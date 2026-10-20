#ifndef KZ3_DATA_MANAGER_H
#define KZ3_DATA_MANAGER_H

#include <stdbool.h>
#include <stdint.h>

#include "logic_parameter_store.h"
#include "point_config.h"

typedef enum
{
    DATA_MANAGER_OK = 0,
    DATA_MANAGER_INVALID_ARGUMENT,
    DATA_MANAGER_NOT_FOUND,
    DATA_MANAGER_TYPE_MISMATCH,
    DATA_MANAGER_READ_ONLY,
    DATA_MANAGER_REVISION_CONFLICT,
    DATA_MANAGER_BUSY,
    DATA_MANAGER_PERSISTENCE_ERROR,
    DATA_MANAGER_REJECTED,
    DATA_MANAGER_STOP_PENDING
} DataManagerResult;

typedef enum
{
    DATA_MANAGER_FAULT_NONE = 0U,
    DATA_MANAGER_FAULT_CONFIGURATION = 1U << 0U,
    DATA_MANAGER_FAULT_INPUT_QUALITY = 1U << 1U,
    DATA_MANAGER_FAULT_LOGIC_SCAN = 1U << 2U,
    DATA_MANAGER_FAULT_SOUTHBOND = 1U << 3U,
    DATA_MANAGER_FAULT_HEALTH = 1U << 4U
} DataManagerFault;

#define DATA_MANAGER_FAULT_EVENT_COUNT 5U

/* 故障来源是稳定的诊断分类；具体故障码仍是唯一可用于程序判断的字段。 */
typedef enum
{
    DATA_MANAGER_FAULT_SOURCE_NONE = 0U,
    DATA_MANAGER_FAULT_SOURCE_CONFIGURATION,
    DATA_MANAGER_FAULT_SOURCE_INPUT,
    DATA_MANAGER_FAULT_SOURCE_LOGIC,
    DATA_MANAGER_FAULT_SOURCE_SOUTHBOND,
    DATA_MANAGER_FAULT_SOURCE_HEALTH
} DataManagerFaultSource;

/* M1 只保留固定大小的实时故障摘要；报警确认、历史队列和掉电保存属于 M2。 */
typedef struct
{
    DataManagerFault code;
    DataManagerFaultSource source;
    bool active;
    bool latched;
    /* M1 尚无逐故障附加上下文，固定为 0；M2 再冻结 detail 编码。 */
    uint32_t detail;
    uint32_t first_seen_ms;
    uint32_t last_seen_ms;
} DataManagerFaultEvent;

/*
 * 唯一运行数据 owner。Begin/Commit/Abort 和命令屏障只允许控制 owner 调用；
 * Publish、Write、Submit、Read/Copy 是任务间短临界区入口，但均禁止 ISR 调用。
 * 网络、RTU 和 HMI 不得缓存或直接修改 LogicContext 内部成员。
 */
typedef struct
{
    LogicContext active;
    LogicContext working;
    /* 网络/HMI 任务写入此槽；控制扫描开始时一次性交换到 working.command。 */
    LogicCommands pending_commands;
    /* 命令屏障由控制 owner 建立/完成；跨任务提交仅能在短临界区写待消费槽。 */
    uint32_t command_epoch;
    uint32_t parameter_revision;
    LogicParameterStore parameter_store;
    uint32_t scan_sequence;
    /* fault_flags 是需 reset 确认的锁存故障；active_fault_flags 表示根因仍存在。 */
    uint32_t fault_flags;
    uint32_t active_fault_flags;
    DataManagerFaultEvent fault_events[DATA_MANAGER_FAULT_EVENT_COUNT];
    bool initialized;
    bool scan_open;
    bool parameter_write_busy;
    bool command_barrier_closed;
    bool stop_requested;
} DataManager;

/** @brief 面向 HMI/诊断/遥测的只读过程投影，不形成第二份运行 owner。 */
typedef struct
{
    uint16_t di_bitmap;
    uint8_t do_target_bitmap;
    uint16_t ai_ua[4];
    uint16_t ao_ua[2];
    uint16_t io_quality;
    uint32_t fault_flags;
    uint32_t fault_code;
    uint32_t fault_detail;
    uint32_t fault_first_seen_ms;
    uint32_t fault_last_seen_ms;
    uint8_t fault_source;
    uint8_t fault_active;
    uint8_t fault_latched;
} DataManagerProcessSnapshot;

void DataManager_Init(DataManager *manager);

DataManagerResult DataManager_PublishBoolInput(
    DataManager *manager, const char *bind, bool value,
    PointConfigQuality quality, uint32_t update_ms);
/** update_ms 是源样本完成时间；重复发布缓存值不得替换为当前扫描时间。 */
DataManagerResult DataManager_PublishF32Input(
    DataManager *manager, const char *bind, float value,
    PointConfigQuality quality, uint32_t update_ms);
DataManagerResult DataManager_PublishU16Input(
    DataManager *manager, const char *bind, uint16_t value,
    PointConfigQuality quality, uint32_t update_ms);

typedef struct
{
    const char *bind;
    PointConfigValueType type;
    union
    {
        bool boolean;
        int32_t s32;
        float f32;
    } value;
} DataManagerExternalWriteItem;

/* 北向外部状态只写 RAM；每次合法写入（包括同值）都会刷新接收时间。 */
DataManagerResult DataManager_WriteExternalBool(
    DataManager *manager, const char *bind, bool value, uint32_t received_ms);
DataManagerResult DataManager_WriteExternalS32(
    DataManager *manager, const char *bind, int32_t value, uint32_t received_ms);
DataManagerResult DataManager_WriteExternalF32(
    DataManager *manager, const char *bind, float value, uint32_t received_ms);
/* 同一上级报文中的外部样本共用接收时间，校验全部通过后原子提交。 */
DataManagerResult DataManager_WriteExternalBatch(
    DataManager *manager, const DataManagerExternalWriteItem *items,
    uint16_t item_count, uint32_t received_ms);

/* 逻辑扫描只能由 Begin/Commit 包围；Begin 会原子交换待消费命令，Commit
 * 只发布 output/state，不能清除扫描期间新到达的 one-shot 命令。 */
DataManagerResult DataManager_BeginLogicScan(DataManager *manager,
                                             uint32_t now_ms,
                                             LogicContext **context);
DataManagerResult DataManager_CommitLogicScan(DataManager *manager,
                                              const LogicContext *context);
void DataManager_AbortLogicScan(DataManager *manager, DataManagerFault fault);

DataManagerResult DataManager_WriteParameterF32(DataManager *manager,
                                                const char *bind, float value,
                                                uint32_t expected_revision,
                                                uint32_t *new_revision);
DataManagerResult DataManager_WriteParameterBool(DataManager *manager,
                                                 const char *bind, bool value,
                                                 uint32_t expected_revision,
                                                 uint32_t *new_revision);
/**
 * @brief 以 CAS 语义写入 U32 项目参数，并执行点表范围与持久化策略。
 * @note 仅允许任务上下文调用；成功后参数从下一次逻辑扫描生效。
 */
DataManagerResult DataManager_WriteParameterU32(DataManager *manager,
                                                const char *bind,
                                                uint32_t value,
                                                uint32_t expected_revision,
                                                uint32_t *new_revision);
DataManagerResult DataManager_SubmitBoolCommand(DataManager *manager,
                                                const char *bind, bool value);
/** @brief 控制 owner 建立 STOP/FAULT/reset 屏障，清除旧 normal 命令。 */
void DataManager_CloseCommandBarrier(DataManager *manager);
/**
 * @brief 控制 owner 以生成安全值结束当前扫描；条件允许时线性化地重开命令屏障。
 * @return 已重新开放屏障返回 true；仍有 STOP 或故障时保持关闭并返回 false。
 */
bool DataManager_CompleteSafeTransition(DataManager *manager);
DataManagerResult DataManager_ReadBool(const DataManager *manager,
                                       const char *bind, bool *value,
                                       PointConfigQuality *quality);
DataManagerResult DataManager_ReadF32(const DataManager *manager,
                                      const char *bind, float *value,
                                      PointConfigQuality *quality);
/** @brief 读取 U16 输入采样或输出目标；不隐含量程、单位或缩放。 */
DataManagerResult DataManager_ReadU16(const DataManager *manager,
                                      const char *bind, uint16_t *value,
                                      PointConfigQuality *quality);
/** @brief 读取项目 u32 状态；当前 u32 不作为模拟采样值，质量固定为 GOOD。 */
DataManagerResult DataManager_ReadU32(const DataManager *manager,
                                      const char *bind, uint32_t *value,
                                      PointConfigQuality *quality);
DataManagerResult DataManager_ReadS32(const DataManager *manager,
                                      const char *bind, int32_t *value,
                                      PointConfigQuality *quality);

/* 仅供控制任务在同一调度上下文读取输出快照；网络/HMI 不得跨任务长期持有
 * 返回指针，应使用 DataManager_Read* 或其各自的只读投影。 */
const LogicContext *DataManager_GetSnapshot(const DataManager *manager);
/** @brief 在 owner 临界区内复制完整活动过程映像，供跨任务只读投影使用。 */
DataManagerResult DataManager_CopySnapshot(const DataManager *manager,
                                           LogicContext *snapshot);
/** @brief 仅复制南向提交所需的输出区，目标对象由控制 owner 私有持有。 */
DataManagerResult DataManager_CopyOutputSnapshot(
    const DataManager *manager, LogicContext *snapshot);
DataManagerResult DataManager_CopyProcessSnapshot(
    const DataManager *manager, DataManagerProcessSnapshot *snapshot);
uint32_t DataManager_GetParameterRevision(const DataManager *manager);
void DataManager_GetParameterPersistenceDiagnostic(
    const DataManager *manager,
    LogicParameterStoreDiagnostic *diagnostic);
/** @brief 返回当前项目的参数恢复策略是否允许执行项目初始化/扫描。 */
bool DataManager_AreParametersReady(const DataManager *manager);
uint32_t DataManager_GetFaultFlags(const DataManager *manager);
uint32_t DataManager_GetActiveFaultFlags(const DataManager *manager);
bool DataManager_GetFaultEvent(const DataManager *manager, uint8_t index,
                               DataManagerFaultEvent *event);
void DataManager_SetFaultAt(DataManager *manager, DataManagerFault fault,
                            uint32_t now_ms);
void DataManager_SetFault(DataManager *manager, DataManagerFault fault);
/** @brief 故障源 owner 更新根因状态；解除只清 active，锁存位仍等待 reset。 */
void DataManager_SetFaultCondition(DataManager *manager, DataManagerFault fault,
                                   bool active, uint32_t now_ms);
/** @brief reset owner 仅清除已经解除根因的锁存故障。 */
void DataManager_ClearFault(DataManager *manager, DataManagerFault fault);

#endif
