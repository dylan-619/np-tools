#ifndef KZ3_CAT1_MQTT_H
#define KZ3_CAT1_MQTT_H

#include <stdint.h>

#include "cat1_config.h"

#define CAT1_MQTT_CLIENT_INDEX       1U
#define CAT1_MQTT_DOWNLINK_MAX_SIZE 1024U
#define CAT1_MQTT_PUBLISH_MAX_SIZE  1024U
#define CAT1_MQTT_RX_STREAM_SIZE    4096U
#define CAT1_MQTT_REGISTRATION_UNKNOWN 255U
#define CAT1_MQTT_SIGNAL_UNKNOWN       255U

typedef enum
{
    CAT1_MQTT_STATE_POWER_OFF = 0U,
    CAT1_MQTT_STATE_POWER_ON,
    CAT1_MQTT_STATE_AT,
    CAT1_MQTT_STATE_AT_RETRY_DELAY,
    CAT1_MQTT_STATE_ECHO_OFF,
    CAT1_MQTT_STATE_SIM_READY,
    CAT1_MQTT_STATE_ATTACH,
    CAT1_MQTT_STATE_REGISTER,
    CAT1_MQTT_STATE_PDP_CONFIG,
    CAT1_MQTT_STATE_PDP_ACTIVATE,
    CAT1_MQTT_STATE_PDP_VERIFY,
    CAT1_MQTT_STATE_MQTT_VERSION,
    CAT1_MQTT_STATE_MQTT_KEEPALIVE,
    CAT1_MQTT_STATE_MQTT_SESSION,
    CAT1_MQTT_STATE_MQTT_RECV_MODE,
    CAT1_MQTT_STATE_MQTT_OPEN,
    CAT1_MQTT_STATE_MQTT_CONNECT,
    CAT1_MQTT_STATE_MQTT_SUBSCRIBE,
    CAT1_MQTT_STATE_ONLINE,
    CAT1_MQTT_STATE_PUBLISH_PROMPT,
    CAT1_MQTT_STATE_PUBLISH_RESULT,
    CAT1_MQTT_STATE_MQTT_RETRY_DELAY,
    CAT1_MQTT_STATE_FULL_RETRY_DELAY,
    /** 追加在枚举末尾，避免改变既有状态诊断编号。 */
    CAT1_MQTT_STATE_SIGNAL,
    CAT1_MQTT_STATE_FUNCTIONAL,
    CAT1_MQTT_STATE_EPS_STATUS,
    CAT1_MQTT_STATE_OPERATOR_STATUS
} Cat1MqttState;

typedef enum
{
    CAT1_MQTT_ERROR_NONE = 0U,
    CAT1_MQTT_ERROR_ARGUMENT,
    CAT1_MQTT_ERROR_AT_TIMEOUT,
    CAT1_MQTT_ERROR_NETWORK,
    CAT1_MQTT_ERROR_OPEN,
    CAT1_MQTT_ERROR_CONNECT,
    CAT1_MQTT_ERROR_SUBSCRIBE,
    CAT1_MQTT_ERROR_PUBLISH,
    CAT1_MQTT_ERROR_RX_STREAM,
    CAT1_MQTT_ERROR_UART
} Cat1MqttError;

typedef enum
{
    CAT1_MQTT_PUBLISH_TELEMETRY = 1U,
    CAT1_MQTT_PUBLISH_ACK = 2U
} Cat1MqttPublishKind;

typedef struct
{
    Cat1MqttState state;
    Cat1MqttError last_error;
    uint8_t initialized;
    uint8_t online;
    uint8_t publish_pending;
    uint8_t publish_kind;
    uint8_t mqtt_soft_retry_count;
    /** 最近一次合法 +CREG/+CEREG 注册状态；255 表示尚未取得。 */
    uint8_t registration_status;
    /** +CSQ 原始 RSSI/BER；255 表示尚未取得，99 表示模组未知。 */
    uint8_t signal_rssi;
    uint8_t signal_ber;
    uint32_t retry_delay_ms;
    uint32_t reconnect_count;
    uint32_t full_recovery_count;
    uint32_t rx_drop_count;
    uint32_t publish_success_count;
    uint32_t last_completed_token;
} Cat1MqttStatus;

/** 下行处理在无线任务上下文同步执行，返回前必须复制所需数据。 */
typedef void (*Cat1MqttDownlinkHandler)(void *context, const uint8_t *payload,
                                       uint16_t length);

/** 使用已校验配置和由 SN 生成的 topic 初始化固定容量状态机。 */
uint8_t Cat1Mqtt_Init(const Cat1Config *config, const char *client_id,
                      const char *publish_topic, const char *subscribe_topic,
                      uint32_t now_ms);

/** 全部新字段验证后替换会话配置，保留已接管的 in-flight payload。 */
uint8_t Cat1Mqtt_Reconfigure(const Cat1Config *config, const char *client_id,
                             const char *publish_topic,
                             const char *subscribe_topic);

/** 执行一次无阻塞状态转移；时间由调用方显式传入。 */
void Cat1Mqtt_Step(uint32_t now_ms);

/** 输入任意分块的 UART 字节；error_flags 非零时丢弃残帧并恢复。 */
void Cat1Mqtt_OnRx(const uint8_t *data, uint16_t length,
                   uint32_t error_flags);

/** 请求执行完整 Cat.1 恢复并重新建立 MQTT 会话。 */
void Cat1Mqtt_RequestReconnect(void);

/** 固定单槽发布；未成功 URC 前不会覆盖 payload。 */
uint8_t Cat1Mqtt_QueuePublish(const uint8_t *payload, uint16_t length,
                              Cat1MqttPublishKind kind, uint32_t token);

void Cat1Mqtt_SetDownlinkHandler(Cat1MqttDownlinkHandler handler,
                                 void *context);
uint8_t Cat1Mqtt_GetStatus(Cat1MqttStatus *status);
const char *Cat1Mqtt_StateName(Cat1MqttState state);

#endif
