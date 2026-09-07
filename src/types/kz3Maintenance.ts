export type Kz3ConfigGroup =
  | 'system'
  | 'ethernet'
  | 'sle'
  | 'wireless'
  | 'cat1'
  | 'io'
  | 'debug'

export type Kz3MaintenanceStatus =
  | 'disconnected'
  | 'connected'
  | 'querying'
  | 'writing'
  | 'waiting_reboot'
  | 'error'

export interface Kz3ProtocolEnvelope {
  ok: boolean
  family: string
  fields: Record<string, string>
  raw: string
}

export interface Kz3Snapshot {
  group: Kz3ConfigGroup
  fields: Record<string, string>
  raw: string
  receivedAt: string
  port: string
}

export interface Kz3CommandResult {
  command: string
  group: Kz3ConfigGroup
  status: 'ok' | 'device_error' | 'timeout' | 'communication_error'
  protocolLine: string
  rawLines: string[]
  startedAt: string
  completedAt: string
  error?: string
}

export interface Kz3SessionRecord extends Kz3CommandResult {
  id: string
  operation: 'query' | 'write' | 'follow_up_query'
  port: string
}

/** 串口确认保存地址后，对单一已知 HTTP 地址的受控复连审计。 */
export interface Kz3NetworkRecoveryAttempt {
  id: string
  candidateUrl: string
  startedAt: string
  completedAt?: string
  status:
    | 'prepared'
    | 'http_reachable'
    | 'http_reachable_read_only'
    | 'http_reachable_matched'
    | 'http_reachable_partial'
    | 'http_reachable_mismatch'
    | 'failed'
  error?: string
}

export interface Kz3EthernetCandidate {
  ip: string
  mask: string
  gateway: string
  port: string
}

export interface Kz3SleCandidate {
  address: string
  name: string
  apid: string
  power: string
  maxPower: string
  mode: string
}

export interface Kz3WirelessCandidate {
  mode: 'SLE' | 'CAT1'
  reportSeconds: string
}

export interface Kz3Cat1Candidate {
  apn: string
  host: string
  port: string
  /** 已保存配置不会回显用户名；留空表示分项写入时保持设备现值。 */
  username: string
  /** 密码永不从设备读回；留空表示分项写入时保持设备现值。 */
  password: string
  topic: string
  keepalive: string
  qos: string
}

export type Kz3SystemRole = 'CONTROLLER' | 'RTU_SLAVE'
