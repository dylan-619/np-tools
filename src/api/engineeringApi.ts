import { invoke, Channel } from '@tauri-apps/api/core'
import type { CaseConfig, Delivery, RuntimeSnapshot } from '../types/engineering'
export const samplePointTable = (caseId = 'three-pump-level-control') =>
  invoke<string>('engineering_sample', { caseId })
export const importEngineering = (content: string, fileName: string) =>
  invoke<{ id: string; input: { inputSha256: string } }>('engineering_import', {
    content,
    fileName
  })
export const generateEngineering = (
  workspaceId: string,
  config: CaseConfig,
  requirements: string
) => invoke<Delivery>('engineering_generate', { workspaceId, config, requirements })
export const generateScene = (workspaceId: string) =>
  invoke<{ scene: Delivery['scene']; bindings: Record<string, unknown> }>('engineering_scene', {
    workspaceId
  })
export const deploySimulation = (workspaceId: string) =>
  invoke<{ runId: string; identity: Record<string, unknown> }>('simulation_deploy', { workspaceId })
export const runtimeSnapshot = () => invoke<RuntimeSnapshot>('simulation_snapshot')
export const engineeringHistory = (workspaceId: string) =>
  invoke<string[]>('engineering_history', { workspaceId })
export const selectEngineeringVersion = (workspaceId: string, version: string) =>
  invoke<Delivery>('engineering_select_version', { workspaceId, version })
export const preflightEngineering = () =>
  invoke<{ ready: boolean; python: string; pyyaml: string; compiler: string; platform: string }>(
    'engineering_preflight'
  )
export const cancelEngineering = (workspaceId: string) =>
  invoke('engineering_cancel', { workspaceId })
export const exportEngineering = (workspaceId: string) =>
  invoke<{ saved: boolean; sha256?: string }>('engineering_export', { workspaceId })
export const runtimeAction = (
  workspaceId: string,
  runId: string,
  op: string,
  value: unknown = null
) => invoke<RuntimeSnapshot>('simulation_action', { request: { workspaceId, runId, op, value } })
export const connectOpenCode = (
  baseUrl: string,
  workspaceId: string,
  username?: string,
  password?: string
) =>
  invoke<{
    health: { healthy: boolean; version: string }
    models: Array<{ id: string; name: string }>
    selectedModel: string
  }>('opencode_connect', { baseUrl, workspaceId, username, password })
export const openCodeRequest = <T = unknown>(
  workspaceId: string,
  operation: string,
  body?: unknown,
  sessionId?: string,
  requestId?: string
) =>
  invoke<T>('opencode_request', { request: { workspaceId, operation, sessionId, requestId, body } })
export async function subscribeOpenCode(workspaceId: string, handler: (event: unknown) => void) {
  const onEvent = new Channel<unknown>()
  onEvent.onmessage = handler
  await invoke('opencode_subscribe', { workspaceId, onEvent })
  return onEvent
}

export const restoreEngineering = (workspaceId: string) =>
  invoke<{
    id: string
    content: string
    input: unknown
    delivery: Delivery | null
    hmiReady: boolean
  }>('engineering_restore', { workspaceId })
