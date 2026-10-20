#ifndef KZ3_CONTROL_TIMING_H
#define KZ3_CONTROL_TIMING_H

#include <stdbool.h>
#include <stdint.h>

/** @brief 处理 DWT 32 位周期计数器自然回绕。 */
static inline uint32_t ControlTiming_CycleDelta(uint32_t start_cycles,
                                                 uint32_t end_cycles)
{
    return end_cycles - start_cycles;
}

/** @brief 将周期数换算为微秒；时钟未就绪时返回 0，避免诊断路径除零。 */
static inline uint32_t ControlTiming_CyclesToUs(uint32_t cycles,
                                                uint32_t core_clock_hz)
{
    uint32_t cycles_per_us = core_clock_hz / 1000000U;

    return cycles_per_us == 0U ? 0U : cycles / cycles_per_us;
}

/**
 * @brief 判断本拍能否发布看门狗健康令牌。
 *
 * RUNNING 允许协议声明期限内仍在推进的异步输出；STOPPED 只有安全输出
 * 已确认送达才健康。FAULT_SAFE 或任何活动故障都不发布令牌。
 */
static inline bool ControlTiming_CanAdvanceHealth(
    bool sample_ok, bool logic_ok, bool snapshot_ok, bool output_failed,
    bool active_fault, bool running, bool stopped, bool safe_output_ready)
{
    return sample_ok && logic_ok && snapshot_ok && !output_failed &&
           !active_fault && (running || (stopped && safe_output_ready));
}

/** 启动门禁每拍已检查期限且仍在等待时，允许安全输出重试推进看门狗。
 * 超时/失败由门禁转 FAULT_SAFE，不能借此绕过正常 STOPPED 的确认要求。 */
static inline bool ControlTiming_CanAdvanceStartupHealth(
    bool sample_ok, bool logic_ok, bool snapshot_ok, bool output_failed,
    bool active_fault, bool startup_waiting)
{
    return sample_ok && logic_ok && snapshot_ok && !output_failed &&
        !active_fault && startup_waiting;
}

#endif
