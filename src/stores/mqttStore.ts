import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { mqttConnect, mqttDisconnect, mqttPublish, mqttSubscribe } from '../api/mqttApi'
import type {
  MqttConnectionConfig,
  MqttConnectionState,
  MqttFrontendEvent,
  MqttLogDirection,
  MqttLogLevel,
  MqttLogLine,
} from '../types/mqtt'
import {
  validateBrokerHost,
  validateClientId,
  validateMqttQos,
  validateMqttTopic,
  validatePayload,
  validateKz3DownlinkEnvelope,
} from '../utils/mqttValidation'

const MQTT_CONFIG_STORAGE_KEY = 'np_tools_mqtt_config'
const MAX_LOGS = 5000
const KZ3_BOOT_ID_FRESHNESS_MS = 30_000

function createClientId(): string {
  return `np-tools-mqtt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function defaultConfig(): MqttConnectionConfig {
  return {
    host: '',
    port: 1883,
    clientId: createClientId(),
    username: '',
    password: '',
    keepAliveSec: 60,
    subscribeTopic: '',
    subscribeQos: 1,
  }
}

function loadConfig(): MqttConnectionConfig {
  const defaults = defaultConfig()
  if (typeof localStorage === 'undefined') return defaults
  try {
    const stored = JSON.parse(localStorage.getItem(MQTT_CONFIG_STORAGE_KEY) || '{}')
    // 密码仅保留在本次内存会话，绝不写入本地存储或普通日志。
    return { ...defaults, ...stored, password: '' }
  } catch {
    return defaults
  }
}

function timeString(timestampMs = Date.now()): string {
  const date = new Date(timestampMs)
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}.${date
    .getMilliseconds()
    .toString()
    .padStart(3, '0')}`
}

export const useMqttStore = defineStore('mqtt', () => {
  const config = ref<MqttConnectionConfig>(loadConfig())
  const connectionState = ref<MqttConnectionState>('disconnected')
  const busy = ref(false)
  const publishing = ref(false)
  const errorMsg = ref('')
  const logs = ref<MqttLogLine[]>([])
  const rxMessages = ref(0)
  const txMessages = ref(0)
  const rxBytes = ref(0)
  const txBytes = ref(0)
  const latestBootId = ref<number | null>(null)
  const latestBootIdAt = ref<number | null>(null)
  let publishAckTimer: number | null = null

  const connected = computed(() => connectionState.value === 'connected')

  function appendLog(
    direction: MqttLogDirection,
    text: string,
    level: MqttLogLevel = 'info',
    extra: Pick<MqttLogLine, 'topic' | 'payloadHex'> = {}
  ) {
    logs.value.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: timeString(),
      direction,
      level,
      text,
      ...extra,
    })
    if (logs.value.length > MAX_LOGS) logs.value.splice(0, logs.value.length - MAX_LOGS)
  }

  function validateConnection(): string | undefined {
    return (
      validateBrokerHost(config.value.host) ||
      validateClientId(config.value.clientId) ||
      (config.value.port >= 1 && config.value.port <= 65535
        ? undefined
        : 'Broker 端口必须在 1～65535 范围内') ||
      (config.value.keepAliveSec >= 1 && config.value.keepAliveSec <= 65535
        ? undefined
        : 'Keep Alive 必须在 1～65535 秒范围内') ||
      validateMqttQos(config.value.subscribeQos) ||
      (config.value.subscribeTopic.trim()
        ? validateMqttTopic(config.value.subscribeTopic, true)
        : undefined)
    )
  }

  function handleEvent(event: MqttFrontendEvent) {
    switch (event.kind) {
      case 'connected':
        connectionState.value = 'connected'
        appendLog('system', event.message || '已连接到 Broker', 'success')
        break
      case 'suback':
        appendLog('system', event.message || 'Broker 已确认订阅 (SUBACK)', 'success')
        break
      case 'puback':
        if (publishAckTimer) {
          clearTimeout(publishAckTimer)
          publishAckTimer = null
        }
        publishing.value = false
        appendLog('system', event.message || 'Broker 已确认发布 (PUBACK)', 'success')
        break
      case 'message': {
        const payload = event.payloadText || ''
        const bootId = extractKz3BootId(payload)
        if (bootId !== undefined) {
          latestBootId.value = bootId
          latestBootIdAt.value = event.timestampMs || Date.now()
        }
        rxMessages.value += 1
        rxBytes.value += event.payloadSize || 0
        appendLog(
          'rx',
          `topic=${event.topic || ''} | QoS ${event.qos ?? 0} | Retain=${event.retain ? '1' : '0'}\n${payload}`,
          'info',
          { topic: event.topic, payloadHex: event.payloadHex }
        )
        break
      }
      case 'reconnecting':
        connectionState.value = 'connecting'
        if (publishAckTimer) {
          clearTimeout(publishAckTimer)
          publishAckTimer = null
        }
        publishing.value = false
        appendLog('system', event.message || 'MQTT 通信中断，正在重连', 'warning')
        break
      case 'disconnected':
        connectionState.value = 'disconnected'
        if (publishAckTimer) {
          clearTimeout(publishAckTimer)
          publishAckTimer = null
        }
        publishing.value = false
        appendLog('system', event.message || '已断开 MQTT 连接', 'info')
        break
    }
  }

  function persistConfig() {
    if (typeof localStorage === 'undefined') return
    const { password: _password, ...persisted } = config.value
    localStorage.setItem(MQTT_CONFIG_STORAGE_KEY, JSON.stringify(persisted))
  }

  async function connect() {
    const validationError = validateConnection()
    if (validationError) {
      errorMsg.value = validationError
      return
    }
    busy.value = true
    errorMsg.value = ''
    connectionState.value = 'connecting'
    logs.value = []
    rxMessages.value = 0
    txMessages.value = 0
    rxBytes.value = 0
    txBytes.value = 0
    appendLog('system', `正在连接 ${config.value.host.trim()}:${config.value.port}…`, 'info')
    try {
      await mqttConnect(config.value, handleEvent)
      persistConfig()
    } catch (error: unknown) {
      const detail = String(error)
      connectionState.value = 'disconnected'
      errorMsg.value = `连接 MQTT 失败: ${detail}`
      appendLog('system', errorMsg.value, 'error')
    } finally {
      busy.value = false
    }
  }

  async function disconnect() {
    busy.value = true
    errorMsg.value = ''
    try {
      await mqttDisconnect()
      connectionState.value = 'disconnected'
      if (publishAckTimer) {
        clearTimeout(publishAckTimer)
        publishAckTimer = null
      }
      publishing.value = false
    } catch (error: unknown) {
      errorMsg.value = `断开 MQTT 失败: ${String(error)}`
      appendLog('system', errorMsg.value, 'error')
    } finally {
      busy.value = false
    }
  }

  async function applySubscription() {
    const topic = config.value.subscribeTopic.trim()
    const validationError = validateMqttTopic(topic, true) || validateMqttQos(config.value.subscribeQos)
    if (validationError) {
      errorMsg.value = validationError
      return
    }
    busy.value = true
    errorMsg.value = ''
    try {
      await mqttSubscribe(topic, config.value.subscribeQos)
      persistConfig()
      appendLog('system', `已发起订阅：${topic}，等待 SUBACK`, 'info')
    } catch (error: unknown) {
      errorMsg.value = `订阅失败: ${String(error)}`
      appendLog('system', errorMsg.value, 'error')
    } finally {
      busy.value = false
    }
  }

  function getFreshKz3BootId(): number | undefined {
    if (
      latestBootId.value === null ||
      latestBootIdAt.value === null ||
      Date.now() - latestBootIdAt.value > KZ3_BOOT_ID_FRESHNESS_MS
    ) {
      return undefined
    }
    return latestBootId.value
  }

  async function publish(topic: string, payload: string, qos: number, expectedKz3BootId?: number) {
    const normalizedTopic = topic.trim()
    const validationError =
      validateMqttTopic(normalizedTopic, false) ||
      validateMqttQos(qos) ||
      validatePayload(payload) ||
      validateKz3DownlinkEnvelope(payload, expectedKz3BootId)
    if (validationError) {
      errorMsg.value = validationError
      return false
    }
    if (!connected.value) {
      errorMsg.value = 'MQTT 尚未连接，不能发布消息'
      return false
    }
    publishing.value = qos > 0
    errorMsg.value = ''
    try {
      await mqttPublish(normalizedTopic, payload, qos)
      txMessages.value += 1
      txBytes.value += new TextEncoder().encode(payload).byteLength
      appendLog('tx', `topic=${normalizedTopic} | QoS ${qos} | Retain=0\n${payload}`, 'info', {
        topic: normalizedTopic,
      })
      if (qos === 0) {
        appendLog('system', 'QoS 0 不返回 PUBACK；消息已交给本地 MQTT 客户端处理', 'warning')
      } else {
        if (publishAckTimer) clearTimeout(publishAckTimer)
        publishAckTimer = window.setTimeout(() => {
          publishAckTimer = null
          publishing.value = false
          appendLog('system', '等待 Broker PUBACK 超时，发布结果未知；工具没有自动重试', 'warning')
        }, 10_000)
      }
      return true
    } catch (error: unknown) {
      publishing.value = false
      errorMsg.value = `发布失败: ${String(error)}`
      appendLog('system', errorMsg.value, 'error')
      return false
    }
  }

  function clearLogs() {
    logs.value = []
  }

  return {
    config,
    connectionState,
    busy,
    publishing,
    connected,
    errorMsg,
    logs,
    rxMessages,
    txMessages,
    rxBytes,
    txBytes,
    latestBootId,
    latestBootIdAt,
    getFreshKz3BootId,
    connect,
    disconnect,
    applySubscription,
    publish,
    clearLogs,
  }
})

function extractKz3BootId(payload: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (!isRecord(parsed) || !isRecord(parsed._meta)) return undefined
    const bootId = parsed._meta.boot_id
    return typeof bootId === 'number' && Number.isInteger(bootId) && bootId > 0 && bootId <= 0xffffffff
      ? bootId
      : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
