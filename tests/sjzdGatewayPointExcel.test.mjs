import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom'
})
after(() => server.close())

const { buildSjzdGatewayAcquisitionPointRows, buildSjzdGatewayPointExcelFileName } =
  await server.ssrLoadModule('/src/utils/sjzdGatewayPointExcel.ts')

function point(overrides = {}) {
  return {
    slaveAddr: 1,
    funcCode: 3,
    regAddr: 40001,
    length: 2,
    dataType: 5,
    byteOrder: 1,
    ...overrides
  }
}

test('终端点位导出保留 PLC 地址并生成与固件 JSON 一致的组合键', () => {
  const rows = buildSjzdGatewayAcquisitionPointRows(
    [point(), point({ slaveAddr: 2, regAddr: 1, length: 1, dataType: 2, byteOrder: 0 })],
    '020325090117'
  )

  assert.deepEqual(
    rows.map((row) => [row.pointName, row.address, row.slaveId, row.functionCode, row.dataType]),
    [
      ['MB_1_40001', '40001', 1, 3, 'FLOAT'],
      ['MB_2_1', '1', 2, 3, 'UINT16']
    ]
  )
  assert.equal(rows[0].groupName, 'SJZDV3-020325090117')
  assert.equal(rows[0].collectInterval, 0)
  assert.equal(rows[0].readWriteAccess, 'R')
  assert.match(rows[0].remark, /终端上报键：1_40001/)
  assert.match(rows[0].remark, /CDAB/)
})

test('终端点位导出严格映射数据类型并保留可选工程名称', () => {
  const rows = buildSjzdGatewayAcquisitionPointRows([
    point({ regAddr: 40001, length: 1, dataType: 1, byteOrder: 0 }),
    point({ regAddr: 40002, length: 1, dataType: 2, byteOrder: 0 }),
    point({ regAddr: 40003, dataType: 3, byteOrder: 0 }),
    point({ regAddr: 40005, dataType: 4, byteOrder: 0 }),
    point({ regAddr: 40007, dataType: 5, byteOrder: 0, name: '进水流量', unit: 'm³/h' }),
    point({ funcCode: 1, regAddr: 10001, length: 1, dataType: 6, byteOrder: 0 })
  ])

  assert.deepEqual(
    rows.map((row) => row.dataType),
    ['INT16', 'UINT16', 'INT32', 'UINT32', 'FLOAT', 'BOOLEAN']
  )
  assert.equal(rows[4].pointName, '进水流量')
  assert.equal(rows[4].unit, 'm³/h')
  assert.equal(rows[5].address, '10001')
  assert.equal(rows[5].functionCode, 1)
})

test('终端点位导出拒绝 RAW_HEX、类型功能码冲突和重复上报键', () => {
  assert.throws(() => buildSjzdGatewayAcquisitionPointRows([point({ dataType: 0 })]), /RAW_HEX/)
  assert.throws(
    () => buildSjzdGatewayAcquisitionPointRows([point({ funcCode: 1, dataType: 2 })]),
    /数据类型 UINT16 与功能码 1 不匹配/
  )
  assert.throws(
    () =>
      buildSjzdGatewayAcquisitionPointRows([
        point(),
        point({ funcCode: 4, dataType: 3, byteOrder: 0 })
      ]),
    /重复的终端上报键 1_40001/
  )
})

test('终端网关 Excel 文件名使用 SN 并固定 xlsx 后缀', () => {
  assert.equal(
    buildSjzdGatewayPointExcelFileName('SJZD/0203', new Date(2026, 8, 10, 9, 8, 7)),
    'SJZD_0203_网关采集点_终端Modbus_20260910_090807.xlsx'
  )
})
