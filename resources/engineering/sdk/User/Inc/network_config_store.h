#ifndef KZ3_NETWORK_CONFIG_STORE_H
#define KZ3_NETWORK_CONFIG_STORE_H

#include <stdint.h>

#include "network_config.h"

/**
 * @brief 从 NetworkConfig owner（EEPROM 48..61）加载网络基础配置。
 *
 * 该直接区只保存 IP、掩码、网关和 HTTP 端口；Modbus 端口、服务开关、身份
 * 与角色是固件运行时契约，启动时回到默认值。直接区没有 CRC/提交标志：全
 * 0xFF 擦除态会首次写入默认配置并回读确认；非空非法记录只回退 RAM 默认值，
 * 不自动覆盖，也不读取、迁移或写入其他地址。
 * @param config 输出运行时配置。
 * @param persistent_valid 输出是否得到字段校验通过的直接配置。
 * @return 0 表示已得到可运行配置，1 表示 EEPROM 读取或首次默认写入失败。
 */
uint8_t NetworkConfigStore_Load(NetworkServiceConfig *config,
                                uint8_t *persistent_valid);

/**
 * @brief 判断一次加载结果是否仍允许按已得到的配置继续启动网络服务。
 *
 * 只有字段校验通过或空 EEPROM 首次默认写入成功时才允许控制服务。读取失败、
 * 首次写入失败或非空非法记录都只能使用 RAM 默认值启动诊断 HTTP。
 * @param load_result NetworkConfigStore_Load() 的返回值。
 * @param persistent_valid NetworkConfigStore_Load() 输出的持久化有效标志。
 * @return 1 表示可继续使用配置，0 表示必须按存储异常处理。
 */
static inline uint8_t NetworkConfigStore_HasUsableConfig(uint8_t load_result,
                                                         uint8_t persistent_valid)
{
    return (load_result == 0U && persistent_valid != 0U) ? 1U : 0U;
}

/**
 * @brief 候选校验后写入 48..61 直接区并回读确认。
 * @param config 输入/输出配置；成功后替换为回读后补齐默认运行时字段的配置。
 * @return 0 表示写入与回读一致，1 表示校验或 EEPROM 操作失败。
 */
uint8_t NetworkConfigStore_Commit(NetworkServiceConfig *config);

/** @brief 获取最近一次加载或提交的运行时配置。 */
uint8_t NetworkConfigStore_Get(NetworkServiceConfig *config);

/** @brief 返回最近一次加载结果中的持久化有效标志。 */
uint8_t NetworkConfigStore_IsPersistentValid(void);

#endif
