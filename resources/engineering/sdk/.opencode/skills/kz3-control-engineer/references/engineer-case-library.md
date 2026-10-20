# 案例组合索引

案例用于学习控制结构，再对当前点表和需求适配；不是按关键字整份复制。目录区分“工艺组合参考”
和“底层实现快照”。测试只验证实现，不是案例库的主体。

| ID | 匹配证据 | 组合与资料 | 不适用边界 |
| --- | --- | --- | --- |
| C01_PRESSURE | 压力反馈，调速/设定接口，明确闭环 owner | [恒压供水](cases/pressure-supply.md) + T01/T03/T04，必要时 T05 | 成套柜闭环不得再生成竞争 PID |
| C02_MIXED_SPEED | 固定变频设备与仅启停设备混合 | [工变频组合](cases/mixed-speed.md) + C01 + T01/T04/T05 | 不等于一变频器切多电机 |
| C03_PID | KZ3 拥有 PV/SP/执行接口 | [PID 接入](cases/pid-loop.md) + T03 | 厂家 PID、未知方向/量程不直接套用 |
| C04_VALVE | 开关双 DO，开关到位/明确执行形式 | [双向阀](cases/reversing-valve.md) + T04 | T02 电机反馈与阀到位语义不同 |
| C05_DEVICE | 单机启停与真实运行反馈 | [T01 实现](../assets/control-templates/single_pump_control.h)及[指南](../assets/control-templates/single_pump_control.md) | 脉冲型需适配；远程许可不能当故障许可 |
| C06_INTERLOCK | 确实互斥的 A/B 设备且有停止反馈 | [T02 实现](../assets/control-templates/mutual_interlock_control.h)及[指南](../assets/control-templates/mutual_interlock_control.md) | 不可强制允许并联的泵组全停 |

## 内置实现参考

[源目录快照](../assets/control-templates/catalog.yaml) 保留源仓库的 ID/status/相对路径作为溯源。
其中路径相对目标 KZ3 仓库，**不是包内路径**；不能直接拿它们读本机其他仓库。
T01/T02/T03 实现已随包放入 assets/control-templates；T04 实际 API、T05 runtime 后端须由目标 KZ3 提供。
源标记 certified 仅指该仓库内部模板门禁；本包不宣称工业认证，不因复制而转移验证结论。

每次选择记录：原需求条款 → 业务角色/点 → 案例 ID → 所取模块 → 未采用分支 → 必需改动 → 实现/验收。
复用状态转移、不变量和 API 使用形状，不复用绑定、地址、PID 参数、量程、假反馈或客户工艺数值。

T01/T02 的许可锁存语义、时限等号与项目规则可能不完全相同；先比对实际代码。不同语义需要适配时
标记 CUSTOM_REVIEW_REQUIRED，不为了套模板更改业务要求，也不直接修改全平台模板。
C01/C02 是组合设计参考，尚不是完整且经过项目验证的恒压控制器；它们的分级调度需按本项目生成并验证。

新增案例必须包含适用拓扑、能力/角色、可组合模块、状态转移、参数槽、异常恢复、反例、来源及验证层级。
不得把客户端子/整定作为默认库内容；无现场证据的案例不得标为已投运。
