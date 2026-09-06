import type {
  FourGConfigDto,
  FourGStatusInfo,
  ModbusPointConfig,
  SjzdBridgeStatus,
  SjzdConfigFeature,
  SjzdConfigSaveReceipt,
  SjzdConfigSnapshotEvidence,
} from '../types/sjzd'

const CONFIG_PREFIXES: Record<SjzdConfigFeature, string> = {
  SLE: 'SLE_CONFIG:',
  '4G': '4G_CONFIG:',
  RS485: 'RS485_CONFIG:',
}

export interface SjzdConfigProtocolLine {
  feature: SjzdConfigFeature
  event: string
  fields: Record<string, string>
  /** 固件参与 payload CRC32 的完整 ASCII 行，不含 CR/LF。 */
  raw: string
}

export interface SjzdConfigSnapshot {
  feature: SjzdConfigFeature
  id: number
  version: number
  revision: number
  payloads: SjzdConfigProtocolLine[]
  evidence: SjzdConfigSnapshotEvidence
}

export interface SjzdSleSnapshot {
  eeprom: {
    netName: string
    apId: number
    devAddr: string
    txPower: number
    maxTxPower: number
    bridge: number
  }
  chip?: {
    netName: string
    nameLength: number
    mode: number
    mac: string
    devAddr: string
    txPower: number
  }
  evidence: SjzdConfigSnapshotEvidence
}

export interface SjzdRs485Snapshot {
  points: ModbusPointConfig[]
  evidence: SjzdConfigSnapshotEvidence
}

export interface SjzdFourGSnapshot {
  config: FourGConfigDto
  status: FourGStatusInfo
  evidence: SjzdConfigSnapshotEvidence
}

export interface SjzdSnapshotFeedResult {
  snapshot?: SjzdConfigSnapshot
  error?: string
}

function splitTopLevel(value: string, separator: string): string[] | undefined {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (const char of value) {
    if (char === '"') quoted = !quoted
    if (char === separator && !quoted) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (quoted) return undefined
  parts.push(current)
  return parts
}

function findTopLevelEquals(value: string): number {
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted
    if (value[index] === '=' && !quoted) return index
  }
  return -1
}

function parseFields(parts: string[]): Record<string, string> | undefined {
  const fields: Record<string, string> = {}
  for (const part of parts) {
    const equals = findTopLevelEquals(part)
    if (equals <= 0) return undefined
    const key = part.slice(0, equals).trim().toLowerCase()
    let value = part.slice(equals + 1).trim()
    if (!/^[a-z][a-z0-9_]*$/i.test(key) || Object.prototype.hasOwnProperty.call(fields, key)) return undefined
    if (value.startsWith('"')) {
      if (value.length < 2 || !value.endsWith('"')) return undefined
      value = value.slice(1, -1)
      if (value.includes('"')) return undefined
    } else if (!value || value.includes('"')) {
      return undefined
    }
    fields[key] = value
  }
  return fields
}

function parseLineAfterPrefix(raw: string, prefix: string): { event: string; fields: Record<string, string>; raw: string } | undefined {
  const normalized = raw.trim()
  if (!normalized.startsWith(prefix)) return undefined
  const parts = splitTopLevel(normalized.slice(prefix.length), ',')
  if (!parts || parts.length === 0) return undefined
  const event = parts[0].trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9_]*$/.test(event)) return undefined
  const fields = parseFields(parts.slice(1))
  if (!fields) return undefined
  return { event, fields, raw: normalized }
}

/** 忽略 DBG 前缀，只提取固件直接写入 UART1 的结构化配置行。 */
export function parseSjzdConfigProtocolLine(line: string): SjzdConfigProtocolLine | undefined {
  const matched = (Object.entries(CONFIG_PREFIXES) as Array<[SjzdConfigFeature, string]>)
    .map(([feature, prefix]) => ({ feature, prefix, index: line.indexOf(prefix) }))
    .filter((candidate) => candidate.index >= 0)
    .sort((left, right) => left.index - right.index)[0]
  if (!matched) return undefined
  const parsed = parseLineAfterPrefix(line.slice(matched.index), matched.prefix)
  return parsed ? { feature: matched.feature, ...parsed } : undefined
}

function uintField(fields: Record<string, string>, key: string, label = key): number {
  const value = fields[key]
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${label} 必须是十进制无符号整数`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    throw new Error(`${label} 超出 uint32 范围`)
  }
  return parsed
}

function boundedUint(fields: Record<string, string>, key: string, min: number, max: number, label = key): number {
  const value = uintField(fields, key, label)
  if (value < min || value > max) throw new Error(`${label} 必须在 ${min}..${max} 范围内`)
  return value
}

function textField(fields: Record<string, string>, key: string, label = key): string {
  const value = fields[key]
  if (value === undefined) throw new Error(`缺少 ${label}`)
  return value
}

function hexCrc32(value: string, label = 'crc32'): number {
  if (!/^[0-9a-f]{8}$/i.test(value)) throw new Error(`${label} 必须是 8 位十六进制数`)
  return Number.parseInt(value, 16) >>> 0
}

export function formatSjzdCrc32(value: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

/** 与固件 `ConsoleCrc32Start/Update/Finish` 相同的 CRC-32/ISO-HDLC。 */
export function crc32IsoHdlc(text: string): number {
  let crc = 0xffffffff
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function sameTransactionId(fields: Record<string, string>, expected: number): boolean {
  try {
    return uintField(fields, 'id') === expected
  } catch {
    return false
  }
}

/** 连续喂入同一配置 LIST 的行；仅在 END 的数量和 CRC 都通过时产出快照。 */
export class SjzdConfigSnapshotCollector {
  private active?: { id: number; version: number; revision: number; payloads: SjzdConfigProtocolLine[] }

  constructor(private readonly feature: SjzdConfigFeature) {}

  feed(line: string): SjzdSnapshotFeedResult {
    const parsed = parseSjzdConfigProtocolLine(line)
    if (!parsed || parsed.feature !== this.feature) return {}
    try {
      if (parsed.event === 'BEGIN') {
        if (this.active) return { error: `${this.feature}_CONFIG 在前一事务结束前出现新的 BEGIN` }
        this.active = {
          id: boundedUint(parsed.fields, 'id', 1, 0xffffffff, '事务 ID'),
          version: boundedUint(parsed.fields, 'version', 1, 0xffff, '协议版本'),
          revision: uintField(parsed.fields, 'revision', '配置 revision'),
          payloads: [],
        }
        return {}
      }

      if (!this.active) return {}
      if (!sameTransactionId(parsed.fields, this.active.id)) return {}

      if (parsed.event !== 'END') {
        if (parsed.event === 'SAVED') return {}
        this.active.payloads.push(parsed)
        return {}
      }

      const payloadCount = boundedUint(parsed.fields, 'count', 0, 1000, 'payload count')
      const receivedCrc = hexCrc32(textField(parsed.fields, 'crc32'))
      const status = textField(parsed.fields, 'status').toUpperCase()
      if (status !== 'OK' && status !== 'ERROR') throw new Error(`END status 不受支持：${status}`)
      if (payloadCount !== this.active.payloads.length) {
        throw new Error(`payload count 不一致：END=${payloadCount}，实际=${this.active.payloads.length}`)
      }
      const calculatedCrc = crc32IsoHdlc(this.active.payloads.map((payload) => payload.raw).join(''))
      if (receivedCrc !== calculatedCrc) {
        throw new Error(`payload CRC32 不一致：设备=${formatSjzdCrc32(receivedCrc)}，本机=${formatSjzdCrc32(calculatedCrc)}`)
      }
      const completed = this.active
      this.active = undefined
      return {
        snapshot: {
          feature: this.feature,
          id: completed.id,
          version: completed.version,
          revision: completed.revision,
          payloads: completed.payloads,
          evidence: {
            transactionId: completed.id,
            revision: completed.revision,
            revisionHex: `0x${formatSjzdCrc32(completed.revision)}`,
            payloadCount,
            crc32: formatSjzdCrc32(receivedCrc),
            deviceStatus: status,
            code: parsed.fields.code,
            completedAt: new Date().toISOString(),
          },
        },
      }
    } catch (error) {
      this.active = undefined
      return { error: `${this.feature}_CONFIG 协议无效：${error instanceof Error ? error.message : String(error)}` }
    }
  }
}

function expectVersionOne(snapshot: SjzdConfigSnapshot) {
  if (snapshot.version !== 1) throw new Error(`不支持 ${snapshot.feature}_CONFIG version=${snapshot.version}`)
}

function onlyPayload(snapshot: SjzdConfigSnapshot, event: string): SjzdConfigProtocolLine {
  const matched = snapshot.payloads.filter((payload) => payload.event === event)
  if (matched.length !== 1) throw new Error(`${snapshot.feature}_CONFIG 需要且只能包含一条 ${event} payload`)
  return matched[0]
}

function assertKnownPayloads(snapshot: SjzdConfigSnapshot, allowed: string[]) {
  const unexpected = snapshot.payloads.find((payload) => !allowed.includes(payload.event))
  if (unexpected) throw new Error(`${snapshot.feature}_CONFIG 包含不支持的 ${unexpected.event} payload`)
}

function parseModbusPoint(fields: Record<string, string>, expectedIndex: number): ModbusPointConfig {
  const index = boundedUint(fields, 'index', 0, 99, '点位 index')
  if (index !== expectedIndex) throw new Error(`点位 index 不连续：期望 ${expectedIndex}，收到 ${index}`)
  const point: ModbusPointConfig = {
    slaveAddr: boundedUint(fields, 'addr', 1, 247, '从站地址'),
    funcCode: boundedUint(fields, 'func', 1, 4, '功能码'),
    regAddr: boundedUint(fields, 'reg', 1, 65535, 'PLC 地址'),
    length: boundedUint(fields, 'len', 1, 31, '读取长度'),
    dataType: boundedUint(fields, 'type', 0, 6, '数据类型'),
    byteOrder: boundedUint(fields, 'order', 0, 3, '字节序'),
  }
  if (point.regAddr + point.length - 1 > 65536) throw new Error('PLC 地址与长度超出设备范围')
  if (point.dataType === 6 && ![1, 2].includes(point.funcCode)) {
    throw new Error('BOOL 仅允许 FC01/FC02')
  }
  if ([1, 2, 3, 4, 5].includes(point.dataType) && ![3, 4].includes(point.funcCode)) {
    throw new Error('数值类型仅允许 FC03/FC04')
  }
  if ([3, 4, 5].includes(point.dataType) && point.length < 2) {
    throw new Error('32 位类型读取长度至少为 2')
  }
  return point
}

export function parseSjzdRs485Snapshot(snapshot: SjzdConfigSnapshot): SjzdRs485Snapshot {
  if (snapshot.feature !== 'RS485') throw new Error('不是 RS485_CONFIG 快照')
  expectVersionOne(snapshot)
  if (snapshot.evidence.deviceStatus !== 'OK') {
    throw new Error(`设备以 ${snapshot.evidence.deviceStatus}${snapshot.evidence.code ? `/${snapshot.evidence.code}` : ''} 结束 RS485_CONFIG`)
  }
  assertKnownPayloads(snapshot, ['POINT'])
  const points = snapshot.payloads.map((payload, index) => parseModbusPoint(payload.fields, index))
  if (points.length !== snapshot.evidence.payloadCount) throw new Error('RS485_CONFIG 点位数量不一致')
  return { points, evidence: snapshot.evidence }
}

export function parseSjzdSleSnapshot(snapshot: SjzdConfigSnapshot): SjzdSleSnapshot {
  if (snapshot.feature !== 'SLE') throw new Error('不是 SLE_CONFIG 快照')
  expectVersionOne(snapshot)
  assertKnownPayloads(snapshot, ['EEPROM', 'CHIP'])
  const eeprom = onlyPayload(snapshot, 'EEPROM').fields
  const chipPayload = snapshot.payloads.find((payload) => payload.event === 'CHIP')
  if (snapshot.evidence.deviceStatus === 'OK' && !chipPayload) {
    throw new Error('SLE_CONFIG status=OK 但缺少 CHIP payload')
  }
  if (snapshot.evidence.deviceStatus === 'ERROR' && !snapshot.evidence.code) {
    throw new Error('SLE_CONFIG status=ERROR 缺少错误码')
  }
  const result: SjzdSleSnapshot = {
    eeprom: {
      netName: textField(eeprom, 'net_name'),
      apId: boundedUint(eeprom, 'apid', 0, 255, 'SLE APID'),
      devAddr: String(boundedUint(eeprom, 'dev_addr', 0, 65535, 'SLE DevAddr')),
      txPower: boundedUint(eeprom, 'tx_pwr', 0, 8, 'SLE 发射功率'),
      maxTxPower: boundedUint(eeprom, 'max_tx_pwr', 0, 8, 'SLE 最大发射功率'),
      bridge: boundedUint(eeprom, 'bridge', 0, 1, 'SLE bridge'),
    },
    evidence: snapshot.evidence,
  }
  if (chipPayload) {
    const chip = chipPayload.fields
    const mac = textField(chip, 'mac').toUpperCase()
    if (!/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) throw new Error('SLE CHIP MAC 格式无效')
    result.chip = {
      netName: textField(chip, 'net_name'),
      nameLength: boundedUint(chip, 'name_len', 0, 255, 'SLE CHIP name_len'),
      mode: boundedUint(chip, 'mode', 0, 255, 'SLE CHIP mode'),
      mac,
      devAddr: String(boundedUint(chip, 'addr', 0, 65535, 'SLE CHIP addr')),
      txPower: boundedUint(chip, 'tx_pwr', 0, 8, 'SLE CHIP 发射功率'),
    }
  }
  return result
}

function fourGErrorLabels(errorMask: number): string[] {
  const definitions: Array<[number, string]> = [
    [0x0001, 'EEPROM 配置块无效或为空'],
    [0x0002, 'MQTT Broker 主机未配置'],
    [0x0004, 'MQTT Client ID 未配置'],
    [0x0008, 'MQTT 发布 Topic 未配置'],
    [0x0010, 'MQTT 订阅 Topic 未配置'],
    [0x0020, 'MQTT Broker 端口未配置'],
    [0x0040, 'MQTT KeepAlive 未配置'],
    [0x0080, 'MQTT QoS 无效'],
  ]
  const labels = definitions.filter(([bit]) => (errorMask & bit) !== 0).map(([, label]) => label)
  const unknown = errorMask & ~0x00ff
  if (unknown !== 0) labels.push(`未知配置错误掩码 0x${unknown.toString(16).toUpperCase()}`)
  return labels
}

export function parseSjzdFourGSnapshot(snapshot: SjzdConfigSnapshot): SjzdFourGSnapshot {
  if (snapshot.feature !== '4G') throw new Error('不是 4G_CONFIG 快照')
  expectVersionOne(snapshot)
  const expectedEvents = ['META', 'APN', 'BROKER', 'MQTT', 'IDENTITY', 'PUBLISH', 'SUBSCRIBE']
  if (snapshot.payloads.length !== expectedEvents.length || snapshot.payloads.some((item, index) => item.event !== expectedEvents[index])) {
    throw new Error('4G_CONFIG payload 顺序或数量不符合 version=1 契约')
  }
  const meta = onlyPayload(snapshot, 'META').fields
  const configState = textField(meta, 'config').toLowerCase()
  if (configState !== 'valid' && configState !== 'incomplete') throw new Error(`4G config 状态无效：${configState}`)
  const errorMaskRaw = textField(meta, 'error_mask')
  if (!/^0x[0-9a-f]{1,4}$/i.test(errorMaskRaw)) throw new Error('4G error_mask 格式无效')
  const errorMask = Number.parseInt(errorMaskRaw, 16)
  const apn = onlyPayload(snapshot, 'APN').fields
  const broker = onlyPayload(snapshot, 'BROKER').fields
  const mqtt = onlyPayload(snapshot, 'MQTT').fields
  const identity = onlyPayload(snapshot, 'IDENTITY').fields
  const publish = onlyPayload(snapshot, 'PUBLISH').fields
  const subscribe = onlyPayload(snapshot, 'SUBSCRIBE').fields
  const passwordState = textField(identity, 'password').toLowerCase()
  if (passwordState !== 'set' && passwordState !== 'empty') throw new Error('4G password 状态无效')
  const config: FourGConfigDto = {
    apn: textField(apn, 'value'),
    host: textField(broker, 'host'),
    port: boundedUint(broker, 'port', 0, 65535, '4G Broker 端口'),
    clientId: textField(identity, 'client'),
    username: textField(identity, 'username'),
    password: '',
    publishTopic: textField(publish, 'value'),
    subscribeTopic: textField(subscribe, 'value'),
    keepAliveSec: boundedUint(mqtt, 'keepalive', 0, 65535, '4G KeepAlive'),
    qos: boundedUint(mqtt, 'qos', 0, 1, '4G QoS'),
  }
  const status: FourGStatusInfo = {
    eepromVersion: boundedUint(meta, 'eeprom_version', 0, 255, '4G EEPROM 版本'),
    state: textField(meta, 'state'),
    configOperational: configState === 'valid',
    isOnline: boundedUint(meta, 'online', 0, 1, '4G online') === 1,
    passwordIsSet: passwordState === 'set',
    hasReadback: true,
    configErrors: fourGErrorLabels(errorMask),
    snapshot: snapshot.evidence,
  }
  if (snapshot.evidence.deviceStatus === 'OK' && !status.configOperational) {
    throw new Error('4G_CONFIG status=OK 与 META.config=incomplete 冲突')
  }
  if (snapshot.evidence.deviceStatus === 'ERROR' && snapshot.evidence.code !== 'CONFIG_INCOMPLETE') {
    throw new Error(`4G_CONFIG 错误终态不受支持：${snapshot.evidence.code || '(缺少 code)'}`)
  }
  return { config, status, evidence: snapshot.evidence }
}

/** 解析保存回执；OK 回执必须能证明 revision 与 hash 是同一 uint32 值。 */
export function parseSjzdConfigSaveReceipt(line: string): SjzdConfigSaveReceipt | undefined {
  const parsed = parseSjzdConfigProtocolLine(line)
  if (!parsed || parsed.event !== 'SAVED') return undefined
  try {
    const status = textField(parsed.fields, 'status').toUpperCase()
    if (status !== 'OK' && status !== 'ERROR') return undefined
    const receipt: SjzdConfigSaveReceipt = {
      feature: parsed.feature,
      status,
      receivedAt: new Date().toISOString(),
    }
    if (status === 'ERROR') {
      receipt.code = textField(parsed.fields, 'code')
      return receipt
    }
    const revision = uintField(parsed.fields, 'revision', '保存 revision')
    const hash = formatSjzdCrc32(hexCrc32(textField(parsed.fields, 'hash', '保存 hash')))
    if (revision !== Number.parseInt(hash, 16)) return undefined
    receipt.revision = revision
    receipt.hash = hash
    receipt.restart = textField(parsed.fields, 'restart')
    return receipt
  } catch {
    return undefined
  }
}

/** 解析 `SLE_BRIDGE:ACK`；仅状态为 OK 且 active/requested 一致时才可改变 UI 状态。 */
export function parseSjzdBridgeAck(line: string): SjzdBridgeStatus | undefined {
  const marker = line.indexOf('SLE_BRIDGE:')
  if (marker < 0) return undefined
  const parsed = parseLineAfterPrefix(line.slice(marker), 'SLE_BRIDGE:')
  if (!parsed || parsed.event !== 'ACK') return undefined
  try {
    const status = textField(parsed.fields, 'status').toUpperCase()
    if (status !== 'OK' && status !== 'ERROR') return undefined
    const result: SjzdBridgeStatus = {
      transactionId: boundedUint(parsed.fields, 'id', 1, 0xffffffff, '桥接事务 ID'),
      requested: boundedUint(parsed.fields, 'requested', 0, 1, '桥接 requested') === 1,
      active: boundedUint(parsed.fields, 'active', 0, 1, '桥接 active') === 1,
      uartOwner: textField(parsed.fields, 'uart_owner').toUpperCase() as SjzdBridgeStatus['uartOwner'],
      wireless: textField(parsed.fields, 'wireless').toUpperCase() as SjzdBridgeStatus['wireless'],
      status,
      code: parsed.fields.code,
      confirmedAt: new Date().toISOString(),
    }
    if (!['MCU', 'SLE', '4G'].includes(result.uartOwner) || !['SLE', '4G'].includes(result.wireless)) return undefined
    if (result.status === 'OK' && result.active !== result.requested) return undefined
    return result
  } catch {
    return undefined
  }
}
