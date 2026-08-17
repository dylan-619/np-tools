import { defineStore } from 'pinia'
import { ref } from 'vue'
import { flashProbeTool, flashStart, flashCancel } from '../api/flashApi'
import type { FlashToolInfo, FlashProgressEvent } from '../types/flash'

export const useFlashStore = defineStore('flash', () => {
  const toolInfo = ref<FlashToolInfo>({
    isAvailable: false,
    probes: [],
  })

  const customCliPath = ref('')
  const selectedHexPath = ref('')
  const selectedProbeSn = ref('')
  const isFlashing = ref(false)
  const progress = ref<FlashProgressEvent>({
    state: 'idle',
    percent: 0,
    message: '等待准备烧录...',
    isTerminal: true,
  })
  const flashLogs = ref<string[]>([])
  const isProbing = ref(false)
  const errorMsg = ref('')

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

  async function startFlashing() {
    if (!toolInfo.value.cliPath) {
      errorMsg.value = '未找到 STM32_Programmer_CLI 工具，请在设置中配置有效路径！'
      return
    }
    if (!selectedHexPath.value) {
      errorMsg.value = '请先选择需要烧录的 HEX / BIN 固件文件！'
      return
    }

    isFlashing.value = true
    errorMsg.value = ''
    flashLogs.value = []
    progress.value = {
      state: 'probing',
      percent: 5,
      message: '正在初始化烧录任务...',
      isTerminal: false,
    }

    try {
      await flashStart(
        toolInfo.value.cliPath,
        selectedHexPath.value,
        selectedProbeSn.value || undefined,
        (event) => {
          progress.value = event
          flashLogs.value.push(`[${new Date().toLocaleTimeString()}] ${event.message}`)
          if (event.isTerminal) {
            isFlashing.value = false
          }
        }
      )
    } catch (e: any) {
      errorMsg.value = `烧录执行异常: ${e}`
      isFlashing.value = false
      progress.value = {
        state: 'error',
        percent: progress.value.percent,
        message: `错误: ${e}`,
        isTerminal: true,
      }
    }
  }

  async function cancelFlashing() {
    try {
      await flashCancel()
      flashLogs.value.push(`[${new Date().toLocaleTimeString()}] 用户已下发取消指令`)
    } catch (e: any) {
      errorMsg.value = `取消异常: ${e}`
    }
  }

  function clearLogs() {
    flashLogs.value = []
  }

  return {
    toolInfo,
    customCliPath,
    selectedHexPath,
    selectedProbeSn,
    isFlashing,
    progress,
    flashLogs,
    isProbing,
    errorMsg,
    probeTool,
    startFlashing,
    cancelFlashing,
    clearLogs,
  }
})
