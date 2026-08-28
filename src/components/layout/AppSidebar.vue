<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { useRoute, useRouter } from 'vue-router'
import {
  TerminalSquare,
  Cpu,
  Radio,
  TableProperties,
  Activity,
  Wrench,
  Flame,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-vue-next'
import GlobalSerialBar from './GlobalSerialBar.vue'

const route = useRoute()
const router = useRouter()
const collapsed = ref(false)
const { width } = useWindowSize()
const isCompact = computed(() => collapsed.value || width.value <= 960)

function navigateTo(path: string) {
  router.push(path)
}
</script>

<template>
  <aside class="app-sidebar" :class="{ collapsed: isCompact }">
    <div class="sidebar-header">
      <span v-if="!isCompact" class="workspace-label">工作区</span>
      <button
        class="sidebar-collapse-btn"
        :title="isCompact ? '展开导航栏' : '折叠导航栏'"
        :aria-label="isCompact ? '展开导航栏' : '折叠导航栏'"
        @click="collapsed = !collapsed"
      >
        <PanelLeftOpen v-if="isCompact" :size="16" />
        <PanelLeftClose v-else :size="16" />
      </button>
    </div>

    <!-- Navigation Scroll Area -->
    <div class="nav-scroll-area">
      <!-- Section 1: Smart Data Terminal -->
      <div class="nav-group">
        <div v-if="!isCompact" class="group-label">
          <span>智能采集终端</span>
          <span class="tag-badge">主线产品</span>
        </div>

        <nav class="nav-list">
          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3' }"
            aria-label="设备信息与 SN 烧录"
            title="设备信息与 SN 烧录"
            @click="navigateTo('/devices/sjzdv3')"
          >
            <Cpu :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">设备信息 & SN 烧录</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/sle' }"
            aria-label="星闪 SLE 无线配置"
            title="星闪 SLE 无线配置"
            @click="navigateTo('/devices/sjzdv3/sle')"
          >
            <Radio :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">星闪 (SLE) 无线配置</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/modbus' }"
            aria-label="Modbus 点位管理"
            title="Modbus 点位管理"
            @click="navigateTo('/devices/sjzdv3/modbus')"
          >
            <TableProperties :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">Modbus 点位管理</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/dashboard' }"
            aria-label="实时数据与硬件监测"
            title="实时数据与硬件监测"
            @click="navigateTo('/devices/sjzdv3/dashboard')"
          >
            <Activity :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">实时数据与硬件监测</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/maintenance' }"
            aria-label="系统维护与 EEPROM"
            title="系统维护与 EEPROM"
            @click="navigateTo('/devices/sjzdv3/maintenance')"
          >
            <Wrench :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">系统维护 & EEPROM</span>
          </button>
        </nav>
      </div>

      <!-- Section 2: Smart Controller I/O Tool -->
      <div class="nav-group">
        <div v-if="!isCompact" class="group-label">
          <span>智能控制器 (KZ3)</span>
          <span class="tag-badge-purple">工艺组态</span>
        </div>
        <nav class="nav-list">
          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/controller' }"
            aria-label="I/O 可视化配置工作台"
            title="I/O 可视化配置工作台"
            @click="navigateTo('/devices/controller')"
          >
            <Cpu :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">I/O 可视化配置工作台</span>
          </button>
        </nav>
      </div>

      <!-- Section 3: Universal Tools -->
      <div class="nav-group">
        <div v-if="!isCompact" class="group-label">
          <span>公共工具</span>
        </div>
        <nav class="nav-list">
          <button
            class="nav-item"
            :class="{ active: route.path === '/serial' }"
            aria-label="通用串口监视器"
            title="通用串口监视器"
            @click="navigateTo('/serial')"
          >
            <TerminalSquare :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">通用串口监视器</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/flashing' }"
            aria-label="ST-Link 固件烧录"
            title="ST-Link 固件烧录"
            @click="navigateTo('/flashing')"
          >
            <Flame :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">ST-Link 固件烧录</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/settings' }"
            aria-label="应用设置"
            title="应用设置"
            @click="navigateTo('/settings')"
          >
            <Settings :size="16" class="nav-icon" />
            <span v-if="!isCompact" class="nav-text">应用设置</span>
          </button>
        </nav>
      </div>
    </div>

    <!-- Bottom Global Serial Connection Box -->
    <div class="sidebar-footer">
      <GlobalSerialBar :compact="isCompact" />
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  width: 220px;
  background-color: var(--bg-panel, #1a1d27);
  border-right: 1px solid var(--border, #2a2f42);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  height: 100%;
  transition: width 0.18s ease;
}

.app-sidebar.collapsed {
  width: 52px;
}

.sidebar-header {
  min-height: 38px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border, #2a2f42);
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.workspace-label {
  color: var(--color-text-tertiary, #718391);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sidebar-collapse-btn {
  width: 28px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-xs, 3px);
  color: var(--text-muted, #a8b6c2);
  background: transparent;
  cursor: pointer;
}

.sidebar-collapse-btn:hover {
  background: var(--bg-hover, #1d2a35);
  border-color: var(--border, #31424f);
  color: var(--text-main, #e6edf3);
}

.nav-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-label {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted, #94a3b8);
  padding: 4px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tag-badge {
  font-size: 0.6rem;
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  padding: 1px 4px;
  border-radius: 4px;
  font-weight: normal;
}

.tag-badge-purple {
  font-size: 0.6rem;
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
  padding: 1px 4px;
  border-radius: 4px;
  font-weight: normal;
}

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 7px 8px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-main, #cbd5e1);
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
  width: 100%;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #fff;
}

.nav-item.active {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.3);
  color: #60a5fa;
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--accent, #3b82f6);
}

.nav-icon {
  color: var(--text-muted, #94a3b8);
  flex-shrink: 0;
  transition: color 0.15s;
}
.nav-item.active .nav-icon {
  color: #3b82f6;
}

.nav-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.coming-soon-pill {
  font-size: 0.62rem;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-muted, #94a3b8);
  padding: 1px 5px;
  border-radius: 10px;
}

.sidebar-footer {
  padding: 8px;
  border-top: 1px solid var(--border, #2a2f42);
  background: var(--color-canvas, #0b1016);
}

.app-sidebar.collapsed .sidebar-header,
.app-sidebar.collapsed .nav-item {
  justify-content: center;
}

.app-sidebar.collapsed .nav-item {
  padding-inline: 0;
}

.app-sidebar.collapsed .nav-scroll-area {
  padding-inline: 6px;
  gap: 10px;
}

.app-sidebar.collapsed .nav-group {
  gap: 2px;
}

@media (max-width: 960px) {
  .app-sidebar {
    width: 52px;
  }

  .workspace-label,
  .group-label,
  .nav-text {
    display: none;
  }

  .sidebar-header,
  .nav-item {
    justify-content: center;
  }

  .nav-item {
    padding-inline: 0;
  }
}
</style>
