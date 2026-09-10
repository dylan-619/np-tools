import type {
  ModbusByteOrder,
  ModbusMonitorPoint,
  ModbusReadFunction,
  ModbusValueType,
} from '../types/modbusDebug'

/** Modbus 读功能码单次允许的最大数量，避免工具发出超规范大报文。 */
const MAX_BITS_PER_READ = 2000
const MAX_REGISTERS_PER_READ = 125

export interface ModbusReadResponse {
  unitId: number
  functionCode: number
  data: Uint8Array
  exceptionCode?: number
}

export type ModbusRtuExtractResult =
  | { kind: 'incomplete'; remaining: Uint8Array }
  | { kind: 'response'; response: ModbusReadResponse; frame: Uint8Array; remaining: Uint8Array }
  | {
      kind: 'error'
      status: 'crc_error' | 'protocol_error'
      message: string
      frame: Uint8Array
      remaining: Uint8Array
    }

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) throw new Error(`${label}必须是整数`)
}

function isBitRead(functionCode: number): boolean {
  return functionCode === 1 || functionCode === 2
}

function referenceBase(functionCode: ModbusReadFunction): number {
  switch (functionCode) {
    case 1:
      return 1
    case 2:
      return 10001
    case 3:
      return 40001
    case 4:
      return 30001
  }
}

/** 按点位录入语义转换为 Modbus PDU 的零基地址。 */
export function resolveModbusAddress(point: ModbusMonitorPoint): number {
  assertInteger(point.address, '地址')
  if (point.addressMode === 'offset') {
    if (point.address < 0 || point.address > 0xffff) {
      throw new Error('PDU 偏移必须在 0 到 65535 之间')
    }
    return point.address
  }

  const base = referenceBase(point.functionCode)
  const offset = point.address - base
  if (offset < 0 || offset > 0xffff) {
    throw new Error(
      `功能码 ${String(point.functionCode).padStart(2, '0')} 的 PLC 参考地址必须在 ${base} 到 ${base + 0xffff} 之间`
    )
  }
  return offset
}

/** 返回本次读响应中数据区应有的字节数。 */
export function expectedModbusDataLength(functionCode: number, quantity: number): number {
  return isBitRead(functionCode) ? Math.ceil(quantity / 8) : quantity * 2
}

/** 标量类型固定读取长度；只有 RAW_HEX 允许用户自行指定批量读取数量。 */
export function requiredScalarQuantity(valueType: ModbusValueType): 1 | 2 | null {
  if (valueType === 'raw') return null
  return ['int32', 'uint32', 'float32'].includes(valueType) ? 2 : 1
}

/** 在发报文前收紧点位范围和数据类型，避免“看似成功但地址语义错误”。 */
export function validateModbusMonitorPoint(point: ModbusMonitorPoint): void {
  assertInteger(point.unitId, '从站 ID')
  if (point.unitId < 1 || point.unitId > 247) {
    throw new Error('从站 ID 必须在 1 到 247 之间')
  }
  if (![1, 2, 3, 4].includes(point.functionCode)) {
    throw new Error('只支持 Modbus 只读功能码 01、02、03、04')
  }
  assertInteger(point.quantity, '读取数量')
  const maxQuantity = isBitRead(point.functionCode) ? MAX_BITS_PER_READ : MAX_REGISTERS_PER_READ
  if (point.quantity < 1 || point.quantity > maxQuantity) {
    throw new Error(
      `${isBitRead(point.functionCode) ? '线圈/离散输入' : '寄存器'}读取数量必须在 1 到 ${maxQuantity} 之间`
    )
  }
  resolveModbusAddress(point)

  if (isBitRead(point.functionCode)) {
    if (point.valueType !== 'bool' && point.valueType !== 'raw') {
      throw new Error('功能码 01、02 只能解码为 BOOL 或 RAW_HEX')
    }
  }

  const scalarQuantity = requiredScalarQuantity(point.valueType)
  if (scalarQuantity !== null && point.quantity !== scalarQuantity) {
    throw new Error(
      `${valueTypeLabel(point.valueType)} 是单值点位，读取数量必须为 ${scalarQuantity}`
    )
  }
}

function valueTypeLabel(valueType: ModbusValueType): string {
  const labels: Record<ModbusValueType, string> = {
    raw: 'RAW_HEX',
    bool: 'BOOL',
    int16: 'INT16',
    uint16: 'UINT16',
    int32: 'INT32',
    uint32: 'UINT32',
    float32: 'FLOAT32',
  }
  return labels[valueType]
}

/** 构建 RTU/TCP 共用的 Unit Id + PDU 读请求（不含 TCP MBAP 或 RTU CRC）。 */
export function buildModbusReadPdu(point: ModbusMonitorPoint): Uint8Array {
  validateModbusMonitorPoint(point)
  const address = resolveModbusAddress(point)
  return Uint8Array.from([
    point.unitId,
    point.functionCode,
    (address >>> 8) & 0xff,
    address & 0xff,
    (point.quantity >>> 8) & 0xff,
    point.quantity & 0xff,
  ])
}

/** 标准 Modbus RTU CRC16；在线上的排列是低字节在前。 */
export function modbusCrc16(bytes: ArrayLike<number>): number {
  let crc = 0xffff
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index] & 0xff
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1
    }
  }
  return crc & 0xffff
}

export function buildModbusRtuRequest(point: ModbusMonitorPoint): Uint8Array {
  const pdu = buildModbusReadPdu(point)
  const crc = modbusCrc16(pdu)
  return Uint8Array.from([...pdu, crc & 0xff, (crc >>> 8) & 0xff])
}

export function formatModbusHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (value) => (value & 0xff).toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

function assertRtuFrameCrc(frame: Uint8Array): void {
  if (frame.length < 4) throw new Error('RTU 响应帧长度不足')
  const expected = modbusCrc16(frame.slice(0, -2))
  const actual = frame[frame.length - 2] | (frame[frame.length - 1] << 8)
  if (actual !== expected) {
    throw new Error(
      `RTU CRC 校验失败：期望 ${expected.toString(16).padStart(4, '0').toUpperCase()}，收到 ${actual
        .toString(16)
        .padStart(4, '0')
        .toUpperCase()}`
    )
  }
}

/** 校验单帧 RTU 响应，并拆出数据区。 */
export function parseModbusRtuResponse(
  frame: Uint8Array,
  point: ModbusMonitorPoint
): ModbusReadResponse {
  validateModbusMonitorPoint(point)
  assertRtuFrameCrc(frame)

  if (frame[0] !== point.unitId) {
    throw new Error(`RTU 响应从站 ID 不匹配：期望 ${point.unitId}，收到 ${frame[0]}`)
  }
  const expectedFunction = point.functionCode
  if (frame[1] === (expectedFunction | 0x80)) {
    if (frame.length !== 5) throw new Error('Modbus 异常响应帧长度错误')
    return {
      unitId: frame[0],
      functionCode: frame[1],
      data: new Uint8Array(),
      exceptionCode: frame[2],
    }
  }
  if (frame[1] !== expectedFunction) {
    throw new Error(
      `RTU 响应功能码不匹配：期望 ${String(expectedFunction).padStart(2, '0')}，收到 ${String(frame[1]).padStart(2, '0')}`
    )
  }

  const byteCount = frame[2]
  if (frame.length !== byteCount + 5) {
    throw new Error(`RTU 响应字节数不匹配：声明 ${byteCount} B，实际帧长 ${frame.length} B`)
  }
  const expectedLength = expectedModbusDataLength(point.functionCode, point.quantity)
  if (byteCount !== expectedLength) {
    throw new Error(`RTU 响应数据长度不匹配：期望 ${expectedLength} B，收到 ${byteCount} B`)
  }
  return {
    unitId: frame[0],
    functionCode: frame[1],
    data: frame.slice(3, 3 + byteCount),
  }
}

/**
 * 从串口字节流中提取当前请求对应的第一帧。串口可能分段到达，因而未完整时
 * 只返回 remaining；不会把不完整报文误判成超时或协议错误。
 */
export function extractModbusRtuResponse(
  buffer: Uint8Array,
  point: ModbusMonitorPoint
): ModbusRtuExtractResult {
  const expectedFunction = point.functionCode
  const expectedByteCount = expectedModbusDataLength(point.functionCode, point.quantity)
  let incompleteStart = -1
  let firstError: Extract<ModbusRtuExtractResult, { kind: 'error' }> | null = null

  for (let index = 0; index + 1 < buffer.length; index += 1) {
    if (buffer[index] !== point.unitId) continue
    const functionCode = buffer[index + 1]
    const isException = functionCode === (expectedFunction | 0x80)
    if (functionCode !== expectedFunction && !isException) continue

    if (!isException) {
      if (index + 2 >= buffer.length) {
        if (incompleteStart < 0) incompleteStart = index
        continue
      }
      // 请求回显的第三字节是地址高位，并不是响应字节计数；不把它当作响应头。
      if (buffer[index + 2] !== expectedByteCount) continue
    }

    const expectedFrameLength = isException ? 5 : expectedByteCount + 5
    if (buffer.length - index < expectedFrameLength) {
      if (incompleteStart < 0) incompleteStart = index
      continue
    }

    const frame = buffer.slice(index, index + expectedFrameLength)
    const remaining = buffer.slice(index + expectedFrameLength)
    try {
      return {
        kind: 'response',
        response: parseModbusRtuResponse(frame, point),
        frame,
        remaining,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      firstError ??= {
        kind: 'error',
        status: message.includes('CRC') ? 'crc_error' : 'protocol_error',
        message,
        frame,
        remaining,
      }
    }
  }

  if (incompleteStart >= 0) {
    return { kind: 'incomplete', remaining: buffer.slice(incompleteStart) }
  }
  if (firstError) return firstError

  // 保留可能构成 [unitId, functionCode] 起始的末尾字节。
  return { kind: 'incomplete', remaining: buffer.slice(Math.max(0, buffer.length - 1)) }
}

function orderedBytes(data: Uint8Array, byteOrder: ModbusByteOrder, byteLength: 2 | 4): Uint8Array {
  if (data.length < byteLength) throw new Error(`响应数据不足，无法解码 ${byteLength * 8} 位数值`)
  const source = data.slice(0, byteLength)
  if (byteLength === 2) {
    return byteOrder === 'BADC' || byteOrder === 'DCBA'
      ? Uint8Array.from([source[1], source[0]])
      : source
  }
  const orderMap: Record<ModbusByteOrder, number[]> = {
    ABCD: [0, 1, 2, 3],
    CDAB: [2, 3, 0, 1],
    BADC: [1, 0, 3, 2],
    DCBA: [3, 2, 1, 0],
  }
  return Uint8Array.from(orderMap[byteOrder].map((index) => source[index]))
}

/** 把一个读响应的数据区按点位配置转换为界面可读值。 */
export function decodeModbusValue(
  point: ModbusMonitorPoint,
  data: Uint8Array
): { value: string; rawHex: string } {
  const rawHex = formatModbusHex(data)
  if (point.valueType === 'raw') return { value: rawHex || '—', rawHex }

  if (point.valueType === 'bool') {
    if (data.length === 0) throw new Error('响应数据为空，无法解码 BOOL')
    const value = isBitRead(point.functionCode)
      ? (data[0] & 0x01) === 1
      : ((data[0] << 8) | (data[1] ?? 0)) !== 0
    return { value: value ? 'true' : 'false', rawHex }
  }

  const byteLength: 2 | 4 = ['int16', 'uint16'].includes(point.valueType) ? 2 : 4
  const ordered = orderedBytes(data, point.byteOrder, byteLength)
  const view = new DataView(ordered.buffer, ordered.byteOffset, ordered.byteLength)
  let value: number
  switch (point.valueType) {
    case 'int16':
      value = view.getInt16(0, false)
      break
    case 'uint16':
      value = view.getUint16(0, false)
      break
    case 'int32':
      value = view.getInt32(0, false)
      break
    case 'uint32':
      value = view.getUint32(0, false)
      break
    case 'float32':
      value = view.getFloat32(0, false)
      break
    default:
      throw new Error(`不支持的数据类型：${point.valueType}`)
  }
  if (!Number.isFinite(value)) return { value: String(value), rawHex }
  return { value: point.valueType === 'float32' ? Number(value.toPrecision(8)).toString() : String(value), rawHex }
}

export function modbusExceptionLabel(exceptionCode?: number): string {
  const labels: Record<number, string> = {
    1: '非法功能码',
    2: '非法数据地址',
    3: '非法数据值',
    4: '从站设备故障',
    5: '确认',
    6: '从站设备忙',
    8: '存储奇偶错误',
    10: '网关路径不可用',
    11: '网关目标无响应',
  }
  return exceptionCode === undefined
    ? '从站异常'
    : `从站异常 ${exceptionCode}${labels[exceptionCode] ? ` · ${labels[exceptionCode]}` : ''}`
}
