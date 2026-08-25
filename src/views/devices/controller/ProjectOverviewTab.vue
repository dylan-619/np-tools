<script setup lang="ts">
import {
  Cpu,
  Layers,
  Activity,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Sparkles,
  RefreshCw,
  FolderOpen,
} from 'lucide-vue-next'
import { useControllerStore } from '../../../stores/controllerStore'
import { KZ3_BOARD_DEF } from '../../../utils/controllerIoCatalog'

const controller = useControllerStore()
</script>

<template>
  <div class="tab-content">
    <!-- Top Stats Row -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-icon-box bg-blue">
          <Layers :size="20" />
        </div>
        <div class="metric-body">
          <span class="metric-label">南向扩展设备</span>
          <span class="metric-val">{{ controller.doc.project.devices.length }} <small>台</small></span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon-box bg-emerald">
          <Cpu :size="20" />
        </div>
        <div class="metric-body">
          <span class="metric-label">I/O 业务点位</span>
          <span class="metric-val">
            {{ controller.doc.project.points.inputs.length + controller.doc.project.points.outputs.length }}
            <small>点 (入{{ controller.doc.project.points.inputs.length }}/出{{ controller.doc.project.points.outputs.length }})</small>
          </span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon-box bg-purple">
          <Activity :size="20" />
        </div>
        <div class="metric-body">
          <span class="metric-label">应用变量 / 命令</span>
          <span class="metric-val">
            {{
              controller.doc.project.application_variables.parameters.length +
              controller.doc.project.application_variables.commands.length +
              controller.doc.project.application_variables.states.length
            }}
            <small>个</small>
          </span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon-box bg-amber">
          <FileCode :size="20" />
        </div>
        <div class="metric-body">
          <span class="metric-label">北向通信字段</span>
          <span class="metric-val">{{ controller.doc.project.northbound.fields.length }} <small>条</small></span>
        </div>
      </div>

      <div class="metric-card" :class="{ 'has-error': controller.errorCount > 0 }">
        <div
          class="metric-icon-box"
          :class="controller.errorCount > 0 ? 'bg-red' : 'bg-green'"
        >
          <AlertTriangle v-if="controller.errorCount > 0" :size="20" />
          <CheckCircle2 v-else :size="20" />
        </div>
        <div class="metric-body">
          <span class="metric-label">工程校验状态</span>
          <span class="metric-val">
            <span v-if="controller.errorCount > 0" class="text-danger">{{ controller.errorCount }} 错误</span>
            <span v-else-if="controller.warningCount > 0" class="text-warning">{{ controller.warningCount }} 告警</span>
            <span v-else class="text-success">校验通过</span>
          </span>
        </div>
      </div>
    </div>

    <!-- Main Overview Layout: 2 Columns -->
    <div class="overview-grid">
      <!-- Left Card: Project Identity Form -->
      <div class="panel-card">
        <div class="panel-header">
          <div class="panel-title">
            <Cpu :size="17" class="panel-icon" />
            <span>工程身份与基础属性 (Project Identity)</span>
          </div>
          <span class="schema-pill">{{ controller.doc.schema }}</span>
        </div>

        <div class="panel-body form-body">
          <div class="form-row">
            <div class="form-group">
              <label>工程中文名称 (Project Name)</label>
              <input
                v-model="controller.doc.project.name"
                type="text"
                class="form-input"
                placeholder="例如：扩展DO北向启停跑马灯"
              />
              <span class="form-hint">项目可读描述，用于生成报告与文档识别</span>
            </div>

            <div class="form-group">
              <label>工程唯一标识 (Project ID)</label>
              <input
                v-model="controller.doc.project.id"
                type="text"
                class="form-input"
                placeholder="例如：expansion_marquee_di01_north_command"
              />
              <span class="form-hint">必须为全小写 ASCII 字母/数字/下划线，作为固件代码宏与导出命名</span>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>工程版本 (Version)</label>
              <input
                v-model="controller.doc.project.version"
                type="text"
                class="form-input"
                placeholder="1.0.0"
              />
            </div>

            <div class="form-group">
              <label>扫描周期 (Scan Period ms)</label>
              <div class="input-with-unit">
                <input
                  v-model.number="controller.doc.project.scan_period_ms"
                  type="number"
                  min="1"
                  max="1000"
                  class="form-input"
                />
                <span class="unit-text">ms</span>
              </div>
              <span class="form-hint">主控制循环 Scan 节拍，通常为 10 ms</span>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>固化板型 (Target Board)</label>
              <input
                :value="controller.doc.project.board"
                type="text"
                class="form-input readonly"
                disabled
              />
              <span class="form-hint">KZ3 F427 标准板型 (12DI / 8DO / 4AI / 2AO) 产品固定定义</span>
            </div>

            <div class="form-group">
              <label>功能特性开关 (Auto-derived Features)</label>
              <div class="features-pill-row">
                <span class="feature-tag" :class="{ active: controller.doc.project.pids.length > 0 }">
                  PID: {{ controller.doc.project.pids.length > 0 ? '启用' : '关闭' }}
                </span>
                <span
                  class="feature-tag"
                  :class="{ active: (controller.doc.project.logic_blocks?.counters?.length || 0) > 0 }"
                >
                  Counter: {{ (controller.doc.project.logic_blocks?.counters?.length || 0) > 0 ? '启用' : '关闭' }}
                </span>
                <span class="feature-tag disabled">
                  Retained: 关闭 (当前运行时易失)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Card: Board Specification & Presets -->
      <div class="panel-card">
        <div class="panel-header">
          <div class="panel-title">
            <Sparkles :size="17" class="panel-icon text-purple" />
            <span>硬件产品契约与工程模版</span>
          </div>
        </div>

        <div class="panel-body">
          <div class="board-spec-box">
            <div class="board-title-row">
              <span class="board-badge">{{ KZ3_BOARD_DEF.id }}</span>
              <span class="board-name">{{ KZ3_BOARD_DEF.name }}</span>
            </div>
            <div class="board-channels-summary">
              <div class="ch-chip bg-blue-subtle">12 路 板载数字输入 (DI01~DI12, 低电平有效)</div>
              <div class="ch-chip bg-green-subtle">8 路 板载数字输出 (DO01~DO08, 高电平有效, 默认 safe: false)</div>
              <div class="ch-chip bg-amber-subtle">4 路 板载模拟输入 (AI01~AI04, 0..20 mA)</div>
              <div class="ch-chip bg-purple-subtle">2 路 板载模拟输出 (AO01~AO02, 0..20 mA, 默认 safe: 0.0)</div>
            </div>
          </div>

          <div class="presets-section">
            <div class="section-sub-title">快捷载入工程模板：</div>
            <div class="preset-buttons">
              <button class="btn btn-outline" @click="controller.loadPreset('marquee')">
                <Sparkles :size="14" />
                <span>跑马灯控制工程示例</span>
              </button>
              <button class="btn btn-outline" @click="controller.loadPreset('blank')">
                <RefreshCw :size="14" />
                <span>重置为空白工程</span>
              </button>
            </div>
          </div>

          <div class="quick-file-actions">
            <button class="btn btn-primary flex-1" @click="controller.exportYamlFile()">
              <FileCode :size="15" />
              <span>导出 project_io.yaml</span>
            </button>
            <button class="btn btn-secondary flex-1" @click="controller.importYamlFile()">
              <FolderOpen :size="15" />
              <span>导入已存 YAML</span>
            </button>
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

/* Metrics Cards */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
}

.metric-card {
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

.metric-card.has-error {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.05);
}

.metric-icon-box {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.bg-blue { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.bg-emerald { background: rgba(16, 185, 129, 0.15); color: #34d399; }
.bg-purple { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
.bg-amber { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
.bg-red { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.bg-green { background: rgba(34, 197, 94, 0.15); color: #4ade80; }

.metric-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.metric-label {
  font-size: 0.76rem;
  color: var(--text-muted, #94a3b8);
}

.metric-val {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-main, #e2e8f0);
}

.metric-val small {
  font-size: 0.72rem;
  font-weight: normal;
  color: var(--text-muted, #94a3b8);
  margin-left: 4px;
}

.text-danger { color: #f87171; }
.text-warning { color: #fbbf24; }
.text-success { color: #34d399; }

/* Main Overview Layout */
.overview-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 18px;
}

@media (max-width: 960px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }
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
.text-purple { color: #c084fc; }

.schema-pill {
  font-size: 0.7rem;
  font-family: monospace;
  background: rgba(59, 130, 246, 0.12);
  color: #60a5fa;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(59, 130, 246, 0.25);
}

.panel-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-body {
  gap: 14px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 600px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-main, #cbd5e1);
}

.form-input {
  background: var(--bg-app, #12141c);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 0.82rem;
  color: var(--text-main, #e2e8f0);
  outline: none;
  transition: border-color 0.15s;
}

.form-input:focus {
  border-color: #3b82f6;
}

.form-input.readonly {
  opacity: 0.75;
  background: rgba(255, 255, 255, 0.03);
}

.form-hint {
  font-size: 0.7rem;
  color: var(--text-muted, #94a3b8);
  line-height: 1.3;
}

.input-with-unit {
  position: relative;
  display: flex;
  align-items: center;
}

.input-with-unit input {
  padding-right: 36px;
  width: 100%;
}

.unit-text {
  position: absolute;
  right: 10px;
  font-size: 0.75rem;
  color: var(--text-muted, #94a3b8);
}

.features-pill-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.feature-tag {
  font-size: 0.72rem;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border, #2a2f42);
  color: var(--text-muted, #94a3b8);
}

.feature-tag.active {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
  color: #60a5fa;
}

.feature-tag.disabled {
  opacity: 0.6;
}

/* Board Spec Box */
.board-spec-box {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.board-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.board-badge {
  font-size: 0.72rem;
  font-weight: 600;
  font-family: monospace;
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
  padding: 2px 6px;
  border-radius: 4px;
}

.board-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-main, #e2e8f0);
}

.board-channels-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ch-chip {
  font-size: 0.74rem;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
}

.bg-blue-subtle { background: rgba(59, 130, 246, 0.08); border-color: rgba(59, 130, 246, 0.2); color: #93c5fd; }
.bg-green-subtle { background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.2); color: #6ee7b7; }
.bg-amber-subtle { background: rgba(245, 158, 11, 0.08); border-color: rgba(245, 158, 11, 0.2); color: #fde68a; }
.bg-purple-subtle { background: rgba(168, 85, 247, 0.08); border-color: rgba(168, 85, 247, 0.2); color: #d8b4fe; }

.presets-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
}

.section-sub-title {
  font-size: 0.78rem;
  color: var(--text-muted, #94a3b8);
  font-weight: 500;
}

.preset-buttons {
  display: flex;
  gap: 10px;
}

.quick-file-actions {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}

.flex-1 {
  flex: 1;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s;
}

.btn-primary {
  background: #2563eb;
  color: #fff;
}
.btn-primary:hover {
  background: #1d4ed8;
}

.btn-secondary {
  background: #334155;
  color: #fff;
}
.btn-secondary:hover {
  background: #475569;
}

.btn-outline {
  background: transparent;
  border-color: var(--border, #2a2f42);
  color: var(--text-main, #cbd5e1);
}
.btn-outline:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: #3b82f6;
  color: #60a5fa;
}
</style>
