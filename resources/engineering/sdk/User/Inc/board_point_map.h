#ifndef KZ3_BOARD_POINT_MAP_H
#define KZ3_BOARD_POINT_MAP_H

#include <stdint.h>

#define BOARD_POINT_SYSTEM_START             0U
#define BOARD_POINT_SYSTEM_END               99U
#define BOARD_POINT_BOARD_START             100U
#define BOARD_POINT_BOARD_END               199U
#define BOARD_POINT_MAX_WRITE_VALUES        123U
#define BOARD_POINT_TABLE_VERSION             1U

typedef enum
{
    BOARD_POINT_AREA_COILS = 0,
    BOARD_POINT_AREA_DISCRETE_INPUTS,
    BOARD_POINT_AREA_INPUT_REGISTERS,
    BOARD_POINT_AREA_HOLDING_REGISTERS
} BoardPointArea;

typedef enum
{
    BOARD_POINT_RESULT_OK = 0,
    BOARD_POINT_RESULT_ILLEGAL_ADDRESS,
    BOARD_POINT_RESULT_ILLEGAL_VALUE,
    BOARD_POINT_RESULT_READ_ONLY,
    BOARD_POINT_RESULT_CONTROL_UNAVAILABLE,
    BOARD_POINT_RESULT_INTERNAL
} BoardPointResult;

typedef struct
{
    uint16_t di_bitmap;
    uint16_t do_target_bitmap;
    uint16_t ai_ua[4];
    uint16_t mcu_voltage_mv;
    int16_t mcu_temperature_centi_c;
    uint16_t ao_ua[2];
    uint16_t device_status;
    uint16_t network_status;
    uint16_t io_quality;
    uint16_t output_faults;
    uint16_t command_revision;
    uint16_t applied_revision;
    uint32_t uptime_seconds;
    uint32_t total_runtime_seconds;
    uint8_t ethernet_link;
    uint8_t http_listener;
    uint8_t modbus_listener;
    uint8_t network_config_valid;
    uint8_t remote_write_allowed;
} BoardIoSnapshot;

typedef struct
{
    BoardPointArea area;
    uint16_t address;
    uint16_t quantity;
    uint16_t values[BOARD_POINT_MAX_WRITE_VALUES];
} BoardPointWriteRequest;

/** @brief 初始化不允许远程写入的安全快照。 */
void BoardPointSnapshot_SetDefaults(BoardIoSnapshot *snapshot);

/**
 * @brief 根据 PDU 零基地址读取一个连续点位区间。
 * @param snapshot 板级一致性快照。
 * @param area Modbus 四区。
 * @param address PDU 零基起始地址。
 * @param quantity 点位数量。
 * @param output 输出的 Modbus 大端/位打包数据。
 * @param output_capacity 输出缓冲容量。
 * @param output_length 实际输出字节数。
 * @return 点位映射结果。
 */
BoardPointResult BoardPointMap_Read(const BoardIoSnapshot *snapshot,
                                    BoardPointArea area,
                                    uint16_t address,
                                    uint16_t quantity,
                                    uint8_t *output,
                                    uint16_t output_capacity,
                                    uint16_t *output_length);

#endif
