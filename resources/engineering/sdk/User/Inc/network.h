#ifndef KZ3_NETWORK_MANAGER_H
#define KZ3_NETWORK_MANAGER_H

#include <stdbool.h>
#include <stdint.h>

#include "north_result.h"

/* 北向 Reference、变量契约和协议映射同属 Network；不再保留单独的
 * north_variable_service 模块。定义保持在本头文件前半段，使历史纯协议
 * 主机测试可以只编译这一段，不依赖固件的 DataManager/生成点表。 */
typedef enum
{
    PLC_V2_NORTH_COIL = 0,
    PLC_V2_NORTH_DISCRETE_INPUT,
    PLC_V2_NORTH_INPUT_REGISTER,
    PLC_V2_NORTH_HOLDING_REGISTER
} PlcV2NorthArea;

typedef struct
{
    PlcV2NorthArea area;
    uint8_t function_read;
    uint8_t function_write;
    uint16_t pdu_address;
} PlcV2NorthReference;

bool PlcV2North_ParseReference(const char *reference,
                               PlcV2NorthReference *parsed);
bool PlcV2North_IsWriteAllowed(const PlcV2NorthReference *reference,
                               bool read_write);

typedef enum
{
    PLC_V2_NORTH_VALUE_BOOL = 0,
    PLC_V2_NORTH_VALUE_F32,
    PLC_V2_NORTH_VALUE_U16,
    PLC_V2_NORTH_VALUE_U32,
    PLC_V2_NORTH_VALUE_S32
} PlcV2NorthValueType;

typedef struct
{
    PlcV2NorthValueType type;
    uint8_t quality;
    union
    {
        bool boolean;
        float f32;
        uint16_t u16;
        uint32_t u32;
        int32_t s32;
    } value;
} PlcV2NorthValue;

typedef bool (*PlcV2NorthReadFn)(void *context, PlcV2NorthValue *value);
typedef bool (*PlcV2NorthWriteFn)(void *context, const PlcV2NorthValue *value);
typedef bool (*PlcV2NorthTryLockFn)(void *context);
typedef void (*PlcV2NorthUnlockFn)(void *context);

typedef struct
{
    uint16_t protocol;
    uint16_t role;
    uint32_t source_identity;
    uint32_t boot_id;
    uint32_t request_id;
    uint32_t ttl_ms;
    uint32_t received_tick_ms;
    uint32_t expected_revision;
    bool expected_revision_valid;
    bool received_tick_valid;
} PlcV2NorthWriteContext;

typedef bool (*PlcV2NorthPrepareWriteFn)(
    void *context, const PlcV2NorthWriteContext *write_context);
typedef PlcV2NorthResult (*PlcV2NorthPrepareWriteResultFn)(
    void *context, const PlcV2NorthWriteContext *write_context);

typedef struct PlcV2NorthField PlcV2NorthField;
typedef struct
{
    uint16_t field_index;
    const PlcV2NorthField *field;
    const PlcV2NorthValue *value;
} PlcV2NorthWriteItem;

typedef bool (*PlcV2NorthWriteBatchFn)(
    void *context, const PlcV2NorthWriteItem *items, uint16_t item_count,
    const PlcV2NorthWriteContext *write_context);
typedef PlcV2NorthResult (*PlcV2NorthWriteBatchResultFn)(
    void *context, const PlcV2NorthWriteItem *items, uint16_t item_count,
    const PlcV2NorthWriteContext *write_context);

typedef enum
{
    /* 默认值保持历史字段走参数写门禁。 */
    PLC_V2_NORTH_WRITE_GATED = 0,
    /* STOP/START/RESET 等命令由 DataManager 命令屏障裁决，不等待参数 EEPROM。 */
    PLC_V2_NORTH_WRITE_COMMAND = 1,
    /* 外部状态写入只更新易失样本，不进入参数 CAS 或命令屏障。 */
    PLC_V2_NORTH_WRITE_EXTERNAL_INPUT = 2
} PlcV2NorthWriteClass;

typedef union
{
    struct
    {
        float minimum;
        float maximum;
    } f32;
    struct
    {
        uint32_t minimum;
        uint32_t maximum;
    } u32;
    struct
    {
        int32_t minimum;
        int32_t maximum;
    } s32;
} PlcV2NorthRange;

typedef struct
{
    volatile bool busy;
    PlcV2NorthTryLockFn try_lock;
    PlcV2NorthUnlockFn unlock;
    void *context;
} PlcV2NorthWriteGate;

struct PlcV2NorthField
{
    const char *name;
    const char *bind;
    PlcV2NorthReference reference;
    PlcV2NorthValueType type;
    bool writable;
    bool has_range;
    PlcV2NorthRange range;
    PlcV2NorthReadFn read;
    PlcV2NorthWriteFn write;
    void *context;
    PlcV2NorthWriteClass write_class;
};

typedef struct PlcV2NorthVariableService
{
    const PlcV2NorthField *fields;
    uint16_t field_count;
    PlcV2NorthWriteGate *write_gate;
    PlcV2NorthPrepareWriteFn prepare_write;
    PlcV2NorthPrepareWriteResultFn prepare_write_result;
    void *prepare_context;
    PlcV2NorthWriteBatchFn write_batch;
    PlcV2NorthWriteBatchResultFn write_batch_result;
    void *write_batch_context;
} PlcV2NorthVariableService;

PlcV2NorthResult PlcV2NorthVariableService_Init(
    PlcV2NorthVariableService *service, const PlcV2NorthField *fields,
    uint16_t field_count);
PlcV2NorthResult PlcV2NorthVariableService_InitWithGate(
    PlcV2NorthVariableService *service, const PlcV2NorthField *fields,
    uint16_t field_count, PlcV2NorthWriteGate *write_gate);
void PlcV2NorthVariableService_SetWriteGate(
    PlcV2NorthVariableService *service, PlcV2NorthWriteGate *write_gate);
PlcV2NorthResult PlcV2NorthVariableService_Read(
    const PlcV2NorthVariableService *service, uint16_t field_index,
    PlcV2NorthValue *value);
PlcV2NorthResult PlcV2NorthVariableService_ReadByName(
    const PlcV2NorthVariableService *service, const char *name,
    PlcV2NorthValue *value);
PlcV2NorthResult PlcV2NorthVariableService_Write(
    const PlcV2NorthVariableService *service, uint16_t field_index,
    const PlcV2NorthValue *value);
PlcV2NorthResult PlcV2NorthVariableService_WriteWithContext(
    const PlcV2NorthVariableService *service, uint16_t field_index,
    const PlcV2NorthValue *value, const PlcV2NorthWriteContext *write_context);
PlcV2NorthResult PlcV2NorthVariableService_WriteBatchWithContext(
    const PlcV2NorthVariableService *service,
    const PlcV2NorthWriteItem *items, uint16_t item_count,
    const PlcV2NorthWriteContext *write_context);
int32_t PlcV2NorthVariableService_FindByName(
    const PlcV2NorthVariableService *service, const char *name);
int32_t PlcV2NorthVariableService_FindByReference(
    const PlcV2NorthVariableService *service, PlcV2NorthArea area,
    uint16_t pdu_address);
PlcV2NorthResult PlcV2NorthVariableService_ReadByReference(
    const PlcV2NorthVariableService *service, PlcV2NorthArea area,
    uint16_t pdu_address, PlcV2NorthValue *value);

#include "data_manager.h"
#include "http_api.h"
#include "modbus_tcp_protocol.h"
#include "sle_protocol.h"

/** 单个协议来源的最近成功 Map 请求，只用于 RAM 幂等重放。 */
typedef struct
{
    uint8_t valid;
    uint8_t reserved[3];
    uint32_t boot_id;
    uint32_t request_id;
    uint32_t source_identity;
    uint32_t fingerprint;
    SleMapWriteAck last_ack;
} NetworkRequestCache;

/** @brief Network 内部协议适配状态；不拥有点位表或过程值。 */
typedef struct
{
    const PlcV2NorthVariableService *service;
    ModbusPointAccess modbus_fallback;
    uint8_t modbus_fallback_valid;
    LogicCommandSeq (*get_command_sequence)(void *context);
    void *command_sequence_context;
    uint32_t (*get_parameter_revision)(void *context);
    void *parameter_revision_context;
    uint32_t (*now_ms)(void *context);
    void *now_context;
    NetworkRequestCache sle_request_cache;
    NetworkRequestCache edge_request_cache;
} NetworkProtocolState;

/* HTTP、Modbus TCP、SLE 共享同一个 DataManager 映射，不持有第二份点位值。 */
typedef struct
{
    DataManager *data;
    PlcV2NorthField fields[POINT_CONFIG_NORTH_FIELD_COUNT];
    struct NetworkFieldContext *contexts;
    PlcV2NorthVariableService service;
    NetworkProtocolState protocol;
    bool initialized;
} Network;

bool Network_Init(Network *network, DataManager *data);
bool Network_BindTimeProvider(Network *network,
                              uint32_t (*now_ms)(void *context),
                              void *context);
const PlcV2NorthVariableService *Network_GetPointService(const Network *network);
PlcV2NorthResult NetworkProtocol_BuildModbusAccess(
    NetworkProtocolState *protocol, const ModbusPointAccess *fallback,
    ModbusPointAccess *access);
uint8_t NetworkProtocol_HandleHttpRequest(
    const HttpRequest *request, HttpResponse *response, void *context);
LogicResult NetworkProtocol_HandleSleWrite(
    void *context, const NorthKeyGeneratedTable *generated_table,
    const SleMapWriteBatch *batch, const LogicWriteContext *write_context,
    SleMapWriteAck *ack);
LogicResult NetworkProtocol_HandleEdgeWrite(
    void *context, const NorthKeyGeneratedTable *generated_table,
    const SleMapWriteBatch *batch, const LogicWriteContext *write_context,
    uint32_t now_tick_ms, SleMapWriteAck *ack);

#endif
