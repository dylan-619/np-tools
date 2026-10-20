# C03 KZ3 PID 接入参考

实现参考：[T03 源码](../../assets/control-templates/pid_loop_guard.h)、[指南](../../assets/control-templates/pid_loop_guard.md)。
使用真实目标 `LogicPidInput`、`LogicPidStatus`、`PID_STEP`、`PID_RESET`；变量成员及实例 ID 以生成头文件为准。

先确定 PV、SP、执行量的单位和换算、正反作用、采样、限幅、安全值、手动/跟踪与积分保持。
示例值不可用于整定；厂家内部 PID 时改为其设定接口，不生成本机闭环。

调用关系如下，省略的是需要按目标 API 绑定的项目变量，并非完整可编译代码：
```text
检查本回路参数及修订：KP/KI 改变 -> 本回路退出，要求重新投入
PidLoopGuard_Prepare(policy, request, decision)
若 !decision.call_pid：PID_RESET(instance)，采用 decision.safe_output
否则：给 decision.pid_input 赋 runtime KP/KI（成员由目标 API 核实）
       PID_STEP(context, instance, decision.pid_input, status)
       PidLoopGuard_Finalize(policy, decision, status, output, permitted)
API 失败：项目扫描失败，框架安全收敛
统一输出仲裁：仅在执行权、泵状态与保护同时允许时采用 output
```
T03 快照本身不完成在线增益接线、工艺启停或设备监督；必须按
[PID 整定契约](../pid-online-tuning-contract.md) 补齐。不要把旧示例固定增益复制进新项目。
验证真实扫描中的采样周期、饱和/积分、坏质量、NaN/Inf、测量/输出越界、手自动跟踪、改增益退出，
以及现场调节方向和动态整定的待实板项。
