import type { SerialOpenConfig } from '../types/serial'

export function formatSerialFrame(config: SerialOpenConfig): string {
  const dataBits = config.dataBits === 'seven' ? '7' : '8'
  const parity = config.parity === 'odd' ? 'O' : config.parity === 'even' ? 'E' : 'N'
  const stopBits = config.stopBits === 'two' ? '2' : '1'
  return `${dataBits}${parity}${stopBits}`
}

export function formatSerialConfig(config: SerialOpenConfig): string {
  return `${config.baudRate} ${formatSerialFrame(config)}`
}
