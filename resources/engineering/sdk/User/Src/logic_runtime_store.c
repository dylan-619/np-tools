#include "logic_runtime_store.h"

#include <string.h>

#include "eeprom_transport.h"

#define LOGIC_RUNTIME_STORE_COMMIT             0xA5U
#define LOGIC_RUNTIME_STORE_FORMAT_VERSION     0x01U
#define LOGIC_RUNTIME_STORE_KIND_SYSTEM        0x31U
#define LOGIC_RUNTIME_STORE_KIND_RUNTIME       0x32U
#define LOGIC_RUNTIME_STORE_SYSTEM_SLOT        0xFFU
#define LOGIC_RUNTIME_STORE_PHASE_WRITE_RECORD 1U
#define LOGIC_RUNTIME_STORE_PHASE_WRITE_COMMIT 2U
#define LOGIC_RUNTIME_STORE_PHASE_VERIFY       3U
#define LOGIC_RUNTIME_STORE_RETRY_MS           1000U
#define LOGIC_RUNTIME_STORE_SYSTEM_CHECKPOINT_SECONDS 3600U

static uint16_t Crc16CcittFalse(const uint8_t *data, uint16_t length)
{
    uint16_t crc = 0xFFFFU;
    uint16_t index;

    for (index = 0U; index < length; ++index)
    {
        uint8_t bit;

        crc ^= (uint16_t)data[index] << 8U;
        for (bit = 0U; bit < 8U; ++bit)
        {
            crc = (crc & 0x8000U) != 0U ?
                (uint16_t)((crc << 1U) ^ 0x1021U) : (uint16_t)(crc << 1U);
        }
    }
    return crc;
}

static void PutU32(uint8_t *data, uint32_t value)
{
    data[0] = (uint8_t)value;
    data[1] = (uint8_t)(value >> 8U);
    data[2] = (uint8_t)(value >> 16U);
    data[3] = (uint8_t)(value >> 24U);
}

static uint32_t GetU32(const uint8_t *data)
{
    return (uint32_t)data[0] | ((uint32_t)data[1] << 8U) |
           ((uint32_t)data[2] << 16U) | ((uint32_t)data[3] << 24U);
}

static uint16_t GetU16(const uint8_t *data)
{
    return (uint16_t)data[0] | ((uint16_t)data[1] << 8U);
}

static void PutU16(uint8_t *data, uint16_t value)
{
    data[0] = (uint8_t)value;
    data[1] = (uint8_t)(value >> 8U);
}

static bool IsBlank(const uint8_t record[LOGIC_RUNTIME_STORE_RECORD_SIZE])
{
    uint8_t index;

    for (index = 0U; index < LOGIC_RUNTIME_STORE_RECORD_SIZE; ++index)
    {
        if (record[index] != 0xFFU)
        {
            return false;
        }
    }
    return true;
}

static void EncodeSystem(uint8_t record[LOGIC_RUNTIME_STORE_RECORD_SIZE],
                         uint32_t boot_count, uint32_t total_seconds,
                         uint8_t commit)
{
    memset(record, 0, LOGIC_RUNTIME_STORE_RECORD_SIZE);
    record[0] = commit;
    record[1] = LOGIC_RUNTIME_STORE_FORMAT_VERSION;
    record[2] = LOGIC_RUNTIME_STORE_KIND_SYSTEM;
    PutU32(&record[4], boot_count);
    PutU32(&record[8], total_seconds);
    PutU16(&record[14], Crc16CcittFalse(&record[1], 13U));
}

static void EncodeRuntime(uint8_t record[LOGIC_RUNTIME_STORE_RECORD_SIZE],
                          uint8_t slot, uint32_t key_hash,
                          uint32_t seconds, uint8_t commit)
{
    memset(record, 0, LOGIC_RUNTIME_STORE_RECORD_SIZE);
    record[0] = commit;
    record[1] = LOGIC_RUNTIME_STORE_FORMAT_VERSION;
    record[2] = LOGIC_RUNTIME_STORE_KIND_RUNTIME;
    record[3] = slot;
    PutU32(&record[4], key_hash);
    PutU32(&record[8], seconds);
    PutU16(&record[14], Crc16CcittFalse(&record[1], 13U));
}

static bool DecodeSystem(const uint8_t record[LOGIC_RUNTIME_STORE_RECORD_SIZE],
                         uint32_t *boot_count, uint32_t *total_seconds)
{
    if (record[0] != LOGIC_RUNTIME_STORE_COMMIT ||
        record[1] != LOGIC_RUNTIME_STORE_FORMAT_VERSION ||
        record[2] != LOGIC_RUNTIME_STORE_KIND_SYSTEM || record[3] != 0U ||
        record[12] != 0U || record[13] != 0U ||
        GetU16(&record[14]) != Crc16CcittFalse(&record[1], 13U))
    {
        return false;
    }
    *boot_count = GetU32(&record[4]);
    *total_seconds = GetU32(&record[8]);
    return true;
}

static bool DecodeRuntime(const uint8_t record[LOGIC_RUNTIME_STORE_RECORD_SIZE],
                          uint8_t slot, uint32_t key_hash, uint32_t *seconds)
{
    if (record[0] != LOGIC_RUNTIME_STORE_COMMIT ||
        record[1] != LOGIC_RUNTIME_STORE_FORMAT_VERSION ||
        record[2] != LOGIC_RUNTIME_STORE_KIND_RUNTIME || record[3] != slot ||
        GetU32(&record[4]) != key_hash || record[12] != 0U || record[13] != 0U ||
        GetU16(&record[14]) != Crc16CcittFalse(&record[1], 13U))
    {
        return false;
    }
    *seconds = GetU32(&record[8]);
    return true;
}

static uint16_t RuntimeAddress(uint8_t slot)
{
    return (uint16_t)(LOGIC_RUNTIME_STORE_RUNTIME_BASE +
                      (uint16_t)slot * LOGIC_RUNTIME_STORE_RECORD_SIZE);
}

static void MarkFault(LogicRuntimeStore *store, uint8_t slot)
{
    store->fault_mask |= slot == LOGIC_RUNTIME_STORE_SYSTEM_SLOT ?
        (1UL << 16U) : (1UL << slot);
}

static bool RetryDue(uint32_t now_ms, uint32_t retry_after_ms)
{
    return retry_after_ms == 0U || (int32_t)(now_ms - retry_after_ms) >= 0;
}

void LogicRuntimeStore_Init(LogicRuntimeStore *store)
{
    if (store != NULL)
    {
        memset(store, 0, sizeof(*store));
    }
}

void LogicRuntimeStore_LoadSystem(LogicRuntimeStore *store)
{
    uint8_t record[LOGIC_RUNTIME_STORE_RECORD_SIZE];
    uint32_t boot_count = 0U;
    uint32_t total_seconds = 0U;

    if (store == NULL)
    {
        return;
    }
    if (EepromTransport_Read(record, LOGIC_RUNTIME_STORE_SYSTEM_ADDRESS,
                             sizeof(record)) != 0U)
    {
        store->system.fault = true;
        MarkFault(store, LOGIC_RUNTIME_STORE_SYSTEM_SLOT);
    }
    else if (!IsBlank(record) && !DecodeSystem(record, &boot_count, &total_seconds))
    {
        /* 新项目允许丢失一次历史值：置故障后从零重建，不能永久卡在 null。 */
        store->system.fault = true;
        MarkFault(store, LOGIC_RUNTIME_STORE_SYSTEM_SLOT);
    }
    else
    {
        store->system.total_seconds = total_seconds;
    }
    store->system.boot_count = boot_count == UINT32_MAX ? UINT32_MAX : boot_count + 1U;
    store->system.persisted_seconds = store->system.total_seconds;
    store->system.queued = true;
    store->system.valid = false;
}

void LogicRuntimeStore_LoadRuntime(LogicRuntimeStore *store, uint8_t slot,
                                   uint32_t key_hash, uint32_t *seconds)
{
    uint8_t record[LOGIC_RUNTIME_STORE_RECORD_SIZE];
    uint32_t loaded_seconds = 0U;
    LogicRuntimeStoreSlot *entry;

    if (seconds != NULL)
    {
        *seconds = 0U;
    }
    if (store == NULL || slot >= LOGIC_RUNTIME_STORE_SLOT_COUNT)
    {
        return;
    }
    entry = &store->slots[slot];
    entry->key_hash = key_hash;
    if (EepromTransport_Read(record, RuntimeAddress(slot), sizeof(record)) != 0U)
    {
        entry->fault = true;
        MarkFault(store, slot);
        return;
    }
    if (IsBlank(record))
    {
        return;
    }
    if (!DecodeRuntime(record, slot, key_hash, &loaded_seconds))
    {
        entry->fault = true;
        MarkFault(store, slot);
        return;
    }
    entry->persisted_seconds = loaded_seconds;
    entry->desired_seconds = loaded_seconds;
    if (seconds != NULL)
    {
        *seconds = loaded_seconds;
    }
}

void LogicRuntimeStore_UpdateSystemTime(LogicRuntimeStore *store,
                                         uint32_t now_ms)
{
    uint32_t elapsed_ms;
    uint32_t elapsed_seconds;

    if (store == NULL)
    {
        return;
    }
    if (!store->system.tick_initialized)
    {
        store->system.last_tick_ms = now_ms;
        store->system.tick_initialized = true;
        return;
    }
    elapsed_ms = (uint32_t)(now_ms - store->system.last_tick_ms) +
                 store->system.millisecond_remainder;
    elapsed_seconds = elapsed_ms / 1000U;
    store->system.millisecond_remainder = (uint16_t)(elapsed_ms % 1000U);
    if (UINT32_MAX - store->system.total_seconds < elapsed_seconds)
    {
        store->system.total_seconds = UINT32_MAX;
    }
    else
    {
        store->system.total_seconds += elapsed_seconds;
    }
    store->system.last_tick_ms = now_ms;
}

void LogicRuntimeStore_RequestSystemSave(LogicRuntimeStore *store,
                                         uint32_t now_ms)
{
    if (store != NULL &&
        (store->system.total_seconds - store->system.persisted_seconds >=
             LOGIC_RUNTIME_STORE_SYSTEM_CHECKPOINT_SECONDS ||
         !store->system.valid))
    {
        store->system.queued = true;
        store->system.retry_after_ms = now_ms;
    }
}

void LogicRuntimeStore_RequestRuntimeSave(LogicRuntimeStore *store, uint8_t slot,
                                          uint32_t key_hash, uint32_t seconds,
                                          uint32_t sequence, bool clear_request,
                                          uint32_t now_ms)
{
    LogicRuntimeStoreSlot *entry;

    if (store == NULL || slot >= LOGIC_RUNTIME_STORE_SLOT_COUNT)
    {
        return;
    }
    entry = &store->slots[slot];
    entry->key_hash = key_hash;
    entry->desired_seconds = seconds;
    entry->sequence = sequence;
    entry->queued = true;
    entry->clear_request = clear_request;
    entry->retry_after_ms = now_ms;
}

static bool BeginTransaction(LogicRuntimeStore *store, uint32_t now_ms)
{
    uint8_t offset;

    for (offset = 0U; offset < LOGIC_RUNTIME_STORE_SLOT_COUNT; ++offset)
    {
        uint8_t slot = (uint8_t)((store->round_robin_next + offset) %
                                 LOGIC_RUNTIME_STORE_SLOT_COUNT);
        LogicRuntimeStoreSlot *entry = &store->slots[slot];

        if (entry->queued && entry->clear_request && RetryDue(now_ms, entry->retry_after_ms))
        {
            store->transaction.active = true;
            store->transaction.phase = LOGIC_RUNTIME_STORE_PHASE_WRITE_RECORD;
            store->transaction.slot = slot;
            store->transaction.sequence = entry->sequence;
            store->transaction.seconds = entry->desired_seconds;
            store->transaction.key_hash = entry->key_hash;
            store->transaction.clear_request = true;
            entry->queued = false;
            store->round_robin_next = (uint8_t)((slot + 1U) % LOGIC_RUNTIME_STORE_SLOT_COUNT);
            return true;
        }
    }
    for (offset = 0U; offset <= LOGIC_RUNTIME_STORE_SLOT_COUNT; ++offset)
    {
        uint8_t owner = (uint8_t)((store->round_robin_next + offset) %
                                  (LOGIC_RUNTIME_STORE_SLOT_COUNT + 1U));

        if (owner == LOGIC_RUNTIME_STORE_SLOT_COUNT)
        {
            if (store->system.queued && RetryDue(now_ms, store->system.retry_after_ms))
            {
                store->transaction.active = true;
                store->transaction.phase = LOGIC_RUNTIME_STORE_PHASE_WRITE_RECORD;
                store->transaction.slot = LOGIC_RUNTIME_STORE_SYSTEM_SLOT;
                store->transaction.seconds = store->system.total_seconds;
                store->transaction.sequence = store->system.boot_count;
                store->transaction.clear_request = false;
                store->system.queued = false;
                store->round_robin_next = 0U;
                return true;
            }
        }
        else
        {
            LogicRuntimeStoreSlot *entry = &store->slots[owner];

            if (entry->queued && RetryDue(now_ms, entry->retry_after_ms))
            {
                store->transaction.active = true;
                store->transaction.phase = LOGIC_RUNTIME_STORE_PHASE_WRITE_RECORD;
                store->transaction.slot = owner;
                store->transaction.sequence = entry->sequence;
                store->transaction.seconds = entry->desired_seconds;
                store->transaction.key_hash = entry->key_hash;
                store->transaction.clear_request = entry->clear_request;
                entry->queued = false;
                store->round_robin_next = (uint8_t)((owner + 1U) %
                                                    (LOGIC_RUNTIME_STORE_SLOT_COUNT + 1U));
                return true;
            }
        }
    }
    return false;
}

bool LogicRuntimeStore_BeginOperation(LogicRuntimeStore *store, uint32_t now_ms,
                                      LogicRuntimeStoreOperation *operation)
{
    LogicRuntimeStoreTransaction *transaction;

    if (store == NULL || operation == NULL)
    {
        return false;
    }
    memset(operation, 0, sizeof(*operation));
    if (!store->transaction.active && !BeginTransaction(store, now_ms))
    {
        return false;
    }
    transaction = &store->transaction;
    operation->address = transaction->slot == LOGIC_RUNTIME_STORE_SYSTEM_SLOT ?
        LOGIC_RUNTIME_STORE_SYSTEM_ADDRESS : RuntimeAddress(transaction->slot);
    operation->length = transaction->phase == LOGIC_RUNTIME_STORE_PHASE_WRITE_COMMIT ? 1U :
                        LOGIC_RUNTIME_STORE_RECORD_SIZE;
    if (transaction->phase == LOGIC_RUNTIME_STORE_PHASE_WRITE_RECORD)
    {
        operation->type = LOGIC_RUNTIME_STORE_OPERATION_WRITE;
        if (transaction->slot == LOGIC_RUNTIME_STORE_SYSTEM_SLOT)
        {
            EncodeSystem(operation->data, transaction->sequence, transaction->seconds, 0U);
        }
        else
        {
            EncodeRuntime(operation->data, transaction->slot, transaction->key_hash,
                          transaction->seconds, 0U);
        }
    }
    else if (transaction->phase == LOGIC_RUNTIME_STORE_PHASE_WRITE_COMMIT)
    {
        operation->type = LOGIC_RUNTIME_STORE_OPERATION_WRITE;
        operation->data[0] = LOGIC_RUNTIME_STORE_COMMIT;
    }
    else
    {
        operation->type = LOGIC_RUNTIME_STORE_OPERATION_READ;
    }
    return true;
}

void LogicRuntimeStore_FinishOperation(LogicRuntimeStore *store, uint32_t now_ms,
                                       const LogicRuntimeStoreOperation *operation,
                                       bool success)
{
    LogicRuntimeStoreTransaction *transaction;
    LogicRuntimeStoreSlot *entry = NULL;
    uint32_t decoded_first = 0U;
    uint32_t decoded_seconds = 0U;
    bool decoded = true;

    if (store == NULL || operation == NULL || !store->transaction.active)
    {
        return;
    }
    transaction = &store->transaction;
    if (transaction->slot != LOGIC_RUNTIME_STORE_SYSTEM_SLOT)
    {
        entry = &store->slots[transaction->slot];
    }
    if (success && transaction->phase == LOGIC_RUNTIME_STORE_PHASE_VERIFY)
    {
        decoded = transaction->slot == LOGIC_RUNTIME_STORE_SYSTEM_SLOT ?
            DecodeSystem(operation->data, &decoded_first, &decoded_seconds) :
            DecodeRuntime(operation->data, transaction->slot, transaction->key_hash,
                          &decoded_seconds);
    }
    if (!success || !decoded)
    {
        if (entry != NULL)
        {
            entry->fault = true;
            entry->queued = true;
            entry->retry_after_ms = now_ms + LOGIC_RUNTIME_STORE_RETRY_MS;
        }
        else
        {
            store->system.fault = true;
            store->system.valid = false;
            store->system.queued = true;
            store->system.retry_after_ms = now_ms + LOGIC_RUNTIME_STORE_RETRY_MS;
        }
        MarkFault(store, transaction->slot);
        memset(transaction, 0, sizeof(*transaction));
        return;
    }
    if (transaction->phase == LOGIC_RUNTIME_STORE_PHASE_WRITE_RECORD)
    {
        transaction->phase = LOGIC_RUNTIME_STORE_PHASE_WRITE_COMMIT;
        return;
    }
    if (transaction->phase == LOGIC_RUNTIME_STORE_PHASE_WRITE_COMMIT)
    {
        transaction->phase = LOGIC_RUNTIME_STORE_PHASE_VERIFY;
        return;
    }
    if (entry != NULL)
    {
        entry->persisted_seconds = transaction->seconds;
        entry->completion_seconds = transaction->seconds;
        entry->completion_sequence = transaction->sequence;
        entry->completion_clear = transaction->clear_request;
        entry->completion_ready = true;
    }
    else
    {
        store->system.persisted_seconds = transaction->seconds;
        store->system.valid = true;
    }
    memset(transaction, 0, sizeof(*transaction));
}

bool LogicRuntimeStore_CommitStartup(LogicRuntimeStore *store, uint32_t now_ms)
{
    uint8_t step;

    if (store == NULL)
    {
        return false;
    }
    for (step = 0U; step < 3U; ++step)
    {
        LogicRuntimeStoreOperation operation;
        bool success;

        if (!LogicRuntimeStore_BeginOperation(store, now_ms, &operation))
        {
            return false;
        }
        success = operation.type == LOGIC_RUNTIME_STORE_OPERATION_WRITE ?
            EepromTransport_WriteAndVerify(operation.data, operation.address,
                                           operation.length) == 0U :
            EepromTransport_Read(operation.data, operation.address,
                                 operation.length) == 0U;
        LogicRuntimeStore_FinishOperation(store, now_ms, &operation, success);
        if (!success)
        {
            return false;
        }
    }
    return store->system.valid;
}

bool LogicRuntimeStore_TakeRuntimeCompletion(LogicRuntimeStore *store,
                                              uint8_t slot, uint32_t *sequence,
                                              uint32_t *seconds, bool *clear_request)
{
    LogicRuntimeStoreSlot *entry;

    if (store == NULL || slot >= LOGIC_RUNTIME_STORE_SLOT_COUNT ||
        !store->slots[slot].completion_ready)
    {
        return false;
    }
    entry = &store->slots[slot];
    if (sequence != NULL)
    {
        *sequence = entry->completion_sequence;
    }
    if (seconds != NULL)
    {
        *seconds = entry->completion_seconds;
    }
    if (clear_request != NULL)
    {
        *clear_request = entry->completion_clear;
    }
    entry->completion_ready = false;
    return true;
}

void LogicRuntimeStore_GetSystemSnapshot(const LogicRuntimeStore *store,
                                         uint32_t *boot_count,
                                         uint32_t *total_seconds,
                                         bool *boot_count_valid,
                                         uint32_t *fault_mask,
                                         bool *busy)
{
    uint8_t slot;
    bool active;

    if (store == NULL)
    {
        return;
    }
    active = store->transaction.active || store->system.queued;
    for (slot = 0U; slot < LOGIC_RUNTIME_STORE_SLOT_COUNT; ++slot)
    {
        active = active || store->slots[slot].queued;
    }
    if (boot_count != NULL) *boot_count = store->system.boot_count;
    if (total_seconds != NULL) *total_seconds = store->system.total_seconds;
    if (boot_count_valid != NULL) *boot_count_valid = store->system.valid;
    if (fault_mask != NULL) *fault_mask = store->fault_mask;
    if (busy != NULL) *busy = active;
}
