#ifndef KZ3_CAT1_CONFIG_H
#define KZ3_CAT1_CONFIG_H

#include <stdint.h>

#include "wireless_eeprom_layout.h"

#define CAT1_CONFIG_RECORD_SIZE      256U
#define CAT1_CONFIG_APN_SIZE          32U
#define CAT1_CONFIG_HOST_SIZE         64U
#define CAT1_CONFIG_USERNAME_SIZE     32U
#define CAT1_CONFIG_PASSWORD_SIZE     64U
#define CAT1_CONFIG_TOPIC_PREFIX_SIZE 32U
#define CAT1_CONFIG_CLIENT_ID_SIZE    13U
#define CAT1_CONFIG_TOPIC_SIZE        64U
#define CAT1_CONFIG_VERSION            1U
#define CAT1_CONFIG_KEEPALIVE_MIN     30U
#define CAT1_CONFIG_KEEPALIVE_MAX   1200U

typedef struct
{
    char apn[CAT1_CONFIG_APN_SIZE];
    char broker_host[CAT1_CONFIG_HOST_SIZE];
    uint16_t broker_port;
    uint16_t keepalive_seconds;
    char username[CAT1_CONFIG_USERNAME_SIZE];
    char password[CAT1_CONFIG_PASSWORD_SIZE];
    char topic_prefix[CAT1_CONFIG_TOPIC_PREFIX_SIZE];
    uint8_t qos;
    uint8_t valid;
} Cat1Config;

/** 生成不可联网的安全默认；host 为空，其他字段使用 V1 默认值。 */
void Cat1Config_SetDefaults(Cat1Config *config);

/** 校验持久化字段、字符串终止、范围及 AT 注入边界。 */
uint8_t Cat1Config_Validate(const Cat1Config *config);

/** 从 EEPROM 128..383 加载 magic/version/CRC 完整有效的记录。 */
uint8_t Cat1Config_Load(Cat1Config *config);

/** 读取 Cat.1 记录并区分 I2C 失败与内容无效；语义同 `WirelessConfig_Probe()`。 */
uint8_t Cat1Config_Probe(Cat1Config *config, uint8_t *record_valid);

/** 以 magic 最后提交的顺序保存并完整回读；失败时尽力撤销 magic。 */
uint8_t Cat1Config_Save(const Cat1Config *config);

/**
 * 从生产 SN 和 topic prefix 生成 MQTT 身份与上下行 topic。
 * SN 必须是当前产品的 12 位十进制生产身份。
 */
uint8_t Cat1Config_BuildTopics(const Cat1Config *config, const char *serial_number,
                               char client_id[CAT1_CONFIG_CLIENT_ID_SIZE],
                               char publish_topic[CAT1_CONFIG_TOPIC_SIZE],
                               char subscribe_topic[CAT1_CONFIG_TOPIC_SIZE]);

#endif
