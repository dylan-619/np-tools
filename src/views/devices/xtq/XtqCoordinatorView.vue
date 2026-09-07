<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  EthernetPort,
  FileJson,
  Radio,
  RefreshCw,
  Send,
  TerminalSquare
} from 'lucide-vue-next'
import ConfirmModal from '../../../components/common/ConfirmModal.vue'
import { appOpenFile, appSaveFile } from '../../../api/sjzdApi'
import { useSerialStore } from '../../../stores/serialStore'
import { useXtqCoordinatorStore } from '../../../stores/xtqCoordinatorStore'
import {
  XTQ_CAPABILITY_SLOT_COUNT,
  XTQ_OWNERS,
  type XtqOwner
} from '../../../types/xtqCoordinator'
import {
  buildSyncPayload,
  capabilityOwnerForSlot,
  configErrorLabels,
  enumLabel,
  validateCapabilityValue,
  XTQ_MODE_LABELS,
  XTQ_NETWORK_STATE_LABELS,
  XTQ_RADIO_STATE_LABELS,
  XTQ_ROLE_LABELS
} from '../../../utils/xtqCoordinatorProtocol'

type Section = 'overview' | 'configuration' | 'capabilities' | 'sync' | 'session'

const serial = useSerialStore()
const coordinator = useXtqCoordinatorStore()
const activeSection = ref<Section>('overview')
const editors = reactive<Record<XtqOwner, string>>({
  DeviceIdentity: '',
  CoordinatorConfig: '',
  Radio1Config: '',
  Radio2Config: '',
  EthernetConfig: ''
})
const capabilitySlots = Array.from({ length: XTQ_CAPABILITY_SLOT_COUNT }, (_, slot) => slot)
const selectedCapabilitySlot = ref(0)
const capabilityEditor = ref('')
const capabilityDrafts = ref<Partial<Record<number, string>>>({})
const syncEditor = ref(
  JSON.stringify(
    { version: 1, enabled: false, cache_ttl_seconds: 600, rules: [] },
    null,
    2
  )
)
const message = ref<{ text: string; error: boolean } | null>(null)
const pendingWrite = ref<XtqOwner | null>(null)
const pendingCapabilityWrite = ref(false)
const pendingSyncUpload = ref(false)

const sections = [
  { id: 'overview' as const, label: '运行总览', caption: '@STATUS 实时诊断', icon: Activity },
  {
    id: 'configuration' as const,
    label: '配置快照',
    caption: 'Owner 读取与受控写入',
    icon: Database
  },
  {
    id: 'capabilities' as const,
    label: '终端适配',
    caption: '32 槽位 Capability 台账',
    icon: Cpu
  },
  {
    id: 'sync' as const,
    label: '同步规则',
    caption: '预检、CRC 与状态摘要核对',
    icon: FileJson
  },
  { id: 'session' as const, label: '会话记录', caption: '命令、回包与边界', icon: TerminalSquare }
]

const connected = computed(() => Boolean(serial.connectedPort))
const ready = computed(() => connected.value && coordinator.serialConfigMatches)
const statusLabel = computed(
  () =>
    ({
      disconnected: '未连接',
      connected: coordinator.identified ? '协调器已识别' : '串口已连接，尚未识别',
      querying: '正在查询',
      writing: '正在写入',
      waiting_reboot: '设备重启中，等待复核',
      error: '最近操作失败'
    })[coordinator.state]
)
const configErrors = computed(() =>
  coordinator.status ? configErrorLabels(coordinator.status.config_errors) : []
)
const selectedCapability = computed(
  () => coordinator.capabilitySnapshots[selectedCapabilitySlot.value]
)
const importedCapabilityCount = computed(() => Object.keys(capabilityDrafts.value).length)
const syncPreflight = computed(() => {
  try {
    return { prepared: buildSyncPayload(syncEditor.value), error: '' }
  } catch (error) {
    return { prepared: null, error: String(error) }
  }
})
const radioConfigOverview = computed(() =>
  [1, 2].map((index) => {
    const owner = `Radio${index}Config` as XtqOwner
    const value = coordinator.snapshots[owner]?.value
    return {
      index,
      owner,
      available: Boolean(value),
      netName: typeof value?.net_name === 'string' ? value.net_name : '未读取',
      txPower: typeof value?.tx_power === 'number' ? value.tx_power : '—',
      maxTxPower: typeof value?.max_tx_power === 'number' ? value.max_tx_power : '—',
      configuredAddress:
        typeof value?.local_radio_addr === 'number' ? value.local_radio_addr : '—',
      apId: typeof value?.ap_id === 'number' ? value.ap_id : '—'
    }
  })
)

watch(
  () => coordinator.snapshots,
  (snapshots) => {
    for (const owner of XTQ_OWNERS) {
      const snapshot = snapshots[owner]
      if (snapshot) editors[owner] = JSON.stringify(snapshot.value, null, 2)
    }
  },
  { deep: true }
)

watch(
  () => [selectedCapabilitySlot.value, coordinator.capabilitySnapshots[selectedCapabilitySlot.value]],
  () => {
    const slot = selectedCapabilitySlot.value
    capabilityEditor.value =
      capabilityDrafts.value[slot] ||
      (selectedCapability.value ? JSON.stringify(selectedCapability.value.value, null, 2) : '')
  },
  { immediate: true }
)

function showMessage(text: string, error = false) {
  message.value = { text, error }
  window.setTimeout(() => {
    if (message.value?.text === text) message.value = null
  }, 4500)
}

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未读取'
}

function formatDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${days}天 ${hours}小时 ${minutes}分`
}

function delta(path: 'routes' | 'points' | 'sync') {
  const current = coordinator.status
  const previous = coordinator.previousStatus
  if (!current || !previous) return '—'
  if (path === 'routes') return String(current.routing.dropped - previous.routing.dropped)
  if (path === 'points') return String(current.points.updates - previous.points.updates)
  return String(current.sync.target_failures - previous.sync.target_failures)
}

function formatStatusValue(value: string | number | null) {
  return value === null ? '未上报' : String(value)
}

async function identify() {
  try {
    const record = await coordinator.queryStatus()
    if (record.status === 'ok' && coordinator.identified) {
      showMessage(`已识别 ${coordinator.status?.target}，固件 ${coordinator.status?.firmware}`)
      coordinator.startPolling()
    } else showMessage(coordinator.lastError || '未识别为协调器', true)
  } catch (error) {
    showMessage(String(error), true)
  }
}

async function readAll() {
  try {
    const records = await coordinator.readAllOwners()
    const successful = records.filter((record) => record.status === 'ok').length
    showMessage(
      successful === XTQ_OWNERS.length
        ? '五类 owner 已读取；编辑区已基于设备当前完整对象更新'
        : `Owner 扫描结束：成功 ${successful}/${records.length}，请查看会话记录`,
      successful !== XTQ_OWNERS.length
    )
  } catch (error) {
    showMessage(String(error), true)
  }
}

function selectCapabilitySlot(slot: number) {
  selectedCapabilitySlot.value = slot
}

function capabilityDescription(slot: number) {
  const snapshot = coordinator.capabilitySnapshots[slot]
  if (capabilityDrafts.value[slot]) return '已导入草稿，待逐槽确认'
  if (!snapshot) return '尚未读取'
  return snapshot.value.enabled
    ? `${snapshot.value.sn} · APP ${snapshot.value.reported_app_addr}`
    : '已禁用'
}

async function readSelectedCapability() {
  try {
    const record = await coordinator.readCapability(selectedCapabilitySlot.value)
    showMessage(
      record.status === 'ok'
        ? `${capabilityOwnerForSlot(selectedCapabilitySlot.value)} 已读取`
        : coordinator.lastError,
      record.status !== 'ok'
    )
  } catch (error) {
    showMessage(String(error), true)
  }
}

async function readAllCapabilities() {
  try {
    const records = await coordinator.readAllCapabilities()
    const successful = records.filter((record) => record.status === 'ok').length
    showMessage(
      successful === XTQ_CAPABILITY_SLOT_COUNT
        ? '32 个 Capability 槽位已读取'
        : `Capability 扫描结束：成功 ${successful}/${records.length}，请查看会话记录`,
      successful !== XTQ_CAPABILITY_SLOT_COUNT
    )
  } catch (error) {
    showMessage(String(error), true)
  }
}

function requestCapabilityWrite() {
  if (!selectedCapability.value)
    return showMessage('写入前必须先读取当前槽位；导入文件只作为草稿，不直接写设备', true)
  if (!capabilityEditor.value.trim()) return showMessage('Capability JSON 不能为空', true)
  try {
    validateCapabilityValue(JSON.parse(capabilityEditor.value))
    pendingCapabilityWrite.value = true
  } catch (error) {
    showMessage(`Capability 预检失败：${String(error)}`, true)
  }
}

async function confirmCapabilityWrite() {
  pendingCapabilityWrite.value = false
  const slot = selectedCapabilitySlot.value
  try {
    const record = await coordinator.writeCapability(slot, capabilityEditor.value)
    if (record.status !== 'ok') return showMessage(coordinator.lastError || record.response, true)
    const drafts = { ...capabilityDrafts.value }
    delete drafts[slot]
    capabilityDrafts.value = drafts
    showMessage(`${capabilityOwnerForSlot(slot)} 已写入且读回一致`)
  } catch (error) {
    showMessage(String(error), true)
  }
}

async function exportCapabilities() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const content = JSON.stringify(
    {
      schema: 'np-tools.xtq-capabilities.v1',
      exportedAt: new Date().toISOString(),
      slots: capabilitySlots.flatMap((slot) => {
        const snapshot = coordinator.capabilitySnapshots[slot]
        return snapshot ? [{ slot, value: snapshot.value }] : []
      })
    },
    null,
    2
  )
  const path = await appSaveFile(
    `XTQ-Capability-草稿-${timestamp}.json`,
    content,
    'XTQ Capability 草稿',
    'json'
  )
  showMessage(path ? `Capability 草稿已导出：${path}` : '未选择导出位置', !path)
}

async function importCapabilities() {
  const file = await appOpenFile('XTQ Capability 草稿 (*.json)', ['json'])
  if (!file) return
  try {
    const parsed = JSON.parse(file.content) as { slots?: Array<{ slot?: unknown; value?: unknown }> }
    if (!Array.isArray(parsed.slots)) throw new Error('文件缺少 slots 数组')
    const drafts: Partial<Record<number, string>> = {}
    for (const item of parsed.slots) {
      if (
        !Number.isInteger(item.slot) ||
        Number(item.slot) < 0 ||
        Number(item.slot) >= XTQ_CAPABILITY_SLOT_COUNT
      ) {
        throw new Error(`存在无效槽位：${String(item.slot)}`)
      }
      const value = validateCapabilityValue(item.value)
      drafts[Number(item.slot)] = JSON.stringify(value, null, 2)
    }
    capabilityDrafts.value = drafts
    const firstSlot = Object.keys(drafts).map(Number).sort((left, right) => left - right)[0]
    if (firstSlot !== undefined) {
      selectedCapabilitySlot.value = firstSlot
      capabilityEditor.value = drafts[firstSlot] || ''
    }
    showMessage(`已导入 ${Object.keys(drafts).length} 个 Capability 草稿；仍需逐槽读取、确认和写入`)
  } catch (error) {
    showMessage(`Capability 草稿导入失败：${String(error)}`, true)
  }
}

async function importSyncDraft() {
  const file = await appOpenFile('XTQ 同步规则 (*.json)', ['json'])
  if (!file) return
  try {
    const prepared = buildSyncPayload(file.content)
    syncEditor.value = prepared.canonicalJson
    showMessage(`已导入并规范化同步规则：${prepared.ruleCount} 条规则、${prepared.mappingCount} 条映射`)
  } catch (error) {
    showMessage(`同步规则导入失败：${String(error)}`, true)
  }
}

async function exportSyncDraft() {
  if (!syncPreflight.value.prepared)
    return showMessage(`同步规则未通过预检：${syncPreflight.value.error}`, true)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const path = await appSaveFile(
    `XTQ-同步规则-${timestamp}.json`,
    syncPreflight.value.prepared.canonicalJson,
    'XTQ 同步规则',
    'json'
  )
  showMessage(path ? `同步规则已导出：${path}` : '未选择导出位置', !path)
}

function requestSyncUpload() {
  if (!coordinator.identified) return showMessage('上传前必须先识别协调器并读取 @STATUS', true)
  if (!syncPreflight.value.prepared)
    return showMessage(`同步规则预检失败：${syncPreflight.value.error}`, true)
  pendingSyncUpload.value = true
}

async function confirmSyncUpload() {
  pendingSyncUpload.value = false
  try {
    const record = await coordinator.uploadSyncConfiguration(syncEditor.value)
    showMessage(
      record.status === 'ok'
        ? coordinator.lastSyncUpload?.verificationMessage || '同步规则已上传，等待状态摘要核对'
        : coordinator.lastError || record.response,
      record.status !== 'ok'
    )
  } catch (error) {
    showMessage(String(error), true)
  }
}

async function readOwner(owner: XtqOwner) {
  try {
    const record = await coordinator.readOwner(owner)
    showMessage(
      record.status === 'ok' ? `${owner} 已读取` : coordinator.lastError,
      record.status !== 'ok'
    )
  } catch (error) {
    showMessage(String(error), true)
  }
}

function requestWrite(owner: XtqOwner) {
  if (!coordinator.snapshots[owner]) return showMessage('写入前必须先读取设备当前值', true)
  if (owner === 'DeviceIdentity')
    return showMessage('普通固件身份只读；factory 生产写入尚未集成', true)
  if (!editors[owner].trim()) return showMessage('候选 JSON 不能为空', true)
  try {
    if (owner === 'Radio1Config' || owner === 'Radio2Config') {
      const other = owner === 'Radio1Config' ? 'Radio2Config' : 'Radio1Config'
      const candidate = JSON.parse(editors[owner])
      const otherValue = coordinator.snapshots[other]?.value
      if (candidate.net_name && candidate.net_name === otherValue?.net_name) {
        return showMessage('同一协调器的南北网络名必须不同', true)
      }
    }
    JSON.parse(editors[owner])
    pendingWrite.value = owner
  } catch (error) {
    showMessage(`候选 JSON 解析失败：${String(error)}`, true)
  }
}

async function confirmWrite() {
  const owner = pendingWrite.value
  pendingWrite.value = null
  if (!owner) return
  try {
    const record = await coordinator.writeOwner(owner, editors[owner])
    if (record.status !== 'ok') return showMessage(coordinator.lastError || record.response, true)
    if (record.response === 'OK_REBOOTING')
      showMessage('设备已接受完整 owner 并开始重启；请等待后点击“重启后复核”')
    else showMessage(`${owner} 已写入并执行读回`)
  } catch (error) {
    showMessage(String(error), true)
  }
}

async function confirmReboot() {
  try {
    const record = await coordinator.confirmAfterReboot()
    showMessage(
      record.status === 'ok' ? '设备已重新识别并读取全部 owner' : coordinator.lastError,
      record.status !== 'ok'
    )
  } catch (error) {
    showMessage(String(error), true)
  }
}

async function exportDiagnostic() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const path = await appSaveFile(
    `XTQ-协调器诊断-${timestamp}.json`,
    coordinator.exportDiagnostic(),
    'XTQ 协调器诊断包',
    'json'
  )
  showMessage(path ? `诊断记录已导出：${path}` : '未选择导出位置', !path)
}

onMounted(() => coordinator.initialize())
onBeforeUnmount(() => coordinator.stopPolling())
</script>

<template>
  <div class="xtq-page">
    <header class="page-header">
      <div class="title-block">
        <div class="title-mark"><Radio :size="22" /></div>
        <div>
          <div class="eyebrow">STM32F407 / F427 · DUAL NEARLINK COORDINATOR</div>
          <h1>双星闪协调器调试工作台</h1>
          <p>USART1 状态、双 Radio、路由、同步摘要与 EEPROM owner 配置</p>
        </div>
      </div>
      <div class="header-actions">
        <div
          class="connection-chip"
          :class="{ online: ready && coordinator.identified, warning: connected && !ready }"
        >
          <span class="status-dot" />
          <div>
            <strong>{{ statusLabel }}</strong><small>{{ serial.connectedPort || '115200 8N1' }}</small>
          </div>
        </div>
        <button class="btn" :disabled="!ready || coordinator.isBusy" @click="identify">
          <RefreshCw :size="15" :class="{ spin: coordinator.isBusy }" /> 识别 / 刷新
        </button>
        <button
          v-if="coordinator.state === 'waiting_reboot'"
          class="btn primary"
          @click="confirmReboot"
        >
          重启后复核
        </button>
      </div>
    </header>

    <div v-if="message" class="notice" :class="{ error: message.error }">
      <AlertTriangle v-if="message.error" :size="15" /><CheckCircle2 v-else :size="15" />{{
        message.text
      }}
    </div>

    <div class="workspace">
      <aside class="section-nav">
        <button
          v-for="item in sections"
          :key="item.id"
          :class="{ active: activeSection === item.id }"
          @click="activeSection = item.id"
        >
          <component :is="item.icon" :size="17" /><span><strong>{{ item.label }}</strong><small>{{ item.caption }}</small></span>
        </button>
        <div class="scope-note">
          <strong>固件能力边界</strong>
          <p>
            已支持 Capability 槽位、<code>@SYNC BEGIN/COMMIT</code> 上传和新版
            <code>@SYNC GET</code> 完整规则读回；Radio 深度实时观测仍未实现。收到
            <code>OK_REBOOTING</code> 后，工具最多 30 秒仅重开本次已知串口路径，不扫描或连接其他端口。
          </p>
        </div>
      </aside>

      <main class="content">
        <template v-if="activeSection === 'overview'">
          <section class="identity-card panel">
            <div>
              <Cpu :size="20" /><span><small>目标芯片</small><strong>{{ coordinator.status?.target || '未识别' }}</strong></span>
            </div>
            <div>
              <FileJson :size="20" /><span><small>固件版本</small><strong>{{ coordinator.status?.firmware || '—' }}</strong></span>
            </div>
            <div>
              <Database :size="20" /><span><small>Router SN</small><strong>{{ coordinator.status?.router_sn || '未配置' }}</strong></span>
            </div>
            <div>
              <Activity :size="20" /><span><small>工作模式</small><strong>{{
                coordinator.status ? enumLabel(XTQ_MODE_LABELS, coordinator.status.mode) : '—'
              }}</strong></span>
            </div>
          </section>

          <section v-if="coordinator.status" class="status-grid">
            <article
              v-for="(radio, index) in coordinator.status.radios"
              :key="index"
              class="panel radio-card"
              :class="{
                healthy: radio.ready === 1,
                alarm: radio.state === 12 || radio.uart_errors > 0
              }"
            >
              <div class="panel-title">
                <Radio :size="18" />
                <div>
                  <h2>Radio {{ index + 1 }}</h2>
                  <small>{{
                    index === 0 ? 'USART6 / ZIG1 · PC8/PC9' : 'USART2 / ZIG2 · PD7/PB3'
                  }}</small>
                </div>
                <span class="badge">{{ enumLabel(XTQ_ROLE_LABELS, radio.role) }}</span>
              </div>
              <dl>
                <div>
                  <dt>状态机</dt>
                  <dd>{{ enumLabel(XTQ_RADIO_STATE_LABELS, radio.state) }}</dd>
                </div>
                <div>
                  <dt>READY / STA</dt>
                  <dd>{{ radio.ready }} / {{ radio.sta }}</dd>
                </div>
                <div>
                  <dt>观测地址</dt>
                  <dd>{{ radio.address }}</dd>
                </div>
                <div>
                  <dt>恢复次数</dt>
                  <dd>{{ radio.recoveries }}</dd>
                </div>
                <div>
                  <dt>有效帧</dt>
                  <dd>{{ radio.valid_frames }}</dd>
                </div>
                <div>
                  <dt>UART 错误</dt>
                  <dd>{{ radio.uart_errors }}</dd>
                </div>
                <div>
                  <dt>RX 重启</dt>
                  <dd>{{ radio.rx_restarts }}</dd>
                </div>
                <div>
                  <dt>无效帧 / 丢弃字节</dt>
                  <dd>{{ radio.invalid_frames }} / {{ radio.dropped_bytes }}</dd>
                </div>
              </dl>
            </article>

            <article class="panel metrics-card">
              <div class="panel-title">
                <Activity :size="18" />
                <h2>路由与点缓存</h2>
              </div>
              <div class="metric-row">
                <span>邻居 / 路由</span><strong>{{ coordinator.status.routing.neighbors }} /
                  {{ coordinator.status.routing.routes }}</strong>
              </div>
              <div class="metric-row">
                <span>冲突 / 丢弃</span><strong
                  :class="{
                    danger:
                      coordinator.status.routing.conflicts || coordinator.status.routing.dropped
                  }"
                >{{ coordinator.status.routing.conflicts }} /
                  {{ coordinator.status.routing.dropped }}</strong>
              </div>
              <div class="metric-row">
                <span>点缓存</span><strong>{{ coordinator.status.points.used }} / 256</strong>
              </div>
              <div class="metric-row">
                <span>更新 / 淘汰</span><strong>{{ coordinator.status.points.updates }} /
                  {{ coordinator.status.points.evictions }}</strong>
              </div>
              <small class="delta">最近采样：路由丢弃 +{{ delta('routes') }}，点更新 +{{ delta('points') }}</small>
            </article>

            <article class="panel metrics-card">
              <div class="panel-title">
                <EthernetPort :size="18" />
                <h2>Ethernet 与同步</h2>
              </div>
              <div class="metric-row">
                <span>网络状态</span><strong>{{
                  enumLabel(XTQ_NETWORK_STATE_LABELS, coordinator.status.network.state)
                }}</strong>
              </div>
              <div class="metric-row">
                <span>队列 / 收 / 发</span><strong>{{ coordinator.status.network.queued }} /
                  {{ coordinator.status.network.received }} /
                  {{ coordinator.status.network.sent }}</strong>
              </div>
              <div class="metric-row">
                <span>同步序号 / 规则</span><strong>{{ coordinator.status.sync.sequence }} /
                  {{ coordinator.status.sync.rules }}</strong>
              </div>
              <div class="metric-row">
                <span>运行 / 源缺失 / 目标失败</span><strong>{{ coordinator.status.sync.runs }} /
                  {{ coordinator.status.sync.source_missing }} /
                  {{ coordinator.status.sync.target_failures }}</strong>
              </div>
              <small class="delta">最近采样：同步目标失败 +{{ delta('sync') }}</small>
            </article>
          </section>

          <section v-if="coordinator.status" class="panel detail-strip">
            <span><small>运行时间</small><strong>{{ formatDuration(coordinator.status.uptime_ms) }}</strong></span>
            <span><small>Boot ID / Reset Cause</small><strong>{{ coordinator.status.boot_id }} / {{ coordinator.status.reset_cause }}</strong></span>
            <span><small>PHY Result / ID</small><strong>{{ coordinator.status.phy_result }} / 0x{{
              coordinator.status.phy_id.toString(16).toUpperCase()
            }}</strong></span>
            <span><small>Capability</small><strong>{{ coordinator.status.capabilities }} / 32</strong></span>
            <span class="grow"><small>配置错误掩码</small><strong :class="{ danger: configErrors.length }">0x{{ coordinator.status.config_errors.toString(16).toUpperCase() }} ·
              {{ configErrors.join(', ') || '无' }}</strong></span>
          </section>

          <section v-if="coordinator.status" class="panel status-history">
            <div class="panel-title">
              <Activity :size="18" />
              <div>
                <h2>状态时间线与结构化差异</h2>
                <small>
                  当前会话保留最近 {{ coordinator.statusHistory.length }}/300 个有效 <code>@STATUS</code>
                  采样；仅比较固件已定义的字段。
                </small>
              </div>
              <button class="btn" :disabled="!coordinator.statusHistory.length" @click="coordinator.clearStatusHistory">
                清空时间线
              </button>
            </div>
            <div class="history-summary">
              <span><small>最近采样</small><strong>{{ formatTime(coordinator.statusHistory[coordinator.statusHistory.length - 1]?.capturedAt || '') }}</strong></span>
              <span><small>最近差异</small><strong>{{ coordinator.latestStatusDifferences.length }} 项</strong></span>
              <span><small>导出范围</small><strong>原始采样 + 受控字段差异</strong></span>
            </div>
            <div v-if="coordinator.statusHistory.length < 2" class="history-empty">
              已记录首个基线采样；下一次成功读取 <code>@STATUS</code> 后显示差异。
            </div>
            <div v-else-if="!coordinator.latestStatusDifferences.length" class="history-empty">
              与上一有效采样相比，受控诊断字段没有变化。
            </div>
            <div v-else class="difference-list">
              <div v-for="difference in coordinator.latestStatusDifferences" :key="difference.path" class="difference-row">
                <strong>{{ difference.label }}</strong><code>{{ formatStatusValue(difference.before) }}</code><span>→</span><code>{{ formatStatusValue(difference.after) }}</code>
              </div>
            </div>
          </section>

          <section v-if="coordinator.status" class="panel radio-config-compare">
            <div class="panel-title">
              <Radio :size="18" />
              <div>
                <h2>双 Radio 配置对照</h2>
                <small>运行状态来自 <code>@STATUS</code>；网络名与功率仅来自已读取 EEPROM owner。</small>
              </div>
              <button
                class="btn"
                :disabled="!coordinator.identified || coordinator.isBusy"
                @click="readAll"
              >
                <RefreshCw :size="14" />读取配置
              </button>
            </div>
            <div class="radio-config-grid">
              <article v-for="radio in radioConfigOverview" :key="radio.owner" class="radio-config-card">
                <strong>Radio {{ radio.index }} · {{ radio.owner }}</strong>
                <span><small>网络名</small><code>{{ radio.netName }}</code></span>
                <span><small>目标 / 最大功率</small><code>{{ radio.txPower }} / {{ radio.maxTxPower }}</code></span>
                <span><small>配置地址 / AP ID</small><code>{{ radio.configuredAddress }} / {{ radio.apId }}</code></span>
                <em v-if="!radio.available">尚未读取 owner，不能将运行地址推断为配置地址。</em>
              </article>
            </div>
          </section>

          <div v-else class="empty-state">
            <Radio :size="42" />
            <h2>先识别协调器</h2>
            <p>连接 USART1 后点击“识别 / 刷新”。仅串口打开不代表设备身份已确认。</p>
          </div>
        </template>

        <template v-else-if="activeSection === 'configuration'">
          <div class="section-toolbar">
            <div>
              <h2>完整 Owner 配置</h2>
              <p>写入前先读取；发送完整 JSON，不执行伪局部更新。</p>
            </div>
            <button
              class="btn primary"
              :disabled="!coordinator.identified || coordinator.isBusy"
              @click="readAll"
            >
              <RefreshCw :size="15" />读取全部
            </button>
          </div>
          <section class="owner-grid">
            <article v-for="owner in XTQ_OWNERS" :key="owner" class="panel owner-card">
              <div class="panel-title">
                <FileJson :size="17" />
                <div>
                  <h2>{{ owner }}</h2>
                  <small>{{ formatTime(coordinator.snapshots[owner]?.receivedAt || '') }}</small>
                </div>
                <button
                  class="icon-btn"
                  :disabled="!ready || coordinator.isBusy"
                  title="重新读取"
                  @click="readOwner(owner)"
                >
                  <RefreshCw :size="14" />
                </button>
              </div>
              <textarea
                v-model="editors[owner]"
                spellcheck="false"
                :placeholder="`先读取 ${owner}`"
                :readonly="owner === 'DeviceIdentity'"
              />
              <div class="owner-actions">
                <span v-if="owner === 'DeviceIdentity'">普通固件只读</span><span v-else>校验完整 schema 后写入</span>
                <button
                  class="btn"
                  :disabled="
                    owner === 'DeviceIdentity' ||
                      !coordinator.snapshots[owner] ||
                      coordinator.isBusy
                  "
                  @click="requestWrite(owner)"
                >
                  <Send :size="14" />应用到设备
                </button>
              </div>
            </article>
          </section>
        </template>

        <template v-else-if="activeSection === 'capabilities'">
          <div class="section-toolbar">
            <div>
              <h2>终端协议与无线地址适配</h2>
              <p>32 个 EEPROM 固定槽位。导入只生成草稿，写入始终逐槽、读前与读后核对。</p>
            </div>
            <div class="toolbar-actions">
              <button class="btn" @click="importCapabilities">导入草稿</button>
              <button class="btn" :disabled="!coordinator.capabilityReadCount" @click="exportCapabilities">
                <Download :size="14" />导出已读
              </button>
              <button
                class="btn primary"
                :disabled="!coordinator.identified || coordinator.isBusy"
                @click="readAllCapabilities"
              >
                <RefreshCw :size="14" />扫描 32 槽位
              </button>
            </div>
          </div>
          <section class="capability-layout">
            <article class="panel capability-list">
              <div class="capability-list-header">
                <strong>槽位台账</strong>
                <small>已读取 {{ coordinator.capabilityReadCount }}/32 · 导入草稿 {{ importedCapabilityCount }}</small>
              </div>
              <button
                v-for="slot in capabilitySlots"
                :key="slot"
                class="capability-slot"
                :class="{
                  active: selectedCapabilitySlot === slot,
                  enabled: coordinator.capabilitySnapshots[slot]?.value.enabled,
                  draft: capabilityDrafts[slot]
                }"
                @click="selectCapabilitySlot(slot)"
              >
                <strong>{{ String(slot).padStart(2, '0') }}</strong><span>{{ capabilityDescription(slot) }}</span>
              </button>
            </article>
            <article class="panel capability-editor">
              <div class="panel-title">
                <Database :size="18" />
                <div>
                  <h2>{{ capabilityOwnerForSlot(selectedCapabilitySlot) }}</h2>
                  <small>{{ selectedCapability ? formatTime(selectedCapability.receivedAt) : '先读取此槽位，再允许写入' }}</small>
                </div>
                <button
                  class="icon-btn"
                  :disabled="!ready || coordinator.isBusy"
                  title="读取当前槽位"
                  @click="readSelectedCapability"
                >
                  <RefreshCw :size="14" />
                </button>
              </div>
              <div class="capability-hint">
                <span>0=SPARK_LINK 时地址必须为 0；2=FACTORY 时必须提供固定地址。</span>
                <span>codec：0=NONE，1=SPARK_V1，2=SJZ_LEGACY。</span>
              </div>
              <textarea
                v-model="capabilityEditor"
                spellcheck="false"
                :placeholder="`先读取 ${capabilityOwnerForSlot(selectedCapabilitySlot)}`"
              />
              <div class="owner-actions">
                <span>设备端写 EEPROM 后立即读回，不重启协调器。</span>
                <button
                  class="btn primary"
                  :disabled="!ready || !selectedCapability || coordinator.isBusy"
                  @click="requestCapabilityWrite"
                >
                  <Send :size="14" />确认并写入此槽位
                </button>
              </div>
            </article>
          </section>
        </template>

        <template v-else-if="activeSection === 'sync'">
          <div class="section-toolbar">
            <div>
              <h2>同步规则规范化上传</h2>
              <p>桌面端冻结为固件可解析的规范 JSON；上传后仅用现有 <code>@STATUS</code> 核对规则数与长度摘要。</p>
            </div>
            <div class="toolbar-actions">
              <button class="btn" @click="importSyncDraft">导入 JSON</button>
              <button class="btn" @click="exportSyncDraft"><Download :size="14" />导出规范稿</button>
              <button
                class="btn primary"
                :disabled="!coordinator.identified || coordinator.isBusy || !syncPreflight.prepared"
                @click="requestSyncUpload"
              >
                <Send :size="14" />预检后上传
              </button>
            </div>
          </div>
          <section class="sync-layout">
            <article class="panel sync-editor">
              <div class="panel-title">
                <FileJson :size="18" />
                <div>
                  <h2>规则草稿</h2>
                  <small>最多 16 条规则、128 条映射、32768 B；上传前将统一字段顺序与数据类型大小写。</small>
                </div>
              </div>
              <textarea v-model="syncEditor" spellcheck="false" />
            </article>
            <aside class="sync-summary">
              <article class="panel preflight-card" :class="{ invalid: !syncPreflight.prepared }">
                <strong>{{ syncPreflight.prepared ? '本地预检通过' : '本地预检未通过' }}</strong>
                <template v-if="syncPreflight.prepared">
                  <span>规范化长度 <code>{{ syncPreflight.prepared.byteLength }} B</code></span>
                  <span>CRC32 <code>{{ syncPreflight.prepared.crc32 }}</code></span>
                  <span>规则 / 映射 <code>{{ syncPreflight.prepared.ruleCount }} / {{ syncPreflight.prepared.mappingCount }}</code></span>
                </template>
                <p v-else>{{ syncPreflight.error }}</p>
              </article>
              <article v-if="coordinator.lastSyncUpload" class="panel preflight-card" :class="{ invalid: !coordinator.lastSyncUpload.summaryMatched }">
                <strong>最近一次上传摘要核对</strong>
                <span>设备 sequence：{{ coordinator.lastSyncUpload.sequenceBefore }} → {{ coordinator.lastSyncUpload.sequenceAfter }}</span>
                <span>设备长度 / 规则：{{ coordinator.lastSyncUpload.deviceJsonLength }} / {{ coordinator.lastSyncUpload.deviceRuleCount }}</span>
                <p>{{ coordinator.lastSyncUpload.verificationMessage }}</p>
              </article>
              <article class="panel sync-boundary">
                <AlertTriangle :size="18" />
                <p>
                  当前固件未提供同步规则完整读回接口。<code>@STATUS</code> 摘要匹配不等同于 Flash 内容一致、同步运行、掉电恢复或三级级联 HIL 通过；缺口已记录给固件工程。
                </p>
              </article>
            </aside>
          </section>
        </template>

        <template v-else>
          <div class="section-toolbar">
            <div>
              <h2>命令事务与诊断边界</h2>
              <p>记录实际命令、设备回包、超时与失败；不把设备回包等同于 HIL 通过。</p>
            </div>
            <div class="toolbar-actions">
              <button class="btn" @click="coordinator.clearRecords">清空</button><button class="btn primary" @click="exportDiagnostic">
                <Download :size="15" />导出诊断
              </button>
            </div>
          </div>
          <section class="panel session-table">
            <div v-if="!coordinator.records.length" class="empty-inline">暂无协调器事务</div>
            <div
              v-for="record in [...coordinator.records].reverse()"
              :key="record.id"
              class="record-row"
            >
              <span class="record-status" :class="record.status">{{ record.status }}</span>
              <time>{{ formatTime(record.startedAt) }}</time><code>{{ record.command }}</code><span class="response">{{ record.response || record.error || '无回包' }}</span>
            </div>
          </section>
          <section class="panel limitations">
            <AlertTriangle :size="18" />
            <div>
              <h3>当前未验证边界</h3>
              <p>
                未执行 F407/F427 实板、双 Radio 射频、EEPROM 掉电、LAN8742/TCP、同步 Flash
                掉电恢复和三级级联 HIL。同步完整 JSON 已可读回核验，但 Radio 芯片实时观测仍需扩展协议；
                EEPROM owner 中的网络名/功率只表示保存目标，不表示实际无线生效值。重启恢复只尝试写入前
                已连接的精确串口路径；若系统重新枚举为新路径，工具不会扫描或向新路径自动发送命令。
              </p>
            </div>
          </section>
        </template>
      </main>
    </div>

    <ConfirmModal
      :visible="Boolean(pendingWrite)"
      title="应用完整配置到设备"
      :message="`${pendingWrite || ''} 写入会修改 EEPROM，并可能立即重启设备、短暂中断双 Radio 与网络。当前工具不会宣称跨 owner 原子回滚。`"
      danger-level="high"
      confirm-text="确认写入"
      :countdown-seconds="3"
      @confirm="confirmWrite"
      @cancel="pendingWrite = null"
    />
    <ConfirmModal
      :visible="pendingCapabilityWrite"
      title="写入终端 Capability 槽位"
      :message="`${capabilityOwnerForSlot(selectedCapabilitySlot)} 会立即修改 EEPROM 中单个终端的下行/ACK 协议和无线地址适配。工具会在设备返回 OK 后重新读取同一槽位；不批量写入其他导入草稿。`"
      danger-level="high"
      confirm-text="确认写入并读回"
      :countdown-seconds="3"
      @confirm="confirmCapabilityWrite"
      @cancel="pendingCapabilityWrite = false"
    />
    <ConfirmModal
      :visible="pendingSyncUpload"
      title="上传同步规则到内部 Flash"
      :message="`将以 @SYNC BEGIN/${syncPreflight.prepared?.byteLength || 0} B/CRC32 ${syncPreflight.prepared?.crc32 || '—'} → payload → @SYNC COMMIT 单次提交。设备可能短暂复位双 Radio；工具随后读取 @STATUS 和 @SYNC GET，核验完整规范内容。`"
      danger-level="high"
      confirm-text="确认上传规则"
      :countdown-seconds="3"
      @confirm="confirmSyncUpload"
      @cancel="pendingSyncUpload = false"
    />
  </div>
</template>

<style scoped>
.xtq-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-canvas);
}
.page-header {
  min-height: 82px;
  padding: 12px 16px;
  background: var(--color-surface-1);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.title-block,
.header-actions,
.title-block > div,
.connection-chip,
.panel-title,
.identity-card > div,
.toolbar-actions {
  display: flex;
  align-items: center;
}
.title-block {
  gap: 11px;
}
.title-mark {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  color: var(--color-accent);
  background: #e7f1fa;
  border: 1px solid #9fc1dc;
  border-radius: var(--radius);
}
.eyebrow {
  color: var(--color-accent);
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.page-header h1 {
  margin: 2px 0;
  font-size: 1.18rem;
}
.page-header p,
.section-toolbar p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}
.header-actions {
  gap: 8px;
}
.connection-chip {
  gap: 8px;
  min-width: 170px;
  padding: 6px 9px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
}
.connection-chip > div {
  display: flex;
  flex-direction: column;
}
.connection-chip strong {
  font-size: 0.76rem;
}
.connection-chip small {
  color: var(--color-text-tertiary);
  font-size: 0.66rem;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-border-strong);
}
.connection-chip.online .status-dot {
  background: var(--color-success);
  box-shadow: 0 0 0 3px #dff2e8;
}
.connection-chip.warning .status-dot {
  background: var(--color-warning);
}
.btn,
.icon-btn {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-xs);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 0.75rem;
}
.btn:hover:not(:disabled),
.icon-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  background: #eef6fc;
}
.btn.primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: white;
}
.btn:disabled,
.icon-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.icon-btn {
  min-width: 28px;
  padding: 4px;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.notice {
  position: absolute;
  z-index: 20;
  top: 88px;
  right: 16px;
  max-width: 560px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  color: var(--color-success);
  background: #e7f5ed;
  border: 1px solid #8bc5a8;
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 22px rgba(27, 45, 58, 0.15);
  font-size: 0.75rem;
}
.notice.error {
  color: var(--color-danger);
  background: #fdebed;
  border-color: #d58b90;
}
.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 190px 1fr;
}
.section-nav {
  padding: 12px 8px;
  background: var(--color-surface-1);
  border-right: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.section-nav > button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--color-text-primary);
}
.section-nav > button.active {
  color: var(--color-accent);
  background: #e7f1fa;
  border-color: #9fc1dc;
}
.section-nav button span {
  display: flex;
  flex-direction: column;
}
.section-nav strong {
  font-size: 0.76rem;
}
.section-nav small {
  color: var(--color-text-tertiary);
  font-size: 0.64rem;
}
.scope-note {
  margin-top: auto;
  padding: 9px;
  background: #fff8e7;
  border: 1px solid #d8bd77;
  border-radius: var(--radius-sm);
}
.scope-note strong {
  color: var(--color-warning);
  font-size: 0.7rem;
}
.scope-note p {
  margin: 5px 0 0;
  color: var(--color-text-secondary);
  font-size: 0.64rem;
  line-height: 1.45;
}
.scope-note code {
  font-family: var(--font-mono);
}
.content {
  overflow: auto;
  padding: 12px;
}
.panel {
  background: var(--color-surface-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
}
.identity-card {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin-bottom: 10px;
}
.identity-card > div {
  gap: 9px;
  padding: 11px 13px;
  border-right: 1px solid var(--color-border-subtle);
}
.identity-card > div:last-child {
  border: 0;
}
.identity-card svg {
  color: var(--color-accent);
}
.identity-card span {
  display: flex;
  flex-direction: column;
}
.identity-card small,
.detail-strip small {
  color: var(--color-text-tertiary);
  font-size: 0.64rem;
}
.identity-card strong {
  margin-top: 2px;
  font-size: 0.82rem;
}
.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(300px, 1fr));
  gap: 10px;
}
.radio-card,
.metrics-card {
  padding: 11px;
}
.radio-card.healthy {
  border-top: 3px solid var(--color-success);
}
.radio-card.alarm {
  border-top-color: var(--color-danger);
}
.panel-title {
  gap: 8px;
  margin-bottom: 9px;
}
.panel-title > div {
  flex: 1;
}
.panel-title h2 {
  margin: 0;
  font-size: 0.82rem;
}
.panel-title small {
  color: var(--color-text-tertiary);
  font-size: 0.64rem;
}
.panel-title .badge {
  margin-left: auto;
  padding: 2px 6px;
  color: var(--color-accent);
  background: #e7f1fa;
  border-radius: 10px;
  font-size: 0.63rem;
}
.radio-card dl {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  background: var(--color-border-subtle);
}
.radio-card dl div {
  padding: 6px 8px;
  background: var(--color-surface-2);
}
.radio-card dt {
  color: var(--color-text-tertiary);
  font-size: 0.62rem;
}
.radio-card dd {
  margin: 2px 0 0;
  font-family: var(--font-mono);
  font-size: 0.7rem;
}
.metric-row {
  display: flex;
  justify-content: space-between;
  padding: 7px 2px;
  border-bottom: 1px solid var(--color-border-subtle);
  font-size: 0.72rem;
}
.metric-row span {
  color: var(--color-text-secondary);
}
.metric-row strong {
  font-family: var(--font-mono);
}
.delta {
  display: block;
  margin-top: 8px;
  color: var(--color-text-tertiary);
  font-size: 0.64rem;
}
.danger {
  color: var(--color-danger) !important;
}
.detail-strip {
  margin-top: 10px;
  padding: 10px 12px;
  display: flex;
  gap: 22px;
}
.detail-strip span {
  display: flex;
  flex-direction: column;
}
.detail-strip .grow {
  flex: 1;
}
.detail-strip strong {
  margin-top: 3px;
  font-size: 0.72rem;
}
.status-history {
  margin-top: 10px;
  padding: 11px;
}
.status-history .panel-title {
  align-items: flex-start;
}
.status-history .btn {
  margin-left: auto;
}
.history-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: var(--color-border-subtle);
}
.history-summary span {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 8px;
  background: var(--color-surface-2);
}
.history-summary small,
.history-empty {
  color: var(--color-text-tertiary);
  font-size: 0.64rem;
}
.history-summary strong {
  color: var(--color-text-primary);
  font-size: 0.69rem;
  font-weight: 600;
}
.history-empty {
  padding: 10px 1px 1px;
  line-height: 1.45;
}
.history-empty code,
.difference-row code {
  font-family: var(--font-mono);
}
.difference-list {
  max-height: 208px;
  margin-top: 9px;
  overflow: auto;
  border: 1px solid var(--color-border-subtle);
}
.difference-row {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(80px, 0.45fr) 16px minmax(80px, 0.45fr);
  align-items: center;
  gap: 7px;
  min-height: 29px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
  font-size: 0.66rem;
}
.difference-row:last-child {
  border-bottom: 0;
}
.difference-row strong {
  font-weight: 500;
}
.difference-row code {
  overflow: hidden;
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.difference-row span {
  color: var(--color-text-tertiary);
  text-align: center;
}
.radio-config-compare {
  margin-top: 10px;
  padding: 11px;
}
.radio-config-compare .panel-title {
  align-items: flex-start;
}
.radio-config-compare .panel-title .btn {
  margin-left: auto;
}
.radio-config-compare code,
.sync-boundary code,
.preflight-card code {
  font-family: var(--font-mono);
}
.radio-config-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(240px, 1fr));
  gap: 8px;
}
.radio-config-card {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 9px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-xs);
}
.radio-config-card > strong,
.radio-config-card > em {
  grid-column: 1 / -1;
}
.radio-config-card > strong {
  font-size: 0.73rem;
}
.radio-config-card span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.radio-config-card small {
  color: var(--color-text-tertiary);
  font-size: 0.61rem;
}
.radio-config-card code {
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.radio-config-card em {
  color: var(--color-warning);
  font-size: 0.63rem;
  font-style: normal;
}
.empty-state {
  min-height: 360px;
  display: grid;
  place-content: center;
  justify-items: center;
  color: var(--color-text-tertiary);
}
.empty-state h2 {
  margin: 12px 0 4px;
  color: var(--color-text-primary);
  font-size: 1rem;
}
.empty-state p {
  margin: 0;
  font-size: 0.75rem;
}
.section-toolbar {
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 9px;
}
.section-toolbar h2 {
  margin: 0 0 3px;
  font-size: 0.95rem;
}
.owner-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(360px, 1fr));
  gap: 10px;
}
.owner-card {
  padding: 10px;
}
.owner-card textarea {
  width: 100%;
  min-height: 210px;
  resize: vertical;
  padding: 9px;
  color: var(--color-text-primary);
  background: #f7f9fb;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-xs);
  font: 0.7rem/1.5 var(--font-mono);
  user-select: text;
}
.owner-card textarea:focus {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -1px;
}
.owner-card textarea:read-only {
  color: var(--color-text-secondary);
}
.owner-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 7px;
}
.owner-actions span {
  color: var(--color-text-tertiary);
  font-size: 0.65rem;
}
.capability-layout,
.sync-layout {
  display: grid;
  grid-template-columns: minmax(290px, 0.8fr) minmax(430px, 1.2fr);
  gap: 10px;
}
.capability-list,
.capability-editor,
.sync-editor {
  padding: 10px;
}
.capability-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 6px;
}
.capability-list-header {
  grid-column: 1 / -1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: 4px;
}
.capability-list-header strong {
  font-size: 0.8rem;
}
.capability-list-header small {
  color: var(--color-text-tertiary);
  font-size: 0.64rem;
}
.capability-slot {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 6px;
  min-height: 45px;
  padding: 6px;
  color: var(--color-text-primary);
  text-align: left;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-xs);
  cursor: pointer;
}
.capability-slot:hover,
.capability-slot.active {
  border-color: var(--color-accent);
  background: #e7f1fa;
}
.capability-slot.enabled {
  border-left: 3px solid var(--color-success);
}
.capability-slot.draft {
  box-shadow: inset 0 0 0 1px var(--color-warning);
}
.capability-slot strong {
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}
.capability-slot span {
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: 0.64rem;
  line-height: 1.35;
  text-overflow: ellipsis;
}
.capability-editor {
  display: flex;
  flex-direction: column;
}
.capability-editor textarea,
.sync-editor textarea {
  width: 100%;
  min-height: 300px;
  resize: vertical;
  padding: 9px;
  color: var(--color-text-primary);
  background: #f7f9fb;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-xs);
  font: 0.7rem/1.5 var(--font-mono);
  user-select: text;
}
.capability-editor textarea:focus,
.sync-editor textarea:focus {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -1px;
}
.capability-hint {
  display: flex;
  gap: 12px;
  margin: 0 0 8px;
  color: var(--color-text-tertiary);
  font-size: 0.64rem;
  line-height: 1.4;
}
.sync-layout {
  grid-template-columns: minmax(480px, 1.35fr) minmax(280px, 0.65fr);
}
.sync-summary {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.preflight-card,
.sync-boundary {
  padding: 11px;
}
.preflight-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-left: 3px solid var(--color-success);
}
.preflight-card.invalid {
  border-left-color: var(--color-danger);
  background: #fff8f8;
}
.preflight-card strong {
  font-size: 0.78rem;
}
.preflight-card span,
.preflight-card p,
.sync-boundary p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.67rem;
  line-height: 1.5;
}
.sync-boundary {
  display: flex;
  gap: 8px;
  color: var(--color-warning);
  background: #fff8e7;
  border-color: #d8bd77;
}
.session-table {
  overflow: hidden;
}
.record-row {
  min-height: 38px;
  display: grid;
  grid-template-columns: 90px 150px minmax(240px, 1fr) minmax(180px, 0.8fr);
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border-bottom: 1px solid var(--color-border-subtle);
  font-size: 0.68rem;
}
.record-row:last-child {
  border-bottom: 0;
}
.record-row time {
  color: var(--color-text-tertiary);
}
.record-row code,
.response {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  user-select: text;
}
.record-status {
  width: max-content;
  padding: 2px 6px;
  border-radius: 9px;
  background: #e8edf2;
  text-transform: uppercase;
}
.record-status.ok {
  color: var(--color-success);
  background: #e7f5ed;
}
.record-status.device_error,
.record-status.timeout,
.record-status.communication_error {
  color: var(--color-danger);
  background: #fdebed;
}
.empty-inline {
  padding: 36px;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: 0.75rem;
}
.limitations {
  margin-top: 10px;
  padding: 11px;
  display: flex;
  gap: 9px;
  color: var(--color-warning);
  background: #fff8e7;
  border-color: #d8bd77;
}
.limitations h3 {
  margin: 0;
  font-size: 0.78rem;
}
.limitations p {
  margin: 4px 0 0;
  color: var(--color-text-secondary);
  font-size: 0.68rem;
  line-height: 1.45;
}
@media (max-width: 1100px) {
  .identity-card {
    grid-template-columns: repeat(2, 1fr);
  }
  .status-grid,
  .owner-grid,
  .capability-layout,
  .sync-layout {
    grid-template-columns: 1fr;
  }
  .radio-config-grid {
    grid-template-columns: 1fr;
  }
  .history-summary {
    grid-template-columns: 1fr;
  }
  .difference-row {
    grid-template-columns: minmax(130px, 1fr) minmax(70px, 0.45fr) 16px minmax(70px, 0.45fr);
  }
  .header-actions .connection-chip {
    display: none;
  }
}
</style>
