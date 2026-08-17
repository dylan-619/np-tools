<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  Flame,
  RefreshCw,
  FolderOpen,
  Square,
  AlertTriangle,
  Terminal,
  Cpu,
  Trash2,
} from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'
import { useFlashStore } from '../stores/flashStore'
import { useSerialStore } from '../stores/serialStore'
import { useSjzdStore } from '../stores/sjzdStore'

const flash = useFlashStore()
const serial = useSerialStore()
const sjzd = useSjzdStore()

const autoBurnSnAfterFlash = ref(false)
const productionSn = ref('430125010001')

async function chooseHexFile() {
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: 'STM32 Firmware',
        extensions: ['hex', 'bin', 'elf'],
      },
    ],
  })
  if (selected && typeof selected === 'string') {
    flash.selectedHexPath = selected
    localStorage.setItem('np_tools_last_hex', selected)
  }
}

async function handleStartFlash() {
  await flash.startFlashing()

  // Optional Production Pipeline: Flash -> Serial Connect -> Write SN
  if (
    autoBurnSnAfterFlash.value &&
    flash.progress.state === 'success' &&
    serial.selectedPort &&
    productionSn.value.length === 12
  ) {
    flash.flashLogs.push(`[产线流水线] 正在尝试通过串口 ${serial.selectedPort} 自动写入 SN...`)
    try {
      if (!serial.connectedPort) {
        await serial.connect(serial.selectedPort)
      }
      await sjzd.burnSn(productionSn.value)
      flash.flashLogs.push(`[产线流水线] SN [${productionSn.value}] 自动烧录成功！`)
    } catch (e: any) {
      flash.flashLogs.push(`[产线流水线] 自动写入 SN 失败: ${e}`)
    }
  }
}

onMounted(() => {
  const savedHex = localStorage.getItem('np_tools_last_hex')
  if (savedHex && !flash.selectedHexPath) {
    flash.selectedHexPath = savedHex
  }
  flash.probeTool()
})
</script>

<template>
  <div class="view-container">
    <!-- Header -->
    <header class="view-header">
      <div class="title-col">
        <h2>STM32 ST-Link 固件烧录与产线流水线</h2>
        <p class="subtitle">
          集成 STM32CubeProgrammer CLI 工具链，支持 SWD 接口硬件复位烧录、全自动擦除校验及产线一键烧录写入 SN。
        </p>
      </div>

      <div class="actions-col">
        <button
          class="btn btn-secondary"
          :disabled="flash.isProbing || flash.isFlashing"
          @click="flash.probeTool()"
        >
          <RefreshCw :size="14" :class="{ spin: flash.isProbing }" />
          <span>重新检测探针与工具</span>
        </button>
      </div>
    </header>

    <!-- Tool Status Banner -->
    <div
      class="tool-status-card"
      :class="{ available: flash.toolInfo.isAvailable, unavailable: !flash.toolInfo.isAvailable }"
    >
      <div class="tool-status-left">
        <Cpu :size="20" class="tool-icon" />
        <div class="tool-info-text">
          <span class="tool-title">
            {{ flash.toolInfo.isAvailable ? 'STM32CubeProgrammer CLI 已就绪' : '未检测到 STM32CubeProgrammer CLI' }}
          </span>
          <span class="tool-path mono-text">
            {{ flash.toolInfo.cliPath || '请检查是否已安装 STM32CubeProgrammer 或在设置中手动配置绝对路径' }}
          </span>
        </div>
      </div>

      <div class="tool-status-right">
        <span
          class="status-pill"
          :class="{ ok: flash.toolInfo.isAvailable, err: !flash.toolInfo.isAvailable }"
        >
          {{ flash.toolInfo.isAvailable ? '就绪' : '不可用' }}
        </span>
      </div>
    </div>

    <!-- Error Banner -->
    <div v-if="flash.errorMsg" class="error-banner">
      <AlertTriangle :size="16" />
      <span>{{ flash.errorMsg }}</span>
    </div>

    <!-- Configuration Card -->
    <div class="section-card">
      <div class="card-header">
        <div class="header-left">
          <Flame :size="16" class="icon-flame" />
          <h3>烧录参数配置</h3>
        </div>
      </div>

      <div class="card-body form-grid">
        <!-- Target Hex File -->
        <div class="form-group span-2">
          <label>目标固件文件 (.hex / .bin)</label>
          <div class="input-with-button">
            <input
              v-model="flash.selectedHexPath"
              type="text"
              placeholder="请选择或粘贴固件绝对路径..."
              class="form-input mono-text"
              :disabled="flash.isFlashing"
            />
            <button
              class="btn btn-secondary"
              :disabled="flash.isFlashing"
              @click="chooseHexFile"
            >
              <FolderOpen :size="15" />
              <span>浏览选择文件</span>
            </button>
          </div>
        </div>

        <!-- Probe Selector -->
        <div class="form-group">
          <label>ST-Link 调试器探针</label>
          <select
            v-model="flash.selectedProbeSn"
            class="form-select"
            :disabled="flash.isFlashing || flash.toolInfo.probes.length === 0"
          >
            <option v-if="flash.toolInfo.probes.length === 0" value="">
              未检测到 ST-Link 探针 (使用默认首个设备)
            </option>
            <option
              v-for="probe in flash.toolInfo.probes"
              :key="probe.serialNumber"
              :value="probe.serialNumber"
            >
              {{ probe.description }}
            </option>
          </select>
        </div>

        <!-- Connection Parameters Display -->
        <div class="form-group">
          <label>SWD 连接协议配置</label>
          <div class="swd-params-box mono-text">
            <span>port=SWD</span>
            <span>mode=UR (复位下连接)</span>
            <span>freq=4000kHz</span>
          </div>
        </div>

        <!-- Pipeline Auto-SN Checkbox -->
        <div class="form-group span-2 pipeline-box">
          <label class="checkbox-label">
            <input
              v-model="autoBurnSnAfterFlash"
              type="checkbox"
              :disabled="flash.isFlashing"
            />
            <span class="label-bold">产线一键流水线：固件烧录成功后自动通过串口写入 SN</span>
          </label>

          <div v-if="autoBurnSnAfterFlash" class="pipeline-inputs">
            <div class="sn-input-wrapper">
              <label>生产 SN 序列号：</label>
              <input
                v-model="productionSn"
                type="text"
                maxlength="12"
                placeholder="4301xxxxxxxx"
                class="form-input mono-text"
                :disabled="flash.isFlashing"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Action Button Row -->
      <div class="card-footer">
        <button
          v-if="!flash.isFlashing"
          class="btn btn-flash-start"
          :disabled="!flash.toolInfo.isAvailable || !flash.selectedHexPath || flash.isFlashing"
          @click="handleStartFlash"
        >
          <Flame :size="16" />
          <span>开始 SWD 硬件烧录 (Erase + Write + Verify)</span>
        </button>

        <button
          v-else
          class="btn btn-danger"
          @click="flash.cancelFlashing"
        >
          <Square :size="16" />
          <span>取消烧录任务</span>
        </button>
      </div>
    </div>

    <!-- Progress Card -->
    <div v-if="flash.progress.state !== 'idle'" class="section-card">
      <div class="card-header">
        <div class="header-left">
          <h3>烧录执行进度</h3>
        </div>
        <span class="progress-state-pill" :class="flash.progress.state">
          {{ flash.progress.state.toUpperCase() }}
        </span>
      </div>

      <div class="card-body">
        <div class="progress-bar-container">
          <div
            class="progress-bar-fill"
            :class="flash.progress.state"
            :style="{ width: `${flash.progress.percent}%` }"
          />
        </div>

        <div class="progress-meta">
          <span class="progress-msg">{{ flash.progress.message }}</span>
          <span class="progress-pct mono-text">{{ flash.progress.percent }}%</span>
        </div>
      </div>
    </div>

    <!-- Log Console -->
    <div class="section-card">
      <div class="card-header">
        <div class="header-left">
          <Terminal :size="15" />
          <h3>STM32CubeProgrammer 烧录控制台输出</h3>
        </div>
        <button
          class="icon-btn-micro"
          title="清空日志"
          @click="flash.clearLogs"
        >
          <Trash2 :size="14" />
        </button>
      </div>

      <div class="card-body log-console-body">
        <div class="flash-log-terminal mono-text">
          <div v-for="(log, i) in flash.flashLogs" :key="i" class="log-line">
            {{ log }}
          </div>
          <div v-if="flash.flashLogs.length === 0" class="empty-log-hint">
            准备就绪，点击【开始 SWD 硬件烧录】启动任务并捕获 CLI 实时输出...
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view-container {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1100px;
}

.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.title-col h2 {
  margin: 0 0 6px 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-main, #e2e8f0);
}
.subtitle {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-muted, #94a3b8);
}

.tool-status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid var(--border, #2a2f42);
  background: var(--bg-panel, #1a1d27);
}
.tool-status-card.available {
  border-left: 4px solid #10b981;
}
.tool-status-card.unavailable {
  border-left: 4px solid #f59e0b;
}

.tool-status-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tool-icon {
  color: #3b82f6;
}

.tool-info-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tool-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-main, #e2e8f0);
}
.tool-path {
  font-size: 0.72rem;
  color: var(--text-muted, #94a3b8);
}

.status-pill {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}
.status-pill.ok {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
}
.status-pill.err {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 6px;
  color: #fca5a5;
  font-size: 0.82rem;
}

.section-card {
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 8px;
  overflow: hidden;
}

.card-header {
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.15);
  border-bottom: 1px solid var(--border, #2a2f42);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.header-left h3 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-main, #e2e8f0);
}

.icon-flame {
  color: #f97316;
}

.card-body {
  padding: 18px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.span-2 {
  grid-column: span 2;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-group label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-main, #e2e8f0);
}

.input-with-button {
  display: flex;
  gap: 8px;
}

.form-input,
.form-select {
  width: 100%;
  padding: 8px 10px;
  background: var(--bg-input, #232736);
  border: 1px solid var(--border, #2a2f42);
  color: #fff;
  border-radius: 6px;
  font-size: 0.85rem;
  outline: none;
}
.form-input:focus,
.form-select:focus {
  border-color: var(--accent, #3b82f6);
}

.mono-text {
  font-family: var(--font-mono, monospace);
}

.swd-params-box {
  display: flex;
  gap: 10px;
  background: var(--bg-input, #232736);
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border, #2a2f42);
  font-size: 0.75rem;
  color: #93c5fd;
}

.pipeline-box {
  background: rgba(0, 0, 0, 0.15);
  padding: 12px;
  border-radius: 6px;
  border: 1px dashed var(--border, #2a2f42);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  cursor: pointer;
}
.label-bold {
  font-weight: 600;
  color: #fb923c;
}

.pipeline-inputs {
  display: flex;
  gap: 12px;
}
.sn-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--text-muted, #94a3b8);
}
.sn-input-wrapper input {
  width: 180px;
}

.card-footer {
  padding: 12px 18px;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid var(--border, #2a2f42);
  display: flex;
  justify-content: flex-end;
}

.btn-flash-start {
  background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
  color: #fff;
  padding: 10px 22px;
  font-size: 0.88rem;
  font-weight: 600;
}
.btn-flash-start:hover:not(:disabled) {
  background: linear-gradient(135deg, #fb923c 0%, #f97316 100%);
}

.progress-state-pill {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
}
.progress-state-pill.programming {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}
.progress-state-pill.verifying {
  background: rgba(168, 85, 247, 0.2);
  color: #c084fc;
}
.progress-state-pill.success {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}
.progress-state-pill.error {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.progress-bar-container {
  height: 10px;
  background: var(--bg-input, #232736);
  border-radius: 5px;
  overflow: hidden;
  margin-bottom: 8px;
}
.progress-bar-fill {
  height: 100%;
  background: #3b82f6;
  border-radius: 5px;
  transition: width 0.2s ease;
}
.progress-bar-fill.success {
  background: #10b981;
}
.progress-bar-fill.error {
  background: #ef4444;
}

.progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.8rem;
}
.progress-msg {
  color: var(--text-main, #e2e8f0);
}
.progress-pct {
  font-weight: bold;
  color: var(--accent, #3b82f6);
}

.log-console-body {
  padding: 10px;
  background: var(--bg-app, #0f111a);
}

.flash-log-terminal {
  height: 180px;
  overflow-y: auto;
  font-size: 0.78rem;
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: #cbd5e1;
}

.log-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.empty-log-hint {
  color: var(--text-muted, #94a3b8);
  text-align: center;
  padding-top: 60px;
}

.icon-btn-micro {
  background: transparent;
  border: none;
  color: var(--text-muted, #94a3b8);
  cursor: pointer;
  padding: 4px;
}
.icon-btn-micro:hover {
  color: #fff;
}

.btn {
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
  transition: all 0.15s;
}
.btn-secondary {
  background: var(--bg-input, #232736);
  color: var(--text-main, #e2e8f0);
  border-color: var(--border, #2a2f42);
}
.btn-secondary:hover:not(:disabled) {
  background: #2e3448;
}
.btn-danger {
  background: #ef4444;
  color: #fff;
}
.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  100% {
    transform: rotate(360deg);
  }
}
</style>
