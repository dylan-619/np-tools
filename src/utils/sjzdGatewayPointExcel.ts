import type { ModbusPointConfig } from '../types/sjzd'
import type { GatewayAcquisitionPointRow } from './gatewayPointExcel'

const DATA_TYPE_MAP: Record<number, string> = {
  1: 'INT16',
  2: 'UINT16',
  3: 'INT32',
  4: 'UINT32',
  5: 'FLOAT',
  6: 'BOOLEAN'
}

const BYTE_ORDER_MAP: Record<number, string> = {
  0: 'ABCD',
  1: 'CDAB',
  2: 'BADC',
  3: 'DCBA'
}

function normalizeOptionalText(
  value: string | undefined,
  label: string,
  maxLength: number
): string {
  const normalized = value?.trim() || ''
  if (normalized.includes('\0')) throw new Error(`${label}不能包含 NUL 字符`)
  if (normalized.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`)
  return normalized
}

function validatePoint(point: ModbusPointConfig, index: number): void {
  const label = `第 ${index + 1} 个点位`
  if (!Number.isInteger(point.slaveAddr) || point.slaveAddr < 1 || point.slaveAddr > 247) {
    throw new Error(`${label}的从站地址必须是 1～247 的整数`)
  }
  if (!Number.isInteger(point.funcCode) || point.funcCode < 1 || point.funcCode > 4) {
    throw new Error(`${label}的功能码必须是 1～4 的整数`)
  }
  if (!Number.isInteger(point.regAddr) || point.regAddr < 1 || point.regAddr > 65_535) {
    throw new Error(`${label}的 PLC 地址必须是 1～65535 的整数`)
  }
  if (!Number.isInteger(point.length) || point.length < 1 || point.length > 31) {
    throw new Error(`${label}的读取长度必须是 1～31 的整数`)
  }
  if (point.regAddr + point.length - 1 > 65_536) {
    throw new Error(`${label}的读取范围超过 Modbus 最大协议地址`)
  }
  if (point.dataType === 0) {
    throw new Error(
      `${label}使用 RAW_HEX；网关采集点没有等价的规范数据类型，请先改为明确的数据类型`
    )
  }
  const dataType = DATA_TYPE_MAP[point.dataType]
  if (!dataType) throw new Error(`${label}的数据类型 ${point.dataType} 不受网关支持`)
  const isBoolean = point.dataType === 6
  if (isBoolean !== [1, 2].includes(point.funcCode)) {
    throw new Error(`${label}的数据类型 ${dataType} 与功能码 ${point.funcCode} 不匹配`)
  }
  if ([3, 4, 5].includes(point.dataType) && point.length < 2) {
    throw new Error(`${label}的 32 位数据读取长度不能小于 2`)
  }
  if (!BYTE_ORDER_MAP[point.byteOrder]) {
    throw new Error(`${label}的字节序 ${point.byteOrder} 不受支持`)
  }
}

export function buildSjzdGatewayAcquisitionPointRows(
  points: ModbusPointConfig[],
  deviceSn?: string
): GatewayAcquisitionPointRow[] {
  if (points.length === 0) throw new Error('当前 Modbus 点位表为空，无法导出网关采集点')

  const normalizedSn = normalizeOptionalText(deviceSn, '设备 SN', 64)
  const groupName = normalizedSn ? `SJZDV3-${normalizedSn}` : 'SJZDV3 数据采集终端'
  const upstreamKeys = new Set<string>()
  const pointNames = new Set<string>()

  return points.map((point, index) => {
    validatePoint(point, index)
    const address = String(point.regAddr)
    const upstreamKey = `${point.slaveAddr}_${address}`
    if (upstreamKeys.has(upstreamKey)) {
      throw new Error(`第 ${index + 1} 个点位生成了重复的终端上报键 ${upstreamKey}`)
    }
    upstreamKeys.add(upstreamKey)

    const generatedName = `MB_${point.slaveAddr}_${address}`
    const pointName =
      normalizeOptionalText(point.name, `点位 ${upstreamKey} 的名称`, 100) || generatedName
    if (pointNames.has(pointName)) throw new Error(`网关点位名称重复：${pointName}`)
    pointNames.add(pointName)
    const unit = normalizeOptionalText(point.unit, `点位 ${pointName} 的单位`, 20)
    const dataType = DATA_TYPE_MAP[point.dataType]
    const byteOrder = BYTE_ORDER_MAP[point.byteOrder]

    return {
      id: '',
      groupName,
      pointName,
      pointTag: pointName,
      // 网关会组合 slaveId_address 匹配终端 JSON，不能改成 Modicon 分区地址。
      address,
      dataType,
      unit,
      collectInterval: 0,
      slaveId: point.slaveAddr,
      functionCode: point.funcCode,
      enabled: '启用',
      remark: `终端上报键：${upstreamKey}；读取长度：${point.length}；终端解码字节序：${byteOrder}`,
      description: `SJZDV3 下挂 Modbus 点位，PLC 1-based 地址 ${address}`,
      readWriteAccess: 'R'
    }
  })
}

export function buildSjzdGatewayPointExcelFileName(deviceSn?: string, now = new Date()): string {
  const safeIdentity = (deviceSn?.trim() || 'SJZDV3').replace(/[\\/:*?"<>|]/g, '_').slice(0, 64)
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')
  return `${safeIdentity}_网关采集点_终端Modbus_${stamp}.xlsx`
}
