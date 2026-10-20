# 机器可读需求契约

项目 README 中必须保留一个由下列注释包围的 YAML 块：

````text
<!-- KZ3_REQUIREMENTS_CONTRACT_BEGIN -->
```yaml
requirements_contract:
  schema: kz3-requirements/v1
  ...
```
<!-- KZ3_REQUIREMENTS_CONTRACT_END -->
````

完整初始结构以 `assets/project-requirements-template.md` 为准。该块只表达门禁结论；详细业务规则、证据
路径和 Given/When/Then 仍写在 README 正文，不能把正文压缩成几个布尔值。

## 状态

- `DRAFT`：允许证据为 `pending`、确认项为 `false`、`open_items` 非空；可交付完整草案与验收设计，不生成可运行源。
- `BLOCKED`：已完成当前可做工作，但有外部证据或关键决策阻塞；不能生成可运行项目源。
- `FROZEN`：`version` 和 `project_id` 明确，点位/安全/控制依据非占位，十项确认全部为 `true`，
  `open_items: []`；才允许进入生成和严格验证。

十项确认分别约束：交付范围、点位角色、输出安全值、模式唯一 owner、冲突/保护优先级、坏质量策略、
故障复位范围、自动恢复策略、时间单位与阈值边界、北向白名单。确认项必须由正文中的事实和证据支持，
不能为了通过脚本机械改成 `true`。

一个需求文档只保留一个有效契约块，历史契约移入版本记录，不能并列两个块让工具取第一份。
YAML 禁止重复 key，避免后写值静默覆盖原结论。冻结只关闭设计阻塞；已冻结禁用行为的调试项及 HIL
待办仍在正文逐项保留，见 [完整性门禁](completeness-gate.md)，不把 FROZEN 当成现场投用许可。

`traceability` 使用相同的十个 key，把每项确认指向 README 小节、表格编号或证据位置。冻结时每个引用
必须是明确字符串，不能写 `pending`；引用存在只证明可追溯，仍需工程师核对内容是否足以支持结论。

## 测试场景契约

新增需求在 `engineering_review.control_features` 列出实际控制特征（无命中用 `[]`）：

| 特征 | 必须声明的验收场景 |
| --- | --- |
| STAGED_GROUP | STAGE_TRANSITIONS、CAPACITY_OWNERSHIP、TIME_BOUNDARY、TICK_WRAP、PARAMETER_UPDATE |
| HETEROGENEOUS_GROUP | HETEROGENEOUS_REPLACEMENT、CAPACITY_OWNERSHIP |
| PID_LOOP | PID_OWNER、PID_TRANSFER、PID_TUNING |
| MANUAL_MULTI_DEVICE | MANUAL_INDEPENDENCE、MODE_ISOLATION |
| PER_DEVICE_AUTO | AUTO_SELECTION、AUTO_POOL_ELIGIBILITY、AUTO_MODE_ISOLATION |
| TIMED_AUTO_CYCLE | CYCLE_PER_DEVICE_PARAMETERS、CYCLE_TIME_BOUNDARY、CYCLE_INSTANCE_ISOLATION、CYCLE_PARAMETER_UPDATE |
| VALVE_TIMED_SEQUENCE | VALVE_TIME_ORIGINS、VALVE_SEQUENCE_ABORT、VALVE_SEQUENCE_SELECTION |
| POSTRUN_LINKAGE | POSTRUN_TIME_ORIGIN、POSTRUN_RETRIGGER、POSTRUN_SAFETY_ABORT |
| PER_DEVICE_FAULT_RESET | DEVICE_RESET_OWNERSHIP、DEVICE_RESET_ISOLATION |
| DEVICE_FAULT_COHERENCE | FAULT_LATCH_LIFECYCLE、FAULT_VISIBLE_COHERENCE、FAULT_RESET_COHERENCE |

组合特征取并集；未知特征、重复特征及缺少场景会失败，草案也要先规划完整场景。
新建/重新冻结含设备总故障的控制项目声明 `DEVICE_FAULT_COHERENCE`；正文按设备归属契约列故障
来源、锁存、北向可见分项、汇总与复位条件。短暂硬接故障恢复后保留，实际北向总故障每拍等于
可见分项 OR，有效复位同拍清允许的记录并重汇总；软件锁存包括硬接故障历史，不改写现场 DI。
无硬接输入只测适用软件来源；脚本检查特征/场景结构，不能代替真实扫描/北向读值断言。
同一控制器有多台受控设备且存在自动控制时必须声明 `PER_DEVICE_AUTO`；正文逐台列明自动选择和
候选资格。脚本只能检查已声明特征到场景的结构关系，不能自动识别漏报特征或证明设备确已逐台选择，
这两项必须在语义审查和项目测试中核对。
许可与故障须分域：有效远程反馈未成立只禁止控制，不作为设备故障/总故障来源或复位前提；正文与
反馈/模式验收按设备归属契约覆盖许可移交，不能用结构门禁通过冒充已证明“无远程误报故障”。
多设备控制项目必须声明 `PER_DEVICE_FAULT_RESET`；正文逐台列出复位命令、可清软件故障清单、
不可清客观故障与复位后本机/他机总故障预期。`RESET_FAULTS` 基础场景按恢复白名单验证本机重新可用、旧启动不恢复，以及不改模式、参数和 runtime；新增场景验证复位归属与跨设备隔离。单设备旧接口可保留。
自动运行/停止时长构成周期或定时轮换时必须声明 `TIMED_AUTO_CYCLE`，正文列出每台参与设备的
运行时长、停止时长、单位、有效范围、北向 bind、默认/调试状态、首阶段、计时起点与在线变更策略。
独立周期未明定首阶段时沿用 FIRST_RUN：已停设备合法手动切 AUTO 先启动；已运行设备不做额外启停
处理，直接从切入开始运行计时。写入正文“沿用规则”，不是待用户再次采纳的新决策。
例外和恢复按计时契约记录。脚本只
验证特征到场景的结构关系；每台参数是否成对、是否被代码实际使用，须对照点位和测试语义复核。
特征由智能体依据点位和原文判别，不要求用户填写。旧文档可缺省此字段以保持兼容；脚本不靠中文关键词
猜工艺，因此字段遗漏仍需语义审查，不能把空列表当成已审核不适用。标签与声明通过不证明行为覆盖。

阀门定时轮次顺控声明 `VALVE_TIMED_SEQUENCE`：正文按 [计时契约](control-timing-contract.md) 分开
开/关行程、开位停留、阀间间隔和整轮等待；测试真实计时起点、两轮、异常停轮/未知关位禁止新开、
AUTO 候选取消/新加入与混合手动移交。仅手动开关阀不声明该特征；单序列阀组不机械声明电机独立周期。
凡控制开/关两个方向的阀、闸门，不论是否定时顺控，都直接沿用计时契约的
[双向反转保护](control-timing-contract.md#阀门双向反转保护)，在 `required_scenarios` 加入
`NEGATIVE_SWITCH_WINDOW`、`TIME_BOUNDARY`、`TICK_WRAP`，与已有 `COMMAND_CONFLICT`、`STOP_SAFE`
共同覆盖逐阀、双向、手动独立STOP/早到丢弃/到时新命令及已有自动流程的等待和复核。
在 `feedback_interlocks`、`timing_parameters` 正文追溯全断起点和恢复不绕过规则；这些是语义审查要求，
脚本不自动识别阀门拓扑或证明无命令排队。纯手动不为满足验收新增自动流程。
自动联动清料/延停声明 `POSTRUN_LINKAGE`：测试从冻结的上游停止事件起算、新需求取消/重建延停、
安全异常中止与手动不继承延停。旧项目诊断不为适配新特征直接改现场契约。

新项目同时添加 `engineering_review.profile: TABLE_CONTROL_V1`，执行命令追加
`--require-engineering-review`。旧 v1 契约保持兼容，未启用该选项且无工程表时不检查扩展；一旦存在工程表，
即使没有选项也必须验证。所有自称 `FROZEN` 的文档都会执行冻结检查，不能借普通结构命令接受虚假冻结。

`engineering_review.decisions` 是建议记录列表，每项包含唯一大写 `id`、`status: proposed|accepted`、
`proposal`（已展示方案）、`selection`（采纳选项）、`basis`（用户回复或有效既有决策依据）。草案可用
pending；accepted 项必须完整，冻结时不允许 proposed。已有需求无新增建议时允许空列表。

`engineering_review.boundaries` 必须包含 [点表工程规则](table-input-engineering.md) 的全部 11 个域。
每项含 `status: pending|specified|not_applicable`、`rationale`（正文规则引用或不适用理由）、`scenarios`
（已声明 ID 的列表）。specified 必须引用该域规定的基本场景；not_applicable 不挂场景且必须有理由；
pending 只允许在草案。示例：

```yaml
process_arbitration:
  status: specified
  rationale: 第7节，D01已采纳，液位差需求与定时需求取OR
  scenarios: [DEMAND_PRIORITY]
```

这是结构与追溯校验，不是签核真实性、功能覆盖或安全证明。正文语义、not_applicable 是否合理、测试是否
执行真实路径仍按 [安全与可靠性审查](safety-reliability-review.md) 复核；HIL 结果另表管理，不用它阻止
已经具备明确设计依据的隔离主机开发。

`verification.required_scenarios` 至少包含：

- `NORMAL_PATH`
- `BAD_QUALITY`
- `COMMAND_CONFLICT`
- `STOP_SAFE`
- `RESET_FAULTS`

脚本还会按项目特征要求：定时或 `_ms` 逻辑增加 `TIME_BOUNDARY`、`TICK_WRAP`；runtime 增加
`RUNTIME_PERSISTENCE`；通信设备增加 `COMMUNICATION_LOSS`；主备、轮换、替补、正反转、互锁或切换
增加 `NEGATIVE_SWITCH_WINDOW`；external input 增加 `EXTERNAL_INPUT_LIFECYCLE`。每个已声明场景必须在 `logic_project_test.c` 中出现
`PLC_TEST: <场景 ID>` 注释，并具有实际断言。

## 命令

脱离目标工程使用技能时，直接校验需求文件：

```sh
python3 <skill目录>/scripts/verify_project.py --requirements-file <需求文件.md> --require-engineering-review
```

准备冻结追加 `--require-frozen`。结果为 `document-only`，只检查需求契约；不声明工程适配、编译或
主机行为通过。已有目标工程时再执行以下项目级检查。

需求草案结构检查：

```sh
python3 .opencode/skills/kz3-control-engineer/scripts/verify_project.py \
  application/projects/<项目目录> --requirements-only --require-engineering-review
```

冻结前检查：

```sh
python3 .opencode/skills/kz3-control-engineer/scripts/verify_project.py \
  application/projects/<项目目录> --requirements-only --require-frozen --require-engineering-review
```

`--strict-quality` 会再次强制执行冻结契约，并检查 `project_id` 与 `project_io.yaml` 一致，因此不能绕过
需求阶段直接声明项目通过。
