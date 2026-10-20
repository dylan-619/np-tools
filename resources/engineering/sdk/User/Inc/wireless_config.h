#ifndef KZ3_WIRELESS_CONFIG_H
#define KZ3_WIRELESS_CONFIG_H

#include <stdint.h>

#include "wireless_eeprom_layout.h"

#define WIRELESS_CONFIG_RECORD_SIZE 32U
#define WIRELESS_CONFIG_VERSION     1U
#define WIRELESS_CONFIG_FLAGS_NONE  0U

typedef enum
{
    WIRELESS_MODE_UNCONFIGURED = 0U,
    WIRELESS_MODE_SLE = 1U,
    WIRELESS_MODE_CAT1 = 2U
} WirelessMode;

/** 新批次无线公共配置；运行期必须使用启动时加载得到的快照。 */
typedef struct
{
    WirelessMode selected_mode;
    uint8_t report_seconds_raw;
    uint8_t flags;
    uint8_t valid;
} WirelessConfig;

/** 生成不启用任何无线承载的 RAM 默认值，不访问 EEPROM。 */
void WirelessConfig_SetDefaults(WirelessConfig *config);

/** 校验可提交配置；只有 SLE/CAT1 可写为活动模式。 */
uint8_t WirelessConfig_Validate(const WirelessConfig *config);

/** 从 EEPROM 96..127 加载完整版本化记录；失败时不修改 config。 */
uint8_t WirelessConfig_Load(WirelessConfig *config);

/**
 * 读取无线公共记录并区分 I2C 失败与内容无效。
 * 读取成功返回 0；内容有效时 `record_valid=1` 并输出 config，内容无效时为 0。
 */
uint8_t WirelessConfig_Probe(WirelessConfig *config, uint8_t *record_valid);

/**
 * 以模式字节最后提交的顺序保存完整记录并回读解码。
 * 失败时 EEPROM 记录保持未提交或无效，调用方运行快照不受影响。
 */
uint8_t WirelessConfig_Save(const WirelessConfig *config);

/** 计算实际上报周期，保持地址 97 的既有 0/0xFF 字节语义。 */
uint8_t WirelessConfig_ReportSeconds(const WirelessConfig *config);

#endif
