import type { NorthboundField } from '../types/controllerIo'

export const KZ3_IEC_PROJECT_IO_SCHEMA = 'kz3-iec-project-io/v1'

function object(value: any, path: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} 必须是对象`)
  return value
}

function text(value: any, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} 必须是非空字符串`)
  return value
}

/**
 * 只建立 IEC YAML 的调试视图，沿用 SDK iec/model.py::derive 的活动布局顺序。
 * plc.xml 才拥有 IEC 类型/初值和扫描周期；这里仅使用发布字段声明的类型，不能作为构建配置导出。
 */
export function projectIecDebugView(raw: any): Record<string, any> {
  const project = object(raw.project, 'project')
  for (const key of ['id', 'name', 'version', 'board']) text(project[key], `project.${key}`)
  if (!Array.isArray(raw.bindings)) throw new Error('bindings 必须是列表')
  const north = object(raw.northbound, 'northbound')
  for (const key of ['layout', 'reserved', 'protocols']) {
    if (!Array.isArray(north[key])) throw new Error(`northbound.${key} 必须是列表`)
  }

  const bindings = new Map<string, any>()
  const runtimeBinds = new Set<string>()
  for (const entry of raw.bindings) {
    const binding = object(entry, 'bindings[]')
    const id = text(binding.binding_id, 'binding.binding_id')
    const key = text(binding.runtime_key, 'binding.runtime_key')
    const role = text(binding.role, 'binding.role')
    if (!['input', 'output', 'external_input', 'parameter', 'command', 'state', 'runtime', 'scan_clock'].includes(role))
      throw new Error(`不支持的 IEC 绑定角色 ${role}`)
    const bind = `${role === 'input' || role === 'output' ? 'point' : role === 'external_input' ? 'external' : role}.${key}`
    if (bindings.has(id) || runtimeBinds.has(bind)) throw new Error(`IEC 绑定身份或运行键重复: ${id}`)
    object(binding.options, `binding.${key}.options`)
    if (role === 'input' || role === 'output') text(binding.channel, `binding.${key}.channel`)
    bindings.set(id, { ...binding, bind })
    runtimeBinds.add(bind)
  }

  const fields: NorthboundField[] = []
  const fieldByBinding = new Map<string, any>()
  const publishIds = new Set<string>()
  for (const [index, entry] of north.layout.entries()) {
    const slot = object(entry, `northbound.layout[${index}]`)
    const id = text(slot.publish_id, 'layout.publish_id')
    if (publishIds.has(id)) throw new Error(`北向发布身份重复: ${id}`)
    publishIds.add(id)
    if (slot.status !== 'active' && slot.status !== 'retired') throw new Error(`未知的北向发布状态 ${slot.status}`)
    // 历史槽位只保存在原文件中，不向已删除的字段发 HTTP 查询。
    if (slot.status !== 'active') continue
    const field = object(slot.field, 'layout.field')
    for (const key of ['name', 'bind', 'c_type']) text(field[key], `layout.field.${key}`)
    if (field.access !== 'read' && field.access !== 'read_write') throw new Error(`北向字段 ${field.name} 的访问权限无效`)
    // js-yaml 将未加引号的 00008 读成数字；恢复五位调试地址，原文件仍按原字节保存。
    const reference = typeof field.reference === 'number' && Number.isInteger(field.reference)
      ? String(field.reference).padStart(5, '0') : field.reference
    if (typeof reference !== 'string' || !/^[0134]\d{4}$/.test(reference))
      throw new Error(`北向字段 ${field.name} 必须声明五位 Modbus 地址`)
    const identity = slot.binding_id === undefined ? id : slot.binding_id
    if (identity !== null) {
      const binding = bindings.get(identity)
      if (!binding || binding.bind !== field.bind || fieldByBinding.has(identity))
        throw new Error(`活动北向字段 ${field.name} 缺少唯一匹配的 IEC 绑定`)
      const access = ['external_input', 'parameter', 'command'].includes(binding.role) ? 'read_write' : 'read'
      if (field.access !== access) throw new Error(`北向字段 ${field.name} 的权限与 IEC 角色不匹配`)
      fieldByBinding.set(identity, field)
    }
    fields.push({ ...field, reference, id: `iec_north_${index}` } as NorthboundField)
  }

  const points: Record<string, any[]> = { inputs: [], outputs: [] }
  const application: Record<string, any[]> = { parameters: [], commands: [], states: [], external_inputs: [] }
  const groups: Record<string, string> = { parameter: 'parameters', command: 'commands', state: 'states', external_input: 'external_inputs' }
  for (const [id, binding] of bindings) {
    const { role, runtime_key: name, options } = binding
    const field = fieldByBinding.get(id)
    if (role === 'input' || role === 'output') {
      points[`${role}s`].push({ name, source: binding.channel, description: options.description || field?.description || '' })
    } else if (groups[role] && field) {
      // 未发布的应用变量没有可核实类型；保留在原 YAML 中，不虚构 BOOL/default。
      application[groups[role]]!.push({ ...options, name, c_type: field.c_type,
        description: options.description || field.description || '' })
    }
  }
  return { ...project, points, application_variables: application,
    northbound: { ...north, fields } }
}
