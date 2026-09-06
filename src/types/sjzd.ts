export interface ModbusPointConfig {
  slaveAddr: number      // 1 ~ 247
  funcCode: number       // 1: 01H, 2: 02H, 3: 03H, 4: 04H
  regAddr: number        // 1 ~ 65535 (PLC 1-based)
  length: number         // 1 ~ 31
  dataType: number       // 0: RAW_HEX, 1: INT16, 2: UINT16, 3: INT32, 4: UINT32, 5: FLOAT32, 6: BOOL
  byteOrder: number      // 0: ABCD, 1: CDAB, 2: BADC, 3: DCBA
  name?: string          // Custom point name
  unit?: string          // e.g. "℃", "MPa", "mA"
}

/** SJZDV3 配置结构化协议中的功能域。 */
export type SjzdConfigFeature = 'SLE' | '4G' | 'RS485'

/**
 * 已通过同一事务 ID、payload 数量与 CRC32 校验的配置快照证据。
 * `deviceStatus=ERROR` 表示快照传输完整，但设备明确报告该配置或运行条件有问题。
 */
export interface SjzdConfigSnapshotEvidence {
  transactionId: number
  revision: number
  revisionHex: string
  payloadCount: number
  crc32: string
  deviceStatus: 'OK' | 'ERROR'
  code?: string
  completedAt: string
}

/** 保存结果由固件写后读校验完成后输出；仍须再做 LIST revision 复核。 */
export interface SjzdConfigSaveReceipt {
  feature: SjzdConfigFeature
  status: 'OK' | 'ERROR'
  revision?: number
  hash?: string
  restart?: string
  code?: string
  receivedAt: string
}

/** UART1 到 UART2 透传的固件确认帧。 */
export interface SjzdBridgeStatus {
  transactionId: number
  requested: boolean
  active: boolean
  uartOwner: 'MCU' | 'SLE' | '4G'
  wireless: 'SLE' | '4G'
  status: 'OK' | 'ERROR'
  code?: string
  confirmedAt: string
}

export type ModbusDebugReportStatus =
  | 'pending'
  | 'ok'
  | 'exception'
  | 'timeout'
  | 'crc_error'
  | 'short_frame'
  | 'overflow'
  | 'unexpected_response'
  | 'malformed_length'
  | 'busy'
  | 'invalid'
  | 'parse_error'
  | 'io_error'
  | 'protocol_error'

/** 单点 Modbus 串口诊断证据；只有完整 `MB_DEBUG:RESULT/END` 才能为终态。 */
export interface ModbusDebugReport {
  schema: 'np-tools.sjzd-modbus-debug-report.v1'
  point: ModbusPointConfig
  port: string
  startedAt: string
  completedAt?: string
  status: ModbusDebugReportStatus
  message: string
  request: {
    transactionId?: number
    pointRevision?: number
    plcAddress?: number
    protoAddress?: number
    timeoutMs?: number
    txHex?: string
  }
  response: {
    addr?: number
    func?: number
    byteCount?: number
    dataHex?: string
    crc?: string
    exceptionCode?: number
    expectedByteCount?: number
    rxHex?: string
    code?: string
  }
  decodedValue?: string
  decodeWarning?: string
  rawLines: string[]
}

export interface SleConfigDto {
  netName: string
  apId: number
  txPower: number
  maxTxPower: number
}

export interface SleFieldComparison {
  fieldName: string
  eepromVal: string
  chipVal: string
  isMatched: boolean
  /** 芯片未就绪/非 SLE 模式时，没有可比较的运行时字段。 */
  isComparable?: boolean
}

export interface SleCurrentStatus {
  netName?: string
  apId?: number
  devAddr?: string
  txPower?: number
  maxTxPower?: number
  mac?: string
  mode?: number
  bridge?: number
  chipAvailable?: boolean
  snapshot?: SjzdConfigSnapshotEvidence
  lastSave?: SjzdConfigSaveReceipt
  lastSyncTime?: string
}

export interface DeviceInfoResult {
  sn?: string
  deviceType?: string
  deviceAddr?: string
  hwVersion?: string
  fwVersion?: string
  bootCount?: number
  uptimeSec?: number
  reportFreqSec?: number
  rawText: string
}

export interface AiSampleDto {
  ai1Ma: number
  ai2Ma: number
  timestampMs: number
}

export const MODBUS_FUNC_OPTIONS = [
  { value: 1, label: '01 读线圈' },
  { value: 2, label: '02 读离散输入' },
  { value: 3, label: '03 读保持寄存器' },
  { value: 4, label: '04 读输入寄存器' },
]

export const MODBUS_DATA_TYPE_OPTIONS = [
  { value: 0, label: 'RAW_HEX', minLen: 1 },
  { value: 1, label: 'INT16', minLen: 1 },
  { value: 2, label: 'UINT16', minLen: 1 },
  { value: 3, label: 'INT32', minLen: 2 },
  { value: 4, label: 'UINT32', minLen: 2 },
  { value: 5, label: 'FLOAT32', minLen: 2 },
  { value: 6, label: 'BOOL', minLen: 1 },
]

export const MODBUS_BYTE_ORDER_OPTIONS = [
  { value: 0, label: 'ABCD' },
  { value: 1, label: 'CDAB' },
  { value: 2, label: 'BADC' },
  { value: 3, label: 'DCBA' },
]

export const SLE_TX_POWER_MAP: Record<number, string> = {
  1: '1 (-6 dBm)',
  2: '2 (-2 dBm)',
  3: '3 (+2 dBm)',
  4: '4 (+6 dBm)',
  5: '5 (+10 dBm)',
  6: '6 (+14 dBm)',
  7: '7 (+16 dBm)',
  8: '8 (+20 dBm)',
}

export const LOG_LEVEL_OPTIONS = [
  { value: 0, label: '0: DEBUG3 (极详细/原始报文)' },
  { value: 1, label: '1: DEBUG2 (详细追踪)' },
  { value: 2, label: '2: DEBUG (常规调试)' },
  { value: 3, label: '3: INFO (关键事件)' },
  { value: 4, label: '4: WARN (警告信息)' },
  { value: 5, label: '5: ERROR (仅错误)' },
]

export type WirelessMode = 'SLE' | '4G'

export interface WlanTypeInfo {
  mode: WirelessMode
  modeCode: number
  uart2Baud: number
  lastSyncTime?: string
}

export interface FourGConfigDto {
  apn: string
  host: string
  port: number
  clientId: string
  username: string
  password: string
  publishTopic: string
  subscribeTopic: string
  keepAliveSec: number
  qos: number
}

export interface FourGStatusInfo {
  eepromVersion?: number
  state?: string
  configOperational?: boolean
  isOnline?: boolean
  passwordIsSet?: boolean
  lastSyncTime?: string
  lastOnlineLogTime?: string
  lastQmtstat?: { client: string; result: string; state: string; time: string }
  retryReason?: string
  hasReadback?: boolean
  configErrors?: string[]
  snapshot?: SjzdConfigSnapshotEvidence
  lastSave?: SjzdConfigSaveReceipt
}

export const FOUR_G_EMPTY_CONFIG: FourGConfigDto = {
  apn: '',
  host: '',
  port: 0,
  clientId: '',
  username: '',
  password: '',
  publishTopic: '',
  subscribeTopic: '',
  keepAliveSec: 0,
  qos: 0,
}

export const FOUR_G_DEFAULT_CONFIG: FourGConfigDto = {
  apn: 'cmiot',
  host: '',
  port: 1883,
  clientId: '',
  username: '',
  password: '',
  publishTopic: '',
  subscribeTopic: '',
  keepAliveSec: 60,
  qos: 1,
}
