<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowRight,
  Check,
  ChevronRight,
  FileInput,
  FileText,
  Layers,
  Maximize2,
  MonitorPlay,
  Play,
  Sparkles,
  X,
  RefreshCw
} from 'lucide-vue-next'
import hljs from 'highlight.js/lib/core'
import c from 'highlight.js/lib/languages/c'
import yaml from 'highlight.js/lib/languages/yaml'
import 'highlight.js/styles/github.css'
import { useEngineeringStore } from '../../stores/engineeringStore'
import WaterStationPanel from '../../components/engineering/WaterStationPanel.vue'
import ThreePumpPanel from '../../components/engineering/ThreePumpPanel.vue'
import CustomSelect from '../../components/common/CustomSelect.vue'
import { PROCESS_RECIPES, processRecipe } from '../../types/engineering'
import { load } from 'js-yaml'
import SimulationPanel from '../../components/engineering/SimulationPanel.vue'
import PhysicalDeploymentPanel from '../../components/engineering/PhysicalDeploymentPanel.vue'
import EngineeringChat from '../../components/engineering/EngineeringChat.vue'
import { scenarioPresentation, workflowCompleted } from '../../utils/engineeringPresentation'
hljs.registerLanguage('c', c)
hljs.registerLanguage('yaml', yaml)
const store = useEngineeringStore(),
  route = useRoute(),
  router = useRouter()
const draft = ref('')
const showSource = ref(false)
const codeTab = ref<'code' | 'yaml' | 'points' | 'log'>('code')
const steps = ['点表核对', '需求设计', '工程生成', '仿真运行', 'HMI 联调', '实板烧录']
const hostPassed = computed(() => store.delivery?.manifest.hostReport.status === 'HOST_PASS')
const completed = computed(() => workflowCompleted({
  workspaceId: store.workspaceId, delivery: store.delivery,
  hostPassed: hostPassed.value, currentRuntime: store.currentRuntime
}))
const stepHints = [
  '导入点表，核对信号类型与工艺角色。',
  '与 AI 明确设备分工、启停条件和保护规则。',
  '查看控制程序、点位说明与实际验证记录。',
  '把当前版本部署到本机设备模型。',
  '改变工况，观察控制程序的实际响应。',
  '准备匹配固件，再进入设备写入与校验。'
]
const selectedCase = ref('three-pump-level-control')
const previewRecipe = computed(() =>
  store.step === 0 ? processRecipe(selectedCase.value) : store.activeRecipe
)
const isWater = computed(() => previewRecipe.value.id === 'water-supply-station')
const isThree = computed(() => previewRecipe.value.id === 'three-pump-level-control')
const scenario = computed(() => scenarioPresentation(previewRecipe.value))
const guideVisible = ref(false)
const caseOptions = computed(() =>
  [...PROCESS_RECIPES]
    .sort(
      (a, b) =>
        Number(b.id === 'three-pump-level-control') - Number(a.id === 'three-pump-level-control')
    )
    .map((r) => ({ label: r.name, value: r.id, hint: r.ioSummary }))
)
watch(() => store.workspaceId, () => { draft.value = '' })
const code = computed(
  () =>
    hljs.highlight(
      codeTab.value === 'yaml' ? (store.delivery?.yaml ?? '') : (store.delivery?.code ?? ''),
      { language: codeTab.value === 'yaml' ? 'yaml' : 'c' }
    ).value
)
const canStep = (i: number) =>
  i === 0 ||
  (i === 1 && !!store.workspaceId) ||
  (i === 2 && !!store.delivery) ||
  (i === 3 && hostPassed.value) ||
  (i === 4 && store.hmiReady) ||
  (i === 5 && !!store.delivery && store.hmiReady)
function openDeviceFlashing() {
  void router.push({
    name: 'FirmwareFlashing',
    query: { from: 'ai-assistant', profile: 'kz3_f427_app' }
  })
}
function openHmi() {
  if (store.hmiReady) {
    store.step = 4
    return
  }
  // 生成过程回到同一段对话，完成后由已校验的场景结果进入工艺画面。
  store.step = 1
  void store.send(
    '请为当前工程生成工艺操作画面，使用当前版本北向点位展示设备分工、运行状态、报警与趋势，提供受支持的自动投入、正常停止、立即停止、参数调整和设备复位。保留本案例既定控制规则。',
    'hmi'
  )
}
onMounted(() => {
  void store.initialize()
  if (route.name === 'EngineeringHmi' && store.hmiReady) store.step = 4
})
async function chooseFile() {
  try {
    const result = await invoke<[string, string] | null>('engineering_pick_file')
    if (result)
      await store.importText(result[1], result[0].split(/[\\/]/).pop() ?? 'project_io.yaml')
  } catch (e) {
    store.error = String(e)
  }
}
async function fullScreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    /* Native desktop window can still be maximized. */
  }
}
async function exportFile(name: string, content: string) {
  try {
    await invoke('app_save_file', {
      defaultName: name,
      content,
      filterName: '工程文件',
      filterExt: name.split('.').slice(-1)[0] ?? 'txt'
    })
  } catch (e) {
    store.error = String(e)
  }
}
function exportCurrentFile() {
  if (!store.delivery) return
  if (codeTab.value === 'points') {
    const lines = [
      ['字段', '用途', '绑定', '类型', '权限', '地址'],
      ...store.delivery.manifest.fields.map((f) => [
        f.name,
        f.description,
        f.bind,
        f.c_type,
        f.access,
        f.reference
      ])
    ]
    void exportFile(
      'northbound.csv',
      '\ufeff' +
        lines
          .map((row) => row.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','))
          .join('\r\n')
    )
  } else if (codeTab.value === 'log') void exportFile('host-build.log', store.delivery.log)
  else
    void exportFile(
      codeTab.value === 'yaml' ? 'project_io.yaml' : 'logic.c',
      codeTab.value === 'yaml' ? store.delivery.yaml : store.delivery.code
    )
}
const legacyTerminals = [
  {
    terminal: 'DI1',
    source: 'board.di01',
    name: '启动按钮',
    kind: '输入',
    detail: '新上升沿 · 虚拟脉冲'
  },
  {
    terminal: 'DI2',
    source: 'board.di02',
    name: '正常停止',
    kind: '输入',
    detail: '停止优先 · 虚拟脉冲'
  },
  {
    terminal: 'DI3',
    source: 'board.di03',
    name: '运行许可',
    kind: '输入',
    detail: '保持开关 · 恢复不自启'
  },
  {
    terminal: 'DO1',
    source: 'board.do01',
    name: '后级控制输出',
    kind: '输出',
    detail: '先接通 · 延时断开'
  },
  {
    terminal: 'DO2',
    source: 'board.do02',
    name: '前级控制输出',
    kind: '输出',
    detail: '延时接通 · 先断开'
  }
]
const terminals = computed(() => {
  if (store.step > 0 && store.inputText) {
    const p = (
      load(store.inputText) as {
        project: {
          points: {
            inputs: Array<{ name: string; source: string; description: string }>
            outputs: Array<{ name: string; source: string; description: string }>
          }
        }
      }
    ).project.points
    return [...p.inputs, ...p.outputs].map((point) => ({
      terminal: point.source
        .replace('board.', '')
        .toUpperCase()
        .replace(/^(DI|DO|AI|AO)0/, '$1'),
      source: point.source,
      name: point.description.split('，')[0],
      kind: /^board\.(di|ai)/.test(point.source) ? '输入' : '输出',
      detail: point.name
    }))
  }
  if (previewRecipe.value.terminals) return previewRecipe.value.terminals
  if (!isWater.value) return legacyTerminals
  const names = [
    '清水箱低位',
    '清水箱高位',
    '上游水源许可',
    '下游供水需求',
    'P101运行反馈',
    'P101故障',
    'P102运行反馈',
    'P102故障',
    'XV101开到位',
    'XV101关到位',
    '设备运行许可',
    'P101启动',
    'P102启动',
    'XV101开向',
    'XV101关向'
  ]
  return Object.values(previewRecipe.value.bindings).map((source, i) => ({
    terminal: source.replace('board.', '').toUpperCase().replace('DI0', 'DI').replace('DO0', 'DO'),
    source,
    name: names[i],
    kind: source.includes('.di') ? '输入' : '输出',
    detail: source.includes('.di') ? '状态与联锁信号' : '设备控制信号'
  }))
})
</script>
<template>
  <div class="engineering-page" :class="{ 'hmi-mode': store.step === 4 }">
    <header class="engineering-top">
      <div class="product-mark">
        <Layers :size="23" />
        <div>
          <h1>AI 辅助工作台</h1>
          <span>工艺需求分析 · 控制工程生成 · 仿真联调</span>
        </div>
      </div>
      <div class="top-actions">
        <CustomSelect
          v-if="store.versions.length > 1"
          class="version-picker"
          :model-value="store.delivery?.manifest.config.projectVersion"
          :options="
            store.versions.map((version) => ({ label: `历史版本 ${version}`, value: version }))
          "
          aria-label="历史成功版本"
          :disabled="store.busy || store.sending"
          @change="store.selectVersion(String($event))"
        /><span class="mode-tag">{{ store.step === 5 ? '实板部署' : '软件联调' }}</span><span class="connection-dot" :class="{ online: store.connected }" />
        <small>{{ store.connected ? `OpenCode ${store.serverVersion}` : 'AI 尚未连接' }}</small><button v-if="store.delivery" :disabled="store.busy" @click="store.exportPackage()">
          导出工程包
        </button><button aria-label="全屏展示" title="全屏展示" @click="fullScreen">
          <Maximize2 :size="17" />
        </button>
      </div>
    </header>
    <nav class="workflow" aria-label="工程流程">
      <template v-for="(name, i) in steps" :key="name">
        <button
          :class="{ active: store.step === i, complete: completed[i] }"
          :aria-current="store.step === i ? 'step' : undefined"
          :title="stepHints[i]"
          :disabled="!canStep(i) || store.busy || store.sending"
          @click="store.step = i"
        >
          <span><Check v-if="completed[i] && store.step !== i" :size="14" /><template v-else>{{ i + 1 }}</template></span>{{ name }}
        </button><ChevronRight v-if="i < steps.length - 1" :size="15" class="step-arrow" />
      </template>
    </nav>
    <div v-if="store.error && store.step !== 1" class="error-banner" role="alert">
      <span>{{ store.error }}</span><button aria-label="关闭错误" @click="store.error = ''"><X :size="16" /></button>
    </div>
    <div v-if="store.busy && store.step !== 1" class="job-banner" role="status">
      <RefreshCw :size="16" class="spin" />{{ store.stage
      }}<button
        v-if="store.workspaceId && /生成|编译|打包|部署/.test(store.stage)"
        class="text-button"
        @click="store.cancel()"
      >
        取消任务
      </button>
    </div>

    <section v-if="store.step === 0" class="import-layout">
      <div class="intro-pane">
        <span class="section-kicker">KZ3 F427 工业控制平台</span>
        <h2>工业控制工程<br>智能设计与联调</h2>
        <p>面向现场实施的 AI 辅助工程平台。贯通点表核对、工艺方案设计、控制代码生成与 HMI 仿真联调，形成可追溯的工程交付资料。</p>
        <dl class="engineering-value">
          <div><dt>工艺需求分析</dt><dd>结合点位补全启停、联锁与故障处理。</dd></div>
          <div><dt>控制工程生成</dt><dd>复用已验证案例，确认参数后生成工程。</dd></div>
          <div><dt>运行仿真验证</dt><dd>改变来水、注入故障，现场观察控制响应。</dd></div>
        </dl>
        <div class="recipe-select">
          <span>当前工艺场景</span>
          <CustomSelect
            v-model="selectedCase"
            :options="caseOptions"
            aria-label="应用场景"
            size="lg"
          />
        </div>
        <div class="import-actions">
          <button class="primary" :disabled="store.busy || store.sending" @click="store.loadSample(selectedCase)">
            <Play :size="17" />使用当前工艺点表开始
          </button><button class="secondary" :disabled="store.busy || store.sending" @click="chooseFile">
            <FileInput :size="17" />导入现场点表
          </button>
        </div>
        <small>本机仿真无需连接控制器。支持现有三类案例的匹配点表。<br>支持 project_io.yaml / .yml / .ymal</small>
        <details class="environment-details">
          <summary>运行环境与点表格式</summary>
          <p>{{ store.environment ? '本机编译环境检查通过，可生成并运行控制程序。' : '本机编译环境尚未就绪，请检查上方提示。' }}<br>点表需采用 KZ3 工程格式，具备完整、唯一的通道与中文描述。</p>
        </details><button v-if="store.workspaceId" class="text-button" :disabled="store.busy || store.sending" @click="store.step = 1">
          继续当前工程 <ArrowRight :size="15" />
        </button>
      </div>
      <div class="scenario-board">
        <div class="board-title">
          <div>
            <span class="section-kicker">本次应用场景</span>
            <h3>{{ previewRecipe.name }}</h3>
          </div>
          <span class="point-count">{{
            previewRecipe.ioSummary ?? (isWater ? '11 DI / 4 DO' : '3 DI / 2 DO')
          }}</span>
        </div>
        <p class="scenario-purpose">{{ scenario.purpose }}</p>
        <div class="scenario-outline">
          <section><h4>设备配置与分工</h4><p>{{ scenario.equipment }}</p></section>
          <section><h4>控制策略</h4><p>{{ scenario.sequence }}</p></section>
          <section><h4>联锁与故障处理</h4><p>{{ scenario.protection }}</p></section>
        </div>
        <div class="scenario-observations"><span>联调观察</span><b v-for="item in scenario.observations" :key="item.title">{{ item.title }}</b></div>
        <details class="preview-points">
          <summary>查看 {{ terminals.length }} 个板载点位</summary>
          <div v-for="point in terminals" :key="point.source" class="terminal-row">
            <span class="terminal" :class="{ output: point.kind === '输出' }">{{
              point.terminal
            }}</span>
            <div>
              <strong>{{ point.name }}</strong><small>{{ point.source }} · {{ point.detail }}</small>
            </div>
            <span class="direction">{{ point.kind }}</span>
          </div>
        </details>
      </div>
    </section>

    <section v-else-if="store.step === 1" class="design-layout">
      <aside class="facts-pane">
        <span class="section-kicker">工程资料</span>
        <h3>点表结构已核对</h3>
        <p>{{ store.activeRecipe.name }}<br>下一步结合需求确认设备角色与控制条件。</p>
        <details class="requirements-scope" open><summary>需求核对范围</summary><ul><li>设备分工与控制目标</li><li>启停条件与联动时序</li><li>故障接替与恢复方式</li><li>参数、画面与联调要求</li></ul></details>
        <details class="facts-point-list">
          <summary>已导入 {{ terminals.length }} 个点位</summary>
          <div v-for="p in terminals" :key="p.source" class="fact-point">
            <b>{{ p.terminal }}</b><span>{{ p.name }}</span>
          </div>
        </details>
        <button class="text-button" @click="showSource = !showSource">
          <FileText :size="14" />{{ showSource ? '收起原始点表' : '查看原始点表' }}
        </button>
        <pre v-if="showSource" class="raw-input">{{ store.inputText }}</pre>
        <div class="input-proof">SHA-256 {{ store.inputHash.slice(0, 12) }}…</div>
        <div class="fixed-rules">
          <strong>案例控制边界</strong>
          <p>{{ store.activeRecipe.description }}</p>
        </div>
      </aside>
      <EngineeringChat v-model="draft" :points="terminals" />
    </section>

    <section v-else-if="store.step === 2 && store.delivery" class="artifacts-layout">
      <div class="artifact-heading">
        <div>
          <span class="section-kicker">当前生成版本 {{ store.delivery.manifest.config.projectVersion }}</span>
          <h2>{{ hostPassed ? '控制工程已生成，主机验证通过' : '控制工程已生成，验证结果待核对' }}</h2>
          <p>{{ store.activeRecipe.name }} · 依据已确认参数生成，控制代码与点位说明同步归档。</p>
        </div>
        <button class="primary" :disabled="store.busy || !hostPassed" @click="store.step = 3">
          下一步：仿真运行 <ArrowRight :size="16" />
        </button>
      </div>
      <div class="artifact-checks" v-if="hostPassed">
        <span><Check :size="15" />点表与控制逻辑一致</span><span><Check :size="15" />控制程序编译及主机执行检查通过</span><span><Check :size="15" />{{ store.delivery.manifest.fields.length }} 个北向点位可供画面绑定</span>
      </div>
      <p class="artifact-explainer">控制程序负责设备联动，北向点位连接操作画面与运行状态。下方可查看本次实际产物与验证记录；下一步观察它在变化工况下的响应。</p>
      <div class="code-tabs">
        <button
          v-for="tab in [
            ['code', '控制代码'],
            ['yaml', '工程点表'],
            ['points', '北向点位说明'],
            ['log', '验证记录']
          ] as const"
          :key="tab[0]"
          :class="{ selected: codeTab === tab[0] }"
          @click="codeTab = tab[0]"
        >
          {{ tab[1] }}
        </button><button class="export-button" @click="exportCurrentFile">导出当前文件</button>
      </div>
      <table v-if="codeTab === 'points'" class="north-table">
        <thead>
          <tr>
            <th>字段</th>
            <th>用途</th>
            <th>绑定</th>
            <th>类型</th>
            <th>权限</th>
            <th>地址</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in store.delivery.manifest.fields" :key="f.name">
            <td>{{ f.name }}</td>
            <td>{{ f.description }}</td>
            <td>{{ f.bind }}</td>
            <td>{{ f.c_type }}</td>
            <td>{{ f.access === 'read' ? '只读' : '受控写' }}</td>
            <td>{{ f.reference }}</td>
          </tr>
        </tbody>
      </table>
      <pre v-else-if="codeTab === 'log'" class="source-code">{{ store.delivery.log }}</pre>
      <pre v-else class="source-code"><code v-html="code" /></pre>
    </section>

    <section v-else-if="store.step === 3 && store.delivery" class="deploy-layout">
      <div class="deployment-card">
        <div class="deployment-icon"><MonitorPlay :size="34" /></div>
        <span class="section-kicker">当前工程 {{ store.delivery.manifest.config.projectVersion }}</span>
        <h2>控制程序仿真部署</h2>
        <p>
          在本机部署当前控制程序，连接{{
            isThree ? '集水井、三台泵与变频器' : isWater ? '水箱、泵与阀门' : '前后级设备'
          }}的仿真模型。<br>随后生成工艺画面，观察启停联动、运行反馈和故障处理。
        </p>
        <div class="deploy-facts">
          <span>当前版本控制程序</span><span>模型产生设备反馈</span><span>无需实板烧录</span>
        </div>
        <button class="primary deploy-main" :disabled="store.busy || store.sending || !hostPassed" @click="store.deploy()">
          <Play :size="17" />{{ store.currentRuntime ? '重新部署当前工程' : '部署到本机仿真' }}
        </button>
        <p v-if="store.currentRuntime" class="deployment-success">
          <Check :size="15" />程序已运行，设备自动控制待投入
        </p>
        <div v-if="store.currentRuntime" class="generate-hmi">
          <h3>工艺操作画面生成</h3>
          <p>沿用当前版本的设备与北向点位，将控制结果呈现为流程、状态和操作。</p>
          <button
            class="secondary"
            :disabled="store.busy || store.sending || (!store.hmiReady && !store.connected)"
            @click="openHmi"
          >
            <Sparkles :size="16" />{{ store.hmiReady ? '进入 HMI 联调' : 'AI 生成工艺画面' }}
          </button><small v-if="!store.connected && !store.hmiReady">请回到需求设计页连接智能服务后继续。</small>
        </div>
      </div>
      <aside class="deployment-proof">
        <h3>联调验证项目</h3>
        <ol class="deployment-observations"><li v-for="item in scenario.observations" :key="item.title"><strong>{{ item.title }}</strong><p>{{ item.expected }}</p></li></ol>
        <details class="deployment-identity">
          <summary>查看当前版本与部署标识</summary>
          <dl>
            <dt>案例</dt>
            <dd>{{ store.activeRecipe.name }} v1.0.0</dd>
            <dt>C 核心源码</dt>
            <dd>{{ String(store.delivery.manifest.identity.sourceSha256).slice(0, 20) }}…</dd>
            <dt>运行器 SHA-256</dt>
            <dd>{{ store.delivery.manifest.hostReport.runnerSha256.slice(0, 20) }}…</dd>
            <dt>范围</dt>
            <dd>软件联调</dd>
            <dt>运行版本</dt>
            <dd>{{ store.snapshot?.identity?.projectVersion ?? '尚未部署' }}</dd>
          </dl>
        </details>
        <p>当前为本机软件联调。实板部署使用独立固件与设备校验流程。</p>
      </aside>
    </section>

    <template v-else-if="store.step === 4">
      <div class="hmi-toolbar">
        <div>
          <span class="section-kicker">工艺运行与联调</span>
          <h2>{{ store.delivery?.scene.name }}</h2>
        </div>
        <div class="hmi-toolbar-actions">
          <button class="secondary" :aria-expanded="guideVisible" @click="guideVisible = !guideVisible">{{ guideVisible ? '收起联调指引' : '联调操作指引' }}</button>
          <button
            class="secondary"
            :disabled="!store.delivery"
            @click="exportFile('demo.scene.json', JSON.stringify(store.delivery?.scene, null, 2))"
          >
            <FileText :size="15" />导出 HMI 配置
          </button>
          <button class="primary" :disabled="store.busy || !store.delivery" @click="store.step = 5">
            准备实板烧录 <ArrowRight :size="15" />
          </button>
        </div>
      </div>
      <div v-if="guideVisible" class="commissioning-guide" aria-label="联调操作指引">
        <article v-for="(item, index) in scenario.observations" :key="item.title"><b>{{ index + 1 }}. {{ item.title }}</b><p>{{ item.action }}</p><small>{{ item.expected }}</small></article>
      </div>
      <ThreePumpPanel v-if="store.activeRecipe.id === 'three-pump-level-control'" />
      <WaterStationPanel
        v-else-if="store.activeRecipe.id === 'water-supply-station'"
      /><SimulationPanel v-else />
    </template>
    <PhysicalDeploymentPanel
      v-else-if="store.step === 5 && store.delivery"
      @back="store.step = 4"
      @flash="openDeviceFlashing"
    />
    <details v-if="store.eventLog.length" class="event-log">
      <summary>
        执行记录 <small>{{ store.eventLog.length }}</small>
      </summary>
      <div v-for="(e, i) in store.eventLog" :key="i">
        <time>{{ e.time }}</time>{{ e.text }}
      </div>
    </details>
  </div>
</template>
<style scoped>
.engineering-value { margin: 20px 0 26px; border-left: 2px solid #9fbfcf; padding-left: 17px; }
.engineering-value div + div { margin-top: 13px; }
.engineering-value dt { font-size: 13px; color: #214d67; font-weight: 600; }
.engineering-value dd { margin: 4px 0 0; font-size: 12px; line-height: 1.7; color: #607e90; }
.scenario-board { padding: 26px; border: 1px solid #d6e2e9; border-radius: 12px; background: #fff; align-self: start; }
.scenario-purpose { color: #416b81; font-size: 14px; line-height: 1.9; margin: 0 0 20px; }
.scenario-outline section { border-top: 1px solid #e3ebf0; padding: 16px 0; }
.scenario-outline h4 { margin: 0 0 7px; font-size: 13px; color: #214d67; }
.scenario-outline p { font-size: 12px; line-height: 1.9; color: #627d90; margin: 0; }
.scenario-observations { display: flex; gap: 8px 12px; flex-wrap: wrap; align-items: center; padding: 12px 0; font-size: 11px; color: #688292; }
.scenario-observations b { color: #286b87; font-weight: 500; }
.preview-points { border-top: 1px solid #e3ebf0; padding-top: 16px; font-size: 12px; color: #396882; }
.preview-points summary, .environment-details summary, .facts-pane summary, .deployment-identity summary { cursor: pointer; }
.preview-points[open] { max-height: 290px; overflow-y: auto; scrollbar-width: thin; }
.environment-details { margin-top: 12px; color: #6b8596; font-size: 11px; }
.intro-pane .environment-details p { font-size: 11px; margin: 8px 0; }
.facts-pane details { font-size: 12px; color: #3a637c; margin: 18px 0; }
.requirements-scope ul { padding-left: 17px; line-height: 2; font-size: 11px; color: #637d90; }
.artifact-explainer { font-size: 12px; color: #607d90; line-height: 1.8; margin: 0 0 18px; }
.deployment-observations { padding-left: 20px; color: #3b657d; font-size: 12px; }
.deployment-observations li { padding: 5px 0; }
.deployment-observations p { font-size: 12px; line-height: 1.8; color: #6f8596; margin: 6px 0; }
.deployment-identity { margin: 25px 0; font-size: 12px; color: #5a788e; }
.deployment-identity dl { margin-top: 15px; }
.commissioning-guide { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 25px; background: #fff; border: 1px solid #d6e2e9; padding: 20px; border-radius: 9px; margin-bottom: 16px; }
.commissioning-guide article { font-size: 12px; line-height: 1.8; color: #355f78; }
.commissioning-guide p { margin: 6px 0; }
.commissioning-guide small { font-size: 11px; color: #6a8293; }
.engineering-page {
  background: #f2f5f8;
  min-height: 100%;
  padding: 22px 28px 32px;
  color: #142c43;
  font-family: inherit;
}
.engineering-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 25px;
  gap: 20px;
}
.product-mark {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #146c94;
}
.product-mark h1 {
  font-size: 20px;
  font-weight: 650;
  margin: 0 0 4px;
  color: #142c43;
}
.product-mark span {
  font-size: 12px;
  color: #708397;
}
.top-actions {
  display: flex;
  gap: 9px;
  align-items: center;
}
.top-actions small {
  font-size: 11px;
  color: #61788a;
}
.top-actions button {
  display: flex;
  background: transparent;
  border: 0;
  color: #60798b;
  padding: 8px;
}
.mode-tag {
  font-size: 11px;
  border: 1px solid #c6d9e5;
  color: #2d6b8d;
  border-radius: 5px;
  padding: 5px 8px;
}
.connection-dot {
  height: 6px;
  width: 6px;
  border-radius: 50%;
  background: #a3b0bc;
  margin-left: 7px;
}
.connection-dot.online {
  background: #18794e;
}
.workflow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border: 1px solid #dce5ed;
  border-radius: 10px;
  padding: 13px 18px;
  margin-bottom: 24px;
  gap: 7px;
}
.workflow button {
  display: flex;
  gap: 10px;
  align-items: center;
  border: 0;
  background: transparent;
  color: #788a9a;
  padding: 6px;
  font-size: 13px;
  white-space: nowrap;
}
.workflow button > span {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #edf2f6;
  color: #74899c;
  font-size: 12px;
}
.workflow button.active {
  color: #146c94;
  font-weight: 650;
}
.workflow button.active > span {
  background: #146c94;
  color: #fff;
}
.workflow button.complete:not(.active) > span {
  background: #e9f6ee;
  color: #18794e;
}
.step-arrow {
  color: #b8c6d0;
}
.error-banner,
.job-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 15px;
  border-radius: 7px;
  font-size: 13px;
  margin-bottom: 16px;
}
.error-banner {
  background: #fff0f1;
  color: #a2343d;
  border: 1px solid #efced1;
}
.error-banner button {
  border: 0;
  background: none;
  color: inherit;
}
.job-banner {
  justify-content: flex-start;
  background: #e9f3fa;
  color: #146c94;
}
.spin {
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
button {
  cursor: pointer;
  font-family: inherit;
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
button:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 2px solid #146c94;
  outline-offset: 3px;
}
.primary,
.secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 41px;
  padding: 9px 16px;
  border-radius: 6px;
  font-size: 13px;
  border: 1px solid #146c94;
  background: #146c94;
  color: white;
  white-space: nowrap;
}
.secondary {
  background: white;
  color: #365c76;
  border-color: #c6d5e0;
}
.wide {
  width: 100%;
}
.text-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 7px 0;
  border: 0;
  background: transparent;
  color: #146c94;
}
.section-kicker {
  font-size: 12px;
  color: #52798f;
}
.import-layout {
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 40px;
  max-width: 1080px;
  margin: 25px auto;
}
.intro-pane {
  padding: 10px 0;
}
.intro-pane h2 {
  font-size: clamp(27px, 2.5vw, 37px);
  line-height: 1.45;
  letter-spacing: -1px;
  margin: 18px 0;
}
.intro-pane p {
  font-size: 15px;
  color: #5c768b;
  line-height: 1.9;
  max-width: 370px;
  margin-bottom: 28px;
}
.import-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.intro-pane > small {
  display: block;
  font-size: 11px;
  color: #8495a4;
  line-height: 1.9;
  margin-top: 17px;
}
.point-board {
  background: #fff;
  border: 1px solid #dae4ec;
  border-radius: 13px;
  padding: 25px;
}
.board-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
}
.board-title h3 {
  font-size: 20px;
  margin: 8px 0 0;
}
.point-count {
  font-size: 11px;
  background: #edf5fa;
  padding: 7px 9px;
  color: #146c94;
  border-radius: 5px;
}
.terminal-row {
  display: flex;
  align-items: center;
  gap: 14px;
  border-top: 1px solid #e9eef3;
  padding: 16px 0;
}
.terminal {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 34px;
  background: #eaf3f9;
  color: #146c94;
  font-size: 12px;
  font-weight: 600;
  border-radius: 5px;
}
.terminal.output {
  color: #4a7680;
  background: #edf5f4;
}
.terminal-row strong {
  font-size: 13px;
  font-weight: 550;
}
.terminal-row small {
  display: block;
  color: #8194a4;
  font-size: 10px;
  margin-top: 6px;
}
.direction {
  margin-left: auto;
  font-size: 11px;
  color: #96a4af;
}
.timing-note {
  font-size: 11px;
  color: #6c8597;
  border-top: 1px solid #e9eef3;
  padding-top: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.design-layout {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.facts-pane {
  padding: 15px 10px 0 0;
  max-height: calc(100vh - 226px);
  overflow-y: auto;
  scrollbar-width: thin;
}
.facts-pane h3 {
  font-size: 17px;
  margin: 10px 0;
}
.facts-pane p {
  font-size: 12px;
  color: #6f8497;
  line-height: 1.8;
}
.fact-point {
  display: flex;
  gap: 9px;
  font-size: 11px;
  padding: 12px 0;
  border-bottom: 1px solid #dfe7ed;
}
.fact-point b {
  color: #146c94;
  min-width: 28px;
  font-weight: 550;
}
.recipe-select {
  display: block;
  font-size: 12px;
  color: #557387;
  margin: 20px 0;
}
.recipe-select :deep(.custom-select-container) {
  display: flex;
  width: 100%;
  max-width: 360px;
  border: 1px solid #cbdbe4;
  border-radius: 5px;
  padding: 10px;
  background: white;
  margin-top: 7px;
  color: #193b4b;
}
.version-picker {
  max-width: 155px;
}
.water-point-board {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 18px;
  align-content: start;
}
.water-point-board .board-title,
.water-point-board .timing-note {
  grid-column: 1/-1;
}
.water-point-board .terminal-row {
  min-width: 0;
  padding: 10px 0;
}
.water-point-board .terminal-row strong {
  font-size: 12px;
}
.water-point-board .terminal-row small {
  font-size: 10px;
}
.water-point-board .direction {
  display: none;
}
.water-point-board .terminal {
  font-size: 11px;
  min-width: 40px;
}
.input-proof {
  font-size: 9px;
  color: #94a2ae;
  margin-top: 8px;
  overflow-wrap: anywhere;
}
.fixed-rules {
  margin-top: 25px;
  border-left: 2px solid #bfd6e4;
  padding-left: 12px;
}
.fixed-rules strong {
  font-size: 12px;
}
.raw-input {
  font-size: 9px;
  max-height: 250px;
  overflow: auto;
  background: #fff;
  padding: 8px;
}
.artifact-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
}
.artifact-heading h2,
.hmi-toolbar h2 {
  font-size: 25px;
  margin: 10px 0;
}
.artifact-heading p {
  font-size: 12px;
  color: #71879a;
}
.artifact-checks {
  display: flex;
  gap: 23px;
  margin: 22px 0;
  font-size: 12px;
  color: #18794e;
  flex-wrap: wrap;
}
.artifact-checks span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.code-tabs {
  display: flex;
  align-items: center;
  gap: 5px;
  background: white;
  border: 1px solid #dbe5ed;
  border-radius: 8px 8px 0 0;
  padding: 8px;
}
.code-tabs button {
  border: 0;
  background: none;
  color: #6b8499;
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 5px;
}
.code-tabs button.selected {
  background: #eaf3f9;
  color: #146c94;
}
.code-tabs .export-button {
  margin-left: auto;
}
.source-code {
  margin: 0;
  padding: 23px;
  background: #fff;
  border: 1px solid #dbe5ed;
  border-top: 0;
  max-height: 58vh;
  overflow: auto;
  font-size: 12px;
  line-height: 1.8;
  color: #243c51;
  white-space: pre;
}
.north-table {
  width: 100%;
  background: white;
  border-collapse: collapse;
  font-size: 11px;
}
.north-table th,
.north-table td {
  text-align: left;
  padding: 11px 12px;
  border-bottom: 1px solid #e5ecf2;
  white-space: nowrap;
}
.north-table th {
  color: #8194a4;
  font-weight: 500;
}
.deploy-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 24px;
}
.deployment-card {
  text-align: center;
  background: #fff;
  border: 1px solid #dce5ed;
  border-radius: 12px;
  padding: 35px 25px;
}
.deployment-icon {
  color: #146c94;
  margin-bottom: 18px;
}
.deployment-card h2 {
  font-size: 28px;
  margin: 14px 0;
}
.deployment-card > p {
  font-size: 13px;
  line-height: 1.9;
  color: #70879a;
}
.deploy-facts {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 23px 0;
}
.deploy-facts span {
  padding: 6px 9px;
  background: #f2f6f9;
  border-radius: 5px;
  color: #7490a3;
  font-size: 10px;
}
.deploy-main {
  min-height: 45px;
}
.deployment-card .deployment-success {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #18794e;
  font-size: 12px;
}
.generate-hmi {
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px solid #e5edf3;
}
.generate-hmi h3 {
  font-size: 17px;
  margin: 0;
}
.generate-hmi p {
  font-size: 12px;
  color: #8395a4;
}
.generate-hmi small {
  display: block;
  margin: 12px;
  color: #738da0;
  font-size: 11px;
}
.deployment-proof {
  padding: 10px 0;
}
.deployment-proof h3 {
  font-size: 14px;
}
.deployment-proof dt {
  font-size: 11px;
  color: #8095a5;
  margin-top: 24px;
}
.deployment-proof dd {
  margin: 7px 0;
  font-size: 11px;
  color: #3c6079;
  overflow-wrap: anywhere;
}
.deployment-proof > p {
  font-size: 10px;
  line-height: 1.8;
  color: #92a1ad;
  margin-top: 30px;
}
.hmi-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 18px;
}
.hmi-toolbar h2 {
  font-size: 20px;
}
.hmi-toolbar-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.event-log {
  margin-top: 25px;
  border-top: 1px solid #dbe5ed;
  padding-top: 13px;
  color: #698399;
  font-size: 11px;
}
.event-log summary {
  cursor: pointer;
}
.event-log summary small {
  font-size: 10px;
  margin-left: 6px;
  color: #a0b0bd;
}
.event-log > div {
  display: flex;
  gap: 15px;
  padding: 7px 0;
  font-size: 10px;
}
.event-log time {
  color: #98a9b5;
  white-space: nowrap;
}
@media (max-width: 1250px) {
  .engineering-page {
    padding: 20px;
  }
  .design-layout {
    grid-template-columns: 170px minmax(0, 1fr);
    gap: 12px;
  }
  .intro-pane h2 {
    font-size: 32px;
  }
  .import-layout {
    gap: 30px;
  }
  .workflow button {
    font-size: 12px;
    gap: 6px;
  }
}
@media (max-width: 1060px) {
  .design-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .facts-pane {
    display: none;
  }
  .import-layout {
    margin: 25px auto;
    gap: 24px;
  }
  .workflow {
    padding: 10px;
  }
  .workflow button {
    flex-direction: column;
    gap: 5px;
    font-size: 11px;
  }
  .step-arrow {
    display: none;
  }
  .workflow button > span {
    width: 22px;
    height: 22px;
  }
  .deploy-layout {
    grid-template-columns: 1fr;
  }
  .deployment-proof {
    display: none;
  }
  .north-table {
    display: block;
    overflow: auto;
  }
}
@media (max-width: 800px) {
  .commissioning-guide { grid-template-columns: 1fr; }
  .top-actions small,
  .step-arrow {
    display: none;
  }
  .workflow {
    gap: 0;
  }
  .workflow button {
    flex-direction: column;
    gap: 5px;
    font-size: 10px;
  }
  .design-layout {
    grid-template-columns: 1fr;
  }
  .import-layout {
    grid-template-columns: 1fr;
  }
  .intro-pane h2 {
    font-size: 29px;
  }
  .intro-pane h2 br {
    display: none;
  }
  .artifact-heading {
    flex-wrap: wrap;
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
.hmi-mode {
  padding: 16px 20px 20px;
}
.hmi-mode .engineering-top {
  margin-bottom: 9px;
}
.hmi-mode .product-mark span {
  display: none;
}
.hmi-mode .workflow {
  padding: 5px 12px;
  margin-bottom: 9px;
}
.hmi-mode .hmi-toolbar {
  margin-bottom: 10px;
}
.hmi-mode .hmi-toolbar .section-kicker {
  display: none;
}
.hmi-mode .hmi-toolbar h2 {
  font-size: 17px;
  margin: 3px 0;
}
</style>
