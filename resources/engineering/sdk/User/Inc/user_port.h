#ifndef KZ3_USER_PORT_H_
#define KZ3_USER_PORT_H_

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "data_manager.h"

#define ADC_VALUE_SYNC_TIME				200

#define CJ431_VOLT						2.5f  		    //CJ431 voltage reference source
#define CUR_SAMP_RES					150.0f				//Current sampling resistor
#define BOARD_AI_MAX_ACCEPTED_MA        20.32f  /* 4~20 mA 满量程上限 +2% FS */

#define ADC_CHANNEL_NUM     			6
#define ADC_SAMPLE_NUM      			9

#define MCU_DI1							PBI(0)
#define MCU_DI2							PBI(1)
#define MCU_DI3							PBI(2)
#define MCU_DI4							PEI(7)
#define MCU_DI5							PEI(8)
#define MCU_DI6							PEI(9)
#define MCU_DI7							PEI(10)
#define MCU_DI8							PEI(11)
#define MCU_DI9							PEI(12)
#define MCU_DI10						PEI(13)
#define MCU_DI11						PEI(14)
#define MCU_DI12						PEI(15)

#define MCU_DO1							PDO(15)
#define MCU_DO2							PDO(14)
#define MCU_DO3							PDO(13)
#define MCU_DO4							PDO(12)
#define MCU_DO5							PDO(11)
#define MCU_DO6							PDO(10)
#define MCU_DO7							PDO(7)
#define MCU_DO8							PBO(4)

#define RLY_PWR							PCO(8)

#define TEMPINT_ADC_RANK        0
#define VREF_ADC_RANK           1
#define AI1_ADC_RANK           	2
#define AI2_ADC_RANK           	3
#define AI3_ADC_RANK           	4
#define AI4_ADC_RANK           	5

typedef struct
{
	uint8_t DOVal;
	uint8_t DO1;
	uint8_t DO2;
	uint8_t DO3;
	uint8_t DO4;
	uint8_t DO5;
	uint8_t DO6;
	uint8_t DO7;
	uint8_t DO8;

	uint16_t DIVal;
	uint8_t DI1;
	uint8_t DI2;
	uint8_t DI3;
	uint8_t DI4;
	uint8_t DI5;
	uint8_t DI6;
	uint8_t DI7;
	uint8_t DI8;
	uint8_t DI9;
	uint8_t DI10;
	uint8_t DI11;
	uint8_t DI12;

	//mA
	float AI1;
	float AI2;
	float AI3;
	float AI4;

	float Vref;
	float Vmcu;
	float TempMCU;

	//mA
	float AO1;
	float AO2;

} DeviceDataTypeDef;

typedef enum
{
    BOARD_PORT_OUTPUT_READY = 0,
    BOARD_PORT_OUTPUT_PENDING = 1,
    BOARD_PORT_OUTPUT_FAILED = 2
} BoardPortOutputResult;

typedef enum
{
    BOARD_PORT_ANALOG_INIT = 0,
    BOARD_PORT_ANALOG_GOOD = 1,
    BOARD_PORT_ANALOG_BAD = 2
} BoardPortAnalogStatus;

typedef struct
{
    float values[4];
    uint32_t sampled_at_ms;
    uint32_t sequence;
    uint32_t last_attempt_ms;
    uint32_t error_count;
    uint8_t channel_good_mask;
    BoardPortAnalogStatus acquisition_status;
    bool has_sample;
} BoardPortAnalogDiagnostics;

typedef struct
{
    float desired;
    float last_successful;
    uint32_t last_success_ms;
    uint32_t error_count;
    uint8_t last_error;
    bool apply_valid;
    bool activated;
    bool deferred;
} BoardPortOutputChannelDiagnostics;

/**
 * @brief 立即将板载 DO/AO 写为硬件安全目标。
 *
 * 仅供统一启动/故障编排器调用；业务逻辑不得直接调用或写 user_port.c 的
 * 私有物理适配器影子。
 */
BoardPortOutputResult UserPort_ApplySafeOutputs(void);

/**
 * @brief 异常上下文中直接拉低已确认低电平安全的八路 DO。
 *
 * 不修改极性未冻结的 RLY_PWR，不尝试 AO/RTU 通信，不调用 HAL 或 RTOS。
 */
void BoardPort_EnterEmergencySafe(void);

/* M1 Southbound 的板载桥接：仅 Southbound 调用，项目逻辑和网络不得直接调用。 */
/** 由既有维护任务执行低频 ADC 批采样；不得从 10 ms 控制任务调用。 */
void UserPort_UpdateM1AnalogInputs(uint32_t now_ms);
bool UserPort_SampleM1Inputs(DataManager *data_manager, uint32_t now_ms);
/** 只提交本次板载输出目标；DAC 物理写统一由 ServiceOutputRetry 执行。 */
bool UserPort_ApplyM1Outputs(const LogicContext *context);
BoardPortOutputResult UserPort_ApplyM1SafeOutputs(void);

/**
 * @brief 每个已激活 AO 最多执行一次到期写入或刷新。
 *
 * 仅由南向控制 owner 调用。FAILED 表示存在尚未恢复的本地 DAC 写失败，
 * PENDING 表示严格激活或新目标仍待写，READY 只证明本地总线写成功。
 */
BoardPortOutputResult BoardPort_ServiceOutputRetry(uint32_t now_ms);
bool BoardPort_CopyAnalogDiagnostics(BoardPortAnalogDiagnostics *diagnostics);
bool BoardPort_CopyOutputDiagnostics(
    BoardPortOutputChannelDiagnostics diagnostics[2]);

#if defined(KZ3_USER_PORT_UNIT_TEST)
/** 清空静态采样/输出状态，只供同进程主机边界测试。 */
void BoardPort_ResetForTest(void);
#endif

#endif
