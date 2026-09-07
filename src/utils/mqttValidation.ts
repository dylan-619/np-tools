const MAX_PAYLOAD_BYTES = 1024

export function validateBrokerHost(host: string): string | undefined {
  const normalized = host.trim()
  if (!normalized || /\s/.test(normalized)) return 'Broker 主机不能为空，且不能包含空白字符'
  if (normalized.includes('://') || /[\\/]/.test(normalized)) {
    return 'Broker 主机只填写域名或 IP，端口请单独填写'
  }
  return undefined
}

export function validateClientId(clientId: string): string | undefined {
  const normalized = clientId.trim()
  if (!normalized || normalized.length > 64 || /[\x00-\x1F\x7F]/.test(normalized)) {
    return 'Client ID 必须为 1～64 个非控制字符'
  }
  if (/^\d{12}$/.test(normalized)) return 'Client ID 不能使用 12 位设备 SN，以免把设备挤下线'
  return undefined
}

export function validateMqttTopic(topic: string, allowWildcard: boolean): string | undefined {
  const normalized = topic.trim()
  if (!normalized || normalized.length > 65_535 || /[\x00-\x1F\x7F]/.test(normalized)) {
    return 'Topic 不能为空、不能包含控制字符，且长度不能超过 65535 字节'
  }
  if (!allowWildcard && /[+#]/.test(normalized)) return '发布 Topic 不能包含 + 或 # 通配符'
  if (!allowWildcard) return undefined

  const levels = normalized.split('/')
  for (const level of levels) {
    if (level.includes('#') && level !== '#') return '# 只能单独占据订阅 Topic 的最后一级'
    if (level.includes('+') && level !== '+') return '+ 只能单独占据订阅 Topic 的一级'
  }
  const hashIndex = normalized.indexOf('#')
  if (hashIndex >= 0 && hashIndex !== normalized.length - 1) return '# 只能位于订阅 Topic 的末尾'
  return undefined
}

export function validateMqttQos(qos: number): string | undefined {
  return [0, 1, 2].includes(qos) ? undefined : 'QoS 仅允许 0、1 或 2'
}

export function validatePayload(payload: string): string | undefined {
  const size = new TextEncoder().encode(payload).byteLength
  return size <= MAX_PAYLOAD_BYTES ? undefined : `MQTT payload 不能超过 ${MAX_PAYLOAD_BYTES} B`
}

export function payloadByteLength(payload: string): number {
  return new TextEncoder().encode(payload).byteLength
}

/**
 * 仅识别 KZ3 V1 的 func_code=2 信封；普通 MQTT 文本和其他协议仍按通用调试模式放行。
 * 快捷模板默认带完整运行时元数据；为兼容旧平台，func_code=2 可完整省略 _meta。
 */
export function validateKz3DownlinkEnvelope(payload: string, expectedBootId?: number): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || parsed.func_code !== 2) return undefined

  const topLevelKeys = Object.keys(parsed)
  if (topLevelKeys.some((key) => !['_meta', 'func_code', 'data'].includes(key))) {
    return 'KZ3 下行 JSON 顶层只允许 _meta、func_code、data'
  }
  if (!isRecord(parsed.data) || Object.keys(parsed.data).length === 0) {
    return 'KZ3 func_code=2 的 data 必须至少包含一个待写字段'
  }
  if (!('_meta' in parsed)) return undefined
  if (!isRecord(parsed._meta)) return 'KZ3 _meta 必须为 object，或完整省略 _meta 使用兼容模式'

  const metaKeys = Object.keys(parsed._meta)
  if (metaKeys.some((key) => !['boot_id', 'request_id', 'ttl_ms', 'expected_revision'].includes(key))) {
    return 'KZ3 _meta 包含未知字段'
  }
  const { boot_id: bootId, request_id: requestId, ttl_ms: ttlMs } = parsed._meta
  if (!isNonZeroU32(bootId)) return 'KZ3 boot_id 必须为来自最新遥测的非零 U32'
  if (expectedBootId === undefined) return 'KZ3 提供 _meta 时，必须先收到 30 秒内的设备遥测'
  if (bootId !== expectedBootId) return 'KZ3 boot_id 与最新设备遥测不一致，请重新填充 JSON 模板'
  if (!isNonZeroU32(requestId)) return 'KZ3 request_id 必须为非零 U32'
  if (!isNonZeroU32(ttlMs) || ttlMs > 0x7fffffff) {
    return 'KZ3 ttl_ms 必须在 1..0x7FFFFFFF 范围内'
  }
  if ('expected_revision' in parsed._meta && !isU32(parsed._meta.expected_revision)) {
    return 'KZ3 expected_revision 必须为 U32'
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isU32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff
}

function isNonZeroU32(value: unknown): value is number {
  return isU32(value) && value > 0
}
