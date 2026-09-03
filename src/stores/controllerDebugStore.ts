import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  kz3GetDiagnostic,
  kz3GetPoint,
  kz3WritePoint,
  type DiagnosticResource
} from '../api/controllerDebugApi'
import { useControllerStore } from './controllerStore'
import { PROFILE_CATALOG } from '../utils/controllerIoCatalog'
import {
  isRuntimeClearBinding,
  pointValueMatchesType,
  pointValuesEqual,
  writeValueError
} from '../utils/controllerDebugValues'
import type {
  CompatibilityState,
  DebugLogEntry,
  DebugSessionReport,
  DebugTransportState,
  DeviceDebugSession,
  DiagnosticEnvelope,
  Kz3Diagnostics,
  Kz3HttpResponse,
  Kz3Scalar,
  ObservationState,
  PointDescriptor,
  PointQuality,
  PointSample,
  WriteEvent
} from '../types/controllerDebug'

const POLL_INTERVAL_MS = 1000
const LOCAL_STALE_AFTER_MS = 3000
const MAX_SELECTED_POINTS = 12
const WRITE_PERMIT_MS = 10 * 60 * 1000
const MIN_WRITE_INTERVAL_MS = 700
const POLL_DRAIN_TIMEOUT_MS = 10000
const MONITOR_STORAGE_PREFIX = 'np-tools:kz3-watch-list:'
const OPERATOR_STORAGE_KEY = 'np-tools:kz3-debug-operator'
const SITE_STORAGE_KEY = 'np-tools:kz3-debug-site'

class HttpResponseError extends Error {
  readonly status: number
  readonly code?: string
  readonly body: string

  constructor(response: Kz3HttpResponse) {
    let code: string | undefined
    let message = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(response.body) as { error?: { code?: string; message?: string } }
      code = parsed.error?.code
      message = parsed.error?.message || message
    } catch {
      // 原始响应会保留在错误对象中，不能用解析失败覆盖设备返回证据。
    }
    super(message)
    this.status = response.status
    this.code = code
    this.body = response.body
  }
}

function createId(prefix: string): string {
  const suffix =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${suffix}`
}

function parseSuccessJson<T>(response: Kz3HttpResponse): T {
  if (response.status < 200 || response.status >= 300) {
    throw new HttpResponseError(response)
  }
  try {
    return JSON.parse(response.body) as T
  } catch {
    throw new Error(`设备返回的 JSON 无法解析（HTTP ${response.status}）`)
  }
}

function errorDetail(error: unknown): string {
  if (error instanceof HttpResponseError) {
    return `HTTP ${error.status}${error.code ? ` / ${error.code}` : ''} / ${error.body}`
  }
  return error instanceof Error ? error.message : String(error)
}

export const useControllerDebugStore = defineStore('controllerDebug', () => {
  const controller = useControllerStore()
  const baseUrl = ref('http://192.168.11.59:8080')
  const operatorName = ref(
    typeof localStorage === 'undefined' ? '' : localStorage.getItem(OPERATOR_STORAGE_KEY) || ''
  )
  const siteName = ref(
    typeof localStorage === 'undefined' ? '' : localStorage.getItem(SITE_STORAGE_KEY) || ''
  )
  const transportState = ref<DebugTransportState>('disconnected')
  const compatibilityState = ref<CompatibilityState>('unverified')
  const session = ref<DeviceDebugSession | null>(null)
  const diagnostics = ref<Kz3Diagnostics>({})
  const selectedPointNames = ref<string[]>([])
  const samples = ref<Record<string, PointSample>>({})
  const logs = ref<DebugLogEntry[]>([])
  const writeEvents = ref<WriteEvent[]>([])
  const lastSuccessAt = ref<number | null>(null)
  const consecutiveErrors = ref(0)
  const consecutiveHealthErrors = ref(0)
  const isPolling = ref(false)
  const pollInFlight = ref(false)
  const writeInFlight = ref(false)
  const writePermitUntil = ref<number | null>(null)
  const writePermitReason = ref('')
  const now = ref(Date.now())
  let pollTimer: number | null = null
  let diagnosticCursor = 0
  let lastWriteAt = 0

  function projectSignature(): string {
    return `${controller.doc.project.id}@${controller.doc.project.version}`
  }

  function monitorStorageKey(): string {
    return `${MONITOR_STORAGE_PREFIX}${projectSignature()}`
  }

  function loadStoredMonitorList(): string[] {
    if (typeof localStorage === 'undefined') return []
    try {
      const value = JSON.parse(localStorage.getItem(monitorStorageKey()) || '[]')
      if (!Array.isArray(value)) return []
      const available = new Set(pointDescriptors.value.map((item) => item.name))
      return value
        .filter((item): item is string => typeof item === 'string' && available.has(item))
        .slice(0, MAX_SELECTED_POINTS)
    } catch {
      return []
    }
  }

  if (typeof window !== 'undefined') {
    window.setInterval(() => {
      now.value = Date.now()
      for (const sample of Object.values(samples.value)) {
        sample.localStale = now.value - sample.receivedAt > LOCAL_STALE_AFTER_MS
      }
      if (writePermitUntil.value !== null && now.value >= writePermitUntil.value) {
        disableWrites('写入许可已因 10 分钟无操作自动解除')
      }
    }, 1000)
  }

  const pointDescriptors = computed<PointDescriptor[]>(() => {
    const project = controller.doc.project
    return project.northbound.fields.map((field) => {
      let description = ''
      let unit: string | undefined
      let min: number | undefined
      let max: number | undefined
      let source: string | undefined
      let category: PointDescriptor['category'] = 'unknown'
      let valueSemantic = '业务北向值（设备未提供描述元数据）'

      if (field.bind.startsWith('parameter.')) {
        category = 'parameter'
        const name = field.bind.slice('parameter.'.length)
        const parameter = project.application_variables.parameters.find(
          (item) => item.name === name
        )
        description = parameter?.description || 'RAM 参数；设备复位后恢复工程默认值'
        unit = parameter?.unit
        min = parameter?.min
        max = parameter?.max
        valueSemantic = 'RAM 参数当前值（非持久化配置）'
      } else if (isRuntimeClearBinding(field.bind)) {
        category = 'command'
        description = field.description || '累计运行时间清零；单次触发后需核对秒数与清零状态'
        valueSemantic = '运行时间清零 one-shot 命令，不代表累计值已完成清零'
      } else if (field.bind.startsWith('command.')) {
        category = 'command'
        const name = field.bind.slice('command.'.length)
        const command = project.application_variables.commands.find((item) => item.name === name)
        description = command?.description || '一次性命令；由下一次逻辑扫描消费'
        valueSemantic = 'one-shot 命令槽，不代表逻辑或物理动作已完成'
      } else if (field.bind.startsWith('state.')) {
        category = 'state'
        const name = field.bind.slice('state.'.length)
        const state = project.application_variables.states.find((item) => item.name === name)
        description = state?.description || '应用逻辑可观测状态'
        valueSemantic = '应用逻辑状态'
      } else if (field.bind.startsWith('point.')) {
        const name = field.bind.slice('point.'.length)
        const input = project.points.inputs.find((item) => item.name === name)
        const output = project.points.outputs.find((item) => item.name === name)
        const point = input || output
        source = point?.source
        description = point?.description || point?.source || '业务 I/O 点'
        category = input ? 'input' : output ? 'output' : 'unknown'
        if (input) {
          valueSemantic = '业务输入采样值；质量码来自设备采样链路'
        } else if (output && source?.startsWith('board.')) {
          valueSemantic = '板载输出软件目标，不等同于端子物理反馈'
        } else if (output && source?.startsWith('rtu.')) {
          const [, deviceName, signalCode] = source.split('.')
          const device = project.devices.find((item) => item.name === deviceName)
          const signal = device
            ? PROFILE_CATALOG[device.profile]?.outputs.find((item) => item.code === signalCode)
            : undefined
          valueSemantic = signal?.hasFeedbackShadow
            ? 'Southbound 寄存器回读影子，不等同于真实物理反馈'
            : 'Southbound 输出运行值；反馈语义需结合 Profile 证据'
        }
      }

      let writeSupported = false
      let writeDisabledReason: string | undefined
      if (field.access !== 'read_write') {
        writeDisabledReason = '工程北向契约为只读'
      } else if (
        category === 'parameter' &&
        (field.c_type === 'bool' || field.c_type === 'float' || field.c_type === 'u32')
      ) {
        writeSupported = true
      } else if (category === 'command' && field.c_type === 'bool') {
        writeSupported = true
      } else if (category === 'parameter' && ['u16', 'i16', 'i32'].includes(field.c_type)) {
        writeDisabledReason = `当前固件尚未实现 ${field.c_type.toUpperCase()} parameter 写入链路`
      } else {
        writeDisabledReason = '当前固件仅允许 BOOL/FLOAT/U32 parameter 或 BOOL command 写入'
      }

      return {
        ...field,
        description,
        unit,
        min,
        max,
        source,
        category,
        valueSemantic,
        writeSupported,
        writeDisabledReason
      }
    })
  })

  selectedPointNames.value = loadStoredMonitorList()

  const isConnected = computed(
    () => transportState.value === 'online' || transportState.value === 'degraded'
  )
  const controllerFaultActive = computed(
    () => diagnostics.value.io?.data.controller_fault.active === true
  )
  const allHealthHealthy = computed(() => {
    const health = diagnostics.value.health?.data
    return Boolean(
      health?.watchdog_healthy &&
        health.storage_healthy &&
        health.network_healthy &&
        health.control_task_healthy
    )
  })
  const projectIdentityChanged = computed(() => {
    if (!session.value) return false
    return (
      session.value.expectedProjectId !== controller.doc.project.id ||
      session.value.expectedProjectVersion !== controller.doc.project.version
    )
  })
  const writePermitRemainingSeconds = computed(() => {
    if (writePermitUntil.value === null) return 0
    return Math.max(0, Math.ceil((writePermitUntil.value - now.value) / 1000))
  })
  const writesEnabled = computed(() => writePermitRemainingSeconds.value > 0)
  const canEnableWrites = computed(
    () =>
      isConnected.value &&
      compatibilityState.value === 'partial' &&
      !projectIdentityChanged.value &&
      !controllerFaultActive.value &&
      operatorName.value.trim().length > 0 &&
      diagnostics.value.device !== undefined &&
      diagnostics.value.health !== undefined &&
      diagnostics.value.io !== undefined &&
      allHealthHealthy.value &&
      consecutiveHealthErrors.value === 0
  )

  const sessionPhase = computed<
    'offline' | 'preflight' | 'monitoring' | 'degraded' | 'write-enabled'
  >(() => {
    if (transportState.value === 'connecting') return 'preflight'
    if (!isConnected.value) return 'offline'
    if (writesEnabled.value) return 'write-enabled'
    if (transportState.value === 'degraded') return 'degraded'
    return 'monitoring'
  })

  function isActiveSession(sessionId: string | undefined): boolean {
    return Boolean(
      sessionId &&
      session.value?.sessionId === sessionId &&
      session.value.endedAt === undefined &&
      transportState.value !== 'disconnected'
    )
  }

  function appendLog(
    level: DebugLogEntry['level'],
    scope: DebugLogEntry['scope'],
    message: string,
    detail?: string
  ) {
    logs.value.push({ id: createId('log'), timestamp: Date.now(), level, scope, message, detail })
    if (logs.value.length > 300) logs.value.splice(0, logs.value.length - 300)
  }

  function assignDiagnostic(resource: DiagnosticResource, envelope: DiagnosticEnvelope<unknown>) {
    switch (resource) {
      case 'device':
        diagnostics.value.device = envelope as Kz3Diagnostics['device']
        break
      case 'hardware':
        diagnostics.value.hardware = envelope as Kz3Diagnostics['hardware']
        break
      case 'network':
        diagnostics.value.network = envelope as Kz3Diagnostics['network']
        break
      case 'sle':
        diagnostics.value.sle = envelope as Kz3Diagnostics['sle']
        break
      case 'io':
        diagnostics.value.io = envelope as Kz3Diagnostics['io']
        break
      case 'config':
        diagnostics.value.config = envelope as Kz3Diagnostics['config']
        break
      case 'services':
        diagnostics.value.services = envelope as Kz3Diagnostics['services']
        break
      case 'health':
        diagnostics.value.health = envelope as Kz3Diagnostics['health']
        break
    }
  }

  function markSuccess(sessionId: string | undefined) {
    if (!isActiveSession(sessionId)) return
    lastSuccessAt.value = Date.now()
    consecutiveErrors.value = 0
    transportState.value = 'online'
  }

  function markFailure(sessionId: string | undefined) {
    if (!isActiveSession(sessionId)) return
    consecutiveErrors.value += 1
    transportState.value = 'degraded'
  }

  async function readDiagnostic(
    resource: DiagnosticResource,
    quiet = false,
    expectedSessionId = session.value?.sessionId
  ): Promise<void> {
    try {
      const response = await kz3GetDiagnostic(baseUrl.value, resource)
      if (!isActiveSession(expectedSessionId)) throw new Error('调试会话已结束，已丢弃过期诊断响应')
      const envelope = parseSuccessJson<DiagnosticEnvelope<unknown>>(response)
      if (
        envelope.api_version !== 'v1' ||
        typeof envelope.timestamp_ms !== 'number' ||
        !envelope.data
      ) {
        throw new Error(`/${resource} 响应不符合 KZ3 v1 诊断外层契约`)
      }
      assignDiagnostic(resource, envelope)
      markSuccess(expectedSessionId)
      if (resource === 'health') consecutiveHealthErrors.value = 0
      if (resource === 'io' && controllerFaultActive.value) {
        disableWrites('控制器存在 active fault，已解除北向写入许可')
      }
      if (!quiet)
        appendLog(
          'success',
          'diagnostic',
          `读取 /api/v1/${resource} 成功`,
          `${response.elapsedMs} ms`
        )
    } catch (error) {
      markFailure(expectedSessionId)
      if (!isActiveSession(expectedSessionId)) throw error
      if (resource === 'health') {
        consecutiveHealthErrors.value += 1
        if (consecutiveHealthErrors.value >= 3) {
          disableWrites('健康接口连续失败 3 次，已解除北向写入许可')
        }
      }
      appendLog('error', 'diagnostic', `读取 /api/v1/${resource} 失败`, errorDetail(error))
      throw error
    }
  }

  async function readPoint(
    name: string,
    quiet = false,
    expectedSessionId = session.value?.sessionId
  ): Promise<PointSample> {
    try {
      const response = await kz3GetPoint(baseUrl.value, name)
      if (!isActiveSession(expectedSessionId)) throw new Error('调试会话已结束，已丢弃过期点位响应')
      const data = parseSuccessJson<{ name: string; value: Kz3Scalar; quality: number }>(response)
      if (
        data.name !== name ||
        (typeof data.value !== 'boolean' && typeof data.value !== 'number')
      ) {
        throw new Error(`点位 ${name} 响应字段或 value 类型不符合本地 descriptor`)
      }
      if (!Number.isInteger(data.quality) || data.quality < 0 || data.quality > 4) {
        throw new Error(`点位 ${name} 返回未知质量码 ${data.quality}`)
      }
      const descriptor = pointDescriptors.value.find((item) => item.name === name)
      if (descriptor && !pointValueMatchesType(descriptor.c_type, data.value)) {
        compatibilityState.value = 'mismatch'
        const currentSession = session.value
        if (currentSession && currentSession.sessionId === expectedSessionId) {
          currentSession.compatibilityState = 'mismatch'
        }
        disableWrites(`点位 ${name} 类型与当前工程不一致，已解除写入许可`)
        throw new Error(`点位 ${name} 设备值类型与工程 ${descriptor.c_type} 不一致`)
      }
      const previous = samples.value[name]
      const changed =
        previous !== undefined &&
        !pointValuesEqual(previous.value, data.value, descriptor?.c_type)
      const sample: PointSample = {
        name,
        value: data.value,
        quality: data.quality as PointQuality,
        receivedAt: Date.now(),
        httpStatus: response.status,
        elapsedMs: response.elapsedMs,
        localStale: false,
        previousValue: previous?.value,
        changedAt: changed ? Date.now() : previous?.changedAt
      }
      samples.value[name] = sample
      markSuccess(expectedSessionId)
      if (!quiet)
        appendLog(
          'success',
          'point',
          `读取点位 ${name} 成功`,
          `${String(data.value)} / Q=${data.quality} / ${response.elapsedMs} ms`
        )
      return sample
    } catch (error) {
      markFailure(expectedSessionId)
      if (!isActiveSession(expectedSessionId)) throw error
      if (error instanceof HttpResponseError && error.status === 404) {
        compatibilityState.value = 'mismatch'
        if (session.value) session.value.compatibilityState = 'mismatch'
        disableWrites(`设备缺少当前工程点位 ${name}，工程兼容性已标记 mismatch`)
      }
      if (!quiet) appendLog('error', 'point', `读取点位 ${name} 失败`, errorDetail(error))
      throw error
    }
  }

  async function connect(): Promise<void> {
    stopPolling()
    disableWrites()
    transportState.value = 'connecting'
    compatibilityState.value = 'unverified'
    diagnostics.value = {}
    samples.value = {}
    consecutiveErrors.value = 0
    consecutiveHealthErrors.value = 0
    const project = controller.doc.project
    session.value = {
      sessionId: createId('kz3-debug'),
      startedAt: Date.now(),
      baseUrl: baseUrl.value.trim(),
      expectedProjectId: project.id,
      expectedProjectVersion: project.version,
      compatibilityState: 'unverified',
      operatorName: operatorName.value.trim() || undefined,
      siteName: siteName.value.trim() || undefined
    }
    const sessionId = session.value.sessionId
    appendLog(
      'info',
      'session',
      `开始连接 KZ3 控制器 ${baseUrl.value.trim()}`,
      `打开工程 ${project.id}@${project.version}`
    )

    try {
      await readDiagnostic('device', false, sessionId)
      const remaining: DiagnosticResource[] = [
        'hardware',
        'network',
        'sle',
        'config',
        'services',
        'health',
        'io'
      ]
      for (const resource of remaining) {
        try {
          await readDiagnostic(resource, false, sessionId)
        } catch {
          // 首次连接允许单个非身份诊断缺失，界面按 degraded 显示并保留原始错误。
        }
      }
      if (!isActiveSession(sessionId)) return
      compatibilityState.value = 'partial'
      if (session.value?.sessionId === sessionId) session.value.compatibilityState = 'partial'
      const stored = loadStoredMonitorList()
      if (
        selectedPointNames.value.length === 0 ||
        selectedPointNames.value.some(
          (name) => !pointDescriptors.value.some((item) => item.name === name)
        )
      ) {
        selectedPointNames.value =
          stored.length > 0 ? stored : pointDescriptors.value.slice(0, 8).map((item) => item.name)
      }
      appendLog(
        'warning',
        'session',
        '设备已连接，但工程兼容性只能部分确认',
        '当前固件没有 /project 或点位 manifest；写入前必须人工核对设备、工程与现场条件'
      )
      startPolling()
    } catch (error) {
      if (session.value?.sessionId === sessionId) {
        transportState.value = 'disconnected'
        session.value.endedAt = Date.now()
        appendLog('error', 'session', '连接 KZ3 控制器失败', errorDetail(error))
      }
      throw error
    }
  }

  function disconnect() {
    stopPolling()
    disableWrites('设备会话结束，已解除北向写入许可')
    if (session.value) session.value.endedAt = Date.now()
    transportState.value = 'disconnected'
    compatibilityState.value = 'unverified'
    appendLog('info', 'session', '已断开 KZ3 HTTP 调试会话')
  }

  async function pollOnce() {
    if (
      !session.value ||
      session.value.endedAt !== undefined ||
      pollInFlight.value ||
      !isConnected.value
    )
      return
    const sessionId = session.value.sessionId
    pollInFlight.value = true
    try {
      if (projectIdentityChanged.value) {
        compatibilityState.value = 'mismatch'
        session.value.compatibilityState = 'mismatch'
        disableWrites('打开工程身份已变化，已解除写入许可；请重新连接设备')
      }

      try {
        await readDiagnostic('io', true, sessionId)
      } catch {
        /* 日志已记录 */
      }
      if (!isActiveSession(sessionId)) return
      try {
        await readDiagnostic('health', true, sessionId)
      } catch {
        /* 日志已记录 */
      }
      if (!isActiveSession(sessionId)) return

      const slowResources: DiagnosticResource[] = ['services', 'network', 'sle', 'device']
      const slowResource = slowResources[diagnosticCursor % slowResources.length]
      diagnosticCursor += 1
      try {
        await readDiagnostic(slowResource, true, sessionId)
      } catch {
        /* 日志已记录 */
      }

      for (const name of selectedPointNames.value) {
        if (!isActiveSession(sessionId)) return
        try {
          await readPoint(name, true, sessionId)
        } catch {
          /* 单点失败不阻止其他监视点 */
        }
      }
    } finally {
      pollInFlight.value = false
    }
  }

  function scheduleNextPoll(delay = POLL_INTERVAL_MS) {
    if (!isPolling.value) return
    pollTimer = window.setTimeout(async () => {
      await pollOnce()
      scheduleNextPoll()
    }, delay)
  }

  function startPolling() {
    if (
      !session.value ||
      session.value.endedAt !== undefined ||
      !isConnected.value ||
      isPolling.value
    )
      return
    isPolling.value = true
    scheduleNextPoll(0)
  }

  function stopPolling() {
    isPolling.value = false
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  async function waitForPollingIdle() {
    const deadline = Date.now() + POLL_DRAIN_TIMEOUT_MS
    while (pollInFlight.value) {
      if (Date.now() >= deadline) {
        throw new Error('周期采样未能在 10 秒内结束，已取消本次写入')
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 25))
    }
  }

  function suspend() {
    stopPolling()
    disableWrites('离开在线调试页，已解除北向写入许可')
  }

  function togglePointSelection(name: string) {
    const index = selectedPointNames.value.indexOf(name)
    if (index >= 0) {
      selectedPointNames.value.splice(index, 1)
      return
    }
    if (selectedPointNames.value.length >= MAX_SELECTED_POINTS) {
      throw new Error(
        `最多同时监视 ${MAX_SELECTED_POINTS} 个点位，避免高频短连接占满控制器 HTTP client`
      )
    }
    selectedPointNames.value.push(name)
  }

  function clearPointSelection() {
    selectedPointNames.value = []
  }

  function selectDefaultPoints() {
    selectedPointNames.value = pointDescriptors.value.slice(0, 8).map((item) => item.name)
  }

  function enableWrites(reason: string) {
    if (!canEnableWrites.value) {
      throw new Error(
        '当前设备状态不满足写入门禁，请填写工程师并检查连接、工程身份、四项健康状态和控制器故障'
      )
    }
    if (session.value) {
      session.value.operatorName = operatorName.value.trim()
      session.value.siteName = siteName.value.trim() || undefined
    }
    const normalizedReason = reason.trim()
    if (!normalizedReason) throw new Error('解锁前必须填写本次测试编号或调试依据')
    writePermitReason.value = normalizedReason
    writePermitUntil.value = Date.now() + WRITE_PERMIT_MS
    appendLog(
      'warning',
      'write',
      '已启用北向调试写入 10 分钟',
      `工程师 ${operatorName.value.trim()}；依据 ${normalizedReason}；仅限 parameter/command`
    )
  }

  function disableWrites(reason?: string) {
    if (writePermitUntil.value !== null && reason) appendLog('warning', 'write', reason)
    writePermitUntil.value = null
    writePermitReason.value = ''
  }

  async function writePoint(
    name: string,
    value: Kz3Scalar,
    reason: string,
    expectedBeforeValue?: Kz3Scalar
  ): Promise<WriteEvent> {
    const descriptor = pointDescriptors.value.find((item) => item.name === name)
    if (!descriptor) throw new Error(`当前工程不存在北向点位 ${name}`)
    if (!descriptor.writeSupported)
      throw new Error(descriptor.writeDisabledReason || '当前点位不可写')
    if (!writesEnabled.value || !canEnableWrites.value)
      throw new Error('北向写入许可未启用或已失效')
    const auditReason = reason.trim() || writePermitReason.value.trim()
    if (!auditReason) throw new Error('当前写入许可缺少测试编号或调试依据')
    if (writeInFlight.value) throw new Error('已有写入请求在途，请等待完成')
    if (Date.now() - lastWriteAt < MIN_WRITE_INTERVAL_MS)
      throw new Error('写入操作过快，请稍后再试')
    const validationError = writeValueError(descriptor, value)
    if (validationError) throw new Error(validationError)

    const event: WriteEvent = {
      id: createId('write'),
      timestamp: Date.now(),
      descriptor: { ...descriptor },
      requestedValue: value,
      reason: auditReason,
      explicitConfirmation: true,
      transportOk: false,
      acceptedByOwner: null,
      readbackObserved: 'unknown',
      logicEffectObserved: 'unknown',
      physicalEffectObserved: 'unknown'
    }
    writeEvents.value.unshift(event)
    if (writeEvents.value.length > 100) writeEvents.value.length = 100
    writeInFlight.value = true
    lastWriteAt = Date.now()
    const sessionId = session.value?.sessionId
    const shouldResumePolling = isPolling.value
    stopPolling()

    try {
      if (!sessionId) throw new Error('写入前设备会话已经结束')
      await waitForPollingIdle()
      const before = await readPoint(name, true, sessionId)
      event.beforeValue = before.value
      if (
        expectedBeforeValue !== undefined &&
        !pointValuesEqual(before.value, expectedBeforeValue, descriptor.c_type)
      ) {
        throw new Error(
          `点位 ${name} 已从弹窗打开时的 ${String(expectedBeforeValue)} 变化为 ${String(before.value)}，已取消写入；请重新核对`
        )
      }

      const response = await kz3WritePoint(baseUrl.value, name, descriptor.bind, value)
      if (!isActiveSession(sessionId))
        throw new Error('写入响应到达时调试会话已结束，结果未知且不会重试')
      event.httpStatus = response.status
      event.responseBody = response.body
      if (response.status < 200 || response.status >= 300) throw new HttpResponseError(response)
      event.transportOk = true
      const result = parseSuccessJson<{ name: string; ok: boolean }>(response)
      event.acceptedByOwner = result.name === name && result.ok === true
      if (!event.acceptedByOwner) throw new Error('设备响应未确认目标 owner 接受写入')

      await new Promise<void>((resolve) => window.setTimeout(resolve, 120))
      try {
        const after = await readPoint(name, true, sessionId)
        event.afterValue = after.value
        event.readbackObserved =
          descriptor.category === 'parameter'
            ? pointValuesEqual(after.value, value, descriptor.c_type)
              ? 'passed'
              : 'failed'
            : 'unknown'
      } catch (error) {
        event.readbackObserved = 'unknown'
        appendLog('warning', 'write', `点位 ${name} 写入已接受，但写后读回失败`, errorDetail(error))
      }

      if (descriptor.category === 'parameter' && event.readbackObserved !== 'passed') {
        disableWrites('parameter 写后读回未通过，北向写入许可已自动解除')
      } else {
        writePermitUntil.value = Date.now() + WRITE_PERMIT_MS
      }
      appendLog(
        'write',
        'write',
        descriptor.category === 'command'
          ? `已触发一次命令 ${name}`
          : `已写入 RAM 参数 ${name} = ${String(value)}`,
        `HTTP ${response.status}；owner accepted；readback=${event.readbackObserved}；逻辑/物理效果仍为 unknown`
      )
      return event
    } catch (error) {
      if (error instanceof HttpResponseError) {
        event.errorCode = error.code
        event.acceptedByOwner = false
      }
      appendLog(
        'error',
        'write',
        `点位 ${name} 写入失败或结果未知，工具不会自动重试`,
        errorDetail(error)
      )
      disableWrites('写入失败或结果未知，北向写入许可已自动解除')
      throw error
    } finally {
      writeInFlight.value = false
      if (shouldResumePolling && isActiveSession(sessionId)) startPolling()
    }
  }

  function setWriteObservation(
    eventId: string,
    layer: 'logicEffectObserved' | 'physicalEffectObserved',
    state: ObservationState
  ) {
    const event = writeEvents.value.find((item) => item.id === eventId)
    if (event) event[layer] = state
  }

  function setWriteObservationNote(eventId: string, note: string) {
    const event = writeEvents.value.find((item) => item.id === eventId)
    if (event) event.observationNote = note.trim() || undefined
  }

  function clearLogs() {
    logs.value = []
  }

  function buildSessionReport(): DebugSessionReport {
    return {
      schema: 'kz3-debug-session/v1',
      exportedAt: Date.now(),
      verificationBoundary: {
        desktopTool: 'verified',
        hardwareHil: writeEvents.value.length > 0 ? 'in_progress' : 'deferred',
        fieldCommissioning: 'not_verified',
        note: '本报告记录桌面工具看到的 HTTP 诊断、受控写入与人工标注；只有工程师完成并签核相应测试后，才能形成 HIL 或现场结论。'
      },
      project: {
        id: controller.doc.project.id,
        name: controller.doc.project.name,
        version: controller.doc.project.version
      },
      session: session.value ? { ...session.value } : null,
      transport: {
        state: transportState.value,
        compatibility: compatibilityState.value,
        lastSuccessAt: lastSuccessAt.value,
        consecutiveErrors: consecutiveErrors.value
      },
      diagnostics: JSON.parse(JSON.stringify(diagnostics.value)) as Kz3Diagnostics,
      monitoredPoints: [...selectedPointNames.value],
      samples: Object.values(samples.value).map((item) => ({ ...item })),
      logs: logs.value.map((item) => ({ ...item })),
      writeEvents: writeEvents.value.map((item) => ({
        ...item,
        descriptor: { ...item.descriptor }
      }))
    }
  }

  watch(operatorName, (value) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(OPERATOR_STORAGE_KEY, value)
  })

  watch(siteName, (value) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SITE_STORAGE_KEY, value)
  })

  watch(
    selectedPointNames,
    (value) => {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(monitorStorageKey(), JSON.stringify(value))
    },
    { deep: true }
  )

  watch(
    () => projectSignature(),
    () => {
      samples.value = {}
      selectedPointNames.value = loadStoredMonitorList()
      if (session.value && session.value.endedAt === undefined) {
        compatibilityState.value = 'mismatch'
        session.value.compatibilityState = 'mismatch'
        disableWrites('打开工程身份已变化，已解除写入许可；请结束会话后重新连接')
      }
    }
  )

  return {
    baseUrl,
    operatorName,
    siteName,
    transportState,
    compatibilityState,
    session,
    diagnostics,
    selectedPointNames,
    samples,
    logs,
    writeEvents,
    lastSuccessAt,
    consecutiveErrors,
    consecutiveHealthErrors,
    isPolling,
    pollInFlight,
    writeInFlight,
    writePermitReason,
    pointDescriptors,
    isConnected,
    controllerFaultActive,
    allHealthHealthy,
    projectIdentityChanged,
    writePermitRemainingSeconds,
    writesEnabled,
    canEnableWrites,
    sessionPhase,
    connect,
    disconnect,
    startPolling,
    stopPolling,
    suspend,
    pollOnce,
    readDiagnostic,
    readPoint,
    togglePointSelection,
    clearPointSelection,
    selectDefaultPoints,
    enableWrites,
    disableWrites,
    writePoint,
    setWriteObservation,
    setWriteObservationNote,
    clearLogs,
    buildSessionReport
  }
})
