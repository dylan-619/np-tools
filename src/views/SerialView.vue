<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useVirtualList } from '@vueuse/core'
import {
  Trash2,
  Send,
  Activity,
  Copy,
  Check,
  Filter,
  Plus,
  X,
  Zap,
} from 'lucide-vue-next'
import { useSerialStore } from '../stores/serialStore'
import type { TerminalLogLine } from '../types/serial'

const serial = useSerialStore()

const sendText = ref('')
const sendAddCR = ref(true)
const sendAddLF = ref(true)
const sendIsHex = ref(false)

const sendHistory = ref<string[]>([])
const historyIndex = ref(-1)

const isLoop = ref(false)
const loopInterval = ref(1000)
const loopTimer = ref<number | null>(null)
const autoScroll = ref(true)

export interface SerialCommandPreset {
  name: string
  cmd: string
  desc: string
  category: 'kz3' | 'sjzd' | 'xtq' | 'custom'
  danger?: boolean
}

const BUILTIN_COMMANDS: SerialCommandPreset[] = [
  // KZ3 智能控制器
  { name: '查身份', cmd: '@CFG,SYS,SHOW', desc: '查询生产 SN、型号、设备地址及有效性', category: 'kz3' },
  { name: '查以太网', cmd: '@CFG,ETH,SHOW', desc: '查询以太网 IP、掩码、网关、端口及 Link 状态', category: 'kz3' },
  { name: '查星闪', cmd: '@CFG,SLE,SHOW', desc: '查询 SLE 地址、网络名、发射功率及模组状态', category: 'kz3' },
  { name: '查 Edge TCP', cmd: '@CFG,EDGE,SHOW', desc: '查询 Edge TCP 的 RUN/SAVED、客户端状态与重启需求', category: 'kz3' },
  { name: '查日志', cmd: '@DEBUG', desc: '查询 UART1 调试日志开关状态', category: 'kz3' },
  { name: '开日志', cmd: '@DEBUG=1', desc: '开启持久化调试日志输出', category: 'kz3' },
  { name: '关日志', cmd: '@DEBUG=0', desc: '关闭普通调试日志，保留 OK/ERR', category: 'kz3' },
  { name: '绿灯', cmd: 'GRN', desc: '点亮面板绿色运行指示灯', category: 'kz3' },
  { name: '红灯', cmd: 'RED', desc: '点亮面板红色告警指示灯', category: 'kz3' },
  { name: '关灯', cmd: 'OFF', desc: '关闭面板状态指示灯', category: 'kz3' },
  { name: '安全重启', cmd: '@RST', desc: '确认安全输出后执行软件复位；使保存配置生效', category: 'kz3', danger: true },
  { name: '批量设网络', cmd: '@CFG,ETH,INIT,192.168.30.66,255.255.255.0,192.168.30.1,8080', desc: '一次提交完整以太网参数 (需重启)', category: 'kz3' },

  // SJZDV3 智能采集终端
  { name: '终端信息', cmd: 'DEVINFO', desc: '查询终端运行时间、开机次数与状态', category: 'sjzd' },
  { name: '查询无线模式', cmd: 'WLAN_TYPE:LIST', desc: '查询当前无线模式 (SLE vs 4G) 及 UART2 波特率', category: 'sjzd' },
  { name: '切换星闪模式', cmd: 'WLAN_TYPE:SLE', desc: '将无线模式设为星闪 (SLE)，设备将自动重启', category: 'sjzd', danger: true },
  { name: '切换4G模式', cmd: 'WLAN_TYPE:4G', desc: '将无线模式设为 4G Cat.1，设备将自动重启 (需先配 Broker)', category: 'sjzd', danger: true },
  { name: '查询4G配置', cmd: '4G:LIST', desc: '回读 4G/MQTT 状态、Broker、ClientID 与主题', category: 'sjzd' },
  { name: '设置APN(cmiot)', cmd: '4G_APN:cmiot', desc: '配置 Cat.1 接入点为移动物联网 cmiot', category: 'sjzd' },
  { name: '4G模组重连', cmd: '4G:RECONNECT', desc: '触发 Cat.1 模组重连 MQTT (仅 4G 模式有效)', category: 'sjzd' },
  { name: '清除4G配置', cmd: '4G:RESET_CONFIG', desc: '清空 EEPROM 中的 4G/MQTT 参数 (仅 SLE 模式可用)', category: 'sjzd', danger: true },
  { name: '星闪列表', cmd: 'SLE:LIST', desc: '查询星闪下挂从机拓扑列表', category: 'sjzd' },
  { name: '开启星闪', cmd: '@WLAN=1', desc: '启用星闪无线射频通信', category: 'sjzd' },
  { name: '关闭星闪', cmd: '@WLAN=0', desc: '禁用星闪无线射频通信', category: 'sjzd' },
  { name: '485设备拓扑', cmd: 'RS485DEV:LIST', desc: '查询 RS485 总线轮询设备列表', category: 'sjzd' },
  { name: '模拟量自检', cmd: 'AITEST', desc: '开始 4~20mA 模拟量输入诊断', category: 'sjzd' },
  { name: '停止自检', cmd: 'TESTSTOP', desc: '停止模拟量自检模式', category: 'sjzd' },
  { name: '终端复位', cmd: '@RST', desc: '终端硬件软重启', category: 'sjzd', danger: true },

  // 双星闪协调器
  { name: '协调器状态', cmd: '@STATUS', desc: '双 Radio 状态机、STA/READY 与 Ethernet 摘要', category: 'xtq' },
  { name: '读取身份', cmd: '@CFG GET DeviceIdentity', desc: '读取协调器 SN、产品类型和硬件版本', category: 'xtq' },
  { name: '读取拓扑', cmd: '@CFG GET CoordinatorConfig', desc: '读取工作模式与双 Radio 角色配置', category: 'xtq' },
  { name: '读取 Radio 1', cmd: '@CFG GET Radio1Config', desc: '读取第一颗 Radio 的 EEPROM 目标配置', category: 'xtq' },
  { name: '读取 Radio 2', cmd: '@CFG GET Radio2Config', desc: '读取第二颗 Radio 的 EEPROM 目标配置', category: 'xtq' },
  { name: '读取 Capability 0', cmd: '@CFG GET DeviceCapability0', desc: '读取第 0 个终端协议/无线地址适配槽位', category: 'xtq' },
]

const CUSTOM_COMMANDS_KEY = 'np_tools_custom_serial_commands'
function loadCustomCommands(): SerialCommandPreset[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(CUSTOM_COMMANDS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

const customCommands = ref<SerialCommandPreset[]>(loadCustomCommands())
const showAddCustomModal = ref(false)
const newCustomName = ref('')
const newCustomCmd = ref('')
const newCustomDesc = ref('')

function saveCustomCommand() {
  if (!newCustomCmd.value.trim()) return
  customCommands.value.push({
    name: newCustomName.value.trim() || newCustomCmd.value.trim().slice(0, 10),
    cmd: newCustomCmd.value.trim(),
    desc: newCustomDesc.value.trim() || '自定义快捷指令',
    category: 'custom',
  })
  localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(customCommands.value))
  newCustomName.value = ''
  newCustomCmd.value = ''
  newCustomDesc.value = ''
  showAddCustomModal.value = false
}

function removeCustomCommand(index: number) {
  customCommands.value.splice(index, 1)
  localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(customCommands.value))
}

const activePresetCategory = ref<'all' | 'kz3' | 'sjzd' | 'xtq' | 'custom'>('all')

const visiblePresets = computed<SerialCommandPreset[]>(() => {
  const all = [...BUILTIN_COMMANDS, ...customCommands.value]
  if (activePresetCategory.value === 'all') return all
  return all.filter((c) => c.category === activePresetCategory.value)
})

function applyCommand(cmd: string, directSend = false) {
  sendText.value = cmd
  if (directSend) {
    nextTick(() => {
      handleSend()
    })
  }
}

// Filter Level
const activeFilter = ref<'ALL' | 'INFO' | 'WARN' | 'ERROR' | 'SLE' | 'MB'>('ALL')

const filteredLogs = computed<TerminalLogLine[]>(() => {
  if (activeFilter.value === 'ALL') {
    return serial.logs
  }
  if (activeFilter.value === 'INFO') {
    return serial.logs.filter((l: TerminalLogLine) => l.level === 'INFO')
  }
  if (activeFilter.value === 'WARN') {
    return serial.logs.filter((l: TerminalLogLine) => l.level === 'WARN')
  }
  if (activeFilter.value === 'ERROR') {
    return serial.logs.filter((l: TerminalLogLine) => l.level === 'ERROR')
  }
  if (activeFilter.value === 'SLE') {
    return serial.logs.filter((l: TerminalLogLine) => l.text.includes('SLE') || l.text.includes('SEL_'))
  }
  if (activeFilter.value === 'MB') {
    return serial.logs.filter(
      (l: TerminalLogLine) => l.text.includes('RS485DEV') || l.text.includes('MB_') || l.text.includes('Modbus')
    )
  }
  return serial.logs
})

const { list, containerProps, wrapperProps, scrollTo } = useVirtualList(filteredLogs, {
  itemHeight: 22,
})

watch(
  () => filteredLogs.value.length,
  () => {
    if (autoScroll.value && filteredLogs.value.length > 0) {
      nextTick(() => {
        scrollTo(filteredLogs.value.length - 1)
      })
    }
  }
)

async function executeSend() {
  if (!serial.connectedPort || !sendText.value) return
  try {
    await serial.sendRaw(sendText.value, {
      isHex: sendIsHex.value,
      addCR: sendAddCR.value,
      addLF: sendAddLF.value,
    })
  } catch {
    if (loopTimer.value) {
      clearInterval(loopTimer.value)
      loopTimer.value = null
    }
  }
}

async function handleSend() {
  if (!sendText.value || !serial.connectedPort) return

  if (loopTimer.value) {
    clearInterval(loopTimer.value)
    loopTimer.value = null
    return
  }

  // Record history
  if (sendHistory.value[sendHistory.value.length - 1] !== sendText.value) {
    sendHistory.value.push(sendText.value)
    if (sendHistory.value.length > 50) sendHistory.value.shift()
  }
  historyIndex.value = sendHistory.value.length

  if (isLoop.value && loopInterval.value >= 10) {
    loopTimer.value = window.setInterval(executeSend, loopInterval.value)
  }

  await executeSend()
}

function handleHistoryUp(e: KeyboardEvent) {
  if (historyIndex.value > 0) {
    e.preventDefault()
    historyIndex.value--
    sendText.value = sendHistory.value[historyIndex.value]
  }
}

function handleHistoryDown(e: KeyboardEvent) {
  if (historyIndex.value < sendHistory.value.length - 1) {
    e.preventDefault()
    historyIndex.value++
    sendText.value = sendHistory.value[historyIndex.value]
  } else {
    historyIndex.value = sendHistory.value.length
    sendText.value = ''
  }
}

const copiedSuccess = ref(false)

async function copyCurrentLogs() {
  if (filteredLogs.value.length === 0) return
  try {
    const textToCopy = filteredLogs.value
      .map((l: TerminalLogLine) => `[${l.timestamp}] [${l.direction.toUpperCase()}] ${l.text}`)
      .join('\n')
    await navigator.clipboard.writeText(textToCopy)
    copiedSuccess.value = true
    setTimeout(() => {
      copiedSuccess.value = false
    }, 2000)
  } catch (err: any) {
    serial.errorMsg = `复制到剪贴板失败: ${err}`
  }
}
</script>

<template>
  <div class="serial-view-container">
    <!-- Top Toolbar -->
    <header class="terminal-header">
      <div class="header-left">
        <div class="stats-box">
          <Activity :size="14" class="activity-icon" />
          <span class="mono-text">RX: {{ serial.rxBytes }} B | TX: {{ serial.txBytes }} B</span>
        </div>

        <div class="filter-chips">
          <span class="filter-label"><Filter :size="12" /> 过滤:</span>
          <button
            class="chip"
            :class="{ active: activeFilter === 'ALL' }"
            @click="activeFilter = 'ALL'"
          >
            全部
          </button>
          <button
            class="chip chip-info"
            :class="{ active: activeFilter === 'INFO' }"
            @click="activeFilter = 'INFO'"
          >
            INFO
          </button>
          <button
            class="chip chip-warn"
            :class="{ active: activeFilter === 'WARN' }"
            @click="activeFilter = 'WARN'"
          >
            WARN
          </button>
          <button
            class="chip chip-err"
            :class="{ active: activeFilter === 'ERROR' }"
            @click="activeFilter = 'ERROR'"
          >
            ERROR
          </button>
          <button
            class="chip chip-sle"
            :class="{ active: activeFilter === 'SLE' }"
            @click="activeFilter = 'SLE'"
          >
            星闪报文
          </button>
          <button
            class="chip chip-mb"
            :class="{ active: activeFilter === 'MB' }"
            @click="activeFilter = 'MB'"
          >
            Modbus
          </button>
        </div>
      </div>

      <div class="header-right">
        <button
          class="btn-tool"
          :class="{ success: copiedSuccess }"
          title="一键复制当前区域的所有日志内容到剪贴板"
          :disabled="filteredLogs.length === 0"
          @click="copyCurrentLogs"
        >
          <Check v-if="copiedSuccess" :size="13" class="icon-success" />
          <Copy v-else :size="13" />
          <span>{{ copiedSuccess ? '已复制内容' : '复制当前内容' }}</span>
        </button>

        <label class="checkbox-label">
          <input v-model="autoScroll" type="checkbox" />
          <span>自动滚屏</span>
        </label>

        <button class="btn-tool" title="清空终端" @click="serial.clearLogs">
          <Trash2 :size="13" />
          <span>清空</span>
        </button>
      </div>
    </header>

    <!-- Terminal Virtual Scroll List -->
    <div class="terminal-body" v-bind="containerProps">
      <div v-bind="wrapperProps" class="lines-wrapper">
        <div
          v-for="item in list"
          :key="item.data.id"
          class="log-row"
          :class="[item.data.direction, item.data.level]"
        >
          <span class="log-timestamp">[{{ item.data.timestamp }}]</span>
          <span class="log-dir">[{{ item.data.direction.toUpperCase() }}]</span>
          <span class="log-content">{{ item.data.text }}</span>
        </div>

        <div v-if="filteredLogs.length === 0" class="empty-terminal-state">
          <span>等待串口数据流接收...</span>
        </div>
      </div>
    </div>

    <!-- Send Panel -->
    <div class="send-dock" :class="{ disabled: !serial.connectedPort }">
      <div class="send-options-row">
        <label class="checkbox-label">
          <input
            v-model="sendAddCR"
            type="checkbox"
            :disabled="sendIsHex || loopTimer !== null"
          />
          <span>+CR (\r)</span>
        </label>

        <label class="checkbox-label">
          <input
            v-model="sendAddLF"
            type="checkbox"
            :disabled="sendIsHex || loopTimer !== null"
          />
          <span>+LF (\n)</span>
        </label>

        <label class="checkbox-label">
          <input
            v-model="sendIsHex"
            type="checkbox"
            :disabled="loopTimer !== null"
          />
          <span>HEX 格式</span>
        </label>

        <div class="divider-v" />

        <label class="checkbox-label">
          <input
            v-model="isLoop"
            type="checkbox"
            :disabled="loopTimer !== null"
          />
          <span>循环发送</span>
        </label>

        <div v-if="isLoop" class="loop-box">
          <input
            v-model.number="loopInterval"
            type="number"
            min="10"
            step="100"
            class="loop-input"
            :disabled="loopTimer !== null"
          />
          <span>ms</span>
        </div>
      </div>

      <!-- Quick Command Presets Workbench -->
      <div class="quick-presets-workbench">
        <div class="presets-header-row">
          <div class="presets-nav-tabs">
            <span class="preset-label"><Zap :size="13" /> 常用指令库:</span>
            <button
              class="preset-tab-btn"
              :class="{ active: activePresetCategory === 'all' }"
              @click="activePresetCategory = 'all'"
            >
              全部 ({{ visiblePresets.length }})
            </button>
            <button
              class="preset-tab-btn"
              :class="{ active: activePresetCategory === 'kz3' }"
              @click="activePresetCategory = 'kz3'"
            >
              KZ3 控制器
            </button>
            <button
              class="preset-tab-btn"
              :class="{ active: activePresetCategory === 'sjzd' }"
              @click="activePresetCategory = 'sjzd'"
            >
              SJZD 采集终端
            </button>
            <button
              class="preset-tab-btn"
              :class="{ active: activePresetCategory === 'xtq' }"
              @click="activePresetCategory = 'xtq'"
            >
              双星闪协调器
            </button>
            <button
              class="preset-tab-btn"
              :class="{ active: activePresetCategory === 'custom' }"
              @click="activePresetCategory = 'custom'"
            >
              自定义 ({{ customCommands.length }})
            </button>
          </div>

          <button
            class="btn-add-custom"
            title="添加常用指令到自定义库"
            @click="showAddCustomModal = true"
          >
            <Plus :size="12" />
            <span>自定义指令</span>
          </button>
        </div>

        <div class="presets-list-scroll">
          <div
            v-for="(item, idx) in visiblePresets"
            :key="item.cmd + idx"
            class="cmd-chip-item"
            :class="{ danger: item.danger, custom: item.category === 'custom' }"
            :title="`${item.desc}\n单击填入输入框，双击或点击右侧发送图标立即发送`"
          >
            <button
              class="chip-content-btn"
              :disabled="!serial.connectedPort || loopTimer !== null"
              @click="applyCommand(item.cmd, false)"
              @dblclick="applyCommand(item.cmd, true)"
            >
              <span class="chip-name">{{ item.name }}</span>
              <code class="chip-code">{{ item.cmd }}</code>
            </button>
            <button
              class="chip-direct-send"
              title="立即发送此命令"
              :disabled="!serial.connectedPort || loopTimer !== null"
              @click.stop="applyCommand(item.cmd, true)"
            >
              <Send :size="10" />
            </button>
            <button
              v-if="item.category === 'custom'"
              class="chip-delete-btn"
              title="删除此自定义指令"
              @click.stop="removeCustomCommand(idx)"
            >
              <X :size="10" />
            </button>
          </div>
        </div>
      </div>

      <div class="send-input-row">
        <textarea
          v-model="sendText"
          placeholder="输入发送内容... (Enter 发送，支持 ↑/↓ 历史记录)"
          class="send-textarea mono-text"
          :disabled="!serial.connectedPort || loopTimer !== null"
          @keydown.enter.prevent="handleSend"
          @keydown.up="handleHistoryUp"
          @keydown.down="handleHistoryDown"
        />

        <button
          class="btn-send-main"
          :class="{ 'btn-loop-stop': loopTimer !== null }"
          :disabled="!serial.connectedPort || (!sendText && loopTimer === null)"
          @click="handleSend"
        >
          <Send v-if="!loopTimer" :size="16" />
          <span>{{ loopTimer ? '停止' : '发送' }}</span>
        </button>
      </div>
    </div>

    <!-- Custom Command Add Modal -->
    <div v-if="showAddCustomModal" class="custom-cmd-modal-backdrop" @click.self="showAddCustomModal = false">
      <div class="custom-cmd-modal">
        <div class="modal-header">
          <h3>添加常用串口指令</h3>
          <button class="modal-close" @click="showAddCustomModal = false"><X :size="14" /></button>
        </div>
        <div class="modal-body">
          <label class="modal-label">
            <span>指令名称</span>
            <input v-model="newCustomName" class="modal-input" placeholder="例如：查询版本号" />
          </label>
          <label class="modal-label">
            <span>指令文本 (ASCII / AT / 协议文本)</span>
            <input v-model="newCustomCmd" class="modal-input mono-text" placeholder="例如：@VERSION? 或 @CFG,SYS,SHOW" />
          </label>
          <label class="modal-label">
            <span>用途备注 (可选)</span>
            <input v-model="newCustomDesc" class="modal-input" placeholder="例如：出厂前用于核对软硬件版本" />
          </label>
        </div>
        <div class="modal-footer">
          <button class="modal-btn cancel" @click="showAddCustomModal = false">取消</button>
          <button class="modal-btn submit" :disabled="!newCustomCmd.trim()" @click="saveCustomCommand">保存指令</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.serial-view-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app, #edf1f4);
}

.terminal-header {
  min-height: 40px;
  height: auto;
  background: var(--color-surface-1, #ffffff);
  border-bottom: 1px solid var(--border, #b9c5cf);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  gap: 8px;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.stats-box {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-muted, #40515f);
}
.activity-icon {
  color: var(--accent, #1769aa);
}

.filter-chips {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}
.filter-label {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
  display: flex;
  align-items: center;
  gap: 3px;
  margin-right: 2px;
}

.chip {
  min-height: 24px;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 0.7rem;
  background: var(--bg-input, #f7f9fb);
  border: 1px solid var(--border, #b9c5cf);
  color: var(--text-muted, #40515f);
  cursor: pointer;
}
.chip:hover {
  color: #17212b;
}
.chip.active {
  background: rgba(59, 130, 246, 0.2);
  border-color: #1769aa;
  color: #1769aa;
  font-weight: bold;
}
.chip.chip-info.active {
  background: rgba(16, 185, 129, 0.2);
  border-color: #176b45;
  color: #176b45;
}
.chip.chip-warn.active {
  background: rgba(245, 158, 11, 0.2);
  border-color: #8a5700;
  color: #7a4b00;
}
.chip.chip-err.active {
  background: rgba(239, 68, 68, 0.2);
  border-color: #a12d34;
  color: #a12d34;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-tool {
  padding: 4px 10px;
  background: var(--bg-input, #f7f9fb);
  border: 1px solid var(--border, #b9c5cf);
  color: var(--text-muted, #40515f);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  transition: all 0.15s ease;
}
.btn-tool:hover:not(:disabled) {
  background: #e5ebf0;
  color: #17212b;
  border-color: #1769aa;
}
.btn-tool:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-tool.success {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.4);
  color: #176b45;
}
.icon-success {
  color: #176b45;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  color: var(--text-muted, #40515f);
  cursor: pointer;
}

.terminal-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.78rem;
  line-height: 20px;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.log-row {
  display: flex;
  gap: 8px;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
  -webkit-user-select: text;
}

.log-timestamp {
  color: #64748b;
  flex-shrink: 0;
}
.log-dir {
  font-weight: 600;
  flex-shrink: 0;
}
.log-row.rx .log-dir {
  color: #176b45;
}
.log-row.tx .log-dir {
  color: #1769aa;
}

.log-content {
  color: var(--text-main, #17212b);
}
.log-row.INFO .log-content {
  color: #176b45;
}
.log-row.WARN .log-content {
  color: #7a4b00;
}
.log-row.ERROR .log-content {
  color: #a12d34;
}
.log-row.DEBUG .log-content {
  color: #0f5f9e;
}

.empty-terminal-state {
  color: #475569;
  text-align: center;
  padding-top: 100px;
}

.send-dock {
  background: var(--bg-panel, #ffffff);
  border-top: 1px solid var(--border, #b9c5cf);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.send-dock.disabled {
  opacity: 0.6;
}

.send-options-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.divider-v {
  width: 1px;
  height: 14px;
  background: var(--border, #b9c5cf);
}

.loop-box {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--text-muted, #40515f);
}
.loop-input {
  width: 60px;
  padding: 2px 6px;
  background: var(--bg-app, #edf1f4);
  border: 1px solid var(--border, #b9c5cf);
  color: #17212b;
  border-radius: 4px;
  font-size: 0.75rem;
}

.quick-presets-workbench {
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: var(--bg-app, #edf1f4);
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border, #b9c5cf);
}

.presets-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.presets-nav-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
}

.preset-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-muted, #40515f);
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-right: 2px;
  white-space: nowrap;
}

.preset-tab-btn {
  padding: 2px 7px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 0.7rem;
  color: var(--text-muted, #40515f);
  cursor: pointer;
  white-space: nowrap;
}
.preset-tab-btn:hover {
  color: var(--text-main, #17212b);
  background: rgba(0, 0, 0, 0.05);
}
.preset-tab-btn.active {
  background: #ffffff;
  border-color: var(--border, #b9c5cf);
  color: #1769aa;
  font-weight: 700;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.btn-add-custom {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  background: #fff;
  border: 1px dashed var(--border, #b9c5cf);
  border-radius: 4px;
  font-size: 0.68rem;
  color: #1769aa;
  cursor: pointer;
  white-space: nowrap;
}
.btn-add-custom:hover {
  background: #eef4f9;
  border-color: #1769aa;
}

.presets-list-scroll {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: thin;
}

.cmd-chip-item {
  display: inline-flex;
  align-items: stretch;
  background: #ffffff;
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
  transition: all 0.15s ease;
}
.cmd-chip-item:hover {
  border-color: #90b8d8;
  box-shadow: 0 1px 4px rgba(23, 105, 170, 0.12);
}
.cmd-chip-item.danger {
  border-color: #e5b4b7;
  background: #fff8f8;
}
.cmd-chip-item.danger:hover {
  border-color: #a12d34;
}

.chip-content-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}
.chip-content-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.chip-name {
  font-size: 0.71rem;
  font-weight: 600;
  color: #1e3342;
  white-space: nowrap;
}
.cmd-chip-item.danger .chip-name {
  color: #8f2028;
}

.chip-code {
  font-family: var(--font-mono, monospace);
  font-size: 0.67rem;
  color: #1769aa;
  background: #eef3f7;
  padding: 1px 4px;
  border-radius: 3px;
  white-space: nowrap;
}
.cmd-chip-item.danger .chip-code {
  color: #a12d34;
  background: #fdebed;
}

.chip-direct-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  background: transparent;
  border: none;
  border-left: 1px solid #e2e8ed;
  color: #40515f;
  cursor: pointer;
  padding: 0;
  transition: all 0.12s;
}
.chip-direct-send:hover:not(:disabled) {
  background: #1769aa;
  color: #ffffff;
}
.cmd-chip-item.danger .chip-direct-send:hover:not(:disabled) {
  background: #a12d34;
  color: #ffffff;
}
.chip-direct-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.chip-delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  background: transparent;
  border: none;
  border-left: 1px solid #e2e8ed;
  color: #8f2028;
  cursor: pointer;
  padding: 0;
}
.chip-delete-btn:hover {
  background: #fdebed;
}

/* Custom Command Add Modal */
.custom-cmd-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
  z-index: 9999;
  display: grid;
  place-items: center;
  padding: 16px;
}
.custom-cmd-modal {
  width: 100%;
  max-width: 420px;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  border: 1px solid #b9c5cf;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #e2e8ed;
  background: #f7f9fb;
}
.modal-header h3 {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: #17212b;
}
.modal-close {
  background: transparent;
  border: none;
  color: #71838e;
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 4px;
}
.modal-close:hover {
  color: #17212b;
}
.modal-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.75rem;
  color: #40515f;
  font-weight: 600;
}
.modal-input {
  min-height: 32px;
  padding: 5px 8px;
  border: 1px solid #b9c5cf;
  border-radius: 4px;
  font-size: 0.82rem;
  outline: none;
}
.modal-input:focus {
  border-color: #1769aa;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  background: #f7f9fb;
  border-top: 1px solid #e2e8ed;
}
.modal-btn {
  padding: 5px 12px;
  border-radius: 4px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}
.modal-btn.cancel {
  background: transparent;
  border: 1px solid #b9c5cf;
  color: #40515f;
}
.modal-btn.submit {
  background: #1769aa;
  border: 1px solid #1769aa;
  color: #ffffff;
}
.modal-btn.submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.send-input-row {
  display: flex;
  gap: 10px;
}

.send-textarea {
  flex: 1;
  height: 40px;
  padding: 7px 10px;
  background: var(--bg-input, #f7f9fb);
  border: 1px solid var(--border, #b9c5cf);
  color: #17212b;
  border-radius: 6px;
  font-size: 0.85rem;
  resize: none;
  outline: none;
}
.send-textarea:focus {
  border-color: var(--accent, #1769aa);
}

.btn-send-main {
  width: 82px;
  background: var(--accent, #1769aa);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

@media (max-width: 960px) {
  .terminal-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .header-right {
    margin-left: auto;
  }

  .filter-label,
  .stats-box .mono-text {
    display: none;
  }
}
.btn-send-main:hover:not(:disabled) {
  background: var(--accent-hover, #1769aa);
}
.btn-send-main.btn-loop-stop {
  background: var(--danger, #a12d34);
}
.btn-send-main:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mono-text {
  font-family: var(--font-mono, monospace);
}
</style>
