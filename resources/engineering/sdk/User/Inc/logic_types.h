#ifndef KZ3_LOGIC_TYPES_H
#define KZ3_LOGIC_TYPES_H

#include <stdint.h>

/** @brief 逻辑 ABI 使用的显式布尔值，禁止把编译器 bool 作为跨模块布局。 */
typedef uint8_t LogicBool;

#define LOGIC_FALSE 0U
#define LOGIC_TRUE  1U

/* 北向命令的控制模式快照位；未置位表示就地/自动/运行中。 */
#define LOGIC_MODE_REMOTE_ACTIVE       (1UL << 0)
#define LOGIC_MODE_MANUAL_ACTIVE       (1UL << 1)
#define LOGIC_MODE_STOPPED              (1UL << 2)
#define LOGIC_MODE_MAINTENANCE_ACTIVE   (1UL << 3)
#define LOGIC_MODE_ALL_MASK             (LOGIC_MODE_REMOTE_ACTIVE | \
                                         LOGIC_MODE_MANUAL_ACTIVE | \
                                         LOGIC_MODE_STOPPED | \
                                         LOGIC_MODE_MAINTENANCE_ACTIVE)

typedef uint32_t LogicPointId;
typedef uint32_t LogicPersistId;
typedef uint32_t LogicCommandSeq;

/** @brief 固定宽度结果码，数值属于 LogicToolkit ABI。 */
typedef uint16_t LogicResult;

#define LOGIC_RESULT_OK                 0U
#define LOGIC_RESULT_INVALID_ARGUMENT   1U
#define LOGIC_RESULT_NOT_FOUND           2U
#define LOGIC_RESULT_CAPACITY            3U
#define LOGIC_RESULT_DUPLICATE           4U
#define LOGIC_RESULT_TYPE_MISMATCH       5U
#define LOGIC_RESULT_BAD_CONFIGURATION   6U
#define LOGIC_RESULT_BUSY                7U
#define LOGIC_RESULT_REJECTED            8U
#define LOGIC_RESULT_EXPIRED             9U
#define LOGIC_RESULT_INCOMPATIBLE_API   10U
#define LOGIC_RESULT_NOT_SUPPORTED      11U
#define LOGIC_RESULT_NOT_READY          12U
#define LOGIC_RESULT_OUT_OF_RANGE       13U

/** @brief 点位值类型。第一版明确拒绝 64 位、BCD、字符串和 float64。 */
typedef uint16_t LogicValueType;

#define LOGIC_VALUE_BOOL 1U
#define LOGIC_VALUE_U16  2U
#define LOGIC_VALUE_S16  3U
#define LOGIC_VALUE_U32  4U
#define LOGIC_VALUE_S32  5U
#define LOGIC_VALUE_F32  6U

/** @brief 输入数据质量，与命令/输出状态分离。 */
typedef uint16_t LogicQuality;

#define LOGIC_QUALITY_INIT          0U
#define LOGIC_QUALITY_GOOD          1U
#define LOGIC_QUALITY_STALE         2U
#define LOGIC_QUALITY_OFFLINE       3U
#define LOGIC_QUALITY_BAD_CONFIG    4U
#define LOGIC_QUALITY_OUT_OF_RANGE  5U

/** @brief 运行状态的通用低位定义，模块可在高位保留诊断信息。 */
typedef uint16_t LogicStatus;

#define LOGIC_STATUS_NONE                0U
#define LOGIC_STATUS_COMMAND_PENDING     1U
#define LOGIC_STATUS_COMMAND_ACCEPTED    2U
#define LOGIC_STATUS_COMMAND_APPLIED     3U
#define LOGIC_STATUS_COMMAND_FAILED      4U
#define LOGIC_STATUS_OUTPUT_SAFE         5U
#define LOGIC_STATUS_OUTPUT_ACCEPTED     6U
#define LOGIC_STATUS_OUTPUT_EXPIRED      7U
#define LOGIC_STATUS_OUTPUT_UNCONFIGURED 8U

/**
 * @brief 点位值的固定 32 位载体。
 *
 * 读取者必须结合 LogicValueType 解释成员，禁止跨类型读取。F32 要求目标
 * 使用 IEEE-754 binary32；该要求与现有 ARM hard-float 工具链一致。
 */
typedef union
{
    uint32_t u32;
    int32_t s32;
    float f32;
} LogicPointValue;

/** @brief 一次发布得到的完整点位样本。 */
typedef struct
{
    LogicPointValue value;
    uint32_t update_tick_ms;
    uint32_t generation;
    LogicQuality quality;
    LogicStatus status;
} LogicPointSample;

/** @brief 判断值类型是否属于首版稳定 ABI。 */
static inline LogicBool LogicValueType_IsSupported(LogicValueType value_type)
{
    return (LogicBool)(value_type >= LOGIC_VALUE_BOOL && value_type <= LOGIC_VALUE_F32);
}

#endif
