# T01 单泵监督器使用契约

适用于单台泵、风机、搅拌机或单方向电机。模板处理 one-shot 启停/复位、安全许可、设备故障、
启动反馈、运行反馈丢失和停机反馈粘连；不处理主备调度、变频给定、就地控制器内部逻辑或硬件安全回路。

## 项目必须提供

- `start/stop/reset` 三个 one-shot command；同扫描停止优先；
- 安全总许可、设备故障、真实运行反馈以及三个输入各自的质量；
- 启动、运行反馈丢失、停机反馈三个非零超时；
- `SinglePumpState` 对应的项目 state 字段；禁止保存在文件级 `static`；
- 唯一的最终物理输出 owner，安全值必须为项目已确认值。

## 固定行为

- 上电不启动；`reset` 不启动；故障恢复不自动启动；
- 输入质量、安全许可或设备故障异常时，当扫描撤销输出并锁存；
- 停机后真实反馈未断开时保持 `STOPPING`，超时报告粘连；
- STARTING/RUNNING 只有在本地安全条件持续成立时才形成输出；
- 所有时间使用无符号差值，支持 `uint32_t` 回绕。

项目可改变超时值，但不能移除上述行为。若现场明确允许自动恢复，不能偷偷修改模板；应建立新的、
经过风险评审和独立认证的策略模板。

## `Logic_Scan` 薄适配形状

YAML 需声明 `phase/requested_on/fault_latched/rearm_required/feedback_missing/phase_started_ms/
feedback_missing_since_ms/blocked_reason` 等标量 state。扫描中把标量装入模板结构，调用一次，再写回：

```c
#include "case_center/standard_templates/single_pump_control.h"

SinglePumpState pump = {
    .phase = (SinglePumpPhase)context->state.pump_phase,
    .requested_on = context->state.pump_requested_on,
    .fault_latched = context->state.pump_fault_latched,
    .rearm_required = context->state.pump_rearm_required,
    .feedback_missing = context->state.pump_feedback_missing,
    .phase_started_ms = context->state.pump_phase_started_ms,
    .feedback_missing_since_ms =
        context->state.pump_feedback_missing_since_ms,
    .blocked_reason =
        (SinglePumpBlockedReason)context->state.pump_blocked_reason,
};
SinglePumpInput input = {
    .start_command = context->command.pump_start,
    .stop_command = context->command.pump_stop,
    .reset_command = context->command.pump_reset,
    .safety_permit = safety->value,
    .safety_quality_good = safety->quality == POINT_CONFIG_QUALITY_GOOD,
    .device_fault = fault->value,
    .device_fault_quality_good = fault->quality == POINT_CONFIG_QUALITY_GOOD,
    .run_feedback = feedback->value,
    .run_feedback_quality_good =
        feedback->quality == POINT_CONFIG_QUALITY_GOOD,
    .now_ms = context->now_ms,
};

if (!SinglePump_Evaluate(&pump, &input, &policy))
{
    return false;
}
/* 写回全部模板状态；物理输出只在扫描结尾赋值一次。 */
IO_OUT(context, pump_start_output) = pump.output_on;
```

不要只复制片段中的一部分状态。字段漏写回会让下一扫描丢失模板状态，应由项目测试覆盖。
