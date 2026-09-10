<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  EthernetPort,
  Info,
  Play,
  Plus,
  RefreshCw,
  TableProperties,
  TerminalSquare,
  Trash2,
} from 'lucide-vue-next'
import { modbusTcpRead } from '../api/modbusTcpApi'
import { useSerialStore } from '../stores/serialStore'
import {
  MODBUS_ADDRESS_MODE_OPTIONS,
  MODBUS_BYTE_ORDER_OPTIONS,
  MODBUS_READ_FUNCTION_OPTIONS,
  MODBUS_VALUE_TYPE_OPTIONS,
  type ModbusAddressMode,
  type ModbusMonitorPoint,
  type ModbusPointRuntime,
  type ModbusPointStatus,
  type ModbusReadFunction,
  type ModbusTransport,
  type ModbusValueType,
} from '../types/modbusDebug'
import {
  buildModbusReadPdu,
  buildModbusRtuRequest,
  decodeModbusValue,
  extractModbusRtuResponse,
  formatModbusHex,
  modbusExceptionLabel,
  requiredScalarQuantity,
  resolveModbusAddress,
  validateModbusMonitorPoint,
  type ModbusReadResponse,
} from '../utils/modbusProtocol'

const router = useRouter()
const serial = useSerialStore()

const STORAGE_KEY = 'np_tools_modbus_debug_config_v1'
const RTU_LISTENER_ID = 'np_tools_modbus_debug_rtu'
const MAX_MONITOR_POINTS = 64
const MAX_TRANSACTION_HISTORY = 30

interface SavedConfig {
  transport: ModbusTransport
  tcpHost: string
  tcpPort: number
  timeoutMs: number
  pollIntervalMs: number
  points: ModbusMonitorPoint[]
}

interface TransactionRecord {
  id: string
  timestamp: string
  pointName: string
  transport: ModbusTransport
  result: 'ok' | 'error' | 'exception'
  message: string
  tx: string
  rx?: string
  elapsedMs?: number
}

type RtuReadOutcome =
  | {
      kind: 'response'
      response: ModbusReadResponse
      frame: Uint8Array
      elapsedMs: number
    }
  | {
      kind: 'error'
      status: 'crc_error' | 'protocol_error' | 'communication_error'
      message: string
      frame?: Uint8Array
      elapsedMs: number
    }
  | { kind: 'timeout'; elapsedMs: number }
  | { kind: 'cancelled'; elapsedMs: number }

interface PendingRtuRead {
  point: ModbusMonitorPoint
  startedAt: number
  timer: number
  resolve: (result: RtuReadOutcome) => void
}

function referenceBase(functionCode: ModbusReadFunction): number {
  if (functionCode === 1) return 1
  if (functionCode === 2) return 10001
  if (functionCode === 3) return 40001
  return 30001
}

function defaultPoint(index = 1): ModbusMonitorPoint {
  return {
    id: `modbus-point-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `点位 ${index}`,
    enabled: true,
    unitId: 1,
    functionCode: 3,
    address: 40001,
    addressMode: 'reference',
    quantity: 1,
    valueType: 'uint16',
    byteOrder: 'ABCD',
  }
}

function normalizePoint(input: Partial<ModbusMonitorPoint>, index: number): ModbusMonitorPoint {
  const fallback = defaultPoint(index)
  const functionCode = [1, 2, 3, 4].includes(Number(input.functionCode))
    ? (Number(input.functionCode) as ModbusReadFunction)
    : fallback.functionCode
  const addressMode: ModbusAddressMode = input.addressMode === 'offset' ? 'offset' : 'reference'
  const selectedValueType = MODBUS_VALUE_TYPE_OPTIONS.some((item) => item.value === input.valueType)
    ? (input.valueType as ModbusValueType)
    : fallback.valueType
  const valueType: ModbusValueType =
    [1, 2].includes(functionCode) && !['bool', 'raw'].includes(selectedValueType)
      ? 'bool'
      : selectedValueType
  const address = Number(input.address)
  const quantity = Number(input.quantity)
  const unitId = Number(input.unitId)
  const scalarQuantity = requiredScalarQuantity(valueType)
  return {
    ...fallback,
    id: typeof input.id === 'string' && input.id ? input.id : fallback.id,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : fallback.name,
    enabled: input.enabled !== false,
    unitId: Number.isInteger(unitId) ? unitId : fallback.unitId,
    functionCode,
    address: Number.isInteger(address) ? address : referenceBase(functionCode),
    addressMode,
    quantity: scalarQuantity ?? (Number.isInteger(quantity) ? quantity : fallback.quantity),
    valueType,
    byteOrder: MODBUS_BYTE_ORDER_OPTIONS.some((item) => item.value === input.byteOrder)
      ? input.byteOrder!
      : fallback.byteOrder,
  }
}

function loadSavedConfig(): SavedConfig {
  const fallback: SavedConfig = {
    transport: 'rtu',
    // 默认留空，避免切换到 TCP 后误把读请求发往某个历史调试地址。
    tcpHost: '',
    tcpPort: 502,
    timeoutMs: 800,
    pollIntervalMs: 1000,
    points: [defaultPoint()],
  }
  if (typeof localStorage === 'undefined') return fallback
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<SavedConfig>
    return {
      transport: stored.transport === 'tcp' ? 'tcp' : 'rtu',
      tcpHost: typeof stored.tcpHost === 'string' ? stored.tcpHost : fallback.tcpHost,
      tcpPort: Number.isInteger(stored.tcpPort) ? Number(stored.tcpPort) : fallback.tcpPort,
      timeoutMs: Number.isInteger(stored.timeoutMs) ? Number(stored.timeoutMs) : fallback.timeoutMs,
      pollIntervalMs: Number.isInteger(stored.pollIntervalMs)
        ? Number(stored.pollIntervalMs)
        : fallback.pollIntervalMs,
      points:
        Array.isArray(stored.points) && stored.points.length > 0
          ? stored.points.slice(0, MAX_MONITOR_POINTS).map(normalizePoint)
          : fallback.points,
    }
  } catch {
    return fallback
  }
}

const saved = loadSavedConfig()
const transport = ref<ModbusTransport>(saved.transport)
const tcp = reactive({ host: saved.tcpHost, port: saved.tcpPort })
const timeoutMs = ref(saved.timeoutMs)
const pollIntervalMs = ref(saved.pollIntervalMs)
const points = ref<ModbusMonitorPoint[]>(saved.points)
const runtime = reactive<Record<string, ModbusPointRuntime>>({})
const transactions = ref<TransactionRecord[]>([])
const isPolling = ref(false)
const isCycling = ref(false)
const statusMessage = ref('已就绪：配置点位后即可执行只读轮询。')
const lastCycleAt = ref('—')

let nextCycleTimer: number | undefined
let pollGeneration = 0
let rtuListenerAttached = false
let rtuReceiveBuffer = new Uint8Array()
let pendingRtuRead: PendingRtuRead | null = null

const enabledPointCount = computed(() => points.value.filter((point) => point.enabled).length)
const successfulPointCount = computed(
  () => points.value.filter((point) => point.enabled && runtime[point.id]?.status === 'ok').length
)
const activeTransportLabel = computed(() => (transport.value === 'rtu' ? 'Modbus RTU' : 'Modbus TCP'))
const configurationLocked = computed(() => isPolling.value || isCycling.value)

function persistConfig() {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      transport: transport.value,
      tcpHost: tcp.host.trim(),
      tcpPort: Number(tcp.port),
      timeoutMs: Number(timeoutMs.value),
      pollIntervalMs: Number(pollIntervalMs.value),
      points: points.value,
    })
  )
}

watch(
  [transport, () => tcp.host, () => tcp.port, timeoutMs, pollIntervalMs, points],
  persistConfig,
  { deep: true }
)

watch(transport, () => {
  if (isPolling.value || isCycling.value) stopPolling('通信模式已切换，已停止当前轮询。')
})

function currentRuntime(pointId: string): ModbusPointRuntime {
  return runtime[pointId] || { status: 'idle' }
}

function updateRuntime(pointId: string, next: Partial<ModbusPointRuntime>) {
  runtime[pointId] = { ...currentRuntime(pointId), ...next }
}

function clock(): string {
  const date = new Date()
  return `${date.toLocaleTimeString('zh-CN', { hour12: false })}.${date
    .getMilliseconds()
    .toString()
    .padStart(3, '0')}`
}

function formatError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return detail.replace(/^Error:\s*/, '') || '未知通信错误'
}

function statusFromError(message: string): ModbusPointStatus {
  return /超时|timeout/i.test(message) ? 'timeout' : 'communication_error'
}

function statusLabel(status: ModbusPointStatus): string {
  const labels: Record<ModbusPointStatus, string> = {
    idle: '未读取',
    reading: '读取中',
    ok: '有效',
    timeout: '超时',
    exception: '从站异常',
    crc_error: 'CRC 错误',
    protocol_error: '协议错误',
    communication_error: '通信错误',
    validation_error: '配置错误',
  }
  return labels[status]
}

function addTransaction(entry: Omit<TransactionRecord, 'id' | 'timestamp'>) {
  transactions.value.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: clock(),
    ...entry,
  })
  if (transactions.value.length > MAX_TRANSACTION_HISTORY) {
    transactions.value.splice(MAX_TRANSACTION_HISTORY)
  }
}

function attachRtuListener() {
  if (rtuListenerAttached) return
  serial.registerChunkListener(RTU_LISTENER_ID, handleRtuChunk, { suppressText: true })
  rtuListenerAttached = true
}

function detachRtuListener() {
  if (!rtuListenerAttached) return
  serial.unregisterChunkListener(RTU_LISTENER_ID)
  rtuListenerAttached = false
  rtuReceiveBuffer = new Uint8Array()
}

function appendRtuBytes(payload: Uint8Array) {
  const MAX_BUFFER_BYTES = 1024
  const start = Math.max(0, rtuReceiveBuffer.length + payload.length - MAX_BUFFER_BYTES)
  const combined = new Uint8Array(rtuReceiveBuffer.length + payload.length)
  combined.set(rtuReceiveBuffer)
  combined.set(payload, rtuReceiveBuffer.length)
  rtuReceiveBuffer = combined.slice(start)
}

function completePendingRtuRead(result: RtuReadOutcome) {
  const pending = pendingRtuRead
  if (!pending) return
  window.clearTimeout(pending.timer)
  pendingRtuRead = null
  pending.resolve(result)
}

function handleRtuChunk(payload: Uint8Array) {
  const pending = pendingRtuRead
  if (!pending) return
  appendRtuBytes(payload)
  const extracted = extractModbusRtuResponse(rtuReceiveBuffer, pending.point)
  rtuReceiveBuffer = extracted.remaining
  if (extracted.kind === 'incomplete') return

  const elapsedMs = Math.max(0, Date.now() - pending.startedAt)
  if (extracted.kind === 'response') {
    completePendingRtuRead({
      kind: 'response',
      response: extracted.response,
      frame: extracted.frame,
      elapsedMs,
    })
    return
  }
  completePendingRtuRead({
    kind: 'error',
    status: extracted.status,
    message: extracted.message,
    frame: extracted.frame,
    elapsedMs,
  })
}

function cancelPendingRtuRead() {
  const pending = pendingRtuRead
  if (!pending) return
  completePendingRtuRead({ kind: 'cancelled', elapsedMs: Math.max(0, Date.now() - pending.startedAt) })
}

async function readRtuPoint(point: ModbusMonitorPoint): Promise<RtuReadOutcome> {
  if (!serial.connectedPort) throw new Error('RTU 模式需要先在左下角打开公共串口')
  const temporaryListener = !rtuListenerAttached
  if (temporaryListener) attachRtuListener()
  const request = buildModbusRtuRequest(point)
  const requestHex = formatModbusHex(request)
  rtuReceiveBuffer = new Uint8Array()

  try {
    return await new Promise<RtuReadOutcome>((resolve) => {
      const startedAt = Date.now()
      const timer = window.setTimeout(() => {
        completePendingRtuRead({ kind: 'timeout', elapsedMs: Math.max(0, Date.now() - startedAt) })
      }, Number(timeoutMs.value))
      pendingRtuRead = { point, startedAt, timer, resolve }

      void serial
        .sendRaw(requestHex, {
          isHex: true,
          exactBytes: true,
          logText: `MODBUS RTU TX · ${point.name} · ${requestHex}`,
        })
        .catch((error) => {
          if (pendingRtuRead?.point.id !== point.id) return
          completePendingRtuRead({
            kind: 'error',
            status: 'communication_error',
            message: formatError(error),
            elapsedMs: Math.max(0, Date.now() - startedAt),
          })
        })
    })
  } finally {
    if (temporaryListener && !isPolling.value) detachRtuListener()
  }
}

function applyResponse(
  point: ModbusMonitorPoint,
  response: ModbusReadResponse,
  details: { transport: ModbusTransport; requestHex: string; responseHex: string; elapsedMs: number }
) {
  if (response.exceptionCode !== undefined) {
    const message = modbusExceptionLabel(response.exceptionCode)
    updateRuntime(point.id, {
      status: 'exception',
      value: '—',
      rawHex: '',
      updatedAt: clock(),
      elapsedMs: details.elapsedMs,
      message,
      requestHex: details.requestHex,
      responseHex: details.responseHex,
    })
    addTransaction({
      pointName: point.name,
      transport: details.transport,
      result: 'exception',
      message,
      tx: details.requestHex,
      rx: details.responseHex,
      elapsedMs: details.elapsedMs,
    })
    return
  }

  const decoded = decodeModbusValue(point, response.data)
  updateRuntime(point.id, {
    status: 'ok',
    value: decoded.value,
    rawHex: decoded.rawHex,
    updatedAt: clock(),
    elapsedMs: details.elapsedMs,
    message: `${details.transport === 'rtu' ? 'RTU' : 'TCP'} 响应有效`,
    requestHex: details.requestHex,
    responseHex: details.responseHex,
  })
  addTransaction({
    pointName: point.name,
    transport: details.transport,
    result: 'ok',
    message: decoded.value,
    tx: details.requestHex,
    rx: details.responseHex,
    elapsedMs: details.elapsedMs,
  })
}

async function readPoint(point: ModbusMonitorPoint) {
  const activeTransport = transport.value
  let requestHex = ''
  updateRuntime(point.id, {
    status: 'reading',
    value: '—',
    rawHex: '',
    message: '正在发送只读请求…',
  })

  try {
    validateModbusMonitorPoint(point)
    if (activeTransport === 'rtu') {
      requestHex = formatModbusHex(buildModbusRtuRequest(point))
      const outcome = await readRtuPoint(point)
      if (outcome.kind === 'cancelled') return
      if (outcome.kind === 'timeout') {
        const message = `RTU 响应超时（${Number(timeoutMs.value)} ms）`
        updateRuntime(point.id, {
          status: 'timeout',
          value: '—',
          rawHex: '',
          updatedAt: clock(),
          elapsedMs: outcome.elapsedMs,
          message,
          requestHex,
          responseHex: '',
        })
        addTransaction({
          pointName: point.name,
          transport: activeTransport,
          result: 'error',
          message,
          tx: requestHex,
          elapsedMs: outcome.elapsedMs,
        })
        return
      }
      if (outcome.kind === 'error') {
        const responseHex = outcome.frame ? formatModbusHex(outcome.frame) : ''
        updateRuntime(point.id, {
          status: outcome.status,
          value: '—',
          rawHex: '',
          updatedAt: clock(),
          elapsedMs: outcome.elapsedMs,
          message: outcome.message,
          requestHex,
          responseHex,
        })
        addTransaction({
          pointName: point.name,
          transport: activeTransport,
          result: 'error',
          message: outcome.message,
          tx: requestHex,
          rx: responseHex,
          elapsedMs: outcome.elapsedMs,
        })
        return
      }
      applyResponse(point, outcome.response, {
        transport: activeTransport,
        requestHex,
        responseHex: formatModbusHex(outcome.frame),
        elapsedMs: outcome.elapsedMs,
      })
      return
    }

    const address = resolveModbusAddress(point)
    requestHex = `PDU ${formatModbusHex(buildModbusReadPdu(point))}`
    const response = await modbusTcpRead({
      host: tcp.host.trim(),
      port: Number(tcp.port),
      unitId: point.unitId,
      functionCode: point.functionCode,
      address,
      quantity: point.quantity,
      timeoutMs: Number(timeoutMs.value),
    })
    applyResponse(
      point,
      {
        unitId: response.unitId,
        functionCode: response.functionCode,
        data: Uint8Array.from(response.data),
        exceptionCode: response.exceptionCode,
      },
      {
        transport: activeTransport,
        requestHex: formatModbusHex(response.txAdu),
        responseHex: formatModbusHex(response.rxAdu),
        elapsedMs: response.elapsedMs,
      }
    )
  } catch (error) {
    const message = formatError(error)
    const status = message.includes('从站 ID') || message.includes('数量') || message.includes('参考地址') || message.includes('只支持') || message.includes('至少需要')
      ? 'validation_error'
      : statusFromError(message)
    updateRuntime(point.id, {
      status,
      value: '—',
      rawHex: '',
      updatedAt: clock(),
      message,
      requestHex,
      responseHex: '',
    })
    addTransaction({
      pointName: point.name,
      transport: activeTransport,
      result: 'error',
      message,
      tx: requestHex,
    })
  }
}

function validateCommunicationSettings(): void {
  const timeout = Number(timeoutMs.value)
  if (!Number.isInteger(timeout) || timeout < 150 || timeout > 10000) {
    throw new Error('通信超时必须在 150 到 10000 ms 之间')
  }
  if (transport.value === 'rtu' && !serial.connectedPort) {
    throw new Error('RTU 模式需要先在左下角打开公共串口')
  }
  if (transport.value === 'tcp') {
    const host = tcp.host.trim()
    const port = Number(tcp.port)
    const octets = host.split('.').map(Number)
    const validIpv4 =
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) &&
      octets.length === 4 &&
      octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
      !octets.every((octet) => octet === 0) &&
      !(octets[0] >= 224 && octets[0] <= 239) &&
      !octets.every((octet) => octet === 255)
    if (!validIpv4) {
      throw new Error('TCP 地址必须填写 IPv4 地址，例如 192.168.30.66')
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('TCP 端口必须在 1 到 65535 之间')
    }
  }
}

function validateSession(): void {
  if (enabledPointCount.value === 0) throw new Error('请至少启用一个点位再启动轮询')
  validateCommunicationSettings()
  const interval = Number(pollIntervalMs.value)
  if (!Number.isInteger(interval) || interval < 300 || interval > 60000) {
    throw new Error('轮询周期必须在 300 到 60000 ms 之间')
  }
  for (const point of points.value.filter((item) => item.enabled)) {
    validateModbusMonitorPoint(point)
  }
}

async function runPollCycle(generation: number) {
  if (isCycling.value || generation !== pollGeneration || !isPolling.value) return
  isCycling.value = true
  try {
    for (const point of points.value.filter((item) => item.enabled)) {
      if (generation !== pollGeneration || !isPolling.value) break
      await readPoint(point)
    }
    if (generation === pollGeneration && isPolling.value) {
      lastCycleAt.value = clock()
      statusMessage.value = `上一轮已完成：${successfulPointCount.value}/${enabledPointCount.value} 个点位响应有效。`
    }
  } finally {
    isCycling.value = false
    if (generation === pollGeneration && isPolling.value) {
      nextCycleTimer = window.setTimeout(() => {
        void runPollCycle(generation)
      }, Number(pollIntervalMs.value))
    }
  }
}

function startPolling() {
  if (isPolling.value) return
  try {
    validateSession()
    pollGeneration += 1
    const generation = pollGeneration
    isPolling.value = true
    if (transport.value === 'rtu') attachRtuListener()
    statusMessage.value = `${activeTransportLabel.value} 轮询已启动：按表格顺序逐点只读，不执行任何写操作。`
    void runPollCycle(generation)
  } catch (error) {
    statusMessage.value = `无法启动：${formatError(error)}`
  }
}

function stopPolling(message = '轮询已停止，实时值保留在当前表格中。') {
  pollGeneration += 1
  isPolling.value = false
  if (nextCycleTimer !== undefined) {
    window.clearTimeout(nextCycleTimer)
    nextCycleTimer = undefined
  }
  cancelPendingRtuRead()
  detachRtuListener()
  statusMessage.value = message
}

async function readOne(point: ModbusMonitorPoint) {
  if (isCycling.value || isPolling.value) {
    statusMessage.value = '轮询正在运行。为避免报文交叉，请先停止轮询后再执行单点读取。'
    return
  }
  try {
    validateCommunicationSettings()
    validateModbusMonitorPoint(point)
    isCycling.value = true
    statusMessage.value = `正在读取「${point.name}」…`
    await readPoint(point)
    const result = currentRuntime(point.id)
    statusMessage.value =
      result.status === 'ok'
        ? `单点读取成功：${point.name} = ${result.value || '—'}`
        : `单点读取未成功：${point.name} · ${result.message || statusLabel(result.status)}`
  } catch (error) {
    statusMessage.value = `无法读取：${formatError(error)}`
  } finally {
    isCycling.value = false
  }
}

function addPoint() {
  if (points.value.length >= MAX_MONITOR_POINTS) {
    statusMessage.value = `最多维护 ${MAX_MONITOR_POINTS} 个监视点。`
    return
  }
  points.value.push(defaultPoint(points.value.length + 1))
}

function clonePoint(index: number) {
  if (points.value.length >= MAX_MONITOR_POINTS) return
  const source = points.value[index]
  const clone = normalizePoint(
    {
      ...source,
      id: '',
      name: `${source.name} 副本`,
      address: source.address + Math.max(1, Number(source.quantity) || 1),
    },
    index + 2
  )
  points.value.splice(index + 1, 0, clone)
}

function removePoint(index: number) {
  const [removed] = points.value.splice(index, 1)
  if (removed) delete runtime[removed.id]
}

function invalidatePointRuntime(point: ModbusMonitorPoint) {
  if (!runtime[point.id]) return
  runtime[point.id] = {
    status: 'idle',
    value: '—',
    rawHex: '',
    message: '点位配置已变化，请重新读取',
  }
}

function normalizePointQuantity(point: ModbusMonitorPoint) {
  const required = requiredScalarQuantity(point.valueType)
  if (required !== null) point.quantity = required
}

function onFunctionChanged(point: ModbusMonitorPoint) {
  if (point.addressMode === 'reference') {
    // 功能码改变时重置到该区首地址，避免旧参考地址落入另一区后被静默解释为巨大偏移。
    point.address = referenceBase(point.functionCode)
  }
  if ([1, 2].includes(point.functionCode) && !['bool', 'raw'].includes(point.valueType)) {
    point.valueType = 'bool'
  }
  normalizePointQuantity(point)
  invalidatePointRuntime(point)
}

function onAddressModeChanged(point: ModbusMonitorPoint) {
  const base = referenceBase(point.functionCode)
  const address = Number(point.address)
  if (point.addressMode === 'offset') {
    point.address = Number.isInteger(address) && address >= base && address <= base + 0xffff
      ? address - base
      : 0
  } else {
    point.address = Number.isInteger(address) && address >= 0 && address <= 0xffff
      ? base + address
      : base
  }
  invalidatePointRuntime(point)
}

function onValueTypeChanged(point: ModbusMonitorPoint) {
  if ([1, 2].includes(point.functionCode) && !['bool', 'raw'].includes(point.valueType)) {
    point.valueType = 'bool'
  }
  normalizePointQuantity(point)
  invalidatePointRuntime(point)
}

function clearReadings() {
  if (isCycling.value) return
  for (const key of Object.keys(runtime)) delete runtime[key]
  transactions.value = []
  lastCycleAt.value = '—'
  statusMessage.value = '已清除实时值与本页事务记录，点位配置保持不变。'
}

async function copyTransactions() {
  if (transactions.value.length === 0) return
  try {
    await navigator.clipboard.writeText(
      transactions.value
        .map(
          (entry) =>
            `[${entry.timestamp}] ${entry.transport.toUpperCase()} ${entry.pointName} ${entry.result.toUpperCase()} ${entry.message}\nTX ${entry.tx}${entry.rx ? `\nRX ${entry.rx}` : ''}`
        )
        .join('\n\n')
    )
    statusMessage.value = '最近事务已复制到剪贴板。'
  } catch (error) {
    statusMessage.value = `复制失败：${formatError(error)}`
  }
}

function openSerialTool() {
  router.push('/serial')
}

onBeforeUnmount(() => {
  stopPolling('已离开 Modbus 调试页面，轮询已停止。')
})
</script>

<template>
  <main class="modbus-debugger">
    <header class="station-header">
      <div class="station-title">
        <div class="station-mark"><TableProperties :size="23" /></div>
        <div>
          <div class="eyebrow">NP-TOOLS · FIELD BUS WORKBENCH</div>
          <h1>Modbus RTU / TCP 调试</h1>
          <p>一张点位表覆盖串口 RTU 与 TCP；按顺序读取多个从站点位，实时显示只读结果。</p>
        </div>
      </div>
      <div class="run-status" :class="{ running: isPolling, busy: isCycling && !isPolling }">
        <span class="status-dot" />
        <div>
          <strong>{{ isPolling ? '轮询运行中' : isCycling ? '单点读取中' : '等待启动' }}</strong>
          <code>{{ activeTransportLabel }} · 已启用 {{ enabledPointCount }} 点 · 有效 {{ successfulPointCount }} 点</code>
        </div>
      </div>
    </header>

    <section class="connection-card" aria-label="通信连接设置">
      <div class="transport-switch" role="tablist" aria-label="Modbus 传输模式">
        <button
          type="button"
          class="transport-tab"
          :class="{ active: transport === 'rtu' }"
          :disabled="configurationLocked"
          role="tab"
          :aria-selected="transport === 'rtu'"
          @click="transport = 'rtu'"
        >
          <TerminalSquare :size="16" /> Modbus RTU
        </button>
        <button
          type="button"
          class="transport-tab"
          :class="{ active: transport === 'tcp' }"
          :disabled="configurationLocked"
          role="tab"
          :aria-selected="transport === 'tcp'"
          @click="transport = 'tcp'"
        >
          <EthernetPort :size="16" /> Modbus TCP
        </button>
      </div>

      <div v-if="transport === 'rtu'" class="connection-summary rtu-summary">
        <div class="connection-icon"><TerminalSquare :size="17" /></div>
        <div>
          <strong>{{ serial.connectedPort ? '公共串口已连接' : '公共串口未连接' }}</strong>
          <span>{{ serial.connectedPort ? `${serial.connectedPort} · ${serial.config.baudRate} bps` : '先选择串口、波特率和 485 转换器。' }}</span>
        </div>
        <button type="button" class="quiet-action" :disabled="configurationLocked" @click="openSerialTool">
          配置串口
        </button>
      </div>

      <div v-else class="tcp-fields">
        <label>
          <span>目标 IPv4</span>
          <input v-model.trim="tcp.host" :disabled="configurationLocked" inputmode="decimal" placeholder="192.168.30.66">
        </label>
        <label>
          <span>TCP 端口</span>
          <input v-model.number="tcp.port" :disabled="configurationLocked" type="number" min="1" max="65535" inputmode="numeric">
        </label>
        <div class="tcp-note"><EthernetPort :size="15" />后端直接建立一次只读 TCP 事务，不扫描网段、不保持长连接。</div>
      </div>

      <div class="shared-fields">
        <label>
          <span>响应超时 (ms)</span>
          <input v-model.number="timeoutMs" :disabled="configurationLocked" type="number" min="150" max="10000" step="50" inputmode="numeric">
        </label>
        <label>
          <span>轮询周期 (ms)</span>
          <input v-model.number="pollIntervalMs" :disabled="configurationLocked" type="number" min="300" max="60000" step="100" inputmode="numeric">
        </label>
        <div class="poll-actions">
          <button v-if="!isPolling" type="button" class="primary-action" :disabled="configurationLocked" @click="startPolling">
            <Play :size="15" />启动轮询
          </button>
          <button v-else type="button" class="stop-action" @click="stopPolling()">停止轮询</button>
          <small>上一轮：{{ lastCycleAt }}</small>
        </div>
      </div>
    </section>

    <section class="safety-strip" aria-label="Modbus 调试范围说明">
      <Info :size="17" />
      <div>
        <strong>只读监视模式</strong>
        <span>仅开放功能码 01–04；地址可选 PLC 参考地址或 PDU 0 基偏移。字节/字序仅用于数值解码，不改变 Modbus 地址的网络编码。</span>
      </div>
    </section>

    <section class="point-card">
      <div class="point-toolbar">
        <div>
          <h2>监视点位</h2>
          <p>启用的点位按表格顺序逐个读取；每次只保留一个在途请求，避免串口和低性能从站报文交叉。</p>
        </div>
        <div class="toolbar-actions">
          <button type="button" class="quiet-action" :disabled="configurationLocked" @click="clearReadings">
            <RefreshCw :size="14" />清除读数
          </button>
          <button type="button" class="primary-soft-action" :disabled="configurationLocked || points.length >= MAX_MONITOR_POINTS" @click="addPoint">
            <Plus :size="15" />添加点位
          </button>
        </div>
      </div>

      <div class="point-hints">
        <span><b>参考地址：</b>线圈 1、离散输入 10001、输入寄存器 30001、保持寄存器 40001 均会自动转换为 PDU 偏移。</span>
        <span><b>读取数量：</b>标量类型自动固定为 1 或 2；RAW_HEX 可批量读取。</span>
        <span><b>容量：</b>{{ points.length }} / {{ MAX_MONITOR_POINTS }} 点。</span>
      </div>

      <div class="table-scroll">
        <table class="point-table">
          <colgroup>
            <col class="col-enabled">
            <col class="col-name">
            <col class="col-unit-id">
            <col class="col-function">
            <col class="col-address-mode">
            <col class="col-address">
            <col class="col-quantity">
            <col class="col-value-type">
            <col class="col-byte-order">
            <col class="col-value">
            <col class="col-state">
            <col class="col-actions">
          </colgroup>
          <thead>
            <tr>
              <th class="center compact-col">启用</th>
              <th>点位名称</th>
              <th class="center small-col">从站 ID</th>
              <th>功能码</th>
              <th>地址语义</th>
              <th class="address-col">地址</th>
              <th class="center small-col">数量</th>
              <th>数据类型</th>
              <th>字节 / 字序</th>
              <th class="value-col">实时值</th>
              <th class="state-col">状态 / 时间</th>
              <th class="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(point, index) in points" :key="point.id" :class="{ disabled: !point.enabled }">
              <td class="center">
                <input v-model="point.enabled" :disabled="configurationLocked" type="checkbox" :aria-label="`启用 ${point.name}`">
              </td>
              <td><input v-model.trim="point.name" :disabled="configurationLocked" class="cell-input point-name" maxlength="32"></td>
              <td><input v-model.number="point.unitId" :disabled="configurationLocked" class="cell-input center-input" type="number" min="1" max="247" inputmode="numeric" @input="invalidatePointRuntime(point)"></td>
              <td>
                <select v-model.number="point.functionCode" :disabled="configurationLocked" class="cell-select" @change="onFunctionChanged(point)">
                  <option v-for="option in MODBUS_READ_FUNCTION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </td>
              <td>
                <select v-model="point.addressMode" :disabled="configurationLocked" class="cell-select" @change="onAddressModeChanged(point)">
                  <option v-for="option in MODBUS_ADDRESS_MODE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </td>
              <td><input v-model.number="point.address" :disabled="configurationLocked" class="cell-input mono-input" type="number" min="0" max="105536" inputmode="numeric" @input="invalidatePointRuntime(point)"></td>
              <td><input v-model.number="point.quantity" :disabled="configurationLocked || point.valueType !== 'raw'" class="cell-input center-input" type="number" min="1" :max="[1, 2].includes(point.functionCode) ? 2000 : 125" inputmode="numeric" :title="point.valueType === 'raw' ? 'RAW_HEX 可设置批量读取数量' : '标量类型的读取数量由数据类型自动确定'" @input="invalidatePointRuntime(point)"></td>
              <td>
                <select v-model="point.valueType" :disabled="configurationLocked" class="cell-select" @change="onValueTypeChanged(point)">
                  <option v-for="option in MODBUS_VALUE_TYPE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </td>
              <td>
                <select v-model="point.byteOrder" :disabled="configurationLocked || point.valueType === 'raw' || point.valueType === 'bool'" class="cell-select mono-select" @change="invalidatePointRuntime(point)">
                  <option v-for="option in MODBUS_BYTE_ORDER_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </td>
              <td class="value-cell">
                <strong :title="currentRuntime(point.id).rawHex">{{ currentRuntime(point.id).value || '—' }}</strong>
                <code v-if="currentRuntime(point.id).rawHex">{{ currentRuntime(point.id).rawHex }}</code>
              </td>
              <td class="state-cell">
                <span class="state-tag" :class="`state-${currentRuntime(point.id).status}`" :title="currentRuntime(point.id).message">{{ statusLabel(currentRuntime(point.id).status) }}</span>
                <small>{{ currentRuntime(point.id).updatedAt || '—' }}<template v-if="currentRuntime(point.id).elapsedMs !== undefined"> · {{ currentRuntime(point.id).elapsedMs }} ms</template></small>
              </td>
              <td class="row-actions">
                <button type="button" class="icon-button read" :disabled="configurationLocked" :title="`读取 ${point.name}`" @click="readOne(point)"><Play :size="14" /></button>
                <button type="button" class="icon-button" :disabled="configurationLocked || points.length >= MAX_MONITOR_POINTS" :title="`复制 ${point.name}`" @click="clonePoint(index)"><Copy :size="14" /></button>
                <button type="button" class="icon-button danger" :disabled="configurationLocked" :title="`删除 ${point.name}`" @click="removePoint(index)"><Trash2 :size="14" /></button>
              </td>
            </tr>
            <tr v-if="points.length === 0">
              <td colspan="12" class="empty-row"><AlertTriangle :size="16" />暂无监视点，点击“添加点位”后开始配置。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="transaction-card">
      <div class="transaction-header">
        <div>
          <h2>最近事务</h2>
          <p>保留本页最近 {{ MAX_TRANSACTION_HISTORY }} 条收发帧，便于比对从站异常、CRC 和 TCP MBAP。</p>
        </div>
        <button type="button" class="quiet-action" :disabled="transactions.length === 0" @click="copyTransactions"><Copy :size="14" />复制事务</button>
      </div>
      <div v-if="transactions.length === 0" class="empty-transactions">
        <Activity :size="17" />启动轮询或执行单点读取后，这里会显示 TX / RX 原始报文。
      </div>
      <div v-else class="transaction-list">
        <article v-for="entry in transactions" :key="entry.id" class="transaction-row" :class="entry.result">
          <div class="transaction-meta">
            <span>{{ entry.timestamp }}</span>
            <b>{{ entry.transport.toUpperCase() }}</b>
            <strong>{{ entry.pointName }}</strong>
            <em>{{ entry.result === 'ok' ? '有效' : entry.result === 'exception' ? '从站异常' : '失败' }}</em>
            <small v-if="entry.elapsedMs !== undefined">{{ entry.elapsedMs }} ms</small>
          </div>
          <p>{{ entry.message }}</p>
          <code>TX {{ entry.tx || '—' }}</code>
          <code v-if="entry.rx">RX {{ entry.rx }}</code>
        </article>
      </div>
    </section>

    <footer class="status-footer" :class="{ error: statusMessage.startsWith('无法') || statusMessage.startsWith('无法启动') }">
      <CheckCircle2 v-if="!statusMessage.startsWith('无法')" :size="16" />
      <AlertTriangle v-else :size="16" />
      <span>{{ statusMessage }}</span>
    </footer>
  </main>
</template>

<style scoped>
.modbus-debugger { min-height: 100%; padding: 16px; color: #17212b; background: #edf1f4; }
.station-header, .connection-card, .point-card, .transaction-card { border: 1px solid #b9c5cf; border-radius: 7px; background: #fff; box-shadow: 0 1px 4px rgba(27, 45, 58, .06); }
.station-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 18px; }
.station-title, .run-status, .connection-summary, .tcp-note, .safety-strip, .toolbar-actions, .poll-actions, .transaction-header, .transaction-meta, .empty-transactions, .status-footer { display: flex; align-items: center; }
.station-title { gap: 11px; }
.station-mark { width: 43px; height: 43px; display: grid; place-items: center; color: #fff; border-radius: 5px; background: #174d6b; box-shadow: inset 0 -2px rgba(0,0,0,.18); }
.eyebrow { color: #5b7280; font: 700 11px/1.2 var(--font-mono); letter-spacing: .1em; }
h1, h2, p { margin: 0; }
h1 { margin-top: 2px; font-size: 20px; }
h2 { color: #254559; font-size: 15px; }
.station-title p, .point-toolbar p, .transaction-header p { margin-top: 4px; color: #58707e; font-size: 12px; line-height: 1.5; }
.run-status { min-width: 274px; gap: 9px; padding: 9px 11px; border: 1px solid #c7d2d9; border-radius: 4px; background: #f7f9fa; }
.run-status.running { border-color: #92c8ad; background: #ecf8f1; }
.run-status.busy { border-color: #dbbf81; background: #fff8e8; }
.run-status > div { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.run-status strong { color: #3e5664; font-size: 12px; }
.run-status code { max-width: 270px; overflow: hidden; color: #6b7e89; font: 11px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.status-dot { width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; background: #82939d; box-shadow: 0 0 0 4px rgba(130,147,157,.12); }
.running .status-dot { background: #198257; box-shadow: 0 0 0 4px rgba(25,130,87,.13); }
.busy .status-dot { background: #bf7b1d; box-shadow: 0 0 0 4px rgba(191,123,29,.13); }
.connection-card { display: grid; grid-template-columns: 172px minmax(0, 1fr); grid-template-areas: "transport primary" "transport common"; gap: 12px 16px; align-items: stretch; margin-top: 12px; padding: 12px; }
.transport-switch { grid-area: transport; display: flex; flex-direction: column; gap: 5px; padding-right: 13px; border-right: 1px solid #d3dce2; }
.transport-tab { display: inline-flex; align-items: center; gap: 7px; min-width: 0; min-height: 34px; padding: 8px 10px; color: #516572; border: 1px solid transparent; border-radius: 4px; background: transparent; cursor: pointer; font-size: 12px; font-weight: 700; text-align: left; }
.transport-tab:hover:not(:disabled) { color: #174d6b; background: #eef5f8; }
.transport-tab.active { color: #0f5f9e; border-color: #a3c5da; background: #eaf5fb; box-shadow: inset 3px 0 #1769aa; }
.transport-tab:disabled { cursor: not-allowed; opacity: .58; }
.connection-summary { grid-area: primary; gap: 9px; min-width: 0; }
.connection-icon { width: 31px; height: 31px; display: grid; flex: 0 0 auto; place-items: center; color: #276a8c; border: 1px solid #b8d1df; border-radius: 4px; background: #eef7fb; }
.connection-summary > div:nth-child(2) { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.connection-summary strong { color: #2f5164; font-size: 12px; }
.connection-summary span { overflow: hidden; color: #6b7d87; font: 11px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.tcp-fields, .shared-fields { display: flex; align-items: end; flex-wrap: wrap; min-width: 0; gap: 8px 10px; }
.tcp-fields { grid-area: primary; }
.shared-fields { grid-area: common; justify-content: flex-start; padding-top: 10px; border-top: 1px solid #dbe4e9; }
.tcp-fields label, .shared-fields label { display: flex; min-width: 0; flex-direction: column; gap: 5px; color: #5a6d78; font-size: 12px; font-weight: 700; letter-spacing: .025em; }
.tcp-fields label:first-child { flex: 1 1 220px; width: auto; }
.tcp-fields label:nth-child(2) { flex: 0 0 104px; width: auto; }
.shared-fields label { flex: 0 1 132px; width: auto; }
.tcp-fields input, .shared-fields input { width: 100%; min-width: 0; height: 34px; box-sizing: border-box; padding: 5px 8px; color: #183444; border: 1px solid #b9c7d0; border-radius: 4px; background: #fbfcfd; font: 12px var(--font-mono); outline: none; }
.tcp-fields input:focus, .shared-fields input:focus, .cell-input:focus, .cell-select:focus { border-color: #3180af; box-shadow: 0 0 0 2px rgba(49,128,175,.12); }
.tcp-note { display: flex; align-items: center; flex: 1 1 250px; align-self: stretch; max-width: none; gap: 6px; padding: 6px 8px; color: #5e7684; border-left: 1px solid #d8e2e8; font-size: 12px; line-height: 1.4; }
.poll-actions { flex: 0 0 auto; flex-direction: row; align-items: center; gap: 8px; min-height: 34px; }
.poll-actions small { color: #70818b; font-size: 11px; text-align: left; white-space: nowrap; }
.primary-action, .stop-action, .quiet-action, .primary-soft-action { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 750; white-space: nowrap; }
.primary-action { color: #fff; border: 1px solid #1769aa; background: #1769aa; }
.primary-action:hover:not(:disabled) { background: #0f5f9e; }
.stop-action { color: #842b25; border: 1px solid #d49891; background: #fff2f0; }
.quiet-action { color: #365666; border: 1px solid #b9c8d1; background: #f8fafb; }
.primary-soft-action { color: #0d618f; border: 1px solid #9ec4dc; background: #eaf5fb; }
.quiet-action:hover:not(:disabled), .primary-soft-action:hover:not(:disabled) { filter: brightness(.97); }
.primary-action:disabled, .stop-action:disabled, .quiet-action:disabled, .primary-soft-action:disabled, .icon-button:disabled { cursor: not-allowed; opacity: .48; }
.safety-strip { gap: 9px; margin-top: 12px; padding: 10px 12px; color: #684b1c; border: 1px solid #e1c88f; border-left: 4px solid #c48322; border-radius: 5px; background: #fff8ea; }
.safety-strip > div { display: flex; flex-direction: column; gap: 2px; }
.safety-strip strong { font-size: 12px; }
.safety-strip span { font-size: 12px; line-height: 1.5; }
.point-card, .transaction-card { margin-top: 12px; overflow: hidden; }
.point-toolbar, .transaction-header { justify-content: space-between; gap: 12px; padding: 13px 14px; border-bottom: 1px solid #d4dee4; background: #fbfcfd; }
.toolbar-actions { flex: 0 0 auto; gap: 7px; }
.point-hints { display: flex; flex-wrap: wrap; gap: 6px 15px; padding: 9px 14px; color: #647781; border-bottom: 1px solid #e0e7eb; background: #f5f8fa; font-size: 12px; line-height: 1.5; }
.point-hints b { color: #315568; }
.table-scroll { overflow: auto; }
.point-table { width: 100%; min-width: 1420px; border-collapse: collapse; table-layout: fixed; }
.point-table th, .point-table td { box-sizing: border-box; }
.point-table th { padding: 9px 7px; color: #536975; border-bottom: 1px solid #cfdbe2; background: #edf3f6; font-size: 12px; font-weight: 750; letter-spacing: .02em; text-align: left; white-space: nowrap; }
.point-table td { height: 56px; padding: 6px 7px; border-bottom: 1px solid #e1e8ec; background: #fff; vertical-align: middle; }
.point-table tbody tr:hover td { background: #f9fcfd; }
.point-table tbody tr.disabled td { background: #f5f7f8; opacity: .68; }
.center { text-align: center !important; }
.col-enabled { width: 52px; }.col-name { width: 150px; }.col-unit-id { width: 78px; }.col-function { width: 148px; }.col-address-mode { width: 145px; }.col-address { width: 105px; }.col-quantity { width: 78px; }.col-value-type { width: 108px; }.col-byte-order { width: 112px; }.col-value { width: 185px; }.col-state { width: 138px; }.col-actions { width: 121px; }
.compact-col, .small-col, .address-col, .value-col, .state-col, .actions-col { width: auto; }
.actions-col { position: sticky; right: 0; z-index: 2; text-align: center !important; border-left: 1px solid #cfdbe2; }
.cell-input, .cell-select { width: 100%; min-width: 0; height: 32px; box-sizing: border-box; padding: 4px 6px; color: #1e3a49; border: 1px solid #c5d1d8; border-radius: 3px; background: #fff; font-size: 12px; outline: none; }
.cell-select { cursor: pointer; }
.point-name { min-width: 100px; }
.center-input { text-align: center; font-family: var(--font-mono); }
.mono-input, .mono-select { font-family: var(--font-mono); }
.value-cell { overflow: hidden; }
.value-cell strong { display: block; overflow: hidden; color: #174d6b; font: 700 12px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.value-cell code { display: block; max-width: 180px; margin-top: 2px; overflow: hidden; color: #788994; font: 11px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.state-cell { display: flex; flex-direction: column; gap: 4px; }
.state-cell small { color: #768792; font: 11px var(--font-mono); white-space: nowrap; }
.state-tag { display: inline-flex; width: fit-content; padding: 3px 6px; border: 1px solid #c8d3d9; border-radius: 9px; color: #647781; background: #f3f6f8; font-size: 11px; font-weight: 750; white-space: nowrap; }
.state-reading { color: #6f551b; border-color: #e5ca8e; background: #fff7e4; }
.state-ok { color: #176b48; border-color: #a8d1b9; background: #edf8f2; }
.state-timeout, .state-exception, .state-crc_error, .state-protocol_error, .state-communication_error, .state-validation_error { color: #9b342d; border-color: #e2a9a4; background: #fff0ef; }
.row-actions { position: sticky; right: 0; z-index: 1; min-width: 0; text-align: center; white-space: nowrap; border-left: 1px solid #d9e2e7; background: #fff; }
.row-actions .icon-button + .icon-button { margin-left: 6px; }
.point-table tbody tr:hover .row-actions { background: #f9fcfd; }
.point-table tbody tr.disabled .row-actions { background: #f5f7f8; }
.icon-button { display: inline-grid; width: 30px; height: 30px; flex: 0 0 30px; place-items: center; padding: 0; color: #526b78; border: 1px solid #c5d1d7; border-radius: 3px; background: #f8fafb; cursor: pointer; }
.icon-button.read { color: #0e6392; border-color: #a4c5d8; background: #eef8fd; }
.icon-button.danger { color: #9a3731; border-color: #dfb4b0; background: #fff5f4; }
.icon-button:hover:not(:disabled) { filter: brightness(.96); }
.empty-row { padding: 25px !important; color: #71838d; text-align: center; }
.empty-row svg { margin-right: 5px; vertical-align: middle; }
.transaction-card { margin-bottom: 12px; }
.transaction-header { border-bottom: 1px solid #d4dee4; }
.empty-transactions { justify-content: center; gap: 7px; min-height: 84px; color: #71838c; font-size: 12px; }
.transaction-list { max-height: 340px; overflow: auto; }
.transaction-row { display: grid; grid-template-columns: minmax(165px, .65fr) minmax(150px, .55fr) minmax(260px, 1.2fr) minmax(260px, 1.2fr); gap: 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid #e2e9ed; background: #fff; }
.transaction-row:last-child { border-bottom: none; }
.transaction-row.error, .transaction-row.exception { background: #fffbfa; }
.transaction-meta { flex-wrap: wrap; gap: 5px; color: #617682; font: 10px var(--font-mono); }
.transaction-meta b { padding: 2px 4px; color: #1a668e; border-radius: 3px; background: #eaf4f9; font-size: 10px; }
.transaction-meta strong { color: #314f60; font: 700 11px var(--font-sans); }
.transaction-meta em { padding: 2px 4px; color: #19704b; border-radius: 3px; background: #edf8f2; font-style: normal; font-size: 10px; font-weight: 700; }
.transaction-row.error .transaction-meta em, .transaction-row.exception .transaction-meta em { color: #9b342d; background: #fff0ef; }
.transaction-meta small { color: #7d8c95; font-size: 10px; }
.transaction-row p { overflow: hidden; color: #566d79; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.transaction-row code { display: block; overflow: hidden; color: #58717f; font: 10px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.status-footer { gap: 7px; margin: 0 1px; padding: 5px 2px 0; color: #396353; font-size: 12px; }
.status-footer.error { color: #9b342d; }
@media (max-width: 920px) { .connection-card { grid-template-columns: 1fr; grid-template-areas: "transport" "primary" "common"; } .transport-switch { flex-direction: row; padding: 0 0 9px; border-right: 0; border-bottom: 1px solid #d3dce2; } .transport-tab { flex: 1; } .transaction-row { grid-template-columns: minmax(165px,.7fr) minmax(170px,.7fr) 1fr; } .transaction-row code:last-child { grid-column: 2 / -1; } }
@media (max-width: 760px) { .modbus-debugger { padding: 10px; } .station-header, .connection-card, .point-toolbar, .transaction-header { align-items: flex-start; flex-direction: column; } .run-status { width: 100%; } .connection-card { display: flex; } .transport-switch { width: 100%; flex-direction: row; padding-right: 0; padding-bottom: 9px; border-right: 0; border-bottom: 1px solid #d3dce2; } .transport-tab { flex: 1; } .connection-summary, .tcp-fields, .shared-fields { width: 100%; } .tcp-fields, .shared-fields { flex-wrap: wrap; justify-content: flex-start; padding-left: 0; border-left: 0; } .shared-fields { padding-top: 10px; border-top: 1px solid #dbe4e9; } .tcp-fields label:first-child { flex: 1; width: auto; } .tcp-note { width: 100%; max-width: none; padding-left: 0; border-left: 0; } .toolbar-actions { width: 100%; } .transaction-row { grid-template-columns: 1fr; gap: 4px; } .transaction-row code:last-child { grid-column: auto; } }
</style>
