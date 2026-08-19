<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown, Check } from 'lucide-vue-next'

export interface SelectOption {
  label: string
  value: any
  disabled?: boolean
  hint?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: any
    options: Array<SelectOption | string | number>
    placeholder?: string
    disabled?: boolean
    size?: 'sm' | 'md' | 'lg'
    mono?: boolean
    placement?: 'bottom' | 'top' | 'auto'
    minDropdownWidth?: number
    clearable?: boolean
  }>(),
  {
    placeholder: '请选择...',
    disabled: false,
    size: 'md',
    mono: false,
    placement: 'auto',
    minDropdownWidth: 0,
    clearable: false,
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: any): void
  (e: 'change', value: any): void
}>()

const isOpen = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const highlightedIndex = ref(-1)

const normalizedOptions = computed<SelectOption[]>(() => {
  return (props.options || []).map((opt) => {
    if (typeof opt === 'object' && opt !== null && 'value' in opt) {
      return {
        label: opt.label !== undefined ? String(opt.label) : String(opt.value),
        value: opt.value,
        disabled: !!opt.disabled,
        hint: opt.hint,
      }
    }
    return {
      label: String(opt),
      value: opt,
      disabled: false,
    }
  })
})

const selectedOption = computed(() => {
  return normalizedOptions.value.find((opt) => opt.value === props.modelValue)
})

const displayLabel = computed(() => {
  if (selectedOption.value) {
    return selectedOption.value.label
  }
  return ''
})

const triggerRect = ref<{
  top: number
  bottom: number
  left: number
  right: number
  width: number
} | null>(null)

const isPlacementUp = ref(false)

function updatePosition() {
  if (!triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  triggerRect.value = {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    width: rect.width,
  }

  const spaceBelow = window.innerHeight - rect.bottom
  const spaceAbove = rect.top
  if (props.placement === 'top') {
    isPlacementUp.value = true
  } else if (props.placement === 'bottom') {
    isPlacementUp.value = false
  } else {
    // auto: if space below < 200 and space above > space below, flip up
    isPlacementUp.value = spaceBelow < 200 && spaceAbove > spaceBelow
  }
}

const dropdownStyle = computed(() => {
  if (!triggerRect.value) return {}
  const { top, bottom, left, width } = triggerRect.value
  const targetWidth = Math.max(width, props.minDropdownWidth || width)

  return {
    position: 'fixed' as const,
    left: `${left}px`,
    width: `${targetWidth}px`,
    minWidth: `${targetWidth}px`,
    maxWidth: 'calc(100vw - 24px)',
    zIndex: 99999,
    top: isPlacementUp.value ? 'auto' : `${bottom + 4}px`,
    bottom: isPlacementUp.value ? `${window.innerHeight - top + 4}px` : 'auto',
  }
})

function toggleDropdown() {
  if (props.disabled) return
  if (isOpen.value) {
    closeDropdown()
  } else {
    openDropdown()
  }
}

function openDropdown() {
  if (props.disabled) return
  updatePosition()
  isOpen.value = true

  // Set initial highlighted index
  const activeIdx = normalizedOptions.value.findIndex(
    (opt) => opt.value === props.modelValue
  )
  highlightedIndex.value = activeIdx >= 0 ? activeIdx : 0

  window.addEventListener('scroll', handleGlobalScroll, true)
  window.addEventListener('resize', handleGlobalResize)
  window.addEventListener('mousedown', handleOutsideClick, true)

  nextTick(() => {
    scrollToHighlighted()
  })
}

function closeDropdown() {
  isOpen.value = false
  window.removeEventListener('scroll', handleGlobalScroll, true)
  window.removeEventListener('resize', handleGlobalResize)
  window.removeEventListener('mousedown', handleOutsideClick, true)
}

function handleGlobalScroll(e: Event) {
  // If scrolling inside the dropdown itself, don't close/update
  if (dropdownRef.value && dropdownRef.value.contains(e.target as Node)) {
    return
  }
  updatePosition()
}

function handleGlobalResize() {
  updatePosition()
}

function handleOutsideClick(e: MouseEvent) {
  const target = e.target as Node
  if (triggerRef.value && triggerRef.value.contains(target)) {
    return
  }
  if (dropdownRef.value && dropdownRef.value.contains(target)) {
    return
  }
  closeDropdown()
}

function selectOption(option: SelectOption) {
  if (option.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
  closeDropdown()
  triggerRef.value?.focus()
}

function scrollToHighlighted() {
  if (!dropdownRef.value) return
  const items = dropdownRef.value.querySelectorAll('.custom-select-option')
  if (items[highlightedIndex.value]) {
    items[highlightedIndex.value].scrollIntoView({
      block: 'nearest',
    })
  }
}

function onKeydown(e: KeyboardEvent) {
  if (props.disabled) return

  if (!isOpen.value) {
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault()
      openDropdown()
    }
    return
  }

  const opts = normalizedOptions.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (highlightedIndex.value < opts.length - 1) {
      highlightedIndex.value++
      scrollToHighlighted()
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (highlightedIndex.value > 0) {
      highlightedIndex.value--
      scrollToHighlighted()
    }
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (opts[highlightedIndex.value]) {
      selectOption(opts[highlightedIndex.value])
    }
  } else if (e.key === 'Escape' || e.key === 'Tab') {
    closeDropdown()
  }
}

watch(
  () => props.disabled,
  (val) => {
    if (val && isOpen.value) {
      closeDropdown()
    }
  }
)

onBeforeUnmount(() => {
  closeDropdown()
})
</script>

<template>
  <div
    ref="triggerRef"
    class="custom-select-container"
    :class="[
      `size-${size}`,
      {
        'is-open': isOpen,
        'is-disabled': disabled,
        'is-mono': mono,
        'is-up': isPlacementUp,
      },
    ]"
    tabindex="0"
    @click="toggleDropdown"
    @keydown="onKeydown"
  >
    <div class="selected-value-wrapper">
      <span v-if="displayLabel" class="selected-text">{{ displayLabel }}</span>
      <span v-else class="placeholder-text">{{ placeholder }}</span>
    </div>

    <div class="arrow-wrapper">
      <ChevronDown
        :size="size === 'sm' ? 13 : 15"
        class="chevron-icon"
        :class="{ 'rotate-up': isOpen }"
      />
    </div>

    <!-- Teleported Floating Dropdown Menu -->
    <Teleport to="body">
      <transition name="select-dropdown">
        <div
          v-if="isOpen"
          ref="dropdownRef"
          class="custom-select-dropdown"
          :class="[`size-${size}`, { 'is-mono': mono }]"
          :style="dropdownStyle"
        >
          <div v-if="normalizedOptions.length === 0" class="empty-option">
            无可用选项
          </div>

          <div
            v-for="(opt, idx) in normalizedOptions"
            :key="opt.value"
            class="custom-select-option"
            :class="{
              'is-active': opt.value === modelValue,
              'is-highlighted': idx === highlightedIndex,
              'is-disabled': opt.disabled,
            }"
            @mouseenter="highlightedIndex = idx"
            @click.stop="selectOption(opt)"
          >
            <div class="option-label-wrapper">
              <span class="option-label">{{ opt.label }}</span>
              <span v-if="opt.hint" class="option-hint">{{ opt.hint }}</span>
            </div>

            <Check
              v-if="opt.value === modelValue"
              :size="size === 'sm' ? 13 : 15"
              class="check-icon"
            />
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.custom-select-container {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  box-sizing: border-box;
  background-color: var(--bg-input, #232736);
  border: 1px solid var(--border, #2a2f42);
  border-radius: 6px;
  color: var(--text-main, #e2e8f0);
  cursor: pointer;
  user-select: none;
  transition: all 0.18s ease;
  outline: none;
}

.custom-select-container:hover:not(.is-disabled) {
  border-color: #3b82f6;
  background-color: #272c3d;
}

.custom-select-container:focus-visible,
.custom-select-container.is-open {
  border-color: var(--accent, #3b82f6);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.22);
  background-color: #272c3d;
}

.custom-select-container.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background-color: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.06);
}

/* Size Variants */
.custom-select-container.size-sm {
  height: 28px;
  padding: 0 8px;
  font-size: 0.78rem;
  border-radius: 5px;
}

.custom-select-container.size-md {
  height: 36px;
  padding: 0 10px;
  font-size: 0.84rem;
  border-radius: 6px;
}

.custom-select-container.size-lg {
  height: 42px;
  padding: 0 12px;
  font-size: 0.92rem;
  border-radius: 8px;
}

.custom-select-container.is-mono {
  font-family: var(--font-mono, monospace);
}

.selected-value-wrapper {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 6px;
  display: flex;
  align-items: center;
}

.selected-text {
  color: var(--text-main, #e2e8f0);
  font-weight: 400;
}

.placeholder-text {
  color: var(--text-muted, #94a3b8);
  font-style: normal;
}

.arrow-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted, #94a3b8);
  flex-shrink: 0;
  transition: color 0.15s;
}

.custom-select-container:hover .arrow-wrapper,
.custom-select-container.is-open .arrow-wrapper {
  color: #60a5fa;
}

.chevron-icon {
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.chevron-icon.rotate-up {
  transform: rotate(180deg);
}

/* Dropdown Menu Styles (Rendered via Teleport in body) */
.custom-select-dropdown {
  background-color: #1a1d29;
  border: 1px solid #2e354b;
  border-radius: 8px;
  padding: 5px;
  box-shadow:
    0 12px 28px -4px rgba(0, 0, 0, 0.6),
    0 4px 12px -2px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.05);
  max-height: 250px;
  overflow-y: auto;
  box-sizing: border-box;
  backdrop-filter: blur(12px);
  user-select: none;
}

.custom-select-dropdown.is-mono {
  font-family: var(--font-mono, monospace);
}

/* Dropdown Sizes */
.custom-select-dropdown.size-sm .custom-select-option {
  padding: 5px 8px;
  font-size: 0.76rem;
  border-radius: 4px;
}

.custom-select-dropdown.size-md .custom-select-option {
  padding: 7px 10px;
  font-size: 0.82rem;
  border-radius: 5px;
}

.custom-select-dropdown.size-lg .custom-select-option {
  padding: 9px 12px;
  font-size: 0.88rem;
  border-radius: 6px;
}

.custom-select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-main, #cbd5e1);
  cursor: pointer;
  transition: all 0.12s ease;
  margin-bottom: 2px;
}

.custom-select-option:last-child {
  margin-bottom: 0;
}

.custom-select-option.is-highlighted {
  background-color: rgba(59, 130, 246, 0.12);
  color: #fff;
}

.custom-select-option.is-active {
  background-color: rgba(59, 130, 246, 0.22);
  color: #60a5fa;
  font-weight: 500;
}

.custom-select-option.is-active.is-highlighted {
  background-color: rgba(59, 130, 246, 0.28);
  color: #93c5fd;
}

.custom-select-option.is-disabled {
  opacity: 0.35;
  cursor: not-allowed;
  background-color: transparent !important;
}

.option-label-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-hint {
  font-size: 0.72em;
  color: var(--text-muted, #94a3b8);
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
}

.check-icon {
  color: #3b82f6;
  flex-shrink: 0;
}

.empty-option {
  padding: 12px;
  text-align: center;
  font-size: 0.78rem;
  color: var(--text-muted, #94a3b8);
}

/* Dropdown Animation */
.select-dropdown-enter-active,
.select-dropdown-leave-active {
  transition:
    opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.select-dropdown-enter-from,
.select-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
