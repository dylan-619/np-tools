# C01 恒压供水组合参考

状态：设计参考；结构来自原 W04 边界卡，实际 PID 外围参考 T03。不是已投运供水程序。
先读 [W04](../water-process-boundaries/04_pressure_supply.md)。

必要能力：可信压力 PV、设定 SP、泵启停、约定的运行/故障/许可、调速或厂家设定接口。
水源/吸入许可和超压保护从实际设计确认；缺水不能由持续低压推断。判据未具备则列 GAP。
区分每泵独立变频、固定一变频+工频、一变频切换接触器、成套柜内部调压。

组合顺序：压力/参数校验 → 闭环控制者 → 工艺容量目标 → 合格设备选择 → 每机监督 → 最终输出。
使用 T01 单机监督、T03 PID 外围、T04 计时、真实反馈存在时 T05。独立变频并联不套全组互斥。

| 阶段 | 条件与动作 | 完成/异常 |
| --- | --- | --- |
| 待投入 | 新的投入意图且许可/参数/PV 合格，选可用主调泵 | 无候选保持禁止，不能假启动 |
| 启动确认 | 发该设备启动请求，按冻结策略给起始频率 | 真实运行确认后进入调压；超时撤请求并记录故障 |
| 调压 | 调用已确认 owner；连续低压/高负荷满足加级条件 | 仅形成容量请求，不直接写额外泵 DO |
| 加减级 | 经 C02 或对应拓扑执行，等待实际反馈 | 未完成不重复加级；故障/质量失效中止并重算 |
| 停机/保护 | 普通停机按冻结斜坡/顺序；保护走即时安全仲裁 | 反馈未停仍占容量；恢复不重放旧启动 |

算法形状（概念伪代码，不是 KZ3 API）：
```text
snapshot = read_inputs_once()
valid = check_pressure_and_parameters(snapshot)
manual_requests = consume_per_device_commands()
auto_pool = selected_auto & permitted & healthy & capability_matches
if automatic_session_is_active and valid:
    pid_result = step_the_single_pid_owner()
    capacity_request = evaluate_stage_conditions_with_hysteresis(pid_result, snapshot)
    auto_requests = advance_at_most_one_stage_after_feedback(capacity_request, auto_pool)
final_outputs = arbitrate_per_device(manual_requests, auto_requests, protection)
```
参数槽：压力目标/范围、方向、PID 采样和增益、输出限幅/斜坡、升降级阈值/确认、最小启停间隔、
最大容量。休眠唤醒仅在需求采用时加入；缺流量信号不能声称检测到无流量。
验收：压力往返边界不抖动、质量坏时不调压、迟到反馈不吞超时、手动不被调度、同拍保护优先、
加减级 PID 跟踪、停机未知容量、复位与启动同拍、饱和与恢复。所有数值来自冻结需求。
