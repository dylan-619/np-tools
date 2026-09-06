<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import {
  Wifi,
  RefreshCw,
  Sliders,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Zap,
  Download,
  Upload,
  Radio,
  Eye,
  EyeOff,
  Sparkles,
  Activity,
  FileText,
  Trash2,
  PlayCircle,
  TableProperties,
  ArrowDownLeft,
  Info,
  X,
  AlertTriangle
} from 'lucide-vue-next'
import { useSjzdStore } from '../../../stores/sjzdStore'
import { useSerialStore } from '../../../stores/serialStore'
import type { FourGConfigDto, WirelessMode } from '../../../types/sjzd'
import { appSaveFile, appOpenFile } from '../../../api/sjzdApi'
import ConfirmModal from '../../../components/common/ConfirmModal.vue'

const sjzd = useSjzdStore()
const serial = useSerialStore()

// Active sub-tab
type ActiveTab = 'params' | 'wizard' | 'logs'
const activeTab = ref<ActiveTab>('params')

// Form editing state (decoupled from store for user drafting before saving)
const form = ref<FourGConfigDto>({
  apn: 'cmiot',
  host: '',
  port: 1883,
  clientId: '',
  username: '',
  password: '',
  publishTopic: '',
  subscribeTopic: '',
  keepAliveSec: 60,
  qos: 1
})
const mcuConsoleReady = computed(
  () => Boolean(sjzd.wlanBridgeStatus && !sjzd.wlanBridgeStatus.active)
)

// Sync form from store whenever store updates or initially loads
function syncFormFromStore() {
  if (!sjzd.fourGStatus.hasReadback) {
    sjzd.showMessage('尚未获取设备完整快照，请先点击右上角【查询配置】', false)
    return
  }
  form.value = {
    apn: sjzd.fourGConfig.apn || 'cmiot',
    host: sjzd.fourGConfig.host || '',
    port: sjzd.fourGConfig.port || 1883,
    clientId: sjzd.fourGConfig.clientId || sjzd.deviceInfo?.sn || '',
    username: sjzd.fourGConfig.username || '',
    password: sjzd.fourGConfig.password || '',
    publishTopic: sjzd.fourGConfig.publishTopic || '',
    subscribeTopic: sjzd.fourGConfig.subscribeTopic || '',
    keepAliveSec: sjzd.fourGConfig.keepAliveSec || 60,
    qos: sjzd.fourGConfig.qos ?? 1
  }
  sjzd.showMessage('已从通过 transaction ID、count 和 CRC32 校验的 4G_CONFIG 完整快照同步至表单')
}

// Password visibility toggle
const showPassword = ref(false)

// Single item copy from readback to form
function copyReadbackToDraft(field: keyof FourGConfigDto) {
  if (!sjzd.fourGStatus.hasReadback) {
    sjzd.showMessage('尚未获取完整快照，无法复制该项', false)
    return
  }
  if (field === 'apn') form.value.apn = sjzd.fourGConfig.apn || 'cmiot'
  else if (field === 'host') form.value.host = sjzd.fourGConfig.host || ''
  else if (field === 'port') form.value.port = sjzd.fourGConfig.port || 1883
  else if (field === 'clientId') form.value.clientId = sjzd.fourGConfig.clientId || ''
  else if (field === 'username') form.value.username = sjzd.fourGConfig.username || ''
  else if (field === 'password') form.value.password = sjzd.fourGConfig.password || ''
  else if (field === 'publishTopic') form.value.publishTopic = sjzd.fourGConfig.publishTopic || ''
  else if (field === 'subscribeTopic') form.value.subscribeTopic = sjzd.fourGConfig.subscribeTopic || ''
  else if (field === 'keepAliveSec') form.value.keepAliveSec = sjzd.fourGConfig.keepAliveSec || 60
  else if (field === 'qos') form.value.qos = sjzd.fourGConfig.qos ?? 1
  sjzd.showMessage('已将完整快照字段同步至表单')
}

// Readback table rows definition for reactive display
const readbackRows = computed(() => {
  const isRead = sjzd.fourGStatus.hasReadback
  return [
    {
      name: '4G 接入点 APN',
      cmd: '4G_APN',
      readback: !isRead ? '--' : (sjzd.fourGConfig.apn || '(未设置/默认 cmiot)'),
      draft: form.value.apn || 'cmiot',
      isDiff: Boolean(isRead && (form.value.apn || 'cmiot') !== (sjzd.fourGConfig.apn || 'cmiot')),
      field: 'apn' as keyof FourGConfigDto,
      isPass: false
    },
    {
      name: 'Broker 主机',
      cmd: 'MQTT_HOST',
      readback: !isRead ? '--' : (sjzd.fourGConfig.host || '(未配置/空)'),
      draft: form.value.host || '(未填写)',
      isDiff: Boolean(isRead && form.value.host !== sjzd.fourGConfig.host),
      field: 'host' as keyof FourGConfigDto,
      isPass: false
    },
    {
      name: 'Broker 端口',
      cmd: 'MQTT_PORT',
      readback: !isRead ? '--' : (sjzd.fourGConfig.port > 0 ? String(sjzd.fourGConfig.port) : '(未配置)'),
      draft: form.value.port ? String(form.value.port) : '--',
      isDiff: Boolean(isRead && Number(form.value.port) !== Number(sjzd.fourGConfig.port)),
      field: 'port' as keyof FourGConfigDto,
      isPass: false
    },
    {
      name: 'Client ID',
      cmd: 'MQTT_CLIENT',
      readback: !isRead ? '--' : (sjzd.fourGConfig.clientId || '(未配置)'),
      draft: form.value.clientId || '(未填写)',
      isDiff: Boolean(isRead && form.value.clientId !== sjzd.fourGConfig.clientId),
      field: 'clientId' as keyof FourGConfigDto,
      isPass: false
    },
    {
      name: '认证用户名',
      cmd: 'MQTT_USER',
      readback: !isRead ? '--' : (sjzd.fourGConfig.username || '(无)'),
      draft: form.value.username || '(无)',
      isDiff: Boolean(isRead && form.value.username !== sjzd.fourGConfig.username),
      field: 'username' as keyof FourGConfigDto,
      isPass: false
    },
    {
      name: '认证密码',
      cmd: 'MQTT_PASS',
      readback: !isRead
        ? '--'
        : sjzd.fourGStatus.passwordIsSet
          ? showPassword.value && sjzd.fourGConfig.password
            ? sjzd.fourGConfig.password
            : '●●●●●● (已安全设置)'
          : '(未设置/空)',
      draft: form.value.password
        ? showPassword.value
          ? form.value.password
          : '••••••••'
        : sjzd.fourGStatus.passwordIsSet
          ? '保持原密码 (<set>)'
          : '(空)',
      isDiff: Boolean(form.value.password),
      field: 'password' as keyof FourGConfigDto,
      isPass: true
    },
    {
      name: '上行发布主题',
      cmd: 'MQTT_PUB_TOPIC',
      readback: !isRead ? '--' : (sjzd.fourGConfig.publishTopic || '(未配置)'),
      draft: form.value.publishTopic || '(未填写)',
      isDiff: Boolean(isRead && form.value.publishTopic !== sjzd.fourGConfig.publishTopic),
      field: 'publishTopic' as keyof FourGConfigDto,
      isPass: false
    },
    {
      name: '下行订阅主题',
      cmd: 'MQTT_SUB_TOPIC',
      readback: !isRead ? '--' : (sjzd.fourGConfig.subscribeTopic || '(未配置)'),
      draft: form.value.subscribeTopic || '(未填写)',
      isDiff: Boolean(isRead && form.value.subscribeTopic !== sjzd.fourGConfig.subscribeTopic),
      field: 'subscribeTopic' as keyof FourGConfigDto,
      isPass: false
    },
    {
      name: '保活心跳周期',
      cmd: 'MQTT_KEEPALIVE',
      readback: !isRead ? '--' : (sjzd.fourGConfig.keepAliveSec > 0 ? `${sjzd.fourGConfig.keepAliveSec}s` : '--'),
      draft: form.value.keepAliveSec ? `${form.value.keepAliveSec}s` : '--',
      isDiff: Boolean(isRead && Number(form.value.keepAliveSec) !== Number(sjzd.fourGConfig.keepAliveSec)),
      field: 'keepAliveSec' as keyof FourGConfigDto,
      isPass: false
    },
    {
      name: '服务质量等级',
      cmd: 'MQTT_QOS',
      readback: !isRead ? '--' : (sjzd.fourGConfig.qos !== undefined && sjzd.fourGConfig.qos >= 0 ? `QoS ${sjzd.fourGConfig.qos}` : '--'),
      draft: form.value.qos !== undefined ? `QoS ${form.value.qos}` : '--',
      isDiff: Boolean(isRead && Number(form.value.qos) !== Number(sjzd.fourGConfig.qos)),
      field: 'qos' as keyof FourGConfigDto,
      isPass: false
    }
  ]
})

watch(
  () => [sjzd.fourGConfig, sjzd.fourGStatus.hasReadback],
  ([cfg, hasRead]) => {
    if (!hasRead) return
    const c = cfg as FourGConfigDto
    if (c.apn !== undefined) form.value.apn = c.apn || 'cmiot'
    if (c.host !== undefined) form.value.host = c.host || ''
    if (c.port !== undefined && c.port > 0) form.value.port = c.port
    if (c.clientId !== undefined) form.value.clientId = c.clientId || ''
    if (c.username !== undefined) form.value.username = c.username || ''
    if (c.publishTopic !== undefined) form.value.publishTopic = c.publishTopic || ''
    if (c.subscribeTopic !== undefined) form.value.subscribeTopic = c.subscribeTopic || ''
    if (c.keepAliveSec !== undefined && c.keepAliveSec > 0) form.value.keepAliveSec = c.keepAliveSec
    if (c.qos !== undefined && c.qos >= 0) form.value.qos = c.qos
    if (c.password !== undefined) form.value.password = c.password || ''
  },
  { deep: true }
)

// Modals
const showResetModal = ref(false)
const showModeSwitchModal = ref(false)
const showTipsModal = ref(false)
const targetSwitchMode = ref<WirelessMode>('4G')

// Wizard State
const wizardSnInput = ref('')
const wizardStep = ref<number>(1)
const wizardExecuting = ref(false)
const wizardLog = ref<string[]>([])

function addWizardLog(msg: string) {
  const t = new Date().toLocaleTimeString()
  wizardLog.value.push(`[${t}] ${msg}`)
}

// Log viewer
const logFilter = ref<'all' | 'info' | 'warn' | 'error' | 'success'>('all')
const autoScroll = ref(true)
const logContainerRef = ref<HTMLElement | null>(null)

const filteredLogs = computed(() => {
  if (logFilter.value === 'all') return sjzd.fourGLogs
  return sjzd.fourGLogs.filter((l) => l.level === logFilter.value)
})

watch(
  () => filteredLogs.value.length,
  async () => {
    if (autoScroll.value) {
      await nextTick()
      if (logContainerRef.value) {
        logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight
      }
    }
  }
)

function clearLogs() {
  sjzd.fourGLogs.length = 0
  sjzd.showMessage('已清空 4G 诊断日志')
}

async function exportLogs() {
  if (sjzd.fourGLogs.length === 0) {
    sjzd.showMessage('当前没有日志可导出', false)
    return
  }
  const content = sjzd.fourGLogs.map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.text}`).join('\n')
  const defaultName = `4G_MQTT_Log_${Date.now()}.txt`
  const saved = await appSaveFile(defaultName, content, '文本日志 (*.txt)', 'txt')
  if (saved) {
    sjzd.showMessage(`日志已成功导出至: ${saved}`)
  } else {
    // Fallback
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    sjzd.showMessage('已导出日志文件')
  }
}

// Auto generate topics from SN
function handleAutoGenerateTopics() {
  const sn = (form.value.clientId || sjzd.deviceInfo?.sn || '').trim()
  if (!sn) {
    sjzd.showMessage('未检测到有效的 SN / Client ID，请先在上方输入或查询设备', false)
    return
  }
  form.value.clientId = sn
  form.value.publishTopic = `devices/${sn}/up`
  form.value.subscribeTopic = `devices/${sn}/down`
  sjzd.showMessage(`已根据 SN [${sn}] 自动推导 Client ID 与 Pub/Sub 主题`)
}

// Template Export (Strictly exclude password for security!)
async function exportTemplateJson() {
  const exportData = {
    version: 1,
    exportTime: new Date().toISOString(),
    config: {
      apn: form.value.apn,
      host: form.value.host,
      port: form.value.port,
      clientId: form.value.clientId,
      username: form.value.username,
      publishTopic: form.value.publishTopic,
      subscribeTopic: form.value.subscribeTopic,
      keepAliveSec: form.value.keepAliveSec,
      qos: form.value.qos
    }
  }
  const content = JSON.stringify(exportData, null, 2)
  const defaultName = `4G_MQTT_Template_${form.value.clientId || 'config'}.json`
  const saved = await appSaveFile(defaultName, content, 'JSON 配置模板 (*.json)', 'json')
  if (saved) {
    sjzd.showMessage(`4G 配置模板已导出至: ${saved} (认证密码已安全脱敏)`)
  } else {
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    sjzd.showMessage('4G 配置模板已导出 (密码已脱敏)')
  }
}

// Template Import
const fileInputRef = ref<HTMLInputElement | null>(null)
async function triggerImportTemplate() {
  const fileRes = await appOpenFile('4G 配置模板 (*.json)', ['json'])
  if (fileRes) {
    parseTemplateContent(fileRes.content)
    return
  }
  if (fileInputRef.value) {
    fileInputRef.value.click()
  }
}

function handleFileImport(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    const text = ev.target?.result as string
    if (text) {
      parseTemplateContent(text)
    }
    target.value = ''
  }
  reader.readAsText(file)
}

function parseTemplateContent(raw: string) {
  try {
    const data = JSON.parse(raw)
    const cfg = data.config || data
    if (cfg.host) form.value.host = cfg.host
    if (cfg.port) form.value.port = Number(cfg.port)
    if (cfg.apn !== undefined) form.value.apn = cfg.apn
    if (cfg.clientId) form.value.clientId = cfg.clientId
    if (cfg.username !== undefined) form.value.username = cfg.username
    if (cfg.publishTopic) form.value.publishTopic = cfg.publishTopic
    if (cfg.subscribeTopic) form.value.subscribeTopic = cfg.subscribeTopic
    if (cfg.keepAliveSec) form.value.keepAliveSec = Number(cfg.keepAliveSec)
    if (cfg.qos !== undefined) form.value.qos = Number(cfg.qos)
    sjzd.showMessage('已成功导入 4G/MQTT 模板参数')
  } catch (err: any) {
    sjzd.showMessage(`导入模板解析失败: ${err.message || err}`, false)
  }
}

// Batch save
async function handleBatchSave() {
  if (!form.value.host) {
    sjzd.showMessage('MQTT Broker 主机地址不能为空', false)
    return
  }
  if (!form.value.port || form.value.port <= 0 || form.value.port > 65535) {
    sjzd.showMessage('MQTT 端口号必须在 1 ~ 65535 之间', false)
    return
  }
  if (!form.value.clientId) {
    sjzd.showMessage('MQTT Client ID 不能为空 (推荐为设备 12 位 SN)', false)
    return
  }
  await sjzd.saveAllFourGParams({
    apn: form.value.apn,
    host: form.value.host,
    port: form.value.port,
    clientId: form.value.clientId,
    username: form.value.username,
    password: form.value.password,
    publishTopic: form.value.publishTopic,
    subscribeTopic: form.value.subscribeTopic,
    keepAliveSec: form.value.keepAliveSec,
    qos: form.value.qos
  })
}

// Wireless Mode Switch logic
function promptModeSwitch(targetMode: WirelessMode) {
  if (targetMode === sjzd.wlanTypeInfo.mode) {
    sjzd.showMessage(`当前设备已处于 ${targetMode} 模式`, false)
    return
  }
  if (targetMode === '4G') {
    if (!form.value.host || !form.value.port || !form.value.clientId) {
      sjzd.showMessage('切换 4G 模式前，必须先填写并保存 MQTT Broker 及 ClientID！', false)
      return
    }
  }
  targetSwitchMode.value = targetMode
  showModeSwitchModal.value = true
}

async function confirmModeSwitch() {
  showModeSwitchModal.value = false
  await sjzd.setWirelessMode(targetSwitchMode.value)
}

// Clear 4G EEPROM config
function promptResetConfig() {
  if (sjzd.wlanTypeInfo.mode === '4G') {
    sjzd.showMessage('清除 4G 配置必须在 SLE 模式下执行，以防止模组运行异常！', false)
    return
  }
  showResetModal.value = true
}

async function confirmResetConfig() {
  showResetModal.value = false
  await sjzd.resetFourGConfig()
  syncFormFromStore()
}

// Provisioning Wizard execution
async function startWizard() {
  wizardExecuting.value = true
  wizardStep.value = 1
  wizardLog.value = []
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  try {
    addWizardLog('=== 开始按 SN 快速开通向导 ===')
    const bridge = await sjzd.queryWlanBridge()
    if (!bridge || bridge.active) {
      throw new Error('UART1 当前处于透传或状态未确认，不能执行 MCU 侧 4G 配置向导；请先退出透传')
    }
    // Step 1: Query device info
    addWizardLog('第 1 步: 读取终端基础信息与 SN...')
    await sjzd.queryDeviceInfo()
    await delay(600)
    const sn = (wizardSnInput.value || sjzd.deviceInfo?.sn || '').trim()
    if (!sn) {
      throw new Error('未获取到设备 SN，请确认设备已连接并在上方输入或烧录 SN！')
    }
    wizardSnInput.value = sn
    addWizardLog(`成功识别设备 SN: ${sn}`)
    wizardStep.value = 2

    // Step 2: Query mode & check
    addWizardLog('第 2 步: 检查当前无线通信模式...')
    await sjzd.queryWlanType()
    await delay(400)
    addWizardLog(`当前无线模式: ${sjzd.wlanTypeInfo.mode} (UART2波特率: ${sjzd.wlanTypeInfo.uart2Baud}bps)`)
    wizardStep.value = 3

    // Step 3: Auto derive topics and form parameters
    addWizardLog('第 3 步: 自动推导 MQTT Client ID 与 Pub/Sub 主题...')
    form.value.clientId = sn
    form.value.publishTopic = `devices/${sn}/up`
    form.value.subscribeTopic = `devices/${sn}/down`
    addWizardLog(`推导完成: ClientID=${form.value.clientId}`)
    addWizardLog(`上行发布主题: ${form.value.publishTopic}`)
    addWizardLog(`下行订阅主题: ${form.value.subscribeTopic}`)
    wizardStep.value = 4

    // Step 4: Batch write parameters
    addWizardLog('第 4 步: 批量下发 4G/MQTT 参数至 EEPROM...')
    await sjzd.saveAllFourGParams({
      apn: form.value.apn,
      host: form.value.host,
      port: form.value.port,
      clientId: form.value.clientId,
      username: form.value.username,
      password: form.value.password,
      publishTopic: form.value.publishTopic,
      subscribeTopic: form.value.subscribeTopic,
      keepAliveSec: form.value.keepAliveSec,
      qos: form.value.qos
    })
    await delay(800)
    addWizardLog('4G/MQTT 参数写入完成，正在获取并校验 4G:LIST 完整快照...')
    await sjzd.queryFourGConfig()
    await delay(600)
    if (!sjzd.fourGStatus.configOperational) {
      addWizardLog('[警告] 设备返回了完整快照，但 META.config=incomplete；请按错误掩码补齐 Broker、端口或 MQTT 必填项。')
    } else {
      addWizardLog('[提示] 设备报告 Config=valid，且 4G_CONFIG transaction ID、count、CRC32 已通过校验；本次保存 revision 也已复核。')
    }
    wizardStep.value = 5

    // Step 5: Switch to 4G if in SLE
    if (sjzd.wlanTypeInfo.mode !== '4G') {
      addWizardLog('第 5 步: 切换设备至 4G Cat.1 模式 (WLAN_TYPE:4G)...')
      await sjzd.setWirelessMode('4G')
      addWizardLog('设备正在复位重启，等待 4G 模组初始化与 MQTT 上线...')
    } else {
      addWizardLog('第 5 步: 当前已处于 4G 模式，触发 4G 模组重连 (4G:RECONNECT)...')
      await sjzd.reconnectFourG()
    }
    addWizardLog('开通流程已全部下发！请在右侧“实时日志”观察上线过程。')
  } catch (err: any) {
    addWizardLog(`[向导中断失败] ${err.message || err}`)
    sjzd.showMessage(`开通向导失败: ${err.message || err}`, false)
  } finally {
    wizardExecuting.value = false
  }
}

async function refreshFourGConfiguration() {
  const bridge = await sjzd.queryWlanBridge()
  if (!bridge || bridge.active) return
  await sjzd.queryWlanType()
  await sjzd.queryFourGConfig()
  syncFormFromStore()
}

// Lifecycle
onMounted(async () => {
  if (serial.connectedPort) {
    await refreshFourGConfiguration()
  }
})
</script>

<template>
  <div class="view-container">
    <!-- Hidden File Input for template import -->
    <input
      ref="fileInputRef"
      type="file"
      accept=".json"
      style="display: none"
      @change="handleFileImport"
    />

    <!-- Header -->
    <header class="view-header">
      <div class="title-col">
        <div class="title-with-badge">
          <h2>4G Cat.1 / MQTT 通信配置与诊断</h2>
          <span
            class="mode-badge"
            :class="sjzd.wlanTypeInfo.mode === '4G' ? 'badge-4g' : 'badge-sle'"
          >
            {{ sjzd.wlanTypeInfo.mode === '4G' ? '4G Cat.1 模式' : '星闪 (SLE) 模式' }}
          </span>
        </div>
        <p class="subtitle">
          支持无线工作模式切换 (SLE / 4G)、MQTT Broker 接入点配置、按 SN 一键开通向导与 Cat.1 通信链路诊断；配置读回以结构化事务完整性校验为准。
        </p>
      </div>

      <div class="actions-col">
        <button
          class="btn btn-primary"
          :disabled="!serial.connectedPort || sjzd.isBusy"
          title="先确认 UART1 透传状态，再查询当前无线模式与完整 4G MQTT 快照"
          @click="refreshFourGConfiguration"
        >
          <RefreshCw :size="14" :class="{ spin: sjzd.isBusy }" />
          <span>查询配置 (4G:LIST)</span>
        </button>

        <button
          v-if="sjzd.wlanTypeInfo.mode === '4G'"
          class="btn btn-secondary"
          :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
          title="强制 4G 模组断开重连 (4G:RECONNECT)"
          @click="sjzd.reconnectFourG"
        >
          <Activity :size="14" />
          <span>4G 模组重连</span>
        </button>

        <button
          class="btn btn-danger"
          :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy || sjzd.wlanTypeInfo.mode === '4G'"
          :title="sjzd.wlanTypeInfo.mode === '4G' ? '清除 4G 配置前必须先切回 SLE 模式' : '清空 EEPROM 中的 4G/MQTT 参数'"
          @click="promptResetConfig"
        >
          <Trash2 :size="14" />
          <span>清除 4G 配置</span>
        </button>
      </div>
    </header>

    <div v-if="sjzd.wlanBridgeStatus?.active" class="mode-alert-banner">
      <ShieldAlert :size="18" class="banner-icon-amber" />
      <div class="banner-content">
        <strong>UART1 已确认透传到 {{ sjzd.wlanBridgeStatus.uartOwner }}。</strong>
        <span>MCU 侧 4G 查询、保存、切换与重连已被工具保护性阻止；请先在星闪页退出透传。</span>
      </div>
      <router-link to="/devices/sjzdv3/sle" class="btn btn-sm btn-outline">前往退出透传</router-link>
    </div>

    <!-- Top KPI Status Cards -->
    <div class="metrics-grid">
      <!-- Card 1: Wireless Mode -->
      <div class="metric-card">
        <div class="metric-icon" :class="sjzd.wlanTypeInfo.mode === '4G' ? 'blue' : 'purple'">
          <Wifi v-if="sjzd.wlanTypeInfo.mode === '4G'" :size="20" />
          <Radio v-else :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">当前无线通信模式</span>
          <div class="metric-value-row">
            <span class="metric-value">
              {{ sjzd.wlanTypeInfo.mode === '4G' ? '4G Cat.1 蜂窝模式' : '星闪 (SLE) 无线模式' }}
            </span>
            <span class="sub-baud-tag">
              UART2: {{ sjzd.wlanTypeInfo.uart2Baud }} bps
            </span>
          </div>
        </div>
        <button
          class="switch-mode-btn"
          :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
          :title="sjzd.wlanTypeInfo.mode === '4G' ? '切换为 SLE 星闪模式' : '切换为 4G Cat.1 模式'"
          @click="promptModeSwitch(sjzd.wlanTypeInfo.mode === '4G' ? 'SLE' : '4G')"
        >
          <span>切换至 {{ sjzd.wlanTypeInfo.mode === '4G' ? 'SLE' : '4G' }}</span>
        </button>
      </div>

      <!-- Card 2: 4G Run State -->
      <div class="metric-card">
        <div class="metric-icon green">
          <Activity :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">4G 模组运行状态</span>
          <span class="metric-value mono-text">
            {{ sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.state || 'UNKNOWN') : '-- (待回读)' }}
          </span>
        </div>
      </div>

      <!-- Card 3: MQTT Connection -->
      <div class="metric-card">
        <div class="metric-icon" :class="sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.isOnline ? 'green' : 'amber') : 'gray'">
          <Zap :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">MQTT 联机状态</span>
          <div class="metric-value-row">
            <span
              class="status-pill"
              :class="sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.isOnline ? 'pill-online' : 'pill-offline') : 'pill-unknown'"
            >
              {{ sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.isOnline ? 'ONLINE (已订阅)' : 'OFFLINE (离线)') : '待回读' }}
            </span>
            <span v-if="sjzd.fourGStatus.lastOnlineLogTime" class="sub-time-hint">
              {{ sjzd.fourGStatus.lastOnlineLogTime }}
            </span>
          </div>
        </div>
      </div>

      <!-- Card 4: Config Operational Validity -->
      <div class="metric-card">
        <div class="metric-icon" :class="sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.configOperational ? 'blue' : 'amber') : 'gray'">
          <CheckCircle2 v-if="sjzd.fourGStatus.hasReadback && sjzd.fourGStatus.configOperational" :size="20" />
          <AlertCircle v-else :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">EEPROM 参数合法性</span>
          <div class="metric-value-row">
            <span
              class="status-pill"
              :class="sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.configOperational ? 'pill-valid' : 'pill-incomplete') : 'pill-unknown'"
            >
              {{ sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.configOperational ? '有效 (valid)' : '待完善 (incomplete)') : '待回读' }}
            </span>
            <span class="sub-pass-tag">
              密码: {{ sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.passwordIsSet ? '已设置' : '空') : '--' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Mode Warning Banner if in SLE mode -->
    <div v-if="sjzd.wlanTypeInfo.mode === 'SLE'" class="alert-banner warning">
      <ShieldAlert :size="18" class="banner-icon" />
      <div class="banner-text">
        <strong>提示：当前设备工作于【星闪 (SLE) 模式】。</strong>
        您在此界面配置并写入的 4G/MQTT 参数将直接烧录至 EEPROM。保存就绪后，可点击右上角“切换至 4G”让设备复位并启动 Cat.1 模组通信。
      </div>
    </div>

    <!-- Sub Tab Navigation -->
    <div class="subtabs-bar">
      <button
        class="subtab-btn"
        :class="{ active: activeTab === 'params' }"
        @click="activeTab = 'params'"
      >
        <Sliders :size="15" />
        <span>4G / MQTT 参数配置</span>
      </button>

      <button
        class="subtab-btn"
        :class="{ active: activeTab === 'wizard' }"
        @click="activeTab = 'wizard'"
      >
        <Sparkles :size="15" />
        <span>按 SN 快速开通向导</span>
      </button>

      <button
        class="subtab-btn"
        :class="{ active: activeTab === 'logs' }"
        @click="activeTab = 'logs'"
      >
        <FileText :size="15" />
        <span>通信诊断与实时日志</span>
        <span v-if="sjzd.fourGLogs.length > 0" class="tab-count-badge">
          {{ sjzd.fourGLogs.length }}
        </span>
      </button>
    </div>

    <!-- TAB 1: 4G / MQTT Parameters Form & Readback Table -->
    <div v-if="activeTab === 'params'" class="tab-pane-content">
      <div class="form-layout-columns">
        <!-- Left: Form Card -->
        <div class="section-card form-card">
          <div class="card-header">
            <div class="header-left">
              <Sliders :size="16" class="icon-blue" />
              <h3>4G Cat.1 & MQTT 接入参数 (待下发草稿)</h3>
            </div>
            <div class="header-right">
              <button
                class="btn btn-xs btn-outline"
                title="查看 4G / MQTT 配置工程规范与注意事项"
                @click="showTipsModal = true"
              >
                <Info :size="12" />
                <span>配置规范</span>
              </button>
              <button
                class="btn btn-xs btn-outline"
                title="导入 JSON 配置模板"
                @click="triggerImportTemplate"
              >
                <Upload :size="12" />
                <span>导入模板</span>
              </button>
              <button
                class="btn btn-xs btn-outline"
                title="导出当前配置模板 (自动排除敏感密码)"
                @click="exportTemplateJson"
              >
                <Download :size="12" />
                <span>导出模板</span>
              </button>
            </div>
          </div>

          <div class="card-body">
            <!-- APN -->
            <div class="form-group">
              <label class="form-label">4G 接入点 APN (4G_APN)</label>
              <div class="input-with-action">
                <input
                  v-model="form.apn"
                  type="text"
                  placeholder="默认使用 cmiot (可填写 ctnet / 3gnet)"
                  class="form-input"
                  :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                />
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                  @click="sjzd.setFourGApn(form.apn || 'cmiot')"
                >
                  写入 APN
                </button>
              </div>
              <span class="field-hint">默认中国移动物联网卡接入点 cmiot (电信使用 ctnet / 联通使用 3gnet)</span>
            </div>

            <!-- MQTT Broker Host & Port (Row 2: Exactly 2 symmetrical columns) -->
            <div class="form-row-2">
              <div class="form-group">
                <label class="form-label required">MQTT Broker 主机 (MQTT_HOST)</label>
                <div class="input-with-action">
                  <input
                    v-model="form.host"
                    type="text"
                    placeholder="例: 106.57.244.54 或 iot.example.com"
                    class="form-input"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                  />
                  <button
                    class="btn btn-sm btn-secondary"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || !form.host.trim() || sjzd.isBusy"
                    @click="sjzd.setMqttHost(form.host.trim())"
                  >
                    写入
                  </button>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label required">MQTT 端口 (MQTT_PORT)</label>
                <div class="input-with-action">
                  <input
                    v-model.number="form.port"
                    type="number"
                    min="1"
                    max="65535"
                    placeholder="8005 或 1883"
                    class="form-input"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                  />
                  <button
                    class="btn btn-sm btn-secondary"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || !form.port || sjzd.isBusy"
                    @click="sjzd.setMqttPort(form.port)"
                  >
                    写入
                  </button>
                </div>
              </div>
            </div>

            <!-- Client ID with Auto Generator (Row 3) -->
            <div class="form-group">
              <label class="form-label required">MQTT Client ID (MQTT_CLIENT)</label>
              <div class="input-with-action">
                <input
                  v-model="form.clientId"
                  type="text"
                  placeholder="默认使用设备 12 位 SN (例: 260303000001)"
                  class="form-input mono-text"
                  :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                />
                <button
                  class="btn btn-sm btn-outline"
                  title="使用终端 SN 填充 Client ID 与上下行主题"
                  @click="handleAutoGenerateTopics"
                >
                  <Sparkles :size="13" />
                  <span>按 SN 推导</span>
                </button>
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="!serial.connectedPort || !mcuConsoleReady || !form.clientId.trim() || sjzd.isBusy"
                  @click="sjzd.setMqttClientId(form.clientId.trim())"
                >
                  写入
                </button>
              </div>
              <span class="field-hint">平台鉴权核心标识，必须保证全局唯一 (推荐使用设备 12 位 SN)</span>
            </div>

            <!-- Username & Password (Row 4: Exactly 2 symmetrical columns) -->
            <div class="form-row-2">
              <div class="form-group">
                <label class="form-label">用户名 (MQTT_USER)</label>
                <div class="input-with-action">
                  <input
                    v-model="form.username"
                    type="text"
                    placeholder="如无鉴权可留空"
                    class="form-input"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                  />
                  <button
                    class="btn btn-sm btn-secondary"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                    @click="sjzd.setMqttUser(form.username.trim())"
                  >
                    写入
                  </button>
                </div>
              </div>

              <div class="form-group">
                <div class="label-row">
                  <label class="form-label">密码 (MQTT_PASS)</label>
                  <span v-if="sjzd.fourGStatus.passwordIsSet" class="pw-badge-set">
                    ● 已设置 (固件安全隐藏)
                  </span>
                  <span v-else class="pw-badge-empty">
                    ○ 未设置
                  </span>
                </div>
                <div class="input-with-action">
                  <div class="password-wrapper">
                    <input
                      v-model="form.password"
                      :type="showPassword ? 'text' : 'password'"
                      :placeholder="sjzd.fourGStatus.passwordIsSet ? '●●●●●● (终端已设置密码，如需修改请输入新密码)' : '未设置密码，如需设置请在此输入'"
                      class="form-input password-input"
                      :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                    />
                    <button
                      type="button"
                      class="pw-toggle-btn"
                      :title="showPassword ? '隐藏密码' : '显示密码'"
                      @click="showPassword = !showPassword"
                    >
                      <EyeOff v-if="showPassword" :size="14" />
                      <Eye v-else :size="14" />
                    </button>
                  </div>
                  <button
                    class="btn btn-sm btn-secondary"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                    @click="sjzd.setMqttPass(form.password)"
                  >
                    写入
                  </button>
                </div>
                <span class="field-hint">
                  固件对已设密码安全脱敏显示 (&lt;set&gt;)。若不更改密码请留空，下发时将保留原密码不变。
                </span>
              </div>
            </div>

            <!-- Publish Topic & Subscribe Topic (Row 5: Exactly 2 symmetrical columns) -->
            <div class="form-row-2">
              <div class="form-group">
                <label class="form-label required">上行发布主题 (MQTT_PUB_TOPIC)</label>
                <div class="input-with-action">
                  <input
                    v-model="form.publishTopic"
                    type="text"
                    placeholder="例: devices/<SN>/up"
                    class="form-input mono-text"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                  />
                  <button
                    class="btn btn-sm btn-secondary"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || !form.publishTopic.trim() || sjzd.isBusy"
                    @click="sjzd.setMqttPubTopic(form.publishTopic.trim())"
                  >
                    写入
                  </button>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label required">下行订阅主题 (MQTT_SUB_TOPIC)</label>
                <div class="input-with-action">
                  <input
                    v-model="form.subscribeTopic"
                    type="text"
                    placeholder="例: devices/<SN>/down"
                    class="form-input mono-text"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                  />
                  <button
                    class="btn btn-sm btn-secondary"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || !form.subscribeTopic.trim() || sjzd.isBusy"
                    @click="sjzd.setMqttSubTopic(form.subscribeTopic.trim())"
                  >
                    写入
                  </button>
                </div>
              </div>
            </div>

            <!-- KeepAlive & QoS (Row 6: Exactly 2 symmetrical columns) -->
            <div class="form-row-2">
              <div class="form-group">
                <label class="form-label">心跳保活周期 (MQTT_KEEPALIVE)</label>
                <div class="input-with-action">
                  <input
                    v-model.number="form.keepAliveSec"
                    type="number"
                    min="30"
                    max="1200"
                    placeholder="60"
                    class="form-input"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                  />
                  <button
                    class="btn btn-sm btn-secondary"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || !form.keepAliveSec || sjzd.isBusy"
                    @click="sjzd.setMqttKeepalive(form.keepAliveSec)"
                  >
                    写入
                  </button>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">服务质量等级 (MQTT_QOS)</label>
                <div class="input-with-action">
                  <select
                    v-model.number="form.qos"
                    class="form-select"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                  >
                    <option :value="0">QoS 0 (最多交付一次)</option>
                    <option :value="1">QoS 1 (至少交付一次，推荐)</option>
                  </select>
                  <button
                    class="btn btn-sm btn-secondary"
                    :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                    @click="sjzd.setMqttQos(form.qos)"
                  >
                    写入
                  </button>
                </div>
              </div>
            </div>

            <!-- Form Actions Bottom Bar -->
            <div class="form-actions-bar">
              <button
                class="btn btn-outline btn-md"
                title="将右侧已校验完整快照字段复制并填入左侧草稿表单"
                @click="syncFormFromStore"
              >
                <ArrowDownLeft :size="14" />
                <span>从完整快照同步至表单</span>
              </button>
              <button
                class="btn btn-primary btn-md"
                :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                @click="handleBatchSave"
              >
                <CheckCircle2 :size="16" />
                <span>批量保存并完整复核</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Right: Readback Table Card -->
        <div class="section-card readback-card">
          <div class="card-header">
            <div class="header-left">
              <TableProperties :size="16" class="icon-green" />
              <h3>设备参数完整快照与状态对照 (4G:LIST)</h3>
            </div>
            <div class="header-right">
              <button
                class="btn btn-xs btn-outline"
                title="将右侧完整快照字段全部填充至左侧表单"
                @click="syncFormFromStore"
              >
                <ArrowDownLeft :size="12" />
                <span>全部填入表单</span>
              </button>
              <button
                class="btn btn-xs btn-primary"
                :disabled="!serial.connectedPort || sjzd.isBusy"
                title="重新向设备查询 4G / MQTT 参数 (4G:LIST)"
                @click="refreshFourGConfiguration"
              >
                <RefreshCw :size="12" :class="{ spin: sjzd.isBusy }" />
                <span>刷新完整快照</span>
              </button>
            </div>
          </div>

          <div class="card-body readback-card-body">
            <!-- Status Mini Summary Strip -->
            <div class="readback-status-strip">
              <div class="strip-item">
                <span class="strip-k">运行状态:</span>
                <span class="strip-v mono-text">{{ sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.state || 'UNKNOWN') : '-- (待回读)' }}</span>
              </div>
              <div class="strip-item">
                <span class="strip-k">设备报告配置:</span>
                <span
                  class="status-pill"
                  :class="sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.configOperational ? 'pill-valid' : 'pill-incomplete') : 'pill-unknown'"
                >
                  {{ sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.configOperational ? '有效 (valid)' : '待完善 (incomplete)') : '未检测' }}
                </span>
              </div>
              <div class="strip-item">
                <span class="strip-k">MQTT联机:</span>
                <span
                  class="status-pill"
                  :class="sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.isOnline ? 'pill-online' : 'pill-offline') : 'pill-unknown'"
                >
                  {{ sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.isOnline ? '已在线' : '离线') : '未检测' }}
                </span>
              </div>
              <div class="strip-item">
                <span class="strip-k">快照时间:</span>
                <span class="strip-v">{{ sjzd.fourGStatus.hasReadback ? (sjzd.fourGStatus.lastSyncTime || '已解析') : '未获取 (点击刷新)' }}</span>
              </div>
              <div v-if="sjzd.fourGStatus.snapshot" class="strip-item">
                <span class="strip-k">事务证据:</span>
                <span class="strip-v mono-text">
                  id={{ sjzd.fourGStatus.snapshot.transactionId }} · {{ sjzd.fourGStatus.snapshot.revisionHex }} · CRC32 {{ sjzd.fourGStatus.snapshot.crc32 }}
                </span>
              </div>
            </div>

            <p class="field-hint">
              仅在 <code>4G_CONFIG:BEGIN/END</code> 事务 ID 一致、payload 数量和 CRC32 均通过后显示。<code>END status=ERROR,code=CONFIG_INCOMPLETE</code> 表示读取完整，但设备配置本身待完善。
            </p>

            <!-- Config Errors Alert Banner if firmware reported 4G_CONFIG_ERROR -->
            <div v-if="sjzd.fourGStatus.configErrors && sjzd.fourGStatus.configErrors.length > 0" class="config-errors-banner">
              <AlertTriangle :size="14" class="err-icon" />
              <div class="err-content">
                <span class="err-title">设备报告配置待完善：</span>
                <span class="err-desc">设备报告待完善参数 <strong>{{ sjzd.fourGStatus.configErrors.join('、') }}</strong>，请在左侧表单补齐后写入！</span>
              </div>
            </div>

            <!-- Readback Table -->
            <div class="readback-table-wrap">
              <table class="readback-table">
                <thead>
                  <tr>
                    <th style="width: 28%;">参数项 / 指令</th>
                    <th style="width: 32%;">固件完整回读字段</th>
                    <th style="width: 25%;">草稿值</th>
                    <th style="width: 15%; text-align: center;">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in readbackRows"
                    :key="row.cmd"
                    :class="{ 'row-diff': row.isDiff }"
                  >
                    <td class="col-name">
                      <div class="name-box">
                        <span class="row-name">{{ row.name }}</span>
                        <code class="row-cmd">{{ row.cmd }}</code>
                      </div>
                    </td>
                    <td class="col-readback">
                      <span
                        class="mono-text readback-val"
                        :class="{ 'val-empty': row.readback.includes('未') || row.readback.includes('空') || row.readback === '--' }"
                      >
                        {{ row.readback }}
                      </span>
                    </td>
                    <td class="col-draft">
                      <div class="draft-wrap">
                        <span class="mono-text draft-val">{{ row.draft }}</span>
                        <span v-if="row.isDiff" class="diff-badge">有变动</span>
                      </div>
                    </td>
                    <td class="col-op">
                      <button
                        v-if="!row.isPass"
                        class="btn btn-xs btn-outline row-fill-btn"
                        :disabled="!sjzd.fourGStatus.hasReadback"
                        title="将该完整回读字段填入左侧表单草稿"
                        @click="copyReadbackToDraft(row.field)"
                      >
                        <ArrowDownLeft :size="11" />
                        <span>填入</span>
                      </button>
                      <span v-else class="text-muted-xs">加密</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: Provisioning Wizard -->
    <div v-if="activeTab === 'wizard'" class="tab-pane-content">
      <div class="section-card wizard-card">
        <div class="card-header">
          <div class="header-left">
            <Sparkles :size="16" class="icon-blue" />
            <h3>按 SN 快速开通向导 (Provisioning Wizard)</h3>
          </div>
          <span class="header-tag-success">
            标准化交付向导 · 5步闭环
          </span>
        </div>

        <div class="card-body wizard-body">
          <!-- Stepper Indicator -->
          <div class="wizard-stepper">
            <div class="step-item" :class="{ current: wizardStep === 1, done: wizardStep > 1 }">
              <div class="step-circle">1</div>
              <span class="step-text">校验 SN</span>
            </div>
            <div class="step-connector" :class="{ done: wizardStep > 1 }"></div>

            <div class="step-item" :class="{ current: wizardStep === 2, done: wizardStep > 2 }">
              <div class="step-circle">2</div>
              <span class="step-text">检查模式</span>
            </div>
            <div class="step-connector" :class="{ done: wizardStep > 2 }"></div>

            <div class="step-item" :class="{ current: wizardStep === 3, done: wizardStep > 3 }">
              <div class="step-circle">3</div>
              <span class="step-text">推导主题</span>
            </div>
            <div class="step-connector" :class="{ done: wizardStep > 3 }"></div>

            <div class="step-item" :class="{ current: wizardStep === 4, done: wizardStep > 4 }">
              <div class="step-circle">4</div>
              <span class="step-text">烧录参数</span>
            </div>
            <div class="step-connector" :class="{ done: wizardStep > 4 }"></div>

            <div class="step-item" :class="{ current: wizardStep === 5, done: wizardStep >= 5 }">
              <div class="step-circle">5</div>
              <span class="step-text">切入4G并联机</span>
            </div>
          </div>

          <!-- Wizard Input Form Box -->
          <div class="wizard-config-box">
            <h4>向导预设参数确认</h4>
            <div class="wizard-form-grid">
              <div class="form-group">
                <label>目标设备 SN (12位)</label>
                <input
                  v-model="wizardSnInput"
                  type="text"
                  placeholder="例: 260303000001 (留空则自动从设备回读)"
                  class="form-input mono-text"
                  :disabled="wizardExecuting"
                />
              </div>

              <div class="form-group">
                <label>MQTT Broker 主机</label>
                <input
                  v-model="form.host"
                  type="text"
                  placeholder="106.57.244.54"
                  class="form-input"
                  :disabled="wizardExecuting"
                />
              </div>

              <div class="form-group">
                <label>MQTT 端口</label>
                <input
                  v-model.number="form.port"
                  type="number"
                  placeholder="8005"
                  class="form-input"
                  :disabled="wizardExecuting"
                />
              </div>

              <div class="form-group">
                <label>MQTT 用户名 (选填)</label>
                <input
                  v-model="form.username"
                  type="text"
                  placeholder="user_xxx"
                  class="form-input"
                  :disabled="wizardExecuting"
                />
              </div>
            </div>

            <div class="wizard-action-row">
              <button
                class="btn btn-primary btn-lg"
                :disabled="!serial.connectedPort || wizardExecuting"
                @click="startWizard"
              >
                <PlayCircle :size="16" />
                <span>{{ wizardExecuting ? '向导正在执行中...' : '一键执行自动化开通流程' }}</span>
              </button>
            </div>
          </div>

          <!-- Wizard Execution Log Area -->
          <div class="wizard-log-panel">
            <div class="log-panel-header">
              <span>向导执行轨迹与设备反馈</span>
              <span class="mono-text">{{ wizardLog.length }} 条记录</span>
            </div>
            <div class="wizard-log-terminal">
              <div v-if="wizardLog.length === 0" class="log-placeholder">
                点击上方“一键执行自动化开通流程”后，将在此实时打印每一步的交互、保存回执和完整快照复核结果...
              </div>
              <div
                v-for="(item, idx) in wizardLog"
                :key="idx"
                class="log-terminal-line"
                :class="{
                  'line-success': item.includes('[成功]'),
                  'line-warn': item.includes('[警告]'),
                  'line-error': item.includes('[向导中断失败]')
                }"
              >
                {{ item }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 3: Diagnosis & Live Logs -->
    <div v-if="activeTab === 'logs'" class="tab-pane-content">
      <!-- State Machine Stage Tracker -->
      <div class="section-card pipeline-card">
        <div class="card-header">
          <div class="header-left">
            <Activity :size="16" class="icon-blue" />
            <h3>4G Cat.1 状态机通信链路流水线</h3>
          </div>
          <span class="cur-state-pill">
            当前处于: {{ sjzd.fourGStatus.state || 'UNKNOWN' }}
          </span>
        </div>

        <div class="card-body">
          <div class="pipeline-track">
            <div
              class="pipe-node"
              :class="{
                active: ['POWER_ON', 'AT', 'ECHO_OFF'].includes(sjzd.fourGStatus.state || ''),
                passed: ['SIM_READY', 'ATTACH', 'REGISTER', 'PDP_CONFIG', 'PDP_ACTIVATE', 'PDP_VERIFY', 'MQTT_VERSION', 'MQTT_OPEN', 'MQTT_CONNECT', 'ONLINE'].includes(sjzd.fourGStatus.state || '')
              }"
            >
              <div class="node-badge">1</div>
              <span class="node-title">上电/AT响应</span>
              <span class="node-sub">POWER_ON</span>
            </div>

            <div class="pipe-line"></div>

            <div
              class="pipe-node"
              :class="{
                active: sjzd.fourGStatus.state === 'SIM_READY',
                passed: ['ATTACH', 'REGISTER', 'PDP_CONFIG', 'PDP_ACTIVATE', 'PDP_VERIFY', 'MQTT_VERSION', 'MQTT_OPEN', 'MQTT_CONNECT', 'ONLINE'].includes(sjzd.fourGStatus.state || '')
              }"
            >
              <div class="node-badge">2</div>
              <span class="node-title">SIM 卡就绪</span>
              <span class="node-sub">SIM_READY</span>
            </div>

            <div class="pipe-line"></div>

            <div
              class="pipe-node"
              :class="{
                active: ['ATTACH', 'REGISTER'].includes(sjzd.fourGStatus.state || ''),
                passed: ['PDP_CONFIG', 'PDP_ACTIVATE', 'PDP_VERIFY', 'MQTT_VERSION', 'MQTT_OPEN', 'MQTT_CONNECT', 'ONLINE'].includes(sjzd.fourGStatus.state || '')
              }"
            >
              <div class="node-badge">3</div>
              <span class="node-title">基站附着/注册</span>
              <span class="node-sub">REGISTER</span>
            </div>

            <div class="pipe-line"></div>

            <div
              class="pipe-node"
              :class="{
                active: ['PDP_CONFIG', 'PDP_ACTIVATE', 'PDP_VERIFY'].includes(sjzd.fourGStatus.state || ''),
                passed: ['MQTT_VERSION', 'MQTT_OPEN', 'MQTT_CONNECT', 'ONLINE'].includes(sjzd.fourGStatus.state || '')
              }"
            >
              <div class="node-badge">4</div>
              <span class="node-title">PDP 数据通路激活</span>
              <span class="node-sub">PDP_ACTIVATE</span>
            </div>

            <div class="pipe-line"></div>

            <div
              class="pipe-node"
              :class="{
                active: ['MQTT_VERSION', 'MQTT_OPEN', 'MQTT_CONNECT', 'MQTT_SUBSCRIBE'].includes(sjzd.fourGStatus.state || ''),
                passed: sjzd.fourGStatus.state === 'ONLINE'
              }"
            >
              <div class="node-badge">5</div>
              <span class="node-title">MQTT 握手/认证</span>
              <span class="node-sub">MQTT_CONNECT</span>
            </div>

            <div class="pipe-line"></div>

            <div
              class="pipe-node online-node"
              :class="{
                active: sjzd.fourGStatus.state === 'ONLINE',
                passed: sjzd.fourGStatus.state === 'ONLINE'
              }"
            >
              <div class="node-badge">6</div>
              <span class="node-title">在线订阅</span>
              <span class="node-sub">ONLINE</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Live 4G Logs Panel -->
      <div class="section-card logs-card">
        <div class="card-header">
          <div class="header-left">
            <FileText :size="16" class="icon-purple" />
            <h3>Cat.1 / MQTT 运行日志监控</h3>
          </div>
          <div class="header-right log-actions">
            <!-- Filter Pills -->
            <div class="filter-pills">
              <button
                class="pill-btn"
                :class="{ active: logFilter === 'all' }"
                @click="logFilter = 'all'"
              >
                全部 ({{ sjzd.fourGLogs.length }})
              </button>
              <button
                class="pill-btn"
                :class="{ active: logFilter === 'info' }"
                @click="logFilter = 'info'"
              >
                信息
              </button>
              <button
                class="pill-btn"
                :class="{ active: logFilter === 'warn' }"
                @click="logFilter = 'warn'"
              >
                警告
              </button>
              <button
                class="pill-btn"
                :class="{ active: logFilter === 'error' }"
                @click="logFilter = 'error'"
              >
                错误
              </button>
              <button
                class="pill-btn"
                :class="{ active: logFilter === 'success' }"
                @click="logFilter = 'success'"
              >
                成功
              </button>
            </div>

            <button class="btn btn-xs btn-outline" title="导出日志到文本文件" @click="exportLogs">
              <Download :size="12" />
              <span>导出日志</span>
            </button>
            <button class="btn btn-xs btn-outline" title="清空日志" @click="clearLogs">
              <Trash2 :size="12" />
              <span>清空</span>
            </button>
          </div>
        </div>

        <div class="card-body log-viewer-body">
          <div ref="logContainerRef" class="log-stream-terminal">
            <div v-if="filteredLogs.length === 0" class="log-empty">
              暂无 4G 诊断日志。当执行查询、参数设置或模组连接时，相关的 URC 与交互报文将在此显示。
            </div>
            <div
              v-for="(log, idx) in filteredLogs"
              :key="idx"
              class="terminal-entry"
              :class="`level-${log.level}`"
            >
              <span class="entry-time">{{ log.timestamp }}</span>
              <span class="entry-level">[{{ log.level.toUpperCase() }}]</span>
              <span class="entry-text">{{ log.text }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Confirm Modal: Switch Mode -->
    <ConfirmModal
      :visible="showModeSwitchModal"
      title="切换无线通信模式确认"
      :message="`您确定要将无线模式切换为【${targetSwitchMode}】吗？写入后终端将自动复位重启，UART2 波特率将自动切换生效。`"
      confirm-text="确认切换并重启"
      cancel-text="取消"
      danger-level="normal"
      @confirm="confirmModeSwitch"
      @cancel="showModeSwitchModal = false"
    />

    <!-- Confirm Modal: Clear 4G EEPROM Config -->
    <ConfirmModal
      :visible="showResetModal"
      title="清除 4G/MQTT EEPROM 配置确认"
      message="此操作将彻底擦除 EEPROM (地址 256~767) 中存储的全部 4G 接入点、Broker 主机、用户名、密码与主题配置，恢复为出厂默认。该操作不可撤销！"
      confirm-text="确认清空 4G 配置"
      cancel-text="放弃"
      danger-level="critical"
      require-typing="RESET"
      :countdown-seconds="3"
      @confirm="confirmResetConfig"
      @cancel="showResetModal = false"
    />

    <!-- Config Tips Modal Dialog -->
    <div v-if="showTipsModal" class="modal-backdrop" @click.self="showTipsModal = false">
      <div class="modal-card tips-modal-card">
        <div class="modal-header">
          <div class="header-left">
            <Info :size="18" class="icon-blue" />
            <h3>4G Cat.1 / MQTT 配置注意事项与工程规范</h3>
          </div>
          <button class="close-btn" title="关闭" @click="showTipsModal = false">
            <X :size="16" />
          </button>
        </div>
        <div class="modal-body tips-modal-body">
          <div class="tip-item">
            <span class="tip-num">1</span>
            <div>
              <strong>无线模式互斥与波特率自动切换</strong>
              <p>星闪 (SLE) 与 4G Cat.1 模式物理互斥。切换至 4G 时终端自动配置 UART2 为 <code>115200</code> 波特率；切回 SLE 模式为 <code>230400</code> 波特率，写入后需终端复位重启生效。</p>
            </div>
          </div>
          <div class="tip-item">
            <span class="tip-num">2</span>
            <div>
              <strong>4G 运行中防误擦除保护机制</strong>
              <p>终端在 4G 工作模式下禁止执行参数清空 (<code>4G:CLEAR</code>) 操作；如需清除 EEPROM 配置，必须先将无线模式切换回星闪 (SLE) 模式后方可执行。</p>
            </div>
          </div>
          <div class="tip-item">
            <span class="tip-num">3</span>
            <div>
              <strong>密码安全性与明文保护</strong>
              <p>出于安全性考虑，固件在 <code>4G:LIST</code> 输出中不会回传密码明文（仅显示 <code>&lt;set&gt;</code> 或 <code>&lt;empty&gt;</code>）。工具会校验列表事务完整性，并且仅复核密码“已设置/未设置”状态；更新密码需在表单输入新值后单独或批量下发。</p>
            </div>
          </div>
          <div class="tip-item">
            <span class="tip-num">4</span>
            <div>
              <strong>主题命名与设备 SN 统一规范</strong>
              <p>建议严格遵照 <code>devices/&lt;SN&gt;/up</code> 与 <code>devices/&lt;SN&gt;/down</code> 规范，可在表单点击「按 SN 推导」或使用「按 SN 快速开通向导」完成下发、保存回执与完整快照 revision 复核；上线、掉电保持和端到端通信仍需现场验证。</p>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary btn-md" @click="showTipsModal = false">我知道了</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 100%;
  padding: 12px 14px;
  box-sizing: border-box;
}

.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--color-border-subtle, #d5dde4);
  background: var(--color-surface-1, #ffffff);
  border-radius: var(--radius-sm, 5px);
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-col h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-main, #17212b);
}

.mode-badge {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 4px;
}
.badge-4g {
  background: rgba(59, 130, 246, 0.15);
  color: #0f5f9e;
  border: 1px solid rgba(59, 130, 246, 0.3);
}
.badge-sle {
  background: rgba(139, 92, 246, 0.15);
  color: #63339e;
  border: 1px solid rgba(139, 92, 246, 0.3);
}

.subtitle {
  margin: 4px 0 0 0;
  font-size: 0.74rem;
  color: var(--text-muted, #40515f);
}

.actions-col {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* Metrics Cards */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  width: 100%;
}

.metric-card {
  position: relative;
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: var(--radius-sm, 5px);
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 9px;
}

.metric-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm, 5px);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.metric-icon.blue {
  background: rgba(59, 130, 246, 0.15);
  color: #0f5f9e;
}
.metric-icon.green {
  background: rgba(16, 185, 129, 0.15);
  color: #176b45;
}
.metric-icon.amber {
  background: rgba(245, 158, 11, 0.15);
  color: #7a4b00;
}
.metric-icon.purple {
  background: rgba(139, 92, 246, 0.15);
  color: #63339e;
}

.metric-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.metric-label {
  font-size: 0.69rem;
  color: var(--text-muted, #5a6d7c);
}

.metric-value-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.metric-value {
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--text-main, #17212b);
}

.sub-baud-tag {
  font-size: 0.68rem;
  color: var(--text-muted, #7c8f9f);
  font-family: var(--font-mono, monospace);
}

.sub-time-hint {
  font-size: 0.66rem;
  color: var(--text-muted, #7c8f9f);
}

.sub-pass-tag {
  font-size: 0.68rem;
  color: var(--text-muted, #5a6d7c);
}

.switch-mode-btn {
  font-size: 0.69rem;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid var(--border, #b9c5cf);
  background: var(--bg-hover, #f1f5f9);
  color: var(--text-main, #17212b);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.switch-mode-btn:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: #94a3b8;
}

.status-pill {
  font-size: 0.69rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
}
.pill-online {
  background: rgba(16, 185, 129, 0.15);
  color: #176b45;
}
.pill-offline {
  background: rgba(148, 163, 184, 0.2);
  color: #475569;
}
.pill-valid {
  background: rgba(59, 130, 246, 0.15);
  color: #0f5f9e;
}
.pill-incomplete {
  background: rgba(245, 158, 11, 0.15);
  color: #7a4b00;
}
.pill-unknown {
  background: rgba(148, 163, 184, 0.15);
  color: #64748b;
}

.config-errors-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 4px;
  color: #991b1b;
  font-size: 0.72rem;
  line-height: 1.4;
}
.config-errors-banner .err-icon {
  color: #dc2626;
  flex-shrink: 0;
  margin-top: 1px;
}
.config-errors-banner .err-content {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.config-errors-banner .err-title {
  font-weight: 700;
  color: #b91c1c;
}
.config-errors-banner .err-desc {
  color: #7f1d1d;
}

/* Alert Banner */
.alert-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-sm, 5px);
  font-size: 0.76rem;
  line-height: 1.4;
}
.alert-banner.warning {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
}
.banner-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

/* Sub-tabs */
.subtabs-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--color-border-subtle, #d5dde4);
  padding-bottom: 4px;
}

.subtab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted, #5a6d7c);
  font-size: 0.77rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.subtab-btn:hover {
  background: var(--bg-hover, #f1f5f9);
  color: var(--text-main, #17212b);
}
.subtab-btn.active {
  background: var(--color-surface-1, #ffffff);
  border-color: var(--color-border-subtle, #d5dde4);
  color: var(--primary, #0f5f9e);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.tab-count-badge {
  font-size: 0.65rem;
  background: rgba(59, 130, 246, 0.15);
  color: #0f5f9e;
  padding: 1px 5px;
  border-radius: 8px;
}

/* Section Card */
.section-card {
  background: var(--color-surface-1, #ffffff);
  border: 1px solid var(--color-border-subtle, #d5dde4);
  border-radius: var(--radius-sm, 5px);
  display: flex;
  flex-direction: column;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-subtle, #d5dde4);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.header-left h3 {
  margin: 0;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--text-main, #17212b);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.card-body {
  padding: 12px;
}

/* Form Layout */
.form-layout-columns {
  display: grid;
  grid-template-columns: minmax(440px, 1.15fr) minmax(420px, 1fr);
  gap: 14px;
  align-items: start;
}
@media (max-width: 1100px) {
  .form-layout-columns {
    grid-template-columns: 1fr;
  }
}

.form-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 680px) {
  .form-row-2 {
    grid-template-columns: 1fr;
  }
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}

.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.pw-badge-set {
  font-size: 0.68rem;
  font-weight: 600;
  color: #15803d;
  background: rgba(22, 163, 74, 0.12);
  border: 1px solid rgba(22, 163, 74, 0.25);
  padding: 1px 6px;
  border-radius: 4px;
}

.pw-badge-empty {
  font-size: 0.68rem;
  font-weight: 500;
  color: #64748b;
  background: rgba(100, 116, 139, 0.1);
  border: 1px solid rgba(100, 116, 139, 0.2);
  padding: 1px 6px;
  border-radius: 4px;
}

.form-group label,
.form-label {
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--text-main, #17212b);
  line-height: 1.35;
  display: block;
}
.form-group label.required::after,
.form-label.required::after {
  content: ' *';
  color: #dc2626;
}

.cur-tag {
  font-size: 0.67rem;
  color: #0f5f9e;
  background: rgba(59, 130, 246, 0.08);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
}
.cur-tag.tag-green {
  color: #176b45;
  background: rgba(16, 185, 129, 0.1);
}
.cur-tag.tag-gray {
  color: #64748b;
  background: #f1f5f9;
}

.input-with-action {
  display: flex;
  align-items: center;
  gap: 6px;
}

.form-input,
.form-select {
  flex: 1;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border, #b9c5cf);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-panel, #ffffff);
  color: var(--text-main, #17212b);
  font-size: 0.76rem;
  box-sizing: border-box;
}
.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--primary, #0f5f9e);
  box-shadow: 0 0 0 2px rgba(15, 95, 158, 0.15);
}

.password-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
}
.password-input {
  width: 100%;
  padding-right: 28px;
}
.pw-toggle-btn {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-muted, #7c8f9f);
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pw-toggle-btn:hover {
  color: var(--text-main, #17212b);
}

.field-hint {
  font-size: 0.67rem;
  color: var(--text-muted, #7c8f9f);
}

.form-actions-bar {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-subtle, #e2e8f0);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

/* Right Readback Table Styles */
.readback-card-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.readback-status-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  background: #f8fafc;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  flex-wrap: wrap;
}

.strip-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.71rem;
}

.strip-k {
  color: var(--text-muted, #64748b);
  font-weight: 500;
}

.strip-v {
  color: var(--text-main, #17212b);
  font-weight: 600;
}

.readback-table-wrap {
  border: 1px solid var(--color-border-subtle, #d5dde4);
  border-radius: 4px;
  overflow-x: auto;
}

.readback-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.72rem;
  background: #ffffff;
}

.readback-table thead th {
  background: #f1f5f9;
  color: var(--text-muted, #475569);
  font-weight: 600;
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid var(--color-border-subtle, #d5dde4);
  white-space: nowrap;
}

.readback-table tbody tr {
  border-bottom: 1px solid #edf2f7;
  transition: background 0.12s;
}

.readback-table tbody tr:last-child {
  border-bottom: none;
}

.readback-table tbody tr:hover {
  background: #f8fafc;
}

.readback-table tbody tr.row-diff {
  background: #fffbeb;
}

.readback-table tbody tr.row-diff:hover {
  background: #fef3c7;
}

.readback-table td {
  padding: 6px 8px;
  vertical-align: middle;
}

.name-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-name {
  font-weight: 600;
  color: var(--text-main, #1e293b);
  font-size: 0.73rem;
}

.row-cmd {
  font-size: 0.64rem;
  color: #64748b;
  font-family: var(--font-mono, monospace);
  background: #f1f5f9;
  padding: 0 4px;
  border-radius: 2px;
  display: inline-block;
  width: fit-content;
}

.readback-val {
  font-size: 0.71rem;
  color: #0f5f9e;
  word-break: break-all;
}

.readback-val.val-empty {
  color: #94a3b8;
  font-style: italic;
}

.draft-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.draft-val {
  font-size: 0.71rem;
  color: #334155;
  word-break: break-all;
}

.diff-badge {
  font-size: 0.61rem;
  font-weight: 700;
  color: #d97706;
  background: #fef3c7;
  border: 1px solid #fde68a;
  padding: 0 4px;
  border-radius: 3px;
  white-space: nowrap;
}

.col-op {
  text-align: center;
}

.row-fill-btn {
  font-size: 0.66rem;
  padding: 2px 6px;
  height: 22px;
}

.text-muted-xs {
  font-size: 0.65rem;
  color: #94a3b8;
}

.icon-blue {
  color: var(--primary, #0f5f9e);
}

.icon-green {
  color: #10b981;
}

/* Modal Dialog & Tips Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(27, 45, 58, 0.45);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.tips-modal-card {
  width: 580px;
  max-width: 92vw;
  background-color: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 8px;
  box-shadow: 0 16px 36px rgba(27, 45, 58, 0.28);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modal-in 0.15s ease-out;
}

.tips-modal-card .modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.tips-modal-card .modal-header h3 {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--text-main, #17212b);
}

.close-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-muted, #7c8f9f);
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.15s;
}
.close-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-main, #17212b);
}

.tips-modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 70vh;
  overflow-y: auto;
}

.tips-modal-card .modal-footer {
  padding: 10px 16px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  display: flex;
  justify-content: flex-end;
}

/* Tips Body & Items */
.tips-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tip-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.tip-num {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fef3c7;
  color: #92400e;
  font-size: 0.68rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.tip-item strong {
  display: block;
  font-size: 0.75rem;
  color: var(--text-main, #17212b);
  margin-bottom: 2px;
}

.tip-item p {
  margin: 0;
  font-size: 0.71rem;
  color: var(--text-muted, #5a6d7c);
  line-height: 1.4;
}

.tip-item code {
  background: #f1f5f9;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
  color: #0f5f9e;
}

/* Provisioning Wizard */
.wizard-stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 10px 16px;
  background: #f8fafc;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  z-index: 1;
}

.step-circle {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #cbd5e1;
  color: #ffffff;
  font-size: 0.74rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.step-text {
  font-size: 0.69rem;
  font-weight: 600;
  color: #64748b;
}

.step-item.current .step-circle {
  background: #0f5f9e;
  box-shadow: 0 0 0 3px rgba(15, 95, 158, 0.2);
}
.step-item.current .step-text {
  color: #0f5f9e;
  font-weight: 700;
}

.step-item.done .step-circle {
  background: #10b981;
}
.step-item.done .step-text {
  color: #10b981;
}

.step-connector {
  flex: 1;
  height: 2px;
  background: #e2e8f0;
  margin: -14px 6px 0 6px;
  transition: all 0.2s;
}
.step-connector.done {
  background: #10b981;
}

.wizard-config-box {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 14px;
}
.wizard-config-box h4 {
  margin: 0 0 10px 0;
  font-size: 0.78rem;
  color: var(--text-main, #17212b);
}

.wizard-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}

.wizard-action-row {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}

.wizard-log-panel {
  border: 1px solid #0f172a;
  border-radius: 5px;
  background: #0b1120;
  overflow: hidden;
}

.log-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: #1e293b;
  color: #94a3b8;
  font-size: 0.69rem;
}

.wizard-log-terminal {
  padding: 10px;
  height: 180px;
  overflow-y: auto;
  font-family: var(--font-mono, monospace);
  font-size: 0.72rem;
  line-height: 1.5;
  color: #cbd5e1;
}

.log-placeholder {
  color: #64748b;
  font-style: italic;
}

.log-terminal-line {
  white-space: pre-wrap;
  word-break: break-all;
}
.log-terminal-line.line-success {
  color: #34d399;
}
.log-terminal-line.line-warn {
  color: #fbbf24;
}
.log-terminal-line.line-error {
  color: #f87171;
}

/* Communication State Machine Pipeline */
.pipeline-track {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 10px;
  overflow-x: auto;
}

.pipe-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 90px;
  text-align: center;
}

.node-badge {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #cbd5e1;
  color: #ffffff;
  font-size: 0.72rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.node-title {
  font-size: 0.72rem;
  font-weight: 600;
  color: #64748b;
}

.node-sub {
  font-size: 0.63rem;
  color: #94a3b8;
  font-family: var(--font-mono, monospace);
}

.pipe-node.passed .node-badge {
  background: #10b981;
}
.pipe-node.passed .node-title {
  color: #10b981;
}

.pipe-node.active .node-badge {
  background: #0f5f9e;
  box-shadow: 0 0 0 3px rgba(15, 95, 158, 0.25);
}
.pipe-node.active .node-title {
  color: #0f5f9e;
  font-weight: 700;
}

.pipe-node.online-node.active .node-badge {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.3);
}

.pipe-line {
  flex: 1;
  height: 2px;
  background: #e2e8f0;
  margin: -16px 4px 0 4px;
}

.cur-state-pill {
  font-size: 0.72rem;
  font-weight: 700;
  background: rgba(59, 130, 246, 0.15);
  color: #0f5f9e;
  padding: 2px 8px;
  border-radius: 4px;
}

/* Log viewer */
.log-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filter-pills {
  display: flex;
  background: #f1f5f9;
  padding: 2px;
  border-radius: 4px;
  gap: 2px;
}

.pill-btn {
  font-size: 0.67rem;
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: #64748b;
  border-radius: 3px;
  cursor: pointer;
}
.pill-btn.active {
  background: #ffffff;
  color: #0f5f9e;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.log-viewer-body {
  padding: 0;
}

.log-stream-terminal {
  background: #0b1120;
  color: #e2e8f0;
  font-family: var(--font-mono, monospace);
  font-size: 0.72rem;
  padding: 10px 12px;
  height: 320px;
  overflow-y: auto;
  line-height: 1.5;
}

.log-empty {
  color: #64748b;
  font-style: italic;
  text-align: center;
  margin-top: 40px;
}

.terminal-entry {
  display: flex;
  gap: 8px;
  word-break: break-all;
}

.entry-time {
  color: #64748b;
  flex-shrink: 0;
}

.entry-level {
  flex-shrink: 0;
  font-weight: 700;
}

.level-info .entry-level {
  color: #38bdf8;
}
.level-warn .entry-level {
  color: #fbbf24;
}
.level-warn .entry-text {
  color: #fef08a;
}
.level-error .entry-level {
  color: #f87171;
}
.level-error .entry-text {
  color: #fca5a5;
}
.level-success .entry-level {
  color: #34d399;
}
.level-success .entry-text {
  color: #a7f3d0;
}

/* Button & Base classes */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 0.74rem;
  font-weight: 600;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid transparent;
  box-sizing: border-box;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--primary, #0f5f9e);
  color: #ffffff;
}
.btn-primary:hover:not(:disabled) {
  background: #0d5289;
}

.btn-secondary {
  background: #e2e8f0;
  color: #1e293b;
  border-color: #cbd5e1;
}
.btn-secondary:hover:not(:disabled) {
  background: #cbd5e1;
}

.btn-danger {
  background: #fee2e2;
  color: #b91c1c;
  border-color: #fca5a5;
}
.btn-danger:hover:not(:disabled) {
  background: #fecaca;
}

.btn-outline {
  background: transparent;
  border-color: var(--border, #b9c5cf);
  color: var(--text-main, #17212b);
}
.btn-outline:hover:not(:disabled) {
  background: #f1f5f9;
}

.btn-sm {
  height: 26px;
  padding: 0 8px;
  font-size: 0.71rem;
}

.btn-xs {
  height: 22px;
  padding: 0 6px;
  font-size: 0.67rem;
}

.btn-lg {
  height: 32px;
  padding: 0 14px;
  font-size: 0.78rem;
}

.header-tag-success {
  font-size: 0.69rem;
  color: #176b45;
  background: rgba(16, 185, 129, 0.12);
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 600;
}

.mono-text {
  font-family: var(--font-mono, monospace);
}

.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
