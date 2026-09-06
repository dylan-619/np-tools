<script setup lang="ts">
import { computed, ref, onMounted, watch, nextTick } from 'vue'
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
const MAX_MODBUS_POINTS = 100

const showResetModal = ref(false)
// Keep the capture console out of the way until a test starts or the user opens it.
const showDebugDrawer = ref(false)
const activeDebugPoint = ref<ModbusPointConfig | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedPreset = ref('')
const copiedAll = ref(false)
const copiedLineIndex = ref<number | null>(null)
const debugLogsRef = ref<HTMLElement | null>(null)
const mcuConsoleReady = computed(
  () => Boolean(sjzd.wlanBridgeStatus && !sjzd.wlanBridgeStatus.active)
)

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
  if (sjzd.modbusPoints.length >= MAX_MODBUS_POINTS) {
    sjzd.showMessage(`点位数量已达到上限 (最多 ${MAX_MODBUS_POINTS} 个)`, false)
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

function debugStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: '等待结果',
    ok: '响应有效',
    exception: '从站异常',
    timeout: '响应超时',
    crc_error: 'CRC 错误',
    short_frame: '短帧',
    overflow: '接收溢出',
    unexpected_response: '功能码不匹配',
    malformed_length: '长度不匹配',
    busy: 'RS485 忙',
    invalid: '参数无效',
    parse_error: '命令解析失败',
    io_error: '串口 I/O 错误',
    protocol_error: '诊断协议不完整',
  }
  return labels[status] || status
}

async function exportModbusDebugReport() {
  const content = sjzd.exportModbusDebugReport()
  if (!content || !sjzd.lastModbusDebugReport) {
    sjzd.showMessage('尚无可导出的单点诊断报告', false)
    return
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const path = await appSaveFile(
    `SJZDV3-Modbus单点诊断-${timestamp}.json`,
    content,
    'SJZDV3 Modbus 单点诊断报告',
    'json'
  )
  sjzd.showMessage(path ? `单点诊断报告已导出：${path}` : '未选择诊断报告导出位置', Boolean(!path))
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
  if (sjzd.modbusPoints.length >= MAX_MODBUS_POINTS) {
    sjzd.showMessage(`点位数量已达到上限 (最多 ${MAX_MODBUS_POINTS} 个)`, false)
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
      sjzd.modbusPoints = parsed.slice(0, MAX_MODBUS_POINTS).map((p: any) => ({
        slaveAddr: Number(p.slaveAddr) || 1,
        funcCode: Number(p.funcCode) || 3,
        regAddr: Number(p.regAddr) || 40001,
        length: Number(p.length) || 1,
        dataType: Number(p.dataType) || 0,
        byteOrder: Number(p.byteOrder) || 0,
      }))
      sjzd.showMessage(
        parsed.length > MAX_MODBUS_POINTS
          ? `已导入前 ${MAX_MODBUS_POINTS} 个点位；源文件其余 ${parsed.length - MAX_MODBUS_POINTS} 个未写入。`
          : `已成功导入 ${sjzd.modbusPoints.length} 个点位配置！`
      )
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
    sjzd.modbusPoints = newPoints.slice(0, MAX_MODBUS_POINTS)
    sjzd.showMessage(
      newPoints.length > MAX_MODBUS_POINTS
        ? `已导入前 ${MAX_MODBUS_POINTS} 个点位；CSV 其余 ${newPoints.length - MAX_MODBUS_POINTS} 个未写入。`
        : `已从 CSV 成功导入 ${sjzd.modbusPoints.length} 个点位！`
    )
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
    void (async () => {
      const bridge = await sjzd.queryWlanBridge()
      if (!bridge || bridge.active) return
      await sjzd.queryModbusPoints()
    })()
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
          直观表格化维护最多 100 个下挂仪表与从站点位，具备 32 位类型自动纠错、保存回执与完整快照 revision 复核、模板导入导出和结构化单点调试功能。
        </p>
      </div>

      <div class="toolbar-actions">
        <div class="toolbar-group">
          <button
            class="btn btn-secondary"
            :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
            @click="handleReadFromDevice"
            title="获取设备当前完整点位快照（校验 RS485_CONFIG 事务 ID、count 与 CRC32）"
          >
            <RefreshCw :size="14" :class="{ spin: sjzd.isBusy }" />
            <span>获取完整快照</span>
          </button>

          <button
            class="btn btn-secondary"
            :disabled="!serial.connectedPort || sjzd.isBusy"
            title="查询 UART1 透传状态；透传开启时不会下发 RS485 MCU 命令"
            @click="sjzd.queryWlanBridge"
          >
            <RefreshCw :size="14" :class="{ spin: sjzd.isBusy }" />
            <span>查询桥接</span>
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
            :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.modbusPoints.length === 0 || sjzd.isBusy"
            @click="sjzd.saveModbusPoints"
          >
            <Send :size="14" />
            <span>下发 ({{ sjzd.modbusPoints.length }})</span>
          </button>

          <button
            class="btn btn-danger-soft"
            :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
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
          <span class="count-badge">当前已配置: {{ sjzd.modbusPoints.length }} / {{ MAX_MODBUS_POINTS }}</span>
          <span v-if="sjzd.modbusConfigSnapshot" class="instruction-hint mono-text">
            <Info :size="13" />
            完整快照 id={{ sjzd.modbusConfigSnapshot.transactionId }} · {{ sjzd.modbusConfigSnapshot.revisionHex }} · CRC32 {{ sjzd.modbusConfigSnapshot.crc32 }}
          </span>
          <span class="instruction-hint">
            <Info :size="13" />
            选择 32 位整型/浮点数类型时，读取长度将自动强制约束为 ≥ 2 个寄存器。
          </span>
        </div>

        <button
          class="btn btn-sm btn-primary-soft"
          :disabled="sjzd.modbusPoints.length >= MAX_MODBUS_POINTS"
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
                    :disabled="!serial.connectedPort || !mcuConsoleReady || sjzd.isBusy"
                    @click="triggerSinglePointDebug(pt)"
                  >
                    <Play :size="13" />
                  </button>
                  <button
                    class="action-btn"
                    title="复制点位 (Clone)"
                    :disabled="sjzd.modbusPoints.length >= MAX_MODBUS_POINTS"
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
                设备当前完整快照为空，可点击上方【添加点位】、【导入模板】或连接串口后点击【获取完整快照】；只有 <code>RS485_CONFIG:END</code> 的 count 与 CRC32 通过后，空表才表示设备无点位配置。
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
        <section
          v-if="sjzd.lastModbusDebugReport"
          class="diagnostic-report"
          :class="{ failed: sjzd.lastModbusDebugReport.status !== 'ok' }"
        >
          <div class="report-heading">
            <div>
              <strong>单点原始日志诊断</strong>
              <span>{{ debugStatusLabel(sjzd.lastModbusDebugReport.status) }}</span>
            </div>
            <button
              class="debug-btn copy-btn"
              title="导出本次单点诊断 JSON"
              @click="exportModbusDebugReport"
            >
              <Download :size="13" />导出报告
            </button>
          </div>
          <p>{{ sjzd.lastModbusDebugReport.message }}</p>
          <div class="report-facts">
            <span><small>请求</small><code>{{ sjzd.lastModbusDebugReport.request.txHex || '固件未回报' }}</code></span>
            <span><small>数据区</small><code>{{ sjzd.lastModbusDebugReport.response.dataHex || '—' }}</code></span>
            <span><small>解析值</small><code>{{ sjzd.lastModbusDebugReport.decodedValue || '—' }}</code></span>
          </div>
          <small v-if="sjzd.lastModbusDebugReport.decodeWarning" class="report-warning">{{ sjzd.lastModbusDebugReport.decodeWarning }}</small>
          <small class="report-boundary">报告仅接受同一事务 ID 的 <code>MB_DEBUG:RESULT/END</code>；成功还要求 <code>BEGIN/TX/RX/DATA</code> 齐全。不等同于持续轮询、物理层或仪表量程 HIL 通过。</small>
        </section>
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
  border: 1px solid var(--color-border-subtle, #d5dde4);
  background: var(--color-surface-1, #ffffff);
  border-radius: var(--radius-sm, 5px);
}

.title-col h2 {
  margin: 0 0 4px 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-main, #17212b);
}
.subtitle {
  margin: 0;
  font-size: 0.74rem;
  color: var(--text-muted, #40515f);
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
  border-left: 1px solid var(--color-border-subtle, #d5dde4);
}

.table-card {
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: var(--radius-sm, 5px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.table-top-bar {
  min-height: 38px;
  padding: 6px 10px;
  background: #f7f9fb;
  border-bottom: 1px solid var(--border, #b9c5cf);
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
  color: #1769aa;
  background: rgba(59, 130, 246, 0.15);
  padding: 3px 8px;
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
}

.instruction-hint {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
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
  background: #e8edf2;
  border-bottom: 1px solid var(--border, #b9c5cf);
  text-align: left;
  font-weight: 600;
  color: var(--text-muted, #40515f);
  white-space: nowrap;
}

.grid-table td {
  padding: 4px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.grid-table tr:hover {
  background: #f7f9fb;
}

.center-text {
  text-align: center;
}
.mono-text {
  font-family: var(--font-mono, monospace);
}

.index-cell {
  color: var(--text-muted, #40515f);
  font-weight: bold;
}

.cell-input,
.cell-select {
  width: 100%;
  min-height: var(--control-height-dense, 28px);
  padding: 4px 7px;
  background: var(--bg-input, #f7f9fb);
  border: 1px solid var(--border, #b9c5cf);
  color: var(--text-main, #17212b);
  border-radius: 4px;
  font-size: 0.82rem;
  outline: none;
  box-sizing: border-box;
}
.cell-input:focus,
.cell-select:focus {
  border-color: var(--accent, #1769aa);
}

.reg-input {
  color: #0f5f9e;
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
  background: var(--bg-input, #f7f9fb);
  border: 1px solid var(--border, #b9c5cf);
  color: var(--text-muted, #40515f);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.action-btn:hover:not(:disabled) {
  background: #e8edf2;
  color: #17212b;
}
.action-btn.test {
  color: #176b45;
}
.action-btn.test:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.2);
}
.action-btn.delete {
  color: #a12d34;
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
  color: var(--text-muted, #40515f);
}

.debug-panel {
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: var(--radius-sm, 5px);
  overflow: hidden;
}

.debug-header {
  min-height: 38px;
  padding: 7px 10px;
  background: #f7f9fb;
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
  color: var(--text-main, #17212b);
}

.active-debug-badge {
  font-size: 0.72rem;
  background: rgba(16, 185, 129, 0.15);
  color: #176b45;
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
  background: var(--bg-input, #f7f9fb);
  border: 1px solid var(--border, #b9c5cf);
  color: var(--text-muted, #40515f);
  cursor: pointer;
  transition: all 0.15s ease;
}

.debug-btn:hover {
  background: #e8edf2;
  color: var(--text-main, #17212b);
}

.debug-btn.copy-btn:hover {
  color: #0f5f9e;
  border-color: rgba(59, 130, 246, 0.4);
}

.debug-btn.copy-btn.success {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.4);
  color: #176b45;
}

.debug-btn.clear-btn:hover {
  color: #a12d34;
  border-color: rgba(239, 68, 68, 0.4);
}

.toggle-hint {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
}

.debug-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  background: var(--bg-app, #edf1f4);
}

.diagnostic-report {
  padding: 9px 10px;
  border: 1px solid #94cbb0;
  border-left: 3px solid #208452;
  border-radius: 4px;
  background: #f2fbf5;
}

.diagnostic-report.failed {
  border-color: #e2a0a0;
  border-left-color: #c94747;
  background: #fff7f7;
}

.report-heading,
.report-heading > div,
.report-facts,
.report-facts span {
  display: flex;
  align-items: center;
}

.report-heading {
  justify-content: space-between;
  gap: 8px;
}

.report-heading > div {
  gap: 7px;
}

.report-heading strong {
  font-size: 0.73rem;
}

.report-heading span {
  padding: 2px 6px;
  border-radius: 10px;
  color: #176b45;
  background: #dcf3e5;
  font-size: 0.63rem;
}

.diagnostic-report.failed .report-heading span {
  color: #a42e2e;
  background: #fde3e3;
}

.diagnostic-report p,
.report-warning,
.report-boundary {
  display: block;
  margin: 6px 0 0;
  color: var(--text-muted, #40515f);
  font-size: 0.66rem;
  line-height: 1.45;
}

.report-facts {
  gap: 1px;
  margin-top: 8px;
  background: rgba(80, 103, 118, 0.16);
}

.report-facts span {
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 5px 6px;
  background: rgba(255, 255, 255, 0.7);
}

.report-facts small {
  color: var(--text-muted, #40515f);
  font-size: 0.6rem;
}

.report-facts code {
  max-width: 100%;
  overflow: hidden;
  font: 0.64rem var(--font-mono, monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-warning {
  color: #8a5f00;
}

.report-boundary {
  color: #7b6438;
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
  background: #eef3f7;
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
  background: #eef3f7;
  border-color: var(--border, #b9c5cf);
}

.copy-line-btn:hover {
  color: #0f5f9e;
  background: rgba(59, 130, 246, 0.15) !important;
  border-color: rgba(59, 130, 246, 0.3) !important;
}

.copy-line-btn.success {
  opacity: 1;
  color: #176b45;
  background: rgba(16, 185, 129, 0.15) !important;
  border-color: rgba(16, 185, 129, 0.3) !important;
}

.copied-tip {
  font-size: 0.68rem;
  font-family: sans-serif;
}

.log-time {
  color: var(--text-muted, #40515f);
  flex-shrink: 0;
}
.log-text {
  color: #0f5f9e;
  word-break: break-all;
}

.empty-debug-text {
  color: var(--text-muted, #40515f);
  text-align: center;
  padding-top: 40px;
}

.form-select-sm {
  padding: 6px 10px;
  background: var(--bg-input, #f7f9fb);
  border: 1px solid rgba(59, 130, 246, 0.4);
  color: #1769aa;
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
.btn-primary-soft {
  background: rgba(59, 130, 246, 0.15);
  color: #0f5f9e;
  border-color: rgba(59, 130, 246, 0.3);
}
.btn-primary-soft:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.25);
}
.btn-danger-soft {
  background: rgba(239, 68, 68, 0.12);
  color: #a12d34;
  border-color: rgba(239, 68, 68, 0.25);
}
.btn-danger-soft:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.22);
}
.btn:disabled {
  background: var(--color-surface-1, #ffffff);
  border-color: var(--color-border-subtle, #d5dde4);
  color: var(--color-text-disabled, #667784);
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
