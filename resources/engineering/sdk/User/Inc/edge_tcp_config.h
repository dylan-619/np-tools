#ifndef KZ3_EDGE_TCP_CONFIG_H
#define KZ3_EDGE_TCP_CONFIG_H

#include <stdint.h>

#define EDGE_TCP_CONFIG_RECORD_SIZE 16U
#define EDGE_TCP_CONFIG_VERSION      1U

/**
 * @brief Edge TCP 有线连接配置。
 *
 * server_port 单位为 TCP 端口号。valid 只表示本次加载得到了
 * 完整有效记录，不是持久化字段。
 */
typedef struct
{
    uint8_t server_ip[4];
    uint16_t server_port;
    uint8_t enabled;
    uint8_t valid;
} EdgeTcpConfig;

/** 生成禁用的 RAM 安全默认值，不访问 EEPROM。 */
void EdgeTcpConfig_SetDefaults(EdgeTcpConfig *config);

/** 校验一组可保存的 IP、端口和开关；valid 不参与校验。 */
uint8_t EdgeTcpConfig_Validate(const EdgeTcpConfig *config);

/**
 * @brief 从 EEPROM 384..399 读取带 magic/version/CRC 的单页记录。
 * @return 0 表示成功；非 0 时不修改 config。
 */
uint8_t EdgeTcpConfig_Load(EdgeTcpConfig *config);

/**
 * @brief 单次写入完整配置页，并重新加载比对业务字段。
 * @return 0 表示保存和回读均成功；非 0 时由维护端重试。
 *
 * 调用上下文必须为任务，不得在 ISR 中调用。保存不改变已启动的
 * Edge 运行快照，新配置在重启后生效。
 */
uint8_t EdgeTcpConfig_Save(const EdgeTcpConfig *config);

#endif
