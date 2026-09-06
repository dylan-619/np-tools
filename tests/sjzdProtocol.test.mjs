import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

// 复用 Vite 的 TypeScript 加载器；仅验证桌面工具对 SJZDV3 结构化串口协议的判定。
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
})
after(() => server.close())

const configProtocol = await server.ssrLoadModule('/src/utils/sjzdConsoleProtocol.ts')
const debugProtocol = await server.ssrLoadModule('/src/utils/sjzdModbusDebug.ts')

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
