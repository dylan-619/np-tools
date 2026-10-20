import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const toModule = (text) =>
  'data:text/javascript;base64,' +
  Buffer.from(
    ts.transpileModule(text, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
    }).outputText
  ).toString('base64')
const typeModule = toModule(
  (await readFile(new URL('../src/types/engineering.ts', import.meta.url), 'utf8')).replace(
    "import catalog from '../../resources/engineering/cases/catalog.json'",
    'const catalog = ' +
      (await readFile(
        new URL('../resources/engineering/cases/catalog.json', import.meta.url),
        'utf8'
      ))
  )
)
const contractSource = (
  await readFile(new URL('../src/utils/engineeringContract.ts', import.meta.url), 'utf8')
).replace("'../types/engineering'", JSON.stringify(typeModule))
const { structuredCandidates, validateCaseConfig, validateScene } = await import(
  toModule(contractSource)
)
const { FIXED_BINDINGS } = await import(typeModule)
const config = () => ({
  schema: 'np-tools-expo-case-config/v1',
  caseId: 'two-device-output-sequence',
  caseVersion: '1.0.0',
  projectId: 'expo_sequence_demo',
  projectVersion: '1.0.0',
  bindings: { ...FIXED_BINDINGS },
  parameters: { startDelayMs: 2000, clearDelayMs: 5000 },
  labels: { downstream: '后级', upstream: '前级' }
})
test('only complete JSON code blocks can produce a candidate', () => {
  assert.deepEqual(structuredCandidates('已经完成生成'), [])
  assert.deepEqual(structuredCandidates('```json\n{"schema":'), [])
  assert.equal(structuredCandidates('说明\n```json\n{"schema":"x"}\n```')[0].schema, 'x')
})
test('case identity, fixed wiring, integer ranges and labels are enforced', () => {
  assert.equal(validateCaseConfig(config(), '1.0.0').parameters.startDelayMs, 2000)
  assert.throws(() => validateCaseConfig(config(), '1.0.1'))
  for (const mutator of [
    (c) => (c.bindings.startButton = 'board.di12'),
    (c) => (c.parameters.startDelayMs = 999),
    (c) => (c.parameters.startDelayMs = true),
    (c) => (c.labels.upstream = '\n'),
    (c) => (c.caseVersion = '2.0.0')
  ]) {
    const c = config()
    mutator(c)
    assert.throws(() => validateCaseConfig(c, '1.0.0'))
  }
})
test('HMI cannot bind a different revision, writable physical output or unknown point', () => {
  const fields = [
    { name: 'START', bind: 'command.start', c_type: 'bool', access: 'read_write' },
    { name: 'OUT', bind: 'point.output', c_type: 'bool', access: 'read' }
  ]
  const scene = () => ({
    source: { projectId: 'expo_sequence_demo', projectVersion: '1.0.0' },
    devices: [{ name: 'line', points: { running: 'OUT' }, commands: { start: 'START' } }],
    parameters: []
  })
  assert.doesNotThrow(() => validateScene(scene(), fields, config()))
  let s = scene()
  s.source.projectVersion = '0.0.0'
  assert.throws(() => validateScene(s, fields, config()))
  s = scene()
  s.devices[0].commands.start = 'OUT'
  assert.throws(() => validateScene(s, fields, config()))
  s = scene()
  s.devices[0].points.running = 'ABSENT'
  assert.throws(() => validateScene(s, fields, config()))
})

test('water station requires its own 15 bindings and bounded process parameters', async () => {
  const { processRecipe } = await import(typeModule)
  const r = processRecipe('water-supply-station')
  const make = () => ({
    schema: 'np-tools-expo-case-config/v1',
    caseId: r.id,
    caseVersion: '1.0.0',
    projectId: r.projectId,
    projectVersion: '1.0.0',
    bindings: { ...r.bindings },
    parameters: Object.fromEntries(Object.entries(r.parameters).map(([k, v]) => [k, v.default])),
    labels: { ...r.labels }
  })
  assert.equal(validateCaseConfig(make(), '1.0.0', r.id).parameters.switchDelayMs, 2000)
  assert.throws(() => validateCaseConfig(make(), '1.0.0', 'two-device-output-sequence'))
  for (const mutate of [
    (c) => (c.parameters.switchDelayMs = 1999),
    (c) => (c.parameters.valveTravelTimeoutMs = 15001),
    (c) => (c.bindings.pump1Run = 'board.di12'),
    (c) => (c.parameters.PID = 1),
    (c) => (c.labels.pump2 = c.labels.pump1)
  ]) {
    const c = make()
    mutate(c)
    assert.throws(() => validateCaseConfig(c, '1.0.0', r.id))
  }
  const fields = Object.values(r.parameters).map((s) => ({
    name: s.field,
    bind: 'parameter.' + s.name,
    c_type: 'u32',
    access: 'read_write'
  }))
  const scene = {
    source: { projectId: r.projectId, projectVersion: '1.0.0' },
    devices: [],
    parameters: Object.values(r.parameters).map((s) => ({
      name: s.label,
      point: s.field,
      min: s.min,
      max: s.max,
      unit: 'ms'
    }))
  }
  assert.doesNotThrow(() => validateScene(scene, fields, make()))
  scene.parameters[2].min = 1000
  assert.throws(() => validateScene(scene, fields, make()))
})

test('three-pump finite parameters, ordered levels and engineering units are enforced', async () => {
  const { processRecipe } = await import(typeModule)
  const r = processRecipe('three-pump-level-control')
  const make = () => ({ schema: 'np-tools-expo-case-config/v1', caseId: r.id, caseVersion: '1.0.0', projectId: r.projectId, projectVersion: '1.0.0', bindings: { ...r.bindings }, parameters: Object.fromEntries(Object.entries(r.parameters).map(([k, s]) => [k, s.default])), labels: { ...r.labels } })
  assert.equal(validateCaseConfig(make(), '1.0.0', r.id).parameters.targetLevelM, .8)
  for (const mutate of [c => c.parameters.stopLevelM = .8, c => c.parameters.pidKi = NaN, c => c.parameters.pidKp = Infinity, c => c.parameters.targetLevelM = true, c => c.parameters.pidKi = .1234, c => c.parameters.startConfirmMs = 1000.1]) {
    const c = make(); mutate(c); assert.throws(() => validateCaseConfig(c, '1.0.0', r.id))
  }
  const fields = Object.values(r.parameters).map(s => ({ name: s.field, bind: 'parameter.' + s.name, c_type: s.type, access: 'read_write' }))
  const scene = { source: { projectId: r.projectId, projectVersion: '1.0.0' }, devices: [], parameters: Object.values(r.parameters).map(s => ({ name: s.label, point: s.field, min: s.min, max: s.max, unit: s.unit })) }
  assert.doesNotThrow(() => validateScene(scene, fields, make()))
  scene.parameters[0].unit = 'ms'
  assert.throws(() => validateScene(scene, fields, make()))
})
