import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useSerialStore } from './serialStore'
import type {
  XtqCapabilitySnapshot,
  XtqCoordinatorStatus,
  XtqOwner,
  XtqSessionState,
  XtqSnapshot,
  XtqStatusDifference,
  XtqStatusSample,
  XtqSyncUploadSummary,
  XtqTransactionRecord
} from '../types/xtqCoordinator'
import { XTQ_CAPABILITY_SLOT_COUNT, XTQ_OWNERS } from '../types/xtqCoordinator'
import {
  buildCapabilitySetCommand,
  buildSetCommand,
  buildSyncPayload,
  capabilityOwnerForSlot,
  parseOkJson,
  parseStatus,
  validateCapabilityValue,
  validateOwnerValue,
  XTQ_UART_CONFIG
} from '../utils/xtqCoordinatorProtocol'

const LISTENER_ID = 'xtq-coordinator'
const REBOOT_RECOVERY_WINDOW_MS = 30_000
const REBOOT_RECOVERY_INTERVAL_MS = 1_500
const STATUS_HISTORY_LIMIT = 300
interface StatusComparisonField {
  path: string
  label: string
  read: (status: XtqCoordinatorStatus) => string | number | null
}

function radioField(
  radioIndex: number,
  field: keyof XtqCoordinatorStatus['radios'][number],
  label: string
): StatusComparisonField {
  return {
    path: `radios[${radioIndex}].${field}`,
    label: `Radio ${radioIndex + 1} ${label}`,
    read: (status) => status.radios[radioIndex]?.[field] ?? null
  }
}

const STATUS_COMPARISON_FIELDS: StatusComparisonField[] = [
  { path: 'mode', label: '工作模式', read: (status) => status.mode },
  { path: 'boot_id', label: 'Boot ID', read: (status) => status.boot_id },
  { path: 'reset_cause', label: '复位原因', read: (status) => status.reset_cause },
  { path: 'config_errors', label: '配置错误掩码', read: (status) => status.config_errors },
  { path: 'phy_result', label: 'PHY 结果', read: (status) => status.phy_result },
  { path: 'phy_id', label: 'PHY ID', read: (status) => status.phy_id },
  ...[0, 1].flatMap((radioIndex) => [
    radioField(radioIndex, 'role', '角色'),
    radioField(radioIndex, 'state', '状态机'),
    radioField(radioIndex, 'ready', 'READY'),
    radioField(radioIndex, 'sta', 'STA'),
    radioField(radioIndex, 'address', '观测地址'),
    radioField(radioIndex, 'recoveries', '恢复次数'),
    radioField(radioIndex, 'valid_frames', '有效帧'),
    radioField(radioIndex, 'uart_errors', 'UART 错误'),
    radioField(radioIndex, 'rx_restarts', 'RX 重启'),
    radioField(radioIndex, 'invalid_frames', '无效帧'),
    radioField(radioIndex, 'dropped_bytes', '丢弃字节')
  ]),
  { path: 'routing.neighbors', label: '路由邻居数', read: (status) => status.routing.neighbors },
  { path: 'routing.routes', label: '路由表项数', read: (status) => status.routing.routes },
  { path: 'routing.conflicts', label: '路由冲突数', read: (status) => status.routing.conflicts },
  { path: 'routing.dropped', label: '路由丢弃数', read: (status) => status.routing.dropped },
  { path: 'points.used', label: '点缓存占用', read: (status) => status.points.used },
  { path: 'points.updates', label: '点缓存更新数', read: (status) => status.points.updates },
  { path: 'points.evictions', label: '点缓存淘汰数', read: (status) => status.points.evictions },
  { path: 'sync.sequence', label: '同步序号', read: (status) => status.sync.sequence },
  { path: 'sync.json_length', label: '同步 JSON 长度', read: (status) => status.sync.json_length },
  { path: 'sync.rules', label: '同步规则数', read: (status) => status.sync.rules },
  { path: 'sync.runs', label: '同步运行次数', read: (status) => status.sync.runs },
  { path: 'sync.source_missing', label: '同步源缺失数', read: (status) => status.sync.source_missing },
  {
    path: 'sync.target_failures',
    label: '同步目标失败数',
    read: (status) => status.sync.target_failures
  },
  { path: 'network.ready', label: '网络就绪', read: (status) => status.network.ready },
  { path: 'network.state', label: '网络状态', read: (status) => status.network.state },
  { path: 'network.queued', label: '网络队列', read: (status) => status.network.queued },
  { path: 'network.sent', label: '网络发送数', read: (status) => status.network.sent },
  { path: 'network.received', label: '网络接收数', read: (status) => status.network.received },
  { path: 'network.dropped', label: '网络丢弃数', read: (status) => status.network.dropped },
  {
    path: 'network.protocol_errors',
    label: '网络协议错误数',
    read: (status) => status.network.protocol_errors
  },
  { path: 'capabilities', label: 'Capability 数量', read: (status) => status.capabilities },
  {
    path: 'provisioning_timeouts',
    label: '终端配置超时数',
    read: (status) => status.provisioning_timeouts
  }
]

interface PendingTransaction {
  command: string
  operation: XtqTransactionRecord['operation']
  response: string
  startedAt: string
  port: string
  resolve: (record: XtqTransactionRecord) => void
  timer: number
}

interface TransactOptions {
  timeoutMs?: number
  payload?: string
  exactBytes?: boolean
  displayCommand?: string
  logText?: string
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function cloneStatus(status: XtqCoordinatorStatus): XtqCoordinatorStatus {
  return JSON.parse(JSON.stringify(status)) as XtqCoordinatorStatus
}

function diffStatuses(
  before: XtqCoordinatorStatus,
  after: XtqCoordinatorStatus
): XtqStatusDifference[] {
  return STATUS_COMPARISON_FIELDS.flatMap((field) => {
    const beforeValue = field.read(before)
    const afterValue = field.read(after)
    return beforeValue === afterValue
      ? []
      : [{ path: field.path, label: field.label, before: beforeValue, after: afterValue }]
  })
}

function ownerReadbackMatches(
  owner: XtqOwner,
  candidate: Record<string, unknown>,
  actual: Record<string, unknown>
): boolean {
  for (const [field, value] of Object.entries(candidate)) {
    if (field !== 'config_sequence') {
      if (!sameJson(value, actual[field])) return false
      continue
    }
    if (owner !== 'CoordinatorConfig' && owner !== 'EthernetConfig') {
      if (!sameJson(value, actual[field])) return false
      continue
    }
    const expected = (Number(value) + 1) & 0xffff
    if (actual[field] !== expected) return false
  }
  return true
}

export const useXtqCoordinatorStore = defineStore('xtqCoordinator', () => {
  const serial = useSerialStore()
  const state = ref<XtqSessionState>('disconnected')
  const status = ref<XtqCoordinatorStatus | null>(null)
  const previousStatus = ref<XtqCoordinatorStatus | null>(null)
  const statusHistory = ref<XtqStatusSample[]>([])
  const latestStatusDifferences = ref<XtqStatusDifference[]>([])
  const snapshots = ref<Partial<Record<XtqOwner, XtqSnapshot>>>({})
  const capabilitySnapshots = ref<Partial<Record<number, XtqCapabilitySnapshot>>>({})
  const lastSyncUpload = ref<XtqSyncUploadSummary | null>(null)
  const records = ref<XtqTransactionRecord[]>([])
  const currentCommand = ref('')
  const lastError = ref('')
  const polling = ref(false)
  const initialized = ref(false)
  const recoveryDeadline = ref<number | null>(null)
  const recoveryAttempts = ref(0)
  const recoveryPort = ref<string | null>(null)
  const resumePollingAfterRecovery = ref(false)
  let pending: PendingTransaction | null = null
  let pollTimer: number | null = null
  let recoveryTimer: number | null = null

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
  const recoveryActive = computed(() => recoveryDeadline.value !== null)
  const capabilityReadCount = computed(() => Object.keys(capabilitySnapshots.value).length)

  function appendRecord(record: XtqTransactionRecord) {
    records.value.push(record)
    if (records.value.length > 500) records.value.splice(0, records.value.length - 500)
  }

  function appendStatusSample(
    nextStatus: XtqCoordinatorStatus,
    capturedAt: string,
    port: string
  ) {
    const snapshot = cloneStatus(nextStatus)
    const previous = status.value
    previousStatus.value = previous ? cloneStatus(previous) : null
    latestStatusDifferences.value = previous ? diffStatuses(previous, snapshot) : []
    status.value = snapshot
    statusHistory.value.push({ capturedAt, port, status: cloneStatus(snapshot) })
    if (statusHistory.value.length > STATUS_HISTORY_LIMIT) {
      statusHistory.value.splice(0, statusHistory.value.length - STATUS_HISTORY_LIMIT)
    }
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

  function clearRecoveryTimer() {
    if (recoveryTimer !== null) window.clearTimeout(recoveryTimer)
    recoveryTimer = null
  }

  function stopRebootRecovery() {
    clearRecoveryTimer()
    recoveryDeadline.value = null
    recoveryAttempts.value = 0
    recoveryPort.value = null
    resumePollingAfterRecovery.value = false
  }

  function finishRebootRecovery() {
    const resumePolling = resumePollingAfterRecovery.value
    stopRebootRecovery()
    if (resumePolling) startPolling()
  }

  function scheduleRebootRecovery(delay = REBOOT_RECOVERY_INTERVAL_MS) {
    if (recoveryTimer !== null || recoveryDeadline.value === null) return
    recoveryTimer = window.setTimeout(() => {
      recoveryTimer = null
      void attemptRebootRecovery()
    }, delay)
  }

  async function attemptRebootRecovery() {
    const deadline = recoveryDeadline.value
    if (deadline === null) return
    if (Date.now() >= deadline) {
      stopRebootRecovery()
      lastError.value = '重启后 30 秒恢复窗口已结束；请检查供电、串口枚举和 UART1 参数后手动复核'
      state.value = 'error'
      return
    }
    if (pending || isBusy.value) {
      scheduleRebootRecovery()
      return
    }
    if (!serial.connectedPort) {
      const knownPort = recoveryPort.value
      if (!knownPort) {
        state.value = 'error'
        lastError.value = '重启恢复缺少原串口路径；请手动连接并重新识别设备'
        stopRebootRecovery()
        return
      }
      recoveryAttempts.value += 1
      try {
        // 仅重开本次写入前已连接的精确路径；不刷新端口列表、不扫描其他设备。
        await serial.connect(knownPort, { preserveSession: true })
      } catch {
        state.value = 'waiting_reboot'
        scheduleRebootRecovery()
        return
      }
    }
    if (serial.connectedPort !== recoveryPort.value) {
      lastError.value = `重启恢复期间串口路径已变为 ${serial.connectedPort}；未自动向新路径发送命令，请手动重新识别`
      state.value = 'error'
      stopRebootRecovery()
      return
    }
    recoveryAttempts.value += 1
    const record = await queryStatus(true)
    if (record.status !== 'ok' || !status.value) {
      state.value = 'waiting_reboot'
      scheduleRebootRecovery()
      return
    }
    const ownerRecords = await readAllOwners()
    if (ownerRecords.length === XTQ_OWNERS.length && ownerRecords.every((item) => item.status === 'ok')) {
      state.value = 'connected'
      finishRebootRecovery()
      return
    }
    lastError.value = '设备已恢复响应，但重启后 owner 配置复核未完成；请查看会话记录后手动重试读取'
    state.value = 'error'
  }

  function startRebootRecovery() {
    clearRecoveryTimer()
    recoveryPort.value = serial.connectedPort
    resumePollingAfterRecovery.value = polling.value
    recoveryDeadline.value = Date.now() + REBOOT_RECOVERY_WINDOW_MS
    recoveryAttempts.value = 0
    state.value = 'waiting_reboot'
    scheduleRebootRecovery()
  }

  watch(
    () => serial.connectedPort,
    (port) => {
      if (!port) {
        status.value = null
        stopPolling()
        if (pending) finishPending('communication_error', '', '串口已断开')
        if (recoveryDeadline.value !== null && recoveryPort.value) {
          state.value = 'waiting_reboot'
          scheduleRebootRecovery()
        } else {
          state.value = 'disconnected'
        }
        return
      }
      if (recoveryDeadline.value !== null) {
        state.value = 'waiting_reboot'
        scheduleRebootRecovery(250)
      } else if (!isBusy.value) {
        state.value = 'connected'
      }
    },
    { immediate: true }
  )

  async function transact(
    command: string,
    operation: XtqTransactionRecord['operation'],
    options: TransactOptions = {}
  ): Promise<XtqTransactionRecord> {
    initialize()
    if (!serial.connectedPort) throw new Error('请先连接协调器 USART1')
    if (!serialConfigMatches.value)
      throw new Error('协调器 USART1 固定为 115200 8N1、无流控，请断开串口后修正参数')
    if (pending) throw new Error(`上一条命令仍在等待响应：${pending.command}`)
    const port = serial.connectedPort
    const displayCommand = options.displayCommand || command
    currentCommand.value = displayCommand
    const promise = new Promise<XtqTransactionRecord>((resolve) => {
      pending = {
        command: displayCommand,
        operation,
        response: '',
        startedAt: new Date().toISOString(),
        port,
        resolve,
        timer: window.setTimeout(
          () => finishPending('timeout', '', '等待设备协议回包超时；未自动重试'),
          options.timeoutMs ?? 2500
        )
      }
    })
    try {
      await serial.sendRaw(options.payload || command, {
        exactBytes: options.exactBytes,
        addCR: options.exactBytes ? false : true,
        addLF: options.exactBytes ? false : true,
        logText: options.logText
      })
    } catch (error) {
      finishPending('communication_error', '', String(error))
    }
    return promise
  }

  async function queryStatus(silent = false) {
    if (!silent) state.value = 'querying'
    if (!silent) lastError.value = ''
    const record = await transact('@STATUS', 'status')
    if (record.status !== 'ok') {
      if (!silent) {
        lastError.value = record.error || record.response || '状态查询失败'
        state.value = 'error'
      }
      return record
    }
    try {
      const parsed = parseStatus(record.response)
      appendStatusSample(parsed, record.completedAt, record.port)
      lastError.value = ''
      state.value = 'connected'
    } catch (error) {
      record.status = 'device_error'
      record.error = String(error)
      if (!silent) {
        lastError.value = String(error)
        state.value = 'error'
      }
    }
    return record
  }

  async function readOwner(owner: XtqOwner) {
    state.value = 'querying'
    lastError.value = ''
    const record = await transact(`@CFG GET ${owner}`, 'read')
    if (record.status !== 'ok') {
      lastError.value = record.error || record.response || `${owner} 读取失败`
      state.value = 'error'
      return record
    }
    try {
      const value = parseOkJson(record.response)
      snapshots.value = {
        ...snapshots.value,
        [owner]: {
          owner,
          value,
          raw: record.response,
          receivedAt: record.completedAt,
          port: record.port
        }
      }
      state.value = 'connected'
    } catch (error) {
      lastError.value = `${owner} 回包解析失败：${String(error)}`
      state.value = 'error'
      record.status = 'device_error'
      record.error = lastError.value
    }
    return record
  }

  async function readAllOwners() {
    const results: XtqTransactionRecord[] = []
    for (const owner of XTQ_OWNERS) {
      const record = await readOwner(owner)
      results.push(record)
      if (record.status === 'communication_error' || record.status === 'timeout') break
    }
    return results
  }

  async function writeOwner(owner: XtqOwner, jsonText: string) {
    if (owner === 'DeviceIdentity')
      throw new Error('普通固件的 DeviceIdentity 为只读；生产 factory 流程尚未集成')
    const candidate = validateOwnerValue(owner, JSON.parse(jsonText))
    const command = buildSetCommand(owner, jsonText)
    state.value = 'writing'
    lastError.value = ''
    const record = await transact(command, 'write', { timeoutMs: 5000 })
    if (record.status !== 'ok') {
      lastError.value = record.error || record.response || `${owner} 写入失败`
      state.value = 'error'
      return record
    }
    if (record.response === 'OK_REBOOTING') {
      startRebootRecovery()
      return record
    }
    const readback = await readOwner(owner)
    const actual = snapshots.value[owner]?.value
    if (readback.status !== 'ok' || !actual || !ownerReadbackMatches(owner, candidate, actual)) {
      lastError.value = `${owner} 写后读回不一致或读取失败`
      state.value = 'error'
      record.status = 'device_error'
      record.error = lastError.value
    }
    return record
  }

  async function readCapability(slot: number) {
    const owner = capabilityOwnerForSlot(slot)
    state.value = 'querying'
    lastError.value = ''
    const record = await transact(`@CFG GET ${owner}`, 'capability_read')
    if (record.status !== 'ok') {
      lastError.value = record.error || record.response || `${owner} 读取失败`
      state.value = 'error'
      return record
    }
    try {
      const value = validateCapabilityValue(parseOkJson(record.response))
      capabilitySnapshots.value = {
        ...capabilitySnapshots.value,
        [slot]: {
          slot,
          owner,
          value,
          raw: record.response,
          receivedAt: record.completedAt,
          port: record.port
        }
      }
      state.value = 'connected'
    } catch (error) {
      lastError.value = `${owner} 回包解析失败：${String(error)}`
      state.value = 'error'
      record.status = 'device_error'
      record.error = lastError.value
    }
    return record
  }

  async function readAllCapabilities() {
    const results: XtqTransactionRecord[] = []
    for (let slot = 0; slot < XTQ_CAPABILITY_SLOT_COUNT; slot += 1) {
      const record = await readCapability(slot)
      results.push(record)
      if (record.status === 'communication_error' || record.status === 'timeout') break
    }
    return results
  }

  async function writeCapability(slot: number, jsonText: string) {
    const { command, value } = buildCapabilitySetCommand(slot, jsonText)
    const owner = capabilityOwnerForSlot(slot)
    state.value = 'writing'
    lastError.value = ''
    const record = await transact(command, 'capability_write', { timeoutMs: 5000 })
    if (record.status !== 'ok') {
      lastError.value = record.error || record.response || `${owner} 写入失败`
      state.value = 'error'
      return record
    }
    const readback = await readCapability(slot)
    const actual = capabilitySnapshots.value[slot]?.value
    if (readback.status !== 'ok' || !actual || !sameJson(value, actual)) {
      lastError.value = `${owner} 写后读回不一致或读取失败`
      state.value = 'error'
      record.status = 'device_error'
      record.error = lastError.value
    }
    return record
  }

  async function uploadSyncConfiguration(jsonText: string) {
    if (!status.value) throw new Error('上传同步规则前必须先识别协调器并读取 @STATUS')
    const prepared = buildSyncPayload(jsonText)
    const before = status.value.sync
    state.value = 'writing'
    lastError.value = ''
    const display = `@SYNC BEGIN ${prepared.byteLength} ${prepared.crc32} <${prepared.ruleCount} rules/${prepared.mappingCount} mappings> @SYNC COMMIT`
    const record = await transact(display, 'sync_upload', {
      payload: prepared.payload,
      exactBytes: true,
      displayCommand: display,
      logText: display,
      timeoutMs: 12_000
    })
    if (record.status !== 'ok') {
      lastError.value = record.error || record.response || '同步规则上传失败'
      state.value = 'error'
      return record
    }
    const statusRecord = await queryStatus()
    const after = status.value?.sync
    const summaryVerified =
      statusRecord.status === 'ok' &&
      after !== undefined &&
      after.json_length === prepared.byteLength &&
      after.rules === prepared.ruleCount
    const verificationMessage = summaryVerified
      ? '设备返回 OK，且 @STATUS 的规则数与 JSON 长度摘要匹配；当前固件未提供同步规则完整读回，不能验证 Flash 内容一致。'
      : '设备返回 OK，但 @STATUS 的规则数或 JSON 长度摘要未匹配；当前固件未提供同步规则完整读回，不能定位内容差异。'
    lastSyncUpload.value = {
      uploadedAt: new Date().toISOString(),
      canonicalJson: prepared.canonicalJson,
      byteLength: prepared.byteLength,
      crc32: prepared.crc32,
      ruleCount: prepared.ruleCount,
      mappingCount: prepared.mappingCount,
      sequenceBefore: before.sequence,
      sequenceAfter: after?.sequence ?? null,
      deviceJsonLength: after?.json_length ?? null,
      deviceRuleCount: after?.rules ?? null,
      summaryMatched: summaryVerified,
      contentVerified: false,
      verificationMessage
    }
    if (!summaryVerified) {
      lastError.value = verificationMessage
      state.value = 'error'
      record.status = 'device_error'
      record.error = verificationMessage
    } else {
      state.value = 'connected'
    }
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
          /* 错误留在事务记录，轮询保持有限节奏。 */
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
      clearRecoveryTimer()
      const ownerRecords = await readAllOwners()
      if (
        ownerRecords.length === XTQ_OWNERS.length &&
        ownerRecords.every((item) => item.status === 'ok')
      ) {
        state.value = 'connected'
        finishRebootRecovery()
      } else {
        lastError.value = '设备已恢复响应，但重启后 owner 配置复核未完成；请查看会话记录后手动重试读取'
        state.value = 'error'
        stopRebootRecovery()
      }
    }
    return record
  }

  function clearRecords() {
    records.value = []
  }

  function clearStatusHistory() {
    statusHistory.value = []
    latestStatusDifferences.value = []
    previousStatus.value = null
  }

  function exportDiagnostic() {
    return JSON.stringify(
      {
        schema: 'np-tools.xtq-coordinator-diagnostic.v5',
        exportedAt: new Date().toISOString(),
        port: serial.connectedPort,
        serialConfig: { ...serial.config, path: undefined },
        status: status.value,
        previousStatus: previousStatus.value,
        statusHistory: statusHistory.value,
        latestStatusDifferences: latestStatusDifferences.value,
        owners: snapshots.value,
        capabilities: capabilitySnapshots.value,
        lastSyncUpload: lastSyncUpload.value,
        recovery: {
          active: recoveryActive.value,
          attempts: recoveryAttempts.value,
          deadline: recoveryDeadline.value,
          knownPort: recoveryPort.value
        },
        transactions: records.value,
        limitations: [
          '未执行 F407/F427 实板 HIL 验证',
          '当前固件未提供同步规则完整读回；@STATUS 只能核对规则数和 JSON 长度摘要，不能证明 Flash 内容一致',
          '当前 @STATUS 未提供 Radio 芯片完整实时观测值；网络名和功率仅来自 EEPROM owner 快照'
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
    statusHistory,
    latestStatusDifferences,
    snapshots,
    capabilitySnapshots,
    capabilityReadCount,
    lastSyncUpload,
    records,
    currentCommand,
    lastError,
    polling,
    isBusy,
    identified,
    serialConfigMatches,
    recoveryActive,
    recoveryDeadline,
    recoveryAttempts,
    recoveryPort,
    initialize,
    queryStatus,
    readOwner,
    readAllOwners,
    writeOwner,
    readCapability,
    readAllCapabilities,
    writeCapability,
    uploadSyncConfiguration,
    startPolling,
    stopPolling,
    confirmAfterReboot,
    clearRecords,
    clearStatusHistory,
    exportDiagnostic
  }
})
