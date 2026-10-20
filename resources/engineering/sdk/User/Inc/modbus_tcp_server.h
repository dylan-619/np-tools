#ifndef KZ3_MODBUS_TCP_SERVER_H
#define KZ3_MODBUS_TCP_SERVER_H

#include <stdint.h>

#include "modbus_tcp_protocol.h"
#include "network_config.h"
#include "network_listener.h"
#include "lwip/api.h"
#include "product_build_config.h"

#define MODBUS_TCP_SERVER_MAX_CLIENTS KZ3_MODBUS_TCP_MAX_CLIENTS

typedef struct
{
    struct netconn *connection;
    uint8_t buffer[MODBUS_TCP_MAX_ADU_SIZE];
    uint16_t length;
    uint32_t last_activity_tick;
    int32_t last_error;
    uint32_t failure_count;
} ModbusTcpServerClient;

typedef struct
{
    NetworkServiceConfig config;
    ModbusPointAccess access;
    struct netconn *listener;
    ModbusTcpServerClient clients[MODBUS_TCP_SERVER_MAX_CLIENTS];
    uint8_t running;
    uint8_t client_count;
    uint32_t request_count;
    uint32_t error_count;
    NetworkListenerState listener_state;
    int32_t last_error;
    uint8_t retry_level;
    uint32_t retry_at_ms;
    uint32_t failure_count;
} ModbusTcpServerState;

/** @brief 初始化 Modbus TCP 服务状态，不创建 LwIP 连接。 */
void ModbusTcpServer_Init(ModbusTcpServerState *state,
                          const NetworkServiceConfig *config,
                          const ModbusPointAccess *access);

/** @brief 推进一次 listener/client 状态机；供固定任务和主机故障注入复用。 */
void ModbusTcpServer_Service(ModbusTcpServerState *state, uint32_t now_ms);

/** @brief Modbus TCP 固定任务入口。 */
void ModbusTcpServer_Task(void *argument);

#endif
