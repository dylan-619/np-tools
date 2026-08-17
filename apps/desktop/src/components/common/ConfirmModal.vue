<script setup lang="ts">
import { ref, watch } from 'vue'
import { AlertTriangle, X } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title: string
    message: string
    dangerLevel?: 'normal' | 'high' | 'critical'
    confirmText?: string
    cancelText?: string
    requireTyping?: string
    countdownSeconds?: number
  }>(),
  {
    dangerLevel: 'normal',
    confirmText: '确认执行',
    cancelText: '取消',
    requireTyping: '',
    countdownSeconds: 0,
  }
)

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const typedText = ref('')
const remainingCountdown = ref(0)
let timer: number | null = null

watch(
  () => props.visible,
  (val) => {
    typedText.value = ''
    if (val && props.countdownSeconds > 0) {
      remainingCountdown.value = props.countdownSeconds
      if (timer) clearInterval(timer)
      timer = window.setInterval(() => {
        if (remainingCountdown.value > 0) {
          remainingCountdown.value--
        } else if (timer) {
          clearInterval(timer)
          timer = null
        }
      }, 1000)
    } else {
      remainingCountdown.value = 0
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
  },
  { immediate: true }
)

function isConfirmDisabled(): boolean {
  if (remainingCountdown.value > 0) return true
  if (props.requireTyping && typedText.value.trim() !== props.requireTyping) return true
  return false
}

function handleConfirm() {
  if (isConfirmDisabled()) return
  emit('confirm')
}

function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <div v-if="visible" class="modal-backdrop" @click.self="handleCancel">
    <div class="modal-card" :class="dangerLevel">
      <div class="modal-header">
        <div class="header-icon">
          <AlertTriangle :size="20" />
        </div>
        <h3>{{ title }}</h3>
        <button class="close-btn" @click="handleCancel">
          <X :size="16" />
        </button>
      </div>

      <div class="modal-body">
        <p class="modal-message">{{ message }}</p>

        <div v-if="requireTyping" class="typing-confirm-group">
          <label>请输入 <strong class="type-hint">{{ requireTyping }}</strong> 以确认高危操作：</label>
          <input
            v-model="typedText"
            type="text"
            :placeholder="`输入 ${requireTyping}`"
            class="typing-input"
            @keyup.enter="handleConfirm"
          />
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" @click="handleCancel">
          {{ cancelText }}
        </button>
        <button
          class="btn btn-danger"
          :class="{ 'btn-critical': dangerLevel === 'critical' }"
          :disabled="isConfirmDisabled()"
          @click="handleConfirm"
        >
          <span v-if="remainingCountdown > 0">{{ confirmText }} ({{ remainingCountdown }}s)</span>
          <span v-else>{{ confirmText }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal-card {
  width: 440px;
  max-width: 90vw;
  background-color: var(--bg-panel, #1a1d27);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 8px;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modal-in 0.15s ease-out;
}

@keyframes modal-in {
  from {
    transform: scale(0.95);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

.modal-card.critical {
  border-color: rgba(239, 68, 68, 0.5);
}

.modal-header {
  display: flex;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border, #2a2f42);
  gap: 10px;
}

.header-icon {
  color: #f59e0b;
  display: flex;
  align-items: center;
}

.modal-card.critical .header-icon {
  color: #ef4444;
}

.modal-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  flex: 1;
  color: var(--text-main, #e2e8f0);
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-muted, #94a3b8);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}
.close-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.modal-body {
  padding: 18px 16px;
  font-size: 0.88rem;
  color: var(--text-main, #e2e8f0);
  line-height: 1.5;
}

.modal-message {
  margin: 0 0 12px 0;
  color: #cbd5e1;
}

.typing-confirm-group {
  margin-top: 14px;
  background: rgba(0, 0, 0, 0.2);
  padding: 12px;
  border-radius: 6px;
  border: 1px dashed var(--border, #2a2f42);
}

.typing-confirm-group label {
  display: block;
  font-size: 0.8rem;
  color: var(--text-muted, #94a3b8);
  margin-bottom: 8px;
}

.type-hint {
  color: #ef4444;
  font-family: var(--font-mono, monospace);
}

.typing-input {
  width: 100%;
  padding: 8px 10px;
  background: var(--bg-input, #232736);
  border: 1px solid var(--border, #2a2f42);
  color: #fff;
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 0.9rem;
}
.typing-input:focus {
  border-color: #ef4444;
  outline: none;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.15);
  border-top: 1px solid var(--border, #2a2f42);
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s;
}

.btn-secondary {
  background: var(--bg-input, #232736);
  color: var(--text-main, #e2e8f0);
  border-color: var(--border, #2a2f42);
}
.btn-secondary:hover {
  background: #2e3448;
}

.btn-danger {
  background: #ef4444;
  color: #fff;
}
.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-critical {
  background: #b91c1c;
}
.btn-critical:hover:not(:disabled) {
  background: #991b1b;
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
