import { dump, load } from 'js-yaml'
import type { ProjectIoDocument } from '../types/controllerIo'

/**
 * 序列化 ProjectIoDocument 为标准格式的 YAML 字符串
 */
export function serializeProjectIoYaml(doc: ProjectIoDocument): string {
  // 自动派生 required_profiles
  const usedProfiles = Array.from(new Set(doc.project.devices.map((d) => d.profile))).sort()

  // 自动派生 features
  const hasPid = doc.project.pids.length > 0
  const hasCounter = (doc.project.logic_blocks?.counters?.length || 0) > 0

  const cleanDoc: any = {
    schema: doc.schema || 'kz3-project-io/v3',
    project: {
      name: doc.project.name || '未命名控制器工程',
      id: doc.project.id || 'unnamed_project',
      version: doc.project.version || '1.0.0',
      board: doc.project.board || 'kz3_f427_standard',
      required_profiles: usedProfiles,
      scan_period_ms: Number(doc.project.scan_period_ms) || 10,
      ...(doc.project.startup
        ? {
            startup: {
              ao_deferred_activation: doc.project.startup.ao_deferred_activation === true,
            },
          }
        : {}),
      features: {
        pid: hasPid,
        counter: hasCounter,
        retained: false,
      },
      rs485_ports: doc.project.rs485_ports || {},
      devices: (doc.project.devices || []).map((dev) => ({
        name: dev.name,
        profile: dev.profile,
        port: dev.port,
        slave_address: Number(dev.slave_address),
        poll_period_ms: Number(dev.poll_period_ms) || 500,
        stale_after_ms: Number(dev.stale_after_ms) || 1500,
        use: {
          ...(dev.use?.inputs && dev.use.inputs.length > 0 ? { inputs: dev.use.inputs } : {}),
          ...(dev.use?.outputs && Object.keys(dev.use.outputs).length > 0
            ? { outputs: dev.use.outputs }
            : {}),
        },
      })),
      points: {
        inputs: (doc.project.points?.inputs || []).map((p) => ({
          name: p.name,
          source: p.source,
          description: p.description || '',
        })),
        outputs: (doc.project.points?.outputs || []).map((p) => ({
          name: p.name,
          source: p.source,
          description: p.description || '',
        })),
      },
      application_variables: {
        parameters: (doc.project.application_variables?.parameters || []).map((p) => ({
          name: p.name,
          c_type: p.c_type,
          default: p.default,
          ...(p.persistent ? { persistent: true } : {}),
          ...(p.min !== undefined ? { min: p.min } : {}),
          ...(p.max !== undefined ? { max: p.max } : {}),
          ...(p.unit ? { unit: p.unit } : {}),
          ...(p.apply ? { apply: p.apply } : {}),
          ...(p.description ? { description: p.description } : {}),
        })),
        commands: (doc.project.application_variables?.commands || []).map((c) => ({
          name: c.name,
          c_type: c.c_type || 'bool',
          ...(c.effect ? { effect: c.effect } : {}),
          ...(c.description ? { description: c.description } : {}),
        })),
        states: (doc.project.application_variables?.states || []).map((s) => ({
          name: s.name,
          c_type: s.c_type,
          default: s.default,
          ...(s.description ? { description: s.description } : {}),
        })),
      },
      pids: (doc.project.pids || []).map((pid) => ({
        name: pid.name,
        enabled: pid.enabled,
        measurement: pid.measurement,
        setpoint: pid.setpoint,
        output: pid.output,
        sample_period_ms: Number(pid.sample_period_ms),
        direction: pid.direction,
        kp: Number(pid.kp),
        ki: Number(pid.ki),
        kd: Number(pid.kd),
        output_min: Number(pid.output_min),
        output_max: Number(pid.output_max),
      })),
      logic_blocks: {
        timers: doc.project.logic_blocks?.timers || [],
        edges: doc.project.logic_blocks?.edges || [],
        counters: doc.project.logic_blocks?.counters || [],
        latches: doc.project.logic_blocks?.latches || [],
        debounces: doc.project.logic_blocks?.debounces || [],
        filters: doc.project.logic_blocks?.filters || [],
        rate_limits: doc.project.logic_blocks?.rate_limits || [],
      },
      runtime_counters: (doc.project.runtime_counters || []).map((rc) => ({
        name: rc.name,
        ...(rc.description ? { description: rc.description } : {}),
        trigger: {
          bind: rc.trigger.bind,
          active_value: rc.trigger.active_value ?? true,
          quality: rc.trigger.quality || 'good',
        },
      })),
      northbound: {
        protocols: doc.project.northbound?.protocols || ['sle', 'http', 'modbus_tcp'],
        modbus_tcp: {
          address_style: doc.project.northbound?.modbus_tcp?.address_style || 'modicon_5_digit',
          word_order_32: doc.project.northbound?.modbus_tcp?.word_order_32 || 'abcd',
        },
        fields: (doc.project.northbound?.fields || []).map((f) => ({
          name: f.name,
          bind: f.bind,
          c_type: f.c_type,
          access: f.access,
          reference: String(f.reference).padStart(5, '0'),
          ...(f.description ? { description: f.description } : {}),
        })),
      },
    },
  }

  return dump(cleanDoc, {
    indent: 2,
    lineWidth: 140,
    noRefs: true,
    forceQuotes: false,
  })
}

/**
 * 从 YAML 文本反解析为 ProjectIoDocument 实体
 */
export function deserializeProjectIoYaml(yamlText: string): ProjectIoDocument {
  const raw: any = load(yamlText)
  if (!raw || typeof raw !== 'object') {
    throw new Error('无效的 YAML 结构，根节点必须为对象')
  }

  const p = raw.project || {}

  // 映射 devices
  const devices = (p.devices || []).map((d: any, idx: number) => ({
    id: `dev_${Date.now()}_${idx}`,
    name: d.name || `dev_${idx + 1}`,
    profile: d.profile || 'sp4055_702',
    port: d.port || 'rs485_1',
    slave_address: Number(d.slave_address) || 1,
    poll_period_ms: Number(d.poll_period_ms) || 500,
    stale_after_ms: Number(d.stale_after_ms) || 1500,
    use: {
      inputs: Array.isArray(d.use?.inputs) ? d.use.inputs : [],
      outputs: d.use?.outputs && typeof d.use.outputs === 'object' ? d.use.outputs : {},
    },
  }))

  // 映射 points
  const inputs = (p.points?.inputs || []).map((pt: any, idx: number) => ({
    id: `pt_in_${Date.now()}_${idx}`,
    name: pt.name || `di_${idx + 1}`,
    source: pt.source || '',
    description: pt.description || '',
  }))

  const outputs = (p.points?.outputs || []).map((pt: any, idx: number) => ({
    id: `pt_out_${Date.now()}_${idx}`,
    name: pt.name || `do_${idx + 1}`,
    source: pt.source || '',
    description: pt.description || '',
  }))

  // 映射 application_variables
  const parameters = (p.application_variables?.parameters || []).map((param: any, idx: number) => ({
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
    id: `cmd_${Date.now()}_${idx}`,
    name: cmd.name || `cmd_${idx + 1}`,
    c_type: cmd.c_type || 'bool',
    effect: cmd.effect === 'protective' ? ('protective' as const) : undefined,
    description: cmd.description,
  }))

  const states = (p.application_variables?.states || []).map((st: any, idx: number) => ({
    id: `state_${Date.now()}_${idx}`,
    name: st.name || `state_${idx + 1}`,
    c_type: st.c_type || 'bool',
    default: st.default !== undefined ? st.default : false,
    description: st.description,
  }))

  // 映射 runtime_counters
  const runtime_counters = (p.runtime_counters || []).map((rc: any, idx: number) => ({
    id: `rc_${Date.now()}_${idx}`,
    name: rc.name || `counter_${idx + 1}`,
    description: rc.description || '',
    trigger: {
      bind: rc.trigger?.bind || '',
      active_value: rc.trigger?.active_value !== undefined ? Boolean(rc.trigger.active_value) : true,
      quality: rc.trigger?.quality || 'good',
    },
  }))

  // 映射 pids
  const pids = (p.pids || []).map((pid: any, idx: number) => ({
    id: `pid_${Date.now()}_${idx}`,
    name: pid.name || `pid_${idx + 1}`,
    enabled: Boolean(pid.enabled),
    measurement: pid.measurement || '',
    setpoint: pid.setpoint || '',
    output: pid.output || '',
    sample_period_ms: Number(pid.sample_period_ms) || 50,
    direction: pid.direction === 'reverse' ? ('reverse' as const) : ('direct' as const),
    kp: Number(pid.kp) || 1.0,
    ki: Number(pid.ki) || 0.1,
    kd: Number(pid.kd) || 0.0,
    output_min: Number(pid.output_min) || 0,
    output_max: Number(pid.output_max) || 100,
  }))

  // 映射 northbound
  const fields = (p.northbound?.fields || []).map((f: any, idx: number) => ({
    id: `nb_${Date.now()}_${idx}`,
    name: f.name || `field_${idx + 1}`,
    bind: f.bind || '',
    c_type: f.c_type || 'bool',
    access: f.access === 'read_write' ? ('read_write' as const) : ('read' as const),
    reference: String(f.reference || '00001').padStart(5, '0'),
    description: f.description || '',
  }))

  return {
    schema: raw.schema || 'kz3-project-io/v3',
    project: {
      name: p.name || '未命名工程',
      id: p.id || 'unnamed_project',
      version: p.version || '1.0.0',
      board: p.board || 'kz3_f427_standard',
      required_profiles: Array.isArray(p.required_profiles) ? p.required_profiles : [],
      scan_period_ms: Number(p.scan_period_ms) || 10,
      startup:
        p.startup && typeof p.startup === 'object'
          ? { ao_deferred_activation: Boolean(p.startup.ao_deferred_activation) }
          : undefined,
      features: {
        pid: Boolean(p.features?.pid),
        counter: Boolean(p.features?.counter),
        retained: false,
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
        inputs,
        outputs,
      },
      application_variables: {
        parameters,
        commands,
        states,
      },
      pids,
      logic_blocks: {
        timers: p.logic_blocks?.timers || [],
        edges: p.logic_blocks?.edges || [],
        counters: p.logic_blocks?.counters || [],
        latches: p.logic_blocks?.latches || [],
        debounces: p.logic_blocks?.debounces || [],
        filters: p.logic_blocks?.filters || [],
        rate_limits: p.logic_blocks?.rate_limits || [],
        runtimes: p.logic_blocks?.runtimes || [],
      },
      runtime_counters,
      northbound: {
        protocols: p.northbound?.protocols || ['sle', 'http', 'modbus_tcp'],
        modbus_tcp: {
          address_style: p.northbound?.modbus_tcp?.address_style || 'modicon_5_digit',
          word_order_32: p.northbound?.modbus_tcp?.word_order_32 || 'abcd',
        },
        fields,
      },
    },
  }
}
