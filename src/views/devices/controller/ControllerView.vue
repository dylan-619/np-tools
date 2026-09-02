<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
  Activity,
  ArrowLeft,
  LayoutDashboard
} from 'lucide-vue-next'
import { useControllerStore } from '../../../stores/controllerStore'
import ProjectOverviewTab from './ProjectOverviewTab.vue'
import HardwareSouthboundTab from './HardwareSouthboundTab.vue'
import PointsTableTab from './PointsTableTab.vue'
import VariablesLogicTab from './VariablesLogicTab.vue'
import NorthboundTab from './NorthboundTab.vue'
import YamlDiagnosisTab from './YamlDiagnosisTab.vue'
import OnlineDebugTab from './OnlineDebugTab.vue'

const controller = useControllerStore()
const route = useRoute()
const router = useRouter()
const isDebugMode = computed(() => route.name === 'ControllerDebug')

watch(
  isDebugMode,
  (enabled) => {
    if (enabled) controller.activeTab = 'debug'
    else if (controller.activeTab === 'debug') controller.activeTab = 'overview'
  },
  { immediate: true }
)

function enterDebugMode() {
  router.push({ name: 'ControllerDebug' })
}

function enterMonitorMode() {
  router.push({ name: 'ControllerMonitor' })
}

function leaveDebugMode() {
  router.push({ name: 'ControllerProduct' })
}
</script>

<template>
  <div class="controller-view-container" :class="{ 'debug-mode': isDebugMode }">
    <template v-if="isDebugMode">
      <header class="debug-mode-header">
        <button class="mode-back-btn" @click="leaveDebugMode">
          <ArrowLeft :size="14" /> 返回工程组态
        </button>
        <div class="debug-project-identity">
          <strong :title="controller.doc.project.name || '未命名工程'">{{ controller.doc.project.name || '未命名工程' }}</strong>
          <code :title="`${controller.doc.project.id}@${controller.doc.project.version}`">{{ controller.doc.project.id }}@{{ controller.doc.project.version }}</code>
        </div>
        <span class="mode-safety-badge"><Activity :size="13" /> 在线调试 · 写入需解锁</span>
      </header>
      <main class="tab-viewport debug-viewport">
        <OnlineDebugTab />
      </main>
    </template>

    <template v-else>
      <!-- Header Topbar -->
      <header class="controller-header">
        <div class="header-left-box">
          <div class="header-icon-box">
            <Cpu :size="22" />
          </div>
          <div class="header-title-col">
            <div class="title-row">
              <h1 class="main-title">KZ3 工艺项目 I/O 可视化配置工作台</h1>
              <span class="project-tag" :title="controller.doc.project.name || '未命名工程'">{{ controller.doc.project.name || '未命名工程' }}</span>
              <span class="version-tag">v{{ controller.doc.project.version }}</span>
            </div>
            <p class="sub-desc">
              面向 PLC / 工艺工程师的 I/O 组态、北向契约配置与受控在线调试工作台
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
            <span>{{
              controller.errorCount > 0 ? `${controller.errorCount} 处错误需修复` : '工程校验通过'
            }}</span>
          </button>

          <button class="btn btn-secondary" @click="controller.importYamlFile()">
            <FolderOpen :size="15" />
            <span>导入 YAML</span>
          </button>

          <button class="btn btn-primary" @click="controller.exportYamlFile()">
            <Save :size="15" />
            <span>导出 YAML</span>
          </button>

          <button class="btn btn-monitor" @click="enterMonitorMode">
            <LayoutDashboard :size="15" />
            <span>可视化监测</span>
          </button>

          <button class="btn btn-commissioning" @click="enterDebugMode">
            <Activity :size="15" />
            <span>进入在线调试</span>
          </button>
        </div>
      </header>

      <!-- Navigation Tabs Bar -->
      <nav class="nav-tabs-bar">
        <button
          class="tab-btn"
          :class="{ active: controller.activeTab === 'overview' }"
          title="步骤 1：项目总览"
          :aria-current="controller.activeTab === 'overview' ? 'step' : undefined"
          @click="controller.activeTab = 'overview'"
        >
          <Cpu :size="15" />
          <span>1. 项目总览</span>
        </button>

        <button
          class="tab-btn"
          :class="{ active: controller.activeTab === 'hardware' }"
          title="步骤 2：硬件拓扑与南向设备"
          :aria-current="controller.activeTab === 'hardware' ? 'step' : undefined"
          @click="controller.activeTab = 'hardware'"
        >
          <Layers :size="15" />
          <span>2. 硬件组态</span>
          <span class="tab-count">{{ controller.doc.project.devices.length }}</span>
        </button>

        <button
          class="tab-btn"
          :class="{ active: controller.activeTab === 'points' }"
          title="步骤 3：I/O 业务点表"
          :aria-current="controller.activeTab === 'points' ? 'step' : undefined"
          @click="controller.activeTab = 'points'"
        >
          <TableProperties :size="15" />
          <span>3. I/O 点表</span>
          <span class="tab-count">
            {{
              controller.doc.project.points.inputs.length +
                controller.doc.project.points.outputs.length
            }}
          </span>
        </button>

        <button
          class="tab-btn"
          :class="{ active: controller.activeTab === 'variables' }"
          title="步骤 4：应用变量与逻辑"
          :aria-current="controller.activeTab === 'variables' ? 'step' : undefined"
          @click="controller.activeTab = 'variables'"
        >
          <Sliders :size="15" />
          <span>4. 变量逻辑</span>
          <span class="tab-count">
            {{
              controller.doc.project.application_variables.parameters.length +
                controller.doc.project.application_variables.commands.length +
                controller.doc.project.application_variables.states.length +
                controller.doc.project.pids.length
            }}
          </span>
        </button>

        <button
          class="tab-btn"
          :class="{ active: controller.activeTab === 'northbound' }"
          title="步骤 5：北向通信映射"
          :aria-current="controller.activeTab === 'northbound' ? 'step' : undefined"
          @click="controller.activeTab = 'northbound'"
        >
          <Network :size="15" />
          <span>5. 北向映射</span>
          <span class="tab-count">{{ controller.doc.project.northbound.fields.length }}</span>
        </button>

        <button
          class="tab-btn"
          :class="{ active: controller.activeTab === 'yaml' }"
          title="步骤 6：YAML 预览与工程检查"
          :aria-current="controller.activeTab === 'yaml' ? 'step' : undefined"
          @click="controller.activeTab = 'yaml'"
        >
          <FileCode :size="15" />
          <span>6. 工程检查</span>
          <span v-if="controller.errorCount > 0" class="err-count-dot">{{
            controller.errorCount
          }}</span>
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
    </template>

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
  background: var(--color-canvas, #edf1f4);
  padding: 12px;
  gap: 8px;
  position: relative;
}

.controller-view-container.debug-mode {
  padding: 8px;
  gap: 6px;
  background: #eef2f5;
}

.debug-mode-header {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 7px;
  border: 1px solid #b9c5cf;
  border-radius: 4px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(27, 45, 58, 0.08);
  flex-shrink: 0;
}

.mode-back-btn {
  height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: 1px solid #aebcc7;
  border-radius: 3px;
  background: #f7f9fa;
  color: #284354;
  cursor: pointer;
  font-size: 11px;
  font-weight: 650;
}

.mode-back-btn:hover {
  border-color: #6e94ad;
  background: #edf4f8;
}

.mode-back-btn:focus-visible {
  outline: 2px solid #2f82c4;
  outline-offset: 1px;
}

.debug-project-identity {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.debug-project-identity strong {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #17212b;
  font-size: 12px;
}

.debug-project-identity code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #516675;
  font-size: 10px;
}

.mode-safety-badge {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #126b45;
  font-size: 10px;
  font-weight: 700;
}

.debug-viewport {
  padding-right: 0;
  overflow: hidden;
}

/* Header */
.controller-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
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
  color: var(--color-info, #0f5f9e);
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
  color: var(--text-main, #17212b);
  margin: 0;
}

.project-tag {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(59, 130, 246, 0.15);
  color: #0f5f9e;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.version-tag {
  font-size: 0.7rem;
  font-family: monospace;
  background: #eef3f7;
  color: var(--text-muted, #40515f);
  padding: 2px 6px;
  border-radius: 4px;
}

.sub-desc {
  font-size: 0.72rem;
  color: var(--text-muted, #40515f);
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
  color: #176b45;
}
.status-btn.err {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
  color: #a12d34;
}

/* Tabs */
.nav-tabs-bar {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  align-items: center;
  gap: 4px;
  background: var(--bg-panel, #ffffff);
  border: 1px solid var(--border, #b9c5cf);
  border-radius: var(--radius-sm, 5px);
  padding: 4px;
  flex-shrink: 0;
  min-height: 38px;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  min-height: var(--control-height-dense, 28px);
  padding: 5px 9px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-muted, #40515f);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  transition: all 0.15s ease;
}

.tab-btn > span:not(.tab-count):not(.err-count-dot) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-btn:hover {
  background: #eef3f7;
  color: #17212b;
}

.tab-btn.active {
  background: #1769aa;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35);
}

.tab-count {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 9px;
  background: #e7edf2;
  color: #40515f;
  font-family: var(--font-mono, monospace);
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1.3;
}

.tab-btn.active .tab-count {
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.err-count-dot {
  font-size: 0.65rem;
  background: #a12d34;
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
.btn-primary {
  background: #1769aa;
  color: #fff;
}
.btn-primary:hover {
  background: #0e568e;
}

.btn-secondary {
  background: #e8edf2;
  color: #263b4a;
  border-color: #b9c5cf;
}
.btn-secondary:hover {
  background: #dbe4ea;
  border-color: #8fa2b0;
}

.btn-commissioning {
  background: #176b63;
  border-color: #176b63;
  color: #ffffff;
  font-weight: 650;
}

.btn-monitor {
  background: #e7f1fa;
  border-color: #9fc1dc;
  color: #0f5f9e;
  font-weight: 650;
}

.btn-monitor:hover {
  background: #d8eaf7;
  border-color: #79aacf;
}

.btn-commissioning:hover {
  background: #115850;
  border-color: #115850;
}

@media (max-width: 960px) {
  .tab-btn {
    gap: 4px;
    padding-inline: 5px;
    font-size: 0.75rem;
  }

  .tab-btn svg {
    display: none;
  }
}

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
  box-shadow: 0 8px 24px rgba(27, 45, 58, 0.2);
  z-index: 9999;
}
.toast-box.success {
  background: #e7f5ed;
  border: 1px solid #8bc5a8;
  color: #0f6941;
}
.toast-box.error {
  background: #fdebed;
  border: 1px solid #d58b90;
  color: #8f2028;
}

.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.25s,
    transform 0.25s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
