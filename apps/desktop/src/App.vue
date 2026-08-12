<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import { useVirtualList } from '@vueuse/core'
import { 
  RefreshCw, Trash2, Send, 
  Activity, TerminalSquare, Save
} from 'lucide-vue-next'
import { listPorts, openPort, closePort, writePort, setDtr, setRts, startRecording, stopRecording, SerialPortDescriptor, IoChunk } from './api/serialApi'
import { save } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'

function startDrag() {
  getCurrentWindow().startDragging()
}

// --- State ---
interface LogLine {
  direction: 'rx' | 'tx';
  text: string;
  timestamp: string;
}

const ports = ref<SerialPortDescriptor[]>([])
const loading = ref(false)
const errorMsg = ref('')

const selectedPort = ref('')
const connectedPort = ref<string | null>(null)
const outputLines = ref<LogLine[]>([])
const decoder = new TextDecoder()
let lineBuffer = ''

const rxBytes = ref(0)
const txBytes = ref(0)
const autoScroll = ref(true)

// Config Form
const config = ref({
  baudRate: 115200,
  dataBits: 'eight',
  stopBits: 'one',
  parity: 'none',
  flowControl: 'none'
})

// Send Form
const sendText = ref('')
const sendAddCR = ref(true)
const sendAddLF = ref(true)
const sendIsHex = ref(false)

const sendHistory = ref<string[]>([])
const historyIndex = ref(-1)

const isLoop = ref(false)
const loopInterval = ref(1000)
const loopTimer = ref<number | null>(null)

const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000, 2000000]

const dtrState = ref(false)
const rtsState = ref(false)
const isRecording = ref(false)

// --- Virtual Scroller ---
const { list, containerProps, wrapperProps, scrollTo } = useVirtualList(
  outputLines,
  {
    itemHeight: 22,
  }
)

watch(() => outputLines.value.length, () => {
  if (autoScroll.value && outputLines.value.length > 0) {
    nextTick(() => {
      scrollTo(outputLines.value.length - 1)
    })
  }
})

// --- Actions ---
async function refreshPorts() {
  loading.value = true
  errorMsg.value = ''
  try {
    ports.value = await listPorts()
    if (ports.value.length > 0 && !selectedPort.value) {
      selectedPort.value = ports.value[0].portName
    } else if (ports.value.length === 0) {
      selectedPort.value = ''
    }
  } catch (err: any) {
    errorMsg.value = String(err)
  } finally {
    loading.value = false
  }
}

async function handleConnect(portName: string) {
  errorMsg.value = ''
  try {
    await openPort({
      path: portName,
      baudRate: config.value.baudRate,
      dataBits: config.value.dataBits,
      stopBits: config.value.stopBits,
      parity: config.value.parity,
      flowControl: config.value.flowControl
    }, (chunks: IoChunk[]) => {
      let combinedText = ''
      for (const chunk of chunks) {
        rxBytes.value += chunk.payload.length
        const text = decoder.decode(new Uint8Array(chunk.payload), { stream: true })
        if (text) {
          combinedText += text
        }
      }
      if (combinedText) {
        lineBuffer += combinedText
        const newLines = lineBuffer.split('\n')
        if (newLines.length > 1) {
          lineBuffer = newLines.pop() || ''
          const d = new Date()
          const timeStr = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${d.getMilliseconds().toString().padStart(3,'0')}`
          const rxLines = newLines.map(text => ({
            direction: 'rx' as const,
            text: text,
            timestamp: timeStr
          }))
          outputLines.value.push(...rxLines)
          if (outputLines.value.length > 5000) {
            outputLines.value.splice(0, outputLines.value.length - 5000)
          }
        }
      }
    })
    connectedPort.value = portName
    outputLines.value = []
    lineBuffer = ''
    rxBytes.value = 0
    txBytes.value = 0
  } catch (err: any) {
    errorMsg.value = String(err)
  }
}

async function handleDisconnect() {
  if (!connectedPort.value) return
  errorMsg.value = ''
  try {
    if (loopTimer.value) {
      clearInterval(loopTimer.value)
      loopTimer.value = null
    }
    if (isRecording.value) {
      await stopRecording(connectedPort.value)
      isRecording.value = false
    }
    await closePort(connectedPort.value)
    connectedPort.value = null
  } catch (err: any) {
    errorMsg.value = String(err)
  }
}

async function toggleConnection() {
  if (connectedPort.value) {
    await handleDisconnect()
  } else {
    if (selectedPort.value) {
      await handleConnect(selectedPort.value)
    }
  }
}

async function executeSend() {
  if (!connectedPort.value || !sendText.value) return
  
  let payload: number[] = []
  
  let textToEcho = ''
  if (sendIsHex.value) {
    const hexStr = sendText.value.replace(/\s/g, '')
    for (let i = 0; i < hexStr.length; i += 2) {
      payload.push(parseInt(hexStr.substring(i, i + 2), 16))
    }
    textToEcho = payload.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
  } else {
    let str = sendText.value
    if (sendAddCR.value) str += '\r'
    if (sendAddLF.value) str += '\n'
    payload = Array.from(new TextEncoder().encode(str))
    textToEcho = str.replace(/\r?\n$/, '')
  }
  
  try {
    await writePort(connectedPort.value, payload)
    txBytes.value += payload.length
    
    const d = new Date()
    const timeStr = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${d.getMilliseconds().toString().padStart(3,'0')}`
    outputLines.value.push({
      direction: 'tx',
      text: textToEcho,
      timestamp: timeStr
    })
    
    if (outputLines.value.length > 5000) {
      outputLines.value.splice(0, outputLines.value.length - 5000)
    }
  } catch (err: any) {
    errorMsg.value = String(err)
    if (loopTimer.value) {
      clearInterval(loopTimer.value)
      loopTimer.value = null
    }
  }
}

async function handleSend() {
  if (!sendText.value || !connectedPort.value) return
  
  if (loopTimer.value) {
    // Stop looping
    clearInterval(loopTimer.value)
    loopTimer.value = null
    return
  }

  // Add to history
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

function clearTerminal() {
  outputLines.value = []
}

async function toggleDtr() {
  if (!connectedPort.value) return
  try {
    dtrState.value = !dtrState.value
    await setDtr(connectedPort.value, dtrState.value)
  } catch (err: any) {
    errorMsg.value = String(err)
    dtrState.value = !dtrState.value
  }
}

async function toggleRts() {
  if (!connectedPort.value) return
  try {
    rtsState.value = !rtsState.value
    await setRts(connectedPort.value, rtsState.value)
  } catch (err: any) {
    errorMsg.value = String(err)
    rtsState.value = !rtsState.value
  }
}

async function toggleRecording() {
  if (!connectedPort.value) return
  if (isRecording.value) {
    try {
      await stopRecording(connectedPort.value)
      isRecording.value = false
    } catch (err: any) {
      errorMsg.value = String(err)
    }
  } else {
    try {
      const filePath = await save({
        filters: [{
          name: 'Serial Lab Record',
          extensions: ['slab', 'log', 'txt']
        }]
      })
      if (filePath) {
        await startRecording(connectedPort.value, filePath)
        isRecording.value = true
      }
    } catch (err: any) {
      errorMsg.value = String(err)
    }
  }
}

onMounted(() => {
  refreshPorts()
})
</script>

<template>
  <div class="layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header" @mousedown="startDrag">
        <TerminalSquare class="logo-icon" :size="24" />
        <h1>Serial Lab</h1>
      </div>

      <div class="panel config-panel">
        <div class="panel-title">
          <span>Connection Settings</span>
        </div>
        
        <div class="form-group">
          <div class="label-row">
            <label>Serial Port</label>
            <button class="icon-btn-small" @click="refreshPorts" :disabled="loading || connectedPort !== null" title="Refresh Ports">
              <RefreshCw :size="12" :class="{ 'spin': loading }" />
            </button>
          </div>
          <select v-model="selectedPort" :disabled="connectedPort !== null">
            <option value="" disabled v-if="ports.length === 0">No ports found</option>
            <option v-for="port in ports" :key="port.portName" :value="port.portName">
              {{ port.portName.replace('/dev/', '') }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>Baud Rate</label>
          <select v-model="config.baudRate" :disabled="connectedPort !== null">
            <option v-for="rate in baudRates" :key="rate" :value="rate">{{ rate }}</option>
          </select>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Data Bits</label>
            <select v-model="config.dataBits" :disabled="connectedPort !== null">
              <option value="eight">8</option>
              <option value="seven">7</option>
              <option value="six">6</option>
              <option value="five">5</option>
            </select>
          </div>
          <div class="form-group">
            <label>Stop</label>
            <select v-model="config.stopBits" :disabled="connectedPort !== null">
              <option value="one">1</option>
              <option value="two">2</option>
            </select>
          </div>
        </div>
        
        <div class="form-group">
          <label>Parity</label>
          <select v-model="config.parity" :disabled="connectedPort !== null">
            <option value="none">None</option>
            <option value="odd">Odd</option>
            <option value="even">Even</option>
          </select>
        </div>

        <button 
          class="primary-btn big-connect-btn" 
          :class="{ 'connected-btn': connectedPort !== null }"
          @click="toggleConnection" 
          :disabled="!selectedPort && !connectedPort"
        >
          {{ connectedPort ? 'Disconnect' : 'Connect' }}
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main-content">
      <!-- Toolbar -->
      <header class="toolbar" @mousedown="startDrag">
        <div class="status-indicator">
          <div class="dot" :class="{ connected: connectedPort }" />
          <span class="status-text">{{ connectedPort ? connectedPort : 'Disconnected' }}</span>
        </div>
        
        <div class="toolbar-actions" v-if="connectedPort" @mousedown.stop>
          <button class="icon-btn toggle-btn" :class="{ active: isRecording }" @click="toggleRecording" title="Record to Disk">
            <Save :size="14" style="margin-right:4px;" />
            <span v-if="isRecording">Recording</span>
            <span v-else>Record</span>
          </button>
          <div class="divider" />
          <button class="icon-btn toggle-btn" :class="{ active: dtrState }" @click="toggleDtr" title="Data Terminal Ready">
            DTR
          </button>
          <button class="icon-btn toggle-btn" :class="{ active: rtsState }" @click="toggleRts" title="Request To Send">
            RTS
          </button>
        </div>
      </header>

      <!-- Terminal Area -->
      <div class="terminal-container">
        <div class="terminal-toolbar">
          <div class="stats">
            <Activity :size="14" />
            <span>RX: {{ rxBytes }} | TX: {{ txBytes }}</span>
          </div>
          <div class="terminal-actions">
            <label class="checkbox-label">
              <input type="checkbox" v-model="autoScroll" /> <span>Auto Scroll</span>
            </label>
            <button class="icon-btn" @click="clearTerminal" title="Clear output">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
        
        <div v-bind="containerProps" class="terminal-output">
          <div v-bind="wrapperProps">
            <div v-for="item in list" :key="item.index" class="line" :class="item.data.direction">
              <span class="timestamp">[{{ item.data.timestamp }}]</span>
              <span class="direction">[{{ item.data.direction === 'rx' ? 'RX' : 'TX' }}]</span>
              <span class="content">{{ item.data.text }}</span>
            </div>
            <div v-if="list.length === 0" class="empty-state">
              Waiting for data...
            </div>
          </div>
        </div>
      </div>

      <!-- Send Panel -->
      <div class="send-panel" :class="{ disabled: !connectedPort }">
        <div class="send-options">
          <label class="checkbox-label">
            <input type="checkbox" v-model="sendAddCR" :disabled="sendIsHex || loopTimer !== null"> <span>+CR</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="sendAddLF" :disabled="sendIsHex || loopTimer !== null"> <span>+LF</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="sendIsHex" :disabled="loopTimer !== null"> <span>HEX</span>
          </label>
          <div class="divider-horizontal" />
          <label class="checkbox-label">
            <input type="checkbox" v-model="isLoop" :disabled="loopTimer !== null"> <span>Loop</span>
          </label>
          <div class="loop-interval" v-if="isLoop">
            <input type="number" v-model="loopInterval" :disabled="loopTimer !== null" min="10" step="100"> ms
          </div>
        </div>
        <div class="send-input-row">
          <textarea 
            v-model="sendText" 
            placeholder="Type message... (Use ↑/↓ for history)" 
            @keydown.enter.prevent="handleSend"
            @keydown.up="handleHistoryUp"
            @keydown.down="handleHistoryDown"
            :disabled="!connectedPort || loopTimer !== null"
          />
          <button 
            class="primary-btn send-btn" 
            :class="{ 'danger-btn-stop': loopTimer !== null }"
            @click="handleSend" 
            :disabled="!connectedPort || (!sendText && loopTimer === null)"
          >
            <Send :size="16" v-if="!loopTimer" />
            <span>{{ loopTimer ? 'Stop' : 'Send' }}</span>
          </button>
        </div>
      </div>
      
      <!-- Global Error Toast -->
      <div v-if="errorMsg" class="error-toast">
        {{ errorMsg }}
        <button class="close-btn" @click="errorMsg = ''">&times;</button>
      </div>
    </main>
  </div>
</template>

<style>
/* Global reset and variables */
:root {
  --bg-app: #0f111a;
  --bg-panel: #1a1d27;
  --bg-input: #232736;
  --bg-hover: #2a2f42;
  --text-main: #e2e8f0;
  --text-muted: #94a3b8;
  --border: #2a2f42;
  
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --success: #10b981;
  --danger: #ef4444;
  --danger-hover: #dc2626;
  
  --radius: 6px;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
}

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background-color: var(--bg-app);
  color: var(--text-main);
  font-family: var(--font-sans);
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
}

* {
  box-sizing: border-box;
}

/* Custom Scrollbar */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: var(--bg-app);
}
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 5px;
  border: 2px solid var(--bg-app);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* Layout */
.layout {
  display: flex;
  height: 100vh;
  width: 100vw;
}

/* Sidebar */
.sidebar {
  width: 280px;
  background-color: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 16px;
  padding-top: 32px; /* For macOS traffic lights */
  gap: 24px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-main);
  cursor: grab;
}
.sidebar-header:active {
  cursor: grabbing;
}
.sidebar-header h1 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
}
.logo-icon {
  color: var(--accent);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ports-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.no-ports {
  font-size: 0.85rem;
  color: var(--text-muted);
  padding: 12px;
  text-align: center;
  background-color: var(--bg-app);
  border-radius: var(--radius);
  border: 1px dashed var(--border);
}

.port-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background-color: var(--bg-input);
  border-radius: var(--radius);
  border: 1px solid transparent;
  transition: all 0.2s;
}
.port-item:hover {
  border-color: var(--border);
}
.port-item.active {
  border-color: var(--success);
  background-color: rgba(16, 185, 129, 0.1);
}
.port-name {
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Forms */
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.form-row {
  display: flex;
  gap: 12px;
}
.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.form-group label {
  font-size: 0.8rem;
  color: var(--text-muted);
}
select, input:not([type="checkbox"]), textarea {
  background-color: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--text-main);
  border-radius: var(--radius);
  padding: 8px 12px;
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.2s;
  font-family: inherit;
  width: 100%;
}
select {
  appearance: none;
  background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394a3b8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
  background-repeat: no-repeat;
  background-position: right 12px top 50%;
  background-size: 10px auto;
  padding-right: 32px;
}
select:focus, input:focus, textarea:focus {
  border-color: var(--accent);
}
select:disabled, input:disabled, textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-btn-small {
  padding: 2px 4px;
  border-radius: 4px;
  color: var(--text-muted);
}
.icon-btn-small:hover:not(:disabled) {
  background-color: var(--bg-hover);
  color: var(--text-main);
}
.icon-btn-small:disabled {
  opacity: 0.3;
}
.big-connect-btn {
  margin-top: 12px;
  padding: 12px;
  font-size: 0.9rem;
  letter-spacing: 0.02em;
}
.connected-btn {
  background-color: var(--danger);
}
.connected-btn:hover:not(:disabled) {
  background-color: var(--danger-hover);
}

/* Main Content */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* Toolbar */
.toolbar {
  height: 56px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  cursor: grab;
}
.toolbar:active {
  cursor: grabbing;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: var(--text-muted);
}
.dot.connected {
  background-color: var(--success);
  box-shadow: 0 0 8px var(--success);
}
.status-text {
  font-size: 0.9rem;
  font-weight: 500;
}

/* Terminal */
.terminal-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-app);
  overflow: hidden;
}

.terminal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 24px;
  background-color: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
  gap: 12px;
}

.stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.terminal-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
}

.terminal-output {
  flex: 1;
  padding: 16px 24px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 22px;
  user-select: text;
  -webkit-user-select: text;
}

.line {
  padding: 2px 0;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.timestamp {
  color: var(--text-muted);
  font-size: 0.85em;
  user-select: none;
  flex-shrink: 0;
}
.direction {
  font-weight: bold;
  font-size: 0.85em;
  user-select: none;
  flex-shrink: 0;
}
.line.rx .direction {
  color: var(--success);
}
.line.tx .direction {
  color: var(--accent);
}
.content {
  flex: 1;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.line.tx .content {
  color: var(--text-main);
  opacity: 0.8;
}
.empty-state {
  color: var(--text-muted);
  font-style: italic;
  opacity: 0.5;
}

/* Send Panel */
.send-panel {
  padding: 16px 24px;
  background-color: var(--bg-panel);
  border-top: 1px solid var(--border);
}
.send-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 12px;
}
.send-options {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--text-main);
  cursor: pointer;
  white-space: nowrap;
  flex-wrap: nowrap;
}
.checkbox-label input[type="checkbox"] {
  appearance: auto;
  width: auto;
  height: auto;
  margin: 0;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
  accent-color: var(--accent);
}
.loop-interval {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--text-muted);
}
.loop-interval input {
  width: 70px;
  padding: 4px 8px;
  height: 24px;
}

.send-input-row {
  display: flex;
  gap: 12px;
}
.send-input-row textarea {
  flex: 1;
  height: 60px;
  resize: none;
  user-select: text;
  -webkit-user-select: text;
}
.send-btn {
  width: 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.danger-btn-stop {
  background-color: var(--danger);
  color: #fff;
  border: none;
}
.danger-btn-stop:hover {
  background-color: var(--danger-hover);
}

/* Buttons */
button {
  background: none;
  border: none;
  color: var(--text-main);
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.icon-btn {
  padding: 6px;
  border-radius: var(--radius);
  color: var(--text-muted);
  transition: all 0.2s;
}
.icon-btn:hover {
  background-color: var(--bg-hover);
  color: var(--text-main);
}
.toggle-btn {
  font-size: 0.8rem;
  font-weight: 600;
  padding: 4px 10px;
  background-color: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.toggle-btn.active {
  background-color: var(--success);
  color: #fff;
  border-color: var(--success);
}
.divider {
  width: 1px;
  height: 20px;
  background-color: var(--border);
  margin: 0 8px;
}
.connect-btn {
  font-size: 0.75rem;
  padding: 4px 10px;
  background-color: var(--accent);
  border-radius: 4px;
  font-weight: 500;
  transition: background-color 0.2s;
}
.connect-btn:hover:not(:disabled) {
  background-color: var(--accent-hover);
}
.connect-btn:disabled {
  background-color: var(--bg-hover);
  color: var(--text-muted);
}
.primary-btn {
  background-color: var(--accent);
  color: #fff;
  border-radius: var(--radius);
  font-weight: 600;
  transition: background-color 0.2s;
}
.primary-btn:hover:not(:disabled) {
  background-color: var(--accent-hover);
}
.danger-btn {
  padding: 8px 16px;
  gap: 8px;
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--danger);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius);
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s;
}
.danger-btn:hover {
  background-color: var(--danger);
  color: #fff;
}

/* Utilities */
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Toasts */
.error-toast {
  position: absolute;
  top: 24px;
  right: 24px;
  background-color: var(--danger);
  color: #fff;
  padding: 12px 24px;
  border-radius: var(--radius);
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  font-size: 0.9rem;
  animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 100;
}
.close-btn {
  font-size: 1.2rem;
  opacity: 0.8;
}
.close-btn:hover {
  opacity: 1;
}
@keyframes slideIn {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
</style>