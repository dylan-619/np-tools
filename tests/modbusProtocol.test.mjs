import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

// 使用与现有协议测试一致的 Vite TypeScript 加载器；不连接串口或真实从站。
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
})
after(() => server.close())

const protocol = await server.ssrLoadModule('/src/utils/modbusProtocol.ts')

function point(overrides = {}) {
  return {
    id: 'meter-voltage',
    name: '电压',
    enabled: true,
    unitId: 1,
    functionCode: 3,
    address: 40001,
    addressMode: 'reference',
    quantity: 2,
    valueType: 'float32',
    byteOrder: 'ABCD',
    ...overrides,
  }
}

function appendCrc(payload) {
  const crc = protocol.modbusCrc16(payload)
  return Uint8Array.from([...payload, crc & 0xff, (crc >>> 8) & 0xff])
}

test('PLC 参考地址会准确换算为 PDU 偏移并形成标准 RTU 请求', () => {
  assert.equal(protocol.resolveModbusAddress(point()), 0)
  assert.equal(
    protocol.formatModbusHex(protocol.buildModbusRtuRequest(point())),
    '01 03 00 00 00 02 C4 0B'
  )
  assert.equal(
    protocol.resolveModbusAddress(point({ functionCode: 2, address: 10001, quantity: 1, valueType: 'bool' })),
    0
  )
  assert.equal(
    protocol.resolveModbusAddress(point({ addressMode: 'offset', address: 18 })),
    18
  )
})

test('分片 RTU 数据流可提取完整帧，并按字节序解码实时值', () => {
  const response = appendCrc(Uint8Array.from([1, 3, 4, 0x42, 0xf6, 0xe9, 0x79]))
  const incomplete = protocol.extractModbusRtuResponse(response.slice(0, 4), point())
  assert.equal(incomplete.kind, 'incomplete')

  const complete = protocol.extractModbusRtuResponse(
    Uint8Array.from([0x55, 0xaa, ...response]),
    point()
  )
  assert.equal(complete.kind, 'response')
  assert.deepEqual(Array.from(complete.response.data), [0x42, 0xf6, 0xe9, 0x79])
  const decoded = protocol.decodeModbusValue(point(), complete.response.data)
  assert.ok(Math.abs(Number(decoded.value) - 123.456) < 0.001)

  const swapped = protocol.decodeModbusValue(
    point({ quantity: 1, valueType: 'uint16', byteOrder: 'BADC' }),
    Uint8Array.from([0x34, 0x12])
  )
  assert.equal(swapped.value, '4660')
})

test('RTU 转换器回显请求时跳过回显并继续提取真实响应', () => {
  const echoPoint = point({ addressMode: 'offset', address: 0x0400 })
  const requestEcho = protocol.buildModbusRtuRequest(echoPoint)
  const first = protocol.extractModbusRtuResponse(requestEcho, echoPoint)
  assert.equal(first.kind, 'incomplete')

  const response = appendCrc(Uint8Array.from([1, 3, 4, 0x42, 0xf6, 0xe9, 0x79]))
  const complete = protocol.extractModbusRtuResponse(
    Uint8Array.from([...first.remaining, ...response]),
    echoPoint
  )
  assert.equal(complete.kind, 'response')
  assert.deepEqual(Array.from(complete.response.data), [0x42, 0xf6, 0xe9, 0x79])
})

test('异常帧、CRC 错误和不合法点位均不被当成有效实时值', () => {
  const exception = appendCrc(Uint8Array.from([1, 0x83, 2]))
  const parsed = protocol.parseModbusRtuResponse(exception, point())
  assert.equal(parsed.exceptionCode, 2)
  assert.equal(protocol.modbusExceptionLabel(parsed.exceptionCode), '从站异常 2 · 非法数据地址')

  const crcBroken = Uint8Array.from(exception)
  crcBroken[crcBroken.length - 1] ^= 0x01
  const extracted = protocol.extractModbusRtuResponse(crcBroken, point())
  assert.equal(extracted.kind, 'error')
  assert.equal(extracted.status, 'crc_error')

  assert.throws(
    () => protocol.validateModbusMonitorPoint(point({ functionCode: 1, quantity: 1, valueType: 'int16' })),
    /BOOL 或 RAW_HEX/
  )
  assert.throws(
    () => protocol.validateModbusMonitorPoint(point({ quantity: 1, valueType: 'float32' })),
    /读取数量必须为 2/
  )
  assert.throws(
    () => protocol.validateModbusMonitorPoint(point({ quantity: 2, valueType: 'uint16' })),
    /读取数量必须为 1/
  )
})
