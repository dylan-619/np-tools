import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useSerialStore } from './serialStore'
import type {
  XtqCoordinatorStatus,
  XtqOwner,
  XtqSessionState,
  XtqSnapshot,
  XtqTransactionRecord
} from '../types/xtqCoordinator'
import { XTQ_OWNERS } from '../types/xtqCoordinator'
import {
  buildSetCommand,
  parseOkJson,
  parseStatus,
  XTQ_UART_CONFIG
} from '../utils/xtqCoordinatorProtocol'

const LISTENER_ID = 'xtq-coordinator'

interface PendingTransaction {
  command: string
  operation: XtqTransactionRecord['operation']
  owner?: XtqOwner
  response: string
  startedAt: string
  port: string
  resolve: (record: XtqTransactionRecord) => void
  timer: number
}

export const useXtqCoordinatorStore = defineStore('xtqCoordinator', () => {
  const serial = useSerialStore()
  const state = ref<XtqSessionState>('disconnected')
  const status = ref<XtqCoordinatorStatus | null>(null)
  const previousStatus = ref<XtqCoordinatorStatus | null>(null)
  const snapshots = ref<Partial<Record<XtqOwner, XtqSnapshot>>>({})
  const records = ref<XtqTransactionRecord[]>([])
  const currentCommand = ref('')
  const lastError = ref('')
  const polling = ref(false)
  const initialized = ref(false)
  let pending: PendingTransaction | null = null
  let pollTimer: number | null = null

  const isBusy = computed(() => state.value === 'querying' || state.value === 'writing')
  const serialConfigMatches = computed(
    () =>
      serial.config.baudRate === XTQ_UART_CONFIG.baudRate &&
      serial.config.dataBits === XTQ_UART_CONFIG.dataBits &&
      serial.config.stopBits === XTQ_UART_CONFIG.stopBits &&
      serial.config.parity === XTQ_UART_CONFIG.parity &&
      serial.config.flowControl === XTQ_UART_CONFIG.flowControl
  )
  const identified = computed(() => Boolean(status.value))

  function appendRecord(record: XtqTransactionRecord) {
    records.value.push(record)
    if (records.value.length > 500) records.value.splice(0, records.value.length - 500)
  }

  function finishPending(
    resultStatus: XtqTransactionRecord['status'],
    response = '',
    error?: string
  ) {
    if (!pending) return
    const transaction = pending
    pending = null
    window.clearTimeout(transaction.timer)
    currentCommand.value = ''
    const record: XtqTransactionRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operation: transaction.operation,
      command: transaction.command,
      response: response || transaction.response,
      status: resultStatus,
      startedAt: transaction.startedAt,
      completedAt: new Date().toISOString(),
      port: transaction.port,
      error
    }
    appendRecord(record)
    transaction.resolve(record)
  }

  function handleLine(line: string) {
    if (!pending) return
    const trimmed = line.trim()
    if (trimmed.startsWith('OK ') || trimmed === 'OK' || trimmed === 'OK_REBOOTING') {
      pending.response = trimmed
      finishPending('ok', trimmed)
      return
    }
    if (/^(READ_ONLY|BAD_|BUSY|EEPROM_|FLASH_ERROR|TIMEOUT|STATUS_OVERFLOW)/.test(trimmed)) {
      pending.response = trimmed
      finishPending('device_error', trimmed, `设备拒绝命令：${trimmed}`)
    }
  }

  function initialize() {
    if (initialized.value) return
    serial.registerLineListener(LISTENER_ID, handleLine)
    initialized.value = true
  }

  watch(
    () => serial.connectedPort,
    (port) => {
      if (!port) {
        state.value = 'disconnected'
        status.value = null
        stopPolling()
        if (pending) finishPending('communication_error', '', '串口已断开')
      } else if (!isBusy.value) {
        state.value = 'connected'
      }
    },
    { immediate: true }
  )

  async function transact(
    command: string,
    operation: XtqTransactionRecord['operation'],
    owner?: XtqOwner,
    timeoutMs = 2500
  ): Promise<XtqTransactionRecord> {
    initialize()
    if (!serial.connectedPort) throw new Error('请先连接协调器 USART1')
    if (!serialConfigMatches.value)
      throw new Error('协调器 USART1 固定为 115200 8N1、无流控，请断开串口后修正参数')
    if (pending) throw new Error(`上一条命令仍在等待响应：${pending.command}`)
    const port = serial.connectedPort
    currentCommand.value = command
    const promise = new Promise<XtqTransactionRecord>((resolve) => {
      pending = {
        command,
        operation,
        owner,
        response: '',
        startedAt: new Date().toISOString(),
        port,
        resolve,
        timer: window.setTimeout(
          () => finishPending('timeout', '', '等待设备协议回包超时；未自动重试'),
          timeoutMs
        )
      }
    })
    try {
      await serial.sendRaw(command, { addCR: true, addLF: true })
    } catch (error) {
      finishPending('communication_error', '', String(error))
    }
    return promise
  }

  async function queryStatus(silent = false) {
    if (!silent) state.value = 'querying'
    lastError.value = ''
    const record = await transact('@STATUS', 'status')
    if (record.status !== 'ok') {
      lastError.value = record.error || record.response || '状态查询失败'
      if (!silent) state.value = 'error'
      return record
    }
    try {
      const parsed = parseStatus(record.response)
      previousStatus.value = status.value
      status.value = parsed
      state.value = 'connected'
    } catch (error) {
      lastError.value = String(error)
      state.value = 'error'
      record.status = 'device_error'
      record.error = String(error)
    }
    return record
  }

  async function readOwner(owner: XtqOwner) {
    state.value = 'querying'
    lastError.value = ''
    const record = await transact(`@CFG GET ${owner}`, 'read', owner)
    if (record.status !== 'ok') {
      lastError.value = record.error || record.response || `${owner} 读取失败`
      state.value = 'error'
      return record
    }
    try {
      const value = parseOkJson(record.response)
      snapshots.value[owner] = {
        owner,
        value,
        raw: record.response,
        receivedAt: record.completedAt,
        port: record.port
      }
      state.value = 'connected'
    } catch (error) {
      lastError.value = `${owner} 回包解析失败：${String(error)}`
      state.value = 'error'
    }
    return record
  }

  async function readAllOwners() {
    for (const owner of XTQ_OWNERS) {
      const record = await readOwner(owner)
      if (record.status === 'communication_error' || record.status === 'timeout') break
    }
  }

  async function writeOwner(owner: XtqOwner, jsonText: string) {
    if (owner === 'DeviceIdentity')
      throw new Error('普通固件的 DeviceIdentity 为只读；生产 factory 流程尚未集成')
    const command = buildSetCommand(owner, jsonText)
    state.value = 'writing'
    lastError.value = ''
    const record = await transact(command, 'write', owner, 5000)
    if (record.status !== 'ok') {
      lastError.value = record.error || record.response || `${owner} 写入失败`
      state.value = 'error'
      return record
    }
    if (record.response === 'OK_REBOOTING') {
      state.value = 'waiting_reboot'
      return record
    }
    await readOwner(owner)
    return record
  }

  function schedulePoll() {
    if (!polling.value || pollTimer !== null) return
    pollTimer = window.setTimeout(async () => {
      pollTimer = null
      if (
        polling.value &&
        serial.connectedPort &&
        !isBusy.value &&
        state.value !== 'waiting_reboot'
      ) {
        try {
          await queryStatus(true)
        } catch {
          /* 错误已记录，轮询保持有限节奏 */
        }
      }
      schedulePoll()
    }, 2000)
  }

  function startPolling() {
    polling.value = true
    schedulePoll()
  }

  function stopPolling() {
    polling.value = false
    if (pollTimer !== null) window.clearTimeout(pollTimer)
    pollTimer = null
  }

  async function confirmAfterReboot() {
    state.value = 'querying'
    const record = await queryStatus()
    if (record.status === 'ok' && status.value) {
      state.value = 'connected'
      await readAllOwners()
    }
    return record
  }

  function clearRecords() {
    records.value = []
  }

  function exportDiagnostic() {
    return JSON.stringify(
      {
        schema: 'np-tools.xtq-coordinator-diagnostic.v1',
        exportedAt: new Date().toISOString(),
        port: serial.connectedPort,
        serialConfig: { ...serial.config, path: undefined },
        status: status.value,
        previousStatus: previousStatus.value,
        owners: snapshots.value,
        transactions: records.value,
        limitations: [
          '未执行 F407/F427 实板 HIL 验证',
          '当前固件没有 @SYNC GET，诊断包不含完整同步规则 JSON',
          '当前固件没有 Radio 完整观测值读取接口'
        ]
      },
      null,
      2
    )
  }

  return {
    state,
    status,
    previousStatus,
    snapshots,
    records,
    currentCommand,
    lastError,
    polling,
    isBusy,
    identified,
    serialConfigMatches,
    initialize,
    queryStatus,
    readOwner,
    readAllOwners,
    writeOwner,
    startPolling,
    stopPolling,
    confirmAfterReboot,
    clearRecords,
    exportDiagnostic
  }
})
