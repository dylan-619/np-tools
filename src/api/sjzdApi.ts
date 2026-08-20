import { invoke } from '@tauri-apps/api/core'
import type {
  ModbusPointConfig,
  DeviceInfoResult,
  SleFieldComparison,
  AiSampleDto,
} from '../types/sjzd'

export async function sjzdSendSn(path: string, sn: string): Promise<string> {
  return await invoke<string>('sjzd_send_sn', { path, sn })
}

export async function sjzdSendModbusPoints(
  path: string,
  points: ModbusPointConfig[]
): Promise<string> {
  return await invoke<string>('sjzd_send_modbus_points', { path, points })
}

export async function sjzdSendModbusDebug(
  path: string,
  addr: number,
  func: number,
  reg: number,
  length: number
): Promise<string> {
  return await invoke<string>('sjzd_send_modbus_debug', { path, addr, func, reg, length })
}

export async function sjzdSendSlePwr(path: string, level: number): Promise<string> {
  return await invoke<string>('sjzd_send_sle_pwr', { path, level })
}

export async function sjzdSendSleMaxPwr(path: string, level: number): Promise<string> {
  return await invoke<string>('sjzd_send_sle_maxpwr', { path, level })
}

export async function sjzdSendSleNetName(path: string, name: string): Promise<string> {
  return await invoke<string>('sjzd_send_sle_netname', { path, name })
}

export async function sjzdSendSleApid(path: string, apid: number): Promise<string> {
  return await invoke<string>('sjzd_send_sle_apid', { path, apid })
}

export async function sjzdSendWlanBridge(path: string, enable: boolean): Promise<string> {
  return await invoke<string>('sjzd_send_wlan_bridge', { path, enable })
}

export async function sjzdSendRawCommand(
  path: string,
  text: string,
  exactBytes: boolean = false
): Promise<string> {
  return await invoke<string>('sjzd_send_raw_command', { path, text, exactBytes })
}

export async function sjzdParseDevInfo(text: string): Promise<DeviceInfoResult> {
  return await invoke<DeviceInfoResult>('sjzd_parse_dev_info', { text })
}

export async function sjzdParseSleComparisons(text: string): Promise<SleFieldComparison[]> {
  return await invoke<SleFieldComparison[]>('sjzd_parse_sle_comparisons', { text })
}

export async function sjzdParseModbusPoints(text: string): Promise<ModbusPointConfig[]> {
  return await invoke<ModbusPointConfig[]>('sjzd_parse_modbus_points', { text })
}

export async function sjzdParseAiSample(
  text: string,
  timestampMs: number
): Promise<AiSampleDto | null> {
  return await invoke<AiSampleDto | null>('sjzd_parse_ai_sample', { text, timestampMs })
}

export async function appSaveFile(
  defaultName: string,
  content: string,
  filterName: string,
  filterExt: string
): Promise<string | null> {
  try {
    return await invoke<string | null>('app_save_file', {
      defaultName,
      content,
      filterName,
      filterExt,
    })
  } catch (err) {
    console.warn('Tauri app_save_file error, fallback to browser download:', err)
    return null
  }
}

export async function appOpenFile(
  filterName: string,
  filterExts: string[]
): Promise<{ path: string; content: string } | null> {
  try {
    const res = await invoke<[string, string] | null>('app_open_file', {
      filterName,
      filterExts,
    })
    if (res) {
      return { path: res[0], content: res[1] }
    }
    return null
  } catch (err) {
    console.warn('Tauri app_open_file error, fallback to browser file input:', err)
    return null
  }
}
