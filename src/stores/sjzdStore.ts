import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useSerialStore } from './serialStore'
import {
  sjzdSendSn,
  sjzdSendModbusPoints,
  sjzdSendModbusDebug,
  sjzdSendSlePwr,
  sjzdSendSleMaxPwr,
  sjzdSendSleNetName,
  sjzdSendSleApid,
  sjzdSendWlanBridge,
  sjzdSendRawCommand,
  sjzdParseDevInfo,
  sjzdParseSleComparisons,
  sjzdParseModbusPoints,
  sjzdParseAiSample,
} from '../api/sjzdApi'
import type {
  ModbusPointConfig,
  DeviceInfoResult,
  SleFieldComparison,
  AiSampleDto,
} from '../types/sjzd'

export const useSjzdStore = defineStore('sjzd', () => {
  const serialStore = useSerialStore()

  // State
  const deviceInfo = ref<DeviceInfoResult | null>(null)
  const sleComparisons = ref<SleFieldComparison[]>([])
  const sleForm = ref({
    netName: 'star_RS01',
    apId: 1,
    txPower: 5, // +10 dBm
    maxTxPower: 8, // +20 dBm
  })
  const wlanBridgeEnabled = ref(false)
  const modbusPoints = ref<ModbusPointConfig[]>([
    {
      slaveAddr: 1,
      funcCode: 3,
      regAddr: 40002,
      length: 2,
      dataType: 5, // FLOAT32
      byteOrder: 1, // CDAB
      name: '回路1温度',
      unit: '℃',
    },
    {
      slaveAddr: 1,
      funcCode: 3,
      regAddr: 40010,
      length: 1,
      dataType: 2, // UINT16
      byteOrder: 0, // ABCD
      name: '回路1压力',
      unit: 'kPa',
    },
    {
      slaveAddr: 1,
      funcCode: 1,
      regAddr: 10001,
      length: 1,
      dataType: 6, // BOOL
      byteOrder: 0, // ABCD
      name: '运行指示',
      unit: '',
    },
  ])

  // AI Sampling State
  const isSamplingAi = ref(false)
  const aiHistory = ref<{ timestamp: number; timeStr: string; ai1: number; ai2: number }[]>([])
  const currentAi = ref<AiSampleDto>({ ai1Ma: 0, ai2Ma: 0, timestampMs: Date.now() })

  const reportFreq = ref(3)
  const logLevel = ref(3)
  const isBusy = ref(false)
  const lastOpMessage = ref<{ success: boolean; text: string; time: number } | null>(null)

  // Single Point Debug Logs
  const modbusDebugLogs = ref<{ timestamp: string; text: string }[]>([])

  function showMessage(text: string, success = true) {
    lastOpMessage.value = { success, text, time: Date.now() }
  }

  // Setup stream listener for real-time sample parsing
  serialStore.registerLineListener('sjzd_parser', async (line: string) => {
    // Check for AI Samples: AI1: x.xxx mA, AI2: x.xxx mA
    const sample = await sjzdParseAiSample(line, Date.now())
    if (sample) {
      currentAi.value = sample
      const d = new Date(sample.timestampMs)
      const timeStr = `${d.getMinutes().toString().padStart(2, '0')}:${d
        .getSeconds()
        .toString()
        .padStart(2, '0')}.${Math.floor(d.getMilliseconds() / 100)}`
      aiHistory.value.push({
        timestamp: sample.timestampMs,
        timeStr,
        ai1: sample.ai1Ma,
        ai2: sample.ai2Ma,
      })
      if (aiHistory.value.length > 100) {
        aiHistory.value.shift()
      }
    }

    // Check for DEVINFO responses
    if (line.includes('SN:') || line.includes('DEVINFO') || line.includes('HW:')) {
      const parsed = await sjzdParseDevInfo(line)
      if (parsed.sn || parsed.hwVersion || parsed.fwVersion) {
        deviceInfo.value = {
          sn: parsed.sn || deviceInfo.value?.sn,
          hwVersion: parsed.hwVersion || deviceInfo.value?.hwVersion,
          fwVersion: parsed.fwVersion || deviceInfo.value?.fwVersion,
          bootCount: parsed.bootCount ?? deviceInfo.value?.bootCount,
          uptimeSec: parsed.uptimeSec ?? deviceInfo.value?.uptimeSec,
          rawText: line,
        }
      }
    }

    // Check for SLE:LIST responses
    if (
      line.includes('[EEPROM]') ||
      line.includes('[CHIP]') ||
      line.includes('SLE_NETNAME') ||
      line.includes('SLE:') ||
      line.includes('PWR:') ||
      line.includes('APID:')
    ) {
      const newComparisons = await sjzdParseSleComparisons(line)
      if (newComparisons.length > 0) {
        if (sleComparisons.value.length === 0) {
          sleComparisons.value = newComparisons
        } else {
          for (const nc of newComparisons) {
            const existing = sleComparisons.value.find((c) => c.fieldName === nc.fieldName)
            if (existing) {
              if (nc.eepromVal !== '--') existing.eepromVal = nc.eepromVal
              if (nc.chipVal !== '--') existing.chipVal = nc.chipVal
              existing.isMatched =
                existing.eepromVal === existing.chipVal && existing.eepromVal !== '--'
            } else {
              sleComparisons.value.push(nc)
            }
          }
        }
      }
    }

    // Check for Modbus return list
    if (line.startsWith('RS485DEV:') && line.includes(',')) {
      const pts = await sjzdParseModbusPoints(line)
      if (pts.length > 0) {
        modbusPoints.value = pts
      }
    }

    // Check for Modbus Debug Response or RS485DEV returns
    if (
      line.includes('RS485DEV') ||
      line.includes('MB_RX') ||
      line.includes('MB_TX') ||
      line.includes('DEBUG')
    ) {
      const d = new Date()
      const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d
        .getMinutes()
        .toString()
        .padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
      modbusDebugLogs.value.push({ timestamp: timeStr, text: line })
      if (modbusDebugLogs.value.length > 50) {
        modbusDebugLogs.value.shift()
      }
    }
  })

  // Device Info Actions
  async function queryDeviceInfo() {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    isBusy.value = true
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, 'DEVINFO', false)
      showMessage('已发送设备信息查询指令 (DEVINFO)')
    } catch (e: any) {
      showMessage(`查询失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function burnSn(sn: string) {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    isBusy.value = true
    try {
      const sentText = await sjzdSendSn(serialStore.connectedPort, sn)
      showMessage(`SN 烧录指令 [${sentText}] 已发送，设备将自动复位！`)
    } catch (e: any) {
      showMessage(`SN 烧录失败: ${e}`, false)
      throw e
    } finally {
      isBusy.value = false
    }
  }

  // SLE Actions
  async function querySleConfig() {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    isBusy.value = true
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, 'SLE:LIST', false)
      showMessage('已发送星闪配置查询指令 (SLE:LIST)')
    } catch (e: any) {
      showMessage(`查询星闪配置失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setSleNetName(name: string) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendSleNetName(serialStore.connectedPort, name)
      showMessage(`星闪网络名称已设置为: ${name}`)
    } catch (e: any) {
      showMessage(`设置网络名失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setSleApid(apid: number) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendSleApid(serialStore.connectedPort, apid)
      showMessage(`星闪 AP ID 已设置为: ${apid}`)
    } catch (e: any) {
      showMessage(`设置 AP ID 失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setSlePwr(level: number) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendSlePwr(serialStore.connectedPort, level)
      showMessage(`当前发射功率已设置为档位: ${level}`)
    } catch (e: any) {
      showMessage(`设置发射功率失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setSleMaxPwr(level: number) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendSleMaxPwr(serialStore.connectedPort, level)
      showMessage(`最大发射功率已设置为档位: ${level}`)
    } catch (e: any) {
      showMessage(`设置最大功率失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function applyAllSleConfig() {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    isBusy.value = true
    try {
      showMessage('正在依次下发星闪全套参数...')
      await sjzdSendSleNetName(serialStore.connectedPort, sleForm.value.netName)
      await new Promise((r) => setTimeout(r, 150))
      await sjzdSendSleApid(serialStore.connectedPort, sleForm.value.apId)
      await new Promise((r) => setTimeout(r, 150))
      await sjzdSendSlePwr(serialStore.connectedPort, sleForm.value.txPower)
      await new Promise((r) => setTimeout(r, 150))
      await sjzdSendSleMaxPwr(serialStore.connectedPort, sleForm.value.maxTxPower)
      showMessage('星闪全套参数已批量下发完成！', true)
    } catch (e: any) {
      showMessage(`批量下发星闪参数失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function toggleWlanBridge(enable: boolean) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendWlanBridge(serialStore.connectedPort, enable)
      wlanBridgeEnabled.value = enable
      showMessage(enable ? '已开启星闪透传桥接模式 (@WLAN=1)' : '已关闭星闪透传桥接模式 (@WLAN=0)')
    } catch (e: any) {
      showMessage(`切换透传失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  // Modbus Actions
  async function queryModbusPoints() {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    isBusy.value = true
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, 'RS485DEV:LIST', false)
      showMessage('已发送 Modbus 点位查询指令 (RS485DEV:LIST)')
    } catch (e: any) {
      showMessage(`查询点位失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function saveModbusPoints() {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    isBusy.value = true
    try {
      await sjzdSendModbusPoints(serialStore.connectedPort, modbusPoints.value)
      showMessage(`已下发 ${modbusPoints.value.length} 个点位配置到设备！`)
    } catch (e: any) {
      showMessage(`保存点位失败: ${e}`, false)
      throw e
    } finally {
      isBusy.value = false
    }
  }

  async function debugModbusPoint(pt: ModbusPointConfig) {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    isBusy.value = true
    try {
      await sjzdSendModbusDebug(
        serialStore.connectedPort,
        pt.slaveAddr,
        pt.funcCode,
        pt.regAddr,
        pt.length
      )
      showMessage(`已发送单点调试指令: 从站${pt.slaveAddr}, 寄存器${pt.regAddr}`)
    } catch (e: any) {
      showMessage(`单点调试失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function resetModbusPoints() {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, 'RS485DEV:RESET', false)
      modbusPoints.value = []
      showMessage('已清空 Modbus 点位表 (RS485DEV:RESET)')
    } catch (e: any) {
      showMessage(`清空失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  // Hardware & Dashboard Actions
  async function startAiSampling() {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, 'AITEST', false)
      isSamplingAi.value = true
      showMessage('已启动 4~20mA 模拟量连续采集 (AITEST, 1Hz)')
    } catch (e: any) {
      showMessage(`启动采集失败: ${e}`, false)
    }
  }

  async function stopAiSampling() {
    if (!serialStore.connectedPort || !isSamplingAi.value) return
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, 'TESTSTOP', false)
      isSamplingAi.value = false
      showMessage('已停止模拟量采集 (TESTSTOP)')
    } catch (e: any) {
      console.error(e)
    }
  }

  async function testLed(mode: 'ALLGREEN' | 'ALLRED' | 'ALLOFF') {
    if (!serialStore.connectedPort) return
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, mode, false)
      showMessage(`已下发 LED 指示灯测试: ${mode}`)
    } catch (e: any) {
      showMessage(`测试指令下发失败: ${e}`, false)
    }
  }

  // System Maintenance Actions
  async function setReportFreq(sec: number) {
    if (!serialStore.connectedPort) return
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, `RTFRE:${sec}`, false)
      reportFreq.value = sec
      showMessage(`已设置数据上报周期: ${sec} 秒`)
    } catch (e: any) {
      showMessage(`设置失败: ${e}`, false)
    }
  }

  async function setLogLevel(level: number) {
    if (!serialStore.connectedPort) return
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, `LOGLEVEL:${level}`, false)
      logLevel.value = level
      showMessage(`已设置日志等级: ${level}`)
    } catch (e: any) {
      showMessage(`设置失败: ${e}`, false)
    }
  }

  async function clearPowerCount() {
    if (!serialStore.connectedPort) return
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, '@POC=0', false)
      showMessage('已清零开机次数 (@POC=0)')
    } catch (e: any) {
      showMessage(`清零失败: ${e}`, false)
    }
  }

  async function clearRuntime() {
    if (!serialStore.connectedPort) return
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, '@RTM=0', false)
      showMessage('已清零累计运行时间 (@RTM=0)')
    } catch (e: any) {
      showMessage(`清零失败: ${e}`, false)
    }
  }

  async function resetSystem() {
    if (!serialStore.connectedPort) return
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, '@RST', false)
      showMessage('已触发系统软复位重启 (@RST)')
    } catch (e: any) {
      showMessage(`重启指令失败: ${e}`, false)
    }
  }

  async function clearEeprom() {
    if (!serialStore.connectedPort) return
    try {
      await sjzdSendRawCommand(serialStore.connectedPort, '@EEP=0', false)
      showMessage('已触发 EEPROM 清空 (@EEP=0)，出厂参数已抹除！', false)
    } catch (e: any) {
      showMessage(`清空失败: ${e}`, false)
    }
  }

  return {
    deviceInfo,
    sleComparisons,
    sleForm,
    wlanBridgeEnabled,
    modbusPoints,
    isSamplingAi,
    aiHistory,
    currentAi,
    reportFreq,
    logLevel,
    isBusy,
    lastOpMessage,
    modbusDebugLogs,
    showMessage,
    queryDeviceInfo,
    burnSn,
    querySleConfig,
    setSleNetName,
    setSleApid,
    setSlePwr,
    setSleMaxPwr,
    applyAllSleConfig,
    toggleWlanBridge,
    queryModbusPoints,
    saveModbusPoints,
    debugModbusPoint,
    resetModbusPoints,
    startAiSampling,
    stopAiSampling,
    testLed,
    setReportFreq,
    setLogLevel,
    clearPowerCount,
    clearRuntime,
    resetSystem,
    clearEeprom,
  }
})
