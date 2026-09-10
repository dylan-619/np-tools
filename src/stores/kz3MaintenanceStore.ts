import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useSerialStore } from './serialStore'
import type {
  Kz3CommandResult,
  Kz3ConfigGroup,
  Kz3MaintenanceStatus,
  Kz3NetworkRecoveryAttempt,
  Kz3SessionRecord,
  Kz3Snapshot,
} from '../types/kz3Maintenance'
import {
  getCommandGroup,
  getFollowUpQuery,
  isProtocolLine,
  KZ3_UART_CONFIG,
  KZ3_QUERY_COMMANDS,
  parseKz3ProtocolLine,
  redactKz3Command,
  snapshotNeedsReboot,
  validateKz3Command,
} from '../utils/kz3UartProtocol'

const LISTENER_ID = 'kz3-maintenance'

interface PendingTransaction {
  command: string
  group: Kz3ConfigGroup
  rawLines: string[]
  startedAt: string
  protocolLine: string
  resolve: (result: Kz3CommandResult) => void
  timeoutTimer: number
  settleTimer: number | null
}

export const useKz3MaintenanceStore = defineStore('kz3Maintenance', () => {
  const serial = useSerialStore()
  const status = ref<Kz3MaintenanceStatus>('disconnected')
  const snapshots = ref<Partial<Record<Kz3ConfigGroup, Kz3Snapshot>>>({})
  const records = ref<Kz3SessionRecord[]>([])
  const networkRecoveryAttempts = ref<Kz3NetworkRecoveryAttempt[]>([])
  const currentCommand = ref('')
  const lastError = ref('')
  const initialized = ref(false)
  let pending: PendingTransaction | null = null

  const isBusy = computed(() => status.value === 'querying' || status.value === 'writing')
  const hasRebootPending = computed(() =>
    Object.values(snapshots.value).some((snapshot) =>
      snapshot ? snapshotNeedsReboot(snapshot.fields) : false
    )
  )
  const snapshotPortMatches = computed(() =>
    Object.values(snapshots.value).every(
      (snapshot) => !snapshot || snapshot.port === serial.connectedPort
    )
  )

  function finishPending(resultStatus: Kz3CommandResult['status'], error?: string) {
    if (!pending) return
    const transaction = pending
    pending = null
    window.clearTimeout(transaction.timeoutTimer)
    if (transaction.settleTimer !== null) window.clearTimeout(transaction.settleTimer)
    const result: Kz3CommandResult = {
      command: transaction.command,
      group: transaction.group,
      status: resultStatus,
      protocolLine: transaction.protocolLine,
      rawLines: [...transaction.rawLines],
      startedAt: transaction.startedAt,
      completedAt: new Date().toISOString(),
      error,
    }
    currentCommand.value = ''
    transaction.resolve(result)
  }

  function handleLine(line: string) {
    if (!pending) return
    pending.rawLines.push(line)
    if (isProtocolLine(line)) pending.protocolLine = line.trim()
    if (pending.protocolLine) {
      if (pending.settleTimer !== null) window.clearTimeout(pending.settleTimer)
      pending.settleTimer = window.setTimeout(() => {
        const envelope = parseKz3ProtocolLine(pending?.protocolLine || '')
        finishPending(envelope?.ok ? 'ok' : 'device_error')
      }, 250)
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
        status.value = 'disconnected'
        if (pending) finishPending('communication_error', '串口已断开')
      } else if (!isBusy.value) {
        status.value = hasRebootPending.value ? 'waiting_reboot' : 'connected'
      }
    },
    { immediate: true }
  )

  async function transact(command: string): Promise<Kz3CommandResult> {
    initialize()
    const normalized = validateKz3Command(command)
    if (!serial.connectedPort) throw new Error('请先连接 KZ3 UART1 串口')
    if (
      serial.config.baudRate !== KZ3_UART_CONFIG.baudRate ||
      serial.config.dataBits !== KZ3_UART_CONFIG.dataBits ||
      serial.config.stopBits !== KZ3_UART_CONFIG.stopBits ||
      serial.config.parity !== KZ3_UART_CONFIG.parity ||
      serial.config.flowControl !== KZ3_UART_CONFIG.flowControl
    ) {
      throw new Error('KZ3 UART1 固定为 115200 8N1、无流控；请断开后使用本页重新连接')
    }
    if (pending) throw new Error(`上一条命令仍在等待响应：${pending.command}`)

    const auditCommand = redactKz3Command(normalized)
    currentCommand.value = auditCommand
    const group = getCommandGroup(normalized)
    const resultPromise = new Promise<Kz3CommandResult>((resolve) => {
      pending = {
        command: auditCommand,
        group,
        rawLines: [],
        startedAt: new Date().toISOString(),
        protocolLine: '',
        resolve,
        settleTimer: null,
        timeoutTimer: window.setTimeout(() => {
          finishPending('timeout', '等待 UART1 OK/ERR 协议回包超时；未自动重试')
        }, 2500),
      }
    })

    try {
      await serial.sendRaw(normalized, { addCR: true, addLF: true })
    } catch (error) {
      finishPending('communication_error', String(error))
    }
    return resultPromise
  }

  function appendRecord(
    result: Kz3CommandResult,
    operation: Kz3SessionRecord['operation'],
    port: string
  ) {
    records.value.push({
      ...result,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operation,
      port,
    })
    if (records.value.length > 300) records.value.splice(0, records.value.length - 300)
  }

  function updateSnapshot(result: Kz3CommandResult, port: string) {
    const envelope = parseKz3ProtocolLine(result.protocolLine)
    if (!envelope?.ok) return
    const expectedFamily: Record<Kz3ConfigGroup, string> = {
      system: 'SYS',
      ethernet: 'ETH',
      sle: 'SLE',
      wireless: 'WIRELESS',
      cat1: '4G',
      edge: 'EDGE',
      debug: 'DEBUG',
    }
    if (result.group === 'debug') {
      const debugValue = envelope.family.startsWith('DEBUG=')
        ? envelope.family.slice('DEBUG='.length)
        : envelope.fields.DEBUG
      snapshots.value.debug = {
        group: 'debug',
        fields: { DEBUG: debugValue ?? '' },
        raw: result.protocolLine,
        receivedAt: result.completedAt,
        port,
      }
      return
    }
    if (result.group === 'cat1') {
      const fields = result.rawLines.reduce<Record<string, string>>((merged, line) => {
        const candidate = parseKz3ProtocolLine(line)
        return candidate?.ok && candidate.family === '4G'
          ? { ...merged, ...candidate.fields }
          : merged
      }, {})
      if (Object.keys(fields).length === 0) return
      snapshots.value.cat1 = {
        group: 'cat1',
        fields,
        raw: result.rawLines.filter((line) => parseKz3ProtocolLine(line)?.family === '4G').join('\n'),
        receivedAt: result.completedAt,
        port,
      }
      return
    }
    if (envelope.family !== expectedFamily[result.group]) return
    snapshots.value[result.group] = {
      group: result.group,
      fields: envelope.fields,
      raw: result.protocolLine,
      receivedAt: result.completedAt,
      port,
    }
  }

  async function runQuery(group: Kz3ConfigGroup, followUp = false): Promise<Kz3CommandResult> {
    const port = serial.connectedPort
    if (!port) throw new Error('请先连接 KZ3 UART1 串口')
    status.value = 'querying'
    lastError.value = ''
    const result = await transact(KZ3_QUERY_COMMANDS[group])
    appendRecord(result, followUp ? 'follow_up_query' : 'query', port)
    if (result.status === 'ok') updateSnapshot(result, port)
    else lastError.value = result.error || result.protocolLine || '设备查询失败'
    status.value = result.status === 'ok'
      ? (hasRebootPending.value ? 'waiting_reboot' : 'connected')
      : 'error'
    return result
  }

  async function runWrite(command: string): Promise<Kz3CommandResult> {
    const port = serial.connectedPort
    if (!port) throw new Error('请先连接 KZ3 UART1 串口')
    status.value = 'writing'
    lastError.value = ''
    const result = await transact(command)
    appendRecord(result, 'write', port)
    if (result.status !== 'ok') {
      lastError.value = result.error || result.protocolLine || '设备拒绝写入'
      status.value = 'error'
      return result
    }

    const followUp = getFollowUpQuery(command)
    if (followUp) {
      const queryResult = await runQuery(getCommandGroup(command), true)
      if (queryResult.status !== 'ok') return result
    }
    status.value = hasRebootPending.value ? 'waiting_reboot' : 'connected'
    return result
  }

  async function queryAll() {
    for (const group of ['system', 'ethernet', 'sle', 'wireless', 'cat1', 'edge', 'debug'] as Kz3ConfigGroup[]) {
      const result = await runQuery(group)
      if (result.status === 'communication_error') break
    }
  }

  function clearSession() {
    records.value = []
    networkRecoveryAttempts.value = []
  }

  function startNetworkRecoveryAttempt(candidateUrl: string): string {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    networkRecoveryAttempts.value.push({
      id,
      candidateUrl,
      startedAt: new Date().toISOString(),
      status: 'prepared',
    })
    if (networkRecoveryAttempts.value.length > 50) {
      networkRecoveryAttempts.value.splice(0, networkRecoveryAttempts.value.length - 50)
    }
    return id
  }

  function finishNetworkRecoveryAttempt(
    id: string,
    status: Exclude<Kz3NetworkRecoveryAttempt['status'], 'prepared'>,
    error?: string
  ) {
    const attempt = networkRecoveryAttempts.value.find((item) => item.id === id)
    if (!attempt) return
    attempt.status = status
    attempt.completedAt = new Date().toISOString()
    attempt.error = error
  }

  function exportSession() {
    return JSON.stringify(
      {
        schema: 'np-tools/kz3-uart1-maintenance-session/v1',
        exportedAt: new Date().toISOString(),
        uart: '115200 8N1, no flow control',
        connectedPort: serial.connectedPort,
        snapshots: snapshots.value,
        records: records.value,
        networkRecoveryAttempts: networkRecoveryAttempts.value,
        verificationBoundary: '工具记录仅证明 UART1 协议收发；未替代实板、SLE 无线链路或现场验证。',
      },
      null,
      2
    )
  }

  return {
    status,
    snapshots,
    records,
    networkRecoveryAttempts,
    currentCommand,
    lastError,
    isBusy,
    hasRebootPending,
    snapshotPortMatches,
    initialize,
    runQuery,
    runWrite,
    queryAll,
    clearSession,
    startNetworkRecoveryAttempt,
    finishNetworkRecoveryAttempt,
    exportSession,
  }
})
