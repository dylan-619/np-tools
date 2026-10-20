#ifndef KZ3_LOGIC_MANAGER_H
#define KZ3_LOGIC_MANAGER_H

#include <stdbool.h>
#include <stdint.h>

#include "data_manager.h"
#include "logic_block_api.h"
#include "logic_runtime_store.h"

typedef enum
{
    LOGIC_MANAGER_BOOT_SAFE = 0,
    LOGIC_MANAGER_STOPPED,
    LOGIC_MANAGER_RUNNING,
    LOGIC_MANAGER_FAULT_SAFE,
    LOGIC_MANAGER_STARTUP_WAIT
} LogicManagerState;

typedef enum
{
    LOGIC_STARTUP_PENDING = 0,
    LOGIC_STARTUP_READY,
    LOGIC_STARTUP_FAILED
} LogicStartupStatus;

typedef LogicStartupStatus (*LogicStartupProvider)(void *context,
                                                   uint32_t now_ms);

typedef enum
{
    LOGIC_EXECUTION_NONE = 0,
    LOGIC_EXECUTION_INIT,
    LOGIC_EXECUTION_SCAN,
    LOGIC_EXECUTION_STOP
} LogicExecutionPhase;

typedef enum
{
    LOGIC_API_ERROR_NONE = 0,
    LOGIC_API_ERROR_CONTEXT = 1,
    LOGIC_API_ERROR_PHASE = 2,
    LOGIC_API_ERROR_INSTANCE = 3,
    LOGIC_API_ERROR_ARGUMENT = 4,
    LOGIC_API_ERROR_DUPLICATE = 5,
    LOGIC_API_ERROR_NUMERIC = 6,
    LOGIC_API_ERROR_PROJECT_FAULT = 7
} LogicApiErrorCode;

typedef enum
{
    LOGIC_API_NONE = 0,
    LOGIC_API_TON,
    LOGIC_API_TOF,
    LOGIC_API_TP,
    LOGIC_API_RISING_EDGE,
    LOGIC_API_FALLING_EDGE,
    LOGIC_API_COUNTER_UP,
    LOGIC_API_COUNTER_DOWN,
    LOGIC_API_SR,
    LOGIC_API_RS,
    LOGIC_API_DEBOUNCE,
    LOGIC_API_CLAMP,
    LOGIC_API_SCALE,
    LOGIC_API_HYSTERESIS,
    LOGIC_API_DEADBAND,
    LOGIC_API_FILTER,
    LOGIC_API_RATE_LIMIT,
    LOGIC_API_PID_STEP,
    LOGIC_API_PID_RESET,
    LOGIC_API_PID_TO_U16,
    LOGIC_API_REQUEST_FAULT,
    LOGIC_API_BIND_OWNER,
    LOGIC_API_PARAMETERS_READY
} LogicApiId;

typedef struct
{
    LogicApiErrorCode code;
    LogicApiId api_id;
    LogicExecutionPhase phase;
    uint16_t instance_id;
    uint16_t project_reason;
    uint16_t additional_error_count;
    uint32_t scan_sequence;
    uint32_t violation_count;
} LogicApiFault;

typedef struct
{
    bool active;
    bool previous_input;
    bool output;
    uint32_t started_ms;
} LogicManagerTimer;

typedef struct
{
    bool previous;
} LogicManagerEdge;

typedef struct
{
    uint32_t value;
    bool previous_count;
} LogicManagerCounter;

typedef struct
{
    bool output;
} LogicManagerLatch;

typedef struct
{
    bool candidate;
    bool output;
    uint32_t changed_ms;
} LogicManagerDebounce;

typedef struct
{
    float value;
    uint32_t last_step_ms;
    bool initialized;
} LogicManagerAnalogBlock;

typedef struct
{
    float integral;
    float filtered_derivative;
    float previous_measurement;
    float output;
    float error;
    float p_term;
    float i_term;
    float d_term;
    float unclamped_output;
    uint32_t last_step_ms;
    bool initialized;
    bool manual_mode;
    bool tracking_mode;
    bool saturated_high;
    bool saturated_low;
    bool integral_held;
} LogicManagerPid;

typedef struct
{
    uint32_t total_seconds;
    uint32_t persisted_seconds;
    uint32_t dirty_since_ms;
    uint32_t request_sequence;
    uint32_t clear_sequence;
    uint32_t post_clear_seconds;
    uint32_t last_tick_ms;
    uint16_t millisecond_remainder;
    uint16_t post_clear_millisecond_remainder;
    bool baseline_ready;
    bool previous_running;
    bool dirty;
    bool save_on_stop;
    bool save_pending;
    bool clear_pending;
} LogicManagerRuntime;

typedef struct
{
    DataManager *data;
    LogicManagerState state;
    uint32_t scan_count;
    uint32_t failed_scan_count;
    uint32_t last_scan_ms;
    LogicManagerTimer timers[POINT_CONFIG_TIMER_COUNT > 0U ? POINT_CONFIG_TIMER_COUNT : 1U];
    LogicManagerEdge edges[POINT_CONFIG_EDGE_COUNT > 0U ? POINT_CONFIG_EDGE_COUNT : 1U];
    LogicManagerCounter counters[POINT_CONFIG_COUNTER_COUNT > 0U ? POINT_CONFIG_COUNTER_COUNT : 1U];
#if POINT_CONFIG_LATCH_COUNT > 0U
    LogicManagerLatch latches[POINT_CONFIG_LATCH_COUNT];
#endif
#if POINT_CONFIG_DEBOUNCE_COUNT > 0U
    LogicManagerDebounce debounces[POINT_CONFIG_DEBOUNCE_COUNT];
#endif
#if POINT_CONFIG_FILTER_COUNT > 0U
    LogicManagerAnalogBlock filters[POINT_CONFIG_FILTER_COUNT];
#endif
#if POINT_CONFIG_RATE_LIMIT_COUNT > 0U
    LogicManagerAnalogBlock rate_limits[POINT_CONFIG_RATE_LIMIT_COUNT];
#endif
    LogicManagerPid pids[POINT_CONFIG_PID_COUNT > 0U ? POINT_CONFIG_PID_COUNT : 1U];
    LogicManagerRuntime runtimes[POINT_CONFIG_RUNTIME_COUNT > 0U ? POINT_CONFIG_RUNTIME_COUNT : 1U];
    LogicRuntimeStore runtime_store;
    uint32_t runtime_clear_candidate_mask;
    LogicContext *callback_context;
    uintptr_t startup_owner;
    uintptr_t control_owner;
    LogicExecutionPhase execution_phase;
    LogicApiFault api_fault;
    uint32_t api_violation_count;
    uint32_t timer_usage;
    uint32_t edge_usage;
    uint32_t counter_usage;
    uint32_t latch_usage;
    uint32_t debounce_usage;
    uint32_t filter_usage;
    uint32_t rate_limit_usage;
    uint32_t pid_step_usage;
    bool initialized;
    bool stop_callback_pending;
    bool control_owner_bound;
    bool callback_failed;
    bool parameter_start_inhibit;
    bool project_initialized;
    LogicStartupProvider startup_provider;
    void *startup_context;
    bool startup_complete;
    /* 参数已有效时在硬件等待期接收的RESET，首个就绪拍恢复为STOPPED。 */
    bool parameter_reset_pending;
} LogicManager;

bool LogicManager_Init(LogicManager *manager, DataManager *data);
bool LogicManager_Step(LogicManager *manager, uint32_t now_ms);
void LogicManager_Stop(LogicManager *manager, uint32_t now_ms);
bool LogicManager_Reset(LogicManager *manager, uint32_t now_ms);
/** @brief 由控制任务入口绑定唯一运行 owner；同 owner 重复绑定幂等。 */
bool LogicManager_BindControlOwner(LogicManager *manager);
/** 启动 owner 在控制任务运行前绑定一次硬件门禁；等待期间安全输出、关闭普通
 * 命令屏障且不调用 Logic_Scan。provider 由控制 owner 调用，负责有界失败策略。 */
bool LogicManager_BindStartupGate(LogicManager *manager,
                                  LogicStartupProvider provider, void *context);
/** 仅表示有界上电等待；故障、未绑定门禁或已就绪均返回 false。 */
bool LogicManager_IsStartupWaiting(const LogicManager *manager);
/**
 * @brief 从控制 owner 将南向、健康或逻辑异常统一收敛到 FAULT_SAFE。
 *
 * 会锁存故障并发布配置声明的安全输出；恢复仍必须经过 reset -> STOPPED -> start。
 */
void LogicManager_EnterFaultSafe(LogicManager *manager, DataManagerFault fault,
                                 uint32_t now_ms);
LogicManagerState LogicManager_GetState(const LogicManager *manager);
/** @brief 复制最近一次功能块/API 首错诊断；诊断读取不会清锁存。 */
bool LogicManager_CopyApiFault(const LogicManager *manager,
                               LogicApiFault *fault);

/** 仅由 50 ms maintenance task 调用；每轮最多执行一次 EEPROM 物理操作。 */
void LogicManager_ServicePersistence(LogicManager *manager, uint32_t now_ms);
/** 向 HTTP/HMI 提供控制器级持久化时间快照，不执行 EEPROM I/O。 */
bool LogicManager_GetSystemLifetime(LogicManager *manager, uint32_t *boot_count,
                                    uint32_t *total_seconds, bool *boot_count_valid,
                                    uint32_t *fault_mask, bool *busy);
/** 单控制器产品的北向只读入口；初始化失败或尚未完成时返回 false。 */
bool LogicManager_GetPrimarySystemLifetime(uint32_t *boot_count,
                                           uint32_t *total_seconds,
                                           bool *boot_count_valid,
                                           uint32_t *fault_mask, bool *busy);

#if defined(KZ3_LOGIC_MANAGER_UNIT_TEST)
void LogicManager_SetTestExecutionIdentity(uintptr_t identity, bool in_isr);
/** 仅供主机测试覆盖非当前项目实例的 PID 方向和边界，不进入 production API。 */
bool LogicBlock_PidStepForTest(const PointConfigPid *config,
                               LogicManagerPid *pid,
                               LogicContext *context,
                               const M1LogicPidInput *input,
                               M1LogicPidStatus *status);
/** 仅供主机测试覆盖 RTU U16 AO 的范围校验和取整。 */
bool LogicBlock_PidOutputToU16ForTest(const PointConfigPid *config,
                                      float output, uint16_t *raw_output);
#endif

#endif
