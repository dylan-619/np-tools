<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RefreshCw, Activity, Power, Sliders } from 'lucide-vue-next'
import { useSerialStore } from '../../stores/serialStore'

const serial = useSerialStore()
const showSettings = ref(false)

const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000, 2000000]

onMounted(() => {
  serial.refreshPorts()
})
</script>

<template>
  <div class="global-serial-card">
    <div class="card-header">
      <div class="status-indicator">
        <span class="status-dot" :class="{ connected: !!serial.connectedPort }" />
        <span class="status-title">
          {{ serial.connectedPort ? '串口已连接' : '串口未连接' }}
        </span>
      </div>

      <div class="header-actions">
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
    <div class="port-row">
      <select
        v-model="serial.selectedPort"
        class="port-select"
        :disabled="!!serial.connectedPort"
      >
        <option v-if="serial.ports.length === 0" value="" disabled>无可用串口</option>
        <option
          v-for="p in serial.ports"
          :key="p.portName"
          :value="p.portName"
        >
          {{ p.portName.replace('/dev/', '') }}
        </option>
      </select>

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
    <div v-if="showSettings" class="advanced-config-box">
      <div class="config-item">
        <label>波特率</label>
        <select v-model="serial.config.baudRate" :disabled="!!serial.connectedPort">
          <option v-for="r in baudRates" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>
      <div class="config-grid-2">
        <div class="config-item">
          <label>数据位</label>
          <select v-model="serial.config.dataBits" :disabled="!!serial.connectedPort">
            <option value="eight">8</option>
            <option value="seven">7</option>
          </select>
        </div>
        <div class="config-item">
          <label>校验位</label>
          <select v-model="serial.config.parity" :disabled="!!serial.connectedPort">
            <option value="none">无 (None)</option>
            <option value="odd">奇 (Odd)</option>
            <option value="even">偶 (Even)</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Active Details: RX/TX Counters & Pins -->
    <div v-if="serial.connectedPort" class="live-status-bar">
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

    <div v-if="serial.errorMsg" class="serial-error-hint">
      {{ serial.errorMsg }}
    </div>
  </div>
</template>

<style scoped>
.global-serial-card {
  background-color: var(--bg-input, #232736);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  background-color: var(--text-muted, #94a3b8);
  transition: all 0.2s ease;
}
.status-dot.connected {
  background-color: var(--success, #10b981);
  box-shadow: 0 0 6px var(--success, #10b981);
}

.status-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-main, #e2e8f0);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon-btn-micro {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted, #94a3b8);
  border-radius: 4px;
  padding: 2px 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.icon-btn-micro:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.icon-btn-micro.active {
  color: var(--accent, #3b82f6);
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

.port-select {
  flex: 1;
  font-size: 0.8rem;
  padding: 5px 8px;
  background-color: var(--bg-app, #0f111a);
  border: 1px solid var(--border, #2a2f42);
  color: var(--text-main, #e2e8f0);
  border-radius: 5px;
  outline: none;
  font-family: var(--font-mono, monospace);
  min-width: 0;
}

.connect-action-btn {
  padding: 5px 10px;
  background-color: var(--accent, #3b82f6);
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
  background-color: var(--accent-hover, #2563eb);
}
.connect-action-btn.connected {
  background-color: var(--danger, #ef4444);
}
.connect-action-btn.connected:hover:not(:disabled) {
  background-color: #dc2626;
}
.connect-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.advanced-config-box {
  background: var(--bg-app, #0f111a);
  border: 1px solid var(--border, #2a2f42);
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
  color: var(--text-muted, #94a3b8);
}
.config-item select {
  font-size: 0.75rem;
  padding: 4px 6px;
  background-color: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  color: var(--text-main, #e2e8f0);
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
  border-top: 1px dashed var(--border, #2a2f42);
  font-size: 0.72rem;
  font-family: var(--font-mono, monospace);
  color: var(--text-muted, #94a3b8);
}

.rx-tx-metrics {
  display: flex;
  align-items: center;
  gap: 4px;
}
.activity-icon {
  color: var(--accent, #3b82f6);
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
  background: var(--bg-app, #0f111a);
  border: 1px solid var(--border, #2a2f42);
  color: var(--text-muted, #94a3b8);
  border-radius: 3px;
  cursor: pointer;
}
.pin-btn.active {
  background: rgba(59, 130, 246, 0.2);
  border-color: var(--accent, #3b82f6);
  color: var(--accent, #3b82f6);
  font-weight: bold;
}

.serial-error-hint {
  font-size: 0.7rem;
  color: #ef4444;
  word-break: break-all;
  padding: 4px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 4px;
}
</style>
