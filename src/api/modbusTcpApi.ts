import { invoke } from '@tauri-apps/api/core'
import type { ModbusTcpReadRequest, ModbusTcpReadResponse } from '../types/modbusDebug'

/** 由 Tauri 后端直连 Modbus TCP，浏览器端不参与原始 TCP Socket。 */
export async function modbusTcpRead(
  request: ModbusTcpReadRequest
): Promise<ModbusTcpReadResponse> {
  return await invoke<ModbusTcpReadResponse>('modbus_tcp_read', { request })
}
