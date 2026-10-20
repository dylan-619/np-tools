#ifndef KZ3_TESTS_EEPROM_TRANSPORT_FAKE_H
#define KZ3_TESTS_EEPROM_TRANSPORT_FAKE_H

#include <stdint.h>

typedef void (*EepromTransportFakeWriteHook)(void *context);

/** 将主机测试 EEPROM 恢复为全 0xFF 的未写入状态。 */
void EepromTransportFake_Reset(void);
void EepromTransportFake_FailNextWrite(void);
uint32_t EepromTransportFake_GetWriteCount(void);
/** 在下一次物理写入中、写 EEPROM 字节前执行一次，用于确定性交错测试。 */
void EepromTransportFake_SetNextWriteHook(EepromTransportFakeWriteHook hook,
                                          void *context);

#endif
