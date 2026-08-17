<script setup lang="ts">
import { ref, onMounted } from 'vue'
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
} from 'lucide-vue-next'
import { useSjzdStore } from '../../../stores/sjzdStore'
import { useSerialStore } from '../../../stores/serialStore'
import {
  MODBUS_FUNC_OPTIONS,
  MODBUS_DATA_TYPE_OPTIONS,
  MODBUS_BYTE_ORDER_OPTIONS,
  type ModbusPointConfig,
} from '../../../types/sjzd'
import ConfirmModal from '../../../components/common/ConfirmModal.vue'

const sjzd = useSjzdStore()
const serial = useSerialStore()

const showResetModal = ref(false)
const showDebugDrawer = ref(true)
const activeDebugPoint = ref<ModbusPointConfig | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

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
    name: `点位_${sjzd.modbusPoints.length + 1}`,
    unit: '',
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

async function triggerSinglePointDebug(pt: ModbusPointConfig) {
  activeDebugPoint.value = pt
  await sjzd.debugModbusPoint(pt)
}

function clonePoint(index: number) {
  if (sjzd.modbusPoints.length >= 16) {
    sjzd.showMessage('点位数量已达到上限 (最多 16 个)', false)
    return
  }
  const source = sjzd.modbusPoints[index]
  sjzd.modbusPoints.splice(index + 1, 0, {
    ...source,
    name: `${source.name || '点位'}_副本`,
    regAddr: source.regAddr + source.length,
  })
}

function loadPreset(presetName: 'meter' | 'sensor' | 'vfd') {
  if (presetName === 'meter') {
    sjzd.modbusPoints = [
      { slaveAddr: 1, funcCode: 3, regAddr: 40001, length: 2, dataType: 5, byteOrder: 1, name: 'A相电压', unit: 'V' },
      { slaveAddr: 1, funcCode: 3, regAddr: 40003, length: 2, dataType: 5, byteOrder: 1, name: 'B相电压', unit: 'V' },
      { slaveAddr: 1, funcCode: 3, regAddr: 40005, length: 2, dataType: 5, byteOrder: 1, name: 'C相电压', unit: 'V' },
      { slaveAddr: 1, funcCode: 3, regAddr: 40007, length: 2, dataType: 5, byteOrder: 1, name: '总有功功率', unit: 'kW' },
      { slaveAddr: 1, funcCode: 3, regAddr: 40009, length: 2, dataType: 5, byteOrder: 1, name: '有功总电能', unit: 'kWh' },
    ]
    sjzd.showMessage('已载入【三相智能电表】标准点位预设')
  } else if (presetName === 'sensor') {
    sjzd.modbusPoints = [
      { slaveAddr: 2, funcCode: 3, regAddr: 40001, length: 1, dataType: 2, byteOrder: 0, name: '环境温度1', unit: '0.1℃' },
      { slaveAddr: 2, funcCode: 3, regAddr: 40002, length: 1, dataType: 2, byteOrder: 0, name: '环境湿度1', unit: '0.1%RH' },
      { slaveAddr: 3, funcCode: 3, regAddr: 40001, length: 1, dataType: 2, byteOrder: 0, name: '环境温度2', unit: '0.1℃' },
      { slaveAddr: 3, funcCode: 3, regAddr: 40002, length: 1, dataType: 2, byteOrder: 0, name: '环境湿度2', unit: '0.1%RH' },
    ]
    sjzd.showMessage('已载入【温湿度变送器】标准点位预设')
  } else if (presetName === 'vfd') {
    sjzd.modbusPoints = [
      { slaveAddr: 1, funcCode: 3, regAddr: 40001, length: 1, dataType: 2, byteOrder: 0, name: '运行频率', unit: '0.01Hz' },
      { slaveAddr: 1, funcCode: 3, regAddr: 40002, length: 1, dataType: 2, byteOrder: 0, name: '输出电流', unit: '0.1A' },
      { slaveAddr: 1, funcCode: 3, regAddr: 40003, length: 1, dataType: 2, byteOrder: 0, name: '母线电压', unit: 'V' },
      { slaveAddr: 1, funcCode: 1, regAddr: 10001, length: 1, dataType: 6, byteOrder: 0, name: '故障指示', unit: '' },
    ]
    sjzd.showMessage('已载入【变频器运行监测】标准点位预设')
  }
}

// Export template
function exportJson() {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(sjzd.modbusPoints, null, 2))
  const downloadAnchor = document.createElement('a')
  downloadAnchor.setAttribute('href', dataStr)
  downloadAnchor.setAttribute('download', `SJZDV3_Modbus_Points_${Date.now()}.json`)
  document.body.appendChild(downloadAnchor)
  downloadAnchor.click()
  downloadAnchor.remove()
  sjzd.showMessage('已导出点位 JSON 模板文件')
}

function exportCsv() {
  const headers = '从站地址,功能码,PLC寄存器地址,读取长度,数据类型(0-6),字节序(0-3),点位名称,单位\n'
  const rows = sjzd.modbusPoints
    .map(
      (p) =>
        `${p.slaveAddr},${p.funcCode},${p.regAddr},${p.length},${p.dataType},${p.byteOrder},"${p.name || ''}","${p.unit || ''}"`
    )
    .join('\n')
  // Add UTF-8 BOM \uFEFF for seamless Microsoft Excel compatibility
  const blob = new Blob(['\uFEFF' + headers + rows], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `SJZDV3_Modbus_Points_${Date.now()}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  sjzd.showMessage('已导出点位 CSV 模板文件 (含 Excel UTF-8 BOM)')
}

// Import template
function triggerImport() {
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
      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          sjzd.modbusPoints = parsed.slice(0, 16).map((p: any) => ({
            slaveAddr: Number(p.slaveAddr) || 1,
            funcCode: Number(p.funcCode) || 3,
            regAddr: Number(p.regAddr) || 40001,
            length: Number(p.length) || 1,
            dataType: Number(p.dataType) || 0,
            byteOrder: Number(p.byteOrder) || 0,
            name: p.name || '',
            unit: p.unit || '',
          }))
          sjzd.showMessage(`已成功导入 ${sjzd.modbusPoints.length} 个点位配置！`)
        }
      } else if (file.name.endsWith('.csv')) {
        const lines = content.split('\n').filter((l) => l.trim())
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
              name: parts[6]?.replace(/"/g, '') || '',
              unit: parts[7]?.replace(/"/g, '') || '',
            })
          }
        }
        sjzd.modbusPoints = newPoints.slice(0, 16)
        sjzd.showMessage(`已从 CSV 成功导入 ${sjzd.modbusPoints.length} 个点位！`)
      }
    } catch (err) {
      sjzd.showMessage(`导入模板文件解析失败: ${err}`, false)
    }
  }
  reader.readAsText(file)
  target.value = ''
}

onMounted(() => {
  if (serial.connectedPort) {
    sjzd.queryModbusPoints()
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
        <button
          class="btn btn-secondary"
          :disabled="!serial.connectedPort || sjzd.isBusy"
          @click="sjzd.queryModbusPoints"
          title="从设备回读当前点位表 (RS485DEV:LIST)"
        >
          <RefreshCw :size="14" :class="{ spin: sjzd.isBusy }" />
          <span>从设备回读</span>
        </button>

        <!-- Industry Presets -->
        <div class="preset-dropdown-wrapper">
          <select class="form-select-sm" @change="(e) => loadPreset((e.target as HTMLSelectElement).value as any)">
            <option value="" disabled selected>📦 载入行业点位预设...</option>
            <option value="meter">⚡ 三相智能电表模版 (电压/电流/功率/电能)</option>
            <option value="sensor">🌡️ 4路工业温湿度变送器模版</option>
            <option value="vfd">⚙️ 变频器常用运行参数模版</option>
          </select>
        </div>

        <button
          class="btn btn-secondary"
          @click="triggerImport"
          title="从 JSON/CSV 文件导入点位"
        >
          <Upload :size="14" />
          <span>导入模板</span>
        </button>
        <input
          ref="fileInputRef"
          type="file"
          accept=".json,.csv"
          style="display: none"
          @change="handleFileImport"
        />

        <button
          class="btn btn-secondary"
          @click="exportCsv"
          title="导出当前点位为 CSV 表格"
        >
          <FileSpreadsheet :size="14" />
          <span>导出 CSV</span>
        </button>

        <button
          class="btn btn-secondary"
          @click="exportJson"
          title="导出当前点位为 JSON 配置文件"
        >
          <Download :size="14" />
          <span>导出 JSON</span>
        </button>

        <button
          class="btn btn-primary"
          :disabled="!serial.connectedPort || sjzd.modbusPoints.length === 0 || sjzd.isBusy"
          @click="sjzd.saveModbusPoints"
        >
          <Send :size="14" />
          <span>批量下发到设备 ({{ sjzd.modbusPoints.length }})</span>
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
              <th width="48">序号</th>
              <th width="140">点位名称</th>
              <th width="90">从站地址</th>
              <th width="160">功能码</th>
              <th width="110">PLC 寄存器</th>
              <th width="90">读取长度</th>
              <th width="180">数据类型</th>
              <th width="180">字节序 (ABCD)</th>
              <th width="80">单位</th>
              <th width="140">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(pt, idx) in sjzd.modbusPoints" :key="idx">
              <td class="center-text index-cell">{{ idx + 1 }}</td>

              <!-- Point Name -->
              <td>
                <input
                  v-model="pt.name"
                  type="text"
                  placeholder="例如: 管道压力"
                  class="cell-input"
                />
              </td>

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
                <select v-model.number="pt.funcCode" class="cell-select">
                  <option v-for="f in MODBUS_FUNC_OPTIONS" :key="f.value" :value="f.value">
                    {{ f.label }}
                  </option>
                </select>
              </td>

              <!-- PLC Register Address -->
              <td>
                <input
                  v-model.number="pt.regAddr"
                  type="number"
                  min="1"
                  max="65535"
                  class="cell-input mono-text"
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
                <select
                  v-model.number="pt.dataType"
                  class="cell-select"
                  @change="onDataTypeChanged(pt)"
                >
                  <option
                    v-for="dt in MODBUS_DATA_TYPE_OPTIONS"
                    :key="dt.value"
                    :value="dt.value"
                  >
                    {{ dt.label }}
                  </option>
                </select>
              </td>

              <!-- Byte Order -->
              <td>
                <select
                  v-model.number="pt.byteOrder"
                  class="cell-select"
                  :disabled="![3, 4, 5].includes(pt.dataType)"
                >
                  <option
                    v-for="bo in MODBUS_BYTE_ORDER_OPTIONS"
                    :key="bo.value"
                    :value="bo.value"
                  >
                    {{ bo.label }}
                  </option>
                </select>
              </td>

              <!-- Unit -->
              <td>
                <input
                  v-model="pt.unit"
                  type="text"
                  placeholder="℃/kPa"
                  class="cell-input center-text"
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
              <td colspan="10" class="empty-table">
                暂无点位配置，点击上方【添加点位】或【导入模板】开始创建
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
        <span class="toggle-hint">{{ showDebugDrawer ? '折叠' : '展开' }}</span>
      </div>

      <div v-if="showDebugDrawer" class="debug-body">
        <div class="debug-logs">
          <div
            v-for="(log, i) in sjzd.modbusDebugLogs"
            :key="i"
            class="debug-log-line"
          >
            <span class="log-time">[{{ log.timestamp }}]</span>
            <span class="log-text">{{ log.text }}</span>
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
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1400px;
}

.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.title-col h2 {
  margin: 0 0 4px 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-main, #e2e8f0);
}
.subtitle {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-muted, #94a3b8);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.table-card {
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.table-top-bar {
  padding: 10px 14px;
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
  font-size: 0.75rem;
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
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.25);
  border-bottom: 1px solid var(--border, #2a2f42);
  text-align: left;
  font-weight: 600;
  color: var(--text-muted, #94a3b8);
  white-space: nowrap;
}

.grid-table td {
  padding: 6px 8px;
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
  padding: 5px 8px;
  background: var(--bg-input, #232736);
  border: 1px solid var(--border, #2a2f42);
  color: var(--text-main, #e2e8f0);
  border-radius: 4px;
  font-size: 0.8rem;
  outline: none;
}
.cell-input:focus,
.cell-select:focus {
  border-color: var(--accent, #3b82f6);
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-btn {
  padding: 4px 6px;
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
  padding: 32px;
  color: var(--text-muted, #94a3b8);
}

.debug-panel {
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 8px;
  overflow: hidden;
}

.debug-header {
  padding: 10px 14px;
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

.toggle-hint {
  font-size: 0.72rem;
  color: var(--text-muted, #94a3b8);
}

.debug-body {
  padding: 12px;
  background: var(--bg-app, #0f111a);
}

.debug-logs {
  height: 140px;
  overflow-y: auto;
  font-family: var(--font-mono, monospace);
  font-size: 0.78rem;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.debug-log-line {
  display: flex;
  gap: 8px;
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
  padding: 7px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
}
.btn-sm {
  padding: 5px 10px;
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
