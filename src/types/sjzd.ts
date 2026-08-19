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
  { value: 1, label: '01H 读线圈 (Read Coils)' },
  { value: 2, label: '02H 读离散输入 (Read Discrete Inputs)' },
  { value: 3, label: '03H 读保持寄存器 (Read Holding Registers)' },
  { value: 4, label: '04H 读输入寄存器 (Read Input Registers)' },
]

export const MODBUS_DATA_TYPE_OPTIONS = [
  { value: 0, label: 'RAW_HEX (原始十六进制)', minLen: 1 },
  { value: 1, label: 'INT16 (16位有符号整型)', minLen: 1 },
  { value: 2, label: 'UINT16 (16位无符号整型)', minLen: 1 },
  { value: 3, label: 'INT32 (32位有符号整型)', minLen: 2 },
  { value: 4, label: 'UINT32 (32位无符号整型)', minLen: 2 },
  { value: 5, label: 'FLOAT32 (32位单精度浮点)', minLen: 2 },
  { value: 6, label: 'BOOL (布尔线圈状态)', minLen: 1 },
]

export const MODBUS_BYTE_ORDER_OPTIONS = [
  { value: 0, label: 'ABCD (大端 Big-Endian 标准)' },
  { value: 1, label: 'CDAB (字交换 Word Swap / 主流PLC浮点)' },
  { value: 2, label: 'BADC (字节交换 Byte Swap)' },
  { value: 3, label: 'DCBA (小端 Little-Endian)' },
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
