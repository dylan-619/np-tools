# T02 双向互锁监督器使用契约

适用于正反转接触器、阀门开/关两个输出或任意两个物理上禁止同时动作的方向。软件互锁不能替代
接触器硬件电气互锁、机械限位和安全继电器。

固定切换链为：

```text
RUNNING(A) → STOPPING(A) → A反馈=false → DEADTIME → STARTING(B)
```

任何路径都不得把 `active` 提前清空后直接启动另一方向。旧反馈持续 true、双反馈同时 true、同扫描
双向请求、许可坏质量或全局许可撤销时，两个输出必须保持 false。复位只在两个反馈均断开后清锁存，
不产生方向动作。

项目负责把正/反限位、热继、急停等现场条件归并为 `permit_a/permit_b/global_permit`，并分别处理
质量。方向命令必须是 one-shot；需要长期目标时，由项目 state 持有，但仍通过本监督器换向。

项目 YAML 至少为 `active/target/phase/fault_latched/phase_started_ms/blocked_reason` 声明 state。扫描中
从这些标量恢复 `MutualInterlockState`，构造带质量的 `MutualInterlockInput`，调用一次
`MutualInterlock_Evaluate`，再把所有状态写回。`output_a/output_b` 只能在扫描结尾分别写入唯一物理 owner。

模板输出还必须经过已冻结的硬保护最终许可；不得在另一个分支重新打开任一方向，也不得把
`MutualInterlockState` 改成文件级 `static`。
