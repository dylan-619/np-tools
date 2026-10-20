#include "data_manager.h"

#include <math.h>
#include <stddef.h>
#include <string.h>

/* DataManager 同时被控制、网络和 SLE 任务访问。固件侧使用极短临界区保护
 * 过程映像交换；UART ISR 不得调用本模块。主机单元测试只有单线程，因此不
 * 引入 FreeRTOS 依赖。 */
#if defined(__arm__) || defined(__thumb__)
#include "FreeRTOS.h"
#include "task.h"
static void DataManager_Lock(void)
{
    taskENTER_CRITICAL();
}

static void DataManager_Unlock(void)
{
    taskEXIT_CRITICAL();
}
#else
static void DataManager_Lock(void)
{
}

static void DataManager_Unlock(void)
{
}
#endif

static void *BindingAddress(LogicContext *context,
                            const PointConfigBinding *binding)
{
    return (uint8_t *)context + binding->context_offset;
}

static const void *ConstBindingAddress(const LogicContext *context,
                                       const PointConfigBinding *binding)
{
    return (const uint8_t *)context + binding->context_offset;
}

static void *PendingCommandAddress(LogicCommands *commands,
                                   const PointConfigBinding *binding)
{
    return (uint8_t *)commands + binding->context_offset -
           offsetof(LogicContext, command);
}

static bool *CommandOffsetAddress(LogicCommands *commands, uint16_t offset)
{
    return (bool *)((uint8_t *)commands + offset -
                    offsetof(LogicContext, command));
}

static bool IsControllerStopOffset(uint16_t offset)
{
    return offset == offsetof(LogicContext, command.controller_stop);
}

static bool IsControllerResetOffset(uint16_t offset)
{
    return offset == offsetof(LogicContext, command.controller_reset);
}

static bool CommandIsProtective(uint16_t offset)
{
    uint16_t index;

    for (index = 0U; index < g_point_config.command_policy_count; ++index)
    {
        const PointConfigCommandPolicy *policy =
            &g_point_config.command_policies[index];

        if (policy->offset == offset)
        {
            return policy->effect == POINT_CONFIG_COMMAND_PROTECTIVE;
        }
    }
    return false;
}

static void CloseCommandBarrierLocked(DataManager *manager)
{
    uint16_t index;

    if (!manager->command_barrier_closed)
    {
        manager->command_barrier_closed = true;
        manager->command_epoch++;
    }
    for (index = 0U; index < g_point_config.command_policy_count; ++index)
    {
        const PointConfigCommandPolicy *policy =
            &g_point_config.command_policies[index];

        if (policy->effect == POINT_CONFIG_COMMAND_PROTECTIVE)
        {
            continue;
        }
        *CommandOffsetAddress(&manager->pending_commands, policy->offset) = false;
        *CommandOffsetAddress(&manager->active.command, policy->offset) = false;
        if (manager->scan_open)
        {
            *CommandOffsetAddress(&manager->working.command, policy->offset) = false;
        }
    }
}

static const PointConfigNorthField *FindNorthField(const char *bind)
{
    uint16_t index;

    for (index = 0U; index < g_point_config.north_field_count; ++index)
    {
        if (strcmp(g_point_config.north_fields[index].bind, bind) == 0)
        {
            return &g_point_config.north_fields[index];
        }
    }
    return NULL;
}

static DataManagerFaultSource FaultSourceFromCode(DataManagerFault code)
{
    switch (code)
    {
        case DATA_MANAGER_FAULT_CONFIGURATION:
            return DATA_MANAGER_FAULT_SOURCE_CONFIGURATION;
        case DATA_MANAGER_FAULT_INPUT_QUALITY:
            return DATA_MANAGER_FAULT_SOURCE_INPUT;
        case DATA_MANAGER_FAULT_LOGIC_SCAN:
            return DATA_MANAGER_FAULT_SOURCE_LOGIC;
        case DATA_MANAGER_FAULT_SOUTHBOND:
            return DATA_MANAGER_FAULT_SOURCE_SOUTHBOND;
        case DATA_MANAGER_FAULT_HEALTH:
            return DATA_MANAGER_FAULT_SOURCE_HEALTH;
        default:
            return DATA_MANAGER_FAULT_SOURCE_NONE;
    }
}

static void RecordFaultLocked(DataManager *manager, DataManagerFault fault,
                              uint32_t now_ms)
{
    uint8_t index;

    for (index = 0U; index < DATA_MANAGER_FAULT_EVENT_COUNT; ++index)
    {
        DataManagerFault code = (DataManagerFault)(1U << index);
        DataManagerFaultEvent *event = &manager->fault_events[index];

        if (((uint32_t)fault & (uint32_t)code) == 0U)
        {
            continue;
        }
        if (!event->active)
        {
            event->first_seen_ms = now_ms;
        }
        event->code = code;
        event->source = FaultSourceFromCode(code);
        event->active = true;
        event->latched = true;
        event->detail = 0U;
        event->last_seen_ms = now_ms;
    }
}

static void ClearFaultEventsLocked(DataManager *manager, DataManagerFault fault)
{
    uint8_t index;

    for (index = 0U; index < DATA_MANAGER_FAULT_EVENT_COUNT; ++index)
    {
        if (((uint32_t)fault & (1U << index)) != 0U)
        {
            manager->fault_events[index].active = false;
        }
    }
}

static void ApplySafeOutputs(LogicContext *context)
{
    uint16_t index;

    memset(&context->output, 0, sizeof(context->output));
    for (index = 0U; index < g_point_config.output_safety_count; ++index)
    {
        const PointConfigOutputSafety *safety =
            &g_point_config.output_safety[index];
        const PointConfigBinding *binding = PointConfig_FindBinding(safety->bind);

        if (binding == NULL || binding->kind != POINT_CONFIG_BIND_OUTPUT ||
            binding->type != safety->type)
        {
            continue;
        }
        if (binding->type == POINT_CONFIG_VALUE_BOOL)
        {
            *(bool *)BindingAddress(context, binding) = safety->bool_value;
        }
        else if (binding->type == POINT_CONFIG_VALUE_F32)
        {
            *(float *)BindingAddress(context, binding) = safety->f32_value;
        }
        else if (binding->type == POINT_CONFIG_VALUE_U16)
        {
            *(uint16_t *)BindingAddress(context, binding) = safety->u16_value;
        }
    }
}

static bool ValidateOutputs(const LogicContext *context)
{
    uint16_t index;

    for (index = 0U; index < g_point_config.output_safety_count; ++index)
    {
        const PointConfigOutputSafety *safety =
            &g_point_config.output_safety[index];
        const PointConfigBinding *binding = PointConfig_FindBinding(safety->bind);

        if (binding == NULL || binding->kind != POINT_CONFIG_BIND_OUTPUT ||
            binding->type != safety->type)
        {
            return false;
        }
        if (binding->type == POINT_CONFIG_VALUE_F32)
        {
            float value = *(const float *)ConstBindingAddress(context, binding);

            if (!isfinite(value) || value < safety->minimum ||
                value > safety->maximum)
            {
                return false;
            }
        }
        else if (binding->type == POINT_CONFIG_VALUE_U16)
        {
            uint16_t value = *(const uint16_t *)ConstBindingAddress(context,
                                                                    binding);

            if ((float)value < safety->minimum ||
                (float)value > safety->maximum)
            {
                return false;
            }
        }
    }
    return true;
}

static void RefreshInputQuality(DataManager *manager, uint32_t now_ms)
{
    uint16_t index;

    for (index = 0U; index < g_point_config.binding_count; ++index)
    {
        const PointConfigBinding *binding = &g_point_config.bindings[index];
        uint32_t stale_after_ms = g_point_config.scan_period_ms * 3U;
        uint16_t device_index;

        if (binding->kind != POINT_CONFIG_BIND_INPUT)
        {
            continue;
        }
        if (binding->type == POINT_CONFIG_VALUE_F32 &&
            strncmp(binding->bind, "board.ai", 8U) == 0)
        {
            stale_after_ms = g_point_config.board_ai_stale_after_ms;
        }
        for (device_index = 0U; device_index < g_point_config.rtu_device_count;
             ++device_index)
        {
            const PointConfigRtuDevice *device =
                &g_point_config.rtu_devices[device_index];
            size_t name_length = strlen(device->name);

            if (strncmp(binding->bind, "rtu.", 4U) == 0 &&
                strncmp(binding->bind + 4U, device->name, name_length) == 0 &&
                binding->bind[4U + name_length] == '.')
            {
                stale_after_ms = device->stale_after_ms;
                break;
            }
        }
        if (binding->type == POINT_CONFIG_VALUE_BOOL)
        {
            PointConfigBoolSample *sample = BindingAddress(&manager->active,
                                                            binding);
            if (sample->quality == POINT_CONFIG_QUALITY_GOOD &&
                (uint32_t)(now_ms - sample->update_ms) > stale_after_ms)
            {
                sample->quality = POINT_CONFIG_QUALITY_STALE;
            }
        }
        else if (binding->type == POINT_CONFIG_VALUE_F32)
        {
            PointConfigFloatSample *sample = BindingAddress(&manager->active,
                                                             binding);
            if (sample->quality == POINT_CONFIG_QUALITY_GOOD &&
                (uint32_t)(now_ms - sample->update_ms) > stale_after_ms)
            {
                sample->quality = POINT_CONFIG_QUALITY_STALE;
            }
        }
        else if (binding->type == POINT_CONFIG_VALUE_U16)
        {
            PointConfigU16Sample *sample = BindingAddress(&manager->active,
                                                           binding);

            if (sample->quality == POINT_CONFIG_QUALITY_GOOD &&
                (uint32_t)(now_ms - sample->update_ms) > stale_after_ms)
            {
                sample->quality = POINT_CONFIG_QUALITY_STALE;
            }
        }
    }
    for (index = 0U; index < g_point_config.external_input_count; ++index)
    {
        const PointConfigExternalInput *external =
            &g_point_config.external_inputs[index];
        PointConfigQuality *quality;
        uint32_t *update_ms;
        uint32_t *interruption_count;
        uint32_t elapsed_ms;
        uint32_t limit_ms;

        if (external->type == POINT_CONFIG_VALUE_BOOL)
        {
            PointConfigExternalBoolSample *sample =
                BindingAddress(&manager->active,
                               PointConfig_FindBinding(external->bind));
            quality = &sample->quality;
            update_ms = &sample->update_ms;
            interruption_count = &sample->interruption_count;
        }
        else if (external->type == POINT_CONFIG_VALUE_S32)
        {
            PointConfigExternalS32Sample *sample =
                BindingAddress(&manager->active,
                               PointConfig_FindBinding(external->bind));
            quality = &sample->quality;
            update_ms = &sample->update_ms;
            interruption_count = &sample->interruption_count;
        }
        else
        {
            PointConfigExternalFloatSample *sample =
                BindingAddress(&manager->active,
                               PointConfig_FindBinding(external->bind));
            quality = &sample->quality;
            update_ms = &sample->update_ms;
            interruption_count = &sample->interruption_count;
        }
        limit_ms = *quality == POINT_CONFIG_QUALITY_INIT ?
            external->startup_grace_ms : external->stale_after_ms;
        elapsed_ms = (uint32_t)(now_ms - *update_ms);
        if ((*quality == POINT_CONFIG_QUALITY_INIT ||
             *quality == POINT_CONFIG_QUALITY_GOOD) &&
            elapsed_ms < 0x80000000UL && elapsed_ms > limit_ms)
        {
            *quality = POINT_CONFIG_QUALITY_STALE;
            if (*interruption_count != UINT32_MAX)
            {
                ++(*interruption_count);
            }
        }
    }
}

void DataManager_Init(DataManager *manager)
{
    LogicParameters restored_parameters;

    if (manager == NULL)
    {
        return;
    }
    memset(manager, 0, sizeof(*manager));
    if (!PointConfig_ValidateBuildContract())
    {
        manager->fault_flags = DATA_MANAGER_FAULT_CONFIGURATION;
        manager->active_fault_flags = DATA_MANAGER_FAULT_CONFIGURATION;
        return;
    }
    manager->active.param = g_point_config_default_parameters;
    for (uint16_t index = 0U; index < g_point_config.external_input_count;
         ++index)
    {
        const PointConfigExternalInput *external =
            &g_point_config.external_inputs[index];
        const PointConfigBinding *binding = PointConfig_FindBinding(external->bind);

        if (binding == NULL ||
            binding->kind != POINT_CONFIG_BIND_EXTERNAL_INPUT ||
            binding->type != external->type)
        {
            manager->fault_flags = DATA_MANAGER_FAULT_CONFIGURATION;
            manager->active_fault_flags = DATA_MANAGER_FAULT_CONFIGURATION;
            return;
        }
        if (external->type == POINT_CONFIG_VALUE_BOOL)
        {
            PointConfigExternalBoolSample *sample =
                BindingAddress(&manager->active, binding);
            sample->value = external->default_value.boolean;
            sample->quality = POINT_CONFIG_QUALITY_INIT;
        }
        else if (external->type == POINT_CONFIG_VALUE_S32)
        {
            PointConfigExternalS32Sample *sample =
                BindingAddress(&manager->active, binding);
            sample->value = external->default_value.s32;
            sample->quality = POINT_CONFIG_QUALITY_INIT;
        }
        else if (external->type == POINT_CONFIG_VALUE_F32)
        {
            PointConfigExternalFloatSample *sample =
                BindingAddress(&manager->active, binding);
            sample->value = external->default_value.f32;
            sample->quality = POINT_CONFIG_QUALITY_INIT;
        }
        else
        {
            manager->fault_flags = DATA_MANAGER_FAULT_CONFIGURATION;
            manager->active_fault_flags = DATA_MANAGER_FAULT_CONFIGURATION;
            return;
        }
    }
    LogicParameterStore_Init(&manager->parameter_store);
    restored_parameters = manager->active.param;
    if (LogicParameterStore_Load(&manager->parameter_store,
                                 &restored_parameters) ==
        LOGIC_PARAMETER_STORE_STATUS_OK)
    {
        manager->active.param = restored_parameters;
    }
    ApplySafeOutputs(&manager->active);
    manager->initialized = true;
}

DataManagerResult DataManager_PublishBoolInput(
    DataManager *manager, const char *bind, bool value,
    PointConfigQuality quality, uint32_t update_ms)
{
    const PointConfigBinding *binding;
    PointConfigBoolSample *sample;

    if (manager == NULL || bind == NULL || !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    binding = PointConfig_FindBinding(bind);
    if (binding == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if (binding->kind != POINT_CONFIG_BIND_INPUT ||
        binding->type != POINT_CONFIG_VALUE_BOOL)
    {
        return DATA_MANAGER_TYPE_MISMATCH;
    }
    DataManager_Lock();
    sample = BindingAddress(&manager->active, binding);
    sample->value = value;
    sample->quality = quality;
    sample->update_ms = update_ms;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

DataManagerResult DataManager_PublishF32Input(
    DataManager *manager, const char *bind, float value,
    PointConfigQuality quality, uint32_t update_ms)
{
    const PointConfigBinding *binding;
    PointConfigFloatSample *sample;

    if (manager == NULL || bind == NULL || !manager->initialized ||
        !isfinite(value))
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    binding = PointConfig_FindBinding(bind);
    if (binding == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if (binding->kind != POINT_CONFIG_BIND_INPUT ||
        binding->type != POINT_CONFIG_VALUE_F32)
    {
        return DATA_MANAGER_TYPE_MISMATCH;
    }
    DataManager_Lock();
    sample = BindingAddress(&manager->active, binding);
    sample->value = value;
    sample->quality = quality;
    sample->update_ms = update_ms;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

DataManagerResult DataManager_PublishU16Input(
    DataManager *manager, const char *bind, uint16_t value,
    PointConfigQuality quality, uint32_t update_ms)
{
    const PointConfigBinding *binding;
    PointConfigU16Sample *sample;

    if (manager == NULL || bind == NULL || !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    binding = PointConfig_FindBinding(bind);
    if (binding == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if (binding->kind != POINT_CONFIG_BIND_INPUT ||
        binding->type != POINT_CONFIG_VALUE_U16)
    {
        return DATA_MANAGER_TYPE_MISMATCH;
    }
    DataManager_Lock();
    sample = BindingAddress(&manager->active, binding);
    sample->value = value;
    sample->quality = quality;
    sample->update_ms = update_ms;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

static DataManagerResult ValidateExternalWrite(
    DataManager *manager, const char *bind, PointConfigValueType type,
    const PointConfigExternalInput **external,
    const PointConfigBinding **binding)
{
    if (manager == NULL || bind == NULL || external == NULL || binding == NULL ||
        !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    *binding = PointConfig_FindBinding(bind);
    *external = PointConfig_FindExternalInput(bind);
    if (*binding == NULL || *external == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if ((*binding)->kind != POINT_CONFIG_BIND_EXTERNAL_INPUT ||
        (*binding)->type != type || (*external)->type != type)
    {
        return DATA_MANAGER_TYPE_MISMATCH;
    }
    return DATA_MANAGER_OK;
}

static bool ExternalTimeAccepted(PointConfigQuality quality,
                                 uint32_t previous_ms,
                                 uint32_t received_ms)
{
    return quality == POINT_CONFIG_QUALITY_INIT ||
           (uint32_t)(received_ms - previous_ms) < 0x80000000UL;
}

static bool ExternalGapExceeded(const PointConfigExternalInput *external,
                                PointConfigQuality quality,
                                uint32_t previous_ms,
                                uint32_t received_ms)
{
    uint32_t limit_ms = quality == POINT_CONFIG_QUALITY_INIT ?
        external->startup_grace_ms : external->stale_after_ms;

    return (quality == POINT_CONFIG_QUALITY_INIT ||
            quality == POINT_CONFIG_QUALITY_GOOD) &&
           (uint32_t)(received_ms - previous_ms) > limit_ms;
}

static void IncrementExternalInterruption(uint32_t *count)
{
    if (*count != UINT32_MAX)
    {
        ++(*count);
    }
}

static DataManagerResult ValidateExternalWriteItem(
    DataManager *manager, const DataManagerExternalWriteItem *item,
    const PointConfigExternalInput **external,
    const PointConfigBinding **binding)
{
    DataManagerResult result = ValidateExternalWrite(
        manager, item->bind, item->type, external, binding);

    if (result != DATA_MANAGER_OK)
    {
        return result;
    }
    if (item->type == POINT_CONFIG_VALUE_S32 &&
        (item->value.s32 < (*external)->range.s32.minimum ||
         item->value.s32 > (*external)->range.s32.maximum))
    {
        return DATA_MANAGER_REJECTED;
    }
    if (item->type == POINT_CONFIG_VALUE_F32 &&
        (!isfinite(item->value.f32) ||
         item->value.f32 < (*external)->range.f32.minimum ||
         item->value.f32 > (*external)->range.f32.maximum))
    {
        return DATA_MANAGER_REJECTED;
    }
    return DATA_MANAGER_OK;
}

DataManagerResult DataManager_WriteExternalBatch(
    DataManager *manager, const DataManagerExternalWriteItem *items,
    uint16_t item_count, uint32_t received_ms)
{
    const PointConfigExternalInput *externals[
        POINT_CONFIG_EXTERNAL_INPUT_COUNT > 0U ?
            POINT_CONFIG_EXTERNAL_INPUT_COUNT : 1U];
    const PointConfigBinding *bindings[
        POINT_CONFIG_EXTERNAL_INPUT_COUNT > 0U ?
            POINT_CONFIG_EXTERNAL_INPUT_COUNT : 1U];
    uint16_t index;
    uint16_t other;

    if (manager == NULL || items == NULL || item_count == 0U ||
        item_count > POINT_CONFIG_EXTERNAL_INPUT_COUNT)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    for (index = 0U; index < item_count; ++index)
    {
        DataManagerResult result = ValidateExternalWriteItem(
            manager, &items[index], &externals[index], &bindings[index]);

        if (result != DATA_MANAGER_OK)
        {
            return result;
        }
        for (other = 0U; other < index; ++other)
        {
            if (bindings[other] == bindings[index])
            {
                return DATA_MANAGER_INVALID_ARGUMENT;
            }
        }
    }
    DataManager_Lock();
    for (index = 0U; index < item_count; ++index)
    {
        PointConfigQuality quality;
        uint32_t update_ms;

        if (items[index].type == POINT_CONFIG_VALUE_BOOL)
        {
            const PointConfigExternalBoolSample *sample =
                BindingAddress(&manager->active, bindings[index]);

            quality = sample->quality;
            update_ms = sample->update_ms;
        }
        else if (items[index].type == POINT_CONFIG_VALUE_S32)
        {
            const PointConfigExternalS32Sample *sample =
                BindingAddress(&manager->active, bindings[index]);

            quality = sample->quality;
            update_ms = sample->update_ms;
        }
        else
        {
            const PointConfigExternalFloatSample *sample =
                BindingAddress(&manager->active, bindings[index]);

            quality = sample->quality;
            update_ms = sample->update_ms;
        }
        if (!ExternalTimeAccepted(quality, update_ms, received_ms))
        {
            DataManager_Unlock();
            return DATA_MANAGER_REJECTED;
        }
    }
    for (index = 0U; index < item_count; ++index)
    {
        if (items[index].type == POINT_CONFIG_VALUE_BOOL)
        {
            PointConfigExternalBoolSample *sample =
                BindingAddress(&manager->active, bindings[index]);

            if (ExternalGapExceeded(externals[index], sample->quality,
                                    sample->update_ms, received_ms))
            {
                IncrementExternalInterruption(&sample->interruption_count);
            }
            sample->value = items[index].value.boolean;
            sample->quality = POINT_CONFIG_QUALITY_GOOD;
            sample->update_ms = received_ms;
        }
        else if (items[index].type == POINT_CONFIG_VALUE_S32)
        {
            PointConfigExternalS32Sample *sample =
                BindingAddress(&manager->active, bindings[index]);

            if (ExternalGapExceeded(externals[index], sample->quality,
                                    sample->update_ms, received_ms))
            {
                IncrementExternalInterruption(&sample->interruption_count);
            }
            sample->value = items[index].value.s32;
            sample->quality = POINT_CONFIG_QUALITY_GOOD;
            sample->update_ms = received_ms;
        }
        else
        {
            PointConfigExternalFloatSample *sample =
                BindingAddress(&manager->active, bindings[index]);

            if (ExternalGapExceeded(externals[index], sample->quality,
                                    sample->update_ms, received_ms))
            {
                IncrementExternalInterruption(&sample->interruption_count);
            }
            sample->value = items[index].value.f32;
            sample->quality = POINT_CONFIG_QUALITY_GOOD;
            sample->update_ms = received_ms;
        }
    }
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

DataManagerResult DataManager_WriteExternalBool(
    DataManager *manager, const char *bind, bool value, uint32_t received_ms)
{
    DataManagerExternalWriteItem item = {
        .bind = bind,
        .type = POINT_CONFIG_VALUE_BOOL,
        .value.boolean = value
    };

    return DataManager_WriteExternalBatch(manager, &item, 1U, received_ms);
}

DataManagerResult DataManager_WriteExternalS32(
    DataManager *manager, const char *bind, int32_t value, uint32_t received_ms)
{
    DataManagerExternalWriteItem item = {
        .bind = bind,
        .type = POINT_CONFIG_VALUE_S32,
        .value.s32 = value
    };

    return DataManager_WriteExternalBatch(manager, &item, 1U, received_ms);
}

DataManagerResult DataManager_WriteExternalF32(
    DataManager *manager, const char *bind, float value, uint32_t received_ms)
{
    DataManagerExternalWriteItem item = {
        .bind = bind,
        .type = POINT_CONFIG_VALUE_F32,
        .value.f32 = value
    };

    return DataManager_WriteExternalBatch(manager, &item, 1U, received_ms);
}

DataManagerResult DataManager_BeginLogicScan(DataManager *manager,
                                             uint32_t now_ms,
                                             LogicContext **context)
{
    if (manager == NULL || context == NULL || !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    DataManager_Lock();
    if (manager->scan_open)
    {
        DataManager_Unlock();
        return DATA_MANAGER_BUSY;
    }
    RefreshInputQuality(manager, now_ms);
    manager->working = manager->active;
    /* FAULT/STOP 屏障等待真正的 reset/STOP 转换时，不用空扫描提前消费项目
     * protective 事件；它们与触发安全转换的系统命令同批交给 Stop 回调。 */
    if (manager->command_barrier_closed &&
        !manager->pending_commands.controller_stop &&
        !manager->pending_commands.controller_reset)
    {
        manager->working.command = (LogicCommands){0};
    }
    else
    {
        manager->working.command = manager->pending_commands;
        manager->pending_commands = (LogicCommands){0};
        manager->active.command = (LogicCommands){0};
        if (manager->working.command.controller_stop)
        {
            manager->stop_requested = false;
        }
    }
    manager->working.now_ms = now_ms;
    ApplySafeOutputs(&manager->working);
    manager->scan_open = true;
    *context = &manager->working;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

DataManagerResult DataManager_CommitLogicScan(DataManager *manager,
                                              const LogicContext *context)
{
    if (manager == NULL || context != &manager->working)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    DataManager_Lock();
    if (!manager->scan_open)
    {
        DataManager_Unlock();
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    if (manager->stop_requested)
    {
        ApplySafeOutputs(&manager->active);
        manager->scan_open = false;
        manager->scan_sequence++;
        DataManager_Unlock();
        return DATA_MANAGER_STOP_PENDING;
    }
    if (manager->fault_flags != DATA_MANAGER_FAULT_NONE)
    {
        ApplySafeOutputs(&manager->active);
        manager->scan_open = false;
        DataManager_Unlock();
        return DATA_MANAGER_REJECTED;
    }
    if (!ValidateOutputs(&manager->working))
    {
        CloseCommandBarrierLocked(manager);
        manager->fault_flags |= DATA_MANAGER_FAULT_LOGIC_SCAN;
        manager->active_fault_flags |= DATA_MANAGER_FAULT_LOGIC_SCAN;
        RecordFaultLocked(manager, DATA_MANAGER_FAULT_LOGIC_SCAN,
                          manager->working.now_ms);
        ApplySafeOutputs(&manager->active);
        manager->scan_open = false;
        DataManager_Unlock();
        return DATA_MANAGER_REJECTED;
    }
    manager->active.output = manager->working.output;
    manager->active.state = manager->working.state;
    manager->active.now_ms = manager->working.now_ms;
    manager->scan_open = false;
    manager->scan_sequence++;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

static void AbortLogicScanLocked(DataManager *manager, DataManagerFault fault,
                                 uint32_t now_ms)
{
    if (fault != DATA_MANAGER_FAULT_NONE)
    {
        CloseCommandBarrierLocked(manager);
    }
    manager->fault_flags |= (uint32_t)fault;
    manager->active_fault_flags |= (uint32_t)fault;
    RecordFaultLocked(manager, fault, now_ms);
    manager->active.command = (LogicCommands){0};
    ApplySafeOutputs(&manager->active);
    manager->scan_open = false;
}

void DataManager_AbortLogicScan(DataManager *manager, DataManagerFault fault)
{
    if (manager == NULL)
    {
        return;
    }
    DataManager_Lock();
    AbortLogicScanLocked(manager, fault, manager->scan_open ? manager->working.now_ms :
                                                    manager->active.now_ms);
    DataManager_Unlock();
}

DataManagerResult DataManager_WriteParameterF32(DataManager *manager,
                                                const char *bind, float value,
                                                uint32_t expected_revision,
                                                uint32_t *new_revision)
{
    const PointConfigBinding *binding;
    const PointConfigNorthField *field;
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
    const PointConfigPersistentParameter *persistent;
    LogicParameters candidate;
    LogicParameterStore store_candidate;
    LogicParameterStoreStatus store_status;
    uint32_t now_ms;
#endif

    if (manager == NULL || bind == NULL || new_revision == NULL ||
        !manager->initialized || !isfinite(value))
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    binding = PointConfig_FindBinding(bind);
    field = FindNorthField(bind);
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
    persistent = PointConfig_FindPersistentParameter(bind);
#endif
    if (binding == NULL || field == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if (binding->kind != POINT_CONFIG_BIND_PARAMETER ||
        binding->type != POINT_CONFIG_VALUE_F32 || !field->writable)
    {
        return DATA_MANAGER_READ_ONLY;
    }
    DataManager_Lock();
    if (manager->parameter_write_busy)
    {
        DataManager_Unlock();
        return DATA_MANAGER_BUSY;
    }
    if (expected_revision != manager->parameter_revision)
    {
        DataManager_Unlock();
        return DATA_MANAGER_REVISION_CONFLICT;
    }
    if (value < field->range.f32.minimum ||
        value > field->range.f32.maximum)
    {
        DataManager_Unlock();
        return DATA_MANAGER_REJECTED;
    }
    if (*(float *)BindingAddress(&manager->active, binding) == value &&
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
        (persistent == NULL || manager->parameter_store.record_valid)
#else
        true
#endif
    )
    {
        *new_revision = manager->parameter_revision;
        DataManager_Unlock();
        return DATA_MANAGER_OK;
    }
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT == 0U
    /* 当前项目没有持久参数时，所有参数都只更新 RAM；编译期裁掉 EEPROM
     * 分支，避免空 LogicParameters 占位结构被优化器误判为可写持久字段。 */
    *(float *)BindingAddress(&manager->active, binding) = value;
    manager->parameter_revision++;
    *new_revision = manager->parameter_revision;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
#else
    if (persistent == NULL)
    {
        *(float *)BindingAddress(&manager->active, binding) = value;
        manager->parameter_revision++;
        *new_revision = manager->parameter_revision;
        DataManager_Unlock();
        return DATA_MANAGER_OK;
    }
    candidate = manager->active.param;
    store_candidate = manager->parameter_store;
    *(float *)((uint8_t *)&candidate + persistent->parameter_offset) = value;
    now_ms = manager->active.now_ms;
    manager->parameter_write_busy = true;
    DataManager_Unlock();

    store_status = LogicParameterStore_Commit(
        &store_candidate, &candidate, persistent, now_ms);

    DataManager_Lock();
    manager->parameter_write_busy = false;
    manager->parameter_store = store_candidate;
    if (store_status != LOGIC_PARAMETER_STORE_STATUS_OK)
    {
        DataManager_Unlock();
        return store_status == LOGIC_PARAMETER_STORE_STATUS_BUSY ||
                       store_status == LOGIC_PARAMETER_STORE_STATUS_THROTTLED ?
                   DATA_MANAGER_BUSY : DATA_MANAGER_PERSISTENCE_ERROR;
    }
    *(float *)BindingAddress(&manager->active, binding) = value;
    manager->parameter_revision++;
    *new_revision = manager->parameter_revision;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
#endif
}

DataManagerResult DataManager_WriteParameterBool(DataManager *manager,
                                                 const char *bind, bool value,
                                                 uint32_t expected_revision,
                                                 uint32_t *new_revision)
{
    const PointConfigBinding *binding;
    const PointConfigNorthField *field;
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
    const PointConfigPersistentParameter *persistent;
    LogicParameters candidate;
    LogicParameterStore store_candidate;
    LogicParameterStoreStatus store_status;
    uint32_t now_ms;
#endif

    if (manager == NULL || bind == NULL || new_revision == NULL ||
        !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    binding = PointConfig_FindBinding(bind);
    field = FindNorthField(bind);
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
    persistent = PointConfig_FindPersistentParameter(bind);
#endif
    if (binding == NULL || field == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if (binding->kind != POINT_CONFIG_BIND_PARAMETER ||
        binding->type != POINT_CONFIG_VALUE_BOOL || !field->writable)
    {
        return DATA_MANAGER_READ_ONLY;
    }
    DataManager_Lock();
    if (manager->parameter_write_busy)
    {
        DataManager_Unlock();
        return DATA_MANAGER_BUSY;
    }
    if (expected_revision != manager->parameter_revision)
    {
        DataManager_Unlock();
        return DATA_MANAGER_REVISION_CONFLICT;
    }
    if (*(bool *)BindingAddress(&manager->active, binding) == value &&
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
        (persistent == NULL || manager->parameter_store.record_valid)
#else
        true
#endif
    )
    {
        *new_revision = manager->parameter_revision;
        DataManager_Unlock();
        return DATA_MANAGER_OK;
    }
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT == 0U
    *(bool *)BindingAddress(&manager->active, binding) = value;
    manager->parameter_revision++;
    *new_revision = manager->parameter_revision;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
#else
    if (persistent == NULL)
    {
        *(bool *)BindingAddress(&manager->active, binding) = value;
        manager->parameter_revision++;
        *new_revision = manager->parameter_revision;
        DataManager_Unlock();
        return DATA_MANAGER_OK;
    }
    candidate = manager->active.param;
    store_candidate = manager->parameter_store;
    *(bool *)((uint8_t *)&candidate + persistent->parameter_offset) = value;
    now_ms = manager->active.now_ms;
    manager->parameter_write_busy = true;
    DataManager_Unlock();

    store_status = LogicParameterStore_Commit(
        &store_candidate, &candidate, persistent, now_ms);

    DataManager_Lock();
    manager->parameter_write_busy = false;
    manager->parameter_store = store_candidate;
    if (store_status != LOGIC_PARAMETER_STORE_STATUS_OK)
    {
        DataManager_Unlock();
        return store_status == LOGIC_PARAMETER_STORE_STATUS_BUSY ||
                       store_status == LOGIC_PARAMETER_STORE_STATUS_THROTTLED ?
                   DATA_MANAGER_BUSY : DATA_MANAGER_PERSISTENCE_ERROR;
    }
    *(bool *)BindingAddress(&manager->active, binding) = value;
    manager->parameter_revision++;
    *new_revision = manager->parameter_revision;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
#endif
}

DataManagerResult DataManager_WriteParameterU32(DataManager *manager,
                                                const char *bind,
                                                uint32_t value,
                                                uint32_t expected_revision,
                                                uint32_t *new_revision)
{
    const PointConfigBinding *binding;
    const PointConfigNorthField *field;
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
    const PointConfigPersistentParameter *persistent;
    LogicParameters candidate;
    LogicParameterStore store_candidate;
    LogicParameterStoreStatus store_status;
    uint32_t now_ms;
#endif

    if (manager == NULL || bind == NULL || new_revision == NULL ||
        !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    binding = PointConfig_FindBinding(bind);
    field = FindNorthField(bind);
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
    persistent = PointConfig_FindPersistentParameter(bind);
#endif
    if (binding == NULL || field == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if (binding->kind != POINT_CONFIG_BIND_PARAMETER ||
        binding->type != POINT_CONFIG_VALUE_U32 || !field->writable)
    {
        return DATA_MANAGER_READ_ONLY;
    }
    DataManager_Lock();
    if (manager->parameter_write_busy)
    {
        DataManager_Unlock();
        return DATA_MANAGER_BUSY;
    }
    if (expected_revision != manager->parameter_revision)
    {
        DataManager_Unlock();
        return DATA_MANAGER_REVISION_CONFLICT;
    }
    if (value < field->range.u32.minimum || value > field->range.u32.maximum)
    {
        DataManager_Unlock();
        return DATA_MANAGER_REJECTED;
    }
    if (*(uint32_t *)BindingAddress(&manager->active, binding) == value &&
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
        (persistent == NULL || manager->parameter_store.record_valid)
#else
        true
#endif
    )
    {
        *new_revision = manager->parameter_revision;
        DataManager_Unlock();
        return DATA_MANAGER_OK;
    }
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT == 0U
    *(uint32_t *)BindingAddress(&manager->active, binding) = value;
    manager->parameter_revision++;
    *new_revision = manager->parameter_revision;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
#else
    if (persistent == NULL)
    {
        *(uint32_t *)BindingAddress(&manager->active, binding) = value;
        manager->parameter_revision++;
        *new_revision = manager->parameter_revision;
        DataManager_Unlock();
        return DATA_MANAGER_OK;
    }
    candidate = manager->active.param;
    store_candidate = manager->parameter_store;
    *(uint32_t *)((uint8_t *)&candidate + persistent->parameter_offset) = value;
    now_ms = manager->active.now_ms;
    manager->parameter_write_busy = true;
    DataManager_Unlock();

    store_status = LogicParameterStore_Commit(
        &store_candidate, &candidate, persistent, now_ms);

    DataManager_Lock();
    manager->parameter_write_busy = false;
    manager->parameter_store = store_candidate;
    if (store_status != LOGIC_PARAMETER_STORE_STATUS_OK)
    {
        DataManager_Unlock();
        return store_status == LOGIC_PARAMETER_STORE_STATUS_BUSY ||
                       store_status == LOGIC_PARAMETER_STORE_STATUS_THROTTLED ?
                   DATA_MANAGER_BUSY : DATA_MANAGER_PERSISTENCE_ERROR;
    }
    *(uint32_t *)BindingAddress(&manager->active, binding) = value;
    manager->parameter_revision++;
    *new_revision = manager->parameter_revision;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
#endif
}

DataManagerResult DataManager_SubmitBoolCommand(DataManager *manager,
                                                const char *bind, bool value)
{
    const PointConfigBinding *binding;

    if (manager == NULL || bind == NULL || !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    binding = PointConfig_FindBinding(bind);
    if (binding == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if (binding->kind != POINT_CONFIG_BIND_COMMAND ||
        binding->type != POINT_CONFIG_VALUE_BOOL)
    {
        return DATA_MANAGER_READ_ONLY;
    }
    if (!value)
    {
        return DATA_MANAGER_OK;
    }
    DataManager_Lock();
    if (IsControllerStopOffset(binding->context_offset))
    {
        CloseCommandBarrierLocked(manager);
        manager->stop_requested = true;
    }
    else if (manager->command_barrier_closed &&
             !IsControllerResetOffset(binding->context_offset) &&
             !CommandIsProtective(binding->context_offset))
    {
        DataManager_Unlock();
        return DATA_MANAGER_REJECTED;
    }
    *(bool *)PendingCommandAddress(&manager->pending_commands, binding) = true;
    *(bool *)BindingAddress(&manager->active, binding) = true;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

void DataManager_CloseCommandBarrier(DataManager *manager)
{
    if (manager == NULL || !manager->initialized)
    {
        return;
    }
    DataManager_Lock();
    CloseCommandBarrierLocked(manager);
    DataManager_Unlock();
}

bool DataManager_CompleteSafeTransition(DataManager *manager)
{
    bool can_open;

    if (manager == NULL || !manager->initialized)
    {
        return false;
    }
    DataManager_Lock();
    if (manager->scan_open)
    {
        ApplySafeOutputs(&manager->working);
        manager->active.output = manager->working.output;
        manager->active.state = manager->working.state;
        manager->active.now_ms = manager->working.now_ms;
        manager->scan_open = false;
        manager->scan_sequence++;
    }
    else
    {
        ApplySafeOutputs(&manager->active);
    }
    can_open = !manager->stop_requested &&
               manager->fault_flags == DATA_MANAGER_FAULT_NONE &&
               manager->active_fault_flags == DATA_MANAGER_FAULT_NONE;
    if (can_open)
    {
        manager->command_barrier_closed = false;
    }
    DataManager_Unlock();
    return can_open;
}

DataManagerResult DataManager_ReadBool(const DataManager *manager,
                                       const char *bind, bool *value,
                                       PointConfigQuality *quality)
{
    const PointConfigBinding *binding;

    if (manager == NULL || bind == NULL || value == NULL || !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    binding = PointConfig_FindBinding(bind);
    if (binding == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if (binding->type != POINT_CONFIG_VALUE_BOOL)
    {
        return DATA_MANAGER_TYPE_MISMATCH;
    }
    DataManager_Lock();
    if (binding->kind == POINT_CONFIG_BIND_INPUT)
    {
        const PointConfigBoolSample *sample = ConstBindingAddress(&manager->active,
                                                                   binding);
        *value = sample->value;
        if (quality != NULL)
        {
            *quality = sample->quality;
        }
    }
    else if (binding->kind == POINT_CONFIG_BIND_EXTERNAL_INPUT)
    {
        const PointConfigExternalBoolSample *sample =
            ConstBindingAddress(&manager->active, binding);
        *value = sample->value;
        if (quality != NULL)
        {
            *quality = sample->quality;
        }
    }
    else
    {
        *value = *(const bool *)ConstBindingAddress(&manager->active, binding);
        if (quality != NULL)
        {
            *quality = POINT_CONFIG_QUALITY_GOOD;
        }
    }
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

DataManagerResult DataManager_ReadF32(const DataManager *manager,
                                      const char *bind, float *value,
                                      PointConfigQuality *quality)
{
    const PointConfigBinding *binding;

    if (manager == NULL || bind == NULL || value == NULL || !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    binding = PointConfig_FindBinding(bind);
    if (binding == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if (binding->type != POINT_CONFIG_VALUE_F32)
    {
        return DATA_MANAGER_TYPE_MISMATCH;
    }
    DataManager_Lock();
    if (binding->kind == POINT_CONFIG_BIND_INPUT)
    {
        const PointConfigFloatSample *sample = ConstBindingAddress(&manager->active,
                                                                    binding);
        *value = sample->value;
        if (quality != NULL)
        {
            *quality = sample->quality;
        }
    }
    else if (binding->kind == POINT_CONFIG_BIND_EXTERNAL_INPUT)
    {
        const PointConfigExternalFloatSample *sample =
            ConstBindingAddress(&manager->active, binding);
        *value = sample->value;
        if (quality != NULL)
        {
            *quality = sample->quality;
        }
    }
    else
    {
        *value = *(const float *)ConstBindingAddress(&manager->active, binding);
        if (quality != NULL)
        {
            *quality = POINT_CONFIG_QUALITY_GOOD;
        }
    }
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

DataManagerResult DataManager_ReadU16(const DataManager *manager,
                                      const char *bind, uint16_t *value,
                                      PointConfigQuality *quality)
{
    const PointConfigBinding *binding;

    if (manager == NULL || bind == NULL || value == NULL || !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    binding = PointConfig_FindBinding(bind);
    if (binding == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if (binding->type != POINT_CONFIG_VALUE_U16)
    {
        return DATA_MANAGER_TYPE_MISMATCH;
    }
    DataManager_Lock();
    if (binding->kind == POINT_CONFIG_BIND_INPUT)
    {
        const PointConfigU16Sample *sample = ConstBindingAddress(&manager->active,
                                                                  binding);

        *value = sample->value;
        if (quality != NULL)
        {
            *quality = sample->quality;
        }
    }
    else
    {
        *value = *(const uint16_t *)ConstBindingAddress(&manager->active,
                                                         binding);
        if (quality != NULL)
        {
            *quality = POINT_CONFIG_QUALITY_GOOD;
        }
    }
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

DataManagerResult DataManager_ReadU32(const DataManager *manager,
                                      const char *bind, uint32_t *value,
                                      PointConfigQuality *quality)
{
    const PointConfigBinding *binding;

    if (manager == NULL || bind == NULL || value == NULL || !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    binding = PointConfig_FindBinding(bind);
    if (binding == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if (binding->type != POINT_CONFIG_VALUE_U32 ||
        binding->kind == POINT_CONFIG_BIND_INPUT)
    {
        return DATA_MANAGER_TYPE_MISMATCH;
    }
    DataManager_Lock();
    *value = *(const uint32_t *)ConstBindingAddress(&manager->active, binding);
    if (quality != NULL)
    {
        *quality = POINT_CONFIG_QUALITY_GOOD;
    }
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

DataManagerResult DataManager_ReadS32(const DataManager *manager,
                                      const char *bind, int32_t *value,
                                      PointConfigQuality *quality)
{
    const PointConfigBinding *binding;
    const PointConfigExternalS32Sample *sample;

    if (manager == NULL || bind == NULL || value == NULL || !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    binding = PointConfig_FindBinding(bind);
    if (binding == NULL)
    {
        return DATA_MANAGER_NOT_FOUND;
    }
    if (binding->type != POINT_CONFIG_VALUE_S32 ||
        binding->kind != POINT_CONFIG_BIND_EXTERNAL_INPUT)
    {
        return DATA_MANAGER_TYPE_MISMATCH;
    }
    DataManager_Lock();
    sample = ConstBindingAddress(&manager->active, binding);
    *value = sample->value;
    if (quality != NULL)
    {
        *quality = sample->quality;
    }
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

const LogicContext *DataManager_GetSnapshot(const DataManager *manager)
{
    return manager != NULL && manager->initialized ? &manager->active : NULL;
}

DataManagerResult DataManager_CopySnapshot(const DataManager *manager,
                                           LogicContext *snapshot)
{
    if (manager == NULL || snapshot == NULL || !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    DataManager_Lock();
    *snapshot = manager->active;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

DataManagerResult DataManager_CopyOutputSnapshot(
    const DataManager *manager, LogicContext *snapshot)
{
    if (manager == NULL || snapshot == NULL || !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    DataManager_Lock();
    snapshot->output = manager->active.output;
    DataManager_Unlock();
    return DATA_MANAGER_OK;
}

typedef struct
{
    PointConfigBoolSample di[12];
    bool output[8];
    PointConfigFloatSample ai[4];
    float ao[2];
    uint32_t fault_flags;
    DataManagerFaultEvent fault_events[DATA_MANAGER_FAULT_EVENT_COUNT];
} DataManagerProcessProjection;

DataManagerResult DataManager_CopyProcessSnapshot(
    const DataManager *manager, DataManagerProcessSnapshot *snapshot)
{
    DataManagerProcessProjection process;
    DataManagerProcessSnapshot candidate;
    DataManagerFaultEvent event;
    uint16_t index;
    uint8_t selected_fault = DATA_MANAGER_FAULT_EVENT_COUNT;

    if (manager == NULL || snapshot == NULL || !manager->initialized)
    {
        return DATA_MANAGER_INVALID_ARGUMENT;
    }
    /* 锁内只复制诊断真正需要的紧凑字段；浮点校验、换算和故障选择均在
     * 锁外完成，避免完整 LogicContext 和长计算扩大关中断时间。 */
    DataManager_Lock();
    process.di[0] = manager->active.input.board.di01;
    process.di[1] = manager->active.input.board.di02;
    process.di[2] = manager->active.input.board.di03;
    process.di[3] = manager->active.input.board.di04;
    process.di[4] = manager->active.input.board.di05;
    process.di[5] = manager->active.input.board.di06;
    process.di[6] = manager->active.input.board.di07;
    process.di[7] = manager->active.input.board.di08;
    process.di[8] = manager->active.input.board.di09;
    process.di[9] = manager->active.input.board.di10;
    process.di[10] = manager->active.input.board.di11;
    process.di[11] = manager->active.input.board.di12;
    process.output[0] = manager->active.output.board.do01;
    process.output[1] = manager->active.output.board.do02;
    process.output[2] = manager->active.output.board.do03;
    process.output[3] = manager->active.output.board.do04;
    process.output[4] = manager->active.output.board.do05;
    process.output[5] = manager->active.output.board.do06;
    process.output[6] = manager->active.output.board.do07;
    process.output[7] = manager->active.output.board.do08;
    process.ai[0] = manager->active.input.board.ai01;
    process.ai[1] = manager->active.input.board.ai02;
    process.ai[2] = manager->active.input.board.ai03;
    process.ai[3] = manager->active.input.board.ai04;
    process.ao[0] = manager->active.output.board.ao01;
    process.ao[1] = manager->active.output.board.ao02;
    process.fault_flags = manager->fault_flags;
    memcpy(process.fault_events, manager->fault_events,
           sizeof(process.fault_events));
    DataManager_Unlock();

    memset(&candidate, 0, sizeof(candidate));
    candidate.io_quality = 0x0FU;
    for (index = 0U; index < 12U; ++index)
    {
        candidate.di_bitmap |= process.di[index].value ?
            (uint16_t)(1U << index) : 0U;
        if (process.di[index].quality != POINT_CONFIG_QUALITY_GOOD)
        {
            candidate.io_quality &= (uint16_t)~(1U << 0U);
        }
    }
    for (index = 0U; index < 8U; ++index)
    {
        candidate.do_target_bitmap |= process.output[index] ?
            (uint8_t)(1U << index) : 0U;
    }
    for (index = 0U; index < 4U; ++index)
    {
        if (!isfinite(process.ai[index].value) ||
            process.ai[index].value < 0.0F ||
            process.ai[index].value > 65.535F)
        {
            return DATA_MANAGER_REJECTED;
        }
        candidate.ai_ua[index] =
            (uint16_t)(process.ai[index].value * 1000.0F);
        if (process.ai[index].quality != POINT_CONFIG_QUALITY_GOOD)
        {
            candidate.io_quality &= (uint16_t)~(1U << 1U);
        }
    }
    for (index = 0U; index < 2U; ++index)
    {
        if (!isfinite(process.ao[index]) ||
            process.ao[index] < 0.0F || process.ao[index] > 65.535F)
        {
            return DATA_MANAGER_REJECTED;
        }
        candidate.ao_ua[index] = (uint16_t)(process.ao[index] * 1000.0F);
    }
    candidate.fault_flags = process.fault_flags;
    for (index = 0U; index < DATA_MANAGER_FAULT_EVENT_COUNT; ++index)
    {
        event = process.fault_events[index];
        if (!event.latched)
        {
            continue;
        }
        if (selected_fault == DATA_MANAGER_FAULT_EVENT_COUNT ||
            (event.active && candidate.fault_active == 0U))
        {
            candidate.fault_code = (uint32_t)event.code;
            candidate.fault_detail = event.detail;
            candidate.fault_first_seen_ms = event.first_seen_ms;
            candidate.fault_last_seen_ms = event.last_seen_ms;
            candidate.fault_source = (uint8_t)event.source;
            candidate.fault_active = event.active ? 1U : 0U;
            candidate.fault_latched = 1U;
            selected_fault = (uint8_t)index;
        }
    }
    *snapshot = candidate;
    return DATA_MANAGER_OK;
}

uint32_t DataManager_GetParameterRevision(const DataManager *manager)
{
    uint32_t revision;

    if (manager == NULL)
    {
        return 0U;
    }
    DataManager_Lock();
    revision = manager->parameter_revision;
    DataManager_Unlock();
    return revision;
}

void DataManager_GetParameterPersistenceDiagnostic(
    const DataManager *manager,
    LogicParameterStoreDiagnostic *diagnostic)
{
    if (manager == NULL || diagnostic == NULL)
    {
        return;
    }
    DataManager_Lock();
    LogicParameterStore_GetDiagnostic(&manager->parameter_store, diagnostic);
    diagnostic->busy = diagnostic->busy || manager->parameter_write_busy;
    DataManager_Unlock();
}

bool DataManager_AreParametersReady(const DataManager *manager)
{
    bool ready;

    if (manager == NULL || !manager->initialized)
    {
        return false;
    }
    if (g_point_config.parameter_restore_policy ==
        POINT_CONFIG_PARAMETER_RESTORE_DEFAULTS)
    {
        return true;
    }
    DataManager_Lock();
    ready = manager->parameter_store.record_valid &&
            !manager->parameter_write_busy;
    DataManager_Unlock();
    return ready;
}

uint32_t DataManager_GetFaultFlags(const DataManager *manager)
{
    uint32_t fault_flags;

    if (manager == NULL)
    {
        return DATA_MANAGER_FAULT_CONFIGURATION;
    }
    DataManager_Lock();
    fault_flags = manager->fault_flags;
    DataManager_Unlock();
    return fault_flags;
}

uint32_t DataManager_GetActiveFaultFlags(const DataManager *manager)
{
    uint32_t fault_flags;

    if (manager == NULL)
    {
        return DATA_MANAGER_FAULT_CONFIGURATION;
    }
    DataManager_Lock();
    fault_flags = manager->active_fault_flags;
    DataManager_Unlock();
    return fault_flags;
}

bool DataManager_GetFaultEvent(const DataManager *manager, uint8_t index,
                               DataManagerFaultEvent *event)
{
    if (manager == NULL || event == NULL || index >= DATA_MANAGER_FAULT_EVENT_COUNT)
    {
        return false;
    }
    DataManager_Lock();
    *event = manager->fault_events[index];
    DataManager_Unlock();
    return true;
}

void DataManager_SetFaultAt(DataManager *manager, DataManagerFault fault,
                            uint32_t now_ms)
{
    if (manager == NULL)
    {
        return;
    }
    DataManager_Lock();
    AbortLogicScanLocked(manager, fault, now_ms);
    DataManager_Unlock();
}

void DataManager_SetFault(DataManager *manager, DataManagerFault fault)
{
    if (manager != NULL)
    {
        /* 时间和 scan_open 必须在同一临界区读取，避免网络/HMI 与控制任务
         * 并发时记录到不一致的扫描时间。 */
        DataManager_Lock();
        AbortLogicScanLocked(manager, fault,
                             manager->scan_open ? manager->working.now_ms :
                                                  manager->active.now_ms);
        DataManager_Unlock();
    }
}

void DataManager_SetFaultCondition(DataManager *manager, DataManagerFault fault,
                                   bool active, uint32_t now_ms)
{
    if (manager == NULL || fault == DATA_MANAGER_FAULT_NONE)
    {
        return;
    }
    DataManager_Lock();
    if (active)
    {
        AbortLogicScanLocked(manager, fault, now_ms);
    }
    else
    {
        manager->active_fault_flags &= ~(uint32_t)fault;
        ClearFaultEventsLocked(manager, fault);
    }
    DataManager_Unlock();
}

void DataManager_ClearFault(DataManager *manager, DataManagerFault fault)
{
    if (manager != NULL)
    {
        uint32_t clearable;

        DataManager_Lock();
        clearable = (uint32_t)fault & ~manager->active_fault_flags;
        manager->fault_flags &= ~clearable;
        ClearFaultEventsLocked(manager, (DataManagerFault)clearable);
        DataManager_Unlock();
    }
}
