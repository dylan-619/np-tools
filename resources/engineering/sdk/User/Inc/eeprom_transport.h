#ifndef KZ3_EEPROM_TRANSPORT_H
#define KZ3_EEPROM_TRANSPORT_H

#include <stdint.h>

/** AT24C16 的物理容量与页大小；业务 owner 必须自行限定所属地址范围。 */
#define EEPROM_TRANSPORT_TOTAL_SIZE 2048U
#define EEPROM_TRANSPORT_PAGE_SIZE  16U

/**
 * @brief 从 AT24C16 读取一段已由调用方完成 owner 校验的数据。
 * @param buffer 输出缓冲。
 * @param address EEPROM 起始字节地址。
 * @param length 读取长度，必须不越过 AT24C16 物理范围。
 * @return 0 表示成功，非 0 表示参数、I2C 或互斥访问失败。
 *
 * 本模块只提供串行化的物理传输，不分配业务地址；各业务 owner
 * 必须在上层固定并校验自己的地址边界。
 */
uint8_t EepromTransport_Read(uint8_t *buffer, uint16_t address,
                             uint16_t length);

/**
 * @brief 写入 AT24C16 并逐页回读比对。
 * @param buffer 待写数据；调用期间不会修改该缓冲。
 * @param address EEPROM 起始字节地址。
 * @param length 写入长度，必须不越过 AT24C16 物理范围。
 * @return 0 表示写入和回读一致，非 0 表示本次提交失败。
 *
 * 调用上下文必须是任务而非 ISR。函数在同一 EEPROM 互斥区内完成分页写、
 * 器件写周期等待和回读校验，避免不同 owner 的 I2C 事务交叉。
 */
uint8_t EepromTransport_WriteAndVerify(const uint8_t *buffer,
                                       uint16_t address, uint16_t length);

#endif
