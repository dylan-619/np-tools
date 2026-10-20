<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, CheckCheck, ChevronDown, Code2, PencilLine } from 'lucide-vue-next'
import type { CaseConfig, ProcessRecipe } from '../../types/engineering'
import { validateCaseConfig } from '../../utils/engineeringContract'
import { chineseUnit } from '../../utils/engineeringConversation'
import { scenarioPresentation } from '../../utils/engineeringPresentation'

const props = defineProps<{
  config: CaseConfig
  recipe: ProcessRecipe
  version: string
  busy: boolean
}>()
const emit = defineEmits<{ confirm: [config: CaseConfig]; revise: [] }>()
const edits = ref<Record<string, number>>({})
const accepted = ref(false)
const error = ref('')
const parameters = computed(() => Object.entries(props.recipe.parameters))
const primary = computed(() => parameters.value.slice(0, 4))
const secondary = computed(() => parameters.value.slice(4))
const scenario = computed(() => scenarioPresentation(props.recipe))
watch(
  () => props.config,
  (config) => {
    edits.value = { ...config.parameters }
    accepted.value = false
    error.value = ''
  },
  { immediate: true }
)
watch(
  edits,
  () => {
    accepted.value = false
    error.value = ''
  },
  { deep: true }
)
function confirm() {
  if (!accepted.value || props.busy) return
  try {
    const config = validateCaseConfig(
      { ...props.config, parameters: { ...edits.value } },
      props.version,
      props.recipe.id
    )
    emit('confirm', config)
  } catch (e) {
    error.value = String(e).replace(/^Error:\s*/, '')
  }
}
</script>

<template>
  <form
    class="confirmation-card"
    aria-label="确认工艺方案与参数"
    novalidate
    @submit.prevent="confirm"
  >
    <header>
      <span class="confirmation-icon"><CheckCheck :size="19" /></span>
      <div>
        <h3>请确认这份工艺方案</h3>
        <p>{{ recipe.name }} · 工程版本 {{ version }}</p>
      </div>
    </header>
    <div class="device-names">
      <span v-for="label in config.labels" :key="label">{{ label }}</span>
    </div>
    <details class="control-boundary">
      <summary>核对启停、接替与保护规则</summary>
      <p>{{ scenario.sequence }}</p>
      <p>{{ scenario.protection }}</p>
      <small>以下数值为本次待确认参数；修改后需重新勾选确认。</small>
    </details>
    <div class="parameter-fields">
      <label v-for="[key, spec] in primary" :key="key"><span>{{ spec.label }}</span>
        <div>
          <input
            v-model.number="edits[key]"
            :aria-label="spec.label"
            type="number"
            :min="spec.min"
            :max="spec.max"
            :step="spec.step ?? (spec.type === 'float' ? 0.001 : 1)"
            :disabled="busy"
            required
          ><small>{{ chineseUnit(spec.unit) }}</small>
        </div></label>
    </div>
    <p v-if="recipe.id === 'three-pump-level-control'" class="parameter-rule">
      停泵液位 ＜ 调节目标 ＜ 启变频液位 ＜ 启工频液位
    </p>
    <details v-if="secondary.length" class="secondary-parameters">
      <summary>
        时序与调节参数 <span>{{ secondary.length }} 项</span><ChevronDown :size="14" />
      </summary>
      <div class="parameter-fields">
        <label v-for="[key, spec] in secondary" :key="key"><span>{{ spec.label }}</span>
          <div>
            <input
              v-model.number="edits[key]"
              :aria-label="spec.label"
              type="number"
              :min="spec.min"
              :max="spec.max"
              :step="spec.step ?? (spec.type === 'float' ? 0.001 : 1)"
              :disabled="busy"
              required
            ><small>{{ chineseUnit(spec.unit) }}</small>
          </div></label>
      </div>
    </details>
    <label class="accept-confirmation"><input v-model="accepted" type="checkbox" :disabled="busy">
      <span>已核对设备分工、联锁与参数，确认用于本次工程</span>
    </label>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <footer>
      <button type="button" :disabled="busy" @click="emit('revise')">
        <PencilLine :size="14" />继续调整
      </button>
      <button type="submit" class="generate-button" :disabled="!accepted || busy">
        <Code2 v-if="!busy" :size="15" /><Check v-else :size="15" />确认并生成工程
      </button>
    </footer>
  </form>
</template>

<style scoped>
.control-boundary { font-size: 12px; color: #4d6e83; line-height: 1.8; margin: 14px 0; }
.control-boundary summary { cursor: pointer; color: #255c7a; }
.control-boundary p { margin: 8px 0; }
.control-boundary small { font-size: 11px; }
.confirmation-card {
  margin-top: 18px;
  border: 1px solid #bfd7e3;
  border-radius: 12px;
  background: #fbfdff;
  padding: 20px;
  color: #193b50;
}
header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.confirmation-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #e7f2f6;
  color: #137397;
  flex-shrink: 0;
}
h3 {
  font-size: 15px;
  margin: 0 0 4px;
  font-weight: 600;
}
header p {
  font-size: 11px;
  color: #6c8597;
  margin: 0;
}
.device-names {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 16px 0;
}
.device-names span {
  font-size: 11px;
  padding: 4px 7px;
  border: 1px solid #e0e9ef;
  border-radius: 4px;
  background: white;
  color: #546f82;
}
.parameter-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px 16px;
}
.parameter-fields label > span {
  display: block;
  font-size: 11px;
  color: #607c8e;
  margin-bottom: 6px;
}
.parameter-fields label > div {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #d4e1e9;
  background: white;
  border-radius: 6px;
  padding: 0 9px;
}
.parameter-fields input {
  min-width: 0;
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  padding: 9px 0;
  font-size: 14px;
  color: #234c63;
  font-family: inherit;
}
.parameter-fields label > div:focus-within {
  outline: 2px solid #2682a1;
  outline-offset: 2px;
}
.parameter-fields small {
  white-space: nowrap;
  font-size: 10px;
  color: #7992a2;
}
.parameter-rule {
  font-size: 10px;
  color: #7891a2;
  margin: 10px 0 0;
  line-height: 1.8;
}
.secondary-parameters {
  border-top: 1px solid #e0eaf0;
  border-bottom: 1px solid #e0eaf0;
  margin-top: 14px;
}
summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 12px 0;
  color: #5a788e;
  font-size: 11px;
}
summary::-webkit-details-marker {
  display: none;
}
summary span {
  color: #8ba0af;
}
summary svg {
  margin-left: auto;
}
details[open] summary svg {
  transform: rotate(180deg);
}
.secondary-parameters .parameter-fields {
  padding-bottom: 16px;
}
.accept-confirmation {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 16px;
  font-size: 11px;
  line-height: 1.8;
  color: #536f82;
  cursor: pointer;
}
.accept-confirmation input {
  accent-color: #176d90;
  margin-top: 4px;
  flex-shrink: 0;
}
footer {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid #cbdce6;
  border-radius: 6px;
  padding: 9px 12px;
  background: white;
  color: #527187;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.generate-button {
  background: #146c94;
  border-color: #146c94;
  color: white;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button:focus-visible,
summary:focus-visible,
.accept-confirmation input:focus-visible {
  outline: 2px solid #2682a1;
  outline-offset: 3px;
}
.form-error {
  font-size: 11px;
  color: #b0443d;
  line-height: 1.7;
}
@media (max-width: 600px) {
  .confirmation-card {
    padding: 15px;
  }
  .parameter-fields {
    gap: 12px;
  }
}
</style>
