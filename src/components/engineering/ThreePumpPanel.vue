<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertTriangle,
  ChevronDown,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  OctagonX
} from 'lucide-vue-next'
import CustomSelect from '../common/CustomSelect.vue'
import { useEngineeringStore } from '../../stores/engineeringStore'

const store = useEngineeringStore()
const operating = ref(false)
const live = computed(() => store.currentRuntime)
const read = (name: string) => (store.fields[name]?.[1] === 1 ? store.fields[name]?.[0] : undefined)
const number = (name: string) => (typeof read(name) === 'number' ? Number(read(name)) : undefined)
const automatic = computed(() => read('SYS_AUTO') === true)
const degraded = computed(() => automatic.value && read('SYS_DEG') === true)
const level = computed(() => (read('LEVEL_OK') === true ? number('LEVEL_M') : undefined))
const frequency = computed(() => (read('FREQ_OK') === true ? number('F_ACT_HZ') : undefined))
const disabled = computed(() => !live.value || store.busy || operating.value)
const labels = computed(() => store.delivery?.manifest.config.labels ?? store.activeRecipe.labels)
const parameters = computed(() => store.activeRecipe.parameters)
const configured = (key: string) => {
  const spec = parameters.value[key]!
  return number(spec.field) ?? store.delivery?.manifest.config.parameters[key] ?? spec.default
}
const normalUnavailableReason = computed(() => {
  if (!live.value) return '运行状态不可用'
  if (read('LEVEL_OK') !== true) return '液位信号无效'
  if (read('RUN_PERMIT') !== true) return '运行许可未成立'
  if (read('CONFIG_OK') !== true) return '液位或 PI 参数未就绪'
  if (number('P1_STATUS') === undefined || number('P1_STATUS') === 5)
    return '变频泵状态信号不可用'
  if (read('P1_F_L') !== false) return '变频泵故障尚未复位'
  if (read('P1_REM') !== true) return '变频泵远程自动未许可'
  if (read('FREQ_OK') !== true) return '实际频率反馈异常'
  return ''
})
const normalRestored = computed(() => degraded.value && normalUnavailableReason.value === '')
const stages = [
  '已停止',
  '液位待机',
  '变频泵启动',
  '单泵液位调节',
  '满频增援确认',
  '等待工频接替',
  '双泵联合排水',
  '减泵确认',
  '工频降级模式',
  '自动未投入'
]
const title = computed(() =>
  !live.value
    ? '等待部署'
    : normalRestored.value
      ? '工频降级 · 变频条件已恢复'
      : (stages[Number(read('SYS_STATUS'))] ?? '状态不可用')
)
const reason = computed(() => {
  if (!live.value) return '部署当前控制程序后，即可投入液位自动运行。'
  if (read('LEVEL_OK') !== true) return '液位信号无效，自动已退出；恢复信号后需重新投入。'
  if (read('RUN_PERMIT') !== true) return '运行许可未成立，恢复许可后需重新投入。'
  if (!degraded.value && read('FREQ_OK') !== true)
    return '实际频率反馈异常，正常调节不可用；不能以频率给定替代满频反馈。'
  if (!degraded.value && read('CONFIG_OK') !== true)
    return '液位或 PI 参数未就绪，停止后检查完整参数组。'
  if (read('LEVEL_HH'))
    return '集水井高高位报警；检查来水与排水能力，备用泵不会作为第三台自动投入。'
  if (read('P1_F_L') && !degraded.value)
    return '变频泵故障，正常调节已退出。设备停稳后可明确投入工频降级排水。'
  if (degraded.value)
    return normalRestored.value
      ? '变频调节条件已恢复；当前仍保持工频降级。先点击“停止降级”，待设备停稳后，再投入变频自动。'
      : `工频降级：${normalUnavailableReason.value}；P103主排、P102高位增援。恢复后需停止降级，再投入变频自动。`
  if (!automatic.value && number('OCCUPIED') !== 0)
    return '等待设备停止并确认反馈，停稳后可重新投入变频自动。'
  if (!automatic.value && normalUnavailableReason.value) return normalUnavailableReason.value
  const reasons: Record<number, string> = {
    1: '关键输入质量或许可异常，自动已退出。',
    3: '低水位保护，全部自动泵停止；回升到启变频液位后重新确认。',
    4: '实际满频且高位：观察液位下降趋势，再确认工频增援。',
    5: '等待液位到达启泵等级，或等待连续液位确认。',
    6: '等待最小停机时间或相邻启动间隔。',
    7: '等待设备可用、原泵停稳及接替间隔，未知反馈仍占容量。',
    8: '参数已改变，自动退出；完整核对后重新投入。',
    9: '正常调节条件未满足，请检查设备故障、控制权与反馈。'
  }
  if (read('P3_RUN')) return '工频备用泵已接替增援，P101继续液位调节。'
  return (
    reasons[Number(read('BLOCK_REASON'))] ??
    (automatic.value
      ? '按来水变化调速，按液位与实际满频情况投入工频增援。'
      : '投入变频自动，由P101先启动调节，P102按需增援，P103备用。')
  )
})
const pumpStatus = ['待机', '启动确认', '运行', '停止确认 / 就地运行', '故障隔离', '反馈不可用']
const faultNames = ['', '设备故障接点', '启动反馈超时', '停止反馈超时', '运行反馈丢失']
const pumps = computed(() =>
  [1, 2, 3].map((n) => ({
    n,
    label: labels.value[`pump${n}`],
    role:
      n === 1
        ? '变频主调'
        : n === 2
          ? '工频增援'
          : degraded.value
            ? '降级主排'
            : read('P3_DO')
              ? '备用接替'
              : '工频备用',
    run: read(`P${n}_RUN`) === true,
    command: read(`P${n}_DO`) === true,
    fault: read(`P${n}_F_L`) === true,
    status: pumpStatus[Number(read(`P${n}_STATUS`))] ?? '状态未知',
    detail:
      faultNames[Number(read(`P${n}_FAULT`))] ||
      (read(`P${n}_REM`) === false ? '控制权在就地' : '远程自动'),
    seconds: number(`P${n}_RT_S`)
  }))
)
const flowingPumps = computed(() => (live.value ? pumps.value.filter((p) => p.run) : []))
const suctionFlowPath = computed(() => {
  const first = flowingPumps.value[0]
  return first ? `M214 220H360V${57 + (first.n - 1) * 80}` : ''
})
const dischargeFlowPaths = computed(() =>
  flowingPumps.value
    .filter((p) => p.n !== 2)
    .map((p) => ({ n: p.n, path: `M754 ${57 + (p.n - 1) * 80}V137` }))
)
const markers = computed(() =>
  [
    { key: 'assistStartLevelM', label: '启工频', class: 'aux' },
    { key: 'vfdStartLevelM', label: '启变频', class: 'vfd' },
    { key: 'stopLevelM', label: '停泵', class: 'stop' }
  ].map((m) => ({ ...m, value: configured(m.key), y: 235 - (configured(m.key) / 3) * 210 }))
)
const waterY = computed(() => 235 - (Math.max(0, Math.min(3, level.value ?? 0)) / 3) * 210)
const canDegrade = computed(
  () =>
    live.value &&
    !automatic.value &&
    read('LEVEL_OK') === true &&
    read('RUN_PERMIT') === true &&
    number('OCCUPIED') === 0 &&
    number('P3_STATUS') !== undefined &&
    number('P3_STATUS') !== 5 &&
    read('P3_F_L') === false &&
    read('P3_REM') === true &&
    (read('P1_F_L') === true || read('FREQ_OK') === false || read('P1_REM') === false)
)
async function act(op: string, value: unknown) {
  if (disabled.value) return
  operating.value = true
  try {
    await store.action(op, value)
  } finally {
    operating.value = false
  }
}
const inflowOptions = [
  { label: '日常来水', value: 1, hint: '单泵调节' },
  { label: '来水增加', value: 2, hint: '工频增援' },
  { label: '来水停止', value: 0, hint: '减泵与低位停止' },
  { label: '超大来水', value: 3, hint: '能力不足报警' }
]
const conditions = [
  { name: 'permit', field: 'RUN_PERMIT', label: '运行许可' },
  { name: 'water', field: 'WATER_OK', label: '低水位许可' },
  { name: 'pump1Fault', field: 'P1_FLT', label: '变频泵故障' },
  { name: 'pump2Fault', field: 'P2_FLT', label: '工频泵故障' },
  { name: 'pump3Fault', field: 'P3_FLT', label: '备用泵故障' }
]
const edits = ref<Record<string, number>>({})
watch(
  [() => store.snapshot?.parameterRevision, () => store.delivery?.manifest.config.projectVersion],
  () => {
    for (const key of Object.keys(parameters.value)) edits.value[key] = configured(key)
  },
  { immediate: true }
)
async function apply(key: string) {
  const spec = parameters.value[key]!
  const value = edits.value[key]
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < spec.min ||
    value > spec.max
  ) {
    store.error = `${spec.label}需在${spec.min}–${spec.max}${spec.unit ?? ''}范围内`
    return
  }
  await act('parameter', { name: spec.field, value, revision: store.snapshot?.parameterRevision })
}
type Sample = { time: number; level?: number; frequency?: number }
const history = ref<Sample[]>([])
const entries = ref<Array<{ time: string; text: string }>>([])
let lastSample = -1
watch(
  () => store.snapshot?.runId,
  () => {
    history.value = []
    entries.value = []
    lastSample = -1
  }
)
watch(
  () => store.snapshot?.nowMs,
  (time) => {
    if (!live.value || time === undefined || time - lastSample < 500) return
    history.value.push({ time, level: level.value, frequency: frequency.value })
    history.value = history.value.filter((s) => time - s.time <= 120000).slice(-241)
    lastSample = time
  }
)
function segments(key: 'level' | 'frequency', max: number) {
  const result: string[] = []
  let points: string[] = []
  const end = history.value[history.value.length - 1]?.time ?? 0
  for (const sample of history.value) {
    const value = sample[key]
    if (value === undefined) {
      if (points.length) result.push(points.join(' '))
      points = []
      continue
    }
    points.push(
      `${20 + ((sample.time - end + 120000) / 120000) * 680},${85 - (Math.max(0, Math.min(max, value)) / max) * 72}`
    )
  }
  if (points.length) result.push(points.join(' '))
  return result
}
const levelSegments = computed(() => segments('level', 3))
const frequencySegments = computed(() => segments('frequency', 50))
watch(
  () => [title.value, read('P1_F_L'), read('P2_F_L'), read('P3_F_L'), read('SYS_ALARM')].join(':'),
  (_, old) => {
    if (!old || !live.value) return
    const faults = pumps.value.filter((p) => p.fault).map((p) => `${p.label}：${p.detail}`)
    entries.value.unshift({
      time: new Date().toLocaleTimeString('zh-CN'),
      text: [title.value, ...faults].join(' / ')
    })
    entries.value = entries.value.slice(0, 20)
  }
)
</script>

<template>
  <section class="pump-station" aria-label="三泵集水井液位控制">
    <header class="station-heading">
      <div>
        <span>集水井排水系统</span>
        <h2>{{ title }}</h2>
      </div>
      <span class="state-pill" :class="{ active: live, alarm: read('SYS_ALARM') }">
        <i />{{ !live ? '等待部署' : degraded ? '工频降级' : automatic ? '自动运行' : '控制就绪' }}
      </span>
    </header>
    <div class="station-layout">
      <div class="process-main">
        <div class="measurements">
          <div>
            <span>集水井液位</span><strong>{{ level?.toFixed(2) ?? '—' }}<small>m</small></strong>
          </div>
          <div :class="{ inactive: degraded }">
            <span>{{ degraded ? '调节目标（降级停用）' : '调节目标' }}</span><strong>{{ configured('targetLevelM').toFixed(2) }}<small>m</small></strong>
          </div>
          <div>
            <span>实际频率 / 给定</span><strong>{{ frequency?.toFixed(1) ?? '—'
            }}<small>/ {{ number('F_SET_HZ')?.toFixed(1) ?? '—' }} Hz</small></strong>
          </div>
          <div>
            <span>运行 / 占用台数</span><strong>{{ live ? pumps.filter((p) => p.run).length : '—'
            }}<small>/ {{ number('OCCUPIED') ?? '—' }}</small></strong>
          </div>
        </div>
        <svg
          class="process-diagram"
          viewBox="0 0 800 270"
          role="img"
          aria-label="集水井三级液位、一台变频主调泵与两台工频泵并联排水"
        >
          <defs>
            <clipPath id="three-pump-tank">
              <rect x="36" y="25" width="178" height="210" rx="4" />
            </clipPath>
          </defs>
          <path d="M18 25H36V235H214V25H231" fill="#f4f8fa" stroke="#9eb5c5" stroke-width="3" />
          <rect
            x="36"
            :y="waterY"
            width="178"
            :height="235 - waterY"
            fill="#abd7e4"
            clip-path="url(#three-pump-tank)"
          />
          <line x1="36" x2="214" :y1="waterY" :y2="waterY" stroke="#2094ae" stroke-width="2" />
          <text x="125" y="257" text-anchor="middle" class="tank-label">{{ labels.tank }}</text>
          <g v-for="m in markers" :key="m.key" :class="`level-mark ${m.class}`">
            <line x1="36" x2="224" :y1="m.y" :y2="m.y" stroke-dasharray="5 4" />
            <text x="231" :y="m.y + 4">{{ m.label }} {{ m.value.toFixed(2) }}m</text>
          </g>
          <line
            x1="45"
            x2="210"
            :y1="235 - (configured('targetLevelM') / 3) * 210"
            :y2="235 - (configured('targetLevelM') / 3) * 210"
            stroke="#2d6774"
            stroke-dasharray="2 4"
          />
          <path
            d="M214 220H360V57"
            fill="none"
            class="branch-pipe"
            stroke-width="7"
            stroke-linejoin="round"
          />
          <path
            d="M754 57V217M754 137H788"
            fill="none"
            class="branch-pipe"
            stroke-width="7"
            stroke-linejoin="round"
          />
          <path
            v-for="(p, i) in pumps"
            :key="p.n"
            :transform="`translate(0 ${57 + i * 80})`"
            d="M360 0H472M526 0H754"
            fill="none"
            class="branch-pipe"
            stroke-width="6"
          />
          <g v-if="flowingPumps.length" class="running">
            <path
              :d="suctionFlowPath"
              fill="none"
              class="branch-pipe"
              stroke-width="7"
              stroke-linejoin="round"
            />
            <path :d="suctionFlowPath" fill="none" class="flow-line" stroke-width="2" />
            <g v-for="route in dischargeFlowPaths" :key="route.n">
              <path :d="route.path" fill="none" class="branch-pipe" stroke-width="7" />
              <path :d="route.path" fill="none" class="flow-line" stroke-width="2" />
            </g>
            <path d="M754 137H788" fill="none" class="branch-pipe" stroke-width="7" />
            <path d="M754 137H788" fill="none" class="flow-line" stroke-width="2" />
            <path d="m296 216 6 4-6 4" class="flow-direction" />
          </g>
          <path
            d="m780 130 8 7-8 7"
            fill="none"
            :stroke="flowingPumps.length ? '#2493a6' : '#bdccd6'"
            stroke-width="2.5"
            stroke-linejoin="round"
          />
          <text x="788" y="119" text-anchor="end" class="outlet-label">排水出口</text>
          <g
            v-for="(p, i) in pumps"
            :key="p.n"
            :transform="`translate(0 ${57 + i * 80})`"
            :class="{ running: p.run && live, faulted: p.fault }"
          >
            <path
              v-if="p.run && live"
              d="M360 0H472M526 0H754"
              fill="none"
              class="branch-pipe"
              stroke-width="6"
            />
            <path
              v-if="p.run && live"
              d="M360 0H472M526 0H754"
              fill="none"
              class="flow-line"
              stroke-width="2"
            />
            <path v-if="p.run && live" d="M420-4l6 4-6 4M704-4l6 4-6 4" class="flow-direction" />
            <circle cx="500" cy="0" r="27" class="pump-body" stroke-width="2" />
            <path d="M484 12V-12L515 0Z" class="pump-rotor" />
            <path
              d="M665-7L678 0L665 7ZM678-7V7"
              fill="white"
              stroke="#a4b8c5"
              stroke-width="1.5"
            />
            <text x="550" y="-17" class="pump-label">{{ p.label }}</text>
            <text x="550" y="22" class="pump-caption">
              {{ p.role }} · {{ !live ? '状态未知' : p.status }}
            </text>
          </g>
        </svg>
        <div class="process-reason" :class="{ warning: read('SYS_ALARM') }">
          <AlertTriangle v-if="read('SYS_ALARM')" :size="15" />
          <span>{{ reason }}</span><b v-if="Number(read('REMAIN_MS')) > 0">{{ (Number(read('REMAIN_MS')) / 1000).toFixed(1) }}s</b>
        </div>
        <div class="control-actions">
          <button
            class="primary"
            :disabled="
              disabled ||
                automatic ||
                normalUnavailableReason !== '' ||
                number('OCCUPIED') !== 0
            "
            @click="act('command', 'SYS_STA')"
          >
            <Play :size="16" />{{
              degraded ? '工频降级已投入' : automatic ? '变频自动已投入' : number('OCCUPIED') ? '等待设备停稳' : '投入变频自动'
            }}
          </button>
          <button :disabled="disabled" @click="act('command', 'SYS_STP')">
            <Square :size="16" />{{ degraded ? '停止降级' : '正常停止' }}
          </button>
          <button class="danger" :disabled="disabled" @click="act('command', 'SYS_TRIP')">
            <OctagonX :size="16" />立即停止
          </button>
        </div>
        <div class="pump-cards">
          <article v-for="p in pumps" :key="p.n" :class="{ faulted: p.fault }">
            <div>
              <strong>{{ p.label }}</strong><span>{{ p.role }}</span>
            </div>
            <p><i :class="{ running: p.run && live, alarm: p.fault }" />{{ p.status }}</p>
            <small>{{
              p.fault ? p.detail : p.n === 1 && normalRestored ? '变频已恢复，等待退出降级' : p.command && !p.run ? '等待运行反馈' : p.detail
            }}</small>
            <footer>
              <span>{{ p.seconds ?? '—' }} s</span><button :disabled="disabled || !p.fault" @click="act('command', `P${p.n}_RST`)">
                故障复位
              </button>
            </footer>
          </article>
        </div>
        <div class="trend-heading">
          <span>液位与频率趋势</span><small><i class="level-color" />液位 0–3m <i class="frequency-color" />实际频率 0–50Hz ·
            近120秒</small>
        </div>
        <svg
          class="trend-chart"
          viewBox="0 0 720 100"
          role="img"
          aria-label="液位与变频泵实际频率趋势"
        >
          <path d="M20 13H700M20 49H700M20 85H700" stroke="#e7edf2" fill="none" />
          <line
            x1="20"
            x2="700"
            :y1="85 - (configured('targetLevelM') / 3) * 72"
            :y2="85 - (configured('targetLevelM') / 3) * 72"
            stroke="#a9bdc8"
            stroke-dasharray="4 4"
          />
          <polyline
            v-for="(points, n) in levelSegments"
            :key="`l${n}`"
            :points="points"
            fill="none"
            stroke="#168da5"
            stroke-width="2"
          />
          <polyline
            v-for="(points, n) in frequencySegments"
            :key="`f${n}`"
            :points="points"
            fill="none"
            stroke="#b28a45"
            stroke-width="1.7"
          />
        </svg>
        <details class="parameter-settings">
          <summary>
            <SlidersHorizontal :size="15" />液位与调节参数<small>停止后修改，重新投入生效</small><ChevronDown :size="14" />
          </summary>
          <div class="parameters-grid">
            <label v-for="(spec, key) in parameters" :key="key"><span>{{ spec.label }}</span>
              <div>
                <input
                  v-model.number="edits[key]"
                  type="number"
                  :aria-label="spec.label"
                  :min="spec.min"
                  :max="spec.max"
                  :step="spec.step ?? 1"
                  :disabled="disabled || automatic || Number(read('OCCUPIED')) > 0"
                ><small>{{ spec.unit }}</small><button
                  :disabled="
                    disabled ||
                      automatic ||
                      Number(read('OCCUPIED')) > 0 ||
                      edits[key] === configured(key)
                  "
                  @click="apply(key)"
                >
                  应用
                </button>
              </div></label>
          </div>
          <p>
            停泵 &lt; 调节目标 &lt; 启变频 &lt; 启工频。PI
            增益仅对本软件模型整定，实际设备需重新核验。
          </p>
        </details>
      </div>
      <aside class="conditions-panel" aria-label="三泵工况调试">
        <h3>工况调试</h3>
        <p>改变来水与现场条件，观察控制响应。</p>
        <label class="inflow-picker"><span>上游来水</span><CustomSelect
          :model-value="store.snapshot?.process?.inflowMode ?? 1"
          :options="inflowOptions"
          aria-label="上游来水工况"
          :disabled="disabled"
          @change="act('environment', { name: 'inflow', value: $event })"
        /></label>
        <div v-for="c in conditions" :key="c.name" class="condition-row">
          <span>{{ c.label
          }}<small>{{
            read(c.field) === undefined ? '状态未知' : c.name.includes('Fault') ? (read(c.field) ? '已触发' : '正常') : (read(c.field) ? '允许' : '禁止')
          }}</small></span><button
            role="switch"
            :aria-label="c.label"
            :aria-checked="read(c.field) === true"
            :class="{ on: read(c.field), fault: c.name.includes('Fault') }"
            :disabled="disabled"
            @click="act('condition', { name: c.name, value: read(c.field) !== true })"
          >
            <i />
          </button>
        </div>
        <details class="advanced-conditions">
          <summary>信号与故障注入</summary>
          <div
            v-for="c in [
              { name: 'levelFailed', label: '液位信号异常' },
              { name: 'frequencyFailed', label: '频率反馈异常' }
            ]"
            :key="c.name"
            class="condition-row"
          >
            <span>{{ c.label }}</span><button
              role="switch"
              :aria-label="c.label"
              :aria-checked="
                store.snapshot?.process?.[c.name as 'levelFailed' | 'frequencyFailed'] === true
              "
              :class="{
                on: store.snapshot?.process?.[c.name as 'levelFailed' | 'frequencyFailed'],
                fault: true
              }"
              :disabled="disabled"
              @click="
                act('environment', {
                  name: c.name,
                  value: !store.snapshot?.process?.[c.name as 'levelFailed' | 'frequencyFailed']
                })
              "
            >
              <i />
            </button>
          </div>
        </details>
        <button
          v-if="canDegrade"
          class="degraded-action"
          :disabled="disabled"
          @click="act('command', 'DEG_STA')"
        >
          投入工频降级排水
        </button>
        <p v-if="canDegrade" class="degraded-note">
          {{ normalUnavailableReason }}。降级由P103主排、P102高位增援；变频恢复后需先停止降级，再投入变频自动。
        </p>
        <p class="condition-note">
          解除故障条件后，需在对应设备卡片复位。故障复位不切换运行模式。
        </p>
        <details class="status-records">
          <summary>状态记录 {{ entries.length }}</summary>
          <p v-for="(e, i) in entries" :key="i">
            <time>{{ e.time }}</time>{{ e.text }}
          </p>
        </details>
        <div class="runtime-actions">
          <small>工程 {{ store.delivery?.manifest.config.projectVersion }} · 扫描
            {{ store.snapshot?.scanSequence ?? '—' }}</small><button :disabled="store.busy || operating" @click="store.deploy()">
            <RotateCcw :size="14" />{{ live ? '重新部署' : '部署并运行' }}
          </button><button :disabled="disabled" @click="act('stop', null)">停止软件运行器</button>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.pump-station {
  --ink: #142c43;
  --muted: #6b8295;
  --line: #dde7ee;
  color: var(--ink);
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}
.station-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--line);
}
.station-heading > div > span {
  color: #587b92;
  font-size: 11px;
}
h2 {
  font-size: 22px;
  margin: 7px 0 0;
  line-height: 1.3;
}
.state-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  font-size: 11px;
  color: #708597;
  background: #eff4f7;
  padding: 7px 11px;
  border-radius: 20px;
}
.state-pill i,
.pump-cards p i {
  height: 6px;
  width: 6px;
  border-radius: 50%;
  background: #9dafba;
}
.state-pill.active {
  color: #187953;
  background: #eaf7ef;
}
.state-pill.active i,
.pump-cards p i.running {
  background: #238263;
}
.state-pill.alarm {
  color: #ab4539;
  background: #fff1e9;
}
.state-pill.alarm i,
.pump-cards p i.alarm {
  background: #b95344;
}
.station-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 224px;
}
.process-main {
  min-width: 0;
  padding: 18px 24px;
}
.measurements {
  display: grid;
  grid-template-columns: 0.9fr 0.9fr 1.5fr 1fr;
  gap: 12px;
}
.measurements > div {
  min-width: 0;
}
.measurements span {
  display: block;
  color: var(--muted);
  font-size: 11px;
}
.measurements strong {
  display: block;
  font-size: 24px;
  font-weight: 620;
  margin-top: 6px;
  white-space: nowrap;
}
.measurements small {
  margin-left: 5px;
  font-size: 11px;
  color: var(--muted);
  font-weight: 400;
}
.measurements .inactive strong {
  color: var(--muted);
}
.process-diagram {
  width: 100%;
  display: block;
  margin: 10px 0;
}
.process-diagram text {
  font-family: inherit;
  fill: #496a80;
  font-size: 12px;
}
.process-diagram .tank-label {
  font-weight: 600;
  font-size: 14px;
}
.process-diagram .pump-label {
  font-size: 14px;
  fill: var(--ink);
  font-weight: 600;
}
.process-diagram .pump-caption {
  font-size: 11px;
}
.level-mark line {
  stroke: #8dabbc;
}
.level-mark.aux line {
  stroke: #b08d54;
}
.level-mark.stop line {
  stroke: #bb7f79;
}
.branch-pipe {
  stroke: #bdccd6;
}
.pump-body {
  fill: #f7fafc;
  stroke: #9db7c8;
}
.pump-rotor {
  fill: #9db7c8;
}
.running .branch-pipe {
  stroke: #59a6b6;
}
.running .pump-body {
  fill: #ebf6f8;
  stroke: #2493a6;
}
.running .pump-rotor {
  fill: #2493a6;
}
.faulted .pump-body {
  stroke: #bd6054;
  fill: #fff3ef;
}
.faulted .pump-rotor {
  fill: #bd6054;
}
.flow-line {
  stroke: white;
  stroke-dasharray: 6 16;
  stroke-linejoin: round;
  animation: flowing 1.2s linear infinite;
}
.flow-direction {
  fill: none;
  stroke: white;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.process-diagram .outlet-label {
  font-size: 10px;
}
@keyframes flowing {
  to {
    stroke-dashoffset: -44;
  }
}
.process-reason {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 11px;
  background: #f1f6f9;
  color: #58788e;
  border-radius: 5px;
  font-size: 11px;
  line-height: 1.7;
  min-height: 19px;
}
.process-reason.warning {
  background: #fff4e9;
  color: #956835;
}
.process-reason span {
  flex: 1;
}
.process-reason svg {
  flex-shrink: 0;
}
.process-reason b {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  white-space: nowrap;
}
button {
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid #c4d5e1;
  border-radius: 5px;
  padding: 9px 12px;
  background: white;
  color: #365e78;
  font-size: 12px;
}
button:hover:not(:disabled) {
  background: #eff6fa;
}
button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
button:focus-visible,
input:focus-visible,
summary:focus-visible {
  outline: 2px solid #146c94;
  outline-offset: 3px;
}
button.primary {
  background: #146c94;
  border-color: #146c94;
  color: white;
}
button.primary:hover:not(:disabled) {
  background: #105e82;
}
button.danger {
  border-color: #e4b9bd;
  color: #af3944;
  background: #fff8f8;
}
.control-actions {
  display: grid;
  grid-template-columns: 1.25fr 1fr 1fr;
  gap: 9px;
  margin: 12px 0;
}
.control-actions button {
  min-height: 37px;
}
.pump-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 9px;
}
.pump-cards article {
  background: #f7f9fb;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 12px;
  min-width: 0;
}
.pump-cards article.faulted {
  border-color: #e7c6bd;
  background: #fff8f4;
}
.pump-cards article > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pump-cards strong {
  font-size: 12px;
}
.pump-cards article > div > span {
  font-size: 10px;
  color: var(--muted);
}
.pump-cards p {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 9px 0 4px;
  font-size: 12px;
}
.pump-cards > article > small {
  display: block;
  font-size: 10px;
  color: var(--muted);
  min-height: 14px;
}
.pump-cards footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  margin-top: 9px;
}
.pump-cards footer > span {
  color: var(--muted);
  font-size: 10px;
}
.pump-cards button {
  font-size: 10px;
  padding: 3px 6px;
}
.trend-heading {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  margin-top: 16px;
  font-size: 11px;
}
.trend-heading small {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  font-size: 9px;
}
.trend-heading i {
  height: 2px;
  width: 12px;
  display: inline-block;
}
.level-color {
  background: #168da5;
}
.frequency-color {
  background: #b28a45;
  margin-left: 6px;
}
.trend-chart {
  width: 100%;
  height: 82px;
  display: block;
}
.parameter-settings {
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
summary {
  cursor: pointer;
}
.parameter-settings summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  list-style: none;
}
.parameter-settings summary small {
  color: var(--muted);
  font-size: 10px;
  margin-left: auto;
}
.parameters-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 16px;
}
.parameters-grid label > span {
  display: block;
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 6px;
}
.parameters-grid label > div {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid #d3e0e9;
  border-radius: 5px;
  padding: 4px 5px;
}
.parameters-grid input {
  border: 0;
  width: 65px;
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 12px;
  padding: 5px;
  color: #294d66;
  background: transparent;
}
.parameters-grid small {
  font-size: 9px;
  color: var(--muted);
}
.parameters-grid button {
  padding: 4px 6px;
  font-size: 10px;
}
.parameter-settings > p {
  color: var(--muted);
  font-size: 10px;
  line-height: 1.7;
}
.conditions-panel {
  border-left: 1px solid var(--line);
  padding: 20px 17px;
  background: #f5f8fa;
}
.conditions-panel h3 {
  margin: 0 0 7px;
  font-size: 14px;
}
.conditions-panel > p {
  font-size: 11px;
  line-height: 1.8;
  color: var(--muted);
  margin: 0 0 16px;
}
.inflow-picker > span {
  font-size: 11px;
  display: block;
  margin-bottom: 7px;
  color: #4f6f85;
}
.inflow-picker {
  display: block;
  margin-bottom: 12px;
}
.condition-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 13px 0;
  border-bottom: 1px solid var(--line);
}
.condition-row > span {
  font-size: 11px;
}
.condition-row small {
  display: block;
  color: var(--muted);
  font-size: 10px;
  margin-top: 4px;
}
.condition-row button {
  position: relative;
  width: 35px;
  height: 21px;
  border-radius: 12px;
  background: #bdcbd5;
  border: 0;
  padding: 0;
  flex-shrink: 0;
}
.condition-row button i {
  width: 15px;
  height: 15px;
  position: absolute;
  left: 3px;
  top: 3px;
  background: white;
  border-radius: 50%;
  transition: transform 0.15s;
}
.condition-row button.on {
  background: #2c8f85;
}
.condition-row button.on.fault {
  background: #bd6054;
}
.condition-row button.on i {
  transform: translateX(14px);
}
.advanced-conditions {
  margin-top: 15px;
  font-size: 10px;
  color: #607e93;
}
.conditions-panel .condition-note {
  font-size: 10px;
  margin: 15px 0;
}
.degraded-action {
  width: 100%;
  margin-top: 12px;
  color: #956027;
  border-color: #dbc69c;
  background: #fffaf0;
}
.conditions-panel .degraded-note {
  margin: 8px 0;
  color: #956027;
  font-size: 10px;
}
.status-records {
  margin: 16px 0;
  font-size: 10px;
  color: #607e93;
}
.status-records p {
  font-size: 10px;
  line-height: 1.7;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.status-records time {
  display: block;
  color: #8ba0af;
  font-size: 9px;
}
.runtime-actions {
  display: grid;
  gap: 8px;
  margin-top: 19px;
}
.runtime-actions small {
  font-size: 9px;
  color: #8ba0af;
  margin-bottom: 4px;
}
.runtime-actions button {
  font-size: 11px;
}
@media (max-width: 1250px) {
  .station-heading {
    padding: 14px 17px;
  }
  h2 {
    font-size: 20px;
    margin-top: 5px;
  }
  .station-layout {
    grid-template-columns: minmax(0, 1fr) 190px;
  }
  .process-main {
    padding: 14px 17px;
  }
  .measurements {
    gap: 7px;
  }
  .measurements strong {
    font-size: 20px;
    margin-top: 5px;
  }
  .measurements span,
  .measurements small {
    font-size: 9px;
  }
  .process-diagram {
    margin: 5px 0;
  }
  .pump-cards article {
    padding: 9px;
  }
  .pump-cards strong {
    font-size: 11px;
  }
  .pump-cards article > div > span {
    font-size: 9px;
  }
  .pump-cards p {
    margin-top: 6px;
    font-size: 11px;
  }
  .control-actions {
    gap: 7px;
    margin: 10px 0;
  }
  .control-actions button {
    padding: 8px;
    font-size: 11px;
  }
  .trend-heading {
    margin-top: 12px;
  }
  .conditions-panel {
    padding: 15px 13px;
  }
  .condition-row {
    padding: 10px 0;
  }
}
@media (max-width: 900px) {
  .station-layout {
    grid-template-columns: minmax(0, 1fr) 170px;
  }
  .process-main {
    padding: 12px;
  }
  .measurements {
    grid-template-columns: 1fr 1fr;
  }
  .pump-cards {
    gap: 5px;
  }
  .pump-cards footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
@media (prefers-reduced-motion: reduce) {
  .flow-line {
    animation: none;
  }
  .condition-row button i {
    transition: none;
  }
}
</style>
