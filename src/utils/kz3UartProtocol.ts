import type {
  Kz3ConfigGroup,
  Kz3EthernetCandidate,
  Kz3ProtocolEnvelope,
  Kz3SleCandidate,
  Kz3SystemRole,
} from '../types/kz3Maintenance'

export const KZ3_UART_CONFIG = Object.freeze({
  baudRate: 115200,
  dataBits: 'eight',
  stopBits: 'one',
  parity: 'none',
  flowControl: 'none',
})

export const KZ3_SLE_FIXED_ADDRESS = '0'
export const KZ3_SLE_FIXED_APID = '1'

export const KZ3_QUERY_COMMANDS: Record<Kz3ConfigGroup, string> = {
  system: '@CFG,SYS,SHOW',
  ethernet: '@CFG,ETH,SHOW',
  sle: '@CFG,SLE,SHOW',
  io: '@CFG,IO,SHOW',
  debug: '@DEBUG',
}

const BLOCKED_PREFIXES = [
  '@EEP=0',
  '@CLR_E2P',
  '@CLR_LUA',
  'SN:',
  '@REPORTFREQSEC:',
  '@POC=0',
  '@RTM=0',
  'CLRACCRT',
  '@SET_TS:',
  '@AO1=',
  '@AO2=',
  '@ZIG=',
  'PW_RESET',
  'IP:',
  'ETH_PROT:',
  '@CFG,SHOW',
]

function assertAsciiCommand(command: string): string {
  const normalized = command.trim()
  if (!normalized) throw new Error('命令不能为空')
  if ([...normalized].some((character) => character.charCodeAt(0) > 0x7f)) {
    throw new Error('UART1 命令只能包含 ASCII 字符')
  }
  if (new TextEncoder().encode(normalized).length > 255) {
    throw new Error('UART1 单条有效命令不能超过 255 字节')
  }
  const upper = normalized.toUpperCase()
  if (BLOCKED_PREFIXES.some((prefix) => upper === prefix || upper.startsWith(prefix))) {
    throw new Error('该命令属于退役或高风险入口，已在发送前拦截')
  }
  return normalized
}

function isAllowedCommand(command: string): boolean {
  return (
    Object.values(KZ3_QUERY_COMMANDS).includes(command) ||
    command === '@RST' ||
    command === 'GRN' ||
    command === 'RED' ||
    command === 'OFF' ||
    /^@CFG,SYS,SN,\d{12}$/.test(command) ||
    /^@CFG,ETH,(IP|MASK|GW|PORT),[^,]+$/.test(command) ||
    /^@CFG,ETH,INIT,[^,]+,[^,]+,[^,]+,\d+$/.test(command) ||
    command === `@CFG,SLE,ADDR,${KZ3_SLE_FIXED_ADDRESS}` ||
    command === `@CFG,SLE,APID,${KZ3_SLE_FIXED_APID}` ||
    /^@CFG,SLE,(PWR|MAXPWR|MODE),[^,]+$/.test(command) ||
    command.startsWith('@CFG,SLE,NAME,') ||
    /^@CFG,SLE,INIT,0,[^,]*,1,[^,]+,[^,]+,[^,]+$/.test(command) ||
    command === '@CFG,IO,INIT,CONTROLLER' ||
    /^@CFG,IO,INIT,RTU_SLAVE,\d+$/.test(command) ||
    command === '@DEBUG=0' ||
    command === '@DEBUG=1'
  )
}

export function validateKz3Command(command: string): string {
  const normalized = assertAsciiCommand(command)
  if (!isAllowedCommand(normalized)) {
    throw new Error('命令不在 KZ3 UART1 维护白名单中')
  }
  return normalized
}

function parseIpv4(value: string, fieldName: string): number[] {
  const parts = value.trim().split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error(`${fieldName} 必须是四段十进制 IPv4`)
  }
  const octets = parts.map(Number)
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    throw new Error(`${fieldName} 每段必须在 0~255 范围内`)
  }
  return octets
}

function normalizeIpv4(value: string, fieldName: string): string {
  const octets = parseIpv4(value, fieldName)
  if (octets.every((octet) => octet === 0) || octets.every((octet) => octet === 255)) {
    throw new Error(`${fieldName} 不能是全 0 或全 255 地址`)
  }
  return octets.join('.')
}

function normalizeNetmask(value: string): string {
  const octets = parseIpv4(value, '子网掩码')
  const mask = octets.reduce((result, octet) => result * 256 + octet, 0)
  if (mask === 0) throw new Error('子网掩码不能是全 0')
  const inverse = 0xffffffff - mask
  if ((inverse & (inverse + 1)) !== 0) throw new Error('子网掩码必须是连续掩码')
  return octets.join('.')
}

function normalizeUint(value: string, minimum: number, maximum: number, name: string): string {
  const text = value.trim()
  if (!/^\d+$/.test(text)) throw new Error(`${name} 必须是十进制整数`)
  const parsed = Number(text)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须在 ${minimum}~${maximum} 范围内`)
  }
  return String(parsed)
}

export function buildIdentityCommand(serialNumber: string): string {
  const value = serialNumber.trim()
  if (!/^\d{12}$/.test(value)) throw new Error('SN 必须是 12 位十进制数字')
  const address = Number(value.slice(8))
  if (address < 1 || address > 2047) throw new Error('SN 最后四位设备地址必须在 0001~2047')
  return validateKz3Command(`@CFG,SYS,SN,${value}`)
}

export function buildEthernetCommands(candidate: Kz3EthernetCandidate): string[] {
  const ip = normalizeIpv4(candidate.ip, 'IP')
  const mask = normalizeNetmask(candidate.mask)
  const gateway = normalizeIpv4(candidate.gateway, '网关')
  const port = normalizeUint(candidate.port, 1, 65535, 'HTTP 端口')
  return [
    validateKz3Command(`@CFG,ETH,IP,${ip}`),
    validateKz3Command(`@CFG,ETH,MASK,${mask}`),
    validateKz3Command(`@CFG,ETH,GW,${gateway}`),
    validateKz3Command(`@CFG,ETH,PORT,${port}`),
  ]
}

function normalizeSleName(value: string): string {
  if (value.length > 16) throw new Error('SLE 网络名最长 16 字节')
  if (value.includes(',')) throw new Error('批量初始化的 SLE 网络名不能包含逗号')
  if ([...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 0x21 || code > 0x7e
  })) {
    throw new Error('SLE 网络名只能使用可打印 ASCII 字符，且不能包含空格')
  }
  return value
}

function normalizePower(value: string): string {
  const text = value.trim()
  if (!/^[+-]?\d+$/.test(text)) throw new Error('SLE 发射功率必须是十进制整数')
  const power = Number(text)
  if (power !== 127 && (power < -127 || power > 20)) {
    throw new Error('SLE 发射功率必须在 -127~20，或使用跳过值 127')
  }
  return String(power)
}

export function buildSleInitCommand(candidate: Kz3SleCandidate): string {
  const name = normalizeSleName(candidate.name)
  const power = normalizePower(candidate.power)
  const maxPower = normalizeUint(candidate.maxPower, 1, 8, 'SLE 最大功率')
  const mode = normalizeUint(candidate.mode, 0, 0, 'SLE 工作模式')
  return validateKz3Command(
    `@CFG,SLE,INIT,${KZ3_SLE_FIXED_ADDRESS},${name},${KZ3_SLE_FIXED_APID},${power},${maxPower},${mode}`
  )
}

export function buildRoleCommand(role: Kz3SystemRole, address: string): string {
  if (role === 'CONTROLLER') return '@CFG,IO,INIT,CONTROLLER'
  return validateKz3Command(
    `@CFG,IO,INIT,RTU_SLAVE,${normalizeUint(address, 1, 247, 'RTU 从站地址')}`
  )
}

export function buildDebugCommand(enabled: boolean): string {
  return enabled ? '@DEBUG=1' : '@DEBUG=0'
}

export function buildRebootCommand(): string {
  return validateKz3Command('@RST')
}

export function buildIndicatorCommand(kind: 'GRN' | 'RED' | 'OFF'): string {
  return validateKz3Command(kind)
}

export interface PresetCommandItem {
  name: string
  cmd: string
  description: string
  category: 'query' | 'config' | 'action' | 'led'
  danger?: 'none' | 'low' | 'high'
  confirmPrompt?: string
}

export const KZ3_PRESET_COMMANDS: PresetCommandItem[] = [
  {
    name: '查询生产身份',
    cmd: '@CFG,SYS,SHOW',
    description: '查询 EEPROM 生产身份记录 (12位 SN、产品类型、设备地址、有效性标志)',
    category: 'query',
    danger: 'none',
  },
  {
    name: '查询以太网状态',
    cmd: '@CFG,ETH,SHOW',
    description: '查询 Ethernet 运行值 (RUN) 与保存值 (SAVED)、重启需求及物理网线 Link 状态',
    category: 'query',
    danger: 'none',
  },
  {
    name: '查询星闪无线状态',
    cmd: '@CFG,SLE,SHOW',
    description: '查询 SLE 地址、网络名、发射功率、模组 READY、MAC 及本轮 AT 参数确认状态',
    category: 'query',
    danger: 'none',
  },
  {
    name: '查询系统角色',
    cmd: '@CFG,IO,SHOW',
    description: '查询本次活动角色 (CONTROLLER / RTU_SLAVE) 与 EEPROM 下次启动保存角色',
    category: 'query',
    danger: 'none',
  },
  {
    name: '查询调试日志状态',
    cmd: '@DEBUG',
    description: '查询 UART1 调试日志持久化开关 (@DEBUG=0/1)',
    category: 'query',
    danger: 'none',
  },
  {
    name: '开启调试日志',
    cmd: '@DEBUG=1',
    description: '开启详细调试日志输出并写入 EEPROM',
    category: 'config',
    danger: 'low',
    confirmPrompt: '确定开启 UART1 详细调试日志输出？',
  },
  {
    name: '关闭调试日志',
    cmd: '@DEBUG=0',
    description: '关闭调试日志以保持终端整洁 (OK/ERR 维护回包仍保留)',
    category: 'config',
    danger: 'low',
    confirmPrompt: '确定关闭 UART1 调试日志输出？',
  },
  {
    name: '点亮绿灯 (GRN)',
    cmd: 'GRN',
    description: '点亮控制器面板绿色运行指示灯 (测试硬件通道，不修改持久化配置)',
    category: 'led',
    danger: 'none',
  },
  {
    name: '点亮红灯 (RED)',
    cmd: 'RED',
    description: '点亮控制器面板红色告警指示灯 (测试硬件通道，不修改持久化配置)',
    category: 'led',
    danger: 'none',
  },
  {
    name: '关闭指示灯 (OFF)',
    cmd: 'OFF',
    description: '关闭控制器面板状态指示灯',
    category: 'led',
    danger: 'none',
  },
  {
    name: '安全软件重启 (@RST)',
    cmd: '@RST',
    description: '通知核心任务确认安全输出后执行软件复位；使保存的以太网和系统角色生效',
    category: 'action',
    danger: 'high',
    confirmPrompt: '危险操作：控制器即将安全关断输出并执行软件复位！现场设备将短暂离线，是否继续？',
  },
]

export function getCommandGroup(command: string): Kz3ConfigGroup {
  if (command.startsWith('@CFG,SYS,')) return 'system'
  if (command.startsWith('@CFG,ETH,')) return 'ethernet'
  if (command.startsWith('@CFG,SLE,')) return 'sle'
  if (command.startsWith('@CFG,IO,')) return 'io'
  return 'debug'
}

export function getFollowUpQuery(command: string): string | null {
  if (Object.values(KZ3_QUERY_COMMANDS).includes(command)) return null
  return KZ3_QUERY_COMMANDS[getCommandGroup(command)]
}

function decodeSleName(value: string): string {
  return value.replace(/%2C/gi, ',').replace(/%25/gi, '%')
}

export function parseKz3ProtocolLine(line: string): Kz3ProtocolEnvelope | null {
  const raw = line.trim()
  if (!/^(OK|ERR)(?:,|$)/i.test(raw)) return null
  const segments = raw.split(',')
  const ok = segments[0].toUpperCase() === 'OK'
  const family = segments[1]?.toUpperCase() || (ok ? 'ACK' : 'ERROR')
  const fields: Record<string, string> = {}
  for (const segment of segments.slice(2)) {
    const separator = segment.indexOf('=')
    if (separator <= 0) continue
    const key = segment.slice(0, separator).toUpperCase()
    const value = segment.slice(separator + 1)
    fields[key] = family === 'SLE' && key === 'NAME' ? decodeSleName(value) : value
  }
  return { ok, family, fields, raw }
}

export function isProtocolLine(line: string): boolean {
  return /^(OK|ERR)(?:,|$)/i.test(line.trim())
}

export function snapshotNeedsReboot(fields: Record<string, string>): boolean {
  return fields.REBOOT_REQUIRED === '1'
}

export function sleConfirmationLevel(fields: Record<string, string>): number {
  let level = 0
  if (fields.VALID === '1') level = 1
  if (level === 1 && fields.READY === '1' && fields.MAC_VALID === '1') level = 2
  if (
    level === 2 &&
    fields.CFG_APPLIED === '1' &&
    fields.AT_ADDR === '1' &&
    fields.AT_NAME === '1' &&
    fields.AT_PWR === '1'
  ) level = 3
  return level
}
