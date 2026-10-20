#ifndef INC_SLE_PROTOCOL_H_
#define INC_SLE_PROTOCOL_H_

#include <stdint.h>

#include "north_contract.h"

#define SLE_PROTOCOL_MAGIC0 0xA5U
#define SLE_PROTOCOL_MAGIC1 0x5AU
#define SLE_PROTOCOL_VERSION 0x01U
#define SLE_PROTOCOL_HEADER_LEN 20U
#define SLE_PROTOCOL_FIXED_OVERHEAD 22U
#define SLE_PROTOCOL_MIN_FRAME_SIZE 23U
#define SLE_PROTOCOL_MAX_PAYLOAD 744U
#define SLE_PROTOCOL_MAX_FRAME_SIZE 766U
#define SLE_PROTOCOL_MAX_TELEMETRY_JSON_BYTES \
    (SLE_PROTOCOL_MAX_PAYLOAD - 14U)
#define SLE_PROTOCOL_PHYSICAL_HEADER_LEN 4U
#define SLE_PROTOCOL_MAX_PHYSICAL_FRAME_SIZE 770U
#define SLE_PROTOCOL_MAX_RECV_BUFFER 4096U

#define SLE_FUNC_TELEMETRY 0x01U
#define SLE_FUNC_MAP_WRITE 0x02U
#define SLE_FUNC_MAP_WRITE_ACK 0x03U

/** 最新应用帧解析后的只读视图；指针字段指向调用方提供的原始缓冲区。 */
typedef struct
{
    uint8_t version;
    const uint8_t *sn;
    uint16_t local_addr;
    uint8_t func_code;
    const uint8_t *payload;
    uint16_t payload_len;
} SleProtocolFrameView;

/** UART2 字节流缓存，支持半帧、粘包和噪声重同步。 */
typedef struct
{
    uint8_t *data;
    uint16_t capacity;
    uint16_t len;
} SleProtocolStream;

/** 计算 CRC16-MODBUS，结果按协议约定以低字节在前保存。 */
uint16_t SleProtocol_Crc16(const uint8_t *data, uint16_t len);

/**
 * @brief 构造最新 JSON 应用帧。
 * @param compress_json 保留的兼容参数；实际按 Python 行为仅对遥测功能码压缩。
 * @note 遥测输入最多 730B，输出为 zlib 包装的 Deflate（无收益时 stored 回退）。
 *       在可抢占的任务上下文调用；固定栈工作区，无堆和共享可变压缩状态。
 *       json/sn 与 out 不重叠；容量不足返回 1，只有成功才更新 out_len。
 */
uint8_t SleProtocol_BuildJsonFrame(uint8_t *out, uint16_t capacity,
                                   const uint8_t *sn, uint16_t local_addr,
                                   uint8_t func_code, const uint8_t *json,
                                   uint16_t json_len, uint8_t compress_json,
                                   uint16_t *out_len);

/** 校验并解析一帧最新应用数据。 */
uint8_t SleProtocol_ParseFrame(const uint8_t *frame, uint16_t frame_len,
                               SleProtocolFrameView *view);

/** 增加物理层 `AA + remote_addr(BE) + 55` 封装。 */
uint8_t SleProtocol_BuildPhysicalFrame(uint8_t *out, uint16_t capacity,
                                        const uint8_t *app_frame,
                                        uint16_t app_len, uint16_t remote_addr,
                                        uint16_t *out_len);

/** 绑定调用方提供的固定流缓冲；buffer 生命周期必须覆盖 stream。 */
void SleProtocol_StreamInit(SleProtocolStream *stream, uint8_t *buffer,
                            uint16_t capacity);

/** 追加串口字节；超出 4096 字节时丢弃最旧数据。 */
uint8_t SleProtocol_StreamAppend(SleProtocolStream *stream,
                                 const uint8_t *data, uint16_t len);

/**
 * @brief 从字节流提取一帧应用数据。
 * @return 0 表示尚未形成完整帧，1 表示成功提取，2 表示输出缓冲不足。
 *         返回的 frame 不包含物理层 4 字节路由前缀。
 */
uint8_t SleProtocol_StreamNext(SleProtocolStream *stream, uint8_t *frame,
                               uint16_t capacity, uint16_t *frame_len,
                               uint16_t *remote_addr);

#define SLE_MAP_WRITE_MAX_ENTRIES 32U
#define SLE_MAP_WRITE_MAX_PAYLOAD_BYTES 744U
#define SLE_MAP_WRITE_MAX_JSON_BYTES (SLE_MAP_WRITE_MAX_PAYLOAD_BYTES - 1U)
#define SLE_MAP_ACK_MAX_JSON_BYTES 256U
#define SLE_PROTOCOL_MAP_MAX_SOURCE_BINDINGS 4U

typedef uint16_t SleMapWriteMetaFlags;
#define SLE_MAP_WRITE_META_BOOT_ID           (1U << 0)
#define SLE_MAP_WRITE_META_REQUEST_ID        (1U << 1)
#define SLE_MAP_WRITE_META_TTL_MS            (1U << 2)
#define SLE_MAP_WRITE_META_EXPECTED_REVISION (1U << 3)

typedef struct
{
    uint32_t boot_id;
    uint32_t request_id;
    uint32_t ttl_ms;
    uint32_t expected_revision;
    SleMapWriteMetaFlags flags;
} SleMapWriteMeta;

typedef struct
{
    NorthRoute route;
    LogicPointValue value;
} SleMapWriteEntry;

typedef struct
{
    SleMapWriteMeta meta;
    SleMapWriteEntry entries[SLE_MAP_WRITE_MAX_ENTRIES];
    uint16_t entry_count;
} SleMapWriteBatch;

typedef uint16_t SleMapAckStatus;
#define SLE_MAP_ACK_NONE           0U
#define SLE_MAP_ACK_COMMITTED      1U
#define SLE_MAP_ACK_PENDING_SCAN   2U
#define SLE_MAP_ACK_PENDING_REBOOT 3U
#define SLE_MAP_ACK_REQUIRES_STOP  4U
#define SLE_MAP_ACK_REJECTED       5U
#define SLE_MAP_ACK_FAILED         6U
#define SLE_MAP_ACK_ACCEPTED       7U

typedef struct
{
    SleMapAckStatus status;
    LogicResult result;
    uint32_t request_id;
    uint32_t persisted_revision;
    uint32_t active_revision;
    LogicCommandSeq command_seq;
    uint16_t failed_north_key_id;
    LogicBool has_request_id;
    LogicBool has_revision;
    LogicBool has_command_seq;
    uint8_t reserved[1];
} SleMapWriteAck;

/** 解析 `0x00 + Map JSON` 并按生成点表解析键名和类型。 */
LogicResult SleMapWrite_Parse(
    const uint8_t *payload, uint16_t payload_length,
    const NorthKeyGeneratedTable *generated_table, SleMapWriteBatch *batch);

/** 把统一 Map 写结果编码为有界 JSON object。 */
LogicResult SleMapWriteAck_EncodeJson(
    const SleMapWriteAck *ack,
    const NorthKeyGeneratedTable *generated_table,
    uint8_t *output, uint16_t output_capacity, uint16_t *output_length);

typedef struct
{
    uint16_t remote_addr;
    uint16_t reserved;
    uint32_t source_identity;
    LogicRole role;
    uint16_t reserved_role;
} SleMapSourceBinding;

typedef LogicResult (*SleMapV2WriteHandler)(
    void *context, const NorthKeyGeneratedTable *generated_table,
    const SleMapWriteBatch *batch,
    const LogicWriteContext *write_context, SleMapWriteAck *ack);

/**
 * @brief SLE 协议内部 Map 子系统状态。
 *
 * 该对象不拥有点位或业务数据，只保存生成路由、Network 写入口和单请求固定缓冲。
 */
typedef struct
{
    uint32_t boot_id;
    const NorthKeyGeneratedTable *generated_table;
    SleMapSourceBinding bindings[SLE_PROTOCOL_MAP_MAX_SOURCE_BINDINGS];
    uint16_t binding_count;
    uint16_t reserved;
    LogicModeSnapshotProvider safety_provider;
    void *safety_context;
    SleMapV2WriteHandler v2_write_handler;
    void *v2_write_context;
    SleMapWriteBatch batch;
    uint8_t ack_json[SLE_MAP_ACK_MAX_JSON_BYTES];
    LogicBool response_pending;
    uint8_t response_reserved[3];
    uint16_t response_remote_addr;
    uint16_t response_reserved_addr;
} SleProtocolMap;

LogicResult SleProtocolMap_Init(
    SleProtocolMap *map, const NorthKeyGeneratedTable *generated_table,
    uint32_t boot_id, LogicModeSnapshotProvider safety_provider,
    void *safety_context);
LogicResult SleProtocolMap_BindWriteHandler(
    SleProtocolMap *map, SleMapV2WriteHandler handler, void *context);
uint32_t SleProtocolMap_GetBootId(const SleProtocolMap *map);
LogicResult SleProtocolMap_HandleFrame(SleProtocolMap *map,
                                       const SleProtocolFrameView *view,
                                       uint16_t remote_addr,
                                       uint32_t now_tick_ms,
                                       uint8_t *ack_frame,
                                       uint16_t ack_capacity,
                                       uint16_t *ack_length);
LogicResult SleProtocolMap_ResponseQueued(SleProtocolMap *map,
                                          uint16_t remote_addr);
LogicResult SleProtocolMap_ResponseDropped(SleProtocolMap *map,
                                           uint16_t remote_addr);

#endif
