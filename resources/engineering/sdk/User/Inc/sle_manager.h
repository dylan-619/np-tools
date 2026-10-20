#ifndef INC_SLE_MANAGER_H_
#define INC_SLE_MANAGER_H_

#include <stdint.h>
#include "sle_protocol.h"

#define SLE_CONFIG_VERSION 1U
#define SLE_CONFIG_NET_NAME_LEN 16U
/* 非零的显式 SLE 地址范围；0 保留为“从生产 SN 后四位自动派生”。 */
#define SLE_CONFIG_MIN_DEV_ADDR 1U
#define SLE_CONFIG_MAX_DEV_ADDR 2047U
#define SLE_CONFIG_MIN_POWER (-127)
#define SLE_CONFIG_MAX_POWER 20
#define SLE_CONFIG_SKIP_POWER 127
#define SLE_CONFIG_MAX_TX_POWER 8U

/** SLE AT 配置阶段状态；仅表示模组应答，不等同于读取模组 Flash 回读。 */
#define SLE_AT_APPLY_PENDING 0U
#define SLE_AT_APPLY_ACK     1U
#define SLE_AT_APPLY_SKIPPED 2U
#define SLE_AT_APPLY_FAILED  3U

/** SLE 运行配置；持久化必须经显式记录编解码，禁止按结构体布局直接写 EEPROM。 */
typedef struct
{
    uint16_t desired_dev_addr;
    uint8_t net_name[SLE_CONFIG_NET_NAME_LEN];
    uint8_t work_mode;
    int8_t tx_power;
    uint8_t max_tx_power;
    uint8_t ap_id;
    uint8_t valid;
} SleConfig;

/** 校验待运行配置；0 表示合法。 */
uint8_t SleConfig_Validate(const SleConfig *config);
/** 生成安全默认；地址 0 表示由有效生产 SN 后四位在运行期派生。 */
uint8_t SleConfig_SetDefaults(SleConfig *config, uint16_t device_addr);
/** 从首次初始化 owner 的 EEPROM `64..95` 记录加载已提交的 SLE 配置。 */
uint8_t SleConfig_Load(SleConfig *config);
/** 写入 EEPROM `64..95` 的版本化、CRC 校验 SLE 记录并回读确认。 */
uint8_t SleConfig_Save(const SleConfig *config);

/** SLE 对外状态快照；调用方不得修改后回写模块状态。 */
typedef struct
{
    /** EEPROM 中的配置地址；0 表示自动派生。 */
    uint16_t desired_dev_addr;
    /** 实际下发给 SLE 模组的地址；配置地址为 0 时来自 SN 后四位。 */
    uint16_t effective_dev_addr;
    uint8_t net_name[SLE_CONFIG_NET_NAME_LEN + 1U];
    uint8_t work_mode;
    int8_t tx_power;
    uint8_t max_tx_power;
    uint8_t ap_id;
    uint8_t config_valid;
    uint8_t module_ready;
    uint8_t module_mac[6];
    uint8_t module_mac_valid;
    /** 当前实际采用的板载数据上报周期，单位秒。 */
    uint8_t report_interval_seconds;
    /** EEPROM 97 的原始历史值；读取失败时为 0。 */
    uint8_t report_interval_raw;
    /** EEPROM 97 是否在本次启动读取成功。 */
    uint8_t report_interval_loaded;
    /** 地址、名称、功率 AT 下发的应答状态，取值见 SLE_AT_APPLY_*。 */
    uint8_t at_address_state;
    uint8_t at_name_state;
    uint8_t at_power_state;
    /** 仅当所有需要下发的 AT 参数均收到 ACK 时为 1；不是模组 Flash 回读。 */
    uint8_t module_config_applied;
} SleStatus;

void SleManager_Init(const SleConfig *config);
void SleManager_Step(uint32_t now_ms);
void SleManager_OnRx(const uint8_t *data, uint16_t len);
/** 在无线任务上下文更新地址 97 的周期，不重启 SLE 会话。 */
void SleManager_UpdateReportSchedule(uint8_t report_seconds_raw,
                                     uint32_t now_ms);
/** @brief 绑定已完成运行时激活的 SLE Map 子系统；未绑定时 0x02 保持安全忽略。 */
LogicResult SleManager_BindProtocolMap(SleProtocolMap *map);
uint8_t SleManager_QueueProtocol(const uint8_t *data, uint16_t len, uint16_t dest_addr);
uint16_t SleManager_GetDeviceAddress(void);

/** 读取当前已加载的 SLE 配置与模组状态，用于 OLED 和诊断命令显示。 */
uint8_t SleManager_GetStatus(SleStatus *status);

/**
 * 从 EEPROM 重新加载已校验的 SLE 配置并重启初始化状态机。
 * 保存失败或 EEPROM 配置无效时不覆盖当前运行配置。
 */
uint8_t SleManager_RequestReconfigure(void);

#endif
