/** 通用 Modbus 只读调试工作台的传输层。 */
export type ModbusTransport = 'rtu' | 'tcp'

/** 与 Modbus 功能码 01..04 对应的只读点位类型。 */
export type ModbusReadFunction = 1 | 2 | 3 | 4

/** 读取值的解码方式；RAW_HEX 保留设备原始字节。 */
export type ModbusValueType = 'raw' | 'bool' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32'

/** Modbus 寄存器数据的字节/字顺序。 */
export type ModbusByteOrder = 'ABCD' | 'CDAB' | 'BADC' | 'DCBA'

/** PLC 参考地址与 Modbus PDU 零基偏移两种录入语义必须明确区分。 */
export type ModbusAddressMode = 'reference' | 'offset'

export interface ModbusMonitorPoint {
  id: string
  name: string
  enabled: boolean
  unitId: number
  functionCode: ModbusReadFunction
  address: number
  addressMode: ModbusAddressMode
  quantity: number
  valueType: ModbusValueType
  byteOrder: ModbusByteOrder
}

export type ModbusPointStatus =
  | 'idle'
  | 'reading'
  | 'ok'
  | 'timeout'
  | 'exception'
  | 'crc_error'
  | 'protocol_error'
  | 'communication_error'
  | 'validation_error'

export interface ModbusPointRuntime {
  status: ModbusPointStatus
  value?: string
  rawHex?: string
  updatedAt?: string
  elapsedMs?: number
  message?: string
  requestHex?: string
  responseHex?: string
}

export interface ModbusTcpReadRequest {
  host: string
  port: number
  unitId: number
  functionCode: ModbusReadFunction
  address: number
  quantity: number
  timeoutMs: number
}

export interface ModbusTcpReadResponse {
  unitId: number
  functionCode: number
  data: number[]
  exceptionCode?: number
  txAdu: number[]
  rxAdu: number[]
  elapsedMs: number
}

export const MODBUS_READ_FUNCTION_OPTIONS: Array<{ value: ModbusReadFunction; label: string }> = [
  { value: 1, label: '01 · 读线圈' },
  { value: 2, label: '02 · 读离散输入' },
  { value: 3, label: '03 · 读保持寄存器' },
  { value: 4, label: '04 · 读输入寄存器' },
]

export const MODBUS_VALUE_TYPE_OPTIONS: Array<{ value: ModbusValueType; label: string }> = [
  { value: 'raw', label: 'RAW_HEX' },
  { value: 'bool', label: 'BOOL' },
  { value: 'int16', label: 'INT16' },
  { value: 'uint16', label: 'UINT16' },
  { value: 'int32', label: 'INT32' },
  { value: 'uint32', label: 'UINT32' },
  { value: 'float32', label: 'FLOAT32' },
]

export const MODBUS_BYTE_ORDER_OPTIONS: Array<{ value: ModbusByteOrder; label: string }> = [
  { value: 'ABCD', label: 'ABCD' },
  { value: 'CDAB', label: 'CDAB' },
  { value: 'BADC', label: 'BADC' },
  { value: 'DCBA', label: 'DCBA' },
]

export const MODBUS_ADDRESS_MODE_OPTIONS: Array<{ value: ModbusAddressMode; label: string }> = [
  { value: 'reference', label: 'PLC 参考地址' },
  { value: 'offset', label: 'PDU 偏移 (0 基)' },
]
