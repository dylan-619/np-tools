#ifndef KZ3_EDGE_TCP_PROTOCOL_H
#define KZ3_EDGE_TCP_PROTOCOL_H

#include <stdint.h>

#include "sle_protocol.h"

#define EDGE_TCP_PROTOCOL_MAX_FRAME_SIZE   1024U
#define EDGE_TCP_PROTOCOL_LINE_BUFFER_SIZE 1026U

#define EDGE_TCP_FUNC_HEARTBEAT 0U
#define EDGE_TCP_FUNC_TELEMETRY 1U
#define EDGE_TCP_FUNC_MAP_WRITE 2U
#define EDGE_TCP_FUNC_MAP_ACK   3U
#define EDGE_TCP_FUNC_ERROR     255U

typedef enum
{
    EDGE_TCP_LINE_INCOMPLETE = 0U,
    EDGE_TCP_LINE_COMPLETE,
    EDGE_TCP_LINE_EMPTY,
    EDGE_TCP_LINE_TOO_LARGE,
    EDGE_TCP_LINE_INVALID
} EdgeTcpLineResult;

/** TCP 单行 JSON 的固定缓冲分帧状态。 */
typedef struct
{
    uint8_t *buffer;
    uint16_t capacity;
    uint16_t length;
    uint8_t complete;
} EdgeTcpLineStream;

/** 解析后的零拷贝视图；指针只在输入 frame 有效期内可用。 */
typedef struct
{
    const uint8_t *sn;
    uint16_t sn_length;
    SleMapWriteMeta meta;
    const uint8_t *data;
    uint16_t data_length;
    uint8_t func_code;
} EdgeTcpEnvelopeView;

/** 绑定调用方提供的至少 1026 B 缓冲，容纳 1024 B JSON、可选 CR 和 NUL。 */
void EdgeTcpLine_Init(EdgeTcpLineStream *stream, uint8_t *buffer,
                      uint16_t capacity);

/** 处理完成帧后显式清空；不清空时 PushByte 返回 INVALID。 */
void EdgeTcpLine_Reset(EdgeTcpLineStream *stream);

/**
 * @brief 追加一个 TCP 字节并按 LF 分帧。
 * @param frame_length COMPLETE 时返回不含 CR/LF 的 JSON 长度。
 */
EdgeTcpLineResult EdgeTcpLine_PushByte(EdgeTcpLineStream *stream,
                                      uint8_t byte,
                                      uint16_t *frame_length);

/** 严格解析 sn/func_code/_meta/data 四个顶层字段。 */
uint8_t EdgeTcpProtocol_Parse(const uint8_t *json, uint16_t length,
                              EdgeTcpEnvelopeView *view);

/** 生成带 LF 的心跳帧；output_length 包含 LF。 */
uint8_t EdgeTcpProtocol_BuildHeartbeat(
    const uint8_t sn[12], uint32_t boot_id, uint8_t *output,
    uint16_t output_capacity, uint16_t *output_length);

/** 生成带 LF 的遥测帧；data 必须是完整 JSON object。 */
uint8_t EdgeTcpProtocol_BuildTelemetry(
    const uint8_t sn[12], uint32_t boot_id, const uint8_t *data,
    uint16_t data_length, uint8_t *output, uint16_t output_capacity,
    uint16_t *output_length);

/** func_code 只允许 3 或 255；data 必须是完整 ACK object。 */
uint8_t EdgeTcpProtocol_BuildAck(
    const uint8_t sn[12], uint32_t boot_id, uint32_t request_id,
    uint8_t func_code, const uint8_t *data, uint16_t data_length,
    uint8_t *output, uint16_t output_capacity, uint16_t *output_length);

/** 把 Edge func=2 的 meta + data 投影为现有 `0x00 + Map JSON`。 */
uint8_t EdgeTcpProtocol_BuildMapPayload(
    const EdgeTcpEnvelopeView *view, uint8_t *output,
    uint16_t output_capacity, uint16_t *output_length);

#endif
