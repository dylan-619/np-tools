import type {
  ModbusDebugReport,
  ModbusDebugReportStatus,
  ModbusPointConfig,
} from '../types/sjzd'

export interface ModbusDebugProtocolEvent {
  type: 'begin' | 'tx' | 'rx' | 'data' | 'result' | 'end'
  fields: Record<string, string>
}

function normalizedHex(value: string): string {
  const compact = value.replace(/\s/g, '').toUpperCase()
  if (!compact || compact.length % 2 !== 0 || !/^[0-9A-F]+$/.test(compact)) {
    throw new Error('设备返回的 Modbus HEX 不是偶数位十六进制字节串')
  }
  return compact
}

function numberField(fields: Record<string, string>, key: string): number | undefined {
  const raw = fields[key]
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

function outcome(status: string | undefined, code: string | undefined): ModbusDebugReportStatus {
  switch ((status || '').toUpperCase()) {
    case 'OK':
      return 'ok'
    case 'EXCEPTION':
      return 'exception'
    case 'TIMEOUT':
      return 'timeout'
    case 'CRC_ERROR':
      return 'crc_error'
    case 'IO_ERROR':
      switch ((code || '').toUpperCase()) {
        case 'BUSY':
          return 'busy'
        case 'INVALID_ARGUMENT':
          return 'invalid'
        case 'PARSE_ERROR':
          return 'parse_error'
        case 'RX_OVERFLOW':
          return 'overflow'
        case 'SHORT_FRAME':
          return 'short_frame'
        case 'UNEXPECTED_FUNCTION':
          return 'unexpected_response'
        case 'RESPONSE_LENGTH':
          return 'malformed_length'
        default:
          return 'io_error'
      }
    default:
      return 'protocol_error'
  }
}

function outcomeMessage(status: ModbusDebugReportStatus): string {
  const messages: Record<ModbusDebugReportStatus, string> = {
    pending: '等待设备完成单点 Modbus 诊断',
    ok: '设备已收到一帧 CRC 正确、长度匹配的 Modbus 响应',
    exception: '从站返回 Modbus 异常码',
    timeout: '在固件单点诊断窗口内未收到目标从站响应',
    crc_error: '目标从站响应 CRC 校验失败',
    short_frame: '目标从站响应帧长度不足',
    overflow: 'UART3 接收缓冲溢出，响应已丢弃',
    unexpected_response: '目标从站返回了与请求不匹配的功能码',
    malformed_length: '目标从站响应字节数与请求不匹配',
    busy: '后台轮询或另一条诊断正在占用 RS485，设备拒绝本次单点调试',
    invalid: '设备拒绝了不合法的单点调试参数',
    parse_error: '设备无法解析单点调试命令',
    io_error: '设备在 Modbus 单点诊断中报告了串口或 I/O 错误',
    protocol_error: '未得到同一事务 ID 的完整 MB_DEBUG 结构化结果；不能将原始日志视为单点诊断通过',
  }
  return messages[status]
}

function byteArray(hex: string): Uint8Array {
  const result = new Uint8Array(hex.length / 2)
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return result
}

function expectedDataBytes(point: ModbusPointConfig): number {
  return point.funcCode === 1 || point.funcCode === 2 ? Math.ceil(point.length / 8) : point.length * 2
}

function formatFloat(value: number): string {
  return Number.isFinite(value) ? String(value) : Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity'
}

/** 与 SJZDV3 `MbDecodeValue()` 相同：只解释点位数据区开头的一个工程值。 */
export function decodeModbusDebugData(
  point: ModbusPointConfig,
  rawHex: string
): { value: string; warning?: string } {
  const hex = normalizedHex(rawHex)
  const data = byteArray(hex)
  const expected = expectedDataBytes(point)
  if (data.length !== expected) {
    throw new Error(`数据区长度 ${data.length} B 与本次请求应答长度 ${expected} B 不一致`)
  }
  if (point.dataType === 0) return { value: hex.match(/.{2}/g)?.join(' ') || '' }
  if (point.dataType === 6) {
    if (point.funcCode !== 1 && point.funcCode !== 2) {
      return { value: hex.match(/.{2}/g)?.join(' ') || '', warning: 'BOOL 仅适用于 FC01/FC02，保留原始数据' }
    }
    return {
      value: (data[0] & 0x01) === 1 ? 'true (bit0=1)' : 'false (bit0=0)',
      warning: point.length > 1 ? '固件遥测与本报告均只解释第一个 bit；其余 bit 保留在原始数据中' : undefined,
    }
  }
  if (point.dataType === 1 || point.dataType === 2) {
    if (data.length < 2) throw new Error('16 位数据至少需要 2 B')
    const raw = point.byteOrder === 0 || point.byteOrder === 1 ? (data[0] << 8) | data[1] : (data[1] << 8) | data[0]
    return { value: String(point.dataType === 1 && raw >= 0x8000 ? raw - 0x10000 : raw) }
  }
  if (![3, 4, 5].includes(point.dataType)) {
    return { value: hex.match(/.{2}/g)?.join(' ') || '', warning: '未知数据类型，保留原始数据' }
  }
  if (data.length < 4) throw new Error('32 位数据至少需要 4 B')
  const normalized =
    point.byteOrder === 0
      ? [data[0], data[1], data[2], data[3]]
      : point.byteOrder === 1
        ? [data[2], data[3], data[0], data[1]]
        : point.byteOrder === 2
          ? [data[1], data[0], data[3], data[2]]
          : [data[3], data[2], data[1], data[0]]
  const view = new DataView(Uint8Array.from(normalized).buffer)
  if (point.dataType === 5) return { value: formatFloat(view.getFloat32(0, false)) }
  const unsigned = view.getUint32(0, false)
  return { value: String(point.dataType === 3 ? view.getInt32(0, false) : unsigned) }
}

function parseFields(parts: string[]): Record<string, string> | undefined {
  const fields: Record<string, string> = {}
  for (const part of parts) {
    const separator = part.indexOf('=')
    if (separator <= 0) return undefined
    const key = part.slice(0, separator).trim().toLowerCase()
    const value = part.slice(separator + 1).trim()
    if (!/^[a-z][a-z0-9_]*$/i.test(key) || !value || Object.prototype.hasOwnProperty.call(fields, key)) return undefined
    fields[key] = value
  }
  return fields
}

/** 解析新固件的 `MB_DEBUG:BEGIN/TX/RX/DATA/RESULT/END` 行；日志前缀不影响识别。 */
export function parseModbusDebugProtocolLine(line: string): ModbusDebugProtocolEvent | undefined {
  const marker = line.indexOf('MB_DEBUG:')
  if (marker < 0) return undefined
  const parts = line.slice(marker + 'MB_DEBUG:'.length).trim().split(',')
  const type = parts.shift()?.trim().toLowerCase()
  if (!type || !['begin', 'tx', 'rx', 'data', 'result', 'end'].includes(type)) return undefined
  const fields = parseFields(parts)
  if (!fields || numberField(fields, 'id') === undefined) return undefined
  if (['tx', 'rx', 'data'].includes(type)) {
    try {
      normalizedHex(fields.hex || '')
    } catch {
      return undefined
    }
  }
  return { type: type as ModbusDebugProtocolEvent['type'], fields }
}

function eventId(event: ModbusDebugProtocolEvent | undefined): number | undefined {
  return event ? numberField(event.fields, 'id') : undefined
}

function firstForId(events: ModbusDebugProtocolEvent[], type: ModbusDebugProtocolEvent['type'], id: number) {
  return events.find((event) => event.type === type && eventId(event) === id)
}

function decodeRxFields(hex: string | undefined): Pick<ModbusDebugReport['response'], 'addr' | 'func' | 'byteCount' | 'crc' | 'rxHex'> {
  if (!hex) return {}
  try {
    const normalized = normalizedHex(hex)
    const bytes = byteArray(normalized)
    return {
      rxHex: normalized,
      addr: bytes[0],
      func: bytes[1],
      byteCount: bytes.length >= 3 ? bytes[2] : undefined,
      crc: bytes.length >= 2 ? normalized.slice(-4) : undefined,
    }
  } catch {
    return {}
  }
}

function protocolErrorReport(
  point: ModbusPointConfig,
  port: string,
  startedAt: string,
  completedAt: string,
  rawLines: string[],
  message?: string
): ModbusDebugReport {
  return {
    schema: 'np-tools.sjzd-modbus-debug-report.v1',
    point: { ...point },
    port,
    startedAt,
    completedAt,
    status: 'protocol_error',
    message: message || outcomeMessage('protocol_error'),
    request: {},
    response: {},
    rawLines: [...rawLines],
  }
}

/**
 * 仅当 `RESULT` 与 `END` 属于同一 id 时返回固件终态。正常成功还必须包含
 * BEGIN、TX、RX 和 DATA，防止截断日志被误标记成成功。
 */
export function buildModbusDebugReport(
  point: ModbusPointConfig,
  port: string,
  startedAt: string,
  completedAt: string,
  events: ModbusDebugProtocolEvent[],
  rawLines: string[]
): ModbusDebugReport {
  const begin = events.find((event) => event.type === 'begin')
  const resultCandidate = events.find((event) => event.type === 'result')
  const id = eventId(begin) ?? eventId(resultCandidate)
  if (id === undefined) return protocolErrorReport(point, port, startedAt, completedAt, rawLines)

  const result = firstForId(events, 'result', id)
  const end = firstForId(events, 'end', id)
  if (!result || !end) return protocolErrorReport(point, port, startedAt, completedAt, rawLines)
  const status = outcome(result.fields.status, result.fields.code)
  const scopedBegin = firstForId(events, 'begin', id)
  const tx = firstForId(events, 'tx', id)
  const rx = firstForId(events, 'rx', id)
  const data = firstForId(events, 'data', id)

  if (status === 'ok' && (!scopedBegin || !tx || !rx || !data)) {
    return protocolErrorReport(point, port, startedAt, completedAt, rawLines, '成功终态缺少 BEGIN/TX/RX/DATA 证据，拒绝标记为通过')
  }
  if (scopedBegin) {
    const beginPoint = {
      slaveAddr: numberField(scopedBegin.fields, 'addr'),
      funcCode: numberField(scopedBegin.fields, 'func'),
      regAddr: numberField(scopedBegin.fields, 'reg'),
      length: numberField(scopedBegin.fields, 'len'),
    }
    if (
      beginPoint.slaveAddr !== point.slaveAddr ||
      beginPoint.funcCode !== point.funcCode ||
      beginPoint.regAddr !== point.regAddr ||
      beginPoint.length !== point.length
    ) {
      return protocolErrorReport(point, port, startedAt, completedAt, rawLines, 'MB_DEBUG:BEGIN 与本次点位参数不一致，拒绝采纳')
    }
  }

  const plcAddress = numberField(scopedBegin?.fields || {}, 'reg')
  const report: ModbusDebugReport = {
    schema: 'np-tools.sjzd-modbus-debug-report.v1',
    point: { ...point },
    port,
    startedAt,
    completedAt,
    status,
    message: outcomeMessage(status),
    request: {
      transactionId: id,
      pointRevision: numberField(scopedBegin?.fields || {}, 'point_revision'),
      plcAddress,
      protoAddress: plcAddress === undefined ? undefined : plcAddress - 1,
      timeoutMs: numberField(scopedBegin?.fields || {}, 'timeout_ms'),
      txHex: tx?.fields.hex,
    },
    response: {
      ...decodeRxFields(rx?.fields.hex),
      dataHex: data?.fields.hex,
      exceptionCode: /^0x[0-9a-f]{1,2}$/i.test(result.fields.code || '')
        ? Number.parseInt(result.fields.code, 16)
        : undefined,
      expectedByteCount: status === 'ok' ? expectedDataBytes(point) : undefined,
      code: result.fields.code,
    },
    rawLines: [...rawLines],
  }
  if (status === 'ok' && report.response.dataHex) {
    try {
      const decoded = decodeModbusDebugData(point, report.response.dataHex)
      report.decodedValue = decoded.value
      report.decodeWarning = decoded.warning
    } catch (error) {
      report.decodeWarning = `数据解码失败：${String(error)}`
    }
  }
  return report
}
