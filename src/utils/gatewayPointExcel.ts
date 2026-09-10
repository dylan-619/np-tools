import type { NorthboundField, ProjectIoDocument } from '../types/controllerIo'
import { resolveDeviceProfile } from './controllerIoCatalog'

export const GATEWAY_POINT_EXCEL_HEADERS = [
  'ID',
  '数据分组',
  '点位名称',
  '点位标签',
  '地址',
  '数据类型',
  '单位',
  '采集间隔(ms)',
  '从站地址',
  '功能码',
  '启用状态',
  '备注',
  '节点说明',
  '读写权限'
] as const

export interface GatewayAcquisitionPointRow {
  id: string
  groupName: string
  pointName: string
  pointTag: string
  address: string
  dataType: string
  unit: string
  collectInterval: number
  slaveId: number
  functionCode: number
  enabled: string
  remark: string
  description: string
  readWriteAccess: string
}

export interface GatewayPointExportOptions {
  collectIntervalMs?: number
  slaveId?: number
}

interface AddressInfo {
  address: string
  offset: number
  functionCode: 1 | 2 | 3 | 4
}

const GATEWAY_DATA_TYPES: Record<NorthboundField['c_type'], string> = {
  bool: 'BOOLEAN',
  i16: 'INT16',
  u16: 'UINT16',
  i32: 'INT32',
  u32: 'UINT32',
  float: 'FLOAT'
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label}不能为空`)
  if (normalized.includes('\0')) throw new Error(`${label}不能包含 NUL 字符`)
  if (normalized.length > maxLength) {
    throw new Error(`${label}不能超过 ${maxLength} 个字符`)
  }
  return normalized
}

function optionalText(value: string | undefined, label: string, maxLength: number): string {
  const normalized = value?.trim() || ''
  if (normalized.includes('\0')) throw new Error(`${label}不能包含 NUL 字符`)
  if (normalized.length > maxLength) {
    throw new Error(`${label}不能超过 ${maxLength} 个字符`)
  }
  return normalized
}

function parseReference(field: NorthboundField): AddressInfo {
  const raw = field.reference.trim()
  if (!/^\d{1,5}$/.test(raw)) {
    throw new Error(`点位 ${field.name || field.id} 的地址必须是 KZ3 五位十进制 Modicon 地址`)
  }
  const reference = Number.parseInt(raw, 10)
  if (reference >= 1 && reference <= 9999) {
    return { address: String(reference).padStart(5, '0'), offset: reference - 1, functionCode: 1 }
  }
  if (reference >= 10001 && reference <= 19999) {
    return { address: String(reference), offset: reference - 10001, functionCode: 2 }
  }
  if (reference >= 30001 && reference <= 39999) {
    return { address: String(reference), offset: reference - 30001, functionCode: 4 }
  }
  if (reference >= 40001 && reference <= 49999) {
    return { address: String(reference), offset: reference - 40001, functionCode: 3 }
  }
  throw new Error(
    `点位 ${field.name || field.id} 的地址 ${raw} 不属于 KZ3 北向 Modbus 四个标准地址区`
  )
}

function registerWidth(field: NorthboundField): number {
  return ['i32', 'u32', 'float'].includes(field.c_type) ? 2 : 1
}

function resolveDescription(project: ProjectIoDocument['project'], field: NorthboundField): string {
  if (field.description?.trim()) return field.description.trim()

  const [scope, name] = field.bind.split('.', 2)
  if (!name) return ''
  if (scope === 'point') {
    return (
      [...project.points.inputs, ...project.points.outputs].find((point) => point.name === name)
        ?.description || ''
    )
  }
  if (scope === 'parameter') {
    return (
      project.application_variables.parameters.find((item) => item.name === name)?.description || ''
    )
  }
  if (scope === 'command') {
    return (
      project.application_variables.commands.find((item) => item.name === name)?.description || ''
    )
  }
  if (scope === 'state') {
    return (
      project.application_variables.states.find((item) => item.name === name)?.description || ''
    )
  }
  return ''
}

function resolveUnit(project: ProjectIoDocument['project'], field: NorthboundField): string {
  const [scope, name] = field.bind.split('.', 2)
  if (!name) return ''
  if (scope === 'parameter') {
    return project.application_variables.parameters.find((item) => item.name === name)?.unit || ''
  }
  if (scope !== 'point') return ''

  const point = [...project.points.inputs, ...project.points.outputs].find(
    (item) => item.name === name
  )
  const match = point?.source.match(/^rtu\.([^.]+)\.([^.]+)$/)
  if (!match) return ''
  const device = project.devices.find((item) => item.name === match[1])
  if (!device) return ''
  const profile = resolveDeviceProfile({ schema: 'kz3-project-io/v3', project }, device)
  return (
    [...profile.inputs, ...profile.outputs].find((signal) => signal.code === match[2])?.unit || ''
  )
}

export function buildGatewayAcquisitionPointRows(
  project: ProjectIoDocument['project'],
  options: GatewayPointExportOptions = {}
): GatewayAcquisitionPointRow[] {
  const groupName = requiredText(project.name || project.id, '数据分组', 100)
  const slaveId = options.slaveId ?? 1
  const collectInterval = options.collectIntervalMs ?? 1000
  if (!Number.isInteger(slaveId) || slaveId < 1 || slaveId > 247) {
    throw new Error('网关从站地址必须是 1～247 的整数')
  }
  if (!Number.isInteger(collectInterval) || collectInterval < 0 || collectInterval > 86_400_000) {
    throw new Error('网关采集间隔必须是 0～86400000 ms 的整数')
  }

  const names = new Set<string>()
  const occupied = new Map<string, string>()

  return project.northbound.fields.map((field) => {
    const pointName = requiredText(field.name, `北向字段 ${field.id} 的点位名称`, 100)
    if (names.has(pointName)) throw new Error(`网关点位名称重复：${pointName}`)
    names.add(pointName)

    const address = parseReference(field)
    const isBoolean = field.c_type === 'bool'
    if (isBoolean !== (address.functionCode === 1 || address.functionCode === 2)) {
      throw new Error(
        `点位 ${pointName} 的数据类型 ${field.c_type.toUpperCase()} 与地址 ${address.address} 不匹配`
      )
    }
    if (
      field.access === 'read_write' &&
      (address.functionCode === 2 || address.functionCode === 4)
    ) {
      throw new Error(`点位 ${pointName} 位于只读地址区 ${address.address}，不能导出为 R/W`)
    }

    const width = registerWidth(field)
    if (address.offset + width - 1 > 9998) {
      throw new Error(`点位 ${pointName} 的 ${width} 寄存器数据超出五位地址区边界`)
    }
    for (let offset = address.offset; offset < address.offset + width; offset += 1) {
      const key = `${address.functionCode}:${offset}`
      const previous = occupied.get(key)
      if (previous) {
        throw new Error(`点位 ${pointName} 与 ${previous} 的 Modbus 地址范围重叠`)
      }
      occupied.set(key, pointName)
    }

    const dataType = GATEWAY_DATA_TYPES[field.c_type]
    if (!dataType) {
      throw new Error(`点位 ${pointName} 的数据类型 ${String(field.c_type)} 不受网关支持`)
    }
    const description = optionalText(
      resolveDescription(project, field),
      `点位 ${pointName} 的说明`,
      500
    )
    const unit = optionalText(resolveUnit(project, field), `点位 ${pointName} 的单位`, 20)
    const wordOrder = (project.northbound.modbus_tcp.word_order_32 || 'abcd').toUpperCase()
    const remark = optionalText(
      `KZ3 北向绑定：${field.bind}${width === 2 ? `；32 位字序：${wordOrder}` : ''}`,
      `点位 ${pointName} 的备注`,
      255
    )

    return {
      id: '',
      groupName,
      pointName,
      pointTag: pointName,
      address: address.address,
      dataType,
      unit,
      collectInterval,
      slaveId,
      functionCode: address.functionCode,
      enabled: '启用',
      remark,
      description,
      readWriteAccess: field.access === 'read_write' ? 'R/W' : 'R'
    }
  })
}

export function buildGatewayPointExcelFileName(
  project: ProjectIoDocument['project'],
  now = new Date()
): string {
  const safeProjectName = (project.name || project.id || 'KZ3工程')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')
  return `${safeProjectName}_网关采集点_ModbusTCP_${stamp}.xlsx`
}
