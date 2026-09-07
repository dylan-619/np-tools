import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  flashCancel,
  flashInspectImage,
  flashListProductProfiles,
  flashProbeTarget,
  flashProbeTool,
  flashStart,
} from '../api/flashApi'
import type {
  FlashImageInspection,
  FlashLogEntry,
  FlashProductProfile,
  FlashProgressEvent,
  FlashTargetInfo,
  FlashToolInfo,
} from '../types/flash'

const CLI_PATH_STORAGE_KEY = 'np_tools_flash_cli_path'
const DEFAULT_PROFILE_ID = 'sjzdv3_f412'

function loadPersistedCliPath(): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(CLI_PATH_STORAGE_KEY) || ''
}

function parseLogType(text: string): FlashLogEntry['type'] {
  const lower = text.toLowerCase()
  if (text.startsWith('>') || text.startsWith('$') || text.startsWith('[产线流水线]')) {
    return 'cmd'
  }
  if (
    lower.includes('error') ||
    lower.includes('st-link error') ||
    lower.includes('failed') ||
    text.includes('失败') ||
    text.includes('错误')
  ) {
    return 'error'
  }
  if (
    lower.includes('download verified successfully') ||
    lower.includes('application is running') ||
    lower.includes('complete') ||
    text.includes('成功')
  ) {
    return 'success'
  }
  if (lower.includes('warn') || text.includes('警告') || text.includes('取消')) {
    return 'warn'
  }
  if (
    text.includes('STM32CubeProgrammer') ||
    text.includes('ST-LINK Probe') ||
    text.startsWith('===') ||
    text.startsWith('---')
  ) {
    return 'header'
  }
  return 'info'
}

function cleanLogText(raw: string): string {
  if (!raw) return ''
  return raw
    // Remove ANSI escape sequences
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    // Remove non-printable control chars except tab
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Clean progress bar chars
    .replace(/\[[=\->\s#█▒░▓■□\.\+\u{FFFD}]*\]\s*(\d+%)/u, '正在传输固件数据进度: $1')
    .trim()
}

export const useFlashStore = defineStore('flash', () => {
  const toolInfo = ref<FlashToolInfo>({
    isAvailable: false,
    probes: [],
  })

  const customCliPath = ref(loadPersistedCliPath())
  const productProfiles = ref<FlashProductProfile[]>([])
  const selectedProfileId = ref(DEFAULT_PROFILE_ID)
  const selectedHexPath = ref('')
  const selectedProbeSn = ref('')
  const imageInspection = ref<FlashImageInspection | null>(null)
  const targetInfo = ref<FlashTargetInfo | null>(null)
  const isInspectingImage = ref(false)
  const isProbingTarget = ref(false)
  const isFlashing = ref(false)
  const progress = ref<FlashProgressEvent>({
    state: 'idle',
    percent: 0,
    message: '等待准备烧录...',
    isTerminal: true,
  })
  const flashLogs = ref<FlashLogEntry[]>([])
  const isProbing = ref(false)
  const errorMsg = ref('')

  const selectedProfile = computed(() =>
    productProfiles.value.find((profile) => profile.id === selectedProfileId.value)
  )
  const isImageValidated = computed(
    () => imageInspection.value?.validated === true && imageInspection.value.profileId === selectedProfileId.value
  )
  const canStartFlashing = computed(
    () => Boolean(toolInfo.value.isAvailable && selectedProfile.value && selectedHexPath.value && isImageValidated.value)
  )

  let logIdSeq = 0

  watch([selectedHexPath, selectedProfileId], () => {
    imageInspection.value = null
    targetInfo.value = null
  })

  watch(selectedProbeSn, () => {
    targetInfo.value = null
  })

  function addLog(text: string, forceType?: FlashLogEntry['type']) {
    const cleaned = cleanLogText(text)
    if (!cleaned) return
    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    const type = forceType || parseLogType(cleaned)
    flashLogs.value.push({
      id: ++logIdSeq,
      time,
      text: cleaned,
      type,
    })
  }

  async function probeTool(customPath?: string) {
    isProbing.value = true
    errorMsg.value = ''
    try {
      const info = await flashProbeTool(customPath || customCliPath.value || undefined)
      toolInfo.value = info
      if (info.probes.length > 0 && !selectedProbeSn.value) {
        selectedProbeSn.value = info.probes[0].serialNumber
      }
    } catch (e: any) {
      errorMsg.value = `探测烧录工具失败: ${e}`
    } finally {
      isProbing.value = false
    }
  }

  async function loadProductProfiles() {
    try {
      const profiles = await flashListProductProfiles()
      productProfiles.value = profiles
      if (!profiles.some((profile) => profile.id === selectedProfileId.value)) {
        selectedProfileId.value = profiles[0]?.id || ''
      }
    } catch (e: any) {
      errorMsg.value = `读取烧录产品档案失败: ${e}`
    }
  }

  async function inspectSelectedImage(): Promise<FlashImageInspection | null> {
    if (!selectedProfileId.value) {
      errorMsg.value = '请先选择烧录产品档案！'
      return null
    }
    if (!selectedHexPath.value) {
      errorMsg.value = '请先选择带地址的 Intel HEX 固件文件！'
      return null
    }

    isInspectingImage.value = true
    errorMsg.value = ''
    imageInspection.value = null
    try {
      const inspection = await flashInspectImage(selectedProfileId.value, selectedHexPath.value)
      imageInspection.value = inspection
      addLog(`[镜像审查] ${inspection.message}`, 'success')
      return inspection
    } catch (e: any) {
      errorMsg.value = `镜像审查未通过: ${e}`
      addLog(`[镜像审查] 拒绝：${e}`, 'error')
      return null
    } finally {
      isInspectingImage.value = false
    }
  }

  async function probeSelectedTarget(): Promise<FlashTargetInfo | null> {
    if (!toolInfo.value.cliPath) {
      errorMsg.value = '未找到 STM32_Programmer_CLI 工具，请先完成工具检测！'
      return null
    }
    if (!selectedProfileId.value) {
      errorMsg.value = '请先选择烧录产品档案！'
      return null
    }

    isProbingTarget.value = true
    errorMsg.value = ''
    targetInfo.value = null
    try {
      const target = await flashProbeTarget(
        toolInfo.value.cliPath,
        selectedProfileId.value,
        selectedProbeSn.value || undefined
      )
      targetInfo.value = target
      addLog(`[目标核验] ${target.message}`, target.isCompatible ? 'success' : 'error')
      if (!target.isCompatible) {
        errorMsg.value = target.message
      }
      return target
    } catch (e: any) {
      errorMsg.value = `目标 MCU 核验失败: ${e}`
      addLog(`[目标核验] 失败：${e}`, 'error')
      return null
    } finally {
      isProbingTarget.value = false
    }
  }

  async function startFlashing() {
    if (!toolInfo.value.cliPath) {
      errorMsg.value = '未找到 STM32_Programmer_CLI 工具，请在设置中配置有效路径！'
      return
    }
    if (!selectedHexPath.value) {
      errorMsg.value = '请先选择需要烧录的 Intel HEX 固件文件！'
      return
    }
    if (!selectedProfile.value) {
      errorMsg.value = '请先选择烧录产品档案！'
      return
    }

    const inspection = await inspectSelectedImage()
    if (!inspection) return
    const target = await probeSelectedTarget()
    if (!target?.isCompatible) return

    isFlashing.value = true
    errorMsg.value = ''
    flashLogs.value = []
    logIdSeq = 0
    progress.value = {
      state: 'probing',
      percent: 5,
      message: '正在初始化烧录任务...',
      isTerminal: false,
    }
    addLog(`正在启动 ${selectedProfile.value.label} 的 SWD 烧录任务 (Write + Verify)...`, 'cmd')

    try {
      await flashStart(
        toolInfo.value.cliPath,
        selectedProfileId.value,
        selectedHexPath.value,
        selectedProbeSn.value || undefined,
        (event) => {
          progress.value = event
          addLog(event.message)
          if (event.isTerminal) {
            isFlashing.value = false
          }
        }
      )
    } catch (e: any) {
      errorMsg.value = `烧录执行异常: ${e}`
      addLog(`烧录执行异常: ${e}`, 'error')
      progress.value = {
        state: 'error',
        percent: progress.value.percent,
        message: `错误: ${e}`,
        isTerminal: true,
      }
    } finally {
      isFlashing.value = false
    }
  }

  async function cancelFlashing() {
    try {
      await flashCancel()
      addLog('用户已下发取消指令', 'warn')
    } catch (e: any) {
      errorMsg.value = `取消异常: ${e}`
      addLog(`取消异常: ${e}`, 'error')
    } finally {
      isFlashing.value = false
    }
  }

  function clearLogs() {
    flashLogs.value = []
  }

  function persistCustomCliPath() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(CLI_PATH_STORAGE_KEY, customCliPath.value)
  }

  return {
    toolInfo,
    customCliPath,
    productProfiles,
    selectedProfileId,
    selectedProfile,
    selectedHexPath,
    selectedProbeSn,
    imageInspection,
    targetInfo,
    isInspectingImage,
    isProbingTarget,
    isImageValidated,
    canStartFlashing,
    isFlashing,
    progress,
    flashLogs,
    isProbing,
    errorMsg,
    addLog,
    probeTool,
    loadProductProfiles,
    inspectSelectedImage,
    probeSelectedTarget,
    startFlashing,
    cancelFlashing,
    clearLogs,
    persistCustomCliPath,
  }
})
