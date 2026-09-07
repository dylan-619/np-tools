import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  listPorts,
  openPort,
  closePort,
  writePort,
  setDtr,
  setRts,
  stopRecording,
} from '../api/serialApi'
import type {
  SerialPortDescriptor,
  SerialOpenConfig,
  TerminalLogLine,
  IoChunk,
} from '../types/serial'
import { formatSerialConfig } from '../utils/serialFormat'

/**
 * UART 是公共日志面板，不能因为 KZ3 Cat.1 配置而把凭证写入内存日志、
 * 录制导出或屏幕。实际发送字节保持原样，只有回显文本被脱敏。
 */
function redactSensitiveTxText(text: string): string {
  const normalized = text.trim()
  const parts = normalized.split(',')
  if (parts[0] !== '@CFG' || parts[1] !== '4G') return text
  if (parts[2] === 'INIT' && parts.length === 11) {
    parts[6] = '***'
    parts[7] = '***'
    return parts.join(',')
  }
  if ((parts[2] === 'USER' || parts[2] === 'PASS') && parts.length === 4) {
    parts[3] = '***'
    return parts.join(',')
  }
  return text
}

const SERIAL_CONFIG_STORAGE_KEY = 'np_tools_serial_config'

const DEFAULT_SERIAL_CONFIG: SerialOpenConfig = {
  path: '',
  baudRate: 115200,
  dataBits: 'eight',
  stopBits: 'one',
  parity: 'none',
  flowControl: 'none',
}

interface SerialConnectOptions {
  /** 仅供受控重启恢复使用，保留既有会话日志与流量计数。 */
  preserveSession?: boolean
}

function loadPersistedSerialConfig(): SerialOpenConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SERIAL_CONFIG }
  try {
    const stored = JSON.parse(localStorage.getItem(SERIAL_CONFIG_STORAGE_KEY) || '{}')
    return { ...DEFAULT_SERIAL_CONFIG, ...stored, path: '' }
  } catch {
    return { ...DEFAULT_SERIAL_CONFIG }
  }
}

export const useSerialStore = defineStore('serial', () => {
  const ports = ref<SerialPortDescriptor[]>([])
  const loading = ref(false)
  const errorMsg = ref('')

  const selectedPort = ref('')
  const connectedPort = ref<string | null>(null)
  const logs = ref<TerminalLogLine[]>([])
  const rxBytes = ref(0)
  const txBytes = ref(0)

  const dtrState = ref(false)
  const rtsState = ref(false)
  const isRecording = ref(false)

  const config = ref<SerialOpenConfig>(loadPersistedSerialConfig())

  // Decoder & buffer
  const decoder = new TextDecoder()
  let lineBuffer = ''
  const lineListeners = new Map<string, (line: string) => void>()

  function registerLineListener(id: string, listener: (line: string) => void) {
    lineListeners.set(id, listener)
  }

  function unregisterLineListener(id: string) {
    lineListeners.delete(id)
  }

  function getTimeString(): string {
    const d = new Date()
    return `${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d
      .getMilliseconds()
      .toString()
      .padStart(3, '0')}`
  }

  function cleanAnsiText(raw: string): string {
    if (!raw) return ''
    return raw
      // Strip ANSI escape sequences like \x1b[0;32m or \x1b[0m
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      // Strip non-printable control characters except \t
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim()
  }

  function parseLogLevel(text: string): 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'RAW' {
    const upper = text.toUpperCase()
    if (
      upper.includes('[ERROR]') ||
      upper.includes('ERROR:') ||
      upper.includes('ERR:') ||
      upper.includes('DBGE') ||
      upper.includes('FAILED')
    ) {
      return 'ERROR'
    }
    if (
      upper.includes('[WARN]') ||
      upper.includes('WARN:') ||
      upper.includes('WARNING') ||
      upper.includes('DBGW')
    ) {
      return 'WARN'
    }
    if (
      upper.includes('[INFO]') ||
      upper.includes('INFO:') ||
      upper.includes('DEVINFO') ||
      upper.includes('DEVINFO:') ||
      upper.includes('DBGI')
    ) {
      return 'INFO'
    }
    if (upper.includes('[DEBUG]') || upper.includes('DEBUG:') || upper.includes('DBG')) {
      return 'DEBUG'
    }
    return 'RAW'
  }

  function appendLog(direction: 'rx' | 'tx', text: string) {
    const timeStr = getTimeString()
    const cleanedText = direction === 'rx' ? cleanAnsiText(text) : text
    if (!cleanedText) return

    const logItem: TerminalLogLine = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      direction,
      text: cleanedText,
      timestamp: timeStr,
      level: parseLogLevel(cleanedText),
    }

    logs.value.push(logItem)
    if (logs.value.length > 5000) {
      logs.value.splice(0, logs.value.length - 5000)
    }
  }

  let flushTimer: number | null = null
  function flushLineBuffer() {
    const cleaned = cleanAnsiText(lineBuffer)
    if (cleaned) {
      appendLog('rx', cleaned)
      for (const listener of lineListeners.values()) {
        try {
          listener(cleaned)
        } catch (e) {
          console.error('Line listener error:', e)
        }
      }
    }
    lineBuffer = ''
  }

  async function refreshPorts() {
    loading.value = true
    errorMsg.value = ''
    try {
      ports.value = await listPorts()
      if (ports.value.length > 0 && !selectedPort.value) {
        selectedPort.value = ports.value[0].portName
      } else if (ports.value.length === 0) {
        selectedPort.value = ''
      }
    } catch (err: any) {
      errorMsg.value = `扫描串口失败: ${String(err)}`
    } finally {
      loading.value = false
    }
  }

  async function connect(portName?: string, options: SerialConnectOptions = {}) {
    const target = portName || selectedPort.value
    if (!target) return

    errorMsg.value = ''
    loading.value = true
    try {
      config.value.path = target
      await openPort(
        {
          path: target,
          baudRate: config.value.baudRate,
          dataBits: config.value.dataBits,
          stopBits: config.value.stopBits,
          parity: config.value.parity,
          flowControl: config.value.flowControl,
        },
        (chunks: IoChunk[]) => {
          let chunkText = ''
          for (const chunk of chunks) {
            rxBytes.value += chunk.payload.length
            const text = decoder.decode(new Uint8Array(chunk.payload), { stream: true })
            if (text) {
              chunkText += text
            }
          }

          if (chunkText) {
            lineBuffer += chunkText
            if (flushTimer) clearTimeout(flushTimer)

            const lines = lineBuffer.split('\n')
            if (lines.length > 1) {
              lineBuffer = lines.pop() || ''
              for (const line of lines) {
                const cleaned = cleanAnsiText(line)
                if (cleaned) {
                  appendLog('rx', cleaned)
                  // Broadcast to registered component listeners
                  for (const listener of lineListeners.values()) {
                    try {
                      listener(cleaned)
                    } catch (e) {
                      console.error('Line listener error:', e)
                    }
                  }
                }
              }
            }

            // Residual non-newline prompt handling
            if (lineBuffer.length > 0) {
              if (lineBuffer.length > 1024) {
                flushLineBuffer()
              } else {
                flushTimer = window.setTimeout(flushLineBuffer, 80)
              }
            }
          }
        }
      )
      connectedPort.value = target
      lineBuffer = ''
      if (!options.preserveSession) {
        logs.value = []
        rxBytes.value = 0
        txBytes.value = 0
      }
      appendLog(
        'rx',
        `=== ${options.preserveSession ? '已恢复打开' : '已成功打开'}串口 ${target} (${formatSerialConfig(config.value)}) ===`
      )
    } catch (err: any) {
      errorMsg.value = `打开串口失败: ${String(err)}`
      connectedPort.value = null
      throw err
    } finally {
      loading.value = false
    }
  }

  async function disconnect() {
    if (!connectedPort.value) return
    const target = connectedPort.value
    errorMsg.value = ''
    let recordingError = ''
    try {
      if (isRecording.value) {
        try {
          await stopRecording(target)
        } catch (err: any) {
          recordingError = `停止录制失败: ${String(err)}`
        }
        isRecording.value = false
      }
      await closePort(target)
      appendLog('rx', `=== 已关闭串口 ${target} ===`)
      connectedPort.value = null
      if (recordingError) errorMsg.value = `${recordingError}；串口已继续关闭`
    } catch (err: any) {
      errorMsg.value = `关闭串口失败: ${String(err)}`
    }
  }

  async function toggleConnection() {
    if (connectedPort.value) {
      await disconnect()
    } else {
      await connect()
    }
  }

  async function sendRaw(
    text: string,
    options: {
      isHex?: boolean
      addCR?: boolean
      addLF?: boolean
      exactBytes?: boolean
      logText?: string
    } = {}
  ): Promise<void> {
    if (!connectedPort.value || !text) return

    let payload: number[] = []
    let echoText = text

    if (options.isHex) {
      const hexStr = text.replace(/\s/g, '')
      for (let i = 0; i < hexStr.length; i += 2) {
        payload.push(parseInt(hexStr.substring(i, i + 2), 16))
      }
      echoText = payload.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    } else {
      let str = text
      if (!options.exactBytes) {
        if (options.addCR ?? true) str += '\r'
        if (options.addLF ?? true) str += '\n'
      }
      payload = Array.from(new TextEncoder().encode(str))
      echoText = text.replace(/\r?\n$/, '')
    }

    if (options.logText !== undefined) echoText = options.logText

    try {
      await writePort(connectedPort.value, payload)
      txBytes.value += payload.length
      appendLog('tx', redactSensitiveTxText(echoText))
    } catch (err: any) {
      const detail = String(err)
      errorMsg.value = `发送失败: ${detail}`
      if (/已断开|未连接|后台任务已退出|串口(?:读取|写入)失败|设备可能已断开|channel closed/i.test(detail)) {
        appendLog('rx', `=== 串口连接已失效：${detail} ===`)
        connectedPort.value = null
        isRecording.value = false
      }
      throw err
    }
  }

  async function toggleDtr() {
    if (!connectedPort.value) return
    try {
      dtrState.value = !dtrState.value
      await setDtr(connectedPort.value, dtrState.value)
    } catch (err: any) {
      dtrState.value = !dtrState.value
      errorMsg.value = `切换 DTR 失败: ${String(err)}`
    }
  }

  async function toggleRts() {
    if (!connectedPort.value) return
    try {
      rtsState.value = !rtsState.value
      await setRts(connectedPort.value, rtsState.value)
    } catch (err: any) {
      rtsState.value = !rtsState.value
      errorMsg.value = `切换 RTS 失败: ${String(err)}`
    }
  }

  function clearLogs() {
    logs.value = []
  }

  function persistConfig() {
    if (typeof localStorage === 'undefined') return
    const { baudRate, dataBits, stopBits, parity, flowControl } = config.value
    localStorage.setItem(
      SERIAL_CONFIG_STORAGE_KEY,
      JSON.stringify({ baudRate, dataBits, stopBits, parity, flowControl })
    )
  }

  return {
    ports,
    loading,
    errorMsg,
    selectedPort,
    connectedPort,
    logs,
    rxBytes,
    txBytes,
    dtrState,
    rtsState,
    isRecording,
    config,
    refreshPorts,
    connect,
    disconnect,
    toggleConnection,
    sendRaw,
    toggleDtr,
    toggleRts,
    clearLogs,
    persistConfig,
    registerLineListener,
    unregisterLineListener,
  }
})
