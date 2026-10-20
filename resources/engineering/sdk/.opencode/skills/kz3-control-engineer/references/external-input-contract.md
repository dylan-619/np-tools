# 外部实时输入需求、配置与控制契约

## 何时使用

当 PLC 需求说明“数据由其他采集器、业务机、上级控制器或平台周期写入，本控制器用该当前值参与判断”
时，候选类型是 `external_input`。先按下表分类，不能只因数据来自北向就全部作为 parameter：

| 业务含义 | 配置类型 | 关键区别 |
| --- | --- | --- |
| 上级周期更新的当前状态/测量值，断流后必须失效 | `external_input` | 易失实时样本，合法同值写入也刷新时效 |
| 长期保持的模式、阈值、时间或给定值 | `parameter` | 设定语义，可按声明持久化，不用滚动报文保活 |
| 启动、停止、复位、确认等单次动作 | `command` | one-shot，不把持续状态塞入命令 |
| 现场 DI/AI、接触器反馈或硬保护 | 物理 input | 外部软件数据不得冒充现场物理证据 |

仅用于显示且不参与本机逻辑的数据通常不需要进入工艺项目。需要本机判断报文是否持续到达时必须采用
`external_input`，不能用普通 parameter 加自制计时器模拟。

## 需求必须写清

每个外部输入在需求正文和点位表中单独记录：

- 稳定业务名、中文含义、数据生产者、唯一写入 owner、允许协议/接口和实际消费者；多个来源可能同时
  写同一字段时必须在系统外冻结仲裁方式，当前项目不能从裸值识别来源后再可靠仲裁；
- `bool/s32/float` 类型、单位、合法范围、初始默认值；默认值只是 INIT 阶段占位，不能授予启动许可；
- 上级正常发送周期及最坏抖动的证据、`stale_after_ms`、`startup_grace_ms`，以及等于/越过时效边界的
  判定；未给周期证据时，非安全级联动先建议 `stale_after_ms: 30000`、`startup_grace_ms: 30000`，作为
  用户可改的需求/配置初值；`stale_after_ms` 必须覆盖真实网络和调度最坏延迟，但不能为了掩盖断流无限放大；
- INIT、首次合法报文、同值刷新、非法类型/越界/旧时序写入、STALE、恢复 GOOD 时的控制结果；
- 是否锁存“发生过中断”、由谁复位、复位条件，以及通信恢复后自动重新投入还是等待人工重新使能；
- 外部数据失效对每个输出、自动/手动模式和其他设备的影响，不能只写“通信故障”；
- HMI 是否要显示当前值、有效性/失联摘要和处置动作。内部 `update_ms`、原始
  `interruption_count` 默认不北向发布，确有维护用途时才发布必要的项目摘要状态。

智能体应根据发送周期和工艺危险性给出首选时效与恢复建议，用户确认业务结果。30 秒是形成完整草案的
默认建议，不是已经验证的网络抖动上界或安全反应时间。只有外部输入失效会撤销新增启动许可、进入项目
定义的安全路径且恢复不会自动启动时，用户才可直接采纳；涉及人身安全、危险动作或工艺允许失联时间
短于 30 秒时仍是证据阻塞项。用户可在冻结前改为其他值，智能体无需先反复询问。

## `project_io.yaml` 配置

外部实时输入必须同时具有变量声明和唯一、同类型的 `read_write` 北向字段：

```yaml
application_variables:
  external_inputs:
    - name: remote_pressure_mpa
      c_type: float
      default: 0.0
      min: 0.0
      max: 1.6
      stale_after_ms: 30000
      startup_grace_ms: 30000

northbound:
  fields:
    - name: EXT_PR_MPA
      bind: external.remote_pressure_mpa
      c_type: float
      access: read_write
      reference: "40012"
      description: 上级采集器当前压力，单位 MPa，每次合法写入刷新时效
```

- 类型只允许 `bool`、`s32`、`float`；bool 只给布尔 default 且不声明 min/max，s32/float 必须声明
  `default/min/max`，float 全部是有限且可表示的数；
- `stale_after_ms` 为 `1..2147483647`，`startup_grace_ms` 为 `0..2147483647`；时间值必须小于半个
  U32 周期以保持回绕判断有效；
- 不声明 `persistent`，不进入 EEPROM，不使用 parameter revision，不经过 command one-shot；
- 每个 external input 必须且只能绑定一个同类型 `read_write` 字段。它是功能性数据入口，即使不出现在
  HMI 页面，也不能按“北向最小化”规则删掉；不要为同一值再创建 parameter 或重复写入口；
- s32/float 占两个 Modbus 寄存器，地址与字序按项目北向契约核对。物理输入和物理输出不得因需求来自
  外部而改成可写。

先运行真实生成器检查 schema、类型、范围、地址和绑定，再从生成的 `point_config.h/.md` 取得 C 类型和
字段；不要凭文档示例猜结构。

## `logic.c` 使用

生成后的唯一合法读取形态是强类型样本：

```c
const PointConfigExternalFloatSample *remote =
    &context->input.external.remote_pressure_mpa;

if (remote->quality != POINT_CONFIG_QUALITY_GOOD)
{
    /* 按冻结需求撤销许可、保持安全输出或进入降级。 */
}
else
{
    float pressure_mpa = remote->value;
    /* 只在 GOOD 时使用业务值。 */
}
```

访问 `context->input.external.<name>` 是 external input 的生成契约例外；物理 board/RTU 输入仍使用
`IO_IN` 等公开点名，不直接访问 `context->input.board/rtu`。项目逻辑不得包含网络、HTTP、SLE、Modbus、
HAL tick 或 `DataManager_WriteExternal*` 调用。

初始化质量是 INIT，宽限期只推迟首次缺报中断计数，不使默认值变成 GOOD。年龄
`<= stale_after_ms` 仍为 GOOD，只有 `>` 才为 STALE。若需求要求记住扫描间发生过的短暂断流，使用样本
`interruption_count` 与项目 state 保存的已见计数比较并锁存；不能只检查当前 quality，因为恢复报文可能
先于下一扫描到达。恢复 GOOD 只表示新值有效，不自动清项目锁存、不建立启动请求。

## 生成与验证门禁

使用 external input 的项目必须在需求和测试中声明 `EXTERNAL_INPUT_LIFECYCLE`，并通过真实
DataManager + LogicManager 路径覆盖：

1. 上电默认值仍为 INIT，宽限期内不误启；首次合法报文转 GOOD。
2. 合法同值重复写入刷新时间；恰好等于时效仍 GOOD，超过后 STALE，并按冻结策略形成安全输出。
3. 类型错误、越界、非有限数、只读权限或不被接受的时序写入不改变旧值、质量和接收时间。
4. 长间隔后恢复时 `interruption_count` 不丢失；恢复不清故障锁存、不自动启动，除非需求明确允许且有
   重新使能条件。
5. 多次断流/恢复、计数饱和和 tick 回绕不破坏安全不变量。必要时验证上级重启、控制器重启和高频写入。

平台生成/协议测试证明类型、范围、时效和分派；项目测试证明业务输出策略。HIL 还要使用真实上级按
正常周期、抖动、断网、恢复、重复值及非法值注入，测量端到端最坏延迟并观察物理输出/反馈。HTTP 或
Modbus 写成功、读回数值、主机时间推进都不等于真实上级链路和执行器已验收。
