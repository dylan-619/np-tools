#ifndef KZ3_STANDARD_MUTUAL_INTERLOCK_CONTROL_H
#define KZ3_STANDARD_MUTUAL_INTERLOCK_CONTROL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum
{
    MUTUAL_DIRECTION_NONE = 0U,
    MUTUAL_DIRECTION_A,
    MUTUAL_DIRECTION_B
} MutualDirection;

typedef enum
{
    MUTUAL_PHASE_OFF = 0U,
    MUTUAL_PHASE_STARTING,
    MUTUAL_PHASE_RUNNING,
    MUTUAL_PHASE_STOPPING,
    MUTUAL_PHASE_DEADTIME,
    MUTUAL_PHASE_FAULT
} MutualPhase;

typedef enum
{
    MUTUAL_BLOCK_NONE = 0U,
    MUTUAL_BLOCK_INPUT_QUALITY,
    MUTUAL_BLOCK_GLOBAL_PERMIT,
    MUTUAL_BLOCK_REQUEST_CONFLICT,
    MUTUAL_BLOCK_DIRECTION_UNAVAILABLE,
    MUTUAL_BLOCK_FEEDBACK_CONFLICT,
    MUTUAL_BLOCK_START_FEEDBACK_TIMEOUT,
    MUTUAL_BLOCK_STOP_FEEDBACK_TIMEOUT
} MutualBlockedReason;

typedef struct
{
    uint32_t start_feedback_timeout_ms;
    uint32_t stop_feedback_timeout_ms;
    uint32_t direction_deadtime_ms;
} MutualInterlockPolicy;

typedef struct
{
    bool request_a_command;
    bool request_b_command;
    bool stop_command;
    bool reset_command;
    bool global_permit;
    bool global_permit_quality_good;
    bool permit_a;
    bool permit_a_quality_good;
    bool permit_b;
    bool permit_b_quality_good;
    bool feedback_a;
    bool feedback_a_quality_good;
    bool feedback_b;
    bool feedback_b_quality_good;
    uint32_t now_ms;
} MutualInterlockInput;

typedef struct
{
    MutualDirection active;
    MutualDirection target;
    MutualPhase phase;
    bool output_a;
    bool output_b;
    bool fault_latched;
    uint32_t phase_started_ms;
    MutualBlockedReason blocked_reason;
} MutualInterlockState;

static inline bool MutualInterlock_Elapsed(uint32_t now_ms, uint32_t since_ms,
                                           uint32_t duration_ms)
{
    return (uint32_t)(now_ms - since_ms) >= duration_ms;
}

static inline bool MutualInterlockPolicy_Valid(
    const MutualInterlockPolicy *policy)
{
    return policy != NULL && policy->start_feedback_timeout_ms > 0U &&
           policy->stop_feedback_timeout_ms > 0U &&
           policy->direction_deadtime_ms > 0U;
}

static inline void MutualInterlock_Init(MutualInterlockState *state)
{
    if (state == NULL)
    {
        return;
    }
    *state = (MutualInterlockState){0};
    state->phase = MUTUAL_PHASE_OFF;
}

static inline bool MutualInterlock_FeedbackOf(
    const MutualInterlockInput *input, MutualDirection direction)
{
    return direction == MUTUAL_DIRECTION_A ? input->feedback_a :
           direction == MUTUAL_DIRECTION_B ? input->feedback_b : false;
}

static inline bool MutualInterlock_PermitOf(
    const MutualInterlockInput *input, MutualDirection direction)
{
    return direction == MUTUAL_DIRECTION_A ? input->permit_a :
           direction == MUTUAL_DIRECTION_B ? input->permit_b : false;
}

static inline void MutualInterlock_Fault(MutualInterlockState *state,
                                         MutualBlockedReason reason)
{
    state->output_a = false;
    state->output_b = false;
    state->fault_latched = true;
    state->blocked_reason = reason;
    state->active = MUTUAL_DIRECTION_NONE;
    state->target = MUTUAL_DIRECTION_NONE;
    state->phase = MUTUAL_PHASE_FAULT;
}

static inline bool MutualInterlock_Evaluate(
    MutualInterlockState *state, const MutualInterlockInput *input,
    const MutualInterlockPolicy *policy)
{
    bool qualities_good;
    MutualDirection command = MUTUAL_DIRECTION_NONE;

    if (state == NULL || input == NULL ||
        !MutualInterlockPolicy_Valid(policy))
    {
        return false;
    }
    state->output_a = false;
    state->output_b = false;
    qualities_good = input->global_permit_quality_good &&
                     input->permit_a_quality_good &&
                     input->permit_b_quality_good &&
                     input->feedback_a_quality_good &&
                     input->feedback_b_quality_good;
    if (!qualities_good)
    {
        MutualInterlock_Fault(state, MUTUAL_BLOCK_INPUT_QUALITY);
        return true;
    }
    if (input->feedback_a && input->feedback_b)
    {
        MutualInterlock_Fault(state, MUTUAL_BLOCK_FEEDBACK_CONFLICT);
        return true;
    }
    if (!input->global_permit)
    {
        MutualInterlock_Fault(state, MUTUAL_BLOCK_GLOBAL_PERMIT);
        return true;
    }
    if (state->active != MUTUAL_DIRECTION_NONE &&
        !MutualInterlock_PermitOf(input, state->active))
    {
        MutualInterlock_Fault(state, MUTUAL_BLOCK_DIRECTION_UNAVAILABLE);
        return true;
    }
    if (input->request_a_command && input->request_b_command)
    {
        MutualInterlock_Fault(state, MUTUAL_BLOCK_REQUEST_CONFLICT);
        return true;
    }

    /* 复位不产生方向请求，且要求两个反馈均已断开。 */
    if (input->reset_command && state->fault_latched &&
        !input->feedback_a && !input->feedback_b)
    {
        state->fault_latched = false;
        state->blocked_reason = MUTUAL_BLOCK_NONE;
        state->active = MUTUAL_DIRECTION_NONE;
        state->target = MUTUAL_DIRECTION_NONE;
        state->phase = MUTUAL_PHASE_OFF;
        return true;
    }
    if (state->fault_latched)
    {
        return true;
    }

    /* 同扫描中 stop 高于任何方向请求。 */
    if (input->stop_command)
    {
        state->target = MUTUAL_DIRECTION_NONE;
        if (state->active != MUTUAL_DIRECTION_NONE &&
            MutualInterlock_FeedbackOf(input, state->active))
        {
            if (state->phase != MUTUAL_PHASE_STOPPING)
            {
                state->phase = MUTUAL_PHASE_STOPPING;
                state->phase_started_ms = input->now_ms;
            }
        }
        else
        {
            state->active = MUTUAL_DIRECTION_NONE;
            state->phase = MUTUAL_PHASE_OFF;
        }
        return true;
    }

    command = input->request_a_command ? MUTUAL_DIRECTION_A :
              input->request_b_command ? MUTUAL_DIRECTION_B :
                                         MUTUAL_DIRECTION_NONE;
    if (command != MUTUAL_DIRECTION_NONE &&
        !MutualInterlock_PermitOf(input, command))
    {
        MutualInterlock_Fault(state, MUTUAL_BLOCK_DIRECTION_UNAVAILABLE);
        return true;
    }

    if (command != MUTUAL_DIRECTION_NONE)
    {
        if (state->phase == MUTUAL_PHASE_OFF)
        {
            if (input->feedback_a || input->feedback_b)
            {
                MutualInterlock_Fault(state, MUTUAL_BLOCK_FEEDBACK_CONFLICT);
                return true;
            }
            state->active = command;
            state->target = command;
            state->phase = MUTUAL_PHASE_STARTING;
            state->phase_started_ms = input->now_ms;
        }
        else if (state->phase == MUTUAL_PHASE_RUNNING &&
                 state->active != command)
        {
            state->target = command;
            state->phase = MUTUAL_PHASE_STOPPING;
            state->phase_started_ms = input->now_ms;
        }
    }

    if (state->phase == MUTUAL_PHASE_STOPPING)
    {
        if (!MutualInterlock_FeedbackOf(input, state->active))
        {
            state->active = MUTUAL_DIRECTION_NONE;
            if (state->target == MUTUAL_DIRECTION_NONE)
            {
                state->phase = MUTUAL_PHASE_OFF;
            }
            else
            {
                state->phase = MUTUAL_PHASE_DEADTIME;
                state->phase_started_ms = input->now_ms;
            }
        }
        else if (MutualInterlock_Elapsed(
                     input->now_ms, state->phase_started_ms,
                     policy->stop_feedback_timeout_ms))
        {
            MutualInterlock_Fault(state,
                                  MUTUAL_BLOCK_STOP_FEEDBACK_TIMEOUT);
        }
        return true;
    }

    if (state->phase == MUTUAL_PHASE_DEADTIME)
    {
        if (MutualInterlock_Elapsed(input->now_ms, state->phase_started_ms,
                                    policy->direction_deadtime_ms))
        {
            if (input->feedback_a || input->feedback_b ||
                !MutualInterlock_PermitOf(input, state->target))
            {
                MutualInterlock_Fault(state,
                                      MUTUAL_BLOCK_FEEDBACK_CONFLICT);
                return true;
            }
            state->active = state->target;
            state->phase = MUTUAL_PHASE_STARTING;
            state->phase_started_ms = input->now_ms;
        }
        else
        {
            return true;
        }
    }

    if (state->phase == MUTUAL_PHASE_STARTING)
    {
        if ((state->active == MUTUAL_DIRECTION_A && input->feedback_b) ||
            (state->active == MUTUAL_DIRECTION_B && input->feedback_a))
        {
            MutualInterlock_Fault(state, MUTUAL_BLOCK_FEEDBACK_CONFLICT);
            return true;
        }
        if (MutualInterlock_FeedbackOf(input, state->active))
        {
            state->phase = MUTUAL_PHASE_RUNNING;
        }
        else if (MutualInterlock_Elapsed(
                     input->now_ms, state->phase_started_ms,
                     policy->start_feedback_timeout_ms))
        {
            MutualInterlock_Fault(state,
                                  MUTUAL_BLOCK_START_FEEDBACK_TIMEOUT);
            return true;
        }
    }
    else if (state->phase == MUTUAL_PHASE_RUNNING &&
             !MutualInterlock_FeedbackOf(input, state->active))
    {
        /* 运行反馈丢失复用启动确认窗口，超时后安全锁存。 */
        state->phase = MUTUAL_PHASE_STARTING;
        state->phase_started_ms = input->now_ms;
    }

    if (state->phase == MUTUAL_PHASE_STARTING ||
        state->phase == MUTUAL_PHASE_RUNNING)
    {
        state->output_a = state->active == MUTUAL_DIRECTION_A;
        state->output_b = state->active == MUTUAL_DIRECTION_B;
    }
    return true;
}

#endif
