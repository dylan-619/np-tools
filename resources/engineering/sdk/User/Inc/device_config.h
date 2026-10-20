#ifndef INC_DEVICE_CONFIG_H_
#define INC_DEVICE_CONFIG_H_

#include <stddef.h>
#include <stdint.h>
#include "cat1_config.h"
#include "device_setup_store.h"
#include "edge_tcp_config.h"
#include "edge_tcp_status.h"
#include "network_config.h"
#include "wireless_manager.h"

/** UART1 配置查询响应的固定缓冲容量，包含末尾 NUL。 */
#define DEVICE_CONFIG_QUERY_RESPONSE_CAPACITY 256U

/**
 * Cat.1 INIT 在所有文本字符都需百分号编码时的最坏线长，不含 CRLF/NUL。
 * 公式包含 5 个文本字段、PORT/KEEPALIVE/QOS 最大十进制宽度和 7 个逗号。
 */
#define DEVICE_CONFIG_CAT1_INIT_MAX_COMMAND_LENGTH                         \
    ((sizeof("@CFG,4G,INIT,") - 1U) +                                    \
     3U * ((CAT1_CONFIG_APN_SIZE - 1U) + (CAT1_CONFIG_HOST_SIZE - 1U) +   \
           (CAT1_CONFIG_USERNAME_SIZE - 1U) +                             \
           (CAT1_CONFIG_PASSWORD_SIZE - 1U) +                             \
           (CAT1_CONFIG_TOPIC_PREFIX_SIZE - 1U)) +                        \
     5U + 4U + 1U + 7U)

/** 以太网持久化配置，不包含运行期连接和接收缓冲。 */
typedef struct
{
    uint8_t ip[4];
    uint8_t netmask[4];
    uint8_t gateway[4];
    uint16_t port;
} EthernetConfig;

/** UART1 配置查询命令的分类结果。 */
typedef enum
{
    DEVICE_CONFIG_QUERY_NONE = 0U,
    DEVICE_CONFIG_QUERY_ETHERNET,
    DEVICE_CONFIG_QUERY_SLE,
    DEVICE_CONFIG_QUERY_IDENTITY,
    DEVICE_CONFIG_QUERY_WIRELESS,
    DEVICE_CONFIG_QUERY_CAT1,
    DEVICE_CONFIG_QUERY_EDGE
} DeviceConfigQueryKind;

/** 读取运行/保存网络快照及链路状态的只读 provider。返回 0 表示成功。 */
typedef uint8_t (*DeviceConfig_EthernetReader)(
    void *context,
    NetworkServiceConfig *running,
    NetworkServiceConfig *saved,
    uint8_t *link_up);

/** 读取 SLE 状态快照的只读 provider。返回 0 表示成功。 */
typedef uint8_t (*DeviceConfig_SleReader)(void *context, SleStatus *status);

/** 读取生产身份快照的只读 provider。空白设备也应返回 fallback 快照。 */
typedef uint8_t (*DeviceConfig_IdentityReader)(void *context,
                                               DeviceIdentity *identity);
/** 读取运行/保存无线模式以及公共配置快照。 */
typedef uint8_t (*DeviceConfig_WirelessReader)(void *context,
                                               WirelessStatus *status,
                                               WirelessConfig *config);
/** 读取已提交的 Cat.1/MQTT 配置。 */
typedef uint8_t (*DeviceConfig_Cat1Reader)(void *context,
                                          Cat1Config *config);
/** 读取 Edge 启动快照、EEPROM 快照和运行状态。 */
typedef uint8_t (*DeviceConfig_EdgeReader)(void *context,
                                          EdgeTcpConfig *running,
                                          EdgeTcpConfig *saved,
                                          EdgeTcpStatus *status);

/** 接收最终状态文本的输出 writer；文本不包含 CRLF。 */
typedef void (*DeviceConfig_ResponseWriter)(void *context, const char *response);

/** UART 状态查询的内部测试 seam，不包含保存、重配置或复位回调。 */
typedef struct
{
    DeviceConfig_EthernetReader read_ethernet;
    DeviceConfig_SleReader read_sle;
    DeviceConfig_IdentityReader read_identity;
    DeviceConfig_WirelessReader read_wireless;
    DeviceConfig_Cat1Reader read_cat1;
    DeviceConfig_EdgeReader read_edge;
    DeviceConfig_ResponseWriter write_response;
    void *context;
} DeviceConfigStatusQueryIo;

typedef uint8_t (*DeviceConfig_SleConfigReader)(void *context,
                                                SleConfig *config);
typedef uint8_t (*DeviceConfig_SleConfigWriter)(void *context,
                                                const SleConfig *config);
typedef uint8_t (*DeviceConfig_SleReconfigure)(void *context);
typedef uint8_t (*DeviceConfig_IdentityWriter)(void *context,
                                               const DeviceIdentity *identity);
typedef uint8_t (*DeviceConfig_NetworkConfigReader)(
    void *context, NetworkServiceConfig *config);
typedef uint8_t (*DeviceConfig_NetworkConfigWriter)(
    void *context, const NetworkServiceConfig *config);
typedef uint8_t (*DeviceConfig_DebugModeReader)(void *context,
                                                uint8_t *enabled);
typedef uint8_t (*DeviceConfig_DebugModeWriter)(void *context,
                                                uint8_t enabled);
typedef uint8_t (*DeviceConfig_WirelessConfigReader)(void *context,
                                                     WirelessConfig *config);
typedef uint8_t (*DeviceConfig_WirelessConfigWriter)(
    void *context, const WirelessConfig *config);
typedef uint8_t (*DeviceConfig_Cat1ConfigReader)(void *context,
                                                Cat1Config *config);
typedef uint8_t (*DeviceConfig_Cat1ConfigWriter)(void *context,
                                                const Cat1Config *config);
typedef uint8_t (*DeviceConfig_EdgeConfigReader)(void *context,
                                                EdgeTcpConfig *config);
typedef uint8_t (*DeviceConfig_EdgeConfigWriter)(
    void *context, const EdgeTcpConfig *config);
typedef uint8_t (*DeviceConfig_Cat1Reconnect)(void *context);
typedef void (*DeviceConfig_LedWriter)(void *context, uint8_t action);
/**
 * 请求 MCU 软件复位。调用前 UART1 成功响应必须已完整发出；产品实现通常不返回。
 * 主机测试实现可以返回，用于验证调用顺序。
 */
typedef void (*DeviceConfig_SystemResetRequester)(void *context);

#define DEVICE_CONFIG_LED_OFF 0U
#define DEVICE_CONFIG_LED_GREEN 1U
#define DEVICE_CONFIG_LED_RED 2U

/** UART1 命令执行所需的显式边界；解析器本身不直接访问 EEPROM 或设备 owner。 */
typedef struct
{
    DeviceConfigStatusQueryIo status;
    DeviceConfig_SleConfigReader load_sle;
    DeviceConfig_SleConfigWriter save_sle;
    DeviceConfig_SleReconfigure reconfigure_sle;
    DeviceConfig_IdentityWriter save_identity;
    DeviceConfig_NetworkConfigReader load_network;
    DeviceConfig_NetworkConfigWriter save_network;
    DeviceConfig_DebugModeReader read_debug_mode;
    DeviceConfig_DebugModeWriter save_debug_mode;
    DeviceConfig_WirelessConfigReader load_wireless;
    DeviceConfig_WirelessConfigWriter save_wireless;
    DeviceConfig_Cat1ConfigReader load_cat1;
    DeviceConfig_Cat1ConfigWriter save_cat1;
    DeviceConfig_EdgeConfigReader load_edge;
    DeviceConfig_EdgeConfigWriter save_edge;
    DeviceConfig_Cat1Reconnect reconnect_cat1;
    DeviceConfig_LedWriter set_led;
    DeviceConfig_SystemResetRequester request_system_reset;
} DeviceConfigCommandIo;

#if defined(__GNUC__)
_Static_assert(sizeof(EthernetConfig) == 14U, "EthernetConfig 大小必须为 14 字节");
_Static_assert(offsetof(EthernetConfig, port) == 12U, "EthernetConfig port 偏移错误");
#endif

/** 校验可分配给设备的 IPv4 地址，拒绝全 0 和全 255 地址。 */
uint8_t DeviceConfig_ValidateIpv4(const uint8_t ip[4]);

/** 校验连续 1 的 IPv4 子网掩码，拒绝全 0 掩码。 */
uint8_t DeviceConfig_ValidateNetmask(const uint8_t netmask[4]);

/**
 * @brief 识别严格的 UART1 配置查询命令，不访问硬件或修改配置。
 * @param text 命令原始字节，可在末尾附带 CR/LF。
 * @param len 命令原始长度。
 * @return 查询命令分类；命令不完整、带附加参数或参数无效时返回 NONE。
 */
DeviceConfigQueryKind DeviceConfig_IdentifyQuery(const char *text, uint16_t len);

/**
 * @brief 将运行与保存的网络快照格式化为 UART1 只读查询响应。
 * @param running 当前网络服务实际使用的配置。
 * @param saved NetworkConfig owner 中保存的、经过校验的配置。
 * @param link_up 物理链路状态，非零按 1 输出。
 * @param response 输出缓冲；成功结果不带 CRLF。
 * @param response_capacity 输出缓冲容量，包含末尾 NUL。
 * @return 0 表示成功；非 0 表示参数无效、容量不足或格式化失败。
 *
 * 本接口只读取输入快照；REBOOT_REQUIRED 不比较 sequence，也不访问 EEPROM。
 */
uint8_t DeviceConfig_FormatEthernetQueryResponse(
    const NetworkServiceConfig *running,
    const NetworkServiceConfig *saved,
    uint8_t link_up,
    char *response,
    uint16_t response_capacity);

/**
 * @brief 将 SLE 状态快照格式化为 UART1 只读查询响应。
 * @param status 当前 SLE 状态快照。
 * @param response 输出缓冲；成功结果不带 CRLF。
 * @param response_capacity 输出缓冲容量，包含末尾 NUL。
 * @return 0 表示成功；非 0 表示参数无效、容量不足或格式化失败。
 *
 * NAME 中的百分号和逗号分别编码为 %25 和 %2C；本接口不重配置 SLE。
 */
uint8_t DeviceConfig_FormatSleQueryResponse(
    const SleStatus *status,
    char *response,
    uint16_t response_capacity);

/**
 * @brief 将生产身份快照格式化为 UART1 只读查询响应。
 *
 * 空白设备可返回 `VALID=0` 的 203 型 fallback，供现场确认后执行首次 SN 初始化；
 * 原有身份字段末尾追加 LOGIC_VER，取自编译时生成的工程版本（1..48 字节 ASCII）。
 * 该接口不写 EEPROM，也不改变运行身份；容量不足或格式化失败时返回非 0。
 */
uint8_t DeviceConfig_FormatIdentityQueryResponse(
    const DeviceIdentity *identity,
    char *response,
    uint16_t response_capacity);

/** 格式化无线承载选择与上报周期摘要。 */
uint8_t DeviceConfig_FormatWirelessQueryResponse(
    const WirelessStatus *status,
    const WirelessConfig *config,
    char *response,
    uint16_t response_capacity);

/**
 * 格式化 Cat.1 配置的首行摘要。密码只输出 SET/EMPTY。
 * APN/HOST/TOPIC 由 SHOW 处理器以独立百分号编码行输出。
 */
uint8_t DeviceConfig_FormatCat1QueryResponse(
    const Cat1Config *config,
    char *response,
    uint16_t response_capacity);

/** 格式化 Edge TCP 启动/保存快照和运行状态。 */
uint8_t DeviceConfig_FormatEdgeQueryResponse(
    const EdgeTcpConfig *running,
    const EdgeTcpConfig *saved,
    const EdgeTcpStatus *status,
    char *response,
    uint16_t response_capacity);

/**
 * @brief 分发 UART1 状态查询并输出不带 CRLF 的最终文本。
 * @param query_kind 查询类型，支持 ETH、SLE 或 SYS 身份。
 * @param io 只读 provider 和响应 writer；不访问硬件保存或复位接口。
 * @return 0 表示查询及输出成功；非 0 表示参数、读取或格式化失败。
 *
 * provider 或格式化失败时 writer 分别收到 `ERR,ETH_READ`、`ERR,SLE_READ`
 * 或 `ERR,SYS_READ`；成功时收到对应完整 `OK,...` 文本。
 */
uint8_t DeviceConfig_HandleStatusQuery(
    DeviceConfigQueryKind query_kind,
    const DeviceConfigStatusQueryIo *io);

/**
 * @brief 解析一条 UART1 运维配置命令，不直接访问 EEPROM 或硬件。
 * @param text 命令原始字节；必须以 @CFG, 开头，可附带 CR/LF。
 * @param sle_config 输入/输出 SLE 配置候选值。
 * @param eth_config 输入/输出以太网配置候选值。
 * @param sle_changed/eth_changed 返回实际变更的配置域。
 * @param response 返回简短 ASCII 处理结果。
 * @return 0 表示成功解析和校验；非 0 表示命令或参数非法，调用方不得保存。
 */
uint8_t DeviceConfig_ParseCommand(const char *text, uint16_t len,
                                  SleConfig *sle_config, EthernetConfig *eth_config,
                                  uint8_t *sle_changed, uint8_t *eth_changed,
                                  char *response, uint16_t response_capacity);

/**
 * 识别、校验并执行一条完整 UART1 运维命令；响应统一经 writer 输出。
 * `@RST` 严格匹配时先输出 `OK,RESETTING`，再调用 request_system_reset；
 * 未提供该回调时返回 `ERR,RESET_UNAVAILABLE`，不会复位。
 */
uint8_t DeviceConfig_HandleUartCommand(const char *text, uint16_t len,
                                       const DeviceConfigCommandIo *io);

#endif
