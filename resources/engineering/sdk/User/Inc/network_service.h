#ifndef KZ3_NETWORK_SERVICE_H
#define KZ3_NETWORK_SERVICE_H

#include <stdint.h>

#include "device_setup_store.h"
#include "edge_tcp_config.h"
#include "edge_tcp_status.h"
#include "network_config.h"
#include "network.h"

/** @brief 绑定 V2 统一变量服务及本次启动身份快照；由启动装配调用。 */
LogicResult NetworkService_BindNetwork(Network *network,
                                       const DeviceIdentity *identity,
                                       uint32_t boot_id);

/**
 * @brief 启动当前硬件支持的 HTTP 及按配置启用的 Modbus TCP 服务。
 *
 * 设备能力判断集中在网络服务模块内；调用方不应按 DevType 自行复制
 * 以太网能力规则。重复调用只返回成功，不会重复初始化 LwIP。
 */
uint8_t NetworkService_Start(void);

/** @brief 返回当前有效网络服务配置。 */
uint8_t NetworkService_GetConfig(NetworkServiceConfig *config);

/** @brief 由 LwIP link callback 更新链路状态。 */
void NetworkService_OnLinkStatus(uint8_t link_up);

/** @brief 返回当前物理链路状态。 */
uint8_t NetworkService_IsLinkUp(void);
uint8_t NetworkService_GetClientCount(void);

/** 读取 NetworkService 在启动时固定的 Edge 配置快照。 */
uint8_t NetworkService_GetEdgeConfig(EdgeTcpConfig *config);

/** 读取 Edge TCP 运行状态快照。 */
uint8_t NetworkService_GetEdgeStatus(EdgeTcpStatus *status);

#endif
