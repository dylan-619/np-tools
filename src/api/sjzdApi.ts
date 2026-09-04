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

export async function sjzdQueryWlanType(path: string): Promise<string> {
  return await sjzdSendRawCommand(path, 'WLAN_TYPE:LIST', false)
}

export async function sjzdSendWirelessType(path: string, mode: 'SLE' | '4G'): Promise<string> {
  return await sjzdSendRawCommand(path, `WLAN_TYPE:${mode}`, false)
}

export async function sjzdQueryFourGConfig(path: string): Promise<string> {
  return await sjzdSendRawCommand(path, '4G:LIST', false)
}

export async function sjzdReconnectFourG(path: string): Promise<string> {
  return await sjzdSendRawCommand(path, '4G:RECONNECT', false)
}

export async function sjzdResetFourGConfig(path: string): Promise<string> {
  return await sjzdSendRawCommand(path, '4G:RESET_CONFIG', false)
}

export async function sjzdSendFourGApn(path: string, apn: string): Promise<string> {
  return await sjzdSendRawCommand(path, `4G_APN:${apn}`, false)
}

export async function sjzdSendMqttHost(path: string, host: string): Promise<string> {
  return await sjzdSendRawCommand(path, `MQTT_HOST:${host}`, false)
}

export async function sjzdSendMqttPort(path: string, port: number): Promise<string> {
  return await sjzdSendRawCommand(path, `MQTT_PORT:${port}`, false)
}

export async function sjzdSendMqttClientId(path: string, clientId: string): Promise<string> {
  return await sjzdSendRawCommand(path, `MQTT_CLIENT:${clientId}`, false)
}

export async function sjzdSendMqttUser(path: string, user: string): Promise<string> {
  return await sjzdSendRawCommand(path, `MQTT_USER:${user}`, false)
}

export async function sjzdSendMqttPass(path: string, pass: string): Promise<string> {
  return await sjzdSendRawCommand(path, `MQTT_PASS:${pass}`, false)
}

export async function sjzdSendMqttPubTopic(path: string, topic: string): Promise<string> {
  return await sjzdSendRawCommand(path, `MQTT_PUB_TOPIC:${topic}`, false)
}

export async function sjzdSendMqttSubTopic(path: string, topic: string): Promise<string> {
  return await sjzdSendRawCommand(path, `MQTT_SUB_TOPIC:${topic}`, false)
}

export async function sjzdSendMqttKeepalive(path: string, keepalive: number): Promise<string> {
  return await sjzdSendRawCommand(path, `MQTT_KEEPALIVE:${keepalive}`, false)
}

export async function sjzdSendMqttQos(path: string, qos: number): Promise<string> {
  return await sjzdSendRawCommand(path, `MQTT_QOS:${qos}`, false)
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
