<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Play,
  Square,
  OctagonX,
  RotateCcw,
  SlidersHorizontal,
  ChevronDown,
  Power,
  AlertTriangle
} from 'lucide-vue-next'
import { useEngineeringStore } from '../../stores/engineeringStore'
const store = useEngineeringStore()
const operating = ref(false)
const read = (name: string) => (store.fields[name]?.[1] === 1 ? store.fields[name]?.[0] : undefined)
const live = computed(() => store.currentRuntime)
const automatic = computed(() => read('SYS_AUTO') === true)
const process = computed(() => (live.value ? store.snapshot?.process : undefined))
const level = computed(() => process.value?.tankLevelPct)
const labels = computed(() => store.delivery?.manifest.config.labels ?? store.activeRecipe.labels)
const statusNames = [
  '已停止',
  '低位补水',
  '主泵供水',
  '备用泵供水',
  '自动待机',
  '联锁停机',
  '切换等待',
  '停止关阀'
]
const title = computed(() => {
  if (!live.value) return store.snapshot?.status === 'failed' ? '运行中断' : '等待部署'
  if (automatic.value && read('XV_F_L')) return '补水故障'
  if (automatic.value && read('P1_F_L') && read('P2_F_L')) return '供水故障'
  if (automatic.value && read('SOURCE_OK') === false && read('TK_LOW') === false) return '等待水源'
  return statusNames[Number(read('SYS_STATUS'))] ?? '状态未知'
})
const reason = computed(() => {
  if (!live.value) return '部署当前工程后，即可投入自动运行。'
  const reasons: Record<number, string> = {
    1: '运行许可撤销，设备已停止；恢复后需重新投入。',
    2: '点位质量异常，设备已停止；恢复后需重新投入。',
    3: '低液位保护：供水泵停止，等待补水。',
    4: '上游水源不可用，补水暂停。',
    5: '两台泵均已故障隔离，恢复设备后分别复位。',
    6: '等待原泵运行反馈停止，暂不投入备用泵。',
    7: '高低液位信号矛盾，检查液位开关。'
  }
  const block = Number(read('BLOCK_REASON'))
  if ([1, 2, 7].includes(block)) return reasons[block]
  if (read('XV_F_L')) return '进水阀故障，补水暂停；恢复工况后执行阀门复位。'
  if (automatic.value && read('SOURCE_OK') === false && read('TK_LOW') === false)
    return '水源不可用，无法补水；供水泵因低液位停止。'
  if (reasons[block]) return reasons[block]
  if (read('P1_F_L') && read('P2_RUN')) return '主供泵已隔离，备用泵正在供水。'
  if (Number(read('REMAIN_MS')) > 0)
    return `正在执行切换 / 换向保护，剩余 ${(Number(read('REMAIN_MS')) / 1000).toFixed(1)} 秒。`
  return automatic.value
    ? '自动工艺已投入，按水位与供水需求联动。'
    : '投入自动运行，开始水箱补水与供水控制。'
})
const pumpFault = (code: number) =>
  ['', '设备故障接点', '启动反馈超时', '运行反馈丢失', '停止反馈超时'][code] ?? '设备异常'
const pumps = computed(() =>
  [1, 2].map((n) => ({
    n,
    label: labels.value[`pump${n}`],
    run: read(`P${n}_RUN`),
    command: read(`P${n}_DO`),
    fault: read(`P${n}_F_L`),
    reason: pumpFault(Number(read(`P${n}_FAULT`))),
    status:
      ['待机', '启动确认', '运行', '停止确认', '故障隔离'][Number(read(`P${n}_STATUS`))] ??
      '状态未知',
    seconds: read(`P${n}_RT_S`),
    reset: `P${n}_RST`
  }))
)
const valveName = computed(
  () =>
    ['关到位', '开到位', '开启中', '关闭中', '中间位置', '故障'][Number(read('XV_STATUS'))] ??
    '状态未知'
)
const valveReason = computed(() =>
  Number(read('XV_FAULT')) === 1 ? '开关到位信号矛盾' : '行程反馈超时'
)
const conditions = [
  { name: 'source', field: 'SOURCE_OK', label: '上游水源', on: '可用', off: '不可用' },
  { name: 'demand', field: 'DEMAND', label: '供水需求', on: '有需求', off: '无需求' },
  { name: 'permit', field: 'RUN_PERMIT', label: '运行许可', on: '允许', off: '禁止' },
  { name: 'pump1Fault', field: 'P1_FLT', label: '主供泵故障', on: '已触发', off: '正常' },
  { name: 'pump2Fault', field: 'P2_FLT', label: '备用泵故障', on: '已触发', off: '正常' }
]
const entries = ref<Array<{ time: string; text: string }>>([])
watch(
  () => [title.value, read('P1_F_L'), read('P2_F_L'), read('XV_F_L')].join(':'),
  (_, previous) => {
    if (!previous || !live.value) return
    const alarms = [
      read('P1_F_L') ? 'P101故障' : '',
      read('P2_F_L') ? 'P102故障' : '',
      read('XV_F_L') ? 'XV101故障' : ''
    ].filter(Boolean)
    entries.value.unshift({
      time: new Date().toLocaleTimeString('zh-CN'),
      text: [title.value, ...alarms].join(' / ')
    })
    entries.value = entries.value.slice(0, 5)
  }
)
async function operate(op: string, value: unknown) {
  if (operating.value || !live.value) return
  operating.value = true
  try {
    await store.action(op, value)
  } finally {
    operating.value = false
  }
}
async function restoreConditions() {
  if (operating.value || !live.value) return
  operating.value = true
  try {
    for (const name of ['pump1Fault', 'pump2Fault'])
      await store.action('condition', { name, value: false })
    await store.action('condition', { name: 'source', value: true })
    await store.action('environment', { name: 'restore', value: true })
    await store.action('quality', 0)
  } finally {
    operating.value = false
  }
}
const parameterValues = ref<Record<string, number>>({})
watch(
  () => JSON.stringify(Object.values(store.activeRecipe.parameters).map((s) => read(s.field))),
  () => {
    for (const spec of Object.values(store.activeRecipe.parameters)) {
      const value = read(spec.field)
      if (typeof value === 'number') parameterValues.value[spec.field] = value
      else delete parameterValues.value[spec.field]
    }
  },
  { immediate: true }
)
const parametersStopped = computed(
  () =>
    !automatic.value &&
    read('P1_RUN') === false &&
    read('P2_RUN') === false &&
    read('XV_OPEN_DO') === false &&
    read('XV_CLOSE_DO') === false
)
const disabled = computed(() => !live.value || operating.value)
</script>

<template>
  <section class="water-station" aria-label="清水供水泵站工艺控制">
    <div class="station-heading">
      <div>
        <span class="station-tag">清水供水泵站</span>
        <h2>{{ title }}</h2>
      </div>
      <div class="station-state">
        <i :class="{ online: live }" />{{ live ? (automatic ? '自动运行' : '控制就绪') : '离线'
        }}<small>KZ3 F427</small>
      </div>
    </div>
    <div v-if="store.snapshot?.error" class="station-error" role="alert">
      {{ store.snapshot.error }}<button @click="store.deploy()">重新部署</button>
    </div>
    <div class="station-layout">
      <main class="station-main">
        <div class="process-drawing">
          <svg
            viewBox="0 50 900 300"
            role="img"
            aria-label="上游水源经进水阀进入清水箱，由主供泵或备用泵向下游供水"
          >
            <defs>
              <clipPath id="tk101-water">
                <rect x="310" y="65" width="190" height="232" rx="9" />
              </clipPath>
              <pattern id="station-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.7" fill="#dbe5eb" />
              </pattern>
            </defs>
            <rect width="900" height="380" fill="url(#station-grid)" />
            <g class="pipe-bed">
              <path
                d="M50 175H310 M500 246H556V135H615 M556 246V304H615 M687 135H750V220H843 M687 304H750V220"
              />
            </g>
            <g class="pipe" :class="{ flowing: process?.inflowActive }"><path d="M50 175H310" /></g>
            <g class="pipe" :class="{ flowing: read('P1_RUN') }">
              <path d="M500 246H556V135H615 M687 135H750V220H843" />
            </g>
            <g class="pipe" :class="{ flowing: read('P2_RUN') }">
              <path d="M500 246H556V304H615 M687 304H750V220H843" />
            </g>
            <g class="source-symbol">
              <path d="M37 148Q50 130 63 148L63 197H37Z" />
              <path d="M42 169H58 M42 177H58 M42 185H58" />
            </g>
            <text x="50" y="226" text-anchor="middle" class="device-text">上游水源</text>
            <text x="50" y="246" text-anchor="middle" class="muted-text">
              {{
                read('SOURCE_OK') === undefined ? '—' : read('SOURCE_OK') ? '水源可用' : '水源中断'
              }}
            </text>
            <g
              class="valve-symbol"
              :class="{ moving: read('XV_OPEN_DO') || read('XV_CLOSE_DO'), fault: read('XV_F_L') }"
            >
              <path d="M173 158L215 192V158L173 192Z" />
              <path d="M194 158V133" />
              <rect x="177" y="111" width="34" height="23" rx="3" />
              <text x="194" y="127" text-anchor="middle">M</text>
            </g>
            <text x="194" y="222" text-anchor="middle" class="device-text">XV101 进水阀</text>
            <text
              x="194"
              y="242"
              text-anchor="middle"
              :class="read('XV_F_L') ? 'alarm-text' : 'muted-text'"
            >
              {{ valveName }}
            </text>
            <g class="tank-symbol">
              <rect x="310" y="65" width="190" height="232" rx="9" fill="#fafdff" />
              <g clip-path="url(#tk101-water)">
                <rect
                  v-if="level !== undefined"
                  x="310"
                  :y="297 - (232 * level) / 100"
                  width="190"
                  :height="(232 * level) / 100"
                  fill="#85cdd7"
                />
                <path
                  v-if="level !== undefined"
                  :d="`M310 ${297 - (232 * level) / 100}H500`"
                  stroke="#187c91"
                  stroke-width="2"
                />
              </g>
              <rect
                x="310"
                y="65"
                width="190"
                height="232"
                rx="9"
                fill="none"
                stroke="#668696"
                stroke-width="2"
              />
              <path d="M315 111H495 M315 251H495" class="level-line" />
              <circle
                cx="500"
                cy="111"
                r="5"
                :fill="read('TK_HIGH') ? '#237f6f' : '#fff'"
                stroke="#668696"
              />
              <circle
                cx="500"
                cy="251"
                r="5"
                :fill="read('TK_LOW') ? '#237f6f' : '#fff'"
                stroke="#668696"
              />
              <text x="328" y="101" class="scale-text">高位</text>
              <text x="328" y="273" class="scale-text">低位</text>
              <text x="405" y="180" text-anchor="middle" class="level-value">
                {{ level === undefined ? '—' : level.toFixed(0) }}
                <tspan font-size="16">%</tspan>
              </text>
              <text x="405" y="205" text-anchor="middle" class="tank-caption">液位</text>
            </g>
            <text x="405" y="328" text-anchor="middle" class="device-text">{{ labels.tank }}</text>
            <g
              v-for="(pump, i) in pumps"
              :key="pump.n"
              :transform="`translate(650,${i === 0 ? 135 : 304})`"
              class="pump-symbol"
              :class="{ running: pump.run, fault: pump.fault }"
            >
              <path d="M-25 29H25L18 19H-18Z" class="pump-base" />
              <circle r="34" />
              <path d="M-13 -20L22 0L-13 20Z" />
              <circle r="6" class="hub" />
              <text x="0" y="-58" text-anchor="middle" class="device-text">{{ pump.label }}</text>
              <text
                x="0"
                y="-40"
                text-anchor="middle"
                :class="pump.fault ? 'alarm-text' : 'muted-text'"
              >
                {{ pump.status }}
              </text>
            </g>
            <path d="M819 209L842 220L819 231" fill="none" stroke="#668696" stroke-width="3" />
            <text x="823" y="173" text-anchor="middle" class="device-text">下游供水</text>
            <text x="823" y="194" text-anchor="middle" class="muted-text">
              {{ read('DEMAND') === undefined ? '—' : read('DEMAND') ? '有用水需求' : '暂无需求' }}
            </text>
          </svg>
          <div class="drawing-legend">
            <span><i class="flow-key" />介质流动</span><span><i class="run-key" />设备运行</span
            ><span><i class="fault-key" />故障隔离</span>
          </div>
        </div>
        <div
          class="station-message"
          :class="{ warning: read('P1_F_L') || read('P2_F_L') || read('XV_F_L') }"
          role="status"
        >
          <AlertTriangle v-if="read('P1_F_L') || read('P2_F_L') || read('XV_F_L')" :size="16" />{{
            reason
          }}
        </div>
        <div class="station-controls">
          <button
            class="auto-button"
            :disabled="
              disabled ||
              automatic ||
              read('RUN_PERMIT') !== true ||
              Number(read('BLOCK_REASON')) === 2
            "
            @click="operate('command', 'SYS_STA')"
          >
            <Play :size="16" />投入自动运行
          </button>
          <button :disabled="disabled" @click="operate('command', 'SYS_STP')">
            <Square :size="16" />正常停止
          </button>
          <button class="trip-button" :disabled="disabled" @click="operate('command', 'SYS_TRIP')">
            <OctagonX :size="16" />立即停止
          </button>
        </div>
        <div class="station-devices">
          <article v-for="pump in pumps" :key="pump.n" :class="{ fault: pump.fault }">
            <div>
              <strong>{{ pump.label }}</strong
              ><span :class="{ running: pump.run }">{{ pump.status }}</span>
            </div>
            <p>
              {{
                pump.fault
                  ? pump.reason
                  : pump.run
                    ? '运行反馈已确认'
                    : pump.command
                      ? '等待运行反馈'
                      : pump.n === 1
                        ? '优先供水设备'
                        : '主泵故障时接替'
              }}
            </p>
            <footer>
              <small>累计 {{ pump.seconds === undefined ? '—' : pump.seconds }} s</small
              ><button
                :disabled="
                  disabled ||
                  pump.fault !== true ||
                  pump.run === true ||
                  read(`P${pump.n}_FLT`) !== false
                "
                @click="operate('command', pump.reset)"
              >
                <RotateCcw :size="12" />故障复位
              </button>
            </footer>
          </article>
          <article :class="{ fault: read('XV_F_L') }">
            <div>
              <strong>{{ labels.valve }}</strong
              ><span>{{ valveName }}</span>
            </div>
            <p>{{ read('XV_F_L') ? valveReason : '到位断电 · 换向间隔 2 s' }}</p>
            <footer>
              <small>开 / 关到位联锁</small
              ><button
                :disabled="disabled || read('XV_F_L') !== true || process?.valveBlocked === true"
                @click="operate('command', 'XV_RST')"
              >
                <RotateCcw :size="12" />故障复位
              </button>
            </footer>
          </article>
        </div>
        <details class="station-parameters">
          <summary>
            <SlidersHorizontal :size="14" />工艺参数<small>停止时可调，下次投入生效</small
            ><ChevronDown :size="13" />
          </summary>
          <div class="parameters-grid">
            <label v-for="spec in store.activeRecipe.parameters" :key="spec.field"
              >{{ spec.label }}
              <div>
                <input
                  v-model.number="parameterValues[spec.field]"
                  type="number"
                  :aria-label="spec.label"
                  :min="spec.min"
                  :max="spec.max"
                  step="100"
                  :disabled="disabled || !parametersStopped"
                /><span>ms</span
                ><button
                  :disabled="
                    disabled || !parametersStopped || !Number.isInteger(parameterValues[spec.field])
                  "
                  @click="
                    operate('parameter', {
                      name: spec.field,
                      value: parameterValues[spec.field],
                      revision: store.snapshot?.parameterRevision
                    })
                  "
                >
                  应用
                </button>
              </div></label
            >
          </div>
        </details>
      </main>
      <aside class="conditions-panel" aria-label="工况调试">
        <h3>工况调试</h3>
        <p>切换现场条件，观察工艺响应。</p>
        <div v-for="condition in conditions" :key="condition.name" class="condition-row">
          <div>
            <span>{{ condition.label }}</span
            ><small>{{
              read(condition.field) === undefined
                ? '状态未知'
                : read(condition.field)
                  ? condition.on
                  : condition.off
            }}</small>
          </div>
          <button
            role="switch"
            :aria-label="condition.label"
            :aria-checked="read(condition.field) === true"
            :class="{ enabled: read(condition.field), abnormal: condition.name.includes('Fault') }"
            :disabled="disabled"
            @click="operate('condition', { name: condition.name, value: !read(condition.field) })"
          >
            <i />
          </button>
        </div>
        <div class="condition-row">
          <div>
            <span>进水阀卡住</span
            ><small>{{
              !process ? '状态未知' : process.valveBlocked ? '机构卡住' : '动作正常'
            }}</small>
          </div>
          <button
            role="switch"
            aria-label="进水阀卡住"
            :aria-checked="process?.valveBlocked === true"
            :class="{ enabled: process?.valveBlocked, abnormal: true }"
            :disabled="disabled"
            @click="operate('environment', { name: 'valveBlocked', value: !process?.valveBlocked })"
          >
            <i />
          </button>
        </div>
        <div class="level-scenarios">
          <span>设置水箱工况</span>
          <div>
            <button
              :disabled="disabled"
              @click="operate('environment', { name: 'tankLevel', value: 1000 })"
            >
              低液位</button
            ><button
              :disabled="disabled"
              @click="operate('environment', { name: 'tankLevel', value: 5500 })"
            >
              正常水位</button
            ><button
              :disabled="disabled"
              @click="operate('environment', { name: 'tankLevel', value: 9000 })"
            >
              高液位
            </button>
          </div>
        </div>
        <button class="restore-conditions" :disabled="disabled" @click="restoreConditions">
          <RotateCcw :size="13" />恢复工况</button
        ><small class="reset-note">故障原因解除后，需在设备卡片单独复位。</small>
        <details class="station-events">
          <summary>
            状态记录 <small>{{ entries.length }}</small>
          </summary>
          <p v-for="(entry, i) in entries" :key="i">
            <time>{{ entry.time }}</time
            >{{ entry.text }}
          </p>
        </details>
        <div class="runtime-footer">
          <span
            >工程 {{ store.delivery?.manifest.config.projectVersion }} · 扫描
            {{ live ? store.snapshot?.scanSequence : '—' }}</span
          ><button :disabled="store.busy" @click="store.deploy()">
            <RotateCcw :size="12" />重新部署</button
          ><button :disabled="disabled" @click="operate('stop', null)">
            <Power :size="12" />停止运行
          </button>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.water-station {
  --ink: #193b4b;
  --muted: #6c8290;
  --line: #dce6eb;
  --blue: #176b86;
  --green: #237f6f;
  --red: #b94f43;
  color: var(--ink);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}
.station-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--line);
}
.station-tag {
  font-size: 12px;
  color: var(--muted);
}
h2 {
  font-size: 23px;
  margin: 4px 0 0;
  letter-spacing: 0.5px;
}
.station-state {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.station-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #9babb4;
}
.station-state i.online {
  background: var(--green);
}
.station-state small {
  color: var(--muted);
  border-left: 1px solid var(--line);
  padding-left: 12px;
  margin-left: 5px;
}
.station-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 238px;
}
.station-main {
  padding: 16px 22px 12px;
  min-width: 0;
}
.process-drawing {
  border: 1px solid #e7eef2;
  border-radius: 6px;
  overflow: hidden;
  background: #f8fbfc;
}
.process-drawing svg {
  display: block;
  width: 100%;
  height: auto;
  max-height: 352px;
}
.pipe-bed path {
  stroke: #c5d5de;
  stroke-width: 10;
  fill: none;
  stroke-linejoin: round;
}
.pipe path {
  stroke: #edf3f6;
  stroke-width: 5;
  fill: none;
  stroke-linejoin: round;
}
.pipe.flowing path {
  stroke: #2999b1;
  stroke-dasharray: 14 8;
  animation: water-flow 1.3s linear infinite;
}
.source-symbol {
  fill: #edf3f7;
  stroke: #668696;
  stroke-width: 2;
}
.valve-symbol {
  fill: #f5f9fb;
  stroke: #668696;
  stroke-width: 2;
}
.valve-symbol.moving {
  stroke: #176b86;
  fill: #d5e9ef;
}
.valve-symbol text {
  fill: #446777;
  stroke: none;
  font-size: 13px;
}
.valve-symbol.fault {
  fill: #f9e6dd;
  stroke: var(--red);
}
.device-text {
  fill: #23485b;
  font-size: 14px;
  font-weight: 600;
}
.muted-text {
  fill: #6c8290;
  font-size: 12px;
}
.alarm-text {
  fill: #b94f43;
  font-size: 12px;
}
.level-line {
  stroke: #668696;
  stroke-dasharray: 5 5;
  opacity: 0.5;
}
.scale-text {
  font-size: 10px;
  fill: #4d7487;
}
.level-value {
  font-size: 36px;
  font-weight: 650;
  fill: #1b5369;
  font-variant-numeric: tabular-nums;
}
.tank-caption {
  font-size: 12px;
  fill: #366a7e;
}
.pump-symbol circle {
  fill: #f7fafc;
  stroke: #7994a4;
  stroke-width: 2;
}
.pump-symbol path {
  fill: #c9d7df;
  stroke: #7994a4;
  stroke-width: 2;
}
.pump-symbol .hub {
  fill: #fff;
  stroke: #7994a4;
  stroke-width: 1;
}
.pump-symbol.running circle {
  fill: #e2f4ee;
  stroke: #237f6f;
}
.pump-symbol.running path {
  fill: #66b29b;
  stroke: #237f6f;
}
.pump-symbol.fault circle,
.pump-symbol.fault path {
  fill: #f6e9e3;
  stroke: #b94f43;
}
.pump-symbol .pump-base {
  fill: #d8e3e9;
}
.drawing-legend {
  display: flex;
  gap: 18px;
  justify-content: center;
  font-size: 10px;
  color: var(--muted);
  padding: 0 0 9px;
}
.drawing-legend span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.drawing-legend i {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
.flow-key {
  background: #2999b1;
}
.run-key {
  background: #237f6f;
}
.fault-key {
  background: #b94f43;
}
.station-message {
  display: flex;
  gap: 7px;
  align-items: center;
  background: #f0f5f7;
  padding: 10px 12px;
  font-size: 12px;
  min-height: 36px;
  margin: 12px 0;
  color: #486b7d;
  border-radius: 4px;
}
.station-message.warning {
  background: #fcf2e9;
  color: #97562e;
}
.station-controls {
  display: flex;
  gap: 9px;
}
.water-station button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: #fff;
  color: var(--ink);
  border: 1px solid #cbdbe4;
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.water-station button:hover:not(:disabled) {
  background: #edf4f7;
}
.water-station button:focus-visible {
  outline: 2px solid #258bab;
  outline-offset: 3px;
}
.water-station button:disabled {
  opacity: 0.42;
  cursor: default;
}
.station-controls button {
  height: 40px;
  flex: 1;
}
.station-controls .auto-button {
  background: var(--blue);
  color: #fff;
  border-color: var(--blue);
}
.station-controls .auto-button:hover:not(:disabled) {
  background: #12576d;
}
.station-controls .trip-button {
  color: var(--red);
  border-color: #e6c3bd;
  background: #fffafa;
}
.station-devices {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}
.station-devices article {
  padding: 12px 10px;
  background: #fafcfd;
  border: 1px solid #e2eaef;
  border-radius: 5px;
  min-width: 0;
}
.station-devices article.fault {
  background: #fff9f4;
  border-color: #ead4c7;
}
.station-devices article > div {
  display: flex;
  gap: 5px;
  justify-content: space-between;
  align-items: center;
}
.station-devices strong {
  font-size: 12px;
}
.station-devices article > div > span {
  color: #748996;
  font-size: 10px;
  white-space: nowrap;
}
.station-devices article > div > span.running {
  color: var(--green);
}
.station-devices p {
  font-size: 11px;
  color: var(--muted);
  margin: 9px 0;
}
.station-devices article.fault p {
  color: var(--red);
}
.station-devices footer {
  display: flex;
  justify-content: space-between;
  gap: 5px;
  align-items: center;
}
.station-devices small {
  font-size: 10px;
  color: #748996;
}
.station-devices button {
  font-size: 10px;
  padding: 4px 5px;
  background: transparent;
}
.station-parameters {
  margin-top: 14px;
  font-size: 12px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.station-parameters summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.station-parameters summary small {
  color: var(--muted);
  font-size: 10px;
  margin-left: auto;
}
.parameters-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 16px 0 3px;
}
.parameters-grid label {
  font-size: 11px;
  color: var(--muted);
}
.parameters-grid label > div {
  display: flex;
  border: 1px solid var(--line);
  align-items: center;
  border-radius: 4px;
  margin-top: 5px;
  padding: 4px 6px;
  gap: 7px;
}
.parameters-grid input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: 12px;
}
.parameters-grid button {
  padding: 4px 8px;
  white-space: nowrap;
}
.conditions-panel {
  background: #f4f8fa;
  border-left: 1px solid var(--line);
  padding: 23px 17px 14px;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.conditions-panel h3 {
  font-size: 15px;
  margin: 0 0 5px;
}
.conditions-panel > p {
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 13px;
}
.condition-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e2ebef;
  padding: 11px 0;
}
.condition-row span {
  font-size: 12px;
}
.condition-row small {
  display: block;
  font-size: 10px;
  color: var(--muted);
  margin-top: 4px;
}
.condition-row button {
  width: 34px;
  height: 20px;
  border: 0 !important;
  border-radius: 20px;
  background: #bdcbd4;
  justify-content: flex-start;
  padding: 3px;
}
.condition-row button i {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s;
}
.condition-row button.enabled {
  background: #337f91;
}
.condition-row button.enabled.abnormal {
  background: #bd7559;
}
.condition-row button.enabled i {
  transform: translateX(14px);
}
.level-scenarios {
  margin: 16px 0 12px;
}
.level-scenarios > span {
  font-size: 11px;
  color: var(--muted);
}
.level-scenarios > div {
  display: flex;
  gap: 5px;
  margin-top: 7px;
}
.level-scenarios button {
  font-size: 10px;
  padding: 7px 4px;
  flex: 1;
}
.restore-conditions {
  padding: 8px;
  width: 100%;
}
.reset-note {
  font-size: 10px;
  line-height: 1.6;
  color: var(--muted);
  margin-top: 8px;
}
.station-events {
  font-size: 11px;
  margin: 17px 0 10px;
  color: var(--muted);
}
.station-events summary {
  cursor: pointer;
}
.station-events p {
  font-size: 10px;
  line-height: 1.5;
}
.station-events time {
  display: block;
  font-variant-numeric: tabular-nums;
}
.runtime-footer {
  margin-top: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  border-top: 1px solid var(--line);
  padding-top: 13px;
}
.runtime-footer > span {
  font-size: 9px;
  width: 100%;
  color: var(--muted);
}
.runtime-footer button {
  flex: 1;
  padding: 7px 4px;
  font-size: 10px;
}
.station-error {
  padding: 12px 20px;
  background: #fff0ea;
  color: var(--red);
  font-size: 13px;
}
.station-error button {
  padding: 5px;
  margin-left: 12px;
}
@keyframes water-flow {
  to {
    stroke-dashoffset: -44;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pipe.flowing path {
    animation: none;
  }
}
@media (max-width: 1180px) {
  .station-main {
    padding: 12px;
  }
  .station-layout {
    grid-template-columns: minmax(0, 1fr) 205px;
  }
  .conditions-panel {
    padding: 18px 12px;
  }
  .station-devices {
    gap: 6px;
  }
  .station-devices article > div {
    align-items: flex-start;
    flex-direction: column;
  }
  .station-devices footer {
    flex-wrap: wrap;
  }
  .station-heading {
    padding: 16px 18px;
  }
  .process-drawing svg {
    min-height: 0;
  }
}
@media (max-height: 850px) and (min-width: 851px) {
  .station-heading {
    padding: 11px 18px;
  }
  .station-heading h2 {
    font-size: 21px;
  }
  .station-main {
    padding-top: 10px;
  }
  .conditions-panel {
    padding-top: 14px;
    padding-bottom: 10px;
  }
  .condition-row {
    padding: 6px 0;
    line-height: 1.3;
  }
  .condition-row small {
    margin-top: 3px;
  }
  .conditions-panel > p {
    margin-bottom: 8px;
  }
  .level-scenarios {
    margin-top: 12px;
    margin-bottom: 9px;
  }
  .station-events {
    margin-top: 12px;
  }
  .station-devices {
    margin-top: 10px;
  }
  .station-devices article {
    padding-top: 10px;
    padding-bottom: 9px;
  }
  .station-parameters {
    margin-top: 10px;
    padding-top: 9px;
  }
}
@media (max-width: 850px) {
  .station-layout {
    grid-template-columns: 1fr;
  }
  .conditions-panel {
    border-left: 0;
    border-top: 1px solid var(--line);
  }
  .station-devices {
    grid-template-columns: 1fr;
  }
  .station-devices article > div {
    flex-direction: row;
  }
  .parameters-grid {
    grid-template-columns: 1fr;
  }
  .process-drawing svg {
    min-height: 0;
  }
}
</style>
