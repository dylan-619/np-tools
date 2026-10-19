import { RS485_BAUD_RATES, type Rs485BaudRate, type Rs485BaudResponse } from '../types/sjzd'

function baudRate(value: string | undefined): Rs485BaudRate | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const baud = Number(value)
  return RS485_BAUD_RATES.includes(baud as Rs485BaudRate) ? baud as Rs485BaudRate : undefined
}

export function buildRs485BaudCommand(baud: number | 'DEFAULT'): string {
  if (baud === 'DEFAULT') return 'RS485:BAUD:DEFAULT'
  if (baudRate(String(baud)) === undefined) throw new Error('不支持的采集波特率')
  return `RS485:BAUD:${baud}`
}

/** 仅采纳完整的 RS485 单行回执，不从点表、DEBUG 或普通运行日志猜测值。 */
export function parseRs485BaudResponse(line: string): Rs485BaudResponse | undefined {
  const match = line.trim().match(/^RS485:(CONFIG|SAVED|ERROR),(.+)$/)
  if (!match) return undefined
  const fields: Record<string, string> = {}
  for (const part of match[2].split(',')) {
    const field = part.match(/^([a-z_]+)=([A-Z0-9_]+)$/)
    if (!field || Object.prototype.hasOwnProperty.call(fields, field[1])) return undefined
    fields[field[1]] = field[2]
  }
  const event = match[1] as Rs485BaudResponse['event']
  if (fields.status !== 'OK' && fields.status !== 'ERROR') return undefined
  if (fields.status === 'ERROR' && !fields.code) return undefined
  if (fields.status === 'OK' && fields.code) return undefined
  const active = fields.active_baud === 'UNKNOWN' ? 'UNKNOWN' : baudRate(fields.active_baud)
  const saved = ['UNSET', 'INVALID', 'UNKNOWN'].includes(fields.saved_baud)
    ? fields.saved_baud as 'UNSET' | 'INVALID' | 'UNKNOWN' : baudRate(fields.saved_baud)
  const pending = fields.pending_restart
  if (active === undefined || saved === undefined || !['YES', 'NO', 'UNKNOWN'].includes(pending)) return undefined
  if (event === 'ERROR') {
    if (fields.status !== 'ERROR' || saved !== 'UNKNOWN' || pending !== 'UNKNOWN') return undefined
  } else {
    if (event === 'CONFIG' && fields.default_baud !== '9600') return undefined
    if (event === 'SAVED' && (fields.status !== 'OK' || typeof saved !== 'number')) return undefined
    const target = typeof saved === 'number' ? saved : 9600
    const expectedPending = active === 'UNKNOWN' || saved === 'UNKNOWN' ? 'UNKNOWN' : active === target ? 'NO' : 'YES'
    if (pending !== expectedPending) return undefined
    if (fields.status === 'OK' && event === 'CONFIG' && (active === 'UNKNOWN' || saved === 'UNKNOWN' || saved === 'INVALID')) return undefined
  }
  return { event, status: fields.status, activeBaud: active, savedBaud: saved,
    pendingRestart: pending as Rs485BaudResponse['pendingRestart'], code: fields.code }
}
