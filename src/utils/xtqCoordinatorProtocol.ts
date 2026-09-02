import type { XtqCoordinatorStatus, XtqOwner } from '../types/xtqCoordinator'

export const XTQ_UART_CONFIG = Object.freeze({
  baudRate: 115200,
  dataBits: 'eight',
  stopBits: 'one',
  parity: 'none',
  flowControl: 'none'
})

export const XTQ_MODE_LABELS: Record<number, string> = {
  0: 'PROVISIONING',
  1: 'ETHERNET_EDGE',
  2: 'SLE_CASCADE'
}

export const XTQ_ROLE_LABELS: Record<number, string> = {
  0: 'OFF',
  1: 'SOUTH_MANAGER',
  2: 'NORTH_ENDPOINT'
}

export const XTQ_RADIO_STATE_LABELS: Record<number, string> = {
  0: 'OFF',
  1: 'RESET_ASSERT',
  2: 'RESET_RELEASE',
  3: 'WAIT_STA_HIGH',
  4: 'PROBE_SEL',
  5: 'GET_MODE',
  6: 'GET_ADDR',
  7: 'GET_NAME',
  8: 'GET_TX_POWER',
  9: 'APPLY_DIFFERENCE',
  10: 'WAIT_SET_RESPONSE',
  11: 'READY',
  12: 'RECOVER_BACKOFF'
}

export const XTQ_NETWORK_STATE_LABELS: Record<number, string> = {
  0: 'DISABLED',
  1: 'LINK_WAIT',
  2: 'CONNECTING',
  3: 'ONLINE',
  4: 'BACKOFF'
}

const OWNER_FIELDS: Record<XtqOwner, string[]> = {
  DeviceIdentity: ['coordinator_sn', 'product_type', 'hardware_revision'],
  CoordinatorConfig: [
    'topology_mode',
    'radio1_role',
    'radio2_role',
    'hello_interval_s',
    'neighbor_timeout_s',
    'route_cache_ttl_min',
    'flags',
    'config_sequence'
  ],
  Radio1Config: [
    'local_radio_addr',
    'net_name',
    'tx_power',
    'max_tx_power',
    'ap_id',
    'manager_or_parent_addr',
    'flags'
  ],
  Radio2Config: [
    'local_radio_addr',
    'net_name',
    'tx_power',
    'max_tx_power',
    'ap_id',
    'manager_or_parent_addr',
    'flags'
  ],
  EthernetConfig: [
    'address_mode',
    'flags',
    'mac_override',
    'ipv4_address',
    'ipv4_netmask',
    'ipv4_gateway',
    'ipv4_dns',
    'server_ipv4',
    'server_port',
    'reconnect_interval_s',
    'heartbeat_interval_s',
    'northbound_protocol',
    'config_sequence'
  ]
}

function integer(value: unknown, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} 必须是 ${minimum}~${maximum} 的整数`)
  }
  return Number(value)
}

function ascii(value: unknown, minimum: number, maximum: number, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} 必须是字符串`)
  const bytes = new TextEncoder().encode(value)
  if (
    bytes.length < minimum ||
    bytes.length > maximum ||
    [...value].some((c) => c.charCodeAt(0) < 0x21 || c.charCodeAt(0) > 0x7e)
  ) {
    throw new Error(`${name} 必须为 ${minimum}~${maximum} 字节连续可打印 ASCII`)
  }
  return value
}

function ipv4(value: unknown, name: string, allowZero = true): string {
  if (typeof value !== 'string') throw new Error(`${name} 必须是 IPv4 字符串`)
  const parts = value.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) {
    throw new Error(`${name} 必须是合法点分十进制 IPv4`)
  }
  if (!allowZero && parts.every((part) => Number(part) === 0))
    throw new Error(`${name} 不能为 0.0.0.0`)
  return parts.map(Number).join('.')
}

function requireExactFields(owner: XtqOwner, value: Record<string, unknown>) {
  const expected = OWNER_FIELDS[owner]
  const actual = Object.keys(value)
  const missing = expected.filter((field) => !(field in value))
  const unknown = actual.filter((field) => !expected.includes(field))
  if (missing.length) throw new Error(`${owner} 缺少字段：${missing.join('、')}`)
  if (unknown.length) throw new Error(`${owner} 包含未知字段：${unknown.join('、')}`)
}

export function validateOwnerValue(owner: XtqOwner, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${owner} 必须是 JSON 对象`)
  const data = value as Record<string, unknown>
  requireExactFields(owner, data)

  if (owner === 'DeviceIdentity') {
    ascii(data.coordinator_sn, 12, 12, 'coordinator_sn')
    integer(data.product_type, 0, 255, 'product_type')
    integer(data.hardware_revision, 0, 255, 'hardware_revision')
  } else if (owner === 'CoordinatorConfig') {
    const mode = integer(data.topology_mode, 0, 2, 'topology_mode')
    const r1 = integer(data.radio1_role, 0, 2, 'radio1_role')
    const r2 = integer(data.radio2_role, 0, 2, 'radio2_role')
    const hello = integer(data.hello_interval_s, 5, 60, 'hello_interval_s')
    const timeout = integer(data.neighbor_timeout_s, 15, 255, 'neighbor_timeout_s')
    integer(data.route_cache_ttl_min, 1, 255, 'route_cache_ttl_min')
    if (data.flags !== 0) throw new Error('flags 首版必须为 0')
    integer(data.config_sequence, 0, 65535, 'config_sequence')
    if (timeout < hello * 3) throw new Error('neighbor_timeout_s 不能小于 hello_interval_s 的 3 倍')
    const valid =
      (mode === 0 && r1 === 0 && r2 === 0) ||
      (mode === 1 && [r1, r2].filter((role) => role === 1).length === 1 && [r1, r2].includes(0)) ||
      (mode === 2 && [r1, r2].includes(1) && [r1, r2].includes(2))
    if (!valid) throw new Error('拓扑模式与 Radio 角色组合不合法')
  } else if (owner === 'Radio1Config' || owner === 'Radio2Config') {
    integer(data.local_radio_addr, 0, 65535, 'local_radio_addr')
    ascii(data.net_name, 1, 16, 'net_name')
    integer(data.tx_power, -128, 127, 'tx_power')
    integer(data.max_tx_power, 0, 255, 'max_tx_power')
    integer(data.ap_id, 0, 255, 'ap_id')
    if (data.manager_or_parent_addr !== 0) throw new Error('manager_or_parent_addr 首版必须为 0')
    if (data.flags !== 0) throw new Error('flags 首版必须为 0')
  } else {
    const mode = integer(data.address_mode, 0, 1, 'address_mode')
    if (data.flags !== 0) throw new Error('flags 首版必须为 0')
    if (
      typeof data.mac_override !== 'string' ||
      !/^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(data.mac_override)
    ) {
      throw new Error('mac_override 必须为 XX:XX:XX:XX:XX:XX')
    }
    ipv4(data.ipv4_address, 'ipv4_address', mode === 1)
    ipv4(data.ipv4_netmask, 'ipv4_netmask')
    ipv4(data.ipv4_gateway, 'ipv4_gateway')
    ipv4(data.ipv4_dns, 'ipv4_dns')
    ipv4(data.server_ipv4, 'server_ipv4', false)
    integer(data.server_port, 1, 65535, 'server_port')
    integer(data.reconnect_interval_s, 1, 65535, 'reconnect_interval_s')
    integer(data.heartbeat_interval_s, 0, 65535, 'heartbeat_interval_s')
    integer(data.northbound_protocol, 0, 255, 'northbound_protocol')
    integer(data.config_sequence, 0, 65535, 'config_sequence')
  }
  return data
}

export function parseOkJson(line: string): Record<string, unknown> {
  const trimmed = line.trim()
  if (!trimmed.startsWith('OK ')) throw new Error(`设备未返回 OK JSON：${trimmed}`)
  const parsed = JSON.parse(trimmed.slice(3))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('设备返回的 JSON 不是对象')
  return parsed
}

export function parseStatus(line: string): XtqCoordinatorStatus {
  const status = parseOkJson(line) as unknown as XtqCoordinatorStatus
  if (
    !/^F4(?:07|27)VGT6$/.test(status.target) ||
    typeof status.firmware !== 'string' ||
    !Array.isArray(status.radios) ||
    status.radios.length !== 2
  ) {
    throw new Error('回包不是可识别的 F407/F427 双星闪协调器状态')
  }
  return status
}

export function buildSetCommand(owner: XtqOwner, jsonText: string): string {
  const value = validateOwnerValue(owner, JSON.parse(jsonText))
  const command = `@CFG SET ${owner} ${JSON.stringify(value)}`
  if (new TextEncoder().encode(command).length >= 510)
    throw new Error('命令超过固件 512 B 行缓冲安全上限')
  return command
}

export function enumLabel(labels: Record<number, string>, raw: number): string {
  return labels[raw] ? `${labels[raw]} (${raw})` : `UNKNOWN(${raw})`
}

export function configErrorLabels(mask: number): string[] {
  const labels = [
    'IDENTITY_ERROR',
    'COORDINATOR_ERROR',
    'RADIO1_ERROR',
    'RADIO2_ERROR',
    'ETHERNET_ERROR',
    'CROSS_ERROR'
  ]
  const result = labels.filter((_, bit) => (mask & (1 << bit)) !== 0)
  const knownMask = 0x3f
  if ((mask & ~knownMask) !== 0)
    result.push(`UNKNOWN_BITS(0x${(mask & ~knownMask).toString(16).toUpperCase()})`)
  return result
}
