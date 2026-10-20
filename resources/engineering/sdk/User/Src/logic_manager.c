#include "logic_manager.h"

#include <math.h>
#include <string.h>

#if defined(__arm__) || defined(__thumb__)
#include "cmsis_gcc.h"
#include "FreeRTOS.h"
#include "task.h"
#endif

#include "eeprom_transport.h"

#include "../../application/logic.h"

/* 项目逻辑的功能块门面只在单个控制扫描 owner 内有效。 */
static LogicManager * volatile s_active_manager;
static LogicManager *s_primary_manager;

_Static_assert(POINT_CONFIG_TIMER_COUNT <= 32U, "timer usage 位图容量不足");
_Static_assert(POINT_CONFIG_EDGE_COUNT <= 32U, "edge usage 位图容量不足");
_Static_assert(POINT_CONFIG_COUNTER_COUNT <= 32U, "counter usage 位图容量不足");
_Static_assert(POINT_CONFIG_LATCH_COUNT <= 32U, "latch usage 位图容量不足");
_Static_assert(POINT_CONFIG_DEBOUNCE_COUNT <= 32U,
               "debounce usage 位图容量不足");
_Static_assert(POINT_CONFIG_FILTER_COUNT <= 32U, "filter usage 位图容量不足");
_Static_assert(POINT_CONFIG_RATE_LIMIT_COUNT <= 32U,
               "rate limit usage 位图容量不足");
_Static_assert(POINT_CONFIG_PID_COUNT <= 32U, "PID usage 位图容量不足");

#if !defined(__arm__) && !defined(__thumb__)
static uintptr_t s_test_execution_identity = 1U;
static bool s_test_in_isr;
#endif

static void LogicManager_RuntimeLock(void)
{
#if defined(__arm__) || defined(__thumb__)
    taskENTER_CRITICAL();
#endif
}

static void LogicManager_RuntimeUnlock(void)
{
#if defined(__arm__) || defined(__thumb__)
    taskEXIT_CRITICAL();
#endif
}

static bool LogicManager_InIsr(void)
{
#if defined(__arm__) || defined(__thumb__)
    return __get_IPSR() != 0U;
#else
    return s_test_in_isr;
#endif
}

static uintptr_t LogicManager_CurrentExecutionIdentity(void)
{
#if defined(__arm__) || defined(__thumb__)
    return (uintptr_t)xTaskGetCurrentTaskHandle();
#else
    return s_test_execution_identity;
#endif
}

static bool LogicManager_OwnerMatches(const LogicManager *manager)
{
    uintptr_t current;

    if (manager == NULL || LogicManager_InIsr())
    {
        return false;
    }
    current = LogicManager_CurrentExecutionIdentity();
    return current != 0U &&
        (manager->control_owner_bound ? current == manager->control_owner :
                                        current == manager->startup_owner);
}

static void LogicManager_AtomicSaturatingIncrementU32(uint32_t *value)
{
    uint32_t current = __atomic_load_n(value, __ATOMIC_RELAXED);

    while (current != UINT32_MAX &&
           !__atomic_compare_exchange_n(value, &current, current + 1U, false,
                                        __ATOMIC_RELAXED, __ATOMIC_RELAXED))
    {
    }
}

static void LogicManager_AtomicSaturatingIncrementU16(uint16_t *value)
{
    uint16_t current = __atomic_load_n(value, __ATOMIC_RELAXED);

    while (current != UINT16_MAX &&
           !__atomic_compare_exchange_n(value, &current,
                                        (uint16_t)(current + 1U), false,
                                        __ATOMIC_RELAXED, __ATOMIC_RELAXED))
    {
    }
}

static void LogicManager_RecordApiError(LogicManager *manager,
                                        LogicApiErrorCode code,
                                        LogicApiId api_id,
                                        uint16_t instance_id,
                                        uint16_t project_reason)
{
    if (manager == NULL || code == LOGIC_API_ERROR_NONE)
    {
        return;
    }
    if (LogicManager_InIsr())
    {
        LogicManager_AtomicSaturatingIncrementU32(
            &manager->api_violation_count);
        if (manager->execution_phase != LOGIC_EXECUTION_NONE)
        {
            if (!__atomic_load_n(&manager->callback_failed, __ATOMIC_ACQUIRE))
            {
                __atomic_store_n(&manager->api_fault.code,
                                 LOGIC_API_ERROR_PHASE, __ATOMIC_RELAXED);
                __atomic_store_n(&manager->api_fault.api_id, api_id,
                                 __ATOMIC_RELAXED);
                __atomic_store_n(&manager->api_fault.instance_id, instance_id,
                                 __ATOMIC_RELAXED);
                __atomic_store_n(&manager->api_fault.phase,
                                 manager->execution_phase, __ATOMIC_RELAXED);
                __atomic_store_n(&manager->api_fault.project_reason,
                                 project_reason, __ATOMIC_RELAXED);
                __atomic_store_n(&manager->api_fault.additional_error_count,
                                 0U, __ATOMIC_RELAXED);
                __atomic_store_n(&manager->api_fault.scan_sequence,
                                 manager->data == NULL ? 0U :
                                     manager->data->scan_sequence,
                                 __ATOMIC_RELAXED);
            }
            else
            {
                LogicManager_AtomicSaturatingIncrementU16(
                    &manager->api_fault.additional_error_count);
            }
            __atomic_store_n(&manager->callback_failed, true,
                             __ATOMIC_RELEASE);
        }
        return;
    }
    LogicManager_RuntimeLock();
    LogicManager_AtomicSaturatingIncrementU32(&manager->api_violation_count);
    if (!__atomic_load_n(&manager->callback_failed, __ATOMIC_ACQUIRE))
    {
        manager->api_fault.code = code;
        manager->api_fault.api_id = api_id;
        manager->api_fault.instance_id = instance_id;
        manager->api_fault.phase = manager->execution_phase;
        manager->api_fault.project_reason = project_reason;
        manager->api_fault.additional_error_count = 0U;
        manager->api_fault.scan_sequence = manager->data == NULL ? 0U :
            manager->data->scan_sequence;
    }
    else
    {
        LogicManager_AtomicSaturatingIncrementU16(
            &manager->api_fault.additional_error_count);
    }
    if (manager->execution_phase != LOGIC_EXECUTION_NONE)
    {
        __atomic_store_n(&manager->callback_failed, true, __ATOMIC_RELEASE);
    }
    LogicManager_RuntimeUnlock();
}

static void LogicManager_ClearCallbackUsage(LogicManager *manager)
{
    manager->timer_usage = 0U;
    manager->edge_usage = 0U;
    manager->counter_usage = 0U;
    manager->latch_usage = 0U;
    manager->debounce_usage = 0U;
    manager->filter_usage = 0U;
    manager->rate_limit_usage = 0U;
    manager->pid_step_usage = 0U;
}

static bool LogicManager_BeginCallback(LogicManager *manager,
                                       LogicExecutionPhase phase,
                                       LogicContext *context)
{
    if (manager == NULL || context == NULL || manager->data == NULL ||
        phase == LOGIC_EXECUTION_NONE ||
        manager->execution_phase != LOGIC_EXECUTION_NONE ||
        s_active_manager != NULL || !LogicManager_OwnerMatches(manager) ||
        context != &manager->data->working || !manager->data->scan_open)
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_NONE, 0U, 0U);
        return false;
    }
    __atomic_store_n(&manager->callback_failed, false, __ATOMIC_RELEASE);
    LogicManager_ClearCallbackUsage(manager);
    manager->execution_phase = phase;
    manager->callback_context = context;
    s_active_manager = manager;
    return true;
}

static bool LogicManager_EndCallback(LogicManager *manager)
{
    bool success;

    if (manager == NULL || s_active_manager != manager)
    {
        return false;
    }
    success = !__atomic_load_n(&manager->callback_failed, __ATOMIC_ACQUIRE);
    s_active_manager = NULL;
    manager->callback_context = NULL;
    manager->execution_phase = LOGIC_EXECUTION_NONE;
    return success;
}

static bool LogicManager_ValidateStatefulCall(LogicContext *context,
                                              bool id_valid,
                                              uint16_t instance_id,
                                              bool arguments_valid,
                                              LogicApiErrorCode argument_error,
                                              uint32_t *usage,
                                              LogicApiId api_id)
{
    LogicManager *manager = s_active_manager;
    uint32_t bit;

    if (manager == NULL)
    {
        LogicManager_RecordApiError(s_primary_manager, LOGIC_API_ERROR_PHASE,
                                    api_id, instance_id, 0U);
        return false;
    }
    if (LogicManager_InIsr() || !LogicManager_OwnerMatches(manager) ||
        manager->execution_phase != LOGIC_EXECUTION_SCAN)
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_PHASE, api_id,
                                    instance_id, 0U);
        return false;
    }
    if (context == NULL || context != manager->callback_context ||
        context != &manager->data->working)
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_CONTEXT, api_id,
                                    instance_id, 0U);
        return false;
    }
    if (!id_valid || instance_id >= 32U)
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_INSTANCE, api_id,
                                    instance_id, 0U);
        return false;
    }
    if (!arguments_valid)
    {
        LogicManager_RecordApiError(manager, argument_error, api_id,
                                    instance_id, 0U);
        return false;
    }
    bit = 1UL << instance_id;
    if ((*usage & bit) != 0U)
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_DUPLICATE, api_id,
                                    instance_id, 0U);
        return false;
    }
    *usage |= bit;
    return true;
}

static void LogicManager_RecordCheckedError(LogicApiId api_id,
                                            LogicApiErrorCode code)
{
    if (s_active_manager != NULL)
    {
        LogicManager_RecordApiError(s_active_manager, code, api_id, 0U, 0U);
    }
}

static bool IsTimerIdValid(PointConfigTimerId id)
{
#if POINT_CONFIG_TIMER_COUNT == 0U
    (void)id;
    return false;
#else
    return (uint32_t)id < POINT_CONFIG_TIMER_COUNT;
#endif
}

static bool IsEdgeIdValid(PointConfigEdgeId id)
{
#if POINT_CONFIG_EDGE_COUNT == 0U
    (void)id;
    return false;
#else
    return (uint32_t)id < POINT_CONFIG_EDGE_COUNT;
#endif
}

static bool IsCounterIdValid(PointConfigCounterId id)
{
#if POINT_CONFIG_COUNTER_COUNT == 0U
    (void)id;
    return false;
#else
    return (uint32_t)id < POINT_CONFIG_COUNTER_COUNT;
#endif
}

#if POINT_CONFIG_LATCH_COUNT > 0U
static bool IsLatchIdValid(PointConfigLatchId id)
{
    return (uint32_t)id < POINT_CONFIG_LATCH_COUNT;
}
#endif

#if POINT_CONFIG_DEBOUNCE_COUNT > 0U
static bool IsDebounceIdValid(PointConfigDebounceId id)
{
    return (uint32_t)id < POINT_CONFIG_DEBOUNCE_COUNT;
}
#endif

#if POINT_CONFIG_FILTER_COUNT > 0U
static bool IsFilterIdValid(PointConfigFilterId id)
{
    return (uint32_t)id < POINT_CONFIG_FILTER_COUNT;
}
#endif

#if POINT_CONFIG_RATE_LIMIT_COUNT > 0U
static bool IsRateLimitIdValid(PointConfigRateLimitId id)
{
    return (uint32_t)id < POINT_CONFIG_RATE_LIMIT_COUNT;
}
#endif

static bool IsPidIdValid(PointConfigPidId id)
{
#if POINT_CONFIG_PID_COUNT == 0U
    (void)id;
    return false;
#else
    return (uint32_t)id < POINT_CONFIG_PID_COUNT;
#endif
}

#if POINT_CONFIG_RUNTIME_COUNT > 0U
static void RuntimeAddElapsed(uint32_t *seconds, uint16_t *remainder,
                              uint32_t elapsed_ms)
{
    uint32_t total_ms = elapsed_ms + *remainder;
    uint32_t elapsed_seconds = total_ms / 1000U;

    *remainder = (uint16_t)(total_ms % 1000U);
    if (UINT32_MAX - *seconds < elapsed_seconds)
    {
        *seconds = UINT32_MAX;
    }
    else
    {
        *seconds += elapsed_seconds;
    }
}

static bool RuntimeCommandClearRequested(const LogicContext *context,
                                         uint8_t slot)
{
    const PointConfigRuntime *runtime = &g_point_config_runtimes[slot];

    return *(const bool *)((const uint8_t *)context + runtime->clear_command_offset);
}

static bool RuntimeTriggerIsActive(const LogicContext *context,
                                   const PointConfigRuntime *runtime,
                                   bool *active)
{
    const uint8_t *address;

    if (context == NULL || runtime == NULL || active == NULL)
    {
        return false;
    }
    address = (const uint8_t *)context + runtime->trigger_offset;
    if (runtime->trigger_kind == POINT_CONFIG_RUNTIME_TRIGGER_BOOL_SAMPLE)
    {
        const PointConfigBoolSample *sample = (const PointConfigBoolSample *)address;

        *active = sample->quality == POINT_CONFIG_QUALITY_GOOD &&
            sample->value == runtime->active_value;
        return true;
    }
    if (runtime->trigger_kind == POINT_CONFIG_RUNTIME_TRIGGER_BOOL_SCALAR)
    {
        *active = *(const bool *)address == runtime->active_value;
        return true;
    }
    return false;
}
#endif

static bool RuntimeStepAll(LogicManager *manager, LogicContext *context)
{
#if POINT_CONFIG_RUNTIME_COUNT > 0U
    uint8_t slot;

    for (slot = 0U; slot < POINT_CONFIG_RUNTIME_COUNT; ++slot)
    {
        LogicManagerRuntime *runtime = &manager->runtimes[slot];
        const PointConfigRuntime *descriptor = &g_point_config_runtimes[slot];
        uint32_t elapsed_ms;
        bool confirmed_running;
        bool was_running;

        if (!RuntimeTriggerIsActive(context, descriptor, &confirmed_running))
        {
            return false;
        }
        if (!runtime->baseline_ready)
        {
            runtime->baseline_ready = true;
            runtime->previous_running = confirmed_running;
            runtime->last_tick_ms = context->now_ms;
        }
        else
        {
            was_running = runtime->previous_running;
            elapsed_ms = (uint32_t)(context->now_ms - runtime->last_tick_ms);
            if (was_running)
            {
                RuntimeAddElapsed(&runtime->total_seconds,
                                  &runtime->millisecond_remainder, elapsed_ms);
                if (runtime->clear_pending)
                {
                    RuntimeAddElapsed(
                        &runtime->post_clear_seconds,
                        &runtime->post_clear_millisecond_remainder, elapsed_ms);
                }
            }
            runtime->last_tick_ms = context->now_ms;
            runtime->previous_running = confirmed_running;
            if (was_running && !confirmed_running &&
                runtime->total_seconds != runtime->persisted_seconds)
            {
                runtime->save_on_stop = true;
            }
        }
        if (runtime->total_seconds != runtime->persisted_seconds &&
            !runtime->dirty)
        {
            runtime->dirty = true;
            runtime->dirty_since_ms = context->now_ms;
        }
        if (RuntimeCommandClearRequested(context, slot))
        {
            manager->runtime_clear_candidate_mask |= 1UL << slot;
        }
    }
#else
    (void)manager;
    (void)context;
#endif
    return true;
}

static void RuntimeProjectStates(LogicManager *manager, LogicContext *context)
{
#if POINT_CONFIG_RUNTIME_COUNT > 0U
    uint32_t boot_count = 0U;
    uint32_t total_seconds = 0U;
    uint32_t fault_mask = 0U;
    bool boot_valid = false;
    bool busy = false;
    uint8_t slot;

    LogicRuntimeStore_GetSystemSnapshot(&manager->runtime_store, &boot_count,
                                         &total_seconds, &boot_valid, &fault_mask,
                                         &busy);
    context->state.system_boot_count = boot_count;
    context->state.system_total_runtime_seconds = total_seconds;
    context->state.retained_store_fault = fault_mask != 0U;
    context->state.retained_store_fault_mask = fault_mask;
    context->state.retained_store_busy = busy;
    for (slot = 0U; slot < POINT_CONFIG_RUNTIME_COUNT; ++slot)
    {
        const PointConfigRuntime *runtime = &g_point_config_runtimes[slot];

        *(uint32_t *)((uint8_t *)context + runtime->seconds_state_offset) =
            manager->runtimes[slot].total_seconds;
        *(bool *)((uint8_t *)context + runtime->clear_pending_state_offset) =
            manager->runtimes[slot].clear_pending;
    }
    (void)boot_valid;
#else
    (void)manager;
    (void)context;
#endif
}

static void RuntimeConsumeCompletions(LogicManager *manager, uint32_t now_ms)
{
#if POINT_CONFIG_RUNTIME_COUNT > 0U
    uint8_t slot;

    for (slot = 0U; slot < POINT_CONFIG_RUNTIME_COUNT; ++slot)
    {
        LogicManagerRuntime *runtime = &manager->runtimes[slot];
        uint32_t sequence;
        uint32_t seconds;
        bool clear_request;

        if (!LogicRuntimeStore_TakeRuntimeCompletion(&manager->runtime_store, slot,
                                                      &sequence, &seconds,
                                                      &clear_request))
        {
            continue;
        }
        if (clear_request && runtime->clear_pending &&
            sequence == runtime->clear_sequence)
        {
            runtime->total_seconds = runtime->post_clear_seconds;
            runtime->persisted_seconds = 0U;
            runtime->dirty = runtime->post_clear_seconds != 0U;
            runtime->dirty_since_ms = now_ms;
            runtime->save_pending = false;
            runtime->clear_pending = false;
            runtime->post_clear_seconds = 0U;
            runtime->post_clear_millisecond_remainder = 0U;
        }
        else if (!clear_request && runtime->save_pending &&
                 sequence == runtime->request_sequence)
        {
            runtime->persisted_seconds = seconds;
            runtime->save_pending = false;
            runtime->dirty = runtime->total_seconds != runtime->persisted_seconds;
            /* 已成功保存后，下一轮未保存增量从本时刻重新计时；否则超过
             * 检查点阈值后会在每次扫描反复提交 EEPROM 写请求。 */
            runtime->dirty_since_ms = now_ms;
            if (!runtime->dirty)
            {
                runtime->save_on_stop = false;
            }
        }
    }
#else
    (void)manager;
    (void)now_ms;
#endif
}

static void RuntimeAcceptCommittedRequests(LogicManager *manager, uint32_t now_ms)
{
#if POINT_CONFIG_RUNTIME_COUNT > 0U
    uint8_t slot;

    for (slot = 0U; slot < POINT_CONFIG_RUNTIME_COUNT; ++slot)
    {
        LogicManagerRuntime *runtime = &manager->runtimes[slot];
        const PointConfigRuntime *descriptor = &g_point_config_runtimes[slot];

        if ((manager->runtime_clear_candidate_mask & (1UL << slot)) != 0U &&
            !runtime->clear_pending)
        {
            runtime->clear_pending = true;
            runtime->post_clear_seconds = 0U;
            runtime->post_clear_millisecond_remainder = 0U;
            runtime->clear_sequence++;
            LogicRuntimeStore_RequestRuntimeSave(&manager->runtime_store, slot,
                                                  descriptor->key_hash, 0U,
                                                  runtime->clear_sequence, true,
                                                  now_ms);
            continue;
        }
        if (runtime->dirty && !runtime->save_pending && !runtime->clear_pending &&
            (runtime->save_on_stop ||
             (uint32_t)(now_ms - runtime->dirty_since_ms) >=
                 LOGIC_RUNTIME_STORE_RUNTIME_CHECKPOINT_MS))
        {
            runtime->request_sequence++;
            runtime->save_pending = true;
            runtime->save_on_stop = false;
            LogicRuntimeStore_RequestRuntimeSave(&manager->runtime_store, slot,
                                                  descriptor->key_hash,
                                                  runtime->total_seconds,
                                                  runtime->request_sequence, false,
                                                  now_ms);
        }
    }
#else
    (void)manager;
    (void)now_ms;
#endif
}

static void ResetBlockState(LogicManager *manager)
{
#if POINT_CONFIG_RUNTIME_COUNT > 0U
    uint8_t runtime_slot;
#endif

    memset(manager->timers, 0, sizeof(manager->timers));
    memset(manager->edges, 0, sizeof(manager->edges));
    memset(manager->counters, 0, sizeof(manager->counters));
#if POINT_CONFIG_LATCH_COUNT > 0U
    memset(manager->latches, 0, sizeof(manager->latches));
#endif
#if POINT_CONFIG_DEBOUNCE_COUNT > 0U
    memset(manager->debounces, 0, sizeof(manager->debounces));
#endif
#if POINT_CONFIG_FILTER_COUNT > 0U
    memset(manager->filters, 0, sizeof(manager->filters));
#endif
#if POINT_CONFIG_RATE_LIMIT_COUNT > 0U
    memset(manager->rate_limits, 0, sizeof(manager->rate_limits));
#endif
    memset(manager->pids, 0, sizeof(manager->pids));
#if POINT_CONFIG_RUNTIME_COUNT > 0U
    /* STOP/FAULT/reset 只暂停计时；不能清掉累计值、未保存标记或清零事务。
     * 下次 RUNNING 的首次调用重新建立基线，避免把停机间隔计入设备运行时间。 */
    for (runtime_slot = 0U; runtime_slot < POINT_CONFIG_RUNTIME_COUNT;
         ++runtime_slot)
    {
        manager->runtimes[runtime_slot].baseline_ready = false;
        manager->runtimes[runtime_slot].previous_running = false;
    }
#endif
}

static bool FaultsAllowReset(const LogicManager *manager)
{
    uint32_t active_faults;
    uint32_t faults;
    const uint32_t resettable =
        (uint32_t)DATA_MANAGER_FAULT_LOGIC_SCAN |
        (uint32_t)DATA_MANAGER_FAULT_SOUTHBOND |
        (uint32_t)DATA_MANAGER_FAULT_HEALTH;

    faults = DataManager_GetFaultFlags(manager->data);
    active_faults = DataManager_GetActiveFaultFlags(manager->data);
    return (active_faults & ~(uint32_t)DATA_MANAGER_FAULT_LOGIC_SCAN) == 0U &&
           (faults & ~resettable) == 0U;
}

static bool InvokeLogicStop(LogicManager *manager, LogicContext *context)
{
    bool callback_ok;

    if (!LogicManager_BeginCallback(manager, LOGIC_EXECUTION_STOP, context))
    {
        return false;
    }
    Logic_Stop(context);
    callback_ok = LogicManager_EndCallback(manager);
    return callback_ok;
}

static bool TransitionToStopped(LogicManager *manager, LogicContext *context,
                                DataManagerFault faults_to_clear)
{
    bool stop_ok;

    manager->stop_callback_pending = false;
    DataManager_CloseCommandBarrier(manager->data);
    stop_ok = InvokeLogicStop(manager, context);
    ResetBlockState(manager);
    if (!stop_ok)
    {
        DataManager_SetFaultAt(manager->data, DATA_MANAGER_FAULT_LOGIC_SCAN,
                               context->now_ms);
        manager->state = LOGIC_MANAGER_FAULT_SAFE;
        (void)DataManager_CompleteSafeTransition(manager->data);
        return false;
    }
    if (faults_to_clear != DATA_MANAGER_FAULT_NONE)
    {
        if (((uint32_t)faults_to_clear &
             (uint32_t)DATA_MANAGER_FAULT_LOGIC_SCAN) != 0U)
        {
            DataManager_SetFaultCondition(manager->data,
                                          DATA_MANAGER_FAULT_LOGIC_SCAN,
                                          false, context->now_ms);
        }
        DataManager_ClearFault(manager->data, faults_to_clear);
    }
    manager->state = LOGIC_MANAGER_STOPPED;
    return DataManager_CompleteSafeTransition(manager->data);
}

static bool InitializeInhibitedProject(LogicManager *manager,
                                       LogicContext *context)
{
    bool init_ok;
    bool api_ok;

    if (!DataManager_AreParametersReady(manager->data) ||
        !LogicManager_BeginCallback(manager, LOGIC_EXECUTION_INIT, context))
    {
        return false;
    }
    init_ok = Logic_Init(context);
    api_ok = LogicManager_EndCallback(manager);
    if (!init_ok || !api_ok)
    {
        DataManager_AbortLogicScan(manager->data,
                                   DATA_MANAGER_FAULT_LOGIC_SCAN);
        manager->state = LOGIC_MANAGER_FAULT_SAFE;
        return false;
    }
    manager->project_initialized = true;
    if (!InvokeLogicStop(manager, context))
    {
        DataManager_AbortLogicScan(manager->data,
                                   DATA_MANAGER_FAULT_LOGIC_SCAN);
        manager->state = LOGIC_MANAGER_FAULT_SAFE;
        return false;
    }
    ResetBlockState(manager);
    manager->parameter_start_inhibit = false;
    manager->parameter_reset_pending = false;
    manager->state = LOGIC_MANAGER_STOPPED;
    return DataManager_CompleteSafeTransition(manager->data);
}

void LogicManager_EnterFaultSafe(LogicManager *manager, DataManagerFault fault,
                                 uint32_t now_ms)
{
    LogicContext *context = NULL;
    bool first_entry;

    if (manager == NULL || manager->data == NULL ||
        fault == DATA_MANAGER_FAULT_NONE)
    {
        return;
    }
    if (!LogicManager_OwnerMatches(manager))
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_NONE, 0U, 0U);
        return;
    }
    first_entry = manager->state != LOGIC_MANAGER_FAULT_SAFE;
    manager->parameter_reset_pending = false;
    manager->stop_callback_pending = false;
    DataManager_SetFaultAt(manager->data, fault, now_ms);
    DataManager_CloseCommandBarrier(manager->data);
    if (first_entry && manager->project_initialized)
    {
        if (manager->data->scan_open)
        {
            context = &manager->data->working;
        }
        else
        {
            (void)DataManager_BeginLogicScan(manager->data, now_ms, &context);
        }
        if (context != NULL)
        {
            if (!InvokeLogicStop(manager, context))
            {
                DataManager_SetFaultAt(manager->data,
                                       DATA_MANAGER_FAULT_LOGIC_SCAN, now_ms);
            }
            else if (fault == DATA_MANAGER_FAULT_LOGIC_SCAN)
            {
                DataManager_SetFaultCondition(manager->data,
                                              DATA_MANAGER_FAULT_LOGIC_SCAN,
                                              false, now_ms);
            }
        }
        ResetBlockState(manager);
    }
    (void)DataManager_CompleteSafeTransition(manager->data);
    manager->state = LOGIC_MANAGER_FAULT_SAFE;
}

bool LogicManager_Init(LogicManager *manager, DataManager *data)
{
    LogicContext *context;
    bool startup_reset_requested;
    bool startup_stop_requested;
#if POINT_CONFIG_RUNTIME_COUNT > 0U
    uint8_t slot;
#endif

    if (manager == NULL || data == NULL)
    {
        return false;
    }
    memset(manager, 0, sizeof(*manager));
    manager->data = data;
    manager->state = LOGIC_MANAGER_BOOT_SAFE;
    manager->startup_owner = LogicManager_CurrentExecutionIdentity();
    if (manager->startup_owner == 0U || LogicManager_InIsr())
    {
        return false;
    }
    LogicRuntimeStore_Init(&manager->runtime_store);
    LogicRuntimeStore_LoadSystem(&manager->runtime_store);
    (void)LogicRuntimeStore_CommitStartup(&manager->runtime_store, 0U);
#if POINT_CONFIG_RUNTIME_COUNT > 0U
    for (slot = 0U; slot < POINT_CONFIG_RUNTIME_COUNT; ++slot)
    {
        LogicManagerRuntime *runtime = &manager->runtimes[slot];

        LogicRuntimeStore_LoadRuntime(&manager->runtime_store, slot,
                                      g_point_config_runtimes[slot].key_hash,
                                      &runtime->total_seconds);
        runtime->persisted_seconds = runtime->total_seconds;
    }
#endif
    if (g_point_config.parameter_restore_policy ==
            POINT_CONFIG_PARAMETER_RESTORE_REQUIRE_VALID &&
        !DataManager_AreParametersReady(data))
    {
        DataManager_CloseCommandBarrier(data);
        manager->parameter_start_inhibit = true;
        manager->project_initialized = false;
        manager->initialized = true;
        manager->state = LOGIC_MANAGER_STOPPED;
        s_primary_manager = manager;
        return true;
    }
    if (DataManager_GetSnapshot(data) == NULL ||
        DataManager_BeginLogicScan(data, 0U, &context) != DATA_MANAGER_OK)
    {
        DataManager_SetFault(data, DATA_MANAGER_FAULT_CONFIGURATION);
        manager->state = LOGIC_MANAGER_FAULT_SAFE;
        return false;
    }
    startup_reset_requested = context->command.controller_reset;
    startup_stop_requested = context->command.controller_stop;
    DataManager_CloseCommandBarrier(data);
    if (!LogicManager_BeginCallback(manager, LOGIC_EXECUTION_INIT, context))
    {
        DataManager_AbortLogicScan(data, DATA_MANAGER_FAULT_CONFIGURATION);
        manager->state = LOGIC_MANAGER_FAULT_SAFE;
        return false;
    }
    {
        bool init_ok = Logic_Init(context);
        bool api_ok = LogicManager_EndCallback(manager);

        if (!init_ok || !api_ok)
        {
            DataManager_AbortLogicScan(data, DATA_MANAGER_FAULT_CONFIGURATION);
            manager->state = LOGIC_MANAGER_FAULT_SAFE;
            return false;
        }
    }
    if (startup_reset_requested || startup_stop_requested)
    {
        if (!InvokeLogicStop(manager, context))
        {
            DataManager_AbortLogicScan(data, DATA_MANAGER_FAULT_LOGIC_SCAN);
            manager->state = LOGIC_MANAGER_FAULT_SAFE;
            return false;
        }
        ResetBlockState(manager);
    }
    RuntimeProjectStates(manager, context);
    if (!DataManager_CompleteSafeTransition(data))
    {
        manager->stop_callback_pending = true;
    }
    manager->initialized = true;
    manager->project_initialized = true;
    s_primary_manager = manager;
    /* 纯逻辑环境可以直接扫描；产品启动在控制任务创建前绑定硬件门禁。 */
    manager->state = startup_reset_requested || startup_stop_requested ||
                     manager->stop_callback_pending ?
        LOGIC_MANAGER_STOPPED : LOGIC_MANAGER_RUNNING;
    return true;
}

bool LogicManager_Step(LogicManager *manager, uint32_t now_ms)
{
    LogicContext *context;
    DataManagerResult commit_result;
    bool reset_requested;
    bool stop_requested;
    bool start_requested;

    if (manager == NULL || manager->data == NULL || !manager->initialized ||
        manager->state == LOGIC_MANAGER_BOOT_SAFE)
    {
        return false;
    }
    if (!LogicManager_OwnerMatches(manager))
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_NONE, 0U, 0U);
        return false;
    }
    if (DataManager_BeginLogicScan(manager->data, now_ms, &context) !=
        DATA_MANAGER_OK)
    {
        manager->failed_scan_count++;
        LogicManager_EnterFaultSafe(manager, DATA_MANAGER_FAULT_LOGIC_SCAN,
                                    now_ms);
        return false;
    }
    if (manager->startup_provider != NULL && !manager->startup_complete &&
        manager->state != LOGIC_MANAGER_FAULT_SAFE)
    {
        LogicStartupStatus status = manager->startup_provider(
            manager->startup_context, now_ms);
        bool success;

        if (manager->parameter_start_inhibit &&
            context->command.controller_reset &&
            DataManager_AreParametersReady(manager->data))
        {
            /* BeginLogicScan已消费命令；仅保留恢复意图，不续期、不提前扫描。 */
            manager->parameter_reset_pending = true;
        }
        if (status == LOGIC_STARTUP_FAILED ||
            (status != LOGIC_STARTUP_PENDING && status != LOGIC_STARTUP_READY))
        {
            LogicManager_EnterFaultSafe(manager, DATA_MANAGER_FAULT_SOUTHBOND,
                                        now_ms);
            return false;
        }
        if (status == LOGIC_STARTUP_READY)
        {
            manager->startup_complete = true;
            if (manager->state == LOGIC_MANAGER_STARTUP_WAIT)
            {
                manager->state = LOGIC_MANAGER_RUNNING;
            }
            /* 本拍只发布安全快照及开放屏障，下拍才允许业务扫描。 */
            if (manager->parameter_start_inhibit &&
                manager->parameter_reset_pending &&
                DataManager_AreParametersReady(manager->data))
            {
                success = InitializeInhibitedProject(manager, context);
            }
            else if (manager->project_initialized &&
                (context->command.controller_stop ||
                 context->command.controller_reset ||
                 manager->stop_callback_pending))
            {
                success = TransitionToStopped(manager, context,
                                               DATA_MANAGER_FAULT_NONE);
            }
            else
            {
                success = DataManager_CompleteSafeTransition(manager->data);
            }
            if (!success && manager->state != LOGIC_MANAGER_FAULT_SAFE &&
                manager->project_initialized && !manager->parameter_start_inhibit &&
                DataManager_GetFaultFlags(manager->data) == 0U &&
                DataManager_GetActiveFaultFlags(manager->data) == 0U)
            {
                /* 北向STOP可在采样后或参数初始化期间到达；安全快照已发布，
                 * 下一拍消费STOP，不把合法并发停机误报逻辑故障。 */
                manager->state = LOGIC_MANAGER_STOPPED;
                manager->stop_callback_pending = true;
                success = true;
            }
            if (manager->parameter_start_inhibit)
            {
                DataManager_CloseCommandBarrier(manager->data);
            }
        }
        else
        {
            if (manager->project_initialized &&
                (context->command.controller_stop ||
                 context->command.controller_reset ||
                 manager->stop_callback_pending))
            {
                manager->stop_callback_pending = false;
                success = TransitionToStopped(manager, context,
                                               DATA_MANAGER_FAULT_NONE);
            }
            else
            {
                DataManagerResult result = DataManager_CommitLogicScan(
                    manager->data, context);

                success = result == DATA_MANAGER_OK ||
                    result == DATA_MANAGER_STOP_PENDING;
                if (result == DATA_MANAGER_STOP_PENDING)
                {
                    manager->state = LOGIC_MANAGER_STOPPED;
                    manager->stop_callback_pending = true;
                }
            }
            DataManager_CloseCommandBarrier(manager->data);
        }
        if (!success)
        {
            LogicManager_EnterFaultSafe(manager, DATA_MANAGER_FAULT_LOGIC_SCAN,
                                        now_ms);
            return false;
        }
        manager->last_scan_ms = now_ms;
        return true;
    }
    if (manager->parameter_start_inhibit)
    {
        bool repaired = false;
        bool attempted = false;

        if ((context->command.controller_reset ||
             manager->parameter_reset_pending) &&
            (manager->startup_provider == NULL || manager->startup_complete) &&
            FaultsAllowReset(manager) &&
            DataManager_AreParametersReady(manager->data))
        {
            attempted = true;
            repaired = InitializeInhibitedProject(manager, context);
        }
        else
        {
            DataManager_AbortLogicScan(manager->data,
                                       DATA_MANAGER_FAULT_NONE);
            DataManager_CloseCommandBarrier(manager->data);
        }
        manager->scan_count++;
        manager->last_scan_ms = now_ms;
        return attempted ? repaired : true;
    }
    LogicManager_RuntimeLock();
    RuntimeConsumeCompletions(manager, now_ms);
    manager->runtime_clear_candidate_mask = 0U;
    LogicManager_RuntimeUnlock();
    if (manager->stop_callback_pending)
    {
        bool stopped;

        manager->stop_callback_pending = false;
        stopped = TransitionToStopped(manager, context, DATA_MANAGER_FAULT_NONE);
        manager->scan_count++;
        manager->last_scan_ms = now_ms;
        return stopped;
    }
    reset_requested = context->command.controller_reset;
    stop_requested = context->command.controller_stop;
    start_requested = context->command.controller_start;
    if (manager->state == LOGIC_MANAGER_FAULT_SAFE)
    {
        if (reset_requested && FaultsAllowReset(manager))
        {
            DataManagerFault resettable = (DataManagerFault)(
                DATA_MANAGER_FAULT_LOGIC_SCAN |
                DATA_MANAGER_FAULT_SOUTHBOND |
                DATA_MANAGER_FAULT_HEALTH);

            bool stopped = TransitionToStopped(manager, context, resettable);

            manager->scan_count++;
            manager->last_scan_ms = now_ms;
            return stopped;
        }
        DataManager_AbortLogicScan(manager->data, DATA_MANAGER_FAULT_NONE);
        return false;
    }
    if (reset_requested)
    {
        bool stopped = TransitionToStopped(manager, context,
                                           DATA_MANAGER_FAULT_NONE);

        manager->scan_count++;
        manager->last_scan_ms = now_ms;
        return stopped;
    }
    if (stop_requested)
    {
        bool stopped = TransitionToStopped(manager, context,
                                           DATA_MANAGER_FAULT_NONE);

        manager->scan_count++;
        manager->last_scan_ms = now_ms;
        return stopped;
    }
    else if (manager->state == LOGIC_MANAGER_STOPPED && start_requested)
    {
        manager->state = LOGIC_MANAGER_RUNNING;
    }
    if (manager->state == LOGIC_MANAGER_RUNNING)
    {
        bool scan_ok;
        bool api_ok;

        if (!LogicManager_BeginCallback(manager, LOGIC_EXECUTION_SCAN, context))
        {
            manager->failed_scan_count++;
            LogicManager_EnterFaultSafe(manager, DATA_MANAGER_FAULT_LOGIC_SCAN,
                                        now_ms);
            return false;
        }
        scan_ok = Logic_Scan(context);
        api_ok = LogicManager_EndCallback(manager);
        if (!scan_ok || !api_ok)
        {
            manager->failed_scan_count++;
            LogicManager_EnterFaultSafe(manager, DATA_MANAGER_FAULT_LOGIC_SCAN,
                                        now_ms);
            return false;
        }
        if (!RuntimeStepAll(manager, context))
        {
            manager->failed_scan_count++;
            LogicManager_EnterFaultSafe(manager, DATA_MANAGER_FAULT_LOGIC_SCAN,
                                        now_ms);
            return false;
        }
    }
    LogicManager_RuntimeLock();
    RuntimeProjectStates(manager, context);
    LogicManager_RuntimeUnlock();
    commit_result = DataManager_CommitLogicScan(manager->data, context);
    if (commit_result == DATA_MANAGER_STOP_PENDING)
    {
        ResetBlockState(manager);
        manager->state = LOGIC_MANAGER_STOPPED;
        manager->stop_callback_pending = true;
        manager->scan_count++;
        manager->last_scan_ms = now_ms;
        return true;
    }
    if (commit_result != DATA_MANAGER_OK)
    {
        manager->failed_scan_count++;
        LogicManager_EnterFaultSafe(manager, DATA_MANAGER_FAULT_LOGIC_SCAN,
                                    now_ms);
        return false;
    }
    LogicManager_RuntimeLock();
    RuntimeAcceptCommittedRequests(manager, now_ms);
    LogicManager_RuntimeUnlock();
    manager->scan_count++;
    manager->last_scan_ms = now_ms;
    return true;
}

void LogicManager_Stop(LogicManager *manager, uint32_t now_ms)
{
    LogicContext *context;

    if (manager == NULL || manager->data == NULL || !manager->initialized)
    {
        return;
    }
    if (!LogicManager_OwnerMatches(manager))
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_NONE, 0U, 0U);
        return;
    }
    if (manager->parameter_start_inhibit)
    {
        DataManager_CloseCommandBarrier(manager->data);
        return;
    }
    if (DataManager_BeginLogicScan(manager->data, now_ms, &context) ==
        DATA_MANAGER_OK)
    {
        (void)TransitionToStopped(manager, context, DATA_MANAGER_FAULT_NONE);
        if (LogicManager_IsStartupWaiting(manager))
        {
            DataManager_CloseCommandBarrier(manager->data);
        }
    }
}

bool LogicManager_Reset(LogicManager *manager, uint32_t now_ms)
{
    LogicContext *context;
    DataManagerFault faults;

    if (manager == NULL || manager->data == NULL || !manager->initialized)
    {
        return false;
    }
    if (!LogicManager_OwnerMatches(manager))
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_NONE, 0U, 0U);
        return false;
    }
    if (!FaultsAllowReset(manager))
    {
        return false;
    }
    if (DataManager_BeginLogicScan(manager->data, now_ms, &context) !=
        DATA_MANAGER_OK)
    {
        return false;
    }
    if (manager->parameter_start_inhibit)
    {
        if (DataManager_AreParametersReady(manager->data))
        {
            bool success = InitializeInhibitedProject(manager, context);

            if (LogicManager_IsStartupWaiting(manager))
            {
                DataManager_CloseCommandBarrier(manager->data);
            }
            return success;
        }
        DataManager_AbortLogicScan(manager->data, DATA_MANAGER_FAULT_NONE);
        DataManager_CloseCommandBarrier(manager->data);
        return false;
    }
    faults = (DataManagerFault)DataManager_GetFaultFlags(manager->data);
    {
        bool success = TransitionToStopped(manager, context, faults);

        if (LogicManager_IsStartupWaiting(manager))
        {
            DataManager_CloseCommandBarrier(manager->data);
        }
        return success;
    }
}

LogicManagerState LogicManager_GetState(const LogicManager *manager)
{
    return manager == NULL ? LOGIC_MANAGER_FAULT_SAFE : manager->state;
}

bool LogicManager_BindStartupGate(LogicManager *manager,
                                  LogicStartupProvider provider, void *context)
{
    if (manager == NULL || !manager->initialized || provider == NULL ||
        manager->control_owner_bound || manager->startup_provider != NULL ||
        !LogicManager_OwnerMatches(manager) ||
        manager->state == LOGIC_MANAGER_FAULT_SAFE)
    {
        return false;
    }
    manager->startup_provider = provider;
    manager->startup_context = context;
    if (manager->state == LOGIC_MANAGER_RUNNING)
    {
        manager->state = LOGIC_MANAGER_STARTUP_WAIT;
    }
    DataManager_CloseCommandBarrier(manager->data);
    return true;
}

bool LogicManager_IsStartupWaiting(const LogicManager *manager)
{
    return manager != NULL && manager->initialized &&
        manager->startup_provider != NULL && !manager->startup_complete &&
        manager->state != LOGIC_MANAGER_FAULT_SAFE;
}

bool LogicManager_BindControlOwner(LogicManager *manager)
{
    uintptr_t current;

    if (manager == NULL || !manager->initialized || LogicManager_InIsr() ||
        manager->execution_phase != LOGIC_EXECUTION_NONE)
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_BIND_OWNER, 0U, 0U);
        return false;
    }
    current = LogicManager_CurrentExecutionIdentity();
    if (current == 0U)
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_BIND_OWNER, 0U, 0U);
        return false;
    }
    if (manager->control_owner_bound)
    {
        if (manager->control_owner == current)
        {
            return true;
        }
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_BIND_OWNER, 0U, 0U);
        return false;
    }
    manager->control_owner = current;
    manager->control_owner_bound = true;
    return true;
}

bool LogicManager_CopyApiFault(const LogicManager *manager,
                               LogicApiFault *fault)
{
    if (manager == NULL || fault == NULL)
    {
        return false;
    }
    LogicManager_RuntimeLock();
    *fault = manager->api_fault;
    fault->violation_count = __atomic_load_n(&manager->api_violation_count,
                                             __ATOMIC_RELAXED);
    LogicManager_RuntimeUnlock();
    return fault->code != LOGIC_API_ERROR_NONE;
}

#if defined(KZ3_LOGIC_MANAGER_UNIT_TEST)
void LogicManager_SetTestExecutionIdentity(uintptr_t identity, bool in_isr)
{
#if !defined(__arm__) && !defined(__thumb__)
    s_test_execution_identity = identity;
    s_test_in_isr = in_isr;
#else
    (void)identity;
    (void)in_isr;
#endif
}
#endif

bool LogicBlock_Ton(LogicContext *context, PointConfigTimerId id, bool input,
                    uint32_t preset_ms)
{
    LogicManagerTimer *timer;

    if (!LogicManager_ValidateStatefulCall(
            context, IsTimerIdValid(id), (uint16_t)(uint32_t)id,
            preset_ms <= INT32_MAX, LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL : &s_active_manager->timer_usage,
            LOGIC_API_TON))
    {
        return false;
    }
    timer = &s_active_manager->timers[(uint32_t)id];
    if (!input)
    {
        timer->active = false;
        timer->previous_input = false;
        timer->output = false;
        return false;
    }
    if (!timer->active)
    {
        timer->active = true;
        timer->started_ms = context->now_ms;
    }
    timer->previous_input = true;
    timer->output = (uint32_t)(context->now_ms - timer->started_ms) >= preset_ms;
    return timer->output;
}

bool LogicBlock_Tof(LogicContext *context, PointConfigTimerId id, bool input,
                    uint32_t preset_ms)
{
    LogicManagerTimer *timer;

    if (!LogicManager_ValidateStatefulCall(
            context, IsTimerIdValid(id), (uint16_t)(uint32_t)id,
            preset_ms <= INT32_MAX, LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL : &s_active_manager->timer_usage,
            LOGIC_API_TOF))
    {
        return false;
    }
    timer = &s_active_manager->timers[(uint32_t)id];
    if (input)
    {
        timer->active = false;
        timer->output = true;
    }
    else if (timer->previous_input)
    {
        timer->active = true;
        timer->started_ms = context->now_ms;
        timer->output = preset_ms != 0U;
    }
    else if (timer->active &&
             (uint32_t)(context->now_ms - timer->started_ms) >= preset_ms)
    {
        timer->active = false;
        timer->output = false;
    }
    timer->previous_input = input;
    return timer->output;
}

bool LogicBlock_Tp(LogicContext *context, PointConfigTimerId id, bool input,
                   uint32_t preset_ms)
{
    LogicManagerTimer *timer;

    if (!LogicManager_ValidateStatefulCall(
            context, IsTimerIdValid(id), (uint16_t)(uint32_t)id,
            preset_ms <= INT32_MAX, LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL : &s_active_manager->timer_usage,
            LOGIC_API_TP))
    {
        return false;
    }
    timer = &s_active_manager->timers[(uint32_t)id];
    if (input && !timer->previous_input)
    {
        timer->active = preset_ms != 0U;
        timer->started_ms = context->now_ms;
        timer->output = preset_ms != 0U;
    }
    if (timer->active &&
        (uint32_t)(context->now_ms - timer->started_ms) >= preset_ms)
    {
        timer->active = false;
        timer->output = false;
    }
    timer->previous_input = input;
    return timer->output;
}

bool LogicBlock_RisingEdge(LogicContext *context, PointConfigEdgeId id,
                           bool input)
{
    LogicManagerEdge *edge;
    bool result;

    if (!LogicManager_ValidateStatefulCall(
            context, IsEdgeIdValid(id), (uint16_t)(uint32_t)id, true,
            LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL : &s_active_manager->edge_usage,
            LOGIC_API_RISING_EDGE))
    {
        return false;
    }
    edge = &s_active_manager->edges[(uint32_t)id];
    result = input && !edge->previous;
    edge->previous = input;
    return result;
}

bool LogicBlock_FallingEdge(LogicContext *context, PointConfigEdgeId id,
                            bool input)
{
    LogicManagerEdge *edge;
    bool result;

    if (!LogicManager_ValidateStatefulCall(
            context, IsEdgeIdValid(id), (uint16_t)(uint32_t)id, true,
            LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL : &s_active_manager->edge_usage,
            LOGIC_API_FALLING_EDGE))
    {
        return false;
    }
    edge = &s_active_manager->edges[(uint32_t)id];
    result = !input && edge->previous;
    edge->previous = input;
    return result;
}

uint32_t LogicBlock_CounterUp(LogicContext *context, PointConfigCounterId id,
                              bool count, bool reset, uint32_t preset)
{
    LogicManagerCounter *counter;

    if (!LogicManager_ValidateStatefulCall(
            context, IsCounterIdValid(id), (uint16_t)(uint32_t)id, true,
            LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL : &s_active_manager->counter_usage,
            LOGIC_API_COUNTER_UP))
    {
        return 0U;
    }
    counter = &s_active_manager->counters[(uint32_t)id];
    if (reset)
    {
        counter->value = 0U;
    }
    else if (count && !counter->previous_count && counter->value < preset)
    {
        counter->value++;
    }
    counter->previous_count = count;
    return counter->value;
}

uint32_t LogicBlock_CounterDown(LogicContext *context, PointConfigCounterId id,
                                bool count, bool load, uint32_t preset)
{
    LogicManagerCounter *counter;

    if (!LogicManager_ValidateStatefulCall(
            context, IsCounterIdValid(id), (uint16_t)(uint32_t)id, true,
            LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL : &s_active_manager->counter_usage,
            LOGIC_API_COUNTER_DOWN))
    {
        return 0U;
    }
    counter = &s_active_manager->counters[(uint32_t)id];
    if (load)
    {
        counter->value = preset;
    }
    else if (count && !counter->previous_count && counter->value > 0U)
    {
        counter->value--;
    }
    counter->previous_count = count;
    return counter->value;
}

bool LogicBlock_Sr(LogicContext *context, PointConfigLatchId id, bool set,
                   bool reset)
{
#if POINT_CONFIG_LATCH_COUNT == 0U
    (void)set;
    (void)reset;
    (void)LogicManager_ValidateStatefulCall(
        context, false, (uint16_t)(uint32_t)id, true,
        LOGIC_API_ERROR_ARGUMENT,
        s_active_manager == NULL ? NULL : &s_active_manager->latch_usage,
        LOGIC_API_SR);
    return false;
#else
    LogicManagerLatch *latch;

    if (!LogicManager_ValidateStatefulCall(
            context, IsLatchIdValid(id), (uint16_t)(uint32_t)id, true,
            LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL : &s_active_manager->latch_usage,
            LOGIC_API_SR))
    {
        return false;
    }
    latch = &s_active_manager->latches[(uint32_t)id];
    latch->output = set || (latch->output && !reset);
    return latch->output;
#endif
}

bool LogicBlock_Rs(LogicContext *context, PointConfigLatchId id, bool set,
                   bool reset)
{
#if POINT_CONFIG_LATCH_COUNT == 0U
    (void)set;
    (void)reset;
    (void)LogicManager_ValidateStatefulCall(
        context, false, (uint16_t)(uint32_t)id, true,
        LOGIC_API_ERROR_ARGUMENT,
        s_active_manager == NULL ? NULL : &s_active_manager->latch_usage,
        LOGIC_API_RS);
    return false;
#else
    LogicManagerLatch *latch;

    if (!LogicManager_ValidateStatefulCall(
            context, IsLatchIdValid(id), (uint16_t)(uint32_t)id, true,
            LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL : &s_active_manager->latch_usage,
            LOGIC_API_RS))
    {
        return false;
    }
    latch = &s_active_manager->latches[(uint32_t)id];
    latch->output = !reset && (set || latch->output);
    return latch->output;
#endif
}

bool LogicBlock_Debounce(LogicContext *context, PointConfigDebounceId id,
                         bool input, uint32_t stable_ms)
{
#if POINT_CONFIG_DEBOUNCE_COUNT == 0U
    (void)input;
    (void)LogicManager_ValidateStatefulCall(
        context, false, (uint16_t)(uint32_t)id,
        stable_ms <= INT32_MAX, LOGIC_API_ERROR_ARGUMENT,
        s_active_manager == NULL ? NULL : &s_active_manager->debounce_usage,
        LOGIC_API_DEBOUNCE);
    return false;
#else
    LogicManagerDebounce *debounce;

    if (!LogicManager_ValidateStatefulCall(
            context, IsDebounceIdValid(id), (uint16_t)(uint32_t)id,
            stable_ms <= INT32_MAX, LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL :
                &s_active_manager->debounce_usage,
            LOGIC_API_DEBOUNCE))
    {
        return false;
    }
    debounce = &s_active_manager->debounces[(uint32_t)id];
    if (input != debounce->candidate)
    {
        debounce->candidate = input;
        debounce->changed_ms = context->now_ms;
        if (stable_ms == 0U)
        {
            debounce->output = input;
        }
    }
    else if (debounce->output != debounce->candidate &&
             (uint32_t)(context->now_ms - debounce->changed_ms) >= stable_ms)
    {
        debounce->output = debounce->candidate;
    }
    return debounce->output;
#endif
}

bool Logic_RequestFault(LogicContext *context, uint16_t reason)
{
    LogicManager *manager = s_active_manager;

    if (manager == NULL || LogicManager_InIsr() ||
        !LogicManager_OwnerMatches(manager) ||
        manager->execution_phase == LOGIC_EXECUTION_NONE)
    {
        LogicManager_RecordApiError(manager == NULL ? s_primary_manager : manager,
                                    LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_REQUEST_FAULT, 0U, reason);
        return false;
    }
    if (context == NULL || context != manager->callback_context ||
        context != &manager->data->working)
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_CONTEXT,
                                    LOGIC_API_REQUEST_FAULT, 0U, reason);
        return false;
    }
    if (reason == 0U || reason > 32767U)
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_ARGUMENT,
                                    LOGIC_API_REQUEST_FAULT, 0U, reason);
        return false;
    }
    LogicManager_RecordApiError(manager, LOGIC_API_ERROR_PROJECT_FAULT,
                                LOGIC_API_REQUEST_FAULT, 0U, reason);
    return true;
}

bool Logic_ParametersReady(const LogicContext *context)
{
    LogicManager *manager = s_active_manager;

    if (manager == NULL || LogicManager_InIsr() ||
        !LogicManager_OwnerMatches(manager) ||
        manager->execution_phase == LOGIC_EXECUTION_NONE)
    {
        LogicManager_RecordApiError(manager == NULL ? s_primary_manager : manager,
                                    LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_PARAMETERS_READY, 0U, 0U);
        return false;
    }
    if (context == NULL || context != manager->callback_context ||
        context != &manager->data->working)
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_CONTEXT,
                                    LOGIC_API_PARAMETERS_READY, 0U, 0U);
        return false;
    }
    return DataManager_AreParametersReady(manager->data);
}

bool LogicBlock_ClampChecked(float value, float minimum, float maximum,
                             float *output)
{
    float candidate;

    if (output == NULL || !isfinite(value) || !isfinite(minimum) ||
        !isfinite(maximum) || minimum > maximum)
    {
        LogicManager_RecordCheckedError(LOGIC_API_CLAMP,
                                        LOGIC_API_ERROR_ARGUMENT);
        return false;
    }
    candidate = value < minimum ? minimum :
        (value > maximum ? maximum : value);
    if (!isfinite(candidate))
    {
        LogicManager_RecordCheckedError(LOGIC_API_CLAMP,
                                        LOGIC_API_ERROR_NUMERIC);
        return false;
    }
    *output = candidate;
    return true;
}

float LogicBlock_Clamp(float value, float minimum, float maximum)
{
    float output;

    if (LogicBlock_ClampChecked(value, minimum, maximum, &output))
    {
        return output;
    }
    return isfinite(minimum) ? minimum : 0.0f;
}

bool LogicBlock_Scale(float input, float input_min, float input_max,
                      float output_min, float output_max, float *output)
{
    float candidate;

    if (output == NULL || !isfinite(input) || !isfinite(input_min) ||
        !isfinite(input_max) || !isfinite(output_min) || !isfinite(output_max) ||
        input_min == input_max)
    {
        LogicManager_RecordCheckedError(LOGIC_API_SCALE,
                                        LOGIC_API_ERROR_ARGUMENT);
        return false;
    }
    candidate = output_min + (input - input_min) * (output_max - output_min) /
        (input_max - input_min);
    if (!isfinite(candidate))
    {
        LogicManager_RecordCheckedError(LOGIC_API_SCALE,
                                        LOGIC_API_ERROR_NUMERIC);
        return false;
    }
    *output = candidate;
    return true;
}

bool LogicBlock_HysteresisChecked(float value, float low, float high,
                                  bool previous, bool *output)
{
    bool candidate;

    if (output == NULL || !isfinite(value) || !isfinite(low) ||
        !isfinite(high) || low > high)
    {
        LogicManager_RecordCheckedError(LOGIC_API_HYSTERESIS,
                                        LOGIC_API_ERROR_ARGUMENT);
        return false;
    }
    if (value >= high)
    {
        candidate = true;
    }
    else
    {
        candidate = value <= low ? false : previous;
    }
    *output = candidate;
    return true;
}

bool LogicBlock_Hysteresis(float value, float low, float high, bool previous)
{
    bool output;

    return LogicBlock_HysteresisChecked(value, low, high, previous, &output) ?
        output : previous;
}

bool LogicBlock_DeadbandChecked(float value, float reference, float width,
                                bool *output)
{
    float delta;

    if (output == NULL || !isfinite(value) || !isfinite(reference) ||
        !isfinite(width) || width < 0.0f)
    {
        LogicManager_RecordCheckedError(LOGIC_API_DEADBAND,
                                        LOGIC_API_ERROR_ARGUMENT);
        return false;
    }
    delta = value - reference;
    if (!isfinite(delta))
    {
        LogicManager_RecordCheckedError(LOGIC_API_DEADBAND,
                                        LOGIC_API_ERROR_NUMERIC);
        return false;
    }
    *output = fabsf(delta) > width;
    return true;
}

bool LogicBlock_Deadband(float value, float reference, float width)
{
    bool output;

    return LogicBlock_DeadbandChecked(value, reference, width, &output) ?
        output : false;
}

bool LogicBlock_Filter(LogicContext *context, PointConfigFilterId id,
                       float input, uint32_t time_constant_ms, float *output)
{
#if POINT_CONFIG_FILTER_COUNT == 0U
    (void)LogicManager_ValidateStatefulCall(
        context, false, (uint16_t)(uint32_t)id,
        output != NULL && isfinite(input) && time_constant_ms <= INT32_MAX,
        LOGIC_API_ERROR_ARGUMENT,
        s_active_manager == NULL ? NULL : &s_active_manager->filter_usage,
        LOGIC_API_FILTER);
    return false;
#else
    LogicManagerAnalogBlock *filter;
    LogicManagerAnalogBlock candidate;
    uint32_t elapsed_u32;
    float elapsed_ms;
    float alpha;
    float delta;
    float next_value;

    if (!LogicManager_ValidateStatefulCall(
            context, IsFilterIdValid(id), (uint16_t)(uint32_t)id,
            output != NULL && isfinite(input) &&
                time_constant_ms <= INT32_MAX,
            LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL : &s_active_manager->filter_usage,
            LOGIC_API_FILTER))
    {
        return false;
    }
    filter = &s_active_manager->filters[(uint32_t)id];
    candidate = *filter;
    if (!candidate.initialized)
    {
        candidate.value = input;
        candidate.last_step_ms = context->now_ms;
        candidate.initialized = true;
    }
    else if (time_constant_ms == 0U)
    {
        candidate.value = input;
        candidate.last_step_ms = context->now_ms;
    }
    else
    {
        elapsed_u32 = (uint32_t)(context->now_ms - candidate.last_step_ms);
        if (elapsed_u32 > INT32_MAX)
        {
            LogicManager_RecordApiError(s_active_manager,
                                         LOGIC_API_ERROR_ARGUMENT,
                                         LOGIC_API_FILTER,
                                         (uint16_t)(uint32_t)id, 0U);
            return false;
        }
        elapsed_ms = (float)elapsed_u32;
        alpha = elapsed_ms / ((float)time_constant_ms + elapsed_ms);
        delta = input - candidate.value;
        next_value = candidate.value + alpha * delta;
        if (!isfinite(alpha) || !isfinite(delta) || !isfinite(next_value))
        {
            LogicManager_RecordApiError(s_active_manager,
                                         LOGIC_API_ERROR_NUMERIC,
                                         LOGIC_API_FILTER,
                                         (uint16_t)(uint32_t)id, 0U);
            return false;
        }
        candidate.value = next_value;
        candidate.last_step_ms = context->now_ms;
    }
    *filter = candidate;
    *output = candidate.value;
    return true;
#endif
}

bool LogicBlock_RateLimit(LogicContext *context, PointConfigRateLimitId id,
                          float input, float rise_per_second,
                          float fall_per_second, float *output)
{
#if POINT_CONFIG_RATE_LIMIT_COUNT == 0U
    (void)LogicManager_ValidateStatefulCall(
        context, false, (uint16_t)(uint32_t)id,
        output != NULL && isfinite(input) && isfinite(rise_per_second) &&
            isfinite(fall_per_second) && rise_per_second >= 0.0f &&
            fall_per_second >= 0.0f,
        LOGIC_API_ERROR_ARGUMENT,
        s_active_manager == NULL ? NULL : &s_active_manager->rate_limit_usage,
        LOGIC_API_RATE_LIMIT);
    return false;
#else
    LogicManagerAnalogBlock *rate_limit;
    LogicManagerAnalogBlock candidate;
    uint32_t elapsed_u32;
    float elapsed_seconds;
    float delta;
    float maximum_delta;
    float limited_delta;
    float next_value;

    if (!LogicManager_ValidateStatefulCall(
            context, IsRateLimitIdValid(id), (uint16_t)(uint32_t)id,
            output != NULL && isfinite(input) &&
                isfinite(rise_per_second) && isfinite(fall_per_second) &&
                rise_per_second >= 0.0f && fall_per_second >= 0.0f,
            LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL :
                &s_active_manager->rate_limit_usage,
            LOGIC_API_RATE_LIMIT))
    {
        return false;
    }
    rate_limit = &s_active_manager->rate_limits[(uint32_t)id];
    candidate = *rate_limit;
    if (!candidate.initialized)
    {
        candidate.value = input;
        candidate.last_step_ms = context->now_ms;
        candidate.initialized = true;
    }
    else
    {
        elapsed_u32 = (uint32_t)(context->now_ms - candidate.last_step_ms);
        if (elapsed_u32 > INT32_MAX)
        {
            LogicManager_RecordApiError(s_active_manager,
                                         LOGIC_API_ERROR_ARGUMENT,
                                         LOGIC_API_RATE_LIMIT,
                                         (uint16_t)(uint32_t)id, 0U);
            return false;
        }
        elapsed_seconds = (float)elapsed_u32 / 1000.0f;
        delta = input - candidate.value;
        maximum_delta = (delta >= 0.0f ? rise_per_second : fall_per_second) *
            elapsed_seconds;
        if (!isfinite(delta) || !isfinite(maximum_delta))
        {
            LogicManager_RecordApiError(s_active_manager,
                                         LOGIC_API_ERROR_NUMERIC,
                                         LOGIC_API_RATE_LIMIT,
                                         (uint16_t)(uint32_t)id, 0U);
            return false;
        }
        limited_delta = delta < -maximum_delta ? -maximum_delta :
            (delta > maximum_delta ? maximum_delta : delta);
        next_value = candidate.value + limited_delta;
        if (!isfinite(next_value))
        {
            LogicManager_RecordApiError(s_active_manager,
                                         LOGIC_API_ERROR_NUMERIC,
                                         LOGIC_API_RATE_LIMIT,
                                         (uint16_t)(uint32_t)id, 0U);
            return false;
        }
        candidate.value = next_value;
        candidate.last_step_ms = context->now_ms;
    }
    *rate_limit = candidate;
    *output = candidate.value;
    return true;
#endif
}

static float PidError(const PointConfigPid *config,
                      const M1LogicPidInput *input)
{
    return config->direction == POINT_CONFIG_PID_DIRECT ?
        input->setpoint - input->measurement :
        input->measurement - input->setpoint;
}

static void PidPublishStatus(const LogicManagerPid *pid,
                             PointConfigQuality input_quality,
                             bool running, bool updated, bool tracking,
                             M1LogicPidStatus *status)
{
    status->output = pid->output;
    status->error = pid->error;
    status->p_term = pid->p_term;
    status->i_term = pid->i_term;
    status->d_term = pid->d_term;
    status->unclamped_output = pid->unclamped_output;
    status->running = running;
    status->updated = updated;
    status->saturated_high = pid->saturated_high;
    status->saturated_low = pid->saturated_low;
    status->saturated = pid->saturated_high || pid->saturated_low;
    status->tracking = tracking;
    status->integral_held = pid->integral_held;
    status->input_quality = input_quality;
}

static void PidAlignToExternalOutput(const PointConfigPid *config,
                                     LogicManagerPid *pid,
                                     const M1LogicPidInput *input,
                                     float requested_output,
                                     bool tracking)
{
    pid->error = PidError(config, input);
    pid->p_term = config->kp * pid->error;
    pid->filtered_derivative = 0.0f;
    pid->d_term = 0.0f;
    pid->output = LogicBlock_Clamp(requested_output, config->output_min,
                                   config->output_max);
    pid->integral = pid->output - pid->p_term;
    pid->i_term = pid->integral;
    pid->unclamped_output = requested_output;
    pid->previous_measurement = input->measurement;
    pid->saturated_high = requested_output > config->output_max;
    pid->saturated_low = requested_output < config->output_min;
    pid->integral_held = true;
    pid->initialized = true;
    pid->manual_mode = !tracking;
    pid->tracking_mode = tracking;
}

static bool PidStepMutable(const PointConfigPid *config, LogicManagerPid *pid,
                           LogicContext *context,
                           const M1LogicPidInput *input,
                           M1LogicPidStatus *status)
{
    float raw_derivative;
    float candidate;
    float dt_seconds;
    float filter_seconds;
    float alpha;
    bool integral_allowed;

    if (config == NULL || pid == NULL || context == NULL || input == NULL ||
        status == NULL || !isfinite(input->measurement) ||
        !isfinite(input->setpoint) || !isfinite(input->manual_output) ||
        (input->tracking_mode && !isfinite(input->tracking_output)) ||
        config->sample_period_ms == 0U ||
        !isfinite(config->output_min) || !isfinite(config->output_max) ||
        config->output_min >= config->output_max ||
        !isfinite(config->kp) || !isfinite(config->ki) ||
        !isfinite(config->kd) || config->kp < 0.0f || config->ki < 0.0f ||
        config->kd < 0.0f ||
        (config->kd > 0.0f && config->derivative_filter_ms == 0U))
    {
        return false;
    }
    memset(status, 0, sizeof(*status));
    status->input_quality = input->measurement_quality;
    if (!input->enabled || input->measurement_quality != POINT_CONFIG_QUALITY_GOOD)
    {
        memset(pid, 0, sizeof(*pid));
        pid->output = config->output_min;
        pid->unclamped_output = config->output_min;
        PidPublishStatus(pid, input->measurement_quality, false, false,
                         false, status);
        return true;
    }
    if (input->tracking_mode)
    {
        PidAlignToExternalOutput(config, pid, input, input->tracking_output,
                                 true);
        pid->last_step_ms = context->now_ms;
        PidPublishStatus(pid, input->measurement_quality, true, true, true,
                         status);
        return true;
    }
    if (input->manual_mode)
    {
        PidAlignToExternalOutput(config, pid, input, input->manual_output,
                                 false);
        pid->last_step_ms = context->now_ms;
        PidPublishStatus(pid, input->measurement_quality, true, true, false,
                         status);
        return true;
    }
    if (pid->initialized && (pid->manual_mode || pid->tracking_mode))
    {
        /* 外部控制切自动时，以当前输出反算积分并重建微分基线。本扫描保持
         * 原输出；下一采样周期才闭环，适用于手动和主备/下游跟踪切换。 */
        pid->error = PidError(config, input);
        pid->p_term = config->kp * pid->error;
        pid->integral = pid->output - pid->p_term;
        pid->i_term = pid->integral;
        pid->filtered_derivative = 0.0f;
        pid->d_term = 0.0f;
        pid->unclamped_output = pid->output;
        pid->previous_measurement = input->measurement;
        pid->last_step_ms = context->now_ms;
        pid->manual_mode = false;
        pid->tracking_mode = false;
        pid->saturated_high = false;
        pid->saturated_low = false;
        pid->integral_held = true;
        PidPublishStatus(pid, input->measurement_quality, true, false, false,
                         status);
        return true;
    }
    if (pid->initialized &&
        (uint32_t)(context->now_ms - pid->last_step_ms) < config->sample_period_ms)
    {
        PidPublishStatus(pid, input->measurement_quality, true, false, false,
                         status);
        return true;
    }
    if (!pid->initialized)
    {
        pid->error = PidError(config, input);
        pid->p_term = config->kp * pid->error;
        pid->i_term = 0.0f;
        pid->d_term = 0.0f;
        pid->unclamped_output = config->output_min;
        pid->previous_measurement = input->measurement;
        pid->last_step_ms = context->now_ms;
        pid->output = config->output_min;
        pid->integral_held = true;
        pid->initialized = true;
        /* 首样本只建立测量基线，不在 enable 的同一扫描给 AO 阶跃。 */
        PidPublishStatus(pid, input->measurement_quality, true, false, false,
                         status);
        return true;
    }
    if ((uint32_t)(context->now_ms - pid->last_step_ms) > INT32_MAX)
    {
        return false;
    }
    dt_seconds = (float)(uint32_t)(context->now_ms - pid->last_step_ms) / 1000.0f;
    if (dt_seconds <= 0.0f)
    {
        dt_seconds = (float)config->sample_period_ms / 1000.0f;
    }
    pid->error = PidError(config, input);
    raw_derivative = (input->measurement - pid->previous_measurement) /
        dt_seconds;
    if (config->direction == POINT_CONFIG_PID_DIRECT)
    {
        raw_derivative = -raw_derivative;
    }
    filter_seconds = (float)config->derivative_filter_ms / 1000.0f;
    if (config->kd > 0.0f)
    {
        alpha = dt_seconds / (filter_seconds + dt_seconds);
        pid->filtered_derivative +=
            alpha * (raw_derivative - pid->filtered_derivative);
    }
    else
    {
        pid->filtered_derivative = 0.0f;
    }
    pid->p_term = config->kp * pid->error;
    pid->i_term = pid->integral;
    pid->d_term = config->kd * pid->filtered_derivative;
    candidate = pid->p_term + pid->i_term + pid->d_term;
    pid->unclamped_output = candidate;
    pid->output = LogicBlock_Clamp(candidate, config->output_min,
                                   config->output_max);
    pid->saturated_high = candidate > config->output_max;
    pid->saturated_low = candidate < config->output_min;
    integral_allowed = !input->integral_hold &&
        ((!pid->saturated_high && !pid->saturated_low) ||
         (pid->saturated_high && pid->error < 0.0f) ||
         (pid->saturated_low && pid->error > 0.0f));
    pid->integral_held = !integral_allowed;
    if (integral_allowed)
    {
        pid->integral += config->ki * pid->error * dt_seconds;
    }
    pid->previous_measurement = input->measurement;
    pid->last_step_ms = context->now_ms;
    PidPublishStatus(pid, input->measurement_quality, true, true, false,
                     status);
    return true;
}

static bool PidStateIsFinite(const LogicManagerPid *pid,
                             const M1LogicPidStatus *status)
{
    return isfinite(pid->integral) && isfinite(pid->filtered_derivative) &&
        isfinite(pid->previous_measurement) && isfinite(pid->output) &&
        isfinite(pid->error) && isfinite(pid->p_term) &&
        isfinite(pid->i_term) && isfinite(pid->d_term) &&
        isfinite(pid->unclamped_output) && isfinite(status->output) &&
        isfinite(status->error) && isfinite(status->p_term) &&
        isfinite(status->i_term) && isfinite(status->d_term) &&
        isfinite(status->unclamped_output);
}

static bool PidStep(const PointConfigPid *config, LogicManagerPid *pid,
                    LogicContext *context, const M1LogicPidInput *input,
                    M1LogicPidStatus *status)
{
    LogicManagerPid candidate;
    M1LogicPidStatus candidate_status;
    PointConfigPid runtime_config;

    if (status != NULL)
    {
        memset(status, 0, sizeof(*status));
    }
    if (config == NULL || pid == NULL || context == NULL || input == NULL ||
        status == NULL)
    {
        return false;
    }
    if (input->use_runtime_gains)
    {
        runtime_config = *config;
        runtime_config.kp = input->runtime_kp;
        runtime_config.ki = input->runtime_ki;
        config = &runtime_config;
    }
    candidate = *pid;
    memset(&candidate_status, 0, sizeof(candidate_status));
    if (!PidStepMutable(config, &candidate, context, input,
                        &candidate_status) ||
        !PidStateIsFinite(&candidate, &candidate_status))
    {
        return false;
    }
    *pid = candidate;
    *status = candidate_status;
    return true;
}

bool LogicBlock_PidStep(LogicContext *context, PointConfigPidId id,
                        const M1LogicPidInput *input, M1LogicPidStatus *status)
{
    if (!LogicManager_ValidateStatefulCall(
            context, IsPidIdValid(id), (uint16_t)(uint32_t)id,
            input != NULL && status != NULL, LOGIC_API_ERROR_ARGUMENT,
            s_active_manager == NULL ? NULL : &s_active_manager->pid_step_usage,
            LOGIC_API_PID_STEP))
    {
        if (status != NULL)
        {
            memset(status, 0, sizeof(*status));
        }
        return false;
    }
    if (!PidStep(&g_point_config.pids[(uint32_t)id],
                 &s_active_manager->pids[(uint32_t)id], context, input,
                 status))
    {
        LogicManager_RecordApiError(s_active_manager, LOGIC_API_ERROR_NUMERIC,
                                    LOGIC_API_PID_STEP,
                                    (uint16_t)(uint32_t)id, 0U);
        return false;
    }
    return true;
}

#if defined(KZ3_LOGIC_MANAGER_UNIT_TEST)
bool LogicBlock_PidStepForTest(const PointConfigPid *config,
                               LogicManagerPid *pid,
                               LogicContext *context,
                               const M1LogicPidInput *input,
                               M1LogicPidStatus *status)
{
    return PidStep(config, pid, context, input, status);
}
#endif

void LogicBlock_PidReset(PointConfigPidId id)
{
    LogicManager *manager = s_active_manager;
    uint16_t instance_id = (uint16_t)(uint32_t)id;

    if (manager == NULL)
    {
        LogicManager_RecordApiError(s_primary_manager, LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_PID_RESET, instance_id, 0U);
        return;
    }
    if (LogicManager_InIsr() || !LogicManager_OwnerMatches(manager) ||
        manager->execution_phase == LOGIC_EXECUTION_NONE)
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_PID_RESET, instance_id, 0U);
        return;
    }
    if (!IsPidIdValid(id))
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_INSTANCE,
                                    LOGIC_API_PID_RESET, instance_id, 0U);
        return;
    }
    if (manager->execution_phase == LOGIC_EXECUTION_SCAN &&
        (manager->pid_step_usage & (1UL << instance_id)) != 0U)
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_DUPLICATE,
                                    LOGIC_API_PID_RESET, instance_id, 0U);
        return;
    }
    /* 同拍重复 reset 幂等；reset 后的首次 Step 由 pid_step_usage 控制。 */
    memset(&manager->pids[(uint32_t)id], 0,
           sizeof(manager->pids[(uint32_t)id]));
}

#if POINT_CONFIG_PID_COUNT > 0U || defined(KZ3_LOGIC_MANAGER_UNIT_TEST)
static bool PidOutputToU16(const PointConfigPid *config, float output,
                           uint16_t *raw_output)
{
    if (config == NULL || raw_output == NULL || !isfinite(output) ||
        config->output_type != POINT_CONFIG_VALUE_U16 ||
        config->output_raw_min >= config->output_raw_max ||
        config->output_min < (float)config->output_raw_min ||
        config->output_max > (float)config->output_raw_max ||
        output < config->output_min || output > config->output_max)
    {
        return false;
    }
    *raw_output = (uint16_t)(output + 0.5f);
    return true;
}
#endif

bool LogicBlock_PidOutputToU16(PointConfigPidId id, float output,
                               uint16_t *raw_output)
{
#if POINT_CONFIG_PID_COUNT == 0U
    (void)output;
    (void)raw_output;
    if (s_active_manager != NULL)
    {
        LogicManager_RecordApiError(s_active_manager,
                                     LOGIC_API_ERROR_INSTANCE,
                                     LOGIC_API_PID_TO_U16,
                                     (uint16_t)(uint32_t)id, 0U);
    }
    return false;
#else
    LogicManager *manager = s_active_manager;

    if (manager == NULL || LogicManager_InIsr() ||
        !LogicManager_OwnerMatches(manager) ||
        manager->execution_phase == LOGIC_EXECUTION_NONE)
    {
        LogicManager_RecordApiError(manager == NULL ? s_primary_manager : manager,
                                    LOGIC_API_ERROR_PHASE,
                                    LOGIC_API_PID_TO_U16,
                                    (uint16_t)(uint32_t)id, 0U);
        return false;
    }
    if (!IsPidIdValid(id))
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_INSTANCE,
                                    LOGIC_API_PID_TO_U16,
                                    (uint16_t)(uint32_t)id, 0U);
        return false;
    }
    if (!PidOutputToU16(&g_point_config.pids[(uint32_t)id], output,
                        raw_output))
    {
        LogicManager_RecordApiError(manager, LOGIC_API_ERROR_ARGUMENT,
                                    LOGIC_API_PID_TO_U16,
                                    (uint16_t)(uint32_t)id, 0U);
        return false;
    }
    return true;
#endif
}

#if defined(KZ3_LOGIC_MANAGER_UNIT_TEST)
bool LogicBlock_PidOutputToU16ForTest(const PointConfigPid *config,
                                      float output, uint16_t *raw_output)
{
    return PidOutputToU16(config, output, raw_output);
}
#endif

void LogicManager_ServicePersistence(LogicManager *manager, uint32_t now_ms)
{
    LogicRuntimeStoreOperation operation;
    bool success;

    if (manager == NULL || !manager->initialized)
    {
        return;
    }
    LogicManager_RuntimeLock();
    LogicRuntimeStore_UpdateSystemTime(&manager->runtime_store, now_ms);
    LogicRuntimeStore_RequestSystemSave(&manager->runtime_store, now_ms);
    if (!LogicRuntimeStore_BeginOperation(&manager->runtime_store, now_ms,
                                          &operation))
    {
        LogicManager_RuntimeUnlock();
        return;
    }
    LogicManager_RuntimeUnlock();
    success = operation.type == LOGIC_RUNTIME_STORE_OPERATION_WRITE ?
        EepromTransport_WriteAndVerify(operation.data, operation.address,
                                       operation.length) == 0U :
        EepromTransport_Read(operation.data, operation.address,
                             operation.length) == 0U;
    LogicManager_RuntimeLock();
    LogicRuntimeStore_FinishOperation(&manager->runtime_store, now_ms,
                                      &operation, success);
    LogicManager_RuntimeUnlock();
}

bool LogicManager_GetSystemLifetime(LogicManager *manager, uint32_t *boot_count,
                                    uint32_t *total_seconds, bool *boot_count_valid,
                                    uint32_t *fault_mask, bool *busy)
{
    if (manager == NULL || !manager->initialized)
    {
        return false;
    }
    LogicManager_RuntimeLock();
    LogicRuntimeStore_GetSystemSnapshot(&manager->runtime_store, boot_count,
                                         total_seconds, boot_count_valid,
                                         fault_mask, busy);
    LogicManager_RuntimeUnlock();
    return true;
}

bool LogicManager_GetPrimarySystemLifetime(uint32_t *boot_count,
                                           uint32_t *total_seconds,
                                           bool *boot_count_valid,
                                           uint32_t *fault_mask, bool *busy)
{
    return LogicManager_GetSystemLifetime(s_primary_manager, boot_count,
                                          total_seconds, boot_count_valid,
                                          fault_mask, busy);
}
