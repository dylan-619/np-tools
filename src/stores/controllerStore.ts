import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  ProjectIoDocument,
  ValidationIssue,
  DeviceInstanceConfig,
  PointConfig,
  NorthboundField,
} from '../types/controllerIo'
import { KZ3_BOARD_DEF, PROFILE_CATALOG } from '../utils/controllerIoCatalog'
import { serializeProjectIoYaml, deserializeProjectIoYaml } from '../utils/yamlHelper'
import { appSaveFile, appOpenFile } from '../api/sjzdApi'

const DEFAULT_MARQUEE_YAML = `schema: kz3-project-io/v2

project:
  name: 扩展DO北向启停跑马灯
  id: expansion_marquee_di01_north_command
  version: 1.0.0
  board: kz3_f427_standard
  required_profiles: [sp4055_702]
  scan_period_ms: 10

  features:
    pid: false
    counter: false
    retained: false

  rs485_ports:
    rs485_1:
      baud: 9600
      parity: none
      stop_bits: 1
      response_timeout_ms: 100
      retry_count: 1
      offline_backoff_ms: 5000

  devices:
    - name: expansion
      profile: sp4055_702
      port: rs485_1
      slave_address: 1
      poll_period_ms: 500
      stale_after_ms: 1500
      use:
        outputs:
          do01: {safe_value: false}
          do02: {safe_value: false}
          do03: {safe_value: false}
          do04: {safe_value: false}
          do05: {safe_value: false}
          do06: {safe_value: false}
          do07: {safe_value: false}
          do08: {safe_value: false}

  points:
    inputs: []
    outputs:
      - {name: marquee_enable, source: board.do01, description: 板载 DO1 扩展跑马灯启停标志，true 时运行扩展 DO 跑马灯}
      - {name: expansion_marquee_01, source: rtu.expansion.do01, description: 702 扩展模块 DO1 跑马灯输出}
      - {name: expansion_marquee_02, source: rtu.expansion.do02, description: 702 扩展模块 DO2 跑马灯输出}
      - {name: expansion_marquee_03, source: rtu.expansion.do03, description: 702 扩展模块 DO3 跑马灯输出}
      - {name: expansion_marquee_04, source: rtu.expansion.do04, description: 702 扩展模块 DO4 跑马灯输出}
      - {name: expansion_marquee_05, source: rtu.expansion.do05, description: 702 扩展模块 DO5 跑马灯输出}
      - {name: expansion_marquee_06, source: rtu.expansion.do06, description: 702 扩展模块 DO6 跑马灯输出}
      - {name: expansion_marquee_07, source: rtu.expansion.do07, description: 702 扩展模块 DO7 跑马灯输出}
      - {name: expansion_marquee_08, source: rtu.expansion.do08, description: 702 扩展模块 DO8 跑马灯输出}

  application_variables:
    parameters:
      - {name: marquee_enable, c_type: bool, default: false}
    commands: []
    states:
      - {name: marquee_running, c_type: bool, default: false}
      - {name: marquee_step, c_type: u32, default: 0}
      - {name: marquee_last_ms, c_type: u32, default: 0}

  pids: []

  logic_blocks:
    timers: []
    edges: []
    counters: []
    latches: []
    debounces: []
    filters: []
    rate_limits: []
    runtimes: []

  northbound:
    protocols: [sle, http, modbus_tcp]
    modbus_tcp:
      address_style: modicon_5_digit
      word_order_32: abcd
    fields:
      - {name: command.marquee_toggle, bind: parameter.marquee_enable, c_type: bool, access: read_write, reference: "00001"}
      - {name: board.do01, bind: point.marquee_enable, c_type: bool, access: read, reference: "00011"}
      - {name: state.marquee_running, bind: state.marquee_running, c_type: bool, access: read, reference: "10001"}
      - {name: expansion_marquee_01, bind: point.expansion_marquee_01, c_type: bool, access: read, reference: "00012"}
      - {name: expansion_marquee_02, bind: point.expansion_marquee_02, c_type: bool, access: read, reference: "00013"}
      - {name: expansion_marquee_03, bind: point.expansion_marquee_03, c_type: bool, access: read, reference: "00014"}
      - {name: expansion_marquee_04, bind: point.expansion_marquee_04, c_type: bool, access: read, reference: "00015"}
      - {name: expansion_marquee_05, bind: point.expansion_marquee_05, c_type: bool, access: read, reference: "00016"}
      - {name: expansion_marquee_06, bind: point.expansion_marquee_06, c_type: bool, access: read, reference: "00017"}
      - {name: expansion_marquee_07, bind: point.expansion_marquee_07, c_type: bool, access: read, reference: "00018"}
      - {name: expansion_marquee_08, bind: point.expansion_marquee_08, c_type: bool, access: read, reference: "00019"}
`

export const useControllerStore = defineStore('controller', () => {
  const activeTab = ref<'overview' | 'hardware' | 'points' | 'variables' | 'northbound' | 'yaml'>('overview')
  const doc = ref<ProjectIoDocument>(deserializeProjectIoYaml(DEFAULT_MARQUEE_YAML))
  const toastMessage = ref<{ text: string; isSuccess: boolean } | null>(null)
  let toastTimer: number | null = null

  function showMessage(text: string, isSuccess = true) {
    if (toastTimer) clearTimeout(toastTimer)
    toastMessage.value = { text, isSuccess }
    toastTimer = window.setTimeout(() => {
      toastMessage.value = null
    }, 3000)
  }

  // ==============================================================================
  // 物理可用源计算
  // ==============================================================================

  const availableInputSources = computed(() => {
    const list: { label: string; value: string; type: string }[] = []
    // 1. 板载 DI & AI
    for (const ch of KZ3_BOARD_DEF.channels) {
      if (ch.direction === 'input') {
        list.push({
          label: `[板载] ${ch.name} (board.${ch.code})`,
          value: `board.${ch.code}`,
          type: ch.type,
        })
      }
    }
    // 2. 扩展设备已使能输入
    for (const dev of doc.value.project.devices) {
      const profile = PROFILE_CATALOG[dev.profile]
      if (!profile) continue
      for (const inCode of dev.use.inputs || []) {
        const sig = profile.inputs.find((s) => s.code === inCode)
        const sigName = sig ? sig.name : inCode
        list.push({
          label: `[${dev.name} / ${dev.profile}] ${sigName} (rtu.${dev.name}.${inCode})`,
          value: `rtu.${dev.name}.${inCode}`,
          type: sig ? sig.type : 'bool',
        })
      }
    }
    return list
  })

  const availableOutputSources = computed(() => {
    const list: { label: string; value: string; type: string }[] = []
    // 1. 板载 DO & AO
    for (const ch of KZ3_BOARD_DEF.channels) {
      if (ch.direction === 'output') {
        list.push({
          label: `[板载] ${ch.name} (board.${ch.code})`,
          value: `board.${ch.code}`,
          type: ch.type,
        })
      }
    }
    // 2. 扩展设备已使能输出
    for (const dev of doc.value.project.devices) {
      const profile = PROFILE_CATALOG[dev.profile]
      if (!profile) continue
      for (const outCode of Object.keys(dev.use.outputs || {})) {
        const sig = profile.outputs.find((s) => s.code === outCode)
        const sigName = sig ? sig.name : outCode
        list.push({
          label: `[${dev.name} / ${dev.profile}] ${sigName} (rtu.${dev.name}.${outCode})`,
          value: `rtu.${dev.name}.${outCode}`,
          type: sig ? sig.type : 'bool',
        })
      }
    }
    return list
  })

  function getSourceType(sourceStr: string): 'bool' | 'u16' | 'float' {
    if (!sourceStr) return 'bool'

    // 1. 板载
    if (sourceStr.startsWith('board.')) {
      const code = sourceStr.replace('board.', '')
      const ch = KZ3_BOARD_DEF.channels.find((c) => c.code === code)
      if (ch) return ch.type
      if (code.startsWith('di') || code.startsWith('do')) return 'bool'
      if (code.startsWith('ai') || code.startsWith('ao')) return 'float'
      return 'bool'
    }

    // 2. RTU 扩展设备
    if (sourceStr.startsWith('rtu.')) {
      const parts = sourceStr.split('.')
      if (parts.length >= 3) {
        const devName = parts[1]
        const sigCode = parts[2]
        const dev = doc.value.project.devices.find((d) => d.name === devName)
        if (dev) {
          const profile = PROFILE_CATALOG[dev.profile]
          if (profile) {
            const sig = [...profile.inputs, ...profile.outputs].find((s) => s.code === sigCode)
            if (sig) return sig.type as 'bool' | 'u16' | 'float'
          }
        }
        if (sigCode.startsWith('ai') || sigCode.startsWith('ao')) return 'u16'
        if (sigCode.startsWith('di') || sigCode.startsWith('do')) return 'bool'
      }
    }

    return 'bool'
  }

  const availableBindTargets = computed(() => {
    const list: { label: string; value: string; type: string; category: string }[] = []
    // 1. Points Inputs
    for (const p of doc.value.project.points.inputs) {
      const ptType = getSourceType(p.source)
      list.push({
        label: `[输入点] point.${p.name} (${ptType.toUpperCase()}) - ${p.description || p.source}`,
        value: `point.${p.name}`,
        type: ptType,
        category: 'point',
      })
    }
    // 2. Points Outputs
    for (const p of doc.value.project.points.outputs) {
      const ptType = getSourceType(p.source)
      list.push({
        label: `[输出点] point.${p.name} (${ptType.toUpperCase()}) - ${p.description || p.source}`,
        value: `point.${p.name}`,
        type: ptType,
        category: 'point',
      })
    }
    // 3. Parameters
    for (const param of doc.value.project.application_variables.parameters) {
      list.push({
        label: `[应用参数] parameter.${param.name} (${param.c_type.toUpperCase()})`,
        value: `parameter.${param.name}`,
        type: param.c_type,
        category: 'parameter',
      })
    }
    // 4. Commands
    for (const cmd of doc.value.project.application_variables.commands) {
      list.push({
        label: `[控制命令] command.${cmd.name} (${cmd.c_type.toUpperCase()})`,
        value: `command.${cmd.name}`,
        type: cmd.c_type,
        category: 'command',
      })
    }
    // 5. States
    for (const st of doc.value.project.application_variables.states) {
      list.push({
        label: `[系统状态] state.${st.name} (${st.c_type.toUpperCase()})`,
        value: `state.${st.name}`,
        type: st.c_type,
        category: 'state',
      })
    }
    return list
  })

  // ==============================================================================
  // 综合工程校验引擎
  // ==============================================================================

  const validationIssues = computed<ValidationIssue[]>(() => {
    const issues: ValidationIssue[] = []
    const p = doc.value.project

    // 1. 项目身份
    if (!p.id || !/^[a-zA-Z0-9_.-]{1,64}$/.test(p.id)) {
      issues.push({
        code: 'INVALID_PROJECT_ID',
        severity: 'error',
        tab: 'overview',
        entity: 'project.id',
        message: `项目 ID '${p.id}' 不合规：必须由字母/数字/下划线/中划线/点组成 (最长 64 字符)`,
      })
    }
    if (!p.name.trim()) {
      issues.push({
        code: 'EMPTY_PROJECT_NAME',
        severity: 'warning',
        tab: 'overview',
        entity: 'project.name',
        message: '项目名称建议填写有意义的中文工程名称',
      })
    }
    if (p.scan_period_ms <= 0 || p.scan_period_ms > 1000) {
      issues.push({
        code: 'INVALID_SCAN_PERIOD',
        severity: 'error',
        tab: 'overview',
        entity: 'project.scan_period_ms',
        message: '扫描周期必须在 1~1000 ms 之间',
      })
    }

    // 2. 硬件与设备
    const slaveAddrMap = new Map<string, string>()
    const devNameSet = new Set<string>()

    for (const dev of p.devices) {
      // 实例名查重
      if (!dev.name || !/^[a-zA-Z0-9_.-]{1,48}$/.test(dev.name)) {
        issues.push({
          code: 'INVALID_DEV_NAME',
          severity: 'error',
          tab: 'hardware',
          entity: `device:${dev.name}`,
          message: `设备实例名 '${dev.name}' 不合规：必须由字母/数字/下划线/中划线组成 (如 701_1, expansion)`,
        })
      } else if (devNameSet.has(dev.name)) {
        issues.push({
          code: 'DUPLICATE_DEV_NAME',
          severity: 'error',
          tab: 'hardware',
          entity: `device:${dev.name}`,
          message: `设备实例名 '${dev.name}' 重复，工程内必须唯一`,
        })
      } else {
        devNameSet.add(dev.name)
      }

      // 端口与站号
      if (!p.rs485_ports[dev.port]) {
        issues.push({
          code: 'PORT_NOT_CONFIGURED',
          severity: 'error',
          tab: 'hardware',
          entity: `device:${dev.name}`,
          message: `设备 '${dev.name}' 使用的端口 '${dev.port}' 未在 rs485_ports 中配置`,
        })
      }

      const key = `${dev.port}_${dev.slave_address}`
      if (slaveAddrMap.has(key)) {
        issues.push({
          code: 'DUPLICATE_SLAVE_ADDRESS',
          severity: 'error',
          tab: 'hardware',
          entity: `device:${dev.name}`,
          message: `端口 ${dev.port} 上的站号 ${dev.slave_address} 与设备 '${slaveAddrMap.get(key)}' 冲突`,
        })
      } else {
        slaveAddrMap.set(key, dev.name)
      }

      if (dev.slave_address < 1 || dev.slave_address > 247) {
        issues.push({
          code: 'INVALID_SLAVE_ADDR',
          severity: 'error',
          tab: 'hardware',
          entity: `device:${dev.name}`,
          message: `设备 '${dev.name}' 站号必须在 1~247 之间`,
        })
      }

      // 705 模拟量输出整组完整性规则
      if (dev.profile === 'sp4024_705') {
        const outKeys = Object.keys(dev.use.outputs || {})
        if (outKeys.length > 0 && outKeys.length < 4) {
          issues.push({
            code: 'INCOMPLETE_705_AO_GROUP',
            severity: 'warning',
            tab: 'hardware',
            entity: `device:${dev.name}`,
            message: `705 模块使用 FC16 整组写入，建议将 ao01~ao04 全部 4 路输出均纳入声明并确认安全值`,
          })
        }
      }
    }

    // 3. I/O 点表检查
    const pointNames = new Set<string>()
    const sourceOwners = new Map<string, string>()

    const allPoints = [
      ...p.points.inputs.map((pt) => ({ ...pt, dir: 'input' })),
      ...p.points.outputs.map((pt) => ({ ...pt, dir: 'output' })),
    ]

    for (const pt of allPoints) {
      if (!pt.name || !/^[a-zA-Z0-9_.-]{1,64}$/.test(pt.name)) {
        issues.push({
          code: 'INVALID_POINT_NAME',
          severity: 'error',
          tab: 'points',
          entity: `point:${pt.name}`,
          message: `业务点名 '${pt.name}' 格式不合法：必须由字母/数字/下划线/中划线/点组成 (如 701_2_di01, pump_1_run)`,
        })
      } else if (pointNames.has(pt.name)) {
        issues.push({
          code: 'DUPLICATE_POINT_NAME',
          severity: 'error',
          tab: 'points',
          entity: `point:${pt.name}`,
          message: `业务点名 '${pt.name}' 重复，点表全局必须唯一`,
        })
      } else {
        pointNames.add(pt.name)
      }

      if (!pt.source) {
        issues.push({
          code: 'EMPTY_POINT_SOURCE',
          severity: 'error',
          tab: 'points',
          entity: `point:${pt.name}`,
          message: `业务点 '${pt.name}' 未指定物理源 (source)`,
        })
      } else {
        if (sourceOwners.has(pt.source)) {
          issues.push({
            code: 'DUPLICATE_SOURCE_OWNER',
            severity: 'error',
            tab: 'points',
            entity: `point:${pt.name}`,
            message: `物理源 '${pt.source}' 已被业务点 '${sourceOwners.get(pt.source)}' 绑定，不允许重复所有权`,
          })
        } else {
          sourceOwners.set(pt.source, pt.name)
        }
      }
    }

    // 4. 北向通信映射检查
    const nbFieldNames = new Set<string>()
    const usedModbusRefs = new Set<string>()

    for (const f of p.northbound.fields) {
      if (!f.name || !/^[a-zA-Z0-9_.-]{1,48}$/.test(f.name)) {
        issues.push({
          code: 'INVALID_NB_FIELD_NAME',
          severity: 'error',
          tab: 'northbound',
          entity: `north:${f.name}`,
          message: `北向字段名 '${f.name}' 必须由字母/数字/下划线/中划线/点组成 (最长48字符)`,
        })
      } else if (nbFieldNames.has(f.name)) {
        issues.push({
          code: 'DUPLICATE_NB_FIELD_NAME',
          severity: 'error',
          tab: 'northbound',
          entity: `north:${f.name}`,
          message: `北向字段名 '${f.name}' 重复`,
        })
      } else {
        nbFieldNames.add(f.name)
      }

      if (!f.bind) {
        issues.push({
          code: 'EMPTY_NB_BIND',
          severity: 'error',
          tab: 'northbound',
          entity: `north:${f.name}`,
          message: `北向字段 '${f.name}' 未指定内部绑定对象 (bind)`,
        })
      } else {
        // 权限规则检查
        if (f.bind.startsWith('point.') && f.access === 'read_write') {
          issues.push({
            code: 'WRITE_TO_POINT_FORBIDDEN',
            severity: 'error',
            tab: 'northbound',
            entity: `north:${f.name}`,
            message: `业务点 '${f.bind}' 禁止在北向配置为可写 (read_write)，写入请经由 parameter 或 command 联锁`,
          })
        }
        if (f.bind.startsWith('state.') && f.access === 'read_write') {
          issues.push({
            code: 'STATE_MUST_BE_READONLY',
            severity: 'error',
            tab: 'northbound',
            entity: `north:${f.name}`,
            message: `系统状态 '${f.bind}' 必须为只读 (read)`,
          })
        }
        if ((f.bind.startsWith('parameter.') || f.bind.startsWith('command.')) && f.access === 'read') {
          issues.push({
            code: 'PARAM_CMD_SHOULD_BE_RW',
            severity: 'info',
            tab: 'northbound',
            entity: `north:${f.name}`,
            message: `参数或命令 '${f.bind}' 通常应提供 read_write 访问权限`,
          })
        }
      }

      // Modbus Reference 格式与地址区检查
      const refStr = String(f.reference).padStart(5, '0')
      if (!/^\d{5}$/.test(refStr)) {
        issues.push({
          code: 'INVALID_MODBUS_REF',
          severity: 'error',
          tab: 'northbound',
          entity: `north:${f.name}`,
          message: `Modbus 地址 '${f.reference}' 格式错误，必须为 5 位数字 (如 00001, 10001, 30001, 40001)`,
        })
      } else {
        if (usedModbusRefs.has(refStr)) {
          issues.push({
            code: 'DUPLICATE_MODBUS_REF',
            severity: 'error',
            tab: 'northbound',
            entity: `north:${f.name}`,
            message: `Modbus 地址 '${refStr}' 与其他字段冲突`,
          })
        } else {
          usedModbusRefs.add(refStr)
        }
      }
    }

    return issues
  })

  const errorCount = computed(() => validationIssues.value.filter((i) => i.severity === 'error').length)
  const warningCount = computed(() => validationIssues.value.filter((i) => i.severity === 'warning').length)

  // ==============================================================================
  // 增删改操作辅助函数
  // ==============================================================================

  function addDevice(profileId: string) {
    const profile = PROFILE_CATALOG[profileId]
    if (!profile) return
    const count = doc.value.project.devices.filter((d) => d.profile === profileId).length + 1
    const prefix = profileId.replace('sp4055_', '').replace('sp4024_', '')
    const devName = `${prefix}_${count}`

    // 默认启用所有通道
    const defaultInputs = profile.inputs.map((s) => s.code)
    const defaultOutputs: Record<string, { safe_value: boolean | number }> = {}
    for (const out of profile.outputs) {
      defaultOutputs[out.code] = {
        safe_value: out.type === 'bool' ? false : 0,
      }
    }

    // 寻找未使用的站号
    const usedSlaves = new Set(doc.value.project.devices.map((d) => d.slave_address))
    let slave = 1
    while (usedSlaves.has(slave) && slave < 247) {
      slave++
    }

    const newDev: DeviceInstanceConfig = {
      id: `dev_${Date.now()}`,
      name: devName,
      profile: profileId,
      port: 'rs485_1',
      slave_address: slave,
      poll_period_ms: 500,
      stale_after_ms: 1500,
      use: {
        inputs: defaultInputs,
        outputs: defaultOutputs,
      },
    }

    doc.value.project.devices.push(newDev)
    showMessage(`已添加扩展设备: ${profile.name}`)
  }

  function removeDevice(index: number) {
    const dev = doc.value.project.devices[index]
    doc.value.project.devices.splice(index, 1)
    showMessage(`已移除设备 ${dev.name}`)
  }

  function addInputPoint(pt?: Partial<PointConfig>) {
    const count = doc.value.project.points.inputs.length + 1
    const newPt: PointConfig = {
      id: `pt_in_${Date.now()}`,
      name: pt?.name || `di_${count.toString().padStart(2, '0')}`,
      source: pt?.source || (availableInputSources.value[0]?.value || 'board.di01'),
      description: pt?.description || `输入点位 ${count}`,
    }
    doc.value.project.points.inputs.push(newPt)
  }

  function removeInputPoint(index: number) {
    doc.value.project.points.inputs.splice(index, 1)
  }

  function addOutputPoint(pt?: Partial<PointConfig>) {
    const count = doc.value.project.points.outputs.length + 1
    const newPt: PointConfig = {
      id: `pt_out_${Date.now()}`,
      name: pt?.name || `do_${count.toString().padStart(2, '0')}`,
      source: pt?.source || (availableOutputSources.value[0]?.value || 'board.do01'),
      description: pt?.description || `输出点位 ${count}`,
    }
    doc.value.project.points.outputs.push(newPt)
  }

  function removeOutputPoint(index: number) {
    doc.value.project.points.outputs.splice(index, 1)
  }

  function addParameter() {
    const count = doc.value.project.application_variables.parameters.length + 1
    doc.value.project.application_variables.parameters.push({
      id: `param_${Date.now()}`,
      name: `param_${count}`,
      c_type: 'bool',
      default: false,
      apply: 'next_scan',
    })
  }

  function removeParameter(index: number) {
    doc.value.project.application_variables.parameters.splice(index, 1)
  }

  function addCommand() {
    const count = doc.value.project.application_variables.commands.length + 1
    doc.value.project.application_variables.commands.push({
      id: `cmd_${Date.now()}`,
      name: `cmd_${count}`,
      c_type: 'bool',
    })
  }

  function removeCommand(index: number) {
    doc.value.project.application_variables.commands.splice(index, 1)
  }

  function addState() {
    const count = doc.value.project.application_variables.states.length + 1
    doc.value.project.application_variables.states.push({
      id: `state_${Date.now()}`,
      name: `state_${count}`,
      c_type: 'bool',
      default: false,
    })
  }

  function removeState(index: number) {
    doc.value.project.application_variables.states.splice(index, 1)
  }

  function addPid() {
    const count = doc.value.project.pids.length + 1
    doc.value.project.pids.push({
      id: `pid_${Date.now()}`,
      name: `pid_${count}`,
      enabled: true,
      measurement: 'board.ai01',
      setpoint: 'param_target',
      output: 'board.ao01',
      sample_period_ms: 50,
      direction: 'direct',
      kp: 1.0,
      ki: 0.1,
      kd: 0.0,
      output_min: 0,
      output_max: 100,
    })
  }

  function removePid(index: number) {
    doc.value.project.pids.splice(index, 1)
  }

  function addNorthboundField(f?: Partial<NorthboundField>) {
    const count = doc.value.project.northbound.fields.length + 1
    const firstBind = availableBindTargets.value[0]?.value || 'parameter.marquee_enable'
    const newField: NorthboundField = {
      id: `nb_${Date.now()}`,
      name: f?.name || `field_${count}`,
      bind: f?.bind || firstBind,
      c_type: f?.c_type || 'bool',
      access: f?.access || 'read',
      reference: f?.reference || '00001',
    }
    doc.value.project.northbound.fields.push(newField)
  }

  function removeNorthboundField(index: number) {
    doc.value.project.northbound.fields.splice(index, 1)
  }

  // 自动分配 Modbus 5 位地址
  function autoAssignNorthboundAddresses() {
    let coilRef = 1       // 00001
    let diRef = 10001     // 10001
    let irRef = 30001     // 30001
    let hrRef = 40001     // 40001

    for (const f of doc.value.project.northbound.fields) {
      const isBool = f.c_type === 'bool'
      const isRead = f.access === 'read'

      if (isBool) {
        if (isRead) {
          if (f.bind.startsWith('point.')) {
            const ptName = f.bind.replace('point.', '')
            const isOutputPoint = doc.value.project.points.outputs.some((p) => p.name === ptName)
            if (isOutputPoint) {
              f.reference = coilRef.toString().padStart(5, '0')
              coilRef++
              continue
            }
          }
          f.reference = diRef.toString().padStart(5, '0')
          diRef++
        } else {
          f.reference = coilRef.toString().padStart(5, '0')
          coilRef++
        }
      } else {
        const width = f.c_type === 'u32' || f.c_type === 'float' || f.c_type === 'i32' ? 2 : 1
        if (!isRead || f.bind.startsWith('parameter.')) {
          f.reference = hrRef.toString().padStart(5, '0')
          hrRef += width
        } else if (f.bind.startsWith('point.')) {
          const ptName = f.bind.replace('point.', '')
          const isOutputPoint = doc.value.project.points.outputs.some((p) => p.name === ptName)
          if (isOutputPoint) {
            f.reference = hrRef.toString().padStart(5, '0')
            hrRef += width
          } else {
            f.reference = irRef.toString().padStart(5, '0')
            irRef += width
          }
        } else {
          f.reference = irRef.toString().padStart(5, '0')
          irRef += width
        }
      }
    }
    showMessage('已完成北向 Modbus 地址智能自动分配！')
  }

  // 从点表与变量一键填充北向字段
  function populateNorthboundFromPointsAndVars() {
    const fields: NorthboundField[] = []
    let coilRef = 1       // 00001
    let diRef = 10001     // 10001
    let irRef = 30001     // 30001
    let hrRef = 40001     // 40001

    // 1. Inputs (DI -> 10001+ / AI -> 30001+)
    for (const pt of doc.value.project.points.inputs) {
      const ptType = getSourceType(pt.source)
      if (ptType === 'bool') {
        fields.push({
          id: `nb_${Date.now()}_${pt.name}`,
          name: `input.${pt.name}`,
          bind: `point.${pt.name}`,
          c_type: 'bool',
          access: 'read',
          reference: diRef.toString().padStart(5, '0'),
        })
        diRef++
      } else {
        const width = ptType === 'float' ? 2 : 1
        fields.push({
          id: `nb_${Date.now()}_${pt.name}`,
          name: `input.${pt.name}`,
          bind: `point.${pt.name}`,
          c_type: ptType,
          access: 'read',
          reference: irRef.toString().padStart(5, '0'),
        })
        irRef += width
      }
    }

    // 2. Outputs (DO -> 00001+ / AO -> 40001+)
    for (const pt of doc.value.project.points.outputs) {
      const ptType = getSourceType(pt.source)
      if (ptType === 'bool') {
        fields.push({
          id: `nb_${Date.now()}_${pt.name}`,
          name: `output.${pt.name}`,
          bind: `point.${pt.name}`,
          c_type: 'bool',
          access: 'read',
          reference: coilRef.toString().padStart(5, '0'),
        })
        coilRef++
      } else {
        const width = ptType === 'float' ? 2 : 1
        fields.push({
          id: `nb_${Date.now()}_${pt.name}`,
          name: `output.${pt.name}`,
          bind: `point.${pt.name}`,
          c_type: ptType,
          access: 'read',
          reference: hrRef.toString().padStart(5, '0'),
        })
        hrRef += width
      }
    }

    // 3. Parameters -> HR 4xxxx or Coil 0xxxx
    for (const p of doc.value.project.application_variables.parameters) {
      if (p.c_type === 'bool') {
        fields.push({
          id: `nb_${Date.now()}_${p.name}`,
          name: `param.${p.name}`,
          bind: `parameter.${p.name}`,
          c_type: 'bool',
          access: 'read_write',
          reference: coilRef.toString().padStart(5, '0'),
        })
        coilRef++
      } else {
        const width = p.c_type === 'u32' || p.c_type === 'float' || p.c_type === 'i32' ? 2 : 1
        fields.push({
          id: `nb_${Date.now()}_${p.name}`,
          name: `param.${p.name}`,
          bind: `parameter.${p.name}`,
          c_type: p.c_type,
          access: 'read_write',
          reference: hrRef.toString().padStart(5, '0'),
        })
        hrRef += width
      }
    }

    // 4. Commands -> Coil 0xxxx
    for (const c of doc.value.project.application_variables.commands) {
      fields.push({
        id: `nb_${Date.now()}_${c.name}`,
        name: `command.${c.name}`,
        bind: `command.${c.name}`,
        c_type: 'bool',
        access: 'read_write',
        reference: coilRef.toString().padStart(5, '0'),
      })
      coilRef++
    }

    // 5. States -> DI 1xxxx or IR 3xxxx
    for (const s of doc.value.project.application_variables.states) {
      if (s.c_type === 'bool') {
        fields.push({
          id: `nb_${Date.now()}_${s.name}`,
          name: `state.${s.name}`,
          bind: `state.${s.name}`,
          c_type: 'bool',
          access: 'read',
          reference: diRef.toString().padStart(5, '0'),
        })
        diRef++
      } else {
        const width = s.c_type === 'u32' || s.c_type === 'float' || s.c_type === 'i32' ? 2 : 1
        fields.push({
          id: `nb_${Date.now()}_${s.name}`,
          name: `state.${s.name}`,
          bind: `state.${s.name}`,
          c_type: s.c_type,
          access: 'read',
          reference: irRef.toString().padStart(5, '0'),
        })
        irRef += width
      }
    }

    doc.value.project.northbound.fields = fields
    showMessage(`已自动生成 ${fields.length} 个北向通信映射字段 (含 DI/DO/AI/AO 准确数据类型与 Modbus 地址)！`)
  }

  // ==============================================================================
  // 文件与模板操作
  // ==============================================================================

  function loadPreset(presetKey: 'marquee' | 'full_expansion' | 'blank') {
    if (presetKey === 'marquee') {
      doc.value = deserializeProjectIoYaml(DEFAULT_MARQUEE_YAML)
      showMessage('已载入《扩展 DO 北向跑马灯》工程配置模板')
    } else if (presetKey === 'blank') {
      doc.value = {
        schema: 'kz3-project-io/v2',
        project: {
          name: '新工艺控制器工程',
          id: 'new_kz3_project',
          version: '1.0.0',
          board: 'kz3_f427_standard',
          required_profiles: [],
          scan_period_ms: 10,
          features: { pid: false, counter: false, retained: false },
          rs485_ports: {
            rs485_1: {
              baud: 9600,
              parity: 'none',
              stop_bits: 1,
              response_timeout_ms: 100,
              retry_count: 1,
              offline_backoff_ms: 5000,
            },
          },
          devices: [],
          points: { inputs: [], outputs: [] },
          application_variables: { parameters: [], commands: [], states: [] },
          pids: [],
          logic_blocks: {
            timers: [],
            edges: [],
            counters: [],
            latches: [],
            debounces: [],
            filters: [],
            rate_limits: [],
            runtimes: [],
          },
          northbound: {
            protocols: ['sle', 'http', 'modbus_tcp'],
            modbus_tcp: { address_style: 'modicon_5_digit', word_order_32: 'abcd' },
            fields: [],
          },
        },
      }
      showMessage('已创建空白 KZ3 工程配置')
    }
  }

  async function exportYamlFile() {
    const yamlStr = serializeProjectIoYaml(doc.value)
    const defaultName = `${doc.value.project.id || 'project_io'}.yaml`
    const savedPath = await appSaveFile(defaultName, yamlStr, 'YAML 配置文件 (*.yaml)', 'yaml')
    if (savedPath) {
      showMessage(`已成功导出 YAML 配置文件至: ${savedPath}`)
      return
    }

    // Web Fallback
    const blob = new Blob([yamlStr], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultName
    a.click()
    URL.revokeObjectURL(url)
    showMessage('已导出 project_io.yaml 文件')
  }

  async function importYamlFile() {
    const result = await appOpenFile('YAML 配置文件 (*.yaml, *.yml)', ['yaml', 'yml'])
    if (result && result.content) {
      try {
        doc.value = deserializeProjectIoYaml(result.content)
        showMessage(`已成功从 ${result.path} 载入工程配置！`)
      } catch (err: any) {
        showMessage(`解析 YAML 失败: ${err.message}`, false)
      }
    }
  }

  function getYamlString(): string {
    return serializeProjectIoYaml(doc.value)
  }

  function applyYamlString(yamlText: string) {
    try {
      doc.value = deserializeProjectIoYaml(yamlText)
      showMessage('已成功应用 YAML 编辑更改！')
    } catch (err: any) {
      showMessage(`应用 YAML 失败: ${err.message}`, false)
      throw err
    }
  }

  return {
    doc,
    activeTab,
    toastMessage,
    availableInputSources,
    availableOutputSources,
    availableBindTargets,
    validationIssues,
    errorCount,
    warningCount,
    showMessage,
    addDevice,
    removeDevice,
    addInputPoint,
    removeInputPoint,
    addOutputPoint,
    removeOutputPoint,
    addParameter,
    removeParameter,
    addCommand,
    removeCommand,
    addState,
    removeState,
    addPid,
    removePid,
    addNorthboundField,
    removeNorthboundField,
    getSourceType,
    autoAssignNorthboundAddresses,
    populateNorthboundFromPointsAndVars,
    loadPreset,
    exportYamlFile,
    importYamlFile,
    getYamlString,
    applyYamlString,
  }
})
