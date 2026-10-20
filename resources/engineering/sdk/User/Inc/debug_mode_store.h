#ifndef KZ3_DEBUG_MODE_STORE_H
#define KZ3_DEBUG_MODE_STORE_H

#include <stdbool.h>
#include <stdint.h>

#include "wireless_eeprom_layout.h"

/* 新批次统一布局中的独立 16B 调试配置页。 */
#define DEBUG_MODE_STORE_ADDRESS     WIRELESS_EEPROM_DEBUG_BEGIN
#define DEBUG_MODE_STORE_RECORD_SIZE 16U

/**
 * @brief 从 AT24C16 加载调试开关并同步到 DebugLog。
 * @param enabled 返回有效记录中的开关值。
 * @return 0 表示 magic、版本、取值和 CRC 全部有效；非 0 表示读失败或记录无效。
 *
 * 任何失败都把运行期开关安全置为 false，不会自动回写 EEPROM。
 * 只能在任务上下文调用。
 */
uint8_t DebugModeStore_Load(bool *enabled);

/**
 * @brief 写入带版本和 CRC 的单页记录，回读成功后立即更新运行开关。
 * @return 0 表示 EEPROM 写入/回读和 RAM 切换已完成；非 0 时保留原 RAM 状态。
 */
uint8_t DebugModeStore_Save(bool enabled);

/** DeviceConfig 回调适配；context 忽略，只读当前已生效的 RAM 开关。 */
uint8_t DebugModeStore_ReadForCommand(void *context, uint8_t *enabled);

/** DeviceConfig 回调适配；只接受 0/1，成功时完成 EEPROM 和 RAM 切换。 */
uint8_t DebugModeStore_SaveForCommand(void *context, uint8_t enabled);

#endif
