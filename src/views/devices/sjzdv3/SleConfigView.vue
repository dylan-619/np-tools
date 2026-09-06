<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import {
  Radio,
  RefreshCw,
  Sliders,
  Terminal,
  Send,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Zap,
  Cpu,
  Check,
  Copy,
  Square,
} from 'lucide-vue-next'
import { useSjzdStore } from '../../../stores/sjzdStore'
import { useSerialStore } from '../../../stores/serialStore'
import { SLE_TX_POWER_MAP } from '../../../types/sjzd'
import CustomSelect from '../../../components/common/CustomSelect.vue'

const sjzd = useSjzdStore()
const serial = useSerialStore()

const atInput = ref('SEL_GETNAME?')
const atHistory = ref<string[]>([])
const copiedMac = ref(false)
const mcuConsoleReady = computed(
  () => Boolean(sjzd.wlanBridgeStatus && !sjzd.wlanBridgeStatus.active)
)

async function copyMac(mac?: string) {
  const text = mac || sjzd.sleCurrentStatus?.mac
  if (!text || text === '--') return
  try {
    await navigator.clipboard.writeText(text)
    copiedMac.value = true
    setTimeout(() => {
      copiedMac.value = false
    }, 2000)
  } catch (err) {
    console.error('复制 MAC 失败:', err)
  }
}

const powerOptions = Object.entries(SLE_TX_POWER_MAP).map(([k, v]) => ({
  value: Number(k),
  label: `${k} 档 -> ${v}`,
}))

async function sendAtCommand(customCmd?: string) {
  const cmd = (typeof customCmd === 'string' ? customCmd : atInput.value).trim()
  if (!cmd || !serial.connectedPort) return
  if (cmd !== '@WLAN=0' && cmd !== '@WLAN=1' && !sjzd.wlanBridgeStatus?.active) {
    sjzd.showMessage('请先通过 SLE_BRIDGE:ACK 确认已开启 UART1 透传，再发送星闪 AT 指令', false)
    return
  }
  if (!atHistory.value.includes(cmd)) {
    atHistory.value.push(cmd)
  }
  if (cmd === '@WLAN=0') {
    await sjzd.toggleWlanBridge(false)
  } else if (cmd === '@WLAN=1') {
    await sjzd.toggleWlanBridge(true)
  } else {
    await serial.sendRaw(cmd, { addCR: true, addLF: true })
  }
  if (typeof customCmd !== 'string') {
    atInput.value = ''
  }
}

async function refreshSleConfiguration() {
  const bridge = await sjzd.queryWlanBridge()
  if (!bridge || bridge.active) return
  await sjzd.queryWlanType()
  await sjzd.querySleConfig()
}

onMounted(() => {
  if (serial.connectedPort) {
    void refreshSleConfiguration()
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
          配置采集终端星闪模组的 AP ID、网络名称、发射功率；仅在同一事务 ID、数量和 CRC32 通过后展示 EEPROM 与芯片快照，并提供受 ACK 保护的 AT 透传调试。
        </p>
      </div>

      <div class="actions-col">
        <button
          class="btn btn-primary"
          :disabled="!serial.connectedPort || sjzd.isBusy"
          @click="refreshSleConfiguration"
        >
          <RefreshCw :size="14" :class="{ spin: sjzd.isBusy }" />
          <span>查询完整配置 (SLE:LIST)</span>
        </button>
      </div>
    </header>

    <!-- 4G Mode Active Alert Banner -->
    <div v-if="sjzd.wlanTypeInfo.mode === '4G'" class="mode-alert-banner">
      <AlertCircle :size="18" class="banner-icon-amber" />
      <div class="banner-content">
        <strong>提示：当前设备处于【4G Cat.1 模式】(UART2 115200bps)。</strong>
        <span>星闪无线模组未激活。如需使用星闪通信，请在 4G 配置页切换模式。</span>
      </div>
      <router-link to="/devices/sjzdv3/4g" class="btn btn-sm btn-outline">
        前往 4G 配置
      </router-link>
    </div>

    <div v-if="sjzd.wlanBridgeStatus?.active" class="mode-alert-banner">
      <ShieldAlert :size="18" class="banner-icon-amber" />
      <div class="banner-content">
        <strong>UART1 已确认透传到 {{ sjzd.wlanBridgeStatus.uartOwner }}。</strong>
        <span>MCU 配置查询和写入已被工具阻止；请先退出透传，再执行 SLE 配置操作。</span>
      </div>
      <button class="btn btn-sm btn-outline" :disabled="sjzd.isBusy" @click="sjzd.toggleWlanBridge(false)">退出透传</button>
    </div>

    <!-- Top SLE Metrics Grid -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-icon blue">
          <Radio :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">星闪网络名称 (NetName)</span>
          <span class="metric-value">{{ sjzd.sleCurrentStatus?.netName || '--' }}</span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon green">
          <Sliders :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">从机通信地址 (DevAddr) / APID</span>
          <span class="metric-value">
            {{
              sjzd.sleCurrentStatus?.devAddr || sjzd.sleCurrentStatus?.apId !== undefined
                ? `${sjzd.sleCurrentStatus?.devAddr ? '地址: ' + sjzd.sleCurrentStatus.devAddr : ''}${sjzd.sleCurrentStatus?.devAddr && sjzd.sleCurrentStatus?.apId !== undefined ? ' | ' : ''}${sjzd.sleCurrentStatus?.apId !== undefined ? 'APID: ' + sjzd.sleCurrentStatus.apId : ''}`
                : '--'
            }}
          </span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon amber">
          <Zap :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">当前发射功率档位</span>
          <span class="metric-value">
            {{
              sjzd.sleCurrentStatus?.txPower
                ? `${sjzd.sleCurrentStatus.txPower} 档 (${SLE_TX_POWER_MAP[sjzd.sleCurrentStatus.txPower] || ''})`
                : '--'
            }}
          </span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon purple">
          <Cpu :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">模组物理地址 (MAC)</span>
          <span class="metric-value mono-text">{{ sjzd.sleCurrentStatus?.mac || '--' }}</span>
        </div>
        <button
          v-if="sjzd.sleCurrentStatus?.mac"
          class="card-copy-btn"
          :class="{ copied: copiedMac }"
          :title="copiedMac ? '已复制 MAC' : '复制星闪模组 MAC 地址'"
          @click.stop="copyMac(sjzd.sleCurrentStatus.mac)"
        >
          <Check v-if="copiedMac" :size="13" class="copy-icon-success" />
          <Copy v-else :size="13" />
        </button>
      </div>
    </div>

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
            <span v-if="sjzd.sleCurrentStatus?.lastSyncTime" class="header-tag-success">
              完整快照 v{{ sjzd.sleCurrentStatus.snapshot?.revisionHex || '--' }}
            </span>
          </div>

          <div class="card-body form-body">
            <!-- Net Name -->
            <div class="form-group">
              <div class="label-with-cur">
                <label>星闪网络名称 (SLE_NETNAME)</label>
                <span v-if="sjzd.sleCurrentStatus?.netName" class="cur-badge">
                  完整回读: {{ sjzd.sleCurrentStatus.netName }}
                </span>
              </div>
              <div class="input-with-action">
                <input
                  v-model="sjzd.sleForm.netName"
                  type="text"
                  maxlength="15"
                  placeholder="例: star_RS01"
                  class="form-input"
                  :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                />
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="!serial.connectedPort || !mcuConsoleReady || !sjzd.sleForm.netName.trim() || sjzd.isBusy"
                  @click="sjzd.setSleNetName(sjzd.sleForm.netName.trim())"
                >
                  写入名称
                </button>
              </div>
              <span class="field-hint">最长 15 个可打印 ASCII 字符（16B 存储区预留 NUL）。写入后必须收到 <code>SLE_CONFIG:SAVED</code>，再以 <code>SLE:LIST</code> 的 transaction ID、count、CRC32 和 revision 复核。</span>
            </div>

            <!-- AP ID -->
            <div class="form-group">
              <div class="label-with-cur">
                <label>星闪 AP ID (SLE_APID)</label>
                <span v-if="sjzd.sleCurrentStatus?.apId !== undefined" class="cur-badge">
                  完整回读: {{ sjzd.sleCurrentStatus.apId }}
                </span>
              </div>
              <div class="input-with-action">
                <input
                  v-model.number="sjzd.sleForm.apId"
                  type="number"
                  min="0"
                  max="255"
                  class="form-input"
                  :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                />
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                  @click="sjzd.setSleApid(sjzd.sleForm.apId)"
                >
                  写入 APID
                </button>
              </div>
              <span class="field-hint">范围 0 ~ 255 (十进制数字)</span>
            </div>

            <!-- Tx Power -->
            <div class="form-group">
              <div class="label-with-cur">
                <label>当前发射功率档位 (SLE_PWR)</label>
                <span v-if="sjzd.sleCurrentStatus?.txPower" class="cur-badge">
                  完整回读: {{ sjzd.sleCurrentStatus.txPower }} 档
                </span>
              </div>
              <div class="input-with-action">
                <CustomSelect
                  v-model="sjzd.sleForm.txPower"
                  :options="powerOptions"
                  :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                />
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                  @click="sjzd.setSlePwr(sjzd.sleForm.txPower)"
                >
                  写入功率
                </button>
              </div>
              <span class="field-hint">定长 9 字节（不加 \r\n），即时调节射频输出</span>
            </div>

            <!-- Max Tx Power -->
            <div class="form-group">
              <div class="label-with-cur">
                <label>最大发射功率上限 (SLE_MAXPWR)</label>
                <span v-if="sjzd.sleCurrentStatus?.maxTxPower" class="cur-badge">
                  完整回读: {{ sjzd.sleCurrentStatus.maxTxPower }} 档
                </span>
              </div>
              <div class="input-with-action">
                <CustomSelect
                  v-model="sjzd.sleForm.maxTxPower"
                  :options="powerOptions"
                  :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                />
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
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
                :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                @click="sjzd.applyAllSleConfig"
              >
                <Send :size="14" />
                <span>一键批量写入并完整复核</span>
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
              <h3>EEPROM 与星闪芯片完整快照比对</h3>
            </div>
            <span class="header-subtitle-tag">仅比对两者共有参数 (网络名、通信地址、发射功率)</span>
          </div>

          <div class="card-body no-padding">
            <table class="data-table">
              <thead>
                <tr>
                  <th>比对项目</th>
                  <th>EEPROM 设定值</th>
                  <th>星闪芯片运行时字段</th>
                  <th>一致性状态</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in sjzd.sleComparisons"
                  :key="item.fieldName"
                  :class="{ mismatch: item.isComparable && !item.isMatched }"
                >
                  <td class="font-medium">{{ item.fieldName }}</td>
                  <td class="mono-text">{{ item.eepromVal }}</td>
                  <td class="mono-text">{{ item.chipVal }}</td>
                  <td>
                    <span
                      class="match-badge"
                      :class="{ matched: item.isMatched, unmatched: item.isComparable && !item.isMatched }"
                    >
                      <CheckCircle2 v-if="item.isComparable && item.isMatched" :size="12" />
                      <AlertCircle v-else-if="item.isComparable" :size="12" />
                      <span>{{ !item.isComparable ? '未获取' : item.isMatched ? '一致' : '差异' }}</span>
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

            <!-- Exclusive Hardware / EEPROM Properties Bar -->
            <div v-if="sjzd.sleCurrentStatus?.lastSyncTime" class="extra-prop-bar">
              <div class="prop-item">
                <span class="p-name">从机通信地址 (DevAddr):</span>
                <span class="p-val mono-text">{{ sjzd.sleCurrentStatus.devAddr || '--' }}</span>
              </div>
              <div class="prop-item">
                <span class="p-name">星闪 AP ID (EEPROM):</span>
                <span class="p-val mono-text">{{ sjzd.sleCurrentStatus.apId ?? '--' }}</span>
              </div>
              <div class="prop-item">
                <span class="p-name">最大发射功率上限 (EEPROM):</span>
                <span class="p-val mono-text">
                  {{ sjzd.sleCurrentStatus.maxTxPower !== undefined ? `${sjzd.sleCurrentStatus.maxTxPower} 档` : '--' }}
                </span>
              </div>
              <div class="prop-item">
                <span class="p-name">模组 MAC 地址 (芯片):</span>
                <span class="p-val mono-text">{{ sjzd.sleCurrentStatus.mac || '--' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- AT Pass-Through Terminal Console -->
        <div class="section-card">
          <div class="card-header">
            <div class="header-left">
              <Terminal :size="16" class="icon-purple" />
              <h3>星闪原厂 AT 透传调试</h3>
              <span
                class="bridge-status-badge"
                :class="{ active: sjzd.wlanBridgeEnabled }"
              >
                {{
                  !sjzd.wlanBridgeStatus
                    ? '⚪ 透传状态未确认'
                    : sjzd.wlanBridgeEnabled
                      ? `🟠 已确认透传 (${sjzd.wlanBridgeStatus.uartOwner})`
                      : '🟢 已确认 MCU 命令模式'
                }}
              </span>
            </div>

            <div class="bridge-actions">
              <button
                class="btn btn-sm btn-outline"
                :disabled="!serial.connectedPort || sjzd.isBusy"
                title="查询当前 UART1 透传状态（即使透传已开启也由 MCU 本地处理）"
                @click="sjzd.queryWlanBridge"
              >
                <RefreshCw :size="13" :class="{ spin: sjzd.isBusy }" />
                <span>查询状态</span>
              </button>
              <button
                v-if="sjzd.wlanBridgeEnabled"
                class="btn btn-sm btn-danger"
                :disabled="!serial.connectedPort || sjzd.isBusy"
                title="点击下发 @WLAN=0 退出透传并恢复 MCU 常规指令"
                @click="sjzd.toggleWlanBridge(false)"
              >
                <Square :size="13" />
                <span>退出透传 (@WLAN=0)</span>
              </button>
              <button
                v-else
                class="btn btn-sm btn-outline-purple"
                :disabled="!serial.connectedPort || sjzd.isBusy"
                title="点击下发 @WLAN=1 进入直通星闪模组的原厂 AT 模式"
                @click="sjzd.toggleWlanBridge(true)"
              >
                <Zap :size="13" />
                <span>进入透传 (@WLAN=1)</span>
              </button>
            </div>
          </div>

          <div class="card-body">
            <div v-if="sjzd.wlanBridgeEnabled" class="bridge-active-notice">
              <Zap :size="15" />
              <span>
                已由 <code>SLE_BRIDGE:ACK</code> 确认 UART1 直通 {{ sjzd.wlanBridgeStatus?.uartOwner }}。此时 MCU 配置指令被工具阻止；发送 AT 指令前仍应以实际模组回包和现场通信验证。
              </span>
            </div>
            <div v-else-if="sjzd.wlanBridgeStatus" class="bridge-disabled-notice">
              <ShieldAlert :size="15" />
              <span>
                已由 <code>SLE_BRIDGE:ACK</code> 确认 UART1 由 MCU 处理；可以执行配置查询和写入。进入透传后，工具会暂停 MCU 配置命令。
              </span>
            </div>
            <div v-else class="bridge-disabled-notice">
              <ShieldAlert :size="15" />
              <span>
                透传状态尚未确认。请点击【查询状态】或【进入/退出透传】取得 <code>SLE_BRIDGE:ACK</code>；工具不会把未确认状态当作 MCU 或透传模式。
              </span>
            </div>

            <div class="at-input-row">
              <input
                v-model="atInput"
                type="text"
                placeholder="键入 AT 指令 (例: SEL_GETNAME?, @WLAN=0, SEL_RST)..."
                class="form-input mono-text"
                :disabled="!serial.connectedPort || !sjzd.wlanBridgeStatus?.active"
                @keyup.enter="sendAtCommand()"
              />
              <button
                class="btn btn-primary"
                :disabled="!serial.connectedPort || !sjzd.wlanBridgeStatus?.active || !atInput.trim()"
                @click="sendAtCommand()"
              >
                <Send :size="14" />
                <span>发送</span>
              </button>
            </div>

            <!-- Quick AT Presets -->
            <div class="at-presets-row">
              <span class="preset-label">快捷操作:</span>
              <button
                class="preset-chip chip-danger"
                title="下发 @WLAN=0 退出透传模式"
                :disabled="!serial.connectedPort"
                @click="sendAtCommand('@WLAN=0')"
              >
                @WLAN=0 (退出透传)
              </button>
              <button
                class="preset-chip chip-primary"
                title="下发 @WLAN=1 进入透传模式"
                :disabled="!serial.connectedPort"
                @click="sendAtCommand('@WLAN=1')"
              >
                @WLAN=1 (开启透传)
              </button>
              <button
                class="preset-chip"
                :disabled="!serial.connectedPort"
                @click="atInput = 'SEL_GETNAME?'"
              >
                SEL_GETNAME?
              </button>
              <button
                class="preset-chip"
                :disabled="!serial.connectedPort"
                @click="atInput = 'SEL_GETADDR?'"
              >
                SEL_GETADDR?
              </button>
              <button
                class="preset-chip"
                :disabled="!serial.connectedPort"
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

.config-columns {
  display: grid;
  grid-template-columns: minmax(320px, 380px) minmax(400px, 1fr);
  gap: 10px;
  align-items: start;
  width: 100%;
}

@media (max-width: 1180px) {
  .config-columns {
    grid-template-columns: 1fr;
  }
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  width: 100%;
}

.metric-card {
  position: relative;
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: var(--radius-sm, 5px);
  padding: 9px 10px;
  display: flex;
  align-items: center;
  gap: 9px;
}

.metric-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm, 5px);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.metric-icon.blue {
  background: rgba(59, 130, 246, 0.15);
  color: #0f5f9e;
}
.metric-icon.green {
  background: rgba(16, 185, 129, 0.15);
  color: #176b45;
}
.metric-icon.amber {
  background: rgba(245, 158, 11, 0.15);
  color: #7a4b00;
}
.metric-icon.purple {
  background: rgba(168, 85, 247, 0.15);
  color: #6f3a96;
}

.metric-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.metric-label {
  font-size: 0.75rem;
  color: var(--text-muted, #40515f);
}

.metric-value {
  font-size: 1.05rem;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  color: var(--text-main, #17212b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-copy-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: 1px solid var(--border, #b9c5cf);
  background: var(--bg-input, #f7f9fb);
  color: var(--text-muted, #40515f);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
}
.card-copy-btn:hover {
  background: #e5ebf0;
  color: #17212b;
  border-color: #1769aa;
}
.card-copy-btn.copied {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.4);
  color: #176b45;
}
.copy-icon-success {
  color: #176b45;
}

.header-tag-success {
  font-size: 0.7rem;
  font-family: var(--font-mono, monospace);
  background: rgba(16, 185, 129, 0.15);
  color: #176b45;
  padding: 2px 8px;
  border-radius: 4px;
}

.label-with-cur {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cur-badge {
  font-size: 0.7rem;
  font-family: var(--font-mono, monospace);
  color: #0f5f9e;
  background: rgba(56, 189, 248, 0.1);
  padding: 1px 6px;
  border-radius: 3px;
}

.section-card {
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: var(--radius-sm, 5px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
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
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-main, #17212b);
}

.icon-blue {
  color: #1769aa;
}
.icon-green {
  color: #176b45;
}
.icon-purple {
  color: #6f3a96;
}

.card-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  color: var(--text-main, #17212b);
}

.input-with-action {
  display: flex;
  gap: 8px;
}

.form-input,
.form-select {
  flex: 1;
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

.field-hint {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.data-table th {
  padding: 7px 10px;
  background: #f7f9fb;
  border-bottom: 1px solid var(--border, #b9c5cf);
  text-align: left;
  font-weight: 600;
  color: var(--text-muted, #40515f);
}
.data-table td {
  padding: 7px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  color: var(--text-main, #17212b);
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
  color: #176b45;
}
.match-badge.unmatched {
  background: rgba(239, 68, 68, 0.15);
  color: #a12d34;
}

.header-subtitle-tag {
  font-size: 0.7rem;
  color: var(--text-muted, #40515f);
  background: #eef3f7;
  padding: 2px 8px;
  border-radius: 4px;
}

.extra-prop-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  background: #f7f9fb;
  border-top: 1px solid var(--border, #b9c5cf);
  font-size: 0.76rem;
}
.prop-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.p-name {
  color: var(--text-muted, #40515f);
}
.p-val {
  color: #0f5f9e;
  font-weight: 600;
}

.empty-cell {
  text-align: center;
  padding: 24px;
  color: var(--text-muted, #40515f);
}

.bridge-status-badge {
  font-size: 0.72rem;
  font-family: var(--font-mono, monospace);
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.15);
  color: var(--text-muted, #40515f);
  border: 1px solid rgba(148, 163, 184, 0.2);
}
.bridge-status-badge.active {
  background: rgba(16, 185, 129, 0.15);
  color: #176b45;
  border-color: rgba(16, 185, 129, 0.4);
}

.bridge-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bridge-active-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #176b45;
  font-size: 0.78rem;
  line-height: 1.4;
}

.bridge-disabled-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.25);
  color: #7a4b00;
  font-size: 0.78rem;
  line-height: 1.4;
}

.at-input-row {
  display: flex;
  gap: 8px;
}

.at-presets-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.preset-label {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
}

.preset-chip {
  padding: 2px 8px;
  background: var(--bg-input, #f7f9fb);
  border: 1px solid var(--border, #b9c5cf);
  color: #1769aa;
  border-radius: 4px;
  font-size: 0.72rem;
  font-family: var(--font-mono, monospace);
  cursor: pointer;
  transition: all 0.15s ease;
}
.preset-chip:hover:not(:disabled) {
  border-color: #1769aa;
  background: rgba(59, 130, 246, 0.1);
}
.preset-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.preset-chip.chip-danger {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.35);
  color: #a12d34;
  font-weight: 600;
}
.preset-chip.chip-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.25);
  border-color: #a12d34;
  color: #8f2028;
}

.preset-chip.chip-primary {
  background: rgba(168, 85, 247, 0.15);
  border-color: rgba(168, 85, 247, 0.35);
  color: #6f3a96;
  font-weight: 600;
}
.preset-chip.chip-primary:hover:not(:disabled) {
  background: rgba(168, 85, 247, 0.25);
  border-color: #6f3a96;
  color: #5b2d7d;
}

.btn {
  min-height: var(--control-height, 32px);
  padding: 5px 10px;
  border-radius: var(--radius-xs, 3px);
  font-size: 0.76rem;
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
.btn-danger {
  background: rgba(239, 68, 68, 0.15);
  color: #a12d34;
  border: 1px solid rgba(239, 68, 68, 0.4);
}
.btn-danger:hover:not(:disabled) {
  background: #a12d34;
  color: #fff;
  border-color: #a12d34;
}
.btn-outline-purple {
  background: rgba(168, 85, 247, 0.15);
  color: #6f3a96;
  border: 1px solid rgba(168, 85, 247, 0.4);
}
.btn-outline-purple:hover:not(:disabled) {
  background: #6f3a96;
  color: #fff;
  border-color: #6f3a96;
}
.btn:disabled {
  background: var(--color-surface-1, #ffffff);
  border-color: var(--color-border-subtle, #d5dde4);
  color: var(--color-text-disabled, #667784);
  opacity: 1;
  cursor: not-allowed;
}

.mode-alert-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: var(--radius-sm, 5px);
  color: #92400e;
  font-size: 0.76rem;
  line-height: 1.4;
}
.banner-icon-amber {
  color: #d97706;
  flex-shrink: 0;
}
.banner-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
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
