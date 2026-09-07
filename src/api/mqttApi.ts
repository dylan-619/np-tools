import { Channel, invoke } from '@tauri-apps/api/core'
import type { MqttConnectionConfig, MqttFrontendEvent } from '../types/mqtt'

export async function mqttConnect(
  config: MqttConnectionConfig,
  onEvent: (event: MqttFrontendEvent) => void
): Promise<void> {
  const channel = new Channel<MqttFrontendEvent>()
  channel.onmessage = onEvent
  return await invoke('mqtt_connect', { config, onEvent: channel })
}

export async function mqttDisconnect(): Promise<void> {
  return await invoke('mqtt_disconnect')
}

export async function mqttSubscribe(topic: string, qos: number): Promise<void> {
  return await invoke('mqtt_subscribe', { topic, qos })
}

export async function mqttPublish(topic: string, payload: string, qos: number): Promise<void> {
  return await invoke('mqtt_publish', { topic, payload, qos })
}
