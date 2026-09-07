export type MqttConnectionState = 'disconnected' | 'connecting' | 'connected'
export type MqttLogDirection = 'rx' | 'tx' | 'system'
export type MqttLogLevel = 'info' | 'success' | 'warning' | 'error'

export interface MqttConnectionConfig {
  host: string
  port: number
  clientId: string
  username: string
  password: string
  keepAliveSec: number
  subscribeTopic: string
  subscribeQos: number
}

export interface MqttFrontendEvent {
  kind: 'connected' | 'disconnected' | 'reconnecting' | 'suback' | 'puback' | 'message'
  timestampMs: number
  message?: string
  topic?: string
  payloadText?: string
  payloadHex?: string
  payloadSize?: number
  qos?: number
  retain?: boolean
}

export interface MqttLogLine {
  id: string
  timestamp: string
  direction: MqttLogDirection
  level: MqttLogLevel
  text: string
  topic?: string
  payloadHex?: string
}
