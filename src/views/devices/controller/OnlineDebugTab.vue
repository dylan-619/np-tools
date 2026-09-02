<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  Activity,
  Cable,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ClipboardList,
  Cpu,
  Download,
  Eye,
  EyeOff,
  HeartPulse,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Power,
  RefreshCw,
  Search,
  Send,
  Server,
  Shield,
  Trash2,
  X
} from 'lucide-vue-next'
import { appSaveFile } from '../../../api/sjzdApi'
import { useControllerStore } from '../../../stores/controllerStore'
import { useControllerDebugStore } from '../../../stores/controllerDebugStore'
import type {
  Kz3Scalar,
  ObservationState,
  PointDescriptor,
  PointQuality
} from '../../../types/controllerDebug'

const MAX_MONITOR_POINTS = 12
const DIAGNOSTIC_WIDTH_STORAGE_KEY = 'np_tools_kz3_diagnostic_width'
const DEFAULT_DIAGNOSTIC_WIDTH = 400
const MIN_DIAGNOSTIC_WIDTH = 340
const MAX_DIAGNOSTIC_WIDTH = 620
type PointGroupKey = 'commands' | 'parameters' | 'states' | 'process' | 'other'

function loadDiagnosticWidth() {
  if (typeof window === 'undefined') return DEFAULT_DIAGNOSTIC_WIDTH
  const savedValue = window.localStorage.getItem(DIAGNOSTIC_WIDTH_STORAGE_KEY)
  if (savedValue === null) return DEFAULT_DIAGNOSTIC_WIDTH
  const savedWidth = Number(savedValue)
  if (!Number.isFinite(savedWidth)) return DEFAULT_DIAGNOSTIC_WIDTH
  return Math.min(MAX_DIAGNOSTIC_WIDTH, Math.max(MIN_DIAGNOSTIC_WIDTH, savedWidth))
}

const POINT_GROUPS: Array<{
  key: PointGroupKey
  label: string
  description: string
  categories: PointDescriptor['category'][]
}> = [
  {
    key: 'commands',
    label: '控制命令',
    description: '一次性控制触发；写入后需核对状态与现场动作',
    categories: ['command']
  },
  {
    key: 'parameters',
    label: '可调参数',
    description: '运行期 RAM 调参；复位后恢复工程默认值',
    categories: ['parameter']
  },
  {
    key: 'states',
    label: '状态反馈',
    description: '应用逻辑状态、步骤与告警等只读上报',
    categories: ['state']
  },
  {
    key: 'process',
    label: '过程 I/O',
    description: '业务输入采样与输出运行值；仅用于观察',
    categories: ['input', 'output']
  },
  {
    key: 'other',
    label: '其他上报',
    description: '未归类的北向字段；按只读证据处理',
    categories: ['unknown']
  }
]

const controller = useControllerStore()
const debug = useControllerDebugStore()
const searchText = ref('')
const categoryFilter = ref<'all' | PointDescriptor['category']>('all')
const monitorOnly = ref(false)
const collapsedPointGroups = ref<Record<PointGroupKey, boolean>>({
  commands: false,
  parameters: false,
  states: false,
  process: false,
  other: false
})
const bottomMode = ref<'logs' | 'writes'>('logs')
const diagnosticOpen = ref(typeof window !== 'undefined' ? window.innerWidth > 1200 : true)
const diagnosticWidth = ref(loadDiagnosticWidth())
const diagnosticResizing = ref(false)
const dockExpanded = ref(true)
const writePermitOpen = ref(false)
const writePermitPhrase = ref('')
const writePermitReasonInput = ref('')
const writePermitAcknowledged = ref(false)
const writeDialogOpen = ref(false)
const writeTarget = ref<PointDescriptor | null>(null)
const writeBeforeValue = ref<Kz3Scalar | undefined>()
const writeBeforeReceivedAt = ref<number | undefined>()
const writeBooleanValue = ref(false)
const writeNumberValue = ref('')
const writeNumberInput = ref<HTMLInputElement | null>(null)
const writeReason = ref('')
const writeAcknowledged = ref(false)
const pendingWriteTarget = ref<PointDescriptor | null>(null)
let diagnosticResizeStartX = 0
let diagnosticResizeStartWidth = 0
let previousBodyCursor = ''
let previousBodyUserSelect = ''

const writePermitBlockReason = computed(() => {
  if (!debug.isConnected) return '请先连接设备并完成预检'
  if (!debug.operatorName.trim()) return '请先填写工程师姓名或工号'
  if (debug.projectIdentityChanged) return '打开的工程身份已变化，请结束会话后重新连接'
  if (debug.compatibilityState === 'mismatch') return '设备与当前工程不兼容，请核对工程和设备'
  if (debug.compatibilityState === 'unverified') return '设备预检尚未完成'
  if (!debug.diagnostics.device) return '缺少设备身份诊断结果'
  if (!debug.diagnostics.health || !debug.diagnostics.io) return '健康或 IO 诊断结果尚未就绪'
  if (debug.controllerFaultActive) return '控制器存在 active fault，请先排除故障'
  if (!debug.allHealthHealthy) return '四项健康门禁未全部通过'
  if (debug.consecutiveHealthErrors > 0) return '健康诊断存在连续读取错误'
  return null
})

function diagnosticWidthLimit() {
  if (typeof window === 'undefined') return MAX_DIAGNOSTIC_WIDTH
  const viewportAllowance = window.innerWidth > 1200 ? window.innerWidth - 520 : window.innerWidth - 24
  return Math.min(MAX_DIAGNOSTIC_WIDTH, Math.max(280, viewportAllowance))
}

function clampDiagnosticWidth(width: number) {
  const maximum = diagnosticWidthLimit()
  const minimum = Math.min(MIN_DIAGNOSTIC_WIDTH, maximum)
  return Math.min(maximum, Math.max(minimum, width))
}

function persistDiagnosticWidth() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DIAGNOSTIC_WIDTH_STORAGE_KEY, String(Math.round(diagnosticWidth.value)))
}

function handleDiagnosticResize(event: PointerEvent) {
  if (!diagnosticResizing.value) return
  diagnosticWidth.value = clampDiagnosticWidth(
    diagnosticResizeStartWidth + diagnosticResizeStartX - event.clientX
  )
}

function stopDiagnosticResize() {
  if (!diagnosticResizing.value) return
  diagnosticResizing.value = false
  window.removeEventListener('pointermove', handleDiagnosticResize)
  window.removeEventListener('pointerup', stopDiagnosticResize)
  window.removeEventListener('pointercancel', stopDiagnosticResize)
  document.body.style.cursor = previousBodyCursor
  document.body.style.userSelect = previousBodyUserSelect
  persistDiagnosticWidth()
}

function startDiagnosticResize(event: PointerEvent) {
  if (typeof window === 'undefined') return
  event.preventDefault()
  diagnosticResizing.value = true
  diagnosticResizeStartX = event.clientX
  diagnosticResizeStartWidth = diagnosticWidth.value
  previousBodyCursor = document.body.style.cursor
  previousBodyUserSelect = document.body.style.userSelect
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', handleDiagnosticResize)
  window.addEventListener('pointerup', stopDiagnosticResize)
  window.addEventListener('pointercancel', stopDiagnosticResize)
}

function adjustDiagnosticWidth(delta: number) {
  diagnosticWidth.value = clampDiagnosticWidth(diagnosticWidth.value + delta)
  persistDiagnosticWidth()
}

const filteredDescriptors = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()
  return debug.pointDescriptors.filter((descriptor) => {
    if (categoryFilter.value !== 'all' && descriptor.category !== categoryFilter.value) return false
    if (monitorOnly.value && !debug.selectedPointNames.includes(descriptor.name)) return false
    if (!keyword) return true
    return [
      descriptor.name,
      descriptor.bind,
      descriptor.description,
      descriptor.reference,
      descriptor.source
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword))
  })
})

const descriptorGroups = computed(() =>
  POINT_GROUPS.map((group) => {
    const descriptors = filteredDescriptors.value.filter((descriptor) =>
      group.categories.includes(descriptor.category)
    )
    return {
      ...group,
      descriptors,
      writableCount: descriptors.filter((descriptor) => descriptor.writeSupported).length,
      monitoredCount: descriptors.filter((descriptor) =>
        debug.selectedPointNames.includes(descriptor.name)
      ).length
    }
  }).filter((group) => group.descriptors.length > 0)
)

const allVisibleGroupsCollapsed = computed(
  () =>
    descriptorGroups.value.length > 0 &&
    descriptorGroups.value.every((group) => collapsedPointGroups.value[group.key])
)

function togglePointGroup(group: PointGroupKey) {
  collapsedPointGroups.value[group] = !collapsedPointGroups.value[group]
}

function toggleAllPointGroups() {
  const collapse = !allVisibleGroupsCollapsed.value
  descriptorGroups.value.forEach((group) => {
    collapsedPointGroups.value[group.key] = collapse
  })
}

const healthItems = computed(() => {
  const health = debug.diagnostics.health?.data
  return [
    { label: '看门狗', value: health?.watchdog_healthy },
    { label: '存储', value: health?.storage_healthy },
    { label: '网络', value: health?.network_healthy },
    { label: '控制任务', value: health?.control_task_healthy }
  ]
})
const allHealthGood = computed(
  () =>
    debug.diagnostics.health !== undefined && healthItems.value.every((item) => item.value === true)
)
const ioData = computed(() => debug.diagnostics.io?.data)
const boardAi = computed<Array<number | null>>(
  () => ioData.value?.ai_uA ?? [null, null, null, null]
)
const boardAo = computed<Array<number | null>>(() => ioData.value?.ao_target_uA ?? [null, null])
const phaseLabel = computed(
  () =>
    ({
      offline: '未连接',
      preflight: '正在预检',
      monitoring: debug.isPolling ? '在线监视' : '监视已暂停',
      degraded: '通信降级',
      'write-enabled': '北向写入已启用'
    })[debug.sessionPhase]
)
const writePermitLabel = computed(() => {
  const seconds = debug.writePermitRemainingSeconds
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
})
const preparedWriteValue = computed<Kz3Scalar | null>(() => {
  const descriptor = writeTarget.value
  if (!descriptor) return null
  if (descriptor.category === 'command') return true
  if (descriptor.c_type === 'bool') return writeBooleanValue.value
  if (writeNumberValue.value.trim() === '') return null
  const value = Number(writeNumberValue.value)
  return Number.isFinite(value) ? value : null
})
function isWriteValueValid(descriptor: PointDescriptor | null, value: Kz3Scalar | null) {
  if (!descriptor || value === null) return false
  if (typeof value === 'number') {
    if (descriptor.min !== undefined && value < descriptor.min) return false
    if (descriptor.max !== undefined && value > descriptor.max) return false
  }
  return true
}
const writeValueValid = computed(() =>
  isWriteValueValid(writeTarget.value, preparedWriteValue.value)
)
const canSubmitWrite = computed(
  () =>
    debug.writesEnabled &&
    !debug.writeInFlight &&
    writeReason.value.trim().length > 0 &&
    writeAcknowledged.value &&
    writeValueValid.value
)

function formatTime(timestamp?: number | null): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
}

function formatDateTime(timestamp?: number | null): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`
}

function formatIp(parts?: number[]): string {
  return parts?.length === 4 ? parts.join('.') : '—'
}

function formatValue(value: Kz3Scalar | undefined, descriptor?: PointDescriptor): string {
  if (value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (descriptor?.c_type === 'float')
    return `${Number(value).toFixed(3)}${descriptor.unit ? ` ${descriptor.unit}` : ''}`
  return `${value}${descriptor?.unit ? ` ${descriptor.unit}` : ''}`
}

function formatAnalog(value: number | null): string {
  return value === null ? '—' : (value / 1000).toFixed(3)
}

function sampleAge(receivedAt?: number): string {
  if (!receivedAt) return '无采样'
  const age = Math.max(0, Date.now() - receivedAt)
  if (age < 1000) return `${age} ms 前`
  if (age < 60000) return `${Math.floor(age / 1000)} s 前`
  return `${Math.floor(age / 60000)} min 前`
}

function recentlyChanged(name: string): boolean {
  const changedAt = debug.samples[name]?.changedAt
  return changedAt !== undefined && Date.now() - changedAt < 1800
}

function qualityMeta(quality?: PointQuality) {
  switch (quality) {
    case 1:
      return { label: 'GOOD', className: 'quality-good' }
    case 0:
      return { label: 'INIT', className: 'quality-init' }
    case 2:
      return { label: 'STALE', className: 'quality-stale' }
    case 3:
      return { label: 'OFFLINE', className: 'quality-offline' }
    case 4:
      return { label: 'BAD', className: 'quality-bad' }
    default:
      return { label: 'UNKNOWN', className: 'quality-none' }
  }
}

async function handleConnect() {
  try {
    await debug.connect()
    controller.showMessage('KZ3 HTTP 预检完成，已进入在线监视；北向写入保持锁定')
  } catch (error) {
    controller.showMessage(error instanceof Error ? error.message : String(error), false)
  }
}

function requestWritePermit(target?: PointDescriptor) {
  if (!debug.canEnableWrites) {
    controller.showMessage(`暂不能解锁：${writePermitBlockReason.value || '当前写入门禁不满足'}`, false)
    return
  }
  pendingWriteTarget.value = target || null
  writePermitPhrase.value = ''
  writePermitReasonInput.value = ''
  writePermitAcknowledged.value = false
  writePermitOpen.value = true
}

function confirmWritePermit() {
  if (
    writePermitPhrase.value.trim() !== '启用写入' ||
    !writePermitAcknowledged.value ||
    !writePermitReasonInput.value.trim()
  )
    return
  try {
    debug.enableWrites(writePermitReasonInput.value)
    writePermitOpen.value = false
    controller.showMessage('北向调试写入已解锁 10 分钟；离页、断线或故障将自动上锁')
    const target = pendingWriteTarget.value
    pendingWriteTarget.value = null
    if (target) openWriteDialog(target)
  } catch (error) {
    controller.showMessage(error instanceof Error ? error.message : String(error), false)
  }
}

function revokeWritePermit() {
  debug.disableWrites('工程师手动结束北向写入许可')
  writeDialogOpen.value = false
  controller.showMessage('北向写入已重新锁定')
}

function openWriteDialog(descriptor: PointDescriptor) {
  if (!descriptor.writeSupported) {
    controller.showMessage(descriptor.writeDisabledReason || '当前点位不可写', false)
    return
  }
  if (!debug.writesEnabled) {
    requestWritePermit(descriptor)
    return
  }
  if (writeDialogOpen.value && writeTarget.value?.id === descriptor.id) return
  writeTarget.value = descriptor
  const currentSample = debug.samples[descriptor.name]
  const currentValue = currentSample?.value
  writeBeforeValue.value = currentValue
  writeBeforeReceivedAt.value = currentSample?.receivedAt
  writeBooleanValue.value = typeof currentValue === 'boolean' ? currentValue : false
  writeNumberValue.value = typeof currentValue === 'number' ? String(currentValue) : ''
  writeReason.value = debug.writePermitReason
  writeAcknowledged.value = false
  writeDialogOpen.value = true
}

function updateBooleanDraft(value: boolean) {
  writeBooleanValue.value = value
  writeAcknowledged.value = false
}

function updateNumberDraft(event: Event) {
  writeNumberValue.value = (event.target as HTMLInputElement).value
  writeAcknowledged.value = false
}

function readVisibleWriteDraft(descriptor: PointDescriptor): Kz3Scalar | null {
  if (descriptor.category === 'command') return true
  if (descriptor.c_type === 'bool') return writeBooleanValue.value
  const rawValue = writeNumberInput.value?.value ?? writeNumberValue.value
  if (rawValue.trim() === '') return null
  const value = Number(rawValue)
  return Number.isFinite(value) ? value : null
}

async function submitWrite() {
  const descriptor = writeTarget.value
  if (!descriptor || !canSubmitWrite.value) return
  const value = readVisibleWriteDraft(descriptor)
  if (value === null || !isWriteValueValid(descriptor, value)) {
    controller.showMessage('待写入值为空、不是有效数值或超出允许范围', false)
    return
  }
  try {
    const event = await debug.writePoint(
      descriptor.name,
      value,
      writeReason.value,
      writeBeforeValue.value
    )
    writeDialogOpen.value = false
    openBottomMode('writes')
    controller.showMessage(
      event.readbackObserved === 'failed'
        ? `${descriptor.name} 请求值 ${String(value)} 已被 owner 接受，但写后读回为 ${String(event.afterValue)}，请立即核对`
        : `${descriptor.name} 请求值 ${String(value)} 写入已接受；逻辑与物理效果仍需人工确认`,
      event.readbackObserved !== 'failed'
    )
  } catch (error) {
    controller.showMessage(error instanceof Error ? error.message : String(error), false)
  }
}

function updateObservation(
  eventId: string,
  layer: 'logicEffectObserved' | 'physicalEffectObserved',
  event: Event
) {
  const value = (event.target as HTMLSelectElement).value as ObservationState
  debug.setWriteObservation(eventId, layer, value)
}

function updateObservationNote(eventId: string, event: Event) {
  debug.setWriteObservationNote(eventId, (event.target as HTMLInputElement).value)
}

async function handleRefreshPoint(name: string) {
  try {
    await debug.readPoint(name)
  } catch (error) {
    controller.showMessage(error instanceof Error ? error.message : String(error), false)
  }
}

function handleToggleMonitor(name: string) {
  try {
    debug.togglePointSelection(name)
  } catch (error) {
    controller.showMessage(error instanceof Error ? error.message : String(error), false)
  }
}

function togglePolling() {
  if (debug.isPolling) debug.stopPolling()
  else debug.startPolling()
}

function openBottomMode(mode: 'logs' | 'writes') {
  bottomMode.value = mode
  dockExpanded.value = true
}

async function exportSessionReport() {
  const content = JSON.stringify(debug.buildSessionReport(), null, 2)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const defaultName = `KZ3调试会话_${controller.doc.project.id}_${timestamp}.json`
  const savedPath = await appSaveFile(defaultName, content, 'KZ3 调试会话', 'json')
  if (savedPath) {
    controller.showMessage(`调试会话报告已导出至 ${savedPath}`)
    return
  }
  const blobUrl = URL.createObjectURL(
    new Blob([content], { type: 'application/json;charset=utf-8' })
  )
  const anchor = document.createElement('a')
  anchor.href = blobUrl
  anchor.download = defaultName
  anchor.click()
  URL.revokeObjectURL(blobUrl)
  controller.showMessage('调试会话报告已导出')
}

onMounted(() => {
  if (debug.session && debug.isConnected) debug.startPolling()
})

onUnmounted(() => {
  stopDiagnosticResize()
  debug.suspend()
})
</script>

<template>
  <div class="debug-workbench">
    <section class="target-rack">
      <div class="rack-brand">
        <div class="rack-kicker">COMMISSIONING SESSION</div>
        <div class="rack-title"><Activity :size="17" /><span>KZ3 在线调试</span></div>
      </div>
      <label class="rack-field url-field">
        <span>设备 HTTP 根地址</span>
        <div class="url-control">
          <span class="protocol-lock">HTTP</span><input
            v-model="debug.baseUrl"
            :disabled="debug.transportState !== 'disconnected'"
            aria-label="设备 HTTP 根地址"
            spellcheck="false"
            placeholder="http://192.168.11.59:8080"
            @keyup.enter="debug.transportState === 'disconnected' && handleConnect()"
          >
        </div>
      </label>
      <label class="rack-field metadata-field"><span>工程师</span><input
        v-model="debug.operatorName"
        :disabled="debug.writesEnabled"
        placeholder="姓名 / 工号"
      ></label>
      <label class="rack-field metadata-field site-field"><span>位置</span><input
        v-model="debug.siteName"
        :disabled="debug.writesEnabled"
        placeholder="实验室 / 站点"
      ></label>
      <div class="connection-state" :class="debug.transportState">
        <span class="state-led" />
        <div>
          <strong>{{ phaseLabel }}</strong><small>最后成功 {{ formatTime(debug.lastSuccessAt) }} · 错误
            {{ debug.consecutiveErrors }}</small>
        </div>
      </div>
      <button
        v-if="debug.transportState === 'disconnected'"
        class="rack-btn connect"
        @click="handleConnect"
      >
        <Cable :size="14" /> 连接并预检
      </button>
      <button
        v-else
        class="rack-btn disconnect"
        :disabled="debug.transportState === 'connecting'"
        @click="debug.disconnect()"
      >
        <Power :size="14" /> 结束会话
      </button>
    </section>

    <section class="identity-strip" :class="debug.compatibilityState">
      <div class="identity-item primary">
        <span>目标设备</span><strong>{{ debug.diagnostics.device?.data.serial_number || '尚无设备身份证据' }}</strong>
      </div>
      <div class="identity-item">
        <span>型号 / App</span><strong>{{ debug.diagnostics.device?.data.device_type || '—' }} /
          {{ debug.diagnostics.device?.data.app_version || '—' }}</strong>
      </div>
      <div class="identity-item">
        <span>当前工程</span><strong>{{ controller.doc.project.id }}@{{ controller.doc.project.version }}</strong>
      </div>
      <div class="identity-item">
        <span>兼容性</span><strong>{{ debug.compatibilityState.toUpperCase() }}</strong>
      </div>
      <div class="identity-item safety">
        <span>北向权限</span><strong>{{
          debug.writesEnabled ? '已解锁 · ' + writePermitLabel : '监视可用 · 写入锁定'
        }}</strong>
      </div>
      <button class="diagnostic-toggle" @click="diagnosticOpen = !diagnosticOpen">
        <PanelRightClose v-if="diagnosticOpen" :size="14" /><PanelRightOpen v-else :size="14" />
        诊断
      </button>
    </section>

    <div v-if="debug.projectIdentityChanged" class="critical-strip">
      <Shield :size="14" />打开的工程身份已变化。本会话仅供参考，请结束会话后重新连接。
    </div>

    <div class="commissioning-body">
      <section class="point-panel">
        <header class="panel-toolbar">
          <div class="panel-heading">
            <Eye :size="15" />
            <div><strong>监视表</strong><small>设备质量与本机时效分别显示</small></div>
            <span class="monitor-count" title="只有监视组参与周期轮询">监视
              {{ debug.selectedPointNames.length }}/{{ MAX_MONITOR_POINTS }} · 共
              {{ debug.pointDescriptors.length }}</span>
          </div>
          <div class="point-tools">
            <label class="search-box"><Search :size="13" /><input v-model="searchText" placeholder="点名 / Modbus 地址 / bind"></label>
            <select v-model="categoryFilter" aria-label="北向点位维度">
              <option value="all">全部维度</option>
              <option value="command">控制命令</option>
              <option value="parameter">可调参数</option>
              <option value="state">状态反馈</option>
              <option value="input">过程输入</option>
              <option value="output">过程输出</option>
              <option value="unknown">其他上报</option>
            </select>
            <button
              class="tool-btn"
              :class="{ active: monitorOnly }"
              @click="monitorOnly = !monitorOnly"
            >
              <Eye v-if="monitorOnly" :size="12" /><EyeOff v-else :size="12" />{{
                monitorOnly ? '仅监视组' : '全部点'
              }}
            </button>
            <button
              class="tool-btn optional-tool"
              title="恢复工程默认监视点"
              @click="debug.selectDefaultPoints()"
            >
              默认组
            </button>
            <button
              class="tool-btn optional-tool"
              :title="allVisibleGroupsCollapsed ? '展开当前分组' : '收起当前分组'"
              @click="toggleAllPointGroups"
            >
              <ChevronDown v-if="allVisibleGroupsCollapsed" :size="12" /><ChevronUp v-else :size="12" />{{
                allVisibleGroupsCollapsed ? '展开' : '收起'
              }}
            </button>
            <button
              class="tool-btn icon-only"
              title="清空监视组"
              @click="debug.clearPointSelection()"
            >
              <Trash2 :size="12" />
            </button>
            <button class="tool-btn" :disabled="!debug.isConnected" @click="togglePolling">
              <Pause v-if="debug.isPolling" :size="12" /><Play v-else :size="12" />{{
                debug.isPolling ? '暂停' : '继续'
              }}
            </button>
            <button
              class="tool-btn icon-only"
              :disabled="!debug.isConnected || debug.pollInFlight"
              title="立即采样"
              @click="debug.pollOnce()"
            >
              <RefreshCw :size="12" :class="{ spinning: debug.pollInFlight }" />
            </button>
          </div>
        </header>
        <div class="point-table-wrap">
          <table class="point-table">
            <thead>
              <tr>
                <th class="monitor-col">监视</th>
                <th>北向字段 / 描述</th>
                <th>Modbus 地址</th>
                <th>类型</th>
                <th>实时值</th>
                <th>质量</th>
                <th>时效</th>
                <th class="action-col">操作</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="group in descriptorGroups" :key="group.key">
                <tr class="point-group-row" :class="`group-${group.key}`">
                  <td colspan="8">
                    <button
                      class="point-group-toggle"
                      :aria-expanded="!collapsedPointGroups[group.key]"
                      @click="togglePointGroup(group.key)"
                    >
                      <ChevronDown v-if="collapsedPointGroups[group.key]" :size="14" /><ChevronUp v-else :size="14" />
                      <span class="group-copy"><strong>{{ group.label }}</strong><small :title="group.description">{{ group.description }}</small></span>
                      <span class="group-stat">{{ group.descriptors.length }} 点</span>
                      <span v-if="group.writableCount" class="group-access writable">{{ group.writableCount }} 可写</span><span v-else class="group-access readonly">只读</span>
                      <span class="group-monitored">{{ group.monitoredCount }} 监视</span>
                    </button>
                  </td>
                </tr>
                <tr
                  v-for="descriptor in group.descriptors"
                  v-show="!collapsedPointGroups[group.key]"
                  :key="descriptor.id"
                  :class="{
                    monitored: debug.selectedPointNames.includes(descriptor.name),
                    stale: debug.samples[descriptor.name]?.localStale,
                    changed: recentlyChanged(descriptor.name)
                  }"
                >
                  <td class="monitor-col">
                    <button
                      class="monitor-toggle"
                      :class="{ active: debug.selectedPointNames.includes(descriptor.name) }"
                      :title="
                        debug.selectedPointNames.includes(descriptor.name)
                          ? '从监视组移除'
                          : '加入监视组'
                      "
                      @click="handleToggleMonitor(descriptor.name)"
                    >
                      <Eye
                        v-if="debug.selectedPointNames.includes(descriptor.name)"
                        :size="13"
                      /><EyeOff v-else :size="13" />
                    </button>
                  </td>
                  <td>
                    <strong class="point-name" :title="descriptor.name">{{ descriptor.name }}</strong><small :title="descriptor.description">{{ descriptor.description }}</small>
                  </td>
                  <td>
                    <code
                      class="modbus-reference"
                      :title="`${descriptor.bind} · ${descriptor.valueSemantic}`"
                    >{{ descriptor.reference }}</code>
                  </td>
                  <td>
                    <span class="type-chip">{{ descriptor.c_type.toUpperCase() }}</span><span
                      class="access-chip"
                      :class="descriptor.access === 'read_write' ? 'rw' : 'r'"
                    >{{ descriptor.access === 'read_write' ? 'RW' : 'R' }}</span>
                  </td>
                  <td>
                    <span
                      class="live-value"
                      :class="{
                        boolean: typeof debug.samples[descriptor.name]?.value === 'boolean',
                        on: debug.samples[descriptor.name]?.value === true
                      }"
                    >{{ formatValue(debug.samples[descriptor.name]?.value, descriptor) }}</span><small v-if="recentlyChanged(descriptor.name)" class="changed-label">CHANGED</small>
                  </td>
                  <td>
                    <span
                      class="quality-chip"
                      :class="qualityMeta(debug.samples[descriptor.name]?.quality).className"
                    >{{ qualityMeta(debug.samples[descriptor.name]?.quality).label }}</span><small v-if="debug.samples[descriptor.name]?.localStale" class="local-stale">LOCAL STALE</small>
                  </td>
                  <td>
                    <span class="received-at">{{
                      sampleAge(debug.samples[descriptor.name]?.receivedAt)
                    }}</span><small v-if="debug.samples[descriptor.name]">{{ debug.samples[descriptor.name].elapsedMs }} ms</small>
                  </td>
                  <td class="action-col">
                    <button
                      class="row-btn"
                      :disabled="!debug.isConnected"
                      title="单次读取"
                      @click="handleRefreshPoint(descriptor.name)"
                    >
                      <RefreshCw :size="12" />
                    </button><button
                      v-if="descriptor.writeSupported"
                      class="row-btn write"
                      :class="{ locked: !debug.writesEnabled }"
                      :disabled="!debug.isConnected || debug.writeInFlight"
                      :title="debug.writesEnabled ? '受控写入' : '先解锁北向写入，再设置该点'"
                      @click="openWriteDialog(descriptor)"
                    >
                      <Send :size="12" />
                    </button>
                  </td>
                </tr>
              </template>
              <tr v-if="descriptorGroups.length === 0">
                <td colspan="8" class="empty-row">
                  {{
                    monitorOnly
                      ? '当前监视组为空。切换“全部点”后选择需要观察的点位。'
                      : '当前筛选条件下没有北向点位。'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!debug.isConnected" class="table-evidence-mask">
            <div>
              <EyeOff :size="22" /><strong>尚无有效设备采样</strong><span>连接并完成身份预检后开始在线监视；空值不会显示为 0 或 OFF。</span>
            </div>
          </div>
        </div>
      </section>

      <aside
        class="diagnostic-rail"
        :class="{ open: diagnosticOpen, resizing: diagnosticResizing }"
        :style="{
          width: `${diagnosticWidth}px`
        }"
      >
        <div
          class="diagnostic-resize-handle"
          role="separator"
          aria-label="调整设备诊断面板宽度"
          aria-orientation="vertical"
          :aria-valuemin="MIN_DIAGNOSTIC_WIDTH"
          :aria-valuemax="MAX_DIAGNOSTIC_WIDTH"
          :aria-valuenow="Math.round(diagnosticWidth)"
          tabindex="0"
          title="左右拖动调整诊断面板宽度"
          @pointerdown="startDiagnosticResize"
          @keydown.left.prevent="adjustDiagnosticWidth(24)"
          @keydown.right.prevent="adjustDiagnosticWidth(-24)"
        />
        <div class="diagnostic-scroll">
          <header>
            <div><Activity :size="14" /><strong>设备诊断</strong></div>
            <button @click="diagnosticOpen = false"><X :size="14" /></button>
          </header>
          <article class="diag-section">
            <h3><HeartPulse :size="13" />健康与故障</h3>
            <div class="health-matrix">
              <div
                v-for="item in healthItems"
                :key="item.label"
                class="health-cell"
                :class="item.value === true ? 'ok' : item.value === false ? 'bad' : 'unknown'"
              >
                <span class="mini-led" /><span>{{ item.label }}</span><strong>{{
                  item.value === true ? 'OK' : item.value === false ? 'FAIL' : '—'
                }}</strong>
              </div>
            </div>
            <div
              class="fault-line"
              :class="debug.controllerFaultActive ? 'active' : allHealthGood ? 'clear' : 'unknown'"
            >
              <CircleAlert :size="13" /><span v-if="debug.controllerFaultActive">FAULT {{ debug.diagnostics.io?.data.controller_fault.code }} / SOURCE
                {{ debug.diagnostics.io?.data.controller_fault.source }}</span><span v-else-if="allHealthGood">未报告 active fault</span><span v-else>健康证据不完整</span>
            </div>
            <small class="diag-foot">Reset {{ debug.diagnostics.health?.data.reset_reason || '—' }} · tick
              {{ debug.diagnostics.health?.timestamp_ms ?? '—' }} ms</small>
          </article>
          <article class="diag-section">
            <h3><Cpu :size="13" />设备身份</h3>
            <dl>
              <div>
                <dt>型号</dt>
                <dd>{{ debug.diagnostics.device?.data.device_type || '—' }}</dd>
              </div>
              <div>
                <dt>SN</dt>
                <dd>{{ debug.diagnostics.device?.data.serial_number || '—' }}</dd>
              </div>
              <div>
                <dt>App</dt>
                <dd>{{ debug.diagnostics.device?.data.app_version || '—' }}</dd>
              </div>
              <div>
                <dt>MAC</dt>
                <dd>{{ debug.diagnostics.hardware?.data.mac || '—' }}</dd>
              </div>
              <div>
                <dt>运行时间</dt>
                <dd>{{ formatDuration(debug.diagnostics.device?.data.uptime_seconds) }}</dd>
              </div>
            </dl>
          </article>
          <article class="diag-section">
            <h3><Network :size="13" />网络与服务</h3>
            <div class="network-address">
              <strong>{{ formatIp(debug.diagnostics.network?.data.ip) }}</strong><span>:{{ debug.diagnostics.network?.data.http_port ?? '—' }}</span>
            </div>
            <div class="service-line">
              <Server :size="12" /><span>HTTP</span><strong>{{
                debug.diagnostics.services
                  ? debug.diagnostics.services.data.http.running
                    ? 'RUN'
                    : 'STOP'
                  : '—'
              }}</strong><small>{{
                debug.diagnostics.services
                  ? `${debug.diagnostics.services.data.http.requests} req / ${debug.diagnostics.services.data.http.errors} err`
                  : '无证据'
              }}</small>
            </div>
            <div class="service-line">
              <Activity :size="12" /><span>Modbus TCP</span><strong>{{
                debug.diagnostics.services
                  ? debug.diagnostics.services.data.modbus_tcp.running
                    ? 'RUN'
                    : 'STOP'
                  : '—'
              }}</strong><small>{{
                debug.diagnostics.services
                  ? `${debug.diagnostics.services.data.modbus_tcp.clients} client`
                  : '无证据'
              }}</small>
            </div>
          </article>
          <article class="diag-section io-section">
            <h3><Activity :size="13" />板级 I/O 快照 <em>目标 ≠ 物理反馈</em></h3>
            <div class="bank-row">
              <span>DI 采样</span>
              <div class="bit-row">
                <i
                  v-for="bit in 12"
                  :key="`di-${bit}`"
                  :class="{
                    on: ioData && (ioData.di_bitmap & (1 << (bit - 1))) !== 0,
                    unknown: !ioData
                  }"
                >{{ bit }}</i>
              </div>
            </div>
            <div class="bank-row">
              <span>DO 目标</span>
              <div class="bit-row">
                <i
                  v-for="bit in 8"
                  :key="`do-${bit}`"
                  class="output"
                  :class="{
                    on: ioData && (ioData.do_target_bitmap & (1 << (bit - 1))) !== 0,
                    unknown: !ioData
                  }"
                >{{ bit }}</i>
              </div>
            </div>
            <div class="analog-grid">
              <div v-for="(value, index) in boardAi" :key="`ai-${index}`">
                <span>AI{{ index + 1 }}</span><strong>{{ formatAnalog(value) }}</strong><small>mA 采样</small>
              </div>
              <div v-for="(value, index) in boardAo" :key="`ao-${index}`" class="ao">
                <span>AO{{ index + 1 }}</span><strong>{{ formatAnalog(value) }}</strong><small>mA 目标</small>
              </div>
            </div>
          </article>
        </div>
      </aside>
    </div>

    <section class="event-dock" :class="{ collapsed: !dockExpanded }">
      <header>
        <div class="dock-tabs">
          <button :class="{ active: bottomMode === 'logs' }" @click="openBottomMode('logs')">
            <ClipboardList :size="13" />会话日志 <span>{{ debug.logs.length }}</span>
          </button><button :class="{ active: bottomMode === 'writes' }" @click="openBottomMode('writes')">
            <Send :size="13" />写入证据 <span>{{ debug.writeEvents.length }}</span>
          </button>
        </div>
        <div class="dock-actions">
          <span class="verification-boundary">写入测试已开放 · 结论待记录</span><button @click="exportSessionReport"><Download :size="12" />导出会话</button><button v-if="bottomMode === 'logs'" @click="debug.clearLogs()">
            <Trash2 :size="12" />清空
          </button><button class="icon-action" @click="dockExpanded = !dockExpanded">
            <ChevronDown v-if="dockExpanded" :size="13" /><ChevronUp v-else :size="13" />
          </button>
        </div>
      </header>
      <div v-if="dockExpanded && bottomMode === 'logs'" class="log-list">
        <div
          v-for="entry in [...debug.logs].reverse()"
          :key="entry.id"
          class="log-row"
          :class="entry.level"
        >
          <time>{{ formatTime(entry.timestamp) }}</time><span>{{ entry.scope.toUpperCase() }}</span><strong>{{ entry.message }}</strong><code v-if="entry.detail">{{ entry.detail }}</code>
        </div>
        <div v-if="debug.logs.length === 0" class="dock-empty">
          尚无会话日志。连接预检、诊断异常和人工操作会记录在此。
        </div>
      </div>
      <div v-if="dockExpanded && bottomMode === 'writes'" class="write-event-list">
        <article v-for="event in debug.writeEvents" :key="event.id" class="write-event">
          <div>
            <time>{{ formatDateTime(event.timestamp) }}</time><strong>{{ event.descriptor.name }} = {{ String(event.requestedValue) }}</strong><span>{{ event.reason }}</span>
          </div>
          <div class="evidence-chain">
            <span :class="event.transportOk ? 'passed' : 'failed'">传输 {{ event.transportOk ? 'OK' : '?' }}</span><span
              :class="
                event.acceptedByOwner === true
                  ? 'passed'
                  : event.acceptedByOwner === false
                    ? 'failed'
                    : 'unknown'
              "
            >Owner
              {{
                event.acceptedByOwner === true
                  ? '接受'
                  : event.acceptedByOwner === false
                    ? '拒绝'
                    : '未知'
              }}</span><span :class="event.readbackObserved">读回 {{ event.readbackObserved }}</span><span :class="event.logicEffectObserved">逻辑 {{ event.logicEffectObserved }}</span><span :class="event.physicalEffectObserved">物理 {{ event.physicalEffectObserved }}</span>
          </div>
          <div class="observation-editor">
            <label>逻辑效果<select
              :value="event.logicEffectObserved"
              @change="updateObservation(event.id, 'logicEffectObserved', $event)"
            >
              <option value="unknown">未观察</option>
              <option value="passed">符合预期</option>
              <option value="failed">不符合预期</option>
            </select></label><label>物理效果<select
              :value="event.physicalEffectObserved"
              @change="updateObservation(event.id, 'physicalEffectObserved', $event)"
            >
              <option value="unknown">未观察</option>
              <option value="passed">符合预期</option>
              <option value="failed">不符合预期</option>
            </select></label><label class="observation-note">观察备注<input
              :value="event.observationNote"
              placeholder="端子、负载、联锁或异常现象"
              @change="updateObservationNote(event.id, $event)"
            ></label>
          </div>
        </article>
        <div v-if="debug.writeEvents.length === 0" class="dock-empty">
          尚无北向写入记录。每次写入都会保存写前值、请求值、Owner 接受、读回和人工观察结果。
        </div>
      </div>
    </section>

    <section class="write-release-note">
      <Shield :size="13" /><strong>{{
        debug.writesEnabled ? '北向写入许可已启用' : '北向写入默认锁定'
      }}</strong><span>{{
        debug.writesEnabled
          ? '剩余 ' + writePermitLabel + '；仅允许 BOOL/FLOAT parameter 与 BOOL command，写后自动读回。'
          : '连接预检后由工程师显式解锁；离页、断线、工程变化、健康异常或 active fault 会自动上锁。'
      }}</span><button
        v-if="debug.writesEnabled"
        class="revoke"
        @click="revokeWritePermit"
      >
        立即上锁
      </button><button
        v-else
        :class="{ blocked: !debug.canEnableWrites }"
        :title="debug.canEnableWrites ? '打开写入许可确认' : writePermitBlockReason || '查看未满足的解锁条件'"
        @click="requestWritePermit()"
      >
        解锁写入
      </button>
    </section>

    <div
      v-if="writePermitOpen"
      class="write-modal-backdrop"
    >
      <section
        class="write-modal permit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permit-title"
      >
        <header>
          <div><Shield :size="18" /><strong id="permit-title">解锁北向调试写入</strong></div>
          <button aria-label="关闭" @click="writePermitOpen = false"><X :size="16" /></button>
        </header>
        <div class="write-modal-body">
          <div class="write-warning">
            <CircleAlert :size="18" />
            <div><strong>这是有副作用的 PLC 在线操作</strong><span>HTTP 没有 TLS、登录、CAS 或 command request ID。成功响应只证明 RAM Owner 接受，不证明联锁允许或现场设备已经动作。</span></div>
          </div>
          <dl class="permit-evidence">
            <div><dt>目标设备</dt><dd>{{ debug.diagnostics.device?.data.serial_number || '无 SN 证据' }}</dd></div>
            <div><dt>当前工程</dt><dd>{{ controller.doc.project.id }}@{{ controller.doc.project.version }}</dd></div>
            <div><dt>工程师</dt><dd>{{ debug.operatorName || '未填写' }}</dd></div>
            <div><dt>健康门禁</dt><dd>{{ debug.allHealthHealthy ? '四项正常' : '不满足' }}</dd></div>
          </dl>
          <label class="permit-reason"><span>本次测试编号 / 调试依据</span><input
            v-model="writePermitReasonInput"
            maxlength="160"
            placeholder="例如：HIL-023，PID 闭环参数验证"
          ></label>
          <label class="write-check"><input v-model="writePermitAcknowledged" type="checkbox"><span>我已核对设备、工程、联锁条件和现场安全，接受 10 分钟后自动上锁。</span></label>
          <label class="confirm-phrase"><span>输入 <strong>启用写入</strong> 进行确认</span><input
            v-model="writePermitPhrase"
            autocomplete="off"
            placeholder="启用写入"
            @keyup.enter="confirmWritePermit"
          ></label>
        </div>
        <footer>
          <button class="secondary" @click="writePermitOpen = false">取消</button><button
            class="danger"
            :disabled="
              writePermitPhrase.trim() !== '启用写入' ||
                !writePermitAcknowledged ||
                !writePermitReasonInput.trim()
            "
            @click="confirmWritePermit"
          >
            解锁 10 分钟
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="writeDialogOpen && writeTarget"
      class="write-modal-backdrop"
    >
      <section
        class="write-modal point-write-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="write-title"
      >
        <header>
          <div>
            <Send :size="18" /><strong id="write-title">{{
              writeTarget.category === 'command' ? '触发一次命令' : '修改 RAM 参数'
            }}</strong>
          </div>
          <button aria-label="关闭" @click="writeDialogOpen = false"><X :size="16" /></button>
        </header>
        <div class="write-modal-body">
          <div class="write-target-summary">
            <strong>{{ writeTarget.name }}</strong><span>{{ writeTarget.description }}</span>
            <code>{{ writeTarget.bind }} · {{ writeTarget.c_type.toUpperCase() }} · {{ writeTarget.reference }}</code>
          </div>
          <div class="write-before-row"><span>打开时读值</span><strong>{{ formatValue(writeBeforeValue, writeTarget) }}</strong><small>采样 {{ formatTime(writeBeforeReceivedAt) }} · 提交前会重新读取</small></div>
          <div v-if="writeTarget.category === 'command'" class="command-value">
            <CircleAlert :size="16" /><span>将单次写入 <strong>TRUE</strong>。本次许可保持有效；工具不会保持、复位或自动重试，请通过关联 state/output 判断逻辑效果。</span>
          </div>
          <fieldset v-else-if="writeTarget.c_type === 'bool'" class="boolean-write">
            <legend>目标值</legend>
            <button :class="{ active: writeBooleanValue === false }" @click="updateBooleanDraft(false)">FALSE</button><button :class="{ active: writeBooleanValue === true }" @click="updateBooleanDraft(true)">TRUE</button>
          </fieldset>
          <label v-else class="number-write"><span>目标值（用户草稿，不随轮询更新）{{ writeTarget.unit ? '（' + writeTarget.unit + '）' : '' }}</span><input
            ref="writeNumberInput"
            :value="writeNumberValue"
            type="number"
            :min="writeTarget.min"
            :max="writeTarget.max"
            step="any"
            @input="updateNumberDraft"
          ><small>允许范围 {{ writeTarget.min ?? '—' }} ～ {{ writeTarget.max ?? '—' }}</small></label>
          <div class="write-draft-row"><span>本次请求值</span><strong>{{ formatValue(preparedWriteValue ?? undefined, writeTarget) }}</strong><small>提交时以输入框可见值为准</small></div>
          <label class="write-reason"><span>测试依据（已从本次解锁许可带入，可按点补充）</span><textarea
            v-model="writeReason"
            maxlength="160"
            placeholder="必填，例如：HIL-023，验证 PID 设定值读回"
          /></label>
          <label class="write-check"><input v-model="writeAcknowledged" type="checkbox"><span>我确认点名、打开时读值和本次请求值无误；写入后将核对读回、逻辑效果和物理效果。</span></label>
        </div>
        <footer>
          <span class="permit-countdown">许可剩余 {{ writePermitLabel }}</span><button
            class="secondary"
            @click="writeDialogOpen = false"
          >
            取消
          </button><button class="danger" :disabled="!canSubmitWrite" @click="submitWrite">
            {{
              debug.writeInFlight
                ? '写入中…'
                : writeTarget.category === 'command'
                  ? '触发一次'
                  : '确认写入'
            }}
          </button>
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.debug-workbench {
  --debug-canvas: #eef2f5;
  --debug-surface: #ffffff;
  --debug-surface-subtle: #f6f8fa;
  --debug-surface-strong: #e8edf2;
  --debug-border: #b9c5cf;
  --debug-border-soft: #d5dde4;
  --debug-text: #17212b;
  --debug-text-secondary: #40515f;
  --debug-text-muted: #5f6f7d;
  --debug-blue: #1769aa;
  --debug-blue-soft: #e7f1fa;
  --debug-green: #176b45;
  --debug-green-soft: #e7f5ed;
  --debug-amber: #7a4b00;
  --debug-amber-soft: #fff3d2;
  --debug-red: #a12d34;
  --debug-red-soft: #fdebed;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
  overflow: hidden;
  color: var(--debug-text);
  background: var(--debug-canvas);
}
.target-rack {
  display: grid;
  grid-template-columns:
    166px minmax(260px, 1.5fr) minmax(105px, 0.55fr) minmax(105px, 0.55fr)
    minmax(155px, 0.7fr) auto;
  align-items: end;
  gap: 7px;
  padding: 7px 8px;
  border: 1px solid #385064;
  border-left: 3px solid #3b82f6;
  border-radius: 4px;
  background: linear-gradient(105deg, #111a22, #17232d 55%, #121b23);
  flex-shrink: 0;
}
.rack-kicker {
  margin-bottom: 4px;
  color: #5d7890;
  font: 700 8px/1 var(--font-mono);
  letter-spacing: 0.16em;
}
.rack-title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #edf6ff;
  font-size: 13px;
  font-weight: 750;
}
.rack-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rack-field > span {
  color: #7f95a5;
  font-size: 8px;
}
.rack-field > input,
.url-control {
  height: 30px;
  border: 1px solid #3b5365;
  border-radius: 3px;
  background: #0b1218;
}
.rack-field > input {
  min-width: 0;
  width: 100%;
  padding: 0 7px;
  outline: 0;
  color: #dceaf5;
  font: 9px var(--font-mono);
  user-select: text;
}
.rack-field input:disabled {
  color: #718796;
}
.url-control {
  display: flex;
  overflow: hidden;
}
.protocol-lock {
  display: grid;
  place-items: center;
  padding: 0 7px;
  border-right: 1px solid #304657;
  color: #62a7ff;
  background: #132537;
  font: 700 8px var(--font-mono);
}
.url-control input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  padding: 0 8px;
  color: #dceaf5;
  background: transparent;
  font: 10px var(--font-mono);
  user-select: text;
}
.connection-state {
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 7px;
  border: 1px solid #344958;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.15);
}
.state-led {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #647482;
}
.connection-state.online .state-led {
  background: #35cc84;
  box-shadow: 0 0 7px #35cc84;
}
.connection-state.degraded .state-led {
  background: #e4a33a;
  box-shadow: 0 0 7px #e4a33a;
}
.connection-state.connecting .state-led {
  background: #4ba1ff;
  animation: pulse 1s infinite;
}
.connection-state div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.connection-state strong {
  font-size: 9px;
}
.connection-state small {
  color: #7f93a2;
  font: 7px var(--font-mono);
  white-space: nowrap;
}
.rack-btn {
  height: 30px;
  padding: 0 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid;
  border-radius: 3px;
  cursor: pointer;
  font-size: 9px;
  font-weight: 700;
  white-space: nowrap;
}
.rack-btn.connect {
  color: #dbedff;
  background: #1760ad;
  border-color: #3787da;
}
.rack-btn.disconnect {
  color: #ffc7c7;
  background: #3a1d23;
  border-color: #74363d;
}
.rack-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.identity-strip {
  min-height: 34px;
  display: flex;
  align-items: stretch;
  border: 1px solid #314653;
  border-radius: 4px;
  background: #111a21;
  overflow: hidden;
  flex-shrink: 0;
}
.identity-item {
  min-width: 0;
  flex: 1;
  padding: 5px 8px;
  border-right: 1px solid #263a46;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.identity-item.primary {
  flex: 1.15;
}
.identity-item.safety {
  flex: 1.2;
  background: rgba(151, 103, 31, 0.07);
}
.identity-item span {
  color: #687f8f;
  font-size: 7px;
}
.identity-item strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #bfced8;
  font: 8px var(--font-mono);
}
.identity-strip.partial .identity-item:nth-child(4) strong {
  color: #d7aa59;
}
.identity-strip.mismatch {
  border-color: #79383e;
}
.identity-strip.mismatch .identity-item:nth-child(4) strong {
  color: #ef8282;
}
.identity-item.safety strong {
  color: #d3a75b;
}
.diagnostic-toggle {
  min-width: 68px;
  border: 0;
  background: #15242e;
  color: #8ca6b7;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
  font-size: 8px;
}
.critical-strip {
  min-height: 27px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid #78383e;
  border-radius: 3px;
  color: #ef8d8d;
  background: rgba(126, 39, 47, 0.14);
  font-size: 8px;
  flex-shrink: 0;
}
.commissioning-body {
  min-height: 0;
  flex: 1;
  display: flex;
  gap: 6px;
  position: relative;
  overflow: hidden;
}
.point-panel {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid #2e424f;
  border-radius: 4px;
  background: #101820;
  overflow: hidden;
}
.panel-toolbar {
  min-height: 39px;
  padding: 5px 7px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 7px;
  border-bottom: 1px solid #2a3d4a;
  background: #151f28;
  flex-shrink: 0;
}
.panel-heading,
.panel-heading > div {
  display: flex;
  align-items: center;
  gap: 6px;
}
.panel-heading > div {
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}
.panel-heading strong {
  font-size: 10px;
}
.panel-heading small {
  color: #6e8494;
  font-size: 7px;
}
.monitor-count {
  padding: 2px 5px;
  border-radius: 8px;
  color: #78b8f3;
  background: rgba(59, 130, 246, 0.12);
  font: 7px var(--font-mono);
}
.point-tools {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
.search-box {
  width: min(210px, 24vw);
  height: 26px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border: 1px solid #334956;
  border-radius: 3px;
  background: #0d151b;
  color: #688091;
}
.search-box input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: #dbe8f1;
  font-size: 8px;
  user-select: text;
}
.point-tools select,
.tool-btn {
  height: 26px;
  border: 1px solid #334956;
  border-radius: 3px;
  background: #121d25;
  color: #9db0be;
  font-size: 8px;
}
.point-tools select {
  width: 76px;
  padding: 0 5px;
}
.tool-btn {
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.tool-btn.icon-only {
  width: 26px;
  padding: 0;
}
.tool-btn.active {
  color: #79b7f5;
  border-color: #3e78aa;
  background: #12283a;
}
.tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.point-table-wrap {
  min-height: 0;
  flex: 1;
  overflow: auto;
  position: relative;
}
.point-table {
  width: 100%;
  min-width: 760px;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}
.point-table th {
  position: sticky;
  top: 0;
  z-index: 3;
  height: 27px;
  padding: 0 6px;
  border-bottom: 1px solid #304552;
  border-right: 1px solid #243743;
  background: #17232c;
  color: #7890a0;
  text-align: left;
  font-size: 7px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.point-table td {
  height: 42px;
  padding: 4px 6px;
  border-bottom: 1px solid #20323e;
  border-right: 1px solid #1e303b;
  background: #101820;
  vertical-align: middle;
  font-size: 8px;
}
.point-table tbody tr:hover td {
  background: #13212b;
}
.point-table .point-group-row td {
  height: 32px;
  padding: 0;
  border-right: 0;
  border-bottom-color: #304552;
  background: #18252e;
}
.point-table .point-group-row:hover td {
  background: #1b2a34;
}
.point-group-row.group-commands td {
  box-shadow: inset 3px 0 #d95d63;
}
.point-group-row.group-parameters td {
  box-shadow: inset 3px 0 #d89b31;
}
.point-group-row.group-states td {
  box-shadow: inset 3px 0 #3b82b5;
}
.point-group-row.group-process td {
  box-shadow: inset 3px 0 #318566;
}
.point-group-row.group-other td {
  box-shadow: inset 3px 0 #7a8994;
}
.point-group-toggle {
  width: 100%;
  height: 31px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  border: 0;
  background: transparent;
  color: #a8bac7;
  text-align: left;
  cursor: pointer;
}
.point-group-toggle:focus-visible {
  outline: 2px solid #4b9ad2;
  outline-offset: -2px;
}
.group-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.group-copy strong {
  color: #e1ebf2;
  font-size: 9px;
}
.group-copy small {
  min-width: 0;
  overflow: hidden;
  color: #778d9c;
  font-size: 7px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-stat,
.group-access,
.group-monitored {
  flex-shrink: 0;
  padding: 2px 5px;
  border-radius: 8px;
  color: #9fb0bc;
  background: #243541;
  font: 7px var(--font-mono);
}
.group-access.writable {
  color: #e5b667;
  background: rgba(216, 155, 49, 0.14);
}
.group-access.readonly {
  color: #82b9df;
  background: rgba(59, 130, 181, 0.14);
}
.group-monitored {
  color: #84bcec;
  background: rgba(59, 130, 246, 0.13);
}
.point-table tr.monitored td:first-child {
  box-shadow: inset 2px 0 #4396dc;
}
.point-table tr.stale td {
  background: #171c1d;
}
.point-table tr.changed td:nth-child(5) {
  animation: valueChanged 1.3s ease-out;
}
.point-table th:nth-child(2) {
  width: 190px;
}
.point-table th:nth-child(3) {
  width: 112px;
}
.point-table th:nth-child(4) {
  width: 70px;
}
.point-table th:nth-child(5) {
  width: 105px;
}
.point-table th:nth-child(6) {
  width: 90px;
}
.point-table th:nth-child(7) {
  width: 72px;
}
.monitor-col {
  position: sticky !important;
  left: 0;
  z-index: 4 !important;
  width: 43px;
  text-align: center !important;
}
.point-table td.monitor-col {
  background: #111b22;
}
.action-col {
  position: sticky !important;
  right: 0;
  z-index: 4 !important;
  width: 68px;
  text-align: center !important;
  box-shadow: -5px 0 10px rgba(2, 8, 12, 0.28);
}
.point-table td.action-col {
  background: #111b22;
}
.point-table td > small {
  display: block;
  margin-top: 2px;
  color: #607685;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.point-name {
  display: block;
  color: #d9e7f0;
  font: 700 9px var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.point-table code {
  color: #8fb3cc;
  font-size: 8px;
}
.point-table .modbus-reference {
  display: inline-flex;
  min-width: 48px;
  align-items: center;
  justify-content: center;
  padding: 3px 6px;
  border: 1px solid #314b5b;
  border-radius: 3px;
  background: #13232d;
  color: #9dc6e1;
  font: 700 9px var(--font-mono);
  letter-spacing: 0.04em;
}
.monitor-toggle,
.row-btn {
  width: 23px;
  height: 23px;
  display: inline-grid;
  place-items: center;
  border: 1px solid #314653;
  border-radius: 3px;
  background: #111b22;
  color: #617988;
  cursor: pointer;
}
.monitor-toggle.active {
  color: #72b8f2;
  border-color: #3e78a4;
  background: #12283a;
}
.type-chip,
.access-chip,
.quality-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 4px;
  border-radius: 2px;
  font: 700 7px var(--font-mono);
}
.type-chip {
  color: #b9c9d5;
  background: #23313b;
}
.access-chip {
  margin-left: 3px;
}
.access-chip.r {
  color: #75b9f2;
  background: rgba(59, 130, 246, 0.11);
}
.access-chip.rw {
  color: #e0ac5d;
  background: rgba(216, 155, 49, 0.12);
}
.live-value {
  color: #d7e4ed;
  font: 700 10px var(--font-mono);
}
.live-value.boolean {
  color: #8a9aa5;
}
.live-value.boolean.on {
  color: #5dd399;
}
.changed-label {
  color: #67b5ed !important;
  font: 6px var(--font-mono);
}
.quality-good {
  color: #5bd195;
  background: rgba(56, 178, 118, 0.11);
}
.quality-init,
.quality-none {
  color: #8194a1;
  background: #202d36;
}
.quality-stale {
  color: #e3ad56;
  background: rgba(216, 155, 49, 0.12);
}
.quality-offline,
.quality-bad {
  color: #ee8282;
  background: rgba(223, 91, 91, 0.12);
}
.local-stale {
  color: #d99d45 !important;
  font: 6px var(--font-mono);
}
.received-at {
  color: #a7bac7;
  font: 8px var(--font-mono);
}
.row-btn {
  margin: 0 1px;
  color: #83a5bb;
}
.row-btn.write {
  color: #9f815a;
  border-color: #5b4a34;
}
.row-btn:disabled {
  opacity: 0.28;
  cursor: not-allowed;
}
.empty-row {
  height: 75px !important;
  text-align: center;
  color: #647986;
}
.table-evidence-mask {
  position: absolute;
  inset: 27px 0 0;
  z-index: 2;
  display: grid;
  place-items: center;
  background: rgba(9, 15, 20, 0.84);
  backdrop-filter: blur(2px);
}
.table-evidence-mask > div {
  max-width: 390px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #627b8b;
  text-align: center;
}
.table-evidence-mask strong {
  color: #a9bdc9;
  font-size: 10px;
}
.table-evidence-mask span {
  font-size: 8px;
  line-height: 1.45;
}
.diagnostic-rail {
  position: relative;
  width: 400px;
  min-width: 0;
  max-width: calc(100vw - 24px);
  flex-shrink: 0;
  display: none;
  flex-direction: column;
  border: 1px solid #2b414f;
  border-radius: 4px;
  background: #0f171d;
  overflow: hidden;
}
.diagnostic-rail.open {
  display: flex;
}
.diagnostic-scroll {
  min-height: 0;
  height: 100%;
  overflow: auto;
}
.diagnostic-resize-handle {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 4;
  width: 9px;
  cursor: col-resize;
  touch-action: none;
}
.diagnostic-resize-handle::after {
  position: absolute;
  top: 50%;
  left: 2px;
  width: 2px;
  height: 48px;
  border-radius: 2px;
  background: #50758a;
  content: '';
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity 120ms ease;
}
.diagnostic-resize-handle:hover::after,
.diagnostic-resize-handle:focus-visible::after,
.diagnostic-rail.resizing .diagnostic-resize-handle::after {
  opacity: 1;
}
.diagnostic-resize-handle:focus-visible {
  outline: 2px solid #4b9ad2;
  outline-offset: -2px;
}
.diagnostic-scroll > header {
  min-height: 34px;
  padding: 0 8px 0 13px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #293d49;
  background: #14212a;
  position: sticky;
  top: 0;
  z-index: 2;
}
.diagnostic-scroll > header div {
  display: flex;
  align-items: center;
  gap: 6px;
}
.diagnostic-scroll > header strong {
  font-size: 9px;
}
.diagnostic-scroll > header button {
  border: 0;
  background: transparent;
  color: #748b9a;
  cursor: pointer;
}
.diag-section {
  padding: 8px;
  border-bottom: 1px solid #22343f;
}
.diag-section h3 {
  margin: 0 0 7px;
  display: flex;
  align-items: center;
  gap: 5px;
  color: #a9bdca;
  font-size: 8px;
}
.diag-section h3 em {
  margin-left: auto;
  color: #d2a052;
  font: 6px var(--font-mono);
  font-style: normal;
}
.health-matrix {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.health-cell {
  min-height: 25px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 5px;
  padding: 4px 5px;
  border: 1px solid #2a3c49;
  border-radius: 2px;
  color: #8296a4;
  font-size: 7px;
}
.health-cell strong {
  font: 6px var(--font-mono);
}
.mini-led {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #61717d;
}
.health-cell.ok {
  color: #79d7aa;
  border-color: rgba(56, 178, 118, 0.25);
}
.health-cell.ok .mini-led {
  background: #38b276;
}
.health-cell.bad {
  color: #f08a8a;
  border-color: rgba(223, 91, 91, 0.35);
}
.health-cell.bad .mini-led {
  background: #df5b5b;
}
.fault-line {
  margin-top: 5px;
  padding: 5px;
  display: flex;
  align-items: center;
  gap: 5px;
  border-radius: 2px;
  color: #7d929f;
  background: #151f25;
  font: 7px var(--font-mono);
}
.fault-line.clear {
  color: #69b98f;
  background: rgba(56, 178, 118, 0.08);
}
.fault-line.active {
  color: #ff9393;
  background: rgba(223, 91, 91, 0.14);
}
.diag-foot {
  display: block;
  margin-top: 5px;
  color: #5f7686;
  font: 6px var(--font-mono);
}
.diag-section dl {
  margin: 0;
  display: grid;
  gap: 4px;
}
.diag-section dl div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 7px;
}
.diag-section dt {
  color: #687e8d;
}
.diag-section dd {
  margin: 0;
  max-width: 165px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #b7c8d3;
  font-family: var(--font-mono);
}
.network-address {
  margin-bottom: 6px;
}
.network-address strong {
  color: #dcecff;
  font: 700 12px var(--font-mono);
}
.network-address span {
  color: #668195;
  font: 8px var(--font-mono);
}
.service-line {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 5px;
  padding: 5px;
  border-top: 1px solid #223641;
  color: #7f96a5;
  font-size: 7px;
}
.service-line strong {
  color: #67c794;
  font: 7px var(--font-mono);
}
.service-line small {
  grid-column: 2/-1;
  color: #5f7584;
  font: 6px var(--font-mono);
}
.bank-row {
  margin-top: 5px;
  display: grid;
  grid-template-columns: 45px 1fr;
  align-items: center;
  gap: 5px;
}
.bank-row > span {
  color: #687f8f;
  font-size: 7px;
}
.bit-row {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.bit-row i {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border: 1px solid #344956;
  border-radius: 2px;
  color: #536875;
  background: #0d141a;
  font: 6px var(--font-mono);
  font-style: normal;
}
.bit-row i.on {
  color: #082718;
  background: #4fce8e;
  border-color: #76e8ae;
}
.bit-row i.output.on {
  color: #081d31;
  background: #53aaff;
  border-color: #80c0ff;
}
.bit-row i.unknown {
  color: #455661;
  border-style: dashed;
  background: transparent;
}
.analog-grid {
  margin-top: 6px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
}
.analog-grid > div {
  display: flex;
  flex-direction: column;
  padding: 4px;
  border-left: 2px solid #3a8ac8;
  background: #0d151b;
}
.analog-grid > div.ao {
  border-left-color: #c98a3d;
}
.analog-grid span {
  color: #7790a0;
  font: 6px var(--font-mono);
}
.analog-grid strong {
  color: #dceaf3;
  font: 700 8px var(--font-mono);
}
.analog-grid small {
  color: #536b7a;
  font-size: 6px;
}
.event-dock {
  height: 138px;
  min-height: 32px;
  display: flex;
  flex-direction: column;
  border: 1px solid #293d49;
  border-radius: 4px;
  overflow: hidden;
  background: #0c1318;
  flex-shrink: 0;
  transition: height 0.15s ease;
}
.event-dock.collapsed {
  height: 32px;
}
.event-dock > header {
  min-height: 31px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 6px;
  border-bottom: 1px solid #263a46;
  background: #131e26;
}
.dock-tabs {
  height: 100%;
  display: flex;
}
.dock-tabs button {
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #728797;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 8px;
  cursor: pointer;
}
.dock-tabs button.active {
  color: #a9c8de;
  border-bottom-color: #4a9be0;
}
.dock-tabs button span {
  padding: 1px 4px;
  border-radius: 7px;
  background: #24343f;
  font: 6px var(--font-mono);
}
.dock-actions {
  display: flex;
  align-items: center;
  gap: 3px;
}
.dock-actions button {
  height: 23px;
  border: 1px solid #2d424f;
  border-radius: 2px;
  background: #111b22;
  color: #758c9a;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 5px;
  cursor: pointer;
  font-size: 7px;
}
.dock-actions .icon-action {
  width: 23px;
  padding: 0;
  justify-content: center;
}
.verification-boundary {
  margin-right: 4px;
  color: #9c7e4d;
  font: 6px var(--font-mono);
}
.log-list,
.write-event-list {
  min-height: 0;
  flex: 1;
  overflow: auto;
}
.log-row {
  min-height: 24px;
  display: grid;
  grid-template-columns: 55px 55px minmax(220px, 0.8fr) 1.5fr;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  border-bottom: 1px solid #172731;
  font-size: 7px;
}
.log-row time,
.log-row span {
  color: #536b7b;
  font-family: var(--font-mono);
}
.log-row strong {
  color: #9eafbb;
  font-weight: 500;
}
.log-row code {
  color: #657f90;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.log-row.error strong {
  color: #e97b7b;
}
.log-row.warning strong {
  color: #dca752;
}
.log-row.success strong {
  color: #64bd8e;
}
.log-row.write strong {
  color: #e3a654;
}
.write-event {
  padding: 6px 7px;
  border-bottom: 1px solid #1a2a34;
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 8px;
  align-items: center;
}
.write-event > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 7px;
}
.write-event time {
  color: #5c7180;
  font-family: var(--font-mono);
}
.write-event strong {
  color: #d3e0e8;
  font-family: var(--font-mono);
}
.write-event span {
  color: #778b99;
}
.evidence-chain {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.evidence-chain span {
  padding: 2px 4px;
  border: 1px solid #31424d;
  border-radius: 2px;
  color: #70828e;
  font: 6px var(--font-mono);
}
.evidence-chain .passed {
  color: #65c791;
  border-color: rgba(56, 178, 118, 0.35);
}
.evidence-chain .failed {
  color: #e77d7d;
  border-color: rgba(223, 91, 91, 0.35);
}
.evidence-chain .unknown {
  color: #9b8c69;
}
.dock-empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: #526977;
  font-size: 8px;
}
.write-release-note {
  min-height: 29px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 7px;
  border: 1px solid #5b482d;
  border-left: 3px solid #b98635;
  border-radius: 3px;
  background: #171813;
  color: #b59664;
  flex-shrink: 0;
}
.write-release-note strong {
  font-size: 8px;
}
.write-release-note span {
  flex: 1;
  color: #7f7564;
  font-size: 7px;
}
.write-release-note button {
  height: 21px;
  border: 1px solid #5e5039;
  border-radius: 2px;
  background: #201c16;
  color: #8f7a58;
  font-size: 7px;
}
.spinning {
  animation: spin 0.85s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
@keyframes valueChanged {
  0% {
    background: #cce8fb;
  }
  100% {
    background: var(--debug-surface);
  }
}

/* KZ3 现场调试采用高对比浅色工作面；状态色只表达设备状态和安全边界。 */
.target-rack {
  border-color: #9eb0bd;
  border-left-color: var(--debug-blue);
  background: linear-gradient(105deg, #ffffff, #f4f7f9 62%, #eaf0f4);
  box-shadow: 0 1px 2px rgba(27, 45, 58, 0.08);
}
.rack-kicker {
  color: #526979;
  font-size: 10px;
}
.rack-title {
  color: var(--debug-text);
  font-size: 15px;
}
.rack-field > span {
  color: var(--debug-text-secondary);
  font-size: 10px;
  font-weight: 650;
}
.rack-field > input,
.url-control {
  border-color: #aebcc7;
  background: #ffffff;
}
.rack-field > input {
  color: var(--debug-text);
  font-size: 11px;
}
.rack-field input:disabled {
  color: var(--debug-text-muted);
  background: #edf1f4;
}
.protocol-lock {
  border-right-color: #aec3d2;
  color: #0f5f9e;
  background: #e2edf6;
  font-size: 10px;
}
.url-control input {
  color: var(--debug-text);
  font-size: 11px;
}
.connection-state {
  border-color: #aebcc7;
  background: var(--debug-surface-subtle);
}
.connection-state strong {
  color: var(--debug-text);
  font-size: 11px;
}
.connection-state small {
  color: var(--debug-text-muted);
  font-size: 9px;
}
.state-led {
  background: #70808c;
}
.connection-state.online .state-led {
  background: #168052;
  box-shadow: 0 0 0 3px #cdebdc;
}
.connection-state.degraded .state-led {
  background: #b57200;
  box-shadow: 0 0 0 3px #f8e3b7;
}
.connection-state.connecting .state-led {
  background: var(--debug-blue);
}
.rack-btn {
  font-size: 11px;
}
.rack-btn.connect {
  color: #ffffff;
  background: #1769aa;
  border-color: #0e568e;
}
.rack-btn.disconnect {
  color: #8d2028;
  background: #fff1f2;
  border-color: #d89297;
}
.rack-btn:disabled,
.tool-btn:disabled {
  opacity: 0.62;
}
.identity-strip {
  border-color: var(--debug-border);
  background: var(--debug-surface);
}
.identity-item {
  border-right-color: var(--debug-border-soft);
}
.identity-item.safety {
  background: #fff8e7;
}
.identity-item span {
  color: var(--debug-text-secondary);
  font-size: 10px;
}
.identity-item strong {
  color: var(--debug-text);
  font-size: 10px;
}
.identity-strip.partial .identity-item:nth-child(4) strong,
.identity-item.safety strong {
  color: var(--debug-amber);
}
.identity-strip.mismatch {
  border-color: #c97177;
}
.identity-strip.mismatch .identity-item:nth-child(4) strong {
  color: var(--debug-red);
}
.diagnostic-toggle {
  border-left: 1px solid var(--debug-border-soft);
  background: #edf3f7;
  color: #254e69;
  font-size: 10px;
  font-weight: 700;
}
.critical-strip {
  border-color: #d78b90;
  color: #8f2028;
  background: var(--debug-red-soft);
  font-size: 11px;
}
.point-panel {
  border-color: var(--debug-border);
  background: var(--debug-surface);
  box-shadow: 0 1px 2px rgba(27, 45, 58, 0.07);
}
.panel-toolbar {
  border-bottom-color: var(--debug-border);
  background: var(--debug-surface-subtle);
}
.panel-heading strong {
  color: var(--debug-text);
  font-size: 12px;
}
.panel-heading small {
  color: var(--debug-text-secondary);
  font-size: 10px;
}
.monitor-count {
  color: #0f5f9e;
  background: var(--debug-blue-soft);
  font-size: 9px;
}
.search-box {
  border-color: #aebcc7;
  background: #ffffff;
  color: #506879;
}
.search-box:focus-within {
  border-color: var(--debug-blue);
  box-shadow: 0 0 0 2px rgba(23, 105, 170, 0.13);
}
.search-box input {
  color: var(--debug-text);
  font-size: 11px;
}
.search-box input::placeholder {
  color: #6e7d88;
}
.point-tools select,
.tool-btn {
  border-color: #aebcc7;
  background: #ffffff;
  color: #2f4656;
  font-size: 10px;
}
.point-tools select:focus-visible,
.tool-btn:focus-visible,
.rack-btn:focus-visible,
.monitor-toggle:focus-visible,
.row-btn:focus-visible,
.diagnostic-toggle:focus-visible {
  outline: 2px solid #2f82c4;
  outline-offset: 1px;
}
.tool-btn:hover:not(:disabled),
.monitor-toggle:hover:not(:disabled),
.row-btn:hover:not(:disabled) {
  border-color: #6e94ad;
  background: #edf4f8;
}
.tool-btn.active {
  color: #0f5f9e;
  border-color: #6a9bc0;
  background: var(--debug-blue-soft);
}
.point-table th {
  border-bottom-color: #aebcc7;
  border-right-color: #c8d2da;
  background: var(--debug-surface-strong);
  color: #314654;
  font-size: 10px;
}
.point-table td {
  border-bottom-color: #d6dee4;
  border-right-color: #e0e6eb;
  background: var(--debug-surface);
  color: var(--debug-text);
  font-size: 11px;
}
.point-table tbody tr:hover td {
  background: #eef6fb;
}
.point-table .point-group-row td {
  border-bottom-color: #bac8d2;
  background: #edf2f5;
}
.point-table .point-group-row:hover td {
  background: #e6eef3;
}
.point-group-toggle {
  color: #3f5666;
}
.group-copy strong {
  color: #172a37;
  font-size: 11px;
}
.group-copy small {
  color: #576c7a;
  font-size: 9px;
}
.group-stat,
.group-access,
.group-monitored {
  color: #405766;
  background: #dce5eb;
  font-size: 9px;
}
.group-access.writable {
  color: #7a4b00;
  background: var(--debug-amber-soft);
}
.group-access.readonly {
  color: #0f5f9e;
  background: var(--debug-blue-soft);
}
.group-monitored {
  color: #0f5f9e;
  background: #dcecf8;
}
.point-table tr.stale td {
  background: #f4f1e9;
}
.point-table td.monitor-col,
.point-table td.action-col {
  background: #f8fafb;
}
.action-col {
  box-shadow: -5px 0 10px rgba(52, 72, 86, 0.1);
}
.point-table td > small {
  color: var(--debug-text-muted);
  font-size: 9px;
}
.point-name {
  color: #102330;
  font-size: 12px;
}
.point-table code {
  color: #34566e;
  font-size: 10px;
}
.point-table .modbus-reference {
  border-color: #a9bdca;
  background: #edf4f8;
  color: #164f75;
  font-size: 10px;
}
.monitor-toggle,
.row-btn {
  border-color: #aebcc7;
  background: #ffffff;
  color: #3f5d70;
}
.monitor-toggle.active {
  color: #0f5f9e;
  border-color: #6a9bc0;
  background: var(--debug-blue-soft);
}
.type-chip,
.access-chip,
.quality-chip {
  font-size: 9px;
}
.type-chip {
  color: #293e4d;
  background: #e5ebef;
}
.access-chip.r {
  color: #0f5f9e;
  background: var(--debug-blue-soft);
}
.access-chip.rw {
  color: var(--debug-amber);
  background: var(--debug-amber-soft);
}
.live-value {
  color: #102330;
  font-size: 12px;
}
.live-value.boolean {
  color: #53636f;
}
.live-value.boolean.on {
  color: #0d7145;
}
.changed-label,
.local-stale {
  font-size: 9px;
}
.changed-label {
  color: #0f69a8 !important;
}
.quality-good {
  color: #0c6f43;
  background: var(--debug-green-soft);
}
.quality-init,
.quality-none {
  color: #465a68;
  background: #e8edf1;
}
.quality-stale {
  color: var(--debug-amber);
  background: var(--debug-amber-soft);
}
.quality-offline,
.quality-bad {
  color: var(--debug-red);
  background: var(--debug-red-soft);
}
.local-stale {
  color: #8b5700 !important;
}
.received-at {
  color: #425968;
  font-size: 10px;
}
.row-btn.write {
  color: #7a4b00;
  border-color: #c9ab76;
  background: #fff9ec;
}
.empty-row {
  color: var(--debug-text-muted);
}
.table-evidence-mask {
  background: rgba(244, 247, 249, 0.94);
}
.table-evidence-mask > div {
  color: var(--debug-text-secondary);
}
.table-evidence-mask strong {
  color: var(--debug-text);
  font-size: 12px;
}
.table-evidence-mask span {
  font-size: 10px;
}
.diagnostic-rail {
  border-color: var(--debug-border);
  background: var(--debug-surface);
}
.diagnostic-scroll > header {
  border-bottom-color: var(--debug-border);
  background: var(--debug-surface-strong);
}
.diagnostic-scroll > header strong {
  color: var(--debug-text);
  font-size: 11px;
}
.diagnostic-scroll > header button {
  color: #40596a;
}
.diagnostic-resize-handle::after {
  background: #2f82c4;
}
.diag-section {
  border-bottom-color: var(--debug-border-soft);
}
.diag-section h3 {
  color: #2f4757;
  font-size: 11px;
}
.diag-section h3 em {
  color: var(--debug-amber);
  font-size: 9px;
}
.health-cell {
  border-color: #c6d0d8;
  color: #405563;
  background: #fafbfc;
  font-size: 10px;
}
.health-cell strong {
  font-size: 9px;
}
.mini-led {
  background: #73828d;
}
.health-cell.ok {
  color: #116a43;
  border-color: #8bc5a8;
  background: var(--debug-green-soft);
}
.health-cell.bad {
  color: var(--debug-red);
  border-color: #d58b90;
  background: var(--debug-red-soft);
}
.fault-line {
  color: #405563;
  background: #edf1f4;
  font-size: 9px;
}
.fault-line.clear {
  color: #0f6941;
  background: var(--debug-green-soft);
}
.fault-line.active {
  color: var(--debug-red);
  background: var(--debug-red-soft);
}
.diag-foot {
  color: var(--debug-text-muted);
  font-size: 9px;
}
.diag-section dl div {
  font-size: 10px;
}
.diag-section dt {
  color: var(--debug-text-secondary);
}
.diag-section dd {
  color: var(--debug-text);
}
.network-address strong {
  color: #102330;
}
.network-address span {
  color: #486275;
  font-size: 10px;
}
.service-line {
  border-top-color: var(--debug-border-soft);
  color: var(--debug-text-secondary);
  font-size: 9px;
}
.service-line strong {
  color: #0f6b43;
  font-size: 9px;
}
.service-line small {
  color: var(--debug-text-muted);
  font-size: 9px;
}
.bank-row > span {
  color: var(--debug-text-secondary);
  font-size: 9px;
}
.bit-row i {
  width: 18px;
  height: 18px;
  border-color: #aebcc7;
  color: #465966;
  background: #f5f7f9;
  font-size: 9px;
}
.bit-row i.on {
  color: #0b4f31;
  background: #bfe9d2;
  border-color: #69b78e;
}
.bit-row i.output.on {
  color: #0d4c78;
  background: #c9e6fa;
  border-color: #69a8d4;
}
.bit-row i.unknown {
  color: #647480;
}
.analog-grid > div {
  background: #f3f7fa;
}
.analog-grid span {
  color: var(--debug-text-secondary);
  font-size: 9px;
}
.analog-grid strong {
  color: var(--debug-text);
  font-size: 10px;
}
.analog-grid small {
  color: var(--debug-text-muted);
  font-size: 9px;
}
.event-dock {
  border-color: var(--debug-border);
  background: var(--debug-surface);
}
.event-dock > header {
  border-bottom-color: var(--debug-border);
  background: var(--debug-surface-strong);
}
.dock-tabs button {
  color: #405563;
  font-size: 10px;
}
.dock-tabs button.active {
  color: #0f5f9e;
  border-bottom-color: var(--debug-blue);
}
.dock-tabs button span {
  color: #314654;
  background: #d6e0e7;
  font-size: 9px;
}
.dock-actions button {
  border-color: #aebcc7;
  background: #ffffff;
  color: #334c5c;
  font-size: 9px;
}
.verification-boundary {
  color: var(--debug-amber);
  font-size: 9px;
}
.log-row {
  border-bottom-color: #e0e6ea;
  color: var(--debug-text);
  font-size: 9px;
}
.log-row time,
.log-row span {
  color: var(--debug-text-muted);
}
.log-row strong {
  color: #314654;
}
.log-row code {
  color: #486275;
}
.log-row.error strong,
.evidence-chain .failed {
  color: var(--debug-red);
}
.log-row.warning strong,
.log-row.write strong {
  color: var(--debug-amber);
}
.log-row.success strong,
.evidence-chain .passed {
  color: var(--debug-green);
}
.write-event {
  border-bottom-color: #dce3e8;
  grid-template-columns: minmax(170px, 0.8fr) auto minmax(280px, 1.3fr);
}
.write-event > div:first-child {
  font-size: 9px;
}
.write-event time,
.write-event span {
  color: var(--debug-text-muted);
}
.write-event strong {
  color: var(--debug-text);
}
.evidence-chain span {
  border-color: #aebcc7;
  color: #405563;
  background: #f7f9fa;
  font-size: 9px;
}
.evidence-chain .passed {
  border-color: #75b997;
}
.evidence-chain .failed {
  border-color: #d18a8f;
}
.evidence-chain .unknown {
  color: #6f572d;
}
.observation-editor {
  display: grid;
  grid-template-columns: auto auto minmax(150px, 1fr);
  gap: 5px;
  align-items: end;
}
.observation-editor label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: #5f6f7d;
  font-size: 8px;
}
.observation-editor select,
.observation-editor input {
  height: 24px;
  border: 1px solid #b9c5cf;
  border-radius: 3px;
  background: #ffffff;
  color: #314654;
  font-size: 9px;
}
.observation-editor select {
  min-width: 74px;
}
.observation-editor input {
  width: 100%;
  min-width: 120px;
  padding: 0 6px;
}
.dock-empty {
  color: var(--debug-text-muted);
  font-size: 10px;
}
.write-release-note {
  border-color: #c8a35b;
  border-left-color: #a86a00;
  background: var(--debug-amber-soft);
  color: #654000;
}
.write-release-note strong {
  font-size: 10px;
}
.write-release-note span {
  color: #6f5527;
  font-size: 9px;
}
.write-release-note button {
  border-color: #bf9c5d;
  background: #fff9ea;
  color: #694b16;
  font-size: 9px;
}
.write-release-note button:not(:disabled) {
  cursor: pointer;
}
.write-release-note button:not(:disabled):hover {
  border-color: #8c681f;
  background: #ffefc6;
}
.write-release-note button.blocked {
  border-style: dashed;
}
.write-release-note button.revoke {
  border-color: #b9c5cf;
  background: #ffffff;
  color: #40515f;
}
.row-btn.write.locked {
  color: #78591d;
  border-style: dashed;
  background: #fff8e8;
}
.write-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(24, 39, 50, 0.68);
  /* WebKit 会在后方实时表格更新时反复重算全屏模糊层，导致 Tauri 出现白帧。 */
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
.write-modal {
  width: min(540px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #8fa2b0;
  border-radius: 8px;
  background: #ffffff;
  color: #17212b;
  box-shadow: 0 18px 48px rgba(27, 45, 58, 0.28);
}
.write-modal > header,
.write-modal > footer {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #eef3f7;
}
.write-modal > header {
  justify-content: space-between;
  border-bottom: 1px solid #d5dde4;
}
.write-modal > header > div {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #7a4b00;
}
.write-modal > header strong {
  font-size: 13px;
}
.write-modal > header button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #40515f;
  cursor: pointer;
}
.write-modal > header button:hover {
  background: #dfe7ed;
}
.write-modal-body {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  overflow-y: auto;
}
.write-warning,
.command-value {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px;
  border: 1px solid #d3ad63;
  border-radius: 5px;
  background: #fff5dc;
  color: #654000;
}
.write-warning svg,
.command-value svg {
  flex: 0 0 auto;
  margin-top: 1px;
}
.write-warning div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.write-warning strong,
.command-value strong {
  color: #5b3800;
}
.write-warning span,
.command-value span {
  font-size: 11px;
  line-height: 1.5;
}
.permit-evidence {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
  border: 1px solid #d5dde4;
  border-radius: 5px;
  overflow: hidden;
}
.permit-evidence > div {
  min-width: 0;
  padding: 8px 10px;
  border-right: 1px solid #d5dde4;
  border-bottom: 1px solid #d5dde4;
  background: #f7f9fb;
}
.permit-evidence > div:nth-child(2n) {
  border-right: 0;
}
.permit-evidence > div:nth-last-child(-n + 2) {
  border-bottom: 0;
}
.permit-evidence dt {
  margin-bottom: 3px;
  color: #5f6f7d;
  font-size: 10px;
}
.permit-evidence dd {
  margin: 0;
  overflow: hidden;
  color: #17212b;
  font: 600 11px var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.write-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: #314654;
  font-size: 11px;
  line-height: 1.45;
  cursor: pointer;
}
.write-check input {
  flex: 0 0 auto;
  margin: 2px 0 0;
}
.confirm-phrase,
.permit-reason,
.number-write,
.write-reason {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: #40515f;
  font-size: 11px;
}
.confirm-phrase input,
.permit-reason input,
.number-write input,
.write-reason textarea {
  width: 100%;
  border: 1px solid #b9c5cf;
  border-radius: 4px;
  background: #ffffff;
  color: #17212b;
  font: 12px var(--font-mono);
  outline: none;
}
.confirm-phrase input,
.permit-reason input,
.number-write input {
  height: 32px;
  padding: 0 9px;
}
.write-reason textarea {
  min-height: 64px;
  padding: 8px 9px;
  resize: vertical;
}
.confirm-phrase input:focus,
.permit-reason input:focus,
.number-write input:focus,
.write-reason textarea:focus {
  border-color: #1769aa;
  box-shadow: 0 0 0 2px rgba(23, 105, 170, 0.14);
}
.write-target-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #d5dde4;
}
.write-target-summary strong {
  overflow: hidden;
  font: 700 12px var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.write-target-summary span {
  grid-row: 2;
  color: #40515f;
  font-size: 11px;
}
.write-target-summary code {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  color: #0f5f9e;
  font-size: 10px;
}
.write-before-row,
.write-draft-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: baseline;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 4px;
  background: #eef3f7;
}
.write-before-row span,
.write-before-row small,
.write-draft-row span,
.write-draft-row small {
  color: #5f6f7d;
  font-size: 10px;
}
.write-before-row strong,
.write-draft-row strong {
  color: #17212b;
  font: 700 13px var(--font-mono);
}
.write-draft-row {
  border: 1px solid #c9ab76;
  background: #fff9ec;
}
.write-draft-row strong {
  color: #7a4b00;
}
.boolean-write {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 0;
  padding: 8px;
  border: 1px solid #d5dde4;
  border-radius: 5px;
}
.boolean-write legend {
  padding: 0 4px;
  color: #40515f;
  font-size: 10px;
}
.boolean-write button {
  height: 32px;
  border: 1px solid #b9c5cf;
  border-radius: 4px;
  background: #f7f9fb;
  color: #40515f;
  font: 700 11px var(--font-mono);
  cursor: pointer;
}
.boolean-write button.active {
  border-color: #1769aa;
  background: #e7f1fa;
  color: #0f5f9e;
}
.number-write small {
  color: #5f6f7d;
  font-size: 10px;
}
.write-modal > footer {
  justify-content: flex-end;
  border-top: 1px solid #d5dde4;
}
.write-modal > footer button {
  min-width: 88px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #b9c5cf;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.write-modal > footer button.secondary {
  background: #ffffff;
  color: #40515f;
}
.write-modal > footer button.danger {
  border-color: #a12d34;
  background: #a12d34;
  color: #ffffff;
}
.write-modal > footer button:disabled {
  border-color: #c7d0d7;
  background: #e5ebf0;
  color: #667784;
  cursor: not-allowed;
}
.permit-countdown {
  margin-right: auto;
  color: #7a4b00;
  font: 10px var(--font-mono);
}
@media (max-width: 1200px) {
  .diagnostic-rail {
    position: absolute;
    inset: 0 0 0 auto;
    z-index: 8;
    box-shadow: -12px 0 28px rgba(37, 56, 69, 0.22);
  }
  .metadata-field.site-field {
    display: none;
  }
  .target-rack {
    grid-template-columns:
      150px minmax(240px, 1.5fr) minmax(100px, 0.55fr) minmax(145px, 0.7fr)
      auto;
  }
}
@media (max-width: 900px) {
  .rack-brand {
    display: none;
  }
  .target-rack {
    grid-template-columns: minmax(220px, 1.5fr) minmax(85px, 0.55fr) minmax(130px, 0.7fr) auto;
  }
  .identity-item:nth-child(2),
  .identity-item:nth-child(4) {
    display: none;
  }
  .panel-heading small,
  .optional-tool {
    display: none;
  }
  .search-box {
    width: 150px;
  }
  .verification-boundary {
    display: none;
  }
  .write-modal-backdrop {
    padding: 10px;
  }
}
</style>
