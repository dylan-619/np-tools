import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia } from 'pinia'
import { createServer as createHttpServer } from 'node:http'

globalThis.localStorage = { getItem: () => null, setItem: () => {} }
const server = await createServer({
  server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  logLevel: 'error'
})
after(() => server.close())
const { default: Chat } = await server.ssrLoadModule('/src/components/engineering/EngineeringChat.vue')
const { useEngineeringStore } = await server.ssrLoadModule('/src/stores/engineeringStore.ts')
const { processRecipe } = await server.ssrLoadModule('/src/types/engineering.ts')
const { renderEngineeringReply, chineseUnit, engineeringModelLabel } = await server.ssrLoadModule('/src/utils/engineeringConversation.ts')
const { structuredCandidates } = await server.ssrLoadModule('/src/utils/engineeringContract.ts')
const { requirementDraft, workflowCompleted } = await server.ssrLoadModule('/src/utils/engineeringPresentation.ts')
const recipe = processRecipe('three-pump-level-control')
const config = () => ({
  schema: 'np-tools-expo-case-config/v1', caseId: recipe.id, caseVersion: '1.0.0',
  projectId: recipe.projectId, projectVersion: '1.0.0', bindings: { ...recipe.bindings },
  parameters: Object.fromEntries(Object.entries(recipe.parameters).map(([key, spec]) => [key, spec.default])),
  labels: { ...recipe.labels }
})
async function render(state = {}) {
  const pinia = createPinia()
  const app = createSSRApp(Chat, { modelValue: '', points: recipe.terminals ?? [] })
  app.use(pinia)
  const store = useEngineeringStore(pinia)
  Object.assign(store, { connected: true, ...state })
  return renderToString(app)
}
const assistant = (text, completed = true) => ({ id: 'answer', role: 'assistant', text, completed })

test('historical camel-case summaries become Chinese Markdown without changing machine data', () => {
  const machine = JSON.stringify(config())
  const source = '### 请核对参数\n\n| 参数 | 值 |\n|---|---|\n| stopLevelM | 0.40 m |\n\n```\nstartConfirmMs 2000 / stageConfirmMs 5000\npidKp 24 / pidKi 0.6\n```\n\n```json\n' + machine + '\n```'
  const html = renderEngineeringReply(source, recipe)
  assert.match(html, /<h3>请核对参数<\/h3>/)
  assert.match(html, /<table>/)
  for (const name of ['停泵液位', '启变频连续确认', '加减泵连续确认', '液位比例增益', '液位积分增益']) assert.ok(html.includes(name), name)
  assert.ok(!/stopLevelM|startConfirmMs|pidKp|np-tools-expo|"bindings"/.test(html))
  assert.equal(structuredCandidates(source)[0].parameters.stopLevelM, 0.4)
  assert.equal(structuredCandidates(source)[0].schema, config().schema)
  assert.equal(chineseUnit('mA/(m·s)'), '毫安/(米·秒)')
  const units = renderEngineeringReply('连续2s，实际50Hz；请回复“采用”。', recipe)
  assert.match(units, /连续2秒，实际50赫兹/)
  assert.match(units, /请在下方核对方案参数/)
  assert.match(renderEngineeringReply('2cm、3 mm，pumpNAuto', recipe), /2厘米、3 毫米，各泵远程自动许可/)
  assert.equal(engineeringModelLabel('deepseek/deepseek-flash'), '深度求索 · 快速模型')
  assert.notEqual(engineeringModelLabel('provider/model-a'), engineeringModelLabel('provider/model-b'))
})

test('streamed configuration is hidden before its schema or closing fence arrives', () => {
  for (const source of ['```json\n{', '```json\n{"schema":', '```\n{"schema":"np-tools-expo-case-config/v1",']) {
    const html = renderEngineeringReply(source, recipe)
    assert.equal(html.trim(), '')
  }
  const text = renderEngineeringReply('已整理好参数。\n\n{"schema":"np-tools-expo-case-config/v1","bindings":{', recipe)
  assert.match(text, /已整理好参数/)
  assert.ok(!text.includes('schema'))
})

test('assistant markup cannot inject HTML, load images or navigate the desktop webview', () => {
  const html = renderEngineeringReply('<img src=x onerror="alert(1)">\n<script>alert(2)</script>\n\n[参考](https://example.com)\n![图](https://example.com/tracker.png)\n[恶意](javascript:alert(1))', recipe)
  assert.ok(!/<(?:img|script|a)\b|\shref=/.test(html))
  assert.match(html, /&lt;img/)
  assert.match(html, /message-reference/)
})

test('a completed proposal offers the next action inside the conversation', async () => {
  const html = await render({ messages: [assistant('### 控制方案\n\nP101先启动。返回`np-tools-expo-case-config/v1`配置。')] })
  assert.match(html, /<h3>控制方案<\/h3>/)
  assert.match(html, /下一步，核对工程参数/)
  assert.ok(!html.includes('np-tools-expo-case-config/v1'))
  assert.ok(!html.includes('方案与配置'))
})

test('partial, busy or failed replies never offer a premature proposal confirmation', async () => {
  for (const state of [
    { messages: [assistant('尚未完成', false)] },
    { messages: [assistant('方案已完成')], sending: true },
    { messages: [assistant('已停止')], error: '服务请求失败' }
  ]) {
    const html = await render(state)
    assert.ok(!html.includes('下一步，核对工程参数'))
  }
})

test('current validated configuration becomes a Chinese in-chat form requiring explicit confirmation', async () => {
  const html = await render({ candidate: config(), messages: [assistant('```json\n' + JSON.stringify(config()) + '\n```')] })
  assert.match(html, /aria-label="确认工艺方案与参数"/)
  assert.match(html, /aria-label="停泵液位"/)
  assert.match(html, /时序与调节参数/)
  assert.match(html, /已核对设备分工、联锁与参数/)
  assert.match(html, /type="submit"[^>]*disabled[^>]*>[\s\S]*?确认并生成工程/)
  assert.ok(!html.includes('stopLevelM'))
  assert.ok(!html.includes('下一步，核对工程参数'))
})

test('restored unconfirmed configuration requires a fresh request instead of automatic adoption', async () => {
  const html = await render({ messages: [assistant('```json\n' + JSON.stringify(config()) + '\n```')] })
  assert.match(html, /继续核对工程参数/)
  assert.ok(!html.includes('aria-label="确认工艺方案与参数"'))
  const delivered = await render({ delivery: { manifest: { config: config(), identity: {}, fields: [] } }, messages: [assistant('```json\n' + JSON.stringify(config()) + '\n```')] })
  assert.ok(!delivered.includes('继续核对工程参数'))
})

test('generated artifact receipt uses real version, fields and confirmed parameters', async () => {
  const html = await render({ delivery: { manifest: { config: config(), identity: {}, fields: [{ name: 'LEVEL_M' }], hostReport: { status: 'HOST_PASS' } } } })
  assert.match(html, /当前工程已生成/)
  assert.match(html, /1 个北向点位/)
  assert.match(html, /主机检查通过/)
  assert.match(html, /查看已确认参数/)
  assert.match(html, /液位比例增益/)
  assert.match(html, /毫安\/米/)
  assert.match(html, /进入仿真运行/)
})

test('questions, permission requests and real generation activity remain in the message flow', async () => {
  const questions = await render({ pending: [{ id: 'q', sessionID: 's', questions: [{ header: '参数', question: 'startConfirmMs是否采用建议值？', options: [{ label: '采用建议值' }] }] }] })
  assert.match(questions, /启变频连续确认是否采用建议值/)
  assert.match(questions, /确认并继续/)
  const permission = await render({ pending: [{ id: 'p', sessionID: 's', permission: 'read', patterns: ['project_io.yaml'] }] })
  assert.match(permission, /读取工程资料/)
  assert.match(permission, /仅本次允许/)
  const generating = await render({ busy: true, stage: '生成点表、编译并运行主机测试' })
  assert.match(generating, /正在生成控制工程/)
  assert.match(generating, /生成点表、编译并运行主机测试/)
  assert.match(generating, /取消生成/)
  const connecting = await render({ busy: true, stage: '连接现场实施协作工程师' })
  assert.match(connecting, /连接现场实施协作工程师/)
  assert.ok(!connecting.includes('正在生成控制工程'))
})

test('requirement outline covers operating and failure boundaries with actual recipe defaults', () => {
  for (const id of ['three-pump-level-control', 'water-supply-station', 'two-device-output-sequence']) {
    const r = processRecipe(id)
    const text = requirementDraft(r)
    for (const heading of ['控制目标', '设备分工', '启停与联动', '建议参数', '故障与保护', '联调与交付']) {
      assert.ok(text.includes(`【${heading}】`), `${id}: ${heading}`)
    }
    assert.match(text, /先给出方案/)
    assert.ok(!/stopLevelM|pidKp|startDelayMs/.test(text))
  }
  const changed = structuredClone(recipe)
  changed.parameters.targetLevelM.default = 0.85
  const text = requirementDraft(changed)
  assert.match(text, /调节目标液位 0.85 米/)
  assert.match(text, /实际满频/)
  assert.match(text, /正常最多两台/)
  assert.match(text, /操作员明确投入/)
})

test('workflow completion depends on real evidence, not visiting later pages', () => {
  assert.deepEqual(workflowCompleted({ workspaceId: '', delivery: null, hostPassed: false, currentRuntime: false }), [false, false, false, false, false, false])
  assert.deepEqual(workflowCompleted({ workspaceId: 'saved', delivery: {}, hostPassed: true, currentRuntime: false }), [true, true, true, false, false, false])
  assert.deepEqual(workflowCompleted({ workspaceId: 'saved', delivery: {}, hostPassed: true, currentRuntime: true }), [true, true, true, true, false, false])
})

test('new conversations provide a complete requirement entry and existing ones retain a checklist', async () => {
  const initial = await render()
  assert.match(initial, /工艺方案设计/)
  assert.match(initial, /填入完整需求示例/)
  assert.match(initial, /正常最多两台/)
  const continued = await render({ messages: [assistant('已整理工艺要求')] })
  assert.match(continued, /需求核对提纲/)
  assert.match(continued, /追加案例需求提纲/)
})
