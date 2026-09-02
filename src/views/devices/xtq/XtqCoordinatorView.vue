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
import { appSaveFile } from '../../../api/sjzdApi'
import { useSerialStore } from '../../../stores/serialStore'
import { useXtqCoordinatorStore } from '../../../stores/xtqCoordinatorStore'
import { XTQ_OWNERS, type XtqOwner } from '../../../types/xtqCoordinator'
import {
  configErrorLabels,
  enumLabel,
  XTQ_MODE_LABELS,
  XTQ_NETWORK_STATE_LABELS,
  XTQ_RADIO_STATE_LABELS,
  XTQ_ROLE_LABELS
} from '../../../utils/xtqCoordinatorProtocol'

type Section = 'overview' | 'configuration' | 'session'

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
const message = ref<{ text: string; error: boolean } | null>(null)
const pendingWrite = ref<XtqOwner | null>(null)

const sections = [
  { id: 'overview' as const, label: '运行总览', caption: '@STATUS 实时诊断', icon: Activity },
  {
    id: 'configuration' as const,
    label: '配置快照',
    caption: 'Owner 读取与受控写入',
    icon: Database
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
    await coordinator.readAllOwners()
    showMessage('五类 owner 已读取；编辑区已基于设备当前完整对象更新')
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
            <code>@SYNC GET</code> 与完整 Radio
            观测接口尚未实现，当前只展示真实摘要，不推断规则内容或功率档位。
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
                掉电恢复和三级级联 HIL。同步完整 JSON 读取及 Radio 网络名/功率观测需先扩展固件协议。
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
  .owner-grid {
    grid-template-columns: 1fr;
  }
  .header-actions .connection-chip {
    display: none;
  }
}
</style>
