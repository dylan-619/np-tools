<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Plus,
  Trash2,
  Sliders,
  Terminal,
  Activity,
  Gauge,
  Info,
  Clock,
  HardDrive,
} from 'lucide-vue-next'
import { useControllerStore } from '../../../stores/controllerStore'
import CustomSelect from '../../../components/common/CustomSelect.vue'

const controller = useControllerStore()

const subTab = ref<'parameters' | 'commands' | 'states' | 'pids' | 'runtimes'>('parameters')

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

const activeValueOptions = [
  { label: '高电平/真 (true)', value: true },
  { label: '低电平/假 (false)', value: false },
]

const qualityOptions = [
  { label: '必须有效 (good)', value: 'good' },
  { label: '任意质量 (any)', value: 'any' },
]

const persistentCount = computed(() => {
  return controller.doc.project.application_variables.parameters.filter((p) => p.persistent).length
})
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

            <button
              class="sub-tab-btn"
              :class="{ active: subTab === 'runtimes' }"
              @click="subTab = 'runtimes'"
            >
              <Clock :size="14" />
              <span>运行累计 ({{ controller.doc.project.runtime_counters?.length || 0 }})</span>
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

          <button
            v-if="subTab === 'runtimes'"
            class="btn btn-primary"
            @click="controller.addRuntimeCounter()"
          >
            <Plus :size="14" />
            <span>添加运行累计器</span>
          </button>
        </div>
      </div>

      <div class="panel-body">
        <!-- 1. Parameters Table -->
        <div v-if="subTab === 'parameters'" class="table-responsive">
          <div class="param-persistent-banner" :class="{ warn: persistentCount > 32 }">
            <div class="banner-left">
              <HardDrive :size="15" />
              <span>掉电保持参数：<strong>{{ persistentCount }}</strong> / 32</span>
              <span v-if="persistentCount > 32" class="persistent-warn-text">⚠️ 保持参数超过 32 项推荐上限，写入下发可能受 EEPROM 扇区容量限制</span>
              <span v-else class="persistent-tip-text">勾选“保持”的参数在掉电后自动存入内部 EEPROM，重启时不丢失；写入后下个扫描周期生效</span>
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 45px;">#</th>
                <th style="width: 200px;">参数名称 (name)</th>
                <th style="width: 170px;">类型 (c_type)</th>
                <th style="width: 120px;">默认值 (default)</th>
                <th style="width: 90px;">最小值 (min)</th>
                <th style="width: 90px;">最大值 (max)</th>
                <th style="width: 90px;">工程单位</th>
                <th style="width: 100px; text-align: center;">掉电保持</th>
                <th style="width: 60px; text-align: center;">操作</th>
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
                  <label class="persistent-toggle-label" :title="param.persistent ? '掉电保持：写入控制器内部 EEPROM' : '非保持：重启后恢复默认值'">
                    <input
                      v-model="param.persistent"
                      type="checkbox"
                    />
                    <span class="persistent-pill" :class="{ active: param.persistent }">
                      {{ param.persistent ? '保持' : '非保持' }}
                    </span>
                  </label>
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
                <td colspan="9" class="empty-cell">
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

        <!-- 5. Runtime Counters Table -->
        <div v-if="subTab === 'runtimes'" class="table-responsive">
          <div class="runtime-intro-banner">
            <Clock :size="16" class="text-blue banner-icon" />
            <div class="intro-text">
              <div class="intro-title">设备运行时间累计器 (Runtime Hour Counters)</div>
              <div class="intro-desc">
                根据绑定的布尔信号自动按秒累计持续运行时间。自动在北向生成 <code>runtime.&lt;name&gt;.seconds</code> (只读 U32 累计秒数)、<code>runtime.&lt;name&gt;.clear</code> (读写 BOOL 复位触发) 与 <code>runtime.&lt;name&gt;.clear_pending</code> (只读 BOOL 正在复位)。
              </div>
            </div>
          </div>

          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 45px; text-align: center;">#</th>
                <th style="width: 180px;">累计器名称 (name)</th>
                <th style="min-width: 200px;">触发信号绑定 (trigger.bind)</th>
                <th style="width: 150px;">有效电平 (active_value)</th>
                <th style="width: 150px;">质量门禁 (quality)</th>
                <th>功能描述 (description)</th>
                <th style="width: 60px; text-align: center;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(rc, idx) in (controller.doc.project.runtime_counters || [])"
                :key="rc.id"
              >
                <td class="text-center text-muted font-mono">{{ idx + 1 }}</td>
                <td>
                  <input
                    v-model="rc.name"
                    type="text"
                    class="table-cell-input text-mono font-bold"
                    placeholder="如 pump1_run"
                  />
                </td>
                <td>
                  <CustomSelect
                    v-model="rc.trigger.bind"
                    :options="controller.availableBindTargets.filter((t) => t.type === 'bool' || !t.type)"
                  />
                </td>
                <td>
                  <CustomSelect
                    v-model="rc.trigger.active_value"
                    :options="activeValueOptions"
                  />
                </td>
                <td>
                  <CustomSelect
                    v-model="rc.trigger.quality"
                    :options="qualityOptions"
                  />
                </td>
                <td>
                  <input
                    v-model="rc.description"
                    type="text"
                    class="table-cell-input"
                    placeholder="如 1# 循环泵累计运行时间"
                  />
                </td>
                <td style="text-align: center;">
                  <button
                    class="btn-icon btn-danger"
                    title="删除累计器"
                    @click="controller.removeRuntimeCounter(idx)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </td>
              </tr>

              <tr v-if="!controller.doc.project.runtime_counters || controller.doc.project.runtime_counters.length === 0">
                <td colspan="7" class="empty-cell">
                  暂无运行时间累计器，点击右上角“添加运行累计器”为泵/阀等设备建立工时与维护监控。
                </td>
              </tr>
            </tbody>
          </table>
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
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #b9c5cf);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f7f9fb;
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
  color: var(--text-main, #17212b);
}

.panel-icon {
  color: #0f5f9e;
}

.sub-nav-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-app, #ffffff);
  padding: 3px;
  border-radius: 6px;
  border: 1px solid var(--border, #b9c5cf);
}

.sub-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  color: var(--text-muted, #40515f);
  font-size: 0.74rem;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.sub-tab-btn.active {
  background: #1769aa;
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
  background: #f7f9fb;
  color: var(--text-muted, #40515f);
  font-weight: 600;
  font-size: 0.74rem;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border, #b9c5cf);
}

.data-table td {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  vertical-align: middle;
}

.table-cell-input {
  background: var(--bg-app, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 0.78rem;
  color: var(--text-main, #17212b);
  width: 100%;
  outline: none;
}
.table-cell-input:focus { border-color: #1769aa; }

.text-mono { font-family: monospace; }
.font-bold { font-weight: 600; }
.text-muted { color: var(--text-muted, #40515f); }

.badge-cmd {
  font-size: 0.7rem;
  background: rgba(168, 85, 247, 0.15);
  color: #6f3a96;
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
  color: var(--text-muted, #40515f);
}
.btn-icon:hover { background: rgba(239, 68, 68, 0.15); color: #a12d34; }

.empty-cell, .empty-state {
  text-align: center;
  padding: 36px;
  color: var(--text-muted, #40515f);
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
  background: #f7f9fb;
  border: 1px solid var(--border, #b9c5cf);
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
  color: #0f5f9e;
  padding: 2px 8px;
  border-radius: 4px;
}

.pid-name-input {
  background: var(--bg-app, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 4px;
  padding: 4px 8px;
  color: #17212b;
  font-size: 0.8rem;
  width: 160px;
}

.pid-status-tag {
  font-size: 0.68rem;
  padding: 1px 6px;
  border-radius: 4px;
}
.pid-status-tag.active { background: rgba(16, 185, 129, 0.15); color: #176b45; }
.pid-status-tag.inactive { background: rgba(239, 68, 68, 0.15); color: #a12d34; }

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
  color: var(--text-muted, #40515f);
}

.form-input {
  background: var(--bg-app, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 0.8rem;
  color: var(--text-main, #17212b);
  outline: none;
}
.form-input:focus { border-color: #1769aa; }

.range-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
}
.range-inputs input { width: 50%; }
.range-sep { color: var(--text-muted, #40515f); font-size: 0.8rem; }

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
.btn-primary { background: #1769aa; color: #fff; }
.btn-primary:hover { background: #0e568e; }
/* Compact engineering workspace pass */
.tab-content { gap: 10px; }
.panel-card { border-radius: var(--radius-sm); }
.panel-header { min-height: 38px; padding: 8px 12px; gap: 8px; }
.data-table th { padding: 7px 8px; }
.data-table td { padding: 5px 8px; }
.table-cell-input { min-height: var(--control-height-dense); padding: 4px 7px; }
.empty-cell { padding: 20px; }
.btn { min-height: var(--control-height-dense); padding: 4px 9px; border-radius: var(--radius-xs); }

/* Persistent Parameter Banner & Pills */
.param-persistent-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 6px;
  padding: 6px 12px;
  margin-bottom: 10px;
  font-size: 0.76rem;
  color: #166534;
}

.param-persistent-banner.warn {
  background: #fffbeb;
  border-color: #fde68a;
  color: #92400e;
}

.banner-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.persistent-warn-text {
  color: #b45309;
  font-weight: 600;
}

.persistent-tip-text {
  color: #64748b;
  font-size: 0.72rem;
}

.persistent-toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  user-select: none;
}

.persistent-toggle-label input[type="checkbox"] {
  cursor: pointer;
}

.persistent-pill {
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  background: #f1f5f9;
  color: #64748b;
  border: 1px solid #cbd5e1;
}

.persistent-pill.active {
  background: #dcfce7;
  color: #166534;
  border-color: #86efac;
}

/* Runtime Counters Intro Banner */
.runtime-intro-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
}

.runtime-intro-banner .banner-icon {
  margin-top: 2px;
  flex-shrink: 0;
  color: #2563eb;
}

.intro-text .intro-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: #1e40af;
  margin-bottom: 2px;
}

.intro-text .intro-desc {
  font-size: 0.73rem;
  color: #3b82f6;
  line-height: 1.4;
}

.intro-desc code {
  background: rgba(37, 99, 235, 0.1);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.7rem;
}
</style>
