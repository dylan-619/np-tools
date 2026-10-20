#ifndef KZ3_LOGIC_CONTRACT_H
#define KZ3_LOGIC_CONTRACT_H

#include <stdint.h>

#include "logic_types.h"

/** @brief 北向写请求的固定角色；角色授权由通信适配层映射，不由逻辑包猜测。 */
typedef uint16_t LogicRole;

#define LOGIC_ROLE_NONE         0U
#define LOGIC_ROLE_OBSERVER     1U
#define LOGIC_ROLE_OPERATOR     2U
#define LOGIC_ROLE_ENGINEER     3U
#define LOGIC_ROLE_MAINTENANCE  4U

/** @brief 点位访问策略位；读状态不等于具备下发控制或修改参数的权限。 */
typedef uint16_t LogicAccessPolicy;

#define LOGIC_ACCESS_READ_STATUS      (1U << 0)
#define LOGIC_ACCESS_WRITE_COMMAND    (1U << 1)
#define LOGIC_ACCESS_WRITE_PARAMETER  (1U << 2)
#define LOGIC_ACCESS_SERVICE_WRITE    (1U << 3)
#define LOGIC_ACCESS_INTERNAL_ONLY    (1U << 4)
#define LOGIC_ACCESS_WRITE_EXTERNAL_INPUT (1U << 5)

/** @brief 参数写入后的生效策略；持久化状态、运行态和待生效状态必须分别可观测。 */
typedef uint16_t LogicApplyPolicy;

#define LOGIC_APPLY_IMMEDIATE       1U
#define LOGIC_APPLY_NEXT_SCAN       2U
#define LOGIC_APPLY_WHEN_STOPPED    3U
#define LOGIC_APPLY_REBOOT          4U

/** @brief 写上下文来源协议；数值是 Toolkit ABI 的稳定组成部分。 */
typedef uint16_t LogicWriteProtocol;

#define LOGIC_WRITE_PROTOCOL_INTERNAL      1U
#define LOGIC_WRITE_PROTOCOL_MODBUS_TCP    2U
#define LOGIC_WRITE_PROTOCOL_SLE_MAP       3U
#define LOGIC_WRITE_PROTOCOL_HTTP          4U
#define LOGIC_WRITE_PROTOCOL_EDGE_TCP      5U

/**
 * @brief 所有北向写入口共享的实时控制模式读取契约。
 *
 * Provider 只能读取统一点位/安全快照，不得修改命令、参数或输出。调用方必须
 * 在每个外部写请求前重新调用；返回失败时不得沿用请求绑定时的旧模式值。
 */
typedef LogicResult (*LogicModeSnapshotProvider)(void *context,
                                                 uint32_t now_tick_ms,
                                                 uint32_t *mode_snapshot);

/**
 * @brief 由北向适配层传入 Toolkit 的固定宽度写上下文。
 *
 * source_identity 只用于来源隔离和审计；它不是认证凭据。request_id 去重作用域
 * 为 source_identity + boot_id，重启后不得重放旧请求。expected_revision 为 0 时
 * 表示调用方不进行乐观并发校验；若置位
 * LOGIC_WRITE_EXPECTED_REVISION_REQUIRED，则低 16 位即使为 0 也必须与当前
 * persisted revision 精确相等，供 Modbus TCP 的首次组写入使用。
 */
typedef struct
{
    LogicWriteProtocol protocol;
    LogicRole role;
    uint32_t source_identity;
    uint32_t boot_id;
    uint32_t request_id;
    uint32_t received_tick_ms;
    uint32_t expected_revision;
    uint32_t mode_snapshot;
} LogicWriteContext;

#define LOGIC_WRITE_EXPECTED_REVISION_REQUIRED 0x80000000UL
#define LOGIC_WRITE_EXPECTED_REVISION_VALUE_MASK 0x0000FFFFUL

_Static_assert(sizeof(LogicWriteContext) == 28U,
               "LogicWriteContext is a fixed-width Toolkit ABI object");

#endif
