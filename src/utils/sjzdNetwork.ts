import type {
  SjzdNetworkConfig, SjzdNetworkRecord, SjzdNetworkSnapshot, SjzdNetworkStatus,
  SjzdNetworkStatusKind, WlanTypeInfo,
} from '../types/sjzd'
import type { SjzdConfigSnapshot } from './sjzdConsoleProtocol'

export const SJZD_NETWORK_DEFAULTS: Readonly<SjzdNetworkConfig> = {
  ip: '192.168.30.55', mask: '255.255.255.0', gateway: '0.0.0.0',
  nettyIp: '0.0.0.0', nettyPort: 0, flags: 2, aiUnit: 247, modbusPort: 502,
}

export const SJZD_NETWORK_FIELDS: Array<{ key: keyof SjzdNetworkConfig; label: string }> = [
  { key: 'ip', label: '本机 IPv4' }, { key: 'mask', label: '子网掩码' },
  { key: 'gateway', label: '路由网关' }, { key: 'nettyIp', label: 'Netty 服务端 IPv4' },
  { key: 'nettyPort', label: 'Netty 服务端口' }, { key: 'flags', label: '服务开关' },
  { key: 'aiUnit', label: '本机 AI Unit ID' }, { key: 'modbusPort', label: 'Modbus TCP 监听端口' },
]

function ipv4(value: string): number | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return undefined
  const octets = value.split('.').map(Number)
  if (octets.some((part) => part > 255)) return undefined
  return ((octets[0]! * 0x1000000) + (octets[1]! << 16) + (octets[2]! << 8) + octets[3]!) >>> 0
}

function unicast(value: number): boolean {
  const first = value >>> 24
  return first !== 0 && first !== 127 && first < 224
}

function host(value: number, mask: number): boolean {
  const tail = (value & ~mask) >>> 0
  return unicast(value) && tail !== 0 && tail !== (~mask >>> 0)
}

export function validateSjzdNetworkConfig(config: SjzdNetworkConfig): Partial<Record<keyof SjzdNetworkConfig, string>> {
  const errors: Partial<Record<keyof SjzdNetworkConfig, string>> = {}
  const integer = (key: 'flags' | 'aiUnit' | 'modbusPort' | 'nettyPort', min: number, max: number) => {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) errors[key] = `请输入 ${min}～${max} 的整数`
  }
  integer('flags', 0, 3); integer('aiUnit', 1, 247); integer('modbusPort', 1, 65535); integer('nettyPort', 0, 65535)
  const local = ipv4(config.ip), mask = ipv4(config.mask), gateway = ipv4(config.gateway), remote = ipv4(config.nettyIp)
  for (const [key, value] of [['ip', local], ['mask', mask], ['gateway', gateway], ['nettyIp', remote]] as const) {
    if (value === undefined) errors[key] = '请输入完整的四段十进制 IPv4'
  }
  if (remote !== undefined && (remote !== 0 || config.nettyPort !== 0 || (config.flags & 1))) {
    if (!unicast(remote)) errors.nettyIp = '启用或预配置 Netty 时须填写合法单播地址'
    if (config.nettyPort === 0) errors.nettyPort = 'Netty 目标端口不能为 0'
  }
  // 兼容原有两个服务关闭、网参全零的合法记录；不把它改写为默认值。
  if (local === 0 && mask === 0 && gateway === 0 && config.flags === 0) return errors
  if (local !== undefined && !unicast(local)) errors.ip = '本机地址不能为回环、组播或未配置地址'
  if (mask !== undefined) {
    const tail = ~mask >>> 0
    if (mask === 0 || tail < 3 || (tail & (tail + 1)) !== 0) errors.mask = '掩码须连续，支持 /1～/30'
    else {
      if (local !== undefined && !host(local, mask)) errors.ip = '本机地址不能为网络号或广播地址'
      if (gateway !== undefined && gateway !== 0 && local !== undefined &&
          (!host(gateway, mask) || (gateway & mask) !== (local & mask) || gateway === local)) {
        errors.gateway = '网关须为本机同子网的其他合法主机'
      }
      if (remote !== undefined && remote !== 0 && local !== undefined) {
        if ((remote & mask) === (local & mask) && !host(remote, mask)) errors.nettyIp = 'Netty 目标不能为网络号或广播'
        if ((config.flags & 1) && (remote & mask) !== (local & mask) && gateway === 0) errors.gateway = '访问跨网段 Netty 服务须配置路由网关'
      }
    }
  }
  return errors
}

export function normalizeSjzdNetworkConfig(config: SjzdNetworkConfig): SjzdNetworkConfig {
  const address = (text: string) => ipv4(text.trim()) === undefined ? text.trim() : text.trim().split('.').map(Number).join('.')
  return {
    ip: address(config.ip), mask: address(config.mask), gateway: address(config.gateway), nettyIp: address(config.nettyIp),
    nettyPort: Number(config.nettyPort), flags: Number(config.flags), aiUnit: Number(config.aiUnit), modbusPort: Number(config.modbusPort),
  }
}

export function buildSjzdNetworkCommand(input: SjzdNetworkConfig): string {
  const config = normalizeSjzdNetworkConfig(input)
  const errors = validateSjzdNetworkConfig(config)
  if (Object.keys(errors).length) throw new Error(Object.entries(errors).map(([key, error]) => `${SJZD_NETWORK_FIELDS.find((field) => field.key === key)?.label}: ${error}`).join('；'))
  return `NET:SET,${config.ip},${config.mask},${config.gateway},${config.nettyIp},${config.nettyPort},${config.flags},${config.aiUnit},${config.modbusPort}`
}

export function sameSjzdNetworkConfig(left: SjzdNetworkConfig, right: SjzdNetworkConfig): boolean {
  return SJZD_NETWORK_FIELDS.every(({ key }) => left[key] === right[key])
}

function numberField(fields: Record<string, string>, key: string, min: number, max: number): number {
  const raw = fields[key]
  if (raw === undefined || !/^\d+$/.test(raw)) throw new Error(`缺少或非法的 ${key}`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} 超出 ${min}～${max}`)
  return value
}

function readRecord(fields: Record<string, string>): SjzdNetworkRecord {
  const config: SjzdNetworkRecord = {
    valid: numberField(fields, 'valid', 0, 1) === 1, code: fields.code || '', version: numberField(fields, 'version', 0, 255),
    ip: fields.ip || '', mask: fields.mask || '', gateway: fields.gateway || '', nettyIp: fields.netty_ip || '',
    nettyPort: numberField(fields, 'netty_port', 0, 65535), flags: numberField(fields, 'flags', 0, 3),
    aiUnit: numberField(fields, 'ai_unit', 1, 247), modbusPort: numberField(fields, 'modbus_port', 1, 65535),
  }
  if (!config.code || (config.valid && (config.code !== 'OK' || config.version !== 1)) || (!config.valid && config.code === 'OK')) throw new Error('NET_CONFIG 记录有效性与 code/version 不一致')
  if (Object.keys(validateSjzdNetworkConfig(config)).length) throw new Error('NET_CONFIG 回读字段非法')
  return config
}

export function parseSjzdNetworkSnapshot(snapshot: SjzdConfigSnapshot): SjzdNetworkSnapshot {
  if (snapshot.feature !== 'NET' || snapshot.version !== 1) throw new Error('不支持的 NET_CONFIG 协议版本')
  if (snapshot.evidence.deviceStatus !== 'OK') throw new Error(`网络记录读取失败：${snapshot.evidence.code || snapshot.evidence.deviceStatus}`)
  if (snapshot.payloads.length !== 3) throw new Error('NET_CONFIG 必须包含两个 ITEM 和一个 STATE')
  const saved = snapshot.payloads.filter((line) => line.event === 'ITEM' && line.fields.source === 'SAVED')
  const running = snapshot.payloads.filter((line) => line.event === 'ITEM' && line.fields.source === 'RUNNING')
  const state = snapshot.payloads.filter((line) => line.event === 'STATE')
  if (saved.length !== 1 || running.length !== 1 || state.length !== 1) throw new Error('NET_CONFIG 来源缺失、重复或包含未知 payload')
  const pending = state[0]!.fields.pending_restart
  if (!['YES', 'NO', 'UNKNOWN'].includes(pending || '')) throw new Error('待重启状态非法')
  const result = { saved: readRecord(saved[0]!.fields), running: readRecord(running[0]!.fields), pendingRestart: pending as SjzdNetworkSnapshot['pendingRestart'], evidence: snapshot.evidence }
  const differs = result.saved.valid !== result.running.valid || !sameSjzdNetworkConfig(result.saved, result.running)
  if ((pending === 'YES') !== differs && pending !== 'UNKNOWN') throw new Error('待重启标志与保存/运行回显不一致')
  return result
}

export function parseSjzdWlanType(line: string): WlanTypeInfo | undefined {
  const match = line.match(/WLAN_TYPE:\s*(mode=[^\r\n]+)/)
  if (!match) return undefined
  const fields: Record<string, string> = {}
  for (const part of match[1]!.split(',')) {
    const pair = part.trim().match(/^([a-z][a-z0-9_]*)=([^=,]+)$/)
    if (!pair || fields[pair[1]!] !== undefined) throw new Error('WLAN_TYPE 字段非法或重复')
    fields[pair[1]!] = pair[2]!
  }
  if (!['SLE', '4G', 'NETTY', 'NONE'].includes(fields.mode || '')) return undefined
  const result: WlanTypeInfo = {
    mode: fields.mode as WlanTypeInfo['mode'], modeCode: numberField(fields, 'mode_code', 0, 4),
    uart2Baud: numberField(fields, 'uart2_baud', 0, 10000000), lastSyncTime: new Date().toLocaleTimeString(),
  }
  if (result.modeCode !== ({ NONE: 0, SLE: 2, '4G': 3, NETTY: 4 }[result.mode])) throw new Error('通信模式与代码不一致')
  if (fields.report_transport !== undefined) {
    if (!['SLE', '4G', 'NETTY', 'NONE'].includes(fields.report_transport)) throw new Error('实际上报承载非法')
    result.reportTransport = fields.report_transport as WlanTypeInfo['reportTransport']
  }
  if (fields.uart2_active !== undefined) result.uart2Active = numberField(fields, 'uart2_active', 0, 1) === 1
  if (fields.saved_mode_code !== undefined) result.savedModeCode = numberField(fields, 'saved_mode_code', 0, 255)
  if (fields.saved_read_ok !== undefined) result.savedReadOk = numberField(fields, 'saved_read_ok', 0, 1) === 1
  if (fields.mode_source !== undefined) {
    if (!['SAVED', 'LEGACY_NETTY', 'AUTO_PROBING', 'AUTO'].includes(fields.mode_source)) throw new Error('模式来源非法')
    result.modeSource = fields.mode_source as WlanTypeInfo['modeSource']
  }
  if (fields.module_state !== undefined) {
    if (!['DISABLED', 'PROBING', 'RESPONDING', 'NO_RESPONSE', 'BRIDGE'].includes(fields.module_state)) throw new Error('模块串口状态非法')
    result.moduleState = fields.module_state as WlanTypeInfo['moduleState']
  }
  if (fields.module_age_ms !== undefined) result.moduleAgeMs = numberField(fields, 'module_age_ms', 0, 0xffffffff)
  if (fields.module_failures !== undefined) result.moduleFailures = numberField(fields, 'module_failures', 0, 0xffffffff)
  if (result.reportTransport && result.reportTransport !== 'NETTY' && result.reportTransport !== result.mode) throw new Error('通信模式与实际上报承载不一致')
  if (result.mode === 'NONE' && result.reportTransport && result.reportTransport !== 'NONE') throw new Error('未启用上报状态与实际承载不一致')
  const wired = result.mode === 'NONE' || result.mode === 'NETTY' || result.reportTransport === 'NETTY'
  if ((wired && result.uart2Active === true) || (result.uart2Active === true && result.uart2Baud === 0) ||
      ((result.mode === 'NETTY' || result.mode === 'NONE') && result.uart2Baud !== 0) ||
      (!wired && result.uart2Baud === 0 && result.uart2Active !== false)) throw new Error('实际上报承载与 UART2 状态不一致')
  return result
}

export class SjzdNetworkStatusCollector {
  private parts: SjzdNetworkStatus['parts'] = {}
  private rawLines: string[] = []
  static readonly kinds: SjzdNetworkStatusKind[] = ['STATUS', 'NETTY', 'MODBUS', 'CACHE', 'RESOURCES']

  feed(line: string): boolean {
    const match = line.trim().match(/^NET:(STATUS|NETTY|MODBUS|CACHE|RESOURCES),(.+)$/)
    if (!match) return false
    const kind = match[1] as SjzdNetworkStatusKind
    if (this.parts[kind]) throw new Error(`重复的 NET:${kind} 状态行`)
    const fields: Record<string, string> = {}
    for (const item of match[2]!.split(',')) {
      const pair = item.match(/^([a-z][a-z0-9_]*)=([^=,]+)$/)
      if (!pair || fields[pair[1]!] !== undefined) throw new Error(`NET:${kind} 字段非法或重复`)
      fields[pair[1]!] = pair[2]!
    }
    const required: Record<SjzdNetworkStatusKind, string[]> = {
      STATUS: ['ip', 'driver', 'link', 'report_transport'], NETTY: ['enabled', 'state'],
      MODBUS: ['enabled', 'listening'], CACHE: ['ai_valid'], RESOURCES: ['lwip_heap_used', 'netconn_used'],
    }
    if (required[kind].some((key) => fields[key] === undefined)) throw new Error(`NET:${kind} 缺少必要状态字段`)
    this.parts[kind] = fields
    this.rawLines.push(line.trim())
    return this.snapshot().complete
  }

  snapshot(): SjzdNetworkStatus {
    const missing = SjzdNetworkStatusCollector.kinds.filter((kind) => !this.parts[kind])
    return { parts: { ...this.parts }, complete: missing.length === 0, missing, receivedAt: new Date().toISOString(), rawLines: [...this.rawLines] }
  }
}
