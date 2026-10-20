<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Play,
  Square,
  OctagonX,
  RotateCcw,
  ArrowRight,
  Circle,
  Power,
  Timer,
  SlidersHorizontal
} from 'lucide-vue-next'
import { useEngineeringStore } from '../../stores/engineeringStore'
const store = useEngineeringStore()
const phaseNames = ['待命', '等待前级接通', '两路输出接通', '后级延时停止', '禁止启动']
const value = (name: string) =>
  store.fields[name]?.[1] === 1 ? store.fields[name]?.[0] : undefined
const phase = computed(() => Number(value('LINE_PHASE')))
const label = computed(() =>
  store.currentRuntime
    ? (phaseNames[phase.value] ?? '未识别阶段')
    : store.snapshot?.status === 'failed'
      ? '运行中断'
      : '等待部署'
)
const permit = computed(() => value('RUN_PERMIT') === true)
const down = computed(() => value('DOWN_OUT'))
const up = computed(() => value('UP_OUT'))
const remain = computed(() =>
  typeof value('LINE_REMAIN_MS') === 'number'
    ? (Number(value('LINE_REMAIN_MS')) / 1000).toFixed(1)
    : '—'
)
const startDelay = ref<number | string>(''),
  clearDelay = ref<number | string>(''),
  operating = ref(false)
watch(
  () => value('START_DELAY_MS'),
  (v) => {
    startDelay.value = typeof v === 'number' ? v : ''
  },
  { immediate: true }
)
watch(
  () => value('CLEAR_DELAY_MS'),
  (v) => {
    clearDelay.value = typeof v === 'number' ? v : ''
  },
  { immediate: true }
)
const reason = computed(() =>
  !store.currentRuntime
    ? '当前没有有效仿真快照'
    : value('LINE_BLOCK_REASON') === 2
      ? '输入质量异常，所有输出已撤销'
      : !permit.value
        ? '运行许可关闭，等待开启 DI3'
        : value('STOP_BTN')
          ? '停止输入有效，不能启动'
          : phase.value === 3
            ? '正在完成停止顺序，启动请求不会排队'
            : '停止优先 · 许可恢复后等待新启动'
)
async function operate(op: string, v: unknown) {
  if (operating.value) return
  operating.value = true
  try {
    await store.action(op, v)
  } finally {
    operating.value = false
  }
}
async function setParameter(name: string, v: number | string) {
  await operate('parameter', { name, value: v, revision: store.snapshot?.parameterRevision })
}
</script>

<template>
  <section class="simulation-panel" aria-label="本地仿真 HMI">
    <div class="simulation-heading">
      <div>
        <span class="eyebrow">KZ3 F427 · 本地仿真</span>
        <h2>{{ store.currentRuntime ? '顺序控制，正在执行。' : '顺序控制，等待运行。' }}</h2>
        <p>虚拟输入进入本次 C 程序，输出由控制扫描回读。</p>
      </div>
      <span class="live-status" :class="{ live: store.currentRuntime }"
        ><Circle :size="10" fill="currentColor" />{{
          store.currentRuntime ? '仿真运行中' : '状态不可用'
        }}</span
      >
    </div>
    <div v-if="store.snapshot?.error" class="runtime-error" role="alert">
      {{ store.snapshot.error }} <button @click="store.deploy()">重新启动</button>
    </div>
    <div class="hmi-layout">
      <div class="process-area">
        <div class="process-summary">
          <div>
            <span>当前步骤</span><strong>{{ label }}</strong>
          </div>
          <div class="countdown">
            <Timer :size="17" /><strong>{{ remain }}</strong
            ><span>秒剩余</span>
          </div>
        </div>
        <div class="process-track">
          <article
            class="machine"
            :class="{ energized: down === true, unknown: down === undefined }"
          >
            <div class="machine-caption"><span>DO1</span><span>后级</span></div>
            <div class="conveyor-symbol" aria-hidden="true">
              <div class="belt"><i /><i /><i /><i /></div>
              <div class="roller left" />
              <div class="roller right" />
            </div>
            <h3>{{ store.delivery?.manifest.config.labels.downstream ?? '后级输送设备' }}</h3>
            <span class="output-state"
              ><Circle :size="10" fill="currentColor" />{{
                down === undefined ? '输出未知' : down ? '输出接通' : '输出断开'
              }}</span
            >
          </article>
          <div class="process-link">
            <ArrowRight :size="29" /><small>先后级<br />再前级</small>
          </div>
          <article class="machine" :class="{ energized: up === true, unknown: up === undefined }">
            <div class="machine-caption"><span>DO2</span><span>前级</span></div>
            <div class="conveyor-symbol" aria-hidden="true">
              <div class="belt"><i /><i /><i /><i /></div>
              <div class="roller left" />
              <div class="roller right" />
            </div>
            <h3>{{ store.delivery?.manifest.config.labels.upstream ?? '前级输送设备' }}</h3>
            <span class="output-state"
              ><Circle :size="10" fill="currentColor" />{{
                up === undefined ? '输出未知' : up ? '输出接通' : '输出断开'
              }}</span
            >
          </article>
        </div>
        <p class="control-reason" role="status">{{ reason }}</p>
        <div class="hmi-actions">
          <button
            class="start-button"
            :disabled="
              !store.currentRuntime ||
              !permit ||
              phase !== 0 ||
              value('STOP_BTN') === true ||
              operating
            "
            @click="operate('command', 'LINE_START')"
          >
            <Play :size="17" />启动
          </button>
          <button
            :disabled="!store.currentRuntime || operating"
            @click="operate('command', 'LINE_STOP')"
          >
            <Square :size="17" />正常停止
          </button>
          <button
            class="stop-button"
            :disabled="!store.currentRuntime || operating"
            @click="operate('command', 'LINE_PROTECT_STOP')"
          >
            <OctagonX :size="17" />立即停止
          </button>
        </div>
        <div class="parameter-heading">
          <SlidersHorizontal :size="15" />时序参数<span>待命时可调，下一启动周期生效</span>
        </div>
        <div class="parameter-grid">
          <label
            >启动间隔
            <div>
              <input
                v-model.number="startDelay"
                aria-label="启动间隔毫秒"
                placeholder="等待读回"
                type="number"
                min="1000"
                max="10000"
                step="100"
                :disabled="!store.currentRuntime || phase !== 0 || operating"
              /><span>ms</span
              ><button
                :disabled="!store.currentRuntime || phase !== 0 || operating"
                @click="setParameter('START_DELAY_MS', startDelay)"
              >
                应用
              </button>
            </div></label
          >
          <label
            >后级停止延时
            <div>
              <input
                v-model.number="clearDelay"
                aria-label="后级停止延时毫秒"
                placeholder="等待读回"
                type="number"
                min="1000"
                max="10000"
                step="100"
                :disabled="!store.currentRuntime || phase !== 0 || operating"
              /><span>ms</span
              ><button
                :disabled="!store.currentRuntime || phase !== 0 || operating"
                @click="setParameter('CLEAR_DELAY_MS', clearDelay)"
              >
                应用
              </button>
            </div></label
          >
        </div>
        <small class="feedback-note">指示代表控制输出目标，不代表真实电机运行反馈。</small>
      </div>
      <aside class="virtual-inputs">
        <div>
          <span class="eyebrow">虚拟输入</span>
          <h3>从点位触发控制</h3>
          <p>与 HMI 命令进入同一份逻辑</p>
        </div>
        <div class="di-row">
          <div>
            <b>DI1</b><span>启动按钮</span
            ><small>{{
              value('START_BTN') === undefined ? '未知' : value('START_BTN') ? '已按下' : '已释放'
            }}</small>
          </div>
          <button
            :disabled="!store.currentRuntime || operating || value('START_BTN') === true"
            @click="operate('pulse', 0)"
          >
            按下启动
          </button>
        </div>
        <div class="di-row">
          <div>
            <b>DI2</b><span>停止按钮</span
            ><small>{{
              value('STOP_BTN') === undefined ? '未知' : value('STOP_BTN') ? '已按下' : '已释放'
            }}</small>
          </div>
          <button
            :disabled="!store.currentRuntime || operating || value('STOP_BTN') === true"
            @click="operate('pulse', 1)"
          >
            按下停止
          </button>
        </div>
        <div class="di-row">
          <div>
            <b>DI3</b><span>运行许可</span
            ><small>{{
              value('RUN_PERMIT') === undefined ? '未知' : permit ? '允许控制' : '许可关闭'
            }}</small>
          </div>
          <button
            role="switch"
            :aria-checked="permit"
            aria-label="DI3运行许可"
            class="permit-switch"
            :class="{ on: permit }"
            :disabled="!store.currentRuntime || operating"
            @click="operate('permit', !permit)"
          >
            <i />
          </button>
        </div>
        <p class="input-note">
          按钮自动释放，无需连接实板。撤销许可，两路输出立即断开；恢复许可不会自动启动。
        </p>
        <button
          class="reset-button"
          :disabled="store.busy || operating || !store.delivery"
          @click="store.deploy()"
        >
          <RotateCcw :size="16" />重置演示
        </button>
        <button
          class="reset-button"
          :disabled="!store.currentRuntime || operating"
          @click="operate('stop', null)"
        >
          <Power :size="16" />停止仿真
        </button>
        <small class="runtime-meta"
          >{{ store.snapshot?.identity?.projectVersion ?? '未部署' }}<br />扫描
          {{ store.snapshot?.scanSequence ?? '—' }} · 目标周期 10ms</small
        >
      </aside>
    </div>
  </section>
</template>
<style scoped>
.simulation-panel {
  color: #142c43;
  background: #fff;
  border: 1px solid #dbe4ec;
  border-radius: 16px;
  overflow: hidden;
}
.simulation-heading {
  padding: 26px 28px 22px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 1px solid #e3eaf0;
}
.eyebrow {
  font-size: 12px;
  color: #527386;
}
.simulation-heading h2 {
  font-size: 25px;
  margin: 7px 0 8px;
  letter-spacing: -0.5px;
}
.simulation-heading p,
.virtual-inputs p {
  font-size: 13px;
  color: #61778a;
  margin: 0;
  line-height: 1.6;
}
.live-status {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  background: #edf1f4;
  color: #6b7884;
  padding: 8px 12px;
  border-radius: 20px;
  white-space: nowrap;
}
.live-status.live {
  color: #18794e;
  background: #e9f7ef;
}
.hmi-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 265px;
}
.process-area {
  padding: 24px 28px;
}
.process-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.process-summary span {
  font-size: 12px;
  color: #6d7e8e;
}
.process-summary strong {
  display: block;
  font-size: 21px;
  margin-top: 6px;
}
.countdown {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #146c94;
}
.countdown strong {
  font-size: 28px;
  font-variant-numeric: tabular-nums;
  margin: 0;
}
.process-track {
  display: flex;
  align-items: center;
  padding: 34px 0 24px;
  gap: 12px;
}
.machine {
  flex: 1;
  min-width: 0;
  border: 1px solid #d8e1e8;
  background: #f7f9fb;
  border-radius: 12px;
  padding: 15px 18px 18px;
  text-align: center;
  transition: background 0.15s;
}
.machine.energized {
  border-color: #6db193;
  background: #f0faf5;
}
.machine.unknown {
  opacity: 0.6;
}
.machine-caption {
  display: flex;
  justify-content: space-between;
  color: #667d90;
  font-size: 12px;
}
.machine h3 {
  font-size: 16px;
  margin: 15px 0 10px;
  overflow-wrap: anywhere;
}
.output-state {
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #6b7b8c;
}
.energized .output-state {
  color: #18794e;
}
.conveyor-symbol {
  position: relative;
  max-width: 155px;
  height: 64px;
  margin: 18px auto 0;
}
.belt {
  height: 32px;
  border: 3px solid #a4b5c2;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 0 12px;
}
.belt i {
  height: 12px;
  width: 12px;
  border: 2px solid #a4b5c2;
  border-radius: 50%;
}
.roller {
  position: absolute;
  top: 37px;
  width: 5px;
  height: 22px;
  background: #a4b5c2;
}
.roller.left {
  left: 20px;
}
.roller.right {
  right: 20px;
}
.energized .belt,
.energized .belt i {
  border-color: #23845a;
}
.energized .roller {
  background: #23845a;
}
.process-link {
  text-align: center;
  color: #6b879b;
}
.process-link small {
  display: block;
  font-size: 10px;
  line-height: 1.6;
}
.control-reason {
  min-height: 20px;
  font-size: 12px;
  color: #65798c;
  background: #f3f6f8;
  padding: 10px 12px;
  border-radius: 6px;
}
.hmi-actions {
  display: flex;
  gap: 10px;
  margin: 18px 0 24px;
}
.hmi-actions button {
  min-height: 44px;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid #bfcdd9;
  border-radius: 7px;
  background: #fff;
  color: #243d53;
  cursor: pointer;
  font-size: 14px;
}
.hmi-actions .start-button {
  background: #146c94;
  color: white;
  border-color: #146c94;
}
.hmi-actions .stop-button {
  color: #a2343d;
  border-color: #dbb6ba;
  background: #fff6f6;
}
.parameter-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
}
.parameter-heading span {
  font-size: 11px;
  color: #758698;
  margin-left: auto;
}
.parameter-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-top: 14px;
}
.parameter-grid label {
  font-size: 12px;
  color: #5a7084;
}
.parameter-grid label > div {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #d6e0e9;
  border-radius: 6px;
  margin-top: 7px;
  padding: 4px 7px;
}
.parameter-grid input {
  border: 0;
  min-width: 0;
  width: 100%;
  background: transparent;
  padding: 6px;
  color: #142c43;
}
.parameter-grid button {
  border: 0;
  background: #edf4f8;
  color: #146c94;
  border-radius: 4px;
  padding: 6px;
  white-space: nowrap;
}
.feedback-note {
  display: block;
  margin-top: 18px;
  font-size: 11px;
  color: #8492a0;
}
.virtual-inputs {
  background: #f5f8fb;
  border-left: 1px solid #e1e8ef;
  padding: 24px 20px;
}
.virtual-inputs h3 {
  font-size: 18px;
  margin: 6px 0;
}
.di-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #dfe7ee;
  padding: 20px 0;
  gap: 8px;
}
.di-row b {
  font-size: 12px;
  color: #146c94;
  margin-right: 8px;
}
.di-row span {
  font-size: 13px;
}
.di-row small {
  display: block;
  font-size: 11px;
  color: #788b9d;
  margin-top: 7px;
}
.di-row button {
  min-height: 36px;
  font-size: 12px;
  color: #29485e;
  border: 1px solid #cad7e1;
  background: #fff;
  border-radius: 6px;
  padding: 5px 9px;
  cursor: pointer;
  white-space: nowrap;
}
.di-row .permit-switch {
  min-height: 28px;
  width: 48px;
  background: #b7c5d0;
  border: 0;
  border-radius: 18px;
  padding: 4px;
  display: flex;
}
.permit-switch i {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: white;
}
.di-row .permit-switch.on {
  background: #18794e;
  justify-content: flex-end;
}
.virtual-inputs .input-note {
  font-size: 11px;
  margin: 16px 0 24px;
}
.reset-button {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 38px;
  border: 1px solid #d0dce5;
  background: white;
  border-radius: 6px;
  color: #4b6479;
  margin-top: 9px;
}
.runtime-meta {
  display: block;
  color: #8193a2;
  font-size: 10px;
  line-height: 1.8;
  margin-top: 16px;
}
.runtime-error {
  padding: 12px 24px;
  color: #a2343d;
  background: #fff2f3;
  font-size: 13px;
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid #146c94;
  outline-offset: 3px;
}
@media (max-width: 1200px) {
  .hmi-layout {
    grid-template-columns: minmax(0, 1fr) 215px;
  }
  .process-area {
    padding: 20px;
  }
  .virtual-inputs {
    padding: 20px 14px;
  }
  .machine {
    padding: 12px;
  }
  .simulation-heading {
    padding: 20px;
  }
  .parameter-heading span {
    display: none;
  }
}
@media (max-width: 900px) {
  .hmi-layout {
    grid-template-columns: 1fr;
  }
  .virtual-inputs {
    border-left: 0;
    border-top: 1px solid #e1e8ef;
  }
  .di-row {
    padding: 10px 0;
  }
  .simulation-heading {
    gap: 10px;
  }
  .simulation-heading h2 {
    font-size: 21px;
  }
}
@media (min-width: 900px) and (max-height: 850px) {
  .simulation-heading {
    padding: 12px 20px;
  }
  .simulation-heading h2 {
    font-size: 19px;
    margin: 5px 0;
  }
  .simulation-heading p {
    font-size: 11px;
  }
  .process-area {
    padding: 15px 20px;
  }
  .process-summary strong {
    font-size: 18px;
    margin-top: 4px;
  }
  .process-track {
    padding: 15px 0 10px;
  }
  .machine {
    padding: 10px 14px;
  }
  .conveyor-symbol {
    height: 52px;
    margin-top: 12px;
  }
  .machine h3 {
    font-size: 14px;
    margin: 10px 0;
  }
  .control-reason {
    margin: 7px 0;
    padding: 7px 10px;
    font-size: 11px;
  }
  .hmi-actions {
    margin: 10px 0 12px;
  }
  .hmi-actions button {
    min-height: 38px;
    font-size: 13px;
  }
  .parameter-grid {
    margin-top: 8px;
    gap: 12px;
  }
  .feedback-note {
    margin-top: 9px;
    font-size: 10px;
  }
  .virtual-inputs {
    padding: 15px;
  }
  .virtual-inputs h3 {
    font-size: 16px;
  }
  .virtual-inputs p {
    font-size: 11px;
  }
  .di-row {
    padding: 12px 0;
  }
  .virtual-inputs .input-note {
    margin: 10px 0;
  }
  .reset-button {
    min-height: 32px;
    font-size: 11px;
  }
  .runtime-meta {
    margin-top: 8px;
  }
}
</style>
