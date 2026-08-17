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

function startDrag() {
  getCurrentWindow().startDragging()
}
</script>

<template>
  <div class="app-layout">
    <!-- Left Product Line & Global Serial Sidebar -->
    <AppSidebar />

    <!-- Right Main Content Area -->
    <div class="main-wrapper">
      <!-- Title Drag Bar -->
      <header class="app-header" @mousedown="startDrag">
        <div class="header-breadcrumb" @mousedown.stop>
          <span class="route-title">{{ currentTitle }}</span>
        </div>

        <div class="header-right-status" @mousedown.stop>
          <div class="port-status-badge" :class="{ connected: !!serial.connectedPort }">
            <span class="badge-dot" />
            <span>{{ serial.connectedPort ? `串口: ${serial.connectedPort.replace('/dev/', '')}` : '未连接硬件串口' }}</span>
          </div>
        </div>
      </header>

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
</template>

<style>
/* Global CSS variables & Reset */
:root {
  --bg-app: #0f111a;
  --bg-panel: #1a1d27;
  --bg-input: #232736;
  --bg-hover: #2a2f42;
  --text-main: #e2e8f0;
  --text-muted: #94a3b8;
  --border: #2a2f42;

  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --success: #10b981;
  --danger: #ef4444;
  --danger-hover: #dc2626;

  --radius: 6px;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
}

html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  background-color: var(--bg-app);
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
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  position: relative;
}

.main-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  background: var(--bg-app);
  position: relative;
}

.app-header {
  height: 48px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  cursor: grab;
  flex-shrink: 0;
}
.app-header:active {
  cursor: grabbing;
}

.route-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-main);
}

.header-right-status {
  display: flex;
  align-items: center;
}

.port-status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-family: var(--font-mono);
  padding: 3px 10px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.port-status-badge.connected {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.3);
  color: #34d399;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--text-muted);
}
.port-status-badge.connected .badge-dot {
  background-color: var(--success);
  box-shadow: 0 0 6px var(--success);
}

/* Global Floating Toast */
.global-toast-container {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  border-radius: 20px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  font-size: 0.82rem;
  font-weight: 500;
  backdrop-filter: blur(12px);
  border: 1px solid transparent;
}
.global-toast-container.success {
  background: rgba(16, 185, 129, 0.9);
  color: #ffffff;
}
.global-toast-container.error {
  background: rgba(239, 68, 68, 0.9);
  color: #ffffff;
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
  transform: translate(-50%, -16px);
}

.view-content-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
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
</style>