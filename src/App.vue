<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from './components/layout/AppSidebar.vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSerialStore } from './stores/serialStore'
import { useSjzdStore } from './stores/sjzdStore'
import { CheckCircle2, AlertTriangle, X } from 'lucide-vue-next'

const route = useRoute()
const serial = useSerialStore()
const sjzd = useSjzdStore()

const currentTitle = computed(() => {
  return (route.meta?.title as string) || 'NP-Tools 硬件调试平台'
})

const activeToast = ref<{ success: boolean; text: string } | null>(null)
let toastTimer: number | null = null

watch(
  () => sjzd.lastOpMessage,
  (msg) => {
    if (msg) {
      activeToast.value = { success: msg.success, text: msg.text }
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = window.setTimeout(() => {
        activeToast.value = null
      }, 3500)
    }
  }
)

function dismissToast() {
  activeToast.value = null
  if (toastTimer) clearTimeout(toastTimer)
}

async function handleTitlebarMouseDown(e: MouseEvent) {
  if (e.button === 0) {
    const target = e.target as HTMLElement
    if (
      target &&
      (target.tagName === 'BUTTON' ||
        target.closest('button') ||
        target.tagName === 'INPUT' ||
        target.closest('.no-drag'))
    ) {
      return
    }
    try {
      await getCurrentWindow().startDragging()
    } catch (err) {
      console.error('startDragging 失败:', err)
    }
  }
}

async function handleTitlebarDblClick() {
  try {
    const win = getCurrentWindow()
    const isMax = await win.isMaximized()
    if (isMax) {
      await win.unmaximize()
    } else {
      await win.maximize()
    }
  } catch (err) {
    console.error('窗口最大化切换失败:', err)
  }
}
</script>

<template>
  <div class="app-layout">
    <!-- Top Dedicated Full-Width Window Titlebar / Drag Strip -->
    <header
      class="app-top-drag-bar"
      data-tauri-drag-region
      @mousedown="handleTitlebarMouseDown"
      @dblclick="handleTitlebarDblClick"
    >
      <!-- macOS traffic lights space placeholder (approx 74px) -->
      <div class="mac-traffic-lights-spacer" data-tauri-drag-region />

      <!-- Left App Branding & Route Breadcrumb -->
      <div class="titlebar-left" data-tauri-drag-region>
        <div class="brand-badge" data-tauri-drag-region>
          <img src="./assets/app-icon.png" alt="Logo" class="brand-mini-icon" data-tauri-drag-region />
          <span class="brand-text" data-tauri-drag-region>NP-Tools</span>
          <span class="brand-version" data-tauri-drag-region>v2.0</span>
        </div>
        <div class="titlebar-sep" data-tauri-drag-region />
        <div class="route-badge" data-tauri-drag-region>
          <span class="route-name" data-tauri-drag-region>{{ currentTitle }}</span>
        </div>
      </div>

      <!-- Center Wide Draggable Area -->
      <div class="titlebar-drag-spacer" data-tauri-drag-region />

      <!-- Right Connection Status Badge -->
      <div class="titlebar-right" data-tauri-drag-region>
        <div
          class="top-port-badge"
          :class="{ connected: !!serial.connectedPort }"
          :title="serial.connectedPort ? `已连接硬件串口: ${serial.connectedPort}` : '硬件串口未连接'"
        >
          <span class="badge-dot" />
          <span class="port-label">
            {{ serial.connectedPort ? serial.connectedPort.replace('/dev/', '') : '未连接硬件串口' }}
          </span>
        </div>
      </div>
    </header>

    <!-- App Body Container below Top Titlebar -->
    <div class="app-body-container">
      <!-- Left Product Line & Global Serial Sidebar -->
      <AppSidebar />

      <!-- Right Main Content Area -->
      <div class="main-wrapper">
        <!-- Global Floating Toast Notification Bar -->
        <transition name="toast-slide">
          <div
            v-if="activeToast"
            class="global-toast-container"
            :class="{ success: activeToast.success, error: !activeToast.success }"
          >
            <div class="toast-content">
              <CheckCircle2 v-if="activeToast.success" :size="16" class="toast-icon" />
              <AlertTriangle v-else :size="16" class="toast-icon" />
              <span class="toast-text">{{ activeToast.text }}</span>
            </div>
            <button class="toast-close-btn" @click="dismissToast">
              <X :size="13" />
            </button>
          </div>
        </transition>

        <!-- View Routed Content -->
        <main class="view-content-area">
          <router-view v-slot="{ Component }">
            <transition name="fade-slide" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </main>
      </div>
    </div>
  </div>
</template>

<style>
/* Global CSS variables & Reset */
:root {
  --bg-app: var(--color-canvas);
  --bg-panel: var(--color-surface-1);
  --bg-input: var(--color-surface-2);
  --bg-hover: var(--color-surface-3);
  --text-main: var(--color-text-primary);
  --text-muted: var(--color-text-secondary);
  --border: var(--color-border-default);
  --accent: var(--color-accent);
  --accent-hover: var(--color-accent-hover);
  --success: var(--color-success);
  --danger: var(--color-danger);
  --danger-hover: #c94747;
}

html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  background-color: var(--color-canvas);
  color: var(--text-main);
  font-family: var(--font-sans);
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
}

* {
  box-sizing: border-box;
}

/* Custom Scrollbar */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: var(--bg-app);
}
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  position: relative;
  background-color: var(--bg-app);
}

.app-top-drag-bar {
  height: 34px;
  background: var(--color-surface-1);
  border-bottom: 1px solid var(--color-border-subtle);
  display: flex;
  align-items: center;
  padding: 0 16px;
  user-select: none;
  -webkit-user-select: none;
  -webkit-app-region: drag;
  app-region: drag;
  cursor: grab;
  flex-shrink: 0;
  z-index: 100;
}
.app-top-drag-bar:active {
  cursor: grabbing;
}

.no-drag,
.top-port-badge,
button,
input,
select {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.mac-traffic-lights-spacer {
  width: 62px;
  flex-shrink: 0;
  height: 100%;
}

.titlebar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100%;
}

.brand-badge {
  display: flex;
  align-items: center;
  gap: 6px;
}

.brand-mini-icon {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}

.brand-text {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-main, #e2e8f0);
  letter-spacing: 0.02em;
}

.brand-version {
  font-size: 0.65rem;
  font-family: var(--font-mono, monospace);
  color: var(--color-info);
  background: rgba(74, 163, 255, 0.12);
  padding: 1px 4px;
  border-radius: 3px;
}

.titlebar-sep {
  width: 1px;
  height: 14px;
  background: var(--color-border-default);
}

.route-badge {
  display: flex;
  align-items: center;
}

.route-name {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-muted, #94a3b8);
}

.titlebar-drag-spacer {
  flex: 1;
  height: 100%;
  min-width: 20px;
}

.titlebar-right {
  display: flex;
  align-items: center;
  height: 100%;
}

.top-port-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  font-family: var(--font-mono, monospace);
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-secondary);
  transition: all 0.2s ease;
}
.top-port-badge.connected {
  background: rgba(56, 178, 118, 0.12);
  border-color: rgba(56, 178, 118, 0.36);
  color: var(--color-success);
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--color-text-tertiary);
}
.top-port-badge.connected .badge-dot {
  background-color: var(--color-success);
}

.app-body-container {
  flex: 1;
  display: flex;
  overflow: hidden;
  height: calc(100vh - 34px);
  width: 100%;
}

.main-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  background: var(--bg-app);
  position: relative;
  overflow: hidden;
}

/* Global Floating Toast */
.global-toast-container {
  position: fixed;
  top: 46px;
  right: 16px;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.34);
  font-size: 0.82rem;
  font-weight: 500;
  backdrop-filter: blur(12px);
  border: 1px solid transparent;
}
.global-toast-container.success {
  background: #154634;
  border-color: rgba(56, 178, 118, 0.48);
  color: var(--color-text-primary);
}
.global-toast-container.error {
  background: #4a2426;
  border-color: rgba(223, 91, 91, 0.5);
  color: var(--color-text-primary);
}

.toast-content {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toast-close-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
}
.toast-close-btn:hover {
  color: #fff;
}

.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.toast-slide-enter-from,
.toast-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.view-content-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  scrollbar-gutter: stable;
}

/* Page transitions */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.15s ease-out;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Polished Native Select & Form Control Styles */
select,
.form-select {
  appearance: none;
  -webkit-appearance: none;
  background-color: var(--bg-input, #232736);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 14px;
  border: 1px solid var(--border, #2a2f42);
  border-radius: 6px;
  color: var(--text-main, #e2e8f0);
  padding: 7px 32px 7px 10px;
  font-size: 0.84rem;
  outline: none;
  transition: all 0.18s ease;
  cursor: pointer;
}

select:hover:not(:disabled),
.form-select:hover:not(:disabled) {
  border-color: var(--color-accent);
  background-color: var(--color-surface-3);
}

select:focus,
.form-select:focus {
  border-color: var(--color-focus-ring);
  box-shadow: 0 0 0 2px rgba(121, 169, 255, 0.22);
}

select:disabled,
.form-select:disabled {
  background: var(--color-surface-1);
  border-color: var(--color-border-subtle);
  color: var(--color-text-disabled);
  opacity: 1;
  cursor: not-allowed;
}

select option {
  background-color: var(--color-surface-2);
  color: var(--color-text-primary);
  padding: 8px;
}
</style>
