<script setup lang="ts">
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
  Gamepad2,
} from 'lucide-vue-next'
import GlobalSerialBar from './GlobalSerialBar.vue'

const route = useRoute()
const router = useRouter()

function navigateTo(path: string) {
  router.push(path)
}
</script>

<template>
  <aside class="app-sidebar">
    <!-- Header Brand -->
    <div class="sidebar-header" data-tauri-drag-region>
      <div class="logo-wrapper">
        <img src="../../assets/app-icon.png" alt="App Logo" class="brand-logo-img" />
        <div class="brand-text">
          <span class="app-title">NP-Tools</span>
          <span class="app-subtitle">硬件调试平台 v2.0</span>
        </div>
      </div>
    </div>

    <!-- Navigation Scroll Area -->
    <div class="nav-scroll-area">
      <!-- Section 1: Smart Data Terminal -->
      <div class="nav-group">
        <div class="group-label">
          <span>智能采集终端</span>
          <span class="tag-badge">主线产品</span>
        </div>

        <nav class="nav-list">
          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3' }"
            @click="navigateTo('/devices/sjzdv3')"
          >
            <Cpu :size="16" class="nav-icon" />
            <span class="nav-text">设备信息 & SN 烧录</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/sle' }"
            @click="navigateTo('/devices/sjzdv3/sle')"
          >
            <Radio :size="16" class="nav-icon" />
            <span class="nav-text">星闪 (SLE) 无线配置</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/modbus' }"
            @click="navigateTo('/devices/sjzdv3/modbus')"
          >
            <TableProperties :size="16" class="nav-icon" />
            <span class="nav-text">Modbus 点位管理</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/dashboard' }"
            @click="navigateTo('/devices/sjzdv3/dashboard')"
          >
            <Activity :size="16" class="nav-icon" />
            <span class="nav-text">实时数据与硬件监测</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/devices/sjzdv3/maintenance' }"
            @click="navigateTo('/devices/sjzdv3/maintenance')"
          >
            <Wrench :size="16" class="nav-icon" />
            <span class="nav-text">系统维护 & EEPROM</span>
          </button>
        </nav>
      </div>

      <!-- Section 2: Controller Placeholder -->
      <div class="nav-group">
        <div class="group-label">
          <span>智能控制器</span>
        </div>
        <nav class="nav-list">
          <button
            class="nav-item disabled-preview"
            :class="{ active: route.path === '/devices/controller' }"
            @click="navigateTo('/devices/controller')"
          >
            <Gamepad2 :size="16" class="nav-icon" />
            <span class="nav-text">控制器调试</span>
            <span class="coming-soon-pill">规划中</span>
          </button>
        </nav>
      </div>

      <!-- Section 3: Universal Tools -->
      <div class="nav-group">
        <div class="group-label">
          <span>公共工具</span>
        </div>
        <nav class="nav-list">
          <button
            class="nav-item"
            :class="{ active: route.path === '/serial' }"
            @click="navigateTo('/serial')"
          >
            <TerminalSquare :size="16" class="nav-icon" />
            <span class="nav-text">通用串口监视器</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/flashing' }"
            @click="navigateTo('/flashing')"
          >
            <Flame :size="16" class="nav-icon" />
            <span class="nav-text">ST-Link 固件烧录</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: route.path === '/settings' }"
            @click="navigateTo('/settings')"
          >
            <Settings :size="16" class="nav-icon" />
            <span class="nav-text">应用设置</span>
          </button>
        </nav>
      </div>
    </div>

    <!-- Bottom Global Serial Connection Box -->
    <div class="sidebar-footer">
      <GlobalSerialBar />
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  width: 250px;
  background-color: var(--bg-panel, #1a1d27);
  border-right: 1px solid var(--border, #2a2f42);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  height: 100%;
}

.sidebar-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border, #2a2f42);
  user-select: none;
}

.logo-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-logo-img {
  width: 34px;
  height: 34px;
  object-fit: contain;
  filter: drop-shadow(0 2px 8px rgba(59, 130, 246, 0.4));
}

.logo-box {
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.app-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-main, #e2e8f0);
  letter-spacing: 0.02em;
}

.app-subtitle {
  font-size: 0.7rem;
  color: var(--text-muted, #94a3b8);
}

.nav-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
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
  padding: 10px;
  border-top: 1px solid var(--border, #2a2f42);
  background: rgba(0, 0, 0, 0.1);
}
</style>
