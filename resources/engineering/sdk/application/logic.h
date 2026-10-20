#ifndef KZ3_APPLICATION_LOGIC_H
#define KZ3_APPLICATION_LOGIC_H

#include <stdbool.h>

#include "logic_block_api.h"

/*
 * 项目逻辑只使用以下短名称；底层 LogicBlock_* 符号保留给平台实现和旧代码。
 * TON/TOF/TP、R_TRIG/F_TRIG、CTU/CTD、SR/RS 与 IEC 61131-3 常用命名对齐。
 */
#define TON LogicBlock_Ton
#define TOF LogicBlock_Tof
#define TP LogicBlock_Tp
#define R_TRIG LogicBlock_RisingEdge
#define F_TRIG LogicBlock_FallingEdge
#define CTU LogicBlock_CounterUp
#define CTD LogicBlock_CounterDown
#define SR LogicBlock_Sr
#define RS LogicBlock_Rs
#define DEBOUNCE LogicBlock_Debounce
#define REQUEST_FAULT Logic_RequestFault
#define PARAMETERS_READY Logic_ParametersReady
#define CLAMP LogicBlock_Clamp
#define CLAMP_CHECKED LogicBlock_ClampChecked
#define SCALE LogicBlock_Scale
#define HYSTERESIS LogicBlock_Hysteresis
#define HYSTERESIS_CHECKED LogicBlock_HysteresisChecked
#define DEADBAND LogicBlock_Deadband
#define DEADBAND_CHECKED LogicBlock_DeadbandChecked
#define FILTER LogicBlock_Filter
#define RATE_LIMIT LogicBlock_RateLimit
#define PID_STEP LogicBlock_PidStep
#define PID_RESET LogicBlock_PidReset
#define PID_TO_U16 LogicBlock_PidOutputToU16
bool Logic_Init(LogicContext *context);
bool Logic_Scan(LogicContext *context);
void Logic_Stop(LogicContext *context);

#endif
