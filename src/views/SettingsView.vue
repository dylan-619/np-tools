<script setup lang="ts">
import { ref } from 'vue'
import { Settings, Save, CheckCircle2, Cpu, Info, FolderOpen } from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'
import { useFlashStore } from '../stores/flashStore'
import { useSerialStore } from '../stores/serialStore'
import CustomSelect from '../components/common/CustomSelect.vue'

const flash = useFlashStore()
const serial = useSerialStore()

const savedSuccess = ref(false)

const baudRateOptions = [
  { label: '9600', value: 9600 },
  { label: '19200', value: 19200 },
  { label: '38400', value: 38400 },
  { label: '57600', value: 57600 },
  { label: '115200 (推荐默认)', value: 115200 },
  { label: '230400', value: 230400 },
  { label: '921600', value: 921600 },
]

const dataBitOptions = [
  { label: '8 数据位 (标准)', value: 'eight' },
  { label: '7 数据位', value: 'seven' },
]

const parityOptions = [
  { label: '无校验 (None)', value: 'none' },
  { label: '奇校验 (Odd)', value: 'odd' },
  { label: '偶校验 (Even)', value: 'even' },
]

async function chooseCliPath() {
  try {
    const selected = await open({
      multiple: false,
      directory: false,
      title: '选择 STM32_Programmer_CLI 可执行程序',
    })
    if (selected && typeof selected === 'string') {
      flash.customCliPath = selected
      await flash.probeTool(selected)
    }
  } catch (err) {
    console.error('打开 CLI 路径选择对话框失败:', err)
  }
}

function saveSettings() {
  savedSuccess.value = true
  setTimeout(() => {
    savedSuccess.value = false
  }, 2500)
}
</script>

<template>
  <div class="view-container">
    <!-- Header -->
    <header class="view-header">
      <div class="title-col">
        <h2>应用全局设置与工具链配置</h2>
        <p class="subtitle">
          配置底层烧录工具链绝对路径、默认串口通信参数及系统偏好设置。
        </p>
      </div>

      <div class="actions-col">
        <button class="btn btn-primary" @click="saveSettings">
          <Save :size="14" />
          <span>保存配置</span>
        </button>
      </div>
    </header>

    <!-- Save Success Hint -->
    <transition name="fade">
      <div v-if="savedSuccess" class="alert-banner success">
        <CheckCircle2 :size="16" />
        <span>设置已保存至本地配置。</span>
      </div>
    </transition>

    <!-- Section 1: STM32 Programmer Toolchain -->
    <div class="section-card">
      <div class="card-header">
        <div class="header-left">
          <Cpu :size="16" class="icon-blue" />
          <h3>STM32CubeProgrammer CLI 工具链路径</h3>
        </div>
      </div>

      <div class="card-body">
        <div class="form-group">
          <label>CLI 绝对执行路径 (STM32_Programmer_CLI)</label>
          <div class="input-with-button">
            <input
              v-model="flash.customCliPath"
              type="text"
              class="form-input mono-text"
              placeholder="例如: /Applications/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI"
            />
            <button class="btn btn-secondary" @click="chooseCliPath">
              <FolderOpen :size="14" />
              <span>选择路径</span>
            </button>
          </div>
          <span class="field-hint">
            如不填写则自动探测系统 <code>PATH</code> 及 ST 默认安装路径。
          </span>
        </div>
      </div>
    </div>

    <!-- Section 2: Default Serial Config -->
    <div class="section-card">
      <div class="card-header">
        <div class="header-left">
          <Settings :size="16" class="icon-blue" />
          <h3>默认串口连接参数 (标准: 115200 8N1)</h3>
        </div>
      </div>

      <div class="card-body form-grid-3">
        <div class="form-group">
          <label>默认波特率</label>
          <CustomSelect
            v-model="serial.config.baudRate"
            :options="baudRateOptions"
            mono
          />
        </div>

        <div class="form-group">
          <label>默认数据位</label>
          <CustomSelect
            v-model="serial.config.dataBits"
            :options="dataBitOptions"
          />
        </div>

        <div class="form-group">
          <label>默认校验位</label>
          <CustomSelect
            v-model="serial.config.parity"
            :options="parityOptions"
          />
        </div>
      </div>
    </div>

    <!-- Section 3: About Application -->
    <div class="section-card">
      <div class="card-header">
        <div class="header-left">
          <Info :size="16" class="icon-purple" />
          <h3>关于 NP-Tools 硬件调试平台</h3>
        </div>
      </div>

      <div class="card-body about-box">
        <div class="about-item">
          <span class="about-label">软件版本：</span>
          <span class="about-val">v2.0.0 (Tauri v2 + Rust Actor Architecture)</span>
        </div>
        <div class="about-item">
          <span class="about-label">支持硬件产品线：</span>
          <span class="about-val">SJZDV3 星闪现场采集终端、智能控制器（规划中）</span>
        </div>
        <div class="about-item">
          <span class="about-label">底层通信引擎：</span>
          <span class="about-val">Tokio Async Serial Engine (33ms 批次聚合 / 零拷贝磁盘流录制)</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view-container {
  padding: var(--page-gutter, 12px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--color-border-subtle, #24323d);
  background: var(--color-surface-1, #111820);
  border-radius: var(--radius-sm, 5px);
}

.title-col h2 {
  margin: 0 0 3px 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-main, #e2e8f0);
}
.subtitle {
  margin: 0;
  font-size: 0.74rem;
  color: var(--text-muted, #94a3b8);
}

.success-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 6px;
  color: #34d399;
  font-size: 0.82rem;
}

.section-card {
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: var(--radius-sm, 5px);
  overflow: hidden;
}

.card-header {
  min-height: 38px;
  padding: 8px 12px;
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

.icon-blue {
  color: #3b82f6;
}
.icon-purple {
  color: #a855f7;
}

.card-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-grid-3 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
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
  min-height: var(--control-height, 32px);
  padding: 6px 9px;
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

.field-hint {
  font-size: 0.72rem;
  color: var(--text-muted, #94a3b8);
}
.field-hint code {
  color: #93c5fd;
  font-family: var(--font-mono, monospace);
}

.about-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 0.82rem;
}

.about-item {
  display: flex;
  gap: 10px;
}
.about-label {
  color: var(--text-muted, #94a3b8);
  width: 140px;
  flex-shrink: 0;
}
.about-val {
  color: var(--text-main, #e2e8f0);
  font-weight: 500;
}

.btn {
  min-height: var(--control-height, 32px);
  padding: 6px 10px;
  border-radius: var(--radius-xs, 3px);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
}
.btn-primary {
  background: var(--accent, #3b82f6);
  color: #fff;
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover, #2563eb);
}
.btn-secondary {
  background: var(--bg-input, #232736);
  color: var(--text-main, #e2e8f0);
  border-color: var(--border, #2a2f42);
}
.btn-secondary:hover:not(:disabled) {
  background: #2e3448;
}
</style>
