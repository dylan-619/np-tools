
#ifndef KZ3_USER_UART_H_
#define KZ3_USER_UART_H_
#include <stdbool.h>
#include <stdint.h>
#include "user_definitions.h"
#include "product_build_config.h"

#define UART1_RX_BUF_SIZE		768
#define UART2_RX_BUF_SIZE		4096
#if KZ3_CONTROL_ARCH == KZ3_CONTROL_ARCH_V2
/* V2 RTU 最大 Modbus 帧固定为 256 字节；超过边界的帧必须丢弃。 */
#define UART3_RX_BUF_SIZE		256
#define UART4_RX_BUF_SIZE		256
#else
#define UART3_RX_BUF_SIZE		512
#define UART4_RX_BUF_SIZE		512
#endif

#define UART_RX_TIMEOUT_MS		10

extern volatile uint8_t UART1_RxOkFlag;
extern volatile uint8_t UART1_RxFlag;
extern volatile uint16_t UART1_RxCnt;
extern volatile uint16_t UART1_RxOvtm;
extern volatile uint32_t UART1_RxErrorFlags;
extern volatile uint8_t UART1_RxOverflowFlag;
extern uint8_t UART1_RxBuf[UART1_RX_BUF_SIZE];

extern volatile uint8_t UART2_RxOkFlag;
extern volatile uint8_t UART2_RxFlag;
extern volatile uint16_t UART2_RxCnt;
extern volatile uint16_t UART2_RxOvtm;
/* USART2 一次空闲分块内观察到的硬件错误标志（USART_SR 的 PE/FE/NE/ORE）。 */
extern volatile uint32_t UART2_RxErrorFlags;
/* 4096B 满或尚未消费的 ready 块又到数据时置粘滞标志；
 * 仅由 WirelessPort 取块后清除。 */
extern volatile uint8_t UART2_RxOverflowFlag;
extern USER_CCMRAM_BSS uint8_t UART2_RxBuf[UART2_RX_BUF_SIZE];

extern volatile uint8_t UART3_RxOkFlag;
extern volatile uint16_t UART3_RxCnt;
extern volatile uint16_t UART3_RxOvtm;
extern volatile uint32_t UART3_RxDropCount;
extern USER_CCMRAM_BSS uint8_t UART3_RxBuf[UART3_RX_BUF_SIZE];

extern volatile uint8_t UART4_RxOkFlag;
extern volatile uint16_t UART4_RxCnt;
extern volatile uint16_t UART4_RxOvtm;
extern volatile uint32_t UART4_RxDropCount;
extern USER_CCMRAM_BSS uint8_t UART4_RxBuf[UART4_RX_BUF_SIZE];

void UserUartInit(void);

bool UART3_SendData(uint8_t * pData, uint16_t len);
bool UART4_SendData(uint8_t * pData, uint16_t len);


#endif
