import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import type { GatewayAcquisitionPointRow } from '../utils/gatewayPointExcel'

export type GatewayPointExportProfile = 'kz3Northbound' | 'sjzdPush'

export async function exportGatewayPointsXlsx(
  defaultName: string,
  rows: GatewayAcquisitionPointRow[],
  profile: GatewayPointExportProfile = 'kz3Northbound'
): Promise<string | null> {
  const targetPath = await save({
    title: '导出网关采集点 Excel',
    defaultPath: defaultName,
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
  })
  if (!targetPath) return null

  return await invoke<string>('gateway_points_export_xlsx', { targetPath, rows, profile })
}
