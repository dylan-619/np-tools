#ifndef KZ3_VALVE_REVERSE_GUARD_H
#define KZ3_VALVE_REVERSE_GUARD_H

#include <stdbool.h>
#include <stdint.h>

/* 项目内部的方向输出保护，不产生北向字段，也不代替接触器/零速反馈。
 * 调用者按扫描恢复/保存两个 u32 state；不得用文件级 static 保存本机状态。
 * memory: [1:0] 最后实际输出方向，[3:2] 上拍实际输出方向，
 * bit4 全关起点有效，bit5 手动反向被拒后必须收到独立 STOP。
 * 冷启动的全零状态没有历史方向；首次启动行为沿用项目原规则。
 * Logic_Stop/故障复位/模式切换不得清除这两个跨扫描状态。 */
typedef struct
{
    uint32_t memory;
    uint32_t off_since_ms;
} ValveReverseGuard;

typedef struct
{
    bool open_request;
    bool close_request;
    bool automatic;
    bool open_command;
    bool close_command;
    bool stop_command;
    uint32_t now_ms;
    uint32_t minimum_off_ms;
} ValveReverseInput;

typedef struct
{
    bool open_output;
    bool close_output;
    bool waiting;
    bool discard_manual;
    bool started;
} ValveReverseOutput;

#define VALVE_REVERSE_NONE          0U
#define VALVE_REVERSE_OPEN          1U
#define VALVE_REVERSE_CLOSE         2U
#define VALVE_REVERSE_DIRECTION_MASK 3U
#define VALVE_REVERSE_OUTPUT_SHIFT  2U
#define VALVE_REVERSE_OFF_VALID     16U
#define VALVE_REVERSE_NEEDS_STOP    32U
#define VALVE_REVERSE_VALID_MASK    63U
#define VALVE_REVERSE_MINIMUM_OFF_MS 2000U

/* 行程监督只在上一拍确实发出该方向DO请求后检查其原始deadline。 */
static inline bool ValveReverseGuard_Active(uint32_t memory, uint32_t direction)
{
    return ((memory >> VALVE_REVERSE_OUTPUT_SHIFT) &
            VALVE_REVERSE_DIRECTION_MASK) == direction;
}

/* 只基于最终软件输出计时；首次形成双 false 的扫描才建立全关起点。
 * 手动过早/未先停止的反向由调用者取消动作目标，禁止延迟排队执行。
 * 自动目标可保留，waiting 时由调用者暂停阀行程监督，started 时从真实
 * DO 请求首次有效重新起算；minimum_off_ms 必须由项目已确认规则提供。 */
static inline ValveReverseOutput ValveReverseGuard_Apply(
    ValveReverseGuard *guard, const ValveReverseInput *input)
{
    ValveReverseOutput output = {false, false, false, false, false};
    uint32_t last = guard->memory & VALVE_REVERSE_DIRECTION_MASK;
    uint32_t previous = (guard->memory >> VALVE_REVERSE_OUTPUT_SHIFT) &
                        VALVE_REVERSE_DIRECTION_MASK;
    uint32_t desired = input->open_request ? VALVE_REVERSE_OPEN :
        (input->close_request ? VALVE_REVERSE_CLOSE : VALVE_REVERSE_NONE);
    bool off_valid = (guard->memory & VALVE_REVERSE_OFF_VALID) != 0U;
    bool needs_stop = (guard->memory & VALVE_REVERSE_NEEDS_STOP) != 0U;
    bool command_direction = input->open_command != input->close_command;
    uint32_t command = input->open_command ? VALVE_REVERSE_OPEN :
                                           VALVE_REVERSE_CLOSE;
    bool reverse_command = command_direction && last != VALVE_REVERSE_NONE &&
                           command != last;

    if ((guard->memory & ~VALVE_REVERSE_VALID_MASK) != 0U ||
        last > VALVE_REVERSE_CLOSE || previous > VALVE_REVERSE_CLOSE ||
        input->minimum_off_ms == 0U ||
        input->minimum_off_ms > UINT32_MAX / 2U)
    {
        output.discard_manual = !input->automatic;
        return output;
    }
    if (input->stop_command)
    {
        needs_stop = false;
        desired = VALVE_REVERSE_NONE;
    }
    else if (!input->automatic && previous != VALVE_REVERSE_NONE &&
             (reverse_command ||
              (input->open_command && input->close_command)))
    {
        needs_stop = true;
        /* 既有离线策略若仍保持原方向，只拒绝新反向，不改变该保持策略。 */
        if (desired != last)
        {
            desired = VALVE_REVERSE_NONE;
            output.discard_manual = true;
        }
    }
    if (input->open_request && input->close_request)
    {
        desired = VALVE_REVERSE_NONE;
        output.discard_manual = !input->automatic;
    }
    if (desired != VALVE_REVERSE_NONE &&
        last != VALVE_REVERSE_NONE && desired != last)
    {
        bool ready = previous == VALVE_REVERSE_NONE && off_valid &&
            (uint32_t)(input->now_ms - guard->off_since_ms) >=
                input->minimum_off_ms;

        if (!ready || (!input->automatic && needs_stop))
        {
            desired = VALVE_REVERSE_NONE;
            output.waiting = input->automatic;
            output.discard_manual = !input->automatic;
        }
    }
    if (desired == VALVE_REVERSE_NONE)
    {
        if (previous != VALVE_REVERSE_NONE)
        {
            guard->off_since_ms = input->now_ms;
            off_valid = true;
        }
        previous = VALVE_REVERSE_NONE;
    }
    else
    {
        output.started = previous == VALVE_REVERSE_NONE;
        last = desired;
        previous = desired;
        off_valid = false;
        output.open_output = desired == VALVE_REVERSE_OPEN;
        output.close_output = desired == VALVE_REVERSE_CLOSE;
    }
    guard->memory = last | (previous << VALVE_REVERSE_OUTPUT_SHIFT) |
        (off_valid ? VALVE_REVERSE_OFF_VALID : 0U) |
        (needs_stop ? VALVE_REVERSE_NEEDS_STOP : 0U);
    return output;
}

static inline ValveReverseOutput ValveReverseGuard_Step(
    uint32_t *memory, uint32_t *off_since_ms,
    const ValveReverseInput *input)
{
    ValveReverseGuard guard = {*memory, *off_since_ms};
    ValveReverseOutput output = ValveReverseGuard_Apply(&guard, input);

    *memory = guard.memory;
    *off_since_ms = guard.off_since_ms;
    return output;
}

/* 生命周期已决定撤销输出时只记录全关，保留最后方向和手动STOP门禁。 */
static inline void ValveReverseGuard_Off(
    uint32_t *memory, uint32_t *off_since_ms, uint32_t now_ms)
{
    ValveReverseInput input = {0};

    input.now_ms = now_ms;
    input.minimum_off_ms = VALVE_REVERSE_MINIMUM_OFF_MS;
    (void)ValveReverseGuard_Step(memory, off_since_ms, &input);
}

#endif
