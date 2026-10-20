#ifndef KZ3_WIRELESS_MANAGER_H
#define KZ3_WIRELESS_MANAGER_H

#include <stdint.h>

#include "sle_protocol.h"
#include "wireless_config.h"

typedef enum
{
    WIRELESS_LINK_STAGE_CONFIG_REQUIRED = 0U,
    WIRELESS_LINK_STAGE_OFF,
    WIRELESS_LINK_STAGE_INITIALIZING,
    WIRELESS_LINK_STAGE_NETWORK,
    WIRELESS_LINK_STAGE_MQTT,
    WIRELESS_LINK_STAGE_ONLINE
} WirelessLinkStage;

typedef struct
{
    WirelessMode running_mode;
    WirelessMode saved_mode;
    uint8_t initialized;
    uint8_t common_config_valid;
    uint8_t sle_config_valid;
    uint8_t cat1_config_valid;
    uint8_t port_ready;
    uint8_t reboot_required;
    uint8_t cat1_online;
    uint8_t cat1_state;
    uint8_t cat1_last_error;
    uint8_t cat1_soft_retry_count;
    uint8_t cat1_registration_status;
    uint8_t cat1_signal_rssi;
    uint8_t cat1_signal_ber;
    uint32_t cat1_reconnect_count;
    WirelessLinkStage link_stage;
} WirelessStatus;

/** 纯逻辑启动判定；模式与目标配置都有效时返回 1。 */
uint8_t WirelessManager_ModeCanStart(WirelessMode mode,
                                     uint8_t common_config_valid,
                                     uint8_t sle_config_valid,
                                     uint8_t cat1_config_valid);

/** 绑定唯一 Map owner；SLE 和 Cat.1 共用该对象与响应槽。 */
LogicResult WirelessManager_BindProtocolMap(SleProtocolMap *map);

/** 读取运行快照，并重新读取已保存模式以计算 reboot_required。 */
uint8_t WirelessManager_GetStatus(WirelessStatus *status);

WirelessMode WirelessManager_GetRunningMode(void);

/** SLE 活动时重载并重建会话；非活动时不触碰 USART2 且返回成功。 */
uint8_t WirelessManager_RequestSleReconfigure(void);

/** Cat.1 活动时请求完整恢复并重建会话；非 Cat.1 或驱动未就绪返回失败。 */
uint8_t WirelessManager_RequestCat1Reconnect(void);

/** 通知无线任务重读地址 97；不切换 transport，不重启会话。 */
void WirelessManager_RequestReportScheduleReload(void);

void StartWirelessTask(void *argument);

#endif
