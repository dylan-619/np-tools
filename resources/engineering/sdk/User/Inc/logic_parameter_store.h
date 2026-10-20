#ifndef KZ3_LOGIC_PARAMETER_STORE_H
#define KZ3_LOGIC_PARAMETER_STORE_H

#include <stdbool.h>
#include <stdint.h>

#include "point_config.h"
#include "wireless_eeprom_layout.h"

#define LOGIC_PARAMETER_STORE_HEADER_ADDRESS  WIRELESS_EEPROM_LOGIC_PARAMETER_BEGIN
#define LOGIC_PARAMETER_STORE_PAYLOAD_ADDRESS (WIRELESS_EEPROM_LOGIC_PARAMETER_BEGIN + 16U)
#define LOGIC_PARAMETER_STORE_HEADER_SIZE     16U
#define LOGIC_PARAMETER_STORE_PAYLOAD_CAPACITY 120U
#define LOGIC_PARAMETER_STORE_RECORD_END      WIRELESS_EEPROM_LOGIC_PARAMETER_END
#define LOGIC_PARAMETER_STORE_GUARD_BEGIN     WIRELESS_EEPROM_PARAMETER_GUARD_BEGIN
#define LOGIC_PARAMETER_STORE_GUARD_END       WIRELESS_EEPROM_PARAMETER_GUARD_END
#define LOGIC_PARAMETER_STORE_MIN_COMMIT_MS   1000U

typedef enum
{
    LOGIC_PARAMETER_STORE_STATUS_OK = 0,
    LOGIC_PARAMETER_STORE_STATUS_NO_PARAMETERS,
    LOGIC_PARAMETER_STORE_STATUS_EMPTY,
    LOGIC_PARAMETER_STORE_STATUS_FORMAT_ERROR,
    LOGIC_PARAMETER_STORE_STATUS_LAYOUT_MISMATCH,
    LOGIC_PARAMETER_STORE_STATUS_CRC_ERROR,
    LOGIC_PARAMETER_STORE_STATUS_VALUE_ERROR,
    LOGIC_PARAMETER_STORE_STATUS_IO_ERROR,
    LOGIC_PARAMETER_STORE_STATUS_BUSY,
    LOGIC_PARAMETER_STORE_STATUS_THROTTLED,
    LOGIC_PARAMETER_STORE_STATUS_INVALID_ARGUMENT
} LogicParameterStoreStatus;

typedef struct
{
    LogicParameterStoreStatus load_status;
    LogicParameterStoreStatus commit_status;
    uint32_t failure_count;
    uint32_t last_commit_ms[POINT_CONFIG_MAX_PERSISTENT_PARAMETERS];
    uint32_t committed_mask;
    bool record_valid;
    bool busy;
} LogicParameterStore;

typedef struct
{
    LogicParameterStoreStatus load_status;
    LogicParameterStoreStatus commit_status;
    uint32_t failure_count;
    uint32_t layout_hash;
    uint8_t parameter_count;
    uint8_t payload_size;
    bool record_valid;
    bool busy;
} LogicParameterStoreDiagnostic;

/** 初始化单副本参数记录状态；不访问 EEPROM。 */
void LogicParameterStore_Init(LogicParameterStore *store);

/**
 * 从 `784..919` 加载并整组校验参数。只有返回 OK 时才会修改 parameters；
 * 空白、格式、布局、CRC、值域或 I2C 失败均保留调用方传入的默认值。
 */
LogicParameterStoreStatus LogicParameterStore_Load(
    LogicParameterStore *store, LogicParameters *parameters);

/**
 * 提交已经完成完整 DataManager 校验的候选参数快照。首次或无效记录写完整净荷，
 * 有效同布局记录只写目标值字节和头部 CRC。调用上下文必须是任务，不能在 ISR。
 */
LogicParameterStoreStatus LogicParameterStore_Commit(
    LogicParameterStore *store, const LogicParameters *parameters,
    const PointConfigPersistentParameter *parameter, uint32_t now_ms);

void LogicParameterStore_GetDiagnostic(
    const LogicParameterStore *store,
    LogicParameterStoreDiagnostic *diagnostic);

#endif
