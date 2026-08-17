<script setup lang="ts">
import { ref } from 'vue'
import {
  Wrench,
  RotateCcw,
  AlertTriangle,
  Flame,
  ShieldAlert,
  Save,
} from 'lucide-vue-next'
import { useSjzdStore } from '../../../stores/sjzdStore'
import { useSerialStore } from '../../../stores/serialStore'
import { LOG_LEVEL_OPTIONS } from '../../../types/sjzd'
import ConfirmModal from '../../../components/common/ConfirmModal.vue'

const sjzd = useSjzdStore()
const serial = useSerialStore()

const inputFreq = ref(3)
const selectedLogLevel = ref(3)

const showPocModal = ref(false)
const showRtmModal = ref(false)
const showRstModal = ref(false)
const showEepromModal = ref(false)
</script>

<template>
  <div class="view-container">
    <!-- Header -->
    <header class="view-header">
      <div class="title-col">
        <h2>SJZDV3 系统维护与高危操作</h2>
        <p class="subtitle">
          配置数据周期上报频率、调整串口日志级别、清零运行统计计数器及执行系统软复位与 EEPROM 初始化。
        </p>
      </div>
    </header>

    <!-- General Maintenance Section -->
    <div class="section-card">
      <div class="card-header">
        <div class="header-left">
          <Wrench :size="16" class="icon-blue" />
          <h3>运行参数与周期设置</h3>
        </div>
      </div>

      <div class="card-body params-grid">
        <!-- Report Frequency -->
        <div class="param-box">
          <label>数据上报周期 (RTFRE)</label>
          <div class="input-with-action">
            <input
              v-model.number="inputFreq"
              type="number"
              min="1"
              max="255"
              class="form-input"
              :disabled="!serial.connectedPort || sjzd.isBusy"
            />
            <span class="unit-text">秒</span>
            <button
              class="btn btn-sm btn-secondary"
              :disabled="!serial.connectedPort || sjzd.isBusy"
              @click="sjzd.setReportFreq(inputFreq)"
            >
              <Save :size="13" />
              <span>保存</span>
            </button>
          </div>
          <span class="field-hint">范围 1 ~ 255 秒（默认 3 秒）</span>
        </div>

        <!-- Log Level -->
        <div class="param-box">
          <label>运行日志输出等级 (LOGLEVEL)</label>
          <div class="input-with-action">
            <select
              v-model.number="selectedLogLevel"
              class="form-select"
              :disabled="!serial.connectedPort || sjzd.isBusy"
            >
              <option v-for="l in LOG_LEVEL_OPTIONS" :key="l.value" :value="l.value">
                {{ l.label }}
              </option>
            </select>
            <button
              class="btn btn-sm btn-secondary"
              :disabled="!serial.connectedPort || sjzd.isBusy"
              @click="sjzd.setLogLevel(selectedLogLevel)"
            >
              <Save :size="13" />
              <span>设置</span>
            </button>
          </div>
          <span class="field-hint">0 为最详细报文抓包，5 为仅输出错误</span>
        </div>
      </div>
    </div>

    <!-- System Diagnostics & Reset -->
    <div class="section-card">
      <div class="card-header">
        <div class="header-left">
          <RotateCcw :size="16" class="icon-amber" />
          <h3>统计计数清零与系统复位</h3>
        </div>
      </div>

      <div class="card-body actions-grid-3">
        <!-- Clear Boot Count -->
        <div class="action-card">
          <div class="action-info">
            <span class="action-name">开机次数清零 (@POC=0)</span>
            <span class="action-desc">将板卡累计上电开机计数器重置为 0</span>
          </div>
          <button
            class="btn btn-secondary btn-full"
            :disabled="!serial.connectedPort || sjzd.isBusy"
            @click="showPocModal = true"
          >
            清零开机计数
          </button>
        </div>

        <!-- Clear Runtime -->
        <div class="action-card">
          <div class="action-info">
            <span class="action-name">累计工作时间清零 (@RTM=0)</span>
            <span class="action-desc">将板卡累计上电工作小时数重置为 0</span>
          </div>
          <button
            class="btn btn-secondary btn-full"
            :disabled="!serial.connectedPort || sjzd.isBusy"
            @click="showRtmModal = true"
          >
            清零运行时间
          </button>
        </div>

        <!-- Soft Reset -->
        <div class="action-card">
          <div class="action-info">
            <span class="action-name">系统软复位 (@RST)</span>
            <span class="action-desc">触发 STM32 单片机软件重启并重新初始化</span>
          </div>
          <button
            class="btn btn-warning btn-full"
            :disabled="!serial.connectedPort || sjzd.isBusy"
            @click="showRstModal = true"
          >
            软复位重启
          </button>
        </div>
      </div>
    </div>

    <!-- High-Risk EEPROM Wipe Section -->
    <div class="section-card critical-zone">
      <div class="card-header critical-header">
        <div class="header-left">
          <ShieldAlert :size="18" class="icon-danger" />
          <h3>极高危操作专区 (EEPROM 初始化)</h3>
        </div>
        <span class="danger-tag">双重保护限制</span>
      </div>

      <div class="card-body critical-body">
        <div class="critical-warning-box">
          <AlertTriangle :size="20" class="warning-icon" />
          <div class="warning-text">
            <strong>【严重警告】</strong>
            清空 EEPROM 将全量抹除板载 AT24C16 存储芯片内包含的 <strong>设备 SN 序列号、星闪网络参数、Modbus 全部点位表</strong> 以及出厂校准配置！
            仅在产线重置或返厂维保时使用。
          </div>
        </div>

        <div class="critical-action-row">
          <button
            class="btn btn-critical"
            :disabled="!serial.connectedPort || sjzd.isBusy"
            @click="showEepromModal = true"
          >
            <Flame :size="16" />
            <span>全量擦除清空 EEPROM (@EEP=0)</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Confirm Modals -->
    <ConfirmModal
      :visible="showPocModal"
      title="清零开机次数？"
      message="确认将设备的累计开机次数重置为 0？此操作不可逆。"
      danger-level="normal"
      confirm-text="确认清零"
      @confirm="
        () => {
          showPocModal = false
          sjzd.clearPowerCount()
        }
      "
      @cancel="showPocModal = false"
    />

    <ConfirmModal
      :visible="showRtmModal"
      title="清零累计运行时间？"
      message="确认将设备的累计运行时间重置为 0？此操作不可逆。"
      danger-level="normal"
      confirm-text="确认清零"
      @confirm="
        () => {
          showRtmModal = false
          sjzd.clearRuntime()
        }
      "
      @cancel="showRtmModal = false"
    />

    <ConfirmModal
      :visible="showRstModal"
      title="执行系统软复位？"
      message="即将向设备下发 @RST 指令触发 MCU 软复位，设备将中断当前通信并重启。"
      danger-level="high"
      confirm-text="确认复位重启"
      @confirm="
        () => {
          showRstModal = false
          sjzd.resetSystem()
        }
      "
      @cancel="showRstModal = false"
    />

    <ConfirmModal
      :visible="showEepromModal"
      title="【极高危】确认清空全部 EEPROM？"
      message="即将下发 @EEP=0 指令。这会永久擦除出厂序列号、星闪网络与 Modbus 全部配置！"
      danger-level="critical"
      confirm-text="强制全量擦除"
      require-typing="CONFIRM"
      :countdown-seconds="5"
      @confirm="
        () => {
          showEepromModal = false
          sjzd.clearEeprom()
        }
      "
      @cancel="showEepromModal = false"
    />
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

.icon-blue {
  color: #3b82f6;
}
.icon-amber {
  color: #f59e0b;
}
.icon-danger {
  color: #ef4444;
}

.card-body {
  padding: 18px;
}

.params-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}

.param-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg-input, #232736);
  padding: 14px;
  border-radius: 6px;
  border: 1px solid var(--border, #2a2f42);
}
.param-box label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-main, #e2e8f0);
}

.input-with-action {
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-input,
.form-select {
  flex: 1;
  padding: 8px 10px;
  background: var(--bg-app, #0f111a);
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

.unit-text {
  font-size: 0.8rem;
  color: var(--text-muted, #94a3b8);
}
.field-hint {
  font-size: 0.72rem;
  color: var(--text-muted, #94a3b8);
}

.actions-grid-3 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.action-card {
  background: var(--bg-input, #232736);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 6px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
}

.action-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.action-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-main, #e2e8f0);
}
.action-desc {
  font-size: 0.72rem;
  color: var(--text-muted, #94a3b8);
  line-height: 1.4;
}

.critical-zone {
  border-color: rgba(239, 68, 68, 0.4);
}
.critical-header {
  background: rgba(239, 68, 68, 0.08);
}
.danger-tag {
  font-size: 0.72rem;
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.critical-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.critical-warning-box {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 6px;
  color: #fca5a5;
  font-size: 0.82rem;
  line-height: 1.5;
}
.warning-icon {
  color: #ef4444;
  flex-shrink: 0;
  margin-top: 2px;
}

.critical-action-row {
  display: flex;
  justify-content: flex-end;
}

.btn {
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  transition: all 0.15s;
}
.btn-sm {
  padding: 6px 12px;
  font-size: 0.78rem;
  white-space: nowrap;
}
.btn-full {
  width: 100%;
}
.btn-secondary {
  background: var(--bg-app, #0f111a);
  color: var(--text-main, #e2e8f0);
  border-color: var(--border, #2a2f42);
}
.btn-secondary:hover:not(:disabled) {
  background: #2e3448;
}

.btn-warning {
  background: rgba(245, 158, 11, 0.15);
  border-color: rgba(245, 158, 11, 0.3);
  color: #fbbf24;
}
.btn-warning:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.25);
  border-color: #f59e0b;
}

.btn-critical {
  background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
  color: #fff;
  padding: 10px 20px;
  font-weight: 600;
}
.btn-critical:hover:not(:disabled) {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
