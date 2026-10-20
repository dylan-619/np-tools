#ifndef KZ3_REPORT_SCHEDULE_H
#define KZ3_REPORT_SCHEDULE_H

#include <stdint.h>

#include "wireless_eeprom_layout.h"

/* 无线公共记录内：96 为已提交模式，97 保留板载数据上报周期字节语义。 */
#define REPORT_SCHEDULE_EEPROM_ADDRESS (WIRELESS_EEPROM_COMMON_BEGIN + 1U)
#define REPORT_SCHEDULE_DEFAULT_SECONDS 1U

/**
 * @brief 将历史 EEPROM 周期字节归一化为实际秒数。
 *
 * 兼容旧固件行为：0 表示未初始化并回退为 1 秒；255 是旧异常保护值，
 * 回退为 2 秒；其余 1..254 原样保留。
 */
uint8_t ReportSchedule_NormalizeLegacySeconds(uint8_t raw_value);

/**
 * @brief 从 CRC 有效的无线公共记录读取板载数据上报周期。
 * @param seconds 输出实际周期（秒），不可为 NULL。
 * @param raw_value 可选输出 EEPROM 原始字节。
 * @return 0 表示读取成功；非 0 表示读取失败，此时 seconds 仍返回安全默认 1 秒。
 *
 * 调用上下文为任务；函数不写 EEPROM。
 */
uint8_t ReportSchedule_LoadSeconds(uint8_t *seconds, uint8_t *raw_value);

#endif
