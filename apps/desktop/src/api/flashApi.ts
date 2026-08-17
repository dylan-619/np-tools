import { invoke, Channel } from '@tauri-apps/api/core'
import type { FlashToolInfo, FlashProgressEvent } from '../types/flash'

export async function flashProbeTool(customCli?: string): Promise<FlashToolInfo> {
  return await invoke<FlashToolInfo>('flash_probe_tool', { customCli })
}

export async function flashStart(
  cliPath: string,
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
    hexPath,
    probeSn,
    onProgress: channel,
  })
}

export async function flashCancel(): Promise<void> {
  return await invoke('flash_cancel')
}
