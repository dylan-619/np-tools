import type { BoardDef, ProfileDef } from '../types/controllerIo'

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
}
