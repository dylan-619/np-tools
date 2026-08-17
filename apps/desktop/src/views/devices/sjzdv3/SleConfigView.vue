<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  Radio,
  RefreshCw,
  Sliders,
  Terminal,
  Send,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
} from 'lucide-vue-next'
import { useSjzdStore } from '../../../stores/sjzdStore'
import { useSerialStore } from '../../../stores/serialStore'
import { SLE_TX_POWER_MAP } from '../../../types/sjzd'

const sjzd = useSjzdStore()
const serial = useSerialStore()

const atInput = ref('SEL_GETNAME?')
const atHistory = ref<string[]>([])

const powerOptions = Object.entries(SLE_TX_POWER_MAP).map(([k, v]) => ({
  value: Number(k),
  label: `${k} 档 -> ${v}`,
}))

async function sendAtCommand() {
  const cmd = atInput.value.trim()
  if (!cmd || !serial.connectedPort) return
  if (!atHistory.value.includes(cmd)) {
    atHistory.value.push(cmd)
  }
  await serial.sendRaw(cmd, { addCR: true, addLF: true })
  atInput.value = ''
}

onMounted(() => {
  if (serial.connectedPort) {
    sjzd.querySleConfig()
  }
})
</script>

<template>
  <div class="view-container">
    <!-- Header -->
    <header class="view-header">
      <div class="title-col">
        <h2>星闪 (NearLink / SLE) 无线网络配置</h2>
        <p class="subtitle">
          配置采集终端星闪模组的 AP ID、网络名称、发射功率，支持 EEPROM 与模组芯片双向参数比对及 AT 透传调试。
        </p>
      </div>

      <div class="actions-col">
        <button
          class="btn btn-primary"
          :disabled="!serial.connectedPort || sjzd.isBusy"
          @click="sjzd.querySleConfig"
        >
          <RefreshCw :size="14" :class="{ spin: sjzd.isBusy }" />
          <span>查询比对配置 (SLE:LIST)</span>
        </button>
      </div>
    </header>

    <!-- Two-Column Layout -->
    <div class="config-columns">
      <!-- Left Column: Parameter Form -->
      <div class="column-left">
        <div class="section-card">
          <div class="card-header">
            <div class="header-left">
              <Sliders :size="16" class="icon-blue" />
              <h3>星闪无线参数设置</h3>
            </div>
          </div>

          <div class="card-body form-body">
            <!-- Net Name -->
            <div class="form-group">
              <label>星闪网络名称 (SLE_NETNAME)</label>
              <div class="input-with-action">
                <input
                  v-model="sjzd.sleForm.netName"
                  type="text"
                  maxlength="16"
                  placeholder="例: star_RS01"
                  class="form-input"
                  :disabled="!serial.connectedPort || sjzd.isBusy"
                />
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="!serial.connectedPort || !sjzd.sleForm.netName.trim() || sjzd.isBusy"
                  @click="sjzd.setSleNetName(sjzd.sleForm.netName.trim())"
                >
                  写入名称
                </button>
              </div>
              <span class="field-hint">最长 16 字符 ASCII，修改后 MCU 自动复位模组生效</span>
            </div>

            <!-- AP ID -->
            <div class="form-group">
              <label>星闪 AP ID (SLE_APID)</label>
              <div class="input-with-action">
                <input
                  v-model.number="sjzd.sleForm.apId"
                  type="number"
                  min="0"
                  max="255"
                  class="form-input"
                  :disabled="!serial.connectedPort || sjzd.isBusy"
                />
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="!serial.connectedPort || sjzd.isBusy"
                  @click="sjzd.setSleApid(sjzd.sleForm.apId)"
                >
                  写入 APID
                </button>
              </div>
              <span class="field-hint">范围 0 ~ 255 (十进制数字)</span>
            </div>

            <!-- Tx Power -->
            <div class="form-group">
              <label>当前发射功率档位 (SLE_PWR)</label>
              <div class="input-with-action">
                <select
                  v-model.number="sjzd.sleForm.txPower"
                  class="form-select"
                  :disabled="!serial.connectedPort || sjzd.isBusy"
                >
                  <option v-for="opt in powerOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="!serial.connectedPort || sjzd.isBusy"
                  @click="sjzd.setSlePwr(sjzd.sleForm.txPower)"
                >
                  写入功率
                </button>
              </div>
              <span class="field-hint">定长 9 字节（不加 \r\n），即时调节射频输出</span>
            </div>

            <!-- Max Tx Power -->
            <div class="form-group">
              <label>最大发射功率上限 (SLE_MAXPWR)</label>
              <div class="input-with-action">
                <select
                  v-model.number="sjzd.sleForm.maxTxPower"
                  class="form-select"
                  :disabled="!serial.connectedPort || sjzd.isBusy"
                >
                  <option v-for="opt in powerOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="!serial.connectedPort || sjzd.isBusy"
                  @click="sjzd.setSleMaxPwr(sjzd.sleForm.maxTxPower)"
                >
                  写入上限
                </button>
              </div>
              <span class="field-hint">定长 12 字节（不加 \r\n），固化射频保护上限</span>
            </div>

            <!-- Batch Apply All Button -->
            <div class="batch-apply-box">
              <button
                class="btn btn-primary btn-full-width"
                :disabled="!serial.connectedPort || sjzd.isBusy"
                @click="sjzd.applyAllSleConfig"
              >
                <Send :size="14" />
                <span>一键批量写入并同步全套参数</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column: Comparison Table & AT Console -->
      <div class="column-right">
        <!-- Dual Comparison Table -->
        <div class="section-card">
          <div class="card-header">
            <div class="header-left">
              <Radio :size="16" class="icon-green" />
              <h3>EEPROM 与芯片底层回读比对</h3>
            </div>
          </div>

          <div class="card-body no-padding">
            <table class="data-table">
              <thead>
                <tr>
                  <th>配置项目</th>
                  <th>EEPROM 设定值</th>
                  <th>芯片实际回读值</th>
                  <th>一致性状态</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in sjzd.sleComparisons"
                  :key="item.fieldName"
                  :class="{ mismatch: !item.isMatched }"
                >
                  <td class="font-medium">{{ item.fieldName }}</td>
                  <td class="mono-text">{{ item.eepromVal }}</td>
                  <td class="mono-text">{{ item.chipVal }}</td>
                  <td>
                    <span
                      class="match-badge"
                      :class="{ matched: item.isMatched, unmatched: !item.isMatched }"
                    >
                      <CheckCircle2 v-if="item.isMatched" :size="12" />
                      <AlertCircle v-else :size="12" />
                      <span>{{ item.isMatched ? '一致' : '差异' }}</span>
                    </span>
                  </td>
                </tr>
                <tr v-if="sjzd.sleComparisons.length === 0">
                  <td colspan="4" class="empty-cell">
                    点击右上角【查询比对配置 (SLE:LIST)】获取设备参数
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- AT Pass-Through Terminal Console -->
        <div class="section-card">
          <div class="card-header">
            <div class="header-left">
              <Terminal :size="16" class="icon-purple" />
              <h3>星闪原厂 AT 透传调试</h3>
            </div>

            <div class="bridge-switch-wrapper">
              <label class="switch-label">
                <input
                  type="checkbox"
                  :checked="sjzd.wlanBridgeEnabled"
                  :disabled="!serial.connectedPort || sjzd.isBusy"
                  @change="sjzd.toggleWlanBridge(!sjzd.wlanBridgeEnabled)"
                />
                <span>透传模式 (@WLAN)</span>
              </label>
            </div>
          </div>

          <div class="card-body">
            <div v-if="!sjzd.wlanBridgeEnabled" class="bridge-disabled-notice">
              <ShieldAlert :size="16" />
              <span>开启【透传模式 (@WLAN=1)】后，USART1 将直通星闪模组 UART2，允许直接交互原厂 AT 指令。</span>
            </div>

            <div class="at-input-row">
              <input
                v-model="atInput"
                type="text"
                placeholder="键入 AT 指令 (例: SEL_GETNAME?, SEL_RST)..."
                class="form-input mono-text"
                :disabled="!serial.connectedPort || !sjzd.wlanBridgeEnabled"
                @keyup.enter="sendAtCommand"
              />
              <button
                class="btn btn-primary"
                :disabled="!serial.connectedPort || !sjzd.wlanBridgeEnabled || !atInput.trim()"
                @click="sendAtCommand"
              >
                <Send :size="14" />
                <span>发送</span>
              </button>
            </div>

            <!-- Quick AT Presets -->
            <div class="at-presets-row">
              <span class="preset-label">快捷指令:</span>
              <button
                class="preset-chip"
                :disabled="!sjzd.wlanBridgeEnabled"
                @click="atInput = 'SEL_GETNAME?'"
              >
                SEL_GETNAME?
              </button>
              <button
                class="preset-chip"
                :disabled="!sjzd.wlanBridgeEnabled"
                @click="atInput = 'SEL_GETADDR?'"
              >
                SEL_GETADDR?
              </button>
              <button
                class="preset-chip"
                :disabled="!sjzd.wlanBridgeEnabled"
                @click="atInput = 'SEL_RST'"
              >
                SEL_RST
              </button>
            </div>
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
  max-width: 1200px;
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

.config-columns {
  display: grid;
  grid-template-columns: 420px 1fr;
  gap: 16px;
  align-items: start;
}

.section-card {
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
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
.icon-green {
  color: #10b981;
}
.icon-purple {
  color: #a855f7;
}

.card-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.card-body.no-padding {
  padding: 0;
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

.input-with-action {
  display: flex;
  gap: 8px;
}

.form-input,
.form-select {
  flex: 1;
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

.field-hint {
  font-size: 0.72rem;
  color: var(--text-muted, #94a3b8);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.data-table th {
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid var(--border, #2a2f42);
  text-align: left;
  font-weight: 600;
  color: var(--text-muted, #94a3b8);
}
.data-table td {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  color: var(--text-main, #e2e8f0);
}
.data-table tr.mismatch {
  background: rgba(239, 68, 68, 0.08);
}

.mono-text {
  font-family: var(--font-mono, monospace);
}

.match-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.72rem;
}
.match-badge.matched {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
}
.match-badge.unmatched {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

.empty-cell {
  text-align: center;
  padding: 24px;
  color: var(--text-muted, #94a3b8);
}

.bridge-switch-wrapper {
  display: flex;
  align-items: center;
}

.switch-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--text-main, #e2e8f0);
  cursor: pointer;
}

.bridge-disabled-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.25);
  color: #fbbf24;
  font-size: 0.78rem;
}

.at-input-row {
  display: flex;
  gap: 8px;
}

.at-presets-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preset-label {
  font-size: 0.72rem;
  color: var(--text-muted, #94a3b8);
}

.preset-chip {
  padding: 2px 8px;
  background: var(--bg-input, #232736);
  border: 1px solid var(--border, #2a2f42);
  color: #93c5fd;
  border-radius: 4px;
  font-size: 0.72rem;
  font-family: var(--font-mono, monospace);
  cursor: pointer;
}
.preset-chip:hover:not(:disabled) {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
}
.preset-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
}
.btn-sm {
  padding: 6px 12px;
  font-size: 0.78rem;
  white-space: nowrap;
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
.btn:disabled {
  opacity: 0.5;
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
