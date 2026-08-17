export interface SerialPortDescriptor {
  portName: string
  productName?: string
  manufacturer?: string
  vid?: number
  pid?: number
}

export interface SerialOpenConfig {
  path: string
  baudRate: number
  dataBits: string
  stopBits: string
  parity: string
  flowControl: string
}

export interface IoChunk {
  id: string
  direction: 'rx' | 'tx'
  timestampUs: number
  payload: number[]
}

export interface TerminalLogLine {
  id: string
  direction: 'rx' | 'tx'
  text: string
  timestamp: string
  level?: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'RAW'
}
