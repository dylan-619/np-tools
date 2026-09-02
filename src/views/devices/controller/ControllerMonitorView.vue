<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Activity,
  ArrowLeft,
  Cable,
  CircleDot,
  Cpu,
  Eye,
  EyeOff,
  Gauge,
  Network,
  Pause,
  Play,
  Power,
  RefreshCw,
  Router,
  ShieldCheck,
  Unplug,
  Zap,
} from 'lucide-vue-next'
import { useControllerStore } from '../../../stores/controllerStore'
import { useControllerDebugStore } from '../../../stores/controllerDebugStore'
import { KZ3_BOARD_DEF, PROFILE_CATALOG } from '../../../utils/controllerIoCatalog'
import type { BoardChannelDef, DeviceInstanceConfig, ProfileSignalDef } from '../../../types/controllerIo'
import type { Kz3Scalar, PointQuality } from '../../../types/controllerDebug'

type SignalKind = 'DI' | 'DO' | 'AI' | 'AO'

interface SignalView {
  key: string
  code: string
  name: string
  kind: SignalKind
  enabled: boolean
  pointName?: string
  descriptorName?: string
  value: Kz3Scalar | null
  quality?: PointQuality
  range?: string
  monitored: boolean
  localStale: boolean
}

const MAX_MONITORED_POINTS = 12
const controller = useControllerStore()
const debug = useControllerDebugStore()
const router = useRouter()
const connectError = ref('')

const pointBySource = computed(() => {
  const map = new Map<string, { name: string }>()
  for (const point of [
    ...controller.doc.project.points.inputs,
    ...controller.doc.project.points.outputs,
  ]) {
    if (point.source) map.set(point.source, point)
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

function signalKind(code: string): SignalKind {
  return code.slice(0, 2).toUpperCase() as SignalKind
}

function channelIndex(code: string): number {
  return Math.max(0, Number.parseInt(code.slice(2), 10) - 1)
}

function boardChannelValue(channel: BoardChannelDef): Kz3Scalar | null {
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
  return { pointName: point?.name, descriptorName }
}

const boardSignals = computed<SignalView[]>(() =>
  KZ3_BOARD_DEF.channels.map((channel) => {
    const source = `board.${channel.code}`
    const binding = bindingForSource(source)
    return {
      key: source,
      code: channel.code,
      name: channel.name,
      kind: signalKind(channel.code),
      enabled: true,
      pointName: binding.pointName,
      descriptorName: binding.descriptorName,
      value: boardChannelValue(channel),
      range: channel.range,
      monitored: true,
      localStale: debug.transportState === 'degraded',
    }
  }),
)

function isSignalEnabled(device: DeviceInstanceConfig, signal: ProfileSignalDef): boolean {
  return signal.direction === 'input'
    ? (device.use.inputs || []).includes(signal.code)
    : Object.prototype.hasOwnProperty.call(device.use.outputs || {}, signal.code)
}

function expansionSignals(device: DeviceInstanceConfig): SignalView[] {
  const profile = PROFILE_CATALOG[device.profile]
  if (!profile) return []
  return [...profile.inputs, ...profile.outputs].map((signal) => {
    const source = `rtu.${device.name}.${signal.code}`
    const binding = bindingForSource(source)
    const sample = binding.descriptorName ? debug.samples[binding.descriptorName] : undefined
    return {
      key: source,
      code: signal.code,
      name: signal.name,
      kind: signalKind(signal.code),
      enabled: isSignalEnabled(device, signal),
      pointName: binding.pointName,
      descriptorName: binding.descriptorName,
      value: sample?.value ?? null,
      quality: sample?.quality,
      range: signal.engineeringRange,
      monitored: Boolean(
        binding.descriptorName && debug.selectedPointNames.includes(binding.descriptorName),
      ),
      localStale: sample?.localStale ?? false,
    }
  })
}

const busGroups = computed(() => {
  const project = controller.doc.project
  const ports = new Set([...Object.keys(project.rs485_ports), ...project.devices.map((d) => d.port)])
  return [...ports]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((port) => ({
      port,
      config: project.rs485_ports[port],
      devices: project.devices
        .filter((device) => device.port === port)
        .slice()
        .sort((a, b) => a.slave_address - b.slave_address || a.name.localeCompare(b.name)),
    }))
})

const topologyPointNames = computed(() => {
  const names: string[] = []
  for (const group of busGroups.value) {
    for (const device of group.devices) {
      for (const signal of expansionSignals(device)) {
        if (signal.enabled && signal.descriptorName && !names.includes(signal.descriptorName)) {
          names.push(signal.descriptorName)
        }
      }
    }
  }
  return names
})

const configuredExpansionCount = computed(() =>
  busGroups.value.reduce(
    (count, group) =>
      count +
      group.devices.reduce(
        (deviceCount, device) =>
          deviceCount + expansionSignals(device).filter((signal) => signal.enabled).length,
        0,
      ),
    0,
  ),
)

const activeDigitalCount = computed(() => {
  let count = boardSignals.value.filter(
    (signal) => (signal.kind === 'DI' || signal.kind === 'DO') && signal.value === true,
  ).length
  for (const group of busGroups.value) {
    for (const device of group.devices) {
      count += expansionSignals(device).filter(
        (signal) =>
          signal.enabled &&
          (signal.kind === 'DI' || signal.kind === 'DO') &&
          signal.value === true,
      ).length
    }
  }
  return count
})

const connectionLabel = computed(() => {
  if (debug.transportState === 'connecting') return '正在建立会话'
  if (debug.transportState === 'online') return '实时监测中'
  if (debug.transportState === 'degraded') return '连接质量下降'
  return '尚未连接控制器'
})

function primeTopologyMonitor() {
  debug.clearPointSelection()
  for (const name of topologyPointNames.value.slice(0, MAX_MONITORED_POINTS)) {
    debug.togglePointSelection(name)
  }
}

async function connect() {
  connectError.value = ''
  try {
    await debug.connect()
    primeTopologyMonitor()
    await debug.pollOnce()
  } catch (error) {
    connectError.value = error instanceof Error ? error.message : String(error)
  }
}

async function refreshNow() {
  connectError.value = ''
  try {
    await debug.pollOnce()
  } catch (error) {
    connectError.value = error instanceof Error ? error.message : String(error)
  }
}

function togglePolling() {
  if (debug.isPolling) debug.stopPolling()
  else debug.startPolling()
}

function toggleSignalMonitor(signal: SignalView) {
  if (!signal.descriptorName) return
  try {
    debug.togglePointSelection(signal.descriptorName)
  } catch (error) {
    controller.showMessage(error instanceof Error ? error.message : String(error), false)
  }
}

function qualityLabel(quality?: PointQuality): string {
  return quality === 0
    ? 'GOOD'
    : quality === 1
      ? 'STALE'
      : quality === 2
        ? 'OFFLINE'
        : quality === 3
          ? 'FAULT'
          : quality === 4
            ? 'FORCED'
            : 'NO DATA'
}

function formatValue(signal: SignalView): string {
  if (signal.value === null) return '—'
  if (signal.kind === 'DI' || signal.kind === 'DO') return signal.value === true ? 'ON' : 'OFF'
  if (typeof signal.value !== 'number') return String(signal.value)
  if (signal.kind === 'AI' || signal.kind === 'AO') {
    if (signal.range?.includes('µA') || signal.key.startsWith('board.')) {
      return `${(signal.value / 1000).toFixed(3)} mA`
    }
    return Number.isInteger(signal.value) ? String(signal.value) : signal.value.toFixed(3)
  }
  return String(signal.value)
}

function parityLabel(parity?: string): string {
  if (parity === 'even') return 'E'
  if (parity === 'odd') return 'O'
  return 'N'
}

onMounted(() => {
  if (debug.session && debug.isConnected) {
    primeTopologyMonitor()
    debug.startPolling()
  }
})

onUnmounted(() => debug.suspend())
</script>

<template>
  <div class="monitor-page">
    <header class="monitor-header">
      <div class="header-identity">
        <button class="icon-button" title="返回工程组态" @click="router.push({ name: 'ControllerProduct' })">
          <ArrowLeft :size="16" />
        </button>
        <div class="brand-mark"><Activity :size="19" /></div>
        <div>
          <span class="eyebrow">LIVE I/O TOPOLOGY</span>
          <div class="title-line">
            <h1>KZ3 可视化监测</h1>
            <code>{{ controller.doc.project.id }}@{{ controller.doc.project.version }}</code>
          </div>
        </div>
      </div>

      <div class="connection-controls">
        <label class="address-field">
          <span>控制器地址</span>
          <input
            v-model="debug.baseUrl"
            :disabled="debug.transportState !== 'disconnected'"
            spellcheck="false"
            @keyup.enter="debug.transportState === 'disconnected' && connect()"
          >
        </label>
        <div class="connection-pill" :class="debug.transportState">
          <span class="status-led" />
          <div><strong>{{ connectionLabel }}</strong><small>{{ debug.consecutiveErrors }} 次连续错误</small></div>
        </div>
        <button
          v-if="debug.transportState === 'disconnected'"
          class="action-button connect"
          @click="connect"
        >
          <Cable :size="15" />连接
        </button>
        <button v-else class="action-button disconnect" @click="debug.disconnect()">
          <Power :size="15" />断开
        </button>
        <button class="square-button" :disabled="!debug.isConnected" :title="debug.isPolling ? '暂停轮询' : '继续轮询'" @click="togglePolling">
          <Pause v-if="debug.isPolling" :size="15" /><Play v-else :size="15" />
        </button>
        <button class="square-button" :disabled="!debug.isConnected || debug.pollInFlight" title="立即刷新" @click="refreshNow">
          <RefreshCw :size="15" :class="{ spinning: debug.pollInFlight }" />
        </button>
      </div>
    </header>

    <div v-if="connectError" class="error-strip"><Unplug :size="14" />{{ connectError }}</div>

    <section class="overview-strip">
      <div class="overview-primary">
        <span class="kicker">设备</span>
        <strong>{{ debug.diagnostics.device?.data.serial_number || '等待连接' }}</strong>
        <small>{{ debug.diagnostics.device?.data.device_type || 'KZ3 F427 Controller' }}</small>
      </div>
      <div class="metric"><Cpu :size="15" /><span>板载 I/O</span><strong>{{ KZ3_BOARD_DEF.channels.length }}</strong><small>12 DI · 8 DO · 4 AI · 2 AO</small></div>
      <div class="metric"><Router :size="15" /><span>扩展模块</span><strong>{{ controller.doc.project.devices.length }}</strong><small>{{ busGroups.length }} 条 RS-485 总线</small></div>
      <div class="metric"><Gauge :size="15" /><span>已配置通道</span><strong>{{ configuredExpansionCount }}</strong><small>扩展模块启用点</small></div>
      <div class="metric live"><Zap :size="15" /><span>数字量 ON</span><strong>{{ debug.isConnected ? activeDigitalCount : '—' }}</strong><small>当前快照</small></div>
      <div class="metric"><Eye :size="15" /><span>周期监测</span><strong>{{ debug.selectedPointNames.length }}/{{ MAX_MONITORED_POINTS }}</strong><small>扩展北向点位</small></div>
    </section>

    <main class="topology-canvas">
      <section class="controller-node">
        <header class="node-header">
          <div class="node-icon"><Cpu :size="22" /></div>
          <div class="node-copy">
            <span class="node-kicker">MASTER CONTROLLER</span>
            <h2>{{ KZ3_BOARD_DEF.name.split(' (')[0] }}</h2>
            <code>{{ KZ3_BOARD_DEF.id }}</code>
          </div>
          <span class="health-badge" :class="{ healthy: debug.allHealthHealthy }"><ShieldCheck :size="13" />{{ debug.allHealthHealthy ? 'HEALTHY' : 'UNVERIFIED' }}</span>
        </header>

        <div class="board-groups">
          <section v-for="kind in (['DI', 'DO', 'AI', 'AO'] as SignalKind[])" :key="kind" class="signal-group" :class="kind.toLowerCase()">
            <header><strong>{{ kind }}</strong><span>{{ boardSignals.filter((signal) => signal.kind === kind).length }} CH</span></header>
            <div class="signal-grid" :class="{ analog: kind === 'AI' || kind === 'AO' }">
              <article
                v-for="signal in boardSignals.filter((item) => item.kind === kind)"
                :key="signal.key"
                class="signal-cell"
                :class="{ on: signal.value === true, stale: signal.localStale }"
                :title="signal.pointName ? `point.${signal.pointName}` : `${signal.name} · 未绑定业务点`"
              >
                <span v-if="kind === 'DI' || kind === 'DO'" class="signal-lamp" />
                <div class="signal-copy"><strong>{{ signal.code.toUpperCase() }}</strong><small>{{ signal.pointName || '未绑定' }}</small></div>
                <b>{{ formatValue(signal) }}</b>
              </article>
            </div>
          </section>
        </div>
      </section>

      <section class="bus-stack">
        <article v-for="group in busGroups" :key="group.port" class="bus-lane">
          <header class="bus-header">
            <div class="bus-port"><Network :size="16" /><strong>{{ group.port.toUpperCase() }}</strong><span>MASTER</span></div>
            <div class="bus-spec" v-if="group.config">
              {{ group.config.baud }} bps · 8{{ parityLabel(group.config.parity) }}{{ group.config.stop_bits }} · timeout {{ group.config.response_timeout_ms }} ms
            </div>
            <div class="bus-count">{{ group.devices.length }} 从站</div>
          </header>

          <div class="bus-track">
            <div class="bus-origin"><span class="port-socket"><CircleDot :size="17" /></span><small>A / B</small></div>
            <div class="bus-wire" />
            <div v-if="group.devices.length" class="module-row">
              <article v-for="device in group.devices" :key="device.id" class="module-card">
                <div class="drop-line"><span /></div>
                <header class="module-header">
                  <span class="address-badge">ADDR <b>{{ device.slave_address }}</b></span>
                  <div class="module-title"><strong>{{ device.name }}</strong><code>{{ device.profile }}</code></div>
                  <span class="module-state" :class="debug.isConnected ? 'online' : 'unknown'"><i />{{ debug.isConnected ? 'POLL' : 'IDLE' }}</span>
                </header>
                <p class="profile-description">{{ PROFILE_CATALOG[device.profile]?.description || '未知扩展模块 Profile' }}</p>
                <div class="module-signals">
                  <button
                    v-for="signal in expansionSignals(device)"
                    :key="signal.key"
                    class="module-signal"
                    :class="[
                      signal.kind.toLowerCase(),
                      { enabled: signal.enabled, on: signal.value === true, monitored: signal.monitored, stale: signal.localStale },
                    ]"
                    :disabled="!signal.descriptorName"
                    :title="signal.descriptorName ? `${signal.name} · 点击${signal.monitored ? '移出' : '加入'}周期监测` : `${signal.name} · 未绑定北向点位`"
                    @click="toggleSignalMonitor(signal)"
                  >
                    <span v-if="signal.kind === 'DI' || signal.kind === 'DO'" class="mini-lamp" />
                    <span class="signal-id">{{ signal.code.toUpperCase() }}</span>
                    <span class="signal-point">{{ signal.pointName || (signal.enabled ? '未映射' : '未启用') }}</span>
                    <strong>{{ formatValue(signal) }}</strong>
                    <Eye v-if="signal.monitored" :size="11" class="watch-icon" /><EyeOff v-else-if="signal.descriptorName" :size="11" class="watch-icon" />
                  </button>
                </div>
                <footer class="module-footer">
                  <span>{{ expansionSignals(device).filter((signal) => signal.enabled).length }} 通道已配置</span>
                  <span>{{ expansionSignals(device).filter((signal) => signal.monitored).length }} 周期监测</span>
                  <span :class="{ warning: expansionSignals(device).some((signal) => signal.enabled && !signal.descriptorName) }">{{ expansionSignals(device).filter((signal) => signal.enabled && !signal.descriptorName).length }} 未映射</span>
                </footer>
              </article>
            </div>
            <div v-else class="empty-bus">该端口尚未配置从站模块</div>
          </div>
        </article>

        <div v-if="busGroups.length === 0" class="empty-topology">
          <Network :size="28" /><strong>尚未配置 RS-485 总线</strong><span>返回硬件组态添加扩展模块后，这里会按从站地址生成拓扑。</span>
        </div>
      </section>
    </main>

    <footer class="monitor-legend">
      <span><i class="legend-dot on" />数字量 ON</span><span><i class="legend-dot off" />数字量 OFF</span><span><i class="legend-dot none" />无实时证据</span>
      <span class="legend-note">扩展点按从站地址顺序显示；点击已映射通道可加入/移出周期监测。{{ topologyPointNames.length > MAX_MONITORED_POINTS ? `当前 ${topologyPointNames.length} 个扩展点可监测，受设备 HTTP 并发保护限制同时轮询前 ${MAX_MONITORED_POINTS} 个。` : '' }}</span>
      <span class="quality-note">{{ qualityLabel(undefined) }} 不等于 OFF / 0</span>
    </footer>
  </div>
</template>

<style scoped>
.monitor-page {
  --ink: var(--color-text-primary, #17212b);
  --muted: var(--color-text-secondary, #40515f);
  --panel: var(--color-surface-1, #ffffff);
  --panel-2: var(--color-surface-2, #f7f9fb);
  --line: var(--color-border-default, #b9c5cf);
  --cyan: var(--color-accent, #1769aa);
  --green: var(--color-success, #176b45);
  --amber: var(--color-warning, #7a4b00);
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow: hidden;
  color: var(--ink);
  background:
    radial-gradient(circle at 15% 0%, rgba(23, 105, 170, 0.08), transparent 34%),
    var(--color-canvas, #edf1f4);
}

.monitor-header,
.overview-strip,
.monitor-legend {
  flex-shrink: 0;
  border: 1px solid var(--line);
  background: var(--panel);
  box-shadow: 0 3px 12px rgba(35, 56, 71, 0.06);
}

.monitor-header { min-height: 62px; padding: 8px 10px; display: flex; align-items: center; gap: 16px; justify-content: space-between; border-radius: 8px; }
.header-identity, .connection-controls, .title-line, .connection-pill, .overview-strip, .metric, .node-header, .bus-header, .bus-port, .module-header, .module-footer, .monitor-legend { display: flex; align-items: center; }
.header-identity { gap: 9px; min-width: 0; }
.icon-button, .square-button { width: 30px; height: 30px; border: 1px solid var(--line); border-radius: 5px; color: var(--muted); background: var(--panel-2); display: grid; place-items: center; cursor: pointer; }
.icon-button:hover, .square-button:hover:not(:disabled) { border-color: var(--cyan); color: var(--cyan); }
.square-button:disabled { opacity: .4; cursor: not-allowed; }
.brand-mark { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid #9fc1dc; border-radius: 7px; color: var(--cyan); background: #e7f1fa; box-shadow: inset 0 0 16px rgba(23,105,170,.04); }
.eyebrow, .node-kicker { display: block; margin-bottom: 2px; color: var(--color-text-tertiary, #5f6f7d); font: 700 9px/1 var(--font-mono); letter-spacing: .16em; }
.title-line { gap: 9px; min-width: 0; }
.title-line h1 { margin: 0; color: var(--ink); font-size: 16px; line-height: 1.1; white-space: nowrap; }
.title-line code { padding: 2px 6px; border-radius: 3px; color: var(--muted); background: var(--color-surface-3, #eef3f7); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 230px; }
.connection-controls { gap: 7px; margin-left: auto; }
.address-field { display: grid; gap: 2px; }
.address-field span { color: var(--color-text-tertiary, #5f6f7d); font-size: 9px; font-weight: 700; letter-spacing: .05em; }
.address-field input { width: 210px; height: 29px; padding: 0 8px; border: 1px solid var(--line); border-radius: 4px; outline: none; color: var(--ink) !important; background: #ffffff; font: 11px var(--font-mono); }
.address-field input:focus { border-color: var(--cyan); box-shadow: 0 0 0 2px rgba(23,105,170,.12); }
.connection-pill { min-width: 150px; gap: 7px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel-2); }
.connection-pill div { display: grid; line-height: 1.1; }
.connection-pill strong { font-size: 11px; }.connection-pill small { margin-top: 2px; color: var(--color-text-tertiary, #5f6f7d); font-size: 9px; }
.status-led, .module-state i { width: 7px; height: 7px; border-radius: 50%; background: #8fa2b0; box-shadow: 0 0 0 3px rgba(143,162,176,.14); }
.connection-pill.online .status-led, .module-state.online i { background: #22a861; box-shadow: 0 0 7px rgba(34,168,97,.5); }
.connection-pill.degraded .status-led { background: #d18b18; box-shadow: 0 0 7px rgba(209,139,24,.45); }
.connection-pill.connecting .status-led { background: var(--cyan); animation: pulse 1s infinite; }
.action-button { height: 30px; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid; border-radius: 5px; color: #fff; font-weight: 650; font-size: 11px; cursor: pointer; }
.action-button.connect { border-color: #1769aa; background: #1769aa; }.action-button.disconnect { border-color: #c4878c; color: #8f2028; background: #fdebed; }
.error-strip { flex-shrink: 0; display: flex; align-items: center; gap: 7px; padding: 6px 9px; border: 1px solid #d58b90; border-radius: 5px; color: #8f2028; background: #fdebed; font-size: 11px; }

.overview-strip { min-height: 58px; border-radius: 8px; overflow: hidden; }
.overview-primary { min-width: 190px; align-self: stretch; display: grid; align-content: center; padding: 7px 13px; border-right: 1px solid var(--line); background: linear-gradient(90deg, rgba(23,105,170,.08), transparent); }
.overview-primary .kicker { color: var(--color-text-tertiary, #5f6f7d); font-size: 9px; font-weight: 700; }.overview-primary strong { font: 700 14px var(--font-mono); color: var(--ink); }.overview-primary small { color: var(--color-text-tertiary, #5f6f7d); font-size: 9px; }
.metric { min-width: 120px; flex: 1; align-self: stretch; display: grid; grid-template-columns: 18px 1fr auto; grid-template-rows: 1fr 1fr; column-gap: 5px; padding: 7px 10px; border-right: 1px solid var(--line); }
.metric svg { grid-row: 1 / 3; color: #547184; }.metric span { color: var(--color-text-tertiary, #5f6f7d); font-size: 9px; font-weight: 700; }.metric strong { color: var(--ink); font: 700 16px var(--font-mono); }.metric small { color: var(--color-text-tertiary, #5f6f7d); font-size: 9px; }.metric.live strong, .metric.live svg { color: var(--green); }

.topology-canvas { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: minmax(360px, 34%) minmax(520px, 1fr); gap: 10px; padding: 1px; }
.controller-node, .bus-lane { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); box-shadow: 0 4px 14px rgba(35,56,71,.07); }
.controller-node { min-height: min-content; align-self: start; overflow: hidden; }
.node-header { min-height: 66px; padding: 10px; gap: 9px; border-bottom: 1px solid var(--line); background: linear-gradient(110deg, rgba(23,105,170,.08), transparent 55%); }
.node-icon { width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid #9fc1dc; border-radius: 6px; color: var(--cyan); background: #e7f1fa; }
.node-copy { min-width: 0; }.node-copy h2 { margin: 0 0 3px; color: var(--ink); font-size: 14px; }.node-copy code { color: var(--color-text-tertiary, #5f6f7d); font-size: 9px; }
.health-badge { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 4px; color: var(--color-text-tertiary, #5f6f7d); background: var(--panel-2); font: 700 9px var(--font-mono); }.health-badge.healthy { border-color: #8bc5a8; color: var(--green); background: #e7f5ed; }
.board-groups { padding: 8px; display: grid; gap: 7px; }
.signal-group { overflow: hidden; border: 1px solid var(--color-border-subtle, #d5dde4); border-radius: 5px; background: #ffffff; }
.signal-group > header { height: 24px; padding: 0 7px; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--color-border-subtle, #d5dde4); background: var(--color-surface-3, #eef3f7); }
.signal-group > header strong { font: 800 10px var(--font-mono); color: var(--color-info, #0f5f9e); }.signal-group.do > header strong, .signal-group.ao > header strong { color: #8a5a12; }.signal-group > header span { margin-left: auto; color: var(--color-text-tertiary, #5f6f7d); font: 9px var(--font-mono); }
.signal-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--color-border-subtle, #d5dde4); }.signal-grid.analog { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.signal-cell { min-width: 0; min-height: 42px; padding: 5px 6px; display: grid; grid-template-columns: 10px minmax(0,1fr) auto; align-items: center; gap: 4px; background: #ffffff; }
.signal-copy { min-width: 0; display: grid; }.signal-copy strong { color: var(--ink); font: 700 10px var(--font-mono); }.signal-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-tertiary, #5f6f7d); font-size: 8px; }.signal-cell b { color: var(--muted); font: 700 10px var(--font-mono); white-space: nowrap; }.signal-cell.on b { color: var(--green); }
.signal-lamp, .mini-lamp { width: 7px; height: 7px; border-radius: 50%; background: #d7e0e6; border: 1px solid #8fa2b0; box-shadow: inset 0 0 2px rgba(23,33,43,.2); }.signal-cell.on .signal-lamp, .module-signal.on .mini-lamp { border-color: #128148; background: #22b866; box-shadow: 0 0 7px rgba(34,184,102,.58); }.signal-cell.stale { opacity: .58; }

.bus-stack { min-width: 0; display: flex; flex-direction: column; gap: 9px; }
.bus-lane { min-width: 0; overflow: hidden; }
.bus-header { min-height: 36px; padding: 6px 9px; border-bottom: 1px solid var(--line); background: var(--color-surface-3, #eef3f7); }
.bus-port { gap: 6px; color: var(--cyan); }.bus-port strong { font: 800 11px var(--font-mono); }.bus-port span { padding: 2px 4px; border: 1px solid #9fc1dc; border-radius: 3px; color: var(--color-info, #0f5f9e); background: #e7f1fa; font: 8px var(--font-mono); }
.bus-spec { margin-left: 14px; color: var(--color-text-tertiary, #5f6f7d); font: 9px var(--font-mono); }.bus-count { margin-left: auto; color: var(--muted); font: 10px var(--font-mono); }
.bus-track { position: relative; min-height: 168px; padding: 34px 10px 10px 57px; overflow-x: auto; background-color: #fafcfd; background-image: linear-gradient(rgba(143,162,176,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(143,162,176,.12) 1px, transparent 1px); background-size: 20px 20px; }
.bus-origin { position: absolute; left: 12px; top: 25px; z-index: 2; display: grid; justify-items: center; gap: 1px; color: var(--cyan); }.bus-origin small { color: var(--color-text-tertiary, #5f6f7d); font: 8px var(--font-mono); }.port-socket { width: 29px; height: 29px; display: grid; place-items: center; border: 1px solid #79aacf; border-radius: 50%; background: #e7f1fa; }
.bus-wire { position: absolute; left: 39px; right: 10px; top: 39px; height: 3px; border-top: 1px solid #4b91c5; border-bottom: 1px solid #0f5f9e; background: #1769aa; box-shadow: 0 0 6px rgba(23,105,170,.22); }
.module-row { position: relative; z-index: 1; display: flex; align-items: flex-start; gap: 8px; min-width: max-content; }
.module-card { position: relative; width: 292px; margin-top: 20px; border: 1px solid var(--line); border-radius: 5px; overflow: hidden; background: #ffffff; box-shadow: 0 6px 16px rgba(35,56,71,.12); }
.drop-line { position: absolute; top: -22px; left: 22px; width: 2px; height: 22px; background: #1769aa; }.drop-line span { position: absolute; top: -3px; left: -3px; width: 8px; height: 8px; border: 2px solid #1769aa; border-radius: 50%; background: #ffffff; }
.module-header { height: 42px; padding: 5px 7px; gap: 7px; border-bottom: 1px solid var(--color-border-subtle, #d5dde4); background: linear-gradient(100deg, #e7f1fa, #f7f9fb); }
.address-badge { width: 42px; height: 30px; display: grid; place-items: center; border: 1px solid #79aacf; border-radius: 4px; color: var(--color-text-tertiary, #5f6f7d); background: #ffffff; font: 7px var(--font-mono); line-height: .9; }.address-badge b { color: var(--cyan); font-size: 14px; }
.module-title { min-width: 0; display: grid; flex: 1; }.module-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-size: 11px; }.module-title code { color: var(--color-text-tertiary, #5f6f7d); font-size: 8px; }
.module-state { display: flex; align-items: center; gap: 4px; color: var(--color-text-tertiary, #5f6f7d); font: 8px var(--font-mono); }.module-state.online { color: var(--green); }
.profile-description { min-height: 28px; margin: 0; padding: 5px 7px; border-bottom: 1px solid var(--color-border-subtle, #d5dde4); color: var(--color-text-secondary, #40515f); background: var(--panel-2); font-size: 8px; line-height: 1.35; }
.module-signals { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 1px; background: var(--color-border-subtle, #d5dde4); }
.module-signal { position: relative; min-width: 0; height: 30px; padding: 3px 5px; display: grid; grid-template-columns: 8px 29px minmax(0,1fr) auto 11px; align-items: center; gap: 3px; border: 0; color: var(--color-text-disabled, #667784); background: #f1f4f6; text-align: left; cursor: default; }
.module-signal.enabled { color: var(--ink); background: #ffffff; }.module-signal.enabled:not(:disabled) { cursor: pointer; }.module-signal.enabled:not(:disabled):hover { background: #eef6fb; }.module-signal.monitored { box-shadow: inset 2px 0 var(--cyan); background: #f4f9fc; }.module-signal.stale { opacity: .55; }
.signal-id { font: 700 9px var(--font-mono); }.signal-point { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-tertiary, #5f6f7d); font-size: 7px; }.module-signal strong { color: var(--muted); font: 700 9px var(--font-mono); white-space: nowrap; }.module-signal.on strong { color: var(--green); }.watch-icon { color: #78909c; }.module-signal.monitored .watch-icon { color: var(--cyan); }
.module-footer { height: 23px; padding: 0 7px; gap: 8px; color: var(--color-text-tertiary, #5f6f7d); background: var(--panel-2); font-size: 7px; }.module-footer span:last-child { margin-left: auto; }.module-footer .warning { color: var(--amber); }
.empty-bus, .empty-topology { min-height: 100px; display: grid; place-items: center; align-content: center; gap: 5px; color: var(--color-text-tertiary, #5f6f7d); font-size: 10px; }.empty-topology { min-height: 180px; border: 1px dashed var(--line); border-radius: 8px; background: var(--panel); }.empty-topology strong { color: var(--muted); font-size: 12px; }.empty-topology span { max-width: 320px; text-align: center; }

.monitor-legend { min-height: 30px; padding: 5px 9px; gap: 13px; border-radius: 6px; color: var(--color-text-tertiary, #5f6f7d); font-size: 9px; }
.monitor-legend > span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }.legend-dot { width: 7px; height: 7px; border-radius: 50%; }.legend-dot.on { background: #22b866; box-shadow: 0 0 6px rgba(34,184,102,.55); }.legend-dot.off { border: 1px solid #8fa2b0; background: #d7e0e6; }.legend-dot.none { border: 1px dashed #8fa2b0; background: transparent; }.legend-note { flex: 1; white-space: normal !important; }.quality-note { color: var(--amber); }
.spinning { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 50% { opacity: .3; } }

@media (max-width: 1180px) {
  .overview-primary { min-width: 160px; }.metric { min-width: 105px; }.metric:nth-of-type(3) { display: none; }
  .topology-canvas { grid-template-columns: minmax(330px, 38%) minmax(480px, 1fr); }
  .connection-pill { min-width: 125px; }.address-field input { width: 170px; }
}

@media (max-width: 900px) {
  .monitor-header { align-items: flex-start; flex-direction: column; }.connection-controls { width: 100%; margin: 0; }.address-field { flex: 1; }.address-field input { width: 100%; }
  .overview-strip { overflow-x: auto; }.topology-canvas { display: flex; flex-direction: column; }.controller-node { width: 100%; }.bus-stack { width: 100%; }.signal-grid { grid-template-columns: repeat(6, minmax(0,1fr)); }
}
</style>
