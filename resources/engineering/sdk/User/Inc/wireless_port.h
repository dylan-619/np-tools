#ifndef KZ3_WIRELESS_PORT_H
#define KZ3_WIRELESS_PORT_H

#include <stdint.h>

#include "wireless_config.h"

#define WIRELESS_PORT_RX_CHUNK_MAX_LEN 4096U
#define WIRELESS_PORT_TX_MAX_LEN       1100U
#define WIRELESS_PORT_PARSER_WORKSPACE_SIZE 4096U
#define WIRELESS_PORT_RX_ERROR_OVERFLOW (1UL << 31U)

/** 按活动承载配置 USART2 为 8N1；SLE=230400，Cat.1=115200。 */
uint8_t WirelessPort_Configure(WirelessMode mode);

/** 禁用 USART2 中断并释放外设；未知模式和配置错误必须走该路径。 */
void WirelessPort_Disable(void);

/**
 * 控制兼容无线插座的模组供电/使能线 ZB_RST/PE0。
 * 只能在无线任务上下文调用；0=拉低关闭，非 0=拉高开启。
 */
void WirelessPort_SetModulePower(uint8_t powered);

/** 清当前承载的 RX/TX 会话数据，不改变 UART 模式。 */
void WirelessPort_ResetSession(void);

/** 固定单槽发送；数据被复制，忙、未配置或超长时返回非零。 */
uint8_t WirelessPort_QueueTx(const uint8_t *data, uint16_t length);

/**
 * 在唯一无线任务中服务一次有界阻塞发送。
 * SLE 两次发送尝试之间，从上次返回起至少留出 100ms；等待期间立即返回，
 * 保留发送槽并允许继续收包。含 AT/ACK，失败重试同样限速；Cat.1 不施加此空隙。
 */
void WirelessPort_ServiceTx(void);

/**
 * 取出一次 UART 空闲分块或粘滞错误事件。返回 0 后调用方必须
 * 读取错误标志；纯错误事件的 length 为 0，不得解析 output。
 */
uint8_t WirelessPort_TakeRx(uint8_t *output, uint16_t capacity,
                            uint16_t *length);

uint32_t WirelessPort_GetLastRxErrorFlags(void);

/**
 * 返回活动承载独占的解析工作区。SLE/Cat.1 只可在启动分支确定后使用，
 * 从而不在静态 RAM 中叠加两套 4KB 流缓冲。
 */
uint8_t *WirelessPort_GetParserWorkspace(uint16_t *capacity);

#endif
