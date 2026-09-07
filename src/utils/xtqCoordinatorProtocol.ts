import {
  XTQ_CAPABILITY_SLOT_COUNT,
  type XtqCapabilityValue,
  type XtqCoordinatorStatus,
  type XtqOwner
} from '../types/xtqCoordinator'

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

export const XTQ_SYNC_UPLOAD_MAX_BYTES = 32768
export const XTQ_SYNC_RULE_MAX = 16
export const XTQ_SYNC_MAPPING_MAX = 128

const XTQ_SYNC_DATA_TYPES = ['BOOL', 'INT16', 'UINT16', 'INT32', 'UINT32', 'REAL', 'LREAL'] as const

type JsonRecord = Record<string, unknown>

interface NormalizedSyncMapping {
  from_sn: string
  from_key: string
  data_type: (typeof XTQ_SYNC_DATA_TYPES)[number]
  to_sn: string
  to_key: string
}

interface NormalizedSyncRule {
  id: string
  name: string
  enabled: boolean
  interval_seconds: number
  mappings: NormalizedSyncMapping[]
}

interface NormalizedSyncConfiguration {
  version: 1
  enabled: boolean
  cache_ttl_seconds: number
  rules: NormalizedSyncRule[]
}

export interface XtqPreparedSyncPayload {
  payload: string
  canonicalJson: string
  byteLength: number
  crc32: string
  ruleCount: number
  mappingCount: number
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

function record(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name} 必须是 JSON 对象`)
  return value as JsonRecord
}

function requireFields(name: string, data: JsonRecord, expected: string[]) {
  const actual = Object.keys(data)
  const missing = expected.filter((field) => !(field in data))
  const unknown = actual.filter((field) => !expected.includes(field))
  if (missing.length) throw new Error(`${name} 缺少字段：${missing.join('、')}`)
  if (unknown.length) throw new Error(`${name} 包含未知字段：${unknown.join('、')}`)
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

function printableText(
  value: unknown,
  minimum: number,
  maximum: number,
  name: string,
  asciiOnly = false
): string {
  if (typeof value !== 'string') throw new Error(`${name} 必须是字符串`)
  const bytes = new TextEncoder().encode(value)
  if (
    bytes.length < minimum ||
    bytes.length > maximum ||
    [...value].some((char) => {
      const code = char.codePointAt(0) ?? 0
      return code < 0x20 || (asciiOnly && code > 0x7e)
    })
  ) {
    throw new Error(`${name} 必须为 ${minimum}~${maximum} 字节的可打印${asciiOnly ? ' ASCII' : ' UTF-8'}文本`)
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
  requireFields(owner, value, OWNER_FIELDS[owner])
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

export function capabilityOwnerForSlot(slot: number): string {
  integer(slot, 0, XTQ_CAPABILITY_SLOT_COUNT - 1, 'Capability 槽位')
  return `DeviceCapability${slot}`
}

/**
 * 与固件 DeviceCapability_DecodeJson/EntryValid 保持同一持久化约束。
 * radio_addr_source=1/3 是路由运行时来源，不允许写入 EEPROM capability 槽位。
 */
export function validateCapabilityValue(value: unknown): XtqCapabilityValue {
  const data = record(value, 'DeviceCapability')
  if (data.enabled === false) {
    requireFields('禁用的 DeviceCapability', data, ['enabled'])
    return { enabled: false }
  }
  requireFields('启用的 DeviceCapability', data, [
    'enabled',
    'sn',
    'reported_app_addr',
    'radio_dest_addr',
    'downlink_codec',
    'ack_codec',
    'radio_addr_source'
  ])
  if (data.enabled !== true) throw new Error('DeviceCapability.enabled 必须为 true 或 false')
  const sn = ascii(data.sn, 12, 12, 'sn')
  const reportedAppAddress = integer(data.reported_app_addr, 1, 65534, 'reported_app_addr')
  const radioAddressSource = integer(data.radio_addr_source, 0, 2, 'radio_addr_source')
  if (radioAddressSource !== 0 && radioAddressSource !== 2)
    throw new Error('持久化 Capability 的 radio_addr_source 只允许 0（SPARK_LINK）或 2（FACTORY）')
  const radioDestinationAddress = integer(data.radio_dest_addr, 0, 65534, 'radio_dest_addr')
  const downlinkCodec = integer(data.downlink_codec, 0, 2, 'downlink_codec')
  const ackCodec = integer(data.ack_codec, 0, 2, 'ack_codec')
  if (downlinkCodec === 0 && ackCodec !== 0)
    throw new Error('downlink_codec=0（NONE）时 ack_codec 也必须为 0（NONE）')
  if (radioAddressSource === 0 && radioDestinationAddress !== 0)
    throw new Error('radio_addr_source=0（SPARK_LINK）时 radio_dest_addr 必须为 0')
  if (radioAddressSource === 2 && radioDestinationAddress === 0)
    throw new Error('radio_addr_source=2（FACTORY）时 radio_dest_addr 必须为 1~65534')
  return {
    enabled: true,
    sn,
    reported_app_addr: reportedAppAddress,
    radio_dest_addr: radioDestinationAddress,
    downlink_codec: downlinkCodec,
    ack_codec: ackCodec,
    radio_addr_source: radioAddressSource
  }
}

export function buildCapabilitySetCommand(slot: number, jsonText: string): {
  command: string
  value: XtqCapabilityValue
} {
  const owner = capabilityOwnerForSlot(slot)
  const value = validateCapabilityValue(JSON.parse(jsonText))
  const command = `@CFG SET ${owner} ${JSON.stringify(value)}`
  if (new TextEncoder().encode(command).length >= 510)
    throw new Error('Capability 命令超过固件 512 B 行缓冲安全上限')
  return { command, value }
}

function syncBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} 必须是 true 或 false`)
  return value
}

function normalizeSyncMapping(value: unknown): NormalizedSyncMapping {
  const data = record(value, '同步映射')
  requireFields('同步映射', data, ['from_sn', 'from_key', 'data_type', 'to_sn', 'to_key'])
  if (typeof data.data_type !== 'string') throw new Error('同步映射 data_type 必须是字符串')
  const dataType = data.data_type.toUpperCase()
  if (!XTQ_SYNC_DATA_TYPES.includes(dataType as (typeof XTQ_SYNC_DATA_TYPES)[number]))
    throw new Error(`同步映射 data_type 不支持：${data.data_type}`)
  return {
    from_sn: ascii(data.from_sn, 12, 12, 'from_sn'),
    from_key: printableText(data.from_key, 1, 48, 'from_key'),
    data_type: dataType as (typeof XTQ_SYNC_DATA_TYPES)[number],
    to_sn: ascii(data.to_sn, 12, 12, 'to_sn'),
    to_key: printableText(data.to_key, 1, 48, 'to_key')
  }
}

function normalizeSyncConfiguration(value: unknown): NormalizedSyncConfiguration {
  const data = record(value, '同步规则')
  requireFields('同步规则', data, ['version', 'enabled', 'cache_ttl_seconds', 'rules'])
  if (integer(data.version, 1, 1, 'version') !== 1) throw new Error('version 仅支持 1')
  if (!Array.isArray(data.rules)) throw new Error('rules 必须是数组')
  if (data.rules.length > XTQ_SYNC_RULE_MAX)
    throw new Error(`rules 最多 ${XTQ_SYNC_RULE_MAX} 条`)
  const ruleIds = new Set<string>()
  const targets = new Set<string>()
  let mappingCount = 0
  const rules = data.rules.map((rawRule, index) => {
    const rule = record(rawRule, `rules[${index}]`)
    requireFields(`rules[${index}]`, rule, ['id', 'name', 'enabled', 'interval_seconds', 'mappings'])
    const id = printableText(rule.id, 1, 32, `rules[${index}].id`, true)
    if (ruleIds.has(id)) throw new Error(`规则 ID 重复：${id}`)
    ruleIds.add(id)
    if (!Array.isArray(rule.mappings) || rule.mappings.length === 0)
      throw new Error(`rules[${index}].mappings 必须包含至少一条映射`)
    const mappings = rule.mappings.map((rawMapping, mappingIndex) => {
      const mapping = normalizeSyncMapping(rawMapping)
      mappingCount += 1
      if (mappingCount > XTQ_SYNC_MAPPING_MAX)
        throw new Error(`全部规则最多 ${XTQ_SYNC_MAPPING_MAX} 条映射`)
      const target = `${mapping.to_sn}\u0000${mapping.to_key}`
      if (targets.has(target))
        throw new Error(`映射目标重复：${mapping.to_sn}/${mapping.to_key}（rules[${index}].mappings[${mappingIndex}]）`)
      targets.add(target)
      return mapping
    })
    return {
      id,
      name: printableText(rule.name, 1, 64, `rules[${index}].name`),
      enabled: syncBoolean(rule.enabled, `rules[${index}].enabled`),
      interval_seconds: integer(rule.interval_seconds, 1, 86400, `rules[${index}].interval_seconds`),
      mappings
    }
  })
  return {
    version: 1,
    enabled: syncBoolean(data.enabled, 'enabled'),
    cache_ttl_seconds: integer(data.cache_ttl_seconds, 1, 86400, 'cache_ttl_seconds'),
    rules
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 生成固件可直接接收的单次 @SYNC 事务，不在中途拆包或附加额外换行。 */
export function buildSyncPayload(jsonText: string): XtqPreparedSyncPayload {
  const normalized = normalizeSyncConfiguration(JSON.parse(jsonText))
  const canonicalJson = JSON.stringify(normalized)
  const bytes = new TextEncoder().encode(canonicalJson)
  if (bytes.length === 0 || bytes.length > XTQ_SYNC_UPLOAD_MAX_BYTES)
    throw new Error(`同步 JSON 必须为 1~${XTQ_SYNC_UPLOAD_MAX_BYTES} B UTF-8 数据`)
  const checksum = crc32(bytes).toString(16).toUpperCase().padStart(8, '0')
  return {
    payload: `@SYNC BEGIN ${bytes.length} ${checksum}\r\n${canonicalJson}\r\n@SYNC COMMIT\r\n`,
    canonicalJson,
    byteLength: bytes.length,
    crc32: checksum,
    ruleCount: normalized.rules.length,
    mappingCount: normalized.rules.reduce((total, rule) => total + rule.mappings.length, 0)
  }
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
