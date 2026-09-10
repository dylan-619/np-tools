<script setup lang="ts">
import { ref } from 'vue'
import { Settings, Save, CheckCircle2, Cpu, Info, FolderOpen } from 'lucide-vue-next'
import { open } from '@tauri-apps/plugin-dialog'
import { useFlashStore } from '../stores/flashStore'
import { useSerialStore } from '../stores/serialStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import CustomSelect from '../components/common/CustomSelect.vue'
import { formatSerialConfig } from '../utils/serialFormat'

const flash = useFlashStore()
const serial = useSerialStore()
const workspace = useWorkspaceStore()

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

const stopBitOptions = [
  { label: '1 停止位', value: 'one' },
  { label: '2 停止位', value: 'two' },
]

const flowControlOptions = [
  { label: '无流控 (None)', value: 'none' },
  { label: '软件流控 (XON/XOFF)', value: 'software' },
  { label: '硬件流控 (RTS/CTS)', value: 'hardware' },
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

async function chooseWorkspaceRoot() {
  try {
    const selected = await open({
      multiple: false,
      directory: true,
      title: '选择 NP-Tools 本地工作空间',
    })
    if (selected && typeof selected === 'string') {
      await workspace.setRoot(selected)
    }
  } catch (err) {
    console.error('初始化工作空间失败:', err)
  }
}

function saveSettings() {
  serial.persistConfig()
  flash.persistCustomCliPath()
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

    <!-- Section 1: Local device workspace -->
    <div class="section-card workspace-card">
      <div class="card-header">
        <div class="header-left">
          <FolderOpen :size="16" class="icon-blue" />
          <h3>本地设备工作空间</h3>
        </div>
        <span class="local-mode-badge">本地模式</span>
      </div>

      <div class="card-body">
        <div class="form-group">
          <label>工作目录</label>
          <div class="input-with-button">
            <input
              :value="workspace.rootPath"
              type="text"
              class="form-input mono-text"
              readonly
              placeholder="尚未选择工作空间"
            />
            <button class="btn btn-secondary" :disabled="workspace.busy" @click="chooseWorkspaceRoot">
              <FolderOpen :size="14" />
              <span>{{ workspace.rootPath ? '更换目录' : '选择目录' }}</span>
            </button>
          </div>
          <span class="field-hint">
            导入 KZ3 配置后，将按 <code>devices/KZ3/设备 SN/configurations</code>
            保存版本；以后连接并读到相同 SN 时自动加载。平台组织、项目和注册 ID 本期不要求填写。
          </span>
        </div>
        <div
          v-if="workspace.lastMessage"
          class="workspace-message"
          :class="{ error: !workspace.lastMessageSuccess }"
        >
          {{ workspace.lastMessage }}
        </div>
      </div>
    </div>

    <!-- Section 2: STM32 Programmer Toolchain -->
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

    <!-- Section 3: Default Serial Config -->
    <div class="section-card">
      <div class="card-header">
        <div class="header-left">
          <Settings :size="16" class="icon-blue" />
          <h3>默认串口连接参数（当前：{{ formatSerialConfig(serial.config) }}）</h3>
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

        <div class="form-group">
          <label>默认停止位</label>
          <CustomSelect
            v-model="serial.config.stopBits"
            :options="stopBitOptions"
          />
        </div>

        <div class="form-group">
          <label>默认流控</label>
          <CustomSelect
            v-model="serial.config.flowControl"
            :options="flowControlOptions"
          />
        </div>
      </div>
    </div>

    <!-- Section 4: About Application -->
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
          <span class="about-val">v1.0.4 (Tauri v2 + Rust Actor Architecture)</span>
        </div>
        <div class="about-item">
          <span class="about-label">支持硬件产品线：</span>
          <span class="about-val">SJZDV3 星闪现场采集终端、KZ3 F427 智能控制器</span>
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
  border: 1px solid var(--color-border-subtle, #d5dde4);
  background: var(--color-surface-1, #ffffff);
  border-radius: var(--radius-sm, 5px);
}

.title-col h2 {
  margin: 0 0 3px 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-main, #17212b);
}
.subtitle {
  margin: 0;
  font-size: 0.74rem;
  color: var(--text-muted, #40515f);
}

.success-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 6px;
  color: #176b45;
  font-size: 0.82rem;
}

.section-card {
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: var(--radius-sm, 5px);
  overflow: hidden;
}

.card-header {
  min-height: 38px;
  padding: 8px 12px;
  background: #eef3f7;
  border-bottom: 1px solid var(--border, #b9c5cf);
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
  color: var(--text-main, #17212b);
}

.icon-blue {
  color: #1769aa;
}
.icon-purple {
  color: #6f3a96;
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
  color: var(--text-main, #17212b);
}

.input-with-button {
  display: flex;
  gap: 8px;
}

.input-with-button > .btn {
  min-width: 96px;
  flex: 0 0 auto;
  white-space: nowrap;
}

.form-input,
.form-select {
  width: 100%;
  min-height: var(--control-height, 32px);
  padding: 6px 9px;
  background: var(--bg-input, #f7f9fb);
  border: 1px solid var(--border, #b9c5cf);
  color: #17212b;
  border-radius: 6px;
  font-size: 0.85rem;
  outline: none;
}
.form-input:focus,
.form-select:focus {
  border-color: var(--accent, #1769aa);
}

.mono-text {
  font-family: var(--font-mono, monospace);
}

.field-hint {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
}

.local-mode-badge {
  padding: 3px 7px;
  border: 1px solid #a9bdca;
  border-radius: 999px;
  background: #f7fafc;
  color: #40515f;
  font-size: 0.7rem;
  font-weight: 700;
}

.workspace-message {
  padding: 7px 9px;
  border-left: 3px solid var(--color-success, #176b45);
  background: #edf8f2;
  color: #176b45;
  font-size: 0.78rem;
  line-height: 1.45;
}

.workspace-message.error {
  border-left-color: var(--color-danger, #9d2d35);
  background: #fff1f2;
  color: #8d2730;
}
.field-hint code {
  color: #1769aa;
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
  color: var(--text-muted, #40515f);
  width: 140px;
  flex-shrink: 0;
}
.about-val {
  color: var(--text-main, #17212b);
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
  background: var(--accent, #1769aa);
  color: #fff;
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover, #1769aa);
}
.btn-secondary {
  background: var(--bg-input, #f7f9fb);
  color: var(--text-main, #17212b);
  border-color: var(--border, #b9c5cf);
}
.btn-secondary:hover:not(:disabled) {
  background: #e5ebf0;
}
</style>
