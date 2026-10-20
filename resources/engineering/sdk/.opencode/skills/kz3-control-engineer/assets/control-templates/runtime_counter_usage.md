# T05 声明式运行时间统计模板

模板 ID：`T05_RUNTIME_COUNTER_USAGE`

本模板固定的是“如何选择统计对象、如何声明 `runtime_counters`、如何对北发布和如何验证”，不是一份
由项目 `logic.c` 手写的计时器。累计、时钟回绕、U32 饱和、异步 EEPROM 保存和清零事务均由
`LogicManager` 与 `LogicRuntimeStore` 统一拥有；项目不得再维护第二份累计值。

## 1. 先区分统计口径

| 需求 | 标准来源 | 可宣称含义 |
| --- | --- | --- |
| 本次 MCU 启动时长 | 平台 `session_uptime_seconds` | 本次会话上电时间，重启归零 |
| 控制器跨重启总上电时间 | `state.system_total_runtime_seconds` | application 上电累计，不等于设备运行 |
| 设备真实运行时间 | `runtime_counters` 绑定独立运行反馈 | 反馈 `GOOD` 且等于 `active_value` 的累计秒数 |
| 输出命令保持时间 | `runtime_counters` 绑定最终 BOOL 输出 | 只能命名为“命令运行时长”，不能冒充物理运行 |
| 启动次数、故障时长、班次/月报、历史曲线 | 当前无认证持久化模板 | `CUSTOM_REVIEW_REQUIRED`，普通 Counter/state 不得宣称掉电保持 |

若设备有独立接触器辅助触点、变频器运行位或经过评审的运行反馈，必须优先使用该反馈。只有确认现场
没有真实反馈且业务接受“命令时长”口径时，才允许绑定最终输出目标；输出请求、模块寄存器回读和真实
设备运行反馈不能混为一类。

## 2. 标准 YAML 形状

可执行生成夹具见
[`runtime_counter_fixture/project_io.yaml`](runtime_counter_fixture/project_io.yaml)。项目适配时只复制字段
形状，不复制其中的 `board.di01`、名称或 Modbus 地址。

输入反馈必须显式要求质量：

```yaml
runtime_counters:
  - name: pump_01
    description: 水泵 1 独立运行反馈 GOOD+true 累计秒数
    trigger:
      bind: point.pump_01_feedback
      active_value: true
      quality: good
```

标量输出、BOOL parameter 或 BOOL state 触发时必须省略 `quality`。`active_value` 必须显式声明，不能靠
名称猜有效极性。若对北开放清零，发布以下字段；`clear_pending` 仅供内部逻辑和测试检查，不占北向点位：

- `runtime.<name>.seconds`：`u32`、只读；
- `runtime.<name>.clear`：`bool`、读写 one-shot command；
- `state.retained_store_fault`、`state.retained_store_fault_mask`、
  `state.retained_store_busy`：只读存储诊断。

协议 ACK 只证明清零请求被接受，`clear_pending` 从 true 回到 false 才证明该对象的零记录已完成持久化。
设备在清零事务期间继续运行时，完成后可能直接显示非零秒数，这是保留清零后新运行时间的正确行为。

## 3. 固定运行语义

1. 首次成功 RUNNING 扫描只建立时间基线，不凭空加一个扫描周期。
2. 扫描区间归属于区间起点的运行状态；当前扫描发现反馈变坏时，先结算此前仍为 GOOD 的区间，再停止累计。
3. 毫秒余数保留在 RAM，满 1000 ms 才增加 U32 秒数；相同 `now_ms` 的重复扫描不重复累计。
4. 时间差使用无符号减法，支持 32 位 tick 正常回绕；秒数到 `UINT32_MAX` 后饱和，不回零。
5. STOP、FAULT_SAFE 和 reset 暂停设备累计并丢弃停机间隔；恢复 RUNNING 后重新建立基线。
6. `Logic_Scan()` 读取 `RUNTIME_SECONDS(context, name)` 时看到的是上一拍已投影值；累计本身由框架在
   本次逻辑成功后统一推进。
7. 项目代码不得直接调用 EEPROM、`LogicManager_*` 或 `LogicRuntimeStore_*`，也不得以文件级 `static`、
   普通 Counter 或 state 复制累计器。

## 4. 持久化与寿命门禁

当前可执行固件的设备 runtime 行为是：连续运行每 `300000 ms`（5 分钟）请求一次检查点；从运行变为
非运行且秒数已变化时立即请求保存。`SystemLifetime` 仍使用 1 小时检查点。该周期是平台常量，不是项目
参数，Agent 不得自行更改。

每个 runtime 使用一个 16 B EEPROM 单页。未命中覆写窗口的普通掉电，可能丢失最近 5 分钟、维护队列
积压和重试期间的增量；若掉电正好命中单页覆写窗口，该对象全部历史值都可能失效，重启后从 0 开始并
置存储故障。当前没有 A/B 备份或零丢失承诺。

5 分钟检查点和每次有效停机保存都会增加写次数。对于频繁启停设备，Agent 必须取得“日最大启停次数、
目标服役年限、实装 EEPROM 型号/endurance/温度降额”后做寿命评审；缺少证据时明确写
“我不知道（I don't know）是否满足目标寿命”，并把掉电/写寿命列为待 HIL/产品放行项。不能因为主机
测试通过就宣称现场可长期可靠保持。

## 5. 身份与升级规则

- 最多 16 个 runtime，按 YAML 声明顺序映射固定槽位；
- 持久化身份包含 `project.id` 和 runtime 名称；已投产列表只允许尾部追加；
- 改 `project.id`、改名、删除或重排都属于 EEPROM schema 变更，可能从 0 恢复并置 fault；
- 更换 I/O 模块但仍是同一物理设备时可保留名称；更换设备后是否清零必须由运维流程决定；
- clear 的开放协议、权限、审计和现场操作人必须在冻结需求中确定，Agent 不得默认向所有协议开放。

## 6. 项目必测场景

项目 `logic_project_test.c` 必须通过真实 `DataManager + LogicManager` 扫描覆盖：

1. 首拍为 0、运行满 999/1000/1001 ms、相同 tick 重复扫描；
2. `GOOD+active` 累计，`BAD/STALE/OFFLINE/INIT` 或非 active 暂停，恢复后不补记空窗；
3. 32 位 tick 回绕和 U32 秒数饱和；
4. STOP、Reset、FAULT_SAFE 前后不把停机间隔计入；
5. 运行转停止触发保存，维护任务完成后重新初始化仍恢复已提交秒数；
6. clear 的 candidate、pending、完成和运行中清零后保留新时间；
7. EEPROM 写失败后 fault/mask/busy 可观测，其他 runtime 不被清零或阻塞；
8. 多对象同时运行、同时保存和分别清零时槽位隔离与公平性。

本目录主机夹具覆盖单对象核心边界；0/1/10/16/17 个对象的容量、字段生成、多槽公平性和记录 CRC 由
catalog 所列平台测试共同覆盖。实板仍必须验证实际 EEPROM、WP、I2C 故障、写中掉电和长期启停寿命。
