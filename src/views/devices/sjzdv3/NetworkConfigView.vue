<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { EthernetPort, RefreshCw, Save, RotateCcw, Radio, Copy, Activity } from 'lucide-vue-next'
import { useSjzdStore } from '../../../stores/sjzdStore'
import { useSerialStore } from '../../../stores/serialStore'
import type { SjzdNetworkConfig, SjzdNetworkRecord, SjzdNetworkStatusKind } from '../../../types/sjzd'
import { SJZD_NETWORK_DEFAULTS, SJZD_NETWORK_FIELDS, normalizeSjzdNetworkConfig, sameSjzdNetworkConfig, validateSjzdNetworkConfig } from '../../../utils/sjzdNetwork'
import SjzdHardwareSelector from '../../../components/common/SjzdHardwareSelector.vue'
import ConfirmModal from '../../../components/common/ConfirmModal.vue'

const sjzd = useSjzdStore()
const serial = useSerialStore()
const router = useRouter()
const draft = ref<SjzdNetworkConfig>({ ...SJZD_NETWORK_DEFAULTS })
const baseline = ref<SjzdNetworkConfig | null>(null)
const confirmation = ref<'restart' | 'reset' | 'SLE' | '4G' | 'NETTY' | 'LOCAL' | null>(null)
const localMessage = ref('')
const enteredAt = Date.now()
const displayMessage = computed(() => localMessage.value || (sjzd.lastOpMessage && sjzd.lastOpMessage.time >= enteredAt ? sjzd.lastOpMessage.text : ''))
const dirty = computed(() => Boolean(baseline.value && !sameSjzdNetworkConfig(normalizeSjzdNetworkConfig(draft.value), baseline.value)))
const errors = computed(() => validateSjzdNetworkConfig(normalizeSjzdNetworkConfig(draft.value)))
const canRead = computed(() => Boolean(serial.connectedPort && !sjzd.isBusy && sjzd.hardwareVariant !== 'f411'))
const canWrite = computed(() => Boolean(canRead.value && sjzd.networkSupported === true && sjzd.networkSnapshotFresh))
const hasSnapshot = computed(() => Boolean(sjzd.networkSnapshot))
const actualTransport = computed(() => sjzd.networkStatus?.parts.STATUS?.report_transport
  || (sjzd.wlanTypeInfo.lastSyncTime ? sjzd.wlanTypeInfo.reportTransport : undefined) || '未返回')
const transportLabel = computed(() => sjzd.wlanTypeInfo.modeSource === 'AUTO_PROBING' ? '自动探测中'
  : actualTransport.value === 'NONE' ? '未启用主动上报' : actualTransport.value)
const moduleStateLabel = computed(() => {
  const state = sjzd.wlanTypeInfo.moduleState
  return state ? { DISABLED: '不使用无线模块', PROBING: '探测中', RESPONDING: '有应答',
    NO_RESPONSE: '无应答，后台重试', BRIDGE: '透传中，检测暂停' }[state] : '旧固件未提供'
})
const modeSourceLabel = computed(() => {
  const source = sjzd.wlanTypeInfo.modeSource
  return source ? { SAVED: '已保存配置', LEGACY_NETTY: '已有 Netty 配置',
    AUTO_PROBING: '未配置，自动探测中', AUTO: '本次启动自动识别' }[source] : '旧固件未提供'
})
const fields = SJZD_NETWORK_FIELDS.filter((field) => field.key !== 'flags').map((field) => ({ ...field,
  numeric: ['nettyPort', 'modbusPort', 'aiUnit'].includes(field.key),
  hint: ({ ip: '设备自己的地址；电脑请使用同网段其他 IP。', mask: '连续掩码，支持 /1～/30。', gateway: '同网段直连可填 0.0.0.0。',
    nettyIp: '接收设备上报的服务器地址；不是设备 IP。', nettyPort: '关闭时可保留预配置；未配置目标 IP 与端口成对为 0。',
    aiUnit: '1～247，不能与既有 RS485 从站冲突。', modbusPort: '设备本机监听端口，默认 502。' } as Record<string, string>)[field.key],
}))

function copySaved(feedback = true) {
  if (!sjzd.networkSnapshot || !sjzd.networkSnapshotFresh) return
  draft.value = { ...sjzd.networkSnapshot.saved }
  baseline.value = { ...sjzd.networkSnapshot.saved }
  localMessage.value = feedback ? '已将完整保存值复制到编辑区；回填动作没有写入设备。' : ''
}

watch(() => sjzd.networkSnapshot, (snapshot) => {
  if (!snapshot) { draft.value = { ...SJZD_NETWORK_DEFAULTS }; baseline.value = null; return }
  if (!baseline.value || !dirty.value) {
    draft.value = { ...snapshot.saved }
    baseline.value = { ...snapshot.saved }
    localMessage.value = ''
  }
}, { immediate: true })

watch(() => serial.connectedPort, () => { confirmation.value = null; localMessage.value = '' })
watch(() => sjzd.hardwareVariant, () => { confirmation.value = null })

function changeField(key: keyof SjzdNetworkConfig, event: Event) {
  const text = (event.target as HTMLInputElement).value
  if (['nettyPort', 'modbusPort', 'aiUnit'].includes(key)) (draft.value[key] as number) = Number(text)
  else (draft.value[key] as string) = text
  localMessage.value = ''
}

function toggleFlag(bit: number, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  draft.value.flags = checked ? draft.value.flags | bit : draft.value.flags & ~bit
  localMessage.value = ''
}

function focusField(key: keyof SjzdNetworkConfig) {
  const input = document.getElementById(`net-${key}`)
  input?.focus({ preventScroll: true })
  input?.scrollIntoView({ block: 'center' })
}

async function readConfig() {
  localMessage.value = ''
  await sjzd.queryNetworkConfig()
}

async function refreshStatus() {
  localMessage.value = ''
  await sjzd.refreshNetworkStatus()
}

async function save() {
  localMessage.value = ''
  const saved = await sjzd.saveNetworkConfig(draft.value)
  if (saved) copySaved(false)
}

function flagLabel(value: number) {
  return ['两项均关闭', '仅 Netty', '仅 Modbus TCP', 'Netty + Modbus TCP'][value] || `未知 ${value}`
}

function display(config: SjzdNetworkConfig | undefined, key: keyof SjzdNetworkConfig) {
  if (!config) return '未读取'
  return key === 'flags' ? `${config.flags} · ${flagLabel(config.flags)}` : String(config[key])
}

function recordLabel(record: SjzdNetworkRecord | undefined) {
  if (!record) return '未读取'
  return record.valid ? '有效记录' : `${record.code} · 以下为默认回退值`
}

const pendingLabel = computed(() => !sjzd.networkSnapshotFresh ? '未确认 / 历史回显'
  : sjzd.networkSnapshot?.pendingRestart === 'YES' ? '已保存，待重启生效'
    : sjzd.networkSnapshot?.pendingRestart === 'NO' ? '保存值与运行值一致' : '存储状态未知')
const confirmationTitle = computed(() => confirmation.value === 'restart' ? '重启并复核网络配置'
  : confirmation.value === 'reset' ? '仅清除网络配置记录'
    : confirmation.value === 'LOCAL' ? '仅使用 Modbus TCP（关闭主动上报）' : `选择 ${confirmation.value} 上报`)
const confirmationMessage = computed(() => confirmation.value === 'restart'
  ? `将重启设备并核对 SN、EEPROM 保存值及启动运行值。目标 ${sjzd.networkSnapshot?.saved.ip}:${sjzd.networkSnapshot?.saved.modbusPort}，${flagLabel(sjzd.networkSnapshot?.saved.flags || 0)}。`
  : confirmation.value === 'reset'
    ? '仅清除网络记录，保留 SN、无线配置和 485 点表。重启后默认 192.168.30.55:502、AI247、Netty 关闭；若 AI247 与 485 从站冲突，服务将拒绝启动。'
    : confirmation.value === 'LOCAL'
      ? '关闭星闪、4G 和 Netty 主动上报，开启 Modbus TCP；保留本机 IP、端口及采集点表，保存后自动重启。即使无线模块仍插着，重启后也不再探测或初始化；需要时可重新选择星闪或 4G。'
      : confirmation.value === 'NETTY'
      ? '保存 Netty 上报选择并重启，停用无线 UART2；服务器和连接开关仍按网络配置启用。仅使用本机 Modbus TCP 时无需执行此操作。'
      : `保存 ${confirmation.value} 选择并重启，清除 Netty 开关，保留 Modbus TCP 开关和其他网参。尚未保存的编辑内容不参与切换。`)

async function confirm() {
  const action = confirmation.value
  confirmation.value = null
  localMessage.value = ''
  if (action === 'restart') await sjzd.restartNetworkAndVerify()
  else if (action === 'reset') { if (await sjzd.resetNetworkConfig()) copySaved(false) }
  else if (action === 'SLE' || action === '4G' || action === 'NETTY' || action === 'LOCAL') await sjzd.setWirelessMode(action)
}

const statusGroups: Array<{ kind: SjzdNetworkStatusKind; title: string; metrics: Array<[string, string, string?, SjzdNetworkStatusKind?]> }> = [
  { kind: 'STATUS', title: '网口与链路', metrics: [['ip', '实际 IP'], ['driver', '驱动'], ['error', '驱动结果'], ['link', '链路'], ['speed_mbps', '协商速率', 'Mbps'], ['full_duplex', '全双工'], ['mac', 'MAC'], ['rx', '接收帧'], ['tx', '发送帧'], ['rx_errors', '接收错误'], ['tx_errors', '发送错误'], ['spi_errors', 'SPI 错误'], ['rx_drops', '接收丢弃']] },
  { kind: 'NETTY', title: 'Netty 主动上报', metrics: [['enabled', '启用'], ['state', '连接状态'], ['last_error', '最近错误'], ['connections', '累计建连'], ['rx_frames', '接收帧'], ['tx_frames', '发送帧'], ['errors', '累计错误']] },
  { kind: 'MODBUS', title: 'Modbus TCP 服务', metrics: [['enabled', '启用'], ['listening', '监听'], ['error', '最近错误'], ['clients', '客户端'], ['requests', '读取请求'], ['exceptions', '异常响应'], ['rejected', '拒绝连接'], ['stack_free', '栈余量', 'B']] },
  { kind: 'CACHE', title: '采集缓存', metrics: [['ai_valid', 'AI 有效'], ['ai_age_ms', 'AI 年龄', 'ms'], ['valid_points', '有效 485 点'], ['oldest_age_ms', '最老缓存年龄', 'ms'], ['config_generation', '配置代次'], ['wlan_stack_free', '上报栈余量', 'B']] },
  { kind: 'RESOURCES', title: '运行资源', metrics: [['free_heap', '系统 heap 余量', 'B', 'STATUS'], ['min_free_heap', '系统 heap 最低余量', 'B', 'STATUS'], ['network_stack_free', '网口任务栈余量', 'B', 'STATUS'], ['lwip_heap_used', 'LwIP heap', 'B'], ['lwip_heap_max', 'heap 峰值', 'B'], ['lwip_heap_errors', 'heap 分配错误'], ['netconn_used', 'netconn 使用'], ['netconn_errors', 'netconn 错误'], ['tcp_pcb_used', 'TCP PCB 使用'], ['tcp_pcb_errors', 'TCP PCB 错误'], ['netbuf_used', 'netbuf 使用'], ['netbuf_max', 'netbuf 峰值'], ['netbuf_errors', 'netbuf 错误'], ['core_stack_free', '协议栈栈余量', 'B']] },
]
const currentAddress = computed(() => sjzd.networkStatus?.parts.STATUS?.ip)
const canDebugAi = computed(() => Boolean(canWrite.value && sjzd.networkStatus?.complete && currentAddress.value
  && sjzd.networkStatus.parts.STATUS?.link === 'UP' && sjzd.networkStatus.parts.MODBUS?.listening === '1'
  && sjzd.networkStatus.parts.MODBUS?.enabled === '1' && (sjzd.networkSnapshot!.running.flags & 2)))

function openAiDebug() {
  if (!canDebugAi.value) return
  router.push({ path: '/modbus', query: { sjzd: 'ai', host: currentAddress.value,
    port: String(sjzd.networkSnapshot!.running.modbusPort), unit: String(sjzd.networkSnapshot!.running.aiUnit) } })
}

async function copyTrace() {
  try {
    await navigator.clipboard.writeText(sjzd.networkTrace.map((line) => `[${line.time}] ${line.direction} ${line.text}`).join('\n'))
    localMessage.value = '已复制本次设备的网络指令与原始回包。'
  } catch { localMessage.value = '复制失败，请在下方选择并复制原始回包。' }
}
</script>

<template>
  <main class="network-page">
    <header class="page-header">
      <div class="heading"><EthernetPort :size="26" aria-hidden="true" /><div><h1>网口与上报承载</h1><p>F412 · 静态 IPv4、Netty 与 Modbus TCP。修改先保存读回，再重启复核。</p></div></div>
      <button class="button primary" :disabled="!canRead" @click="readConfig"><RefreshCw :size="15" aria-hidden="true" />{{ sjzd.isBusy ? '等待设备回包…' : '读取配置与状态' }}</button>
    </header>

    <SjzdHardwareSelector />

    <section v-if="sjzd.hardwareVariant === 'f411'" class="notice" role="status">
      <strong>STM32F411 不具备网口功能</strong><p>此设备不开放网络表单，也不发送 NET 查询或保存指令。SLE、4G 和 RS485 功能继续使用。</p>
      <router-link to="/devices/sjzdv3">返回设备信息</router-link>
    </section>
    <template v-else>
      <div v-if="!serial.connectedPort" class="notice" role="status">请先连接设备 UART1（115200 8N1），再确认芯片并读取配置。</div>
      <div v-else-if="sjzd.hardwareVariant === 'unknown'" class="notice" role="status">芯片待确认。可先选择 F411 / F412，或点击“读取配置与状态”只读探测；成功取得完整 NET 快照后确认 F412 网口固件能力。</div>
      <div v-if="sjzd.networkSupported === false" class="notice warning" role="status">当前固件明确不支持 NET 协议。F412 请升级配套网口固件；F411 没有网络硬件。</div>
      <div v-if="sjzd.networkError" class="notice error" role="alert">{{ sjzd.networkError }}</div>
      <p v-if="displayMessage" class="operation-message" role="status" aria-live="polite">{{ displayMessage }}</p>

      <section class="summary" aria-label="配置与运行概况">
        <div><span>本次配置</span><strong :class="{ warning: !sjzd.networkSnapshotFresh || sjzd.networkSnapshot?.pendingRestart === 'YES' }">{{ pendingLabel }}</strong></div>
        <div><span>主动上报方式</span><strong>{{ transportLabel }}</strong><small>当前选择 {{ sjzd.wlanTypeInfo.lastSyncTime ? sjzd.wlanTypeInfo.mode === 'NONE' ? sjzd.wlanTypeInfo.savedModeCode === 254 ? '主动上报已关闭' : '未选择' : sjzd.wlanTypeInfo.mode : '未读取' }}；UART2 {{ sjzd.wlanTypeInfo.uart2Active === undefined ? '未返回' : sjzd.wlanTypeInfo.uart2Active ? '参与上报' : '停用' }}</small><small>模式保存字节：{{ sjzd.wlanTypeInfo.savedReadOk === false ? '读取失败' : sjzd.wlanTypeInfo.savedModeCode ?? '未返回' }}（2=SLE / 3=4G / 4=Netty / 254=关闭 / 0=未配置）</small></div>
        <div><span>最后完整配置</span><strong>{{ sjzd.networkSnapshot?.evidence.completedAt ? new Date(sjzd.networkSnapshot.evidence.completedAt).toLocaleTimeString() : '未读取' }}</strong><small>{{ sjzd.networkRestartVerifiedAt ? '已通过重启后复核' : sjzd.networkSaveVerified ? '已通过保存后读回，尚未复核重启' : '尚无保存后复核结果' }}</small></div>
      </section>

      <p class="notice" role="status">模式来源：{{ modeSourceLabel }}；无线模块串口：{{ moduleStateLabel }}。模块有应答与蜂窝、MQTT 联网状态分别显示。</p>

      <section v-if="hasSnapshot" class="panel">
        <div class="panel-heading"><div><h2>网络参数</h2><p>编辑值只在本地。SAVED 为 EEPROM 保存值，RUNNING 为本次启动快照。</p></div><button class="button" :disabled="!canWrite" @click="copySaved()">用保存值回填</button></div>
        <div v-if="!sjzd.networkSnapshotFresh" class="notice warning">下方保留上次完整回显，当前已失效或读取失败。请重新读取后再保存。</div>
        <fieldset :disabled="!canWrite">
          <legend class="sr-only">编辑网络配置</legend>
          <div v-if="Object.keys(errors).length" class="notice error" role="alert"><strong>请修正以下字段：</strong><ul><li v-for="(error, key) in errors" :key="key"><button type="button" class="field-error-link" @click="focusField(key)">{{ SJZD_NETWORK_FIELDS.find(field => field.key === key)?.label }}：{{ error }}</button></li></ul></div>
          <div class="switches">
            <label><input type="checkbox" :checked="Boolean(draft.flags & 1)" @change="toggleFlag(1, $event)">启用 Netty 主动上报</label>
            <label><input type="checkbox" :checked="Boolean(draft.flags & 2)" @change="toggleFlag(2, $event)">启用 Modbus TCP 服务</label>
            <span>组合值 {{ draft.flags }} · {{ flagLabel(draft.flags) }}</span>
          </div>
          <div class="form-grid">
            <label v-for="field in fields" :key="field.key" :for="`net-${field.key}`">
              <span>{{ field.label }}</span>
              <input
                :id="`net-${field.key}`" :value="draft[field.key]" :type="field.numeric ? 'number' : 'text'" :inputmode="field.numeric ? 'numeric' : 'decimal'"
                :min="field.key === 'nettyPort' ? 0 : 1" :max="field.key === 'aiUnit' ? 247 : 65535" autocomplete="off" :spellcheck="false"
                :aria-invalid="Boolean(errors[field.key])" :aria-describedby="`net-help-${field.key}`" @input="changeField(field.key, $event)"
              >
              <small :id="`net-help-${field.key}`" :class="{ 'field-error': errors[field.key] }">{{ errors[field.key] || field.hint }}</small>
            </label>
          </div>
        </fieldset>
        <div class="form-actions">
          <span>{{ dirty ? '编辑值有未保存修改' : !sjzd.networkSnapshot?.saved.valid ? 'EEPROM 记录未配置或无效，可显式保存当前回退值' : '编辑值与最近回填一致' }}</span>
          <button class="button primary" :disabled="!canWrite || (!dirty && sjzd.networkSnapshot?.saved.valid) || Object.keys(errors).length > 0" @click="save"><Save :size="15" aria-hidden="true" />保存并读回复核</button>
          <button class="button" :disabled="!canWrite || dirty" @click="confirmation = 'restart'"><RotateCcw :size="15" aria-hidden="true" />重启并复核</button>
        </div>

        <div class="table-scroll">
          <table aria-label="编辑、保存和运行值对照">
            <thead><tr><th>字段</th><th>编辑值</th><th>EEPROM 保存值 (SAVED)</th><th>本次运行值 (RUNNING)</th></tr></thead>
            <tbody>
              <tr><th>记录状态</th><td>本地草稿</td><td>{{ recordLabel(sjzd.networkSnapshot?.saved) }}</td><td>{{ recordLabel(sjzd.networkSnapshot?.running) }}<small v-if="sjzd.networkSnapshot?.saved.valid !== sjzd.networkSnapshot?.running.valid">记录状态不同，待重启重新加载</small></td></tr>
              <tr v-for="field in SJZD_NETWORK_FIELDS" :key="field.key" :class="{ difference: draft[field.key] !== sjzd.networkSnapshot?.saved[field.key] || sjzd.networkSnapshot?.saved[field.key] !== sjzd.networkSnapshot?.running[field.key] }">
                <th>{{ field.label }}</th><td>{{ display(draft, field.key) }}</td><td>{{ display(sjzd.networkSnapshot?.saved, field.key) }}</td><td>{{ display(sjzd.networkSnapshot?.running, field.key) }}<small v-if="sjzd.networkSnapshot?.saved[field.key] !== sjzd.networkSnapshot?.running[field.key]">与保存值不同，待重启</small></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="evidence">完整事务 {{ sjzd.networkSnapshot?.evidence.transactionId }} · revision {{ sjzd.networkSnapshot?.evidence.revisionHex }} · CRC32 {{ sjzd.networkSnapshot?.evidence.crc32 }} · {{ sjzd.networkSnapshotFresh ? '当前连接已完整读取' : '历史记录，未确认' }}</p>
      </section>

      <section class="panel">
        <div class="panel-heading"><div><h2>运行状态回显</h2><p>按需查询，不自动覆盖编辑区。未返回的字段保持未知，计数 0 按实际回显显示。</p></div><button class="button" :disabled="!canRead || sjzd.networkSupported !== true" @click="refreshStatus"><RefreshCw :size="15" aria-hidden="true" />刷新状态</button></div>
        <p class="state-note">{{ !sjzd.networkStatus ? '尚未读取运行状态' : sjzd.networkStatus.complete ? `本次五类状态已完整返回 · ${new Date(sjzd.networkStatus.receivedAt).toLocaleTimeString()}` : `状态未完整返回，缺少：${sjzd.networkStatus.missing.join('、')}` }}</p>
        <div class="status-grid">
          <article v-for="group in statusGroups" :key="group.kind">
            <h3>{{ group.title }}</h3><dl>
              <template v-for="[key, label, unit, source] in group.metrics" :key="key"><dt>{{ label }}</dt><dd>{{ sjzd.networkStatus?.parts[source || group.kind]?.[key] === undefined ? '未返回' : `${sjzd.networkStatus.parts[source || group.kind]![key]}${unit ? ' ' + unit : ''}` }}</dd></template>
            </dl>
          </article>
        </div>
        <div class="service-actions"><button class="button" :disabled="!canDebugAi" @click="openAiDebug"><Activity :size="15" aria-hidden="true" />用当前运行地址调试 AI</button><span>{{ currentAddress || '实际 IP 未返回' }}:{{ sjzd.networkSnapshot?.running.modbusPort ?? '—' }} · Unit {{ sjzd.networkSnapshot?.running.aiUnit ?? '—' }} · FC04 / PDU 0、2 / FLOAT32 / ABCD</span></div>
      </section>

      <section class="panel maintenance">
        <div><h2>主动上报方式与网络重置</h2><p>星闪、4G、Netty 是三种可选上报方式。Modbus TCP 默认开启，配置本机 IP 即可被动读取数据，不要求选择任何上报方式。Netty 仅按显式配置连接服务器。</p></div>
        <div class="service-actions"><button class="button" :disabled="!canWrite || dirty" @click="confirmation = 'SLE'"><Radio :size="15" aria-hidden="true" />星闪上报</button><button class="button" :disabled="!canWrite || dirty" @click="confirmation = '4G'">4G 上报</button><button class="button" :disabled="!canWrite || dirty" @click="confirmation = 'NETTY'"><EthernetPort :size="15" aria-hidden="true" />Netty 上报</button><button class="button danger" :disabled="!canWrite || dirty" @click="confirmation = 'reset'">仅重置网络配置</button></div>
        <div class="service-actions"><button class="button" :disabled="!canWrite || dirty || !sjzd.wlanTypeInfo.modeSource" @click="confirmation = 'LOCAL'"><EthernetPort :size="15" aria-hidden="true" />仅使用 Modbus TCP（关闭主动上报）</button><span>无线模块可拔插；关闭状态保存后，重启也不恢复无线初始化。旧固件需先升级。</span></div>
      </section>

      <section class="panel"><details><summary>本次设备原始指令与回包（{{ sjzd.networkTrace.length }} 行）</summary><button class="button trace-copy" :disabled="!sjzd.networkTrace.length" @click="copyTrace"><Copy :size="14" aria-hidden="true" />复制回包</button><pre>{{ sjzd.networkTrace.map(line => `[${line.time}] ${line.direction} ${line.text}`).join('\n') || '尚无网络指令记录' }}</pre></details></section>
    </template>
    <ConfirmModal :visible="confirmation !== null" :title="confirmationTitle" :message="confirmationMessage" confirm-text="确认执行" @confirm="confirm" @cancel="confirmation = null" />
  </main>
</template>

<style scoped>
.network-page { height: 100%; overflow: auto; padding: 16px; color: var(--text-main); background: var(--bg-app); }
.page-header, .heading, .panel-heading, .form-actions, .service-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.page-header { justify-content: space-between; margin-bottom: 14px; }
.heading > svg { color: var(--accent); flex-shrink: 0; }
h1 { margin: 0 0 5px; font-size: 21px; } h2 { margin: 0 0 5px; font-size: 16px; } h3 { margin: 0 0 10px; font-size: 14px; }
p { margin: 0; line-height: 1.65; font-size: 13px; color: var(--text-muted); }
.button { min-height: 36px; padding: 7px 12px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-panel); color: var(--text-main); cursor: pointer; font-size: 13px; }
.button:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--accent); } .button.primary { background: var(--accent); border-color: var(--accent); color: white; } .button.primary:hover:not(:disabled) { background: var(--accent-hover); } .button.danger { color: var(--danger); } .button:disabled { cursor: not-allowed; opacity: .5; }
.panel { margin-bottom: 14px; padding: 16px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius); }
.panel-heading { justify-content: space-between; margin-bottom: 14px; } .panel-heading > div { flex: 1 1 250px; }
.notice { padding: 12px 14px; margin-bottom: 14px; background: var(--color-surface-3); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 13px; line-height: 1.6; } .notice.warning { color: var(--color-warning); border-color: var(--color-warning); } .notice.error { color: var(--danger); border-color: var(--danger); } .operation-message { margin: 0 0 14px; }
.summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 14px; gap: 12px; } .summary > div { display: flex; flex-direction: column; gap: 6px; background: var(--bg-panel); padding: 14px; border: 1px solid var(--border); border-radius: var(--radius); } .summary span, .summary small { color: var(--text-muted); font-size: 12px; } .summary strong { font-size: 15px; } .warning { color: var(--color-warning); }
fieldset { margin: 0; border: 0; padding: 0; min-width: 0; } fieldset:disabled { opacity: .65; }
.switches { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 16px; padding: 12px; border: 1px solid var(--border); background: var(--bg-input); border-radius: var(--radius-sm); } .switches label { display: flex; align-items: center; gap: 7px; min-height: 28px; font-size: 13px; cursor: pointer; } .switches input { width: 17px; height: 17px; accent-color: var(--accent); } .switches > span { font-size: 12px; color: var(--text-muted); }
.form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 18px; } .form-grid label { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: 13px; } .form-grid input { width: 100%; height: 36px; padding: 7px 10px; color: var(--text-main); background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: var(--font-mono); } .form-grid input[aria-invalid=true] { border-color: var(--danger); } .form-grid small { min-height: 32px; color: var(--text-muted); font-size: 12px; line-height: 1.5; } .form-grid .field-error { color: var(--danger); }
.form-actions { justify-content: flex-end; margin: 12px 0 16px; } .form-actions > span { margin-right: auto; font-size: 12px; color: var(--text-muted); }
.table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; } th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-border-subtle); overflow-wrap: anywhere; vertical-align: top; } thead th { background: var(--bg-input); } th:first-child { width: 19%; } td { font-family: var(--font-mono); } td small { display: block; font-family: var(--font-sans); color: var(--color-warning); font-size: 12px; margin-top: 4px; } tr.difference td { background: color-mix(in srgb, var(--color-warning) 7%, white); } .evidence { margin-top: 12px; font-size: 12px; overflow-wrap: anywhere; }
.status-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; } .status-grid article { padding: 14px; background: var(--bg-input); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); } dl { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 7px 12px; font-size: 12px; } dt { color: var(--text-muted); } dd { margin: 0; text-align: right; overflow-wrap: anywhere; font-family: var(--font-mono); } .state-note { margin-bottom: 12px; } .service-actions { margin-top: 14px; } .service-actions > span { font-size: 12px; color: var(--text-muted); overflow-wrap: anywhere; } .maintenance { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; } .maintenance .service-actions { margin-top: 0; }
summary { cursor: pointer; font-size: 13px; min-height: 28px; } .trace-copy { margin-top: 10px; } pre { max-height: 300px; overflow: auto; padding: 12px; background: var(--bg-input); font-size: 12px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); }
.field-error-link { border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: left; text-decoration: underline; cursor: pointer; }
@media (max-width: 1100px) { .form-grid, .status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 740px) { .network-page { padding: 10px; } .summary, .form-grid, .status-grid { grid-template-columns: 1fr; } .page-header > button { width: 100%; } .panel { padding: 12px; } table { min-width: 650px; } .button { min-height: 40px; } }
</style>
