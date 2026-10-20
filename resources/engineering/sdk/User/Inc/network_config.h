#ifndef KZ3_NETWORK_CONFIG_H
#define KZ3_NETWORK_CONFIG_H

#include <stdint.h>

#include "logic_contract.h"
#include "wireless_eeprom_layout.h"

/* NetworkService 的既有可迁移物理配置仅为 EEPROM 48..61 的 14 B 直接区。
 * 32 B 结构字段仍是 RAM 服务契约；不得据此推导 80..111 的物理记录。 */
#define NETWORK_CONFIG_DIRECT_ADDRESS          WIRELESS_EEPROM_ETHERNET_BEGIN
#define NETWORK_CONFIG_DIRECT_RECORD_SIZE      14U
#define NETWORK_CONFIG_DIRECT_IP_OFFSET        0U
#define NETWORK_CONFIG_DIRECT_NETMASK_OFFSET   4U
#define NETWORK_CONFIG_DIRECT_GATEWAY_OFFSET   8U
#define NETWORK_CONFIG_DIRECT_HTTP_PORT_OFFSET 12U
#define NETWORK_CONFIG_DIRECT_END_ADDRESS      WIRELESS_EEPROM_ETHERNET_END

#if NETWORK_CONFIG_DIRECT_ADDRESS != 48U || \
    (NETWORK_CONFIG_DIRECT_ADDRESS + NETWORK_CONFIG_DIRECT_RECORD_SIZE - 1U) != \
        NETWORK_CONFIG_DIRECT_END_ADDRESS
#error "NetworkConfig 直接区必须严格占用 EEPROM 48..61"
#endif

/* 以下常量仅保留给 RAM 编码/历史 host 测试；当前 production 不得使用它们
 * 作为 EEPROM 物理地址或迁移目标。 */
#define NETWORK_CONFIG_RECORD_SIZE             32U
#define NETWORK_CONFIG_FORMAT_VERSION          1U
#define NETWORK_CONFIG_COMMIT_OFFSET           0U
#define NETWORK_CONFIG_VERSION_OFFSET          1U
#define NETWORK_CONFIG_IP_OFFSET               2U
#define NETWORK_CONFIG_NETMASK_OFFSET          6U
#define NETWORK_CONFIG_GATEWAY_OFFSET          10U
#define NETWORK_CONFIG_HTTP_PORT_OFFSET        14U
#define NETWORK_CONFIG_MODBUS_PORT_OFFSET      16U
#define NETWORK_CONFIG_SERVICE_FLAGS_OFFSET    18U
#define NETWORK_CONFIG_SEQUENCE_OFFSET         20U
#define NETWORK_CONFIG_UNIT_ID_OFFSET          22U
#define NETWORK_CONFIG_NETWORK_MODE_OFFSET     23U
#define NETWORK_CONFIG_MODBUS_WRITE_SOURCE_IDENTITY_OFFSET 24U
#define NETWORK_CONFIG_MODBUS_WRITE_ROLE_OFFSET 28U
#define NETWORK_CONFIG_RESERVED_OFFSET          29U
#define NETWORK_CONFIG_CRC_OFFSET              30U
#define NETWORK_SERVICE_FLAG_MODBUS_TCP        0x0001U
#define NETWORK_CONFIG_SERVICE_FLAG_MODBUS_TCP NETWORK_SERVICE_FLAG_MODBUS_TCP

#if (NETWORK_CONFIG_MODBUS_PORT_OFFSET + 2U) > NETWORK_CONFIG_CRC_OFFSET || \
    (NETWORK_CONFIG_SERVICE_FLAGS_OFFSET + 2U) > NETWORK_CONFIG_CRC_OFFSET || \
    (NETWORK_CONFIG_SEQUENCE_OFFSET + 2U) > NETWORK_CONFIG_CRC_OFFSET || \
    (NETWORK_CONFIG_UNIT_ID_OFFSET + 1U) > NETWORK_CONFIG_CRC_OFFSET || \
    (NETWORK_CONFIG_NETWORK_MODE_OFFSET + 1U) > NETWORK_CONFIG_CRC_OFFSET || \
    (NETWORK_CONFIG_MODBUS_WRITE_SOURCE_IDENTITY_OFFSET + 4U) > NETWORK_CONFIG_CRC_OFFSET || \
    NETWORK_CONFIG_RESERVED_OFFSET >= NETWORK_CONFIG_CRC_OFFSET || \
    (NETWORK_CONFIG_CRC_OFFSET + 2U) != NETWORK_CONFIG_RECORD_SIZE
#error "NetworkConfig 字段布局越过 32B owner 或覆盖 CRC"
#endif

typedef struct
{
    uint8_t ip[4];
    uint8_t netmask[4];
    uint8_t gateway[4];
    uint16_t http_port;
    uint16_t modbus_port;
    uint16_t service_flags;
    uint16_t sequence;
    uint8_t unit_id;
    uint8_t network_mode;
    uint32_t modbus_write_source_identity;
    LogicRole modbus_write_role;
} NetworkServiceConfig;

/**
 * @brief 生成安全默认网络服务配置。
 * @param config 输出配置。
 * @return 0 表示成功，1 表示参数无效。
 */
uint8_t NetworkConfig_SetDefaults(NetworkServiceConfig *config);

/**
 * @brief 校验网络服务配置，避免错误配置启动监听或写入 EEPROM。
 * @param config 待校验配置。
 * @return 0 表示合法，1 表示非法。
 */
uint8_t NetworkConfig_Validate(const NetworkServiceConfig *config);

#endif
