<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, Activity, Power, Sliders } from 'lucide-vue-next'
import { useSerialStore } from '../../stores/serialStore'
import CustomSelect from '../common/CustomSelect.vue'
import { formatSerialConfig } from '../../utils/serialFormat'

defineProps<{ compact?: boolean }>()

const serial = useSerialStore()
const showSettings = ref(false)

const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000, 2000000]

const portOptions = computed(() =>
  serial.ports.map((p) => ({
    label: p.portName.replace('/dev/', ''),
    value: p.portName,
  }))
)

const dataBitOptions = [
  { label: '8 位', value: 'eight' },
  { label: '7 位', value: 'seven' },
]

const parityOptions = [
  { label: '无 (None)', value: 'none' },
  { label: '奇 (Odd)', value: 'odd' },
  { label: '偶 (Even)', value: 'even' },
]

const stopBitOptions = [
  { label: '1 位', value: 'one' },
  { label: '2 位', value: 'two' },
]

const flowControlOptions = [
  { label: '无', value: 'none' },
  { label: 'XON/XOFF', value: 'software' },
  { label: 'RTS/CTS', value: 'hardware' },
]

const serialConfigSummary = computed(() => formatSerialConfig(serial.config))

onMounted(() => {
  serial.refreshPorts()
})
</script>

<template>
  <div class="global-serial-card" :class="{ compact }">
    <div class="card-header">
      <div class="status-indicator">
        <span class="status-dot" :class="{ connected: !!serial.connectedPort }" />
        <span v-if="!compact" class="status-copy">
          <strong>{{ serial.connectedPort ? '串口已连接' : '串口未连接' }}</strong>
          <small>{{ serialConfigSummary }}</small>
        </span>
      </div>

      <div v-if="!compact" class="header-actions">
        <button
          class="icon-btn-micro"
          :title="showSettings ? '隐藏配置' : '展开参数配置'"
          :class="{ active: showSettings }"
          @click="showSettings = !showSettings"
        >
          <Sliders :size="13" />
        </button>
        <button
          class="icon-btn-micro"
          title="刷新串口列表"
          :disabled="serial.loading || !!serial.connectedPort"
          @click="serial.refreshPorts"
        >
          <RefreshCw :size="13" :class="{ spin: serial.loading }" />
        </button>
      </div>
    </div>

    <!-- Port Selector & Connect Button -->
    <div v-if="!compact" class="port-row">
      <div class="port-select-wrapper">
        <CustomSelect
          v-model="serial.selectedPort"
          :options="portOptions"
          :placeholder="serial.ports.length === 0 ? '无可用串口' : '选择串口'"
          :disabled="!!serial.connectedPort"
          size="sm"
          mono
        />
      </div>

      <button
        class="connect-action-btn"
        :class="{ connected: !!serial.connectedPort }"
        :disabled="!serial.selectedPort && !serial.connectedPort"
        @click="serial.toggleConnection"
        :title="serial.connectedPort ? '断开串口' : '打开串口'"
      >
        <Power :size="14" />
        <span>{{ serial.connectedPort ? '断开' : '连接' }}</span>
      </button>
    </div>

    <!-- Expandable Advanced Config -->
    <div v-if="showSettings && !compact" class="advanced-config-box">
      <div class="config-item">
        <label>波特率</label>
        <CustomSelect
          v-model="serial.config.baudRate"
          :options="baudRates"
          :disabled="!!serial.connectedPort"
          size="sm"
          mono
        />
      </div>
      <div class="config-grid-2">
        <div class="config-item">
          <label>数据位</label>
          <CustomSelect
            v-model="serial.config.dataBits"
            :options="dataBitOptions"
            :disabled="!!serial.connectedPort"
            size="sm"
          />
        </div>
        <div class="config-item">
          <label>校验位</label>
          <CustomSelect
            v-model="serial.config.parity"
            :options="parityOptions"
            :disabled="!!serial.connectedPort"
            size="sm"
          />
        </div>
        <div class="config-item">
          <label>停止位</label>
          <CustomSelect
            v-model="serial.config.stopBits"
            :options="stopBitOptions"
            :disabled="!!serial.connectedPort"
            size="sm"
          />
        </div>
        <div class="config-item">
          <label>流控</label>
          <CustomSelect
            v-model="serial.config.flowControl"
            :options="flowControlOptions"
            :disabled="!!serial.connectedPort"
            size="sm"
          />
        </div>
      </div>
    </div>

    <!-- Active Details: RX/TX Counters & Pins -->
    <div v-if="serial.connectedPort && !compact" class="live-status-bar">
      <div class="rx-tx-metrics">
        <Activity :size="12" class="activity-icon" />
        <span>RX: {{ serial.rxBytes }}B</span>
        <span class="sep">|</span>
        <span>TX: {{ serial.txBytes }}B</span>
      </div>

      <div class="pins-control">
        <button
          class="pin-btn"
          :class="{ active: serial.dtrState }"
          @click="serial.toggleDtr"
          title="Data Terminal Ready"
        >
          DTR
        </button>
        <button
          class="pin-btn"
          :class="{ active: serial.rtsState }"
          @click="serial.toggleRts"
          title="Request To Send"
        >
          RTS
        </button>
      </div>
    </div>

    <div v-if="serial.errorMsg && !compact" class="serial-error-hint">
      {{ serial.errorMsg }}
    </div>
  </div>
</template>

<style scoped>
.global-serial-card {
  background-color: var(--color-surface-2, #f7f9fb);
  border: 1px solid var(--color-border-subtle, #d5dde4);
  border-radius: var(--radius-sm, 5px);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.global-serial-card.compact {
  padding: 6px;
  align-items: center;
}

.global-serial-card.compact .card-header {
  width: 100%;
  justify-content: center;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--text-muted, #40515f);
  transition: all 0.2s ease;
}
.status-dot.connected {
  background-color: var(--color-success, #176b45);
  box-shadow: 0 0 0 3px rgba(56, 178, 118, 0.12);
}

.status-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.status-copy strong {
  font-size: 0.76rem;
  font-weight: 650;
  color: var(--text-main, #17212b);
}

.status-copy small {
  color: var(--color-text-tertiary, #5f6f7d);
  font: 0.62rem var(--font-mono, monospace);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon-btn-micro {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted, #40515f);
  border-radius: 4px;
  min-width: 24px;
  min-height: 24px;
  padding: 2px 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.icon-btn-micro:hover:not(:disabled) {
  background: #e5ebf0;
  color: #17212b;
}
.icon-btn-micro.active {
  color: var(--accent, #1769aa);
  background: rgba(59, 130, 246, 0.1);
}

.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  100% {
    transform: rotate(360deg);
  }
}

.port-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.port-select-wrapper {
  flex: 1;
  min-width: 0;
}

.connect-action-btn {
  min-height: var(--control-height-dense, 28px);
  padding: 4px 9px;
  background-color: var(--accent, #1769aa);
  color: #fff;
  border: none;
  border-radius: 5px;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s;
  white-space: nowrap;
}
.connect-action-btn:hover:not(:disabled) {
  background-color: var(--accent-hover, #1769aa);
}
.connect-action-btn.connected {
  background-color: #fdebed;
  border: 1px solid #d58b90;
  color: #8f2028;
}
.connect-action-btn.connected:hover:not(:disabled) {
  background-color: rgba(223, 91, 91, 0.14);
}
.connect-action-btn:disabled {
  background: var(--color-surface-1, #ffffff);
  color: var(--color-text-disabled, #667784);
  opacity: 1;
  cursor: not-allowed;
}

.advanced-config-box {
  background: var(--bg-app, #edf1f4);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 6px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.config-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.config-item label {
  font-size: 0.7rem;
  color: var(--text-muted, #40515f);
}
.config-item select {
  font-size: 0.75rem;
  padding: 4px 6px;
  background-color: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  color: var(--text-main, #17212b);
  border-radius: 4px;
}

.config-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.live-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 4px;
  border-top: 1px dashed var(--border, #b9c5cf);
  font-size: 0.72rem;
  font-family: var(--font-mono, monospace);
  color: var(--text-muted, #40515f);
}

.rx-tx-metrics {
  display: flex;
  align-items: center;
  gap: 4px;
}
.activity-icon {
  color: var(--accent, #1769aa);
}
.sep {
  opacity: 0.4;
}

.pins-control {
  display: flex;
  gap: 4px;
}

.pin-btn {
  padding: 1px 5px;
  font-size: 0.68rem;
  background: var(--bg-app, #edf1f4);
  border: 1px solid var(--border, #b9c5cf);
  color: var(--text-muted, #40515f);
  border-radius: 3px;
  cursor: pointer;
}
.pin-btn.active {
  background: rgba(59, 130, 246, 0.2);
  border-color: var(--accent, #1769aa);
  color: var(--accent, #1769aa);
  font-weight: bold;
}

.serial-error-hint {
  font-size: 0.7rem;
  color: #8f2028;
  word-break: break-all;
  padding: 4px;
  background: rgba(223, 91, 91, 0.1);
  border-radius: 4px;
}
</style>
