import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
})
after(() => server.close())

const mqtt = await server.ssrLoadModule('/src/utils/mqttValidation.ts')

test('MQTT 发布 Topic 拒绝通配符，订阅 Topic 仅接受独立通配符层级', () => {
  assert.equal(mqtt.validateMqttTopic('devices/+/up', true), undefined)
  assert.equal(mqtt.validateMqttTopic('devices/#', true), undefined)
  assert.match(mqtt.validateMqttTopic('devices/a#', true) || '', /#/)
  assert.match(mqtt.validateMqttTopic('devices/a+b/up', true) || '', /\+/)
  assert.match(mqtt.validateMqttTopic('devices/+/up', false) || '', /通配符/)
})

test('MQTT 公共调试不允许用设备 SN 作为 Client ID，且 payload 按 UTF-8 字节计数', () => {
  assert.match(mqtt.validateClientId('020325090118') || '', /设备 SN/)
  assert.equal(mqtt.validateClientId('np-tools-mqtt-1'), undefined)
  assert.equal(mqtt.payloadByteLength('中文'), 6)
  assert.equal(mqtt.validatePayload('a'.repeat(1024)), undefined)
  assert.match(mqtt.validatePayload('a'.repeat(1025)) || '', /1024 B/)
})

test('KZ3 下行信封校验元数据；兼容模式允许完整省略 _meta', () => {
  const valid = JSON.stringify({
    _meta: { boot_id: 123456, request_id: 1001, ttl_ms: 5000 },
    func_code: 2,
    data: { 'command.board_do01_start': true },
  })
  assert.equal(mqtt.validateKz3DownlinkEnvelope(valid, 123456), undefined)
  assert.match(
    mqtt.validateKz3DownlinkEnvelope(
      JSON.stringify({ _meta: { boot_id: 0, request_id: 1001, ttl_ms: 5000 }, func_code: 2, data: { x: true } }),
      123456
    ) || '',
    /boot_id/
  )
  assert.match(
    mqtt.validateKz3DownlinkEnvelope(
      JSON.stringify({ _meta: { boot_id: 1, request_id: 2, ttl_ms: 5000 }, func_code: 2, data: {} }),
      1
    ) || '',
    /data/
  )
  assert.match(mqtt.validateKz3DownlinkEnvelope(valid) || '', /30 秒/)
  assert.equal(
    mqtt.validateKz3DownlinkEnvelope(
      JSON.stringify({ func_code: 2, data: { 'command.board_do01_stop': true } })
    ),
    undefined,
    '兼容旧平台时可完整省略 _meta'
  )
})
