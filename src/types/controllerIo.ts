/**
 * KZ3 工艺项目 I/O 可视化配置工具数据模型
 * 遵循 schema: kz3-project-io/v2
 */

// ==============================================================================
// 1. 固化板型与 Profile 产品字典
// ==============================================================================

export interface BoardChannelDef {
  code: string          // e.g. 'di01', 'do01', 'ai01', 'ao01'
  name: string          // 中文描述，如 '板载输入 DI1'
  type: 'bool' | 'float'
  direction: 'input' | 'output'
  driverChannel: number
  activeLevel?: 'low' | 'high'
  range?: string        // 如 '0..20 mA'
  defaultSafeValue?: boolean | number
  qualification: 'verified' | 'pending'
}

export interface BoardDef {
  id: string
  name: string
  channels: BoardChannelDef[]
}

export interface ProfileSignalDef {
  code: string          // e.g. 'di01', 'do01', 'ai01', 'ao01'
  name: string
  type: 'bool' | 'u16' | 'float'
  direction: 'input' | 'output'
  wireType?: string
  engineeringRange?: string
  hasFeedbackShadow?: boolean // 702/703 DO 与 705 AO 支持同地址回读影子
}

export interface ProfileDef {
  id: string            // 'sp4055_701', 'sp4055_702', etc.
  name: string          // '16路数字量输入模块 (701)'
  description: string
  qualification: 'software_qualified' | 'range_confirmed' | 'pending'
  inputs: ProfileSignalDef[]
  outputs: ProfileSignalDef[]
}

// ==============================================================================
// 2. 项目配置领域模型
// ==============================================================================

export interface Rs485PortConfig {
  baud: number
  parity: 'none' | 'even' | 'odd'
  stop_bits: 1 | 2
  response_timeout_ms: number
  retry_count: number
  offline_backoff_ms: number
}

export interface DeviceOutputUseConfig {
  safe_value: boolean | number
  confirm_timeout_ms?: number
}

export interface DeviceInstanceConfig {
  id: string            // UI 稳定 UUID
  name: string          // 项目内唯一实例 code，如 'expansion' 或 'dio_702'
  profile: string       // e.g. 'sp4055_702'
  port: string          // 'rs485_1' | 'rs485_2'
  slave_address: number // 1..247
  poll_period_ms: number
  stale_after_ms: number
  use: {
    inputs: string[]
    outputs: Record<string, DeviceOutputUseConfig>
  }
}

export interface PointConfig {
  id: string            // UI 稳定 UUID
  name: string          // 业务 logic_name，匹配 [a-z][a-z0-9_]{0,47}
  source: string        // 如 'board.di01' 或 'rtu.expansion.do01'
  description: string
  dataType?: string     // 派生类型：bool, float, u16 等
}

export interface ParameterConfig {
  id: string
  name: string
  c_type: 'bool' | 'u16' | 'u32' | 'i16' | 'i32' | 'float'
  default: boolean | number
  min?: number
  max?: number
  unit?: string
  apply?: 'next_scan'
  description?: string
}

export interface CommandConfig {
  id: string
  name: string
  c_type: 'bool'
  description?: string
}

export interface StateConfig {
  id: string
  name: string
  c_type: 'bool' | 'u16' | 'u32' | 'i16' | 'i32' | 'float'
  default: boolean | number
  description?: string
}

export interface PidConfig {
  id: string
  name: string
  enabled: boolean
  measurement: string   // 绑定的 float 输入点或参数
  setpoint: string      // 绑定的设定点
  output: string        // 绑定的输出 AO
  sample_period_ms: number
  direction: 'direct' | 'reverse'
  kp: number
  ki: number
  kd: number
  output_min: number
  output_max: number
}

export interface NorthboundField {
  id: string
  name: string          // 对外 JSON 键 / 字段名，如 'command.marquee_toggle'
  bind: string          // 内部绑定目标，如 'parameter.marquee_enable' 或 'point.expansion_marquee_01'
  c_type: 'bool' | 'u16' | 'u32' | 'float' | 'i16' | 'i32'
  access: 'read' | 'read_write'
  reference: string     // 5 位 Modicon 地址，如 '00001', '10001', '30001', '40001'
}

export interface ProjectIoDocument {
  schema: string        // 'kz3-project-io/v2'
  project: {
    name: string
    id: string
    version: string
    board: string       // 'kz3_f427_standard'
    required_profiles: string[]
    scan_period_ms: number
    features: {
      pid: boolean
      counter: boolean
      retained: boolean
    }
    rs485_ports: Record<string, Rs485PortConfig>
    devices: DeviceInstanceConfig[]
    points: {
      inputs: PointConfig[]
      outputs: PointConfig[]
    }
    application_variables: {
      parameters: ParameterConfig[]
      commands: CommandConfig[]
      states: StateConfig[]
    }
    pids: PidConfig[]
    logic_blocks: {
      timers: any[]
      edges: any[]
      counters: any[]
      latches: any[]
      debounces: any[]
      filters: any[]
      rate_limits: any[]
      runtimes: any[]
    }
    northbound: {
      protocols: string[]
      modbus_tcp: {
        address_style: string
        word_order_32: string
      }
      fields: NorthboundField[]
    }
  }
}

// ==============================================================================
// 3. 诊断与校验问题
// ==============================================================================

export type ValidationSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  code: string
  severity: ValidationSeverity
  tab: 'overview' | 'hardware' | 'points' | 'variables' | 'northbound' | 'debug' | 'yaml'
  entity: string
  message: string
  yamlPath?: string
}
