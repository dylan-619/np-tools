import { invoke } from '@tauri-apps/api/core'

export interface WorkspaceInfo {
  rootPath: string
  devicesPath: string
}

export interface StoredControllerConfig {
  serialNumber: string
  path: string
  revisionId: string
  importedAtMs: number
  content?: string
}

export async function initializeWorkspace(root: string): Promise<WorkspaceInfo> {
  return await invoke<WorkspaceInfo>('workspace_initialize', { root })
}

export async function storeControllerConfig(
  root: string,
  serialNumber: string,
  content: string
): Promise<StoredControllerConfig> {
  return await invoke<StoredControllerConfig>('workspace_store_controller_config', {
    root,
    serialNumber,
    content,
  })
}

export async function loadControllerConfig(
  root: string,
  serialNumber: string
): Promise<StoredControllerConfig | null> {
  return await invoke<StoredControllerConfig | null>('workspace_load_controller_config', {
    root,
    serialNumber,
  })
}
