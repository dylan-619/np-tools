<script setup lang="ts">
import { ref } from 'vue'
import {
  Plus,
  Trash2,
  Sliders,
  Terminal,
  Activity,
  Gauge,
  Info,
} from 'lucide-vue-next'
import { useControllerStore } from '../../../stores/controllerStore'
import CustomSelect from '../../../components/common/CustomSelect.vue'

const controller = useControllerStore()

const subTab = ref<'parameters' | 'commands' | 'states' | 'pids'>('parameters')

const cTypeOptions = [
  { label: '布尔值 (bool)', value: 'bool' },
  { label: '无符号16位整数 (u16)', value: 'u16' },
  { label: '无符号32位整数 (u32)', value: 'u32' },
  { label: '有符号16位整数 (i16)', value: 'i16' },
  { label: '有符号32位整数 (i32)', value: 'i32' },
  { label: '单精度浮点数 (float)', value: 'float' },
]

const directionOptions = [
  { label: '正动作 (Direct)', value: 'direct' },
  { label: '反动作 (Reverse)', value: 'reverse' },
]
</script>

<template>
  <div class="tab-content">
    <div class="panel-card">
      <div class="panel-header">
        <div class="header-left">
          <div class="panel-title">
            <Sliders :size="17" class="panel-icon" />
            <span>应用变量与逻辑资源 (Application Variables & PID)</span>
          </div>

          <div class="sub-nav-tabs">
            <button
              class="sub-tab-btn"
              :class="{ active: subTab === 'parameters' }"
              @click="subTab = 'parameters'"
            >
              <Sliders :size="14" />
              <span>参数 ({{ controller.doc.project.application_variables.parameters.length }})</span>
            </button>

            <button
              class="sub-tab-btn"
              :class="{ active: subTab === 'commands' }"
              @click="subTab = 'commands'"
            >
              <Terminal :size="14" />
              <span>命令 ({{ controller.doc.project.application_variables.commands.length }})</span>
            </button>

            <button
              class="sub-tab-btn"
              :class="{ active: subTab === 'states' }"
              @click="subTab = 'states'"
            >
              <Activity :size="14" />
              <span>状态 ({{ controller.doc.project.application_variables.states.length }})</span>
            </button>

            <button
              class="sub-tab-btn"
              :class="{ active: subTab === 'pids' }"
              @click="subTab = 'pids'"
            >
              <Gauge :size="14" />
              <span>PID 回路 ({{ controller.doc.project.pids.length }})</span>
            </button>
          </div>
        </div>

        <div class="header-actions">
          <button
            v-if="subTab === 'parameters'"
            class="btn btn-primary"
            @click="controller.addParameter()"
          >
            <Plus :size="14" />
            <span>添加参数</span>
          </button>

          <button
            v-if="subTab === 'commands'"
            class="btn btn-primary"
            @click="controller.addCommand()"
          >
            <Plus :size="14" />
            <span>添加命令</span>
          </button>

          <button
            v-if="subTab === 'states'"
            class="btn btn-primary"
            @click="controller.addState()"
          >
            <Plus :size="14" />
            <span>添加状态</span>
          </button>

          <button
            v-if="subTab === 'pids'"
            class="btn btn-primary"
            @click="controller.addPid()"
          >
            <Plus :size="14" />
            <span>添加 PID 回路</span>
          </button>
        </div>
      </div>

      <div class="panel-body">
        <!-- 1. Parameters Table -->
        <div v-if="subTab === 'parameters'" class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th style="width: 220px;">参数名称 (name)</th>
                <th style="width: 180px;">类型 (c_type)</th>
                <th style="width: 140px;">默认值 (default)</th>
                <th style="width: 100px;">最小值 (min)</th>
                <th style="width: 100px;">最大值 (max)</th>
                <th style="width: 100px;">工程单位</th>
                <th style="width: 70px; text-align: center;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(param, idx) in controller.doc.project.application_variables.parameters"
                :key="param.id"
              >
                <td class="text-muted">{{ idx + 1 }}</td>
                <td>
                  <input
                    v-model="param.name"
                    type="text"
                    class="table-cell-input text-mono font-bold"
                    placeholder="如 setpoint_temp"
                  />
                </td>
                <td>
                  <CustomSelect v-model="param.c_type" :options="cTypeOptions" />
                </td>
                <td>
                  <input
                    v-if="param.c_type === 'bool'"
                    v-model="param.default"
                    type="checkbox"
                    style="margin-left: 6px;"
                  />
                  <input
                    v-else
                    v-model.number="param.default"
                    type="number"
                    class="table-cell-input"
                  />
                </td>
                <td>
                  <input
                    v-if="param.c_type !== 'bool'"
                    v-model.number="param.min"
                    type="number"
                    class="table-cell-input"
                    placeholder="可选"
                  />
                  <span v-else class="text-muted">-</span>
                </td>
                <td>
                  <input
                    v-if="param.c_type !== 'bool'"
                    v-model.number="param.max"
                    type="number"
                    class="table-cell-input"
                    placeholder="可选"
                  />
                  <span v-else class="text-muted">-</span>
                </td>
                <td>
                  <input
                    v-model="param.unit"
                    type="text"
                    class="table-cell-input"
                    placeholder="℃ / mA / s"
                  />
                </td>
                <td style="text-align: center;">
                  <button
                    class="btn-icon btn-danger"
                    title="删除参数"
                    @click="controller.removeParameter(idx)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </td>
              </tr>

              <tr v-if="controller.doc.project.application_variables.parameters.length === 0">
                <td colspan="8" class="empty-cell">
                  暂无参数定义，点击右上角“添加参数”。
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 2. Commands Table -->
        <div v-if="subTab === 'commands'" class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th style="width: 260px;">命令名称 (name)</th>
                <th style="width: 180px;">数据类型 (c_type)</th>
                <th>说明</th>
                <th style="width: 70px; text-align: center;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(cmd, idx) in controller.doc.project.application_variables.commands"
                :key="cmd.id"
              >
                <td class="text-muted">{{ idx + 1 }}</td>
                <td>
                  <input
                    v-model="cmd.name"
                    type="text"
                    class="table-cell-input text-mono font-bold"
                    placeholder="如 pump_start"
                  />
                </td>
                <td>
                  <span class="badge badge-cmd">bool (One-Shot 命令)</span>
                </td>
                <td>
                  <input
                    v-model="cmd.description"
                    type="text"
                    class="table-cell-input"
                    placeholder="填写命令触发逻辑说明"
                  />
                </td>
                <td style="text-align: center;">
                  <button
                    class="btn-icon btn-danger"
                    title="删除命令"
                    @click="controller.removeCommand(idx)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </td>
              </tr>

              <tr v-if="controller.doc.project.application_variables.commands.length === 0">
                <td colspan="5" class="empty-cell">
                  暂无命令定义，点击右上角“添加命令”。
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 3. States Table -->
        <div v-if="subTab === 'states'" class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th style="width: 240px;">状态名称 (name)</th>
                <th style="width: 180px;">类型 (c_type)</th>
                <th style="width: 140px;">初始默认值 (default)</th>
                <th>说明</th>
                <th style="width: 70px; text-align: center;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(st, idx) in controller.doc.project.application_variables.states"
                :key="st.id"
              >
                <td class="text-muted">{{ idx + 1 }}</td>
                <td>
                  <input
                    v-model="st.name"
                    type="text"
                    class="table-cell-input text-mono font-bold"
                    placeholder="如 marquee_running"
                  />
                </td>
                <td>
                  <CustomSelect v-model="st.c_type" :options="cTypeOptions" />
                </td>
                <td>
                  <input
                    v-if="st.c_type === 'bool'"
                    v-model="st.default"
                    type="checkbox"
                    style="margin-left: 6px;"
                  />
                  <input
                    v-else
                    v-model.number="st.default"
                    type="number"
                    class="table-cell-input"
                  />
                </td>
                <td>
                  <input
                    v-model="st.description"
                    type="text"
                    class="table-cell-input"
                    placeholder="填写可观测逻辑状态说明"
                  />
                </td>
                <td style="text-align: center;">
                  <button
                    class="btn-icon btn-danger"
                    title="删除状态"
                    @click="controller.removeState(idx)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </td>
              </tr>

              <tr v-if="controller.doc.project.application_variables.states.length === 0">
                <td colspan="6" class="empty-cell">
                  暂无状态定义，点击右上角“添加状态”。
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 4. PID Loops -->
        <div v-if="subTab === 'pids'" class="pids-stack">
          <div
            v-for="(pid, idx) in controller.doc.project.pids"
            :key="pid.id"
            class="pid-card"
          >
            <div class="pid-card-header">
              <div class="pid-title-row">
                <input
                  v-model="pid.enabled"
                  type="checkbox"
                  class="pid-enable-check"
                />
                <span class="pid-badge">PID Loop #{{ idx + 1 }}</span>
                <input
                  v-model="pid.name"
                  type="text"
                  class="pid-name-input text-mono font-bold"
                  placeholder="回路名 (如 temp_control)"
                />
                <span class="pid-status-tag" :class="pid.enabled ? 'active' : 'inactive'">
                  {{ pid.enabled ? '已启用' : '已禁用' }}
                </span>
              </div>

              <button
                class="btn-icon btn-danger"
                title="删除 PID 回路"
                @click="controller.removePid(idx)"
              >
                <Trash2 :size="14" />
              </button>
            </div>

            <div class="pid-form-grid">
              <div class="form-group">
                <label>测量输入源 (Measurement)</label>
                <input
                  v-model="pid.measurement"
                  type="text"
                  class="form-input text-mono"
                  placeholder="如 board.ai01 或 point.temp"
                />
              </div>

              <div class="form-group">
                <label>目标设定值 (Setpoint)</label>
                <input
                  v-model="pid.setpoint"
                  type="text"
                  class="form-input text-mono"
                  placeholder="如 parameter.target_temp"
                />
              </div>

              <div class="form-group">
                <label>控制输出端 (Output)</label>
                <input
                  v-model="pid.output"
                  type="text"
                  class="form-input text-mono"
                  placeholder="如 board.ao01 或 rtu.field_io.ao01"
                />
              </div>

              <div class="form-group">
                <label>动作方向 (Direction)</label>
                <CustomSelect v-model="pid.direction" :options="directionOptions" />
              </div>

              <div class="form-group">
                <label>比例系数 (Kp)</label>
                <input
                  v-model.number="pid.kp"
                  type="number"
                  step="0.1"
                  class="form-input"
                />
              </div>

              <div class="form-group">
                <label>积分系数 (Ki)</label>
                <input
                  v-model.number="pid.ki"
                  type="number"
                  step="0.01"
                  class="form-input"
                />
              </div>

              <div class="form-group">
                <label>微分系数 (Kd)</label>
                <input
                  v-model.number="pid.kd"
                  type="number"
                  step="0.01"
                  class="form-input"
                />
              </div>

              <div class="form-group">
                <label>输出限幅 (Min ~ Max)</label>
                <div class="range-inputs">
                  <input
                    v-model.number="pid.output_min"
                    type="number"
                    class="form-input"
                    placeholder="Min (0)"
                  />
                  <span class="range-sep">~</span>
                  <input
                    v-model.number="pid.output_max"
                    type="number"
                    class="form-input"
                    placeholder="Max (100)"
                  />
                </div>
              </div>
            </div>
          </div>

          <div v-if="controller.doc.project.pids.length === 0" class="empty-state">
            <Info :size="32" class="empty-icon" />
            <p>当前项目未配置任何 PID 闭环控制回路，点击右上角“添加 PID 回路”。</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
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

.panel-icon {
  color: #60a5fa;
}

.sub-nav-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-app, #12141c);
  padding: 3px;
  border-radius: 6px;
  border: 1px solid var(--border, #2a2f42);
}

.sub-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  color: var(--text-muted, #94a3b8);
  font-size: 0.74rem;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.sub-tab-btn.active {
  background: #3b82f6;
  color: #fff;
  font-weight: 600;
}

.panel-body {
  padding: 16px;
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

.text-mono { font-family: monospace; }
.font-bold { font-weight: 600; }
.text-muted { color: var(--text-muted, #94a3b8); }

.badge-cmd {
  font-size: 0.7rem;
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(168, 85, 247, 0.25);
}

.btn-icon {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px;
  cursor: pointer;
  color: var(--text-muted, #94a3b8);
}
.btn-icon:hover { background: rgba(239, 68, 68, 0.15); color: #f87171; }

.empty-cell, .empty-state {
  text-align: center;
  padding: 36px;
  color: var(--text-muted, #94a3b8);
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.empty-icon { opacity: 0.4; }

/* PID Cards */
.pids-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pid-card {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pid-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.pid-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pid-badge {
  font-size: 0.72rem;
  font-weight: 700;
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  padding: 2px 8px;
  border-radius: 4px;
}

.pid-name-input {
  background: var(--bg-app, #12141c);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 4px;
  padding: 4px 8px;
  color: #fff;
  font-size: 0.8rem;
  width: 160px;
}

.pid-status-tag {
  font-size: 0.68rem;
  padding: 1px 6px;
  border-radius: 4px;
}
.pid-status-tag.active { background: rgba(16, 185, 129, 0.15); color: #34d399; }
.pid-status-tag.inactive { background: rgba(239, 68, 68, 0.15); color: #f87171; }

.pid-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 0.76rem;
  color: var(--text-muted, #94a3b8);
}

.form-input {
  background: var(--bg-app, #12141c);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 0.8rem;
  color: var(--text-main, #e2e8f0);
  outline: none;
}
.form-input:focus { border-color: #3b82f6; }

.range-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
}
.range-inputs input { width: 50%; }
.range-sep { color: var(--text-muted, #94a3b8); font-size: 0.8rem; }

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
/* Compact engineering workspace pass */
.tab-content { gap: 10px; }
.panel-card { border-radius: var(--radius-sm); }
.panel-header { min-height: 38px; padding: 8px 12px; gap: 8px; }
.data-table th { padding: 7px 8px; }
.data-table td { padding: 5px 8px; }
.table-cell-input { min-height: var(--control-height-dense); padding: 4px 7px; }
.empty-cell { padding: 20px; }
.btn { min-height: var(--control-height-dense); padding: 4px 9px; border-radius: var(--radius-xs); }
</style>
