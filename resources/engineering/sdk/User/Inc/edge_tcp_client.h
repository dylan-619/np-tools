#ifndef KZ3_EDGE_TCP_CLIENT_H
#define KZ3_EDGE_TCP_CLIENT_H

#include <stdint.h>

#include "device_setup_store.h"
#include "edge_tcp_config.h"
#include "edge_tcp_status.h"
#include "network.h"

#define EDGE_TCP_SOURCE_IDENTITY          0x45444745UL
#define EDGE_TCP_HEARTBEAT_INTERVAL_MS    30000UL
#define EDGE_TCP_REPORT_INTERVAL_MS       1000UL
#define EDGE_TCP_RECEIVE_TIMEOUT_MS       100U
#define EDGE_TCP_SEND_TIMEOUT_MS          1000U

/**
 * @brief 绑定启动期快照和唯一 Network owner。
 *
 * 函数只复制配置与身份，不持有调用方栈对象。配置禁用时返回成功并保持
 * DISABLED；配置、身份、boot_id 或绑定无效时返回失败且禁止建连。
 */
uint8_t EdgeTcpClient_Init(
    const EdgeTcpConfig *config, const DeviceIdentity *identity,
    uint32_t boot_id, const PlcV2NorthVariableService *point_service,
    NetworkProtocolState *protocol,
    const NorthKeyGeneratedTable *generated_table);

/** 由唯一 Ethernet link callback 更新；实际关闭和重连仍在 Edge task 执行。 */
void EdgeTcpClient_SetLinkUp(uint8_t link_up);

/** Edge TCP 唯一 netconn owner 任务入口。 */
void EdgeTcpClient_Task(void *argument);

/** 用短临界区复制运行状态；不访问 EEPROM 或 LwIP。 */
uint8_t EdgeTcpClient_GetStatus(EdgeTcpStatus *status);

#if defined(EDGE_TCP_CLIENT_UNIT_TEST)
typedef enum
{
    EDGE_TCP_TRANSPORT_OK = 0U,
    EDGE_TCP_TRANSPORT_TIMEOUT,
    EDGE_TCP_TRANSPORT_CLOSED,
    EDGE_TCP_TRANSPORT_ERROR
} EdgeTcpTransportResult;

typedef uint8_t (*EdgeTcpTransportConsumeFn)(
    void *context, const uint8_t *data, uint16_t length);

/** 仅供主机测试注入；生产固件始终使用本文件对应的 LwIP netconn 适配。 */
typedef struct
{
    void *context;
    uint32_t (*now_ms)(void *context);
    void (*delay_ms)(void *context, uint32_t delay_ms);
    void *(*open)(void *context);
    EdgeTcpTransportResult (*connect)(
        void *context, void *connection, const uint8_t ip[4], uint16_t port);
    EdgeTcpTransportResult (*receive)(
        void *context, void *connection, EdgeTcpTransportConsumeFn consume,
        void *consume_context);
    EdgeTcpTransportResult (*send_part)(
        void *context, void *connection, const uint8_t *data, uint16_t length,
        uint16_t *sent_length);
    void (*close)(void *context, void *connection);
    void (*destroy)(void *context, void *connection);
} EdgeTcpTransportOps;

void EdgeTcpClient_TestInstallTransport(const EdgeTcpTransportOps *ops);
void EdgeTcpClient_TestStep(void);
#endif

#endif
