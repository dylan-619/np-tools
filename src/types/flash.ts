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

export interface FlashProductProfile {
  id: string
  label: string
  mcu: string
  imageKind: string
  flashStart: number
  flashEndExclusive: number
  expectedDeviceId: number
  requiresXtqManifest: boolean
  supportsSjzdSnPipeline: boolean
  safetyNote: string
}

export interface FlashImageInspection {
  profileId: string
  filePath: string
  fileSha256: string
  addressStart: number
  addressEndInclusive: number
  dataRecordCount: number
  dataByteCount: number
  manifestTargetId?: number
  manifestImageSize?: number
  validated: boolean
  message: string
}

export interface FlashTargetInfo {
  profileId: string
  deviceId?: number
  deviceName?: string
  isCompatible: boolean
  message: string
}

export interface FlashProgressEvent {
  state: 'idle' | 'probing' | 'connecting' | 'erasing' | 'programming' | 'verifying' | 'success' | 'error' | string
  percent: number
  message: string
  isTerminal: boolean
}

export interface FlashLogEntry {
  id: number
  time: string
  text: string
  type: 'info' | 'success' | 'warn' | 'error' | 'header' | 'cmd'
}
