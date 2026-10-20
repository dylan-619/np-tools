# STM32-Logic 项目生成工作流

设备故障按设备归属契约生成锁存/可见分项/复位矩阵，硬接恢复不自清；总故障每拍为可见分项 OR。
新建有设备总故障的控制项目声明 `DEVICE_FAULT_COHERENCE`，实现三个专项场景，区分实时 FLT 与记录 F_DEV，
不复制旧综合 FLT 的混合语义，不修改已交付接口。

新项目读取 [安全与可靠性审查](safety-reliability-review.md)，需求冻结检查和最终严格检查均追加
`--require-engineering-review`。以已采纳的决策卡和 11 个边界域生成状态机与反例测试；场景名称不能
代替实际输入、扫描和禁止输出断言。

只在当前对话存在完整冻结需求，并且用户已明确要求生成，或 `AUTO_PROJECT` 原始授权仍有效时使用。原始
“做、实现、生成、创建、完成、跑通”等请求可以作为普通项目源生成授权，无需再要求用户重复确认。需求
门禁未通过时返回需求阶段，不得根据案例猜齐字段。

## 生成前

先完整读取 [端到端交付契约](end-to-end-delivery.md)，按其配置完整性、稳定性及 HIL 交付要求执行。

复核 PLC 原始需求保留表与边界差异表，按已采纳分支实现。水处理参考本技能的
[PLC 边界匹配](plc-boundary-matching.md)，不能用通用案例改写同步启动、并联关系或手动独立等明文。
命中的 [标准场景](field-control-patterns.md) 只继承控制结构；按
[计时契约](control-timing-contract.md) 明确首轮、反馈起算、参数生效点和清除副作用，不能直接复制
旧案例的复位清延停、固定宽限或旧故障分类。阀顺控与电机独立周期分别适配，不造无用途参数。

1. 读取适用 `AGENTS.md`、`docs/逻辑代码块开发指南.md` 第 1、2、5、7、8、10 节和
   `docs/design/工艺项目配置到逻辑代码生成与运行机制.md`。
2. 对目标目录运行 `verify_project.py <项目目录> --requirements-only --require-frozen --require-engineering-review`。不通过时返回需求
   阶段，不能先生成代码再补需求；确认项必须有 README 正文和证据支持。
3. 先读取 `application/case_center/standard_templates/catalog.yaml`，按设备类型和安全语义选择
   `certified` 模板 ID；命中时读取其 guide、implementation 和 tests，并保留固定安全不变量。没有命中时
   在 README 标记 `CUSTOM_REVIEW_REQUIRED`，再选择相近案例或正式项目提取需求和测试思路，不能把普通
   示例包装成标准模板。任何模板都不继承物理 bind、极性、安全值、站号、串口、北向地址或 PID 参数。
4. 读取冻结需求引用的原始点位文件，复核每个业务角色的 `name`、`description`、`type`、`direction`、
   `bind`、质量和安全属性。点位描述用于识别语义，不能覆盖结构字段；发现漂移或冲突时返回需求阶段。
5. 检查目标目录、`application/project_selection.yaml` 和工作树现状。目标必须是解析后仍位于
   `application/projects/` 内的项目叶子目录；允许一级目录或“客户/项目”等分组层级。
   `project.id` 为 1..48 位受限 ASCII。
6. 阅读 [生成契约](generation-contract.md)、[北向 HMI 点表契约](northbound-contract.md)、
   [PLC 风格控制逻辑质量门禁](logic-quality-gate.md)和[标准符合性声明](standards-compliance.md)。涉及 PID
   时额外读取 `docs/PID场景验证与调试指南.md` 及当前 API/测试；涉及 runtime 或 Profile 时读取对应专项
   设计与定义文件。
7. 冻结需求含外部实时数据时读取 [外部实时输入契约](external-input-contract.md)，复核平台版本真实支持
   `external_inputs`，以及生产者、写入 owner、协议、发送周期、类型/范围、时效和恢复策略均已冻结。

## 生成顺序

1. 先写或更新项目 `README.md`，保存冻结需求、证据、优先级、验收矩阵、选用的标准模板 ID（或
   `CUSTOM_REVIEW_REQUIRED`）、标准符合性矩阵和待现场边界。
2. 写 `project_io.yaml`：外部点与硬件事实只来自冻结需求；内部 state 和功能块只声明真实需要的资源；
   parameter/command 的接口形态必须已确认；输出北向默认只读。按 `HMI_SHORT_V1` 白名单发布必要字段，
   逐字复用冻结需求的统一短名和 bind 映射，不得在落盘时改用项目私有同义缩写；不把内部中间量、临时量和无用户动作的诊断加入北向。外部实时输入写入
   `application_variables.external_inputs`，并为每项配置唯一同类型 `read_write` 北向入口。
   点位及扁平变量清单按 [生成契约](generation-contract.md) 每条记录占一个物理行；不要让 YAML 序列化器
   将一条记录拆成多行，也不要为缩短行宽省略 description、bind 或其他必需字段。
3. 在临时目录运行 `tools/point_config_gen.py`，审查生成的 `point_config.h/.md`，确认类型、业务点名、
   功能块 ID、输出安全值和北向契约后再写 C。
4. 写 `logic.c`：只包含 `logic.h` 和必要标准头；物理点使用 `IO_IN/IO_OUT` 与短 API；external input
   按生成类型读取 `context->input.external.<name>` 样本；质量门控、请求计算和最终输出许可分层；每轮
   对所有受控输出形成唯一最终赋值。多设备手动与自动分别计算、保存请求，选择当前 owner 后才应用
   设备许可/保护；不得复用一个请求数组让自动调度、轮换、顺控、PID 或联停污染手动控制。
   多设备逐台读取 `auto_selected[i]`；组级自动使能不能代替逐台选择。自动候选池必须排除未选自动或
   不可用设备；手动运行设备仅进入真实容量/安全核算，不进入自动启停/轮换候选。
   逐台实现适用的启动/开阀、停止/关阀超时；只有独立真实运行反馈且仍有运行目标时才实现
   已确认运行后的滚动反馈丢失，并在停止请求后退出窗口。按冻结值及单体契约默认表执行：未指定
   时继电器设备启动 5 秒、停止 30 秒、运行丢失 5 秒，阀开/关各 120 秒。只有开、关到位反馈
   的阀门只做开、关超时。硬接故障仅使用真实故障反馈，不拿软件故障冒充；坏质量先按安全策略
   处理。清零交由 T05 runtime 公共绑定，不在 `logic.c` 自建累计或清零器。
5. 写 `logic_project_test.c`：用简体中文注释标识 Given/When/Then，并为冻结需求中的每个场景写
   `PLC_TEST: <场景 ID>`。测试必须调用项目逻辑或 DataManager + LogicManager 真实扫描路径，至少具有
   三个可执行断言；不能用空 `main`、只编译不断言或仅复制标签代替行为验证。one-shot、
   STOP/FAULT_SAFE、有状态块或 runtime 必须走真实管理器路径。
   每台设备适用的启停/开关超时、运行反馈丢失、硬接故障和独立总故障分别用边界与恢复断言覆盖；
   每个 runtime 追加本机清零/pending/他机隔离测试，不能把故障复位测试当清零测试。
6. 在 `application/project_selection.yaml` 登记项目但保持现有 `active_project`，除非用户明确授权激活。
   不得直接修改 `application/project_io.yaml`、`application/logic.c`、`application/logic_project_test.c`、
   `application/generated/` 或 lock 文件。
7. 完整项目必须补齐实际生成的点表/配置说明、安全与稳定性报告、可执行 HIL 计划，可并入 README
   或复用已有手册。原始点表样本按需要附带；不得包含未经确认的硬件事实或虚构实测结果。
8. 使用本 skill 的隔离验证脚本 `--strict-quality --require-engineering-review --require-execution-evidence` 验收；验证失败时只修复
   与冻结需求和诊断有关的内容。补充脚本未覆盖的语义、长序列及物理验证项，分层填写结果。

## 代码硬边界

- 不使用 HAL、RTOS、LwIP、UART、HTTP、SLE、EEPROM、RTU 私有接口、动态内存、阻塞等待、递归或
  静态可写业务状态。
- `Logic_Init` 不启动物理输出；`Logic_Stop` 撤销许可并形成安全输出；`Logic_Scan` 返回 false 会触发
  故障安全。
- command 是 one-shot；需要保持的请求写入 `context->state`。时间差使用
  `(uint32_t)(now - start)`。
- external input 只在 quality GOOD 时使用 value；INIT/STALE 按冻结策略收敛，恢复不自动清锁存或产生
  启动。项目不得直接调用网络、HAL tick 或 `DataManager_WriteExternal*`。
- 长期可调设置使用 parameter，一次性动作使用 command，只读观察量使用 state；不根据地址分配便利
  改变已冻结语义。
- 一个有状态功能块 ID 只服务一个业务用途，每扫描最多调用一次；返回 bool 的
  `SCALE/FILTER/RATE_LIMIT/PID_STEP` 失败时传播为扫描失败。
- 不把 output 目标或 RTU 回读描述成真实设备动作；普通 state/Counter 不掉电保持；parameter 仅在显式
  `persistent: true` 时由参数 store 保持，否则重启回 YAML 默认值。
- 命中认证模板时不删除模板规定的质量、反馈、复位、死区、故障锁存和恢复不误启结构；禁止复制旧案例
  中的可写文件级 `static` 业务状态或同步互斥切换。
- 多台设备支持手动时默认逐台独立；特殊手动联动必须来自冻结需求。自动模式内部的候选、阶段、需求台数
  和联停状态不作为手动输出条件，模式切换清理内部计时也不得改写另一模式请求或操作无关设备。
- 多设备自动控制声明 `PER_DEVICE_AUTO`；逐台选择变化只移交目标设备，其他设备模式/手动请求不变。
  候选不足、联动下游未选自动和重入自动均执行冻结策略，不能借用手动设备或沿用旧自动请求误启。
- 自动按运行/停止时长启停或轮换时声明 `TIMED_AUTO_CYCLE`；每台参与设备生成独立可写参数、北向短名、
  计时状态与参数校验。不得为了简化代码把逐台时长合成一对系统参数，除非冻结需求明文采纳例外。
- 多设备逐台生成 `*_reset_faults` 命令与 `*_RST` 北向 one-shot，分别只清本机软件故障点位；
  保留 `RESET_FAULTS` 安全场景，并声明 `PER_DEVICE_FAULT_RESET`。单设备可沿用既有 `reset_faults`；
  系统故障另设系统专属复位，不能把全局命令拆成无边界的清除扇出。
- 只有严格验证通过时，README 才能写 `KZ3 PLC_STYLE_V1: PASS (host-only)`；IEC 61131-3、PLCopen、
  IEC 61131-2、IEC 61508、IEC 62061、SIL 和 MISRA C 的措辞必须遵守标准符合性声明。
