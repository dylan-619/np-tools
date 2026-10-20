#ifndef KZ3_CAT1_BRIDGE_H
#define KZ3_CAT1_BRIDGE_H

#include <stdint.h>

#include "device_setup_store.h"
#include "network.h"
#include "sle_protocol.h"

typedef struct
{
    uint8_t initialized;
    uint8_t ack_pending;
    uint8_t telemetry_active;
    uint8_t telemetry_inflight;
    uint32_t downlink_count;
    uint32_t rejected_count;
    uint32_t dropped_count;
    uint32_t telemetry_success_count;
} Cat1BridgeStatus;

LogicResult Cat1Bridge_BindProtocolMap(SleProtocolMap *map);
uint8_t Cat1Bridge_BindPointService(
    const PlcV2NorthVariableService *service);

/** 用启动时身份和公共上报周期初始化，并绑定 MQTT 下行。 */
uint8_t Cat1Bridge_Init(const DeviceIdentity *identity,
                        uint8_t report_interval_seconds, uint32_t now_ms);

/** 在无线任务上下文更新遥测周期，不丢弃已接管的包。 */
uint8_t Cat1Bridge_UpdateReportInterval(uint8_t report_interval_seconds,
                                        uint32_t now_ms);

/** MQTT 下行回调；只进入现有 Map，不直接操作 DataManager。 */
void Cat1Bridge_OnDownlink(void *context, const uint8_t *payload,
                           uint16_t length);

/** 先提交 ACK，再按公共周期分包提交遥测。 */
void Cat1Bridge_Service(uint32_t now_ms);
uint8_t Cat1Bridge_GetStatus(Cat1BridgeStatus *status);

#endif
