<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Activity,
  ChevronDown,
  ChevronUp,
  CircleDot,
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

interface TopologyTarget {
  key: string
  name: string
  meta: string
  device?: DeviceInstanceConfig
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

const STORAGE_KEY = 'np-tools:kz3-floating-topology-layout:v1'
const MIN_WIDTH = 430
const MIN_HEIGHT = 320
const EDGE_GAP = 10

const left = ref(0)
const top = ref(0)
const width = ref(620)
const height = ref(520)
const minimized = ref(false)
const query = ref('')
const activeTargetKey = ref('board')
let dragging = false
let resizing = false
let startPointerX = 0
let startPointerY = 0
let startLeft = 0
let startTop = 0
let startWidth = 0
let startHeight = 0

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

const targets = computed<TopologyTarget[]>(() => [
  {
    key: 'board',
    name: 'KZ3 主控板',
    meta: `${KZ3_BOARD_DEF.channels.length} 路板载 I/O`,
  },
  ...controller.doc.project.devices.map((device) => {
    const profile = resolveDeviceProfile(controller.doc, device)
    return {
      key: device.id,
      name: device.name,
      meta: `${profile.name} · ${device.port.toUpperCase()} / 站号 ${device.slave_address}`,
      device,
    }
  }),
])

const activeTarget = computed(
  () => targets.value.find((item) => item.key === activeTargetKey.value) || targets.value[0],
)

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

const visibleRows = computed(() => {
  const rows = activeTarget.value.device ? deviceRows(activeTarget.value.device) : boardRows()
  const normalized = query.value.trim().toLowerCase()
  if (!normalized) return rows
  return rows.filter((row) =>
    [row.code, row.name, row.pointName, row.descriptorName, row.source]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized)),
  )
})

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
    width.value = typeof saved.width === 'number' ? saved.width : 620
    height.value = typeof saved.height === 'number' ? saved.height : 520
    left.value = typeof saved.left === 'number' ? saved.left : window.innerWidth - width.value - 22
    top.value = typeof saved.top === 'number' ? saved.top : 68
  } catch {
    left.value = window.innerWidth - width.value - 22
    top.value = 68
  }
  clampLayout()
}

function handlePointerMove(event: PointerEvent) {
  if (dragging) {
    left.value = startLeft + event.clientX - startPointerX
    top.value = startTop + event.clientY - startPointerY
    clampLayout()
  } else if (resizing) {
    width.value = startWidth + event.clientX - startPointerX
    height.value = startHeight + event.clientY - startPointerY
    clampLayout()
  }
}

function stopPointerAction() {
  if (!dragging && !resizing) return
  dragging = false
  resizing = false
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

function startResize(event: PointerEvent) {
  if (window.innerWidth <= 760 || event.button !== 0) return
  event.preventDefault()
  resizing = true
  startPointerX = event.clientX
  startPointerY = event.clientY
  startWidth = width.value
  startHeight = height.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'nwse-resize'
}

function toggleMinimize() {
  minimized.value = !minimized.value
  requestAnimationFrame(clampLayout)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

watch(targets, (value) => {
  if (!value.some((item) => item.key === activeTargetKey.value)) activeTargetKey.value = 'board'
})

onMounted(() => {
  restoreLayout()
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', stopPointerAction)
  window.addEventListener('resize', clampLayout)
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  stopPointerAction()
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', stopPointerAction)
  window.removeEventListener('resize', clampLayout)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <aside
      class="topology-float"
      :class="{ minimized }"
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
          <div><span>设备</span><strong>{{ targets.length }}</strong></div>
          <div><span>监测点</span><strong>{{ monitoredCount }}/12</strong></div>
          <div><span>采样周期</span><strong>1 s</strong></div>
          <p><Activity :size="12" />本窗不创建额外连接；输出显示目标值或回读影子，不能替代端子物理反馈。</p>
        </section>

        <nav class="target-tabs" aria-label="拓扑设备">
          <button
            v-for="target in targets"
            :key="target.key"
            :class="{ active: activeTarget?.key === target.key }"
            :title="target.meta"
            @click="activeTargetKey = target.key"
          >
            <CircleDot :size="11" />
            <span>{{ target.name }}</span>
            <small>{{ target.device ? target.device.slave_address : 'LOCAL' }}</small>
          </button>
        </nav>

        <section class="device-strip">
          <div>
            <strong>{{ activeTarget?.name }}</strong>
            <span>{{ activeTarget?.meta }}</span>
          </div>
          <label><Search :size="12" /><input v-model="query" placeholder="筛选点位 / 北向名"></label>
        </section>

        <div class="signal-table">
          <div class="signal-head">
            <span>信号</span><span>业务绑定</span><span>实时值</span><span>质量 / 监测</span>
          </div>
          <button
            v-for="row in visibleRows"
            :key="row.key"
            class="signal-row"
            :class="{ disabled: !row.enabled, on: row.value === true, stale: row.localStale || (row.quality !== undefined && row.quality !== 0) }"
            :title="`${row.source}\n${row.semantic}${row.range ? `\n${row.range}` : ''}`"
            :disabled="!row.descriptorName || activeTarget?.key === 'board'"
            @click="toggleMonitor(row)"
          >
            <span class="signal-id"><i :class="row.kind.toLowerCase()">{{ row.kind }}</i><b>{{ row.code }}</b></span>
            <span class="signal-binding"><b>{{ row.name }}</b><small>{{ row.descriptorName || row.pointName || '未绑定北向点' }}</small></span>
            <strong class="signal-value">{{ formatValue(row) }}</strong>
            <span class="signal-quality" :class="qualityLabel(row.quality, row.localStale).toLowerCase().replace(' ', '-')">
              <i />{{ activeTarget?.key === 'board' ? (debug.diagnostics.io ? 'SNAPSHOT' : 'NO SNAPSHOT') : qualityLabel(row.quality, row.localStale) }}
              <em v-if="activeTarget?.key !== 'board' && row.descriptorName">{{ row.monitored ? '移出' : '+监测' }}</em>
            </span>
          </button>
          <div v-if="visibleRows.length === 0" class="empty-state">没有匹配的点位</div>
        </div>

        <footer class="float-footer">
          <span>{{ activeTarget?.device ? '点击点位可加入或移出当前采样列表' : '板载值来自 /diagnostic/io 快照' }}</span>
          <button @click="minimized = true"><ChevronDown :size="12" />收起到标题栏</button>
        </footer>
        <button class="resize-handle" title="拖动调整大小" @pointerdown="startResize" />
      </template>
    </aside>
  </Teleport>
</template>

<style scoped>
.topology-float { position: fixed; z-index: 850; display: grid; grid-template-rows: 42px auto auto auto minmax(0, 1fr) 30px; min-width: 430px; min-height: 320px; overflow: hidden; border: 1px solid #667d8d; border-radius: 6px; background: #f5f7f8; box-shadow: 0 18px 48px rgba(18, 32, 43, .28), 0 2px 7px rgba(18, 32, 43, .22); color: #1b2b36; }
.topology-float.minimized { min-height: 42px; }
.float-titlebar { display: flex; align-items: center; gap: 8px; padding: 0 7px; color: #fff; background: linear-gradient(90deg, #17384c, #214f66 68%, #1f4659); cursor: grab; user-select: none; }
.float-titlebar:active { cursor: grabbing; }.drag-mark { display: grid; place-items: center; color: #8db3c8; }.float-title { min-width: 0; display: flex; align-items: baseline; gap: 9px; }.float-title strong { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-size: 12px; letter-spacing: .02em; }.float-title small { overflow: hidden; color: #a9c4d2; font: 9px var(--font-mono, monospace); white-space: nowrap; text-overflow: ellipsis; }.float-titlebar button { width: 27px; height: 27px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(207,229,240,.25); border-radius: 3px; background: rgba(255,255,255,.07); color: #d9ebf3; cursor: pointer; }.float-titlebar button:hover { background: rgba(255,255,255,.16); }
.transport-pill { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; color: #c9d8df; font-size: 9px; font-weight: 700; white-space: nowrap; }.transport-pill i { width: 7px; height: 7px; border-radius: 50%; background: #8fa1aa; }.transport-pill.online i { background: #45d694; box-shadow: 0 0 0 3px rgba(69,214,148,.13); }.transport-pill.degraded i { background: #edb34c; }.transport-pill.connecting i { background: #63b8e8; }
.float-summary { display: grid; grid-template-columns: 76px 76px 82px 1fr; gap: 6px; align-items: center; padding: 7px 9px; border-bottom: 1px solid #cbd5dc; background: #fff; }.float-summary div { display: flex; align-items: baseline; justify-content: space-between; padding: 3px 6px; border-left: 2px solid #6d9ebb; background: #edf3f6; }.float-summary span { color: #5b6d78; font-size: 9px; }.float-summary strong { font: 700 11px var(--font-mono, monospace); }.float-summary p { min-width: 0; display: flex; align-items: center; gap: 5px; margin: 0; color: #756027; font-size: 9px; line-height: 1.25; }
.target-tabs { display: flex; gap: 4px; overflow-x: auto; padding: 6px 8px; border-bottom: 1px solid #d4dde3; background: #e9eef1; scrollbar-width: thin; }.target-tabs button { min-width: 0; max-width: 190px; height: 26px; display: inline-flex; align-items: center; gap: 5px; padding: 0 7px; border: 1px solid #b8c5cd; border-radius: 3px; background: #f8fafb; color: #425866; cursor: pointer; white-space: nowrap; }.target-tabs button span { overflow: hidden; text-overflow: ellipsis; font-size: 10px; font-weight: 650; }.target-tabs button small { margin-left: auto; color: #70838f; font: 8px var(--font-mono, monospace); }.target-tabs button.active { border-color: #24729f; background: #dcecf5; color: #15587d; box-shadow: inset 0 -2px #24729f; }
.device-strip { min-height: 43px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 9px; border-bottom: 1px solid #cbd5dc; background: #fff; }.device-strip > div { min-width: 0; display: grid; gap: 1px; }.device-strip strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }.device-strip span { overflow: hidden; color: #647782; font: 9px var(--font-mono, monospace); text-overflow: ellipsis; white-space: nowrap; }.device-strip label { width: 178px; height: 26px; display: flex; align-items: center; gap: 5px; padding: 0 7px; border: 1px solid #b9c6ce; border-radius: 3px; color: #6d7e88; background: #f8fafb; }.device-strip input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; color: #263944; font-size: 10px; }
.signal-table { min-height: 0; overflow: auto; background: #fff; }.signal-head,.signal-row { display: grid; grid-template-columns: 92px minmax(150px, 1fr) 112px 118px; align-items: center; }.signal-head { position: sticky; top: 0; z-index: 2; min-height: 24px; padding: 0 9px; border-bottom: 1px solid #b9c7d0; background: #e5ebef; color: #657783; font-size: 8px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }.signal-row { width: 100%; min-height: 43px; padding: 3px 9px; border: 0; border-bottom: 1px solid #e0e6ea; background: #fff; color: inherit; text-align: left; cursor: pointer; }.signal-row:hover:not(:disabled) { background: #eef7fb; }.signal-row:disabled { cursor: default; }.signal-row.disabled { opacity: .48; background: #f2f4f5; }.signal-row.on { box-shadow: inset 3px 0 #26a66b; }.signal-row.stale { box-shadow: inset 3px 0 #d89527; }
.signal-id { display: flex; align-items: center; gap: 6px; }.signal-id > i { min-width: 26px; padding: 2px 3px; border-radius: 2px; background: #dceaf2; color: #155d84; font: 700 8px var(--font-mono, monospace); text-align: center; }.signal-id > i.do,.signal-id > i.ao { background: #efe4d4; color: #87551d; }.signal-id b { font: 700 10px var(--font-mono, monospace); }.signal-binding { min-width: 0; display: grid; gap: 2px; }.signal-binding b,.signal-binding small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.signal-binding b { font-size: 10px; }.signal-binding small { color: #75858f; font: 8px var(--font-mono, monospace); }.signal-value { color: #183f55; font: 700 12px var(--font-mono, monospace); }.signal-quality { display: flex; align-items: center; gap: 5px; color: #778791; font: 700 8px var(--font-mono, monospace); }.signal-quality > i { width: 6px; height: 6px; border-radius: 50%; background: #a4afb5; }.signal-quality.good > i,.signal-quality.snapshot > i { background: #2eaf70; }.signal-quality.stale > i,.signal-quality.local-stale > i { background: #dc982b; }.signal-quality.offline > i,.signal-quality.invalid > i { background: #c64e57; }.signal-quality em { margin-left: auto; padding: 2px 4px; border: 1px solid #a9bdc9; border-radius: 2px; color: #226b93; font-style: normal; }.empty-state { display: grid; min-height: 100px; place-items: center; color: #7a8992; font-size: 11px; }
.float-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 9px; border-top: 1px solid #c6d0d7; background: #edf1f3; color: #61747f; font-size: 9px; }.float-footer button { display: inline-flex; align-items: center; gap: 4px; padding: 2px 5px; border: 0; background: transparent; color: #245f80; cursor: pointer; font-size: 9px; }.resize-handle { position: absolute; right: 1px; bottom: 1px; width: 18px; height: 18px; border: 0; background: linear-gradient(135deg, transparent 0 45%, #78909e 46% 52%, transparent 53% 62%, #78909e 63% 69%, transparent 70%); cursor: nwse-resize; }
@media (max-width: 760px) { .topology-float { inset: auto 6px 6px 6px !important; width: auto !important; height: min(68vh, 560px) !important; min-width: 0; }.topology-float.minimized { height: 42px !important; }.float-titlebar { cursor: default; }.float-title small,.float-summary p { display: none; }.float-summary { grid-template-columns: repeat(3, 1fr); }.signal-head,.signal-row { grid-template-columns: 72px minmax(120px, 1fr) 86px 78px; }.resize-handle { display: none; } }
</style>
