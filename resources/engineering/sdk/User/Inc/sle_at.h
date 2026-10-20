#ifndef INC_SLE_AT_H_
#define INC_SLE_AT_H_

#include <stdint.h>
#include "sle_manager.h"

typedef enum
{
    SLE_AT_STAGE_PROBE = 0,
    SLE_AT_STAGE_SET_WORK_MODE,
    SLE_AT_STAGE_SET_ADDRESS,
    SLE_AT_STAGE_SET_NAME,
    SLE_AT_STAGE_SET_TX_POWER,
    SLE_AT_STAGE_VERIFY_WORK_MODE,
    SLE_AT_STAGE_COUNT
} SleAtStage;

/**
 * @brief 生成最新文档规定的 AT 命令。
 * @return 0 已生成，1 当前配置要求跳过该阶段，2 参数或缓冲区非法。
 */
uint8_t SleAt_BuildCommand(SleAtStage stage, const SleConfig *config,
                           uint16_t local_addr, char *out, uint16_t capacity);

/** 按阶段匹配模块响应，避免任意历史 OK 回包误推进状态机。 */
uint8_t SleAt_ResponseMatches(SleAtStage stage, const uint8_t *data, uint16_t len);

/** 地址、名称和功率设置失败时按最新协议继续后续初始化。 */
uint8_t SleAt_StageOptional(SleAtStage stage);

#endif
