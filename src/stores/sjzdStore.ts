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
  sjzdQueryWlanType,
  sjzdSendWirelessType,
  sjzdQueryFourGConfig,
  sjzdReconnectFourG,
  sjzdResetFourGConfig,
  sjzdSendFourGApn,
  sjzdSendMqttHost,
  sjzdSendMqttPort,
  sjzdSendMqttClientId,
  sjzdSendMqttUser,
  sjzdSendMqttPass,
  sjzdSendMqttPubTopic,
  sjzdSendMqttSubTopic,
  sjzdSendMqttKeepalive,
  sjzdSendMqttQos,
} from '../api/sjzdApi'
import type {
  ModbusPointConfig,
  DeviceInfoResult,
  SleFieldComparison,
  SleCurrentStatus,
  AiSampleDto,
  WirelessMode,
  WlanTypeInfo,
  FourGConfigDto,
  FourGStatusInfo,
} from '../types/sjzd'
import { FOUR_G_EMPTY_CONFIG } from '../types/sjzd'

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

  // Wireless Mode (SLE vs 4G Cat.1)
  const wlanTypeInfo = ref<WlanTypeInfo>({
    mode: 'SLE',
    modeCode: 2,
    uart2Baud: 230400,
  })

  // 4G Cat.1 / MQTT Configuration & Status (初始或未回读时为空状态)
  const fourGConfig = ref<FourGConfigDto>({ ...FOUR_G_EMPTY_CONFIG })
  const fourGStatus = ref<FourGStatusInfo>({
    state: 'UNKNOWN',
    configOperational: false,
    isOnline: false,
    passwordIsSet: false,
    hasReadback: false,
    configErrors: [],
  })
  const fourGLogs = ref<{ timestamp: string; text: string; level: 'info' | 'warn' | 'error' | 'success' }[]>([])

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

  function appendFourGLog(text: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
    const d = new Date()
    const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${Math.floor(d.getMilliseconds() / 100)}`
    fourGLogs.value.push({ timestamp: timeStr, text, level })
    if (fourGLogs.value.length > 200) {
      fourGLogs.value.shift()
    }
  }

  // 彻底重置设备运行时状态（不留任何旧设备缓存与脏数据）
  function resetDeviceState() {
    deviceInfo.value = null
    sleComparisons.value = []
    sleCurrentStatus.value = {}
    wlanTypeInfo.value = { mode: 'SLE', modeCode: 2, uart2Baud: 230400 }
    fourGConfig.value = { ...FOUR_G_EMPTY_CONFIG }
    fourGStatus.value = {
      state: 'UNKNOWN',
      configOperational: false,
      isOnline: false,
      passwordIsSet: false,
      hasReadback: false,
      configErrors: [],
    }
    fourGLogs.value = []
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

  function formatFourGConfigError(raw: string): string {
    if (raw.includes('MQTT_HOST_EMPTY')) return 'MQTT Broker主机未配置'
    if (raw.includes('MQTT_CLIENT_EMPTY')) return 'Client ID未配置'
    if (raw.includes('MQTT_PUB_TOPIC_EMPTY')) return '发布主题(Pub)未配置'
    if (raw.includes('MQTT_SUB_TOPIC_EMPTY')) return '订阅主题(Sub)未配置'
    if (raw.includes('MQTT_PORT_ZERO')) return '端口号未配置或为0'
    if (raw.includes('MQTT_KEEPALIVE_ZERO')) return '心跳周期未配置'
    if (raw.includes('MQTT_QOS_OUT_OF_RANGE')) return 'QoS取值无效'
    if (raw.includes('EEPROM_BLOCK_INVALID_OR_EMPTY')) return 'EEPROM未初始化或为空'
    return raw
  }

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
        if (line.includes('[EEPROM]')) {
          const netNameMatch = line.match(/NetName=([^\s,]+)/i)
          if (netNameMatch) {
            sleForm.value.netName = netNameMatch[1]
            sleCurrentStatus.value.netName = netNameMatch[1]
          }
          const apIdMatch = line.match(/APID=(\d+)/i)
          if (apIdMatch) {
            const ap = parseInt(apIdMatch[1], 10)
            if (!isNaN(ap)) {
              sleForm.value.apId = ap
              sleCurrentStatus.value.apId = ap
            }
          }
          const addrMatch = line.match(/DevAddr=(\d+)/i)
          if (addrMatch) {
            sleCurrentStatus.value.devAddr = addrMatch[1]
          }
          const txPwrMatch = line.match(/TxPwr=(\d+)/i)
          if (txPwrMatch) {
            const pwr = parseInt(txPwrMatch[1], 10)
            if (!isNaN(pwr) && pwr >= 1 && pwr <= 8) {
              sleForm.value.txPower = pwr
              sleCurrentStatus.value.txPower = pwr
            }
          }
          const maxPwrMatch = line.match(/MaxTxPwr=(\d+)/i)
          if (maxPwrMatch) {
            const mp = parseInt(maxPwrMatch[1], 10)
            if (!isNaN(mp) && mp >= 1 && mp <= 8) {
              sleForm.value.maxTxPower = mp
              sleCurrentStatus.value.maxTxPower = mp
            }
          }
          const bridgeMatch = line.match(/Bridge=(\d+)/i)
          if (bridgeMatch) {
            wlanBridgeEnabled.value = bridgeMatch[1] === '1'
            sleCurrentStatus.value.bridge = parseInt(bridgeMatch[1], 10)
          }
          sleCurrentStatus.value.lastSyncTime = new Date().toLocaleTimeString()
        } else if (line.includes('[CHIP]')) {
          const macMatch = line.match(/Mac=([0-9A-Fa-f:]{17})/i)
          if (macMatch && macMatch[1] !== '00:00:00:00:00:00') {
            sleCurrentStatus.value.mac = macMatch[1]
          }
          const netNameMatch = line.match(/NetName='([^']+)'/i)
          if (netNameMatch && netNameMatch[1]) {
            sleCurrentStatus.value.netName = netNameMatch[1]
          }
          const chipAddrMatch = line.match(/Addr=(\d+)/i)
          if (chipAddrMatch && chipAddrMatch[1] !== '0') {
            sleCurrentStatus.value.devAddr = chipAddrMatch[1]
          }
        } else {
          // General SLE fallback matching
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
          if (addrMatch && addrMatch[1] !== '0') {
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
          if (macMatch && macMatch[1] !== '00:00:00:00:00:00') {
            sleCurrentStatus.value.mac = macMatch[1]
          }

          const bridgeMatch = line.match(/(?:Bridge|Wlan|WlanBridge)=(\d+)/i)
          if (bridgeMatch) {
            wlanBridgeEnabled.value = bridgeMatch[1] === '1'
            sleCurrentStatus.value.bridge = parseInt(bridgeMatch[1], 10)
          }

          sleCurrentStatus.value.lastSyncTime = new Date().toLocaleTimeString()
        }

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

        if (isEepromLine) {
          const nm = line.match(/NetName=([^\s,]+)/i)
          const am = line.match(/DevAddr=(\d+)/i)
          const tm = line.match(/TxPwr=(\d+)/i)
          if (nm) updateComparison('星闪网络名称 (NetName)', nm[1], '--')
          if (am) updateComparison('从机通信地址 (DevAddr)', am[1], '--')
          if (tm) updateComparison('当前发射功率 (Tx Power)', `${tm[1]} 档`, '--')
        } else if (isChipLine) {
          const nm = line.match(/NetName='([^']*)'/i)
          const am = line.match(/Addr=(\d+)/i)
          const tm = line.match(/TxPwr=(\d+)/i)
          if (nm) updateComparison('星闪网络名称 (NetName)', '--', nm[1] || '(空)')
          if (am) updateComparison('从机通信地址 (DevAddr)', '--', am[1])
          if (tm) updateComparison('当前发射功率 (Tx Power)', '--', `${tm[1]} 档`)
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

      // 8. 4G Cat.1 / Wireless Mode (WLAN_TYPE) responses
      if (line.includes('WLAN_TYPE:')) {
        const wtMatch = line.match(/WLAN_TYPE:\s*mode=(\w+),\s*mode_code=(\d+),\s*uart2_baud=(\d+)/i)
        if (wtMatch) {
          const modeStr: WirelessMode = wtMatch[1].toUpperCase() === '4G' ? '4G' : 'SLE'
          wlanTypeInfo.value = {
            mode: modeStr,
            modeCode: parseInt(wtMatch[2], 10),
            uart2Baud: parseInt(wtMatch[3], 10),
            lastSyncTime: new Date().toLocaleTimeString(),
          }
          appendFourGLog(`[模式查询] 当前无线模式: ${modeStr} (UART2波特率: ${wtMatch[3]}bps)`, 'info')
          showMessage(`已获取无线模式: ${modeStr} (${wtMatch[3]}bps)`)
        }
      }

      if (line.includes('Wireless type saved as SLE')) {
        wlanTypeInfo.value.mode = 'SLE'
        wlanTypeInfo.value.modeCode = 2
        wlanTypeInfo.value.uart2Baud = 230400
        wlanTypeInfo.value.lastSyncTime = new Date().toLocaleTimeString()
        appendFourGLog('无线工作模式已切换为 SLE (星闪) 模式，设备正在复位重启...', 'info')
        showMessage('无线模式已切换为 SLE，设备正在重启')
      }

      if (line.includes('Wireless type saved as 4G')) {
        wlanTypeInfo.value.mode = '4G'
        wlanTypeInfo.value.modeCode = 3
        wlanTypeInfo.value.uart2Baud = 115200
        wlanTypeInfo.value.lastSyncTime = new Date().toLocaleTimeString()
        appendFourGLog('无线工作模式已切换为 4G Cat.1 模式，设备正在复位重启...', 'info')
        showMessage('无线模式已切换为 4G Cat.1，设备正在重启')
      }

      if (line.includes('4G mode rejected:')) {
        appendFourGLog('切换 4G 模式被拒绝：必须先完整配置 MQTT_HOST 及所需参数！', 'error')
        showMessage('切换 4G 模式被拒绝：必须先配置 MQTT Host 及所需参数', false)
      }

      if (line.includes('4G reconnect rejected:')) {
        appendFourGLog('4G 重连被拒绝：当前设备处于 SLE 星闪模式', 'warn')
        showMessage('4G 重连被拒绝：当前设备工作于 SLE 模式', false)
      }

      if (line.includes('4G/MQTT configuration cleared')) {
        fourGConfig.value = { ...FOUR_G_EMPTY_CONFIG }
        fourGStatus.value.hasReadback = true
        fourGStatus.value.passwordIsSet = false
        fourGStatus.value.configOperational = false
        fourGStatus.value.isOnline = false
        fourGStatus.value.configErrors = ['EEPROM配置已清空，需重新配置']
        appendFourGLog('4G/MQTT 配置已被清除抹除 (RESET_CONFIG)', 'warn')
        showMessage('4G/MQTT EEPROM 配置已清空')
      }

      // 9. 4G Cat.1 Configuration Multi-line Output (4G:LIST)
      if (line.includes('=== 4G/MQTT Configuration ===')) {
        fourGConfig.value = { ...FOUR_G_EMPTY_CONFIG }
        fourGStatus.value.hasReadback = true
        fourGStatus.value.passwordIsSet = false
        fourGStatus.value.configErrors = []
        appendFourGLog('=== 开始回读 4G/MQTT 参数配置 ===', 'info')
      }

      // 9.1 Cat.1 Config Error details reported by firmware (4G_CONFIG_ERROR: ...)
      if (line.includes('4G_CONFIG_ERROR:')) {
        const rawErr = line.split('4G_CONFIG_ERROR:')[1]?.trim() || ''
        if (rawErr && !rawErr.startsWith('mask=')) {
          if (!fourGStatus.value.configErrors) {
            fourGStatus.value.configErrors = []
          }
          const formatted = formatFourGConfigError(rawErr)
          if (!fourGStatus.value.configErrors.includes(formatted)) {
            fourGStatus.value.configErrors.push(formatted)
          }
          appendFourGLog(`[配置校验异常] ${formatted}`, 'warn')
        }
      }

      if (line.includes('EEPROM version=') && line.includes('State=')) {
        const vM = line.match(/EEPROM\s*version=(\d+)/i)
        const sM = line.match(/State=([A-Za-z0-9_]+)/i)
        const cM = line.match(/Config=([A-Za-z0-9_]+)/i)
        const oM = line.match(/Online=(\d+)/i)
        if (vM || sM || cM || oM) {
          if (vM) fourGStatus.value.eepromVersion = parseInt(vM[1], 10)
          if (sM) fourGStatus.value.state = sM[1]
          if (cM) fourGStatus.value.configOperational = cM[1].toLowerCase() === 'valid'
          if (oM) fourGStatus.value.isOnline = oM[1] === '1'
          fourGStatus.value.lastSyncTime = new Date().toLocaleTimeString()
          appendFourGLog(`[回读状态] 运行状态: ${sM?.[1] || '--'}, 配置状态: ${cM?.[1] || '--'}, MQTT连接: ${oM?.[1] === '1' ? '在线' : '离线'}`, oM?.[1] === '1' ? 'success' : 'info')
        }
      }

      const apnMatch = line.match(/\bAPN=['"]?([^'"\r\n\s]+)['"]?/i)
      if (apnMatch && !line.includes('===')) {
        fourGConfig.value.apn = apnMatch[1]
      }

      const brokerMatch = line.match(/\bBroker=['"]?([^:'"\s]*?)['"]?:(\d+)['"]?,\s*KeepAlive=(\d+),\s*QoS=(\d+)/i)
      if (brokerMatch) {
        fourGConfig.value.host = brokerMatch[1].trim()
        fourGConfig.value.port = parseInt(brokerMatch[2], 10)
        fourGConfig.value.keepAliveSec = parseInt(brokerMatch[3], 10)
        fourGConfig.value.qos = parseInt(brokerMatch[4], 10)
      }

      // 兼容旧固件的 <set>/<empty>，并读取新固件 Password='<明文>' 格式。
      const clientMatch = line.match(
        /\bClientId=['"]?([^'",\s]*)['"]?,\s*Username=['"]?([^'",\s]*)['"]?,\s*Password=(?:['"]([^'"]*)['"]|(<empty>|<set>))/i
      )
      if (clientMatch) {
        fourGConfig.value.clientId = clientMatch[1]
        fourGConfig.value.username = clientMatch[2]
        if (clientMatch[3] !== undefined) {
          fourGConfig.value.password = clientMatch[3]
          fourGStatus.value.passwordIsSet = clientMatch[3].length > 0
        } else {
          fourGStatus.value.passwordIsSet = clientMatch[4] === '<set>'
        }
      } else {
        const idM = line.match(/\bClientId=['"]?([^'",\r\n\s]*)['"]?/i)
        if (idM) fourGConfig.value.clientId = idM[1]
        const uM = line.match(/\bUsername=['"]?([^'",\r\n\s]*)['"]?/i)
        if (uM) fourGConfig.value.username = uM[1]
        const pwM = line.match(/\bPassword=(?:['"]([^'"]*)['"]|(<empty>|<set>))/i)
        if (pwM) {
          if (pwM[1] !== undefined) {
            fourGConfig.value.password = pwM[1]
            fourGStatus.value.passwordIsSet = pwM[1].length > 0
          } else {
            fourGStatus.value.passwordIsSet = pwM[2] === '<set>'
          }
        }
      }

      const pubMatch = line.match(/\bPublish=['"]?([^'"\r\n\s]+)['"]?/i)
      if (pubMatch && !line.includes('Prompt') && !line.includes('Result')) {
        fourGConfig.value.publishTopic = pubMatch[1]
      }

      const subMatch = line.match(/\bSubscribe=['"]?([^'"\r\n\s]+)['"]?/i)
      if (subMatch) {
        fourGConfig.value.subscribeTopic = subMatch[1]
        fourGStatus.value.hasReadback = true
        appendFourGLog(
          `[4G回读成功] APN=${fourGConfig.value.apn}, Broker=${fourGConfig.value.host}:${fourGConfig.value.port}, ClientId=${fourGConfig.value.clientId}, User=${fourGConfig.value.username || '(无)'}, Pub=${fourGConfig.value.publishTopic}, Sub=${fourGConfig.value.subscribeTopic}, 密码=${fourGStatus.value.passwordIsSet ? '已设置' : '未设置'}`,
          'success'
        )
      }

      // 10. 4G Parameter Write Confirmations & Runtime Logs
      if (line.includes('4G APN saved')) {
        appendFourGLog('APN 接入点已成功保存', 'success')
        showMessage('APN 已保存')
      }
      if (line.includes('MQTT broker host saved')) {
        appendFourGLog('MQTT Broker 地址已成功保存', 'success')
        showMessage('MQTT Broker Host 已保存')
      }
      if (line.includes('MQTT port saved:')) {
        const pM = line.match(/MQTT port saved:\s*(\d+)/i)
        appendFourGLog(`MQTT 端口已成功保存: ${pM?.[1]}`, 'success')
        showMessage(`MQTT 端口已保存 (${pM?.[1]})`)
      }
      if (line.includes('MQTT client ID saved')) {
        appendFourGLog('MQTT Client ID 已成功保存', 'success')
        showMessage('MQTT Client ID 已保存')
      }
      if (line.includes('MQTT username saved')) {
        appendFourGLog('MQTT 用户名已成功保存', 'success')
        showMessage('MQTT 用户名已保存')
      }
      if (line.includes('MQTT password saved')) {
        fourGStatus.value.passwordIsSet = true
        appendFourGLog('MQTT 认证密码已成功保存', 'success')
        showMessage('MQTT 密码已保存')
      }
      if (line.includes('MQTT publish topic saved')) {
        appendFourGLog('MQTT 上行发布主题 (Pub) 已成功保存', 'success')
        showMessage('MQTT 发布主题已保存')
      }
      if (line.includes('MQTT subscribe topic saved')) {
        appendFourGLog('MQTT 下行订阅主题 (Sub) 已成功保存', 'success')
        showMessage('MQTT 订阅主题已保存')
      }
      if (line.includes('MQTT keepalive saved:')) {
        const kM = line.match(/MQTT keepalive saved:\s*(\d+)/i)
        appendFourGLog(`MQTT 心跳周期已保存: ${kM?.[1]}s`, 'success')
        showMessage(`MQTT Keepalive 已保存 (${kM?.[1]}s)`)
      }
      if (line.includes('MQTT QoS saved:')) {
        const qM = line.match(/MQTT QoS saved:\s*(\d+)/i)
        appendFourGLog(`MQTT 服务质量等级 (QoS) 已保存: ${qM?.[1]}`, 'success')
        showMessage(`MQTT QoS 已保存 (${qM?.[1]})`)
      }

      // 11. 4G MQTT Online URC & Connection Diagnostics
      if (line.includes('4G MQTT online and subscribed:')) {
        const subM = line.match(/4G MQTT online and subscribed:\s*(.*)/i)
        fourGStatus.value.isOnline = true
        fourGStatus.value.state = 'ONLINE'
        fourGStatus.value.lastOnlineLogTime = new Date().toLocaleTimeString()
        if (subM && subM[1]) {
          fourGConfig.value.subscribeTopic = subM[1].trim()
        }
        appendFourGLog(`4G Cat.1 MQTT 服务已连接上线并成功订阅主题: ${subM?.[1] || ''}`, 'success')
        showMessage(`4G MQTT 已连接上线并成功订阅: ${subM?.[1] || ''}`)
      }

      // 12. QMTSTAT: client status change from Quectel module
      if (line.includes('4G QMTSTAT:')) {
        const qm = line.match(/4G QMTSTAT:\s*client=(\d+),\s*result=(\d+),\s*state=([A-Za-z0-9_]+)/i)
        fourGStatus.value.isOnline = false
        fourGStatus.value.state = 'DISCONNECTED'
        if (qm) {
          fourGStatus.value.lastQmtstat = {
            client: qm[1],
            result: qm[2],
            state: qm[3],
            time: new Date().toLocaleTimeString()
          }
          const reasonStr = qm[2] === '1' ? '服务器断开连接 (peer closed / ACL限制)' : `状态码 ${qm[2]}`
          appendFourGLog(`[链路告警] Cat.1 模组收到下线事件 QMTSTAT: client=${qm[1]}, 结果: ${reasonStr}, 阶段: ${qm[3]}`, 'warn')
        }
      }

      // 13. Session retry & Reconnect detection
      if (
        line.includes('4G MQTT session retry in') ||
        line.includes('4G MQTT reconnect in') ||
        line.includes('4G MQTT reconnect requested')
      ) {
        const rm = line.match(/4G MQTT (?:session retry|reconnect) in\s*(\d+)\s*ms:\s*(.*)/i)
        fourGStatus.value.isOnline = false
        fourGStatus.value.state = 'RETRYING'
        const reason = rm?.[2] || 'link URC'
        fourGStatus.value.retryReason = reason
        appendFourGLog(`[自动重试] 4G MQTT 会话将在 ${rm?.[1] || 1000}ms 后重试连接 (原因: ${reason})`, 'warn')
      }

      if (line.includes('4G MQTT soft retry exhausted')) {
        fourGStatus.value.isOnline = false
        fourGStatus.value.state = 'RETRY_EXHAUSTED'
        appendFourGLog('4G MQTT 软重试次数已耗尽，将触发重新初始化', 'error')
      }

      // 14. Command not support error handling
      if (line.includes('Command not support')) {
        appendFourGLog('终端返回: 指令不支持 (Command not support)', 'error')
        showMessage('指令不支持 (Command not support)', false)
      }

      if (
        (line.includes('Cat1') || line.includes('4G ') || line.includes('MQTT') || line.includes('QMT') || line.includes('PDP')) &&
        !line.includes('Modbus') &&
        !line.includes('=== 4G/MQTT Configuration ===') &&
        !line.includes('WLAN_TYPE:')
      ) {
        const isErr = line.includes('fail') || line.includes('reject') || line.includes('error') || line.includes('Invalid')
        const isWarn = line.includes('warn') || line.includes('drop') || line.includes('overflow') || line.includes('incomplete')
        appendFourGLog(line, isErr ? 'error' : isWarn ? 'warn' : 'info')
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

  // 4G Cat.1 / Wireless Mode Actions
  async function queryWlanType() {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    isBusy.value = true
    try {
      await sjzdQueryWlanType(serialStore.connectedPort)
      showMessage('已发送无线模式查询 (WLAN_TYPE:LIST)')
    } catch (e: any) {
      showMessage(`查询无线模式失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setWirelessMode(mode: WirelessMode) {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    if (mode === '4G') {
      if (!fourGConfig.value.host || !fourGConfig.value.port) {
        showMessage('切换 4G 模式前，必须先配置并保存 MQTT Broker 主机与端口', false)
        return
      }
    }
    isBusy.value = true
    try {
      await sjzdSendWirelessType(serialStore.connectedPort, mode)
      showMessage(`已发送切换模式指令 (WLAN_TYPE:${mode})，设备将复位生效`)
    } catch (e: any) {
      showMessage(`切换模式失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function queryFourGConfig() {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    isBusy.value = true
    // 查询前重置回读状态与旧配置，避免显示陈旧或未读数据
    fourGConfig.value = { ...FOUR_G_EMPTY_CONFIG }
    fourGStatus.value.hasReadback = false
    fourGStatus.value.passwordIsSet = false
    fourGStatus.value.configErrors = []
    fourGStatus.value.state = 'READING...'
    try {
      await sjzdQueryFourGConfig(serialStore.connectedPort)
      showMessage('已发送 4G 配置查询指令 (4G:LIST)')
      // 等待串口多行回传数据接收并由监听器解析完毕 (通常约 200~400ms)
      await new Promise((resolve) => setTimeout(resolve, 600))
    } catch (e: any) {
      showMessage(`查询 4G 配置失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setFourGApn(apn: string) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    const targetApn = apn?.trim() || 'cmiot'
    try {
      await sjzdSendFourGApn(serialStore.connectedPort, targetApn)
      showMessage(`APN 指令已发送: ${targetApn}`)
    } catch (e: any) {
      showMessage(`设置 APN 失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setMqttHost(host: string) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendMqttHost(serialStore.connectedPort, host)
      showMessage(`MQTT Broker 地址指令已发送: ${host}`)
    } catch (e: any) {
      showMessage(`设置 Host 失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setMqttPort(port: number) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendMqttPort(serialStore.connectedPort, port)
      showMessage(`MQTT 端口指令已发送: ${port}`)
    } catch (e: any) {
      showMessage(`设置 Port 失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setMqttClientId(id: string) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendMqttClientId(serialStore.connectedPort, id)
      showMessage(`MQTT Client ID 指令已发送: ${id}`)
    } catch (e: any) {
      showMessage(`设置 Client ID 失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setMqttUser(user: string) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendMqttUser(serialStore.connectedPort, user)
      showMessage(`MQTT 用户名指令已发送: ${user}`)
    } catch (e: any) {
      showMessage(`设置用户名失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setMqttPass(pass: string) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendMqttPass(serialStore.connectedPort, pass)
      showMessage(`MQTT 密码指令已发送`)
    } catch (e: any) {
      showMessage(`设置密码失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setMqttPubTopic(topic: string) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendMqttPubTopic(serialStore.connectedPort, topic)
      showMessage(`MQTT 发布主题指令已发送: ${topic}`)
    } catch (e: any) {
      showMessage(`设置发布主题失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setMqttSubTopic(topic: string) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendMqttSubTopic(serialStore.connectedPort, topic)
      showMessage(`MQTT 订阅主题指令已发送: ${topic}`)
    } catch (e: any) {
      showMessage(`设置订阅主题失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setMqttKeepalive(sec: number) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendMqttKeepalive(serialStore.connectedPort, sec)
      showMessage(`MQTT 心跳周期指令已发送: ${sec}s`)
    } catch (e: any) {
      showMessage(`设置保活周期失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function setMqttQos(qos: number) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdSendMqttQos(serialStore.connectedPort, qos)
      showMessage(`MQTT QoS 指令已发送: ${qos}`)
    } catch (e: any) {
      showMessage(`设置 QoS 失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function reconnectFourG() {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      await sjzdReconnectFourG(serialStore.connectedPort)
      showMessage('已发送 4G 模组重连指令 (4G:RECONNECT)')
    } catch (e: any) {
      showMessage(`4G 重连指令失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function resetFourGConfig() {
    if (!serialStore.connectedPort) return
    if (wlanTypeInfo.value.mode === '4G') {
      showMessage('重置 4G/MQTT 配置必须先切换到 SLE 模式，以确保安全！', false)
      return
    }
    isBusy.value = true
    try {
      await sjzdResetFourGConfig(serialStore.connectedPort)
      showMessage('已发送清除 4G/MQTT 配置指令 (4G:RESET_CONFIG)')
    } catch (e: any) {
      showMessage(`重置 4G 配置失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  function generateTopicsFromSn(targetSn?: string) {
    const sn = (targetSn || deviceInfo.value?.sn || fourGConfig.value.clientId || '').trim()
    if (!sn) {
      showMessage('未获取到有效设备 SN，请先查询设备信息或手动输入 SN', false)
      return false
    }
    fourGConfig.value.clientId = sn
    fourGConfig.value.publishTopic = `devices/${sn}/up`
    fourGConfig.value.subscribeTopic = `devices/${sn}/down`
    showMessage(`已根据 SN [${sn}] 自动生成 Client ID 与默认 Pub/Sub 主题`)
    return true
  }

  async function saveAllFourGParams(cfg?: Partial<FourGConfigDto>) {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    const target = { ...fourGConfig.value, ...(cfg || {}) }
    isBusy.value = true
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    try {
      // 1. APN (默认使用 cmiot)
      const apnVal = target.apn?.trim() || 'cmiot'
      await sjzdSendFourGApn(serialStore.connectedPort, apnVal)
      await delay(120)
      // 2. Broker Host
      if (target.host) {
        await sjzdSendMqttHost(serialStore.connectedPort, target.host)
        await delay(120)
      }
      // 3. Port
      if (target.port) {
        await sjzdSendMqttPort(serialStore.connectedPort, target.port)
        await delay(120)
      }
      // 4. Client ID
      if (target.clientId) {
        await sjzdSendMqttClientId(serialStore.connectedPort, target.clientId)
        await delay(120)
      }
      // 5. Username
      if (target.username) {
        await sjzdSendMqttUser(serialStore.connectedPort, target.username)
        await delay(120)
      }
      // 6. Password (only send if user explicitly provided a new non-empty password)
      if (target.password) {
        await sjzdSendMqttPass(serialStore.connectedPort, target.password)
        await delay(120)
      }
      // 7. Pub Topic
      if (target.publishTopic) {
        await sjzdSendMqttPubTopic(serialStore.connectedPort, target.publishTopic)
        await delay(120)
      }
      // 8. Sub Topic
      if (target.subscribeTopic) {
        await sjzdSendMqttSubTopic(serialStore.connectedPort, target.subscribeTopic)
        await delay(120)
      }
      // 9. KeepAlive
      if (target.keepAliveSec) {
        await sjzdSendMqttKeepalive(serialStore.connectedPort, target.keepAliveSec)
        await delay(120)
      }
      // 10. QoS
      if (target.qos !== undefined) {
        await sjzdSendMqttQos(serialStore.connectedPort, target.qos)
        await delay(120)
      }

      // Finally read back config
      await delay(200)
      await sjzdQueryFourGConfig(serialStore.connectedPort)
      showMessage('所有 4G/MQTT 参数已批量下发并请求回读校验！')
    } catch (e: any) {
      showMessage(`批量保存 4G 参数失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  return {
    deviceInfo,
    sleComparisons,
    sleCurrentStatus,
    sleForm,
    wlanBridgeEnabled,
    wlanTypeInfo,
    fourGConfig,
    fourGStatus,
    fourGLogs,
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
    appendFourGLog,
    queryDeviceInfo,
    burnSn,
    querySleConfig,
    setSleNetName,
    setSleApid,
    setSlePwr,
    setSleMaxPwr,
    applyAllSleConfig,
    toggleWlanBridge,
    queryWlanType,
    setWirelessMode,
    queryFourGConfig,
    setFourGApn,
    setMqttHost,
    setMqttPort,
    setMqttClientId,
    setMqttUser,
    setMqttPass,
    setMqttPubTopic,
    setMqttSubTopic,
    setMqttKeepalive,
    setMqttQos,
    reconnectFourG,
    resetFourGConfig,
    generateTopicsFromSn,
    saveAllFourGParams,
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
