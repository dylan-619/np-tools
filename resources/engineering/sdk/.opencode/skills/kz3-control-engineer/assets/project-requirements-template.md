# 【项目名称】——需求草案

> 状态：DRAFT / 不参与构建 / 不驱动硬件
>
> 需求版本：【待确认】
>
> 点位来源：【文件路径或待提供】

<!-- KZ3_REQUIREMENTS_CONTRACT_BEGIN -->
```yaml
requirements_contract:
  schema: kz3-requirements/v1
  status: DRAFT
  version: pending
  project_id: pending
  evidence:
    point_source: pending
    safety_source: pending
    control_source: pending
  confirmations:
    scope: false
    point_roles: false
    output_safe_values: false
    mode_owner: false
    priority: false
    bad_quality_policy: false
    reset_scope: false
    auto_restart_policy: false
    timing_units_and_boundaries: false
    northbound_whitelist: false
  traceability:
    scope: pending
    point_roles: pending
    output_safe_values: pending
    mode_owner: pending
    priority: pending
    bad_quality_policy: pending
    reset_scope: pending
    auto_restart_policy: pending
    timing_units_and_boundaries: pending
    northbound_whitelist: pending
  northbound:
    profile: HMI_SHORT_V1
  verification:
    execution_profile: PLC_EXECUTED_V1
    required_scenarios:
      - NORMAL_PATH
      - BAD_QUALITY
      - COMMAND_CONFLICT
      - STOP_SAFE
      - RESET_FAULTS
  open_items:
    - pending
  engineering_review:
    profile: TABLE_CONTROL_V1
    control_features: []
    decisions:
      - {id: D01, status: proposed, proposal: pending, selection: pending, basis: pending}
    boundaries:
      io_semantics: {status: pending, rationale: pending, scenarios: []}
      ownership: {status: pending, rationale: pending, scenarios: []}
      startup_recovery: {status: pending, rationale: pending, scenarios: []}
      process_arbitration: {status: pending, rationale: pending, scenarios: []}
      feedback_interlocks: {status: pending, rationale: pending, scenarios: []}
      measurement_quality: {status: pending, rationale: pending, scenarios: []}
      timing_parameters: {status: pending, rationale: pending, scenarios: []}
      fault_reset: {status: pending, rationale: pending, scenarios: []}
      communication: {status: pending, rationale: pending, scenarios: []}
      retention: {status: pending, rationale: pending, scenarios: []}
      hmi_contract: {status: pending, rationale: pending, scenarios: []}
```
<!-- KZ3_REQUIREMENTS_CONTRACT_END -->

上面的 YAML 是需求门禁输入，不是面向现场人员的正文。`DRAFT/BLOCKED` 可以保留 `false`、`pending`
和未决项；改为 `FROZEN` 前，必须填写稳定版本和项目 ID、给出点位与安全值证据、把全部确认项设为
`true`，补齐由项目特征要求的测试场景，并将 `open_items` 清空。

## 1. 用白话说要做什么

【用三到八句话说明设备怎么启动、正常怎么运行、什么时候停止或切换。】

## 2. 正常流程

1. 【第一步】
2. 【第二步】
3. 【第三步】

## 2.1 PLC 工程师既定方案保留与边界匹配

原方案版本/出处：【当前有效文档或输入】。PLC 工程师提供既定工艺；本次只补点表与需求中省略的实现边界。

| 原条款 ID | 原文要求及点位证据 | 必须保持的工艺/接口 |
| --- | --- | --- |

| 原条款 / 点位 | 案例变体 / 边界 ID | 匹配结论 | 缺失边界与建议补充 | 影响 / 采纳依据 | 验收场景 |
| --- | --- | --- | --- | --- | --- |

匹配结论使用 MATCHED/GAP/CONFLICT/UNSUPPORTED/NOT_APPLICABLE；已明确项直接继承，只有缺口需要
补充卡。冲突保留两方证据，能力不足说明缺信号或接口；不适用写理由。明文工艺变更单列，不伪装成补充。

## 2.2 缺口补充建议与采纳记录

匹配场景：【Cxx 场景名称】；主模式/模板：【Pxx / Txx 或 CUSTOM_REVIEW_REQUIRED】

| 决策项 | 推荐方案 | 推荐理由 | 可选替代及影响 | 结论 |
| --- | --- | --- | --- | --- |
| 【例如启停冲突】 | 【建议停止优先】 | 【避免冲突误启】 | 【其他方案及风险】 | 待确认/采纳/改写 |

对常规 PLC 软件结构先给建议，用户只确认业务结果；端子、极性、安全值、真实反馈、硬保护和量程等不能
推导的内容列入第 10 节证据阻塞项，不用经验值填充。

## 3. 从点位描述识别出的设备角色

先建立控制关系：对象/可替换能力池、测量与质量、工艺需求、许可/保护、调度、输出、真实反馈及唯一控制者。
组合控制填写逐级/逐步转移表（前态、条件、连续时间、取消条件、动作、完成反馈、超时、恢复），不能只写正常流程。
软件细化、工艺裁决、调试/物理证据分别列出；已有授权项不重复提问，用户通常只裁决 1～3 组关键分歧。

原始表版本/出处：【输入或文件版本】；使用点数：【数量】；备用点数：【数量】。
本点表编号约定：A11 为控制器本机，A12 为从站 1，A13 为从站 2；硬件型号单列，不能用编号代替型号。
从站未指定串口时默认 `rs485_1`，有明确指定或既有证据时按其执行；波特率等通信参数单独记录。
表格含模块分组时，先保留“柜体、模块标识/型号、通道、原文/行号、业务角色、使用/备用、证据”归一化表；
不要将不同模块的同名通道合并，不向备用点分配工艺用途。

| 业务角色 | 点位字段 | 描述依据 | 类型/方向/bind | 控制请求/模块回读/真实反馈 | 状态 |
| --- | --- | --- | --- | --- | --- |

说明所有冲突和缺失。输出请求、模块回读和真实设备反馈要分开写。

多设备先按 [PLC 设备单体与共享工艺归属契约](../references/device-ownership-contract.md) 填完归属表；
一台设备未在表内或共用量作用范围不明时保持 DRAFT。没有该设备业务的列写“不适用”，不能凭空
生成参数或命令。

| 设备/角色及物理点 | 手动命令/请求 | AUTO 选择/自动请求 | 输出/真实反馈 | 专属参数、计时与累计 | 硬件/软件/总故障及本机复位 | 必要北向点/验收场景 | 来源与状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 【逐台填写，不含备用】 | 【命令归属】 | 【候选资格或不适用】 | 【唯一 owner】 | 【仅实际业务】 | 【独立归属】 | 【短名/bind/场景】 | 【已明确/建议/待补】 |

| 共用工艺或安全对象 | 唯一 owner | 作用设备/边界 | 失效与恢复 | 来源与状态 |
| --- | --- | --- | --- | --- |
| 【公共测量/阈值/PID/需求台数/仲裁/联动/安全互锁】 | 【唯一】 | 【明确范围】 | 【安全结果】 | 【已明确/建议/待补】 |

对输入点逐台查独立真实运行反馈，按下表补齐运行累计，不按设备名称排除；只有开、关到位反馈的
阀门不要求。仅采集项目仍要填有真实运行反馈的设备。`*_RUN_M` 周期运行时长不是 `*_RT_S` 累计秒数。

| 设备 | 真实运行反馈点及有效语义 | runtime 名称 / trigger | 只读 `*_RT_S` | 本机 `*_RT_CLR` | 例外或槽位兼容性 |
| --- | --- | --- | --- | --- | --- |
| 【逐台有真实运行反馈的设备】 | 【point 名、GOOD、active_value】 | 【唯一、稳定名称】 | 【runtime.<name>.seconds，u32 秒】 | 【runtime.<name>.clear；内部 clear_pending 不对北】 | 【无则写无；超过16槽需阻塞】 |

上述每台设备在 `verification.required_scenarios` 包含 `RUNTIME_PERSISTENCE`，以真实扫描覆盖 GOOD+
有效反馈累计、坏质量/STOP/Reset 暂停、恢复不补记、逐台隔离和持久化；每个已声明 runtime
都配套本机 one-shot 清零和存储诊断；内部 pending 用于验证完成，不对北发布，且不与故障复位混用。

### 3.1 点位拓扑默认建议卡

| 决策 ID | 点位证据 | 推荐驱动方式 | 推荐细节 | 用户采纳/改写 | 状态 |
| --- | --- | --- | --- | --- | --- |

单启停 DO 默认建议保持型；启动/停止双 DO 默认建议脉冲型并以 `500 ms` 为可调初值；阀门开/关 DO 加
开/关到位默认建议行程保持、到位撤销。若手册或接线证据冲突，记录差异并以证据为准。

多台设备出现手动控制时，默认合并为一张建议卡：每台独立手动，手动/自动请求分域；除明文手动联动
或共用安全保护外，操作一台不改变其他设备。用户只需整组确认，不逐台询问。声明
`control_features: [MANUAL_MULTI_DEVICE]` 并加入 `MANUAL_INDEPENDENCE`、`MODE_ISOLATION` 场景。

多台设备有自动控制时，在同一建议卡中默认补充“逐台自动选择”：每台受控设备都有独立 `*_AUTO`；
组级自动使能若有，只作附加许可。声明 `PER_DEVICE_AUTO`，加入 `AUTO_SELECTION`、
`AUTO_POOL_ELIGIBILITY`、`AUTO_MODE_ISOLATION` 场景；`control_features` 同时命中手动和自动特征
时取并集。用户只需整组确认，不逐台追问。

| 设备 | 逐台自动选择及北向短名 | 手动请求/自动请求 owner | 自动候选资格 | 手动运行占用的容量/共享资源 | 退出/重入自动策略 |
| --- | --- | --- | --- | --- | --- |
| 【逐台填写】 | 【例如 M1_AUTO】 | 【分域】 | 【许可/质量/故障/能力】 | 【真实反馈/未知处理】 | 【防旧请求误启】 |

另列候选不足、自动联动依赖设备未选自动时的禁止/降级、诊断和恢复；自动逻辑不得为了凑目标台数
启停手动设备。已发布全局模式接口若与逐台选择冲突，记录兼容性与迁移决策，不静默改址。

## 4. 哪些是可调整参数

| 参数 | 白话用途 | 默认/范围/单位 | 是否北向可调 | 来源与状态 |
| --- | --- | --- | --- | --- |

自动按时运行/停机或定时轮换时，逐台列参数，不用“全组运行时间/停止时间”替代；例如 `M1_RUN_M`、
`M1_STP_M`、`M2_RUN_M`、`M2_STP_M` 均为独立可读写时长。即使初值一样，bind、计时实例和在线修改
影响范围也必须逐台区分。PLC 初步需求明文规定共享时长则保留原文并记录例外及影响，不静默套默认。

| 参与设备 | 自动运行时长短名 / bind | 自动停止时长短名 / bind | 单位 / 有效范围 / 初值证据 | 起算、切换和在线变更策略 |
| --- | --- | --- | --- | --- |
| 【逐台填写】 | 【例如 M1_RUN_M / parameter.m1_run_min】 | 【例如 M1_STP_M / parameter.m1_stop_min】 | 【已定数值或调试占位】 | 【与其他设备独立】 |

声明 `TIMED_AUTO_CYCLE` 并加入 `CYCLE_PER_DEVICE_PARAMETERS`、`CYCLE_TIME_BOUNDARY`、
`CYCLE_INSTANCE_ISOLATION`、`CYCLE_PARAMETER_UPDATE`。未知时长不得猜成可投运默认值；逐台标
调试前必填，未就绪时禁止该设备自动周期。此处“运行时长”不是 `*_RT_S` 累计运行时间。
独立周期首阶段未另定时直接写“手动切自动先启动，运行时长到后停止，停止时长到后再启动”；这是
已定 FIRST_RUN 默认，不列为反复确认问题。已运行设备不做额外启停处理，保持合法输出，直接从切入
开始运行计时，不重发启动命令/脉冲、不进入启动等待、不清累计；
上电保留选择、故障恢复和参数补齐不算新投入，明文先停止等例外保留并注明来源。
按技能计时契约明确运行/停止反馈起算、成对下完整周期生效及在线0；阀单序列填写
开/关行程、开位停留、阀间与整轮时间，不因模板存在就填无用途的逐阀运行/停止参数。

明确 4–20 mA 时可填 `4.0f/20.0f` 接口端点；未知工程量上下限、液位高低限使用 `float 0.0f` 调试占位，
标记“调试前必填”。占位未解除或范围非法时禁止相关自动控制和报警，不得标记为现场已确认。

## 5. 哪些是一次性命令

| 命令 | 白话用途 | 允许条件 | 冲突时谁优先 | 来源与状态 |
| --- | --- | --- | --- | --- |

双向阀、闸门逐台列独立开/关/停 one-shot 命令；手动换向先单独STOP，双向全断满2秒后重新发令，
未停或早到反向命令丢弃，不排队。STOP与方向同拍只停，复位不能代替STOP；既有接口保持兼容。

每台受控设备逐台列 one-shot 故障复位及其可清软件故障；多设备不能只列 `SYS_RST`。推荐
`M1_RST -> command.m1_reset_faults`、`M2_RST -> command.m2_reset_faults`，单设备已发布
`command.reset_faults` 可兼容。复位一台不得清另一台软件故障；客观故障仍在时本机总故障保持。
按 reset-recovery-contract.md 逐台列恢复白名单：可清故障、本机 READY 转移、监督计时、重投许可、旧请求丢弃；另定 FRESH_START 或 CURRENT_AUTO_DEMAND。不得直接写输出，不改模式、参数、runtime 或他机。

| 设备 | 北向复位短名 / command bind | 可清本机软件故障 | 不可清故障 / 他机范围 | 本机和他机总故障预期 |
| --- | --- | --- | --- | --- |
| 【逐台填写】 | 【如 M1_RST / command.m1_reset_faults】 | 【逐项】 | 【硬件 DI、坏质量、其他设备】 | 【真实来源仍在则保持】 |

多设备声明 `PER_DEVICE_FAULT_RESET`，加入 `DEVICE_RESET_OWNERSHIP`、`DEVICE_RESET_ISOLATION`。
系统级软件故障如需单独复位，另写 `SYS_RST` 的专属范围；不能扇出清各设备。已有全局复位接口
若与逐台复位冲突，记录兼容与迁移决策，不静默改地址。

每台受控设备另列“故障来源 → 本机锁存 → 北向可见分项 → 分项 OR 总故障 → 可清条件/RST”的矩阵；
无硬接反馈明记无，不能造点。新项目实时 FLT 与硬接故障记录 F_DEV 分开；原始 DI 需要时只读暴露，
DI 恢复未复位仍保持 F_DEV。总故障汇总报警分项（含 F_DEV，不含实时 FLT）。软件中的可清锁存包含
已解除硬接故障的历史，不改写现场 DI。活动根因或必要质量不满足时不清，复位有效时
同拍清允许项并重汇总，不能只清总故障或显示字段。声明只读
`<设备>_F_L` 北向绑定。例如单台中心刮泥机：`M1_F_L -> state.total_fault`，说明写“中心刮泥机总故障”。
测试覆盖硬件、软件、并发和本机复位后硬件仍在；多设备不得共用一个设备总故障 state。
新建/重新冻结有设备总故障的控制项目声明 `DEVICE_FAULT_COHERENCE`，加入
`FAULT_LATCH_LIFECYCLE`、`FAULT_VISIBLE_COHERENCE`、`FAULT_RESET_COHERENCE`；真实测试从
生成北向 name/bind 读值，每一步断言总故障等于可见分项 OR，覆盖根因恢复未复位、坏质量、
活动根因+复位、有效复位、多故障只清一项及他机隔离。旧实时 FLT 改绑需记录兼容性授权。

有启动/停止或阀门开/关动作的设备逐台填写适用的反馈监督。只有独立真实运行反馈、本机已确认运行
且仍要求运行，才列运行反馈丢失；只有实际故障 DI 才列硬接故障。只有开、关到位反馈的阀门只列
开阀、关阀超时，不列运行累计或运行/到位丢失；不把 DO、通信错误或软件超时假写成硬接故障。
未指定时直接沿用已定共性默认：继电器控制泵/机器启动 `5000 ms`、停止 `30000 ms`，运行反馈丢失
滚动窗口 `5000 ms`；阀门开到位、关到位各 `120000 ms`。已给值、有效冻结契约及手册约束优先，
逐项填写数值及来源，不再次询问默认数字。运行丢失从已确认运行且仍要求运行时首次观测
`GOOD + 非运行` 起连续计时；GOOD 运行取消窗口，间断丢失不累计，不从上一拍运行提前起算。
明文要求的故障反馈或必需成功反馈缺点位时保持 DRAFT，除非用户明确接受降级并重写验收范围。

| 设备 | 硬接故障点/有效语义 | 启动/开阀成功反馈与超时 | 停止/关阀成功反馈与超时 | 运行反馈丢失窗口（适用时） | 故障锁存、输出与恢复 |
| --- | --- | --- | --- | --- | --- |
| 【逐台执行设备】 | 【真实 DI 或缺口】 | 【GOOD 反馈、实际动作起算、数值及来源】 | 【GOOD 反馈、实际动作起算、数值及来源】 | 【已确认运行后首次 GOOD 非运行起连续计时；继电器缺省 5000 ms 或不适用】 | 【本机复位、保护与不误启】 |

## 5.1 哪些是外部实时输入

只有其他采集器、业务机或上级周期写入、且本机要按最后接收时间判断有效性的当前值才列入本表；长期
设定仍是 parameter，单次动作仍是 command，现场反馈仍是物理 input。

| 业务名/含义 | 生产者与唯一写入 owner | 协议/北向字段 | 类型/单位/默认/范围 | 正常周期与最坏抖动依据 | stale/startup grace | INIT/断流/恢复/再启动策略 |
| --- | --- | --- | --- | --- | --- | --- |

每项必须在 `project_io.yaml` 声明 `external_inputs`，并具有唯一同类型 `read_write` 北向入口。默认值只
用于 INIT 占位，不作为启动许可；记录是否用 interruption_count 锁存中断及其复位方式。未给周期证据
时，非安全级联动先建议 `stale_after_ms: 30000`、`startup_grace_ms: 30000`，用户可一次确认或改写。

## 6. 需要看得到的状态

| 状态 | 白话含义 | 初始/置位/清除条件 | 只读 |
| --- | --- | --- | --- |

## 7. 故障、安全与恢复

- 【许可丢失、反馈超时、故障、急停、STOP、Reset、通信恢复和上电行为】
- 远程许可有效但未成立只禁止控制，不置设备故障/总故障，不新增远程故障点或复位要求；按设备归属
  契约分别填写许可移交/被中止动作监督、质量异常及真实故障，验收覆盖未远程期间无间接超时误报。
- 【逐设备适用的启动/开阀超时、停止/关阀超时、真实运行反馈丢失、实际硬接故障；超时前/到时及恢复】
- 【每个运行累计的独立清零、pending、存储诊断；清零与故障复位隔离】
- 【每个输出安全值及证据；不知道时明确写待确认】
- 【逐设备故障复位的本机清除范围、他机隔离、真实故障保持、不误启和恢复策略】
- 【自动/手动、就地/远程的唯一 owner；同一扫描冲突命令和保护优先级】
- 【坏质量、通信中断和重新上电后的输出及自动恢复策略】

## 7.1 时间、阈值与边界

有开/关双方向输出的阀、闸门时，直接沿用
[双向反转保护](../references/control-timing-contract.md#阀门双向反转保护)：逐台填连续全断
`>=2000 ms` 的起点、历史方向/独立STOP门禁及生命周期；自动换向先停、等满后复核原工艺条件，
行程监督从对应最终DO首次有效起算。加入 `NEGATIVE_SWITCH_WINDOW`、`TIME_BOUNDARY`、`TICK_WRAP`，
逐阀双向测1999/2000/2001 ms、早到不排队、模式/复位不绕过及已有自动分支。此项已定，不再列待采纳。

普通工艺阈值导致启停泵、加减泵或阀门切换时，默认列入 `PROCESS_THRESHOLD_CONFIRM_30S`，
`threshold_confirm_ms` 初值为 `30000 ms`。条件必须连续成立，到时前保持原需求；退出条件、质量失效、
模式/owner 改变或相关参数变化（含合法变更）/非法时取消并从 0 重计。急停、故障和保护动作不得使用该延时。

| 规则 | 数值/单位 | 比较关系 | 前一拍 | 等于阈值 | 后一拍 | tick 回绕 |
| --- | --- | --- | --- | --- | --- | --- |

所有延时、滤波、液位阈值、加减泵间隔、反馈超时和切换空窗都必须填写单位，并明确 `>`、`>=`、`<`、
`<=` 的等号归属。没有此结论不能冻结需求。

| 时间业务 / owner | 起算事件 | 中断/清除条件 | 首轮/恢复 | 在线参数生效点（完整周期/会话/实时） |
| --- | --- | --- | --- | --- |

只填写命中业务，不装入全部计时策略；故障复位、累计清零、正常计时取消、清料延停分别写明。
阀轮次顺控声明 `VALVE_TIMED_SEQUENCE`，自动清料延停声明 `POSTRUN_LINKAGE`，专项场景见机器契约。

## 8. 北向报送

已接线且配置工程量程的 AI 仪表逐路填写：`AI 通道 → 仪表 → 工程量程/单位 → 换算值 bind → 只读北向短名
→ 质量/有效性`。工程值供 HMI 直接显示；原始电流/码和缩放中间量默认排除，未标定或坏质量不能显示为
有效的 0。备用 AI 不生成测量字段。

采用 `HMI_SHORT_V1` 显式白名单，只报送上位机操作、监控、报警、设定和必要维护使用的字段。
先按共享词典建立“中文业务语义 → 统一短名 → bind”，本表名称将原样进入 YAML、生成点表和交付表，不得后续换用同义缩写。

允许类别不是全部必选。先给推荐的最小必要集合；每点说明用途和不发布的影响，无明确用途默认排除。

| 短名 | 中文含义 | bind | 类型/权限 | 地址 | HMI 页面/接口消费者 | 需求依据及不发布的影响 |
| --- | --- | --- | --- | --- | --- | --- |

缩写词典：【从共享词典引用的缩写及含义；若需新增，先更新共享词典再使用】

不报送字段及原因：【中间状态、临时量、内部时序、无用户动作诊断等】

最小化审查：【字段总数；重复语义检查；必要报警/质量/命令完成判据保留情况；兼容性例外】

已有项目地址兼容要求：【保留原地址和顺序；新字段追加；其他已确认策略】

## 9. 用实际场景验收

每个工程边界域在 `engineering_review.boundaries` 声明适用性、正文依据与场景。`specified` 表示需求已写
清楚，不表示测试已通过；`not_applicable` 必须有理由。工程建议用 `proposed/accepted` 和采纳依据记录，
未采纳项不得进入 FROZEN。场景表另外记录实现位置、测试函数/断言、实际结果；仅出现标签不能证明安全。

| 场景 ID | 当时是什么情况（Given） | 做了什么（When） | 应该看到什么（Then） | 主机/HIL/现场 |
| --- | --- | --- | --- | --- |

基础场景固定包含 `NORMAL_PATH`、`BAD_QUALITY`、`COMMAND_CONFLICT`、`STOP_SAFE`、`RESET_FAULTS`。
有启停/开关动作时为每台设备补适用的启动/开阀、停止/关阀超时；有独立真实运行反馈和持续运行目标
才补运行反馈丢失，有实际故障 DI 才补硬接故障。只有开、关到位反馈的阀门只补开、关超时。
有 runtime 时逐台补清零事务与他机隔离，不能只写 `RUNTIME_PERSISTENCE` 标签。
涉及定时/阈值时追加 `TIME_BOUNDARY`、`TICK_WRAP`；涉及主备、正反转、轮换或切换时追加
`NEGATIVE_SWITCH_WINDOW`；涉及 runtime 或通信设备时分别追加 `RUNTIME_PERSISTENCE`、
`COMMUNICATION_LOSS`；涉及 external input 时追加 `EXTERNAL_INPUT_LIFECYCLE`。项目测试用
`PLC_TEST: <场景 ID>` 注释与本表一一对应。

## 10. 还要确认的问题

需求阶段同时列出安全/稳定性及 HIL 验收条件：允许的最坏反应时间、重复/长稳负载、通信与掉电恢复、
测量方式及依据。先给建议供选择，不让用户自行设计测试。实现必需的安全时限未定不得冻结；仅缺硬件
测试环境则标待实板，不阻止已满足门禁的软件生成。完整项目后续按交付模板补齐配置说明、验证报告及
具体 HIL 步骤。

1. 【推荐方案是什么、为什么、用户只需确认的业务结果】

证据阻塞项：【只列无法从点位文件和现有说明确定、会改变物理安全或设备动作的现场事实，并说明需要的
原理图、手册、点表或实测记录】

## 11. 工程记录

在这里保存项目 ID、板型、扫描周期、质量策略、功能块、状态机和证据路径等生成所需细节。面向用户的
主体仍保持白话，避免要求用户先理解实现术语。

## 12. 标准与符合性

- KZ3 PLC_STYLE_V1：`PASS / FAIL / NOT_RUN`（只有 `--strict-quality` 通过才写 PASS，并标注 host-only）
- IEC 61131-3:2025：工程概念对齐；C 产物不构成 IEC 61131-3 编程语言符合性
- PLCopen Software Construction Guidelines：选定工程原则对齐；未做 PLCopen 认证
- IEC 61131-2、IEC 61508、IEC 62061、SIL、MISRA C：本次未建立符合性证据，不作合规声明

## 13. 冻结确认

只有阻塞问题为零才把状态改为 `FROZEN`。`AUTO_PROJECT` 模式沿用用户原始实现授权，自动补齐
`project_io.yaml`、`logic.c` 和 `logic_project_test.c` 并登记；需求专用模式只交付本文档，等待用户
以后提出生成请求。
