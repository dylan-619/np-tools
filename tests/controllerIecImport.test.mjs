import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { dump, load } from 'js-yaml'

const server = await createServer({
  root: process.env.NP_TOOLS_TEST_ROOT || process.cwd(), configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom'
})
after(() => server.close())
const { deserializeProjectIoYaml, serializeProjectIoYaml } = await server.ssrLoadModule('/src/utils/yamlHelper.ts')
const { buildKz3PointManifest } = await server.ssrLoadModule('/src/utils/kz3ProjectManifest.ts')
const { useControllerStore } = await server.ssrLoadModule('/src/stores/controllerStore.ts')
const { useControllerDebugStore } = await server.ssrLoadModule('/src/stores/controllerDebugStore.ts')
const fixture = new URL('./fixtures/kz3-iec-two-pump/', import.meta.url)
const source = await readFile(new URL('project_io.yaml', fixture), 'utf8')
// 由当前 SDK ProjectModel.derive() + _point_manifest() 生成；包含原始未加引号的 00008。
const expected = JSON.parse(await readFile(new URL('expected-debug.json', fixture), 'utf8'))

function stores(t) {
  const pinia = createPinia()
  setActivePinia(pinia)
  t.after(() => disposePinia(pinia))
  return { controller: useControllerStore(), debug: useControllerDebugStore() }
}

test('IEC 双泵工程导入 46 字段，顺序、类型和地址与 SDK manifest 一致', async () => {
  const doc = deserializeProjectIoYaml(source)
  const fields = doc.project.northbound.fields
  const manifest = await buildKz3PointManifest(fields)
  assert.equal(doc.schema, 'kz3-iec-project-io/v1')
  assert.equal(fields.length, 46)
  assert.equal(manifest.hash, expected.manifestHash)
  assert.deepEqual(fields.map(field => {
    const runtimeField = { ...field }
    delete runtimeField.id
    delete runtimeField.description
    return runtimeField
  }), expected.fields)
  assert.equal(fields.find(f => f.name === 'P2_RST').reference, '00008')
  assert.equal(doc.project.points.inputs.length, 8)
  assert.equal(doc.project.points.outputs.length, 2)
  assert.equal(doc.project.application_variables.parameters.length, 6)
  assert.equal(doc.project.application_variables.commands.length, 6)
  assert.equal(doc.project.application_variables.states.length, 26)
})

test('IEC 原始 YAML 字节往返保留绑定、历史/预留地址和未知字段，不虚构 XML 初值', () => {
  const raw = load(source)
  raw.future = { preserved: false }
  raw.northbound.layout[0].status = 'retired'
  raw.northbound.reserved = [{ reference: '10099', width: 1, reason: '测试占位' }]
  const text = '# 保留工程注释\n' + dump(raw)
  const doc = deserializeProjectIoYaml(text)
  assert.equal(doc.project.northbound.fields.length, 45)
  assert.equal(serializeProjectIoYaml(doc), text)
  assert.equal(doc.project.scan_period_ms, undefined)
  for (const variable of [...doc.project.application_variables.parameters, ...doc.project.application_variables.states])
    assert.equal(variable.default, undefined)
  doc.project.northbound.fields[0].name = 'EDITED'
  assert.throws(() => serializeProjectIoYaml(doc), /PLC IDE 修改后重新导入/)
})

test('IEC 调试描述保留持久参数范围、单位、物理源和可写类别，写入仍需在线门禁', (t) => {
  const { controller, debug } = stores(t)
  controller.doc = deserializeProjectIoYaml(source)
  const descriptors = debug.pointDescriptors
  assert.equal(descriptors.length, 46)
  const run = descriptors.find(f => f.name === 'P1_RUN_M')
  assert.equal(run.category, 'parameter')
  assert.equal(run.min, 0)
  assert.equal(run.max, 1440)
  assert.equal(run.unit, 'min')
  assert.equal(run.persistent, true)
  assert.equal(run.writeSupported, true)
  assert.equal(descriptors.find(f => f.name === 'P1_REM').source, 'board.di01')
  assert.equal(descriptors.find(f => f.name === 'P1_DO').category, 'output')
  assert.equal(descriptors.find(f => f.name === 'P1_HZ').unit, 'Hz')
  assert.equal(descriptors.find(f => f.name === 'P1_HZ').writeSupported, false)
  assert.equal(descriptors.filter(f => f.category === 'command').length, 6)
  assert.equal(debug.canEnableWrites, false)
  assert.equal(debug.writesEnabled, false)
})

test('IEC 显式 binding_id 和 Base 字段不要求伪造 IEC 变量', () => {
  const raw = load(source)
  raw.northbound.layout[0].binding_id = raw.northbound.layout[0].publish_id
  raw.northbound.layout[0].publish_id = 'publication_separate'
  raw.northbound.layout.push({ publish_id: 'runtime_clear', binding_id: null, status: 'active',
    field: { name: 'RUNTIME_CLEAR', bind: 'runtime.pump.clear', c_type: 'bool', access: 'read_write', reference: '00099' } })
  const doc = deserializeProjectIoYaml(dump(raw))
  assert.equal(doc.project.northbound.fields.length, 47)
  assert.equal(doc.project.northbound.fields.at(-1).bind, 'runtime.pump.clear')
})

test('IEC 畸形布局、丢失绑定、重复身份及未知状态明确拒绝', () => {
  for (const mutate of [
    raw => { raw.bindings = {} },
    raw => { raw.northbound.layout[0].status = 'future' },
    raw => { raw.northbound.layout[0].field.reference = 'invalid' },
    raw => { raw.northbound.layout[0].field.bind = 'point.missing' },
    raw => { raw.northbound.layout[0].field.access = 'read_write' },
    raw => { raw.bindings.push(raw.bindings[0]) },
    raw => { raw.northbound.layout.push(raw.northbound.layout[0]) },
    raw => { raw.bindings.find(b => b.role === 'parameter').options.persistent = 'false' }
  ]) {
    const raw = load(source)
    mutate(raw)
    assert.throws(() => deserializeProjectIoYaml(dump(raw)))
  }
})

test('导入文件入口保留当前 IEC 工程，不回退到默认旧点表', async (t) => {
  const oldWindow = globalThis.window
  globalThis.window = { setTimeout, clearTimeout, setInterval: () => 0, __TAURI_INTERNALS__: {
    invoke: async command => {
      assert.equal(command, 'app_open_file')
      return ['/tmp/project_io.yaml', source]
    }
  } }
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow })
  const { controller, debug } = stores(t)
  await controller.importYamlFile()
  assert.equal(controller.currentConfigurationSource, 'imported')
  assert.equal(controller.doc.project.id, 'demo-two-pump-time-run')
  assert.equal(controller.toastMessage.isSuccess, true)
  assert.equal(debug.pointDescriptors.length, 46)
  assert.equal(controller.getYamlString(), source)
})
