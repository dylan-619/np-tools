import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
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
} from '../api/sjzdApi'
import type {
  ModbusPointConfig,
  DeviceInfoResult,
  SleFieldComparison,
  SleCurrentStatus,
  AiSampleDto,
} from '../types/sjzd'

export const useSjzdStore = defineStore('sjzd', () => {
  const serialStore = useSerialStore()

  // State
  const deviceInfo = ref<DeviceInfoResult | null>(null)
  const sleComparisons = ref<SleFieldComparison[]>([])
  const sleCurrentStatus = ref<SleCurrentStatus>({})
  const sleForm = ref({
    netName: 'star_RS01',
    apId: 1,
    txPower: 5, // +10 dBm
    maxTxPower: 8, // +20 dBm
  })
  const wlanBridgeEnabled = ref(false)
  const modbusPoints = ref<ModbusPointConfig[]>([])

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

  function appendModbusDebugLog(text: string) {
    const d = new Date()
    const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
    modbusDebugLogs.value.push({ timestamp: timeStr, text })
    if (modbusDebugLogs.value.length > 50) {
      modbusDebugLogs.value.shift()
    }
  }

  // 彻底重置设备运行时状态（不留任何旧设备缓存与脏数据）
  function resetDeviceState() {
    deviceInfo.value = null
    sleComparisons.value = []
    sleCurrentStatus.value = {}
    modbusPoints.value = []
    modbusDebugLogs.value = []
    aiHistory.value = []
    currentAi.value = { ai1Ma: 0, ai2Ma: 0, timestampMs: Date.now() }
  }

  // 当串口断开、重连或切换端口时，立即彻底清除所有上一台设备的数据缓存
  watch(
    () => serialStore.connectedPort,
    () => {
      resetDeviceState()
    }
  )

  // Setup stream listener for real-time sample parsing
  serialStore.registerLineListener('sjzd_parser', (line: string) => {
    try {
      // 1. Check for AI Samples: AI1: x.xxx mA, AI2: x.xxx mA
      if (line.includes('AI1:') && line.includes('AI2:')) {
        const aiM = line.match(/AI1:\s*([0-9.]+)\s*mA,\s*AI2:\s*([0-9.]+)\s*mA/i)
        if (aiM) {
          const ai1 = parseFloat(aiM[1])
          const ai2 = parseFloat(aiM[2])
          const now = Date.now()
          currentAi.value = { ai1Ma: ai1, ai2Ma: ai2, timestampMs: now }
          const d = new Date(now)
          const timeStr = `${d.getMinutes().toString().padStart(2, '0')}:${d
            .getSeconds()
            .toString()
            .padStart(2, '0')}.${Math.floor(d.getMilliseconds() / 100)}`
          aiHistory.value.push({
            timestamp: now,
            timeStr,
            ai1,
            ai2,
          })
          if (aiHistory.value.length > 100) {
            aiHistory.value.shift()
          }
        }
      }

      // 2. Check for DEVINFO responses
      if (
        line.includes('SN:') ||
        line.includes('DEVINFO') ||
        line.includes('DevInfo') ||
        line.includes('HW:') ||
        line.includes('PwrOnCnt') ||
        line.includes('TotRunTim') ||
        line.includes('RptFreq')
      ) {
        const snM = line.match(/(?:SN|DeviceSN|Device\s*SN)[:=]\s*([0-9A-Za-z]+)/i)
        const typeM = line.match(/(?:Type|DevType|Model)[:=]\s*([0-9A-Za-z._-]+)/i)
        const addrM = line.match(/(?:Addr|Address)[:=]\s*([0-9A-Za-z]+)/i)
        const hwM = line.match(/(?:HW|Hardware|HwVer)[:=]\s*([0-9A-Za-z._-]+)/i)
        const fwM = line.match(/(?:FW|Firmware|AppVersion|Version|FwVer)[:=]\s*([0-9A-Za-z._-]+)/i)
        const bootM = line.match(/(?:BOOT|BootCount|PwrOnCnt|POC|PowerOnCount)[:=]\s*(\d+)/i)
        const uptimeM = line.match(/(?:UPTIME|Runtime|TotRunTim|TotRunTime|RTM)[:=]\s*(\d+)/i)
        const freqM = line.match(/(?:RptFreq|ReportFreq|RTFRE)[:=]\s*(\d+)/i)

        if (snM || typeM || addrM || hwM || fwM || bootM || uptimeM || freqM) {
          deviceInfo.value = {
            sn: snM ? snM[1] : deviceInfo.value?.sn,
            deviceType: typeM ? typeM[1] : deviceInfo.value?.deviceType,
            deviceAddr: addrM ? addrM[1] : deviceInfo.value?.deviceAddr,
            hwVersion: hwM ? hwM[1] : deviceInfo.value?.hwVersion || (typeM ? `SJZDV3-${typeM[1]}` : undefined),
            fwVersion: fwM ? fwM[1] : deviceInfo.value?.fwVersion,
            bootCount: bootM ? parseInt(bootM[1], 10) : deviceInfo.value?.bootCount,
            uptimeSec: uptimeM ? parseInt(uptimeM[1], 10) : deviceInfo.value?.uptimeSec,
            reportFreqSec: freqM ? parseInt(freqM[1], 10) : deviceInfo.value?.reportFreqSec,
            rawText: line,
          }
        }
      }

      // 3. Check for SLE / StarFlash responses
      if (
        line.includes('NetName') ||
        line.includes('Net_Name') ||
        line.includes('TxPwr') ||
        line.includes('MaxTxPwr') ||
        line.includes('APID') ||
        line.includes('AP_ID') ||
        line.includes('DevAddr') ||
        (line.includes('Addr=') && line.includes('Mac=')) ||
        line.includes('[EEPROM]') ||
        line.includes('[CHIP]') ||
        line.includes('SLE')
      ) {
        const netNameMatch = line.match(/(?:NetName|Net_Name|Name)=['"]?([^,'"\s\(\)]+)['"]?/i)
        if (netNameMatch) {
          sleForm.value.netName = netNameMatch[1]
          sleCurrentStatus.value.netName = netNameMatch[1]
        }

        const apIdMatch = line.match(/(?:APID|AP_ID)=(\d+)/i)
        if (apIdMatch) {
          const ap = parseInt(apIdMatch[1], 10)
          if (!isNaN(ap)) {
            sleForm.value.apId = ap
            sleCurrentStatus.value.apId = ap
          }
        }

        const addrMatch = line.match(/(?:DevAddr|DeviceAddr|Addr)=(\d+)/i)
        if (addrMatch) {
          sleCurrentStatus.value.devAddr = addrMatch[1]
        }

        const txPwrMatch = line.match(/(?:TxPwr|Tx_Pwr|PWR|Power)=(\d+)/i)
        if (txPwrMatch) {
          const pwr = parseInt(txPwrMatch[1], 10)
          if (!isNaN(pwr) && pwr >= 1 && pwr <= 8) {
            sleForm.value.txPower = pwr
            sleCurrentStatus.value.txPower = pwr
          }
        }

        const maxPwrMatch = line.match(/(?:MaxTxPwr|Max_Tx_Pwr|MaxPwr|MAX_PWR)=(\d+)/i)
        if (maxPwrMatch) {
          const mp = parseInt(maxPwrMatch[1], 10)
          if (!isNaN(mp) && mp >= 1 && mp <= 8) {
            sleForm.value.maxTxPower = mp
            sleCurrentStatus.value.maxTxPower = mp
          }
        }

        const macMatch = line.match(/(?:Mac|MAC)=([0-9A-Fa-f:]{17}|[0-9A-Fa-f-]{17})/i)
        if (macMatch) {
          sleCurrentStatus.value.mac = macMatch[1]
        }

        const bridgeMatch = line.match(/(?:Bridge|Wlan|WlanBridge)=(\d+)/i)
        if (bridgeMatch) {
          wlanBridgeEnabled.value = bridgeMatch[1] === '1'
          sleCurrentStatus.value.bridge = parseInt(bridgeMatch[1], 10)
        }

        sleCurrentStatus.value.lastSyncTime = new Date().toLocaleTimeString()

        // 维护与芯片回读参数比对表
        const updateComparison = (fieldName: string, eepromVal: string, chipVal: string) => {
          const list = [...sleComparisons.value]
          const existing = list.find((c) => c.fieldName === fieldName)
          if (existing) {
            if (eepromVal !== '--') existing.eepromVal = eepromVal
            if (chipVal !== '--') existing.chipVal = chipVal
            existing.isMatched =
              existing.eepromVal === '--' ||
              existing.chipVal === '--' ||
              existing.eepromVal === existing.chipVal
          } else {
            list.push({
              fieldName,
              eepromVal,
              chipVal,
              isMatched:
                eepromVal === '--' ||
                chipVal === '--' ||
                eepromVal === chipVal,
            })
          }
          sleComparisons.value = list
        }

        const isEepromLine = line.includes('[EEPROM]')
        const isChipLine = line.includes('[CHIP]') || (line.includes('Mac=') && line.includes('Addr='))

        if (netNameMatch) {
          updateComparison(
            '星闪网络名称 (NetName)',
            isEepromLine ? netNameMatch[1] : '--',
            isChipLine || !isEepromLine ? netNameMatch[1] : '--'
          )
        }
        if (addrMatch) {
          updateComparison(
            '从机通信地址 (DevAddr)',
            isEepromLine ? addrMatch[1] : '--',
            isChipLine || !isEepromLine ? addrMatch[1] : '--'
          )
        }
        if (txPwrMatch) {
          const pwrStr = `${txPwrMatch[1]} 档`
          updateComparison(
            '当前发射功率 (Tx Power)',
            isEepromLine ? pwrStr : '--',
            isChipLine || !isEepromLine ? pwrStr : '--'
          )
        }
      }

      // 4. Check for Modbus return list / count
      const countMatch = line.match(/Modbus points:\s*(\d+)/i)
      if (countMatch) {
        const total = parseInt(countMatch[1], 10)
        if (total === 0) {
          modbusPoints.value = []
          showMessage('已回读点位配置：当前设备未配置任何点位')
        }
      }

      // 5. Check for single Modbus point item: "[0] addr=3 func=3 reg=42761 len=2 type=5 order=0"
      const addrM = line.match(/\baddr\s*[:=]\s*(\d+)/i)
      const funcM = line.match(/\bfunc\s*[:=]\s*(\d+)/i)
      const regM = line.match(/\breg\s*[:=]\s*(\d+)/i)
      const lenM = line.match(/\blen(?:gth)?\s*[:=]\s*(\d+)/i)
      const typeM = line.match(/\btype\s*[:=]\s*(\d+)/i)
      const orderM = line.match(/\border\s*[:=]\s*(\d+)/i)

      if (addrM && funcM && regM && lenM) {
        // 精准匹配位于 addr 前面的点位索引 [0]，严防误捕获文件名行号如 userMain.c[286] 或时间戳
        const idxM = line.match(/\[(\d+)\]\s*addr/i) || line.match(/INFO:\s*\[(\d+)\]/i)
        const idx = idxM ? parseInt(idxM[1], 10) : undefined

        const pt: ModbusPointConfig = {
          slaveAddr: parseInt(addrM[1], 10),
          funcCode: parseInt(funcM[1], 10),
          regAddr: parseInt(regM[1], 10),
          length: parseInt(lenM[1], 10),
          dataType: typeM ? parseInt(typeM[1], 10) : 0,
          byteOrder: orderM ? parseInt(orderM[1], 10) : 0,
        }

        const nextList = [...modbusPoints.value]
        if (idx !== undefined && idx < nextList.length) {
          nextList[idx] = pt
        } else if (idx !== undefined) {
          while (nextList.length < idx) {
            nextList.push({ slaveAddr: 1, funcCode: 3, regAddr: 40001, length: 1, dataType: 0, byteOrder: 0 })
          }
          nextList[idx] = pt
        } else {
          const exists = nextList.some(
            (p) =>
              p.slaveAddr === pt.slaveAddr &&
              p.funcCode === pt.funcCode &&
              p.regAddr === pt.regAddr &&
              p.length === pt.length
          )
          if (!exists) {
            nextList.push(pt)
          }
        }
        modbusPoints.value = nextList
        showMessage(`已回读从站点位: 从站${pt.slaveAddr}, 寄存器${pt.regAddr}`)
      }

      // 6. Check for standard RS485DEV: return list
      if (line.includes('RS485DEV:') && line.includes(',')) {
        const body = line.split('RS485DEV:')[1]
        if (body) {
          const pts: ModbusPointConfig[] = []
          for (const item of body.split(';')) {
            const parts = item.split(',').map((s) => s.trim())
            if (parts.length >= 4) {
              pts.push({
                slaveAddr: parseInt(parts[0], 10) || 1,
                funcCode: parseInt(parts[1], 10) || 3,
                regAddr: parseInt(parts[2], 10) || 40001,
                length: parseInt(parts[3], 10) || 1,
                dataType: parts[4] ? parseInt(parts[4], 10) : 0,
                byteOrder: parts[5] ? parseInt(parts[5], 10) : 0,
              })
            }
          }
          if (pts.length > 0) {
            modbusPoints.value = pts
          }
        }
      }

      // 7. 将所有 Modbus 相关的回读信息、点位详情、调试报文和指令返回实时推送到抓包监控面板
      if (
        line.includes('Modbus points') ||
        (line.includes('addr=') && line.includes('func=')) ||
        line.includes('RS485DEV') ||
        line.includes('MB_RX') ||
        line.includes('MB_TX') ||
        line.includes('MB_') ||
        line.includes('DEBUG')
      ) {
        appendModbusDebugLog(`[RX] ${line}`)
      }
    } catch (err) {
      console.error('Error in sjzd_parser:', err)
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
      appendModbusDebugLog('[TX] RS485DEV:LIST')
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
      const cmd = await sjzdSendModbusPoints(serialStore.connectedPort, modbusPoints.value)
      appendModbusDebugLog(`[TX] ${cmd}`)
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
      const sentCmd = await sjzdSendModbusDebug(
        serialStore.connectedPort,
        pt.slaveAddr,
        pt.funcCode,
        pt.regAddr,
        pt.length
      )
      appendModbusDebugLog(`[TX] ${sentCmd}`)
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
      appendModbusDebugLog('[TX] RS485DEV:RESET')
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
    sleCurrentStatus,
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
    resetDeviceState,
  }
})
