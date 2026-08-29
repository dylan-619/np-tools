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

const quickCommands = [
  'DEVINFO',
  'SLE:LIST',
  '@WLAN=0',
  '@WLAN=1',
  'RS485DEV:LIST',
  'AITEST',
  'TESTSTOP',
  '@RST',
]

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

      <!-- Quick Command Presets Bar -->
      <div class="quick-presets-row">
        <span class="preset-label">快捷指令:</span>
        <button
          v-for="cmd in quickCommands"
          :key="cmd"
          class="cmd-pill"
          :class="{ danger: cmd === '@RST' }"
          :disabled="!serial.connectedPort || loopTimer !== null"
          :title="cmd === '@RST' ? '设备软复位命令：选中后仍需点击发送或按 Enter' : `填入 ${cmd}`"
          @click="sendText = cmd"
        >
          {{ cmd }}
        </button>
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

.quick-presets-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.preset-label {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
}
.cmd-pill {
  padding: 2px 7px;
  background: #eef3f7;
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 4px;
  color: #1769aa;
  font-family: var(--font-mono, monospace);
  font-size: 0.72rem;
  cursor: pointer;
}
.cmd-pill:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.2);
  border-color: #1769aa;
  color: #0f5f9e;
}
.cmd-pill:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cmd-pill.danger {
  border-color: #d3a1a5;
  color: #8f2028;
  background: #fff3f4;
}
.cmd-pill.danger:hover:not(:disabled) {
  border-color: #a12d34;
  color: #7d1820;
  background: #fdebed;
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
