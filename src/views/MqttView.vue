<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Activity,
  Check,
  ChevronDown,
  Copy,
  PlugZap,
  RadioTower,
  Send,
  Trash2,
  WifiOff,
  Zap,
} from 'lucide-vue-next'
import ConfirmModal from '../components/common/ConfirmModal.vue'
import { useMqttStore } from '../stores/mqttStore'
import type { MqttLogLine } from '../types/mqtt'
import {
  payloadByteLength,
  validateKz3DownlinkEnvelope,
  validateMqttQos,
  validateMqttTopic,
  validatePayload,
} from '../utils/mqttValidation'

const mqtt = useMqttStore()
const terminal = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const copied = ref(false)
const showPublishConfirm = ref(false)
const expandedHexLogId = ref<string | null>(null)
const activeFilter = ref<'all' | 'rx' | 'tx' | 'system' | 'error'>('all')

const publishTopic = ref('')
const publishPayload = ref('')
const publishQos = ref(1)
const nowMs = ref(Date.now())
let freshnessTimer: number | null = null

const filteredLogs = computed(() => {
  if (activeFilter.value === 'all') return mqtt.logs
  if (activeFilter.value === 'error') return mqtt.logs.filter((line) => line.level === 'error')
  return mqtt.logs.filter((line) => line.direction === activeFilter.value)
})

const connectionLabel = computed(() => {
  if (mqtt.connectionState === 'connected') return '已连接'
  if (mqtt.connectionState === 'connecting') return '连接/重连中'
  return '未连接'
})

const payloadSize = computed(() => payloadByteLength(publishPayload.value))
const freshBootId = computed(() => {
  void nowMs.value
  return mqtt.getFreshKz3BootId()
})
const latestBootLabel = computed(() => {
  if (!mqtt.latestBootId || !mqtt.latestBootIdAt) return '尚未收到 KZ3 遥测'
  if (!freshBootId.value) return `boot_id=${mqtt.latestBootId}（已超过 30 秒）`
  return `boot_id=${mqtt.latestBootId}（${new Date(mqtt.latestBootIdAt).toLocaleTimeString()}）`
})

watch(
  () => filteredLogs.value.length,
  () => {
    if (!autoScroll.value) return
    nextTick(() => {
      if (terminal.value) terminal.value.scrollTop = terminal.value.scrollHeight
    })
  }
)

onMounted(() => {
  freshnessTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (freshnessTimer) clearInterval(freshnessTimer)
})

function toggleConnection() {
  if (mqtt.connectionState === 'disconnected') {
    void mqtt.connect()
  } else {
    void mqtt.disconnect()
  }
}

function requestPublish() {
  const error =
    validateMqttTopic(publishTopic.value, false) ||
    validateMqttQos(publishQos.value) ||
    validatePayload(publishPayload.value) ||
    validateKz3DownlinkEnvelope(publishPayload.value, mqtt.getFreshKz3BootId())
  if (error) {
    mqtt.errorMsg = error
    return
  }
  showPublishConfirm.value = true
}

async function confirmPublish() {
  showPublishConfirm.value = false
  await mqtt.publish(publishTopic.value, publishPayload.value, publishQos.value, mqtt.getFreshKz3BootId())
}

function loadKz3Template(command?: 'start' | 'stop') {
  const bootId = mqtt.getFreshKz3BootId()
  const data =
    command === 'start'
      ? { 'command.board_do01_start': true }
      : command === 'stop'
        ? { 'command.board_do01_stop': true }
        : {}
  const envelope = {
    _meta: {
      // 纯格式模板允许提前查看，但 0 会被发送校验拒绝；快捷命令只使用最新遥测值。
      boot_id: bootId || 0,
      request_id: createNonZeroRequestId(),
      ttl_ms: 5000,
    },
    func_code: 2,
    data,
  }
  publishPayload.value = JSON.stringify(envelope, null, 2)
  publishQos.value = 1
  if (!publishTopic.value.trim()) {
    const downTopic = deriveDownTopic(mqtt.config.subscribeTopic)
    if (downTopic) publishTopic.value = downTopic
  }
  mqtt.errorMsg = bootId
    ? ''
    : '已填充 KZ3 JSON 模板；请订阅设备 /up Topic 并收到最新 boot_id 后，再次点击快捷键刷新运行时字段'
}

function createNonZeroRequestId(): number {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0] || 1
}

function deriveDownTopic(upTopic: string): string | undefined {
  const levels = upTopic.trim().split('/')
  const serialNumber = levels[levels.length - 2]
  if (levels[levels.length - 1] !== 'up' || !serialNumber || !/^\d{12}$/.test(serialNumber)) return undefined
  return [...levels.slice(0, -1), 'down'].join('/')
}

async function copyCurrentLogs() {
  if (!filteredLogs.value.length) return
  try {
    const text = filteredLogs.value
      .map((line) => `[${line.timestamp}] [${line.direction.toUpperCase()}] ${line.text}`)
      .join('\n')
    await navigator.clipboard.writeText(text)
    copied.value = true
    window.setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (error) {
    mqtt.errorMsg = `复制到剪贴板失败: ${String(error)}`
  }
}

function logClass(line: MqttLogLine): string[] {
  return [line.direction, line.level]
}
</script>

<template>
  <div class="mqtt-view">
    <section class="connection-panel">
      <div class="panel-heading">
        <div>
          <h1>通用 MQTT 调试</h1>
          <p>MQTT 3.1.1 / TCP；连接 Broker 后订阅实时消息，或发布文本与 JSON。</p>
        </div>
        <div class="connection-status" :class="mqtt.connectionState">
          <span class="status-dot" />
          <span>{{ connectionLabel }}</span>
        </div>
      </div>

      <div class="connection-grid">
        <label class="field host-field">
          <span>Broker 主机</span>
          <input v-model.trim="mqtt.config.host" placeholder="例如：broker.example.com 或 192.168.1.10" :disabled="mqtt.connectionState !== 'disconnected'" />
        </label>
        <label class="field compact-field">
          <span>端口</span>
          <input v-model.number="mqtt.config.port" type="number" min="1" max="65535" :disabled="mqtt.connectionState !== 'disconnected'" />
        </label>
        <label class="field client-id-field">
          <span>Client ID</span>
          <input v-model.trim="mqtt.config.clientId" class="mono" :disabled="mqtt.connectionState !== 'disconnected'" />
        </label>
        <label class="field compact-field">
          <span>Keep Alive (s)</span>
          <input v-model.number="mqtt.config.keepAliveSec" type="number" min="1" max="65535" :disabled="mqtt.connectionState !== 'disconnected'" />
        </label>
        <label class="field">
          <span>用户名 <em>可选</em></span>
          <input v-model="mqtt.config.username" autocomplete="username" :disabled="mqtt.connectionState !== 'disconnected'" />
        </label>
        <label class="field">
          <span>密码 <em>仅本次会话内存保存</em></span>
          <input v-model="mqtt.config.password" type="password" autocomplete="current-password" :disabled="mqtt.connectionState !== 'disconnected'" />
        </label>
      </div>

      <div class="subscription-row">
        <label class="field topic-field">
          <span>订阅 Topic</span>
          <input v-model.trim="mqtt.config.subscribeTopic" class="mono" placeholder="例如：devices/+/up" />
        </label>
        <label class="field qos-field">
          <span>QoS</span>
          <select v-model.number="mqtt.config.subscribeQos">
            <option :value="0">0</option>
            <option :value="1">1</option>
            <option :value="2">2</option>
          </select>
        </label>
        <button
          v-if="mqtt.connected"
          class="button secondary"
          :disabled="mqtt.busy || !mqtt.config.subscribeTopic"
          @click="mqtt.applySubscription"
        >
          <RadioTower :size="15" /> 应用订阅
        </button>
        <button class="button primary connection-button" :disabled="mqtt.busy" @click="toggleConnection">
          <WifiOff v-if="mqtt.connectionState !== 'disconnected'" :size="15" />
          <PlugZap v-else :size="15" />
          {{ mqtt.connectionState === 'disconnected' ? '连接 Broker' : '断开连接' }}
        </button>
      </div>
      <p class="connection-note">
        订阅 Topic 会在连接时自动提交；修改后点击“应用订阅”。Client ID 禁止使用 12 位设备 SN；密码不写入本地存储、不会回显到日志。
      </p>
      <p v-if="mqtt.errorMsg" class="error-message">{{ mqtt.errorMsg }}</p>
    </section>

    <section class="terminal-panel">
      <header class="terminal-toolbar">
        <div class="terminal-stats">
          <Activity :size="15" />
          <span>RX {{ mqtt.rxMessages }} 条 / {{ mqtt.rxBytes }} B</span>
          <span class="stat-divider" />
          <span>TX {{ mqtt.txMessages }} 条 / {{ mqtt.txBytes }} B</span>
        </div>
        <div class="toolbar-actions">
          <div class="filter-group">
            <button :class="{ active: activeFilter === 'all' }" @click="activeFilter = 'all'">全部</button>
            <button :class="{ active: activeFilter === 'rx' }" @click="activeFilter = 'rx'">接收</button>
            <button :class="{ active: activeFilter === 'tx' }" @click="activeFilter = 'tx'">发送</button>
            <button :class="{ active: activeFilter === 'system' }" @click="activeFilter = 'system'">系统</button>
            <button :class="{ active: activeFilter === 'error' }" @click="activeFilter = 'error'">错误</button>
          </div>
          <label class="auto-scroll"><input v-model="autoScroll" type="checkbox" /> 自动滚屏</label>
          <button class="tool-button" :disabled="!filteredLogs.length" @click="copyCurrentLogs">
            <Check v-if="copied" :size="14" />
            <Copy v-else :size="14" />
            {{ copied ? '已复制' : '复制' }}
          </button>
          <button class="tool-button" @click="mqtt.clearLogs"><Trash2 :size="14" /> 清空</button>
        </div>
      </header>

      <div ref="terminal" class="terminal-log">
        <div v-if="filteredLogs.length === 0" class="terminal-empty">连接并订阅 Topic 后，实时 MQTT 消息会显示在这里。</div>
        <article v-for="line in filteredLogs" :key="line.id" class="log-line" :class="logClass(line)">
          <time>[{{ line.timestamp }}]</time>
          <span class="direction">[{{ line.direction.toUpperCase() }}]</span>
          <pre>{{ line.text }}</pre>
          <button
            v-if="line.payloadHex"
            class="hex-toggle"
            :title="expandedHexLogId === line.id ? '隐藏 HEX' : '查看 HEX'"
            @click="expandedHexLogId = expandedHexLogId === line.id ? null : line.id"
          >
            <ChevronDown :size="13" :class="{ flipped: expandedHexLogId === line.id }" /> HEX
          </button>
          <pre v-if="expandedHexLogId === line.id && line.payloadHex" class="hex-payload">{{ line.payloadHex }}</pre>
        </article>
      </div>
    </section>

    <section class="publish-panel" :class="{ disabled: !mqtt.connected }">
      <div class="kz3-shortcuts">
        <span class="shortcut-label"><Zap :size="14" /> KZ3 下行快捷</span>
        <button class="shortcut-button" :disabled="mqtt.publishing" @click="loadKz3Template()">填充 JSON 格式</button>
        <button class="shortcut-button start" :disabled="mqtt.publishing" @click="loadKz3Template('start')">DO1 启动</button>
        <button class="shortcut-button stop" :disabled="mqtt.publishing" @click="loadKz3Template('stop')">DO1 停止</button>
        <span class="boot-hint" :class="{ ready: freshBootId }">{{ latestBootLabel }}</span>
      </div>
      <div class="publish-options">
        <label class="field publish-topic-field">
          <span>发布 Topic</span>
          <input v-model.trim="publishTopic" class="mono" placeholder="例如：devices/020325090118/down" :disabled="!mqtt.connected || mqtt.publishing" />
        </label>
        <label class="field qos-field">
          <span>QoS</span>
          <select v-model.number="publishQos" :disabled="!mqtt.connected || mqtt.publishing">
            <option :value="0">0</option>
            <option :value="1">1</option>
            <option :value="2">2</option>
          </select>
        </label>
        <span class="retain-note">Retain：固定关闭</span>
      </div>
      <div class="publish-body">
        <textarea
          v-model="publishPayload"
          class="mono"
          placeholder="输入要发布的文本或 JSON…"
          :disabled="!mqtt.connected || mqtt.publishing"
        />
        <button
          class="button primary publish-button"
          :disabled="!mqtt.connected || mqtt.publishing || !publishTopic || !publishPayload"
          @click="requestPublish"
        >
          <Send :size="17" />
          {{ mqtt.publishing ? '等待 PUBACK…' : '确认并发布' }}
        </button>
      </div>
      <div class="publish-footer">
        <span>{{ payloadSize }} / 1024 B</span>
        <span>QoS 1/2 收到 PUBACK 仅表示 Broker 已接收，不能代表设备已执行。</span>
      </div>
    </section>

    <ConfirmModal
      :visible="showPublishConfirm"
      title="确认发布 MQTT 消息"
      :message="`将以 QoS ${publishQos} 发布到 ${publishTopic}；Retain 固定关闭。请确认订阅端及现场设备允许接收该消息。`"
      danger-level="high"
      confirm-text="发布消息"
      @cancel="showPublishConfirm = false"
      @confirm="confirmPublish"
    />
  </div>
</template>

<style scoped>
.mqtt-view {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(260px, 1fr) auto;
  gap: 10px;
  padding: var(--page-gutter, 12px);
  background: var(--bg-app);
}

.connection-panel,
.terminal-panel,
.publish-panel {
  border: 1px solid var(--border);
  background: var(--bg-panel);
  border-radius: var(--radius-lg, 8px);
  box-shadow: 0 1px 2px rgba(27, 45, 58, 0.05);
}

.connection-panel { padding: 12px; }
.panel-heading,
.terminal-toolbar,
.subscription-row,
.publish-options,
.publish-body,
.publish-footer,
.terminal-stats,
.toolbar-actions,
.filter-group,
.connection-status {
  display: flex;
  align-items: center;
}
.panel-heading { justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.panel-heading h1 { margin: 0; color: var(--text-main); font-size: 1.05rem; }
.panel-heading p,
.connection-note,
.publish-footer { margin: 4px 0 0; color: var(--text-muted); font-size: 0.75rem; line-height: 1.45; }
.connection-status { gap: 6px; color: var(--text-muted); font-size: 0.78rem; white-space: nowrap; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #8696a3; }
.connection-status.connected { color: var(--success); }
.connection-status.connected .status-dot { background: var(--success); }
.connection-status.connecting { color: var(--color-warning); }
.connection-status.connecting .status-dot { background: var(--color-warning); animation: pulse 1.1s infinite; }
@keyframes pulse { 50% { opacity: .35; } }

.connection-grid { display: grid; grid-template-columns: minmax(200px, 1.25fr) 100px minmax(180px, 1.1fr) 120px minmax(160px, .8fr) minmax(160px, .8fr); gap: 8px; }
.field { min-width: 0; display: grid; gap: 4px; color: var(--text-muted); font-size: .72rem; }
.field span { display: flex; justify-content: space-between; gap: 4px; }
.field em { color: var(--color-text-tertiary); font-style: normal; }
.field input,
.field select,
.publish-body textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 5px);
  background: var(--bg-input);
  color: var(--text-main);
  min-height: var(--control-height, 32px);
  padding: 6px 8px;
  font-size: .8rem;
}
.field input:focus,
.field select:focus,
.publish-body textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(23, 105, 170, .12); }
.mono { font-family: var(--font-mono, monospace); font-variant-numeric: tabular-nums; }
.subscription-row { gap: 8px; margin-top: 10px; }
.topic-field { flex: 1; }
.qos-field { width: 72px; flex: 0 0 72px; }
.connection-button { margin-left: auto; }
.connection-note { margin-top: 8px; }
.error-message { margin: 8px 0 0; color: var(--danger); font-size: .78rem; }

.button,
.tool-button,
.filter-group button,
.hex-toggle { border: 1px solid var(--border); border-radius: var(--radius-sm, 5px); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 5px; font-size: .78rem; }
.button { min-height: var(--control-height, 32px); padding: 0 12px; white-space: nowrap; }
.button.primary { color: #fff; background: var(--accent); border-color: var(--accent); }
.button.primary:hover:not(:disabled) { background: var(--accent-hover); }
.button.secondary,
.tool-button { color: var(--text-muted); background: var(--bg-input); padding: 0 10px; min-height: 28px; }
.button.secondary:hover:not(:disabled),
.tool-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
button:disabled { opacity: .48; cursor: not-allowed; }

.terminal-panel { min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.terminal-toolbar { min-height: 42px; padding: 6px 10px; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--border); background: var(--color-surface-2); }
.terminal-stats { gap: 7px; color: var(--text-muted); font-size: .76rem; white-space: nowrap; }
.terminal-stats svg { color: var(--accent); }
.stat-divider { width: 1px; height: 14px; background: var(--border); }
.toolbar-actions { gap: 8px; min-width: 0; }
.filter-group { gap: 3px; }
.filter-group button { min-height: 25px; padding: 0 7px; color: var(--text-muted); background: transparent; font-size: .7rem; }
.filter-group button.active { border-color: var(--accent); color: var(--accent); background: #e4f1fa; font-weight: 600; }
.auto-scroll { color: var(--text-muted); font-size: .73rem; white-space: nowrap; }
.terminal-log { flex: 1; min-height: 0; overflow: auto; padding: 8px 10px; font-family: var(--font-mono, monospace); background: #fbfcfd; user-select: text; -webkit-user-select: text; }
.terminal-empty { padding: 28px 0; text-align: center; color: var(--color-text-tertiary); font: .8rem var(--font-sans); }
.log-line { position: relative; display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; align-items: start; column-gap: 7px; padding: 2px 0; color: var(--text-main); font-size: .75rem; line-height: 1.45; border-bottom: 1px dashed rgba(185, 197, 207, .45); }
.log-line time { color: #687a89; white-space: nowrap; }
.log-line .direction { font-weight: 700; white-space: nowrap; }
.log-line.rx .direction { color: var(--success); }
.log-line.tx .direction { color: var(--accent); }
.log-line.system .direction { color: var(--color-warning); }
.log-line.error { color: var(--danger); }
.log-line pre { min-width: 0; margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; }
.hex-toggle { min-height: 22px; padding: 0 5px; color: var(--text-muted); background: var(--bg-input); font-size: .68rem; }
.hex-toggle svg { transition: transform .15s; }
.hex-toggle svg.flipped { transform: rotate(180deg); }
.hex-payload { grid-column: 3 / -1; padding: 4px 6px; color: #455665; background: #eef3f7; border-radius: 3px; }

.publish-panel { padding: 10px 12px; }
.publish-panel.disabled { opacity: .72; }
.kz3-shortcuts { display: flex; align-items: center; gap: 6px; margin-bottom: 9px; min-width: 0; }
.shortcut-label { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); font-size: .75rem; font-weight: 600; white-space: nowrap; }
.shortcut-label svg { color: var(--color-warning); }
.shortcut-button { min-height: 26px; padding: 0 8px; color: var(--text-muted); background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm, 5px); cursor: pointer; font-size: .72rem; white-space: nowrap; }
.shortcut-button:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.shortcut-button.start:hover:not(:disabled) { color: var(--success); border-color: var(--success); }
.shortcut-button.stop:hover:not(:disabled) { color: var(--danger); border-color: var(--danger); }
.boot-hint { overflow: hidden; text-overflow: ellipsis; margin-left: auto; color: var(--color-text-tertiary); font: .72rem var(--font-mono, monospace); white-space: nowrap; }
.boot-hint.ready { color: var(--success); }
.publish-options { gap: 8px; }
.publish-topic-field { flex: 1; }
.retain-note { color: var(--text-muted); font-size: .76rem; white-space: nowrap; }
.publish-body { margin-top: 8px; gap: 8px; }
.publish-body textarea { min-height: 140px; resize: vertical; line-height: 1.4; }
.publish-button { min-width: 118px; align-self: stretch; }
.publish-footer { display: flex; justify-content: space-between; gap: 16px; }

@media (max-width: 1200px) { .connection-grid { grid-template-columns: repeat(3, minmax(160px, 1fr)); } }
@media (max-width: 850px) {
  .mqtt-view { display: block; overflow: auto; }
  .connection-panel, .terminal-panel, .publish-panel { margin-bottom: 10px; }
  .connection-grid { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
  .terminal-toolbar, .subscription-row, .publish-options { align-items: flex-start; flex-wrap: wrap; }
  .kz3-shortcuts { flex-wrap: wrap; }
  .toolbar-actions { flex-wrap: wrap; justify-content: flex-end; }
  .terminal-log { height: 360px; }
}
</style>
