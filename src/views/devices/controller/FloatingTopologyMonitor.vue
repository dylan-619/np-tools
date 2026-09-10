<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Activity,
  Cable,
  ChevronDown,
  ChevronUp,
  Cpu,
  Grip,
  Minus,
  Network,
  Search,
  X,
} from 'lucide-vue-next'
import { useControllerStore } from '../../../stores/controllerStore'
import { useControllerDebugStore } from '../../../stores/controllerDebugStore'
import { KZ3_BOARD_DEF, resolveDeviceProfile } from '../../../utils/controllerIoCatalog'
import type {
  BoardChannelDef,
  DeviceInstanceConfig,
  ProfileSignalDef,
} from '../../../types/controllerIo'
import type { Kz3Scalar, PointQuality } from '../../../types/controllerDebug'

type SignalKind = 'DI' | 'DO' | 'AI' | 'AO'
type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

interface TopologyModule {
  key: string
  name: string
  meta: string
  description: string
  addressLabel: string
  device?: DeviceInstanceConfig
}

interface TopologyModuleView extends TopologyModule {
  rows: SignalRow[]
}

interface TopologyGroup {
  key: string
  label: string
  meta: string
  modules: TopologyModuleView[]
}

interface SignalRow {
  key: string
  code: string
  name: string
  kind: SignalKind
  source: string
  pointName?: string
  descriptorName?: string
  value: Kz3Scalar | null
  quality?: PointQuality
  localStale: boolean
  unit?: string
  range?: string
  monitored: boolean
  enabled: boolean
  semantic: string
}

const emit = defineEmits<{ close: [] }>()
const controller = useControllerStore()
const debug = useControllerDebugStore()

const STORAGE_KEY = 'np-tools:kz3-floating-topology-layout:v2'
const MIN_WIDTH = 560
const MIN_HEIGHT = 320
const EDGE_GAP = 10
const SIGNAL_KINDS: SignalKind[] = ['DI', 'DO', 'AI', 'AO']

const left = ref(0)
const top = ref(0)
const width = ref(780)
const height = ref(620)
const minimized = ref(false)
const query = ref('')
const isResizing = ref(false)
let dragging = false
let resizing = false
let resizeDirection: ResizeDirection = 'se'
let startPointerX = 0
let startPointerY = 0
let startLeft = 0
let startTop = 0
let startWidth = 0
let startHeight = 0
let pointerFrame: number | null = null
let pendingPointerPosition: { x: number; y: number } | null = null

const pointBySource = computed(() => {
  const map = new Map<string, { name: string; description?: string }>()
  for (const point of [
    ...controller.doc.project.points.inputs,
    ...controller.doc.project.points.outputs,
  ]) {
    if (point.source) map.set(point.source, { name: point.name, description: point.description })
  }
  return map
})

const descriptorByPoint = computed(() => {
  const map = new Map<string, string>()
  for (const descriptor of debug.pointDescriptors) {
    if (descriptor.bind.startsWith('point.')) {
      map.set(descriptor.bind.slice('point.'.length), descriptor.name)
    }
  }
  return map
})

const modules = computed<TopologyModule[]>(() => [
  {
    key: 'board',
    name: 'KZ3 主控板',
    meta: `${KZ3_BOARD_DEF.channels.length} 路板载 I/O`,
    description: '本机板载过程 I/O；数字量与模拟量按硬件通道分组显示。',
    addressLabel: 'LOCAL',
  },
  ...controller.doc.project.devices.map((device) => {
    const profile = resolveDeviceProfile(controller.doc, device)
    return {
      key: device.id,
      name: device.name,
      meta: `${profile.name} · ${device.port.toUpperCase()} / 站号 ${device.slave_address}`,
      description: profile.description,
      addressLabel: String(device.slave_address),
      device,
    }
  }),
])

function signalKind(
  code: string,
  type?: ProfileSignalDef['type'],
  direction?: ProfileSignalDef['direction'],
): SignalKind {
  const prefix = code.slice(0, 2).toUpperCase()
  if (prefix === 'DI' || prefix === 'DO' || prefix === 'AI' || prefix === 'AO') return prefix
  if (type === 'bool') return direction === 'output' ? 'DO' : 'DI'
  return direction === 'output' ? 'AO' : 'AI'
}

function channelIndex(code: string): number {
  return Math.max(0, Number.parseInt(code.slice(2), 10) - 1)
}

function boardValue(channel: BoardChannelDef): Kz3Scalar | null {
  const io = debug.diagnostics.io?.data
  if (!io) return null
  const index = channelIndex(channel.code)
  switch (signalKind(channel.code)) {
    case 'DI':
      return ((io.di_bitmap >>> index) & 1) === 1
    case 'DO':
      return ((io.do_target_bitmap >>> index) & 1) === 1
    case 'AI':
      return io.ai_uA[index] ?? null
    case 'AO':
      return io.ao_target_uA[index] ?? null
  }
}

function bindingForSource(source: string) {
  const point = pointBySource.value.get(source)
  const descriptorName = point ? descriptorByPoint.value.get(point.name) : undefined
  return { point, descriptorName }
}

function boardRows(): SignalRow[] {
  return KZ3_BOARD_DEF.channels.map((channel) => {
    const source = `board.${channel.code}`
    const { point, descriptorName } = bindingForSource(source)
    return {
      key: source,
      code: channel.code,
      name: point?.description || channel.name,
      kind: signalKind(channel.code),
      source,
      pointName: point?.name,
      descriptorName,
      value: boardValue(channel),
      localStale: debug.transportState === 'degraded',
      range: channel.range,
      monitored: true,
      enabled: true,
      semantic: channel.direction === 'output' ? '板载输出目标值，不等同于端子物理反馈' : '板载输入采样',
    }
  })
}

function isEnabled(device: DeviceInstanceConfig, signal: ProfileSignalDef): boolean {
  return signal.direction === 'input'
    ? device.use.inputs.includes(signal.code)
    : Object.prototype.hasOwnProperty.call(device.use.outputs, signal.code)
}

function deviceRows(device: DeviceInstanceConfig): SignalRow[] {
  const profile = resolveDeviceProfile(controller.doc, device)
  return [...profile.inputs, ...profile.outputs].map((signal) => {
    const source = `rtu.${device.name}.${signal.code}`
    const { point, descriptorName } = bindingForSource(source)
    const sample = descriptorName ? debug.samples[descriptorName] : undefined
    return {
      key: source,
      code: signal.code,
      name: point?.description || signal.name,
      kind: signalKind(signal.code, signal.type, signal.direction),
      source,
      pointName: point?.name,
      descriptorName,
      value: sample?.value ?? null,
      quality: sample?.quality,
      localStale: sample?.localStale === true,
      unit: signal.unit,
      range: signal.engineeringRange,
      monitored: descriptorName ? debug.selectedPointNames.includes(descriptorName) : false,
      enabled: isEnabled(device, signal),
      semantic: signal.direction === 'output'
        ? signal.hasFeedbackShadow
          ? 'Southbound 回读影子，不等同于物理反馈'
          : 'Southbound 输出运行值，反馈语义以 Profile 为准'
        : 'Southbound 输入采样',
    }
  })
}

function moduleRows(module: TopologyModule): SignalRow[] {
  return module.device ? deviceRows(module.device).filter((row) => row.enabled) : boardRows()
}

function filteredRows(rows: SignalRow[]): SignalRow[] {
  const normalized = query.value.trim().toLowerCase()
  if (!normalized) return rows
  return rows.filter((row) =>
    [row.code, row.name, row.pointName, row.descriptorName, row.source]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized)),
  )
}

function groupRows(module: TopologyModuleView, kind: SignalKind): SignalRow[] {
  return module.rows.filter((row) => row.kind === kind)
}

const topologyGroups = computed<TopologyGroup[]>(() => {
  const views = modules.value.map((module) => ({
    ...module,
    rows: filteredRows(moduleRows(module)),
  }))
  const board = views.find((module) => !module.device)
  const busMap = new Map<string, TopologyModuleView[]>()

  for (const module of views.filter((item) => item.device)) {
    const port = module.device!.port
    const list = busMap.get(port) || []
    list.push(module)
    busMap.set(port, list)
  }

  const groups: TopologyGroup[] = board
    ? [{ key: 'board', label: 'MASTER CONTROLLER', meta: '板载 I/O', modules: [board] }]
    : []

  for (const [port, busModules] of [...busMap.entries()].sort(([left], [right]) =>
    left.localeCompare(right, 'en', { numeric: true }),
  )) {
    const config = controller.doc.project.rs485_ports[port]
    groups.push({
      key: port,
      label: port.toUpperCase(),
      meta: config
        ? `${config.baud} bps · 8${config.parity === 'none' ? 'N' : config.parity === 'even' ? 'E' : 'O'}${config.stop_bits} · ${busModules.length} 从站`
        : `${busModules.length} 从站`,
      modules: busModules.sort(
        (left, right) =>
          left.device!.slave_address - right.device!.slave_address ||
          left.name.localeCompare(right.name, 'en', { numeric: true }),
      ),
    })
  }

  return groups
    .map((group) => ({
      ...group,
      modules: group.modules.filter((module) => module.rows.length > 0),
    }))
    .filter((group) => group.modules.length > 0)
})

const moduleCount = computed(() => modules.value.length)
const visiblePointCount = computed(() =>
  topologyGroups.value.reduce(
    (total, group) =>
      total + group.modules.reduce((moduleTotal, module) => moduleTotal + module.rows.length, 0),
    0,
  ),
)

const monitoredCount = computed(() => debug.selectedPointNames.length)
const connectionLabel = computed(() => {
  if (debug.transportState === 'online') return debug.isPolling ? '在线采样' : '在线已暂停'
  if (debug.transportState === 'degraded') return '连接降级'
  if (debug.transportState === 'connecting') return '连接预检'
  return '尚未连接'
})

function qualityLabel(quality?: PointQuality, stale = false): string {
  if (stale) return 'LOCAL STALE'
  const labels: Record<PointQuality, string> = {
    0: 'GOOD',
    1: 'STALE',
    2: 'OFFLINE',
    3: 'INVALID',
    4: 'UNCONFIGURED',
  }
  return quality === undefined ? 'NO SAMPLE' : labels[quality]
}

function statusLabel(module: TopologyModuleView, row: SignalRow): string {
  if (!module.device) return debug.diagnostics.io ? 'SNAPSHOT' : 'NO SNAPSHOT'
  return qualityLabel(row.quality, row.localStale)
}

function qualityClass(module: TopologyModuleView, row: SignalRow): string {
  return statusLabel(module, row).toLowerCase().replace(/\s+/g, '-')
}

function formatValue(row: SignalRow): string {
  if (row.value === null) return '—'
  if (typeof row.value === 'boolean') return row.value ? 'ON' : 'OFF'
  if (!Number.isFinite(row.value)) return String(row.value)
  const value = row.kind === 'AI' || row.kind === 'AO' ? row.value.toFixed(3) : String(row.value)
  return row.unit ? `${value} ${row.unit}` : value
}

function toggleMonitor(row: SignalRow) {
  if (!row.descriptorName) return
  try {
    debug.togglePointSelection(row.descriptorName)
  } catch (error) {
    controller.showMessage(error instanceof Error ? error.message : String(error), false)
  }
}

function clampLayout() {
  if (window.innerWidth <= 760) return
  width.value = Math.min(Math.max(width.value, MIN_WIDTH), window.innerWidth - EDGE_GAP * 2)
  height.value = Math.min(Math.max(height.value, MIN_HEIGHT), window.innerHeight - EDGE_GAP * 2)
  left.value = Math.min(Math.max(left.value, EDGE_GAP), window.innerWidth - width.value - EDGE_GAP)
  top.value = Math.min(Math.max(top.value, EDGE_GAP), window.innerHeight - (minimized.value ? 46 : height.value) - EDGE_GAP)
}

function persistLayout() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ left: left.value, top: top.value, width: width.value, height: height.value }),
  )
}

function restoreLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>
    width.value = typeof saved.width === 'number' ? saved.width : 780
    height.value = typeof saved.height === 'number' ? saved.height : 620
    left.value = typeof saved.left === 'number' ? saved.left : window.innerWidth - width.value - 22
    top.value = typeof saved.top === 'number' ? saved.top : 68
  } catch {
    left.value = window.innerWidth - width.value - 22
    top.value = 68
  }
  clampLayout()
}

function applyPointerMove(clientX: number, clientY: number) {
  if (dragging) {
    left.value = startLeft + clientX - startPointerX
    top.value = startTop + clientY - startPointerY
    clampLayout()
  } else if (resizing) {
    const deltaX = clientX - startPointerX
    const deltaY = clientY - startPointerY

    if (resizeDirection.includes('e')) {
      width.value = Math.min(
        Math.max(startWidth + deltaX, MIN_WIDTH),
        window.innerWidth - startLeft - EDGE_GAP,
      )
    }
    if (resizeDirection.includes('s')) {
      height.value = Math.min(
        Math.max(startHeight + deltaY, MIN_HEIGHT),
        window.innerHeight - startTop - EDGE_GAP,
      )
    }
    if (resizeDirection.includes('w')) {
      const nextLeft = Math.min(
        Math.max(startLeft + deltaX, EDGE_GAP),
        startLeft + startWidth - MIN_WIDTH,
      )
      left.value = nextLeft
      width.value = startWidth + startLeft - nextLeft
    }
    if (resizeDirection.includes('n')) {
      const nextTop = Math.min(
        Math.max(startTop + deltaY, EDGE_GAP),
        startTop + startHeight - MIN_HEIGHT,
      )
      top.value = nextTop
      height.value = startHeight + startTop - nextTop
    }
  }
}

function handlePointerMove(event: PointerEvent) {
  if (!dragging && !resizing) return
  pendingPointerPosition = { x: event.clientX, y: event.clientY }
  if (pointerFrame !== null) return

  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = null
    const pending = pendingPointerPosition
    pendingPointerPosition = null
    if (pending) applyPointerMove(pending.x, pending.y)
  })
}

function stopPointerAction() {
  if (!dragging && !resizing) return
  if (pointerFrame !== null) {
    cancelAnimationFrame(pointerFrame)
    pointerFrame = null
  }
  if (pendingPointerPosition) {
    applyPointerMove(pendingPointerPosition.x, pendingPointerPosition.y)
    pendingPointerPosition = null
  }
  dragging = false
  resizing = false
  isResizing.value = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  persistLayout()
}

function startDrag(event: PointerEvent) {
  if (window.innerWidth <= 760 || event.button !== 0) return
  dragging = true
  startPointerX = event.clientX
  startPointerY = event.clientY
  startLeft = left.value
  startTop = top.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'grabbing'
}

function startResize(event: PointerEvent, direction: ResizeDirection) {
  if (window.innerWidth <= 760 || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  resizing = true
  isResizing.value = true
  resizeDirection = direction
  startPointerX = event.clientX
  startPointerY = event.clientY
  startWidth = width.value
  startHeight = height.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = `${direction}-resize`
}

function toggleMinimize() {
  minimized.value = !minimized.value
  requestAnimationFrame(clampLayout)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  restoreLayout()
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', stopPointerAction)
  window.addEventListener('pointercancel', stopPointerAction)
  window.addEventListener('blur', stopPointerAction)
  window.addEventListener('resize', clampLayout)
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  stopPointerAction()
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', stopPointerAction)
  window.removeEventListener('pointercancel', stopPointerAction)
  window.removeEventListener('blur', stopPointerAction)
  window.removeEventListener('resize', clampLayout)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <aside
      class="topology-float"
      :class="{ minimized, resizing: isResizing }"
      :style="{ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: minimized ? '42px' : `${height}px` }"
      aria-label="I/O 拓扑伴随监测浮窗"
    >
      <header class="float-titlebar" @pointerdown="startDrag">
        <span class="drag-mark" title="拖动浮窗"><Grip :size="14" /></span>
        <div class="float-title">
          <strong><Network :size="14" />I/O 拓扑伴随监测</strong>
          <small>共享当前在线调试会话</small>
        </div>
        <span class="transport-pill" :class="debug.transportState">
          <i />{{ connectionLabel }}
        </span>
        <button title="最小化/展开" @pointerdown.stop @click="toggleMinimize">
          <ChevronUp v-if="minimized" :size="15" /><Minus v-else :size="15" />
        </button>
        <button title="关闭浮窗（Esc）" @pointerdown.stop @click="emit('close')"><X :size="15" /></button>
      </header>

      <template v-if="!minimized">
        <section class="float-summary">
          <div><span>模块</span><strong>{{ moduleCount }}</strong></div>
          <div><span>可见点</span><strong>{{ visiblePointCount }}</strong></div>
          <div><span>监测点</span><strong>{{ monitoredCount }}/12</strong></div>
          <p><Activity :size="12" />本窗不创建额外连接；输出显示目标值或回读影子，不能替代端子物理反馈。</p>
        </section>

        <section class="topology-toolbar">
          <div>
            <strong><Network :size="13" />硬件拓扑</strong>
            <span>主控板与扩展从站按物理层级集中展示</span>
          </div>
          <label><Search :size="12" /><input v-model="query" placeholder="筛选点位 / 北向名"></label>
        </section>

        <div class="topology-canvas">
          <section
            v-for="group in topologyGroups"
            :key="group.key"
            class="topology-lane"
            :class="{ bus: group.key !== 'board' }"
          >
            <header class="lane-header">
              <Cpu v-if="group.key === 'board'" :size="13" />
              <Cable v-else :size="13" />
              <strong>{{ group.label }}</strong>
              <span>{{ group.meta }}</span>
            </header>

            <div class="module-grid">
              <article
                v-for="module in group.modules"
                :key="module.key"
                class="module-card"
                :class="{ board: !module.device }"
              >
                <header class="module-header">
                  <span class="address-badge"><small>{{ module.device ? 'ADDR' : 'SLOT' }}</small><b>{{ module.addressLabel }}</b></span>
                  <div class="module-title">
                    <small>{{ module.device ? 'EXPANSION MODULE' : 'MASTER CONTROLLER' }}</small>
                    <strong>{{ module.name }}</strong>
                    <span>{{ module.meta }}</span>
                  </div>
                  <span class="module-state" :class="debug.transportState"><i />{{ module.device ? 'POLL' : 'LOCAL' }}</span>
                </header>

                <p class="module-description" :title="module.description">{{ module.description }}</p>

                <div class="module-signal-groups">
                  <section
                    v-for="kind in SIGNAL_KINDS"
                    v-show="groupRows(module, kind).length"
                    :key="kind"
                    class="signal-kind-group"
                    :class="kind.toLowerCase()"
                  >
                    <header><strong>{{ kind }}</strong><span>{{ groupRows(module, kind).length }} CH</span></header>
                    <div class="signal-tile-grid">
                      <button
                        v-for="row in groupRows(module, kind)"
                        :key="row.key"
                        class="signal-tile"
                        :class="{
                          on: row.value === true,
                          stale: row.localStale || (row.quality !== undefined && row.quality !== 0),
                          monitored: row.monitored,
                          analog: row.kind === 'AI' || row.kind === 'AO',
                        }"
                        :title="`${row.source}\n${row.semantic}${row.range ? `\n${row.range}` : ''}`"
                        :disabled="!module.device || !row.descriptorName"
                        @click="toggleMonitor(row)"
                      >
                        <span v-if="row.kind === 'DI' || row.kind === 'DO'" class="signal-lamp" />
                        <span v-else class="signal-type">{{ row.kind }}</span>
                        <span class="signal-code">{{ row.code.toUpperCase() }}</span>
                        <strong class="signal-value">{{ formatValue(row) }}</strong>
                        <span class="signal-name">{{ row.name }}</span>
                        <span class="signal-point">{{ row.descriptorName || row.pointName || '未绑定北向点' }}</span>
                        <span class="signal-quality" :class="qualityClass(module, row)"><i />{{ statusLabel(module, row) }}</span>
                        <em v-if="module.device && row.descriptorName">{{ row.monitored ? '已监测' : '+监测' }}</em>
                      </button>
                    </div>
                  </section>
                </div>
              </article>
            </div>
          </section>

          <div v-if="topologyGroups.length === 0" class="empty-state">
            <Search :size="18" />
            <strong>没有匹配的拓扑点位</strong>
            <span>请更换点位名称、物理源或北向字段关键字</span>
          </div>
        </div>

        <footer class="float-footer">
          <span>扩展点位可点击加入监测；板载值来自 /diagnostic/io 快照</span>
          <button @click="minimized = true"><ChevronDown :size="12" />收起到标题栏</button>
        </footer>
        <span class="resize-handle resize-n" @pointerdown="startResize($event, 'n')" />
        <span class="resize-handle resize-ne" @pointerdown="startResize($event, 'ne')" />
        <span class="resize-handle resize-e" @pointerdown="startResize($event, 'e')" />
        <span class="resize-handle resize-se" @pointerdown="startResize($event, 'se')" />
        <span class="resize-handle resize-s" @pointerdown="startResize($event, 's')" />
        <span class="resize-handle resize-sw" @pointerdown="startResize($event, 'sw')" />
        <span class="resize-handle resize-w" @pointerdown="startResize($event, 'w')" />
        <span class="resize-handle resize-nw" @pointerdown="startResize($event, 'nw')" />
      </template>
    </aside>
  </Teleport>
</template>

<style scoped>
.topology-float { position: fixed; z-index: 850; display: grid; grid-template-rows: 42px auto auto minmax(0, 1fr) 30px; min-width: 560px; min-height: 320px; overflow: hidden; border: 1px solid #667d8d; border-radius: 7px; background: #f5f7f8; box-shadow: 0 18px 48px rgba(18, 32, 43, .28), 0 2px 7px rgba(18, 32, 43, .22); color: #1b2b36; transform: translateZ(0); will-change: left, top, width, height; }
.topology-float.minimized { min-height: 42px; }
.topology-float.resizing { pointer-events: none; box-shadow: 0 22px 58px rgba(18, 32, 43, .33), 0 0 0 2px rgba(54, 139, 185, .2); }
.float-titlebar { display: flex; align-items: center; gap: 8px; padding: 0 7px; color: #fff; background: linear-gradient(90deg, #17384c, #214f66 68%, #1f4659); cursor: grab; user-select: none; }
.float-titlebar:active { cursor: grabbing; }.drag-mark { display: grid; place-items: center; color: #8db3c8; }.float-title { min-width: 0; display: flex; align-items: baseline; gap: 9px; }.float-title strong { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-size: 12px; letter-spacing: .02em; }.float-title small { overflow: hidden; color: #a9c4d2; font: 9px var(--font-mono, monospace); white-space: nowrap; text-overflow: ellipsis; }.float-titlebar button { width: 27px; height: 27px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(207,229,240,.25); border-radius: 3px; background: rgba(255,255,255,.07); color: #d9ebf3; cursor: pointer; }.float-titlebar button:hover { background: rgba(255,255,255,.16); }
.transport-pill { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; color: #c9d8df; font-size: 9px; font-weight: 700; white-space: nowrap; }.transport-pill i { width: 7px; height: 7px; border-radius: 50%; background: #8fa1aa; }.transport-pill.online i { background: #45d694; box-shadow: 0 0 0 3px rgba(69,214,148,.13); }.transport-pill.degraded i { background: #edb34c; }.transport-pill.connecting i { background: #63b8e8; }
.float-summary { display: grid; grid-template-columns: 76px 76px 82px 1fr; gap: 6px; align-items: center; padding: 7px 9px; border-bottom: 1px solid #cbd5dc; background: #fff; }.float-summary div { display: flex; align-items: baseline; justify-content: space-between; padding: 3px 6px; border-left: 2px solid #6d9ebb; background: #edf3f6; }.float-summary span { color: #5b6d78; font-size: 9px; }.float-summary strong { font: 700 11px var(--font-mono, monospace); }.float-summary p { min-width: 0; display: flex; align-items: center; gap: 5px; margin: 0; color: #756027; font-size: 9px; line-height: 1.25; }
.topology-toolbar { min-height: 43px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 9px; border-bottom: 1px solid #cbd5dc; background: #fff; }.topology-toolbar > div { min-width: 0; display: grid; gap: 1px; }.topology-toolbar strong { display: inline-flex; align-items: center; gap: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }.topology-toolbar span { overflow: hidden; color: #647782; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.topology-toolbar label { width: 210px; height: 28px; display: flex; align-items: center; gap: 5px; padding: 0 7px; border: 1px solid #b9c6ce; border-radius: 4px; color: #6d7e88; background: #f8fafb; }.topology-toolbar label:focus-within { border-color: #24729f; box-shadow: 0 0 0 2px rgba(36,114,159,.11); }.topology-toolbar input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; color: #263944; font-size: 10px; }
.topology-canvas { min-height: 0; overflow: auto; padding: 10px; background-color: #f8fafb; background-image: linear-gradient(rgba(121,145,160,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(121,145,160,.1) 1px, transparent 1px); background-size: 20px 20px; scrollbar-width: thin; }
.topology-lane { position: relative; display: grid; gap: 7px; margin-bottom: 11px; }.topology-lane.bus { padding-top: 8px; }.topology-lane.bus::before { content: ''; position: absolute; top: 21px; left: 18px; right: 8px; height: 3px; border-top: 1px solid #4b91c5; border-bottom: 1px solid #0f5f9e; background: #1769aa; box-shadow: 0 0 6px rgba(23,105,170,.18); }.lane-header { position: relative; z-index: 1; width: fit-content; min-height: 27px; display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; border: 1px solid #9fb4c1; border-radius: 4px; color: #185c82; background: #eef6fb; }.lane-header strong { font: 800 9px var(--font-mono, monospace); letter-spacing: .06em; }.lane-header span { color: #627987; font: 8px var(--font-mono, monospace); }
.module-grid { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); align-items: start; gap: 9px; }.module-card { min-width: 0; overflow: hidden; border: 1px solid #9eafba; border-radius: 6px; background: #fff; box-shadow: 0 5px 14px rgba(31,55,70,.12); }.module-card.board { grid-column: 1 / -1; border-top: 3px solid #24729f; }.module-header { min-height: 47px; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid #cbd6dd; background: linear-gradient(100deg, #e6f0f6, #f8fafb); }.address-badge { width: 46px; height: 34px; flex: 0 0 auto; display: grid; place-items: center; align-content: center; border: 1px solid #79aacf; border-radius: 4px; color: #627987; background: #fff; font: 7px/1 var(--font-mono, monospace); }.address-badge b { margin-top: 3px; color: #17699a; font-size: 12px; }.module-title { min-width: 0; display: grid; flex: 1; gap: 1px; }.module-title small { color: #748791; font: 700 7px var(--font-mono, monospace); letter-spacing: .11em; }.module-title strong,.module-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.module-title strong { font-size: 11px; }.module-title span { color: #647782; font: 8px var(--font-mono, monospace); }.module-state { display: inline-flex; align-items: center; gap: 4px; color: #72838d; font: 700 8px var(--font-mono, monospace); }.module-state i { width: 7px; height: 7px; border-radius: 50%; background: #95a3aa; }.module-state.online i { background: #2eaf70; box-shadow: 0 0 0 3px rgba(46,175,112,.12); }.module-state.degraded i { background: #dc982b; }.module-description { min-height: 32px; margin: 0; padding: 6px 8px; overflow: hidden; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; border-bottom: 1px solid #d8e0e5; color: #4f626e; background: #f7f9fa; font-size: 10px; line-height: 1.4; }
.module-signal-groups { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1px; background: #cad5dc; }.module-card.board .module-signal-groups { grid-template-columns: repeat(2, minmax(0, 1fr)); }.signal-kind-group { min-width: 0; background: #fff; }.signal-kind-group > header { height: 23px; display: flex; align-items: center; gap: 6px; padding: 0 7px; border-bottom: 1px solid #d2dce2; background: #eef3f6; }.signal-kind-group > header strong { color: #17638f; font: 800 9px var(--font-mono, monospace); }.signal-kind-group.do > header strong,.signal-kind-group.ao > header strong { color: #8b5a18; }.signal-kind-group > header span { margin-left: auto; color: #6c7d87; font: 8px var(--font-mono, monospace); }.signal-tile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: #d8e0e5; }
.signal-tile { min-width: 0; min-height: 91px; display: grid; grid-template-columns: 12px minmax(37px, auto) minmax(58px, 1fr); grid-template-rows: auto auto auto auto; align-items: center; gap: 3px 5px; padding: 6px 7px; border: 0; color: #263944; background: #fff; text-align: left; cursor: pointer; }.signal-tile:hover:not(:disabled) { background: #eef7fb; }.signal-tile:disabled { cursor: default; }.signal-tile.monitored { box-shadow: inset 3px 0 #247aa9; background: #f4f9fc; }.signal-tile.stale { box-shadow: inset 3px 0 #d89527; }.signal-tile.monitored.stale { box-shadow: inset 3px 0 #d89527, inset 6px 0 #247aa9; }.signal-tile.analog { grid-template-columns: 25px minmax(37px, auto) minmax(58px, 1fr); }.signal-lamp { width: 10px; height: 10px; border: 1px solid #8499a8; border-radius: 50%; background: #d7e0e6; box-shadow: inset 0 0 2px rgba(23,33,43,.24); }.signal-tile.on .signal-lamp { border-color: #128148; background: #22b866; box-shadow: 0 0 8px rgba(34,184,102,.62); }.signal-type { padding: 2px 3px; border-radius: 2px; color: #17638f; background: #dceaf2; font: 800 8px var(--font-mono, monospace); text-align: center; }.signal-kind-group.ao .signal-type { color: #87551d; background: #efe4d4; }.signal-code { font: 800 10px var(--font-mono, monospace); }.signal-value { justify-self: end; overflow: hidden; color: #183f55; font: 800 11px var(--font-mono, monospace); text-overflow: ellipsis; white-space: nowrap; }.signal-name { grid-column: 1 / -1; min-width: 0; overflow: hidden; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: #415560; font-size: 10px; line-height: 1.3; }.signal-point { grid-column: 1 / -1; min-width: 0; overflow: hidden; color: #71838d; font: 8px var(--font-mono, monospace); text-overflow: ellipsis; white-space: nowrap; }.signal-quality { grid-column: 1 / 3; display: inline-flex; align-items: center; gap: 4px; color: #778791; font: 700 7px var(--font-mono, monospace); white-space: nowrap; }.signal-quality i { width: 6px; height: 6px; border-radius: 50%; background: #a4afb5; }.signal-quality.good i,.signal-quality.snapshot i { background: #2eaf70; }.signal-quality.stale i,.signal-quality.local-stale i { background: #dc982b; }.signal-quality.offline i,.signal-quality.invalid i { background: #c64e57; }.signal-tile:disabled .signal-quality { grid-column: 1 / -1; }.signal-tile em { grid-column: 3; justify-self: end; padding: 2px 4px; border: 1px solid #a9bdc9; border-radius: 2px; color: #226b93; font: 700 7px var(--font-mono, monospace); font-style: normal; white-space: nowrap; }.empty-state { min-height: 150px; display: grid; place-items: center; align-content: center; gap: 6px; color: #7a8992; font-size: 10px; }.empty-state strong { color: #435761; font-size: 12px; }
.float-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 9px; border-top: 1px solid #c6d0d7; background: #edf1f3; color: #61747f; font-size: 9px; }.float-footer button { display: inline-flex; align-items: center; gap: 4px; padding: 2px 5px; border: 0; background: transparent; color: #245f80; cursor: pointer; font-size: 9px; }
.resize-handle { position: absolute; z-index: 20; touch-action: none; }.resize-n,.resize-s { left: 12px; right: 12px; height: 8px; cursor: ns-resize; }.resize-n { top: -3px; }.resize-s { bottom: -3px; }.resize-e,.resize-w { top: 12px; bottom: 12px; width: 8px; cursor: ew-resize; }.resize-e { right: -3px; }.resize-w { left: -3px; }.resize-ne,.resize-se,.resize-sw,.resize-nw { width: 15px; height: 15px; }.resize-ne { top: -4px; right: -4px; cursor: nesw-resize; }.resize-se { right: -4px; bottom: -4px; cursor: nwse-resize; }.resize-sw { bottom: -4px; left: -4px; cursor: nesw-resize; }.resize-nw { top: -4px; left: -4px; cursor: nwse-resize; }.resize-ne::after,.resize-se::after,.resize-sw::after,.resize-nw::after { content: ''; position: absolute; width: 7px; height: 7px; border-color: rgba(83,111,127,.68); border-style: solid; }.resize-ne::after { top: 4px; right: 4px; border-width: 1px 1px 0 0; }.resize-se::after { right: 4px; bottom: 4px; border-width: 0 1px 1px 0; }.resize-sw::after { bottom: 4px; left: 4px; border-width: 0 0 1px 1px; }.resize-nw::after { top: 4px; left: 4px; border-width: 1px 0 0 1px; }
@media (max-width: 760px) { .topology-float { inset: auto 6px 6px 6px !important; width: auto !important; height: min(72vh, 620px) !important; min-width: 0; }.topology-float.minimized { height: 42px !important; }.float-titlebar { cursor: default; }.float-title small,.float-summary p,.topology-toolbar span { display: none; }.float-summary { grid-template-columns: repeat(3, 1fr); }.topology-toolbar label { width: min(210px, 52vw); }.module-card.board .module-signal-groups { grid-template-columns: minmax(0, 1fr); }.resize-handle { display: none; } }
@media (max-width: 560px) { .module-grid { grid-template-columns: minmax(0, 1fr); }.float-title strong { font-size: 11px; }.transport-pill { display: none; } }
</style>
