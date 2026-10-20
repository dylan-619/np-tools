#ifndef KZ3_PLC_RTU_ENGINE_V2_H
#define KZ3_PLC_RTU_ENGINE_V2_H

/* Southbound 的内部 RTU 状态机契约。虽位于统一头文件目录，仍不得由
 * Logic、Network、HMI 或其他业务模块直接依赖。 */

#include <stdbool.h>
#include <stdint.h>

#define PLC_V2_RTU_MAX_FRAME 256U
#define PLC_V2_RTU_MAX_WRITE_REGISTERS 8U

typedef enum
{
    PLC_V2_RTU_IDLE = 0,
    PLC_V2_RTU_WAIT_RESPONSE,
    PLC_V2_RTU_OFFLINE
} PlcV2RtuState;

typedef enum
{
    PLC_V2_RTU_RESULT_OK = 0,
    PLC_V2_RTU_RESULT_BUSY,
    PLC_V2_RTU_RESULT_INVALID,
    PLC_V2_RTU_RESULT_CRC_ERROR,
    PLC_V2_RTU_RESULT_EXCEPTION,
    PLC_V2_RTU_RESULT_TIMEOUT,
    PLC_V2_RTU_RESULT_OFFLINE
} PlcV2RtuResult;

typedef struct
{
    uint8_t slave_address;
    uint8_t function;
    uint16_t pdu_address;
    uint16_t quantity;
    uint16_t response_timeout_ms;
    uint8_t retry_count;
    uint16_t offline_backoff_ms;
    uint16_t period_ms;
    uint16_t write_bitmask;
    bool enabled;
    uint16_t *write_registers;
    /* 仅用于本地输出 owner 的事务代次匹配，不进入 Modbus 帧。 */
    uint32_t target_generation;
    /* 安全写可在当前不可中断事务完成后优先调度。 */
    bool safety_priority;
} PlcV2RtuRequest;

typedef struct
{
    PlcV2RtuState state;
    PlcV2RtuRequest request;
    uint8_t frame[PLC_V2_RTU_MAX_FRAME];
    uint16_t frame_length;
    uint8_t retries;
    uint32_t deadline_ms;
    uint32_t offline_until_ms;
} PlcV2RtuPort;

/* 仅当帧已经被底层接收排队时返回 true；false 表示端口繁忙，RTU 引擎不得
 * 进入等待响应状态。该约束避免异步 UART 队列满时把未发送请求误判为超时。 */
typedef bool (*PlcV2RtuSendFrameFn)(void *context,
                                    const uint8_t *frame, uint16_t length);

typedef struct
{
    PlcV2RtuPort master;
    PlcV2RtuSendFrameFn send_frame;
    void *send_context;
} PlcV2RtuIoPort;

#define PLC_V2_RTU_ENGINE_PORT_COUNT 2U
#define PLC_V2_RTU_ENGINE_MAX_POLLS 32U
#define PLC_V2_RTU_ENGINE_MAX_PEERS 16U
#define PLC_V2_RTU_ENGINE_MAX_SAFETY_BURST 2U

typedef struct
{
    PlcV2RtuRequest requests[PLC_V2_RTU_ENGINE_MAX_POLLS];
    uint16_t count;
    uint16_t next_index;
    bool active;
} PlcV2RtuEnginePortConfig;

typedef struct
{
    uint32_t cooldown_until_ms;
    PlcV2RtuResult last_result;
    uint16_t consecutive_failures;
    uint8_t port_id;
    uint8_t slave_address;
    bool valid;
} PlcV2RtuPeer;

typedef void (*PlcV2RtuEngineResponseFn)(void *context, uint8_t port_id,
                                         const PlcV2RtuRequest *request,
                                         PlcV2RtuResult result,
                                         const uint8_t *response,
                                         uint16_t response_length);

typedef struct
{
    PlcV2RtuSendFrameFn send_frame[PLC_V2_RTU_ENGINE_PORT_COUNT];
    void *send_context[PLC_V2_RTU_ENGINE_PORT_COUNT];
    PlcV2RtuEngineResponseFn response;
    void *response_context;
} PlcV2RtuEngineConfig;

typedef struct
{
    PlcV2RtuIoPort io;
    PlcV2RtuEnginePortConfig plan;
    uint16_t active_index;
    /* 事务副本冻结 payload 指针和代次，回调不得引用可变计划条目。 */
    PlcV2RtuRequest active_request;
    uint16_t active_write_registers[PLC_V2_RTU_MAX_WRITE_REGISTERS];
    uint8_t request_peer_index[PLC_V2_RTU_ENGINE_MAX_POLLS];
    uint16_t normal_cursor;
    uint16_t safety_cursor;
    uint8_t safety_burst_count;
    /* 当前事务首次成功进入 UART 发送队列的 tick；响应耗时包含协议重试。 */
    uint32_t transaction_started_ms;
    /* 每条请求独立计时。端口级单一 due 会让同一设备的 N 个读块把
     * 完整采集周期错误放大为 N * period_ms。 */
    uint32_t request_due_ms[PLC_V2_RTU_ENGINE_MAX_POLLS];
    uint32_t queue_busy_since_ms;
    uint32_t completed_count;
    uint32_t error_count;
    bool queue_busy_active;
    bool transport_fault;
} PlcV2RtuEnginePort;

typedef struct
{
    PlcV2RtuEngineConfig config;
    PlcV2RtuEnginePort ports[PLC_V2_RTU_ENGINE_PORT_COUNT];
    PlcV2RtuPeer peers[PLC_V2_RTU_ENGINE_MAX_PEERS];
    uint8_t peer_count;
    bool initialized;
    bool finalized;
} PlcV2RtuEngine;

/* plans 可为 NULL，用于先初始化引擎、再在其私有存储内构建请求表。 */
bool PlcV2RtuEngine_Init(PlcV2RtuEngine *engine,
                         const PlcV2RtuEngineConfig *config,
                         const PlcV2RtuEnginePortConfig plans[
                             PLC_V2_RTU_ENGINE_PORT_COUNT]);

/* 构建固定 peer 表并冻结计划；运行前必须成功调用一次。 */
bool PlcV2RtuEngine_FinalizePlan(PlcV2RtuEngine *engine);

/* 每次调用每个端口最多启动一个事务，不阻塞等待响应。 */
void PlcV2RtuEngine_Step(PlcV2RtuEngine *engine, uint32_t now_ms);

/* 将已存在的 FC15/FC16 事件型写请求安排到端口下一次可用时执行。
 * 不改变其他周期读请求的独立到期时间。 */
bool PlcV2RtuEngine_RequestNow(PlcV2RtuEngine *engine, uint8_t port_id,
                               uint16_t request_index, uint32_t now_ms);

bool PlcV2RtuEngine_IsTransportReady(const PlcV2RtuEngine *engine);

PlcV2RtuResult PlcV2RtuEngine_AcceptResponse(PlcV2RtuEngine *engine,
                                             uint8_t port_id,
                                             const uint8_t *response,
                                             uint16_t response_length,
                                             uint32_t now_ms);

uint16_t PlcV2Rtu_Crc16(const uint8_t *data, uint16_t length);
void PlcV2RtuPort_Init(PlcV2RtuPort *port);
PlcV2RtuResult PlcV2RtuPort_Start(PlcV2RtuPort *port,
                                  const PlcV2RtuRequest *request,
                                  uint32_t now_ms);
PlcV2RtuResult PlcV2RtuPort_TakeFrame(const PlcV2RtuPort *port,
                                      uint8_t *output, uint16_t capacity,
                                      uint16_t *length);
PlcV2RtuResult PlcV2RtuPort_AcceptResponse(PlcV2RtuPort *port,
                                           const uint8_t *response,
                                           uint16_t length, uint32_t now_ms);
PlcV2RtuResult PlcV2RtuPort_Tick(PlcV2RtuPort *port, uint32_t now_ms);
void PlcV2RtuIoPort_Init(PlcV2RtuIoPort *port,
                         PlcV2RtuSendFrameFn send_frame, void *send_context);
PlcV2RtuResult PlcV2RtuIoPort_Start(PlcV2RtuIoPort *port,
                                    const PlcV2RtuRequest *request,
                                    uint32_t now_ms);
PlcV2RtuResult PlcV2RtuIoPort_AcceptResponse(PlcV2RtuIoPort *port,
                                             const uint8_t *response,
                                             uint16_t length, uint32_t now_ms);
PlcV2RtuResult PlcV2RtuIoPort_Tick(PlcV2RtuIoPort *port, uint32_t now_ms);

#endif
