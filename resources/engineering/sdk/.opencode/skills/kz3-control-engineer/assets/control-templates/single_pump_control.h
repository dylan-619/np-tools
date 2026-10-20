#ifndef KZ3_STANDARD_SINGLE_PUMP_CONTROL_H
#define KZ3_STANDARD_SINGLE_PUMP_CONTROL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/*
 * 单泵/单电机标准监督器。
 *
 * 本模板只拥有业务状态，不拥有物理 I/O、协议、任务或持久化。调用者必须
 * 每扫描构造输入，并且只把 output_on 写到一个最终物理输出 owner。
 */
typedef enum
{
    SINGLE_PUMP_PHASE_STOPPED = 0U,
    SINGLE_PUMP_PHASE_STARTING,
    SINGLE_PUMP_PHASE_RUNNING,
    SINGLE_PUMP_PHASE_STOPPING,
    SINGLE_PUMP_PHASE_FAULT
} SinglePumpPhase;

typedef enum
{
    SINGLE_PUMP_BLOCK_NONE = 0U,
    SINGLE_PUMP_BLOCK_REARM_REQUIRED,
    SINGLE_PUMP_BLOCK_INPUT_QUALITY,
    SINGLE_PUMP_BLOCK_SAFETY_PERMIT,
    SINGLE_PUMP_BLOCK_DEVICE_FAULT,
    SINGLE_PUMP_BLOCK_FEEDBACK_ALREADY_ON,
    SINGLE_PUMP_BLOCK_START_FEEDBACK_TIMEOUT,
    SINGLE_PUMP_BLOCK_RUN_FEEDBACK_TIMEOUT,
    SINGLE_PUMP_BLOCK_STOP_FEEDBACK_TIMEOUT
} SinglePumpBlockedReason;

typedef struct
{
    uint32_t start_feedback_timeout_ms;
    uint32_t run_feedback_timeout_ms;
    uint32_t stop_feedback_timeout_ms;
} SinglePumpPolicy;

typedef struct
{
    bool start_command;
    bool stop_command;
    bool reset_command;
    bool safety_permit;
    bool safety_quality_good;
    bool device_fault;
    bool device_fault_quality_good;
    bool run_feedback;
    bool run_feedback_quality_good;
    uint32_t now_ms;
} SinglePumpInput;

typedef struct
{
    SinglePumpPhase phase;
    bool requested_on;
    bool output_on;
    bool fault_latched;
    bool rearm_required;
    bool feedback_missing;
    uint32_t phase_started_ms;
    uint32_t feedback_missing_since_ms;
    SinglePumpBlockedReason blocked_reason;
} SinglePumpState;

static inline bool SinglePump_Elapsed(uint32_t now_ms, uint32_t since_ms,
                                      uint32_t duration_ms)
{
    return (uint32_t)(now_ms - since_ms) >= duration_ms;
}

static inline bool SinglePumpPolicy_Valid(const SinglePumpPolicy *policy)
{
    return policy != NULL && policy->start_feedback_timeout_ms > 0U &&
           policy->run_feedback_timeout_ms > 0U &&
           policy->stop_feedback_timeout_ms > 0U;
}

static inline void SinglePump_Init(SinglePumpState *state)
{
    if (state == NULL)
    {
        return;
    }
    *state = (SinglePumpState){0};
    state->phase = SINGLE_PUMP_PHASE_STOPPED;
}

static inline void SinglePump_StopOutput(SinglePumpState *state,
                                         const SinglePumpInput *input,
                                         const SinglePumpPolicy *policy)
{
    state->output_on = false;
    state->requested_on = false;
    state->feedback_missing = false;
    if (input->run_feedback_quality_good && input->run_feedback)
    {
        if (state->phase != SINGLE_PUMP_PHASE_STOPPING)
        {
            state->phase = SINGLE_PUMP_PHASE_STOPPING;
            state->phase_started_ms = input->now_ms;
        }
        else if (SinglePump_Elapsed(input->now_ms, state->phase_started_ms,
                                    policy->stop_feedback_timeout_ms))
        {
            state->fault_latched = true;
            state->rearm_required = true;
            state->blocked_reason = SINGLE_PUMP_BLOCK_STOP_FEEDBACK_TIMEOUT;
            state->phase = SINGLE_PUMP_PHASE_FAULT;
        }
    }
    else
    {
        state->phase = state->fault_latched ? SINGLE_PUMP_PHASE_FAULT :
                                              SINGLE_PUMP_PHASE_STOPPED;
    }
}

static inline bool SinglePump_Evaluate(SinglePumpState *state,
                                       const SinglePumpInput *input,
                                       const SinglePumpPolicy *policy)
{
    bool qualities_good;

    if (state == NULL || input == NULL || !SinglePumpPolicy_Valid(policy))
    {
        return false;
    }
    state->output_on = false;
    qualities_good = input->safety_quality_good &&
                     input->device_fault_quality_good &&
                     input->run_feedback_quality_good;

    /* 质量、安全和设备故障优先于全部命令。 */
    if (!qualities_good)
    {
        state->fault_latched = true;
        state->rearm_required = true;
        state->blocked_reason = SINGLE_PUMP_BLOCK_INPUT_QUALITY;
        SinglePump_StopOutput(state, input, policy);
        return true;
    }
    if (!input->safety_permit)
    {
        state->fault_latched = true;
        state->rearm_required = true;
        state->blocked_reason = SINGLE_PUMP_BLOCK_SAFETY_PERMIT;
        SinglePump_StopOutput(state, input, policy);
        return true;
    }
    if (input->device_fault)
    {
        state->fault_latched = true;
        state->rearm_required = true;
        state->blocked_reason = SINGLE_PUMP_BLOCK_DEVICE_FAULT;
        SinglePump_StopOutput(state, input, policy);
        return true;
    }

    /* 复位只清故障，不建立启动请求。 */
    if (input->reset_command && !input->run_feedback &&
        (state->phase == SINGLE_PUMP_PHASE_STOPPED ||
         state->phase == SINGLE_PUMP_PHASE_FAULT))
    {
        state->fault_latched = false;
        state->rearm_required = false;
        state->requested_on = false;
        state->feedback_missing = false;
        state->blocked_reason = SINGLE_PUMP_BLOCK_NONE;
        state->phase = SINGLE_PUMP_PHASE_STOPPED;
        return true;
    }

    /* 同扫描启停冲突时停止优先。 */
    if (input->stop_command)
    {
        state->blocked_reason = SINGLE_PUMP_BLOCK_NONE;
        SinglePump_StopOutput(state, input, policy);
        return true;
    }

    if (state->fault_latched)
    {
        if (state->blocked_reason == SINGLE_PUMP_BLOCK_NONE)
        {
            state->blocked_reason = SINGLE_PUMP_BLOCK_REARM_REQUIRED;
        }
        SinglePump_StopOutput(state, input, policy);
        return true;
    }

    if (state->phase == SINGLE_PUMP_PHASE_STOPPING)
    {
        SinglePump_StopOutput(state, input, policy);
        return true;
    }

    if (input->start_command && state->phase == SINGLE_PUMP_PHASE_STOPPED)
    {
        if (state->rearm_required)
        {
            state->blocked_reason = SINGLE_PUMP_BLOCK_REARM_REQUIRED;
            return true;
        }
        if (input->run_feedback)
        {
            state->fault_latched = true;
            state->rearm_required = true;
            state->blocked_reason = SINGLE_PUMP_BLOCK_FEEDBACK_ALREADY_ON;
            state->phase = SINGLE_PUMP_PHASE_FAULT;
            return true;
        }
        state->requested_on = true;
        state->feedback_missing = false;
        state->blocked_reason = SINGLE_PUMP_BLOCK_NONE;
        state->phase = SINGLE_PUMP_PHASE_STARTING;
        state->phase_started_ms = input->now_ms;
    }

    if (state->phase == SINGLE_PUMP_PHASE_STARTING)
    {
        if (input->run_feedback)
        {
            state->phase = SINGLE_PUMP_PHASE_RUNNING;
            state->feedback_missing = false;
        }
        else if (SinglePump_Elapsed(input->now_ms, state->phase_started_ms,
                                    policy->start_feedback_timeout_ms))
        {
            state->fault_latched = true;
            state->rearm_required = true;
            state->requested_on = false;
            state->blocked_reason =
                SINGLE_PUMP_BLOCK_START_FEEDBACK_TIMEOUT;
            state->phase = SINGLE_PUMP_PHASE_FAULT;
            return true;
        }
        state->output_on = true;
        return true;
    }

    if (state->phase == SINGLE_PUMP_PHASE_RUNNING)
    {
        if (input->run_feedback)
        {
            state->feedback_missing = false;
        }
        else if (!state->feedback_missing)
        {
            state->feedback_missing = true;
            state->feedback_missing_since_ms = input->now_ms;
        }
        else if (SinglePump_Elapsed(input->now_ms,
                                    state->feedback_missing_since_ms,
                                    policy->run_feedback_timeout_ms))
        {
            state->fault_latched = true;
            state->rearm_required = true;
            state->requested_on = false;
            state->blocked_reason =
                SINGLE_PUMP_BLOCK_RUN_FEEDBACK_TIMEOUT;
            state->phase = SINGLE_PUMP_PHASE_FAULT;
            return true;
        }
        state->output_on = true;
        return true;
    }

    state->requested_on = false;
    return true;
}

#endif
