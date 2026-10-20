#ifndef KZ3_HTTP_API_H
#define KZ3_HTTP_API_H

#include <stdint.h>

#include "board_point_map.h"
#include "network_config.h"

#define HTTP_API_MAX_METHOD_SIZE       8U
#define HTTP_API_MAX_PATH_SIZE       128U
#define HTTP_API_MAX_HEADER_SIZE    1024U
#define HTTP_API_MAX_BODY_SIZE       512U
#define HTTP_API_MAX_RESPONSE_BODY  2048U
#define HTTP_API_MAX_RESPONSE_SIZE  2304U
#define HTTP_API_PROJECT_ID_SIZE       49U
#define HTTP_API_PROJECT_VERSION_SIZE  49U
#define HTTP_API_BUILD_ID_SIZE          32U
#define HTTP_API_MANIFEST_ALGORITHM_SIZE 48U
#define HTTP_API_MANIFEST_HASH_SIZE     65U

#define HTTP_API_METHOD_GET            "GET"
#define HTTP_API_METHOD_POST           "POST"

typedef enum
{
    HTTP_API_PARSE_OK = 0,
    HTTP_API_PARSE_INCOMPLETE,
    HTTP_API_PARSE_BAD_REQUEST,
    HTTP_API_PARSE_TOO_LARGE
} HttpApiParseResult;

typedef enum
{
    HTTP_API_STATUS_OK = 200,
    HTTP_API_STATUS_BAD_REQUEST = 400,
    HTTP_API_STATUS_FORBIDDEN = 403,
    HTTP_API_STATUS_NOT_FOUND = 404,
    HTTP_API_STATUS_METHOD_NOT_ALLOWED = 405,
    HTTP_API_STATUS_REQUEST_TIMEOUT = 408,
    HTTP_API_STATUS_CONFLICT = 409,
    HTTP_API_STATUS_TOO_LARGE = 413,
    HTTP_API_STATUS_INTERNAL_ERROR = 500,
    HTTP_API_STATUS_SERVICE_UNAVAILABLE = 503
} HttpApiStatus;

typedef struct
{
    char method[HTTP_API_MAX_METHOD_SIZE];
    char path[HTTP_API_MAX_PATH_SIZE];
    const uint8_t *body;
    uint16_t body_length;
    uint16_t content_length;
    uint16_t frame_length;
} HttpRequest;

typedef struct
{
    HttpApiStatus status;
    uint8_t body[HTTP_API_MAX_RESPONSE_BODY];
    uint16_t body_length;
    uint8_t allow_header;
} HttpResponse;

typedef struct
{
    NetworkServiceConfig network;
    BoardIoSnapshot io;
    /* M1 的唯一控制故障投影；不把 DataManager fault 混写为旧 output_faults。 */
    uint32_t controller_fault_flags;
    uint32_t controller_fault_code;
    uint32_t controller_fault_detail;
    uint32_t controller_fault_first_seen_ms;
    uint32_t controller_fault_last_seen_ms;
    uint8_t controller_fault_source;
    uint8_t controller_fault_active;
    uint8_t controller_fault_latched;
    uint8_t logic_api_fault_valid;
    uint8_t logic_api_fault_code;
    uint8_t logic_api_fault_id;
    uint8_t logic_api_fault_phase;
    uint16_t logic_api_fault_instance_id;
    uint16_t logic_api_fault_project_reason;
    uint16_t logic_api_fault_additional_count;
    uint32_t logic_api_fault_scan_sequence;
    uint32_t logic_api_fault_violation_count;
    uint8_t parameter_load_status;
    uint8_t parameter_commit_status;
    uint8_t parameter_record_valid;
    uint8_t parameter_store_busy;
    uint8_t parameters_ready;
    uint32_t parameter_store_failure_count;
    char device_type[24];
    char serial_number[32];
    char hardware_version[16];
    char boot_version[16];
    char app_version[16];
    char production_date[24];
    char reset_reason[24];
    char mcu_name[24];
    char project_id[HTTP_API_PROJECT_ID_SIZE];
    char project_version[HTTP_API_PROJECT_VERSION_SIZE];
    char firmware_build_id[HTTP_API_BUILD_ID_SIZE];
    char point_manifest_algorithm[HTTP_API_MANIFEST_ALGORITHM_SIZE];
    char point_manifest_hash[HTTP_API_MANIFEST_HASH_SIZE];
    uint8_t mac[6];
    uint32_t timestamp_ms;
    uint32_t configuration_hash;
    uint32_t config_revision;
    uint16_t device_address;
    uint16_t control_mode_raw;
    uint16_t run_mode_raw;
    uint16_t point_table_version;
    uint16_t project_schema_version;
    uint16_t project_point_count;
    uint32_t boot_count;
    uint8_t boot_count_valid;
    uint8_t control_mode_valid;
    uint8_t run_mode_valid;
    uint8_t ethernet_capable;
    uint8_t http_enabled;
    uint8_t http_running;
    uint8_t modbus_running;
    uint8_t reboot_required;
    uint8_t watchdog_healthy;
    uint8_t storage_healthy;
    uint8_t network_healthy;
    uint8_t control_task_healthy;
    /** 仅当生成契约和运行时 revision 均可用时置 1。 */
    uint8_t project_available;
    uint16_t http_client_count;
    uint16_t modbus_client_count;
    uint32_t http_request_count;
    uint32_t http_error_count;
    uint32_t modbus_request_count;
    uint32_t modbus_error_count;
    uint8_t edge_tcp_configured;
    uint8_t edge_tcp_enabled;
    uint8_t edge_tcp_online;
    uint8_t edge_tcp_state;
    uint8_t edge_tcp_last_error;
    uint8_t edge_tcp_reserved[3];
    uint32_t edge_tcp_reconnect_count;
    /**
     * SLE 只读诊断快照，由网络服务在每次 HTTP 请求时填充。
     * 若设备状态读取失败，字段保持安全零值，特别是 module_ready 和
     * module_mac_valid 必须为 0，避免向客户端伪造模组已经就绪或 MAC 有效。
     */
    uint16_t sle_address;
    char sle_network_name[17];
    uint8_t sle_ap_id;
    uint8_t sle_work_mode;
    int8_t sle_tx_power;
    uint8_t sle_max_tx_power;
    uint8_t sle_config_valid;
    uint8_t sle_module_ready;
    uint8_t sle_module_mac[6];
    uint8_t sle_module_mac_valid;
} HttpApiContext;

/** @brief 初始化用于 HTTP 查询的安全上下文。 */
void HttpApiContext_SetDefaults(HttpApiContext *context);

/**
 * @brief 从固定接收缓冲解析一个 HTTP/1.1 请求。
 * @return 解析状态；请求未收完整时返回 INCOMPLETE，不消费输入。
 */
HttpApiParseResult HttpApi_ParseRequest(const uint8_t *input,
                                        uint16_t input_length,
                                        HttpRequest *request);

/**
 * @brief 根据只读 API 路由生成 JSON 响应。
 * @return HTTP 状态码。
 */
HttpApiStatus HttpApi_HandleRequest(const HttpApiContext *context,
                                    const HttpRequest *request,
                                    HttpResponse *response);

/** @brief 为网络接收/编码错误构造统一 JSON 错误响应。 */
void HttpApi_BuildErrorResponse(HttpResponse *response,
                                HttpApiStatus status,
                                const char *code,
                                const char *message);

/**
 * @brief 将响应编码为可直接发送的 HTTP 报文。
 * @return 0 表示成功，1 表示输出缓冲不足或参数无效。
 */
uint8_t HttpApi_FormatResponse(const HttpResponse *response,
                               uint8_t *output,
                               uint16_t output_capacity,
                               uint16_t *output_length);

#endif
