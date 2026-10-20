#ifndef KZ3_USER_DEFINITIONS_H_
#define KZ3_USER_DEFINITIONS_H_

#if defined(KZ3_HOST_TEST)
/* 主机单元测试只验证纯配置规则，不依赖 STM32 寄存器和段属性。 */
#ifndef __IO
#define __IO volatile
#endif
#ifndef __I
#define __I volatile const
#endif
#define USER_CCMRAM_DATA
#define USER_CCMRAM_BSS
#else
#include "stm32f4xx.h"

/* CCMRAM 由正式 linker script 区分初始化数据和零初始化数据。 */
#define USER_CCMRAM_DATA	__attribute__((section(".ccmram_data")))
#define USER_CCMRAM_BSS		__attribute__((section(".ccmram_bss")))
#endif
#include "string.h"
#include "math.h"
#include "stdio.h"
#include <stdlib.h>
#include <stdint.h>


// 数据类型代码定义
#define TYPE_BOOL    1
#define TYPE_INT8    2
#define TYPE_UINT8   3
#define TYPE_INT16   4
#define TYPE_UINT16  5
#define TYPE_INT32   6
#define TYPE_UINT32  7
#define TYPE_FLOAT   9

#define TYPE_BUF	 16

// 宏定义版本（无函数调用开销）
#define SWAP16_ARRAY(data) do { \
    uint8_t temp = (data).bytes[0]; \
    (data).bytes[0] = (data).bytes[1]; \
    (data).bytes[1] = temp; \
} while(0)

#define SWAP32_ARRAY(data) do { \
    uint8_t temp = (data).bytes[0]; \
    (data).bytes[0] = (data).bytes[3]; \
    (data).bytes[3] = temp; \
    temp = (data).bytes[1]; \
    (data).bytes[1] = (data).bytes[2]; \
    (data).bytes[2] = temp; \
} while(0)

#define SWAP64_ARRAY(data) do { \
    uint8_t temp; \
    temp = (data).bytes[0]; (data).bytes[0] = (data).bytes[7]; (data).bytes[7] = temp; \
    temp = (data).bytes[1]; (data).bytes[1] = (data).bytes[6]; (data).bytes[6] = temp; \
    temp = (data).bytes[2]; (data).bytes[2] = (data).bytes[5]; (data).bytes[5] = temp; \
    temp = (data).bytes[3]; (data).bytes[3] = (data).bytes[4]; (data).bytes[4] = temp; \
} while(0)

//定义一些常用的数据类型短关键字 
typedef int32_t  s32;
typedef int16_t s16;
typedef int8_t  s8;

typedef const int32_t sc32;  
typedef const int16_t sc16;  
typedef const int8_t sc8;  

typedef __IO int32_t  vs32;
typedef __IO int16_t  vs16;
typedef __IO int8_t   vs8;

typedef __I int32_t vsc32;  
typedef __I int16_t vsc16; 
typedef __I int8_t vsc8;   

typedef uint32_t  u32;
typedef uint16_t u16;
typedef uint8_t  u8;

typedef const uint32_t uc32;  
typedef const uint16_t uc16;  
typedef const uint8_t uc8; 

typedef __IO uint32_t  vu32;
typedef __IO uint16_t vu16;
typedef __IO uint8_t  vu8;

typedef __I uint32_t vuc32;  
typedef __I uint16_t vuc16; 
typedef __I uint8_t vuc8; 

typedef union
{
	uint16_t value;
	uint8_t c[2];
}word;

typedef union
{
	uint32_t value;
	uint8_t c[4];
}dword;

typedef union
{
	float value;
	uint8_t c[4];
}fword;

#define bool	_Bool
#define false	0
#define true	1


#endif
