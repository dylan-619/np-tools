import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { createPinia, setActivePinia } from 'pinia'
const moduleUrl = (source) =>
  'data:text/javascript;base64,' +
  Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
    }).outputText
  ).toString('base64')
const types = moduleUrl(
  (await readFile(new URL('../src/types/engineering.ts', import.meta.url), 'utf8')).replace(
    "import catalog from '../../resources/engineering/cases/catalog.json'",
    'const catalog = ' +
      (await readFile(
        new URL('../resources/engineering/cases/catalog.json', import.meta.url),
        'utf8'
      ))
  )
)
const contract = moduleUrl(
  (await readFile(new URL('../src/utils/engineeringContract.ts', import.meta.url), 'utf8')).replace(
    "'../types/engineering'",
    JSON.stringify(types)
  )
)
const api = moduleUrl(`
export const preflightEngineering = async () => globalThis.__npApi.preflight;
export const connectOpenCode = async () => ({health:{version:'test'},models:[{id:'deepseek/deepseek-flash'}],selectedModel:'deepseek/deepseek-flash'});
export const subscribeOpenCode = async () => ({onmessage:null});
export const engineeringHistory = async () => globalThis.__npApi.versions;
export const generateEngineering = async (_, config, requirements) => {globalThis.__npApi.requirements=requirements;globalThis.__npApi.versions.push(config.projectVersion);return {manifest:{config,identity:{},fields:[]}}};
export async function openCodeRequest(_,op,body){
 const state=globalThis.__npApi;
 if(op==='create')return {id:'session1'};
 if(op==='messages')return state.rows;
 if(op==='status')return {};
 if(op==='questions'||op==='permissions')return [];
 if(op==='send'){
  state.body=body;
  state.rows.push({info:{id:'user'+state.rows.length,role:'user'},parts:[{id:'u',type:'text',text:body.parts[0].text}]});
  state.rows.push(state.reply('new'+state.rows.length,state.nextConfig));
 }
}
`)
const events = moduleUrl('export async function listen(){return ()=>{}}')
let source = await readFile(new URL('../src/stores/engineeringStore.ts', import.meta.url), 'utf8')
for (const [name, url] of [
  ['vue', import.meta.resolve('vue')],
  ['pinia', import.meta.resolve('pinia')],
  ['js-yaml', import.meta.resolve('js-yaml')],
  ['@tauri-apps/api/event', events],
  ['../api/engineeringApi', api],
  ['../utils/engineeringContract', contract],
  ['../types/engineering', types]
])
  source = source.replaceAll(`'${name}'`, JSON.stringify(url))
const { useEngineeringStore } = await import(moduleUrl(source))
const { FIXED_BINDINGS } = await import(types)
const config = (version) => ({
  schema: 'np-tools-expo-case-config/v1',
  caseId: 'two-device-output-sequence',
  caseVersion: '1.0.0',
  projectId: 'expo_sequence_demo',
  projectVersion: version,
  bindings: FIXED_BINDINGS,
  parameters: { startDelayMs: 3000, clearDelayMs: 4000 },
  labels: { downstream: '后级', upstream: '前级' }
})
const reply = (id, c) => ({
  info: { id, role: 'assistant', time: { completed: 1 } },
  parts: [{ id: id + 'text', type: 'text', text: '```json\n' + JSON.stringify(c) + '\n```' }]
})

test('startup inspection blocks competing imports until restoration is complete', async () => {
  let finish
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
  globalThis.window = { setInterval: () => 0 }
  globalThis.__npApi = { preflight: new Promise(resolve => { finish = resolve }) }
  setActivePinia(createPinia())
  const store = useEngineeringStore()
  const startup = store.initialize()
  assert.equal(store.busy, true)
  assert.equal(store.stage, '检查运行环境并恢复工程')
  // 若未隔离启动与导入，这会调用不存在的 importEngineering 并产生错误。
  await store.importText('another project')
  assert.equal(store.workspaceId, '')
  assert.equal(store.error, '')
  finish({ ready: true })
  await startup
  assert.equal(store.busy, false)
  assert.equal(store.environment.ready, true)
})

test('three-pump conversation uses its own analog roles, PI rules and current identity', async () => {
  const { processRecipe } = await import(types)
  const r = processRecipe('three-pump-level-control')
  const c = { schema: 'np-tools-expo-case-config/v1', caseId: r.id, caseVersion: '1.0.0', projectId: r.projectId, projectVersion: '1.0.0', bindings: r.bindings, parameters: Object.fromEntries(Object.entries(r.parameters).map(([k,s]) => [k,s.default])), labels: r.labels }
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
  globalThis.__npApi = { versions: [], rows: [], nextConfig: c, reply }
  setActivePinia(createPinia())
  const store = useEngineeringStore(); store.workspaceId = 'three'
  store.inputText = JSON.stringify({project:{points:{inputs:Object.values(r.bindings).filter(x => /board\.(di|ai)/.test(x)).map(source=>({source})),outputs:Object.values(r.bindings).filter(x=>/board\.(do|ao)/.test(x)).map(source=>({source}))}}})
  await store.connect(); await store.send('采用三级液位、一变频两工频，备用故障接替。')
  assert.equal(store.error, '')
  assert.equal(store.candidate.caseId, r.id)
  assert.match(globalThis.__npApi.body.system, /实际频率>=49.5Hz/)
  assert.match(globalThis.__npApi.body.system, /工频降级/)
  assert.match(globalThis.__npApi.body.system, /全部使用简体中文/)
  assert.match(globalThis.__npApi.body.system, /对话内确认表单/)
  assert.equal(store.requestIntent, 'design')
  assert.equal(store.replyPhase, 'idle')
  assert.equal(store.messages.filter((m) => m.role === 'assistant').slice(-1)[0].completed, true)
  assert.match(globalThis.__npApi.body.system, /board.ai01/)
  assert.ok(!globalThis.__npApi.body.system.includes('不使用AI模拟量、压力或PID'))
})
test('restore does not adopt old model output; only a fresh request can create a candidate', async () => {
  const saved = new Map()
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (k, v) => saved.set(k, v)
  }
  globalThis.__npApi = {
    versions: ['1.0.0'],
    rows: [reply('old', config('1.0.0'))],
    nextConfig: config('1.0.1'),
    reply
  }
  setActivePinia(createPinia())
  const store = useEngineeringStore()
  store.workspaceId = 'demo'
  store.versions = ['1.0.0']
  store.delivery = { manifest: { config: config('1.0.0'), identity: {} } }
  store.inputText = JSON.stringify({
    project: {
      points: {
        inputs: ['board.di01', 'board.di02', 'board.di03'].map((source) => ({ source })),
        outputs: ['board.do01', 'board.do02'].map((source) => ({ source }))
      }
    }
  })
  await store.connect()
  assert.equal(store.error, '')
  assert.equal(store.candidate, null)
  await store.send('启动3秒，停止4秒，采用案例规则。')
  assert.equal(store.candidate.projectVersion, '1.0.1')
  assert.match(globalThis.__npApi.body.parts[0].text, /projectVersion=1\.0\.1/)
  assert.ok(store.messages.every((m) => !m.text.includes('<np-tools-context>')))
  store.confirmed = true
  await store.confirmAndGenerate()
  assert.equal(store.nextVersion, '1.0.2')
  await store.reconcile()
  assert.equal(store.error, '')
  assert.equal(store.candidate, null)
  assert.ok(!globalThis.__npApi.requirements.includes('<np-tools-context>'))
  assert.match(globalThis.__npApi.requirements, /本次确认表参数/)
  globalThis.__npApi.nextConfig = config('1.0.0')
  await store.send('生成下一版')
  assert.equal(store.candidate, null)
  assert.match(store.error, /工程身份/)
  assert.equal(store.delivery.manifest.config.projectVersion, '1.0.1')
})

test('water process context and model config stay isolated from the legacy case', async () => {
  const { processRecipe } = await import(types)
  const r = processRecipe('water-supply-station')
  const c = {
    schema: 'np-tools-expo-case-config/v1',
    caseId: r.id,
    caseVersion: '1.0.0',
    projectId: r.projectId,
    projectVersion: '1.0.0',
    bindings: r.bindings,
    parameters: Object.fromEntries(Object.entries(r.parameters).map(([k, v]) => [k, v.default])),
    labels: r.labels
  }
  globalThis.__npApi = { versions: [], rows: [], nextConfig: c, reply }
  setActivePinia(createPinia())
  const store = useEngineeringStore()
  store.workspaceId = 'water'
  store.inputText = JSON.stringify({
    project: {
      points: {
        inputs: Object.values(r.bindings)
          .filter((v) => v.includes('.di'))
          .map((source) => ({ source })),
        outputs: Object.values(r.bindings)
          .filter((v) => v.includes('.do'))
          .map((source) => ({ source }))
      }
    }
  })
  await store.connect()
  await store.send('采用清水箱与双泵供水方案，请生成工程配置。', 'config')
  assert.equal(store.candidate.caseId, r.id)
  assert.match(globalThis.__npApi.body.parts[0].text, /主泵|P101/)
  assert.match(globalThis.__npApi.body.parts[0].text, /2000ms/)
  assert.match(globalThis.__npApi.body.parts[0].text, /projectId=water_supply_station/)
  assert.ok(!globalThis.__npApi.body.parts[0].text.includes('只能使用这套3DI/2DO'))
  globalThis.__npApi.nextConfig = config('1.0.0')
  await store.send('调整参数')
  assert.equal(store.candidate, null)
  assert.match(store.error, /当前固定案例/)
})
