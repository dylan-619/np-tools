#ifndef KZ3_MODBUS_TCP_PROTOCOL_H
#define KZ3_MODBUS_TCP_PROTOCOL_H

#include <stdint.h>

#include "board_point_map.h"
#include "north_result.h"

#define MODBUS_TCP_MAX_ADU_SIZE 260U

typedef enum
{
    MODBUS_TCP_RESULT_OK = 0,
    MODBUS_TCP_RESULT_NO_RESPONSE,
    MODBUS_TCP_RESULT_INCOMPLETE,
    MODBUS_TCP_RESULT_INVALID_FRAME
} ModbusTcpResult;

typedef enum
{
    MODBUS_TCP_FRAME_INVALID = 0,
    MODBUS_TCP_FRAME_INCOMPLETE,
    MODBUS_TCP_FRAME_COMPLETE
} ModbusTcpFrameResult;

typedef struct
{
    void *context;
    /** 精确结果回调优先于历史板级回调，供统一北向服务保留失败语义。 */
    PlcV2NorthResult (*read_result)(void *context,
                                    BoardPointArea area,
                                    uint16_t address,
                                    uint16_t quantity,
                                    uint8_t *output,
                                    uint16_t output_capacity,
                                    uint16_t *output_length);
    PlcV2NorthResult (*write_result)(
        void *context, const BoardPointWriteRequest *request);
    BoardPointResult (*read)(void *context,
                             BoardPointArea area,
                             uint16_t address,
                             uint16_t quantity,
                             uint8_t *output,
                             uint16_t output_capacity,
                             uint16_t *output_length);
    BoardPointResult (*write)(void *context,
                              const BoardPointWriteRequest *request);
} ModbusPointAccess;

/**
 * @brief 根据 MBAP 长度判断固定接收缓冲是否已有完整 ADU。
 * @return 无效、等待更多数据或完整帧。
 */
ModbusTcpFrameResult ModbusTcp_GetFrameLength(const uint8_t *input,
                                              uint16_t input_length,
                                              uint16_t *frame_length);

/**
 * @brief 处理一个完整 Modbus TCP ADU 并生成响应。
 * @param unit_id 当前服务 Unit ID；请求不匹配时不响应。
 * @param access 板载点位访问回调。
 * @param output 输出 ADU。
 * @param output_capacity 输出容量，至少可容纳 260 字节以内响应。
 * @param output_length 实际响应长度；无响应时为 0。
 * @return 协议处理状态。
 */
ModbusTcpResult ModbusTcp_ProcessAdu(const uint8_t *input,
                                     uint16_t input_length,
                                     uint8_t unit_id,
                                     const ModbusPointAccess *access,
                                     uint8_t *output,
                                     uint16_t output_capacity,
                                     uint16_t *output_length);

#endif
