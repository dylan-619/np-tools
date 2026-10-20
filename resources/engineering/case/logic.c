#include "logic.h"
#include <stddef.h>

/* 此案例只对控制输出负责，没有真实电机运行反馈；时间使用扫描单调毫秒。 */
static void PublishOutputs(LogicContext *context)
{
    IO_OUT(context, downstream_output) = context->state.phase >= 1U && context->state.phase <= 3U;
    IO_OUT(context, upstream_output) = context->state.phase == 2U;
}

bool Logic_Init(LogicContext *context)
{
    if (context == NULL) { return false; }
    context->state.phase = 0U;
    context->state.block_reason = 0U;
    context->state.remain_ms = 0U;
    context->state.entered_ms = 0U;
    context->state.sampled = false;
    context->state.previous_start = true;
    PublishOutputs(context);
    return true;
}

bool Logic_Scan(LogicContext *context)
{
    bool good;
    bool pressed;
    bool start;
    bool stop;
    uint32_t elapsed;
    if (context == NULL) { return false; }
    good = IO_IN(context, start_button).quality == POINT_CONFIG_QUALITY_GOOD &&
           IO_IN(context, stop_button).quality == POINT_CONFIG_QUALITY_GOOD &&
           IO_IN(context, run_permit).quality == POINT_CONFIG_QUALITY_GOOD;
    pressed = IO_IN(context, start_button).value;
    start = context->state.sampled && pressed && !context->state.previous_start;
    start = start || context->command.line_start;
    stop = IO_IN(context, stop_button).value || context->command.line_stop;
    context->state.previous_start = pressed;
    context->state.sampled = true;
    context->state.remain_ms = 0U;
    context->state.block_reason = !good ? 2U : (!IO_IN(context, run_permit).value ? 1U : 0U);

    if (context->state.block_reason != 0U)
    {
        context->state.phase = 4U;
        context->state.entered_ms = 0U;
    }
    else if (context->command.line_protect_stop || context->state.phase == 4U || context->state.phase > 4U)
    {
        /* 恢复条件或无效状态只回待命，不消费本拍启动为新的动作。 */
        context->state.phase = 0U;
        context->state.entered_ms = 0U;
    }
    else if (stop && context->state.phase != 3U)
    {
        if (context->state.phase == 2U)
        {
            context->state.phase = 3U;
            context->state.entered_ms = context->now_ms;
            context->state.remain_ms = context->state.cycle_clear_ms;
        }
        else { context->state.phase = 0U; }
    }
    else if (context->state.phase == 1U || context->state.phase == 3U)
    {
        uint32_t duration = context->state.phase == 1U ?
            context->state.cycle_start_ms : context->state.cycle_clear_ms;
        elapsed = context->now_ms - context->state.entered_ms;
        if (elapsed >= duration) { context->state.phase = context->state.phase == 1U ? 2U : 0U; }
        else { context->state.remain_ms = duration - elapsed; }
    }
    else if (context->state.phase == 0U && start && !stop)
    {
        if (context->param.start_delay_ms < 1000U || context->param.start_delay_ms > 10000U ||
            context->param.clear_delay_ms < 1000U || context->param.clear_delay_ms > 10000U)
        {
            PublishOutputs(context);
            return false;
        }
        context->state.cycle_start_ms = context->param.start_delay_ms;
        context->state.cycle_clear_ms = context->param.clear_delay_ms;
        context->state.entered_ms = context->now_ms;
        context->state.phase = 1U;
        context->state.remain_ms = context->state.cycle_start_ms;
    }
    PublishOutputs(context);
    return true;
}

void Logic_Stop(LogicContext *context)
{
    if (context == NULL) { return; }
    context->state.phase = 0U;
    context->state.remain_ms = 0U;
    context->state.block_reason = 0U;
    context->state.sampled = false;
    context->state.previous_start = true;
    PublishOutputs(context);
}
