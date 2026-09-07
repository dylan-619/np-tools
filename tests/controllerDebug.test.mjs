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
const kz3Manifest = await server.ssrLoadModule('/src/utils/kz3ProjectManifest.ts')
const protocol = await server.ssrLoadModule('/src/utils/kz3UartProtocol.ts')
const xtqProtocol = await server.ssrLoadModule('/src/utils/xtqCoordinatorProtocol.ts')
const sjzdModbusDebug = await server.ssrLoadModule('/src/utils/sjzdModbusDebug.ts')
const { useSerialStore } = await server.ssrLoadModule('/src/stores/serialStore.ts')
const { useXtqCoordinatorStore } = await server.ssrLoadModule(
  '/src/stores/xtqCoordinatorStore.ts'
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

function setup(t, { target = field(), before = 0, afterValue, min, max } = {}) {
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
  return { controller, debug, calls }
}

function diagnosticResponse(data) {
  return {
    status: 200,
    body: JSON.stringify({ api_version: 'v1', timestamp_ms: 1, data }),
    contentType: 'application/json',
    elapsedMs: 1
  }
}

function pointResponse(name, value) {
  return {
    status: 200,
    body: JSON.stringify({ name, value, quality: 1 }),
    contentType: 'application/json',
    elapsedMs: 1
  }
}

/**
 * 模拟 KZ3 的 HTTP 调试契约，不连接真机。连接完成后立刻停止周期轮询，
 * 让测试只覆盖显式调用路径。
 */
async function setupVerifiedKz3(
  t,
  { fields, values = {}, projectOverrides = {}, writeStatus = 200 } = {}
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const calls = []
  const oldWindow = globalThis.window
  const realSetTimeout = globalThis.setTimeout
  globalThis.window = {
    setInterval: () => 0,
    // 不执行 0 ms 的轮询回调；写后读回的 120 ms 等待仍异步完成。
    setTimeout: (callback, delay = 0, ...args) =>
      delay === 0 ? 0 : realSetTimeout(callback, 0, ...args),
    __TAURI_INTERNALS__: {
      invoke: async (command, args) => {
        calls.push({ command, args })
        if (command === 'kz3_http_get_diagnostic') {
          const data = diagnostics[args.resource]
          if (data === undefined) throw new Error(`测试未声明诊断资源：${args.resource}`)
          return diagnosticResponse(data)
        }
        if (command === 'kz3_http_get_point') {
          return pointResponse(args.pointName, pointValues[args.pointName])
        }
        if (command === 'kz3_http_write_point') {
          if (writeStatus >= 200 && writeStatus < 300) {
            pointValues[args.pointName] = args.value
          }
          return {
            status: writeStatus,
            body:
              writeStatus >= 200 && writeStatus < 300
                ? JSON.stringify({ name: args.pointName, ok: true })
                : JSON.stringify({ error: { code: 'point_write_failed', message: '点位写入失败' } }),
            contentType: 'application/json',
            elapsedMs: 1
          }
        }
        throw new Error(`测试禁止未声明的设备调用：${command}`)
      }
    }
  }
  t.after(() => {
    disposePinia(pinia)
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
  })

  const controller = useControllerStore()
  const projectFields = fields || [field({ name: 'parameter.gain', bind: 'parameter.gain', c_type: 'float' })]
  controller.doc.project.northbound.fields = projectFields
  controller.doc.project.application_variables.parameters = projectFields
    .filter((item) => item.bind.startsWith('parameter.'))
    .map((item) => ({
      id: item.id,
      name: item.bind.slice('parameter.'.length),
      c_type: item.c_type,
      default: item.c_type === 'bool' ? false : 0
    }))
  controller.doc.project.application_variables.commands = projectFields
    .filter((item) => item.bind.startsWith('command.'))
    .map((item) => ({
      id: item.id,
      name: item.bind.slice('command.'.length),
      c_type: 'bool'
    }))
  controller.doc.project.application_variables.states = []

  const manifest = await kz3Manifest.buildKz3PointManifest(projectFields)
  const pointValues = Object.fromEntries(
    projectFields.map((item) => [item.name, values[item.name] ?? (item.c_type === 'bool' ? false : 0)])
  )
  const diagnostics = {
    device: { device_type: 'KZ3-F427' },
    hardware: {},
    project: {
      project_id: controller.doc.project.id,
      project_version: controller.doc.project.version,
      schema_version: 5,
      firmware_build_id: 'host-test-build',
      configuration_hash: 0xb2ff5c80,
      config_revision: 7,
      point_manifest_algorithm: manifest.algorithm,
      point_manifest_hash: manifest.hash,
      point_count: manifest.pointCount,
      ...projectOverrides
    },
    network: {},
    sle: {},
    config: {},
    services: {},
    health: {
      watchdog_healthy: true,
      storage_healthy: true,
      network_healthy: true,
      control_task_healthy: true
    },
    io: { controller_fault: { active: false } }
  }
  const debug = useControllerDebugStore()
  debug.operatorName = '自动化测试'
  await debug.connect()
  debug.stopPolling()
  return { controller, debug, calls, diagnostics, manifest, pointValues }
}

function xtqStatus({ sequence = 1, jsonLength = 0, rules = 0 } = {}) {
  return {
    target: 'F407VGT6',
    firmware: 'host-test',
    radios: [{}, {}],
    routing: { neighbors: 0, routes: 0, conflicts: 0, dropped: 0 },
    points: { used: 0, updates: 0, evictions: 0 },
    sync: {
      sequence,
      json_length: jsonLength,
      rules,
      runs: 0,
      source_missing: 0,
      target_failures: 0
    },
    network: { ready: 0, state: 0, queued: 0, sent: 0, received: 0, dropped: 0, protocol_errors: 0 },
    capabilities: 0,
    provisioning_timeouts: 0
  }
}

function setupXtq(t) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const oldWindow = globalThis.window
  globalThis.window = { setTimeout, clearTimeout }
  t.after(() => {
    disposePinia(pinia)
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
  })

  const serial = useSerialStore()
  serial.connectedPort = 'mock-xtq'
  Object.assign(serial.config, {
    baudRate: 115200,
    dataBits: 'eight',
    stopBits: 'one',
    parity: 'none',
    flowControl: 'none'
  })
  let lineListener
  let responder = () => undefined
  const sent = []
  serial.registerLineListener = (_id, listener) => {
    lineListener = listener
  }
  serial.unregisterLineListener = () => {
    lineListener = undefined
  }
  serial.sendRaw = async (text, options) => {
    sent.push({ text, options })
    const response = responder(text, options)
    if (response !== undefined) {
      Promise.resolve().then(() => {
        for (const line of Array.isArray(response) ? response : [response]) lineListener?.(line)
      })
    }
  }

  return {
    coordinator: useXtqCoordinatorStore(),
    serial,
    sent,
    setResponder: (nextResponder) => {
      responder = nextResponder
    }
  }
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

test('KZ3 点表 manifest 字节序列与固件生成器一致', async () => {
  const result = await kz3Manifest.buildKz3PointManifest([
    field({
      name: 'command.start',
      bind: 'command.start',
      c_type: 'bool',
      access: 'read_write',
      reference: '00001'
    }),
    field({
      name: 'parameter.gain',
      bind: 'parameter.gain',
      c_type: 'float',
      access: 'read_write',
      reference: '40001'
    }),
    field({
      name: 'state.counter',
      bind: 'state.counter',
      c_type: 'u32',
      access: 'read',
      reference: '30001'
    }),
    field({
      name: 'state.mode',
      bind: 'state.mode',
      c_type: 'i32',
      access: 'read',
      reference: '30003'
    })
  ])
  assert.equal(result.algorithm, 'sha256-kz3-north-fields-canonical-v1')
  assert.equal(
    result.canonicalJson,
    '["kz3-point-manifest/v1",[["command.start","command.start","bool","read_write","00001",1],["parameter.gain","parameter.gain","f32","read_write","40001",2],["state.counter","state.counter","u32","read","30001",2],["state.mode","state.mode","i32","read","30003",1]]]'
  )
  assert.equal(result.hash, '0544a922fa1a90ad1e794a042aac4370da91fe57b9beb9f1025a53c3e1621b2c')
  await assert.rejects(
    kz3Manifest.buildKz3PointManifest([
      field({ name: 'parameter.legacy_i16', bind: 'parameter.legacy_i16', c_type: 'i16' })
    ]),
    /不支持本地点位类型 i16/
  )
})

test('KZ3 descriptor 只开放当前 HTTP owner 实际可处理的北向写入', (t) => {
  const { controller, debug } = setup(t)
  controller.doc.project.northbound.fields = [
    field({ name: 'parameter.enabled', bind: 'parameter.enabled', c_type: 'bool' }),
    field({ name: 'parameter.gain', bind: 'parameter.gain', c_type: 'float' }),
    field({ name: 'parameter.count16', bind: 'parameter.count16', c_type: 'u16' }),
    field({ name: 'parameter.count32', bind: 'parameter.count32', c_type: 'u32' }),
    field({ name: 'parameter.offset16', bind: 'parameter.offset16', c_type: 'i16' }),
    field({ name: 'parameter.offset32', bind: 'parameter.offset32', c_type: 'i32' }),
    field({ name: 'command.start', bind: 'command.start', c_type: 'bool' }),
    field({ bind: 'runtime.grating_01.clear', c_type: 'bool', description: '累计时间清零' }),
    field({ name: 'point.output', bind: 'point.output', c_type: 'bool' }),
    field({ name: 'state.running', bind: 'state.running', c_type: 'bool' }),
    field({ name: 'parameter.read_only', bind: 'parameter.read_only', c_type: 'bool', access: 'read' })
  ]
  assert.deepEqual(debug.pointDescriptors.map((item) => item.writeSupported), [
    true,
    true,
    false,
    false,
    false,
    false,
    true,
    true,
    false,
    false,
    false
  ])
  assert.match(debug.pointDescriptors[2].writeDisabledReason, /BOOL\/FLOAT parameter/)
  assert.equal(debug.pointDescriptors[7].category, 'command')
  assert.equal(debug.pointDescriptors[7].description, '累计时间清零')
  assert.match(debug.pointDescriptors[8].writeDisabledReason, /禁止|仅允许/)
  assert.match(debug.pointDescriptors[10].writeDisabledReason, /只读/)
})

test('KZ3 掉电保持 parameter 不会被误标为 RAM 参数', (t) => {
  const target = field({
    name: 'parameter.gain',
    bind: 'parameter.gain',
    c_type: 'float',
    reference: '40001'
  })
  const { controller, debug } = setup(t, { target })
  controller.doc.project.application_variables.parameters = [
    { id: 'gain', name: 'gain', c_type: 'float', default: 12, persistent: true }
  ]
  const descriptor = debug.pointDescriptors[0]
  assert.equal(descriptor.persistent, true)
  assert.match(descriptor.description, /掉电保持参数/)
  assert.match(descriptor.valueSemantic, /重启恢复/)
})

test('KZ3 在线调试在工程身份未核验时不发送任何点位写入请求', async (t) => {
  const target = field({
    name: 'parameter.gain',
    bind: 'parameter.gain',
    c_type: 'float',
    reference: '40001'
  })
  const { debug, calls } = setup(t, { target })
  assert.equal(debug.compatibilityState, 'partial')
  assert.equal(debug.canEnableWrites, false)
  assert.equal(debug.writesEnabled, false)
  assert.throws(() => debug.enableWrites('主机模拟'), /当前设备状态不满足写入门禁/)
  await assert.rejects(
    debug.writePoint(target.name, 1.25, '写入拦截测试'),
    /北向写入许可未启用或已失效/
  )
  assert.equal(calls.length, 0)
})

test('KZ3 工程 ID、版本和点表 manifest 匹配后才可申请受控写入', async (t) => {
  const target = field({
    name: 'parameter.gain',
    bind: 'parameter.gain',
    c_type: 'float',
    reference: '40001'
  })
  const { debug, calls } = await setupVerifiedKz3(t, {
    fields: [target],
    values: { [target.name]: 1.25 }
  })
  assert.equal(debug.compatibilityState, 'matched')
  assert.equal(debug.canEnableWrites, true)
  assert.equal(debug.writesEnabled, false)
  assert.equal(debug.session.expectedManifestHash?.length, 64)
  assert.equal(
    calls.filter(
      (item) => item.command === 'kz3_http_write_point'
    ).length,
    0
  )
})

test('KZ3 manifest 不匹配保持写入锁定且不会发送 POST', async (t) => {
  const target = field({
    name: 'parameter.gain',
    bind: 'parameter.gain',
    c_type: 'float',
    reference: '40001'
  })
  const { debug, calls } = await setupVerifiedKz3(t, {
    fields: [target],
    projectOverrides: {
      point_manifest_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    }
  })
  assert.equal(debug.compatibilityState, 'mismatch')
  assert.equal(debug.canEnableWrites, false)
  assert.match(debug.compatibilityReason, /manifest hash 不一致/)
  assert.throws(() => debug.enableWrites('主机模拟'), /当前设备状态不满足写入门禁/)
  await assert.rejects(debug.writePoint(target.name, 2.5, '写入拦截测试'), /北向写入许可未启用/)
  assert.equal(calls.some((item) => item.command === 'kz3_http_write_point'), false)
})

test('KZ3 parameter 写入会在 POST 前重新校验工程契约并完成读回', async (t) => {
  const target = field({
    name: 'parameter.gain',
    bind: 'parameter.gain',
    c_type: 'float',
    reference: '40001'
  })
  const { debug, calls, pointValues } = await setupVerifiedKz3(t, {
    fields: [target],
    values: { [target.name]: 1.25 }
  })
  debug.enableWrites('HOST-KZ3-001')
  const event = await debug.writePoint(target.name, 12.5, 'HOST-KZ3-001')
  const projectReads = calls.filter(
    (item) => item.command === 'kz3_http_get_diagnostic' && item.args.resource === 'project'
  )
  const writes = calls.filter((item) => item.command === 'kz3_http_write_point')
  assert.equal(projectReads.length, 2)
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].args, {
    baseUrl: debug.baseUrl,
    pointName: target.name,
    binding: target.bind,
    value: 12.5
  })
  assert.equal(pointValues[target.name], 12.5)
  assert.equal(event.transportOk, true)
  assert.equal(event.acceptedByOwner, true)
  assert.equal(event.beforeValue, 1.25)
  assert.equal(event.afterValue, 12.5)
  assert.equal(event.readbackObserved, 'passed')
  assert.equal(debug.writesEnabled, true)
})

test('KZ3 写入前复核发现 active fault 时取消 POST 并重新上锁', async (t) => {
  const target = field({
    name: 'parameter.gain',
    bind: 'parameter.gain',
    c_type: 'float',
    reference: '40001'
  })
  const { debug, calls, diagnostics } = await setupVerifiedKz3(t, { fields: [target] })
  debug.enableWrites('HOST-KZ3-FAULT')
  diagnostics.io.controller_fault.active = true
  await assert.rejects(
    debug.writePoint(target.name, 12.5, 'HOST-KZ3-FAULT'),
    /工程身份、健康或控制器状态校验未通过/
  )
  assert.equal(calls.filter((item) => item.command === 'kz3_http_write_point').length, 0)
  assert.equal(debug.writesEnabled, false)
})

test('KZ3 周期 project 复核发现设备点表变化后解除写入许可', async (t) => {
  const target = field({
    name: 'parameter.gain',
    bind: 'parameter.gain',
    c_type: 'float',
    reference: '40001'
  })
  const { debug, diagnostics } = await setupVerifiedKz3(t, { fields: [target] })
  debug.enableWrites('HOST-KZ3-POLL')
  diagnostics.project.point_manifest_hash =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  for (let index = 0; index < 5; index += 1) await debug.pollOnce()
  assert.equal(debug.compatibilityState, 'mismatch')
  assert.match(debug.compatibilityReason, /manifest hash 不一致/)
  assert.equal(debug.writesEnabled, false)
})

test('KZ3 会话内 configuration_hash 变化即使点表相同也会解除写入许可', async (t) => {
  const target = field({
    name: 'parameter.gain',
    bind: 'parameter.gain',
    c_type: 'float',
    reference: '40001'
  })
  const { debug, diagnostics } = await setupVerifiedKz3(t, { fields: [target] })
  debug.enableWrites('HOST-KZ3-CONFIG-DRIFT')
  diagnostics.project.configuration_hash = 0x10203040
  for (let index = 0; index < 5; index += 1) await debug.pollOnce()
  assert.equal(debug.compatibilityState, 'mismatch')
  assert.match(debug.compatibilityReason, /configuration_hash 已变化/)
  assert.equal(debug.writesEnabled, false)
})

test('KZ3 HTTP 写入失败不会自动重试', async (t) => {
  const target = field({
    name: 'parameter.gain',
    bind: 'parameter.gain',
    c_type: 'float',
    reference: '40001'
  })
  const { debug, calls } = await setupVerifiedKz3(t, { fields: [target], writeStatus: 503 })
  debug.enableWrites('HOST-KZ3-RETRY')
  await assert.rejects(debug.writePoint(target.name, 12.5, 'HOST-KZ3-RETRY'), /点位写入失败/)
  assert.equal(calls.filter((item) => item.command === 'kz3_http_write_point').length, 1)
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

test('XTQ Capability 槽位严格复现固件持久化约束', () => {
  assert.equal(xtqProtocol.capabilityOwnerForSlot(0), 'DeviceCapability0')
  assert.equal(xtqProtocol.capabilityOwnerForSlot(31), 'DeviceCapability31')
  assert.throws(() => xtqProtocol.capabilityOwnerForSlot(32), /0~31/)
  assert.deepEqual(xtqProtocol.validateCapabilityValue({ enabled: false }), { enabled: false })
  const capability = {
    enabled: true,
    sn: 'SJZ000000001',
    reported_app_addr: 258,
    radio_dest_addr: 4660,
    downlink_codec: 2,
    ack_codec: 2,
    radio_addr_source: 2
  }
  assert.deepEqual(xtqProtocol.validateCapabilityValue(capability), capability)
  assert.match(
    xtqProtocol.buildCapabilitySetCommand(4, JSON.stringify(capability)).command,
    /^@CFG SET DeviceCapability4 /
  )
  assert.throws(
    () =>
      xtqProtocol.validateCapabilityValue({
        ...capability,
        radio_addr_source: 0
      }),
    /radio_dest_addr 必须为 0/
  )
  assert.throws(
    () => xtqProtocol.validateCapabilityValue({ enabled: false, sn: 'SJZ000000001' }),
    /包含未知字段/
  )
})

test('XTQ 同步规则规范化、CRC32 和单次上传帧与固件契约一致', () => {
  const prepared = xtqProtocol.buildSyncPayload(
    JSON.stringify({
      rules: [
        {
          mappings: [
            {
              to_key: '远程液位',
              to_sn: '450125030002',
              data_type: 'real',
              from_key: 'Level',
              from_sn: '450125030001'
            }
          ],
          interval_seconds: 10,
          enabled: true,
          name: '液位同步',
          id: 'R01'
        }
      ],
      cache_ttl_seconds: 600,
      enabled: true,
      version: 1
    })
  )
  const expected =
    '{"version":1,"enabled":true,"cache_ttl_seconds":600,"rules":[{"id":"R01","name":"液位同步","enabled":true,"interval_seconds":10,"mappings":[{"from_sn":"450125030001","from_key":"Level","data_type":"REAL","to_sn":"450125030002","to_key":"远程液位"}]}]}'
  assert.equal(prepared.canonicalJson, expected)
  assert.equal(prepared.byteLength, 259)
  assert.equal(prepared.crc32, '6C735C9B')
  assert.equal(
    prepared.payload,
    `@SYNC BEGIN 259 6C735C9B\r\n${expected}\r\n@SYNC COMMIT\r\n`
  )
  const empty = xtqProtocol.buildSyncPayload(
    '{"version":1,"enabled":false,"cache_ttl_seconds":600,"rules":[]}'
  )
  assert.equal(empty.byteLength, 64)
  assert.equal(empty.crc32, '401C8BEF')
})

test('XTQ 同步规则在写设备前拒绝冲突目标与超出字段契约的草稿', () => {
  const mapping = {
    from_sn: '450125030001',
    from_key: 'Level',
    data_type: 'REAL',
    to_sn: '450125030002',
    to_key: 'RemoteLevel'
  }
  const base = {
    version: 1,
    enabled: true,
    cache_ttl_seconds: 600,
    rules: [
      {
        id: 'R01',
        name: '规则一',
        enabled: true,
        interval_seconds: 10,
        mappings: [mapping]
      },
      {
        id: 'R02',
        name: '规则二',
        enabled: true,
        interval_seconds: 10,
        mappings: [{ ...mapping, from_sn: '450125030003', from_key: 'Pressure' }]
      }
    ]
  }
  assert.throws(() => xtqProtocol.buildSyncPayload(JSON.stringify(base)), /映射目标重复/)
  assert.throws(
    () =>
      xtqProtocol.buildSyncPayload(
        JSON.stringify({ ...base, unexpected: true, rules: [base.rules[0]] })
      ),
    /包含未知字段/
  )
})

test('SJZ 原始 Modbus 调试日志未提供结构化结束帧时不伪造单点诊断通过', () => {
  const point = {
    slaveAddr: 7,
    funcCode: 3,
    regAddr: 40001,
    length: 2,
    dataType: 5,
    byteOrder: 1
  }
  const lines = [
    'MB DEBUG: slave=7 func=3 register=40001 length=2',
    'MB DEBUG TX: 07 03 00 00 00 02 C4 6C',
    'MB DEBUG RX: 07 03 04 00 00 42 F7 19 D6'
  ]
  const events = lines
    .map((line) => sjzdModbusDebug.parseModbusDebugProtocolLine(line))
    .filter(Boolean)
  const report = sjzdModbusDebug.buildModbusDebugReport(
    point,
    'mock-sjz',
    '2026-09-05T00:00:00.000Z',
    '2026-09-05T00:00:01.000Z',
    events,
    lines
  )
  assert.equal(report.status, 'protocol_error')
  assert.match(report.message, /不能将原始日志视为单点诊断通过/)
})

test('SJZ 结构化诊断解析器保留同一事务 ID 的异常码，并拒绝缺少 END 的结果', () => {
  const point = { slaveAddr: 1, funcCode: 4, regAddr: 30001, length: 1, dataType: 2, byteOrder: 0 }
  const exceptionLines = [
    'MB_DEBUG:BEGIN,id=8,point_revision=1,addr=1,func=4,reg=30001,len=1,timeout_ms=1000',
    'MB_DEBUG:TX,id=8,hex=0104753000018A0B',
    'MB_DEBUG:RX,id=8,hex=018402C0F1',
    'MB_DEBUG:RESULT,id=8,status=EXCEPTION,code=0x02',
    'MB_DEBUG:END,id=8'
  ]
  const exception = sjzdModbusDebug.buildModbusDebugReport(
    point,
    'mock-sjz',
    '2026-09-05T00:00:00.000Z',
    '2026-09-05T00:00:01.000Z',
    exceptionLines.map((line) => sjzdModbusDebug.parseModbusDebugProtocolLine(line)),
    exceptionLines
  )
  assert.equal(exception.status, 'exception')
  assert.equal(exception.response.exceptionCode, 2)
  const incomplete = sjzdModbusDebug.buildModbusDebugReport(
    point,
    'mock-sjz',
    '2026-09-05T00:00:00.000Z',
    '2026-09-05T00:00:01.000Z',
    [sjzdModbusDebug.parseModbusDebugProtocolLine('MB_DEBUG:RESULT,id=9,status=OK')],
    ['MB_DEBUG:RESULT,id=9,status=OK']
  )
  assert.equal(incomplete.status, 'protocol_error')
  assert.match(incomplete.message, /不能将原始日志视为单点诊断通过/)
})

test('XTQ 有效状态采样保留时间线并仅导出已定义字段的结构化差异', async (t) => {
  const { coordinator, setResponder } = setupXtq(t)
  const first = xtqStatus()
  first.boot_id = 7
  first.radios = [
    {
      role: 0,
      state: 1,
      ready: 1,
      sta: 0,
      address: 16,
      recoveries: 0,
      valid_frames: 10,
      uart_errors: 0,
      rx_restarts: 0,
      invalid_frames: 0,
      dropped_bytes: 0
    },
    {
      role: 1,
      state: 1,
      ready: 1,
      sta: 0,
      address: 32,
      recoveries: 0,
      valid_frames: 11,
      uart_errors: 0,
      rx_restarts: 0,
      invalid_frames: 0,
      dropped_bytes: 0
    }
  ]
  const second = {
    ...first,
    boot_id: 8,
    routing: { ...first.routing, dropped: 3 },
    radios: [{ ...first.radios[0], recoveries: 1 }, first.radios[1]],
    ignored_future_field: { arbitrary: 'firmware extension' }
  }
  let call = 0
  setResponder((text) => {
    if (text !== '@STATUS') throw new Error(`未期望的 XTQ 状态命令：${text}`)
    return `OK ${JSON.stringify(call++ === 0 ? first : second)}`
  })

  assert.equal((await coordinator.queryStatus()).status, 'ok')
  assert.equal((await coordinator.queryStatus()).status, 'ok')
  assert.equal(coordinator.statusHistory.length, 2)
  assert.equal(coordinator.previousStatus.boot_id, 7)
  assert.deepEqual(
    coordinator.latestStatusDifferences.map((item) => item.path),
    ['boot_id', 'radios[0].recoveries', 'routing.dropped']
  )
  assert.equal(
    coordinator.latestStatusDifferences.some((item) => item.path === 'ignored_future_field'),
    false
  )
  const diagnostic = JSON.parse(coordinator.exportDiagnostic())
  assert.equal(diagnostic.schema, 'np-tools.xtq-coordinator-diagnostic.v5')
  assert.equal(diagnostic.statusHistory.length, 2)
  assert.equal(diagnostic.latestStatusDifferences[2].after, 3)
  coordinator.clearStatusHistory()
  assert.equal(coordinator.statusHistory.length, 0)
  assert.equal(coordinator.previousStatus, null)
})

test('XTQ 会话以精确同步字节帧上传，Capability 写入后只核对状态摘要', async (t) => {
  const { coordinator, sent, setResponder } = setupXtq(t)
  const capability = {
    enabled: true,
    sn: '450125030001',
    reported_app_addr: 258,
    radio_dest_addr: 4660,
    downlink_codec: 2,
    ack_codec: 2,
    radio_addr_source: 2
  }
  const syncDraft = '{"version":1,"enabled":false,"cache_ttl_seconds":600,"rules":[]}'
  const prepared = xtqProtocol.buildSyncPayload(syncDraft)
  let syncUploaded = false
  setResponder((text) => {
    if (text === '@STATUS') {
      return `OK ${JSON.stringify(
        xtqStatus({
          sequence: syncUploaded ? 2 : 1,
          jsonLength: syncUploaded ? prepared.byteLength : 0,
          rules: 0
        })
      )}`
    }
    if (text === '@CFG GET DeviceCapability4') return `OK ${JSON.stringify(capability)}`
    if (text.startsWith('@CFG SET DeviceCapability4 ')) return 'OK'
    if (text === prepared.payload) {
      syncUploaded = true
      return 'OK'
    }
    throw new Error(`未期望的 XTQ 测试命令：${text}`)
  })

  assert.equal((await coordinator.queryStatus()).status, 'ok')
  assert.equal((await coordinator.readCapability(4)).status, 'ok')
  assert.equal((await coordinator.writeCapability(4, JSON.stringify(capability))).status, 'ok')
  const syncRecord = await coordinator.uploadSyncConfiguration(syncDraft)

  assert.equal(syncRecord.status, 'ok')
  assert.equal(coordinator.capabilitySnapshots[4].value.sn, capability.sn)
  assert.equal(coordinator.lastSyncUpload.summaryMatched, true)
  assert.equal(coordinator.lastSyncUpload.contentVerified, false)
  assert.match(coordinator.lastSyncUpload.verificationMessage, /未提供同步规则完整读回/)
  assert.equal(coordinator.records.some((item) => item.operation === 'sync_read'), false)
  assert.equal(sent.some((item) => item.text === '@SYNC GET'), false)
  const syncWrite = sent.find((item) => item.text === prepared.payload)
  assert.ok(syncWrite)
  assert.equal(syncWrite.options.exactBytes, true)
  assert.match(syncWrite.options.logText, /<0 rules\/0 mappings>/)
  assert.equal(syncWrite.options.logText.includes(prepared.canonicalJson), false)
})

test('XTQ 状态摘要不匹配不会伪装为内容验证通过', async (t) => {
  const { coordinator, sent, setResponder } = setupXtq(t)
  const prepared = xtqProtocol.buildSyncPayload(
    '{"version":1,"enabled":false,"cache_ttl_seconds":600,"rules":[]}'
  )
  let uploaded = false
  setResponder((text) => {
    if (text === '@STATUS') {
      return `OK ${JSON.stringify(
        xtqStatus({ sequence: uploaded ? 2 : 1, jsonLength: uploaded ? prepared.byteLength + 1 : 0, rules: 0 })
      )}`
    }
    if (text === prepared.payload) {
      uploaded = true
      return 'OK'
    }
    throw new Error(`未期望的 XTQ 命令：${text}`)
  })

  await coordinator.queryStatus()
  const record = await coordinator.uploadSyncConfiguration(prepared.canonicalJson)
  assert.equal(record.status, 'device_error')
  assert.equal(coordinator.lastSyncUpload.summaryMatched, false)
  assert.equal(coordinator.lastSyncUpload.contentVerified, false)
  assert.match(coordinator.lastError, /摘要未匹配/)
  assert.equal(sent.some((item) => item.text === '@SYNC GET'), false)
})

test('XTQ 重启复核遇到任一 owner 失败时保持错误状态，不伪造恢复成功', async (t) => {
  const { coordinator, sent, setResponder } = setupXtq(t)
  const candidate = {
    topology_mode: 0,
    radio1_role: 0,
    radio2_role: 0,
    hello_interval_s: 5,
    neighbor_timeout_s: 15,
    route_cache_ttl_min: 1,
    flags: 0,
    config_sequence: 0
  }
  setResponder((text) => {
    if (text.startsWith('@CFG SET CoordinatorConfig ')) return 'OK_REBOOTING'
    if (text === '@STATUS') return `OK ${JSON.stringify(xtqStatus())}`
    if (text === '@CFG GET Radio2Config') return 'BAD_SCHEMA'
    if (text.startsWith('@CFG GET ')) return 'OK {}'
    throw new Error(`未期望的 XTQ 重启复核命令：${text}`)
  })

  const write = await coordinator.writeOwner('CoordinatorConfig', JSON.stringify(candidate))
  assert.equal(write.response, 'OK_REBOOTING')
  assert.equal(coordinator.state, 'waiting_reboot')
  assert.equal((await coordinator.confirmAfterReboot()).status, 'ok')
  assert.equal(coordinator.state, 'error')
  assert.match(coordinator.lastError, /owner 配置复核未完成/)
  assert.equal(sent.filter((item) => item.text.startsWith('@CFG SET ')).length, 1)
})

test('XTQ 重启恢复只重开本次已知串口，不扫描端口且恢复后复核全部 owner', async (t) => {
  const { coordinator, serial, setResponder } = setupXtq(t)
  const candidate = {
    topology_mode: 0,
    radio1_role: 0,
    radio2_role: 0,
    hello_interval_s: 5,
    neighbor_timeout_s: 15,
    route_cache_ttl_min: 1,
    flags: 0,
    config_sequence: 0
  }
  const reconnectCalls = []
  serial.connect = async (port, options) => {
    reconnectCalls.push({ port, options })
    serial.connectedPort = port
  }
  serial.refreshPorts = async () => {
    throw new Error('重启恢复不得扫描串口')
  }
  setResponder((text) => {
    if (text.startsWith('@CFG SET CoordinatorConfig ')) return 'OK_REBOOTING'
    if (text === '@STATUS') return `OK ${JSON.stringify(xtqStatus())}`
    if (text.startsWith('@CFG GET ')) return 'OK {}'
    throw new Error(`未期望的 XTQ 重启恢复命令：${text}`)
  })

  assert.equal(
    (await coordinator.writeOwner('CoordinatorConfig', JSON.stringify(candidate))).response,
    'OK_REBOOTING'
  )
  serial.connectedPort = null
  await new Promise((resolve) => setTimeout(resolve, 1_700))

  assert.deepEqual(reconnectCalls, [
    { port: 'mock-xtq', options: { preserveSession: true } }
  ])
  assert.equal(coordinator.state, 'connected')
  assert.equal(coordinator.recoveryActive, false)
  assert.equal(
    coordinator.records.filter((record) => record.operation === 'read').length,
    5
  )
})

const cat1Candidate = {
  apn: 'CMNET',
  host: 'broker.example',
  port: '1883',
  username: 'operator',
  password: 'p,a%ss',
  topic: 'factory data',
  keepalive: '60',
  qos: '1'
}

test('Cat.1 INIT 对文本字段做 percent 编码且会话回显不泄露凭证', () => {
  const command = protocol.buildCat1InitCommand(cat1Candidate)
  assert.equal(
    command,
    '@CFG,4G,INIT,CMNET,broker.example,1883,operator,p%2Ca%25ss,factory%20data,60,1'
  )
  const redacted = protocol.redactKz3Command(command)
  assert.equal(redacted.includes('operator'), false)
  assert.equal(redacted.includes('p%2Ca%25ss'), false)
  assert.match(redacted, /@CFG,4G,INIT,CMNET,broker\.example,1883,\*\*\*,\*\*\*,factory%20data,60,1/)
})

test('Cat.1 差异写入保持未输入的凭证，并拒绝未初始化记录', () => {
  assert.throws(
    () => protocol.buildCat1UpdateCommands(cat1Candidate, { VALID: '0' }),
    /首次初始化/
  )
  const updates = protocol.buildCat1UpdateCommands(
    { ...cat1Candidate, username: '', password: '', host: 'mqtt.example' },
    {
      VALID: '1',
      APN: 'CMNET',
      HOST: 'broker.example',
      PORT: '1883',
      TOPIC: 'factory data',
      KEEPALIVE: '60',
      QOS: '1',
      USER: 'SET',
      PASS: 'SET'
    }
  )
  assert.deepEqual(updates, ['@CFG,4G,HOST,mqtt.example'])
  assert.throws(
    () => protocol.buildCat1InitCommand({ ...cat1Candidate, keepalive: '29' }),
    /Keepalive/
  )
})

test('Cat.1 SHOW 多行字段可解码，白名单拒绝任意注入', () => {
  const envelope = protocol.parseKz3ProtocolLine('OK,4G,HOST=broker.example,TOPIC=factory%20data')
  assert.equal(envelope?.fields.HOST, 'broker.example')
  assert.equal(envelope?.fields.TOPIC, 'factory data')
  assert.equal(protocol.validateKz3Command('@CFG,WIRELESS,MODE,CAT1'), '@CFG,WIRELESS,MODE,CAT1')
  assert.throws(() => protocol.validateKz3Command('@CFG,4G,HOST,broker\r\n@RST'), /ASCII|白名单/)
  assert.throws(() => protocol.validateKz3Command('@CFG,WIRELESS,REPORT,256'), /白名单/)
})

test('KZ3 Ethernet 复连只从已校验的单一 SAVED 候选生成 HTTP 地址', () => {
  const candidate = {
    ip: '192.168.30.66',
    mask: '255.255.255.0',
    gateway: '192.168.30.1',
    port: '8080'
  }
  assert.equal(protocol.buildKz3HttpBaseUrl(candidate), 'http://192.168.30.66:8080')
  assert.throws(
    () => protocol.buildKz3HttpBaseUrl({ ...candidate, ip: '192.168.30.66\nother' }),
    /IPv4/
  )
  assert.throws(
    () => protocol.buildKz3HttpBaseUrl({ ...candidate, mask: '255.0.255.0' }),
    /连续掩码/
  )
})
