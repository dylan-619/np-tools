export const XTQ_OWNERS = [
  'DeviceIdentity',
  'CoordinatorConfig',
  'Radio1Config',
  'Radio2Config',
  'EthernetConfig'
] as const

export type XtqOwner = (typeof XTQ_OWNERS)[number]

export type XtqSessionState =
  'disconnected' | 'connected' | 'querying' | 'writing' | 'waiting_reboot' | 'error'

export interface XtqRadioStatus {
  role: number
  state: number
  ready: number
  sta: number
  address: number
  recoveries: number
  valid_frames: number
  uart_errors: number
  rx_restarts: number
  invalid_frames: number
  dropped_bytes: number
}

export interface XtqCoordinatorStatus {
  target: string
  firmware: string
  router_sn: string | null
  mode: number
  uptime_ms: number
  boot_id: number
  reset_cause: number
  config_errors: number
  phy_result: number
  phy_id: number
  radios: XtqRadioStatus[]
  routing: { neighbors: number; routes: number; conflicts: number; dropped: number }
  points: { used: number; updates: number; evictions: number }
  sync: {
    sequence: number
    json_length: number
    rules: number
    runs: number
    source_missing: number
    target_failures: number
  }
  network: {
    ready: number
    state: number
    queued: number
    sent: number
    received: number
    dropped: number
    protocol_errors: number
  }
  capabilities: number
  provisioning_timeouts: number
  [key: string]: unknown
}

export interface XtqSnapshot {
  owner: XtqOwner
  value: Record<string, unknown>
  raw: string
  receivedAt: string
  port: string
}

export interface XtqTransactionRecord {
  id: string
  operation: 'status' | 'read' | 'write'
  command: string
  response: string
  status: 'ok' | 'device_error' | 'timeout' | 'communication_error'
  startedAt: string
  completedAt: string
  port: string
  error?: string
}
