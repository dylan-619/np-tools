#ifndef KZ3_SLE_TELEMETRY_H
#define KZ3_SLE_TELEMETRY_H

#include <stdint.h>

struct PlcV2NorthVariableService;

/**
 * @brief 从 start_index 起构造一个不超过 capacity 的完整 JSON 遥测分包。
 * @return JSON 字节数；失败返回 0。next_index 返回下一包起始字段，等于 field_count 表示完成。
 */
uint16_t SleTelemetry_BuildConfiguredJsonPacket(
    char *out, uint16_t capacity,
    const struct PlcV2NorthVariableService *service, uint16_t start_index,
    uint16_t *next_index);

#endif
