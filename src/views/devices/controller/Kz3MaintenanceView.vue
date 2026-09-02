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
  Save,
  Settings2,
  ShieldAlert,
  TerminalSquare,
  Trash2,
} from 'lucide-vue-next'
import ConfirmModal from '../../../components/common/ConfirmModal.vue'
import { appSaveFile } from '../../../api/sjzdApi'
import { useSerialStore } from '../../../stores/serialStore'
import { useKz3MaintenanceStore } from '../../../stores/kz3MaintenanceStore'
import type {
  Kz3ConfigGroup,
  Kz3EthernetCandidate,
  Kz3SleCandidate,
  Kz3SystemRole,
} from '../../../types/kz3Maintenance'
import {
  buildDebugCommand,
  buildEthernetInitCommand,
  buildIdentityCommand,
  buildRoleCommand,
  buildSleInitCommand,
  KZ3_SLE_FIXED_ADDRESS,
  KZ3_SLE_FIXED_APID,
  KZ3_UART_CONFIG,
  sleConfirmationLevel,
} from '../../../utils/kz3UartProtocol'

type Section = 'overview' | Kz3ConfigGroup | 'session'

const serial = useSerialStore()
const maintenance = useKz3MaintenanceStore()
const activeSection = ref<Section>('overview')
const pageMessage = ref<{ text: string; error: boolean } | null>(null)
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
const role = ref<Kz3SystemRole>('CONTROLLER')
const roleAddress = ref('1')
const confirmAction = ref<{ title: string; message: string; command: string } | null>(null)

const sections: Array<{
  id: Section
  label: string
  caption: string
  icon: typeof Cpu
}> = [
  { id: 'overview', label: '设备总览', caption: '五组配置快照', icon: Cpu },
  { id: 'system', label: '生产身份', caption: 'SN / 型号 / 地址', icon: Fingerprint },
  { id: 'ethernet', label: 'Ethernet', caption: 'RUN / SAVED', icon: EthernetPort },
  { id: 'sle', label: '星闪 SLE', caption: 'EEPROM / 模组确认', icon: Radio },
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
    showMessage('五组配置查询完成；请按各层状态判断是否真正生效')
  } catch (error) {
    showMessage(String(error), true)
  }
}

function requestWrite(title: string, message: string, builder: () => string) {
  try {
    const command = builder()
    confirmAction.value = { title, message: `${message}\n\n即将发送：${command}`, command }
  } catch (error) {
    showMessage(String(error), true)
  }
}

async function confirmWrite() {
  const action = confirmAction.value
  confirmAction.value = null
  if (!action) return
  try {
    const result = await maintenance.runWrite(action.command)
    if (result.status === 'ok') {
      showMessage('设备已接受写入，并已执行对应 SHOW 复核；请继续检查生效层级')
    } else {
      showMessage(result.error || result.protocolLine || '写入失败', true)
    }
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
          <p>结构化配置 SN、Ethernet、星闪、系统角色与调试日志；不修改工程 YAML</p>
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
            <p class="info-box">批量初始化固定生成完整四参数命令。写入后 LwIP 不在线切换，必须重启并再次查询。</p>
            <button class="button danger-outline" :disabled="!maintenanceReady || maintenance.isBusy" @click="requestWrite('确认写入 Ethernet 配置', '四个字段将作为一个完整候选提交；成功后仍需物理重启。', () => buildEthernetInitCommand(ethernet))"><Save :size="14" /> 写入完整网络配置</button>
          </div>
          <div class="snapshot-card">
            <h3>RUN / SAVED 对照</h3>
            <div class="compare-table"><div class="compare-head"><span>字段</span><span>RUN</span><span>SAVED</span></div><div><strong>IP</strong><code>{{ field('ethernet', 'RUN_IP') }}</code><code>{{ field('ethernet', 'SAVED_IP') }}</code></div><div><strong>MASK</strong><code>{{ field('ethernet', 'RUN_MASK') }}</code><code>{{ field('ethernet', 'SAVED_MASK') }}</code></div><div><strong>GW</strong><code>{{ field('ethernet', 'RUN_GW') }}</code><code>{{ field('ethernet', 'SAVED_GW') }}</code></div><div><strong>PORT</strong><code>{{ field('ethernet', 'RUN_PORT') }}</code><code>{{ field('ethernet', 'SAVED_PORT') }}</code></div></div>
            <div class="state-banner" :class="isOne('ethernet', 'REBOOT_REQUIRED') ? 'warning' : 'success'"><AlertTriangle v-if="isOne('ethernet', 'REBOOT_REQUIRED')" :size="15" /><CheckCircle2 v-else :size="15" />{{ isOne('ethernet', 'REBOOT_REQUIRED') ? '已保存，尚未成为运行配置' : 'RUN 与 SAVED 一致' }}</div>
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
</style>
