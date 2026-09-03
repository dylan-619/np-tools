import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { createPinia, disposePinia, setActivePinia } from 'pinia'

// 复用 Vite 的 TypeScript 加载器；只模拟桌面 IPC，不连接控制器。
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom'
})
after(() => server.close())
const { numericWriteConstraints, pointValuesEqual, pointValueMatchesType, writeValueError } =
  await server.ssrLoadModule('/src/utils/controllerDebugValues.ts')
const { useControllerStore } = await server.ssrLoadModule('/src/stores/controllerStore.ts')
const { useControllerDebugStore } = await server.ssrLoadModule(
  '/src/stores/controllerDebugStore.ts'
)

function field(overrides = {}) {
  return {
    id: 'G1_RUN_T',
    name: 'G1_RUN_T',
    bind: 'parameter.run_time',
    c_type: 'u32',
    access: 'read_write',
    reference: '40011',
    ...overrides
  }
}

function descriptor(overrides = {}) {
  return { ...field(), category: 'parameter', writeSupported: true, ...overrides }
}

function setup(
  t,
  { target = field(), before = 0, afterValue, min, max, rejectWrite = false } = {}
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const calls = []
  let current = before
  let reads = 0
  const oldWindow = globalThis.window
  globalThis.window = {
    setInterval: () => 0,
    setTimeout,
    __TAURI_INTERNALS__: {
      invoke: async (command, args) => {
        calls.push({ command, args })
        let body
        let status = 200
        if (command === 'kz3_http_get_point') {
          body = {
            name: args.pointName,
            value: reads++ > 0 && afterValue !== undefined ? afterValue : current,
            quality: 1
          }
        } else if (command === 'kz3_http_write_point') {
          if (rejectWrite) {
            status = 403
            body = { error: { code: 'point_write_failed', message: '点位写入失败' } }
          } else {
            current = args.value
            body = { name: args.pointName, ok: true }
          }
        } else {
          throw new Error(`测试禁止未声明的设备调用：${command}`)
        }
        return { status, body: JSON.stringify(body), contentType: 'application/json', elapsedMs: 1 }
      }
    }
  }
  t.after(() => {
    disposePinia(pinia)
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
  })
  const controller = useControllerStore()
  controller.doc.project.northbound.fields = [target]
  controller.doc.project.application_variables.parameters = [
    { id: 'run_time', name: 'run_time', c_type: target.c_type, default: before, min, max }
  ]
  const debug = useControllerDebugStore()
  debug.session = {
    sessionId: 'mock-session',
    startedAt: Date.now(),
    baseUrl: debug.baseUrl,
    expectedProjectId: controller.doc.project.id,
    expectedProjectVersion: controller.doc.project.version,
    compatibilityState: 'partial'
  }
  debug.operatorName = '自动化测试'
  debug.transportState = 'online'
  debug.compatibilityState = 'partial'
  debug.diagnostics = {
    device: { data: {} },
    health: {
      data: {
        watchdog_healthy: true,
        storage_healthy: true,
        network_healthy: true,
        control_task_healthy: true
      }
    },
    io: { data: { controller_fault: { active: false } } }
  }
  debug.enableWrites('主机模拟，禁止实机请求')
  return { controller, debug, calls }
}

test('U32 校验覆盖全范围、整数要求和工程上下限', () => {
  const target = descriptor()
  assert.deepEqual(numericWriteConstraints(target), { min: 0, max: 4294967295, step: 1 })
  for (const value of [0, 65536, 2147483648, 4294967295])
    assert.equal(writeValueError(target, value), null)
  for (const value of [-1, 1.5, 4294967296, NaN, Infinity, true, '1800', null]) {
    assert.ok(writeValueError(target, value), `应拒绝 ${String(value)}`)
  }
  const limited = descriptor({ min: 1, max: 86400 })
  assert.equal(writeValueError(limited, 1), null)
  assert.equal(writeValueError(limited, 86400), null)
  assert.ok(writeValueError(limited, 0))
  assert.ok(writeValueError(limited, 86401))
  assert.deepEqual(
    numericWriteConstraints(descriptor({ min: -5, max: 1e10 })),
    numericWriteConstraints(target)
  )
})

test('BOOL/FLOAT 和命令使用各自类型规则', () => {
  for (const value of [true, false])
    assert.equal(writeValueError(descriptor({ c_type: 'bool' }), value), null)
  assert.ok(writeValueError(descriptor({ c_type: 'bool' }), 1))
  const float = descriptor({ c_type: 'float', min: -20, max: 20 })
  assert.equal(writeValueError(float, 12.5), null)
  assert.ok(writeValueError(float, 21))
  assert.ok(writeValueError(descriptor({ c_type: 'float' }), 1e39))
  assert.equal(numericWriteConstraints(float).step, 'any')
  const command = descriptor({ c_type: 'bool', category: 'command' })
  assert.equal(writeValueError(command, true), null)
  for (const value of [false, 1, 'true']) assert.ok(writeValueError(command, value))
})

test('整数精确比对，只有 FLOAT 允许舍入误差；读取检查整数宽度', () => {
  assert.equal(pointValuesEqual(4000000000, 3999999999, 'u32'), false)
  assert.equal(pointValuesEqual(4294967295, 4294967295, 'u32'), true)
  assert.equal(pointValuesEqual(12.345678, 12.34568, 'float'), true)
  assert.equal(pointValuesEqual(true, 1, 'bool'), false)
  for (const value of [-1, 0.5, 4294967296, '1800', Infinity])
    assert.equal(pointValueMatchesType('u32', value), false)
  assert.equal(pointValueMatchesType('u32', 4294967295), true)
})

test('descriptor 仅开放 BOOL/FLOAT/U32 参数与 BOOL 命令，包括 runtime 清零', (t) => {
  const { controller, debug } = setup(t)
  const types = ['bool', 'float', 'u32', 'u16', 'i16', 'i32']
  controller.doc.project.northbound.fields = types.map((c_type) => field({ name: c_type, c_type }))
  assert.deepEqual(
    debug.pointDescriptors.filter((item) => item.writeSupported).map((item) => item.c_type),
    ['bool', 'float', 'u32']
  )
  controller.doc.project.northbound.fields = [
    field({ bind: 'runtime.grating_01.clear', c_type: 'bool', description: '累计时间清零' }),
    field({ bind: 'runtime.grating_01.seconds', access: 'read' }),
    field({ bind: 'runtime.grating_01.clear_pending', c_type: 'bool', access: 'read' }),
    field({ bind: 'runtime..clear', c_type: 'bool' }),
    field({ bind: 'command.numeric', c_type: 'u32' }),
    field({ bind: 'point.output', c_type: 'bool' }),
    field({ bind: 'state.running', c_type: 'bool' }),
    field({ access: 'read' })
  ]
  assert.deepEqual(
    debug.pointDescriptors.map((item) => item.writeSupported),
    [true, false, false, false, false, false, false, false]
  )
  assert.equal(debug.pointDescriptors[0].category, 'command')
  assert.equal(debug.pointDescriptors[0].description, '累计时间清零')
})

for (const value of [0, 65536, 2147483648, 4294967295]) {
  test(`U32 ${value} 完整经历写前 GET、单次 POST、写后 GET`, async (t) => {
    const { debug, calls } = setup(t)
    const event = await debug.writePoint('G1_RUN_T', value, 'U32 边界测试', 0)
    assert.deepEqual(
      calls.map((item) => item.command),
      ['kz3_http_get_point', 'kz3_http_write_point', 'kz3_http_get_point']
    )
    assert.equal(calls[1].args.pointName, 'G1_RUN_T')
    assert.equal(calls[1].args.binding, 'parameter.run_time')
    assert.equal(calls[1].args.value, value)
    assert.equal(JSON.stringify({ value: calls[1].args.value }), `{"value":${value}}`)
    assert.equal(event.requestedValue, value)
    assert.equal(event.readbackObserved, 'passed')
  })
}

test('非法参数在任何设备请求前被拒绝', async (t) => {
  const { debug, calls } = setup(t, { min: 1, max: 86400 })
  for (const value of [-1, 0, 0.5, 86401, 4294967296, '1800', false, Infinity]) {
    await assert.rejects(debug.writePoint('G1_RUN_T', value, '非法值测试'))
  }
  assert.equal(calls.length, 0)
})

test('U32 写前值变化 1 时取消写入', async (t) => {
  const { debug, calls } = setup(t, { before: 3999999999 })
  await assert.rejects(debug.writePoint('G1_RUN_T', 1800, '写前快照测试', 4000000000), /已取消写入/)
  assert.equal(calls.length, 1)
  assert.equal(debug.writesEnabled, false)
})

test('U32 写后值相差 1 时判失败并上锁', async (t) => {
  const { debug } = setup(t, { afterValue: 3999999999 })
  const event = await debug.writePoint('G1_RUN_T', 4000000000, '写后比对测试')
  assert.equal(event.readbackObserved, 'failed')
  assert.equal(debug.writesEnabled, false)
})

test('U32 变化 1 时仍记录监视值变化', async (t) => {
  const { debug } = setup(t, { before: 4000000000, afterValue: 3999999999 })
  await debug.readPoint('G1_RUN_T')
  const changed = await debug.readPoint('G1_RUN_T')
  assert.ok(changed.changedAt)
  assert.equal(changed.previousValue, 4000000000)
})

for (const value of [0.5, -1, 4294967296]) {
  test(`设备 U32 响应 ${value} 触发类型不匹配`, async (t) => {
    const { debug } = setup(t, { before: value })
    await assert.rejects(debug.readPoint('G1_RUN_T'), /类型与工程/)
    assert.equal(debug.compatibilityState, 'mismatch')
    assert.equal(debug.writesEnabled, false)
  })
}

for (const bind of ['command.start', 'runtime.grating_01.clear']) {
  test(`${bind} 只发一次 true，指令已消费不误报读回失败`, async (t) => {
    const { debug, calls } = setup(t, {
      target: field({ bind, c_type: 'bool' }),
      before: false,
      afterValue: false
    })
    await assert.rejects(debug.writePoint('G1_RUN_T', false, '命令测试'))
    await assert.rejects(debug.writePoint('G1_RUN_T', 1, '命令测试'))
    assert.equal(calls.length, 0)
    const event = await debug.writePoint('G1_RUN_T', true, '命令测试')
    assert.equal(calls.filter((item) => item.command === 'kz3_http_write_point').length, 1)
    assert.equal(calls[1].args.binding, bind)
    assert.equal(event.acceptedByOwner, true)
    assert.equal(event.readbackObserved, 'unknown')
    assert.equal(debug.writesEnabled, true)
  })
}

test('设备拒绝不重试，且未解锁时禁止请求', async (t) => {
  const { debug, calls } = setup(t, { rejectWrite: true })
  await assert.rejects(debug.writePoint('G1_RUN_T', 1800, '拒绝测试'), /点位写入失败/)
  assert.equal(calls.filter((item) => item.command === 'kz3_http_write_point').length, 1)
  assert.equal(debug.writesEnabled, false)
  await assert.rejects(debug.writePoint('G1_RUN_T', 1800, '上锁测试'), /许可未启用/)
  assert.equal(calls.length, 2)
})

for (const [c_type, value, before] of [
  ['bool', false, true],
  ['float', 12.5, 10]
]) {
  test(`${c_type} 参数写入保持可用`, async (t) => {
    const { debug } = setup(t, { target: field({ c_type }), before })
    const event = await debug.writePoint('G1_RUN_T', value, '已有类型回归')
    assert.equal(event.readbackObserved, 'passed')
  })
}
