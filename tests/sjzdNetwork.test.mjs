import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { createRenderer, createSSRApp, nextTick, ssrContextKey } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory, createRouter } from 'vue-router'
import vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'

const server = await createServer({ configFile: false, plugins: [vue()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
after(() => server.close())
const protocol = await server.ssrLoadModule('/src/utils/sjzdConsoleProtocol.ts')
const network = await server.ssrLoadModule('/src/utils/sjzdNetwork.ts')
const defaults = { ...network.SJZD_NETWORK_DEFAULTS }

function configLines(saved = defaults, running = defaults, options = {}) {
  const id = options.id || 8
  const record = (source, config, valid = true) => `NET_CONFIG:ITEM,id=${id},source=${source},valid=${valid ? 1 : 0},code=${valid ? 'OK' : 'EMPTY'},version=${valid ? 1 : 0},flags=${config.flags},ip=${config.ip},mask=${config.mask},gateway=${config.gateway},netty_ip=${config.nettyIp},netty_port=${config.nettyPort},ai_unit=${config.aiUnit},modbus_port=${config.modbusPort}`
  const validSaved = options.savedValid ?? true, validRunning = options.runningValid ?? true
  const differs = !network.sameSjzdNetworkConfig(saved, running) || validSaved !== validRunning
  const payload = [record('SAVED', saved, validSaved), record('RUNNING', running, validRunning), `NET_CONFIG:STATE,id=${id},pending_restart=${options.pending || (differs ? 'YES' : 'NO')}`]
  const crc = protocol.formatSjzdCrc32(protocol.crc32IsoHdlc(payload.join('')))
  return [`NET_CONFIG:BEGIN,id=${id},version=1,revision=${options.revision || 100}`, ...payload, `NET_CONFIG:END,id=${id},count=3,crc32=${options.badCrc ? '00000000' : crc},status=OK`]
}

function collect(lines) {
  const collector = new protocol.SjzdConfigSnapshotCollector('NET')
  let snapshot
  for (const line of lines) {
    const fed = collector.feed(line)
    if (fed.error) throw new Error(fed.error)
    if (fed.snapshot) snapshot = fed.snapshot
  }
  return snapshot
}

const statusLines = (config = defaults, mode = 'SLE') => [
  `NET:STATUS,ip=${config.ip === '0.0.0.0' ? defaults.ip : config.ip},driver=READY,error=OK,link=UP,report_transport=${config.flags & 1 ? 'NETTY' : mode},free_heap=24744,rx_errors=0,tx_errors=0,spi_errors=0`,
  `NET:NETTY,enabled=${config.flags & 1 ? 1 : 0},state=${config.flags & 1 ? 'ONLINE' : 'WAIT_LINK'},last_error=NONE,errors=0`,
  `NET:MODBUS,enabled=${config.flags & 2 ? 1 : 0},listening=${config.flags & 2 ? 1 : 0},clients=0,requests=0,error=NONE`,
  'NET:CACHE,ai_valid=1,ai_age_ms=12,valid_points=0',
  'NET:RESOURCES,lwip_heap_used=0,netconn_used=1,netbuf_errors=0',
]

test('NET defaults, four flag combinations and exact full-record command', () => {
  assert.equal(network.buildSjzdNetworkCommand(defaults), 'NET:SET,192.168.30.55,255.255.255.0,0.0.0.0,0.0.0.0,0,2,247,502')
  for (const flags of [0, 1, 2, 3]) {
    const config = { ...defaults, flags, nettyIp: '192.168.30.254', nettyPort: 8888 }
    assert.deepEqual(network.validateSjzdNetworkConfig(config), {})
  }
  assert.deepEqual(network.validateSjzdNetworkConfig({ ...defaults, ip: '0.0.0.0', mask: '0.0.0.0', flags: 0 }), {})
  assert.equal(network.normalizeSjzdNetworkConfig({ ...defaults, ip: '192.168.030.055' }).ip, defaults.ip)
})

test('NET field validation rejects IP/mask/target/port and injection boundaries', () => {
  for (const change of [
    { ip: '192.168.30.255' }, { ip: '127.0.0.1' }, { ip: '224.0.0.1' }, { ip: '192.168.30.256' },
    { ip: '192.168.30.55\r\n@RST' }, { mask: '255.0.255.0' }, { mask: '255.255.255.254' },
    { gateway: defaults.ip }, { gateway: '192.168.31.1' }, { flags: 4 }, { aiUnit: 0 }, { aiUnit: 248 },
    { modbusPort: 0 }, { modbusPort: 65536 }, { nettyPort: -1 }, { flags: 1 },
    { flags: 3, nettyIp: '10.0.0.20', nettyPort: 8888 }, { nettyIp: '192.168.30.255', nettyPort: 8888 },
    { nettyIp: '192.168.30.254', nettyPort: 0 }, { nettyPort: 8888 },
  ]) assert.throws(() => network.buildSjzdNetworkCommand({ ...defaults, ...change }), JSON.stringify(change))
  assert.doesNotThrow(() => network.buildSjzdNetworkCommand({ ...defaults, flags: 3, nettyIp: '10.0.0.20', nettyPort: 8888, gateway: '192.168.30.1' }))
})

test('NET complete CRC snapshot preserves saved and running values, fallback is not disabled', () => {
  const result = network.parseSjzdNetworkSnapshot(collect(configLines({ ...defaults, modbusPort: 1502 })))
  assert.equal(result.saved.modbusPort, 1502); assert.equal(result.running.modbusPort, 502); assert.equal(result.pendingRestart, 'YES')
  const fallback = network.parseSjzdNetworkSnapshot(collect(configLines(defaults, defaults, { savedValid: false, runningValid: false })))
  assert.equal(fallback.saved.valid, false); assert.equal(fallback.running.flags, 2)
  assert.equal(fallback.running.code, 'EMPTY'); assert.equal(fallback.pendingRestart, 'NO')
})

test('NET rejects damaged, truncated, repeated source and contradictory pending snapshots', () => {
  assert.throws(() => collect(configLines(defaults, defaults, { badCrc: true })), /CRC32/)
  const truncated = configLines(); truncated.splice(2, 1)
  assert.throws(() => collect(truncated), /count/)
  assert.equal(collect(configLines().slice(0, 4)), undefined)
  const raw = collect(configLines())
  raw.payloads[1].fields.source = 'SAVED'
  assert.throws(() => network.parseSjzdNetworkSnapshot(raw), /来源/)
  assert.throws(() => network.parseSjzdNetworkSnapshot(collect(configLines({ ...defaults, aiUnit: 246 }, defaults, { pending: 'NO' }))), /待重启/)
})

test('Netty NONE bridge owner and extended wireless readback remain distinct from SLE choice', () => {
  const ack = protocol.parseSjzdBridgeAck('SLE_BRIDGE:ACK,id=1,requested=0,active=0,uart_owner=NONE,wireless=SLE,status=OK')
  assert.equal(ack.uartOwner, 'NONE')
  assert.equal(protocol.parseSjzdBridgeAck('SLE_BRIDGE:ACK,id=1,requested=1,active=1,uart_owner=NONE,wireless=SLE,status=OK'), undefined)
  const state = network.parseSjzdWlanType('WLAN_TYPE: mode=SLE,mode_code=2,uart2_baud=230400,report_transport=NETTY,uart2_active=0,saved_mode_code=0,saved_read_ok=1')
  assert.equal(state.mode, 'SLE'); assert.equal(state.reportTransport, 'NETTY'); assert.equal(state.uart2Active, false); assert.equal(state.savedModeCode, 0)
  assert.equal(network.parseSjzdWlanType('WLAN_TYPE: mode=4G,mode_code=3,uart2_baud=115200').reportTransport, undefined)
  assert.throws(() => network.parseSjzdWlanType('WLAN_TYPE: mode=SLE,mode_code=3,uart2_baud=230400'), /不一致/)
  assert.throws(() => network.parseSjzdWlanType('WLAN_TYPE: mode=SLE,mode_code=2,uart2_baud=230400,mode_code=3'), /重复/)
})

test('NETTY mode readback has no wireless UART and rejects contradictory states', () => {
  const state = network.parseSjzdWlanType('WLAN_TYPE: mode=NETTY,mode_code=4,uart2_baud=0,report_transport=NETTY,uart2_active=0,saved_mode_code=4,saved_read_ok=1')
  assert.equal(state.mode, 'NETTY'); assert.equal(state.modeCode, 4)
  assert.equal(state.reportTransport, 'NETTY'); assert.equal(state.uart2Active, false); assert.equal(state.uart2Baud, 0)
  assert.equal(network.parseSjzdWlanType('WLAN_TYPE: mode=SLE,mode_code=2,uart2_baud=0,report_transport=NETTY,uart2_active=0').uart2Baud, 0)
  for (const change of ['mode_code=3,uart2_baud=0,report_transport=NETTY,uart2_active=0',
    'mode_code=4,uart2_baud=230400,report_transport=NETTY,uart2_active=0',
    'mode_code=4,uart2_baud=0,report_transport=NETTY,uart2_active=1',
    'mode_code=4,uart2_baud=0,report_transport=SLE,uart2_active=0']) {
    assert.throws(() => network.parseSjzdWlanType(`WLAN_TYPE: mode=NETTY,${change}`), /不一致/)
  }
  assert.equal(protocol.parseSjzdBridgeAck('SLE_BRIDGE:ACK,id=1,requested=0,active=0,uart_owner=NONE,wireless=NETTY,status=OK').wireless, 'NETTY')
  assert.equal(protocol.parseSjzdBridgeAck('SLE_BRIDGE:ACK,id=1,requested=0,active=0,uart_owner=MCU,wireless=NETTY,status=OK'), undefined)
})

test('automatic detection and NONE are read-only states, with separate module liveness', () => {
  const pending = network.parseSjzdWlanType('WLAN_TYPE: mode=SLE,mode_code=2,uart2_baud=230400,report_transport=SLE,uart2_active=1,saved_mode_code=255,saved_read_ok=1,mode_source=AUTO_PROBING,module_state=PROBING,module_age_ms=4294967295,module_failures=0')
  assert.equal(pending.modeSource, 'AUTO_PROBING'); assert.equal(pending.moduleState, 'PROBING')
  const passive = network.parseSjzdWlanType('WLAN_TYPE: mode=NONE,mode_code=0,uart2_baud=0,report_transport=NONE,uart2_active=0,saved_mode_code=255,saved_read_ok=1,mode_source=AUTO,module_state=DISABLED,module_age_ms=4294967295,module_failures=0')
  assert.equal(passive.mode, 'NONE'); assert.equal(passive.moduleAgeMs, 0xffffffff)
  assert.throws(() => network.parseSjzdWlanType('WLAN_TYPE: mode=NONE,mode_code=0,uart2_baud=0,report_transport=NETTY,uart2_active=0'), /不一致/)
  assert.equal(protocol.parseSjzdBridgeAck('SLE_BRIDGE:ACK,id=1,requested=0,active=0,uart_owner=NONE,wireless=NONE,status=OK').active, false)
})

test('status requires five rows, preserves numeric zero and leaves missing fields unknown', () => {
  const collector = new network.SjzdNetworkStatusCollector()
  statusLines().slice(0, 4).forEach((line) => collector.feed(line))
  assert.equal(collector.snapshot().complete, false)
  assert.deepEqual(collector.snapshot().missing, ['RESOURCES'])
  assert.equal(collector.snapshot().parts.STATUS.spi_errors, '0')
  assert.equal(collector.snapshot().parts.RESOURCES, undefined)
  assert.equal(collector.feed(statusLines()[4]), true)
  assert.throws(() => collector.feed(statusLines()[4]), /重复/)
  assert.throws(() => new network.SjzdNetworkStatusCollector().feed('NET:STATUS,foo=bar'), /缺少/)
})

async function fixture(options = {}) {
  const previousWindow = globalThis.window
  globalThis.window = { setTimeout: (fn, ms, ...args) => setTimeout(fn, ms >= 2500 ? 180 : ms, ...args), clearTimeout }
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useSerialStore } = await server.ssrLoadModule('/src/stores/serialStore.ts')
  const { useSjzdStore } = await server.ssrLoadModule('/src/stores/sjzdStore.ts')
  const serial = useSerialStore(), listeners = new Map()
  serial.registerLineListener = (id, fn) => listeners.set(id, fn)
  serial.unregisterLineListener = (id) => listeners.delete(id)
  const store = useSjzdStore()
  serial.connectedPort = 'mock-network'
  await nextTick()
  const state = { saved: { ...defaults }, running: { ...defaults }, valid: true, runValid: true, revision: 100, points: [], mode: 'SLE', ...options }
  const commands = []
  const emit = (line) => { for (const fn of [...listeners.values()]) fn(line) }
  window.__TAURI_INTERNALS__ = { invoke: async (name, args) => {
    assert.equal(name, 'sjzd_send_raw_command'); assert.equal(args.path, 'mock-network')
    const text = args.text; commands.push(text)
    if (text === 'SLE_BRIDGE:LIST') emit(`SLE_BRIDGE:ACK,id=1,requested=0,active=0,uart_owner=${state.running.flags & 1 || state.mode === 'NETTY' || state.mode === 'NONE' ? 'NONE' : 'MCU'},wireless=${state.mode},status=OK`)
    else if (text === 'NET:LIST') {
      if (state.unsupported) emit('Command not support.')
      else if (!state.silent) configLines(state.saved, state.running, { revision: state.revision, savedValid: state.valid, runningValid: state.runValid, badCrc: state.badCrc }).forEach(emit)
    } else if (text === 'NET:STATUS') statusLines(state.running, state.mode).slice(0, state.partialStatus ? 4 : 5).forEach(emit)
    else if (text === 'DEVINFO') emit(`DevInfo: SN=${state.sn || '430126070777'}, Type=4301, Addr=777, PwrOnCnt=1, RptFreq=3s, FwVer=SJZD_V2.0`)
    else if (text === 'WLAN_TYPE:LIST') {
      const code = { NONE: 0, SLE: 2, '4G': 3, NETTY: 4 }[state.mode]
      const wired = Boolean(state.running.flags & 1) || state.mode === 'NETTY' || state.mode === 'NONE'
      emit(`WLAN_TYPE: mode=${state.mode},mode_code=${code},uart2_baud=${wired ? 0 : state.mode === '4G' ? 115200 : 230400},report_transport=${state.running.flags & 1 ? 'NETTY' : state.mode},uart2_active=${wired ? 0 : 1},saved_mode_code=${state.savedModeCode ?? 0},saved_read_ok=1${state.modeSource ? `,mode_source=${state.modeSource},module_state=${state.moduleState || 'DISABLED'}` : ''}`)
    }
    else if (text === 'RS485DEV:LIST') {
      const payload = state.points.map((unit, index) => `RS485_CONFIG:POINT,id=4,index=${index},addr=${unit},func=3,reg=1,len=1,type=0,order=0`)
      emit('RS485_CONFIG:BEGIN,id=4,version=1,revision=10'); payload.forEach(emit)
      emit(`RS485_CONFIG:END,id=4,count=${payload.length},crc32=${protocol.formatSjzdCrc32(protocol.crc32IsoHdlc(payload.join('')))},status=OK`)
    } else if (text.startsWith('NET:SET,')) {
      if (state.writeError) { emit('NET_CONFIG:SAVED,status=ERROR,code=WRITE_ERROR'); return 'sent' }
      const values = text.slice(8).split(',')
      state.saved = { ip: values[0], mask: values[1], gateway: values[2], nettyIp: values[3], nettyPort: +values[4], flags: +values[5], aiUnit: +values[6], modbusPort: +values[7] }
      state.revision++; state.valid = true
      if (state.wrongFields) state.saved.ip = '192.168.30.57'
      emit(`NET_CONFIG:SAVED,revision=${state.revision},hash=${state.badHash ? '00000000' : protocol.formatSjzdCrc32(state.revision)},status=OK,restart=YES`)
      if (state.corruptAfterSave) state.badCrc = true
    } else if (text === 'NET:RESET_CONFIG') {
      state.saved = { ...defaults }; state.valid = false; state.revision++
      emit(`NET_CONFIG:SAVED,revision=${state.revision},hash=${protocol.formatSjzdCrc32(state.revision)},status=OK,restart=YES`)
    } else if (text === '@RST') {
      state.running = { ...state.saved }; state.runValid = state.valid
      if (state.snAfterReset) state.sn = state.snAfterReset
      setTimeout(() => emit('Application Running.'), 30)
    } else if (text === 'WLAN_TYPE:SLE') {
      if (state.legacySwitch) { emit('Wireless type saved as SLE'); return 'sent' }
      if (state.switchError) { emit('WLAN_TYPE:SWITCH,status=ERROR,code=NETWORK_WRITE,saved_wireless=2,report_transport=NETTY'); return 'sent' }
      state.saved.flags &= ~1
      state.revision++
      emit('WLAN_TYPE:SWITCH,status=OK,saved_wireless=2,restart=YES')
      setTimeout(() => { state.running = { ...state.saved }; state.mode = 'SLE'; state.savedModeCode = 2; emit('Application Running.') }, 100)
    } else if (text === 'WLAN_TYPE:NETTY') {
      state.savedModeCode = 4
      emit('WLAN_TYPE:SWITCH,status=OK,saved_wireless=4,restart=YES')
      setTimeout(() => { state.running = { ...state.saved }; state.mode = 'NETTY'; emit('Application Running.') }, 100)
    } else if (text === 'WLAN_TYPE:LOCAL') {
      state.savedModeCode = 254
      state.saved.flags = 2
      if (state.saved.ip === '0.0.0.0') Object.assign(state.saved, { ip: defaults.ip, mask: defaults.mask, gateway: defaults.gateway })
      emit('WLAN_TYPE:SWITCH,status=OK,saved_wireless=254,restart=YES')
      setTimeout(() => { state.running = { ...state.saved }; state.mode = 'NONE'; state.modeSource = 'SAVED'; emit('Application Running.') }, 100)
    } else throw new Error('Unexpected command: ' + text)
    return 'sent'
  } }
  return { store, serial, state, commands, emit, pinia, cleanup: () => { globalThis.window = previousWindow } }
}

test('F411 blocks every network action without sending NET, F412 selection resets capability', async () => {
  const f = await fixture()
  try {
    f.store.selectHardwareVariant('f411')
    await f.store.queryNetworkConfig(); await f.store.saveNetworkConfig(defaults); await f.store.resetNetworkConfig(); await f.store.restartNetworkAndVerify()
    assert.equal(f.commands.length, 0); assert.equal(f.store.networkAvailable, false); assert.match(f.store.networkError, /F411/)
    f.store.selectHardwareVariant('f412')
    assert.equal(f.store.networkSupported, null); assert.equal(f.store.networkSnapshot, null)
  } finally { f.cleanup() }
})

test('complete NET protocol detects F412 support and returns current config/transport/zero counters', async () => {
  const f = await fixture({ running: { ...defaults, flags: 3, nettyIp: '192.168.30.254', nettyPort: 8888 }, saved: { ...defaults, flags: 3, nettyIp: '192.168.30.254', nettyPort: 8888 } })
  try {
    await f.store.queryNetworkConfig()
    assert.equal(f.store.hardwareVariant, 'f412'); assert.equal(f.store.hardwareSource, 'protocol')
    assert.equal(f.store.networkSnapshotFresh, true); assert.equal(f.store.networkStatus.complete, true)
    assert.equal(f.store.wlanTypeInfo.reportTransport, 'NETTY'); assert.equal(f.store.networkStatus.parts.STATUS.spi_errors, '0')
    const before = f.commands.length
    await f.store.toggleWlanBridge(true); await f.store.reconnectFourG()
    assert.equal(f.commands.length, before)
  } finally { f.cleanup() }
})

test('F412 old firmware is unsupported, cannot silently write defaults', async () => {
  const f = await fixture({ unsupported: true })
  try {
    f.store.selectHardwareVariant('f412')
    await f.store.queryNetworkConfig()
    assert.equal(f.store.networkSupported, false); assert.equal(f.store.hardwareVariant, 'f412')
    await f.store.saveNetworkConfig(defaults)
    assert.ok(!f.commands.some((text) => text.startsWith('NET:SET')))
  } finally { f.cleanup() }
})

test('saving verifies EEPROM fields/revision, preserves RUNNING and unrelated point draft', async () => {
  const f = await fixture()
  try {
    await f.store.queryNetworkConfig()
    f.store.modbusPoints = [{ slaveAddr: 9, regAddr: 2, length: 1, funcCode: 3, dataType: 0, byteOrder: 0 }]
    const target = { ...defaults, ip: '192.168.30.56', modbusPort: 1502 }
    await f.store.saveNetworkConfig(target)
    assert.equal(f.store.networkSaveVerified, true)
    assert.equal(f.store.networkSnapshot.saved.ip, target.ip)
    assert.equal(f.store.networkSnapshot.running.ip, defaults.ip)
    assert.equal(f.store.networkSnapshot.pendingRestart, 'YES')
    assert.equal(f.store.modbusPoints[0].slaveAddr, 9)
    assert.equal(f.store.networkStatus.parts.STATUS.ip, defaults.ip)
  } finally { f.cleanup() }
})

for (const [fault, message] of [['writeError', 'WRITE_ERROR'], ['badHash', '回执格式'], ['wrongFields', '保存字段'], ['corruptAfterSave', 'CRC32']]) {
  test(`save failure ${fault} never reports verified success and keeps actual/history explicit`, async () => {
    const f = await fixture()
    try {
      await f.store.queryNetworkConfig(); f.state[fault] = true
      await f.store.saveNetworkConfig({ ...defaults, ip: '192.168.30.56' })
      assert.equal(f.store.networkSaveVerified, false); assert.match(f.store.networkError, new RegExp(message))
      assert.equal(f.store.lastOpMessage.success, false)
      if (fault === 'corruptAfterSave') { assert.equal(f.store.networkSnapshotFresh, false); assert.equal(f.store.networkSnapshot.saved.ip, defaults.ip) }
      if (fault === 'wrongFields') { assert.equal(f.store.networkSnapshotFresh, true); assert.equal(f.store.networkSnapshot.saved.ip, '192.168.30.57') }
    } finally { f.cleanup() }
  })
}

test('AI conflicts stop before SET and partial diagnostic rows do not become zero/complete', async () => {
  const f = await fixture({ points: [247] })
  try {
    await f.store.queryNetworkConfig(); f.store.networkSaveVerified = true
    await f.store.saveNetworkConfig({ ...defaults, modbusPort: 1502 })
    assert.equal(f.store.networkSaveVerified, false)
    assert.match(f.store.networkError, /AI_UNIT_CONFLICT/)
    assert.equal(f.commands.some((text) => text.startsWith('NET:SET')), false)
    f.state.partialStatus = true
    await f.store.refreshNetworkStatus()
    assert.equal(f.store.networkStatus.complete, false); assert.equal(f.store.networkStatus.parts.RESOURCES, undefined)
    assert.match(f.store.networkError, /超时/)
  } finally { f.cleanup() }
})

test('reset only clears NET and keeps current running config until an observed verified reboot', async () => {
  const original = { ...defaults, modbusPort: 1502 }
  const f = await fixture({ saved: original, running: original })
  try {
    await f.store.queryNetworkConfig(); await f.store.resetNetworkConfig()
    assert.equal(f.store.networkSnapshot.saved.valid, false); assert.equal(f.store.networkSnapshot.running.modbusPort, 1502)
    assert.equal(f.store.networkSnapshot.pendingRestart, 'YES'); assert.equal(f.commands.includes('@EEP=0'), false)
    await f.store.restartNetworkAndVerify()
    assert.equal(f.store.networkSnapshot.pendingRestart, 'NO'); assert.equal(f.store.networkSnapshot.running.modbusPort, 502)
    assert.ok(f.store.networkRestartVerifiedAt); assert.equal(f.store.lastOpMessage.success, true)
  } finally { f.cleanup() }
})

test('serial switch cancels pending replies and clears hardware and all network readback', async () => {
  const f = await fixture()
  try {
    await f.store.queryNetworkConfig(); f.state.silent = true
    const pending = f.store.queryNetworkConfig()
    await new Promise((resolve) => setTimeout(resolve, 50))
    f.serial.connectedPort = 'another-device'; await nextTick(); await pending
    assert.equal(f.store.hardwareVariant, 'unknown'); assert.equal(f.store.networkSnapshot, null)
    assert.equal(f.store.networkSupported, null); assert.equal(f.store.networkStatus, null)
  } finally { f.cleanup() }
})

test('reboot verification refuses a different device SN', async () => {
  const f = await fixture({ snAfterReset: '430126079999' })
  try {
    await f.store.queryNetworkConfig(); await f.store.restartNetworkAndVerify()
    assert.equal(f.store.networkRestartVerifiedAt, null)
    assert.equal(f.store.networkSnapshot, null); assert.equal(f.store.hardwareVariant, 'unknown')
    assert.equal(f.store.lastOpMessage.success, false)
  } finally { f.cleanup() }
})

test('switching Netty to SLE accepts SWITCH ACK and verifies both groups without changing Modbus', async () => {
  const config = { ...defaults, flags: 3, nettyIp: '192.168.30.254', nettyPort: 8888 }
  const f = await fixture({ saved: config, running: config })
  try {
    await f.store.queryNetworkConfig(); await f.store.setWirelessMode('SLE')
    assert.equal(f.store.lastOpMessage.success, true)
    assert.equal(f.store.wlanTypeInfo.reportTransport, 'SLE')
    assert.equal(f.store.networkSnapshot.saved.flags, 2); assert.equal(f.store.networkSnapshot.running.flags, 2)
    assert.equal(f.store.networkSnapshot.saved.nettyPort, 8888)
    assert.equal(f.commands.filter((command) => command === 'WLAN_TYPE:SLE').length, 1)
  } finally { f.cleanup() }
})

test('NETTY switch verifies reboot/UART shutdown and preserves all four network service combinations', async () => {
  for (const flags of [0, 1, 2, 3]) {
    const config = { ...defaults, flags, nettyIp: '192.168.30.254', nettyPort: 8888 }
    const f = await fixture({ saved: config, running: config })
    try {
      await f.store.queryNetworkConfig(); await f.store.setWirelessMode('NETTY')
      assert.equal(f.store.lastOpMessage.success, true, f.store.lastOpMessage.text)
      assert.equal(f.store.wlanTypeInfo.mode, 'NETTY'); assert.equal(f.store.wlanTypeInfo.uart2Active, false)
      assert.equal(f.store.wlanTypeInfo.reportTransport, 'NETTY')
      assert.equal(f.store.networkSnapshot.saved.flags, flags); assert.equal(f.store.networkSnapshot.running.flags, flags)
      assert.equal(f.store.networkSnapshot.saved.nettyPort, 8888)
      assert.equal(f.commands.filter((command) => command === 'WLAN_TYPE:NETTY').length, 1)
      assert.ok(!f.commands.some((command) => command.startsWith('NET:SET') || command === '4G:LIST'))
      const before = f.commands.length
      await f.store.toggleWlanBridge(true); await f.store.reconnectFourG()
      assert.equal(f.commands.length, before)
    } finally { f.cleanup() }
  }
})

test('F411 refuses NETTY switching without sending device commands', async () => {
  const f = await fixture()
  try {
    f.store.selectHardwareVariant('f411')
    await f.store.setWirelessMode('NETTY')
    assert.equal(f.commands.length, 0); assert.equal(f.store.lastOpMessage.success, false)
  } finally { f.cleanup() }
})

test('LOCAL switches saved SLE/4G/Netty back to passive Modbus without module response and preserves custom IP/port/unit', async () => {
  for (const mode of ['SLE', '4G', 'NETTY']) {
    const config = { ...defaults, flags: 1, nettyIp: '192.168.30.254', nettyPort: 8888, aiUnit: 246, modbusPort: 1502 }
    const f = await fixture({ mode, modeSource: 'SAVED', moduleState: 'NO_RESPONSE', saved: config, running: config })
    try {
      await f.store.queryNetworkConfig(); await f.store.setWirelessMode('LOCAL')
      assert.equal(f.store.lastOpMessage.success, true, f.store.lastOpMessage.text)
      assert.equal(f.store.wlanTypeInfo.mode, 'NONE'); assert.equal(f.store.wlanTypeInfo.savedModeCode, 254)
      assert.equal(f.store.wlanTypeInfo.uart2Active, false)
      assert.equal(f.store.networkSnapshot.running.flags, 2)
      assert.equal(f.store.networkSnapshot.running.modbusPort, 1502); assert.equal(f.store.networkSnapshot.running.aiUnit, 246)
      assert.equal(f.store.networkSnapshot.running.nettyPort, 8888)
      assert.equal(f.commands.filter((command) => command === 'WLAN_TYPE:LOCAL').length, 1)
      assert.ok(!f.commands.some((command) => command === '4G:LIST' || command === 'SLE:LIST'))
      const html = await renderNetworkView(f)
      assert.match(html, /仅使用 Modbus TCP（关闭主动上报）/)
      assert.match(html, /主动上报已关闭/)
    } finally { f.cleanup() }
  }
})

test('LOCAL refuses old firmware without its persisted-off capability', async () => {
  const f = await fixture()
  try {
    await f.store.queryNetworkConfig()
    const before = f.commands.length
    await f.store.setWirelessMode('LOCAL')
    assert.equal(f.commands.length, before); assert.equal(f.store.lastOpMessage.success, false)
  } finally { f.cleanup() }
})

test('failed carrier switch reads actual saved/running groups, never retries or reports success', async () => {
  const config = { ...defaults, flags: 3, nettyIp: '192.168.30.254', nettyPort: 8888 }
  const f = await fixture({ saved: config, running: config, switchError: true })
  try {
    await f.store.queryNetworkConfig(); await f.store.setWirelessMode('SLE')
    assert.equal(f.store.lastOpMessage.success, false)
    assert.equal(f.store.networkSnapshot.running.flags, 3)
    assert.match(f.store.networkError, /NETWORK_WRITE/)
    assert.equal(f.commands.filter((command) => command === 'WLAN_TYPE:SLE').length, 1)
  } finally { f.cleanup() }
})

async function renderNetworkView(f) {
  const { default: View } = await server.ssrLoadModule('/src/views/devices/sjzdv3/NetworkConfigView.vue')
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/devices/sjzdv3/network', component: View }, { path: '/devices/sjzdv3', component: { template: '<div />' } }] })
  await router.push('/devices/sjzdv3/network')
  const app = createSSRApp(View).use(f.pinia).use(router)
  return await renderToString(app)
}

test('NETTY device can query mode/bridge/network and renders the wired setup action', async () => {
  const f = await fixture({ mode: 'NETTY', savedModeCode: 4 })
  try {
    await f.store.queryNetworkConfig(); await f.store.queryWlanType(); await f.store.queryWlanBridge()
    assert.equal(f.store.wlanTypeInfo.mode, 'NETTY'); assert.equal(f.store.wlanBridgeStatus.uartOwner, 'NONE')
    const html = await renderNetworkView(f)
    assert.match(html, /Netty 上报/); assert.match(html, /星闪、4G、Netty 是三种可选上报方式/)
    assert.match(html, /Modbus TCP 默认开启，配置本机 IP 即可被动读取数据/)
    assert.match(html, /UART2 停用/)
  } finally { f.cleanup() }
})

test('no-module AUTO result keeps local Modbus service and never selects Netty', async () => {
  const f = await fixture({ mode: 'SLE', modeSource: 'AUTO_PROBING', moduleState: 'PROBING', savedModeCode: 255 })
  try {
    await f.store.queryNetworkConfig()
    const probingCommands = f.commands.length
    await f.store.toggleWlanBridge(true)
    assert.equal(f.commands.length, probingCommands); assert.match(f.store.lastOpMessage.text, /自动探测/)
    f.state.mode = 'NONE'; f.state.modeSource = 'AUTO'; f.state.moduleState = 'DISABLED'
    await f.store.queryNetworkConfig(); await f.store.queryWlanType()
    assert.equal(f.store.wlanTypeInfo.mode, 'NONE'); assert.equal(f.store.networkSnapshot.running.flags, 2)
    const html = await renderNetworkView(f)
    assert.match(html, /未启用主动上报/); assert.match(html, /本次启动自动识别/)
    const before = f.commands.length
    await f.store.toggleWlanBridge(true); await f.store.reconnectFourG()
    assert.equal(f.commands.length, before)
    assert.ok(!f.commands.some((command) => command === 'WLAN_TYPE:NETTY' || command.startsWith('NET:SET')))
  } finally { f.cleanup() }
})

test('rendered F411 view exposes no network fields and performs no NET query', async () => {
  const f = await fixture()
  try {
    f.store.selectHardwareVariant('f411')
    const html = await renderNetworkView(f)
    assert.match(html, /STM32F411 不具备网口功能/)
    assert.ok(!html.includes('id="net-ip"'))
    assert.equal(f.commands.length, 0)
  } finally { f.cleanup() }
})

test('rendered F412 fields initialize from actual SAVED while RUNNING remains separate', async () => {
  const f = await fixture({ saved: { ...defaults, ip: '192.168.30.56', modbusPort: 1502 } })
  try {
    await f.store.queryNetworkConfig()
    const html = await renderNetworkView(f)
    assert.ok(html.includes('value="192.168.30.56"'))
    assert.ok(html.includes('value="1502"'))
    assert.match(html, /192\.168\.30\.55/)
    assert.match(html, /已保存，待重启生效/)
    assert.match(html, /与保存值不同，待重启/)
    assert.match(html, /编辑值与最近回填一致/)
    assert.ok(!html.includes('value="192.168.30.55"'), '编辑字段不能以本地默认值冒充实际保存值')
  } finally { f.cleanup() }
})

test('unconfigured record renders explicit fallback and allows an intentional default save', async () => {
  const f = await fixture({ valid: false, runValid: false })
  try {
    await f.store.queryNetworkConfig()
    const html = await renderNetworkView(f)
    assert.match(html, /EMPTY · 以下为默认回退值/)
    assert.match(html, /可显式保存当前回退值/)
    const labelAt = html.indexOf('保存并读回复核')
    const saveButton = html.slice(html.lastIndexOf('<button', labelAt), html.indexOf('</button>', labelAt))
    assert.ok(saveButton && !/\sdisabled(?:\s|=|>)/.test(saveButton))
    await f.store.saveNetworkConfig(defaults)
    assert.equal(f.store.networkSnapshot.saved.valid, true)
    assert.equal(f.store.networkSnapshot.running.valid, false)
    assert.equal(f.store.networkSnapshot.pendingRestart, 'YES')
  } finally { f.cleanup() }
})

test('stale readback renders historical values and cannot enable saving', async () => {
  const f = await fixture({ saved: { ...defaults, modbusPort: 1502 } })
  try {
    await f.store.queryNetworkConfig()
    f.store.networkSnapshotFresh = false
    const html = await renderNetworkView(f)
    assert.match(html, /value="1502"/)
    assert.match(html, /历史回显/)
    assert.match(html, /<fieldset disabled/)
  } finally { f.cleanup() }
})

test('changing to F411 after F412 readback clears cached network data and blocks commands', async () => {
  const f = await fixture()
  try {
    await f.store.queryNetworkConfig()
    assert.equal(f.store.hardwareVariant, 'f412')
    f.store.selectHardwareVariant('f411')
    const before = f.commands.length
    await f.store.queryNetworkConfig()
    assert.equal(f.commands.length, before)
    assert.equal(f.store.networkSnapshot, null)
    assert.equal(f.store.networkStatus, null)
    assert.equal(f.store.hardwareVariant, 'f411')
  } finally { f.cleanup() }
})

test('save rechecks identity before SET and cannot write another device', async () => {
  const f = await fixture()
  try {
    await f.store.queryNetworkConfig()
    f.state.sn = '430126079999'
    await f.store.saveNetworkConfig({ ...defaults, modbusPort: 1502 })
    assert.equal(f.commands.some((command) => command.startsWith('NET:SET')), false)
    assert.equal(f.store.networkSnapshot, null)
    assert.equal(f.store.hardwareVariant, 'unknown')
  } finally { f.cleanup() }
})

test('external configuration changes and failed fresh reads invalidate prior reboot verification', async () => {
  const f = await fixture()
  try {
    await f.store.queryNetworkConfig()
    f.store.networkRestartVerifiedAt = new Date().toISOString()
    f.state.saved = { ...defaults, modbusPort: 1502 }
    f.state.running = { ...f.state.saved }
    f.state.revision++
    await f.store.queryNetworkConfig()
    assert.equal(f.store.networkRestartVerifiedAt, null)
    assert.equal(f.store.networkSnapshot.running.modbusPort, 1502)
    f.store.networkRestartVerifiedAt = new Date().toISOString()
    f.state.badCrc = true
    await f.store.queryNetworkConfig()
    assert.equal(f.store.networkRestartVerifiedAt, null)
    assert.equal(f.store.networkSnapshotFresh, false)
    assert.equal(f.store.networkSnapshot.running.modbusPort, 1502)
  } finally { f.cleanup() }
})

test('legacy F411 wireless switching does not require new SWITCH or startup logs and sends no NET', async () => {
  const f = await fixture({ legacySwitch: true })
  try {
    f.store.selectHardwareVariant('f411')
    await f.store.setWirelessMode('SLE')
    assert.equal(f.store.lastOpMessage.success, true)
    assert.match(f.store.lastOpMessage.text, /旧固件未提供重启证明/)
    assert.equal(f.store.hardwareVariant, 'f411')
    assert.ok(f.commands.includes('WLAN_TYPE:SLE'))
    assert.ok(f.commands.includes('WLAN_TYPE:LIST'))
    assert.ok(!f.commands.some((command) => command.startsWith('NET:')))
  } finally { f.cleanup() }
})

async function mountModbusSetup(f, path) {
  const { default: View } = await server.ssrLoadModule('/src/views/ModbusDebuggerView.vue')
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/modbus', component: { render: () => null } },
    { path: '/devices/sjzdv3/network', component: { render: () => null } },
  ] })
  await router.push(path)
  let bindings
  const renderer = createRenderer({
    createElement: () => ({ children: [] }), createText: () => ({}), createComment: () => ({}),
    insert: (node, parent) => { node.parent = parent; parent.children.push(node) },
    remove: (node) => { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node) },
    parentNode: node => node.parent, nextSibling: () => null,
    setText() {}, setElementText() {}, patchProp() {},
  })
  const app = renderer.createApp({ setup(props, context) {
    // 运行实际 SFC 的 setup/watch，仅省去与配置隔离无关的 DOM 渲染。
    bindings = View.setup(props, context)
    return () => null
  } }).use(f.pinia).use(router).provide(ssrContextKey, { modules: new Set() })
  app.mount({ children: [] })
  return { bindings, router, unmount: () => app.unmount() }
}

for (const temporary of [true, false]) {
  test(`actual Modbus setup ${temporary ? 'keeps temporary AI settings isolated after route changes' : 'still persists ordinary workbench edits'}`, async () => {
    const f = await fixture()
    const previousStorage = globalThis.localStorage
    const key = 'np_tools_modbus_debug_config_v1'
    const original = JSON.stringify({ transport: 'tcp', tcpHost: '192.168.30.77', tcpPort: 2502, timeoutMs: 900, pollIntervalMs: 1100, points: [] })
    const storage = new Map([[key, original]])
    globalThis.localStorage = { getItem: name => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, value) }
    let mounted
    try {
      mounted = await mountModbusSetup(f, temporary ? '/modbus?sjzd=ai&host=192.168.30.55&port=1502&unit=246' : '/modbus')
      assert.equal(mounted.bindings.tcp.port, temporary ? 1502 : 2502)
      assert.equal(mounted.bindings.isPolling.value, false)
      if (temporary) {
        assert.deepEqual(mounted.bindings.points.value.map(point => point.unitId), [246, 246])
        // 路由已变化但旧组件尚在离页动画中时，配置 watch 仍不得写常规档案。
        await mounted.router.push('/devices/sjzdv3/network')
      }
      mounted.bindings.tcp.port = 3502
      await nextTick()
      if (temporary) assert.equal(storage.get(key), original)
      else assert.equal(JSON.parse(storage.get(key)).tcpPort, 3502)
    } finally {
      mounted?.unmount()
      if (previousStorage === undefined) delete globalThis.localStorage
      else globalThis.localStorage = previousStorage
      f.cleanup()
    }
  })
}

test('Netty SLE view disables both primary and quick bridge entry while keeping exit available', async () => {
  const netty = { ...defaults, flags: 3, nettyIp: '192.168.30.254', nettyPort: 8888 }
  const f = await fixture({ saved: netty, running: netty })
  try {
    await f.store.queryNetworkConfig()
    const { default: View } = await server.ssrLoadModule('/src/views/devices/sjzdv3/SleConfigView.vue')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/devices/sjzdv3/sle', component: View }] })
    await router.push('/devices/sjzdv3/sle')
    const html = await renderToString(createSSRApp(View).use(f.pinia).use(router))
    assert.match(html, /当前实际承载为 Netty/)
    const entryButtons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]).filter(button => button.includes('@WLAN=1'))
    assert.equal(entryButtons.length, 2)
    assert.ok(entryButtons.every(button => /\sdisabled(?:\s|=|>)/.test(button)), '主入口和快捷入口必须同时禁用')
    const exit = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]).find(button => button.includes('@WLAN=0'))
    assert.ok(exit && !/\sdisabled(?:\s|=|>)/.test(exit), '退出透传仍须可用')
  } finally { f.cleanup() }
})
