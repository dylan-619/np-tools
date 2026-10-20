#ifndef KZ3_NORTH_RESULT_H
#define KZ3_NORTH_RESULT_H

/**
 * @brief 北向变量服务与协议适配层共享的精确处理结果。
 *
 * 数值 0..7 属于已发布契约；新结果只允许追加，协议层必须逐项映射，不能先
 * 压缩成 bool 或板级错误后再猜测失败原因。
 */
typedef enum
{
    PLC_V2_NORTH_RESULT_OK = 0,
    PLC_V2_NORTH_RESULT_INVALID_ARGUMENT = 1,
    PLC_V2_NORTH_RESULT_NOT_FOUND = 2,
    PLC_V2_NORTH_RESULT_READ_ONLY = 3,
    PLC_V2_NORTH_RESULT_TYPE_MISMATCH = 4,
    PLC_V2_NORTH_RESULT_OUT_OF_RANGE = 5,
    PLC_V2_NORTH_RESULT_REJECTED = 6,
    PLC_V2_NORTH_RESULT_BUSY = 7,
    PLC_V2_NORTH_RESULT_REVISION_CONFLICT = 8,
    PLC_V2_NORTH_RESULT_PERSISTENCE_ERROR = 9
} PlcV2NorthResult;

#endif
