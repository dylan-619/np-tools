import { invoke } from '@tauri-apps/api/core'
import type { Kz3HttpResponse, Kz3Scalar } from '../types/controllerDebug'

export type DiagnosticResource =
  | 'device'
  | 'hardware'
  | 'project'
  | 'network'
  | 'sle'
  | 'io'
  | 'config'
  | 'services'
  | 'health'

export async function kz3GetDiagnostic(
  baseUrl: string,
  resource: DiagnosticResource
): Promise<Kz3HttpResponse> {
  return await invoke<Kz3HttpResponse>('kz3_http_get_diagnostic', { baseUrl, resource })
}

export async function kz3GetPoint(baseUrl: string, pointName: string): Promise<Kz3HttpResponse> {
  return await invoke<Kz3HttpResponse>('kz3_http_get_point', { baseUrl, pointName })
}

export async function kz3GetPointsPage(
  baseUrl: string,
  offset: number,
  limit: number
): Promise<Kz3HttpResponse> {
  return await invoke<Kz3HttpResponse>('kz3_http_get_points_page', { baseUrl, offset, limit })
}

export async function kz3WritePoint(
  baseUrl: string,
  pointName: string,
  binding: string,
  value: Kz3Scalar
): Promise<Kz3HttpResponse> {
  return await invoke<Kz3HttpResponse>('kz3_http_write_point', {
    baseUrl,
    pointName,
    binding,
    value
  })
}

/** 会话外info/status/info1，只读；不继承或接管升级会话。 */
export async function kz3GetOtaState(baseUrl: string): Promise<{
  info: { sn: string; board_type: string; ota_protocol: number; phase: number; flags: number }
  status: { state: number; phase: number; flags: number; active: string; candidate: string; error: number }
  identity: { present: number; project_id: string; project_version: string; revision: number; package_id: string }
}> {
  return await invoke('kz3_http_get_ota_state', { baseUrl })
}
