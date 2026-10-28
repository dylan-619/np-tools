import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { createServer } from 'vite'

// 执行实际协议及 Store；配置回归只替换串口和 Tauri API，不连接硬件。
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
})
after(() => server.close())

const configProtocol = await server.ssrLoadModule('/src/utils/sjzdConsoleProtocol.ts')
const debugProtocol = await server.ssrLoadModule('/src/utils/sjzdModbusDebug.ts')
const baudProtocol = await server.ssrLoadModule('/src/utils/sjzdRs485Baud.ts')
const addressProtocol = await server.ssrLoadModule('/src/utils/sjzdSleAddress.ts')

test('SJZ 星闪配置保存有效设备地址，旧固件不写地址，APID 仅回读', async () => {
  const previousWindow = globalThis.window
  globalThis.window = { setTimeout, clearTimeout }
  try {
    const { useSerialStore } = await server.ssrLoadModule('/src/stores/serialStore.ts')
    const { useSjzdStore } = await server.ssrLoadModule('/src/stores/sjzdStore.ts')
    for (const apId of [0, 5, 255]) for (const supported of [false, true]) {
      delete window.__TAURI_INTERNALS__
      setActivePinia(createPinia())
      const serial = useSerialStore()
      const listeners = new Map()
      serial.registerLineListener = (id, listener) => listeners.set(id, listener)
      serial.unregisterLineListener = (id) => listeners.delete(id)
      const store = useSjzdStore()
      serial.connectedPort = 'mock-sjzd'
      await nextTick()
      const calls = []
      const commands = []
      const state = { netName: 'star_RS', txPower: 5, maxTxPower: 8, revision: 100, address: 234, saved: false }
      const emit = (line) => {
        for (const listener of [...listeners.values()]) listener(line)
      }
      window.__TAURI_INTERNALS__ = {
        invoke: async (name, args) => {
          assert.equal(args.path, 'mock-sjzd')
          calls.push(name)
          if (name === 'sjzd_send_raw_command') {
            commands.push(args.text)
            if (args.text === 'SLE_BRIDGE:LIST') {
              emit('SLE_BRIDGE:ACK,id=1,requested=0,active=0,uart_owner=MCU,wireless=SLE,status=OK')
            } else if (args.text.startsWith('SLE_ADDR:')) {
              assert.ok(supported)
              state.address = Number(args.text.slice(9))
              state.saved = true
              state.revision++
              const hash = configProtocol.formatSjzdCrc32(state.revision)
              emit(`SLE_CONFIG:SAVED,revision=${state.revision},hash=${hash},status=OK,restart=MODULE`)
            } else {
              assert.equal(args.text, 'SLE:LIST')
              const effective = supported ? state.address : 1024
              const metadata = supported ? `,addr_saved=${state.saved ? 1 : 0}` : ''
              const payloads = [
                `SLE_CONFIG:EEPROM,id=2,net_name="${state.netName}",apid=${apId},dev_addr=${effective},tx_pwr=${state.txPower},max_tx_pwr=${state.maxTxPower},bridge=0${metadata}`,
                `SLE_CONFIG:CHIP,id=2,net_name="${state.netName}",name_len=${state.netName.length},mode=0,mac=4E:50:AA:04:00:55,addr=${effective},tx_pwr=${state.txPower}`,
              ]
              const crc = configProtocol.formatSjzdCrc32(configProtocol.crc32IsoHdlc(payloads.join('')))
              emit(`SLE_CONFIG:BEGIN,id=2,version=1,revision=${state.revision}`)
              payloads.forEach(emit)
              emit(`SLE_CONFIG:END,id=2,count=2,crc32=${crc},status=OK`)
            }
          } else {
            const fields = {
              sjzd_send_sle_netname: ['netName', 'name'],
              sjzd_send_sle_pwr: ['txPower', 'level'],
              sjzd_send_sle_maxpwr: ['maxTxPower', 'level'],
            }
            assert.ok(fields[name], `不应发送额外的配置命令：${name}`)
            const [field, argument] = fields[name]
            state[field] = args[argument]
            state.revision++
            const hash = configProtocol.formatSjzdCrc32(state.revision)
            emit(`SLE_CONFIG:SAVED,revision=${state.revision},hash=${hash},status=OK,restart=NO`)
          }
          return 'sent'
        },
      }
      await store.querySleConfig()
      assert.equal(store.lastOpMessage.success, true, store.lastOpMessage.text)
      assert.equal(store.sleCurrentStatus.apId, apId)
      assert.equal(store.sleCurrentStatus.devAddr, supported ? '234' : '1024')
      assert.equal(store.sleCurrentStatus.addressSaved, supported ? false : undefined)
      assert.equal('apId' in store.sleForm, false)
      assert.equal('setSleApid' in store, false)
      store.sleForm.netName = 'JY_2'
      store.sleForm.txPower = 4
      store.sleForm.maxTxPower = 7
      store.sleForm.address = 1024
      if (!supported) {
        const count = calls.length
        await store.setSleAddress(1024)
        assert.equal(calls.length, count, '旧固件不得发送地址写入')
        assert.equal(store.lastOpMessage.success, false)
      }
      calls.length = 0
      commands.length = 0
      await store.applyAllSleConfig()
      assert.deepEqual(calls, [
        'sjzd_send_sle_netname', 'sjzd_send_sle_pwr', 'sjzd_send_sle_maxpwr',
        ...(supported ? ['sjzd_send_raw_command'] : []), 'sjzd_send_raw_command',
      ])
      assert.deepEqual(commands, supported ? ['SLE_ADDR:1024', 'SLE:LIST'] : ['SLE:LIST'])
      assert.equal(store.lastOpMessage.success, true, store.lastOpMessage.text)
      assert.equal(store.sleCurrentStatus.apId, apId)
      assert.equal(store.sleCurrentStatus.lastSave.revision, state.revision)
      assert.equal(store.sleCurrentStatus.snapshot.revision, state.revision)
      assert.deepEqual(store.sleForm, { netName: 'JY_2', address: 1024, txPower: 4, maxTxPower: 7 })
      if (supported) {
        await store.setSleAddress(32768)
        assert.equal(store.lastOpMessage.success, true, store.lastOpMessage.text)
        assert.equal(store.sleCurrentStatus.addressSaved, true)
        assert.equal(store.sleCurrentStatus.devAddr, '32768')
        calls.length = 0
        await store.setSleAddress(0)
        assert.equal(store.lastOpMessage.success, false)
        await store.setSleAddress(65535)
        assert.equal(store.lastOpMessage.success, false)
        assert.deepEqual(calls, [], '非法地址不得写入设备')
        assert.equal(store.sleCurrentStatus.addressSaved, true)
      }
      assert.equal(listeners.size, 1, '事务监听器必须在完整回读后释放')
    }
  } finally {
    globalThis.window = previousWindow
  }
})

test('SJZ 地址只允许 1..65534，回读兼容默认地址和已保存地址', () => {
  for (const address of [1, 234, 1024, 32768, 65534]) {
    assert.equal(addressProtocol.buildSjzdSleAddressCommand(address), `SLE_ADDR:${address}`)
  }
  for (const address of [0, -1, 1.5, NaN, Infinity, 65535]) {
    assert.throws(() => addressProtocol.buildSjzdSleAddressCommand(address), /1～65534/)
  }
  const parse = (address, metadata) => {
    const payload = `SLE_CONFIG:EEPROM,id=2,net_name="star_RS",apid=5,dev_addr=${address},tx_pwr=5,max_tx_pwr=5,bridge=0${metadata}`
    const crc = configProtocol.formatSjzdCrc32(configProtocol.crc32IsoHdlc(payload))
    return configProtocol.parseSjzdSleSnapshot(completeSnapshot('SLE', [
      'SLE_CONFIG:BEGIN,id=2,version=1,revision=1', payload,
      `SLE_CONFIG:END,id=2,count=1,crc32=${crc},status=ERROR,code=CHIP_NOT_READY`,
    ]))
  }
  assert.equal(parse(234, ',addr_saved=0').eeprom.addressSaved, false)
  assert.equal(parse(65534, ',addr_saved=1').eeprom.addressSaved, true)
  assert.equal(parse(234, '').eeprom.addressSaved, undefined)
  assert.throws(() => parse(0, ',addr_saved=0'))
  assert.throws(() => parse(65535, ',addr_saved=1'))
  assert.throws(() => parse(234, ',addr_saved=2'))
})

function completeSnapshot(feature, lines) {
  const collector = new configProtocol.SjzdConfigSnapshotCollector(feature)
  let completed
  for (const line of lines) {
    const fed = collector.feed(line)
    assert.equal(fed.error, undefined, `协议行不应失败：${line}`)
    if (fed.snapshot) completed = fed.snapshot
  }
  assert.ok(completed, `${feature} 应在 END 后形成完整快照`)
  return completed
}

test('SJZ 配置列表仅在同一事务 count 与 CRC32 均通过后采纳 RS485 点表', () => {
  assert.equal(configProtocol.formatSjzdCrc32(configProtocol.crc32IsoHdlc('123456789')), 'CBF43926')
  const lines = [
    'RS485_CONFIG:BEGIN,id=1,version=1,revision=2644332057',
    'RS485_CONFIG:POINT,id=1,index=0,addr=3,func=3,reg=43014,len=1,type=0,order=0',
    'RS485_CONFIG:END,id=1,count=1,crc32=BFD8E2D8,status=OK',
  ]
  const snapshot = completeSnapshot('RS485', lines)
  const parsed = configProtocol.parseSjzdRs485Snapshot(snapshot)
  assert.deepEqual(parsed.points, [
    { slaveAddr: 3, funcCode: 3, regAddr: 43014, length: 1, dataType: 0, byteOrder: 0 },
  ])
  assert.equal(parsed.evidence.revisionHex, '0x9D9D4E19')

  const corrupt = new configProtocol.SjzdConfigSnapshotCollector('RS485')
  corrupt.feed(lines[0])
  corrupt.feed(lines[1])
  const result = corrupt.feed('RS485_CONFIG:END,id=1,count=1,crc32=00000000,status=OK')
  assert.match(result.error || '', /CRC32 不一致/)
})

test('SJZ SLE 完整 EEPROM 快照可明确表达芯片未就绪，而不是伪造成可比对状态', () => {
  const snapshot = completeSnapshot('SLE', [
    'SLE_CONFIG:BEGIN,id=2,version=1,revision=3269668012',
    'SLE_CONFIG:EEPROM,id=2,net_name="star_RS",apid=5,dev_addr=1,tx_pwr=5,max_tx_pwr=5,bridge=0',
    'SLE_CONFIG:END,id=2,count=1,crc32=DA580F8D,status=ERROR,code=CHIP_NOT_READY',
  ])
  const parsed = configProtocol.parseSjzdSleSnapshot(snapshot)
  assert.equal(parsed.eeprom.netName, 'star_RS')
  assert.equal(parsed.chip, undefined)
  assert.equal(parsed.evidence.deviceStatus, 'ERROR')
  assert.equal(parsed.evidence.code, 'CHIP_NOT_READY')
})

test('SJZ 4G 完整错误终态保留脱敏密码、带引号文本与配置错误掩码', () => {
  const snapshot = completeSnapshot('4G', [
    '4G_CONFIG:BEGIN,id=7,version=1,revision=157637504',
    '4G_CONFIG:META,id=7,eeprom_version=1,config=incomplete,error_mask=0x002E,state=IDLE,online=0',
    '4G_CONFIG:APN,id=7,value="cmiot"',
    '4G_CONFIG:BROKER,id=7,host="broker,edge=1.example.com",port=0',
    '4G_CONFIG:MQTT,id=7,keepalive=0,qos=0',
    '4G_CONFIG:IDENTITY,id=7,client="",username="",password=set',
    '4G_CONFIG:PUBLISH,id=7,value=""',
    '4G_CONFIG:SUBSCRIBE,id=7,value=""',
    '4G_CONFIG:END,id=7,count=7,crc32=09755980,status=ERROR,code=CONFIG_INCOMPLETE',
  ])
  const parsed = configProtocol.parseSjzdFourGSnapshot(snapshot)
  assert.equal(parsed.config.host, 'broker,edge=1.example.com')
  assert.equal(parsed.config.password, '')
  assert.equal(parsed.status.passwordIsSet, true)
  assert.equal(parsed.status.configOperational, false)
  assert.deepEqual(parsed.status.configErrors, [
    'MQTT Broker 主机未配置',
    'MQTT Client ID 未配置',
    'MQTT 发布 Topic 未配置',
    'MQTT Broker 端口未配置',
  ])
})

test('SJZ 保存回执与桥接状态必须通过格式和值一致性校验', () => {
  const receipt = configProtocol.parseSjzdConfigSaveReceipt(
    '4G_CONFIG:SAVED,revision=3804028397,hash=E2BCDDED,status=OK,restart=NO'
  )
  assert.deepEqual(
    { feature: receipt?.feature, status: receipt?.status, revision: receipt?.revision, hash: receipt?.hash },
    { feature: '4G', status: 'OK', revision: 3804028397, hash: 'E2BCDDED' }
  )
  assert.equal(
    configProtocol.parseSjzdConfigSaveReceipt(
      '4G_CONFIG:SAVED,revision=3804028397,hash=00000000,status=OK,restart=NO'
    ),
    undefined
  )
  const bridge = configProtocol.parseSjzdBridgeAck(
    'SLE_BRIDGE:ACK,id=5,requested=1,active=1,uart_owner=SLE,wireless=SLE,status=OK'
  )
  assert.deepEqual(
    { active: bridge?.active, uartOwner: bridge?.uartOwner, wireless: bridge?.wireless },
    { active: true, uartOwner: 'SLE', wireless: 'SLE' }
  )
  assert.equal(
    configProtocol.parseSjzdBridgeAck(
      'SLE_BRIDGE:ACK,id=5,requested=1,active=0,uart_owner=MCU,wireless=SLE,status=OK'
    ),
    undefined
  )
})

test('SJZ Modbus DEBUG 只将同一 ID 的完整 BEGIN/TX/RX/DATA/RESULT/END 判为成功', () => {
  const point = { slaveAddr: 3, funcCode: 3, regAddr: 43014, length: 1, dataType: 2, byteOrder: 0 }
  const lines = [
    'MB_DEBUG:BEGIN,id=4,point_revision=2644332057,addr=3,func=3,reg=43014,len=1,timeout_ms=1000',
    'MB_DEBUG:TX,id=4,hex=0303A8050001B589',
    'MB_DEBUG:RX,id=4,hex=0303021234CCF3',
    'MB_DEBUG:DATA,id=4,hex=1234',
    'MB_DEBUG:RESULT,id=4,status=OK',
    'MB_DEBUG:END,id=4',
  ]
  const events = lines.map((line) => debugProtocol.parseModbusDebugProtocolLine(line))
  const report = debugProtocol.buildModbusDebugReport(
    point,
    'mock-sjz',
    '2026-09-05T00:00:00.000Z',
    '2026-09-05T00:00:01.000Z',
    events,
    lines
  )
  assert.equal(report.status, 'ok')
  assert.equal(report.request.transactionId, 4)
  assert.equal(report.request.protoAddress, 43013)
  assert.equal(report.response.rxHex, '0303021234CCF3')
  assert.equal(report.decodedValue, '4660')

  const incomplete = debugProtocol.buildModbusDebugReport(
    point,
    'mock-sjz',
    '2026-09-05T00:00:00.000Z',
    '2026-09-05T00:00:01.000Z',
    events.slice(0, -1),
    lines.slice(0, -1)
  )
  assert.equal(incomplete.status, 'protocol_error')
})

test('SJZ Modbus DEBUG 保留同一 ID 的异常与 BUSY 终态，不接受其他事务的 END', () => {
  const point = { slaveAddr: 1, funcCode: 4, regAddr: 30001, length: 1, dataType: 2, byteOrder: 0 }
  const exceptionLines = [
    'MB_DEBUG:BEGIN,id=8,point_revision=1,addr=1,func=4,reg=30001,len=1,timeout_ms=1000',
    'MB_DEBUG:TX,id=8,hex=0104753000018A0B',
    'MB_DEBUG:RX,id=8,hex=018402C0F1',
    'MB_DEBUG:RESULT,id=8,status=EXCEPTION,code=0x02',
    'MB_DEBUG:END,id=8',
  ]
  const exception = debugProtocol.buildModbusDebugReport(
    point,
    'mock-sjz',
    '2026-09-05T00:00:00.000Z',
    '2026-09-05T00:00:01.000Z',
    exceptionLines.map((line) => debugProtocol.parseModbusDebugProtocolLine(line)),
    exceptionLines
  )
  assert.equal(exception.status, 'exception')
  assert.equal(exception.response.exceptionCode, 2)

  const busyLines = ['MB_DEBUG:RESULT,id=9,status=IO_ERROR,code=BUSY', 'MB_DEBUG:END,id=9']
  const busy = debugProtocol.buildModbusDebugReport(
    point,
    'mock-sjz',
    '2026-09-05T00:00:00.000Z',
    '2026-09-05T00:00:01.000Z',
    busyLines.map((line) => debugProtocol.parseModbusDebugProtocolLine(line)),
    busyLines
  )
  assert.equal(busy.status, 'busy')

  const wrongEndLines = [
    'MB_DEBUG:BEGIN,id=10,point_revision=1,addr=1,func=4,reg=30001,len=1,timeout_ms=1000',
    'MB_DEBUG:RESULT,id=10,status=TIMEOUT',
    'MB_DEBUG:END,id=11',
  ]
  const wrongEnd = debugProtocol.buildModbusDebugReport(
    point,
    'mock-sjz',
    '2026-09-05T00:00:00.000Z',
    '2026-09-05T00:00:01.000Z',
    wrongEndLines.map((line) => debugProtocol.parseModbusDebugProtocolLine(line)),
    wrongEndLines
  )
  assert.equal(wrongEnd.status, 'protocol_error')
})



test('SJZ 全局波特率严格构造命令，默认恢复不清点表', () => {
  for (const baud of [9600, 19200, 38400, 57600, 115200]) {
    assert.equal(baudProtocol.buildRs485BaudCommand(baud), `RS485:BAUD:${baud}`)
  }
  assert.equal(baudProtocol.buildRs485BaudCommand('DEFAULT'), 'RS485:BAUD:DEFAULT')
  for (const baud of [0, -1, 4800, 9600.5, NaN, Infinity, '9600junk']) {
    assert.throws(() => baudProtocol.buildRs485BaudCommand(baud))
  }
})

test('SJZ 波特率区分未设置、已保存待重启、重启运行值及 EEPROM 读取失败', () => {
  const parse = baudProtocol.parseRs485BaudResponse
  assert.equal(parse('RS485:CONFIG,status=OK,active_baud=9600,saved_baud=UNSET,default_baud=9600,pending_restart=NO')?.savedBaud, 'UNSET')
  const saved = parse('RS485:SAVED,status=OK,active_baud=9600,saved_baud=115200,pending_restart=YES')
  assert.equal(saved?.event, 'SAVED')
  assert.equal(saved?.activeBaud, 9600)
  assert.equal(saved?.savedBaud, 115200)
  assert.equal(saved?.pendingRestart, 'YES')
  assert.equal(parse('RS485:CONFIG,status=OK,active_baud=115200,saved_baud=115200,default_baud=9600,pending_restart=NO')?.activeBaud, 115200)
  assert.equal(parse('RS485:CONFIG,status=ERROR,code=STORAGE_READ,active_baud=9600,saved_baud=UNKNOWN,default_baud=9600,pending_restart=UNKNOWN')?.savedBaud, 'UNKNOWN')
  assert.equal(parse('RS485:CONFIG,status=ERROR,code=UART_INIT_FAILED,active_baud=UNKNOWN,saved_baud=9600,default_baud=9600,pending_restart=UNKNOWN')?.activeBaud, 'UNKNOWN')
})

test('SJZ 波特率拒绝不完整回执、非法数值、重复字段及伪造的已生效状态', () => {
  for (const line of [
    'RS485:SAVED,status=OK,active_baud=9600,saved_baud=115200,pending_restart=NO',
    'RS485:SAVED,status=OK,active_baud=9600,saved_baud=UNSET,pending_restart=NO',
    'RS485:CONFIG,status=OK,active_baud=9600,saved_baud=115200,pending_restart=YES',
    'RS485:CONFIG,status=OK,active_baud=4800,saved_baud=9600,default_baud=9600,pending_restart=YES',
    'RS485:CONFIG,status=OK,active_baud=9600,saved_baud=UNKNOWN,default_baud=9600,pending_restart=UNKNOWN',
    'RS485:CONFIG,status=OK,active_baud=9600,saved_baud=INVALID,default_baud=9600,pending_restart=NO',
    'RS485:ERROR,status=ERROR,active_baud=9600,saved_baud=UNKNOWN,pending_restart=UNKNOWN',
    'RS485:SAVED,status=OK,status=OK,active_baud=9600,saved_baud=9600,pending_restart=NO',
    'RS485_CONFIG:BEGIN,id=1,version=1,revision=1',
    'MB_DEBUG:RESULT,id=1,status=OK',
    'RS485 UART3: baud=115200, 8N1, frame_idle_ms=10',
  ]) assert.equal(baudProtocol.parseRs485BaudResponse(line), undefined, line)
})

test('SJZ 波特率 store 实际执行设置后 LIST 复核，重启仅发送 @RST，旧固件禁止保存', async () => {
  globalThis.window = { setTimeout, clearTimeout }
  const { createPinia, setActivePinia } = await import('pinia')
  const { nextTick } = await import('vue')
  setActivePinia(createPinia())
  const { useSerialStore } = await server.ssrLoadModule('/src/stores/serialStore.ts')
  const serial = useSerialStore()
  const listeners = new Map()
  serial.registerLineListener = (id, callback) => listeners.set(id, callback)
  serial.unregisterLineListener = (id) => listeners.delete(id)
  const { useSjzdStore } = await server.ssrLoadModule('/src/stores/sjzdStore.ts')
  const store = useSjzdStore()
  serial.connectedPort = 'mock-rs485-baud'
  await nextTick()
  const sent = []
  let savedBaud = 'UNSET'
  let mode = 'normal'
  window.__TAURI_INTERNALS__ = {
    invoke: async (name, args) => {
      assert.equal(name, 'sjzd_send_raw_command')
      assert.equal(args.path, 'mock-rs485-baud')
      sent.push(args.text)
      let reply
      if (args.text === 'SLE_BRIDGE:LIST') {
        reply = 'SLE_BRIDGE:ACK,id=1,requested=0,active=0,uart_owner=MCU,wireless=SLE,status=OK'
      } else if (mode === 'unsupported') {
        reply = '[ERROR] Command not support.'
      } else if (args.text === 'RS485:LIST') {
        const baud = mode === 'mismatch' ? '19200' : savedBaud
        reply = `RS485:CONFIG,status=OK,active_baud=9600,saved_baud=${baud},default_baud=9600,pending_restart=${baud === 'UNSET' || baud === '9600' ? 'NO' : 'YES'}`
      } else if (args.text.startsWith('RS485:BAUD:')) {
        savedBaud = args.text.split(':')[2] === 'DEFAULT' ? '9600' : args.text.split(':')[2]
        reply = mode === 'write-error'
          ? 'RS485:ERROR,status=ERROR,code=STORAGE_VERIFY,active_baud=9600,saved_baud=UNKNOWN,pending_restart=UNKNOWN'
          : `RS485:SAVED,status=OK,active_baud=9600,saved_baud=${savedBaud},pending_restart=${savedBaud === '9600' ? 'NO' : 'YES'}`
      } else assert.equal(args.text, '@RST')
      if (reply) queueMicrotask(() => { for (const listener of [...listeners.values()]) listener(reply) })
      return args.text
    },
  }
  await store.queryRs485Baud()
  assert.equal(store.rs485BaudConfig.savedBaud, 'UNSET')
  sent.length = 0
  await store.saveRs485Baud(115200)
  assert.deepEqual(sent, ['RS485:BAUD:115200', 'RS485:LIST'])
  assert.equal(store.rs485BaudConfig.activeBaud, 9600)
  assert.equal(store.rs485BaudConfig.savedBaud, 115200)
  assert.equal(store.rs485BaudConfig.pendingRestart, 'YES')
  mode = 'mismatch'
  await store.saveRs485Baud(57600)
  assert.equal(store.rs485BaudConfig, null)
  assert.equal(store.lastOpMessage.success, false)
  mode = 'write-error'
  sent.length = 0
  await store.saveRs485Baud(38400)
  assert.deepEqual(sent, ['RS485:BAUD:38400'])
  assert.equal(store.rs485BaudConfig, null)
  assert.equal(store.lastOpMessage.success, false)
  mode = 'normal'
  await store.queryRs485Baud()
  sent.length = 0
  await store.resetSystem()
  assert.deepEqual(sent, ['@RST'])
  assert.equal(store.rs485BaudConfig, null)
  assert.equal(store.rs485BaudSupported, null)
  mode = 'unsupported'
  await store.queryRs485Baud()
  assert.equal(store.rs485BaudSupported, false)
  sent.length = 0
  await store.saveRs485Baud(115200)
  assert.deepEqual(sent, [])
  assert.equal(store.isBusy, false)
  delete globalThis.window
})


test('SJZ DEVINFO 与 VERSION 回读显示实际固件版本，旧响应清空版本缓存', async () => {
  globalThis.window = { setTimeout, clearTimeout }
  try {
    const { createPinia, setActivePinia } = await import('pinia')
    const { nextTick } = await import('vue')
    setActivePinia(createPinia())
    const { useSerialStore } = await server.ssrLoadModule('/src/stores/serialStore.ts')
    const serial = useSerialStore()
    const listeners = new Map()
    serial.registerLineListener = (id, callback) => listeners.set(id, callback)
    serial.unregisterLineListener = (id) => listeners.delete(id)
    const { useSjzdStore } = await server.ssrLoadModule('/src/stores/sjzdStore.ts')
    const store = useSjzdStore()
    serial.connectedPort = 'mock-firmware-version'
    await nextTick()
    const emit = (line) => { for (const listener of [...listeners.values()]) listener(line) }
    const sent = []
    const legacy = 'DevInfo: SN=430120260001, Type=4301, Addr=1, PwrOnCnt=7, TotRunTim=123s, RptFreq=2s'
    window.__TAURI_INTERNALS__ = {
      invoke: async (name, args) => {
        assert.equal(name, 'sjzd_send_raw_command')
        assert.equal(args.path, 'mock-firmware-version')
        sent.push(args.text)
        if (args.text === 'SLE_BRIDGE:LIST') {
          queueMicrotask(() => emit('SLE_BRIDGE:ACK,id=1,requested=0,active=0,uart_owner=MCU,wireless=SLE,status=OK'))
        } else {
          assert.equal(args.text, 'DEVINFO')
          queueMicrotask(() => emit(`${legacy}, FwVer=SJZD_V2.0`))
        }
        return args.text
      },
    }
    await store.queryDeviceInfo()
    assert.deepEqual(sent, ['SLE_BRIDGE:LIST', 'DEVINFO'])
    assert.equal(store.deviceInfo.sn, '430120260001')
    assert.equal(store.deviceInfo.fwVersion, 'SJZD_V2.0')
    assert.equal(store.deviceInfo.bootCount, 7)
    assert.equal(store.deviceInfo.uptimeSec, 123)
    assert.equal(store.deviceInfo.reportFreqSec, 2)

    emit('[1.000] userMain.c[255]: AppVersion:SJZD_V2.1')
    assert.equal(store.deviceInfo.fwVersion, 'SJZD_V2.1')
    assert.equal(store.deviceInfo.sn, '430120260001')
    emit('[1.001] userMain.c[4412]: Hardware Version:3')
    assert.equal(store.deviceInfo.fwVersion, 'SJZD_V2.1')

    emit(legacy)
    assert.equal(store.deviceInfo.fwVersion, undefined)
    assert.equal(store.deviceInfo.deviceType, '4301')
    emit('AppVersion:DC_V1.0.2')
    assert.equal(store.deviceInfo.fwVersion, 'DC_V1.0.2')
    emit('[2.000] userMain.c[1220]: ' + legacy)
    assert.equal(store.deviceInfo.fwVersion, undefined)
    assert.equal(store.deviceInfo.bootCount, 7)
  } finally {
    delete globalThis.window
  }
})

async function createDeviceInfoStore(port) {
  const { createPinia, setActivePinia } = await import('pinia')
  const { nextTick } = await import('vue')
  setActivePinia(createPinia())
  const { useSerialStore } = await server.ssrLoadModule('/src/stores/serialStore.ts')
  const serial = useSerialStore()
  const listeners = new Map()
  serial.registerLineListener = (id, callback) => listeners.set(id, callback)
  serial.unregisterLineListener = (id) => listeners.delete(id)
  const { useSjzdStore } = await server.ssrLoadModule('/src/stores/sjzdStore.ts')
  const store = useSjzdStore()
  serial.connectedPort = port
  await nextTick()
  const emit = (line) => { for (const listener of [...listeners.values()]) listener(line) }
  return { store, listeners, emit }
}

test('SJZ DEVINFO 等待实际回读完成后才发送后续 WLAN_TYPE 查询', async () => {
  globalThis.window = { setTimeout, clearTimeout }
  try {
    const { store, listeners, emit } = await createDeviceInfoStore('mock-device-info-order')
    const sent = []
    let deviceInfoWritten
    const writeCompleted = new Promise((resolve) => { deviceInfoWritten = resolve })
    window.__TAURI_INTERNALS__ = {
      invoke: async (name, args) => {
        assert.equal(name, 'sjzd_send_raw_command')
        assert.equal(args.path, 'mock-device-info-order')
        sent.push(args.text)
        if (args.text === 'SLE_BRIDGE:LIST') {
          queueMicrotask(() => emit('SLE_BRIDGE:ACK,id=1,requested=0,active=0,uart_owner=MCU,wireless=SLE,status=OK'))
        } else if (args.text === 'DEVINFO') {
          deviceInfoWritten()
        } else {
          assert.equal(args.text, 'WLAN_TYPE:LIST')
          queueMicrotask(() => emit('WLAN_TYPE: mode=4G,mode_code=3,uart2_baud=115200'))
        }
        return args.text
      },
    }

    let infoResolved = false
    const infoQuery = store.queryDeviceInfo().then(() => { infoResolved = true })
    const refresh = infoQuery.then(() => store.queryWlanType())
    await writeCompleted
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(store.isBusy, true)
    assert.equal(infoResolved, false)
    assert.deepEqual(sent, ['SLE_BRIDGE:LIST', 'DEVINFO'])
    assert.equal(listeners.size, 2, '回读前必须保留 DEVINFO 事务监听器')

    emit('[1.000] UART1 RX: DEVINFO')
    emit('[1.001] AppVersion:SJZD_V2.0')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(infoResolved, false, '发送回显和版本日志不能替代 DevInfo 回读')
    assert.equal(store.isBusy, true)
    assert.deepEqual(sent, ['SLE_BRIDGE:LIST', 'DEVINFO'])

    emit('[1.020] DevInfo: SN=123456789012, Type=4301, Addr=1, PwrOnCnt=7, TotRunTim=123s, RptFreq=2s')
    await refresh
    assert.equal(infoResolved, true)
    assert.deepEqual(sent, ['SLE_BRIDGE:LIST', 'DEVINFO', 'WLAN_TYPE:LIST'])
    assert.equal(store.deviceInfo.sn, '123456789012')
    assert.equal(store.wlanTypeInfo.mode, '4G')
    assert.equal(store.isBusy, false)
    assert.equal(store.lastOpMessage.success, true)
    assert.equal(listeners.size, 1, '事务结束后只保留全局解析器')
  } finally {
    delete globalThis.window
  }
})

test('SJZ DEVINFO 不支持或回读超时均报告失败并释放事务监听器', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  globalThis.window = { setTimeout, clearTimeout }
  try {
    const { store, listeners, emit } = await createDeviceInfoStore('mock-device-info-failure')
    let mode = 'unsupported'
    window.__TAURI_INTERNALS__ = {
      invoke: async (name, args) => {
        assert.equal(name, 'sjzd_send_raw_command')
        assert.equal(args.path, 'mock-device-info-failure')
        if (args.text === 'SLE_BRIDGE:LIST') {
          queueMicrotask(() => emit('SLE_BRIDGE:ACK,id=1,requested=0,active=0,uart_owner=MCU,wireless=SLE,status=OK'))
        } else {
          assert.equal(args.text, 'DEVINFO')
          if (mode === 'unsupported') queueMicrotask(() => emit('[ERROR] Command not support.'))
        }
        return args.text
      },
    }

    await store.queryDeviceInfo()
    assert.equal(store.lastOpMessage.success, false)
    assert.match(store.lastOpMessage.text, /Command not support/)
    assert.equal(store.isBusy, false)
    assert.equal(listeners.size, 1)

    mode = 'timeout'
    let resolved = false
    const query = store.queryDeviceInfo().then(() => { resolved = true })
    await new Promise((resolve) => setImmediate(resolve))
    context.mock.timers.tick(2499)
    await Promise.resolve()
    assert.equal(resolved, false)
    assert.equal(store.isBusy, true)
    assert.equal(listeners.size, 2)

    context.mock.timers.tick(1)
    await query
    assert.equal(store.lastOpMessage.success, false)
    assert.match(store.lastOpMessage.text, /等待设备响应超时（2500ms）/)
    assert.equal(store.isBusy, false)
    assert.equal(listeners.size, 1)
  } finally {
    delete globalThis.window
  }
})
