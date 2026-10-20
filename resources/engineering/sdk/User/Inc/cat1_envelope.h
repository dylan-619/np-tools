#ifndef KZ3_CAT1_ENVELOPE_H
#define KZ3_CAT1_ENVELOPE_H

#include <stdint.h>

#define CAT1_ENVELOPE_FUNC_TELEMETRY 0x01U
#define CAT1_ENVELOPE_FUNC_MAP_WRITE 0x02U
#define CAT1_ENVELOPE_FUNC_MAP_ACK   0x03U
#define CAT1_ENVELOPE_FUNC_ERROR     0xFFU

#define CAT1_ENVELOPE_META_BOOT_ID           (1U << 0U)
#define CAT1_ENVELOPE_META_REQUEST_ID        (1U << 1U)
#define CAT1_ENVELOPE_META_TTL_MS            (1U << 2U)
#define CAT1_ENVELOPE_META_EXPECTED_REVISION (1U << 3U)

typedef struct
{
    uint32_t boot_id;
    uint32_t request_id;
    uint32_t ttl_ms;
    uint32_t expected_revision;
    uint8_t flags;
} Cat1EnvelopeMeta;

typedef struct
{
    Cat1EnvelopeMeta meta;
    uint8_t func_code;
    const uint8_t *data;
    uint16_t data_length;
    uint8_t data_is_object;
} Cat1EnvelopeView;

/**
 * 严格解析顶层字段并拒绝重复或未知字段。
 * func=2 为兼容旧平台允许省略 `_meta`；其他功能码仍要求完整信封。
 */
uint8_t Cat1Envelope_Parse(const uint8_t *json, uint16_t length,
                           Cat1EnvelopeView *view);

/** 将 func=2 的 meta 和 data 对象投影为现有 Map 的 `0x00+JSON`。 */
uint8_t Cat1Envelope_BuildMapPayload(const Cat1EnvelopeView *view,
                                     uint8_t *output,
                                     uint16_t output_capacity,
                                     uint16_t *output_length);

/** 用规范化 meta 和已验证的 JSON data 构造 MQTT 业务信封。 */
uint8_t Cat1Envelope_Build(const Cat1EnvelopeMeta *meta, uint8_t func_code,
                           const uint8_t *data, uint16_t data_length,
                           uint8_t *output, uint16_t output_capacity,
                           uint16_t *output_length);

#endif
