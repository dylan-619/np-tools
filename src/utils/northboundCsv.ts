import type { NorthboundField, ProjectIoDocument } from '../types/controllerIo'

interface ModbusAddressInfo {
  zone: string
  baseOneAddress: number | ''
  protocolOffset: number | ''
  functionCodes: string
}

function guardSpreadsheetFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

function csvCell(value: string | number, allowFormula = false): string {
  const source = String(value)
  const safe = allowFormula ? source : guardSpreadsheetFormula(source)
  return `"${safe.replace(/"/g, '""')}"`
}

function getAddressInfo(field: NorthboundField): ModbusAddressInfo {
  const reference = Number.parseInt(field.reference, 10)

  if (reference >= 1 && reference <= 9999) {
    return {
      zone: 'Coil 线圈 (0x)',
      baseOneAddress: reference,
      protocolOffset: reference - 1,
      functionCodes: field.access === 'read_write' ? 'FC01 / FC05 / FC15' : 'FC01',
    }
  }
  if (reference >= 10001 && reference <= 19999) {
    return {
      zone: 'Discrete Input 离散输入 (1x)',
      baseOneAddress: reference - 10000,
      protocolOffset: reference - 10001,
      functionCodes: 'FC02',
    }
  }
  if (reference >= 30001 && reference <= 39999) {
    return {
      zone: 'Input Register 输入寄存器 (3x)',
      baseOneAddress: reference - 30000,
      protocolOffset: reference - 30001,
      functionCodes: 'FC04',
    }
  }
  if (reference >= 40001 && reference <= 49999) {
    return {
      zone: 'Holding Register 保持寄存器 (4x)',
      baseOneAddress: reference - 40000,
      protocolOffset: reference - 40001,
      functionCodes: field.access === 'read_write' ? 'FC03 / FC06 / FC16' : 'FC03',
    }
  }

  return {
    zone: '自定义 / 地址待检查',
    baseOneAddress: '',
    protocolOffset: '',
    functionCodes: '',
  }
}

function getFieldWidth(field: NorthboundField): string {
  if (field.c_type === 'bool') return '1 bit'
  return field.c_type === 'u32' || field.c_type === 'i32' || field.c_type === 'float'
    ? '2 registers'
    : '1 register'
}

function resolveDescription(project: ProjectIoDocument['project'], field: NorthboundField): string {
  if (field.description?.trim()) return field.description.trim()

  const [scope, name] = field.bind.split('.', 2)
  if (!name) return ''

  if (scope === 'point') {
    return [...project.points.inputs, ...project.points.outputs]
      .find((point) => point.name === name)?.description || ''
  }
  if (scope === 'parameter') {
    return project.application_variables.parameters.find((item) => item.name === name)?.description || ''
  }
  if (scope === 'command') {
    return project.application_variables.commands.find((item) => item.name === name)?.description || ''
  }
  if (scope === 'state') {
    return project.application_variables.states.find((item) => item.name === name)?.description || ''
  }
  return ''
}

function formatExportTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function buildNorthboundCsv(
  project: ProjectIoDocument['project'],
  exportedAt = new Date()
): string {
  const wordOrder = (project.northbound.modbus_tcp.word_order_32 || 'abcd').toUpperCase()
  const rows: Array<Array<string | number>> = [
    ['文档', 'KZ3 北向 Modbus TCP 点位表'],
    ['项目名称', project.name],
    ['项目 ID', project.id],
    ['项目版本', project.version],
    ['地址基准', 'Base 1（5 位参考地址和数据区地址均从 1 开始）'],
    ['协议偏移', 'Base 0（Modbus PDU Address = 数据区地址 Base 1 - 1）'],
    ['32 位字序', wordOrder],
    ['导出时间', formatExportTime(exportedAt)],
    [],
    [
      '序号',
      '数据区',
      '功能码',
      '5位参考地址(Base 1)',
      '数据区地址(Base 1)',
      '协议偏移(Base 0)',
      '对外字段名',
      '点位说明',
      '内部绑定',
      '数据类型',
      '占用宽度',
      '访问权限',
      '32位字序',
    ],
  ]

  project.northbound.fields.forEach((field, index) => {
    const address = getAddressInfo(field)
    const is32Bit = field.c_type === 'u32' || field.c_type === 'i32' || field.c_type === 'float'
    const normalizedReference = String(field.reference).padStart(5, '0')

    rows.push([
      index + 1,
      address.zone,
      address.functionCodes,
      `=${csvCell(normalizedReference)}`,
      address.baseOneAddress,
      address.protocolOffset,
      field.name,
      resolveDescription(project, field),
      field.bind,
      field.c_type,
      getFieldWidth(field),
      field.access === 'read_write' ? '读写' : '只读',
      is32Bit ? wordOrder : '—',
    ])
  })

  return '\uFEFF' + rows
    .map((row) => row.map((value, index) => csvCell(value, index === 3 && String(value).startsWith('='))).join(','))
    .join('\r\n')
}

export function buildNorthboundCsvFileName(project: ProjectIoDocument['project'], now = new Date()): string {
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
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
  return `${safeProjectName}_北向Modbus点位表_Base1_${stamp}.csv`
}
