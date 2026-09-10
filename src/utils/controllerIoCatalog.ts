import type {
  BoardDef,
  DeviceInstanceConfig,
  ProfileDef,
  ProfileSignalDef,
  ProjectIoDocument,
} from '../types/controllerIo'

export const KZ3_BOARD_DEF: BoardDef = {
  id: 'kz3_f427_standard',
  name: 'KZ3 F427 标准主控板 (12DI + 8DO + 4AI + 2AO)',
  channels: [
    // 12 DI
    ...Array.from({ length: 12 }, (_, i) => {
      const idx = (i + 1).toString().padStart(2, '0')
      return {
        code: `di${idx}`,
        name: `板载输入 DI${i + 1}`,
        type: 'bool' as const,
        direction: 'input' as const,
        driverChannel: i,
        activeLevel: 'low' as const,
        qualification: 'pending' as const,
      }
    }),
    // 8 DO
    ...Array.from({ length: 8 }, (_, i) => {
      const idx = (i + 1).toString().padStart(2, '0')
      return {
        code: `do${idx}`,
        name: `板载输出 DO${i + 1}`,
        type: 'bool' as const,
        direction: 'output' as const,
        driverChannel: i,
        activeLevel: 'high' as const,
        defaultSafeValue: false,
        qualification: 'pending' as const,
      }
    }),
    // 4 AI
    ...Array.from({ length: 4 }, (_, i) => {
      const idx = (i + 1).toString().padStart(2, '0')
      return {
        code: `ai${idx}`,
        name: `板载模拟输入 AI${i + 1} (0..20 mA)`,
        type: 'float' as const,
        direction: 'input' as const,
        driverChannel: i,
        range: '0..20 mA',
        qualification: 'pending' as const,
      }
    }),
    // 2 AO
    ...Array.from({ length: 2 }, (_, i) => {
      const idx = (i + 1).toString().padStart(2, '0')
      return {
        code: `ao${idx}`,
        name: `板载模拟输出 AO${i + 1} (0..20 mA)`,
        type: 'float' as const,
        direction: 'output' as const,
        driverChannel: i,
        range: '0..20 mA',
        defaultSafeValue: 0.0,
        qualification: 'pending' as const,
      }
    }),
  ],
}

export const PROFILE_CATALOG: Record<string, ProfileDef> = {
  sp4055_701: {
    id: 'sp4055_701',
    name: 'SP4055 701 (16DI 扩展模块)',
    description: '16 路数字量输入模块，Modbus RTU FC01 轮询',
    qualification: 'software_qualified',
    inputs: Array.from({ length: 16 }, (_, i) => {
      const idx = (i + 1).toString().padStart(2, '0')
      return {
        code: `di${idx}`,
        name: `输入 DI${i + 1}`,
        type: 'bool',
        direction: 'input',
      }
    }),
    outputs: [],
  },
  sp4055_702: {
    id: 'sp4055_702',
    name: 'SP4055 702 (8DI + 8DO 扩展模块)',
    description: '8 路数字输入 + 8 路数字输出，支持 FC15 写与同地址 FC01 回读影子',
    qualification: 'software_qualified',
    inputs: Array.from({ length: 8 }, (_, i) => {
      const idx = (i + 1).toString().padStart(2, '0')
      return {
        code: `di${idx}`,
        name: `输入 DI${i + 1}`,
        type: 'bool',
        direction: 'input',
      }
    }),
    outputs: Array.from({ length: 8 }, (_, i) => {
      const idx = (i + 1).toString().padStart(2, '0')
      return {
        code: `do${idx}`,
        name: `输出 DO${i + 1}`,
        type: 'bool',
        direction: 'output',
        hasFeedbackShadow: true,
      }
    }),
  },
  sp4055_703: {
    id: 'sp4055_703',
    name: 'SP4055 703 (8DO 扩展模块)',
    description: '8 路数字输出模块，支持 FC15 写与同地址 FC01 回读影子',
    qualification: 'software_qualified',
    inputs: [],
    outputs: Array.from({ length: 8 }, (_, i) => {
      const idx = (i + 1).toString().padStart(2, '0')
      return {
        code: `do${idx}`,
        name: `输出 DO${i + 1}`,
        type: 'bool',
        direction: 'output',
        hasFeedbackShadow: true,
      }
    }),
  },
  sp4055_704: {
    id: 'sp4055_704',
    name: 'SP4055 704 (8AI 模拟量输入模块)',
    description: '8 路模拟量输入，4..20 mA 换算为 4000..20000 µA',
    qualification: 'range_confirmed',
    inputs: Array.from({ length: 8 }, (_, i) => {
      const idx = (i + 1).toString().padStart(2, '0')
      return {
        code: `ai${idx}`,
        name: `模拟量输入 AI${i + 1}`,
        type: 'u16',
        direction: 'input',
        engineeringRange: '4000..20000 µA',
      }
    }),
    outputs: [],
  },
  sp4024_705: {
    id: 'sp4024_705',
    name: 'SP4024 705 (4DI + 4AO 扩展模块)',
    description: '4 路数字输入 + 4 路模拟输出 (0..4095 原始码，FC16 整组写入)',
    qualification: 'software_qualified',
    inputs: Array.from({ length: 4 }, (_, i) => {
      const idx = (i + 1).toString().padStart(2, '0')
      return {
        code: `di${idx}`,
        name: `输入 DI${i + 1}`,
        type: 'bool',
        direction: 'input',
      }
    }),
    outputs: Array.from({ length: 4 }, (_, i) => {
      const idx = (i + 1).toString().padStart(2, '0')
      return {
        code: `ao${idx}`,
        name: `模拟输出 AO${i + 1}`,
        type: 'u16',
        direction: 'output',
        engineeringRange: '原始码 0..4095',
        hasFeedbackShadow: true,
      }
    }),
  },
  et703: {
    id: 'et703',
    name: 'ET703 三相电力测控仪',
    description:
      '第三方 Modbus RTU 电力仪表；当前工程通过 FC03 读取 21 个 F32 电压、电流与功率量。',
    qualification: 'software_qualified',
    deviceClass: 'third_party',
    presentation: 'dataset',
    definitionSource: 'builtin',
    inputs: [
      ['phase_a_voltage', 'A 相电压', 'V'],
      ['phase_b_voltage', 'B 相电压', 'V'],
      ['phase_c_voltage', 'C 相电压', 'V'],
      ['line_ab_voltage', 'AB 线电压', 'V'],
      ['line_bc_voltage', 'BC 线电压', 'V'],
      ['line_ca_voltage', 'CA 线电压', 'V'],
      ['phase_a_current', 'A 相电流', 'A'],
      ['phase_b_current', 'B 相电流', 'A'],
      ['phase_c_current', 'C 相电流', 'A'],
      ['total_active_power', '三相有功总功率', 'kW'],
      ['phase_a_active_power', 'A 相有功功率', 'kW'],
      ['phase_b_active_power', 'B 相有功功率', 'kW'],
      ['phase_c_active_power', 'C 相有功功率', 'kW'],
      ['total_reactive_power', '三相无功总功率', 'kvar'],
      ['phase_a_reactive_power', 'A 相无功功率', 'kvar'],
      ['phase_b_reactive_power', 'B 相无功功率', 'kvar'],
      ['phase_c_reactive_power', 'C 相无功功率', 'kvar'],
      ['total_apparent_power', '三相总视在功率', 'kVA'],
      ['phase_a_apparent_power', 'A 相视在功率', 'kVA'],
      ['phase_b_apparent_power', 'B 相视在功率', 'kVA'],
      ['phase_c_apparent_power', 'C 相视在功率', 'kVA'],
    ].map(([code, name, unit]) => ({
      code,
      name,
      unit,
      type: 'float',
      direction: 'input',
    } as ProfileSignalDef)),
    outputs: [],
  },
}

function inferredSignalType(
  document: ProjectIoDocument,
  pointName: string | undefined,
  code: string,
): ProfileSignalDef['type'] {
  const field = pointName
    ? document.project.northbound.fields.find((item) => item.bind === `point.${pointName}`)
    : undefined
  if (field?.c_type === 'float') return 'float'
  if (field?.c_type === 'u16') return 'u16'
  return /^(di|do)/i.test(code) ? 'bool' : /^(ai|ao)/i.test(code) ? 'u16' : 'float'
}

/**
 * 返回设备的可视化 Profile。已知产品使用固化目录；未知第三方产品仅从
 * project_io.yaml 的 use/points/northbound 派生已声明信号，不伪造 Profile 中未上传的协议事实。
 */
export function resolveDeviceProfile(
  document: ProjectIoDocument,
  device: DeviceInstanceConfig,
): ProfileDef {
  const known = PROFILE_CATALOG[device.profile]
  if (known) return known

  const prefix = `rtu.${device.name}.`
  const inputCodes = new Set(device.use.inputs || [])
  const outputCodes = new Set(Object.keys(device.use.outputs || {}))
  const points = [...document.project.points.inputs, ...document.project.points.outputs]
  const pointByCode = new Map<string, (typeof points)[number]>()

  for (const point of points) {
    if (!point.source.startsWith(prefix)) continue
    const code = point.source.slice(prefix.length)
    if (!code || code.includes('.')) continue
    pointByCode.set(code, point)
    if (document.project.points.outputs.includes(point)) outputCodes.add(code)
    else inputCodes.add(code)
  }

  const makeSignal = (
    code: string,
    direction: ProfileSignalDef['direction'],
  ): ProfileSignalDef => {
    const point = pointByCode.get(code)
    return {
      code,
      name: point?.description || point?.name || code,
      description: point?.description,
      type: inferredSignalType(document, point?.name, code),
      direction,
    }
  }

  return {
    id: device.profile,
    name: `${device.profile} 第三方自定义产品`,
    description:
      '工具未内置该 Profile 的完整协议字典；当前仅展示 project_io.yaml 已选用并绑定的信号。',
    qualification: 'pending',
    deviceClass: 'third_party',
    presentation: 'dataset',
    definitionSource: 'project',
    inputs: [...inputCodes].sort().map((code) => makeSignal(code, 'input')),
    outputs: [...outputCodes].sort().map((code) => makeSignal(code, 'output')),
  }
}
