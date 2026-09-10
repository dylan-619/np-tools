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

const {
  GATEWAY_POINT_EXCEL_HEADERS,
  buildGatewayAcquisitionPointRows,
  buildGatewayPointExcelFileName
} = await server.ssrLoadModule('/src/utils/gatewayPointExcel.ts')

function project(fields) {
  return {
    name: 'KZ3 测试控制器',
    id: 'kz3_test',
    version: '1.0.0',
    board: 'kz3_f427_standard',
    required_profiles: [],
    scan_period_ms: 10,
    features: { pid: false, counter: false, retained: false },
    rs485_ports: {},
    devices: [],
    points: {
      inputs: [
        {
          id: 'p-di',
          name: 'alarm_input',
          source: 'board.di01',
          description: '现场报警输入'
        }
      ],
      outputs: []
    },
    application_variables: {
      parameters: [
        {
          id: 'p-setpoint',
          name: 'setpoint',
          c_type: 'u32',
          default: 0,
          unit: 'ms',
          description: '延时设定值'
        }
      ],
      commands: [],
      states: []
    },
    pids: [],
    logic_blocks: {
      timers: [],
      edges: [],
      counters: [],
      latches: [],
      debounces: [],
      filters: [],
      rate_limits: []
    },
    northbound: {
      protocols: ['modbus_tcp'],
      modbus_tcp: { address_style: 'modicon_5_digit', word_order_32: 'abcd' },
      fields
    }
  }
}

function field(overrides) {
  return {
    id: overrides.name,
    bind: `point.${overrides.name}`,
    access: 'read',
    description: '',
    ...overrides
  }
}

test('网关 Excel 使用固定 14 列契约，并严格映射四个 Modbus 地址区', () => {
  assert.deepEqual(
    [...GATEWAY_POINT_EXCEL_HEADERS],
    [
      'ID',
      '数据分组',
      '点位名称',
      '点位标签',
      '地址',
      '数据类型',
      '单位',
      '采集间隔(ms)',
      '从站地址',
      '功能码',
      '启用状态',
      '备注',
      '节点说明',
      '读写权限'
    ]
  )

  const rows = buildGatewayAcquisitionPointRows(
    project([
      field({
        name: 'coil_command',
        bind: 'command.coil_command',
        c_type: 'bool',
        access: 'read_write',
        reference: '1'
      }),
      field({
        name: 'alarm_input',
        c_type: 'bool',
        reference: '10001'
      }),
      field({
        name: 'process_value',
        bind: 'state.process_value',
        c_type: 'float',
        reference: '30001',
        description: '过程测量值'
      }),
      field({
        name: 'setpoint',
        bind: 'parameter.setpoint',
        c_type: 'u32',
        access: 'read_write',
        reference: '40001'
      })
    ])
  )

  assert.deepEqual(
    rows.map((row) => [row.address, row.dataType, row.functionCode, row.readWriteAccess]),
    [
      ['00001', 'BOOLEAN', 1, 'R/W'],
      ['10001', 'BOOLEAN', 2, 'R'],
      ['30001', 'FLOAT', 4, 'R'],
      ['40001', 'UINT32', 3, 'R/W']
    ]
  )
  assert.equal(rows[0].slaveId, 1)
  assert.equal(rows[0].collectInterval, 1000)
  assert.equal(rows[0].pointName, 'coil_command')
  assert.equal(rows[0].pointTag, 'coil_command')
  assert.equal(rows[1].description, '现场报警输入')
  assert.equal(rows[2].description, '过程测量值')
  assert.equal(rows[3].unit, 'ms')
  assert.match(rows[3].remark, /32 位字序：ABCD/)
})

test('网关 Excel 在导出前拒绝类型、权限和地址占用冲突', () => {
  assert.throws(
    () =>
      buildGatewayAcquisitionPointRows(
        project([field({ name: 'bad_boolean', c_type: 'bool', reference: '40001' })])
      ),
    /数据类型 BOOL 与地址 40001 不匹配/
  )

  assert.throws(
    () =>
      buildGatewayAcquisitionPointRows(
        project([
          field({
            name: 'bad_write',
            bind: 'parameter.bad_write',
            c_type: 'u16',
            access: 'read_write',
            reference: '30001'
          })
        ])
      ),
    /只读地址区/
  )

  assert.throws(
    () =>
      buildGatewayAcquisitionPointRows(
        project([
          field({ name: 'wide_value', c_type: 'float', reference: '40001' }),
          field({ name: 'overlap_value', c_type: 'u16', reference: '40002' })
        ])
      ),
    /Modbus 地址范围重叠/
  )
})

test('网关 Excel 文件名固定使用 xlsx 后缀并清理非法字符', () => {
  const value = project([])
  value.name = 'KZ3/测试:设备'
  assert.equal(
    buildGatewayPointExcelFileName(value, new Date(2026, 8, 10, 9, 8, 7)),
    'KZ3_测试_设备_网关采集点_ModbusTCP_20260910_090807.xlsx'
  )
})
