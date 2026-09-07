<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Cpu,
  Database,
  Download,
  EthernetPort,
  FileClock,
  Fingerprint,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings2,
  ShieldAlert,
  TerminalSquare,
  Trash2,
  Lightbulb,
} from 'lucide-vue-next'
import ConfirmModal from '../../../components/common/ConfirmModal.vue'
import { appSaveFile } from '../../../api/sjzdApi'
import { useSerialStore } from '../../../stores/serialStore'
import { useControllerDebugStore } from '../../../stores/controllerDebugStore'
import { useKz3MaintenanceStore } from '../../../stores/kz3MaintenanceStore'
import type {
  Kz3ConfigGroup,
  Kz3Cat1Candidate,
  Kz3EthernetCandidate,
  Kz3SleCandidate,
  Kz3SystemRole,
  Kz3WirelessCandidate,
} from '../../../types/kz3Maintenance'
import {
  buildCat1InitCommand,
  buildCat1ReconnectCommand,
  buildCat1UpdateCommands,
  buildDebugCommand,
  buildEthernetCommands,
  buildKz3HttpBaseUrl,
  buildIdentityCommand,
  buildRoleCommand,
  buildSleInitCommand,
  buildWirelessModeCommand,
  buildWirelessReportCommand,
  KZ3_SLE_FIXED_ADDRESS,
  KZ3_SLE_FIXED_APID,
  KZ3_UART_CONFIG,
  redactKz3Command,
  sleConfirmationLevel,
} from '../../../utils/kz3UartProtocol'

type Section = 'overview' | Kz3ConfigGroup | 'session'

const serial = useSerialStore()
const maintenance = useKz3MaintenanceStore()
const httpDebug = useControllerDebugStore()
const activeSection = ref<Section>('overview')
const pageMessage = ref<{ text: string; error: boolean } | null>(null)
const customCommandInput = ref('')
const snCandidate = ref('020300000001')
const ethernet = ref<Kz3EthernetCandidate>({
  ip: '192.168.30.66',
  mask: '255.255.255.0',
  gateway: '192.168.30.1',
  port: '8080',
})
const sle = ref<Kz3SleCandidate>({
  address: KZ3_SLE_FIXED_ADDRESS,
  name: 'KZ3-CTRL',
  apid: KZ3_SLE_FIXED_APID,
  power: '5',
  maxPower: '5',
  mode: '0',
})
const wireless = ref<Kz3WirelessCandidate>({
  mode: 'SLE',
  reportSeconds: '15',
})
const cat1 = ref<Kz3Cat1Candidate>({
  apn: '',
  host: '',
  port: '1883',
  username: '',
  password: '',
  topic: 'devices',
  keepalive: '60',
  qos: '1',
})
const role = ref<Kz3SystemRole>('CONTROLLER')
const roleAddress = ref('1')
const confirmAction = ref<{ title: string; message: string; commands: string[] } | null>(null)

const sections: Array<{
  id: Section
  label: string
  caption: string
  icon: typeof Cpu
}> = [
  { id: 'overview', label: '设备总览', caption: '七组配置快照', icon: Cpu },
  { id: 'system', label: '生产身份', caption: 'SN / 型号 / 地址', icon: Fingerprint },
  { id: 'ethernet', label: 'Ethernet', caption: 'RUN / SAVED', icon: EthernetPort },
  { id: 'sle', label: '星闪 SLE', caption: 'EEPROM / 模组确认', icon: Radio },
  { id: 'wireless', label: '无线承载', caption: 'SLE / Cat.1 模式', icon: Activity },
  { id: 'cat1', label: 'Cat.1 / MQTT', caption: '首配 / 差异 / 重连', icon: Settings2 },
  { id: 'io', label: '系统角色', caption: 'Controller / RTU', icon: Database },
  { id: 'debug', label: '调试日志', caption: '持久化 DEBUG 开关', icon: TerminalSquare },
  { id: 'session', label: '会话记录', caption: '原始回包与审计', icon: FileClock },
]

const connected = computed(() => Boolean(serial.connectedPort))
const serialConfigMatches = computed(() =>
  serial.config.baudRate === KZ3_UART_CONFIG.baudRate &&
  serial.config.dataBits === KZ3_UART_CONFIG.dataBits &&
  serial.config.stopBits === KZ3_UART_CONFIG.stopBits &&
  serial.config.parity === KZ3_UART_CONFIG.parity &&
  serial.config.flowControl === KZ3_UART_CONFIG.flowControl
)
const maintenanceReady = computed(() => connected.value && serialConfigMatches.value)
const statusText = computed(() => {
  if (connected.value && !serialConfigMatches.value) return '串口参数不匹配'
  const labels = {
    disconnected: '未连接',
    connected: '已连接，可查询',
    querying: '正在查询',
    writing: '正在写入',
    waiting_reboot: '配置已保存，等待重启复核',
    error: '最近操作失败',
  }
  return labels[maintenance.status]
})
const sleLevel = computed(() =>
  sleConfirmationLevel(maintenance.snapshots.sle?.fields || {})
)
const latestSnapshotAt = computed(() => {
  const timestamps = Object.values(maintenance.snapshots)
    .map((snapshot) => snapshot?.receivedAt || '')
    .filter(Boolean)
    .sort()
  return timestamps[timestamps.length - 1] || ''
})
const savedHttpUrl = computed(() => {
  const fields = maintenance.snapshots.ethernet?.fields
  if (!fields?.SAVED_IP || !fields.SAVED_MASK || !fields.SAVED_GW || !fields.SAVED_PORT) return ''
  try {
    return buildKz3HttpBaseUrl({
      ip: fields.SAVED_IP,
      mask: fields.SAVED_MASK,
      gateway: fields.SAVED_GW,
      port: fields.SAVED_PORT,
    })
  } catch {
    return ''
  }
})
const latestNetworkRecovery = computed(
  () => maintenance.networkRecoveryAttempts[maintenance.networkRecoveryAttempts.length - 1]
)

function showMessage(text: string, error = false) {
  pageMessage.value = { text, error }
  window.setTimeout(() => {
    if (pageMessage.value?.text === text) pageMessage.value = null
  }, 4000)
}

function field(group: Kz3ConfigGroup, name: string, fallback = '—') {
  return maintenance.snapshots[group]?.fields[name] || fallback
}

function isOne(group: Kz3ConfigGroup, name: string) {
  return field(group, name, '0') === '1'
}

function hasSnapshot(group: Kz3ConfigGroup) {
  return Boolean(maintenance.snapshots[group])
}

function formatTime(iso: string) {
  if (!iso) return '尚未查询'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

async function query(group: Kz3ConfigGroup) {
  try {
    const result = await maintenance.runQuery(group)
    if (result.status === 'ok') showMessage(`${sections.find((item) => item.id === group)?.label}查询完成`)
    else showMessage(result.error || result.protocolLine || '查询失败', true)
  } catch (error) {
    showMessage(String(error), true)
  }
}

async function queryAll() {
  try {
    await maintenance.queryAll()
    showMessage('七组配置查询完成；请按各层状态判断是否真正生效')
  } catch (error) {
    showMessage(String(error), true)
  }
}

async function reconnectHttpAtSavedAddress() {
  const target = savedHttpUrl.value
  if (!target) {
    showMessage('请先通过 @CFG,ETH,SHOW 回读完整 SAVED IP、MASK、GW 与 PORT', true)
    return
  }
  const attemptId = maintenance.startNetworkRecoveryAttempt(target)
  try {
    if (httpDebug.transportState !== 'disconnected') httpDebug.disconnect()
    httpDebug.baseUrl = target
    await httpDebug.connect()
    const status =
      httpDebug.compatibilityState === 'matched'
        ? 'http_reachable_matched'
        : httpDebug.compatibilityState === 'mismatch'
          ? 'http_reachable_mismatch'
          : 'http_reachable_partial'
    maintenance.finishNetworkRecoveryAttempt(attemptId, status)
    showMessage(
      httpDebug.compatibilityState === 'matched'
        ? `HTTP 已连通：${target}；工程 ID、版本与北向 manifest 已匹配，在线页仍需单独解锁写入`
        : `HTTP 已连通：${target}；工程身份校验状态为 ${httpDebug.compatibilityState}，在线页保持只读`,
      false
    )
  } catch (error) {
    maintenance.finishNetworkRecoveryAttempt(attemptId, 'failed', String(error))
    showMessage(`候选 HTTP 地址未连通：${String(error)}；工具未扫描其他网段或地址`, true)
  }
}

function handleReboot() {
  requestWrite(
    '确认安全软重启设备 (@RST)',
    '向控制器发送软重启指令 @RST。控制器输出将在安全状态下复位，CPU 重启并重新加载 EEPROM 存储的全部配置。',
    () => '@RST'
  )
}

async function sendIndicatorTest(kind: 'GRN' | 'RED' | 'OFF') {
  try {
    const res = await maintenance.runWrite(kind)
    if (res.status === 'ok') {
      showMessage(`指示灯自检指令 ${kind} 已执行：${res.protocolLine}`)
    } else {
      showMessage(`指示灯指令失败：${res.error || res.protocolLine}`, true)
    }
  } catch (err) {
    showMessage(String(err), true)
  }
}

async function sendDirectCommand(rawCmd?: string) {
  const cmd = (rawCmd !== undefined ? rawCmd : customCommandInput.value).trim()
  if (!cmd) return
  try {
    const res = await maintenance.runWrite(cmd)
    if (res.status === 'ok') {
      showMessage(`指令 ${cmd} 执行成功：${res.protocolLine}`)
      if (rawCmd === undefined) customCommandInput.value = ''
    } else {
      showMessage(`指令失败：${res.error || res.protocolLine}`, true)
    }
  } catch (err) {
    showMessage(String(err), true)
  }
}

function requestWrite(title: string, message: string, builder: () => string | string[]) {
  try {
    const built = builder()
    const commands = Array.isArray(built) ? built : [built]
    const commandPreview = commands.map((command, index) => `${index + 1}. ${redactKz3Command(command)}`).join('\n')
    confirmAction.value = {
      title,
      message: `${message}\n\n即将按顺序发送 ${commands.length} 条配置指令：\n${commandPreview}`,
      commands,
    }
  } catch (error) {
    showMessage(String(error), true)
  }
}

async function confirmWrite() {
  const action = confirmAction.value
  confirmAction.value = null
  if (!action) return
  try {
    for (let index = 0; index < action.commands.length; index++) {
      const command = action.commands[index]
      const result = await maintenance.runWrite(command)
      if (result.status !== 'ok') {
        showMessage(
          `第 ${index + 1}/${action.commands.length} 条指令失败（${command}）：${result.error || result.protocolLine || '设备拒绝写入'}`,
          true
        )
        return
      }
    }
    showMessage(
      action.commands.length > 1
        ? `${action.commands.length} 项配置已逐条写入，每条均完成回包与 SHOW 复核；请继续检查生效层级`
        : '设备已接受写入，并已执行对应 SHOW 复核；请继续检查生效层级'
    )
  } catch (error) {
    showMessage(String(error), true)
  }
}

async function exportSession() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const path = await appSaveFile(
    `KZ3-UART1维护记录-${timestamp}.json`,
    maintenance.exportSession(),
    'KZ3 UART1 维护记录',
    'json'
  )
  showMessage(path ? `维护记录已导出：${path}` : '未选择导出位置', !path)
}

watch(
  () => maintenance.snapshots.system,
  (snapshot) => {
    if (snapshot?.fields.SN && snapshot.fields.VALID === '1') snCandidate.value = snapshot.fields.SN
  }
)

watch(
  () => maintenance.snapshots.ethernet,
  (snapshot) => {
    if (!snapshot) return
    ethernet.value = {
      ip: snapshot.fields.SAVED_IP || ethernet.value.ip,
      mask: snapshot.fields.SAVED_MASK || ethernet.value.mask,
      gateway: snapshot.fields.SAVED_GW || ethernet.value.gateway,
      port: snapshot.fields.SAVED_PORT || ethernet.value.port,
    }
  }
)

watch(
  () => maintenance.snapshots.sle,
  (snapshot) => {
    if (!snapshot) return
    sle.value = {
      address: KZ3_SLE_FIXED_ADDRESS,
      name: snapshot.fields.NAME ?? sle.value.name,
      apid: KZ3_SLE_FIXED_APID,
      power: snapshot.fields.PWR || sle.value.power,
      maxPower: snapshot.fields.MAXPWR || sle.value.maxPower,
      mode: snapshot.fields.MODE || sle.value.mode,
    }
  }
)

watch(
  () => maintenance.snapshots.wireless,
  (snapshot) => {
    if (!snapshot) return
    wireless.value = {
      mode: snapshot.fields.SAVED === 'CAT1' ? 'CAT1' : 'SLE',
      reportSeconds: snapshot.fields.REPORT_RAW || wireless.value.reportSeconds,
    }
  }
)

watch(
  () => maintenance.snapshots.cat1,
  (snapshot) => {
    if (!snapshot) return
    cat1.value = {
      apn: snapshot.fields.APN ?? cat1.value.apn,
      host: snapshot.fields.HOST ?? cat1.value.host,
      port: snapshot.fields.PORT || cat1.value.port,
      username: '',
      password: '',
      topic: snapshot.fields.TOPIC ?? cat1.value.topic,
      keepalive: snapshot.fields.KEEPALIVE || cat1.value.keepalive,
      qos: snapshot.fields.QOS || cat1.value.qos,
    }
  }
)

watch(
  () => maintenance.snapshots.io,
  (snapshot) => {
    if (!snapshot) return
    role.value = snapshot.fields.SAVED_ROLE === 'RTU_SLAVE' ? 'RTU_SLAVE' : 'CONTROLLER'
    roleAddress.value = snapshot.fields.SAVED_ADDR || '1'
  }
)

onMounted(() => {
  maintenance.initialize()
})
</script>

<template>
  <div class="maintenance-page">
    <header class="page-header">
      <div class="title-block">
        <div class="title-mark"><Settings2 :size="22" /></div>
        <div>
          <div class="eyebrow">KZ3 · UART1 DEVICE MAINTENANCE</div>
          <h1>设备初始化与维护工作台</h1>
          <p>结构化配置 SN、Ethernet、SLE、Cat.1/MQTT、系统角色与调试日志；不修改工程 YAML</p>
        </div>
      </div>
      <div class="header-actions">
        <div class="shared-serial-status" :class="{ online: maintenanceReady, warning: connected && !serialConfigMatches }">
          <span class="pulse-dot" />
          <div>
            <strong>{{ statusText }}</strong>
            <small>{{ serial.connectedPort || '请使用左下角公共串口连接' }}</small>
          </div>
        </div>
        <button class="button danger-outline" :disabled="!maintenanceReady || maintenance.isBusy" title="向控制器发送 @RST 软重启命令" @click="handleReboot">
          <RotateCcw :size="14" /> 安全重启 (@RST)
        </button>
        <button class="button secondary" :disabled="maintenance.isBusy" @click="exportSession">
          <Download :size="14" /> 导出记录
        </button>
        <button class="button primary" :disabled="!maintenanceReady || maintenance.isBusy" @click="queryAll">
          <RefreshCw :size="14" :class="{ spin: maintenance.isBusy }" /> 查询全部
        </button>
      </div>
    </header>

    <div v-if="pageMessage" class="page-message" :class="{ error: pageMessage.error }">
      <AlertTriangle v-if="pageMessage.error" :size="15" />
      <CheckCircle2 v-else :size="15" />
      {{ pageMessage.text }}
    </div>

    <div class="workspace">
      <nav class="section-nav" aria-label="KZ3 维护功能">
        <button
          v-for="item in sections"
          :key="item.id"
          class="section-item"
          :class="{ active: activeSection === item.id }"
          @click="activeSection = item.id"
        >
          <component :is="item.icon" :size="17" />
          <span>
            <strong>{{ item.label }}</strong>
            <small>{{ item.caption }}</small>
          </span>
          <ChevronRight :size="14" />
        </button>

        <div class="boundary-card">
          <ShieldAlert :size="18" />
          <strong>验证边界</strong>
          <p>UART 回包只证明协议 owner 接受/查询成功，不等于网络、无线链路或现场动作通过。</p>
        </div>
      </nav>

      <main class="content-panel">
        <section v-if="activeSection === 'overview'" class="panel-section">
          <div class="section-heading">
            <div>
              <span class="section-kicker">CONFIGURATION SNAPSHOT</span>
              <h2>设备配置总览</h2>
              <p>最近快照 {{ formatTime(latestSnapshotAt) }}；断开或换端口后缓存不再代表当前设备。</p>
            </div>
            <span v-if="!maintenance.snapshotPortMatches" class="stale-badge">缓存来自其他串口</span>
          </div>

          <!-- Field Quick Actions & Hardware Test Toolbar -->
          <div class="field-toolbar-card">
            <div class="field-toolbar-row">
              <div class="toolbar-group">
                <span class="toolbar-title"><Lightbulb :size="14" /> 指示灯寻机自检：</span>
                <button
                  class="toolbar-btn led-grn"
                  :disabled="!maintenanceReady || maintenance.isBusy"
                  title="发送 GRN 指令，绿灯常亮测试"
                  @click="sendIndicatorTest('GRN')"
                >
                  绿灯 (GRN)
                </button>
                <button
                  class="toolbar-btn led-red"
                  :disabled="!maintenanceReady || maintenance.isBusy"
                  title="发送 RED 指令，红灯常亮测试"
                  @click="sendIndicatorTest('RED')"
                >
                  红灯 (RED)
                </button>
                <button
                  class="toolbar-btn led-off"
                  :disabled="!maintenanceReady || maintenance.isBusy"
                  title="发送 OFF 指令，关闭指示灯"
                  @click="sendIndicatorTest('OFF')"
                >
                  关灯 (OFF)
                </button>
              </div>

              <div class="toolbar-group command-runner-group">
                <span class="toolbar-title"><TerminalSquare :size="14" /> 常用指令速测：</span>
                <button
                  class="toolbar-chip"
                  :disabled="!maintenanceReady || maintenance.isBusy"
                  @click="sendDirectCommand('@CFG,SYS,SHOW')"
                >
                  @SYS
                </button>
                <button
                  class="toolbar-chip"
                  :disabled="!maintenanceReady || maintenance.isBusy"
                  @click="sendDirectCommand('@CFG,ETH,SHOW')"
                >
                  @ETH
                </button>
                <button
                  class="toolbar-chip"
                  :disabled="!maintenanceReady || maintenance.isBusy"
                  @click="sendDirectCommand('@CFG,SLE,SHOW')"
                >
                  @SLE
                </button>
                <button
                  class="toolbar-chip"
                  :disabled="!maintenanceReady || maintenance.isBusy"
                  @click="sendDirectCommand('@CFG,WIRELESS,SHOW')"
                >
                  @WIRELESS
                </button>
                <button
                  class="toolbar-chip"
                  :disabled="!maintenanceReady || maintenance.isBusy"
                  @click="sendDirectCommand('@CFG,4G,SHOW')"
                >
                  @4G
                </button>
                <button
                  class="toolbar-chip"
                  :disabled="!maintenanceReady || maintenance.isBusy"
                  @click="sendDirectCommand('@CFG,IO,SHOW')"
                >
                  @IO
                </button>
                <button
                  class="toolbar-chip"
                  :disabled="!maintenanceReady || maintenance.isBusy"
                  @click="sendDirectCommand('@DEBUG')"
                >
                  @DEBUG
                </button>
              </div>
            </div>

            <div class="custom-cmd-row">
              <input
                v-model="customCommandInput"
                type="text"
                class="custom-cmd-input mono"
                placeholder="输入原始 UART1 指令 (如 @DEBUG=1, @CFG,SYS,SHOW, DEVINFO)..."
                @keydown.enter="sendDirectCommand()"
              />
              <button
                class="button small primary"
                :disabled="!maintenanceReady || maintenance.isBusy || !customCommandInput.trim()"
                @click="sendDirectCommand()"
              >
                <Send :size="12" /> 发送指令
              </button>
            </div>
          </div>

          <div class="summary-grid">
            <button class="summary-card" @click="activeSection = 'system'">
              <div class="card-top"><Fingerprint :size="18" /><span>生产身份</span></div>
              <strong class="mono">{{ field('system', 'SN') }}</strong>
              <small :class="isOne('system', 'VALID') ? 'good' : 'warn'">
                {{ isOne('system', 'VALID') ? '身份记录有效' : '未确认 / 安全 fallback' }}
              </small>
            </button>
            <button class="summary-card" @click="activeSection = 'ethernet'">
              <div class="card-top"><EthernetPort :size="18" /><span>Ethernet</span></div>
              <strong class="mono">{{ field('ethernet', 'RUN_IP') }}</strong>
              <small :class="hasSnapshot('ethernet') && !isOne('ethernet', 'REBOOT_REQUIRED') ? 'good' : 'warn'">
                {{ !hasSnapshot('ethernet') ? '尚未查询' : isOne('ethernet', 'REBOOT_REQUIRED') ? '保存值待重启' : 'RUN / SAVED 一致' }}
              </small>
            </button>
            <button class="summary-card" @click="activeSection = 'sle'">
              <div class="card-top"><Radio :size="18" /><span>星闪 SLE</span></div>
              <strong>{{ field('sle', 'NAME') }}</strong>
              <small :class="sleLevel === 3 ? 'good' : 'warn'">
                {{ ['尚未确认', 'EEPROM 有效', '模组基础就绪', 'AT 参数已确认'][sleLevel] }}
              </small>
            </button>
            <button class="summary-card" @click="activeSection = 'wireless'">
              <div class="card-top"><Activity :size="18" /><span>无线承载</span></div>
              <strong>{{ field('wireless', 'RUN') }}</strong>
              <small :class="hasSnapshot('wireless') && !isOne('wireless', 'REBOOT_REQUIRED') ? 'good' : 'warn'">
                {{ !hasSnapshot('wireless') ? '尚未查询' : isOne('wireless', 'REBOOT_REQUIRED') ? '保存值待断电复核' : '运行 / 保存状态已读取' }}
              </small>
            </button>
            <button class="summary-card" @click="activeSection = 'cat1'">
              <div class="card-top"><Settings2 :size="18" /><span>Cat.1 / MQTT</span></div>
              <strong>{{ field('cat1', 'HOST') }}</strong>
              <small :class="isOne('cat1', 'VALID') ? 'good' : 'warn'">
                {{ isOne('cat1', 'VALID') ? '配置有效；凭证未回显' : '未配置 / 未确认' }}
              </small>
            </button>
            <button class="summary-card" @click="activeSection = 'io'">
              <div class="card-top"><Database :size="18" /><span>系统角色</span></div>
              <strong>{{ field('io', 'ACTIVE_ROLE') }}</strong>
              <small :class="hasSnapshot('io') && !isOne('io', 'REBOOT_REQUIRED') ? 'good' : 'warn'">
                {{ !hasSnapshot('io') ? '尚未查询' : isOne('io', 'REBOOT_REQUIRED') ? 'SAVED 尚未成为 ACTIVE' : field('io', 'ACTIVE_RECORD') }}
              </small>
            </button>
          </div>

          <div class="status-matrix">
            <div class="matrix-title">配置域生效矩阵</div>
            <div class="matrix-row matrix-header"><span>配置域</span><span>本地记录</span><span>运行/活动</span><span>外部链路</span></div>
            <div class="matrix-row"><strong>SYS</strong><span>{{ field('system', 'VALID') === '1' ? 'VALID' : 'UNKNOWN' }}</span><span>{{ field('system', 'SN') }}</span><span>不适用</span></div>
            <div class="matrix-row"><strong>ETH</strong><span>{{ field('ethernet', 'SAVED_IP') }}</span><span>{{ field('ethernet', 'RUN_IP') }}</span><span>{{ field('ethernet', 'LINK') === '1' ? 'LINK UP' : '未确认' }}</span></div>
            <div class="matrix-row"><strong>SLE</strong><span>{{ field('sle', 'VALID') === '1' ? 'VALID' : 'INVALID/未知' }}</span><span>{{ field('sle', 'READY') === '1' ? 'READY' : 'NOT READY' }}</span><span>{{ field('sle', 'CFG_APPLIED') === '1' ? 'AT ACK' : '待 AT 确认' }}</span></div>
            <div class="matrix-row"><strong>WIRELESS</strong><span>{{ field('wireless', 'SAVED') }}</span><span>{{ field('wireless', 'RUN') }}</span><span>{{ field('wireless', 'REBOOT_REQUIRED') === '1' ? '待断电复核' : '链路另验' }}</span></div>
            <div class="matrix-row"><strong>CAT1</strong><span>{{ field('cat1', 'VALID') === '1' ? 'VALID' : 'INVALID/未知' }}</span><span>PORT {{ field('cat1', 'PORT') }}</span><span>{{ field('wireless', 'CAT1_ONLINE') === '1' ? 'ONLINE' : '未确认' }}</span></div>
            <div class="matrix-row"><strong>IO</strong><span>{{ field('io', 'SAVED_ROLE') }}</span><span>{{ field('io', 'ACTIVE_ROLE') }}</span><span>RS485 HIL 另验</span></div>
          </div>
        </section>

        <section v-else-if="activeSection === 'system'" class="panel-section two-column">
          <div class="editor-card">
            <div class="section-heading compact">
              <div><span class="section-kicker">IDENTITY OWNER · EEPROM 0..11</span><h2>生产身份</h2></div>
              <button class="button small" :disabled="!maintenanceReady || maintenance.isBusy" @click="query('system')"><RefreshCw :size="13" /> 查询</button>
            </div>
            <label class="form-field"><span>12 位生产 SN</span><input v-model="snCandidate" maxlength="12" class="mono"><small>固定前缀 0203；最后四位 0001..2047</small></label>
            <button class="button danger-outline" :disabled="!maintenanceReady || maintenance.isBusy" @click="requestWrite('确认写入生产身份', '写入 EEPROM 身份区并立即更新运行身份。', () => buildIdentityCommand(snCandidate))"><Save :size="14" /> 校验并写入 SN</button>
          </div>
          <div class="snapshot-card">
            <h3>设备回读</h3>
            <dl><div><dt>SN</dt><dd class="mono">{{ field('system', 'SN') }}</dd></div><div><dt>TYPE</dt><dd>{{ field('system', 'TYPE') }}</dd></div><div><dt>ADDR</dt><dd>{{ field('system', 'ADDR') }}</dd></div><div><dt>VALID</dt><dd :class="isOne('system', 'VALID') ? 'good' : 'warn'">{{ field('system', 'VALID') }}</dd></div></dl>
            <p v-if="field('system', 'VALID', '0') !== '1'" class="warning-box">当前值可能只是固件安全 fallback，不能当作已落盘生产身份。</p>
          </div>
        </section>

        <section v-else-if="activeSection === 'ethernet'" class="panel-section two-column">
          <div class="editor-card">
            <div class="section-heading compact"><div><span class="section-kicker">NETWORK OWNER · EEPROM 48..61</span><h2>Ethernet 配置</h2></div><button class="button small" :disabled="!maintenanceReady || maintenance.isBusy" @click="query('ethernet')"><RefreshCw :size="13" /> 查询</button></div>
            <div class="form-grid">
              <label class="form-field"><span>IP 地址</span><input v-model="ethernet.ip" class="mono"></label>
              <label class="form-field"><span>子网掩码</span><input v-model="ethernet.mask" class="mono"></label>
              <label class="form-field"><span>网关</span><input v-model="ethernet.gateway" class="mono"></label>
              <label class="form-field"><span>HTTP 端口</span><input v-model="ethernet.port" class="mono" inputmode="numeric"></label>
            </div>
            <p class="info-box">按 IP → MASK → GW → PORT 逐条发送；每条等待回包并完成 SHOW 复核后再发送下一条。写入后 LwIP 不在线切换，必须重启并再次查询。</p>
            <button class="button danger-outline" :disabled="!maintenanceReady || maintenance.isBusy" @click="requestWrite('确认逐项写入 Ethernet 配置', '四个参数将拆为独立指令顺序写入；任意一条失败会立即停止。成功后仍需物理重启。', () => buildEthernetCommands(ethernet))"><Save :size="14" /> 逐项写入网络配置</button>
          </div>
          <div class="snapshot-card">
            <h3>RUN / SAVED 对照</h3>
            <div class="compare-table"><div class="compare-head"><span>字段</span><span>RUN</span><span>SAVED</span></div><div><strong>IP</strong><code>{{ field('ethernet', 'RUN_IP') }}</code><code>{{ field('ethernet', 'SAVED_IP') }}</code></div><div><strong>MASK</strong><code>{{ field('ethernet', 'RUN_MASK') }}</code><code>{{ field('ethernet', 'SAVED_MASK') }}</code></div><div><strong>GW</strong><code>{{ field('ethernet', 'RUN_GW') }}</code><code>{{ field('ethernet', 'SAVED_GW') }}</code></div><div><strong>PORT</strong><code>{{ field('ethernet', 'RUN_PORT') }}</code><code>{{ field('ethernet', 'SAVED_PORT') }}</code></div></div>
            <div class="state-banner" :class="isOne('ethernet', 'REBOOT_REQUIRED') ? 'warning' : 'success'"><AlertTriangle v-if="isOne('ethernet', 'REBOOT_REQUIRED')" :size="15" /><CheckCircle2 v-else :size="15" />{{ isOne('ethernet', 'REBOOT_REQUIRED') ? '已保存，尚未成为运行配置' : 'RUN 与 SAVED 一致' }}</div>
            <div class="network-reconnect-card">
              <strong>重启后 HTTP 复连（不扫描）</strong>
              <p>完成现场许可的重启后，工具仅访问已由 <code>@CFG,ETH,SHOW</code> 读回的一个 SAVED 地址；不会扫描 ARP、端口或其他网段。</p>
              <code class="reconnect-url">{{ savedHttpUrl || '先回读完整 SAVED Ethernet 配置' }}</code>
              <button class="button secondary" :disabled="!savedHttpUrl || httpDebug.transportState === 'connecting'" @click="reconnectHttpAtSavedAddress"><RefreshCw :size="13" :class="{ spin: httpDebug.transportState === 'connecting' }" /> 用候选地址复连并预检</button>
              <small v-if="latestNetworkRecovery">最近尝试：{{ latestNetworkRecovery.status }} · {{ latestNetworkRecovery.candidateUrl }}<template v-if="latestNetworkRecovery.error"> · {{ latestNetworkRecovery.error }}</template></small>
            </div>
            <small>LINK={{ field('ethernet', 'LINK') }} 只表示链路状态，不证明 HTTP 业务可用。</small>
          </div>
        </section>

        <section v-else-if="activeSection === 'sle'" class="panel-section two-column">
          <div class="editor-card">
            <div class="section-heading compact"><div><span class="section-kicker">SLE OWNER · EEPROM 64..95</span><h2>星闪 SLE 配置</h2></div><button class="button small" :disabled="!maintenanceReady || maintenance.isBusy" @click="query('sle')"><RefreshCw :size="13" /> 查询</button></div>
            <div class="form-grid three">
              <label class="form-field"><span>配置地址</span><input :value="KZ3_SLE_FIXED_ADDRESS" class="mono" disabled><small>KZ3 控制器固定为 0，由有效 SN 派生</small></label>
              <label class="form-field wide"><span>网络名</span><input v-model="sle.name" maxlength="16" class="mono"><small>最多 16 B 可打印 ASCII，批量 INIT 禁止逗号</small></label>
              <label class="form-field"><span>APID</span><input :value="KZ3_SLE_FIXED_APID" class="mono" disabled><small>KZ3 控制器固定为 1</small></label>
              <label class="form-field"><span>PWR</span><input v-model="sle.power" class="mono"><small>-127..20 或 127</small></label>
              <label class="form-field"><span>MAXPWR</span><input v-model="sle.maxPower" class="mono"><small>1..8</small></label>
              <label class="form-field"><span>MODE</span><input v-model="sle.mode" class="mono" disabled><small>现行仅 0</small></label>
            </div>
            <button class="button danger-outline" :disabled="!maintenanceReady || maintenance.isBusy" @click="requestWrite('确认写入星闪配置', '固件会保存本地记录并请求模组重配置；OK 不等于无线链路已可用。', () => buildSleInitCommand(sle))"><Radio :size="14" /> 写入并请求模组重配置</button>
          </div>
          <div class="snapshot-card">
            <h3>四层生效判定</h3>
            <ol class="confirmation-ladder">
              <li :class="{ done: isOne('sle', 'VALID') }"><span>1</span><div><strong>EEPROM 配置有效</strong><small>VALID={{ field('sle', 'VALID') }}</small></div></li>
              <li :class="{ done: isOne('sle', 'READY') }"><span>2</span><div><strong>模组基础就绪</strong><small>READY={{ field('sle', 'READY') }}</small></div></li>
              <li :class="{ done: isOne('sle', 'MAC_VALID') }"><span>3</span><div><strong>MAC 已确认</strong><small class="mono">{{ field('sle', 'MAC') }}</small></div></li>
              <li :class="{ done: isOne('sle', 'CFG_APPLIED') }"><span>4</span><div><strong>本轮 AT 参数确认</strong><small>ADDR {{ field('sle', 'AT_ADDR') }} · NAME {{ field('sle', 'AT_NAME') }} · PWR {{ field('sle', 'AT_PWR') }}</small></div></li>
            </ol>
            <div class="sle-facts"><span>实际地址 <strong>{{ field('sle', 'ADDR') }}</strong></span><span>配置地址 <strong>{{ field('sle', 'CFG_ADDR') }}</strong></span><span>APID <strong>{{ field('sle', 'APID') }}</strong></span><span>上报周期 <strong>{{ field('sle', 'RPT_SEC') }}s</strong></span></div>
          </div>
        </section>

        <section v-else-if="activeSection === 'wireless'" class="panel-section two-column">
          <div class="editor-card">
            <div class="section-heading compact"><div><span class="section-kicker">WIRELESS OWNER · EEPROM 96..127</span><h2>无线承载与报告周期</h2></div><button class="button small" :disabled="!maintenanceReady || maintenance.isBusy" @click="query('wireless')"><RefreshCw :size="13" /> 查询</button></div>
            <div class="form-grid">
              <label class="form-field"><span>下次启动无线承载</span><select v-model="wireless.mode"><option value="SLE">SLE</option><option value="CAT1">Cat.1 / MQTT</option></select><small>固件会先校验目标承载的保存记录；切换后需断电复核。</small></label>
              <label class="form-field"><span>报告周期原始值</span><input v-model="wireless.reportSeconds" class="mono" inputmode="numeric"><small>0..255；设备同时回显换算后的 REPORT_SEC。</small></label>
            </div>
            <p class="warning-box">模式切换的 OK 只证明 EEPROM 已保存。固件返回 POWER_CYCLE_REQUIRED 后，必须在安全条件下断电再上电、重新 SHOW，不能把串口软重启当作无线承载已经切换。</p>
            <div class="debug-actions"><button class="button danger-outline" :disabled="!maintenanceReady || maintenance.isBusy" @click="requestWrite('确认保存无线承载模式', '保存的无线承载在下次断电上电后才会成为 RUN。请先确认目标 SLE 或 Cat.1 记录有效。', () => buildWirelessModeCommand(wireless.mode))"><Radio :size="14" /> 保存承载模式</button><button class="button secondary" :disabled="!maintenanceReady || maintenance.isBusy" @click="requestWrite('确认更新无线报告周期', '仅更新无线公共记录；工具会在 ACK 后读取 SHOW 复核保存值。', () => buildWirelessReportCommand(wireless.reportSeconds))"><Save :size="14" /> 更新报告周期</button></div>
          </div>
          <div class="snapshot-card">
            <h3>RUN / SAVED 与链路状态</h3>
            <dl><div><dt>RUN</dt><dd>{{ field('wireless', 'RUN') }}</dd></div><div><dt>SAVED</dt><dd>{{ field('wireless', 'SAVED') }}</dd></div><div><dt>配置有效</dt><dd :class="isOne('wireless', 'VALID') ? 'good' : 'warn'">{{ field('wireless', 'VALID') }}</dd></div><div><dt>报告周期</dt><dd class="mono">{{ field('wireless', 'REPORT_SEC') }} s / RAW {{ field('wireless', 'REPORT_RAW') }}</dd></div><div><dt>Cat.1 链路</dt><dd>{{ field('wireless', 'CAT1_ONLINE') === '1' ? 'ONLINE' : '未确认' }} / STATE {{ field('wireless', 'CAT1_STATE') }}</dd></div></dl>
            <div class="state-banner" :class="isOne('wireless', 'REBOOT_REQUIRED') ? 'warning' : 'success'"><AlertTriangle v-if="isOne('wireless', 'REBOOT_REQUIRED')" :size="15" /><CheckCircle2 v-else :size="15" />{{ isOne('wireless', 'REBOOT_REQUIRED') ? '保存模式尚未成为 RUN，待断电复核' : '未报告承载切换等待状态' }}</div>
            <small>PORT=READY 仅表示无线端口资源就绪；Cat.1 ONLINE 也不证明 MQTT broker 鉴权、上报或现场链路通过。</small>
          </div>
        </section>

        <section v-else-if="activeSection === 'cat1'" class="panel-section two-column">
          <div class="editor-card">
            <div class="section-heading compact"><div><span class="section-kicker">CAT.1 / MQTT OWNER · EEPROM 128..383</span><h2>Cat.1 / MQTT 配置</h2></div><button class="button small" :disabled="!maintenanceReady || maintenance.isBusy" @click="query('cat1')"><RefreshCw :size="13" /> 查询</button></div>
            <div class="form-grid">
              <label class="form-field"><span>APN</span><input v-model="cat1.apn" class="mono" maxlength="31"><small>1..31 B 可打印 ASCII</small></label>
              <label class="form-field"><span>MQTT Host</span><input v-model="cat1.host" class="mono" maxlength="63"><small>1..63 B 可打印 ASCII</small></label>
              <label class="form-field"><span>MQTT 端口</span><input v-model="cat1.port" class="mono" inputmode="numeric"><small>1..65535</small></label>
              <label class="form-field"><span>Topic 前缀</span><input v-model="cat1.topic" class="mono" maxlength="31"><small>留空时固件按 devices 生成 Topic</small></label>
              <label class="form-field"><span>MQTT 用户名（仅新值）</span><input v-model="cat1.username" class="mono" autocomplete="off" maxlength="31"><small>SHOW 只返回 SET / EMPTY；留空不会覆盖已保存用户名。</small></label>
              <label class="form-field"><span>MQTT 密码（仅新值）</span><input v-model="cat1.password" type="password" class="mono" autocomplete="new-password" maxlength="63"><small>从不回显、不写入会话/串口日志；留空不会覆盖已保存密码。</small></label>
              <label class="form-field"><span>Keepalive（秒）</span><input v-model="cat1.keepalive" class="mono" inputmode="numeric"><small>30..1200</small></label>
              <label class="form-field"><span>QoS</span><select v-model="cat1.qos"><option value="0">0</option><option value="1">1</option></select><small>仅支持 0 或 1</small></label>
            </div>
            <p class="info-box">首次配置或需要清空凭证时使用完整 INIT；已存在有效记录时，建议“写入草稿差异”，只发送变化的非敏感字段以及明确输入的新凭证。每条命令均在 OK 后自动 SHOW 复核。</p>
            <div class="debug-actions wrap-actions"><button class="button danger-outline" :disabled="!maintenanceReady || maintenance.isBusy" @click="requestWrite('确认重建完整 Cat.1 配置', 'INIT 会替换完整 256B Cat.1 记录。输入框留空的用户名或密码将明确写为空；确认框和会话记录已脱敏。', () => buildCat1InitCommand(cat1))"><Save :size="14" /> 首次初始化 / 重建 (INIT)</button><button class="button primary" :disabled="!maintenanceReady || maintenance.isBusy" @click="requestWrite('确认写入 Cat.1 草稿差异', '设备必须已有 VALID Cat.1 记录。仅写入与 SHOW 快照不一致的字段；未输入的用户名/密码保持不变。', () => buildCat1UpdateCommands(cat1, maintenance.snapshots.cat1?.fields || {}))"><Settings2 :size="14" /> 写入草稿差异</button><button class="button secondary" :disabled="!maintenanceReady || maintenance.isBusy" @click="requestWrite('确认请求 Cat.1 重连', '仅当当前 RUN=CAT1 且保存配置有效时设备才会接受。此操作不会替代 broker 连通性或业务上报验证。', () => buildCat1ReconnectCommand())"><RefreshCw :size="14" /> 请求重连</button></div>
          </div>
          <div class="snapshot-card">
            <h3>保存记录回读</h3>
            <dl><div><dt>VALID</dt><dd :class="isOne('cat1', 'VALID') ? 'good' : 'warn'">{{ field('cat1', 'VALID') }}</dd></div><div><dt>APN</dt><dd class="mono">{{ field('cat1', 'APN') }}</dd></div><div><dt>HOST</dt><dd class="mono">{{ field('cat1', 'HOST') }}</dd></div><div><dt>PORT</dt><dd class="mono">{{ field('cat1', 'PORT') }}</dd></div><div><dt>TOPIC</dt><dd class="mono">{{ field('cat1', 'TOPIC') }}</dd></div><div><dt>KEEPALIVE / QoS</dt><dd class="mono">{{ field('cat1', 'KEEPALIVE') }} / {{ field('cat1', 'QOS') }}</dd></div><div><dt>USERNAME</dt><dd>{{ field('cat1', 'USER') }}</dd></div><div><dt>PASSWORD</dt><dd>{{ field('cat1', 'PASS') }}</dd></div></dl>
            <p class="warning-box">该产品当前 MQTT / HTTP 均为明文链路。工具只可减少误操作，不能替代隔离网络、证书、认证或密钥注入设计。</p>
          </div>
        </section>

        <section v-else-if="activeSection === 'io'" class="panel-section two-column">
          <div class="editor-card">
            <div class="section-heading compact"><div><span class="section-kicker">SYSTEM ROLE · EEPROM 528..543</span><h2>系统角色与 RS485 职责</h2></div><button class="button small" :disabled="!maintenanceReady || maintenance.isBusy" @click="query('io')"><RefreshCw :size="13" /> 查询</button></div>
            <div class="role-selector">
              <label :class="{ selected: role === 'CONTROLLER' }"><input v-model="role" type="radio" value="CONTROLLER"><Cpu :size="20" /><span><strong>CONTROLLER</strong><small>UART3/4 双 RTU 主站；运行 application 逻辑</small></span></label>
              <label :class="{ selected: role === 'RTU_SLAVE' }"><input v-model="role" type="radio" value="RTU_SLAVE"><Database :size="20" /><span><strong>RTU_SLAVE</strong><small>UART3 只读采集；UART4 本机从站；停用 application</small></span></label>
            </div>
            <label v-if="role === 'RTU_SLAVE'" class="form-field compact-input"><span>Modbus RTU 从站地址</span><input v-model="roleAddress" class="mono" inputmode="numeric"><small>1..247；不是上层项目 YAML 的自动写入项</small></label>
            <p class="warning-box">角色保存不会在线切换 UART owner。必须物理复位、重新连接并确认 ACTIVE=SAVED、两份记录 VALID、REBOOT_REQUIRED=0。</p>
            <button class="button danger-outline" :disabled="!maintenanceReady || maintenance.isBusy" @click="requestWrite('确认修改系统角色', role === 'RTU_SLAVE' ? '切换后 application/PID/下行写入不运行，UART4 成为本机 RTU 从站。' : '切换后 UART3/UART4 恢复双主站并运行 application。', () => buildRoleCommand(role, roleAddress))"><Save :size="14" /> 保存下次启动角色</button>
          </div>
          <div class="snapshot-card">
            <h3>ACTIVE / SAVED</h3>
            <div class="role-compare"><div><small>本次启动</small><strong>{{ field('io', 'ACTIVE_ROLE') }}</strong><code>ADDR {{ field('io', 'ACTIVE_ADDR') }}</code><span :class="field('io', 'ACTIVE_RECORD') === 'VALID' ? 'good' : 'warn'">{{ field('io', 'ACTIVE_RECORD') }}</span></div><ChevronRight :size="22" /><div><small>EEPROM 保存</small><strong>{{ field('io', 'SAVED_ROLE') }}</strong><code>ADDR {{ field('io', 'SAVED_ADDR') }}</code><span :class="field('io', 'RECORD') === 'VALID' ? 'good' : 'warn'">{{ field('io', 'RECORD') }}</span></div></div>
            <div class="state-banner" :class="isOne('io', 'REBOOT_REQUIRED') ? 'warning' : 'success'"><AlertTriangle v-if="isOne('io', 'REBOOT_REQUIRED')" :size="15" /><CheckCircle2 v-else :size="15" />{{ isOne('io', 'REBOOT_REQUIRED') ? '需要物理复位并重新 SHOW' : '活动角色与保存角色一致' }}</div>
            <p v-if="['INVALID', 'IO_ERROR'].includes(field('io', 'ACTIVE_RECORD'))" class="critical-box">设备处于维护安全态。IO_ERROR 不得自动写入或静默回退。</p>
          </div>
        </section>

        <section v-else-if="activeSection === 'debug'" class="panel-section two-column">
          <div class="editor-card">
            <div class="section-heading compact"><div><span class="section-kicker">DEBUG LOG OWNER · EEPROM 32..47</span><h2>UART1 调试日志</h2></div><button class="button small" :disabled="!maintenanceReady || maintenance.isBusy" @click="query('debug')"><RefreshCw :size="13" /> 查询</button></div>
            <p class="info-box">开启后输出启动、任务、SLE、RTU 与资源摘要。关闭普通 DBG 后，配置 OK/ERR 和故障 ERR 仍保留。</p>
            <div class="debug-actions"><button class="button primary" :disabled="!maintenanceReady || maintenance.isBusy" @click="requestWrite('开启调试日志', '该开关会持久化并增加 UART1 日志输出。', () => buildDebugCommand(true))"><Activity :size="14" /> 开启 DEBUG</button><button class="button secondary" :disabled="!maintenanceReady || maintenance.isBusy" @click="requestWrite('关闭调试日志', '普通 DBG 日志将停止；协议 OK/ERR 仍保留。', () => buildDebugCommand(false))"><CircleDot :size="14" /> 关闭 DEBUG</button></div>
          </div>
          <div class="snapshot-card debug-current"><h3>当前 RAM 生效值</h3><strong>{{ field('debug', 'DEBUG') === '1' ? 'DEBUG ON' : field('debug', 'DEBUG') === '0' ? 'DEBUG OFF' : 'UNKNOWN' }}</strong><small>{{ maintenance.snapshots.debug ? formatTime(maintenance.snapshots.debug.receivedAt) : '尚未查询' }}</small></div>
        </section>

        <section v-else class="panel-section session-section">
          <div class="section-heading"><div><span class="section-kicker">AUDIT TRAIL</span><h2>UART1 维护会话</h2><p>保留命令、原始协议行、结果与时间；写超时不会自动重试。</p></div><div class="heading-actions"><button class="button secondary" @click="exportSession"><Download :size="14" /> 导出 JSON</button><button class="button ghost-danger" :disabled="maintenance.records.length === 0" @click="maintenance.clearSession"><Trash2 :size="14" /> 清空</button></div></div>
          <div class="session-table"><div class="session-head"><span>时间</span><span>类型</span><span>命令</span><span>最终协议回包</span><span>结果</span></div><div v-for="record in [...maintenance.records].reverse()" :key="record.id" class="session-row"><time>{{ formatTime(record.completedAt) }}</time><span>{{ { query: '查询', write: '写入', follow_up_query: '写后复核' }[record.operation] }}</span><code>{{ record.command }}</code><code :title="record.rawLines.join('\n')">{{ record.protocolLine || record.error || '无协议回包' }}</code><strong :class="record.status === 'ok' ? 'good' : 'warn'">{{ record.status }}</strong></div><div v-if="maintenance.records.length === 0" class="empty-state"><FileClock :size="28" /><span>本次会话还没有命令记录</span></div></div>
        </section>
      </main>

      <aside class="live-rail">
        <div class="rail-title"><Activity :size="15" /><strong>实时事务</strong></div>
        <div class="rail-metric"><span>状态</span><strong>{{ statusText }}</strong></div>
        <div class="rail-metric"><span>当前命令</span><code>{{ maintenance.currentCommand || 'IDLE' }}</code></div>
        <div class="rail-metric"><span>RX / TX</span><code>{{ serial.rxBytes }} / {{ serial.txBytes }} B</code></div>
        <div v-if="maintenance.lastError" class="rail-error"><AlertTriangle :size="14" />{{ maintenance.lastError }}</div>
        <div class="raw-feed"><div class="raw-title">最近 UART 行</div><div v-for="line in serial.logs.slice(-12).reverse()" :key="line.id" class="raw-line" :class="line.direction"><time>{{ line.timestamp }}</time><span>{{ line.direction.toUpperCase() }}</span><code>{{ line.text }}</code></div><div v-if="serial.logs.length === 0" class="raw-empty">等待串口数据</div></div>
      </aside>
    </div>

    <ConfirmModal
      :visible="Boolean(confirmAction)"
      :title="confirmAction?.title || ''"
      :message="confirmAction?.message || ''"
      danger-level="high"
      confirm-text="确认发送"
      @confirm="confirmWrite"
      @cancel="confirmAction = null"
    />
  </div>
</template>

<style scoped>
.maintenance-page { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px; overflow: hidden; background: #edf1f4; color: #17212b; }
.page-header { min-height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 14px; background: #fff; border: 1px solid #b9c5cf; border-radius: 7px; box-shadow: 0 2px 6px rgba(27,45,58,.07); }
.title-block, .header-actions, .section-heading, .heading-actions { display: flex; align-items: center; }
.title-block { gap: 11px; min-width: 0; }
.title-mark { width: 40px; height: 40px; display: grid; place-items: center; color: #fff; background: #174d6b; border-radius: 5px; box-shadow: inset 0 -2px 0 rgba(0,0,0,.18); }
.eyebrow, .section-kicker { color: #557080; font: 700 9px/1.2 var(--font-mono); letter-spacing: .11em; }
h1, h2, h3, p { margin: 0; }
h1 { margin-top: 2px; font-size: 18px; line-height: 1.2; }
.title-block p, .section-heading p { margin-top: 3px; color: #516675; font-size: 11px; }
.header-actions, .heading-actions { gap: 7px; }
.header-actions { flex: 0 0 auto; }
.header-actions .shared-serial-status,
.header-actions .button {
  box-sizing: border-box;
  height: 36px;
  min-height: 36px;
}
.header-actions .button.danger-outline { margin-top: 0; }
.shared-serial-status { min-width: 190px; display: flex; align-items: center; gap: 8px; padding: 5px 9px; border: 1px solid #c8d2d9; border-radius: 4px; background: #f7f9fa; }
.shared-serial-status > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.shared-serial-status strong { color: #40515f; font-size: 10px; }
.shared-serial-status small { max-width: 210px; overflow: hidden; color: #71838e; font: 9px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.shared-serial-status.online { border-color: #9bcbb0; background: #edf8f2; }
.shared-serial-status.online strong { color: #176b45; }
.shared-serial-status.online .pulse-dot { background: #198257; box-shadow: 0 0 0 4px rgba(25,130,87,.13); }
.shared-serial-status.warning { border-color: #ddb979; background: #fff4df; }
.shared-serial-status.warning strong { color: #805016; }
.shared-serial-status.warning .pulse-dot { background: #c17a1c; box-shadow: 0 0 0 4px rgba(193,122,28,.14); }
.button { min-height: 30px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 5px 11px; border: 1px solid #aebcc7; border-radius: 4px; background: #f7f9fa; color: #284354; cursor: pointer; font-size: 11px; font-weight: 700; }
.button:hover:not(:disabled) { border-color: #6e94ad; background: #edf4f8; }
.button:disabled { opacity: .48; cursor: not-allowed; }
.button.primary { background: #1769aa; border-color: #1769aa; color: #fff; }
.button.small { min-height: 26px; padding: 3px 8px; }
.button.danger-outline { margin-top: 12px; border-color: #c47b48; color: #8a4a1f; background: #fff9f3; }
.button.ghost-danger { color: #a12d34; border-color: transparent; background: transparent; }
.pulse-dot { width: 9px; height: 9px; border-radius: 50%; background: #748896; box-shadow: 0 0 0 4px rgba(116,136,150,.12); }
select, input { min-height: 30px; border: 1px solid #aebcc7; border-radius: 4px; background: #fff; padding: 5px 8px; color: #17212b; font-size: 11px; }
.page-message { min-height: 30px; display: flex; align-items: center; gap: 7px; padding: 6px 10px; color: #176b45; background: #edf8f2; border: 1px solid #9bcbb0; border-radius: 4px; font-size: 11px; }
.page-message.error { color: #942a32; background: #fff1f2; border-color: #d99ba0; }
.workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: 178px minmax(0,1fr) 238px; gap: 8px; }
.section-nav, .content-panel, .live-rail { min-height: 0; background: #fff; border: 1px solid #b9c5cf; border-radius: 6px; overflow: hidden; }
.section-nav { padding: 7px; overflow-y: auto; }
.section-item { width: 100%; min-height: 46px; display: grid; grid-template-columns: 20px 1fr 14px; align-items: center; gap: 7px; margin-bottom: 3px; padding: 6px 7px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: #385260; text-align: left; cursor: pointer; }
.section-item:hover { background: #f0f4f7; }
.section-item.active { color: #0f5f9e; background: #e7f1fa; border-color: #a8c7de; box-shadow: inset 2px 0 #1769aa; }
.section-item span { min-width: 0; display: flex; flex-direction: column; }
.section-item strong { font-size: 11px; }
.section-item small { margin-top: 2px; overflow: hidden; color: #70828e; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.boundary-card { margin-top: 10px; padding: 9px; color: #704713; background: #fff8ea; border: 1px solid #dfc38f; border-radius: 4px; }
.boundary-card strong { display: block; margin-top: 5px; font-size: 10px; }
.boundary-card p { margin-top: 4px; font-size: 9px; line-height: 1.5; }
.content-panel { overflow-y: auto; }
.panel-section { min-height: 100%; padding: 14px; }
.section-heading { justify-content: space-between; gap: 14px; margin-bottom: 13px; }
.section-heading.compact { margin-bottom: 12px; }
.section-heading h2 { margin-top: 3px; font-size: 15px; }
.stale-badge { padding: 3px 7px; color: #8a4a1f; background: #fff4e8; border: 1px solid #dcaa76; border-radius: 12px; font-size: 9px; font-weight: 700; }
.summary-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px; }
.summary-card { min-height: 112px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 11px; border: 1px solid #c6d0d8; border-radius: 5px; background: linear-gradient(145deg,#fff,#f5f8fa); color: #17212b; text-align: left; cursor: pointer; box-shadow: 0 1px 2px rgba(27,45,58,.05); }
.summary-card:hover { border-color: #83aac4; transform: translateY(-1px); }
.card-top { width: 100%; display: flex; align-items: center; gap: 7px; color: #486675; font-size: 10px; font-weight: 700; }
.summary-card > strong { max-width: 100%; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.summary-card small { margin-top: auto; font-size: 9px; }
.good { color: #176b45 !important; }
.warn { color: #9a5815 !important; }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.status-matrix { margin-top: 14px; border: 1px solid #c6d0d8; border-radius: 5px; overflow: hidden; }
.matrix-title { padding: 8px 10px; color: #26495d; background: #eef4f7; border-bottom: 1px solid #c6d0d8; font-size: 11px; font-weight: 800; }
.matrix-row { display: grid; grid-template-columns: .6fr 1fr 1fr 1fr; min-height: 34px; align-items: center; border-bottom: 1px solid #e0e6ea; }
.matrix-row:last-child { border-bottom: 0; }
.matrix-row > * { min-width: 0; padding: 6px 10px; overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.matrix-header { color: #617581; background: #fafbfc; font-size: 9px; font-weight: 700; }
.two-column { display: grid; grid-template-columns: minmax(0,1.35fr) minmax(280px,.85fr); gap: 12px; align-content: start; }
.editor-card, .snapshot-card { padding: 13px; border: 1px solid #c6d0d8; border-radius: 5px; background: #fff; }
.snapshot-card { background: #f8fafb; }
.snapshot-card h3 { margin-bottom: 12px; color: #294b5e; font-size: 12px; }
.form-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 9px; }
.form-field span { font-size: 10px; font-weight: 750; }
.form-field small { color: #687c88; font-size: 9px; }
.form-field input { width: 100%; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; }
.form-grid.three { grid-template-columns: repeat(3,1fr); }
.form-grid .wide { grid-column: span 2; }
.info-box, .warning-box, .critical-box { padding: 8px 9px; border-radius: 4px; font-size: 10px; line-height: 1.55; }
.info-box { color: #28536a; background: #edf6fb; border: 1px solid #b9d7e7; }
.warning-box { color: #7a4b13; background: #fff8e9; border: 1px solid #dfc38f; }
.critical-box { color: #942a32; background: #fff0f1; border: 1px solid #d99ba0; }
dl { margin: 0; }
dl div { min-height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid #dce3e7; }
dt { color: #657986; font-size: 9px; font-weight: 700; }
dd { margin: 0; font-size: 11px; font-weight: 700; }
.compare-table > div { display: grid; grid-template-columns: .55fr 1.2fr 1.2fr; gap: 6px; align-items: center; min-height: 30px; border-bottom: 1px solid #dce3e7; }
.compare-table strong, .compare-table code { min-width: 0; overflow: hidden; font-size: 9px; text-overflow: ellipsis; }
.compare-head { color: #647885; font-size: 9px; font-weight: 700; }
.state-banner { display: flex; align-items: center; gap: 7px; margin: 12px 0 7px; padding: 8px; border-radius: 4px; font-size: 10px; font-weight: 800; }
.state-banner.warning { color: #805016; background: #fff4df; border: 1px solid #ddb979; }
.state-banner.success { color: #176b45; background: #edf8f2; border: 1px solid #9bcbb0; }
.network-reconnect-card { display: flex; flex-direction: column; gap: 7px; margin: 10px 0; padding: 9px; border: 1px solid #b8cad7; border-left: 3px solid #2879a8; border-radius: 4px; background: #f1f7fb; }
.network-reconnect-card > strong { color: #204d68; font-size: 10px; }
.network-reconnect-card p, .network-reconnect-card small { margin: 0; color: #526b7a; font-size: 9px; line-height: 1.5; }
.network-reconnect-card code { font-family: var(--font-mono); }
.reconnect-url { overflow: hidden; padding: 5px 6px; color: #174d6b; background: #fff; border: 1px solid #d1dde5; border-radius: 3px; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; user-select: text; }
.network-reconnect-card .button { align-self: flex-start; }
.confirmation-ladder { margin: 0; padding: 0; list-style: none; }
.confirmation-ladder li { display: grid; grid-template-columns: 26px 1fr; gap: 8px; align-items: center; min-height: 48px; position: relative; color: #6c7e89; }
.confirmation-ladder li > span { width: 24px; height: 24px; display: grid; place-items: center; z-index: 1; border: 2px solid #b8c4cb; border-radius: 50%; background: #f8fafb; font: 800 9px var(--font-mono); }
.confirmation-ladder li:not(:last-child)::after { content: ''; position: absolute; top: 34px; bottom: -10px; left: 11px; width: 2px; background: #d5dde4; }
.confirmation-ladder li.done { color: #176b45; }
.confirmation-ladder li.done > span { border-color: #3a956e; background: #e8f6ef; }
.confirmation-ladder div { display: flex; flex-direction: column; gap: 2px; }
.confirmation-ladder strong { font-size: 10px; }
.confirmation-ladder small { font-size: 9px; }
.sle-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 10px; }
.sle-facts span { padding: 6px; background: #fff; border: 1px solid #d3dce2; border-radius: 3px; font-size: 9px; }
.role-selector { display: grid; gap: 7px; }
.role-selector label { min-height: 58px; display: grid; grid-template-columns: 14px 24px 1fr; align-items: center; gap: 8px; padding: 8px; border: 1px solid #c6d0d8; border-radius: 4px; cursor: pointer; }
.role-selector label.selected { color: #0f5f9e; background: #eef6fb; border-color: #80afd0; box-shadow: inset 3px 0 #1769aa; }
.role-selector label span { display: flex; flex-direction: column; gap: 3px; }
.role-selector small { color: #617582; font-size: 9px; }
.compact-input { max-width: 260px; margin-top: 10px; }
.role-compare { display: grid; grid-template-columns: 1fr 24px 1fr; align-items: center; gap: 6px; }
.role-compare > div { min-height: 118px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; background: #fff; border: 1px solid #d3dce2; border-radius: 4px; }
.role-compare small { color: #6b7e89; font-size: 9px; }
.role-compare strong { font-size: 12px; }
.role-compare code { font-size: 9px; }
.debug-actions { display: flex; gap: 8px; margin-top: 13px; }
.debug-actions.wrap-actions { flex-wrap: wrap; }
.debug-current { min-height: 180px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.debug-current strong { color: #174d6b; font: 800 23px var(--font-mono); }
.debug-current small { margin-top: 7px; color: #687c88; font-size: 9px; }
.session-section { min-width: 720px; }
.session-table { border: 1px solid #c6d0d8; border-radius: 4px; overflow: hidden; }
.session-head, .session-row { display: grid; grid-template-columns: 130px 70px minmax(170px,.85fr) minmax(220px,1.3fr) 85px; gap: 7px; align-items: center; min-height: 34px; padding: 5px 8px; border-bottom: 1px solid #e0e6ea; }
.session-head { color: #657986; background: #f1f5f7; font-size: 9px; font-weight: 800; }
.session-row { font-size: 9px; }
.session-row code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty-state { min-height: 180px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #748792; font-size: 10px; }
.live-rail { display: flex; flex-direction: column; padding: 9px; overflow: hidden; background: #f8fafb; }
.rail-title { display: flex; align-items: center; gap: 6px; padding: 2px 3px 9px; color: #294b5e; font-size: 11px; border-bottom: 1px solid #d2dbe1; }
.rail-metric { display: flex; flex-direction: column; gap: 4px; padding: 8px 3px; border-bottom: 1px solid #e0e6ea; }
.rail-metric span { color: #6a7e8a; font-size: 9px; }
.rail-metric strong, .rail-metric code { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.rail-error { display: flex; gap: 5px; margin-top: 7px; padding: 7px; color: #942a32; background: #fff0f1; border: 1px solid #d99ba0; border-radius: 4px; font-size: 9px; }
.raw-feed { flex: 1; min-height: 0; margin-top: 9px; overflow-y: auto; background: #172a35; border: 1px solid #0f212b; border-radius: 4px; }
.raw-title { position: sticky; top: 0; z-index: 1; padding: 6px 7px; color: #b5c8d2; background: #203945; border-bottom: 1px solid #36505c; font: 800 8px var(--font-mono); letter-spacing: .08em; }
.raw-line { display: grid; grid-template-columns: 52px 19px 1fr; gap: 4px; padding: 4px 6px; color: #c8d7de; border-bottom: 1px solid rgba(255,255,255,.05); font: 8px var(--font-mono); }
.raw-line.tx { color: #8fd6b5; }
.raw-line time, .raw-line > span { color: #7895a4; }
.raw-line code { overflow-wrap: anywhere; }
.raw-empty { padding: 20px 8px; color: #6f8996; font: 9px var(--font-mono); text-align: center; }
.spin { animation: spin .9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1250px) { .workspace { grid-template-columns: 164px minmax(0,1fr); } .live-rail { display: none; } .summary-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 900px) { .shared-serial-status { min-width: 0; } .shared-serial-status small { display: none; } .workspace { grid-template-columns: 52px minmax(0,1fr); } .section-item { grid-template-columns: 24px; justify-content: center; } .section-item span, .section-item > :last-child, .boundary-card { display: none; } .two-column { grid-template-columns: 1fr; } }

/* Field Quick Toolbar & LED Self-Check */
.field-toolbar-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
}

.field-toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.toolbar-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  color: #334155;
}

.toolbar-btn {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-btn.led-grn {
  background: #dcfce7;
  color: #15803d;
  border-color: #86efac;
}
.toolbar-btn.led-grn:hover:not(:disabled) {
  background: #bbf7d0;
}

.toolbar-btn.led-red {
  background: #fee2e2;
  color: #b91c1c;
  border-color: #fca5a5;
}
.toolbar-btn.led-red:hover:not(:disabled) {
  background: #fecaca;
}

.toolbar-btn.led-off {
  background: #f8fafc;
  color: #64748b;
  border-color: #cbd5e1;
}
.toolbar-btn.led-off:hover:not(:disabled) {
  background: #e2e8f0;
}

.toolbar-chip {
  font-family: monospace;
  font-size: 0.68rem;
  font-weight: 600;
  background: #ffffff;
  color: #0369a1;
  border: 1px solid #bae6fd;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
}
.toolbar-chip:hover:not(:disabled) {
  background: #e0f2fe;
  border-color: #7dd3fc;
}
.toolbar-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.custom-cmd-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.custom-cmd-input {
  flex: 1;
  font-size: 0.74rem;
  padding: 4px 8px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  outline: none;
}
.custom-cmd-input:focus {
  border-color: #0284c7;
}

.button.danger-outline {
  color: #b91c1c;
  background: #fff;
  border: 1px solid #f87171;
}
.button.danger-outline:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #dc2626;
}
</style>
