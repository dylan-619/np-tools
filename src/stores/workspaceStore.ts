import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  initializeWorkspace,
  loadControllerConfig,
  storeControllerConfig,
  type StoredControllerConfig,
} from '../api/workspaceApi'

const ROOT_STORAGE_KEY = 'np-tools:workspace-root'

function storedValue(key: string): string {
  return typeof localStorage === 'undefined' ? '' : localStorage.getItem(key) || ''
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const rootPath = ref(storedValue(ROOT_STORAGE_KEY))
  // SN 不跨应用启动保留，避免新一轮调试在尚未识别设备时误归档到上一台设备。
  const activeSerialNumber = ref('')
  const currentConfig = ref<StoredControllerConfig | null>(null)
  const busy = ref(false)
  const lastMessage = ref('')
  const lastMessageSuccess = ref(true)

  const configured = computed(() => rootPath.value.trim().length > 0)
  const readyForArchive = computed(
    () => configured.value && activeSerialNumber.value.trim().length > 0
  )

  function setMessage(message: string, success = true) {
    lastMessage.value = message
    lastMessageSuccess.value = success
  }

  async function setRoot(path: string) {
    const normalized = path.trim()
    if (!normalized) throw new Error('请选择工作空间目录')
    busy.value = true
    try {
      const info = await initializeWorkspace(normalized)
      rootPath.value = info.rootPath
      localStorage.setItem(ROOT_STORAGE_KEY, info.rootPath)
      setMessage(`工作空间已启用：${info.rootPath}`)
      return info
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), false)
      throw error
    } finally {
      busy.value = false
    }
  }

  function setActiveSerialNumber(serialNumber: string) {
    const normalized = serialNumber.trim()
    activeSerialNumber.value = normalized
    currentConfig.value = null
  }

  async function archiveControllerConfig(content: string) {
    if (!configured.value) throw new Error('尚未选择工作空间，配置已载入但未归档')
    if (!activeSerialNumber.value) throw new Error('尚未识别或输入设备 SN，配置已载入但未归档')
    busy.value = true
    try {
      const stored = await storeControllerConfig(
        rootPath.value,
        activeSerialNumber.value,
        content
      )
      currentConfig.value = stored
      setMessage(`配置已归档到设备 ${stored.serialNumber}，版本 ${stored.revisionId}`)
      return stored
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), false)
      throw error
    } finally {
      busy.value = false
    }
  }

  async function loadForSerialNumber(serialNumber: string) {
    const normalized = serialNumber.trim()
    setActiveSerialNumber(normalized)
    if (!configured.value || !normalized) return null
    busy.value = true
    try {
      const stored = await loadControllerConfig(rootPath.value, normalized)
      currentConfig.value = stored
      setMessage(
        stored
          ? `已自动加载设备 ${normalized} 的配置版本 ${stored.revisionId}`
          : `设备 ${normalized} 暂无本地配置`
      )
      return stored
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), false)
      throw error
    } finally {
      busy.value = false
    }
  }

  return {
    rootPath,
    activeSerialNumber,
    currentConfig,
    busy,
    lastMessage,
    lastMessageSuccess,
    configured,
    readyForArchive,
    setRoot,
    setActiveSerialNumber,
    archiveControllerConfig,
    loadForSerialNumber,
  }
})
