<script setup lang="ts">
import {
  Plus,
  Trash2,
  Network,
  Sparkles,
  Zap,
  CheckCircle2,
  ArrowRightLeft,
} from 'lucide-vue-next'
import { useControllerStore } from '../../../stores/controllerStore'
import CustomSelect from '../../../components/common/CustomSelect.vue'

const controller = useControllerStore()

// 紧凑数据类型选项
const cTypeCompactOptions = [
  { label: 'BOOL', value: 'bool' },
  { label: 'U16', value: 'u16' },
  { label: 'U32 (2 Reg)', value: 'u32' },
  { label: 'I16', value: 'i16' },
  { label: 'I32 (2 Reg)', value: 'i32' },
  { label: 'F32 (Float)', value: 'float' },
]

function getModbusZoneTag(refStr: string) {
  const num = parseInt(refStr, 10)
  if (isNaN(num)) return { label: '未知', class: 'zone-gray' }
  if (num >= 1 && num <= 9999) return { label: 'Coil (0x)', class: 'zone-blue' }
  if (num >= 10001 && num <= 19999) return { label: 'DI (1x)', class: 'zone-green' }
  if (num >= 30001 && num <= 39999) return { label: 'IR (3x)', class: 'zone-amber' }
  if (num >= 40001 && num <= 49999) return { label: 'HR (4x)', class: 'zone-purple' }
  return { label: '自定义', class: 'zone-gray' }
}

function toggleAccess(idx: number) {
  const f = controller.doc.project.northbound.fields[idx]
  f.access = f.access === 'read_write' ? 'read' : 'read_write'
}

function onBindChange(fieldIdx: number, newBind: string) {
  const f = controller.doc.project.northbound.fields[fieldIdx]
  f.bind = newBind

  // 智能推导 access 与 c_type
  if (newBind.startsWith('point.') || newBind.startsWith('state.')) {
    f.access = 'read'
  } else if (newBind.startsWith('parameter.') || newBind.startsWith('command.')) {
    f.access = 'read_write'
  }

  const target = controller.availableBindTargets.find((t) => t.value === newBind)
  if (target && target.type) {
    f.c_type = target.type as any
  }
}
</script>

<template>
  <div class="northbound-tab-wrapper">
    <!-- Top Protocol Info & Modbus Spec Banner -->
    <div class="protocol-spec-card">
      <div class="spec-left">
        <div class="spec-title-row">
          <Network :size="16" class="text-blue" />
          <span class="spec-main-title">多协议北向通信契约 (Northbound Protocols)</span>
        </div>
        <div class="active-protocols-row">
          <span class="proto-badge">
            <CheckCircle2 :size="13" class="text-green" />
            <span>SLE 星闪无线透传</span>
          </span>
          <span class="proto-badge">
            <CheckCircle2 :size="13" class="text-green" />
            <span>HTTP / RESTful API</span>
          </span>
          <span class="proto-badge">
            <CheckCircle2 :size="13" class="text-green" />
            <span>Modbus TCP 从站 (5位地址 / 大端 ABCD)</span>
          </span>
        </div>
      </div>

      <div class="modbus-legend-grid">
        <div class="legend-chip zone-blue">
          <span class="chip-code">00001..09999</span>
          <span class="chip-name">Coils 线圈 (BOOL 读写)</span>
        </div>
        <div class="legend-chip zone-green">
          <span class="chip-code">10001..19999</span>
          <span class="chip-name">Discrete Inputs (BOOL 只读)</span>
        </div>
        <div class="legend-chip zone-amber">
          <span class="chip-code">30001..39999</span>
          <span class="chip-name">Input Regs (数值 只读)</span>
        </div>
        <div class="legend-chip zone-purple">
          <span class="chip-code">40001..49999</span>
          <span class="chip-name">Holding Regs (数值 读写)</span>
        </div>
      </div>
    </div>

    <!-- Main Northbound Fields Table -->
    <div class="panel-card">
      <div class="panel-header">
        <div class="header-left">
          <div class="panel-title">
            <ArrowRightLeft :size="17" class="panel-icon text-blue" />
            <span>统一北向通信字段映射表 (Northbound Field Mappings)</span>
            <span class="count-pill">{{ controller.doc.project.northbound.fields.length }} 字段</span>
          </div>
        </div>

        <div class="header-actions">
          <button
            class="btn btn-outline"
            title="一键将点表、参数、命令与状态生成对应的北向字段"
            @click="controller.populateNorthboundFromPointsAndVars()"
          >
            <Sparkles :size="14" />
            <span>从点表与变量一键映射</span>
          </button>

          <button
            class="btn btn-outline"
            title="按数据类型与权限规则自动分配 5 位 Modbus 地址"
            @click="controller.autoAssignNorthboundAddresses()"
          >
            <Zap :size="14" />
            <span>自动分配 Modbus 地址</span>
          </button>

          <button
            class="btn btn-primary"
            @click="controller.addNorthboundField()"
          >
            <Plus :size="14" />
            <span>添加映射字段</span>
          </button>
        </div>
      </div>

      <div class="panel-body table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 45px; text-align: center;">#</th>
              <th style="min-width: 290px; width: 35%;">对外协议字段全名 (Field Key)</th>
              <th style="min-width: 250px; width: 30%;">内部实体绑定 (Bind Target)</th>
              <th style="width: 110px; text-align: center;">类型 (Type)</th>
              <th style="width: 90px; text-align: center;">权限 (Access)</th>
              <th style="width: 170px; text-align: center;">5位 Modbus 地址 (Ref)</th>
              <th style="width: 60px; text-align: center;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(f, idx) in controller.doc.project.northbound.fields"
              :key="f.id"
            >
              <td class="text-center text-muted font-mono">{{ idx + 1 }}</td>
              <td>
                <input
                  v-model="f.name"
                  type="text"
                  class="table-cell-input text-mono font-bold text-wide"
                  placeholder="如 command.marquee_toggle"
                />
              </td>
              <td>
                <CustomSelect
                  v-model="f.bind"
                  :options="controller.availableBindTargets"
                  @change="(val) => onBindChange(idx, val)"
                />
              </td>
              <td style="text-align: center;">
                <div class="compact-select-wrapper">
                  <CustomSelect
                    v-model="f.c_type"
                    :options="cTypeCompactOptions"
                  />
                </div>
              </td>
              <td style="text-align: center;">
                <button
                  class="access-toggle-badge"
                  :class="f.access === 'read_write' ? 'badge-rw' : 'badge-r'"
                  :title="`当前权限: ${f.access}，点击快速切换`"
                  @click="toggleAccess(idx)"
                >
                  <span>{{ f.access === 'read_write' ? 'RW' : 'R' }}</span>
                </button>
              </td>
              <td style="text-align: center;">
                <div class="ref-input-cell">
                  <input
                    v-model="f.reference"
                    type="text"
                    class="ref-input font-mono font-bold"
                    placeholder="00001"
                  />
                  <span class="ref-zone-tag" :class="getModbusZoneTag(f.reference).class">
                    {{ getModbusZoneTag(f.reference).label }}
                  </span>
                </div>
              </td>
              <td style="text-align: center;">
                <button
                  class="btn-icon btn-danger"
                  title="删除字段"
                  @click="controller.removeNorthboundField(idx)"
                >
                  <Trash2 :size="14" />
                </button>
              </td>
            </tr>

            <tr v-if="controller.doc.project.northbound.fields.length === 0">
              <td colspan="7" class="empty-cell">
                暂无北向映射字段，可点击右上角“从点表与变量一键映射”快速生成。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.northbound-tab-wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Protocol Spec Banner */
.protocol-spec-card {
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 10px;
  padding: 12px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

.spec-left {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.spec-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spec-main-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-main, #e2e8f0);
}

.active-protocols-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.proto-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.2);
  color: #6ee7b7;
}

.modbus-legend-grid {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.legend-chip {
  display: flex;
  flex-direction: column;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.68rem;
  border: 1px solid transparent;
}

.chip-code {
  font-family: monospace;
  font-weight: 700;
}

.chip-name {
  font-size: 0.62rem;
  opacity: 0.85;
}

.zone-blue { background: rgba(59, 130, 246, 0.1); border-color: rgba(59, 130, 246, 0.25); color: #93c5fd; }
.zone-green { background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.25); color: #6ee7b7; }
.zone-amber { background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.25); color: #fde68a; }
.zone-purple { background: rgba(168, 85, 247, 0.1); border-color: rgba(168, 85, 247, 0.25); color: #d8b4fe; }
.zone-gray { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.1); color: #94a3b8; }

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

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-main, #e2e8f0);
}

.count-pill {
  font-size: 0.72rem;
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  padding: 1px 6px;
  border-radius: 4px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

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

.compact-select-wrapper {
  max-width: 110px;
  margin: 0 auto;
}

.access-toggle-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  font-family: monospace;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.badge-rw {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.35);
  color: #60a5fa;
}
.badge-rw:hover {
  background: rgba(59, 130, 246, 0.25);
}

.badge-r {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.35);
  color: #34d399;
}
.badge-r:hover {
  background: rgba(16, 185, 129, 0.25);
}

.ref-input-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
}

.ref-input {
  width: 65px;
  text-align: center;
  background: var(--bg-app, #12141c);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 4px;
  padding: 5px 6px;
  font-size: 0.8rem;
  color: #fff;
  outline: none;
}
.ref-input:focus { border-color: #3b82f6; }

.ref-zone-tag {
  font-size: 0.65rem;
  font-family: monospace;
  padding: 2px 5px;
  border-radius: 3px;
  white-space: nowrap;
}

.text-mono { font-family: monospace; }
.font-bold { font-weight: 600; }
.text-center { text-align: center; }
.text-muted { color: var(--text-muted, #94a3b8); }
.text-blue { color: #60a5fa; }
.text-green { color: #34d399; }

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
.btn-outline { background: transparent; border-color: var(--border, #2a2f42); color: var(--text-main, #cbd5e1); }
.btn-outline:hover { background: rgba(255, 255, 255, 0.05); color: #60a5fa; }
</style>
