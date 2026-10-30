import { dump, load } from 'js-yaml'
import type { ProjectIoDocument } from '../types/controllerIo'
import { controllerSourceOrder, sortControllerPoints } from './controllerPointOrder'

/** 拒绝会被JSON克隆改写的YAML值，以及循环别名；不把异常输入转换成可发布默认值。 */
function assertSerializable(value: unknown, path = 'project_io', ancestors = new Set<object>()) {
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))))
    throw new Error(`${path} 不是可安全保留的有限数值`)
  if (value === null || typeof value !== 'object') return
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new Error(`${path} 包含不支持的YAML对象类型，请显式使用字符串或普通配置对象`)
  if (ancestors.has(value)) throw new Error(`${path} 包含循环YAML引用`)
  ancestors.add(value)
  for (const [key, child] of Object.entries(value)) assertSerializable(child, `${path}.${key}`, ancestors)
  ancestors.delete(value)
}

function assertTypedFields(object: any, fields: string[], type: 'number' | 'boolean', path: string) {
  for (const field of fields) {
    if (object?.[field] !== undefined && typeof object[field] !== type)
      throw new Error(`${path}.${field} 必须是${type}，不能隐式转换`)
  }
}

/**
 * 序列化 ProjectIoDocument 为标准格式的 YAML 字符串
 */
export function serializeProjectIoYaml(doc: ProjectIoDocument): string {
  // 保留未由页面编辑的固件字段；只剥离工具自己注入的实体 UUID。
  // 不从 UI 字段白名单重建配置，否则启动门禁/外部输入等新字段会静默丢失。
  assertSerializable(doc)
  const cleanDoc = JSON.parse(JSON.stringify(doc))
  const project = cleanDoc.project
  project.required_profiles = Array.from(new Set(doc.project.devices.map((d) => d.profile))).sort()
  project.features = { ...project.features, pid: project.pids.length > 0,
    counter: (project.logic_blocks?.counters?.length || 0) > 0 }
  project.points.inputs = sortControllerPoints(project.points.inputs, controllerSourceOrder(doc, 'input'))
  project.points.outputs = sortControllerPoints(project.points.outputs, controllerSourceOrder(doc, 'output'))
  for (const entries of [project.devices, project.points.inputs, project.points.outputs,
    project.application_variables.parameters, project.application_variables.commands,
    project.application_variables.states, project.pids, project.runtime_counters,
    project.northbound.fields]) {
    for (const entry of entries || []) delete entry.id
  }
  return dump(cleanDoc, { indent: 2, lineWidth: 140, noRefs: true, forceQuotes: false })
}

/**
 * 从 YAML 文本反解析为 ProjectIoDocument 实体
 */
export function deserializeProjectIoYaml(yamlText: string): ProjectIoDocument {
  const raw: any = load(yamlText)
  if (!raw || typeof raw !== 'object') {
    throw new Error('无效的 YAML 结构，根节点必须为对象')
  }

  if (raw.schema !== 'kz3-project-io/v3' || !raw.project || Array.isArray(raw.project) || typeof raw.project !== 'object') {
    throw new Error('仅支持当前固件 kz3-project-io/v3 工程对象；请审查后显式迁移旧schema')
  }
  assertSerializable(raw)
  const p = raw.project
  assertTypedFields(p, ['scan_period_ms'], 'number', 'project')
  assertTypedFields(p.features, ['pid', 'counter', 'retained'], 'boolean', 'project.features')
  assertTypedFields(p.startup, ['ao_deferred_activation'], 'boolean', 'project.startup')
  for (const d of p.devices || []) assertTypedFields(d,
    ['slave_address', 'poll_period_ms', 'stale_after_ms'], 'number', `device.${d.name}`)
  for (const parameter of p.application_variables?.parameters || [])
    assertTypedFields(parameter, ['persistent'], 'boolean', `parameter.${parameter.name}`)
  for (const runtime of p.runtime_counters || [])
    assertTypedFields(runtime.trigger, ['active_value'], 'boolean', `runtime.${runtime.name}.trigger`)
  for (const pid of p.pids || []) {
    assertTypedFields(pid, ['enabled'], 'boolean', `pid.${pid.name}`)
    assertTypedFields(pid, ['sample_period_ms', 'kp', 'ki', 'kd', 'output_min', 'output_max'], 'number', `pid.${pid.name}`)
  }

  // 映射 devices
  const devices = (p.devices || []).map((d: any, idx: number) => ({
    ...d,
    id: `dev_${Date.now()}_${idx}`,
    name: d.name || `dev_${idx + 1}`,
    profile: d.profile || 'sp4055_702',
    port: d.port || 'rs485_1',
    slave_address: Number(d.slave_address ?? 1),
    poll_period_ms: Number(d.poll_period_ms ?? 500),
    stale_after_ms: Number(d.stale_after_ms ?? 1500),
    use: {
      ...d.use,
      inputs: Array.isArray(d.use?.inputs) ? d.use.inputs : [],
      outputs: d.use?.outputs && typeof d.use.outputs === 'object' ? d.use.outputs : {},
    },
  }))

  // 映射 points
  const inputs = (p.points?.inputs || []).map((pt: any, idx: number) => ({
    ...pt,
    id: `pt_in_${Date.now()}_${idx}`,
    name: pt.name || `di_${idx + 1}`,
    source: pt.source || '',
    description: pt.description || '',
  }))

  const outputs = (p.points?.outputs || []).map((pt: any, idx: number) => ({
    ...pt,
    id: `pt_out_${Date.now()}_${idx}`,
    name: pt.name || `do_${idx + 1}`,
    source: pt.source || '',
    description: pt.description || '',
  }))

  // 映射 application_variables
  const parameters = (p.application_variables?.parameters || []).map((param: any, idx: number) => ({
    ...param,
    id: `param_${Date.now()}_${idx}`,
    name: param.name || `param_${idx + 1}`,
    c_type: param.c_type || 'bool',
    default: param.default !== undefined ? param.default : false,
    persistent: Boolean(param.persistent),
    min: param.min,
    max: param.max,
    unit: param.unit,
    apply: param.apply || 'next_scan',
    description: param.description,
  }))

  const commands = (p.application_variables?.commands || []).map((cmd: any, idx: number) => ({
    ...cmd,
    id: `cmd_${Date.now()}_${idx}`,
    name: cmd.name || `cmd_${idx + 1}`,
    c_type: cmd.c_type || 'bool',
    effect: cmd.effect,
    description: cmd.description,
  }))

  const states = (p.application_variables?.states || []).map((st: any, idx: number) => ({
    ...st,
    id: `state_${Date.now()}_${idx}`,
    name: st.name || `state_${idx + 1}`,
    c_type: st.c_type || 'bool',
    ...(st.initial !== undefined && st.default === undefined ? {} : { default: st.default ?? false }),
    description: st.description,
  }))

  // 映射 runtime_counters
  const runtime_counters = (p.runtime_counters || []).map((rc: any, idx: number) => ({
    ...rc,
    id: `rc_${Date.now()}_${idx}`,
    name: rc.name || `counter_${idx + 1}`,
    description: rc.description || '',
    trigger: {
      ...rc.trigger,
      bind: rc.trigger?.bind || '',
      active_value: rc.trigger?.active_value !== undefined ? Boolean(rc.trigger.active_value) : true,
      ...(rc.trigger?.quality !== undefined ? { quality: rc.trigger.quality } : {}),
    },
  }))

  // 映射 pids
  const pids = (p.pids || []).map((pid: any, idx: number) => ({
    ...pid,
    id: `pid_${Date.now()}_${idx}`,
    name: pid.name || `pid_${idx + 1}`,
    enabled: Boolean(pid.enabled),
    measurement: pid.measurement || '',
    setpoint: pid.setpoint || '',
    output: pid.output || '',
    sample_period_ms: Number(pid.sample_period_ms ?? 50),
    direction: pid.direction ?? 'direct',
    kp: Number(pid.kp ?? 1.0),
    ki: Number(pid.ki ?? 0.1),
    kd: Number(pid.kd ?? 0.0),
    output_min: Number(pid.output_min ?? 0),
    output_max: Number(pid.output_max ?? 100),
  }))

  // 映射 northbound
  const fields = (p.northbound?.fields || []).map((f: any, idx: number) => ({
    ...f,
    id: `nb_${Date.now()}_${idx}`,
    name: f.name || `field_${idx + 1}`,
    bind: f.bind || '',
    c_type: f.c_type || 'bool',
    access: f.access ?? 'read',
    reference: String(f.reference || '00001').padStart(5, '0'),
    description: f.description || '',
  }))

  return {
    ...raw,
    schema: raw.schema || 'kz3-project-io/v3',
    project: {
      ...p,
      name: p.name || '未命名工程',
      id: p.id || 'unnamed_project',
      version: p.version || '1.0.0',
      board: p.board || 'kz3_f427_standard',
      required_profiles: Array.isArray(p.required_profiles) ? p.required_profiles : [],
      scan_period_ms: Number(p.scan_period_ms ?? 10),
      startup:
        p.startup && typeof p.startup === 'object'
          ? { ...p.startup, ao_deferred_activation: Boolean(p.startup.ao_deferred_activation) }
          : undefined,
      features: {
        ...p.features,
        pid: Boolean(p.features?.pid),
        counter: Boolean(p.features?.counter),
        retained: p.features?.retained ?? false,
      },
      rs485_ports: p.rs485_ports || {
        rs485_1: {
          baud: 9600,
          parity: 'none',
          stop_bits: 1,
          response_timeout_ms: 100,
          retry_count: 1,
          offline_backoff_ms: 5000,
        },
      },
      devices,
      points: {
        ...p.points,
        inputs,
        outputs,
      },
      application_variables: {
        ...p.application_variables,
        parameters,
        commands,
        states,
      },
      pids,
      logic_blocks: {
        ...p.logic_blocks,
        timers: p.logic_blocks?.timers || [],
        edges: p.logic_blocks?.edges || [],
        counters: p.logic_blocks?.counters || [],
        latches: p.logic_blocks?.latches || [],
        debounces: p.logic_blocks?.debounces || [],
        filters: p.logic_blocks?.filters || [],
        rate_limits: p.logic_blocks?.rate_limits || [],
      },
      runtime_counters,
      northbound: {
        ...p.northbound,
        protocols: p.northbound?.protocols || ['sle', 'http', 'modbus_tcp'],
        modbus_tcp: {
          ...p.northbound?.modbus_tcp,
          address_style: p.northbound?.modbus_tcp?.address_style || 'modicon_5_digit',
          word_order_32: p.northbound?.modbus_tcp?.word_order_32 || 'abcd',
        },
        fields,
      },
    },
  }
}
