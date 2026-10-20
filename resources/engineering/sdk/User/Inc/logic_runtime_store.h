#ifndef KZ3_LOGIC_RUNTIME_STORE_H
#define KZ3_LOGIC_RUNTIME_STORE_H

#include <stdbool.h>
#include <stdint.h>

#include "point_config.h"
#include "wireless_eeprom_layout.h"

/* 仅由本模块访问的 EEPROM owner；不得与既有 SN/网络/SLE owner 重叠。 */
#define LOGIC_RUNTIME_STORE_SYSTEM_ADDRESS WIRELESS_EEPROM_SYSTEM_LIFETIME_BEGIN
#define LOGIC_RUNTIME_STORE_RUNTIME_BASE   WIRELESS_EEPROM_LOGIC_RUNTIME_BEGIN
#define LOGIC_RUNTIME_STORE_RECORD_SIZE    16U
#define LOGIC_RUNTIME_STORE_SLOT_COUNT     16U
/* 连续运行时的掉电恢复上限；停止事件会绕过该周期立即请求保存。 */
#define LOGIC_RUNTIME_STORE_RUNTIME_CHECKPOINT_MS  300000UL

typedef enum
{
    LOGIC_RUNTIME_STORE_OPERATION_NONE = 0U,
    LOGIC_RUNTIME_STORE_OPERATION_WRITE,
    LOGIC_RUNTIME_STORE_OPERATION_READ
} LogicRuntimeStoreOperationType;

typedef struct
{
    LogicRuntimeStoreOperationType type;
    uint16_t address;
    uint8_t length;
    uint8_t data[LOGIC_RUNTIME_STORE_RECORD_SIZE];
} LogicRuntimeStoreOperation;

typedef struct
{
    uint32_t desired_seconds;
    uint32_t persisted_seconds;
    uint32_t key_hash;
    uint32_t sequence;
    uint32_t retry_after_ms;
    uint32_t completion_seconds;
    uint32_t completion_sequence;
    bool queued;
    bool clear_request;
    bool fault;
    bool completion_ready;
    bool completion_clear;
} LogicRuntimeStoreSlot;

typedef struct
{
    uint32_t boot_count;
    uint32_t total_seconds;
    uint32_t persisted_seconds;
    uint32_t retry_after_ms;
    bool queued;
    bool valid;
    bool fault;
    bool tick_initialized;
    uint32_t last_tick_ms;
    uint16_t millisecond_remainder;
} LogicRuntimeStoreSystem;

typedef struct
{
    bool active;
    uint8_t phase;
    uint8_t slot;
    uint32_t sequence;
    uint32_t seconds;
    uint32_t key_hash;
    bool clear_request;
} LogicRuntimeStoreTransaction;

typedef struct
{
    LogicRuntimeStoreSystem system;
    LogicRuntimeStoreSlot slots[LOGIC_RUNTIME_STORE_SLOT_COUNT];
    LogicRuntimeStoreTransaction transaction;
    uint8_t round_robin_next;
    uint32_t fault_mask;
} LogicRuntimeStore;

void LogicRuntimeStore_Init(LogicRuntimeStore *store);

/* 启动阶段读取并准备 SystemLifetime；无效页按新项目规则从 0 自愈但锁存 fault。 */
void LogicRuntimeStore_LoadSystem(LogicRuntimeStore *store);
/* 启动阶段同步提交本次 boot count；失败不阻塞控制，后续由维护循环重试。 */
bool LogicRuntimeStore_CommitStartup(LogicRuntimeStore *store, uint32_t now_ms);
void LogicRuntimeStore_LoadRuntime(LogicRuntimeStore *store, uint8_t slot,
                                   uint32_t key_hash, uint32_t *seconds);

void LogicRuntimeStore_UpdateSystemTime(LogicRuntimeStore *store,
                                         uint32_t now_ms);
void LogicRuntimeStore_RequestSystemSave(LogicRuntimeStore *store,
                                         uint32_t now_ms);
void LogicRuntimeStore_RequestRuntimeSave(LogicRuntimeStore *store, uint8_t slot,
                                          uint32_t key_hash, uint32_t seconds,
                                          uint32_t sequence, bool clear_request,
                                          uint32_t now_ms);

/* 调用方在短临界区内 Begin/Finish；两者之间只能执行 op 描述的一次物理 EEPROM 调用。 */
bool LogicRuntimeStore_BeginOperation(LogicRuntimeStore *store, uint32_t now_ms,
                                      LogicRuntimeStoreOperation *operation);
void LogicRuntimeStore_FinishOperation(LogicRuntimeStore *store, uint32_t now_ms,
                                       const LogicRuntimeStoreOperation *operation,
                                       bool success);

bool LogicRuntimeStore_TakeRuntimeCompletion(LogicRuntimeStore *store,
                                              uint8_t slot, uint32_t *sequence,
                                              uint32_t *seconds, bool *clear_request);
void LogicRuntimeStore_GetSystemSnapshot(const LogicRuntimeStore *store,
                                         uint32_t *boot_count,
                                         uint32_t *total_seconds,
                                         bool *boot_count_valid,
                                         uint32_t *fault_mask,
                                         bool *busy);

#endif
