#ifndef KZ3_DEVICE_SETUP_STORE_H
#define KZ3_DEVICE_SETUP_STORE_H

#include <stdint.h>

#include "sle_manager.h"

#define DEVICE_IDENTITY_SERIAL_LENGTH 12U
#define DEVICE_IDENTITY_SUPPORTED_TYPE 203U

/** 当前 F427-HPF 固件使用的生产身份快照。 */
typedef struct
{
    uint8_t serial_number[DEVICE_IDENTITY_SERIAL_LENGTH + 1U];
    uint16_t device_type;
    uint16_t device_address;
    uint8_t valid;
} DeviceIdentity;

/** 构造未初始化设备的 203 型回退身份；valid 为 0，地址为 0。 */
void DeviceIdentity_SetFallback(DeviceIdentity *identity);

/**
 * @brief 严格解析 12 位生产 SN。
 *
 * 仅接受 `0203xxxxxxxx`，其中末四位是 1..2047 的 SLE/协议设备地址。
 * 成功时输出完整且有效的身份快照；失败时不修改输出。
 */
uint8_t DeviceIdentity_Parse(const char *serial_number, uint16_t length,
                             DeviceIdentity *identity);

/** 从 EEPROM `0..11` 读取并校验生产 SN；空白或损坏记录返回失败。 */
uint8_t DeviceIdentity_Load(DeviceIdentity *identity);

/** 写入 EEPROM `0..11` 并回读确认；不覆盖兼容保留的 `12..15`。 */
uint8_t DeviceIdentity_Save(const DeviceIdentity *identity);

/** 从 EEPROM `64..95` 读取版本、CRC 和提交字节均有效的 SLE 配置。 */
uint8_t DeviceSetupStore_LoadSle(SleConfig *config);

/** 读取 SLE 记录并区分 I2C 失败与内容无效；语义同 `WirelessConfig_Probe()`。 */
uint8_t DeviceSetupStore_ProbeSle(SleConfig *config, uint8_t *record_valid);

/**
 * @brief 加载已提交的 SLE 配置；没有有效 SLE 记录时以有效 SN 后四位生成 RAM 默认值。
 *
 * SN 回退配置不写入 EEPROM，且 valid 为 0，表示尚未完成独立的 SLE 首次初始化。
 * 已提交的 SLE 记录优先级高于 SN 派生地址。
 */
uint8_t DeviceSetupStore_LoadSleOrIdentityDefault(SleConfig *config);

/**
 * 保存 SLE 配置到 EEPROM `64..95`。
 *
 * 先以无线类型字节 0 标记未提交，写入正文和 CRC 后再提交类型 `2`。地址
 * 1..2047 为显式地址；地址 0 仅在 EEPROM 中存在有效生产 SN 时允许保存，
 * 表示运行期从 SN 后四位派生实际模组地址。
 */
uint8_t DeviceSetupStore_SaveSle(const SleConfig *config);

/**
 * @brief 将 SLE 配置地址解析为实际下发给模组的地址。
 *
 * 非零配置地址直接返回；配置地址为 0 时读取有效生产 SN 的后四位。
 * 无有效 SN 时返回失败，避免向模组下发伪造的 0 地址。
 */
uint8_t DeviceSetupStore_ResolveSleAddress(const SleConfig *config,
                                           uint16_t *effective_address);

#endif
