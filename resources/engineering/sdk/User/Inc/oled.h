#ifndef KZ3_OLED_H
#define KZ3_OLED_H

#include <stdint.h>

void OLED_Init(void);
void OLED_Clear(void);
void OLED_Refresh(void);
void OLED_ShowString(uint8_t x, uint8_t y, const char *text,
                     uint8_t font_size, uint8_t mode);

#endif
