#ifndef KZ3_DEBUG_LOG_H
#define KZ3_DEBUG_LOG_H

#include <stdbool.h>

/**
 * @brief 更新运行期调试日志开关。
 *
 * 只修改 RAM 状态；持久化必须通过 DebugModeStore。调用方必须在
 * EEPROM 记录加载或回读确认成功后再更新。
 */
void DebugLog_SetEnabled(bool enabled);

/** @brief 返回当前 RAM 中的调试日志开关。 */
bool DebugLog_IsEnabled(void);

/**
 * @brief 开关开启时通过 printf 重定向的 UART1 输出一条调试日志。
 *
 * 格式字符串应自带 CRLF。关闭时不做格式化，也不访问 UART。
 * 不得在 ISR 或硬实时控制扫描路径调用。
 */
void DebugLog_Print(const char *format, ...);

#endif
