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
  ModbusDebugReport,
  SjzdBridgeStatus,
  SjzdConfigFeature,
  SjzdConfigSaveReceipt,
  SjzdConfigSnapshotEvidence,
} from '../types/sjzd'
import { FOUR_G_EMPTY_CONFIG } from '../types/sjzd'
import {
  buildModbusDebugReport,
  parseModbusDebugProtocolLine,
  type ModbusDebugProtocolEvent,
} from '../utils/sjzdModbusDebug'
import {
  SjzdConfigSnapshotCollector,
  parseSjzdBridgeAck,
  parseSjzdConfigSaveReceipt,
  parseSjzdConfigProtocolLine,
  parseSjzdFourGSnapshot,
  parseSjzdRs485Snapshot,
  parseSjzdSleSnapshot,
  type SjzdSleSnapshot,
} from '../utils/sjzdConsoleProtocol'

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
  const wlanBridgeStatus = ref<SjzdBridgeStatus | null>(null)
  const modbusPoints = ref<ModbusPointConfig[]>([])
  const modbusConfigSnapshot = ref<SjzdConfigSnapshotEvidence | null>(null)
  // 多行 RS485DEV:LIST 事务期间禁止通用流解析器写入半截点位表。
  let isCollectingModbusReadback = false
  let isCollectingSleReadback = false
  let isCollectingFourGReadback = false

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
  const lastModbusDebugReport = ref<ModbusDebugReport | null>(null)

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
    wlanBridgeEnabled.value = false
    wlanBridgeStatus.value = null
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
    modbusConfigSnapshot.value = null
    isCollectingModbusReadback = false
    isCollectingSleReadback = false
    isCollectingFourGReadback = false
    modbusDebugLogs.value = []
    lastModbusDebugReport.value = null
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

  type SerialTransactionDecision<T> = { value: T } | { error: string } | undefined

  type SleEepromReadback = SjzdSleSnapshot['eeprom']

  interface FourGReadback {
    config: FourGConfigDto
    status: FourGStatusInfo
    evidence: SjzdConfigSnapshotEvidence
  }

  /**
   * 在写入之前注册行监听器，直到固件明确给出本次事务的结束特征才解除。
   * 串口 write 完成只代表字节已提交，不能作为设备保存成功的证据。
   */
  function runSerialTransaction<T>(
    operation: string,
    send: () => Promise<unknown>,
    inspectLine: (line: string) => SerialTransactionDecision<T>,
    timeoutMs = 2500
  ): Promise<T> {
    const listenerId = `sjzd_transaction_${operation}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        serialStore.unregisterLineListener(listenerId)
        callback()
      }

      serialStore.registerLineListener(listenerId, (line) => {
        try {
          const decision = inspectLine(line)
          if (!decision) return
          if ('error' in decision) {
            finish(() => reject(new Error(decision.error)))
          } else {
            finish(() => resolve(decision.value))
          }
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))))
        }
      })

      const timer = window.setTimeout(() => {
        finish(() => reject(new Error(`${operation} 等待设备响应超时（${timeoutMs}ms）`)))
      }, timeoutMs)

      void send().catch((error) => {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))))
      })
    })
  }

  function waitForSerialLine(
    operation: string,
    send: () => Promise<unknown>,
    isSuccess: (line: string) => boolean,
    getFailure: (line: string) => string | undefined,
    timeoutMs = 2500
  ): Promise<string> {
    return runSerialTransaction<string>(
      operation,
      send,
      (line) => {
        const failure = getFailure(line)
        if (failure) return { error: failure }
        return isSuccess(line) ? { value: line } : undefined
      },
      timeoutMs
    )
  }

  function configProtocolMarker(feature: SjzdConfigFeature) {
    return `${feature}_CONFIG:`
  }

  function applyBridgeStatus(ack: SjzdBridgeStatus) {
    wlanBridgeStatus.value = ack
    wlanBridgeEnabled.value = ack.active
    sleCurrentStatus.value.bridge = ack.active ? 1 : 0
  }

  function assertMcuConsoleAvailable(action: string) {
    if (wlanBridgeStatus.value?.active) {
      throw new Error(`${action} 被阻止：UART1 当前已确认透传到 ${wlanBridgeStatus.value?.uartOwner || '无线模组'}，请先退出透传`)
    }
  }

  /** 此查询在透传开启时仍由 MCU 本地处理，是所有 MCU 命令的安全前置条件。 */
  async function readWlanBridgeStatusOnce(): Promise<SjzdBridgeStatus> {
    const port = serialStore.connectedPort
    if (!port) throw new Error('请先连接串口')
    const ack = await runSerialTransaction<SjzdBridgeStatus>(
      '查询 UART1 透传状态',
      () => sjzdSendRawCommand(port, 'SLE_BRIDGE:LIST', false),
      (line) => {
        const parsed = parseSjzdBridgeAck(line)
        if (parsed) {
          if (parsed.status !== 'OK') return { error: `桥接状态查询失败：${parsed.code || '未知错误'}` }
          return { value: parsed }
        }
        if (line.includes('SLE_BRIDGE:ACK')) return { error: 'SLE_BRIDGE:ACK 结构化行格式无效' }
        return undefined
      },
      2500
    )
    applyBridgeStatus(ack)
    return ack
  }

  /** 未知桥接状态时先做不被转发的本地查询；查询失败则保守地阻止后续 MCU 命令。 */
  async function ensureMcuConsoleAvailable(action: string) {
    if (!wlanBridgeStatus.value) {
      try {
        await readWlanBridgeStatusOnce()
      } catch (error) {
        throw new Error(`${action} 被阻止：无法确认 UART1 透传状态；${error instanceof Error ? error.message : String(error)}`)
      }
    }
    assertMcuConsoleAvailable(action)
  }

  /** 保存回执本身不能替代读回；成功后必须比较下一次 LIST 的 revision。 */
  async function waitForConfigSave(
    feature: SjzdConfigFeature,
    label: string,
    send: () => Promise<unknown>
  ): Promise<SjzdConfigSaveReceipt> {
    await ensureMcuConsoleAvailable(label)
    return await runSerialTransaction<SjzdConfigSaveReceipt>(
      label,
      send,
      (line) => {
        const receipt = parseSjzdConfigSaveReceipt(line)
        if (receipt && receipt.feature === feature) {
          if (receipt.status === 'ERROR') {
            return { error: `${feature}_CONFIG 保存被设备拒绝：${receipt.code || '未知错误'}` }
          }
          return { value: receipt }
        }
        if (line.includes(`${configProtocolMarker(feature)}SAVED`)) {
          return { error: `${feature}_CONFIG:SAVED 结构化回执格式无效` }
        }
        return undefined
      },
      3500
    )
  }

  function assertSaveRevision(
    label: string,
    receipt: SjzdConfigSaveReceipt,
    evidence: SjzdConfigSnapshotEvidence
  ) {
    if (receipt.revision === undefined || receipt.revision !== evidence.revision) {
      throw new Error(`${label} 保存回执 revision 与完整 LIST 回读不一致`)
    }
  }

  function normalizeModbusPoint(point: ModbusPointConfig): ModbusPointConfig {
    const normalized = { ...point }
    if ([3, 4, 5].includes(normalized.dataType) && normalized.length < 2) {
      normalized.length = 2
    }
    return normalized
  }

  function isSameModbusPoint(left: ModbusPointConfig, right: ModbusPointConfig): boolean {
    return (
      left.slaveAddr === right.slaveAddr &&
      left.funcCode === right.funcCode &&
      left.regAddr === right.regAddr &&
      left.length === right.length &&
      left.dataType === right.dataType &&
      left.byteOrder === right.byteOrder
    )
  }

  function isSameModbusConfig(expected: ModbusPointConfig[], actual: ModbusPointConfig[]): boolean {
    return expected.length === actual.length && expected.every((point, index) => isSameModbusPoint(point, actual[index]))
  }

  async function readModbusPointsOnce(): Promise<ModbusPointConfig[]> {
    const port = serialStore.connectedPort
    if (!port) throw new Error('请先连接串口')
    await ensureMcuConsoleAvailable('RS485DEV:LIST')

    const collector = new SjzdConfigSnapshotCollector('RS485')
    isCollectingModbusReadback = true
    try {
      const readback = await runSerialTransaction<ModbusPointConfig[]>(
        'RS485DEV:LIST',
        async () => {
          appendModbusDebugLog('[TX] RS485DEV:LIST')
          await sjzdSendRawCommand(port, 'RS485DEV:LIST', false)
        },
        (line) => {
          const fed = collector.feed(line)
          if (fed.error) return { error: fed.error }
          if (fed.snapshot) {
            const parsed = parseSjzdRs485Snapshot(fed.snapshot)
            modbusConfigSnapshot.value = parsed.evidence
            return { value: parsed.points }
          }
          if (line.includes(configProtocolMarker('RS485')) && !parseSjzdConfigProtocolLine(line)) {
            return { error: 'RS485_CONFIG 结构化行格式无效' }
          }
          if (line.includes('Command not support')) return { error: '设备不支持 RS485DEV:LIST 结构化回读' }
          return undefined
        },
        3500
      )

      modbusPoints.value = readback
      return readback
    } finally {
      isCollectingModbusReadback = false
    }
  }

  function matchesSleReadback(expected: Partial<SleEepromReadback>, actual: SleEepromReadback): boolean {
    return (
      (expected.netName === undefined || expected.netName === actual.netName) &&
      (expected.apId === undefined || expected.apId === actual.apId) &&
      (expected.txPower === undefined || expected.txPower === actual.txPower) &&
      (expected.maxTxPower === undefined || expected.maxTxPower === actual.maxTxPower) &&
      (expected.bridge === undefined || expected.bridge === actual.bridge)
    )
  }

  function applySleSnapshot(snapshot: SjzdSleSnapshot) {
    const now = new Date().toLocaleTimeString()
    const previousSave = sleCurrentStatus.value.lastSave
    sleForm.value = {
      netName: snapshot.eeprom.netName,
      apId: snapshot.eeprom.apId,
      txPower: snapshot.eeprom.txPower,
      maxTxPower: snapshot.eeprom.maxTxPower,
    }
    sleCurrentStatus.value = {
      netName: snapshot.eeprom.netName,
      apId: snapshot.eeprom.apId,
      devAddr: snapshot.eeprom.devAddr,
      txPower: snapshot.eeprom.txPower,
      maxTxPower: snapshot.eeprom.maxTxPower,
      bridge: snapshot.eeprom.bridge,
      mac: snapshot.chip?.mac,
      chipAvailable: Boolean(snapshot.chip),
      snapshot: snapshot.evidence,
      lastSave: previousSave,
      lastSyncTime: now,
    }
    const comparison = (fieldName: string, eepromVal: string, chipVal?: string): SleFieldComparison => ({
      fieldName,
      eepromVal,
      chipVal: chipVal ?? '--',
      isComparable: chipVal !== undefined,
      isMatched: chipVal !== undefined && eepromVal === chipVal,
    })
    sleComparisons.value = [
      comparison('星闪网络名称 (NetName)', snapshot.eeprom.netName, snapshot.chip?.netName),
      comparison('从机通信地址 (DevAddr)', snapshot.eeprom.devAddr, snapshot.chip?.devAddr),
      comparison(
        '当前发射功率 (Tx Power)',
        `${snapshot.eeprom.txPower} 档`,
        snapshot.chip ? `${snapshot.chip.txPower} 档` : undefined
      ),
    ]
  }

  async function readSleConfigOnce(): Promise<SjzdSleSnapshot> {
    const port = serialStore.connectedPort
    if (!port) throw new Error('请先连接串口')
    await ensureMcuConsoleAvailable('SLE:LIST')

    const collector = new SjzdConfigSnapshotCollector('SLE')
    isCollectingSleReadback = true
    try {
      return await runSerialTransaction<SjzdSleSnapshot>(
        'SLE:LIST',
        () => sjzdSendRawCommand(port, 'SLE:LIST', false),
        (line) => {
          const fed = collector.feed(line)
          if (fed.error) return { error: fed.error }
          if (fed.snapshot) {
            const snapshot = parseSjzdSleSnapshot(fed.snapshot)
            applySleSnapshot(snapshot)
            return { value: snapshot }
          }
          if (line.includes(configProtocolMarker('SLE')) && !parseSjzdConfigProtocolLine(line)) {
            return { error: 'SLE_CONFIG 结构化行格式无效' }
          }
          if (line.includes('Command not support')) return { error: '设备不支持 SLE:LIST 结构化回读' }
          return undefined
        },
        3500
      )
    } finally {
      isCollectingSleReadback = false
    }
  }

  async function sendSleAndVerify(
    label: string,
    send: () => Promise<unknown>,
    expected: Partial<SleEepromReadback>
  ): Promise<SjzdSleSnapshot> {
    const receipt = await waitForConfigSave('SLE', label, send)
    const actual = await readSleConfigOnce()
    if (!matchesSleReadback(expected, actual.eeprom)) {
      throw new Error(`${label} 保存后完整 SLE_CONFIG 快照与目标不一致`)
    }
    assertSaveRevision(label, receipt, actual.evidence)
    sleCurrentStatus.value.lastSave = receipt
    return actual
  }

  function resetFourGReadbackState() {
    fourGConfig.value = { ...FOUR_G_EMPTY_CONFIG }
    fourGStatus.value = {
      state: 'READING...',
      configOperational: false,
      isOnline: false,
      passwordIsSet: false,
      hasReadback: false,
      configErrors: [],
    }
  }

  async function readFourGConfigOnce(): Promise<FourGReadback> {
    const port = serialStore.connectedPort
    if (!port) throw new Error('请先连接串口')
    await ensureMcuConsoleAvailable('4G:LIST')
    const previousSave = fourGStatus.value.lastSave
    resetFourGReadbackState()

    const collector = new SjzdConfigSnapshotCollector('4G')
    isCollectingFourGReadback = true
    try {
      const readback = await runSerialTransaction<FourGReadback>(
        '4G:LIST',
        () => sjzdQueryFourGConfig(port),
        (line) => {
          const fed = collector.feed(line)
          if (fed.error) return { error: fed.error }
          if (fed.snapshot) {
            const parsed = parseSjzdFourGSnapshot(fed.snapshot)
            fourGConfig.value = { ...parsed.config }
            fourGStatus.value = { ...parsed.status, lastSave: previousSave }
            return {
              value: {
                config: { ...parsed.config },
                status: { ...parsed.status, lastSave: previousSave },
                evidence: parsed.evidence,
              },
            }
          }
          if (line.includes(configProtocolMarker('4G')) && !parseSjzdConfigProtocolLine(line)) {
            return { error: '4G_CONFIG 结构化行格式无效' }
          }
          if (line.includes('Command not support')) return { error: '设备不支持 4G:LIST 结构化回读命令' }
          return undefined
        },
        3500
      )

      fourGStatus.value.lastSyncTime = new Date().toLocaleTimeString()
      appendFourGLog(
        `[4G完整快照] id=${readback.evidence.transactionId}, revision=${readback.evidence.revisionHex}, CRC32=${readback.evidence.crc32}, 状态=${readback.evidence.deviceStatus}${readback.evidence.code ? `/${readback.evidence.code}` : ''}`,
        readback.evidence.deviceStatus === 'OK' ? 'success' : 'warn'
      )
      return readback
    } finally {
      isCollectingFourGReadback = false
    }
  }

  function fourGReadbackMismatches(
    expected: Partial<FourGConfigDto>,
    actual: FourGReadback,
    passwordIsSet?: boolean
  ): string[] {
    const mismatches: string[] = []
    const fields: Array<[keyof FourGConfigDto, string]> = [
      ['apn', 'APN'],
      ['host', 'Broker 主机'],
      ['port', 'Broker 端口'],
      ['clientId', 'Client ID'],
      ['username', '用户名'],
      ['publishTopic', '发布 Topic'],
      ['subscribeTopic', '订阅 Topic'],
      ['keepAliveSec', 'KeepAlive'],
      ['qos', 'QoS'],
    ]
    for (const [field, label] of fields) {
      if (expected[field] !== undefined && expected[field] !== actual.config[field]) {
        mismatches.push(label)
      }
    }
    if (passwordIsSet !== undefined && actual.status.passwordIsSet !== passwordIsSet) {
      mismatches.push('密码设置状态')
    }
    return mismatches
  }

  async function waitForFourGSave(label: string, send: () => Promise<unknown>) {
    return await waitForConfigSave('4G', label, send)
  }

  async function saveFourGAndVerify(
    label: string,
    send: () => Promise<unknown>,
    expected: Partial<FourGConfigDto>,
    passwordIsSet?: boolean
  ) {
    const receipt = await waitForFourGSave(label, send)
    const readback = await readFourGConfigOnce()
    const mismatches = fourGReadbackMismatches(expected, readback, passwordIsSet)
    if (mismatches.length > 0) {
      throw new Error(`${label} 保存后完整 4G_CONFIG 快照字段不一致：${mismatches.join('、')}`)
    }
    assertSaveRevision(label, receipt, readback.evidence)
    fourGStatus.value.lastSave = receipt
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

      // 结构化桥接 ACK 是唯一可改变透传 UI 状态的依据；普通日志不参与判定。
      const bridgeAck = parseSjzdBridgeAck(line)
      if (bridgeAck?.status === 'OK' && bridgeAck.active === bridgeAck.requested) {
        applyBridgeStatus(bridgeAck)
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
        !isCollectingSleReadback &&
        !sleCurrentStatus.value.snapshot &&
        (
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
          (line.includes('SLE') && !line.includes('SLE_BRIDGE:'))
        )
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
      if (countMatch && !modbusConfigSnapshot.value) {
        const total = parseInt(countMatch[1], 10)
        if (total === 0 && !isCollectingModbusReadback) {
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

      if (addrM && funcM && regM && lenM && !isCollectingModbusReadback && !modbusConfigSnapshot.value) {
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
      if (!isCollectingModbusReadback && !modbusConfigSnapshot.value && line.includes('RS485DEV:') && line.includes(',')) {
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
      const acceptLegacyFourGSnapshot = !isCollectingFourGReadback && !fourGStatus.value.snapshot
      if (acceptLegacyFourGSnapshot && line.includes('=== 4G/MQTT Configuration ===')) {
        fourGConfig.value = { ...FOUR_G_EMPTY_CONFIG }
        // 旧日志只用于兼容显示，不能替代新版 END/count/CRC32 完整快照。
        fourGStatus.value.hasReadback = false
        fourGStatus.value.passwordIsSet = false
        fourGStatus.value.configErrors = []
        appendFourGLog('=== 开始回读 4G/MQTT 参数配置 ===', 'info')
      }

      // 9.1 Cat.1 Config Error details reported by firmware (4G_CONFIG_ERROR: ...)
      if (acceptLegacyFourGSnapshot && line.includes('4G_CONFIG_ERROR:')) {
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

      if (acceptLegacyFourGSnapshot && line.includes('EEPROM version=') && line.includes('State=')) {
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
      if (acceptLegacyFourGSnapshot && apnMatch && !line.includes('===')) {
        fourGConfig.value.apn = apnMatch[1]
      }

      const brokerMatch = line.match(/\bBroker=['"]?([^:'"\s]*?)['"]?:(\d+)['"]?,\s*KeepAlive=(\d+),\s*QoS=(\d+)/i)
      if (acceptLegacyFourGSnapshot && brokerMatch) {
        fourGConfig.value.host = brokerMatch[1].trim()
        fourGConfig.value.port = parseInt(brokerMatch[2], 10)
        fourGConfig.value.keepAliveSec = parseInt(brokerMatch[3], 10)
        fourGConfig.value.qos = parseInt(brokerMatch[4], 10)
      }

      // 密码回读只接受状态占位符，绝不将串口中的明文密码写入工具状态或日志。
      const clientMatch = line.match(
        /\bClientId=['"]?([^'",\s]*)['"]?,\s*Username=['"]?([^'",\s]*)['"]?,\s*Password=(<empty>|<set>)/i
      )
      if (acceptLegacyFourGSnapshot && clientMatch) {
        fourGConfig.value.clientId = clientMatch[1]
        fourGConfig.value.username = clientMatch[2]
        fourGStatus.value.passwordIsSet = clientMatch[3] === '<set>'
      } else if (acceptLegacyFourGSnapshot) {
        const idM = line.match(/\bClientId=['"]?([^'",\r\n\s]*)['"]?/i)
        if (idM) fourGConfig.value.clientId = idM[1]
        const uM = line.match(/\bUsername=['"]?([^'",\r\n\s]*)['"]?/i)
        if (uM) fourGConfig.value.username = uM[1]
        const pwM = line.match(/\bPassword=(<empty>|<set>)/i)
        if (pwM) {
          fourGStatus.value.passwordIsSet = pwM[1] === '<set>'
        }
      }

      const pubMatch = line.match(/\bPublish=['"]?([^'"\r\n\s]+)['"]?/i)
      if (acceptLegacyFourGSnapshot && pubMatch && !line.includes('Prompt') && !line.includes('Result')) {
        fourGConfig.value.publishTopic = pubMatch[1]
      }

      const subMatch = line.match(/\bSubscribe=['"]?([^'"\r\n\s]+)['"]?/i)
      if (acceptLegacyFourGSnapshot && subMatch) {
        fourGConfig.value.subscribeTopic = subMatch[1]
        appendFourGLog('[旧协议兼容] 已收到 Subscribe 字段；不会作为完整 4G_CONFIG 快照使用', 'warn')
      }

      // 10. 4G Parameter Write Confirmations & Runtime Logs
      if (line.includes('4G APN saved')) {
        appendFourGLog('APN 接入点已成功保存', 'success')
        showMessage('APN 已收到固件保存响应，等待读回校验')
      }
      if (line.includes('MQTT broker host saved')) {
        appendFourGLog('MQTT Broker 地址已成功保存', 'success')
        showMessage('MQTT Broker Host 已收到固件保存响应，等待读回校验')
      }
      if (line.includes('MQTT port saved:')) {
        const pM = line.match(/MQTT port saved:\s*(\d+)/i)
        appendFourGLog(`MQTT 端口已成功保存: ${pM?.[1]}`, 'success')
        showMessage(`MQTT 端口已收到固件保存响应 (${pM?.[1]})，等待读回校验`)
      }
      if (line.includes('MQTT client ID saved')) {
        appendFourGLog('MQTT Client ID 已成功保存', 'success')
        showMessage('MQTT Client ID 已收到固件保存响应，等待读回校验')
      }
      if (line.includes('MQTT username saved')) {
        appendFourGLog('MQTT 用户名已成功保存', 'success')
        showMessage('MQTT 用户名已收到固件保存响应，等待读回校验')
      }
      if (line.includes('MQTT password saved')) {
        fourGStatus.value.passwordIsSet = true
        appendFourGLog('MQTT 认证密码已成功保存', 'success')
        showMessage('MQTT 密码已收到固件保存响应，等待读回校验')
      }
      if (line.includes('MQTT publish topic saved')) {
        appendFourGLog('MQTT 上行发布主题 (Pub) 已成功保存', 'success')
        showMessage('MQTT 发布主题已收到固件保存响应，等待读回校验')
      }
      if (line.includes('MQTT subscribe topic saved')) {
        appendFourGLog('MQTT 下行订阅主题 (Sub) 已成功保存', 'success')
        showMessage('MQTT 订阅主题已收到固件保存响应，等待读回校验')
      }
      if (line.includes('MQTT keepalive saved:')) {
        const kM = line.match(/MQTT keepalive saved:\s*(\d+)/i)
        appendFourGLog(`MQTT 心跳周期已保存: ${kM?.[1]}s`, 'success')
        showMessage(`MQTT Keepalive 已收到固件保存响应 (${kM?.[1]}s)，等待读回校验`)
      }
      if (line.includes('MQTT QoS saved:')) {
        const qM = line.match(/MQTT QoS saved:\s*(\d+)/i)
        appendFourGLog(`MQTT 服务质量等级 (QoS) 已保存: ${qM?.[1]}`, 'success')
        showMessage(`MQTT QoS 已收到固件保存响应 (${qM?.[1]})，等待读回校验`)
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
      await ensureMcuConsoleAvailable('DEVINFO')
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
      await ensureMcuConsoleAvailable('SN 烧录')
      const port = serialStore.connectedPort as string
      const targetSn = sn.trim()
      await waitForSerialLine(
        'SN 烧录',
        () => sjzdSendSn(port, targetSn),
        (line) => line.includes(`Set SN ${targetSn} Done`) && line.includes('Restart System'),
        (line) => (line.includes('SN persistence failed') ? line : undefined),
        2500
      )
      deviceInfo.value = null
      wlanBridgeStatus.value = null
      wlanBridgeEnabled.value = false
      showMessage('SN 已获得固件持久化确认，设备正在重启；重连后须执行 DEVINFO 回读，未回读前不标记为生产完成。')
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
      const snapshot = await readSleConfigOnce()
      showMessage(
        snapshot.evidence.deviceStatus === 'OK'
          ? `已获取完整 SLE_CONFIG 快照（revision ${snapshot.evidence.revisionHex}，EEPROM 与芯片状态可比对）。`
          : `已获取完整 EEPROM 快照（revision ${snapshot.evidence.revisionHex}）；芯片运行时状态：${snapshot.evidence.code || '不可用'}。`
      )
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
      const port = serialStore.connectedPort as string
      const target = name.trim()
      await sendSleAndVerify(
        '设置星闪网络名称',
        () => sjzdSendSleNetName(port, target),
        { netName: target }
      )
      showMessage('星闪网络名称已获保存回执，并通过完整 SLE_CONFIG 快照 revision 复核。')
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
      const port = serialStore.connectedPort as string
      await sendSleAndVerify(
        '设置星闪 AP ID',
        () => sjzdSendSleApid(port, apid),
        { apId: apid }
      )
      showMessage('星闪 AP ID 已获保存回执，并通过完整 SLE_CONFIG 快照 revision 复核。')
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
      const port = serialStore.connectedPort as string
      await sendSleAndVerify(
        '设置星闪发射功率',
        () => sjzdSendSlePwr(port, level),
        { txPower: level }
      )
      showMessage('星闪发射功率已获保存回执，并通过完整 SLE_CONFIG 快照 revision 复核。')
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
      const port = serialStore.connectedPort as string
      await sendSleAndVerify(
        '设置星闪最大发射功率',
        () => sjzdSendSleMaxPwr(port, level),
        { maxTxPower: level }
      )
      showMessage('星闪最大发射功率已获保存回执，并通过完整 SLE_CONFIG 快照 revision 复核。')
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
      const port = serialStore.connectedPort as string
      const target = {
        netName: sleForm.value.netName.trim(),
        apId: sleForm.value.apId,
        txPower: sleForm.value.txPower,
        maxTxPower: sleForm.value.maxTxPower,
        bridge: wlanBridgeEnabled.value ? 1 : 0,
      }
      showMessage('正在逐项等待 SLE_CONFIG:SAVED 回执...')
      await waitForConfigSave('SLE', '设置星闪网络名称', () => sjzdSendSleNetName(port, target.netName))
      await waitForConfigSave('SLE', '设置星闪 AP ID', () => sjzdSendSleApid(port, target.apId))
      await waitForConfigSave('SLE', '设置星闪发射功率', () => sjzdSendSlePwr(port, target.txPower))
      const latestReceipt = await waitForConfigSave(
        'SLE',
        '设置星闪最大发射功率',
        () => sjzdSendSleMaxPwr(port, target.maxTxPower)
      )
      const actual = await readSleConfigOnce()
      if (!matchesSleReadback(target, actual.eeprom)) {
        throw new Error('星闪全套参数写入后完整 SLE_CONFIG 快照与目标不一致')
      }
      assertSaveRevision('星闪全套参数', latestReceipt, actual.evidence)
      sleCurrentStatus.value.lastSave = latestReceipt
      showMessage('星闪全套参数已获逐项保存回执，并通过完整 SLE_CONFIG snapshot revision 复核；芯片实际生效状态请查看右侧比对。')
    } catch (e: any) {
      showMessage(`批量下发星闪参数失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function toggleWlanBridge(enable: boolean) {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    // ACK 丢失时不能继续沿用旧状态，否则 MCU 命令可能被误转发给无线模组。
    wlanBridgeStatus.value = null
    wlanBridgeEnabled.value = false
    try {
      const port = serialStore.connectedPort as string
      const ack = await runSerialTransaction<SjzdBridgeStatus>(
        enable ? '开启 UART1 透传' : '关闭 UART1 透传',
        () => sjzdSendWlanBridge(port, enable),
        (line) => {
          const parsed = parseSjzdBridgeAck(line)
          if (parsed) {
            if (parsed.status !== 'OK') return { error: `桥接切换被设备拒绝：${parsed.code || '未知错误'}` }
            if (parsed.requested !== enable || parsed.active !== enable) {
              return { error: 'SLE_BRIDGE:ACK 与本次目标状态不一致' }
            }
            return { value: parsed }
          }
          if (line.includes('SLE_BRIDGE:ACK')) return { error: 'SLE_BRIDGE:ACK 结构化行格式无效' }
          return undefined
        },
        2500
      )
      applyBridgeStatus(ack)
      showMessage(
        ack.active
          ? `已确认 UART1 透传开启（owner=${ack.uartOwner}，无线=${ack.wireless}）。`
          : `已确认 UART1 已恢复 MCU 命令模式（无线=${ack.wireless}）。`
      )
    } catch (e: any) {
      showMessage(`切换透传失败: ${e}`, false)
    } finally {
      isBusy.value = false
    }
  }

  async function queryWlanBridge(): Promise<SjzdBridgeStatus | undefined> {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    isBusy.value = true
    wlanBridgeStatus.value = null
    wlanBridgeEnabled.value = false
    try {
      const ack = await readWlanBridgeStatusOnce()
      showMessage(
        ack.active
          ? `已确认当前处于 UART1 透传（owner=${ack.uartOwner}）。`
          : '已确认当前由 MCU 处理 UART1 配置命令。'
      )
      return ack
    } catch (e: any) {
      showMessage(`查询透传状态失败: ${e}`, false)
      return
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
      const points = await readModbusPointsOnce()
      showMessage(`已通过 RS485_CONFIG 完整快照校验：${points.length} 个点位，revision ${modbusConfigSnapshot.value?.revisionHex || '--'}。`)
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
      const expected = modbusPoints.value.map(normalizeModbusPoint)
      modbusPoints.value = expected
      const port = serialStore.connectedPort as string
      const receipt = await waitForConfigSave('RS485', '保存 Modbus 点位', () => sjzdSendModbusPoints(port, expected))
      appendModbusDebugLog(`[SAVED] RS485 revision=${receipt.hash || receipt.revision}`)
      const actual = await readModbusPointsOnce()
      if (!isSameModbusConfig(expected, actual)) {
        throw new Error('Modbus 保存后完整 RS485_CONFIG 点位快照与目标不一致')
      }
      if (!modbusConfigSnapshot.value) throw new Error('Modbus 保存后缺少完整 RS485_CONFIG 证据')
      assertSaveRevision('保存 Modbus 点位', receipt, modbusConfigSnapshot.value)
      showMessage(`Modbus 已获保存回执并完成 revision 复核：${actual.length} 个点位。`)
    } catch (e: any) {
      showMessage(`保存点位失败: ${e}`, false)
      throw e
    } finally {
      isBusy.value = false
    }
  }

  async function debugModbusPoint(pt: ModbusPointConfig): Promise<ModbusDebugReport | undefined> {
    if (!serialStore.connectedPort) {
      showMessage('请先连接串口', false)
      return
    }
    isBusy.value = true
    const port = serialStore.connectedPort
    try {
      await ensureMcuConsoleAvailable('RS485DEV:DEBUG')
    } catch (e: any) {
      showMessage(`单点调试被阻止：${String(e)}`, false)
      isBusy.value = false
      return
    }
    const startedAt = new Date().toISOString()
    const rawLines: string[] = []
    const events: ModbusDebugProtocolEvent[] = []
    let activeTransactionId: number | undefined
    try {
      const report = await runSerialTransaction<ModbusDebugReport>(
        'RS485DEV:DEBUG',
        async () => {
          const sentCmd = await sjzdSendModbusDebug(
            port,
            pt.slaveAddr,
            pt.funcCode,
            pt.regAddr,
            pt.length
          )
          appendModbusDebugLog(`[TX] ${sentCmd}`)
        },
        (line) => {
          if (/(?:MB_DEBUG|MB DEBUG|RS485DEV:DEBUG)/i.test(line)) rawLines.push(line)
          const event = parseModbusDebugProtocolLine(line)
          if (!event) {
            if (line.includes('MB_DEBUG:')) return { error: 'MB_DEBUG 结构化行格式无效' }
            return undefined
          }
          const eventId = Number(event.fields.id)
          if (!Number.isSafeInteger(eventId) || eventId < 1) return { error: 'MB_DEBUG 事务 ID 无效' }
          if (activeTransactionId === undefined && (event.type === 'begin' || event.type === 'result')) {
            activeTransactionId = eventId
          }
          if (activeTransactionId === undefined || eventId !== activeTransactionId) return undefined
          events.push(event)
          if (event.type === 'end') {
            return {
              value: buildModbusDebugReport(
                pt,
                port,
                startedAt,
                new Date().toISOString(),
                events,
                rawLines
              )
            }
          }
          return undefined
        },
        3500
      )
      lastModbusDebugReport.value = report
      showMessage(
        report.status === 'ok'
          ? `单点诊断完成：${report.decodedValue ?? '已收到原始数据'}`
          : `单点诊断结束：${report.message}`,
        report.status === 'ok'
      )
      return report
    } catch (e: any) {
      const report = buildModbusDebugReport(
        pt,
        port,
        startedAt,
        new Date().toISOString(),
        events,
        rawLines
      )
      report.message = `${report.message}；${String(e)}`
      lastModbusDebugReport.value = report
      showMessage(`单点调试失败：${report.message}`, false)
      return report
    } finally {
      isBusy.value = false
    }
  }

  function exportModbusDebugReport(): string | null {
    if (!lastModbusDebugReport.value) return null
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        report: lastModbusDebugReport.value,
        verificationBoundary:
          '报告仅在同一 MB_DEBUG 事务 ID 的 RESULT/END 完整到达后给出终态；成功还要求 BEGIN/TX/RX/DATA 齐全。不替代 RS485 物理层、现场仪表量程或持续轮询 HIL 验证。',
      },
      null,
      2
    )
  }

  async function resetModbusPoints() {
    if (!serialStore.connectedPort) return
    isBusy.value = true
    try {
      const port = serialStore.connectedPort as string
      appendModbusDebugLog('[TX] RS485DEV:RESET')
      const receipt = await waitForConfigSave('RS485', '清空 Modbus 点位', () =>
        sjzdSendRawCommand(port, 'RS485DEV:RESET', false)
      )
      const actual = await readModbusPointsOnce()
      if (actual.length !== 0) throw new Error(`清空后完整快照仍包含 ${actual.length} 个 Modbus 点位`)
      if (!modbusConfigSnapshot.value) throw new Error('清空后缺少 RS485_CONFIG 完整快照证据')
      assertSaveRevision('清空 Modbus 点位', receipt, modbusConfigSnapshot.value)
      showMessage('Modbus 点位已获保存回执，并通过空点表完整快照 revision 复核。')
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
      await ensureMcuConsoleAvailable('AITEST')
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
      await ensureMcuConsoleAvailable('TESTSTOP')
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
      await ensureMcuConsoleAvailable(`LED 测试 ${mode}`)
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
      await ensureMcuConsoleAvailable('RTFRE')
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
      await ensureMcuConsoleAvailable('LOGLEVEL')
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
      await ensureMcuConsoleAvailable('@POC=0')
      await sjzdSendRawCommand(serialStore.connectedPort, '@POC=0', false)
      showMessage('已清零开机次数 (@POC=0)')
    } catch (e: any) {
      showMessage(`清零失败: ${e}`, false)
    }
  }

  async function clearRuntime() {
    if (!serialStore.connectedPort) return
    try {
      await ensureMcuConsoleAvailable('@RTM=0')
      await sjzdSendRawCommand(serialStore.connectedPort, '@RTM=0', false)
      showMessage('已清零累计运行时间 (@RTM=0)')
    } catch (e: any) {
      showMessage(`清零失败: ${e}`, false)
    }
  }

  async function resetSystem() {
    if (!serialStore.connectedPort) return
    try {
      await ensureMcuConsoleAvailable('@RST')
      await sjzdSendRawCommand(serialStore.connectedPort, '@RST', false)
      wlanBridgeStatus.value = null
      wlanBridgeEnabled.value = false
      showMessage('已触发系统软复位重启 (@RST)')
    } catch (e: any) {
      showMessage(`重启指令失败: ${e}`, false)
    }
  }

  async function clearEeprom() {
    if (!serialStore.connectedPort) return
    try {
      await ensureMcuConsoleAvailable('@EEP=0')
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
      await ensureMcuConsoleAvailable('WLAN_TYPE:LIST')
      const port = serialStore.connectedPort as string
      await waitForSerialLine(
        '查询无线模式',
        () => sjzdQueryWlanType(port),
        (line) => /WLAN_TYPE:\s*mode=(?:SLE|4G),/i.test(line),
        (line) => (line.includes('Command not support') ? line : undefined)
      )
      showMessage(`无线模式已完成回读：${wlanTypeInfo.value.mode}。`)
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
      await ensureMcuConsoleAvailable(`切换无线模式到 ${mode}`)
      const port = serialStore.connectedPort as string
      await waitForSerialLine(
        `切换无线模式到 ${mode}`,
        () => sjzdSendWirelessType(port, mode),
        (line) => line.includes(`Wireless type saved as ${mode}`),
        (line) => (line.includes('rejected') || line.includes('persistence failed') ? line : undefined)
      )
      wlanBridgeStatus.value = null
      wlanBridgeEnabled.value = false
      showMessage(`无线模式已获固件持久化确认并正在重启；重连后须回读 WLAN_TYPE:LIST 验证。`)
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
    try {
      const readback = await readFourGConfigOnce()
      showMessage(
        `已获取完整 4G_CONFIG 快照（revision ${readback.evidence.revisionHex}；${readback.status.configOperational ? '配置有效' : '配置待完善'}）。`
      )
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
      const port = serialStore.connectedPort as string
      await saveFourGAndVerify(
        '设置 4G APN',
        () => sjzdSendFourGApn(port, targetApn),
        { apn: targetApn }
      )
      showMessage('4G APN 已获保存回执，并通过完整 4G_CONFIG 快照 revision 复核。')
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
      const port = serialStore.connectedPort as string
      await saveFourGAndVerify(
        '设置 MQTT Broker 主机',
        () => sjzdSendMqttHost(port, host),
        { host }
      )
      showMessage('MQTT Broker 主机已获保存回执，并通过完整 4G_CONFIG 快照 revision 复核。')
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
      const serialPort = serialStore.connectedPort as string
      await saveFourGAndVerify(
        '设置 MQTT Broker 端口',
        () => sjzdSendMqttPort(serialPort, port),
        { port }
      )
      showMessage('MQTT Broker 端口已获保存回执，并通过完整 4G_CONFIG 快照 revision 复核。')
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
      const port = serialStore.connectedPort as string
      await saveFourGAndVerify(
        '设置 MQTT Client ID',
        () => sjzdSendMqttClientId(port, id),
        { clientId: id }
      )
      showMessage('MQTT Client ID 已获保存回执，并通过完整 4G_CONFIG 快照 revision 复核。')
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
      const port = serialStore.connectedPort as string
      await saveFourGAndVerify(
        '设置 MQTT 用户名',
        () => sjzdSendMqttUser(port, user),
        { username: user }
      )
      showMessage('MQTT 用户名已获保存回执，并通过完整 4G_CONFIG 快照 revision 复核。')
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
      const port = serialStore.connectedPort as string
      await saveFourGAndVerify(
        '设置 MQTT 密码',
        () => sjzdSendMqttPass(port, pass),
        {},
        pass.length > 0
      )
      showMessage('MQTT 密码已获保存回执，并通过完整 4G_CONFIG 快照复核“已设置”状态；密码内容不会回读。')
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
      const port = serialStore.connectedPort as string
      await saveFourGAndVerify(
        '设置 MQTT 发布 Topic',
        () => sjzdSendMqttPubTopic(port, topic),
        { publishTopic: topic }
      )
      showMessage('MQTT 发布 Topic 已获保存回执，并通过完整 4G_CONFIG 快照 revision 复核。')
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
      const port = serialStore.connectedPort as string
      await saveFourGAndVerify(
        '设置 MQTT 订阅 Topic',
        () => sjzdSendMqttSubTopic(port, topic),
        { subscribeTopic: topic }
      )
      showMessage('MQTT 订阅 Topic 已获保存回执，并通过完整 4G_CONFIG 快照 revision 复核。')
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
      const port = serialStore.connectedPort as string
      await saveFourGAndVerify(
        '设置 MQTT KeepAlive',
        () => sjzdSendMqttKeepalive(port, sec),
        { keepAliveSec: sec }
      )
      showMessage('MQTT KeepAlive 已获保存回执，并通过完整 4G_CONFIG 快照 revision 复核。')
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
      const port = serialStore.connectedPort as string
      await saveFourGAndVerify(
        '设置 MQTT QoS',
        () => sjzdSendMqttQos(port, qos),
        { qos }
      )
      showMessage('MQTT QoS 已获保存回执，并通过完整 4G_CONFIG 快照 revision 复核。')
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
      await ensureMcuConsoleAvailable('4G:RECONNECT')
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
      const port = serialStore.connectedPort as string
      const receipt = await waitForConfigSave('4G', '清空 4G/MQTT 配置', () => sjzdResetFourGConfig(port))
      const readback = await readFourGConfigOnce()
      if (readback.status.configOperational || readback.config.host || readback.config.clientId) {
        throw new Error('4G/MQTT 配置清空后回读仍包含有效配置')
      }
      assertSaveRevision('清空 4G/MQTT 配置', receipt, readback.evidence)
      fourGStatus.value.lastSave = receipt
      showMessage('4G/MQTT 已获清空保存回执，并通过完整 4G_CONFIG 快照 revision 复核。')
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
    try {
      const port = serialStore.connectedPort as string
      const expected: Partial<FourGConfigDto> = {}
      let passwordIsSet: boolean | undefined
      let latestReceipt: SjzdConfigSaveReceipt | undefined
      showMessage('正在逐项等待 4G_CONFIG:SAVED 回执...')

      // 1. APN (默认使用 cmiot)
      const apnVal = target.apn?.trim() || 'cmiot'
      latestReceipt = await waitForFourGSave('设置 4G APN', () => sjzdSendFourGApn(port, apnVal))
      expected.apn = apnVal
      // 2. Broker Host
      if (target.host) {
        latestReceipt = await waitForFourGSave('设置 MQTT Broker 主机', () => sjzdSendMqttHost(port, target.host))
        expected.host = target.host
      }
      // 3. Port
      if (target.port) {
        latestReceipt = await waitForFourGSave('设置 MQTT Broker 端口', () => sjzdSendMqttPort(port, target.port))
        expected.port = target.port
      }
      // 4. Client ID
      if (target.clientId) {
        latestReceipt = await waitForFourGSave('设置 MQTT Client ID', () => sjzdSendMqttClientId(port, target.clientId))
        expected.clientId = target.clientId
      }
      // 5. Username
      if (target.username) {
        latestReceipt = await waitForFourGSave('设置 MQTT 用户名', () => sjzdSendMqttUser(port, target.username))
        expected.username = target.username
      }
      // 6. Password (only send if user explicitly provided a new non-empty password)
      if (target.password) {
        latestReceipt = await waitForFourGSave('设置 MQTT 密码', () => sjzdSendMqttPass(port, target.password))
        passwordIsSet = true
      }
      // 7. Pub Topic
      if (target.publishTopic) {
        latestReceipt = await waitForFourGSave('设置 MQTT 发布 Topic', () => sjzdSendMqttPubTopic(port, target.publishTopic))
        expected.publishTopic = target.publishTopic
      }
      // 8. Sub Topic
      if (target.subscribeTopic) {
        latestReceipt = await waitForFourGSave('设置 MQTT 订阅 Topic', () => sjzdSendMqttSubTopic(port, target.subscribeTopic))
        expected.subscribeTopic = target.subscribeTopic
      }
      // 9. KeepAlive
      if (target.keepAliveSec) {
        latestReceipt = await waitForFourGSave('设置 MQTT KeepAlive', () => sjzdSendMqttKeepalive(port, target.keepAliveSec))
        expected.keepAliveSec = target.keepAliveSec
      }
      // 10. QoS
      if (target.qos !== undefined) {
        latestReceipt = await waitForFourGSave('设置 MQTT QoS', () => sjzdSendMqttQos(port, target.qos))
        expected.qos = target.qos
      }

      const readback = await readFourGConfigOnce()
      const mismatches = fourGReadbackMismatches(expected, readback, passwordIsSet)
      if (mismatches.length > 0) {
        throw new Error(`4G/MQTT 批量保存后完整 4G_CONFIG 快照字段不一致：${mismatches.join('、')}`)
      }
      if (!latestReceipt) throw new Error('4G/MQTT 批量保存未取得保存回执')
      assertSaveRevision('4G/MQTT 批量保存', latestReceipt, readback.evidence)
      fourGStatus.value.lastSave = latestReceipt
      showMessage(`4G/MQTT 参数已获逐项保存回执并完成最终 revision 复核；整体配置${readback.status.configOperational ? '有效' : '仍待完善'}。`)
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
    wlanBridgeStatus,
    wlanTypeInfo,
    fourGConfig,
    fourGStatus,
    fourGLogs,
    modbusPoints,
    modbusConfigSnapshot,
    isSamplingAi,
    aiHistory,
    currentAi,
    reportFreq,
    logLevel,
    isBusy,
    lastOpMessage,
    modbusDebugLogs,
    lastModbusDebugReport,
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
    queryWlanBridge,
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
    exportModbusDebugReport,
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
