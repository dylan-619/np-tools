<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  Cpu,
  RefreshCw,
  Zap,
  Clock,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Check,
  Copy,
  Sparkles,
  Activity,
  X,
} from 'lucide-vue-next'
import { useSjzdStore } from '../../../stores/sjzdStore'
import { useSerialStore } from '../../../stores/serialStore'
import ConfirmModal from '../../../components/common/ConfirmModal.vue'

const sjzd = useSjzdStore()
const serial = useSerialStore()

const inputSn = ref('430125010001')
const autoIncrement = ref(true)
const showConfirmModal = ref(false)
const isVerifying = ref(false)
const copiedSn = ref(false)

async function copySn(sn?: string) {
  const text = sn || sjzd.deviceInfo?.sn
  if (!text || text === '--') return
  try {
    await navigator.clipboard.writeText(text)
    copiedSn.value = true
    setTimeout(() => {
      copiedSn.value = false
    }, 2000)
  } catch (err) {
    console.error('复制 SN 失败:', err)
  }
}

function formatUptime(sec?: number): string {
  if (sec === undefined || sec === null) return '--'
  if (sec < 60) return `${sec} 秒`
  if (sec < 3600) {
    const mins = Math.floor(sec / 60)
    const rem = sec % 60
    return `${mins} 分 ${rem} 秒 (${sec}s)`
  }
  if (sec < 86400) {
    const hours = Math.floor(sec / 3600)
    const mins = Math.floor((sec % 3600) / 60)
    return `${hours} 小时 ${mins} 分 (${sec}s)`
  }
  const days = Math.floor(sec / 86400)
  const hours = Math.floor((sec % 86400) / 3600)
  const mins = Math.floor((sec % 3600) / 60)
  return `${days} 天 ${hours} 小时 ${mins} 分 (${sec}s)`
}

const isSnValid = computed(() => {
  const clean = inputSn.value.trim()
  return clean.length === 12 && /^\d+$/.test(clean)
})

const snValidationMessage = computed(() => {
  const clean = inputSn.value.trim()
  if (!clean) return '请输入 12 位纯数字序列号 (如 430126070777)'
  if (!/^\d+$/.test(clean)) return 'SN 序列号必须全部为纯数字'
  if (clean.length < 12) return `当前输入 ${clean.length}/12 位，缺少 ${12 - clean.length} 位数字`
  if (clean.length > 12) return `当前输入 ${clean.length}/12 位，超出 ${clean.length - 12} 位`
  if (!clean.startsWith('4301')) return '提示: SJZDV3 标准产品 SN 建议以 4301 开头，当前格式已满足 12 位可正常烧录'
  return 'SN 格式正确 (12 位纯数字)，点击右侧按钮即可写入设备'
})

function fillReadbackSn() {
  if (sjzd.deviceInfo?.sn && sjzd.deviceInfo.sn !== '--') {
    inputSn.value = sjzd.deviceInfo.sn
    localStorage.setItem('np_tools_last_sn', inputSn.value)
  }
}

function clearSnInput() {
  inputSn.value = ''
}

function handleSnInput(e: Event) {
  const val = (e.target as HTMLInputElement).value
  // Keep clean alphanumeric/numeric string up to 12 chars
  const digitsOnly = val.replace(/\D/g, '').slice(0, 12)
  inputSn.value = digitsOnly
  localStorage.setItem('np_tools_last_sn', inputSn.value)
}

function triggerBurnSn() {
  if (!isSnValid.value) return
  showConfirmModal.value = true
}

async function confirmBurnSn() {
  showConfirmModal.value = false
  const targetSn = inputSn.value.trim()
  try {
    await sjzd.burnSn(targetSn)

    // If auto-increment is enabled, increment the trailing 8 digits
    if (autoIncrement.value && targetSn.length === 12) {
      const prefix = targetSn.slice(0, 4)
      const numPart = parseInt(targetSn.slice(4), 10)
      if (!isNaN(numPart)) {
        const nextNum = (numPart + 1).toString().padStart(8, '0')
        inputSn.value = `${prefix}${nextNum}`
        localStorage.setItem('np_tools_last_sn', inputSn.value)
      }
    }

    // Auto verify query after reboot delay (1.5s)
    setTimeout(async () => {
      if (serial.connectedPort) {
        await sjzd.queryDeviceInfo()
      }
    }, 1600)
  } catch (err) {
    console.error(err)
  }
}

async function verifySnMatch() {
  isVerifying.value = true
  try {
    await sjzd.queryDeviceInfo()
  } finally {
    isVerifying.value = false
  }
}

onMounted(() => {
  const saved = localStorage.getItem('np_tools_last_sn')
  if (saved && saved.length === 12) {
    inputSn.value = saved
  }
  if (serial.connectedPort) {
    sjzd.queryDeviceInfo()
  }
})
</script>

<template>
  <div class="view-container">
    <!-- View Header -->
    <header class="view-header">
      <div class="title-col">
        <h2>SJZDV3 采集终端概览与生产烧录</h2>
        <p class="subtitle">
          查询设备硬件与固件版本信息，为出厂设备写入唯一 12 位 SN 序列号（USART1 115200 8N1）。
        </p>
      </div>

      <div class="actions-col">
        <button
          class="btn btn-primary"
          :disabled="!serial.connectedPort || sjzd.isBusy"
          @click="sjzd.queryDeviceInfo"
        >
          <RefreshCw :size="14" :class="{ spin: sjzd.isBusy }" />
          <span>查询设备信息 (DEVINFO)</span>
        </button>
      </div>
    </header>

    <!-- Operation Toast Bar -->
    <div
      v-if="sjzd.lastOpMessage"
      class="notice-bar"
      :class="{ success: sjzd.lastOpMessage.success, error: !sjzd.lastOpMessage.success }"
    >
      <CheckCircle2 v-if="sjzd.lastOpMessage.success" :size="16" />
      <AlertTriangle v-else :size="16" />
      <span>{{ sjzd.lastOpMessage.text }}</span>
    </div>

    <!-- Info Metrics Grid -->
    <div class="metrics-grid">
      <div class="metric-card metric-card-sn">
        <div class="metric-icon blue">
          <Cpu :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">设备序列号 (SN)</span>
          <span class="metric-value">{{ sjzd.deviceInfo?.sn || '--' }}</span>
        </div>
        <button
          v-if="sjzd.deviceInfo?.sn"
          class="card-copy-btn"
          :class="{ copied: copiedSn }"
          :title="copiedSn ? '已复制设备 SN' : '一键复制设备 SN 序列号 (用于配置北向上位机)'"
          @click.stop="copySn(sjzd.deviceInfo.sn)"
        >
          <Check v-if="copiedSn" :size="13" class="copy-icon-success" />
          <Copy v-else :size="13" />
        </button>
      </div>

      <div class="metric-card">
        <div class="metric-icon green">
          <Zap :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">设备型号 / 现场地址</span>
          <span class="metric-value">
            {{
              sjzd.deviceInfo?.deviceType
                ? `型号 ${sjzd.deviceInfo.deviceType} | 地址 ${sjzd.deviceInfo.deviceAddr || '默认'}`
                : (sjzd.deviceInfo?.hwVersion || sjzd.deviceInfo?.fwVersion || '--')
            }}
          </span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon purple">
          <RotateCcw :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">累计上电次数 (PwrOnCnt)</span>
          <span class="metric-value">
            {{ sjzd.deviceInfo?.bootCount !== undefined ? `${sjzd.deviceInfo.bootCount} 次` : '--' }}
          </span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon amber">
          <Clock :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">累计运行时间 (TotRunTim)</span>
          <span class="metric-value">
            {{ formatUptime(sjzd.deviceInfo?.uptimeSec) }}
          </span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon teal">
          <Activity :size="20" />
        </div>
        <div class="metric-content">
          <span class="metric-label">周期上报频率 (RptFreq)</span>
          <span class="metric-value">
            {{ sjzd.deviceInfo?.reportFreqSec !== undefined ? `${sjzd.deviceInfo.reportFreqSec} 秒` : '--' }}
          </span>
        </div>
      </div>
    </div>

    <!-- Device Info Breakdown Card -->
    <div v-if="sjzd.deviceInfo" class="section-card">
      <div class="card-header">
        <div class="header-left">
          <Cpu :size="16" class="section-icon" />
          <h3>智能采集终端已解析参数详情 (DevInfo 回读)</h3>
        </div>
        <span class="header-tag-success">已成功解析</span>
      </div>

      <div class="card-body">
        <div class="info-breakdown-grid">
          <div class="breakdown-item">
            <span class="b-label">设备唯一 SN：</span>
            <div class="b-value-wrap">
              <span class="b-value mono-text highlight">{{ sjzd.deviceInfo.sn || '--' }}</span>
              <button
                v-if="sjzd.deviceInfo.sn"
                class="inline-copy-btn"
                :class="{ copied: copiedSn }"
                :title="copiedSn ? '已复制' : '复制 SN 序列号'"
                @click="copySn(sjzd.deviceInfo.sn)"
              >
                <Check v-if="copiedSn" :size="12" class="copy-icon-success" />
                <Copy v-else :size="12" />
              </button>
            </div>
          </div>
          <div class="breakdown-item">
            <span class="b-label">设备型号 (Type)：</span>
            <span class="b-value mono-text">{{ sjzd.deviceInfo.deviceType || sjzd.deviceInfo.hwVersion || '--' }}</span>
          </div>
          <div class="breakdown-item">
            <span class="b-label">设备现场地址 (Addr)：</span>
            <span class="b-value mono-text">{{ sjzd.deviceInfo.deviceAddr || '--' }}</span>
          </div>
          <div class="breakdown-item">
            <span class="b-label">累计开机次数 (PwrOnCnt)：</span>
            <span class="b-value mono-text">{{ sjzd.deviceInfo.bootCount !== undefined ? `${sjzd.deviceInfo.bootCount} 次` : '--' }}</span>
          </div>
          <div class="breakdown-item">
            <span class="b-label">累计运行时间 (TotRunTim)：</span>
            <span class="b-value mono-text">{{ formatUptime(sjzd.deviceInfo.uptimeSec) }}</span>
          </div>
          <div class="breakdown-item">
            <span class="b-label">周期上报频率 (RptFreq)：</span>
            <span class="b-value mono-text">{{ sjzd.deviceInfo.reportFreqSec !== undefined ? `${sjzd.deviceInfo.reportFreqSec} 秒` : '--' }}</span>
          </div>
          <div v-if="sjzd.deviceInfo.rawText" class="breakdown-item full-width">
            <span class="b-label">最新回读原始响应：</span>
            <span class="b-value mono-text raw-line">{{ sjzd.deviceInfo.rawText }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Production SN Burning Form -->
    <div class="section-card">
      <div class="card-header">
        <div class="header-left">
          <Flame :size="18" class="section-icon" />
          <h3>产线 12 位 SN 固化烧录</h3>
        </div>
        <div class="header-right-badges">
          <span class="header-tag">严格定长 15 字节 (无\r\n)</span>
        </div>
      </div>

      <div class="card-body">
        <div class="burn-intro">
          <p>
            <strong>实施人员操作指引：</strong>
            SJZDV3 固件要求 SN 指令为严格定长 15 字节（<code>SN:4301xxxxxxxx</code>），严禁附加 <code>\r\n</code> 尾随符。
            写入成功后硬件将立即自动复位重启并生效。支持扫码枪扫入及批量流水号自动递增。
          </p>
        </div>

        <div class="sn-form-row">
          <div class="input-with-badge">
            <span class="prefix-badge">SN:</span>
            <input
              v-model="inputSn"
              type="text"
              maxlength="12"
              placeholder="请输入 12 位纯数字序列号 (如 4301xxxxxxxx)"
              class="sn-input mono-text"
              :class="{ invalid: !isSnValid && inputSn.length > 0, valid: isSnValid }"
              @input="handleSnInput"
            />
          </div>

          <div class="sn-quick-tools">
            <button
              v-if="sjzd.deviceInfo?.sn && sjzd.deviceInfo.sn !== '--'"
              class="btn btn-sm btn-ghost"
              title="一键填入当前设备回读到的 SN"
              @click="fillReadbackSn"
            >
              <Copy :size="12" />
              <span>填入当前回读 SN</span>
            </button>
            <button
              v-if="inputSn"
              class="btn btn-sm btn-ghost"
              title="清空当前输入框"
              @click="clearSnInput"
            >
              <X :size="12" />
              <span>清空</span>
            </button>
          </div>

          <button
            class="btn btn-burn"
            :disabled="!isSnValid || !serial.connectedPort || sjzd.isBusy"
            @click="triggerBurnSn"
          >
            <Flame :size="16" />
            <span>写入并重启生效 (SN:{{ inputSn }})</span>
          </button>

          <button
            class="btn btn-secondary"
            :disabled="!serial.connectedPort || sjzd.isBusy"
            title="重新查询 DEVINFO 校验设备当前回读 SN 是否一致"
            @click="verifySnMatch"
          >
            <Check :size="14" />
            <span>回读校验</span>
          </button>
        </div>

        <!-- Helper Options: Auto Increment -->
        <div class="batch-helper-row">
          <label class="checkbox-label">
            <input v-model="autoIncrement" type="checkbox" />
            <span class="label-text">
              <Sparkles :size="13" class="sparkle-icon" />
              <strong>批量生产模式：</strong> 每次烧录成功后，末尾序列号自动 +1
            </span>
          </label>
        </div>

        <div class="validation-bar" :class="{ error: !isSnValid, success: isSnValid }">
          <span>{{ snValidationMessage }}</span>
        </div>
      </div>
    </div>

    <!-- Raw Protocol Payload Viewer -->
    <div class="section-card">
      <div class="card-header">
        <div class="header-left">
          <Cpu :size="16" class="icon-muted" />
          <h3>底层下发字节流 (Hex Payload 预览)</h3>
        </div>
      </div>

      <div class="card-body">
        <div class="hex-viewer mono-text">
          <div class="hex-item">
            <span class="label">指令字符：</span>
            <span class="val">SN:{{ inputSn || '4301xxxxxxxx' }}</span>
          </div>
          <div class="hex-item">
            <span class="label">十六进制：</span>
            <span class="val hex-bytes">
              53 4E 3A {{
                inputSn
                  ? Array.from(inputSn)
                      .map((c) => c.charCodeAt(0).toString(16).toUpperCase())
                      .join(' ')
                  : '34 33 30 31 ...'
              }}
            </span>
          </div>
          <div class="hex-item">
            <span class="label">字节长度：</span>
            <span class="val" :class="{ ok: inputSn.length === 12 }">
              {{ inputSn.length + 3 }} 字节 (严格定长 15 字节)
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Confirmation Modal for High-Risk SN Burn -->
    <ConfirmModal
      :visible="showConfirmModal"
      title="确认写入设备 SN 并重启？"
      :message="`即将向设备写入 SN: ${inputSn}。写入后将持久化存入 AT24C16 EEPROM 并触发单片机硬件重启。`"
      danger-level="high"
      confirm-text="确认固化并重启"
      @confirm="confirmBurnSn"
      @cancel="showConfirmModal = false"
    />
  </div>
</template>

<style scoped>
.view-container {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
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

.notice-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 0.82rem;
}
.notice-bar.success {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #34d399;
}
.notice-bar.error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.metric-card {
  position: relative;
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 14px;
}

.card-copy-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: 1px solid var(--border, #2a2f42);
  background: var(--bg-input, #232736);
  color: var(--text-muted, #94a3b8);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
}

.card-copy-btn:hover {
  background: #2e3448;
  color: #fff;
  border-color: #3b82f6;
}

.card-copy-btn.copied {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.4);
  color: #34d399;
}

.copy-icon-success {
  color: #34d399;
}

.b-value-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inline-copy-btn {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted, #94a3b8);
  border-radius: 4px;
  padding: 2px 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.inline-copy-btn:hover {
  background: var(--bg-input, #232736);
  color: #fff;
  border-color: var(--border, #2a2f42);
}

.inline-copy-btn.copied {
  color: #34d399;
}

.metric-icon {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.metric-icon.blue {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}
.metric-icon.green {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
}
.metric-icon.purple {
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
}
.metric-icon.amber {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}
.metric-icon.teal {
  background: rgba(20, 184, 166, 0.15);
  color: #2dd4bf;
}

.header-tag-success {
  font-size: 0.7rem;
  font-family: var(--font-mono, monospace);
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  padding: 2px 8px;
  border-radius: 4px;
}

.info-breakdown-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
  background: var(--bg-app, #0f111a);
  padding: 14px;
  border-radius: 6px;
}

.breakdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.8rem;
}

.breakdown-item.full-width {
  grid-column: 1 / -1;
  border-top: 1px dashed var(--border, #2a2f42);
  padding-top: 10px;
  margin-top: 4px;
}

.b-label {
  color: var(--text-muted, #94a3b8);
  flex-shrink: 0;
  min-width: 140px;
}

.b-value {
  color: var(--text-main, #e2e8f0);
  font-weight: 500;
}

.b-value.highlight {
  color: #60a5fa;
  font-weight: 700;
}

.raw-line {
  color: #94a3b8;
  font-size: 0.75rem;
  word-break: break-all;
}

.metric-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.metric-label {
  font-size: 0.75rem;
  color: var(--text-muted, #94a3b8);
}

.metric-value {
  font-size: 1.1rem;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  color: var(--text-main, #e2e8f0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.section-icon {
  color: #f97316;
}
.icon-muted {
  color: var(--text-muted, #94a3b8);
}

.header-tag {
  font-size: 0.7rem;
  font-family: var(--font-mono, monospace);
  background: rgba(249, 115, 22, 0.15);
  color: #fb923c;
  padding: 2px 8px;
  border-radius: 4px;
}

.card-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.burn-intro p {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-muted, #94a3b8);
  line-height: 1.5;
}

.sn-form-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.sn-quick-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border, #2a2f42);
  color: var(--text-muted, #94a3b8);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 0.76rem;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-ghost:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border-color: #3b82f6;
}

.input-with-badge {
  display: flex;
  align-items: center;
  background: var(--bg-input, #232736);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 6px;
  overflow: hidden;
  flex: 1;
  min-width: 260px;
  max-width: 380px;
  transition: border-color 0.15s;
}

.prefix-badge {
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  font-weight: 700;
  color: #fb923c;
  font-family: var(--font-mono, monospace);
  font-size: 0.9rem;
  border-right: 1px solid var(--border, #2a2f42);
}

.sn-input {
  flex: 1;
  background: transparent;
  border: none;
  padding: 8px 12px;
  color: #fff;
  font-size: 1rem;
  font-weight: 600;
  outline: none;
  letter-spacing: 0.08em;
}

.batch-helper-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.label-text {
  font-size: 0.8rem;
  color: var(--text-main, #e2e8f0);
  display: flex;
  align-items: center;
  gap: 4px;
}

.sparkle-icon {
  color: #fbbf24;
}

.validation-bar {
  font-size: 0.78rem;
  padding: 4px 8px;
  border-radius: 4px;
}
.validation-bar.error {
  color: #f87171;
}
.validation-bar.success {
  color: #34d399;
}

.hex-viewer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg-app, #0f111a);
  padding: 12px;
  border-radius: 6px;
  font-size: 0.78rem;
}

.hex-item {
  display: flex;
  gap: 12px;
}

.hex-item .label {
  color: var(--text-muted, #94a3b8);
  width: 90px;
  flex-shrink: 0;
}

.hex-item .val {
  color: var(--text-main, #e2e8f0);
}

.hex-bytes {
  color: #93c5fd;
}

.val.ok {
  color: #34d399;
  font-weight: 600;
}

.mono-text {
  font-family: var(--font-mono, monospace);
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

.btn-burn {
  background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
  color: #fff;
  font-weight: 600;
}
.btn-burn:hover:not(:disabled) {
  background: linear-gradient(135deg, #fb923c 0%, #f97316 100%);
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
