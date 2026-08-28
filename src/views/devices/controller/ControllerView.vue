<script setup lang="ts">
import {
  Cpu,
  Layers,
  TableProperties,
  Sliders,
  Network,
  FileCode,
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Save,
} from 'lucide-vue-next'
import { useControllerStore } from '../../../stores/controllerStore'
import ProjectOverviewTab from './ProjectOverviewTab.vue'
import HardwareSouthboundTab from './HardwareSouthboundTab.vue'
import PointsTableTab from './PointsTableTab.vue'
import VariablesLogicTab from './VariablesLogicTab.vue'
import NorthboundTab from './NorthboundTab.vue'
import YamlDiagnosisTab from './YamlDiagnosisTab.vue'

const controller = useControllerStore()
</script>

<template>
  <div class="controller-view-container">
    <!-- Header Topbar -->
    <header class="controller-header">
      <div class="header-left-box">
        <div class="header-icon-box">
          <Cpu :size="22" />
        </div>
        <div class="header-title-col">
          <div class="title-row">
            <h1 class="main-title">KZ3 工艺项目 I/O 可视化配置工作台</h1>
            <span class="project-tag">{{ controller.doc.project.name || '未命名工程' }}</span>
            <span class="version-tag">v{{ controller.doc.project.version }}</span>
          </div>
          <p class="sub-desc">
            面向 PLC / 工艺工程师的标准 I/O 组态、硬件拓扑、业务点映射与北向契约配置器 (一期 YAML 维护)
          </p>
        </div>
      </div>

      <div class="header-right-actions">
        <!-- Validation status pill -->
        <button
          class="status-btn"
          :class="controller.errorCount > 0 ? 'err' : 'ok'"
          @click="controller.activeTab = 'yaml'"
        >
          <AlertTriangle v-if="controller.errorCount > 0" :size="15" />
          <CheckCircle2 v-else :size="15" />
          <span>{{ controller.errorCount > 0 ? `${controller.errorCount} 处错误需修复` : '工程校验通过' }}</span>
        </button>

        <button class="btn btn-secondary" @click="controller.importYamlFile()">
          <FolderOpen :size="15" />
          <span>导入 YAML</span>
        </button>

        <button class="btn btn-primary" @click="controller.exportYamlFile()">
          <Save :size="15" />
          <span>导出 YAML</span>
        </button>
      </div>
    </header>

    <!-- Navigation Tabs Bar -->
    <nav class="nav-tabs-bar">
      <button
        class="tab-btn"
        :class="{ active: controller.activeTab === 'overview' }"
        @click="controller.activeTab = 'overview'"
      >
        <Cpu :size="15" />
        <span>1. 项目总览</span>
      </button>

      <button
        class="tab-btn"
        :class="{ active: controller.activeTab === 'hardware' }"
        @click="controller.activeTab = 'hardware'"
      >
        <Layers :size="15" />
        <span>2. 硬件拓扑与南向 ({{ controller.doc.project.devices.length }})</span>
      </button>

      <button
        class="tab-btn"
        :class="{ active: controller.activeTab === 'points' }"
        @click="controller.activeTab = 'points'"
      >
        <TableProperties :size="15" />
        <span>
          3. I/O 业务点表 ({{ controller.doc.project.points.inputs.length + controller.doc.project.points.outputs.length }})
        </span>
      </button>

      <button
        class="tab-btn"
        :class="{ active: controller.activeTab === 'variables' }"
        @click="controller.activeTab = 'variables'"
      >
        <Sliders :size="15" />
        <span>
          4. 应用变量与逻辑 ({{
            controller.doc.project.application_variables.parameters.length +
            controller.doc.project.application_variables.commands.length +
            controller.doc.project.application_variables.states.length +
            controller.doc.project.pids.length
          }})
        </span>
      </button>

      <button
        class="tab-btn"
        :class="{ active: controller.activeTab === 'northbound' }"
        @click="controller.activeTab = 'northbound'"
      >
        <Network :size="15" />
        <span>5. 北向通信映射 ({{ controller.doc.project.northbound.fields.length }})</span>
      </button>

      <button
        class="tab-btn"
        :class="{ active: controller.activeTab === 'yaml' }"
        @click="controller.activeTab = 'yaml'"
      >
        <FileCode :size="15" />
        <span>6. YAML 预览与工程检查</span>
        <span v-if="controller.errorCount > 0" class="err-count-dot">{{ controller.errorCount }}</span>
      </button>
    </nav>

    <!-- Main Active Tab Content -->
    <main class="tab-viewport">
      <ProjectOverviewTab v-if="controller.activeTab === 'overview'" />
      <HardwareSouthboundTab v-else-if="controller.activeTab === 'hardware'" />
      <PointsTableTab v-else-if="controller.activeTab === 'points'" />
      <VariablesLogicTab v-else-if="controller.activeTab === 'variables'" />
      <NorthboundTab v-else-if="controller.activeTab === 'northbound'" />
      <YamlDiagnosisTab v-else-if="controller.activeTab === 'yaml'" />
    </main>

    <!-- Global Toast Alert -->
    <transition name="fade">
      <div
        v-if="controller.toastMessage"
        class="toast-box"
        :class="controller.toastMessage.isSuccess ? 'success' : 'error'"
      >
        <CheckCircle2 v-if="controller.toastMessage.isSuccess" :size="16" />
        <AlertTriangle v-else :size="16" />
        <span>{{ controller.toastMessage.text }}</span>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.controller-view-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--color-canvas, #0b1016);
  padding: 12px;
  gap: 8px;
}

/* Header */
.controller-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: var(--radius-sm, 5px);
  padding: 10px 12px;
  gap: 12px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.header-left-box {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon-box {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm, 5px);
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.28);
  color: var(--color-info, #4aa3ff);
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-title-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.main-title {
  font-size: 0.98rem;
  font-weight: 700;
  color: var(--text-main, #e2e8f0);
  margin: 0;
}

.project-tag {
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.version-tag {
  font-size: 0.7rem;
  font-family: monospace;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted, #94a3b8);
  padding: 2px 6px;
  border-radius: 4px;
}

.sub-desc {
  font-size: 0.72rem;
  color: var(--text-muted, #94a3b8);
  margin: 0;
}

.header-right-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  flex-wrap: wrap;
}

.status-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  min-height: var(--control-height-dense, 28px);
  padding: 4px 9px;
  border-radius: var(--radius-xs, 3px);
  border: 1px solid transparent;
  cursor: pointer;
}
.status-btn.ok {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.3);
  color: #34d399;
}
.status-btn.err {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}

/* Tabs */
.nav-tabs-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: var(--radius-sm, 5px);
  padding: 4px;
  overflow-x: auto;
  flex-shrink: 0;
  min-height: 38px;
  scrollbar-width: thin;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--control-height-dense, 28px);
  padding: 5px 9px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-muted, #94a3b8);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #fff;
}

.tab-btn.active {
  background: #2563eb;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35);
}

.err-count-dot {
  font-size: 0.65rem;
  background: #ef4444;
  color: #fff;
  padding: 1px 5px;
  border-radius: 10px;
  font-weight: 700;
}

.tab-viewport {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--control-height-dense, 28px);
  padding: 5px 10px;
  border-radius: var(--radius-xs, 3px);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s;
}
.btn-primary { background: #2563eb; color: #fff; }
.btn-primary:hover { background: #1d4ed8; }

.btn-secondary { background: #334155; color: #fff; }
.btn-secondary:hover { background: #475569; }

/* Toast Notification */
.toast-box {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 500;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  z-index: 9999;
}
.toast-box.success {
  background: #064e3b;
  border: 1px solid #059669;
  color: #6ee7b7;
}
.toast-box.error {
  background: #7f1d1d;
  border: 1px solid #dc2626;
  color: #fca5a5;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
