#ifndef KZ3_LOGIC_BLOCK_API_H
#define KZ3_LOGIC_BLOCK_API_H

#include <stdbool.h>
#include <stdint.h>

#include "point_config.h"

/**
 * 项目侧 PID 输入；单位由对应业务点和项目参数共同定义。
 *
 * 每个 PID ID 独立接收本结构，因此同一控制器内各回路可以分别启停、
 * 手自动切换、跟踪外部执行值和保持积分。tracking_mode 用于执行器尚未
 * 获得控制权、下游限幅/斜坡或主备切换时对齐内部状态；它不替代设备联锁。
 */
typedef struct
{
    float measurement;
    PointConfigQuality measurement_quality;
    float setpoint;
    bool enabled;
    bool manual_mode;
    float manual_output;
    bool tracking_mode;
    float tracking_output;
    bool integral_hold;
    /* 运行时 PI 增益。false 沿用生成配置；true 由项目参数提供有限非负值。
     * 修改运行中增益前，项目须撤自动请求并重新使能，避免输出突变。 */
    bool use_runtime_gains;
    float runtime_kp;
    float runtime_ki;
} LogicPidInput;

/**
 * 项目侧 PID 扫描结果；output 仍需由项目显式写入业务输出。
 * P/I/D 与 unclamped_output 保持最近一次有效计算或跟踪结果，便于低频北向
 * 轮询诊断；updated=false 时表示本扫描只保持了已有结果。调用失败时 status
 * 若非 NULL 会被确定性清零，PID 实例保持调用前状态。
 */
typedef struct
{
    float output;
    float error;
    float p_term;
    float i_term;
    float d_term;
    float unclamped_output;
    bool running;
    bool updated;
    bool saturated;
    bool saturated_high;
    bool saturated_low;
    bool tracking;
    bool integral_held;
    PointConfigQuality input_quality;
} LogicPidStatus;

/* 兼容既有平台测试和历史项目源码；新项目使用 LogicPidInput/Status。 */
typedef LogicPidInput M1LogicPidInput;
typedef LogicPidStatus M1LogicPidStatus;

/* 底层稳定符号。项目代码通过 application/logic.h 中的短名称调用。
 * 有 context 的有状态功能块仅允许在当前控制 owner 的 Logic_Scan 内调用，
 * context 必须是本拍 working 映像；每个实例每拍只推进一次，禁止 ISR 调用。
 * 时间参数单位均为 ms，且不得超过 INT32_MAX。正常业务结果 false 不是故障；
 * context/阶段/实例/参数/数值错误会锁存本拍 API 故障并阻止普通输出提交。 */
bool LogicBlock_Ton(LogicContext *context, PointConfigTimerId id, bool input,
                    uint32_t preset_ms);
bool LogicBlock_Tof(LogicContext *context, PointConfigTimerId id, bool input,
                    uint32_t preset_ms);
bool LogicBlock_Tp(LogicContext *context, PointConfigTimerId id, bool input,
                   uint32_t preset_ms);
bool LogicBlock_RisingEdge(LogicContext *context, PointConfigEdgeId id,
                           bool input);
bool LogicBlock_FallingEdge(LogicContext *context, PointConfigEdgeId id,
                            bool input);
uint32_t LogicBlock_CounterUp(LogicContext *context, PointConfigCounterId id,
                              bool count, bool reset, uint32_t preset);
uint32_t LogicBlock_CounterDown(LogicContext *context, PointConfigCounterId id,
                                bool count, bool load, uint32_t preset);
bool LogicBlock_Sr(LogicContext *context, PointConfigLatchId id, bool set,
                   bool reset);
bool LogicBlock_Rs(LogicContext *context, PointConfigLatchId id, bool set,
                   bool reset);
bool LogicBlock_Debounce(LogicContext *context, PointConfigDebounceId id,
                         bool input, uint32_t stable_ms);
/** 项目主动请求控制器级故障；reason 取 1..32767，只锁存、不直接操作 I/O。 */
bool Logic_RequestFault(LogicContext *context, uint16_t reason);
/**
 * 返回持久参数是否满足项目启动策略。仅复制运行时状态，不访问 EEPROM；
 * 合法返回 false 表示业务许可未满足，不会锁存 API 故障。
 */
bool Logic_ParametersReady(const LogicContext *context);
/* checked 数学函数失败时不修改 output；可脱离项目回调用于纯逻辑测试。 */
bool LogicBlock_ClampChecked(float value, float minimum, float maximum,
                             float *output);
float LogicBlock_Clamp(float value, float minimum, float maximum);
bool LogicBlock_Scale(float input, float input_min, float input_max,
                      float output_min, float output_max, float *output);
bool LogicBlock_HysteresisChecked(float value, float low, float high,
                                  bool previous, bool *output);
bool LogicBlock_Hysteresis(float value, float low, float high, bool previous);
bool LogicBlock_DeadbandChecked(float value, float reference, float width,
                                bool *output);
bool LogicBlock_Deadband(float value, float reference, float width);
bool LogicBlock_Filter(LogicContext *context, PointConfigFilterId id,
                       float input, uint32_t time_constant_ms, float *output);
bool LogicBlock_RateLimit(LogicContext *context, PointConfigRateLimitId id,
                          float input, float rise_per_second,
                          float fall_per_second, float *output);
bool LogicBlock_PidStep(LogicContext *context, PointConfigPidId id,
                        const LogicPidInput *input, LogicPidStatus *status);
/* Init/Scan/Stop 均允许；Scan 中须位于同 ID 的 PidStep 之前，重复 reset 幂等。 */
void LogicBlock_PidReset(PointConfigPidId id);
/**
 * 将 RTU U16 AO 的 PID float 输出按 PID 限幅和 raw 范围校验并四舍五入。
 * 仅允许项目回调阶段调用；失败不修改 raw_output。
 */
bool LogicBlock_PidOutputToU16(PointConfigPidId id, float output,
                               uint16_t *raw_output);
#endif
