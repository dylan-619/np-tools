import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import { createPinia, disposePinia, setActivePinia } from 'pinia'

// 复用 Vite 的 TypeScript 加载器；只模拟桌面 IPC，不连接控制器。
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom'
})
after(() => server.close())
const { numericWriteConstraints, pointValuesEqual, pointValueMatchesType, writeValueError } =
  await server.ssrLoadModule('/src/utils/controllerDebugValues.ts')
const { controllerSourceOrder, sortControllerPoints } = await server.ssrLoadModule(
  '/src/utils/controllerPointOrder.ts'
)
const { useControllerStore } = await server.ssrLoadModule('/src/stores/controllerStore.ts')
const { useWorkspaceStore } = await server.ssrLoadModule('/src/stores/workspaceStore.ts')
const { useControllerDebugStore } = await server.ssrLoadModule(
  '/src/stores/controllerDebugStore.ts'
)
const kz3Manifest = await server.ssrLoadModule('/src/utils/kz3ProjectManifest.ts')
const protocol = await server.ssrLoadModule('/src/utils/kz3UartProtocol.ts')
const { useKz3MaintenanceStore } = await server.ssrLoadModule('/src/stores/kz3MaintenanceStore.ts')
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

test('KZ3 点表按物理模块与通道号排序而不是按创建顺序排序', () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const controller = useControllerStore()
  controller.doc.project.devices = [
    {
      id: 'dev-2',
      name: 'dio_second',
      profile: 'sp4055_701',
      port: 'rs485_1',
      slave_address: 2,
      poll_period_ms: 500,
      stale_after_ms: 1500,
      use: { inputs: ['di03', 'di01', 'di02'], outputs: {} }
    }
  ]

  const points = [
    { id: 'p5', name: 'module_di3', source: 'rtu.dio_second.di03', description: '' },
    { id: 'p3', name: 'board_di3', source: 'board.di03', description: '' },
    { id: 'p4', name: 'module_di1', source: 'rtu.dio_second.di01', description: '' },
    { id: 'p2', name: 'board_ai1', source: 'board.ai01', description: '' },
    { id: 'p1', name: 'board_di2', source: 'board.di02', description: '' }
  ]

  const ordered = sortControllerPoints(
    points,
    controllerSourceOrder(controller.doc, 'input')
  )
  assert.deepEqual(
    ordered.map((point) => point.source),
    ['board.di02', 'board.di03', 'board.ai01', 'rtu.dio_second.di01', 'rtu.dio_second.di03']
  )
  assert.deepEqual(
    controller.availableInputSources
      .filter((source) => source.value.startsWith('rtu.dio_second.'))
      .map((source) => source.value),
    ['rtu.dio_second.di01', 'rtu.dio_second.di02', 'rtu.dio_second.di03']
  )

  controller.doc.project.points.inputs = points
  const exportedYaml = controller.getYamlString()
  assert.ok(exportedYaml.indexOf('source: board.di02') < exportedYaml.indexOf('source: board.di03'))
  assert.ok(
    exportedYaml.indexOf('source: rtu.dio_second.di01') <
      exportedYaml.indexOf('source: rtu.dio_second.di03')
  )
  disposePinia(pinia)
})

test('导入 YAML 后自动识别 SN 不覆盖当前配置，只有显式刷新才载入设备存档', async (t) => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const controller = useControllerStore()
  controller.doc.project.id = 'imported-project'
  const importedYaml = controller.getYamlString()
  const workspaceYaml = importedYaml.replace('id: imported-project', 'id: workspace-project')
  const oldWindow = globalThis.window
  globalThis.window = {
    setTimeout,
    clearTimeout,
    __TAURI_INTERNALS__: {
      invoke: async (command) => {
        if (command === 'app_open_file') return ['/tmp/imported-project.yaml', importedYaml]
        if (command === 'workspace_activate_controller') {
          return { serialNumber: 'KZ3-TEST-001', devicePath: '/tmp/np-tools/KZ3-TEST-001' }
        }
        if (command === 'workspace_load_controller_config') {
          return {
            serialNumber: 'KZ3-TEST-001',
            path: '/tmp/np-tools/KZ3-TEST-001/config/project_io.yaml',
            revisionId: 'workspace-revision',
            importedAtMs: 1,
            content: workspaceYaml
          }
        }
        throw new Error(`测试禁止未声明的工作空间调用：${command}`)
      }
    }
  }
  t.after(() => {
    disposePinia(pinia)
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
  })

  await controller.importYamlFile()
  assert.equal(controller.doc.project.id, 'imported-project')
  assert.equal(controller.currentConfigurationSource, 'imported')

  const workspace = useWorkspaceStore()
  workspace.rootPath = '/tmp/np-tools'
  await controller.loadWorkspaceConfigForSerial('KZ3-TEST-001')
  assert.equal(controller.doc.project.id, 'imported-project')
  assert.equal(controller.currentConfigurationSource, 'imported')

  await controller.refreshWorkspaceConfigForSerial('KZ3-TEST-001')
  assert.equal(controller.doc.project.id, 'workspace-project')
  assert.equal(controller.currentConfigurationSource, 'workspace')
})

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
  {
    fields,
    values = {},
    deviceOverrides = {},
    hardwareOverrides = {},
    initialSerialNumber = '',
    otaFlags = 140,
    projectOverrides = {},
    writeStatus = 200,
    pageChunkSize = 100,
    pointsPageStatus = 200
  } = {}
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
        if (command === 'kz3_http_get_ota_state') return ota
        if (command === 'kz3_http_get_diagnostic') {
          const data = diagnostics[args.resource]
          if (data === undefined) throw new Error(`测试未声明诊断资源：${args.resource}`)
          return diagnosticResponse(data)
        }
        if (command === 'kz3_http_get_point') {
          return pointResponse(args.pointName, pointValues[args.pointName])
        }
        if (command === 'kz3_http_get_points_page') {
          if (pointsPageStatus !== 200) {
            return {
              status: pointsPageStatus,
              body: JSON.stringify({ error: { code: 'not_found', message: '端点不存在' } }),
              contentType: 'application/json',
              elapsedMs: 1
            }
          }
          const end = Math.min(
            projectFields.length,
            args.offset + Math.min(args.limit, pageChunkSize)
          )
          const points = Object.fromEntries(
            projectFields
              .slice(args.offset, end)
              .map((item) => [item.name, [pointValues[item.name], 1]])
          )
          return {
            status: 200,
            body: JSON.stringify({
              offset: args.offset,
              limit: args.limit,
              total: projectFields.length,
              points,
              count: end - args.offset,
              next_offset: end < projectFields.length ? end : null
            }),
            contentType: 'application/json',
            elapsedMs: 1
          }
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
      default: item.c_type === 'bool' ? false : 0,
      min: item.min,
      max: item.max,
      persistent: item.persistent
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
  const ota = {
    info: { sn: '020325090117', board_type: 'kz3_f427_standard', ota_protocol: 2, phase: 1, flags: otaFlags },
    status: { phase: 1, state: 0, flags: otaFlags, active: 'a'.repeat(64), candidate: '0'.repeat(64), error: 0 },
    identity: { present: 1, project_id: controller.doc.project.id, project_version: controller.doc.project.version,
      revision: 1, package_id: 'a'.repeat(64) }
  }
  const diagnostics = {
    // 模拟网络 owner 的实际输出，不再只覆盖 HttpApiContext_SetDefaults() 的模板型号。
    device: { device_type: 'KZ3-203', serial_number: '020325090117', ...deviceOverrides },
    hardware: { mcu: 'STM32F427', di_count: 12, do_count: 8, ai_count: 4, ao_count: 2, ...hardwareOverrides },
    project: {
      project_id: controller.doc.project.id,
      project_version: controller.doc.project.version,
      schema_version: 7,
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
  if (initialSerialNumber) useWorkspaceStore().setActiveSerialNumber(initialSerialNumber)
  const debug = useControllerDebugStore()
  debug.operatorName = '自动化测试'
  await debug.connect()
  debug.stopPolling()
  return { controller, debug, calls, diagnostics, manifest, pointValues, ota }
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
    '["kz3-point-manifest/v1",[["command.start","command.start","bool","read_write","00001",1],["parameter.gain","parameter.gain","f32","read_write","40001",2],["state.counter","state.counter","u32","read","30001",2],["state.mode","state.mode","i32","read","30003",2]]]'
  )
  assert.equal(result.hash, '4fd95cbd63421b1b28dc650f40f1b8e6eb162989d9a488c750c24fd93a0ee217')
  await assert.rejects(
    kz3Manifest.buildKz3PointManifest([
      field({ name: 'parameter.legacy_i16', bind: 'parameter.legacy_i16', c_type: 'i16' })
    ]),
    /不支持本地点位类型 i16/
  )
})

test('KZ3 descriptor 开放 BOOL/FLOAT/U32 parameter 并继续拒绝未实现整数 owner', (t) => {
  const { controller, debug } = setup(t)
  controller.doc.project.northbound.fields = [
    field({ name: 'parameter.enabled', bind: 'parameter.enabled', c_type: 'bool', description: '运行使能参数' }),
    field({ name: 'parameter.gain', bind: 'parameter.gain', c_type: 'float' }),
    field({ name: 'parameter.count16', bind: 'parameter.count16', c_type: 'u16' }),
    field({ name: 'parameter.count32', bind: 'parameter.count32', c_type: 'u32' }),
    field({ name: 'parameter.offset16', bind: 'parameter.offset16', c_type: 'i16' }),
    field({ name: 'parameter.offset32', bind: 'parameter.offset32', c_type: 'i32' }),
    field({ name: 'command.start', bind: 'command.start', c_type: 'bool', description: '启动一次控制流程' }),
    field({ bind: 'runtime.grating_01.clear', c_type: 'bool', description: '累计时间清零' }),
    field({ name: 'point.output', bind: 'point.output', c_type: 'bool', description: '过程输出反馈' }),
    field({ name: 'state.running', bind: 'state.running', c_type: 'bool', description: '设备运行状态' }),
    field({ name: 'parameter.read_only', bind: 'parameter.read_only', c_type: 'bool', access: 'read' })
  ]
  assert.deepEqual(debug.pointDescriptors.map((item) => item.writeSupported), [
    true,
    true,
    false,
    true,
    false,
    false,
    true,
    true,
    false,
    false,
    false
  ])
  assert.equal(debug.pointDescriptors[0].description, '运行使能参数')
  assert.equal(debug.pointDescriptors[6].description, '启动一次控制流程')
  assert.match(debug.pointDescriptors[2].writeDisabledReason, /BOOL\/FLOAT\/U32 parameter/)
  assert.equal(debug.pointDescriptors[7].category, 'command')
  assert.equal(debug.pointDescriptors[7].description, '累计时间清零')
  assert.equal(debug.pointDescriptors[8].description, '过程输出反馈')
  assert.equal(debug.pointDescriptors[9].description, '设备运行状态')
  assert.match(debug.pointDescriptors[8].writeDisabledReason, /禁止|仅允许/)
  assert.match(debug.pointDescriptors[10].writeDisabledReason, /只读/)
})

test('KZ3 U32 parameter 通过受控 HTTP 写入并按整数范围读回', async (t) => {
  const target = field({
    name: 'MODE',
    bind: 'parameter.grating_mode',
    c_type: 'u32',
    reference: '40001',
    min: 0,
    max: 2,
    description: '控制模式：0 手动，1 液位差，2 时序'
  })
  const { debug, calls, pointValues } = await setupVerifiedKz3(t, {
    fields: [target],
    values: { MODE: 0 }
  })
  const descriptor = debug.pointDescriptors[0]

  assert.equal(descriptor.writeSupported, true)
  assert.deepEqual(numericWriteConstraints(descriptor), { min: 0, max: 2, step: 1 })
  assert.match(writeValueError(descriptor, 3), /不得大于 2/)

  debug.enableWrites('HOST-KZ3-U32')
  const event = await debug.writePoint('MODE', 2, 'HOST-KZ3-U32')
  const writes = calls.filter((item) => item.command === 'kz3_http_write_point')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].args.value, 2)
  assert.equal(pointValues.MODE, 2)
  assert.equal(event.afterValue, 2)
  assert.equal(event.readbackObserved, 'passed')
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

test('KZ3 周期采样跟随实际 next_offset 分页读取全部北向点位', async (t) => {
  const fields = [
    field({ name: 'state.ready', bind: 'state.ready', c_type: 'bool', access: 'read' }),
    field({ name: 'state.pressure', bind: 'state.pressure', c_type: 'float', access: 'read' }),
    field({ name: 'state.counter', bind: 'state.counter', c_type: 'u32', access: 'read' })
  ]
  const { debug, calls } = await setupVerifiedKz3(t, {
    fields,
    values: { 'state.ready': true, 'state.pressure': 12.5, 'state.counter': 100 },
    pageChunkSize: 2
  })

  await debug.pollOnce()

  const pageReads = calls.filter((item) => item.command === 'kz3_http_get_points_page')
  assert.deepEqual(
    pageReads.map((item) => item.args),
    [
      { baseUrl: debug.baseUrl, offset: 0, limit: 30 },
      { baseUrl: debug.baseUrl, offset: 2, limit: 30 }
    ]
  )
  assert.equal(calls.some((item) => item.command === 'kz3_http_get_point'), false)
  assert.equal(debug.samples['state.ready'].value, true)
  assert.equal(debug.samples['state.pressure'].value, 12.5)
  assert.equal(debug.samples['state.counter'].value, 100)
})

test('旧固件缺少分页端点时不退回高频逐点轮询', async (t) => {
  const fields = [
    field({ name: 'state.ready', bind: 'state.ready', c_type: 'bool', access: 'read' }),
    field({ name: 'state.pressure', bind: 'state.pressure', c_type: 'float', access: 'read' })
  ]
  const { debug, calls } = await setupVerifiedKz3(t, { fields, pointsPageStatus: 404 })

  await debug.pollOnce()
  await debug.pollOnce()

  assert.equal(
    calls.filter((item) => item.command === 'kz3_http_get_points_page').length,
    1
  )
  assert.equal(calls.some((item) => item.command === 'kz3_http_get_point'), false)
  assert.deepEqual(debug.samples, {})
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

test('KZ3 Edge TCP 命令与当前 UART1 SET/SHOW 契约一致', () => {
  const command = protocol.buildEdgeTcpCommand({
    serverIp: '192.168.30.100',
    port: '9000',
    enabled: true,
  })
  assert.equal(command, '@CFG,EDGE,SET,192.168.30.100,9000,1')
  assert.equal(protocol.KZ3_QUERY_COMMANDS.edge, '@CFG,EDGE,SHOW')
  assert.equal(protocol.getCommandGroup(command), 'edge')
  assert.equal(protocol.getFollowUpQuery(command), '@CFG,EDGE,SHOW')
  assert.equal(
    protocol.parseKz3ProtocolLine('OK,EDGE,RUN_ENABLE=1,SAVED_ENABLE=1,ONLINE=1,STATE=ONLINE')?.fields.ONLINE,
    '1'
  )
  assert.throws(
    () => protocol.buildEdgeTcpCommand({ serverIp: '127.0.0.1', port: '9000', enabled: false }),
    /单播地址/
  )
  assert.throws(
    () => protocol.buildEdgeTcpCommand({ serverIp: '192.168.30.100', port: '0', enabled: false }),
    /1~65535/
  )
  assert.throws(() => protocol.validateKz3Command('@CFG,IO,SHOW'), /白名单/)
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

test('KZ3 Ethernet INIT 原子提交预先拒绝固件会拒绝的候选网络', () => {
  const candidate = {
    ip: '192.168.30.66',
    mask: '255.255.255.0',
    gateway: '192.168.30.1',
    port: '8080'
  }
  assert.equal(
    protocol.buildEthernetInitCommand(candidate),
    '@CFG,ETH,INIT,192.168.30.66,255.255.255.0,192.168.30.1,8080'
  )
  assert.throws(
    () => protocol.buildEthernetInitCommand({ ...candidate, gateway: '192.168.1.1' }),
    /同一子网/
  )
  assert.throws(
    () => protocol.buildEthernetInitCommand({ ...candidate, ip: '192.168.30.0' }),
    /网络地址/
  )
  assert.throws(
    () => protocol.buildEthernetInitCommand({ ...candidate, port: '502' }),
    /Modbus TCP/
  )
})

test('KZ3 身份查询兼容可选的逻辑代码块版本字段', () => {
  const legacy = protocol.parseKz3ProtocolLine(
    'OK,SYS,SN=020325090118,TYPE=203,ADDR=1,VALID=1'
  )
  const current = protocol.parseKz3ProtocolLine(
    'OK,SYS,SN=020325090118,TYPE=203,ADDR=1,VALID=1,LOGIC_VER=1.2.3'
  )

  assert.equal(legacy?.fields.SN, '020325090118')
  assert.equal(legacy?.fields.LOGIC_VER, undefined)
  assert.equal(current?.fields.LOGIC_VER, '1.2.3')
})


test('KZ3 真实 KZ3-203 型号通过身份预检且不自动解锁', async (t) => {
  const { debug, calls } = await setupVerifiedKz3(t, {
    deviceOverrides: { device_type: 'KZ3-203' }, hardwareOverrides: { mcu: 'STM32F427' }, otaFlags: 142
  })
  assert.equal(debug.canEnableWrites, true)
  assert.equal(debug.writesEnabled, false)
  assert.equal(calls.filter(c => c.command === 'kz3_http_write_point').length, 0)
})

test('KZ3 HTTP 直连按真实 SN 进入同一工作空间，不依赖先连串口或沿用上一台 SN', async (t) => {
  const { debug, calls } = await setupVerifiedKz3(t, { initialSerialNumber: '020325090118' })
  assert.equal(useWorkspaceStore().activeSerialNumber, '020325090117')
  assert.equal(debug.canEnableWrites, true)
  assert.equal(debug.writesEnabled, false)
  assert.ok(calls.every(call => call.command.startsWith('kz3_http_')))
})

test('KZ3 旧 KZ3-F427 标识仍通过相同硬件与 OTA 门禁', async (t) => {
  const { debug, calls } = await setupVerifiedKz3(t, {
    deviceOverrides: { device_type: 'KZ3-F427' }, hardwareOverrides: { mcu: 'STM32F427VG' }
  })
  assert.equal(debug.canEnableWrites, true)
  assert.equal(debug.writesEnabled, false)
  assert.equal(calls.filter(c => c.command === 'kz3_http_write_point').length, 0)
})

test('KZ3 后台身份查询等待期间提交资格保持稳定，各类写入等待轮询后只发送一次', async (t) => {
  for (const item of [
    { label: '单次命令', name: 'P1_STA', bind: 'command.p1_sta', c_type: 'bool', reference: '00002', value: true },
    { label: 'BOOL参数', name: 'P1_AUTO', bind: 'parameter.p1_auto', c_type: 'bool', reference: '00001', value: true },
    { label: 'U32参数', name: 'P1_RUN_M', bind: 'parameter.p1_run_m', c_type: 'u32', reference: '40001', value: 3 },
    { label: 'FLOAT参数', name: 'GAIN', bind: 'parameter.gain', c_type: 'float', reference: '40003', value: 1.5 },
    { label: '掉电保持参数', name: 'RETAINED', bind: 'parameter.retained', c_type: 'u32', reference: '40005', persistent: true, value: 0 }
  ]) {
    await t.test(item.label, async (st) => {
      const { debug, calls } = await setupVerifiedKz3(st, { fields: [field(item)] })
      debug.enableWrites('模拟轮询交互回归')
      const invoke = window.__TAURI_INTERNALS__.invoke
      let started, release
      const queryStarted = new Promise(resolve => { started = resolve })
      const queryPending = new Promise(resolve => { release = resolve })
      let held = false
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'kz3_http_get_ota_state' && !held) {
          held = true
          started()
          await queryPending
        }
        return invoke(command, args)
      }
      const poll = debug.pollOnce()
      await queryStarted
      try {
        assert.equal(debug.pollInFlight, true)
        assert.equal(debug.canEnableWrites, true)
        assert.equal(debug.writesEnabled, true)
        const before = item.c_type === 'bool' ? false : 0
        const write = debug.writePoint(item.name, item.value, '模拟轮询交互回归', before)
        assert.equal(debug.writeInFlight, true)
        assert.equal(calls.filter(call => call.command === 'kz3_http_write_point').length, 0)
        release()
        await poll
        const event = await write
        assert.equal(event.acceptedByOwner, true)
        const posts = calls.filter(call => call.command === 'kz3_http_write_point')
        assert.equal(posts.length, 1)
        assert.equal(posts[0].args.value, item.value)
      } finally {
        release()
        await poll
      }
    })
  }
})

test('KZ3 后台查询发现 HOLD 时取消等待中的命令并解除许可，不发送 POST', async (t) => {
  const { debug, calls, ota } = await setupVerifiedKz3(t, {
    fields: [field({ name: 'P1_STA', bind: 'command.p1_sta', c_type: 'bool', reference: '00002' })]
  })
  debug.enableWrites('模拟刷新发现故障')
  const invoke = window.__TAURI_INTERNALS__.invoke
  let started, release
  const queryStarted = new Promise(resolve => { started = resolve })
  const queryPending = new Promise(resolve => { release = resolve })
  let held = false
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command === 'kz3_http_get_ota_state' && !held) {
      held = true
      started()
      await queryPending
    }
    return invoke(command, args)
  }
  const poll = debug.pollOnce()
  await queryStarted
  try {
    const rejected = assert.rejects(debug.writePoint('P1_STA', true, '模拟刷新发现故障', false))
    assert.equal(debug.writeInFlight, true)
    ota.info.flags |= 1
    ota.status.flags |= 1
    release()
    await poll
    await rejected
    assert.equal(debug.identityVerified, false)
    assert.equal(debug.writesEnabled, false)
    assert.equal(debug.canEnableWrites, false)
    assert.equal(calls.filter(call => call.command === 'kz3_http_write_point').length, 0)
  } finally {
    release()
    await poll
  }
})

test('KZ3 身份不匹配指出具体字段并阻断写入，不按相似型号或隐式类型放行', async (t) => {
  for (const item of [
    { name: '相似型号', deviceOverrides: { device_type: 'KZ3-2030' }, detail: 'device_type="KZ3-2030"' },
    { name: '空SN', deviceOverrides: { serial_number: '' }, detail: 'serial_number=""' },
    { name: '数字SN', deviceOverrides: { serial_number: 20325090117 }, detail: 'serial_number=20325090117' },
    { name: '错误MCU', hardwareOverrides: { mcu: 'STM32F407' }, detail: 'hardware.mcu="STM32F407"' },
    { name: '缺失MCU', hardwareOverrides: { mcu: undefined }, detail: 'hardware.mcu=undefined' },
    { name: 'DI数量字符串', hardwareOverrides: { di_count: '12' }, detail: 'hardware.di_count="12"' },
    { name: 'DO数量错误', hardwareOverrides: { do_count: 7 }, detail: 'hardware.do_count=7' },
    { name: 'AI数量错误', hardwareOverrides: { ai_count: 0 }, detail: 'hardware.ai_count=0' },
    { name: 'AO数量错误', hardwareOverrides: { ao_count: 4 }, detail: 'hardware.ao_count=4' }
  ]) {
    await t.test(item.name, async (st) => {
      const { debug, calls } = await setupVerifiedKz3(st, item)
      assert.equal(debug.canEnableWrites, false)
      assert.equal(debug.writesEnabled, false)
      assert.ok(debug.logs.some(entry => entry.detail?.includes(item.detail)))
      assert.equal(calls.filter(c => c.command === 'kz3_http_write_point').length, 0)
    })
  }
})

test('KZ3 型号、SN、schema和OTA状态变更均阻断实际写请求', async (t) => {
  for (const kind of ['model', 'sn', 'schema', 'hold', 'data', 'phase', 'package']) {
    await t.test(kind, async (st) => {
      const { debug, diagnostics, ota, calls } = await setupVerifiedKz3(st)
      assert.equal(debug.canEnableWrites, true)
      debug.enableWrites('测试依据')
      if (kind === 'model') diagnostics.device.device_type = 'SJZDV3'
      if (kind === 'sn') diagnostics.device.serial_number = '020325090118'
      if (kind === 'schema') diagnostics.project.schema_version = 8
      if (kind === 'hold') { ota.status.flags |= 1; ota.info.flags |= 1 }
      if (kind === 'data') { ota.status.flags = 128; ota.info.flags = 128 }
      if (kind === 'phase') { ota.status.phase = 5; ota.info.phase = 5 }
      if (kind === 'package') { ota.status.active = 'b'.repeat(64); ota.identity.package_id = 'b'.repeat(64) }
      await assert.rejects(debug.writePoint('parameter.gain', 1, '测试'))
      assert.equal(debug.writesEnabled, false)
      assert.equal(calls.filter(c => c.command === 'kz3_http_write_point').length, 0)
    })
  }
})

test('KZ3 预读期间撤销许可后不得发送POST', async (t) => {
  const { debug, calls } = await setupVerifiedKz3(t)
  debug.enableWrites('测试')
  const invoke = window.__TAURI_INTERNALS__.invoke
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    const response = await invoke(command, args)
    if (command === 'kz3_http_get_point') debug.disableWrites('等待期间撤销')
    return response
  }
  await assert.rejects(debug.writePoint('parameter.gain', 1, '测试'))
  assert.equal(calls.filter(c => c.command === 'kz3_http_write_point').length, 0)
})

test('KZ3 command已接受但读回断线时解除许可且不重试', async (t) => {
  const { debug, calls } = await setupVerifiedKz3(t, {
    fields: [field({ name: 'command.start', bind: 'command.start', c_type: 'bool', reference: '00001' })]
  })
  debug.enableWrites('测试')
  const invoke = window.__TAURI_INTERNALS__.invoke
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command === 'kz3_http_get_point' && calls.some(c => c.command === 'kz3_http_write_point'))
      throw new Error('读回断线')
    return invoke(command, args)
  }
  await assert.rejects(debug.writePoint('command.start', true, '测试'))
  assert.equal(debug.writesEnabled, false)
  assert.equal(calls.filter(c => c.command === 'kz3_http_write_point').length, 1)
})

test('KZ3 YAML往返保留未知字段、启动门禁、外部输入、PID零值和Runtime条件', async (t) => {
  const pinia = createPinia()
  setActivePinia(pinia)
  t.after(() => disposePinia(pinia))
  const { deserializeProjectIoYaml, serializeProjectIoYaml } = await server.ssrLoadModule('/src/utils/yamlHelper.ts')
  const { load } = await import('js-yaml')
  const controller = useControllerStore()
  const raw = load(controller.getYamlString())
  raw.future = { enabled: false }
  raw.project.contract = { identity: 'future' }
  raw.project.startup = { parameter_restore: 'require_valid', future: 0 }
  raw.project.input_quality = { board_ai_stale_after_ms: 500 }
  raw.project.application_variables.external_inputs = [{ name: 'level', c_type: 'float', stale_after_ms: 1000 }]
  raw.project.pids = [{ name: 'pid', kp: 0, ki: 0, kd: 0, derivative_filter_ms: 0, future: false }]
  raw.project.runtime_counters = [{ name: 'run', trigger: { bind: 'state.running', active_value: true } }]
  const { dump } = await import('js-yaml')
  const exported = load(serializeProjectIoYaml(deserializeProjectIoYaml(dump(raw))))
  assert.deepEqual(exported.future, raw.future)
  assert.deepEqual(exported.project.contract, raw.project.contract)
  assert.deepEqual(exported.project.startup, { ...raw.project.startup, ao_deferred_activation: false })
  assert.deepEqual(exported.project.application_variables.external_inputs, raw.project.application_variables.external_inputs)
  assert.equal(exported.project.pids[0].kp, 0)
  assert.equal(exported.project.pids[0].ki, 0)
  assert.equal(exported.project.pids[0].derivative_filter_ms, 0)
  assert.deepEqual(exported.project.runtime_counters[0].trigger, raw.project.runtime_counters[0].trigger)
})


test('KZ3 OTA查询不可用时保持只读且不发送业务POST', async (t) => {
  const { debug, calls } = await setupVerifiedKz3(t)
  debug.enableWrites('测试')
  const invoke = window.__TAURI_INTERNALS__.invoke
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command === 'kz3_http_get_ota_state') throw new Error('HTTP 503')
    return invoke(command, args)
  }
  await assert.rejects(debug.writePoint('parameter.gain', 1, '测试'))
  assert.equal(debug.writesEnabled, false)
  assert.equal(debug.canEnableWrites, false)
  assert.equal(calls.filter(c => c.command === 'kz3_http_write_point').length, 0)
})


test('KZ3 manifest严格镜像SDK的s32原名与f32别名', async () => {
  const signed = await kz3Manifest.buildKz3PointManifest([field({ c_type: 's32' })])
  assert.ok(signed.canonicalJson.includes('"s32","read_write","40011",2'))
  const float = await kz3Manifest.buildKz3PointManifest([field({ c_type: 'f32' })])
  assert.ok(float.canonicalJson.includes('"f32","read_write","40011",2'))
})


test('KZ3 预读跨越许可截止时间后不得发送POST', async (t) => {
  const { debug, calls } = await setupVerifiedKz3(t)
  const realNow = Date.now
  t.after(() => { Date.now = realNow })
  debug.enableWrites('过期测试')
  const invoke = window.__TAURI_INTERNALS__.invoke
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    const response = await invoke(command, args)
    if (command === 'kz3_http_get_point') Date.now = () => realNow() + 11 * 60 * 1000
    return response
  }
  await assert.rejects(debug.writePoint('parameter.gain', 1, '测试'))
  assert.equal(calls.filter(c => c.command === 'kz3_http_write_point').length, 0)
})


test('KZ3 写前预读后修改URL不能把POST发到新设备', async (t) => {
  const { debug, calls } = await setupVerifiedKz3(t)
  debug.enableWrites('目标切换测试')
  const invoke = window.__TAURI_INTERNALS__.invoke
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    const response = await invoke(command, args)
    if (command === 'kz3_http_get_point') debug.baseUrl = 'http://192.168.11.60:8080'
    return response
  }
  await assert.rejects(debug.writePoint('parameter.gain', 1, '测试'))
  assert.equal(debug.writesEnabled, false)
  assert.equal(calls.filter(c => c.command === 'kz3_http_write_point').length, 0)
})

test('KZ3 类型别名在descriptor、地址分配与值校验中一致', async (t) => {
  const { debug, controller } = await setupVerifiedKz3(t, { fields: [
    field({ id:'a', name:'parameter.gain', bind:'parameter.gain', c_type:'f32' }),
    field({ id:'b', name:'parameter.count', bind:'parameter.count', c_type:'uint32_t' })
  ] })
  assert.equal(debug.pointDescriptors[0].c_type, 'float')
  assert.equal(debug.pointDescriptors[0].writeSupported, true)
  assert.equal(debug.pointDescriptors[1].c_type, 'u32')
  assert.equal(pointValueMatchesType('s32', 1.5), false)
  assert.equal(pointValueMatchesType('s32', -2147483649), false)
  assert.equal(pointValueMatchesType('s32', -2147483648), true)
  assert.equal(pointValueMatchesType('unexpected', 1), false)
  controller.autoAssignNorthboundAddresses()
  assert.deepEqual(controller.doc.project.northbound.fields.map(f => f.reference), ['40001','40003'])
  assert.deepEqual(controller.doc.project.northbound.fields.map(f => f.c_type), ['f32','uint32_t'])
})

test('KZ3 HTTP读回失败保留owner已经接受的证据', async (t) => {
  const { debug, calls } = await setupVerifiedKz3(t)
  debug.enableWrites('读回错误测试')
  const invoke = window.__TAURI_INTERNALS__.invoke
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command === 'kz3_http_get_point' && calls.some(c => c.command === 'kz3_http_write_point'))
      return {status:503,body:JSON.stringify({error:{code:'busy'}}),elapsedMs:1}
    return invoke(command,args)
  }
  await assert.rejects(debug.writePoint('parameter.gain', 1, '测试'))
  const event = debug.writeEvents[0]
  assert.equal(event.acceptedByOwner, true)
  assert.equal(event.readbackObserved, 'unknown')
  assert.equal(debug.writesEnabled, false)
})

test('KZ3 未知故障状态或非布尔健康字段禁止业务写入', async (t) => {
  for (const kind of ['fault','health']) await t.test(kind, async (st) => {
    const { debug, diagnostics, calls } = await setupVerifiedKz3(st)
    debug.enableWrites('诊断格式测试')
    if (kind === 'fault') diagnostics.io.controller_fault = {}
    else diagnostics.health.storage_healthy = 'true'
    await assert.rejects(debug.writePoint('parameter.gain',1,'测试'))
    assert.equal(calls.filter(c => c.command === 'kz3_http_write_point').length,0)
  })
})

test('KZ3 YAML保持显式normal命令策略与未识别枚举供权威校验', async (t) => {
  const pinia = createPinia(); setActivePinia(pinia); t.after(() => disposePinia(pinia))
  const { deserializeProjectIoYaml, serializeProjectIoYaml } = await server.ssrLoadModule('/src/utils/yamlHelper.ts')
  const { load, dump } = await import('js-yaml')
  const raw = load(useControllerStore().getYamlString())
  raw.project.application_variables.commands = [{name:'start',c_type:'bool',effect:'normal'}]
  raw.project.pids = [{name:'pid',direction:'future_direction'}]
  raw.project.northbound.fields[0].access = 'future_access'
  const exported = load(serializeProjectIoYaml(deserializeProjectIoYaml(dump(raw))))
  assert.equal(exported.project.application_variables.commands[0].effect,'normal')
  assert.equal(exported.project.pids[0].direction,'future_direction')
  assert.equal(exported.project.northbound.fields[0].access,'future_access')
})


test('KZ3 YAML不把字符串布尔值、非有限数或循环引用静默改成发布配置', async (t) => {
  const pinia = createPinia(); setActivePinia(pinia); t.after(() => disposePinia(pinia))
  const { deserializeProjectIoYaml } = await server.ssrLoadModule('/src/utils/yamlHelper.ts')
  const { load, dump } = await import('js-yaml')
  const raw = load(useControllerStore().getYamlString())
  raw.project.application_variables.parameters = [{name:'mode',c_type:'bool',default:false,persistent:'false'}]
  assert.throws(() => deserializeProjectIoYaml(dump(raw)), /persistent.*boolean/)
  raw.project.application_variables.parameters = []
  raw.project.pids = [{name:'pid',kp:NaN}]
  assert.throws(() => deserializeProjectIoYaml(dump(raw)), /有限数值/)
  assert.throws(() => deserializeProjectIoYaml('schema: kz3-project-io/v3\nproject: &p {future: *p}'), /循环/)
})

test('KZ3 三种通信模式按 TCP 开关单选，保留无线记录不等于无线正在运行', () => {
  assert.equal(protocol.getCommunicationMode({ RUN: 'DISABLED', SAVED: 'SLE', PORT: '0' },
    { VALID: '1', RUN_ENABLE: '1', SAVED_ENABLE: '1', ONLINE: '0' }, 'run'), 'TCP')
  assert.equal(protocol.getCommunicationMode({ SAVED: 'SLE' },
    { VALID: '1', SAVED_ENABLE: '1' }, 'saved'), 'TCP')
  for (const mode of ['SLE', 'CAT1']) {
    assert.equal(protocol.getCommunicationMode({ RUN: mode, SAVED: mode, PORT: '1' },
      { VALID: '1', RUN_ENABLE: '0', SAVED_ENABLE: '0' }, 'run'), mode)
    assert.equal(protocol.getCommunicationMode({ SAVED: mode },
      { VALID: '0', SAVED_ENABLE: '0' }, 'saved'), mode)
  }
  assert.equal(protocol.getCommunicationMode({ RUN: 'SLE', PORT: '1' },
    { RUN_ENABLE: '1' }, 'run'), 'CONFLICT')
  assert.equal(protocol.getCommunicationMode({}, { RUN_ENABLE: '1' }, 'run'), 'UNKNOWN')
  assert.equal(protocol.getCommunicationMode({ RUN: 'SLE' }, {}, 'run'), 'UNKNOWN')
})

test('KZ3 只有模式选择要求双组回读，参数写入不会发送切换命令', () => {
  assert.deepEqual(protocol.getFollowUpGroups('@CFG,WIRELESS,MODE,SLE'), ['wireless', 'edge'])
  assert.deepEqual(protocol.getFollowUpGroups('@CFG,WIRELESS,MODE,CAT1'), ['wireless', 'edge'])
  assert.deepEqual(protocol.getFollowUpGroups('@CFG,EDGE,SET,192.168.1.10,9000,1'), ['wireless', 'edge'])
  assert.deepEqual(protocol.getFollowUpGroups('@CFG,WIRELESS,REPORT,15'), ['wireless'])
  assert.deepEqual(protocol.getFollowUpGroups('@CFG,4G,HOST,broker'), ['cat1'])
  assert.deepEqual(protocol.getFollowUpGroups('@CFG,SLE,PWR,5'), ['sle'])
  assert.deepEqual(protocol.getFollowUpGroups('@RST'), [])
})

async function setupMaintenance(t, replies) {
  const previousWindow = globalThis.window
  globalThis.window = {
    setTimeout: (callback, delay = 0) => setTimeout(callback, delay >= 2000 ? 200 : 0),
    clearTimeout,
  }
  const pinia = createPinia()
  setActivePinia(pinia)
  const serial = useSerialStore()
  serial.config = { path: 'mock-kz3', ...protocol.KZ3_UART_CONFIG }
  serial.connectedPort = 'mock-kz3'
  let receive = () => {}
  const calls = []
  t.mock.method(serial, 'registerLineListener', (_id, listener) => { receive = listener })
  t.mock.method(serial, 'sendRaw', async (command) => {
    calls.push(command)
    const response = typeof replies === 'function' ? replies(command) : replies[command]
    assert.ok(response, `未声明维护回包：${command}`)
    for (const line of Array.isArray(response) ? response : [response]) receive(line)
  })
  const maintenance = useKz3MaintenanceStore()
  t.after(() => {
    disposePinia(pinia)
    globalThis.window = previousWindow
  })
  return { maintenance, calls }
}

test('KZ3 切回无线回读两组保存值，运行模式直到重启后查询才变化', async (t) => {
  let rebooted = false
  const { maintenance, calls } = await setupMaintenance(t, (command) => {
    if (command === '@CFG,WIRELESS,MODE,SLE') return 'OK,MODE_SAVED,POWER_CYCLE_REQUIRED'
    if (command === '@CFG,WIRELESS,SHOW') return rebooted
      ? 'OK,WIRELESS,RUN=SLE,SAVED=SLE,VALID=1,PORT=1,REBOOT_REQUIRED=0'
      : 'OK,WIRELESS,RUN=DISABLED,SAVED=SLE,VALID=1,PORT=0,REBOOT_REQUIRED=1'
    if (command === '@CFG,EDGE,SHOW') return rebooted
      ? 'OK,EDGE,VALID=1,RUN_ENABLE=0,SAVED_ENABLE=0,REBOOT_REQUIRED=0'
      : 'OK,EDGE,VALID=1,RUN_ENABLE=1,SAVED_ENABLE=0,REBOOT_REQUIRED=1'
  })
  assert.equal((await maintenance.runWrite('@CFG,WIRELESS,MODE,SLE')).status, 'ok')
  assert.deepEqual(calls, ['@CFG,WIRELESS,MODE,SLE', '@CFG,WIRELESS,SHOW', '@CFG,EDGE,SHOW'])
  assert.deepEqual(maintenance.communicationMode, { run: 'TCP', saved: 'SLE' })
  assert.equal(maintenance.status, 'waiting_reboot')
  rebooted = true
  await maintenance.runQuery('wireless')
  await maintenance.runQuery('edge')
  assert.deepEqual(maintenance.communicationMode, { run: 'SLE', saved: 'SLE' })
  assert.equal(maintenance.status, 'connected')
})

test('KZ3 启用 TCP 后只确认下次选择，当前星闪保持运行', async (t) => {
  const command = '@CFG,EDGE,SET,192.168.1.10,9000,1'
  const { maintenance, calls } = await setupMaintenance(t, {
    [command]: 'OK,EDGE_SAVED,POWER_CYCLE_REQUIRED',
    '@CFG,WIRELESS,SHOW': 'OK,WIRELESS,RUN=SLE,SAVED=SLE,VALID=1,PORT=1,REBOOT_REQUIRED=1',
    '@CFG,EDGE,SHOW': 'OK,EDGE,VALID=1,RUN_ENABLE=0,SAVED_ENABLE=1,SAVED_IP=192.168.1.10,SAVED_PORT=9000,REBOOT_REQUIRED=1',
  })
  assert.equal((await maintenance.runWrite(command)).status, 'ok')
  assert.deepEqual(maintenance.communicationMode, { run: 'SLE', saved: 'TCP' })
  assert.equal(maintenance.status, 'waiting_reboot')
  assert.equal(calls.filter((item) => !item.endsWith(',SHOW')).length, 1)
})

test('KZ3 旧固件 ACK 未关闭 TCP 时工具拒绝宣称互斥保存成功', async (t) => {
  const { maintenance, calls } = await setupMaintenance(t, {
    '@CFG,WIRELESS,MODE,CAT1': 'OK,MODE_SAVED,POWER_CYCLE_REQUIRED',
    '@CFG,WIRELESS,SHOW': 'OK,WIRELESS,RUN=SLE,SAVED=CAT1,VALID=1,PORT=1,REBOOT_REQUIRED=1',
    '@CFG,EDGE,SHOW': 'OK,EDGE,VALID=1,RUN_ENABLE=1,SAVED_ENABLE=1,REBOOT_REQUIRED=0',
  })
  const result = await maintenance.runWrite('@CFG,WIRELESS,MODE,CAT1')
  assert.equal(result.status, 'verification_error')
  assert.match(result.error, /TCP 未确认关闭/)
  assert.equal(maintenance.records.find((record) => record.operation === 'write').status, 'verification_error')
  assert.equal(maintenance.status, 'error')
  assert.equal(maintenance.communicationMode.run, 'CONFLICT')
  assert.equal(calls.length, 3)
})

test('KZ3 无线已保存而 TCP 关闭失败时回读两组，保留 ERR 且不重发', async (t) => {
  const { maintenance, calls } = await setupMaintenance(t, {
    '@CFG,WIRELESS,MODE,SLE': 'ERR,EDGE_SAVE',
    '@CFG,WIRELESS,SHOW': 'OK,WIRELESS,RUN=DISABLED,SAVED=SLE,VALID=1,PORT=0,REBOOT_REQUIRED=0',
    '@CFG,EDGE,SHOW': 'OK,EDGE,VALID=1,RUN_ENABLE=1,SAVED_ENABLE=1,REBOOT_REQUIRED=0',
  })
  assert.equal((await maintenance.runWrite('@CFG,WIRELESS,MODE,SLE')).status, 'device_error')
  assert.equal(maintenance.snapshots.wireless.fields.SAVED, 'SLE')
  assert.equal(maintenance.lastError, 'ERR,EDGE_SAVE')
  assert.equal(maintenance.status, 'error')
  assert.equal(calls.length, 3)
})

test('KZ3 保存后查询失败不得沿用旧快照或返回保存复核成功', async (t) => {
  const { maintenance } = await setupMaintenance(t, {
    '@CFG,WIRELESS,MODE,SLE': 'OK,MODE_SAVED,POWER_CYCLE_REQUIRED',
    '@CFG,WIRELESS,SHOW': 'OK,WIRELESS,RUN=DISABLED,SAVED=SLE,VALID=1,PORT=0,REBOOT_REQUIRED=1',
    '@CFG,EDGE,SHOW': 'ERR,EDGE_READ',
  })
  maintenance.snapshots.edge = { group: 'edge', fields: { VALID: '1', SAVED_ENABLE: '0' }, port: 'mock-kz3' }
  assert.equal((await maintenance.runWrite('@CFG,WIRELESS,MODE,SLE')).status, 'verification_error')
  assert.equal(maintenance.snapshots.edge, undefined)
  assert.equal(maintenance.status, 'error')
})

test('KZ3 无线周期更新只发送原参数命令和无线查询', async (t) => {
  const { maintenance, calls } = await setupMaintenance(t, {
    '@CFG,WIRELESS,REPORT,12': 'OK,WIRELESS_UPDATED',
    '@CFG,WIRELESS,SHOW': 'OK,WIRELESS,RUN=DISABLED,SAVED=SLE,VALID=1,PORT=0,REPORT_RAW=12,REBOOT_REQUIRED=0',
  })
  assert.equal((await maintenance.runWrite('@CFG,WIRELESS,REPORT,12')).status, 'ok')
  assert.deepEqual(calls, ['@CFG,WIRELESS,REPORT,12', '@CFG,WIRELESS,SHOW'])
})
