#include "logic_parameter_store.h"

#include <math.h>
#include <stddef.h>
#include <string.h>

#include "eeprom_transport.h"

#define LOGIC_PARAMETER_STORE_FORMAT_VERSION 1U
#define LOGIC_PARAMETER_STORE_MAGIC_0        ((uint8_t)'L')
#define LOGIC_PARAMETER_STORE_MAGIC_1        ((uint8_t)'P')
#define LOGIC_PARAMETER_STORE_MAGIC_2        ((uint8_t)'S')
#define LOGIC_PARAMETER_STORE_MAGIC_3        ((uint8_t)'1')

_Static_assert(LOGIC_PARAMETER_STORE_HEADER_ADDRESS +
                       LOGIC_PARAMETER_STORE_HEADER_SIZE ==
                   LOGIC_PARAMETER_STORE_PAYLOAD_ADDRESS,
               "参数记录头和净荷地址不连续");
_Static_assert(LOGIC_PARAMETER_STORE_PAYLOAD_ADDRESS +
                       LOGIC_PARAMETER_STORE_PAYLOAD_CAPACITY - 1U ==
                   LOGIC_PARAMETER_STORE_RECORD_END,
               "参数记录上界与净荷容量不一致");
_Static_assert(POINT_CONFIG_MAX_PERSISTENT_PARAMETERS <= 32U,
               "committed_mask 只能表示最多 32 个参数");
_Static_assert(POINT_CONFIG_MAX_PERSISTENT_PAYLOAD_BYTES <=
                   LOGIC_PARAMETER_STORE_PAYLOAD_CAPACITY,
               "生成器持久化净荷上限超过 EEPROM owner");

#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
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
                (uint16_t)((crc << 1U) ^ 0x1021U) :
                (uint16_t)(crc << 1U);
        }
    }
    return crc;
}

static void PutU16(uint8_t *data, uint16_t value)
{
    data[0] = (uint8_t)value;
    data[1] = (uint8_t)(value >> 8U);
}

static uint16_t GetU16(const uint8_t *data)
{
    return (uint16_t)data[0] | ((uint16_t)data[1] << 8U);
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

static bool IsBlank(const uint8_t *data, uint16_t length)
{
    uint16_t index;

    for (index = 0U; index < length; ++index)
    {
        if (data[index] != 0xFFU)
        {
            return false;
        }
    }
    return true;
}
#endif

#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
static uint8_t ExpectedWidth(PointConfigValueType type)
{
    switch (type)
    {
        case POINT_CONFIG_VALUE_BOOL:
            return 1U;
        case POINT_CONFIG_VALUE_U16:
        case POINT_CONFIG_VALUE_S16:
            return 2U;
        case POINT_CONFIG_VALUE_F32:
        case POINT_CONFIG_VALUE_U32:
        case POINT_CONFIG_VALUE_S32:
            return 4U;
        default:
            return 0U;
    }
}
#endif

static bool DescriptorValid(const PointConfigPersistentParameter *parameter)
{
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT == 0U
    (void)parameter;
    return false;
#else
    uint8_t width;

    if (parameter == NULL || parameter->bind == NULL ||
        parameter->index >= POINT_CONFIG_PERSISTENT_PARAMETER_COUNT)
    {
        return false;
    }
    width = ExpectedWidth(parameter->type);
    if (width == 0U || parameter->width != width ||
        (uint16_t)parameter->payload_offset + width >
            POINT_CONFIG_PERSISTENT_PAYLOAD_SIZE)
    {
        return false;
    }
    switch (parameter->type)
    {
        case POINT_CONFIG_VALUE_BOOL:
            return (uint32_t)parameter->parameter_offset + sizeof(bool) <=
                   sizeof(LogicParameters);
        case POINT_CONFIG_VALUE_U16:
            return (uint32_t)parameter->parameter_offset + sizeof(uint16_t) <=
                   sizeof(LogicParameters);
        case POINT_CONFIG_VALUE_S16:
            return (uint32_t)parameter->parameter_offset + sizeof(int16_t) <=
                   sizeof(LogicParameters);
        case POINT_CONFIG_VALUE_F32:
            return (uint32_t)parameter->parameter_offset + sizeof(float) <=
                   sizeof(LogicParameters);
        case POINT_CONFIG_VALUE_U32:
            return (uint32_t)parameter->parameter_offset + sizeof(uint32_t) <=
                   sizeof(LogicParameters);
        case POINT_CONFIG_VALUE_S32:
            return (uint32_t)parameter->parameter_offset + sizeof(int32_t) <=
                   sizeof(LogicParameters);
        default:
            return false;
    }
#endif
}

#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
static bool ValueInRange(const PointConfigPersistentParameter *parameter,
                         double value)
{
    return !parameter->has_range ||
           (value >= (double)parameter->minimum &&
            value <= (double)parameter->maximum);
}

static bool EncodeValue(const LogicParameters *parameters,
                        const PointConfigPersistentParameter *parameter,
                        uint8_t *output)
{
    const uint8_t *source;

    if (parameters == NULL || output == NULL || !DescriptorValid(parameter))
    {
        return false;
    }
    source = (const uint8_t *)parameters + parameter->parameter_offset;
    switch (parameter->type)
    {
        case POINT_CONFIG_VALUE_BOOL:
        {
            bool value;
            (void)memcpy(&value, source, sizeof(value));
            output[0] = value ? 1U : 0U;
            return ValueInRange(parameter, value ? 1.0 : 0.0);
        }
        case POINT_CONFIG_VALUE_U16:
        {
            uint16_t value;
            (void)memcpy(&value, source, sizeof(value));
            PutU16(output, value);
            return ValueInRange(parameter, value);
        }
        case POINT_CONFIG_VALUE_S16:
        {
            int16_t value;
            (void)memcpy(&value, source, sizeof(value));
            PutU16(output, (uint16_t)value);
            return ValueInRange(parameter, value);
        }
        case POINT_CONFIG_VALUE_F32:
        {
            float value;
            uint32_t bits;
            (void)memcpy(&value, source, sizeof(value));
            if (!isfinite(value) || !ValueInRange(parameter, value))
            {
                return false;
            }
            (void)memcpy(&bits, &value, sizeof(bits));
            PutU32(output, bits);
            return true;
        }
        case POINT_CONFIG_VALUE_U32:
        {
            uint32_t value;
            (void)memcpy(&value, source, sizeof(value));
            PutU32(output, value);
            return ValueInRange(parameter, value);
        }
        case POINT_CONFIG_VALUE_S32:
        {
            int32_t value;
            (void)memcpy(&value, source, sizeof(value));
            PutU32(output, (uint32_t)value);
            return ValueInRange(parameter, value);
        }
        default:
            return false;
    }
}

static bool DecodeValue(LogicParameters *parameters,
                        const PointConfigPersistentParameter *parameter,
                        const uint8_t *input)
{
    uint8_t *destination;
    double numeric;

    if (parameters == NULL || input == NULL || !DescriptorValid(parameter))
    {
        return false;
    }
    destination = (uint8_t *)parameters + parameter->parameter_offset;
    switch (parameter->type)
    {
        case POINT_CONFIG_VALUE_BOOL:
        {
            bool value;
            if (input[0] > 1U)
            {
                return false;
            }
            value = input[0] != 0U;
            numeric = value ? 1.0 : 0.0;
            if (!ValueInRange(parameter, numeric))
            {
                return false;
            }
            (void)memcpy(destination, &value, sizeof(value));
            return true;
        }
        case POINT_CONFIG_VALUE_U16:
        {
            uint16_t value = GetU16(input);
            if (!ValueInRange(parameter, value))
            {
                return false;
            }
            (void)memcpy(destination, &value, sizeof(value));
            return true;
        }
        case POINT_CONFIG_VALUE_S16:
        {
            int16_t value = (int16_t)GetU16(input);
            if (!ValueInRange(parameter, value))
            {
                return false;
            }
            (void)memcpy(destination, &value, sizeof(value));
            return true;
        }
        case POINT_CONFIG_VALUE_F32:
        {
            uint32_t bits = GetU32(input);
            float value;
            (void)memcpy(&value, &bits, sizeof(value));
            if (!isfinite(value) || !ValueInRange(parameter, value))
            {
                return false;
            }
            (void)memcpy(destination, &value, sizeof(value));
            return true;
        }
        case POINT_CONFIG_VALUE_U32:
        {
            uint32_t value = GetU32(input);
            if (!ValueInRange(parameter, value))
            {
                return false;
            }
            (void)memcpy(destination, &value, sizeof(value));
            return true;
        }
        case POINT_CONFIG_VALUE_S32:
        {
            int32_t value = (int32_t)GetU32(input);
            if (!ValueInRange(parameter, value))
            {
                return false;
            }
            (void)memcpy(destination, &value, sizeof(value));
            return true;
        }
        default:
            return false;
    }
}

static bool EncodePayload(const LogicParameters *parameters,
                          uint8_t payload[LOGIC_PARAMETER_STORE_PAYLOAD_CAPACITY])
{
    uint8_t index;

    (void)memset(payload, 0, LOGIC_PARAMETER_STORE_PAYLOAD_CAPACITY);
    for (index = 0U; index < POINT_CONFIG_PERSISTENT_PARAMETER_COUNT; ++index)
    {
        const PointConfigPersistentParameter *parameter =
            &g_point_config_persistent_parameters[index];

        if (parameter->index != index ||
            !EncodeValue(parameters, parameter,
                         &payload[parameter->payload_offset]))
        {
            return false;
        }
    }
    return true;
}

static bool DecodePayload(LogicParameters *parameters, const uint8_t *payload)
{
    uint8_t index;

    for (index = 0U; index < POINT_CONFIG_PERSISTENT_PARAMETER_COUNT; ++index)
    {
        const PointConfigPersistentParameter *parameter =
            &g_point_config_persistent_parameters[index];

        if (parameter->index != index ||
            !DecodeValue(parameters, parameter,
                         &payload[parameter->payload_offset]))
        {
            return false;
        }
    }
    return true;
}

static void BuildHeader(uint8_t header[LOGIC_PARAMETER_STORE_HEADER_SIZE],
                        const uint8_t *payload)
{
    (void)memset(header, 0, LOGIC_PARAMETER_STORE_HEADER_SIZE);
    header[0] = LOGIC_PARAMETER_STORE_MAGIC_0;
    header[1] = LOGIC_PARAMETER_STORE_MAGIC_1;
    header[2] = LOGIC_PARAMETER_STORE_MAGIC_2;
    header[3] = LOGIC_PARAMETER_STORE_MAGIC_3;
    header[4] = LOGIC_PARAMETER_STORE_FORMAT_VERSION;
    header[5] = POINT_CONFIG_PERSISTENT_PARAMETER_COUNT;
    PutU16(&header[6], POINT_CONFIG_PERSISTENT_PAYLOAD_SIZE);
    PutU32(&header[8], POINT_CONFIG_PERSISTENT_LAYOUT_HASH);
    PutU16(&header[12], Crc16CcittFalse(
        payload, POINT_CONFIG_PERSISTENT_PAYLOAD_SIZE));
    PutU16(&header[14], Crc16CcittFalse(header, 14U));
}

static LogicParameterStoreStatus ReadRecord(LogicParameters *parameters)
{
    uint8_t header[LOGIC_PARAMETER_STORE_HEADER_SIZE];
    uint8_t payload[LOGIC_PARAMETER_STORE_PAYLOAD_CAPACITY];
    LogicParameters candidate;

    if (EepromTransport_Read(header, LOGIC_PARAMETER_STORE_HEADER_ADDRESS,
                             sizeof(header)) != 0U)
    {
        return LOGIC_PARAMETER_STORE_STATUS_IO_ERROR;
    }
    if (IsBlank(header, sizeof(header)))
    {
        return LOGIC_PARAMETER_STORE_STATUS_EMPTY;
    }
    if (header[0] != LOGIC_PARAMETER_STORE_MAGIC_0 ||
        header[1] != LOGIC_PARAMETER_STORE_MAGIC_1 ||
        header[2] != LOGIC_PARAMETER_STORE_MAGIC_2 ||
        header[3] != LOGIC_PARAMETER_STORE_MAGIC_3 ||
        header[4] != LOGIC_PARAMETER_STORE_FORMAT_VERSION)
    {
        return LOGIC_PARAMETER_STORE_STATUS_FORMAT_ERROR;
    }
    if (header[5] != POINT_CONFIG_PERSISTENT_PARAMETER_COUNT ||
        GetU16(&header[6]) != POINT_CONFIG_PERSISTENT_PAYLOAD_SIZE ||
        GetU32(&header[8]) != POINT_CONFIG_PERSISTENT_LAYOUT_HASH)
    {
        return LOGIC_PARAMETER_STORE_STATUS_LAYOUT_MISMATCH;
    }
    if (GetU16(&header[14]) != Crc16CcittFalse(header, 14U))
    {
        return LOGIC_PARAMETER_STORE_STATUS_CRC_ERROR;
    }
    if (EepromTransport_Read(payload, LOGIC_PARAMETER_STORE_PAYLOAD_ADDRESS,
                             POINT_CONFIG_PERSISTENT_PAYLOAD_SIZE) != 0U)
    {
        return LOGIC_PARAMETER_STORE_STATUS_IO_ERROR;
    }
    if (GetU16(&header[12]) != Crc16CcittFalse(
            payload, POINT_CONFIG_PERSISTENT_PAYLOAD_SIZE))
    {
        return LOGIC_PARAMETER_STORE_STATUS_CRC_ERROR;
    }
    candidate = *parameters;
    if (!DecodePayload(&candidate, payload))
    {
        return LOGIC_PARAMETER_STORE_STATUS_VALUE_ERROR;
    }
    *parameters = candidate;
    return LOGIC_PARAMETER_STORE_STATUS_OK;
}
#endif

void LogicParameterStore_Init(LogicParameterStore *store)
{
    if (store != NULL)
    {
        (void)memset(store, 0, sizeof(*store));
        store->load_status = LOGIC_PARAMETER_STORE_STATUS_NO_PARAMETERS;
        store->commit_status = LOGIC_PARAMETER_STORE_STATUS_NO_PARAMETERS;
    }
}

LogicParameterStoreStatus LogicParameterStore_Load(
    LogicParameterStore *store, LogicParameters *parameters)
{
    LogicParameterStoreStatus status;

    if (store == NULL || parameters == NULL)
    {
        return LOGIC_PARAMETER_STORE_STATUS_INVALID_ARGUMENT;
    }
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT == 0U
    status = LOGIC_PARAMETER_STORE_STATUS_NO_PARAMETERS;
#else
    status = ReadRecord(parameters);
#endif
    store->load_status = status;
    store->record_valid = status == LOGIC_PARAMETER_STORE_STATUS_OK;
    if (status == LOGIC_PARAMETER_STORE_STATUS_IO_ERROR ||
        status == LOGIC_PARAMETER_STORE_STATUS_FORMAT_ERROR ||
        status == LOGIC_PARAMETER_STORE_STATUS_LAYOUT_MISMATCH ||
        status == LOGIC_PARAMETER_STORE_STATUS_CRC_ERROR ||
        status == LOGIC_PARAMETER_STORE_STATUS_VALUE_ERROR)
    {
        store->failure_count++;
    }
    return status;
}

LogicParameterStoreStatus LogicParameterStore_Commit(
    LogicParameterStore *store, const LogicParameters *parameters,
    const PointConfigPersistentParameter *parameter, uint32_t now_ms)
{
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U
    uint8_t payload[LOGIC_PARAMETER_STORE_PAYLOAD_CAPACITY];
    uint8_t header[LOGIC_PARAMETER_STORE_HEADER_SIZE];
    LogicParameterStoreStatus current_status;
    LogicParameters scratch;
    bool full_write;
#endif

    if (store == NULL || parameters == NULL || parameter == NULL ||
        !DescriptorValid(parameter))
    {
        return LOGIC_PARAMETER_STORE_STATUS_INVALID_ARGUMENT;
    }
#if POINT_CONFIG_PERSISTENT_PARAMETER_COUNT == 0U
    (void)now_ms;
    store->commit_status = LOGIC_PARAMETER_STORE_STATUS_NO_PARAMETERS;
    return store->commit_status;
#else
    if (store->busy)
    {
        store->commit_status = LOGIC_PARAMETER_STORE_STATUS_BUSY;
        return store->commit_status;
    }
    if ((store->committed_mask & (1UL << parameter->index)) != 0U &&
        (uint32_t)(now_ms - store->last_commit_ms[parameter->index]) <
            LOGIC_PARAMETER_STORE_MIN_COMMIT_MS)
    {
        store->commit_status = LOGIC_PARAMETER_STORE_STATUS_THROTTLED;
        return store->commit_status;
    }
    if (!EncodePayload(parameters, payload))
    {
        store->commit_status = LOGIC_PARAMETER_STORE_STATUS_VALUE_ERROR;
        store->failure_count++;
        return store->commit_status;
    }
    store->busy = true;
    full_write = !store->record_valid;
    if (full_write)
    {
        /* record_valid=false 代表 RAM 与 EEPROM 是否同源无法证明（例如启动读取
         * 曾瞬时失败）。仍先重读确认介质状态，但本次统一重写完整候选快照，
         * 不能在旧记录上只改一个字段后配上新快照 CRC。 */
        scratch = *parameters;
        current_status = ReadRecord(&scratch);
        (void)current_status;
    }
    BuildHeader(header, payload);
    if (full_write)
    {
        if (EepromTransport_WriteAndVerify(
                payload, LOGIC_PARAMETER_STORE_PAYLOAD_ADDRESS,
                POINT_CONFIG_PERSISTENT_PAYLOAD_SIZE) != 0U ||
            EepromTransport_WriteAndVerify(
                header, LOGIC_PARAMETER_STORE_HEADER_ADDRESS,
                LOGIC_PARAMETER_STORE_HEADER_SIZE) != 0U)
        {
            store->busy = false;
            store->record_valid = false;
            store->commit_status = LOGIC_PARAMETER_STORE_STATUS_IO_ERROR;
            store->failure_count++;
            return store->commit_status;
        }
    }
    else if (EepromTransport_WriteAndVerify(
                 &payload[parameter->payload_offset],
                 (uint16_t)(LOGIC_PARAMETER_STORE_PAYLOAD_ADDRESS +
                            parameter->payload_offset),
                 parameter->width) != 0U ||
             EepromTransport_WriteAndVerify(
                 &header[12],
                 (uint16_t)(LOGIC_PARAMETER_STORE_HEADER_ADDRESS + 12U),
                 4U) != 0U)
    {
        store->busy = false;
        store->record_valid = false;
        store->commit_status = LOGIC_PARAMETER_STORE_STATUS_IO_ERROR;
        store->failure_count++;
        return store->commit_status;
    }
    store->busy = false;
    store->record_valid = true;
    store->last_commit_ms[parameter->index] = now_ms;
    store->committed_mask |= 1UL << parameter->index;
    store->commit_status = LOGIC_PARAMETER_STORE_STATUS_OK;
    return store->commit_status;
#endif
}

void LogicParameterStore_GetDiagnostic(
    const LogicParameterStore *store,
    LogicParameterStoreDiagnostic *diagnostic)
{
    if (store == NULL || diagnostic == NULL)
    {
        return;
    }
    diagnostic->load_status = store->load_status;
    diagnostic->commit_status = store->commit_status;
    diagnostic->failure_count = store->failure_count;
    diagnostic->layout_hash = POINT_CONFIG_PERSISTENT_LAYOUT_HASH;
    diagnostic->parameter_count = POINT_CONFIG_PERSISTENT_PARAMETER_COUNT;
    diagnostic->payload_size = POINT_CONFIG_PERSISTENT_PAYLOAD_SIZE;
    diagnostic->record_valid = store->record_valid;
    diagnostic->busy = store->busy;
}
