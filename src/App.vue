<script setup lang="ts">
import { ref, watch } from 'vue'
import AppSidebar from './components/layout/AppSidebar.vue'
import { useSjzdStore } from './stores/sjzdStore'
import { CheckCircle2, AlertTriangle, X } from 'lucide-vue-next'

const sjzd = useSjzdStore()

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

</script>

<template>
  <div class="app-layout">
    <!-- 使用系统原生标题栏：macOS 红黄绿按钮 / Windows 最小化、最大化与关闭按钮。 -->
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
  --danger-hover: #84242a;
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

button,
input,
select {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

input:not([type='checkbox']):not([type='radio']),
textarea {
  color: var(--color-text-primary) !important;
}

input:not([type='checkbox']):not([type='radio'])::placeholder,
textarea::placeholder {
  color: var(--color-text-tertiary) !important;
  opacity: 1;
}

input:not([type='checkbox']):not([type='radio']):disabled,
textarea:disabled {
  color: var(--color-text-disabled) !important;
  -webkit-text-fill-color: var(--color-text-disabled);
  opacity: 1;
}

.app-body-container {
  flex: 1;
  display: flex;
  overflow: hidden;
  height: 100%;
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
  box-shadow: 0 10px 28px rgba(27, 45, 58, 0.18);
  font-size: 0.82rem;
  font-weight: 500;
  backdrop-filter: blur(12px);
  border: 1px solid transparent;
}
.global-toast-container.success {
  background: #e7f5ed;
  border-color: #8bc5a8;
  color: #0f5f9e;
}
.global-toast-container.error {
  background: #fdebed;
  border-color: #d58b90;
  color: #8f2028;
}

.toast-content {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toast-close-btn {
  background: transparent;
  border: none;
  color: currentColor;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
}
.toast-close-btn:hover {
  color: var(--color-text-primary);
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
  background-color: var(--bg-input, #f7f9fb);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2340515f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 14px;
  border: 1px solid var(--border, #b9c5cf);
  border-radius: 6px;
  color: var(--text-main, #17212b);
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
