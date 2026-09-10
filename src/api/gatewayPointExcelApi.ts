import { invoke } from '@tauri-apps/api/core'
import type { GatewayAcquisitionPointRow } from '../utils/gatewayPointExcel'

export type GatewayPointExportProfile = 'kz3Northbound' | 'sjzdPush'

export async function exportGatewayPointsXlsx(
  defaultName: string,
  rows: GatewayAcquisitionPointRow[],
  profile: GatewayPointExportProfile = 'kz3Northbound'
): Promise<string | null> {
  return await invoke<string | null>('gateway_points_export_xlsx', { defaultName, rows, profile })
}
