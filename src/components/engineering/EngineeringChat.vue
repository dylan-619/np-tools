<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  LoaderCircle,
  MessageSquareText,
  Plug,
  Settings2,
  SlidersHorizontal,
  Square,
  X
} from 'lucide-vue-next'
import { useEngineeringStore } from '../../stores/engineeringStore'
import {
  chineseEngineeringText,
  chineseUnit,
  conversationError,
  engineeringModelLabel,
  renderEngineeringReply
} from '../../utils/engineeringConversation'
import type { CaseConfig } from '../../types/engineering'
import { structuredCandidates } from '../../utils/engineeringContract'
import CustomSelect from '../common/CustomSelect.vue'
import EngineeringConfirmation from './EngineeringConfirmation.vue'
import { requirementDraft, scenarioPresentation } from '../../utils/engineeringPresentation'

defineProps<{ points: Array<{ terminal: string; name?: string }> }>()
const draft = defineModel<string>({ required: true })
const store = useEngineeringStore()
const scenario = computed(() => scenarioPresentation(store.activeRecipe))
const conversation = ref<HTMLElement | null>(null)
const composer = ref<HTMLTextAreaElement | null>(null)
const confirmationArea = ref<HTMLElement | null>(null)
const settingsVisible = ref(!store.connected)
const authVisible = ref(false)
const username = ref('opencode'),
  password = ref('')
const followLatest = ref(true)
const questionChoices = ref<Record<string, Record<number, string[]>>>({})
const questionFree = ref<Record<string, Record<number, string>>>({})
const replies = computed(() =>
  store.messages.filter((message) => message.text.trim()).map((message) => ({
    ...message,
    html:
      message.role === 'assistant' ? renderEngineeringReply(message.text, store.activeRecipe) : ''
  }))
)
const lastAssistant = computed(
  () => store.messages.filter((m) => m.role === 'assistant' && m.text.trim()).slice(-1)[0]
)
const configurationReply = computed(() => lastAssistant.value ? structuredCandidates(lastAssistant.value.text)
  .some((value) => (value as { schema?: string }).schema === 'np-tools-expo-case-config/v1') : false)
const proposalReady = computed(
  () =>
    lastAssistant.value?.completed === true &&
    !store.candidate &&
    store.requestIntent !== 'hmi' &&
    (!configurationReply.value || !store.delivery) &&
    !store.sending &&
    !store.busy &&
    !store.pending.length &&
    !store.error
)
const generating = computed(() => store.busy && /生成|编译|验证工程/.test(store.stage))
const activity = computed(() =>
  store.busy
    ? generating.value ? '正在生成控制工程' : store.stage || '正在处理请求'
    : store.requestIntent === 'hmi'
      ? '正在整理操作界面'
      : store.requestIntent === 'config'
        ? '正在整理待确认参数'
        : store.replyPhase === 'replying'
          ? '正在回复工艺方案'
          : '正在结合点位梳理需求'
)
const chinese = (text: string) => chineseEngineeringText(text, store.activeRecipe)
const permissionNames: Record<string, string> = {
  read: '读取工程资料',
  edit: '调整工程文件',
  write: '写入工程文件',
  bash: '运行本地工具',
  external_directory: '访问工程外的目录',
  webfetch: '读取参考资料'
}
async function toLatest() {
  followLatest.value = true
  await nextTick()
  const hasContent = store.messages.length || store.pending.length || store.candidate || store.sending || store.busy
  conversation.value?.scrollTo({ top: hasContent ? conversation.value.scrollHeight : 0 })
}
function onScroll() {
  const area = conversation.value
  if (area) followLatest.value = area.scrollHeight - area.scrollTop - area.clientHeight < 100
}
watch(
  [
    () => store.messages.map((m) => m.text).join(''),
    () => store.pending.length,
    () => store.candidate,
    () => store.sending,
    () => store.busy,
    () => store.stage
  ],
  async () => {
    if (followLatest.value) await toLatest()
  },
  { flush: 'post' }
)
watch(() => store.candidate, async (config) => {
  if (!config || store.busy || !followLatest.value) return
  await nextTick()
  const area = conversation.value, form = confirmationArea.value
  if (area && form) area.scrollTop += form.getBoundingClientRect().top - area.getBoundingClientRect().top - 12
}, { flush: 'post' })
watch(
  () => store.connected,
  (connected) => {
    if (connected) settingsVisible.value = false
  }
)
watch(
  () => store.workspaceId,
  () => {
    questionChoices.value = {}
    questionFree.value = {}
    followLatest.value = true
  }
)
watch(draft, async () => {
  await nextTick()
  if (composer.value) {
    composer.value.style.height = 'auto'
    composer.value.style.height = `${Math.min(150, Math.max(58, composer.value.scrollHeight))}px`
  }
})
onMounted(toLatest)
async function send() {
  const text = draft.value.trim()
  if (!text || !store.connected || store.sending || store.busy || store.pending.length) return
  draft.value = ''
  followLatest.value = true
  await store.send(text)
}
function onComposerKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault()
    void send()
  }
}
function revise() {
  composer.value?.focus()
}
function beginWithCase() {
  // 已输入的现场需求保留；补充提纲时显式追加，不覆盖用户文字。
  const outline = requirementDraft(store.activeRecipe)
  draft.value = draft.value.trim() ? `${draft.value.trim()}\n\n${outline}` : outline
  revise()
}
function confirm(config: CaseConfig) {
  store.candidate = config
  store.confirmed = true
  followLatest.value = true
  void store.confirmAndGenerate()
}
function adopt() {
  followLatest.value = true
  void store.send(
    '采用当前工艺方案，请整理中文参数确认表；需要调整的事项继续在对话中确认。',
    'config'
  )
}
function chooseAnswer(id: string, index: number, label: string, multiple = false) {
  const rows = (questionChoices.value[id] ??= {})
  rows[index] = multiple
    ? rows[index]?.includes(label)
      ? rows[index]!.filter((x) => x !== label)
      : [...(rows[index] ?? []), label]
    : [label]
}
function hasAnswers(p: (typeof store.pending)[number]) {
  return p.questions?.every(
    (_, i) => questionChoices.value[p.id]?.[i]?.length || questionFree.value[p.id]?.[i]?.trim()
  )
}
function submitAnswers(p: (typeof store.pending)[number]) {
  if (!hasAnswers(p)) return
  followLatest.value = true
  void store.answer(
    p.id,
    p.questions!.map((_, i) =>
      questionFree.value[p.id]?.[i]?.trim()
        ? [questionFree.value[p.id]![i]!.trim()]
        : (questionChoices.value[p.id]?.[i] ?? [])
    )
  )
}
</script>

<template>
  <section class="engineering-chat" aria-label="工艺需求对话">
    <header class="chat-heading">
      <div class="engineer-identity">
        <span class="engineer-avatar"><MessageSquareText :size="19" /></span>
        <div>
          <h2>现场实施协作工程师</h2>
          <p>{{ store.activeRecipe.name }} · {{ points.length }} 个点位结构已核对</p>
        </div>
      </div>
      <div class="chat-tools">
        <span class="service-state" :class="{ online: store.connected }"><i />{{ store.connected ? '服务已连接' : '等待连接' }}</span>
        <button
          type="button"
          class="icon-button"
          aria-label="智能服务设置"
          :aria-expanded="settingsVisible"
          @click="settingsVisible = !settingsVisible"
        >
          <Settings2 :size="17" />
        </button>
      </div>
    </header>
    <div v-if="settingsVisible" class="service-settings">
      <label class="server-address">本机智能服务地址<input
        v-model="store.baseUrl"
        aria-label="OpenCode服务地址"
        placeholder="http://127.0.0.1:4096"
        :disabled="store.busy || store.sending"
      ></label>
      <button
        class="outlined-button"
        :disabled="store.busy || store.sending"
        @click="store.connect(username, password)"
      >
        <Plug :size="14" />{{ store.connected ? '重新连接' : '连接本机服务' }}
      </button>
      <button class="quiet-button" @click="authVisible = !authVisible">身份认证</button>
      <label v-if="store.models.length" class="model-setting">会话模型<CustomSelect
        v-model="store.selectedModel"
        :options="
          store.models.map((m) => ({ label: engineeringModelLabel(m.id, m.name), value: m.id }))
        "
        aria-label="会话模型"
        :disabled="store.sending || store.busy"
        size="sm"
      /></label>
      <div v-if="authVisible" class="auth-fields">
        <input v-model="username" aria-label="OpenCode用户名" placeholder="用户名"><input
          v-model="password"
          aria-label="OpenCode密码"
          type="password"
          placeholder="密码仅用于当前连接"
          autocomplete="off"
        >
      </div>
    </div>
    <details class="mobile-points">
      <summary>
        <Check :size="13" />已导入 {{ points.length }} 个点位 <ChevronDown :size="13" />
      </summary>
      <div>
        <span v-for="point in points" :key="point.terminal"><b>{{ point.terminal }}</b>{{ point.name }}</span>
      </div>
    </details>
    <div class="conversation-body">
      <div
        ref="conversation"
        class="conversation-messages"
        role="log"
        aria-label="需求沟通记录"
        aria-live="polite"
        @scroll="onScroll"
      >
        <div v-if="!store.messages.length" class="chat-welcome">
          <span class="welcome-mark"><SlidersHorizontal :size="25" /></span>
          <h3>工艺方案设计</h3>
          <p>
            结合设备点表和控制要求，整理设备分工、运行策略、<br>联锁保护及关键参数，形成待确认的工艺方案。
          </p>

          <button
            type="button"
            :disabled="store.sending || store.busy"
            @click="beginWithCase"
          >
            <MessageSquareText :size="14" />{{ draft.trim() ? '追加案例需求提纲' : '填入完整需求示例' }}
          </button>
          <small class="welcome-note">示例填入后可直接编辑，发送后才开始 AI 分析。</small>
          <dl class="welcome-brief"><div><dt>控制目标</dt><dd>{{ scenario.purpose }}</dd></div><div><dt>设备分工</dt><dd>{{ scenario.equipment }}</dd></div><div><dt>需要补全</dt><dd>阈值与时序、异常处理、恢复方式、联调观察点。</dd></div></dl>
        </div>
        <article
          v-for="message in replies"
          :key="message.id"
          class="chat-message"
          :class="message.role"
        >
          <span v-if="message.role === 'assistant'" class="message-avatar"><MessageSquareText :size="15" /></span>
          <div class="message-body">
            <span class="message-author">{{
              message.role === 'user' ? '现场需求' : '实施协作工程师'
            }}</span>
            <!-- Markdown 禁用原始 HTML、外部图片及链接跳转，见 engineeringChat.test.mjs -->
            <!-- eslint-disable vue/no-v-html -->
            <div
              v-if="message.role === 'assistant'"
              class="assistant-markdown"
              v-html="message.html"
            />
            <!-- eslint-enable vue/no-v-html -->
            <p v-else class="user-text">{{ message.text }}</p>
          </div>
        </article>

        <div
          v-for="pending in store.pending"
          :key="pending.id"
          class="conversation-action question-card"
        >
          <template v-if="pending.questions">
            <div class="action-heading">
              <CircleHelp :size="18" />
              <h3>还需要确认几项现场信息</h3>
            </div>
            <div v-for="(question, index) in pending.questions" :key="index" class="question-row">
              <label :for="`${pending.id}-${index}`">{{ chinese(question.question) }}</label>
              <div class="question-options">
                <button
                  v-for="option in question.options"
                  :key="option.label"
                  :aria-pressed="
                    questionChoices[pending.id]?.[index]?.includes(option.label) ?? false
                  "
                  :disabled="store.busy"
                  @click="chooseAnswer(pending.id, index, option.label, question.multiple)"
                >
                  {{ chinese(option.label) }}
                </button>
              </div>
              <input
                :id="`${pending.id}-${index}`"
                :value="questionFree[pending.id]?.[index] ?? ''"
                placeholder="也可以直接补充具体要求"
                :disabled="store.busy"
                @input="
                  (questionFree[pending.id] ??= {})[index] = (
                    $event.target as HTMLInputElement
                  ).value
                "
              >
            </div>
            <button
              class="primary-button"
              :disabled="!hasAnswers(pending) || store.busy"
              @click="submitAnswers(pending)"
            >
              确认并继续
            </button>
          </template>
          <template v-else>
            <div class="action-heading">
              <CircleHelp :size="18" />
              <h3>本次操作需要你的授权</h3>
            </div>
            <p>{{ permissionNames[pending.permission ?? ''] ?? '执行当前请求的工程操作' }}</p>
            <details class="permission-scope">
              <summary>查看操作范围</summary>
              <p>{{ pending.patterns?.join('，') }}</p>
            </details>
            <div class="action-buttons">
              <button class="outlined-button" @click="store.permission(pending.id, 'reject')">
                不允许
              </button><button class="primary-button" @click="store.permission(pending.id, 'once')">
                仅本次允许
              </button>
            </div>
          </template>
        </div>

        <div v-if="proposalReady" class="conversation-action proposal-card">
          <div class="action-heading">
            <Check :size="17" />
            <h3>{{ configurationReply ? '继续核对工程参数' : '下一步，核对工程参数' }}</h3>
          </div>
          <p>{{ configurationReply ? '已恢复上次对话。重新核对当前点位与版本后，我会再次整理参数确认表。' : '方案符合现场要求的话，我会把参数整理成确认表。也可以继续告诉我需要调整的地方。' }}</p>
          <div class="action-buttons">
            <button class="quiet-button" @click="revise">继续讨论</button><button class="primary-button" :disabled="!store.connected" @click="adopt">
              核对方案参数 <ArrowUp :size="14" />
            </button>
          </div>
        </div>
        <div
          v-if="store.candidate && !store.sending && !store.pending.length"
          ref="confirmationArea"
          class="inline-confirmation"
        >
          <EngineeringConfirmation
            :config="store.candidate"
            :recipe="store.activeRecipe"
            :version="store.nextVersion"
            :busy="store.busy"
            @confirm="confirm"
            @revise="revise"
          />
        </div>
        <div v-if="store.delivery && !store.candidate && !store.sending && !store.busy && !proposalReady && !store.pending.length" class="conversation-action receipt-card">
          <div class="action-heading"><Check :size="17" /><h3>当前工程已生成</h3></div>
          <p>版本 {{ store.delivery.manifest.config.projectVersion }} · {{ store.delivery.manifest.fields.length }} 个北向点位<span v-if="store.delivery.manifest.hostReport?.status === 'HOST_PASS'"> · 主机检查通过</span></p>
          <details class="confirmed-parameters">
            <summary>查看已确认参数 <ChevronDown :size="13" /></summary><dl>
              <div v-for="(spec, key) in store.activeRecipe.parameters" :key="key"><dt>{{ spec.label }}</dt><dd>{{ store.delivery.manifest.config.parameters[key] }} {{ chineseUnit(spec.unit) }}</dd></div>
            </dl>
          </details>
          <div class="action-buttons"><button class="outlined-button" @click="store.step = 2">查看控制程序</button><button class="primary-button" @click="store.step = 3">进入仿真运行</button></div>
        </div>
        <div
          v-if="(store.sending || store.busy) && !store.pending.length"
          class="conversation-activity"
          role="status"
        >
          <LoaderCircle :size="16" class="activity-spinner" />
          <div>
            <strong>{{ activity }}<span class="typing-dots">…</span></strong>
            <p>
              {{
                store.busy
                  ? store.stage
                  : store.requestIntent === 'config'
                    ? '正在核对设备分工、参数范围和联锁条件'
                    : store.replyPhase === 'replying'
                      ? '方案正在逐步呈现，你可以随时停止回复'
                      : '结合本次点表与工艺要求处理'
              }}
            </p>
            <p v-if="store.sending && store.requestElapsedSeconds >= 30" class="response-wait">
              本次请求已等待 {{ store.requestElapsedSeconds }} 秒。模型响应较慢，可继续等待，或停止回复后重新请求；已发送的需求会保留。
            </p>
          </div>
          <button v-if="generating" class="quiet-button" @click="store.cancel()">取消生成</button>
        </div>
      </div>
      <button v-if="!followLatest && !store.candidate" class="latest-button" @click="toLatest">
        <ArrowDown :size="14" />回到最新消息
      </button>
    </div>
    <div v-if="store.error" class="chat-error" role="alert">
      <div>
        <p>{{ conversationError(store.error) }}</p>
        <details v-if="conversationError(store.error) !== store.error">
          <summary>查看错误详情</summary>
          <pre>{{ store.error }}</pre>
        </details>
      </div>
      <button class="icon-button" aria-label="关闭错误" @click="store.error = ''">
        <X :size="14" />
      </button>
    </div>
    <details v-if="store.messages.length" class="requirement-checklist">
      <summary>需求核对提纲</summary>
      <p>设备分工 → 控制目标 → 启停与联锁 → 故障与恢复 → 参数 → 联调与交付</p>
      <p>{{ scenario.equipment }}</p>
      <button class="quiet-button" type="button" :disabled="store.sending || store.busy" @click="beginWithCase">追加案例需求提纲</button>
    </details>
    <form class="chat-composer" @submit.prevent="send">
      <div class="composer-input">
        <textarea
          ref="composer"
          v-model="draft"
          aria-label="控制需求"
          placeholder="说明设备分工、控制目标和启停要求；也可以先填入完整需求示例…"
          rows="2"
          @keydown="onComposerKeydown"
        />
        <button
          v-if="store.sending"
          class="send-button stop-reply"
          type="button"
          aria-label="停止回复"
          @click="store.abort()"
        >
          <Square :size="16" />
        </button>
        <button
          v-else
          class="send-button"
          type="submit"
          aria-label="发送需求"
          :disabled="!store.connected || !draft.trim() || store.busy || !!store.pending.length"
        >
          <ArrowUp :size="19" />
        </button>
      </div>
      <div class="composer-hint">
        <span>{{
          store.pending.length ? '先完成上方确认，再继续沟通' : '回车发送 · ⇧ 回车换行'
        }}</span><span>沟通需求 → 确认参数 → 生成工程</span>
      </div>
    </form>
  </section>
</template>

<style scoped>
.welcome-brief { margin: 18px 0; text-align: left; max-width: 610px; }
.welcome-brief > div { display: grid; grid-template-columns: 72px 1fr; gap: 12px; margin: 10px 0; font-size: 12px; line-height: 1.8; }
.welcome-brief dt { color: #375f77; font-weight: 600; }
.welcome-brief dd { margin: 0; color: #637d8f; }
.welcome-note { display: block; margin-top: 12px; color: #6c8597; font-size: 11px; }
.requirement-checklist { border-top: 1px solid #e7edf2; padding: 10px 22px; font-size: 12px; color: #42677d; flex-shrink: 0; max-height: 145px; overflow-y: auto; }
.requirement-checklist summary { cursor: pointer; }
.requirement-checklist p { line-height: 1.7; margin: 8px 0; }
.engineering-chat {
  display: flex;
  flex-direction: column;
  height: clamp(460px, calc(100vh - 226px), 920px);
  min-width: 0;
  background: white;
  border: 1px solid #d9e4ed;
  border-radius: 12px;
  overflow: hidden;
  color: #203d52;
}
.chat-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 17px 21px;
  border-bottom: 1px solid #e7edf2;
  flex-shrink: 0;
}
.engineer-identity,
.chat-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.engineer-avatar {
  width: 36px;
  height: 36px;
  background: #edf5fa;
  color: #176e93;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.chat-heading h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 4px;
}
.chat-heading p {
  font-size: 10px;
  color: #7b91a1;
  margin: 0;
}
.service-state {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  white-space: nowrap;
  font-size: 10px;
  color: #899aa6;
}
.service-state i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #9baab5;
}
.service-state.online {
  color: #558475;
}
.service-state.online i {
  background: #3b8e75;
}
button,
input,
textarea {
  font: inherit;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
button:focus-visible,
summary:focus-visible,
input:focus-visible {
  outline: 2px solid #2785a7;
  outline-offset: 3px;
}
.icon-button {
  padding: 6px;
  color: #7890a2;
  background: transparent;
  border: 0;
  border-radius: 5px;
  display: inline-flex;
}
.icon-button:hover {
  background: #f0f5f8;
  color: #21698d;
}
.service-settings {
  background: #f7fafc;
  border-bottom: 1px solid #e5edf3;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  padding: 13px 20px;
  flex-shrink: 0;
}
.service-settings label {
  font-size: 10px;
  color: #70899c;
}
.server-address {
  flex: 1;
  min-width: 170px;
}
.service-settings input,
.question-row > input {
  box-sizing: border-box;
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid #d1e0ea;
  background: white;
  border-radius: 5px;
  color: #315b74;
  font-size: 11px;
}
.service-settings button {
  min-height: 32px;
}
.model-setting {
  min-width: 180px;
  flex: 1;
}
.model-setting :deep(.custom-select-container) {
  display: block;
  margin-top: 6px;
}
.auth-fields {
  display: flex;
  gap: 10px;
  width: 100%;
}
.conversation-body {
  position: relative;
  min-height: 0;
  flex: 1;
}
.conversation-messages {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 25px 28px;
  scrollbar-gutter: stable;
}
.chat-welcome {
  max-width: 520px;
  margin: 15px auto 20px;
  color: #6b8597;
}
.welcome-mark {
  width: 36px;
  height: 36px;
  border: 1px solid #d5e6ed;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: #267a97;
  margin-bottom: 12px;
}
.chat-welcome h3 {
  font-size: 24px;
  font-weight: 600;
  color: #29495e;
  letter-spacing: 0.3px;
  margin: 0 0 14px;
}
.chat-welcome p {
  font-size: 13px;
  line-height: 1.9;
  margin: 0 0 24px;
}
.chat-welcome button {
  border: 1px solid #d4e2eb;
  border-radius: 7px;
  padding: 9px 13px;
  display: flex;
  align-items: center;
  gap: 7px;
  color: #3f718b;
  background: white;
  font-size: 11px;
}
.chat-message {
  display: flex;
  gap: 11px;
  max-width: 850px;
  margin: 0 auto 25px;
}
.message-avatar {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border: 1px solid #dbe8ee;
  color: #216e8e;
  border-radius: 8px;
  margin-top: 1px;
}
.message-body {
  min-width: 0;
  flex: 1;
}
.message-author {
  display: block;
  font-size: 10px;
  color: #8196a5;
  margin: 1px 0 8px;
}
.chat-message.user {
  justify-content: flex-end;
  margin-bottom: 25px;
}
.user .message-body {
  flex: 0 1 auto;
  max-width: 85%;
  border-radius: 12px 12px 3px 12px;
  background: #eff5fa;
  padding: 12px 16px;
}
.user .message-author {
  color: #7d97a8;
}
.user-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.9;
  margin: 0;
  color: #315871;
}
.assistant-markdown {
  font-size: 14px;
  line-height: 1.95;
  color: #29475c;
  overflow-wrap: anywhere;
}
.assistant-markdown :deep(p) {
  margin: 0 0 12px;
}
.assistant-markdown :deep(p:last-child) {
  margin-bottom: 0;
}
.assistant-markdown :deep(h1),
.assistant-markdown :deep(h2),
.assistant-markdown :deep(h3),
.assistant-markdown :deep(h4) {
  font-size: 14px;
  line-height: 1.7;
  margin: 21px 0 10px;
  color: #24495f;
  font-weight: 600;
}
.assistant-markdown :deep(:first-child) {
  margin-top: 0;
}
.assistant-markdown :deep(ul),
.assistant-markdown :deep(ol) {
  padding-left: 21px;
  margin: 8px 0 15px;
}
.assistant-markdown :deep(li) {
  margin: 5px 0;
  padding-left: 2px;
}
.assistant-markdown :deep(li p) {
  margin-bottom: 6px;
}
.assistant-markdown :deep(strong) {
  font-weight: 600;
  color: #234b63;
}
.assistant-markdown :deep(table) {
  border-collapse: collapse;
  display: block;
  max-width: 100%;
  overflow-x: auto;
  margin: 14px 0;
  font-size: 11px;
}
.assistant-markdown :deep(th),
.assistant-markdown :deep(td) {
  border: 1px solid #dce7ef;
  padding: 8px 10px;
  text-align: left;
  min-width: 65px;
}
.assistant-markdown :deep(th) {
  font-weight: 550;
  background: #f4f8fb;
  color: #54748b;
}
.assistant-markdown :deep(code) {
  font: inherit;
  font-size: 0.95em;
  color: #3f728a;
  background: #f2f7fa;
  padding: 1px 4px;
  border-radius: 3px;
}
.assistant-markdown :deep(blockquote) {
  border-left: 2px solid #b6d4e1;
  margin: 15px 0;
  padding-left: 13px;
  color: #7891a1;
}
.assistant-markdown :deep(hr) {
  border: 0;
  border-top: 1px solid #e7eef3;
  margin: 20px 0;
}
.assistant-markdown :deep(.message-reference) {
  color: #27789b;
}
.conversation-action,
.inline-confirmation {
  max-width: 812px;
  margin: 8px auto 22px;
  padding-left: 38px;
  box-sizing: border-box;
}
.conversation-action {
  padding: 18px 20px;
  border: 1px solid #d9e5ee;
  border-radius: 10px;
  background: #fafcfe;
  margin-left: max(38px, calc((100% - 812px) / 2));
}
.action-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #317796;
}
.action-heading h3 {
  font-size: 13px;
  margin: 0;
  font-weight: 600;
  color: #315a73;
}
.conversation-action > p {
  font-size: 12px;
  color: #708a9c;
  line-height: 1.9;
  margin: 10px 0 14px;
}
.action-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  align-items: center;
}
.primary-button,
.outlined-button,
.quiet-button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  border-radius: 6px;
  padding: 8px 11px;
  font-size: 11px;
}
.primary-button {
  border: 1px solid #176e94;
  background: #176e94;
  color: white;
}
.outlined-button {
  border: 1px solid #cadde8;
  background: white;
  color: #426e87;
}
.quiet-button {
  background: transparent;
  border: 1px solid transparent;
  color: #7692a4;
}
.question-card {
  background: #fcfdff;
}
.receipt-card {
  background: #f8fcfa;
  border-color: #d0e4dc;
}
.receipt-card .action-heading {
  color: #438574;
}
.confirmed-parameters {
  margin: 12px 0 16px;
  color: #6b8a7e;
  font-size: 11px;
}
.confirmed-parameters summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  list-style: none;
}
.confirmed-parameters summary::-webkit-details-marker {
  display: none;
}
.confirmed-parameters dl > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid #e3eee8;
}
.confirmed-parameters dd { margin: 0; }
.question-row {
  margin: 17px 0;
}
.question-row > label {
  font-size: 12px;
  line-height: 1.8;
}
.question-options {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.question-options button {
  border: 1px solid #cedfe9;
  border-radius: 6px;
  padding: 7px 10px;
  background: white;
  color: #5f8095;
  font-size: 11px;
}
.question-options button[aria-pressed='true'] {
  background: #eaf4f9;
  border-color: #4b97b5;
  color: #176d90;
}
.permission-scope {
  font-size: 11px;
  color: #718b9d;
  margin: 10px 0;
}
.permission-scope p {
  overflow-wrap: anywhere;
}
.conversation-activity {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-width: 812px;
  margin: 12px auto 8px;
  padding-left: 38px;
  color: #4f859e;
}
.conversation-activity > div {
  flex: 1;
}
.conversation-activity strong {
  font-size: 12px;
  font-weight: 500;
}
.conversation-activity p {
  font-size: 10px;
  color: #91a2ae;
  margin: 6px 0 0;
  line-height: 1.8;
}
.activity-spinner {
  margin-top: 3px;
  flex-shrink: 0;
  animation: processing 1.5s linear infinite;
}
.typing-dots {
  display: inline-block;
  animation: breathing 1.6s ease-in-out infinite;
}
@keyframes processing {
  to {
    transform: rotate(360deg);
  }
}
@keyframes breathing {
  50% {
    opacity: 0.25;
  }
}
.latest-button {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #d4e2eb;
  border-radius: 18px;
  padding: 7px 12px;
  color: #497d99;
  background: white;
  box-shadow: 0 2px 8px #1e4a6810;
  font-size: 10px;
  white-space: nowrap;
}
.chat-composer {
  padding: 13px 19px 12px;
  flex-shrink: 0;
  background: white;
  border-top: 1px solid #edf2f5;
}
.composer-input {
  position: relative;
  background: #f8fbfd;
  border: 1px solid #d3e1eb;
  border-radius: 10px;
  padding: 10px 48px 9px 13px;
}
.composer-input:focus-within {
  border-color: #84b2c8;
  box-shadow: 0 0 0 2px #16769c09;
}
.composer-input textarea {
  width: 100%;
  min-height: 58px;
  max-height: 150px;
  resize: none;
  padding: 0;
  box-sizing: border-box;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 12px;
  line-height: 1.85;
  color: #315971;
  display: block;
}
.composer-input textarea::placeholder {
  color: #91a5b4;
}
.send-button {
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 31px;
  height: 31px;
  border-radius: 8px;
  border: 0;
  background: #176f94;
  color: white;
  display: grid;
  place-items: center;
}
.send-button:disabled {
  background: #c1d3df;
  opacity: 1;
}
.stop-reply {
  background: #416c83;
}
.composer-hint {
  display: flex;
  gap: 10px;
  justify-content: space-between;
  margin-top: 9px;
  color: #98a9b5;
  font-size: 9px;
}
.chat-error {
  margin: 8px 20px 0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #eed6d1;
  border-radius: 6px;
  background: #fff9f7;
  color: #a35f51;
  font-size: 11px;
  line-height: 1.8;
}
.chat-error > div {
  flex: 1;
  min-width: 0;
}
.chat-error p {
  margin: 0;
}
.chat-error details {
  margin-top: 6px;
  font-size: 10px;
}
.chat-error pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mobile-points {
  display: none;
}
@media (max-width: 1060px) {
  .mobile-points {
    display: block;
    border-bottom: 1px solid #e8eff3;
    font-size: 10px;
    color: #638598;
    flex-shrink: 0;
  }
  .mobile-points summary {
    display: flex;
    align-items: center;
    gap: 6px;
    list-style: none;
    padding: 9px 20px;
    cursor: pointer;
  }
  .mobile-points summary::-webkit-details-marker {
    display: none;
  }
  .mobile-points summary svg:last-child {
    margin-left: auto;
  }
  .mobile-points > div {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
    max-height: 160px;
    overflow: auto;
    padding: 10px 20px 15px;
    background: #f9fcfd;
  }
  .mobile-points span {
    display: flex;
    gap: 7px;
  }
  .mobile-points b {
    color: #287396;
  }
}
@media (max-width: 650px) {
  .chat-heading {
    padding: 14px;
  }
  .chat-heading p {
    max-width: 220px;
    line-height: 1.7;
  }
  .chat-tools {
    gap: 4px;
  }
  .service-state {
    display: none;
  }
  .conversation-messages {
    padding: 20px 14px;
  }
  .chat-message {
    gap: 8px;
  }
  .conversation-action {
    margin-left: 0;
    padding: 15px;
  }
  .inline-confirmation,
  .conversation-activity {
    padding-left: 0;
  }
  .chat-composer {
    padding: 12px;
  }
  .composer-hint span:last-child {
    display: none;
  }
  .chat-welcome {
    margin: 25px 10px;
  }
  .chat-welcome h3 {
    font-size: 21px;
  }
  .service-settings {
    padding: 12px 14px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .activity-spinner,
  .typing-dots {
    animation: none;
  }
}
</style>
