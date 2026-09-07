import { invoke, Channel } from '@tauri-apps/api/core'
import type {
  FlashImageInspection,
  FlashProductProfile,
  FlashProgressEvent,
  FlashTargetInfo,
  FlashToolInfo,
} from '../types/flash'

export async function flashProbeTool(customCli?: string): Promise<FlashToolInfo> {
  return await invoke<FlashToolInfo>('flash_probe_tool', { customCli })
}

export async function flashListProductProfiles(): Promise<FlashProductProfile[]> {
  return await invoke<FlashProductProfile[]>('flash_list_product_profiles')
}

export async function flashInspectImage(
  profileId: string,
  hexPath: string
): Promise<FlashImageInspection> {
  return await invoke<FlashImageInspection>('flash_inspect_image', { profileId, hexPath })
}

export async function flashProbeTarget(
  cliPath: string,
  profileId: string,
  probeSn?: string
): Promise<FlashTargetInfo> {
  return await invoke<FlashTargetInfo>('flash_probe_target', { cliPath, profileId, probeSn })
}

export async function flashStart(
  cliPath: string,
  profileId: string,
  hexPath: string,
  probeSn?: string,
  onProgress?: (event: FlashProgressEvent) => void
): Promise<void> {
  const channel = new Channel<FlashProgressEvent>()
  if (onProgress) {
    channel.onmessage = onProgress
  }
  return await invoke('flash_start', {
    cliPath,
    profileId,
    hexPath,
    probeSn,
    onProgress: channel,
  })
}

export async function flashCancel(): Promise<void> {
  return await invoke('flash_cancel')
}
