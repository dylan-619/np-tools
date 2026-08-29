import type { NorthboundField } from './controllerIo'

export type Kz3Scalar = boolean | number
export type PointQuality = 0 | 1 | 2 | 3 | 4
export type DebugTransportState = 'disconnected' | 'connecting' | 'online' | 'degraded'
export type CompatibilityState = 'unverified' | 'partial' | 'matched' | 'mismatch'
export type ObservationState = 'unknown' | 'passed' | 'failed'

export interface Kz3HttpResponse {
  status: number
  body: string
  contentType: string | null
  elapsedMs: number
}

export interface DiagnosticEnvelope<T> {
  api_version: string
  timestamp_ms: number
  data: T
}

export interface DeviceDiagnostic {
  device_type: string
  serial_number: string
  device_address: number
  hardware_version: string
  boot_version: string
  app_version: string
  production_date: string
  boot_count: number | null
  uptime_seconds: number
  total_runtime_seconds: number
}

export interface HardwareDiagnostic {
  mcu: string
  do_count: number
  di_count: number
  ai_count: number
  ao_count: number
  mac: string
  ethernet_capable: boolean
}

export interface NetworkDiagnostic {
  ip: number[]
  netmask: number[]
  gateway: number[]
  mac: string
  link: boolean
  http_port: number
}

export interface SleDiagnostic {
  config_version: number
  address: number
  network_name: string
  ap_id: number
  work_mode: number
  tx_power: number
  max_tx_power: number
  config_valid: boolean
  module_ready: boolean
  module_mac: string
  module_mac_valid: boolean
}

export interface ConfigDiagnostic {
  format_version: number
  config_revision: number
  network_mode: number
  http_port: number
  modbus_port: number
  unit_id: number
  modbus_enabled: boolean
  reboot_required: boolean
}

export interface ServiceState {
  enabled: boolean
  running: boolean
  port: number
  clients: number
  requests: number
  errors: number
}

export interface ServicesDiagnostic {
  http: ServiceState
  modbus_tcp: ServiceState
}

export interface HealthDiagnostic {
  uptime_seconds: number
  reset_reason: string
  watchdog_healthy: boolean
  storage_healthy: boolean
  network_healthy: boolean
  control_task_healthy: boolean
}

export interface ControllerFaultDiagnostic {
  code: number
  source: number
  detail: number
  active: boolean
  latched: boolean
  first_seen_ms: number
  last_seen_ms: number
}

export interface IoDiagnostic {
  snapshot_revision: number
  di_bitmap: number
  do_target_bitmap: number
  ai_uA: number[]
  ao_target_uA: number[]
  mcu_voltage_mV: number
  mcu_temperature_centi_c: number
  control_mode_raw: number
  control_mode_valid?: boolean
  run_mode_raw: number
  run_mode_valid?: boolean
  remote_write_allowed: boolean
  quality_flags: number
  output_fault_flags: number
  controller_fault_flags: number
  controller_fault: ControllerFaultDiagnostic
  command_revision: number
  applied_revision: number
}

export interface Kz3Diagnostics {
  device?: DiagnosticEnvelope<DeviceDiagnostic>
  hardware?: DiagnosticEnvelope<HardwareDiagnostic>
  network?: DiagnosticEnvelope<NetworkDiagnostic>
  sle?: DiagnosticEnvelope<SleDiagnostic>
  io?: DiagnosticEnvelope<IoDiagnostic>
  config?: DiagnosticEnvelope<ConfigDiagnostic>
  services?: DiagnosticEnvelope<ServicesDiagnostic>
  health?: DiagnosticEnvelope<HealthDiagnostic>
}

export interface PointDescriptor extends NorthboundField {
  description: string
  unit?: string
  min?: number
  max?: number
  source?: string
  category: 'input' | 'output' | 'parameter' | 'command' | 'state' | 'unknown'
  valueSemantic: string
  writeSupported: boolean
  writeDisabledReason?: string
}

export interface PointSample {
  name: string
  value: Kz3Scalar
  quality: PointQuality
  receivedAt: number
  httpStatus: number
  elapsedMs: number
  localStale: boolean
  previousValue?: Kz3Scalar
  changedAt?: number
}

export interface DebugLogEntry {
  id: string
  timestamp: number
  level: 'info' | 'success' | 'warning' | 'error' | 'write'
  scope: 'session' | 'diagnostic' | 'point' | 'write'
  message: string
  detail?: string
}

export interface WriteEvent {
  id: string
  timestamp: number
  descriptor: PointDescriptor
  requestedValue: Kz3Scalar
  reason: string
  explicitConfirmation: boolean
  transportOk: boolean
  acceptedByOwner: boolean | null
  readbackObserved: ObservationState
  logicEffectObserved: ObservationState
  physicalEffectObserved: ObservationState
  httpStatus?: number
  errorCode?: string
  responseBody?: string
  beforeValue?: Kz3Scalar
  afterValue?: Kz3Scalar
  observationNote?: string
}

export interface DeviceDebugSession {
  sessionId: string
  startedAt: number
  endedAt?: number
  baseUrl: string
  expectedProjectId: string
  expectedProjectVersion: string
  expectedConfigHash?: string
  compatibilityState: CompatibilityState
  operatorName?: string
  siteName?: string
}

export interface DebugSessionReport {
  schema: 'kz3-debug-session/v1'
  exportedAt: number
  verificationBoundary: {
    desktopTool: 'verified'
    hardwareHil: 'deferred' | 'in_progress'
    fieldCommissioning: 'not_verified'
    note: string
  }
  project: {
    id: string
    name: string
    version: string
  }
  session: DeviceDebugSession | null
  transport: {
    state: DebugTransportState
    compatibility: CompatibilityState
    lastSuccessAt: number | null
    consecutiveErrors: number
  }
  diagnostics: Kz3Diagnostics
  monitoredPoints: string[]
  samples: PointSample[]
  logs: DebugLogEntry[]
  writeEvents: WriteEvent[]
}
