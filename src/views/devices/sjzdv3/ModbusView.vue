<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import {
  Plus,
  Trash2,
  Download,
  Upload,
  RefreshCw,
  Send,
  Play,
  ArrowUp,
  ArrowDown,
  Info,
  Terminal,
  FileSpreadsheet,
  Copy,
  Check,
} from 'lucide-vue-next'
import { useSjzdStore } from '../../../stores/sjzdStore'
import { useSerialStore } from '../../../stores/serialStore'
import {
  MODBUS_FUNC_OPTIONS,
  MODBUS_DATA_TYPE_OPTIONS,
  MODBUS_BYTE_ORDER_OPTIONS,
  type ModbusPointConfig,
} from '../../../types/sjzd'
import { appSaveFile, appOpenFile } from '../../../api/sjzdApi'
import ConfirmModal from '../../../components/common/ConfirmModal.vue'
import CustomSelect from '../../../components/common/CustomSelect.vue'

const sjzd = useSjzdStore()
const serial = useSerialStore()

const showResetModal = ref(false)
// Keep the capture console out of the way until a test starts or the user opens it.
const showDebugDrawer = ref(false)
const activeDebugPoint = ref<ModbusPointConfig | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedPreset = ref('')
const copiedAll = ref(false)
const copiedLineIndex = ref<number | null>(null)
const debugLogsRef = ref<HTMLElement | null>(null)

watch(
  () => sjzd.modbusDebugLogs.length,
  () => {
    nextTick(() => {
      if (debugLogsRef.value) {
        debugLogsRef.value.scrollTop = debugLogsRef.value.scrollHeight
      }
    })
  }
)

const presetOptions = [
  { label: '⚡ 三相智能电表模版 (电压/电流/功率/电能)', value: 'meter' },
  { label: '🌡️ 4路工业温湿度变送器模版', value: 'sensor' },
  { label: '⚙️ 变频器常用运行参数模版', value: 'vfd' },
]

function onPresetChange(val: string) {
  if (val) {
    loadPreset(val as any)
    selectedPreset.value = ''
  }
}

function onDataTypeChanged(pt: ModbusPointConfig) {
  // Smart auto-correction: 32-bit types require length >= 2
  if ([3, 4, 5].includes(pt.dataType) && pt.length < 2) {
    pt.length = 2
  }
}

function addPoint() {
  if (sjzd.modbusPoints.length >= 16) {
    sjzd.showMessage('点位数量已达到上限 (最多 16 个)', false)
    return
  }
  sjzd.modbusPoints.push({
    slaveAddr: 1,
    funcCode: 3,
    regAddr: 40001,
    length: 1,
    dataType: 2, // UINT16
    byteOrder: 0, // ABCD
  })
}

function removePoint(index: number) {
  sjzd.modbusPoints.splice(index, 1)
}

function movePointUp(index: number) {
  if (index <= 0) return
  const item = sjzd.modbusPoints.splice(index, 1)[0]
  sjzd.modbusPoints.splice(index - 1, 0, item)
}

function movePointDown(index: number) {
  if (index >= sjzd.modbusPoints.length - 1) return
  const item = sjzd.modbusPoints.splice(index, 1)[0]
  sjzd.modbusPoints.splice(index + 1, 0, item)
}

async function handleReadFromDevice() {
  showDebugDrawer.value = true
  await sjzd.queryModbusPoints()
}

async function triggerSinglePointDebug(pt: ModbusPointConfig) {
  showDebugDrawer.value = true
  activeDebugPoint.value = pt
  await sjzd.debugModbusPoint(pt)
}

async function copyAllDebugLogs() {
  if (sjzd.modbusDebugLogs.length === 0) return
  try {
    const textToCopy = sjzd.modbusDebugLogs
      .map((l) => `[${l.timestamp}] ${l.text}`)
      .join('\n')
    await navigator.clipboard.writeText(textToCopy)
    copiedAll.value = true
    sjzd.showMessage('已复制全部调试报文到剪贴板')
    setTimeout(() => {
      copiedAll.value = false
    }, 2000)
  } catch (err) {
    sjzd.showMessage(`复制失败: ${err}`, false)
  }
}

async function copyLogLine(text: string, index: number) {
  try {
    await navigator.clipboard.writeText(text)
    copiedLineIndex.value = index
    sjzd.showMessage('已复制报文内容到剪贴板')
    setTimeout(() => {
      if (copiedLineIndex.value === index) {
        copiedLineIndex.value = null
      }
    }, 2000)
  } catch (err) {
    sjzd.showMessage(`复制失败: ${err}`, false)
  }
}

function clearDebugLogs() {
  sjzd.modbusDebugLogs = []
  sjzd.showMessage('已清空调试报文日志')
}

function clonePoint(index: number) {
  if (sjzd.modbusPoints.length >= 16) {
    sjzd.showMessage('点位数量已达到上限 (最多 16 个)', false)
    return
  }
  const source = sjzd.modbusPoints[index]
  sjzd.modbusPoints.splice(index + 1, 0, {
    ...source,
    regAddr: source.regAddr + source.length,
  })
}

function loadPreset(presetName: 'meter' | 'sensor' | 'vfd') {
  if (presetName === 'meter') {
    sjzd.modbusPoints = [
      { slaveAddr: 1, funcCode: 3, regAddr: 40001, length: 2, dataType: 5, byteOrder: 1 },
      { slaveAddr: 1, funcCode: 3, regAddr: 40003, length: 2, dataType: 5, byteOrder: 1 },
      { slaveAddr: 1, funcCode: 3, regAddr: 40005, length: 2, dataType: 5, byteOrder: 1 },
      { slaveAddr: 1, funcCode: 3, regAddr: 40007, length: 2, dataType: 5, byteOrder: 1 },
      { slaveAddr: 1, funcCode: 3, regAddr: 40009, length: 2, dataType: 5, byteOrder: 1 },
    ]
    sjzd.showMessage('已载入【三相智能电表】标准点位预设')
  } else if (presetName === 'sensor') {
    sjzd.modbusPoints = [
      { slaveAddr: 2, funcCode: 3, regAddr: 40001, length: 1, dataType: 2, byteOrder: 0 },
      { slaveAddr: 2, funcCode: 3, regAddr: 40002, length: 1, dataType: 2, byteOrder: 0 },
      { slaveAddr: 3, funcCode: 3, regAddr: 40001, length: 1, dataType: 2, byteOrder: 0 },
      { slaveAddr: 3, funcCode: 3, regAddr: 40002, length: 1, dataType: 2, byteOrder: 0 },
    ]
    sjzd.showMessage('已载入【温湿度变送器】标准点位预设')
  } else if (presetName === 'vfd') {
    sjzd.modbusPoints = [
      { slaveAddr: 1, funcCode: 3, regAddr: 40001, length: 1, dataType: 2, byteOrder: 0 },
      { slaveAddr: 1, funcCode: 3, regAddr: 40002, length: 1, dataType: 2, byteOrder: 0 },
      { slaveAddr: 1, funcCode: 3, regAddr: 40003, length: 1, dataType: 2, byteOrder: 0 },
      { slaveAddr: 1, funcCode: 1, regAddr: 10001, length: 1, dataType: 6, byteOrder: 0 },
    ]
    sjzd.showMessage('已载入【变频器运行监测】标准点位预设')
  }
}

function parsePointsContent(fileName: string, content: string) {
  if (fileName.endsWith('.json')) {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      sjzd.modbusPoints = parsed.slice(0, 16).map((p: any) => ({
        slaveAddr: Number(p.slaveAddr) || 1,
        funcCode: Number(p.funcCode) || 3,
        regAddr: Number(p.regAddr) || 40001,
        length: Number(p.length) || 1,
        dataType: Number(p.dataType) || 0,
        byteOrder: Number(p.byteOrder) || 0,
      }))
      sjzd.showMessage(`已成功导入 ${sjzd.modbusPoints.length} 个点位配置！`)
    }
  } else if (fileName.endsWith('.csv')) {
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
    const newPoints: ModbusPointConfig[] = []
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',')
      if (parts.length >= 4) {
        newPoints.push({
          slaveAddr: Number(parts[0]) || 1,
          funcCode: Number(parts[1]) || 3,
          regAddr: Number(parts[2]) || 40001,
          length: Number(parts[3]) || 1,
          dataType: Number(parts[4]) || 0,
          byteOrder: Number(parts[5]) || 0,
        })
      }
    }
    sjzd.modbusPoints = newPoints.slice(0, 16)
    sjzd.showMessage(`已从 CSV 成功导入 ${sjzd.modbusPoints.length} 个点位！`)
  }
}

// Export template
async function exportJson() {
  if (sjzd.modbusPoints.length === 0) {
    sjzd.showMessage('当前点位表为空，无需导出', false)
    return
  }
  const dataToExport = sjzd.modbusPoints.map((p) => ({
    slaveAddr: p.slaveAddr,
    funcCode: p.funcCode,
    regAddr: p.regAddr,
    length: p.length,
    dataType: p.dataType,
    byteOrder: p.byteOrder,
  }))
  const content = JSON.stringify(dataToExport, null, 2)
  const defaultName = `SJZDV3_Modbus_Points_${Date.now()}.json`

  const savedPath = await appSaveFile(defaultName, content, 'JSON 文件 (*.json)', 'json')
  if (savedPath) {
    sjzd.showMessage(`已成功导出点位 JSON 模板至: ${savedPath}`)
    return
  }

  // Web Browser Fallback
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(content)
  const downloadAnchor = document.createElement('a')
  downloadAnchor.setAttribute('href', dataStr)
  downloadAnchor.setAttribute('download', defaultName)
  document.body.appendChild(downloadAnchor)
  downloadAnchor.click()
  downloadAnchor.remove()
  sjzd.showMessage('已导出点位 JSON 模板文件')
}

async function exportCsv() {
  if (sjzd.modbusPoints.length === 0) {
    sjzd.showMessage('当前点位表为空，无需导出', false)
    return
  }
  const headers = '从站地址,功能码,PLC寄存器地址,读取长度,数据类型(0-6),字节序(0-3)\n'
  const rows = sjzd.modbusPoints
    .map(
      (p) =>
        `${p.slaveAddr},${p.funcCode},${p.regAddr},${p.length},${p.dataType},${p.byteOrder}`
    )
    .join('\n')
  const content = '\uFEFF' + headers + rows
  const defaultName = `SJZDV3_Modbus_Points_${Date.now()}.csv`

  const savedPath = await appSaveFile(defaultName, content, 'CSV 表格文件 (*.csv)', 'csv')
  if (savedPath) {
    sjzd.showMessage(`已成功导出点位 CSV 模板至: ${savedPath}`)
    return
  }

  // Web Browser Fallback
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = defaultName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  sjzd.showMessage('已导出点位 CSV 模板文件 (含 Excel UTF-8 BOM)')
}

// Import template
async function triggerImport() {
  // 优先使用桌面端原生打开文件选择框
  const res = await appOpenFile('Modbus 点位模板 (*.json, *.csv)', ['json', 'csv'])
  if (res) {
    try {
      parsePointsContent(res.path, res.content)
    } catch (err) {
      sjzd.showMessage(`导入模板文件解析失败: ${err}`, false)
    }
    return
  }

  if (fileInputRef.value) {
    fileInputRef.value.click()
  }
}

function handleFileImport(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string
      parsePointsContent(file.name, content)
    } catch (err) {
      sjzd.showMessage(`导入模板文件解析失败: ${err}`, false)
    }
  }
  reader.readAsText(file)
  target.value = ''
}

onMounted(() => {
  if (serial.connectedPort) {
    sjzd.modbusPoints = []
    sjzd.queryModbusPoints()
  } else {
    sjzd.modbusPoints = []
  }
})
</script>

<template>
  <div class="view-container">
    <!-- Header -->
    <header class="view-header">
      <div class="title-col">
        <h2>Modbus RTU 扩展从站轮询点位管理</h2>
        <p class="subtitle">
          直观表格化维护最多 16 个下挂仪表与从站点位，具备 32 位类型自动纠错、批量下发、模板导入导出与单点调试功能。
        </p>
      </div>

      <div class="toolbar-actions">
        <div class="toolbar-group">
          <button
            class="btn btn-secondary"
            :disabled="!serial.connectedPort || sjzd.isBusy"
            @click="handleReadFromDevice"
            title="从设备回读当前点位表 (RS485DEV:LIST)"
          >
            <RefreshCw :size="14" :class="{ spin: sjzd.isBusy }" />
            <span>从设备回读</span>
          </button>

          <div class="preset-dropdown-wrapper">
            <CustomSelect
              v-model="selectedPreset"
              :options="presetOptions"
              placeholder="载入行业点位预设..."
              size="sm"
              @change="onPresetChange"
            />
          </div>

          <button class="btn btn-secondary" @click="triggerImport" title="从 JSON/CSV 文件导入点位">
            <Upload :size="14" />
            <span>导入</span>
          </button>
          <input ref="fileInputRef" type="file" accept=".json,.csv" style="display: none" @change="handleFileImport" />

          <button class="btn btn-secondary" @click="exportCsv" title="导出当前点位为 CSV 表格">
            <FileSpreadsheet :size="14" />
            <span>CSV</span>
          </button>

          <button class="btn btn-secondary" @click="exportJson" title="导出当前点位为 JSON 配置文件">
            <Download :size="14" />
            <span>JSON</span>
          </button>
        </div>

        <div class="toolbar-group toolbar-group-primary">
          <button
            class="btn btn-primary"
            :disabled="!serial.connectedPort || sjzd.modbusPoints.length === 0 || sjzd.isBusy"
            @click="sjzd.saveModbusPoints"
          >
            <Send :size="14" />
            <span>下发 ({{ sjzd.modbusPoints.length }})</span>
          </button>

          <button
            class="btn btn-danger-soft"
            :disabled="!serial.connectedPort || sjzd.isBusy"
            @click="showResetModal = true"
            title="清空所有从站点位 (RS485DEV:RESET)"
          >
            <Trash2 :size="14" />
            <span>清空</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Main Content: Data Grid -->
    <div class="table-card">
      <div class="table-top-bar">
        <div class="bar-left">
          <span class="count-badge">当前已配置: {{ sjzd.modbusPoints.length }} / 16</span>
          <span class="instruction-hint">
            <Info :size="13" />
            选择 32 位整型/浮点数类型时，读取长度将自动强制约束为 ≥ 2 个寄存器。
          </span>
        </div>

        <button
          class="btn btn-sm btn-primary-soft"
          :disabled="sjzd.modbusPoints.length >= 16"
          @click="addPoint"
        >
          <Plus :size="14" />
          <span>添加点位</span>
        </button>
      </div>

      <div class="table-wrapper">
        <table class="grid-table">
          <thead>
            <tr>
              <th width="48" class="center-text">序号</th>
              <th width="80" class="center-text">从站地址</th>
              <th width="140">功能码</th>
              <th width="180">PLC 寄存器地址</th>
              <th width="80" class="center-text">读取长度</th>
              <th width="110">数据类型</th>
              <th width="90">字节序</th>
              <th width="140" class="center-text">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(pt, idx) in sjzd.modbusPoints" :key="idx">
              <td class="center-text index-cell">{{ idx + 1 }}</td>

              <!-- Slave Addr -->
              <td>
                <input
                  v-model.number="pt.slaveAddr"
                  type="number"
                  min="1"
                  max="247"
                  class="cell-input center-text"
                />
              </td>

              <!-- Function Code -->
              <td>
                <CustomSelect
                  v-model="pt.funcCode"
                  :options="MODBUS_FUNC_OPTIONS"
                  size="sm"
                />
              </td>

              <!-- PLC Register Address -->
              <td>
                <input
                  v-model.number="pt.regAddr"
                  type="number"
                  min="1"
                  max="65535"
                  placeholder="例如: 40001"
                  class="cell-input mono-text reg-input"
                />
              </td>

              <!-- Read Length -->
              <td>
                <input
                  v-model.number="pt.length"
                  type="number"
                  min="1"
                  max="31"
                  class="cell-input center-text"
                  :class="{ auto_corrected: [3, 4, 5].includes(pt.dataType) && pt.length >= 2 }"
                />
              </td>

              <!-- Data Type -->
              <td>
                <CustomSelect
                  v-model="pt.dataType"
                  :options="MODBUS_DATA_TYPE_OPTIONS"
                  size="sm"
                  @change="onDataTypeChanged(pt)"
                />
              </td>

              <!-- Byte Order -->
              <td>
                <CustomSelect
                  v-model="pt.byteOrder"
                  :options="MODBUS_BYTE_ORDER_OPTIONS"
                  :disabled="![3, 4, 5].includes(pt.dataType)"
                  size="sm"
                />
              </td>

              <!-- Actions -->
              <td>
                <div class="row-actions">
                  <button
                    class="action-btn test"
                    title="单点调试 (RS485DEV:DEBUG)"
                    :disabled="!serial.connectedPort || sjzd.isBusy"
                    @click="triggerSinglePointDebug(pt)"
                  >
                    <Play :size="13" />
                  </button>
                  <button
                    class="action-btn"
                    title="复制点位 (Clone)"
                    :disabled="sjzd.modbusPoints.length >= 16"
                    @click="clonePoint(idx)"
                  >
                    <Copy :size="13" />
                  </button>
                  <button
                    class="action-btn"
                    title="上移"
                    :disabled="idx === 0"
                    @click="movePointUp(idx)"
                  >
                    <ArrowUp :size="13" />
                  </button>
                  <button
                    class="action-btn"
                    title="下移"
                    :disabled="idx === sjzd.modbusPoints.length - 1"
                    @click="movePointDown(idx)"
                  >
                    <ArrowDown :size="13" />
                  </button>
                  <button
                    class="action-btn delete"
                    title="删除"
                    @click="removePoint(idx)"
                  >
                    <Trash2 :size="13" />
                  </button>
                </div>
              </td>
            </tr>

            <tr v-if="sjzd.modbusPoints.length === 0">
              <td colspan="8" class="empty-table">
                设备当前未配置点位，可点击上方【添加点位】、【导入模板】或连接串口后点击【从设备回读】
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Single Point Debug Output Drawer -->
    <div class="debug-panel">
      <div class="debug-header" @click="showDebugDrawer = !showDebugDrawer">
        <div class="debug-title">
          <Terminal :size="15" />
          <span>Modbus 实时调试与抓包监控</span>
          <span v-if="activeDebugPoint" class="active-debug-badge">
            当前测试: 从站 {{ activeDebugPoint.slaveAddr }} | 寄存器 {{ activeDebugPoint.regAddr }}
          </span>
        </div>
        <div class="debug-header-right">
          <div class="debug-actions" @click.stop>
            <button
              v-if="sjzd.modbusDebugLogs.length > 0"
              class="debug-btn copy-btn"
              :class="{ success: copiedAll }"
              title="一键复制全部调试报文"
              @click="copyAllDebugLogs"
            >
              <component :is="copiedAll ? Check : Copy" :size="13" />
              <span>{{ copiedAll ? '已复制全部' : '复制全部报文' }}</span>
            </button>
            <button
              v-if="sjzd.modbusDebugLogs.length > 0"
              class="debug-btn clear-btn"
              title="清空调试日志"
              @click="clearDebugLogs"
            >
              <Trash2 :size="13" />
              <span>清空</span>
            </button>
          </div>
          <span class="toggle-hint">{{ showDebugDrawer ? '折叠' : '展开' }}</span>
        </div>
      </div>

      <div v-if="showDebugDrawer" class="debug-body">
        <div ref="debugLogsRef" class="debug-logs">
          <div
            v-for="(log, i) in sjzd.modbusDebugLogs"
            :key="i"
            class="debug-log-line"
          >
            <div class="log-content">
              <span class="log-time">[{{ log.timestamp }}]</span>
              <span class="log-text">{{ log.text }}</span>
            </div>
            <button
              class="copy-line-btn"
              :class="{ success: copiedLineIndex === i }"
              :title="copiedLineIndex === i ? '已复制' : '复制该条报文'"
              @click.stop="copyLogLine(log.text, i)"
            >
              <component :is="copiedLineIndex === i ? Check : Copy" :size="12" />
              <span v-if="copiedLineIndex === i" class="copied-tip">已复制</span>
            </button>
          </div>
          <div v-if="sjzd.modbusDebugLogs.length === 0" class="empty-debug-text">
            点击表格操作栏的【测试】按钮发起单点探测，返回的原始 HEX 与解析报文将在此处呈现...
          </div>
        </div>
      </div>
    </div>

    <!-- Reset Confirmation Modal -->
    <ConfirmModal
      :visible="showResetModal"
      title="清空所有 Modbus 点位？"
      message="此操作将向设备下发 RS485DEV:RESET 指令并清空当前所有从站点位表。是否确认清空？"
      danger-level="high"
      confirm-text="确认清空"
      @confirm="
        () => {
          showResetModal = false
          sjzd.resetModbusPoints()
        }
      "
      @cancel="showResetModal = false"
    />
  </div>
</template>

<style scoped>
.view-container {
  padding: var(--page-gutter, 12px);
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  margin: 0 0 4px 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-main, #e2e8f0);
}
.subtitle {
  margin: 0;
  font-size: 0.74rem;
  color: var(--text-muted, #94a3b8);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.toolbar-group-primary {
  padding-left: 6px;
  border-left: 1px solid var(--color-border-subtle, #24323d);
}

.table-card {
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: var(--radius-sm, 5px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.table-top-bar {
  min-height: 38px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid var(--border, #2a2f42);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.count-badge {
  font-size: 0.78rem;
  font-weight: 600;
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.15);
  padding: 3px 8px;
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
}

.instruction-hint {
  font-size: 0.72rem;
  color: var(--text-muted, #94a3b8);
  display: flex;
  align-items: center;
  gap: 4px;
}

.table-wrapper {
  overflow-x: auto;
}

.grid-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.grid-table th {
  padding: 7px 8px;
  background: rgba(0, 0, 0, 0.25);
  border-bottom: 1px solid var(--border, #2a2f42);
  text-align: left;
  font-weight: 600;
  color: var(--text-muted, #94a3b8);
  white-space: nowrap;
}

.grid-table td {
  padding: 4px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.grid-table tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

.center-text {
  text-align: center;
}
.mono-text {
  font-family: var(--font-mono, monospace);
}

.index-cell {
  color: var(--text-muted, #94a3b8);
  font-weight: bold;
}

.cell-input,
.cell-select {
  width: 100%;
  min-height: var(--control-height-dense, 28px);
  padding: 4px 7px;
  background: var(--bg-input, #232736);
  border: 1px solid var(--border, #2a2f42);
  color: var(--text-main, #e2e8f0);
  border-radius: 4px;
  font-size: 0.82rem;
  outline: none;
  box-sizing: border-box;
}
.cell-input:focus,
.cell-select:focus {
  border-color: var(--accent, #3b82f6);
}

.reg-input {
  color: #38bdf8;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-btn {
  width: 26px;
  height: 26px;
  justify-content: center;
  padding: 0;
  background: var(--bg-input, #232736);
  border: 1px solid var(--border, #2a2f42);
  color: var(--text-muted, #94a3b8);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.action-btn.test {
  color: #34d399;
}
.action-btn.test:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.2);
}
.action-btn.delete {
  color: #f87171;
}
.action-btn.delete:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
}
.action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.empty-table {
  text-align: center;
  padding: 18px;
  color: var(--text-muted, #94a3b8);
}

.debug-panel {
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: var(--radius-sm, 5px);
  overflow: hidden;
}

.debug-header {
  min-height: 38px;
  padding: 7px 10px;
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.debug-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-main, #e2e8f0);
}

.active-debug-badge {
  font-size: 0.72rem;
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
}

.debug-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.debug-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.debug-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 0.72rem;
  border-radius: 4px;
  background: var(--bg-input, #232736);
  border: 1px solid var(--border, #2a2f42);
  color: var(--text-muted, #94a3b8);
  cursor: pointer;
  transition: all 0.15s ease;
}

.debug-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-main, #e2e8f0);
}

.debug-btn.copy-btn:hover {
  color: #60a5fa;
  border-color: rgba(59, 130, 246, 0.4);
}

.debug-btn.copy-btn.success {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.4);
  color: #34d399;
}

.debug-btn.clear-btn:hover {
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.4);
}

.toggle-hint {
  font-size: 0.72rem;
  color: var(--text-muted, #94a3b8);
}

.debug-body {
  padding: 8px 10px;
  background: var(--bg-app, #0f111a);
}

.debug-logs {
  min-height: 150px;
  height: 220px;
  max-height: 520px;
  overflow-y: auto;
  resize: vertical;
  font-family: var(--font-mono, monospace);
  font-size: 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-right: 4px;
}

.debug-log-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 3px 6px;
  border-radius: 4px;
  line-height: 1.5;
  transition: background 0.15s ease;
}

.debug-log-line:hover {
  background: rgba(255, 255, 255, 0.04);
}

.log-content {
  display: flex;
  gap: 8px;
  word-break: break-all;
  flex: 1;
}

.copy-line-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  font-size: 0.7rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--text-muted, #64748b);
  cursor: pointer;
  opacity: 0.3;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.debug-log-line:hover .copy-line-btn {
  opacity: 1;
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--border, #2a2f42);
}

.copy-line-btn:hover {
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.15) !important;
  border-color: rgba(59, 130, 246, 0.3) !important;
}

.copy-line-btn.success {
  opacity: 1;
  color: #34d399;
  background: rgba(16, 185, 129, 0.15) !important;
  border-color: rgba(16, 185, 129, 0.3) !important;
}

.copied-tip {
  font-size: 0.68rem;
  font-family: sans-serif;
}

.log-time {
  color: var(--text-muted, #94a3b8);
  flex-shrink: 0;
}
.log-text {
  color: #67e8f9;
  word-break: break-all;
}

.empty-debug-text {
  color: var(--text-muted, #94a3b8);
  text-align: center;
  padding-top: 40px;
}

.form-select-sm {
  padding: 6px 10px;
  background: var(--bg-input, #232736);
  border: 1px solid rgba(59, 130, 246, 0.4);
  color: #93c5fd;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 500;
  outline: none;
  cursor: pointer;
}

.btn {
  min-height: var(--control-height, 32px);
  padding: 5px 9px;
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
  min-height: var(--control-height-dense, 28px);
  padding: 4px 8px;
  font-size: 0.75rem;
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
.btn-primary-soft {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border-color: rgba(59, 130, 246, 0.3);
}
.btn-primary-soft:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.25);
}
.btn-danger-soft {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.25);
}
.btn-danger-soft:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.22);
}
.btn:disabled {
  background: var(--color-surface-1, #111820);
  border-color: var(--color-border-subtle, #24323d);
  color: var(--color-text-disabled, #586874);
  opacity: 1;
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

@media (max-width: 1160px) {
  .view-header {
    align-items: stretch;
  }

  .toolbar-actions {
    width: 100%;
    justify-content: space-between;
  }

  .instruction-hint {
    display: none;
  }
}
</style>
