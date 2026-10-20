#ifndef KZ3_USER_RTC_H
#define KZ3_USER_RTC_H

#include <stdint.h>

extern uint32_t RTC_MsTick;
extern uint32_t RTC_SecTick;

void RTC_TickFsm(void);

#endif
