#ifndef KZ3_PRODUCT_BUILD_CONFIG_H
#define KZ3_PRODUCT_BUILD_CONFIG_H

#define KZ3_CONTROL_ARCH_V2 2U
#define KZ3_NORTH_OWNER_V2 2U

#ifndef KZ3_CONTROL_ARCH
#define KZ3_CONTROL_ARCH KZ3_CONTROL_ARCH_V2
#endif
#ifndef KZ3_NORTH_OWNER
#define KZ3_NORTH_OWNER KZ3_NORTH_OWNER_V2
#endif
#ifndef KZ3_HTTP_MAX_CLIENTS
#define KZ3_HTTP_MAX_CLIENTS 2U
#endif
#ifndef KZ3_MODBUS_TCP_MAX_CLIENTS
#define KZ3_MODBUS_TCP_MAX_CLIENTS 2U
#endif

/* USART1 是现场配置协议端口，默认不混入周期资源日志。长稳采集必须由
 * 特定构建显式启用，避免 RES_* 文本破坏上位机的命令/响应边界。 */
#ifndef KZ3_UART1_RESOURCE_LOG_ENABLED
#define KZ3_UART1_RESOURCE_LOG_ENABLED 0U
#endif

/* 当前固件生成的 RTU 最大帧预算为 256 字节；快照原始 bank 不再为未知项目
 * 预留 4 KiB。若后续项目生成更大的 PollBlock，必须显式提高该构建值并重新
 * 通过 RAM/帧长门禁，不能在运行时动态扩容。 */
#ifndef KZ3_MODBUS_SNAPSHOT_RAW_BYTES
#define KZ3_MODBUS_SNAPSHOT_RAW_BYTES 256U
#endif

#if KZ3_CONTROL_ARCH != KZ3_CONTROL_ARCH_V2
#error "当前固件仅支持 V2 控制架构"
#endif
#if KZ3_NORTH_OWNER != KZ3_NORTH_OWNER_V2
#error "当前固件仅支持 V2 北向 owner"
#endif
#if KZ3_HTTP_MAX_CLIENTS != 1U && KZ3_HTTP_MAX_CLIENTS != 2U
#error "KZ3_HTTP_MAX_CLIENTS 必须为 1 或 2"
#endif
#if KZ3_MODBUS_TCP_MAX_CLIENTS != 1U && KZ3_MODBUS_TCP_MAX_CLIENTS != 2U
#error "KZ3_MODBUS_TCP_MAX_CLIENTS 必须为 1 或 2"
#endif
#if KZ3_UART1_RESOURCE_LOG_ENABLED != 0U && KZ3_UART1_RESOURCE_LOG_ENABLED != 1U
#error "KZ3_UART1_RESOURCE_LOG_ENABLED 必须为 0 或 1"
#endif
#if KZ3_MODBUS_SNAPSHOT_RAW_BYTES == 0U || KZ3_MODBUS_SNAPSHOT_RAW_BYTES > 4096U
#error "KZ3_MODBUS_SNAPSHOT_RAW_BYTES 必须在 1..4096 范围内"
#endif

#endif
