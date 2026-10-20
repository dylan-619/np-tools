# T03 PID 回路安全门使用契约

本模板不实现 PID 算法，而是固定 `PID_STEP` 外围容易出错的安全结构：许可、测量质量、有限数检查、
工程量范围、手动/跟踪输出范围以及最终输出校验。

项目调用顺序：

1. 用已冻结的工程量范围和安全输出构造 `PidLoopGuardPolicy`；
2. `PidLoopGuard_Prepare` 返回 `call_pid=false` 时执行 `PID_RESET` 并写安全输出；
3. `call_pid=true` 时只调用一次项目专属 PID ID 的 `PID_STEP`；
4. `PidLoopGuard_Finalize` 通过后才允许写执行器输出；返回 false 时 `Logic_Scan` 也返回 false；
5. 执行器不由本 PID 拥有时必须进入 tracking，以实际应用输出对齐内部状态。

模板不能决定且 AI 不允许猜测：direct/reverse、采样周期、Kp/Ki/Kd、微分滤波、输出限幅、手自动
切换策略和安全输出。这些全部来自项目冻结需求与 YAML；主机测试通过也不代表现场闭环稳定。

标准调用形状如下，项目专属 PID ID 每扫描最多调用一次：

```c
PidLoopGuardDecision decision;
LogicPidStatus status = {0};
float actuator_output;
bool output_permitted;

if (!PidLoopGuard_Prepare(&policy, &request, &decision))
{
    return false;
}
if (decision.reset_pid)
{
    PID_RESET(POINT_CONFIG_PID_PROCESS_LOOP);
}
if (decision.call_pid &&
    !PID_STEP(context, POINT_CONFIG_PID_PROCESS_LOOP,
              &decision.pid_input, &status))
{
    return false;
}
if (!PidLoopGuard_Finalize(&policy, &decision,
                           decision.call_pid ? &status : NULL,
                           &actuator_output, &output_permitted))
{
    return false;
}
IO_OUT(context, actuator) = output_permitted ? actuator_output :
                                                policy.safe_output;
```
