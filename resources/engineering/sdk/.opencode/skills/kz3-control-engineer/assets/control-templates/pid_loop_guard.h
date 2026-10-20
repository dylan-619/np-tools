#ifndef KZ3_STANDARD_PID_LOOP_GUARD_H
#define KZ3_STANDARD_PID_LOOP_GUARD_H

#include <math.h>
#include <stdbool.h>
#include <stddef.h>

#include "logic_block_api.h"

/* PID_STEP 外围的标准安全门。整定值和方向仍由项目 YAML 冻结。 */
typedef struct
{
    float measurement_min;
    float measurement_max;
    float output_min;
    float output_max;
    float safe_output;
} PidLoopGuardPolicy;

typedef struct
{
    bool permit;
    float measurement;
    PointConfigQuality measurement_quality;
    float setpoint;
    bool manual_mode;
    float manual_output;
    bool tracking_mode;
    float tracking_output;
    bool integral_hold;
} PidLoopGuardRequest;

typedef struct
{
    bool call_pid;
    bool reset_pid;
    float safe_output;
    LogicPidInput pid_input;
} PidLoopGuardDecision;

static inline bool PidLoopGuardPolicy_Valid(const PidLoopGuardPolicy *policy)
{
    return policy != NULL && isfinite(policy->measurement_min) &&
           isfinite(policy->measurement_max) &&
           isfinite(policy->output_min) && isfinite(policy->output_max) &&
           isfinite(policy->safe_output) &&
           policy->measurement_min < policy->measurement_max &&
           policy->output_min < policy->output_max &&
           policy->safe_output >= policy->output_min &&
           policy->safe_output <= policy->output_max;
}

static inline bool PidLoopGuard_InRange(float value, float minimum,
                                        float maximum)
{
    return isfinite(value) && value >= minimum && value <= maximum;
}

static inline bool PidLoopGuard_Prepare(
    const PidLoopGuardPolicy *policy, const PidLoopGuardRequest *request,
    PidLoopGuardDecision *decision)
{
    if (!PidLoopGuardPolicy_Valid(policy) || request == NULL ||
        decision == NULL)
    {
        return false;
    }
    *decision = (PidLoopGuardDecision){0};
    decision->reset_pid = true;
    decision->safe_output = policy->safe_output;

    /* 许可或测量失效是业务安全路径，不是扫描 API 错误。 */
    if (!request->permit ||
        request->measurement_quality != POINT_CONFIG_QUALITY_GOOD ||
        !PidLoopGuard_InRange(request->measurement,
                              policy->measurement_min,
                              policy->measurement_max))
    {
        return true;
    }
    if (!isfinite(request->setpoint) ||
        (request->manual_mode &&
         !PidLoopGuard_InRange(request->manual_output, policy->output_min,
                               policy->output_max)) ||
        (request->tracking_mode &&
         !PidLoopGuard_InRange(request->tracking_output, policy->output_min,
                               policy->output_max)))
    {
        return false;
    }

    decision->call_pid = true;
    decision->reset_pid = false;
    decision->pid_input.measurement = request->measurement;
    decision->pid_input.measurement_quality = request->measurement_quality;
    decision->pid_input.setpoint = request->setpoint;
    decision->pid_input.enabled = true;
    decision->pid_input.manual_mode = request->manual_mode;
    decision->pid_input.manual_output = request->manual_output;
    decision->pid_input.tracking_mode = request->tracking_mode;
    decision->pid_input.tracking_output = request->tracking_output;
    decision->pid_input.integral_hold = request->integral_hold;
    return true;
}

static inline bool PidLoopGuard_Finalize(
    const PidLoopGuardPolicy *policy, const PidLoopGuardDecision *decision,
    const LogicPidStatus *status, float *output, bool *output_permitted)
{
    if (!PidLoopGuardPolicy_Valid(policy) || decision == NULL ||
        output == NULL || output_permitted == NULL)
    {
        return false;
    }
    *output = policy->safe_output;
    *output_permitted = false;
    if (!decision->call_pid)
    {
        return true;
    }
    if (status == NULL || !status->running ||
        status->input_quality != POINT_CONFIG_QUALITY_GOOD ||
        !PidLoopGuard_InRange(status->output, policy->output_min,
                              policy->output_max))
    {
        return false;
    }
    *output = status->output;
    *output_permitted = true;
    return true;
}

#endif
