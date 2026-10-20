# KZ3 项目生成契约

## 正式项目源

```text
application/projects/<项目叶子目录>/
├── README.md
├── project_io.yaml
├── logic.c
└── logic_project_test.c
```

叶子目录可直接位于 `application/projects/`，也可位于一个或多个归档分组下；解析后不得逃逸
`application/projects/`。以上是必需核心产物。完整项目还必须交付配置点表说明、安全/稳定性报告与
HIL 计划，可合并到现有文档；按 [端到端交付契约](end-to-end-delivery.md) 核对，不以四个文件存在代替完成。

活动副本、锁文件和 `application/generated/point_config.*` 由 `tools/project_configure.py` 维护，不是生成
智能体的日常编辑目标。

README 必须包含 `kz3-requirements/v1` 机器可读需求契约。生成时契约为 `FROZEN`、无未决项，且
`project_id` 与 `project_io.yaml` 完全一致；契约结构和命令见
[机器可读需求契约](requirements-contract.md)。

## YAML 关键不变量

新生成的 `project_io.yaml` 中，`project.points.inputs/outputs`、
`project.application_variables.parameters/commands/states/external_inputs` 和
`project.northbound.fields` 的扁平条目均采用行内映射：一个 `- {…}` 只表示一条记录，完整字段写在同一个
物理行上，不将 `name/source/bind/c_type/reference/description` 等拆到后续行。列表仍按原业务/地址顺序
逐行排列；`runtime_counters`、设备/Profile 等含嵌套结构的配置可保持块式写法。示例：

```yaml
project:
  points:
    inputs:
      - {name: p1_run_fb, source: board.di02, description: 1号泵运行反馈}
  northbound:
    fields:
      - {name: P1_RUN, bind: point.p1_run_fb, c_type: bool, access: read, reference: '10001', description: 1号泵运行反馈}
```

`reference` 等需保留前导零的标量必须加引号；含逗号、冒号或其他 YAML 特殊字符的值按 YAML 规则
正确引用。不得因行内排版删除字段、合并不同条目或改变类型、地址、权限与顺序；生成后解析 YAML 并
对照临时生成点表核验语义。修改已有项目时不为排版重写无关记录，除非用户要求统一格式。

- `schema` 使用当前生成器支持的版本；`project.id` 与选择项 key 一致；
- `required_profiles` 与 `devices` 引用的去重集合完全相同；
- 一个物理 source 只映射一个业务点；一个输出只由一个业务 owner 产生；
- RTU 输出在 `use.outputs` 明确安全值；整组写入约束由 Profile/生成器决定；
- parameter 给出类型、默认、范围、单位和 apply；需掉电保持时显式 `persistent: true` 并冻结
  `project.startup.parameter_restore`；command 只表达 one-shot；state 只表达逻辑拥有状态；
- external input 仅用于上级周期写入的当前值，按
  [外部实时输入契约](external-input-contract.md) 声明类型、范围、时效和唯一 `read_write` 北向绑定；
  不持久化、不使用参数 revision，不把 INIT 默认值视为有效输入；
- 每个有状态调用有独占实例名；Counter/PID 功能开关与声明一致；
- 每个 KZ3 PID 回路按 [PID 上位机整定契约](pid-online-tuning-contract.md) 生成独立 KP/KI parameter、
  北向 `float/read_write` 字段和 runtime gain 赋值；增益变化必须退出本回路并重新投入，不能只改影子参数；
- 设备 runtime 采用 `T05_RUNTIME_COUNTER_USAGE`：输入 trigger 明确 `quality: good`，标量 trigger 不配置
  quality；优先真实反馈，绑定输出时只能命名为命令时长；项目 `logic.c` 不手写或复制累计器；
- 逐台扫描已冻结的真实运行反馈点，不按设备名称排除，为每台设备声明唯一
  `runtime_counters`（`trigger.bind=point.<本机运行反馈>`、显式 BOOL `active_value`、`quality: good`）
  和只读 `*_RT_S -> runtime.<name>.seconds`；只采集项目也必须生成。只有开、关到位反馈的阀门
  无真实运行反馈，不造物理运行累计。
  每个已声明 runtime 还必须发布本机 `*_RT_CLR -> runtime.<name>.clear`（读写 one-shot）及 T05
  存储诊断；`clear_pending` 仅在逻辑和测试内部使用，不新增 `*_RT_PND` 北向点位。不在项目变量中重复声明内部
  clear/seconds/pending 成员。16 槽上限及已投产名称/顺序冲突返回需求阶段，不删减设备凑容量；
- 每台受控启停设备或开关阀按 [单体反馈故障契约](device-ownership-contract.md) 生成适用的启动/开阀、
  停止/关阀超时；时限按冻结需求及契约默认表，不指定时继电器设备为启动 5 秒、停止 30 秒、
  运行丢失 5 秒，阀开/关各 120 秒。只有独立真实运行反馈且仍有运行目标时，才生成已确认运行后的滚动
  反馈丢失；只有真实故障 DI 才汇总硬接故障。只有开、关到位反馈的阀门只做开、关超时；缺物理反馈时不造
  虚假状态。已有设备超时故障先核对语义，能覆盖时不重复实现。故障复位命令不得清 runtime，
  runtime 清零命令不得清故障或改输出；
- Modbus 地址与类型宽度匹配且不重叠；parameter/command 可写，state/output 通常只读。

## 点位描述与业务角色

- 生成前重新读取冻结需求引用的点位源，不从 README 中手工复制可能已经漂移的绑定；
- A11 标准板且固件/板型未变时，按 `board_kz3_f427_standard.yaml` 和底层采样/输出映射继承板载
  DI 低有效、逻辑 `true` 为点位状态成立、DO 高有效及 `false` 软件安全目标。`IO_IN` 返回已归一化
  布尔值，项目 `logic.c` 不再反相；DO 按开关量请求写入，不将软件 `false` 断言为物理设备已停止；
- 使用 `name + description` 识别启停控制、运行反馈、故障、许可、频率反馈等业务角色，再用
  `type + direction + bind + unit + safe_value` 校验；
- `description` 与结构字段冲突、同一角色多候选或必要角色缺失时，停止生成并返回需求确认；
- 输出请求、RTU/模块回读和真实运行反馈必须是不同语义，不能因名称相近而合并。

## 北向 HMI 白名单与地址稳定

- 新项目只报送 HMI 操作、监控、报警、设定和必要维护实际使用的业务字段，生成后核对“冻结白名单 =
  北向集合”；
- 对每路已接线且已配置工程量程的 AI 仪表，把转换后的工程值映射为只读北向测量字段；复用冻结需求的
  单位、短名和 bind，保证 HMI 直接显示该值。无效采样/量程/换算须让 HMI 能识别为无效，不能发布
  伪有效的 0 或旧值；原始电流/码及换算中间量默认不重复暴露；
- 每台受控设备声明独立只读 `<设备>_F_L`；按设备归属契约生成故障记录、可见分项和复位矩阵。
  硬接故障有效即置 `*_F_DEV`，DI 恢复未复位仍保持；需要的实时 DI 另以 `*_FLT` 只读暴露。
  每扫描总故障等于可见报警分项 OR（含 F_DEV，不含实时 FLT），不另锁存不可见总故障。有效 RST 同拍清允许的本机记录
  （含已解除的硬接历史）并重汇总，活动根因优先；本机恢复遵守恢复白名单，不直接改原始 DI/输出，不改模式或他机；
- 字段名符合 `HMI_SHORT_V1`，必须逐字复用冻结需求中“中文业务语义 → 统一短名 → bind”映射，
  同一语义只能使用共享词典的唯一缩写；字段具有中文 `description` 和明确页面/用途；内部状态机、临时量、上一拍、
  时间戳、确认中、重试和调试字段默认不发布；
- 修改已有项目时，以现有已发布点表为兼容基线，保留原字段名称、类型、访问权限、地址、宽度和顺序；
- 新字段只追加到不冲突的空闲地址，正确计算 32 位值的寄存器宽度，不重排、不压缩旧地址；
- 新项目按固定的字段分类和声明顺序确定性分配地址，并在冻结或生成结果中输出完整地址表；
- 删除、改名、改类型、改权限、改地址或复用历史地址均属于兼容性变更，必须有用户确认和差异记录。

完整字段选择和缩写表见 [北向 HMI 点表契约](northbound-contract.md)。

## C 审查顺序

```text
读取输入值和 quality
→ 形成保护、故障和许可
→ 消费命令并解决冲突
→ 推进状态机和功能块
→ 统一产生全部最终输出
→ 更新可观测 state/诊断
```

任何提前返回前都必须保证本轮全部输出为安全值，并且不会跳过框架要求的业务逻辑。输入质量默认安全
收敛不代表现场策略已经确认。

双向阀、闸门在唯一最终输出处执行 [双向反转保护](control-timing-contract.md#阀门双向反转保护)：
手动先独立STOP、全断满 `2000 ms` 后新命令，拒令清本次请求；自动先全断至少 `2000 ms` 再复核原条件。
逐阀保护历史和全断起点跨扫描保存，不能被复位/模式切换/控制器停启清掉；停止及提前返回路径同样记录。
等待不启动行程监督或记录实际动作时间，不新增北向调试状态或可调小于2秒的参数。

多设备生成前先按 [PLC 设备单体与共享工艺归属契约](device-ownership-contract.md) 将冻结需求的逐台
owner 表逐行映射到配置、状态、输出与测试；公共液位/压力、阈值、PID、目标台数及调度保留唯一
共享 owner。不得将单体命令/故障/周期参数合并为组变量，也不得复制共享工艺量凑逐台字段。
多设备手自动必须先分域计算，再逐设备选择 owner，禁止用同一个 `requested_on[]` 同时承载两种模式：

```text
consume_manual_commands_per_device(manual_request[])
auto_pool = {i | auto_selected[i] && device_permitted[i] && input_good[i]
                 && !device_fault[i] && capability_matches[i]}
if group_auto_enabled:
    calculate_auto_demand_and_dispatch(auto_pool, auto_request[])
else:
    do_not_advance_auto_dispatch

for each device i:
    selected_request = auto_selected[i] ? gated_auto_request[i] : manual_request[i]
    final_output[i] = apply_device_permit_and_frozen_shared_safety(i, selected_request)
```

`group_auto_enabled` 缺省为 true；若需求设组级使能，也不得替代 `auto_selected[i]`。`gated_auto_request[i]`
在组级禁止、设备退出自动或失去许可时按冻结策略安全收敛，不能沿用旧自动请求误启。手动运行设备不进入
自动候选池，但其真实运行反馈和未知/启动中状态仍计入容量、互锁与安全判断。候选不足和联动下游未选择
自动时执行冻结的降级/禁止与诊断，不得借自动调度启停手动设备。
远程 `GOOD + false` 只走许可/owner 禁止分支，不写设备故障、不合入总故障、不创建远程故障锁存或
复位依赖；拒绝的动作不启动监督，许可移交取消被中止动作监督而不误报停机/行程失败。质量失效及
真实故障仍独立处理，具体边界见设备归属契约。
套用 T01/T02 时不得把普通远程许可直接并入会锁存故障的安全/方向 permit；无法正确隔离许可移交的
模板按 CUSTOM_REVIEW_REQUIRED 适配，保留真实安全保护并补负向测试。
逐台切换首拍必须按冻结策略处理旧 `manual_request[i]` 和 `auto_request[i]`；缺少特殊无扰移交要求时，
默认不复用旧启动请求，保留 AUTO 或参数补齐不产生新使能。独立周期按冻结首阶段接受新的 AUTO
投入作为本机周期使能，首阶段未另定则执行 FIRST_RUN：已停设备合法投入当拍发启动请求；已运行
设备不做额外启停处理，保持合法输出，直接从切入当拍开始运行计时，不重发启动命令/脉冲、不重新
进入启动等待、不清累计。此规则只用于手动转独立周期自动，其他无扰移交
另定，不能把任意模式值变化或旧自动请求当成新手动启动。

定时自动启停/轮换时，对每台参与设备分别读取其 `run_duration[i]`、`stop_duration[i]` 并独立
推进阶段计时，不能用一对全局时长或一个共享 Timer 隐式覆盖全组。时长参数按冻结单位、范围与
零值语义校验；未填/非法时禁用相关设备的自动周期并给出诊断，不把 0 当“立即不停切换”。
运行与停止阶段的起算事件须按需求冻结；有可信真实反馈时优先建议分别从运行确认与停止确认起算，
不能把 DO 撤销当作设备已停止。单台参数在线更新只影响该台计时，按
[计时契约](control-timing-contract.md) 的已冻结成对下完整周期/会话快照/实时保留已用时变体处理；
明确首次阶段、在线0、缩短至已过时长、时间回绕及暂停/故障/模式切换。保护停机永远不等运行时长到期。
阀门单序列的排泥开放时长、阀间启动间隔和整轮间隔不是电机独立运行/停止周期，按
[F07](field-control-patterns.md) 使用各自真实起点；明文共用设定保留，各阀监督、模式和复位仍独立。

手动分支不得调用自动选泵、自动顺控、自动联停或“保持需求台数”逻辑；手动启动/停止一台时，不得为
满足自动目标台数而启停另一台。模式切换清理未选模式内部计时须与设备输出仲裁分开，不能顺带改写另一
模式请求。特殊手动联动必须来自冻结需求，不能从自动代码复用时意外带入。

## 认证模板契约

- `application/case_center/standard_templates/catalog.yaml` 是认证状态唯一来源；目录名、案例名或一段能
  编译的 C 都不能自行宣称为标准模板；
- 项目 README 必须记录模板 ID，未命中时记录 `CUSTOM_REVIEW_REQUIRED`；
- `certified` 模板只能做业务点、状态字段和冻结参数的薄适配，不得移除 catalog invariants；
- 单泵优先 `T01_SINGLE_PUMP_SUPERVISOR`，双向互斥优先 `T02_MUTUAL_INTERLOCK`，PID 外围优先
  `T03_PID_LOOP_GUARD`，边沿/定时器统一遵循 `T04_EDGE_TIMER_USAGE`，运行时间统一遵循
  `T05_RUNTIME_COUNTER_USAGE`；
- 模板主机测试与项目测试必须同时存在。项目测试至少复制与当前场景相关的负向不变量，不能只验证正常
  启动或最终输出；
- 修改认证模板属于跨项目平台变更，必须同步实现、guide、catalog 和 CTest，不能在单个项目里静默分叉。

## 测试选择

生成前把冻结的逐级/逐步转移、模式、故障/恢复表逐行映射到代码和测试，不凭正常流程自行补分支。
有 `engineering_review.control_features` 时覆盖其所有必需场景；异构能力池不混排、并联容量包含未知
运行及启动中设备，不能把软件撤 DO 当作停止确认。调试占位未解除的禁用路径必须真实可执行。

- 纯组合或简单状态逻辑可直接构造 `LogicContext`；测试自行清 one-shot。
- Timer、Edge、Counter、Latch、Debounce、Filter、Rate Limit、PID、runtime、STOP/Reset/FAULT_SAFE 与
  安全提交必须通过真实 LogicManager 扫描。
- runtime 项目还必须覆盖首拍/毫秒余数、质量暂停与恢复、tick 回绕、STOP/FAULT 暂停、U32 饱和、
  异步 clear/pending、保存重载和存储失败诊断；主机测试不能替代 EEPROM 写中掉电和寿命 HIL。
- 至少覆盖正常、所有输入质量状态、冲突命令、时间边界与回绕、STOP/Reset、安全值、参数边界、反馈
  超时和恢复。只实现需求实际涉及的分支，但不能省略安全分支。
- 多台可手动设备声明 `MANUAL_MULTI_DEVICE`，覆盖 `MANUAL_INDEPENDENCE` 与 `MODE_ISOLATION`：逐台命令
  后比较所有设备请求/输出快照；在自动需求、候选、阶段、定时同时变化时证明手动无串扰。明文手动联动
  另测允许的唯一跨设备影响，不能用其删除独立性基线测试。
- 多台设备存在自动控制时声明 `PER_DEVICE_AUTO`，覆盖 `AUTO_SELECTION`、`AUTO_POOL_ELIGIBILITY`、
  `AUTO_MODE_ISOLATION`：逐台选择切换、混合手自动运行、手动设备计入真实容量但不可被自动调度、自动
  候选不足、联动下游不在自动、重新进入自动不沿用旧请求及其他设备无串扰。
- 自动按时运行/停止或定时轮换声明 `TIMED_AUTO_CYCLE`，覆盖 `CYCLE_PER_DEVICE_PARAMETERS`、
  `CYCLE_TIME_BOUNDARY`、`CYCLE_INSTANCE_ISOLATION`、`CYCLE_PARAMETER_UPDATE`：逐台不同设定、
  到时前/等于/之后、改单台参数与模式/故障中断后重入均断言其他设备不串扰。
- 声明 external input 时必须覆盖 `EXTERNAL_INPUT_LIFECYCLE`，通过真实管理器路径验证首次报文、同值
  刷新、时效等号/超时、非法写入、断流计数及恢复不误启；不能仅直接改 LogicContext 的 value。
- 每个冻结场景在测试中使用 `PLC_TEST: <场景 ID>` 标签；测试包含 Given/When/Then、调用项目逻辑或
  真实管理器路径，并具有可执行断言。场景标签只用于可追溯性，不能代替断言。
- 每台设备覆盖其独立 `*_reset_faults` one-shot（单设备旧 `reset_faults` 可兼容）：本机命令仅清本机
  需求列明的软件故障点位/锁存，客观故障在同扫描保持或重新置位；复位按恢复白名单恢复本机 READY、监督计时和重投许可，丢弃旧请求；不得直接改物理输出，不改模式、参数或 runtime，健康运行不额外断开或建立输出。多设备
  声明 `PER_DEVICE_FAULT_RESET`，逐台与双命令同拍验证 `DEVICE_RESET_OWNERSHIP`、
  `DEVICE_RESET_ISOLATION`；无可复位软件故障的本机命令须幂等，不得借系统复位清其他设备。
- 每台受控设备以真实扫描断言总故障：硬件故障单独为 true、任一软件故障单独为 true、两者同时为 true；
  复位后硬件故障仍在则总故障不清，只有所有来源均消失时才为 false。多设备断言故障归属不串扰。
- 使用认证模板时，对照 catalog invariants 逐项建立断言；自定义结构必须增加完整状态转移表、非法状态
  收敛和人工审查记录。

## 质量与标准声明

- 新项目必须通过 [PLC 风格控制逻辑质量门禁](logic-quality-gate.md) 的 `--strict-quality` 检查；
- README 采用 [PLC 工业控制标准符合性声明](standards-compliance.md) 的固定矩阵；
- 只有严格门禁通过才可声明 `KZ3 PLC_STYLE_V1` 符合，且结果限定为 host-only；
- IEC 61131-3 和 PLCopen 只能说明工程概念或选定原则对齐，不得宣称第三方认证；硬件、功能安全、SIL
  和 MISRA C 在没有专项证据时明确写“未建立符合性证据”。
