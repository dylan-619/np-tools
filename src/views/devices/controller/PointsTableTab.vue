<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Plus,
  Trash2,
  Cpu,
  Sparkles,
  Globe,
  Search,
} from 'lucide-vue-next'
import { useControllerStore } from '../../../stores/controllerStore'
import CustomSelect from '../../../components/common/CustomSelect.vue'

const controller = useControllerStore()
const filterMode = ref<'ALL' | 'INPUTS' | 'OUTPUTS'>('ALL')
const searchQuery = ref('')

const inputSourceOptions = computed(() => {
  return controller.availableInputSources.map((s) => ({
    label: s.label,
    value: s.value,
  }))
})

const outputSourceOptions = computed(() => {
  return controller.availableOutputSources.map((s) => ({
    label: s.label,
    value: s.value,
  }))
})

// 计算每个点位是否已在北向发布
const northboundPublishedMap = computed(() => {
  const map = new Map<string, { ref: string; fieldName: string }>()
  for (const f of controller.doc.project.northbound.fields) {
    if (f.bind.startsWith('point.')) {
      const ptName = f.bind.replace('point.', '')
      map.set(ptName, { ref: f.reference, fieldName: f.name })
    }
  }
  return map
})

const filteredInputs = computed(() => {
  if (filterMode.value === 'OUTPUTS') return []
  let list = controller.doc.project.points.inputs
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.source.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
    )
  }
  return list
})

const filteredOutputs = computed(() => {
  if (filterMode.value === 'INPUTS') return []
  let list = controller.doc.project.points.outputs
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.source.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
    )
  }
  return list
})

// 快捷将点位发布至北向
function quickPublishToNorthbound(pointName: string, isOutput: boolean, sourceStr: string) {
  const ptType = controller.getSourceType(sourceStr)
  const isBool = ptType === 'bool'
  let refCode = '00001'
  if (isBool) {
    refCode = isOutput ? '00001' : '10001'
  } else {
    refCode = isOutput ? '40001' : '30001'
  }
  controller.addNorthboundField({
    name: pointName,
    bind: `point.${pointName}`,
    c_type: ptType,
    access: 'read',
    reference: refCode,
  })
  // 触发自动分配地址
  controller.autoAssignNorthboundAddresses()
  controller.showMessage(`已将业务点 point.${pointName} (${ptType.toUpperCase()}) 映射至北向通信协议`)
}

function getPointBadge(sourceStr: string, isOutput: boolean) {
  const ptType = controller.getSourceType(sourceStr)
  if (isOutput) {
    if (ptType === 'bool') return { text: 'DO', class: 'pill-out', typeText: 'BOOL' }
    return { text: 'AO', class: 'pill-ao', typeText: ptType.toUpperCase() }
  } else {
    if (ptType === 'bool') return { text: 'DI', class: 'pill-in', typeText: 'BOOL' }
    return { text: 'AI', class: 'pill-ai', typeText: ptType.toUpperCase() }
  }
}

function handleAutoGeneratePoints() {
  const existingInSources = new Set(controller.doc.project.points.inputs.map((p) => p.source))
  for (const src of controller.availableInputSources) {
    if (!existingInSources.has(src.value)) {
      const cleanName = src.value.replace('board.', 'board_').replace('rtu.', '').replace(/\./g, '_')
      controller.addInputPoint({
        name: cleanName,
        source: src.value,
        description: `自动同步硬件输入: ${src.label}`,
      })
    }
  }

  const existingOutSources = new Set(controller.doc.project.points.outputs.map((p) => p.source))
  for (const src of controller.availableOutputSources) {
    if (!existingOutSources.has(src.value)) {
      const cleanName = src.value.replace('board.', 'board_').replace('rtu.', '').replace(/\./g, '_')
      controller.addOutputPoint({
        name: cleanName,
        source: src.value,
        description: `自动同步硬件输出: ${src.label}`,
      })
    }
  }

  controller.showMessage('已从当前硬件机架通道全部同步生成业务点位！')
}
</script>

<template>
  <div class="points-tab-wrapper">
    <!-- Top KPI Stats Banner -->
    <div class="points-kpi-bar">
      <div class="kpi-item">
        <span class="kpi-num text-blue">{{ controller.doc.project.points.inputs.length }}</span>
        <span class="kpi-text">输入点位 (Inputs)</span>
      </div>
      <div class="kpi-divider" />
      <div class="kpi-item">
        <span class="kpi-num text-green">{{ controller.doc.project.points.outputs.length }}</span>
        <span class="kpi-text">输出点位 (Outputs)</span>
      </div>
      <div class="kpi-divider" />
      <div class="kpi-item">
        <span class="kpi-num text-purple">{{ northboundPublishedMap.size }}</span>
        <span class="kpi-text">已发布至北向通信</span>
      </div>
      <div class="kpi-divider" />
      <div class="kpi-item">
        <span class="kpi-num text-amber">
          {{ controller.availableInputSources.length + controller.availableOutputSources.length }}
        </span>
        <span class="kpi-text">可用硬件物理通道</span>
      </div>
    </div>

    <!-- Main Table Card -->
    <div class="panel-card">
      <div class="panel-header">
        <div class="header-left">
          <div class="panel-title">
            <Cpu :size="17" class="panel-icon text-blue" />
            <span>I/O 业务点位映射总表 (Process Image Points)</span>
          </div>

          <div class="filter-pills">
            <button
              class="filter-pill"
              :class="{ active: filterMode === 'ALL' }"
              @click="filterMode = 'ALL'"
            >
              全部点位 ({{ controller.doc.project.points.inputs.length + controller.doc.project.points.outputs.length }})
            </button>
            <button
              class="filter-pill"
              :class="{ active: filterMode === 'INPUTS' }"
              @click="filterMode = 'INPUTS'"
            >
              📥 输入点 ({{ controller.doc.project.points.inputs.length }})
            </button>
            <button
              class="filter-pill"
              :class="{ active: filterMode === 'OUTPUTS' }"
              @click="filterMode = 'OUTPUTS'"
            >
              📤 输出点 ({{ controller.doc.project.points.outputs.length }})
            </button>
          </div>
        </div>

        <div class="header-actions">
          <div class="search-box">
            <Search :size="13" class="search-icon" />
            <input
              v-model="searchQuery"
              type="text"
              class="search-input"
              placeholder="搜索符号名/物理源/描述..."
            />
          </div>

          <button class="btn btn-outline" @click="handleAutoGeneratePoints">
            <Sparkles :size="14" />
            <span>一键同步硬件通道</span>
          </button>

          <button class="btn btn-primary" @click="controller.addInputPoint()">
            <Plus :size="14" />
            <span>添加输入点</span>
          </button>

          <button class="btn btn-green" @click="controller.addOutputPoint()">
            <Plus :size="14" />
            <span>添加输出点</span>
          </button>
        </div>
      </div>

      <div class="panel-body table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 45px; text-align: center;">#</th>
              <th style="width: 85px; text-align: center;">信号类型</th>
              <th style="width: 230px;">业务符号名 (logic_name)</th>
              <th style="width: 310px;">物理通道绑定源 (source)</th>
              <th style="width: 140px;">北向协议发布状态</th>
              <th>中文说明与用途描述 (description)</th>
              <th style="width: 60px; text-align: center;">操作</th>
            </tr>
          </thead>
          <tbody>
            <!-- Inputs List -->
            <tr
              v-for="(pt, idx) in filteredInputs"
              :key="pt.id"
              class="row-input"
            >
              <td class="text-center text-muted font-mono">{{ idx + 1 }}</td>
              <td style="text-align: center;">
                <span class="type-pill" :class="getPointBadge(pt.source, false).class">
                  {{ getPointBadge(pt.source, false).text }} ({{ getPointBadge(pt.source, false).typeText }})
                </span>
              </td>
              <td>
                <input
                  v-model="pt.name"
                  type="text"
                  class="table-cell-input text-mono font-bold"
                  placeholder="如 pump_start_allow"
                />
              </td>
              <td>
                <CustomSelect
                  v-model="pt.source"
                  :options="inputSourceOptions"
                />
              </td>
              <td>
                <div
                  v-if="northboundPublishedMap.has(pt.name)"
                  class="nb-published-badge"
                  :title="`对外字段: ${northboundPublishedMap.get(pt.name)?.fieldName}`"
                >
                  <Globe :size="12" class="text-blue" />
                  <span>Modbus {{ northboundPublishedMap.get(pt.name)?.ref }}</span>
                </div>
                <button
                  v-else
                  class="btn-publish-nb"
                  @click="quickPublishToNorthbound(pt.name, false, pt.source)"
                >
                  <Plus :size="11" />
                  <span>发布至北向</span>
                </button>
              </td>
              <td>
                <input
                  v-model="pt.description"
                  type="text"
                  class="table-cell-input"
                  placeholder="填写该业务输入点的用途说明"
                />
              </td>
              <td style="text-align: center;">
                <button
                  class="btn-icon btn-danger"
                  title="删除该输入点"
                  @click="controller.removeInputPoint(idx)"
                >
                  <Trash2 :size="14" />
                </button>
              </td>
            </tr>

            <!-- Outputs List -->
            <tr
              v-for="(pt, idx) in filteredOutputs"
              :key="pt.id"
              class="row-output"
            >
              <td class="text-center text-muted font-mono">{{ filteredInputs.length + idx + 1 }}</td>
              <td style="text-align: center;">
                <span class="type-pill" :class="getPointBadge(pt.source, true).class">
                  {{ getPointBadge(pt.source, true).text }} ({{ getPointBadge(pt.source, true).typeText }})
                </span>
              </td>
              <td>
                <input
                  v-model="pt.name"
                  type="text"
                  class="table-cell-input text-mono font-bold"
                  placeholder="如 marquee_enable"
                />
              </td>
              <td>
                <CustomSelect
                  v-model="pt.source"
                  :options="outputSourceOptions"
                />
              </td>
              <td>
                <div
                  v-if="northboundPublishedMap.has(pt.name)"
                  class="nb-published-badge"
                  :title="`对外字段: ${northboundPublishedMap.get(pt.name)?.fieldName}`"
                >
                  <Globe :size="12" class="text-blue" />
                  <span>Modbus {{ northboundPublishedMap.get(pt.name)?.ref }}</span>
                </div>
                <button
                  v-else
                  class="btn-publish-nb"
                  @click="quickPublishToNorthbound(pt.name, true, pt.source)"
                >
                  <Plus :size="11" />
                  <span>发布至北向</span>
                </button>
              </td>
              <td>
                <input
                  v-model="pt.description"
                  type="text"
                  class="table-cell-input"
                  placeholder="填写该业务输出点的用途说明"
                />
              </td>
              <td style="text-align: center;">
                <button
                  class="btn-icon btn-danger"
                  title="删除该输出点"
                  @click="controller.removeOutputPoint(idx)"
                >
                  <Trash2 :size="14" />
                </button>
              </td>
            </tr>

            <tr v-if="filteredInputs.length === 0 && filteredOutputs.length === 0">
              <td colspan="7" class="empty-cell">
                未找到匹配的点位，点击右上角添加或“一键同步硬件通道”。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.points-tab-wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* KPI Banner */
.points-kpi-bar {
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 10px;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  justify-content: space-around;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

.kpi-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.kpi-num {
  font-size: 1.25rem;
  font-weight: 700;
  font-family: monospace;
}

.kpi-text {
  font-size: 0.76rem;
  color: var(--text-muted, #94a3b8);
}

.kpi-divider {
  width: 1px;
  height: 24px;
  background: var(--border, #2a2f42);
}

.panel-card {
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #2a2f42);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.015);
  flex-wrap: wrap;
  gap: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-main, #e2e8f0);
}

.filter-pills {
  display: flex;
  gap: 4px;
  background: var(--bg-app, #12141c);
  padding: 3px;
  border-radius: 6px;
  border: 1px solid var(--border, #2a2f42);
}

.filter-pill {
  background: transparent;
  border: none;
  color: var(--text-muted, #94a3b8);
  font-size: 0.74rem;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.filter-pill.active {
  background: #3b82f6;
  color: #fff;
  font-weight: 600;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 8px;
  color: var(--text-muted, #94a3b8);
}

.search-input {
  background: var(--bg-app, #12141c);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 6px;
  padding: 5px 8px 5px 26px;
  font-size: 0.78rem;
  color: #fff;
  width: 170px;
  outline: none;
}
.search-input:focus { border-color: #3b82f6; }

.table-responsive {
  padding: 0;
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  text-align: left;
}

.data-table th {
  background: rgba(0, 0, 0, 0.2);
  color: var(--text-muted, #94a3b8);
  font-weight: 600;
  font-size: 0.74rem;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border, #2a2f42);
}

.data-table td {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  vertical-align: middle;
}

.table-cell-input {
  background: var(--bg-app, #12141c);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 0.78rem;
  color: var(--text-main, #e2e8f0);
  width: 100%;
  outline: none;
}
.table-cell-input:focus { border-color: #3b82f6; }

.type-pill {
  font-size: 0.68rem;
  font-weight: 700;
  font-family: monospace;
  padding: 2px 6px;
  border-radius: 4px;
}
.pill-in { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
.pill-out { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
.pill-ai { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
.pill-ao { background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); }

.nb-published-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.7rem;
  font-family: monospace;
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.25);
  color: #93c5fd;
  padding: 2px 6px;
  border-radius: 4px;
}

.btn-publish-nb {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.68rem;
  background: transparent;
  border: 1px dashed var(--border, #2a2f42);
  border-radius: 4px;
  color: var(--text-muted, #94a3b8);
  padding: 3px 6px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-publish-nb:hover {
  border-color: #3b82f6;
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.08);
}

.text-mono { font-family: monospace; }
.font-bold { font-weight: 600; }
.text-center { text-align: center; }
.text-muted { color: var(--text-muted, #94a3b8); }
.text-blue { color: #60a5fa; }
.text-green { color: #34d399; }
.text-purple { color: #c084fc; }
.text-amber { color: #fbbf24; }

.btn-icon {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px;
  cursor: pointer;
  color: var(--text-muted, #94a3b8);
}
.btn-icon:hover { background: rgba(239, 68, 68, 0.15); color: #f87171; }

.empty-cell {
  text-align: center;
  padding: 36px;
  color: var(--text-muted, #94a3b8);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn-primary { background: #2563eb; color: #fff; }
.btn-primary:hover { background: #1d4ed8; }
.btn-green { background: #059669; color: #fff; }
.btn-green:hover { background: #047857; }
.btn-outline { background: transparent; border-color: var(--border, #2a2f42); color: var(--text-main, #cbd5e1); }
.btn-outline:hover { background: rgba(255, 255, 255, 0.05); color: #60a5fa; }
/* Compact engineering workspace pass */
.points-tab-wrapper { gap: 10px; }
.points-kpi-bar { gap: 8px; padding: 8px 10px; border-radius: var(--radius-sm); }
.panel-card { border-radius: var(--radius-sm); }
.panel-header { min-height: 38px; padding: 8px 12px; gap: 8px; }
.data-table th { padding: 7px 8px; }
.data-table td { padding: 5px 8px; }
.table-cell-input { min-height: var(--control-height-dense); padding: 4px 7px; }
.empty-cell { padding: 20px; }
.btn { min-height: var(--control-height-dense); padding: 4px 9px; border-radius: var(--radius-xs); }
</style>
