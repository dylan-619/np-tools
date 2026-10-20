#ifndef INC_SLE_PORT_H_
#define INC_SLE_PORT_H_

#include <stdint.h>
#include "sle_protocol.h"

/*
 * SLE 模组单次 UART 物理帧上限，包含 `AA + remote_addr(BE) + 55` 四字节
 * 路由头。遥测组包必须先扣除此头部，再按剩余空间装入完整 JSON KV。
 */
#define SLE_PORT_FRAME_MAX_LEN 730U
#define SLE_PORT_RX_CHUNK_MAX_LEN 4096U

/** 清理当前 SLE 会话收发影子；USART2 模式由 WirelessPort 统一管理。 */
void SlePort_Init(void);

/** 将一帧数据排入 USART2 发送槽；忙或长度非法时返回非零。 */
uint8_t SlePort_QueueTx(const uint8_t *data, uint16_t len);

/** 在 SLE 任务上下文中发送一帧排队数据。 */
void SlePort_ServiceTx(void);

/** 从现有 UART2 接收缓冲提取一次空闲分块；无数据时返回非零。 */
uint8_t SlePort_TakeFrame(uint8_t *dst, uint16_t capacity, uint16_t *frame_len);

/** @brief 取得最近一次取出的 UART2 空闲分块的硬件错误标志。 */
uint32_t SlePort_GetLastRxErrorFlags(void);

#endif
