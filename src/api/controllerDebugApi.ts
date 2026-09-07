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
