#ifndef KZ3_HTTP_SERVER_H
#define KZ3_HTTP_SERVER_H

#include <stdint.h>

#include "http_api.h"
#include "lwip/api.h"
#include "network_listener.h"
#include "product_build_config.h"

#define HTTP_SERVER_MAX_CLIENTS KZ3_HTTP_MAX_CLIENTS
#define HTTP_SERVER_CLIENT_BUFFER_SIZE \
    (HTTP_API_MAX_HEADER_SIZE + HTTP_API_MAX_BODY_SIZE)

typedef void (*HttpApiContextProvider)(HttpApiContext *context, void *provider_context);
typedef uint8_t (*HttpNorthRequestHandler)(const HttpRequest *request,
                                           HttpResponse *response,
                                           void *handler_context);

typedef struct
{
    struct netconn *connection;
    uint8_t buffer[HTTP_SERVER_CLIENT_BUFFER_SIZE];
    uint16_t length;
    uint32_t last_activity_tick;
    int32_t last_error;
    uint32_t failure_count;
} HttpServerClient;

typedef struct
{
    NetworkServiceConfig config;
    HttpApiContextProvider provider;
    void *provider_context;
    HttpNorthRequestHandler north_handler;
    void *north_handler_context;
    struct netconn *listener;
    HttpServerClient clients[HTTP_SERVER_MAX_CLIENTS];
    uint8_t running;
    uint8_t client_count;
    uint32_t request_count;
    uint32_t error_count;
    NetworkListenerState listener_state;
    int32_t last_error;
    uint8_t retry_level;
    uint32_t retry_at_ms;
    uint32_t failure_count;
    HttpApiContext context;
    HttpResponse response;
    uint8_t response_buffer[HTTP_API_MAX_RESPONSE_SIZE];
} HttpServerState;

/** @brief 初始化 HTTP 服务状态，不创建 LwIP 连接。 */
void HttpServer_Init(HttpServerState *state,
                     const NetworkServiceConfig *config,
                     HttpApiContextProvider provider,
                     void *provider_context);

/** @brief 绑定可选的统一变量北向路由；返回 1 表示请求已被处理。 */
void HttpServer_BindNorthHandler(HttpServerState *state,
                                 HttpNorthRequestHandler handler,
                                 void *handler_context);

/** @brief 推进一次 listener/client 状态机；供固定任务和主机故障注入复用。 */
void HttpServer_Service(HttpServerState *state, uint32_t now_ms);

/** @brief HTTP 固定任务入口。 */
void HttpServer_Task(void *argument);

#endif
