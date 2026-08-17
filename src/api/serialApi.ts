import { invoke, Channel } from '@tauri-apps/api/core'
import type { SerialPortDescriptor, SerialOpenConfig, IoChunk } from '../types/serial'

export async function listPorts(): Promise<SerialPortDescriptor[]> {
  try {
    return await invoke<SerialPortDescriptor[]>('serial_list_ports')
  } catch (error) {
    console.error('Failed to list serial ports:', error)
    throw error
  }
}

export async function openPort(
  config: SerialOpenConfig,
  onData: (chunks: IoChunk[]) => void
): Promise<void> {
  const channel = new Channel<IoChunk[]>()
  channel.onmessage = onData
  return await invoke('serial_open', { config, onData: channel })
}

export async function closePort(path: string): Promise<void> {
  return await invoke('serial_close', { path })
}

export async function writePort(path: string, data: number[]): Promise<void> {
  return await invoke('serial_write', { path, data })
}

export async function setDtr(path: string, level: boolean): Promise<void> {
  return await invoke('serial_set_dtr', { path, level })
}

export async function setRts(path: string, level: boolean): Promise<void> {
  return await invoke('serial_set_rts', { path, level })
}

export async function startRecording(path: string, filePath: string): Promise<void> {
  return await invoke('serial_start_recording', { path, filePath })
}

export async function stopRecording(path: string): Promise<void> {
  return await invoke('serial_stop_recording', { path })
}
