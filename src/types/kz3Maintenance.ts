export type Kz3ConfigGroup = 'system' | 'ethernet' | 'sle' | 'io' | 'debug'

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

export type Kz3SystemRole = 'CONTROLLER' | 'RTU_SLAVE'
