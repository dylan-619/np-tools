import { defineStore } from 'pinia'
import { ref } from 'vue'
import { flashProbeTool, flashStart, flashCancel } from '../api/flashApi'
import type { FlashToolInfo, FlashProgressEvent, FlashLogEntry } from '../types/flash'

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
    .replace(/^\[[=\->\s#█▒░▓■□\.\+]*\]\s*(\d+%)/, '正在传输固件数据进度: $1')
    .trim()
}

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
  const flashLogs = ref<FlashLogEntry[]>([])
  const isProbing = ref(false)
  const errorMsg = ref('')

  let logIdSeq = 0

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
    logIdSeq = 0
    progress.value = {
      state: 'probing',
      percent: 5,
      message: '正在初始化烧录任务...',
      isTerminal: false,
    }
    addLog('正在启动 SWD 固件烧录任务 (Erase + Write + Verify)...', 'cmd')

    try {
      await flashStart(
        toolInfo.value.cliPath,
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
    addLog,
    probeTool,
    startFlashing,
    cancelFlashing,
    clearLogs,
  }
})
