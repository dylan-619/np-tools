export const XTQ_OWNERS = [
  'DeviceIdentity',
  'CoordinatorConfig',
  'Radio1Config',
  'Radio2Config',
  'EthernetConfig'
] as const

export type XtqOwner = (typeof XTQ_OWNERS)[number]

export const XTQ_CAPABILITY_SLOT_COUNT = 32

export interface XtqCapabilityDisabled {
  enabled: false
}

export interface XtqCapabilityEnabled {
  enabled: true
  sn: string
  reported_app_addr: number
  radio_dest_addr: number
  downlink_codec: number
  ack_codec: number
  radio_addr_source: number
}

export type XtqCapabilityValue = XtqCapabilityDisabled | XtqCapabilityEnabled

export interface XtqCapabilitySnapshot {
  slot: number
  owner: string
  value: XtqCapabilityValue
  raw: string
  receivedAt: string
  port: string
}

export interface XtqSyncUploadSummary {
  uploadedAt: string
  canonicalJson: string
  byteLength: number
  crc32: string
  ruleCount: number
  mappingCount: number
  sequenceBefore: number | null
  sequenceAfter: number | null
  deviceJsonLength: number | null
  deviceRuleCount: number | null
  /** @STATUS 摘要只能核对长度和规则数，不能证明 Flash 中的完整内容一致。 */
  summaryMatched: boolean
  contentVerified: false
  verificationMessage: string
}

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

/** 单次 `@STATUS` 成功解析后的会话内采样；仅保存在当前工具会话和诊断导出文件中。 */
export interface XtqStatusSample {
  capturedAt: string
  port: string
  status: XtqCoordinatorStatus
}

/** 与前一次有效采样相比的受控字段差异，不把未知固件字段伪装成已解释的诊断结论。 */
export interface XtqStatusDifference {
  path: string
  label: string
  before: string | number | null
  after: string | number | null
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
  operation:
    | 'status'
    | 'read'
    | 'write'
    | 'capability_read'
    | 'capability_write'
    | 'sync_upload'
  command: string
  response: string
  status: 'ok' | 'device_error' | 'timeout' | 'communication_error'
  startedAt: string
  completedAt: string
  port: string
  error?: string
}
