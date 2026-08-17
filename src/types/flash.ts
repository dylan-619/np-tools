export interface StLinkProbe {
  index: number
  serialNumber: string
  description: string
}

export interface FlashToolInfo {
  cliPath?: string
  isAvailable: boolean
  version?: string
  probes: StLinkProbe[]
}

export interface FlashProgressEvent {
  state: 'idle' | 'probing' | 'connecting' | 'erasing' | 'programming' | 'verifying' | 'success' | 'error' | string
  percent: number
  message: string
  isTerminal: boolean
}
