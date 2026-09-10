# KZ3 工艺项目 I/O 可视化配置工具设计

> 状态：目标设计；NP-Tools 已实现配置器原型、HTTP 在线调试工作台和 UART1 结构化设备维护工作台；
> 串口协议已按固件代码对齐，真实 UART/EEPROM/Ethernet/SLE/双角色 HIL 仍待实板验证
>
> 配置模型基线核对日期：2026-09-01；HTTP API 核对日期：2026-08-28
>
> HTTP 固件实现基线：`e70e100`
>
> 控制器/IO 扩展双模式固件基线：`e075fce`
>
> 适用范围：KZ3 F427 工艺项目的板型与扩展模块组态、业务点配置、应用变量、逻辑资源、南向实例、北向映射、需求与验收描述、校验及 OpenCode 工作空间导出
>
> 核心产物：`project_io.yaml`；配套产物包括需求文件、产品契约锁、校验报告和 OpenCode 生成请求
>
> 关联设计：[OpenCode 工艺逻辑代码生成架构设计](OpenCode工艺项目AI代码生成架构设计.md)

本文可单独复制到其他工程，作为配置工具的产品与实现输入。文中的字段、约束、模块字典和 YAML
示例已经包含当前 KZ3 工程点位配置的必要语义；但真正生成固件时，仍必须随工具发布同一版本的
`io_definitions`、schema/生成 SDK 和权威校验器。本文是人读规范，不能替代这些机器可执行契约。

## 1. 设计结论

本工具应定位为面向 PLC/工艺工程师的**离线工程配置器**，而不是普通 YAML 编辑器，也不是在 MCU
上运行的 PLC 编程环境。它负责把现场 I/O、扩展模块、业务点名、外部变量和北向通信契约配置为一份
可审查、可校验、可冻结的 `project_io.yaml`，再与工艺需求一起导出到独立工作空间，交给 OpenCode
生成 `logic.c` 和内部逻辑资源声明，最后由确定性生成器完成点位代码生成、编译和验证。

本次对照当前 `application/`、board/Profile 和生成器后的结论是：

- 工具范围必须覆盖工程身份、板型、RS485、设备实例、通道、业务点、变量、逻辑资源、PID/Runtime 和
  北向字段，不能只做 701/702 模块拖拽；
- `points.inputs/outputs` 的业务别名模型正确，但 702/703 DO 和 705 AO 的普通配置必须按每通道一个输出
  业务点实现，不能再自动复制一套 feedback 业务点；
- 北向字段模型必须保留 `name/bind/c_type/access/reference`，并额外在预览中展示生成器解析后的运行时
  读绑定；北向地址与设备 PDU 明确分离；
- 701–705 的通道与协议来自固化产品目录，只读展示，项目只配置实例、站号、轮询、实际使用通道和安全值；
- 本文已经给出当前活动工程的完整数量、命名区间和地址区间，但生成和发布仍必须绑定机器可读产品契约。

产品交互应贴近 PLC 工程师已有习惯：

- 用“硬件组态、设备树、模块槽位/站号、符号表、I/O 点表、通信地址表、编译诊断”组织信息；
- 总线和模块关系使用拓扑视图，几十到上百个点位的编辑使用工程表格；
- 支持键盘连续录入、批量选择、复制粘贴、按通道自动命名、CSV 导入导出和地址自动分配；
- 所有物理事实与业务语义分栏显示，避免把 `DI1`、寄存器地址和“水泵启动允许”混成一个字段；
- 输出安全值、输入质量、反馈性质、地址权限和硬件验证状态始终可见，不能藏在高级页面；
- 编辑时即时提示，导出时必须调用固件侧权威生成器完成最终校验，前端不能自称替代生成器。

首版不应直接建设梯形图、ST 编辑器或在线监控。OpenCode 负责工艺逻辑代码，配置工具的核心价值是
保证 AI 获得的外部点位契约准确、稳定、完整，并且 AI 无法越权修改物理绑定和通信契约。

## 2. 当前仓库事实与设计影响

### 2.1 当前输入与生成链

现行链路为：

```text
application/projects/<项目>/project_io.yaml ──┐
application/project_selection.yaml          ──┴─ project_configure.py
                                                       │
                                                       ▼
application/project_io.yaml                  ─┐
application/io_definitions/board_*.yaml      ─┼─ point_config_gen.py
application/io_definitions/rtu_profile_*.yaml ─┘
                                                       │
                                                       ├─ point_config.h
                                                       ├─ point_config.c
                                                       └─ point_config.md
```

其中：

- 板型定义保存板载端子、驱动通道、有效电平、量程、安全值和验证状态；
- RTU Profile 保存功能码、PDU 地址、读取块、写组、字节序、通道、工程量换算和反馈关系；
- `application/projects/<项目>/project_io.yaml` 是正式项目源，保存项目实际使用的板型、RTU 实例、通道、
  业务点、变量、功能块、PID 和北向字段；
- `project_selection.yaml` 选择一个项目，`project_configure.py` 原子物化活动副本并生成 C/H/Markdown；
- 固件不解析 YAML，正式运行只使用生成的 C/H；
- `application/project_io.yaml` 是当前活动项目兼容副本，不是人工编辑源，也不适合作为多项目平台数据库。

### 2.2 当前固化产品硬件目录

当前仓库中的板型和 RTU Profile 是固件产品定义，不属于普通工程配置。工具直接内置并只读展示以下
固定硬件目录：

| 类型 | 定义名 | 能力 | 当前证据状态 |
| --- | --- | --- | --- |
| 板型 | `kz3_f427_standard` | 12DI、8DO、4AI、2AO | 数字/模拟端子仍有 HIL 边界，定义中带 `qualification` |
| RTU | `sp4055_701` | 16DI | 软件协议有基线，端子 HIL 待完成 |
| RTU | `sp4055_702` | 8DI + 8DO；DO 写目标与寄存器回读同地址 | 软件协议有基线，端子实际输出待确认 |
| RTU | `sp4055_703` | 8DO；DO 写目标与寄存器回读同地址 | 软件协议有基线，端子实际输出待确认 |
| RTU | `sp4055_704` | 8AI，4–20 mA 转换为 4000..20000 µA | 量程已有部分实测依据 |
| RTU | `sp4024_705` | 4DI + 4AO，AO 原始码 0..4095 | 地址和原始范围有依据，电气映射/安全含义待 HIL |
| RTU | `kz3_f427_io` | KZ3 F427 作为 12DI、4AI、8DO、2AO IO 扩展模块 | 协议和角色切换已有软件/启动冒烟证据；RS485-2 真实帧、端子和输出 watchdog 待 HIL |
| 示例 | `generic_level_f32_example` | F32、CDAB 字节序示例 | `example_only`，不能作为可交付真实设备 |

工具必须把 `software_qualified`、`pending`、`range_confirmed`、`example_only` 等状态直接展示给工程师。
“能够选择”不等于“已经允许现场驱动”。

工具不提供 `board_*.yaml` 或 `rtu_profile_*.yaml` 的新建、删除、导入、版本选择和字段编辑功能。
`project.board` 固定写入 `kz3_f427_standard`；工程师只能从固定扩展模块列表中添加项目实例，再配置端口、
站号、轮询、启用通道和输出安全值。将来新增板型、模块或修改寄存器时，应修改固件产品源码、完成验证，
并随新的工具/固件产品版本一起发布，而不是在项目配置界面现场维护。

#### 2.2.1 板型只读字典

`kz3_f427_standard` 的当前机器定义如下。工具可以改变显示名称，但不得改变 code、通道数量、极性、
量程或安全值：

| 类别 | code/数量 | 类型与范围 | 固化事实 | 当前验证边界 |
| --- | --- | --- | --- | --- |
| 板载 DI | `di01..di12`，12 路 | BOOL | `driver_channel=0..11`，`active=low` | 板级 HIL `pending` |
| 板载 DO | `do01..do08`，8 路 | BOOL | `driver_channel=0..7`，`active=high`，`safe_value=false` | 实际端子输出待 HIL |
| 板载 AI | `ai01..ai04`，4 路 | float，0..20 mA | `driver_channel=0..3` | `electrical_verified=false`，当前禁止北向发布 |
| 板载 AO | `ao01..ao02`，2 路 | float，0..20 mA | `driver_channel=0..1`，`safe_value=0.0` | `electrical_verified=false`，当前禁止北向发布 |

`device_type=203` 是板型产品事实。工具的项目层只创建 `point.<业务名>` 到 `board.<code>` 的别名，
不允许用户编辑 `driver_channel`、`active` 或板载安全值。

#### 2.2.2 701–705 Profile 只读协议字典

下表是另一工程实现模块库、协议详情页和通道选择器所需的最低完整快照。`PDU` 为 Modbus 报文中的
零基地址，不是北向 `reference`，也不是界面显示的 5 位 Modicon 地址。站号不属于 Profile，由每个
项目设备实例配置。

| Profile | 项目可选信号 | 设备侧读取 | 设备侧写入 | 值语义与限制 |
| --- | --- | --- | --- | --- |
| `sp4055_701` | `di01..di16` | FC01，PDU 0，16 coils | 无 | BOOL；端子电平 HIL `pending` |
| `sp4055_702` | 输入 `di01..di08`；输出 `do01..do08` | DI：FC01，PDU 0，8 coils；DO 回读：FC01，PDU 16，8 coils | FC15，PDU 16，8 coils | 每路 DO 项目层默认只建一个输出业务点；回读是同线圈寄存器值，不等于端子/接触器反馈；安全值 BOOL |
| `sp4055_703` | 输出 `do01..do08` | DO 回读：FC01，PDU 16，8 coils | FC15，PDU 16，8 coils | 与 702 的 DO 规则相同，但没有 DI |
| `sp4055_704` | `ai01..ai08` | FC03，PDU 0，8 registers | 无 | wire U16；raw 0..65535 线性换算为 4000..20000 µA；当前 HIL 状态 `range_confirmed` |
| `sp4024_705` | 输入 `di01..di04`；输出 `ao01..ao04` | DI：FC01，PDU 0，4 coils；AO 回读：FC03，PDU 0，4 registers | FC16，PDU 0，4 registers | U16 AB，raw 0..4095，恒等工程表示；任一 AO 启用时必须完整声明 4 路写组；原始码 0 的真实电流/安全含义待 HIL |

Profile 内仍保留 `doXX_feedback`/`aoXX_feedback` 信号，供南向写后确认和必要的高级诊断使用。普通项目
配置器不得因此自动创建第二套业务点或第二套北向字段。702/703/705 满足“同功能区、同 PDU、同通道、
同类型，且数值表示一致”的合并条件时，配置界面只展示 `doXX`/`aoXX` 一个业务字段：逻辑写入目标值，
北向只读时由生成器读取对应寄存器回读影子。

模块页必须同时显示 `qualification` 和 `evidence.hardware_hil`。`software_qualified` 只证明请求/响应和
软件解析有基线，不证明接线、端子极性、实际电压/电流或负载已经动作。

#### 2.2.3 KZ3 F427 IO 扩展 Profile

`kz3_f427_io` 是上层 Controller 项目使用的只读伴生 Profile，不是目标设备的在线角色配置。它固定
描述 KZ3 F427 在 `RTU_SLAVE` 角色下对外暴露的协议能力：

| 能力 | 固定协议 |
| --- | --- |
| DO 回读 | FC01，PDU 0，8 coils |
| DI | FC02，PDU 0，12 discrete inputs |
| AI | FC04，PDU 0，4 registers，U16 AB，单位 µA，0..20000 |
| 诊断 | FC04，PDU 4，19 registers；包含质量、故障、map version/hash、从站地址、watchdog、运行时间和持久化状态 |
| AO 回读 | FC03，PDU 0，2 registers，U16 AB，单位 µA，0..20000 |
| DO 写入 | FC15，PDU 0，完整 8-coil 组，默认安全值 false |
| AO 写入 | FC16，PDU 0，完整 2-register 组，U16 AB，0..20000，默认安全值 0 |

基础 Profile 的 `io_map_hash` 当前为 `706267284`。工具必须同时读取设备诊断中的 map hash 并与项目
绑定的 Profile 比较；不一致时不得把 DI/AI 标为 GOOD，也不得开放 DO/AO 写入。基础 Profile 和每个
项目生成的 `rtu_slave_profile.yaml` 都属于固件产品契约：前者供上层项目实例化，后者由当前项目的
`io_extension.exports` 确定性生成，普通工程师不得直接编辑功能码、PDU、通道或 hash。

#### 2.2.4 跨工程交付时的事实优先级

另一工程实现工具时按以下顺序处理冲突：

1. 与固件产品版本绑定的机器可读 board/Profile、schema 和权威生成器，是可执行事实；
2. 冻结的 `project_io.yaml` 是某个项目的配置事实；
3. 生成的 `point_config.md` 是前两者的只读展开和审查证据；
4. 本文中的表格是实现说明和当前快照。若机器契约升级导致差异，必须升级本文和工具契约版本，不能由
   前端自行选择一个值继续生成。

因此，工具安装包应带固定产品契约包，而不是只把本文中的表格复制成另一份可编辑 JSON。前端可以缓存
展示模型，但冻结和导出必须核对产品契约 hash。

### 2.3 `project_io.yaml` 当前覆盖的维度

```text
project_io.yaml
├── 项目身份：name/id/version/board/required_profiles/scan_period_ms
├── feature 开关：pid/counter/retained
├── 南向端口：rs485_1/rs485_2 及串口、超时、重试、退避参数
├── 南向设备：Profile、端口、站号、轮询、失效时间、启用通道、安全值
├── IO 扩展导出：io_extension.exports 聚合 rs485_1 下挂设备的只读输入/反馈
├── 业务点：points.inputs/outputs 的 name/source/description
├── 应用变量：parameters/commands/states
├── PID：measurement/setpoint/output/周期/方向/整定值/限幅
├── 逻辑资源：Timer/Edge/Counter/Latch/Debounce/Filter/RateLimit/Runtime
└── 北向：协议、Modbus 地址风格、字段名、绑定、类型、权限、reference
```

因此只做“扩展模块拖拽器”是不完整的。工具必须覆盖从物理设备到 OpenCode 业务接口的全链路。

### 2.4 当前能力缺口

以下内容是目标设计，不应误写成当前已经实现：

- `application_codegen.py prepare/finalize` 和平台交换 schema 尚未实现；
- 当前生成器直接读取 YAML，尚未提取统一 JSON Schema 或独立领域模型库；
- 当前 YAML 没有平台稳定 point UUID，只有稳定 `logic_name`；
- 普通 parameter/state 不掉电保持，`features.retained` 仍是兼容字段；
- 板载模拟量虽然进入 `LogicContext`，但当前生成器拒绝直接映射到北向，电气闭环也未完成；
- Profile 的证据字段存在，但这些证据随固件产品发布维护，不进入项目配置界面；
- 当前项目切换器会物化共享活动目录，不支持后端并发生成任务；
- 现有 Python 校验有不少运行约束，但尚未对所有变量字段形成严格的声明式 schema；
- `poll_period_ms` 生成目标是 U16，但当前 Python 基础校验只检查正整数，尚未拒绝大于 65535 的值；
  工具必须先按 1..65535 限制，P0 同时补齐权威生成器回归；
- 现行开发指南把 `i32` 视为两个 Modbus 寄存器，但当前 `field_width()` 实现只返回一个寄存器；在修复
  并用测试冻结前，工具不得开放 `i32` 北向映射；
- 共享解析器接受 `u8`，但当前 `PointConfigValueType` 和 `_point_config_value_type()` 没有 U8 映射；在
  生成契约补齐或明确归一化为 U16 前，工具不得提供 `u8` 项目变量；
- SLE 线协议以 `northbound.fields[].name` 作为 JSON key；生成表中的 `north_key_id` 只是固件内部路由
  ID，可以随当前项目重新生成，工具不得把它显示成外部协议地址或要求工程师维护；
- 活动 SLE 发送链路的物理帧上限为 730 B（含 4 B 路由头），遥测 JSON 预算为 690 B；当前
  `plc_gen.py` 仍保留旧的 512/472 B 保守预检查常量。两者尚未收敛前，工具不得复制任一数字形成第三套
  校验，必须展示“运行时上限”和“绑定生成器门禁”两个来源，并以当前权威生成器能否导出作为冻结结论。

可视化工具不能掩盖这些缺口。首版应通过禁用、状态标记或权威后端校验保持现有安全边界。

### 2.5 三类配置域与唯一 owner

工具必须把三类配置域在页面、保存位置和审计记录中分开，不能做成一张可任意互填的“设备配置表”：

| 配置域 | 权威入口与 owner | 持久化/生效 | 工具动作 |
| --- | --- | --- | --- |
| 工程配置 | `project_io.yaml` → 生成器 → 固件 Flash | 重新生成、构建、烧录后生效 | 离线编辑、校验、冻结、导出；不得在线偷改 EEPROM |
| 设备本机配置 | UART1 `@CFG/*` / `@DEBUG` → 各 EEPROM owner | 按命令独立提交；部分立即请求应用，部分必须重启 | 结构化表单、预校验、确认、单次发送、SHOW 回读和会话记录 |
| 运行时业务值 | HTTP/Modbus TCP/SLE → `Network/DataManager` | parameter 可能仅 RAM；command 为 one-shot | 按生成字段权限受控读写；不写 GPIO、AO 或 RTU 寄存器 |

系统角色与上层设备实例尤其不能合并：远端 KZ3 的从站地址由本机
`@CFG,IO,INIT,RTU_SLAVE,<address>` 保存；上层 Controller 的 `devices[].slave_address` 只是工程拓扑声明。
工具可以做一致性核对，但不得从上层 YAML 自动跨设备写远端 EEPROM。

### 2.6 UART1 设备初始化与维护契约

UART1 固定为 USART1（PA9/TX、PA10/RX）、`115200 8N1`、无硬件流控。固件以 10 ms 无新字节判断
帧结束，接收缓冲 256 B，单条有效命令最多 255 B。工具统一发送 ASCII + CRLF，同一时刻只允许一条命令
在途；写命令超时不自动重试。调试日志可能与回包交错，客户端提取最后一条 `OK/ERR`，同时保留原始行。

结构化页面覆盖的现行白名单如下：

| 配置组 | 查询 | 写入 | 关键边界 |
| --- | --- | --- | --- |
| 生产身份 | `@CFG,SYS,SHOW` | `@CFG,SYS,SN,<12位SN>` | 前缀 `0203`，末四位 `0001..2047`；`OK,SN_UPDATED` 后写后查询 |
| Ethernet | `@CFG,ETH,SHOW` | 单字段或完整四参数 `INIT` | IP/GW 非全 0/255，连续非零掩码，端口 1..65535；比较 RUN/SAVED 与重启标记 |
| SLE | `@CFG,SLE,SHOW` | 单字段或严格六字段 `INIT` | KZ3 控制器固定下发 `CFG_ADDR=0`、`APID=1`；名称最多 16 B 可打印 ASCII、PWR -127..20 或 127、MAXPWR 1..8、MODE=0 |
| 系统角色 | `@CFG,IO,SHOW` | `CONTROLLER` 或 `RTU_SLAVE,1..247` | 同时展示 ACTIVE/SAVED、两份记录状态和 `REBOOT_REQUIRED` |
| 调试日志 | `@DEBUG` | `@DEBUG=0/1` | 持久化开关；关闭普通 DBG 后协议 OK/ERR 仍保留 |

SLE 的 `OK,SLE_RECONFIGURE` 只表示本地记录已保存并请求模组重新配置。工具继续查询并分别展示
`VALID`、`READY`、`MAC_VALID`、`CFG_APPLIED` 和 `AT_ADDR/AT_NAME/AT_PWR`；任一单层成功都不能升级为
“无线链路通过”。`SHOW` 中 NAME 的 `%25/%2C` 解码后显示，原始协议行仍进入会话记录。
KZ3 控制器工具不开放 `CFG_ADDR` 和 `APID` 编辑：表单只读显示产品固定值，SLE `INIT` 命令构造层也
始终使用 `0` 和 `1`，不能通过修改页面状态绕过。`SHOW` 返回的实际值仍单独展示，用于诊断旧设备或异常配置。

Ethernet 批量初始化必须生成完整 `IP,MASK,GW,PORT` 四参数，不发送历史文档中的空参数 `INIT`。
普通流程不提供任意文本输入；整片 EEPROM 擦除、Lua、文本复位、旧 SN/IP/端口、统计清零、RTC 写入、
裸 AO、旧 Zigbee 等退役入口在真正串口写入前拦截。

### 2.7 系统角色与双 RS485 固定职责

| 活动角色 | UART3 / RS485-1 | UART4 / RS485-2 | application 与输出行为 |
| --- | --- | --- | --- |
| `CONTROLLER` | RTU 主站 A | RTU 主站 B | 正常运行 `logic.c`、PID、顺控和南向读写 |
| `RTU_SLAVE` | 只读采集主站 | 本机 Modbus RTU 从站 | 不初始化/扫描 application，不执行下行写入 |
| 维护安全态 | 不启动业务 | 不启动业务 | DO/AO 保持安全，只接受 UART1 IO 角色查询和重配 |

两口产品参数固定为 `9600/N/1`。角色保存不能在线切换任务或 UART owner；必须物理复位、重新连接并再次
SHOW，只有 ACTIVE/SAVED 一致、两份记录为 `VALID`、`REBOOT_REQUIRED=0` 才能显示“角色已生效”。
`INVALID/IO_ERROR` 不能仅因角色文本相同而视为成功，`IO_ERROR` 不得自动写入或回退。

## 3. 产品目标与非目标

### 3.1 目标

1. PLC/工艺工程师无需手写 YAML 即可完成一套可生成的项目外部契约；
2. 内置标准板型和扩展模块库，工程师只配置项目实例，不直接填写标准模块寄存器；
3. 业务点名与物理端子彻底分离，换端子时尽量不修改 `logic.c`；
4. 支持板载、RTU 南向、应用变量、PID/逻辑资源、Runtime 和北向字段的统一配置；
5. 在录入阶段尽早发现重名、错方向、地址冲突、总线超载、安全值缺失和容量超限；
6. 导出结果可被当前 `point_config_gen.py` 或后续生成 SDK 确定性消费；
7. 为 OpenCode 生成最小、稳定、无物理实现噪声的业务上下文；
8. 配置冻结后形成哈希、版本、自动绑定的产品契约锁和校验报告，可追溯到同一次生成任务；
9. 支持导入现有 `project_io.yaml`，编辑后先显示语义 diff，再明确保存；
10. 明确区分主机生成/编译验证、HIL 和现场验证状态；
11. 通过 UART1 结构化向导完成 SN、Ethernet、SLE、调试日志和系统角色配置，写前校验、写后回读；
12. 将 RUN/SAVED、ACTIVE/SAVED、重启待生效和 SLE 模组确认层级明确展示并导出独立维护记录。

### 3.2 非目标

- 首版不实现 LD/FBD/ST 在线编程环境；
- 不在工具中直接控制真实 DO/AO、修改 RTU 寄存器或做在线强制；
- 不自动扫描现场总线后猜测设备型号和端子语义；
- 不允许 AI 修改板型、Profile、站号、物理地址、量程、安全值或北向地址；
- 不把 `project_io.yaml` 当作完整的平台用户、审批、工单或租户数据库；
- 不在 MCU 上解析 YAML/JSON 或运行 OpenCode；
- 不把编译通过显示成“设备验证通过”或“可以投产”；
- 不提供板型/Profile 可视化维护入口；硬件定义变更必须随固件产品版本开发和发布；
- 不在没有证据时自动推断端子极性、工程单位、反馈真实性或安全值。
- 不从上层 Controller 项目自动写远端 IO 设备的系统角色 EEPROM；
- 不恢复整片 EEPROM 擦除、文本复位、裸 AO 写入等退役入口；
- 不把 UART1 写入成功、SLE 本地重配置请求或 `REBOOT_REQUIRED=1` 显示成配置已经运行。

## 4. 使用对象与权限模型

### 4.1 主要角色

| 角色 | 主要任务 | 默认权限 |
| --- | --- | --- |
| PLC/工艺工程师 | 搭硬件拓扑、配置业务点、变量、北向和需求 | 创建/编辑项目；使用固化硬件目录；导出草稿 |
| 电气/调试工程师 | 核对端子、站号、极性、量程、反馈和安全值 | 填写证据状态；确认现场参数；执行 HIL 记录 |
| 固件/平台工程师 | 在源码中维护板型/Profile、生成器、schema 和容量规则 | 随固件产品版本发布固定硬件目录；处理工具诊断 |
| 审核/交付人员 | 比较版本、确认风险、冻结并交给 OpenCode/构建服务 | 只读审查；冻结；导出发布候选包 |
| OpenCode | 读取冻结需求和业务接口，生成逻辑代码和内部声明 | 只读外部配置；只能写指定 AI 输出目录 |

首版即使不做账号系统，也应在界面和文件权限上保留这几个职责边界。工具内没有“模块库维护”入口；
工程项目页面只能查看固定模块资料和实例化模块，不能改写 Profile 的功能码、寄存器和工程量换算。

### 4.2 PLC 工程师的交互偏好

主要使用对象通常更习惯：

- 左侧项目树和硬件树，而不是自由探索式页面；
- 通道编号、端子号、站号和地址按自然顺序展示；
- 点表像电子表格一样连续录入和批量处理；
- 错误能定位到设备/通道/行号，不只返回一段 YAML 路径；
- 编译前有统一“工程检查”，能一次看到错误、告警和未确认项；
- 发布过的地址和符号默认锁定，修改时明确提示兼容性影响；
- 可以导出人读点表给电气、上位机和现场人员复核。

因此拓扑画布是辅助视图，工程表格才是主要编辑器。首版不能只提供拖拽连线而缺少高效表格。

## 5. 端到端工作流

```text
新建/导入项目
    ↓
自动加载固化板型与扩展模块目录
    ↓
配置 RS485 端口与扩展设备实例
    ↓
选择实际使用通道并填写输出安全值
    ↓
建立业务点名、说明、质量与反馈语义
    ↓
配置 parameter / command / observable state
    ↓
配置北向协议、字段名、权限和 Modbus 地址
    ↓
按需预声明 PID、Runtime 和人工指定逻辑资源
    ↓
录入需求、故障策略与 Given/When/Then 验收场景
    ↓
工程检查 → 修复错误 → 确认未验证项
    ↓
冻结配置快照并导出 OpenCode 工作空间
    ↓
OpenCode 生成 logic_definition.json / logic.c / 测试
    ↓
确定性合并与 point_config.c/.h 生成
    ↓
严格编译、静态检查、主机测试、结果回传
```

配置工具完成的是“冻结外部工程契约”。OpenCode 完成的是“在该契约内实现控制逻辑”。两者之间必须
有明确的不可变快照和哈希，不能让工程师在 OpenCode 生成过程中继续修改同一个请求。

## 6. 信息架构与功能菜单

### 6.1 顶层布局

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 项目名 / ID / 版本   [草稿] [配置错误 2] [待 HIL 5]   保存  检查  冻结/导出 │
├──────────────┬──────────────────────────────────────┬───────────────────────┤
│ 工程导航     │ 主工作区                             │ 属性/证据检查器        │
│              │                                      │                       │
│ 项目总览     │ 表格 / 拓扑 / 地址图 / Diff          │ 当前设备、点或字段详情 │
│ 硬件组态     │                                      │ 安全值、范围、说明     │
│ I/O 点表     │                                      │ 引用关系、验证状态     │
│ 应用变量     │                                      │                       │
│ 逻辑资源     │                                      │                       │
│ 北向通信     │                                      │                       │
│ 需求与验收   │                                      │                       │
│ 工程检查     │                                      │                       │
│ 导出与历史   │                                      │                       │
├──────────────┴──────────────────────────────────────┴───────────────────────┤
│ 诊断抽屉：错误 / 告警 / 待确认；双击跳到设备、通道、点或北向字段            │
└─────────────────────────────────────────────────────────────────────────────┘
```

宽屏采用三栏，普通笔记本可折叠右侧检查器；不建议依赖 4K 大屏。所有关键操作必须有键盘路径。

### 6.2 菜单模块

| 一级菜单 | 二级页面 | 主要职责 | 主要产物字段 |
| --- | --- | --- | --- |
| 项目总览 | 基本信息、资源仪表、完成度 | 项目身份、当前风险、全局跳转 | `name/id/version/board/scan_period_ms` |
| 硬件组态 | 板载 I/O、RS485 端口、扩展设备、通道使用 | 形成物理拓扑和南向实例 | `required_profiles/rs485_ports/devices` |
| I/O 点表 | 输入点、输出点、未映射通道、反馈关系 | 建立业务符号和物理 source | `points.inputs/outputs` |
| 应用变量 | 参数、命令、可观测状态、系统变量 | 定义 OpenCode 可用外部变量 | `application_variables` |
| 逻辑资源 | 功能块、PID、Runtime、AI 提案 | 预声明或审查内部资源 | `features/pids/logic_blocks` |
| 北向通信 | 协议、字段表、Modbus 地址图、兼容性 | 定义 HTTP/SLE/Modbus TCP 统一字段 | `northbound` |
| 需求与验收 | 需求文本、故障策略、场景表、未决项 | 形成 OpenCode 输入和测试依据 | `requirement.md/json`，不强塞进 YAML |
| 工程检查 | 错误、告警、容量、定义证据、生成预览 | 调用权威校验并形成报告 | `validation_report.json` |
| 导出与历史 | YAML 预览、语义 Diff、冻结快照、工作空间 | 形成可追溯交付包 | YAML、lock、request、manifest |
| 设置与帮助 | 命名规则、地址策略、SDK 路径、用户指南 | 本机偏好，不进入固件契约 | 本机配置 |

“南向通信”不单独再造一张寄存器表。标准模块的功能码、PDU 地址和字节序来自 Profile；工程项目只在
硬件组态中配置端口、站号、轮询周期、失效时间和实际启用通道。

系统角色不属于工程 YAML，应放在独立的“设备维护/系统角色”页面。项目编辑器可以提示某个工程具备
IO 扩展导出能力，但不得在保存 `project_io.yaml` 时自动改写已连接设备的 EEPROM 角色。

### 6.3 工具安装包应包含的内容

| 内容 | 用途 | 是否由普通项目人员修改 |
| --- | --- | --- |
| 可视化工程编辑器 | 菜单、表格、拓扑、检查器、诊断和 Diff | 使用但不改程序本身 |
| 固化板型/Profile 目录 | 标准板载 I/O、701/702/703/704/705 和 `kz3_f427_io` 定义，随工具产品发布 | 否，只能查看和实例化 |
| schema/固件契约包 | 字段类型、容量、允许 API 和兼容版本 | 否 |
| 案例/模板索引 | 电机启停、多泵、输送线等起始结构 | 复制后必须重新确认现场参数 |
| 权威校验与点位生成 SDK | 复用 `point_config_gen.py` 能力，输出结构化诊断 | 否 |
| OpenCode 工作空间适配器 | 生成最小上下文、冻结输入并导入结果 | 按配置使用 |
| 人读帮助与字段字典 | 解释 parameter/command/state、质量、安全值和地址区 | 只读 |
| 本地草稿/快照服务 | 自动恢复、冻结、hash 和历史 Diff | 工具管理 |

编辑项目不需要打包完整固件仓库；但进行最终 C 编译和固件打包时，工作空间必须绑定明确的固件 SDK/
仓库版本。案例只提供结构参考，不能把其中的站号、端子、安全值或 PID 值当作新项目默认事实。

## 7. 页面与交互详细设计

### 7.1 新建/导入向导

新建工程使用三步向导：

1. 项目身份：中文名称、ASCII ID、版本、扫描周期；板型固定为 `kz3_f427_standard` 并只读显示；
2. 模板：空白、从案例复制、从已有项目复制；
3. 工作目录：选择本地工程目录，默认不开启云同步。

导入支持：

- 单个 `project_io.yaml`；
- 现有 `application/projects/<目录>/`；
- 工具导出的完整工作空间目录或压缩包。

导入后先进入“兼容性检查”，不直接覆盖已有工程。工具需要列出：

- schema 是否支持；
- 引用的 board/Profile 是否属于当前工具固化的产品硬件目录；
- 是否存在工具暂不认识的字段；
- 重新序列化会发生的语义变化；
- 是否缺失工作空间元数据和稳定 UI 实体 ID。

未知字段不得静默丢弃。可进入只读兼容模式，或者由用户明确选择“按当前 schema 迁移”并查看 Diff。

### 7.2 项目总览

总览不是装饰性 Dashboard，而是工程出口面板，应固定展示：

- 项目名、ID、版本、schema、扫描周期、固定板型和产品硬件契约标识；
- 板载点/RTU 设备/已用通道/业务输入/业务输出数量；
- parameter/command/state、PID、Timer、Runtime 和北向字段数量；
- `LogicContext` 预估、binding 数、北向字段数和每个 RS485 端口预算；
- 错误、告警、待证实硬件项数量；
- 最近一次权威校验时间、生成器版本和输入 hash；
- “可导出草稿”“可冻结”“可发布候选”三个不同结论。

状态含义：

| 状态 | 含义 |
| --- | --- |
| 草稿 | 允许字段不完整，不可交给构建服务 |
| 配置完整 | 必填项齐全，但尚未执行权威生成器检查 |
| 校验通过 | 当前配置可生成；不代表 HIL 通过 |
| 已冻结 | 内容和产品硬件契约 hash 不再变化，可交给 OpenCode |
| 已导出 | 已形成工作空间包；修改后必须创建新快照 |
| 有阻塞未决项 | 缺物理点、安全策略或工艺决策，不生成发布候选 |

### 7.3 硬件组态

#### 7.3.1 板载 I/O

板载页面按 DI、DO、AI、AO 分组，展示：

| 字段 | 编辑性 | 说明 |
| --- | --- | --- |
| 端子名、驱动通道 | 只读 | 来自板型定义 |
| 有效电平 | 只读 | 属于板级事实，项目不能改 |
| 类型、单位、软件量程 | 只读 | 来自板型定义 |
| 默认安全值 | 只读 | 板型安全契约；修改需升级板型定义 |
| 电气验证状态 | 只读徽标 | `verified/pending` 等 |
| 项目是否使用 | 可编辑 | 决定是否进入业务点配置候选 |
| 项目备注/证据引用 | 可编辑 | 保存在工作空间元数据，不进入 MCU |

板载所有物理 binding 仍会进入当前生成器的底层 `LogicContext`；“项目是否使用”主要控制点表和业务
界面，不应在未改固件 schema 的情况下假装裁剪了板载驱动。

#### 7.3.2 RS485 端口

端口只允许 `rs485_1`、`rs485_2`。每个端口使用表单加预算条：

- baud：当前产品固定 9600，只读展示；
- parity：当前产品固定 none，只读展示；
- stop bits：当前产品固定 1，只读展示；
- response timeout；
- retry count；
- offline backoff；
- 当前设备数、读取块数、常态占用、故障退避稳态占用。

预算颜色建议：低于门禁只用中性色；接近门禁显示黄色；超过权威门禁显示红色并阻止冻结。不要把低占用
显示成“通信已验证”。

#### 7.3.2.1 设备系统角色与固定端口职责

工具新增“设备维护/系统角色”卡片，通过 UART1 `115200 8N1` 使用以下原子指令：

```text
@CFG,IO,SHOW
@CFG,IO,INIT,CONTROLLER
@CFG,IO,INIT,RTU_SLAVE,7
```

`RTU_SLAVE` 地址只允许 `1..247`。首版不提供端口、baud、parity 或 stop bits 编辑；两种角色的物理
职责固定如下：

| EEPROM 角色 | UART3 / RS485-1 | UART4 / RS485-2 | application 逻辑 |
| --- | --- | --- | --- |
| `CONTROLLER` | RTU 主站 A | RTU 主站 B | 正常初始化和扫描 |
| `RTU_SLAVE` | 只读采集主站，可继续下挂扩展模块 | 本机 Modbus RTU 从站 | 不初始化、不扫描 |

角色记录位于 AT24C16 `528..543` 的单个 16 B 页，使用 magic、version、保留零和 CRC-8，一次整页写入
并回读；不使用 A/B 双槽。工具不能提供裸 EEPROM 地址编辑，也不能把角色记录并入项目参数、网络配置或
运行时间区域。成功保存只改变下次启动配置，不在线切换 UART owner；界面必须明确显示“需要重启”，
不能在收到保存成功后直接把 ACTIVE 状态改成目标角色。

`SHOW` 响应应解析并分别展示：

- `ACTIVE_ROLE/ACTIVE_ADDR/ACTIVE_RECORD`：本次启动实际使用的角色、地址和记录状态；
- `SAVED_ROLE/SAVED_ADDR/RECORD`：EEPROM 保存的下次启动配置；
- `REBOOT_REQUIRED`：活动配置与保存配置不同，或记录处于错误状态。

记录状态固定为 `VALID/BLANK/INVALID/IO_ERROR`。空白页兼容旧设备并以 `CONTROLLER` 启动，但不自动
写 EEPROM；非空损坏或读取失败会进入维护安全态，只接受 `@CFG,IO,*` 恢复。IO 角色下其他配置命令
可能返回 `ERR,MAINTENANCE_ROLE_ONLY`，工具应解释为角色权限限制，不得提示成串口断线。

推荐交互流程：连接设备后先 `SHOW`；用户选择角色并输入地址；展示端口职责、应用逻辑停用和输出风险；
二次确认后发送单条 `INIT`；收到 `OK,IO,SAVED_ROLE=...,SAVED_ADDR=...,REBOOT_REQUIRED=1` 后提示人工或
受控复位；复位后再次 `SHOW`，只有 ACTIVE/SAVED 一致、记录 `VALID` 且 `REBOOT_REQUIRED=0` 才显示
“角色已生效”。

两台控制器联动时必须区分“设备角色”和“项目拓扑”：第二台通过上述 UART 指令保存 `RTU_SLAVE,7`；
第一台仍在自己的项目 YAML 中把第二台声明为普通南向设备。只读联调的最小示例如下：

```yaml
project:
  required_profiles: [kz3_f427_io]

  rs485_ports:
    rs485_1:
      baud: 9600
      parity: none
      stop_bits: 1
      response_timeout_ms: 100
      retry_count: 1
      offline_backoff_ms: 5000

  devices:
    - name: remote_io_1
      profile: kz3_f427_io
      port: rs485_1
      slave_address: 7
      poll_period_ms: 500
      stale_after_ms: 1500
      use:
        inputs: [di01, ai01]
```

需要写 DO/AO 时，工具应按 Profile 写组让用户一次确认完整 8 路 DO 和完整 2 路 AO 的安全值，不能只
生成部分 FC15/FC16 组。上层 YAML 的 `slave_address: 7` 是主站拓扑配置；它不会替第二台写 EEPROM，
也不能与第二台 `SHOW` 返回的 `ACTIVE_ADDR` 不一致。

如果第二台在 IO 角色下还通过 RS485-1 下挂 701/704 等模块，可在第二台项目中选择已声明的只读输入或
反馈加入聚合导出：

```yaml
project:
  rs485_ports:
    rs485_1:
      baud: 9600
      parity: none
      stop_bits: 1
      response_timeout_ms: 100
      retry_count: 1
      offline_backoff_ms: 5000

  devices:
    - name: downstream_di
      profile: sp4055_701
      port: rs485_1
      slave_address: 8
      poll_period_ms: 500
      stale_after_ms: 1500
      use:
        inputs: [di01]

  points:
    inputs:
      - {name: downstream_allow, source: rtu.downstream_di.di01,
         description: IO 扩展控制器下挂 701 DI1}

  io_extension:
    exports:
      - {name: downstream_allow, bind: point.downstream_allow,
         c_type: bool, reference: "10101"}
```

`io_extension.exports` 每项必须且只能包含 `name/bind/c_type/reference`，最多 64 项；只接受 `bool/u16`，
且源必须最终解析为 `rs485_1` 已声明的只读输入或反馈。BOOL 从 `10101` 连续分配，U16 从 `30101`
连续分配，每项质量寄存器由生成器从 `30201` 起派生。板载 I/O 和固定诊断区已经由基础 Profile 暴露，
不得再通过该列表重复导出。

#### 7.3.3 扩展设备拓扑

拓扑视图按端口显示一条总线，设备卡片包含：

```text
[sp4055_702] 泵站远程 I/O
RS485_1 / 站号 1
轮询 500 ms / stale 1500 ms
已用 4 DI / 4 DO（同地址寄存器回读由 Profile 内部关联）
Profile: software_qualified；HIL: pending
```

添加设备流程：

1. 从标准模块库选择 Profile；
2. 填写项目实例名，如 `pump_io`，而不是模块型号；
3. 选择端口和站号；
4. 设置轮询周期与 stale 时间；
5. 勾选实际使用输入；
6. 勾选输出并逐项填写安全值、可选确认超时；
7. 检查完整写组和总线预算。

设备表单与 YAML 的映射必须固定：

| YAML 字段 | UI 含义 | 当前约束/默认 |
| --- | --- | --- |
| `name` | 项目设备实例 code | 项目内唯一；业务点 source 使用这个 code，不使用型号名 |
| `profile` | 固化模块型号 | 只能从产品目录选择，只读保存 |
| `port` | 物理串口 | `rs485_1`/`rs485_2`，且端口已配置 |
| `slave_address` | Modbus RTU 站号 | 1..247；同一端口唯一 |
| `poll_period_ms` | 每个 Profile read block 的轮询周期 | 1..65535 ms；生成结构为 U16，参与总线预算 |
| `stale_after_ms` | 最后有效采样超过该时间后置 stale | 正整数 U32；建议明显大于轮询周期 |
| `use.inputs` | 显式进入项目过程映像的输入信号名列表 | 只能选择 Profile 已知输入，不重复；普通 702/703/705 输出回读不在这里重复勾选 |
| `use.outputs.<signal>.safe_value` | STOP/FAULT/初始化安全目标 | 必填；BOOL 或 Profile raw 范围内整数 |
| `use.outputs.<signal>.confirm_timeout_ms` | 写 ACK 后等待寄存器回读一致的超时 | 可选正整数 U32；不填时生成器使用 `poll_period_ms * 3` |

第三方产品 Profile 使用与 701–705 不同的可视化语义：

- `profile` 仍是产品/协议定义，不将项目实例 `name` 误当成型号；
- ET703 在工具目录中标记为“第三方 Modbus RTU 三相电力测控仪”，当前字典含 21 个
  F32 电压、电流和功率信号；
- 未内置的 Profile 不再显示空白卡片。工具仅从 `devices[].use`、`points` 和 `northbound.fields`
  派生当前工程已声明信号，并明示“不代表设备全量能力”；
- 大点表设备卡首屏最多预览 8 个已配置点，悬停或键盘聚焦后以可滚动检查器展示全部点位、
  业务描述、当前值和质量，避免上百个点直接撑破拓扑画布；
- 点位“已显示”不等于“正在轮询”。当前 KZ3 HTTP 在线监测同时最多 12 点，未占用监测名额的值显示
  `— / NO DATA`，不得解释为 0 或 OFF。

RS485 端口字段必须原样落入 `rs485_ports.<port>`。schema 仍保留 baud/parity/stop bits 字段，但当前
产品生成器只接受 `9600/N/1`；工具应只读展示并固定序列化这三个值，不得利用 schema 的宽范围制造尚未
接入 UART 重配置的能力。`response_timeout_ms` 和 `offline_backoff_ms` 为 1..65535，`retry_count`
为 0..255。

即时校验：

- 同一端口站号不能重复，范围 1..247；
- `device.name` 必须在项目内唯一并可安全转换为 C 标识符；
- 设备引用的端口必须已启用；
- 输出安全值必须显式填写并落在 Profile 范围内；
- FC16 整组写入的通道必须完整声明，界面应把这一组作为不可拆分选择单元；
- 702/703 的 FC15 写请求覆盖完整 8-coil 组。即使项目只声明部分 DO，未声明位也会按产品默认安全值
  `false` 参与组写；界面必须提示整组所有权，禁止同一模块的其余位再由其他控制器并行写入；
- `stale_after_ms` 小于或接近轮询周期时给出不合理配置提示；
- 读取块数和总线占用超过上限时阻止冻结。

Profile 的寄存器详情放在右侧“协议详情”只读页。普通项目页不提供修改功能码、PDU 地址、字节序和
工程量换算的输入框。

#### 7.3.4 各模块实例页面的必备配置

| 模块 | 工程师必须配置 | 工具自动提供/派生 | 禁止工程师配置 |
| --- | --- | --- | --- |
| 701 | 实例名、端口、站号、轮询/stale、选用 `di01..di16` | FC01/PDU 0/count 16、BOOL 类型、qualification | 功能码、地址、DI 极性猜测 |
| 702 | 实例参数、选用 `di01..di08`、选用 `do01..do08`、每路 DO 安全值/可选确认超时 | DI 与 DO 回读块、FC15 写组、每路目标—回读关联 | 把 `doXX_feedback` 默认创建成第二业务点或真实反馈 |
| 703 | 实例参数、选用 `do01..do08`、每路安全值/确认超时 | FC15 写组和同地址 FC01 回读 | 虚构 DI、把寄存器回读叫接触器反馈 |
| 704 | 实例参数、选用 `ai01..ai08` | FC03、raw 到 µA 的换算、范围证据状态 | 用户手填缩放、把单位改成 mA 后不改契约 |
| 705 | 实例参数、选用 `di01..di04`；AO 作为完整 4 路组选择并逐路确认安全值 | DI 读取、AO FC03/FC16、U16 AB、raw 0..4095、目标—回读关联 | 只选 1 路 AO、在无证据时把 raw 换算为电流 |

模块卡片至少要有“通道选择”和“只读协议详情”两个视图。协议详情必须显示设备侧功能码/PDU/count、
wire type、字节序、raw/engineering、反馈性质和证据状态，不能只显示“701/702 型号”四个字。

### 7.4 I/O 点表

#### 7.4.1 主表字段

输入和输出分标签，也支持合并查看：

| 列 | 来源/编辑方式 | 说明 |
| --- | --- | --- |
| 序号 | 工具 | 仅用于视图排序，不作为稳定身份 |
| 方向 | 物理源推导 | Input/Output，不允许手工与源冲突 |
| 类型 | 物理源推导 | bool/float/u16 等，默认只读 |
| 业务名称 | 工程师填写 | `logic_name`，匹配 `[a-z][a-z0-9_]{0,47}` |
| 中文名称/说明 | 工程师填写 | 1..160 字符，写清用途和必要安全语义 |
| 物理来源 | 下拉/拖放 | `board.*` 或 `rtu.<device>.*` |
| 端子/模块/站号 | 自动展开 | 便于接线审查，不重复存 YAML |
| 单位/量程 | 固化硬件目录推导 | 对模拟量始终显示 |
| 质量能力 | 固化硬件目录/运行时推导 | 输入显示 `value/quality/update_ms` |
| 安全值 | 物理输出推导 | 输出始终显示；RTU 实例可配置 |
| 反馈性质 | Profile + 项目说明 | 区分命令回读、模块回读、真实运行反馈 |
| 北向状态 | 引用统计 | 未发布/已发布、地址和权限 |
| 验证状态 | 固化产品定义/项目证据 | 软件基线、HIL、现场状态 |

业务名称一旦随冻结版本交付，重命名必须提示它会破坏 `logic.c` 符号和 OpenCode 上下文；中文说明可在
不改变代码符号的情况下修改。

#### 7.4.2 批量操作

必须支持：

- 从 Excel/CSV 粘贴“业务名、说明、物理源”等列；
- 按设备通道批量生成，如 `pump_io_di01..08`；
- 批量添加前缀、替换前缀和序号补零；
- 批量创建北向只读字段，但必须先显示地址分配预览；
- 过滤未映射通道、输入、输出、模拟量、未验证项和地址未分配项；
- 多选删除时显示被 PID、Runtime、北向或需求引用的关系；
- 导出人读点表 CSV/Markdown 给电气人员复核。

批量粘贴不得“部分成功后不说明”。应先在暂存区解析全部行，列出成功、错误和冲突，确认后一次应用。

#### 7.4.3 唯一 owner 规则

- 每个物理输入只能映射一个业务输入；多个控制逻辑共同读取同一业务点即可；
- 每个物理输出只能有一个业务输出 owner；
- 对 702/703 DO 和 705 AO 这类同地址、同通道、同类型且同数值表示的寄存器，项目默认只创建一个
  输出业务点；不要因为 Profile 内部存在 `*_feedback` 信号就自动创建第二个业务点；
- 只有业务逻辑明确需要独立比较“目标值”和“模块最后寄存器读回”时，才允许在高级模式显式启用
  `*_feedback` 输入并创建第二个输入业务点。它必须命名和描述为“模块寄存器回读”，不能冒充物理反馈；
- 模块寄存器回读不能被默认命名为“电机运行反馈”，除非项目证据明确证明其物理语义；
- 北向写入不能直接成为物理输出 owner，写入应进入 parameter/command，再由逻辑联锁后产生输出。

#### 7.4.4 DO/AO 单业务字段的读写语义

同一个业务点不表示运行时只保存一个内存值。工具、生成器和固件应按下表明确展示不同观察面：

| 观察面 | 702/703 DO、705 AO | 板载 DO/AO |
| --- | --- | --- |
| `logic.c` 读取/写入 `IO_OUT` | 软件目标值 | 软件目标值 |
| 南向写请求 | 将目标值写到 Profile 固化的组地址 | 交给板载驱动 |
| 写后确认 | 读取同地址寄存器并与请求值比较 | 当前没有等价的板载物理反馈 |
| 北向只读 `point.<输出业务名>` | 生成器证明可合并时返回最后寄存器读回 | 返回软件目标值 |
| 实际端子/负载状态 | 未证明；需要独立 DI/AI 或 HIL | 未证明；需要独立 DI/AI 或 HIL |

自动合并必须同时满足：BOOL 使用 FC01 回读、U16 使用 FC03 回读；读写 PDU 相同；通道下标相同；
native type 相同；U16 为 AB 顺序、工程映射恒等且覆盖写目标 raw 范围。任一条件不满足时，工具显示
“不可自动合并”，北向不能静默把目标值冒充回读；需要回读时必须显式创建独立输入业务点。

工具的点表和北向表应分别显示“配置绑定”和“运行时读绑定”。例如：

```text
业务点 dio_702_do01 -> rtu.dio_702.do01
北向配置 bind       -> point.dio_702_do01
北向运行时读绑定    -> rtu.dio_702.do01_feedback
```

`do01_feedback` 只存在于产品 Profile/运行时内部，不要求在项目 `use.inputs`、`points.inputs` 或
`northbound.fields` 中重复声明。

### 7.5 应用变量

#### 7.5.1 参数 Parameter

用于保持型设定值、模式目标、阈值和超时。字段包括：

- name、中文名称/说明；
- c_type；
- default、min、max；
- unit；
- apply 策略，首版只允许当前运行时支持的 `next_scan`；
- 是否北向开放、访问协议和地址；
- 持久化状态徽标。

普通 parameter 当前只在 RAM 保持，重启恢复 YAML 默认值。界面必须明确显示“易失，未持久化”，不能
因为名称是“设置”就暗示掉电保存。

#### 7.5.2 命令 Command

用于启动、停止、复位、确认等 one-shot 事件。字段包括 name、说明、c_type 和北向映射。

固定系统命令 `controller_start/controller_stop/controller_reset` 以只读方式显示，项目不得重名声明。
命令页应提醒工程师为冲突命令定义优先级，并在需求与验收页补充 Given/When/Then。

#### 7.5.3 状态 State

状态分两类显示：

- **外部可观测状态**：由工程师配置，可进入北向和 OpenCode 业务契约；
- **AI 内部状态**：由 OpenCode 在 `logic_definition.json` 中提出，只用于编译和逻辑实现，默认不进入北向。

当前 YAML 会把两类状态最终合并到 `application_variables.states`，但工具内部必须保留来源和所有权，避免
AI 将内部临时变量伪装成平台长期接口。AI 如需新增对外状态，应返回平台变更提案，由工程师确认后形成
新的冻结版本。

### 7.6 逻辑资源

#### 7.6.1 普通功能块

页面按 Timer、Edge、Counter、Latch、Debounce、Filter、RateLimit 分类，显示实例名、用途说明、来源
（人工/AI 提案）和引用位置。规则：

- 每个独立状态必须有独立实例；
- 一个 Timer ID 不混用 TON/TOF/TP；
- Counter 存在时 `features.counter` 自动为 true，否则自动为 false；
- 功能块列表为空时仍生成合法空列表；
- 实例达到容量上限时阻止新增；
- AI 提案必须经过命名冲突和上限校验，不可自动覆盖人工实例。

不建议让 PLC 工程师在配置第一步被迫预先猜全所有 Timer。已知的工艺资源可以人工声明；其余由
OpenCode 返回内部声明，再在结果审查页显示。

#### 7.6.2 PID

PID 使用专门表单：

- name、默认 enabled；
- measurement：只能选择已声明 float 输入/parameter；
- setpoint：只能选择已声明 float 点或 parameter；
- output：只能选择板载 AO 或已声明 RTU analog_output；
- sample period：必须为扫描周期正整数倍；
- direct/reverse；
- Kp/Ki/Kd；
- output min/max；
- 输出物理范围、原始码范围和安全值只读联动展示。

没有现场整定依据时允许保存“禁用草稿”，但不得冻结为可发布候选。AI 不得自行发明 Kp/Ki/Kd。
`features.pid` 由 PID 实例数量派生，避免开关和列表不一致。

#### 7.6.3 Runtime

每个 Runtime 显示：

- 稳定名称和 EEPROM slot 顺序；
- 运行判定所依赖的业务输入/最终状态及质量策略；
- 只读 seconds 北向字段；
- 可选 clear 命令和必须配套的 clear_pending 状态；
- “真实运行反馈”或“命令运行时长”的语义标签；
- 已投产后的追加/重命名/删除风险。

Runtime 列表投产后默认只能尾部追加。重排、删除或改名按持久化 schema 破坏性变更显示红色确认，不能
当作普通表格排序。

### 7.7 北向通信

#### 7.7.1 协议设置

协议多选：SLE、HTTP、Modbus TCP。三者读取同一份字段模型，不分别维护三张点表。

Modbus TCP 当前固定显示：

- `address_style: modicon_5_digit`；
- `word_order_32: abcd`。

不支持的值不能仅作为自由文本保存。

#### 7.7.2 字段表

| 列 | 规则 |
| --- | --- |
| name | 1..48 字节 ASCII，字母/数字/`_-.`；作为 HTTP/SLE 对外名称 |
| bind | 从 `point/parameter/command/state` 中选择，不手写任意字符串 |
| c_type | 从 bind 推导并锁定；必要时显示等价类型，不允许不一致 |
| access | point/state 只允许 read；parameter/command 必须 read_write；工具层禁止物理 point 直写 |
| reference | 5 位 Modicon 地址，按类型和权限限制地址区 |
| width | 当前固件生成器的 manifest 按 bool/u16/i32 为 1、float/u32 为 2 编码；工具必须逐字节镜像该现状。`i32` 不是当前 HTTP owner 可写类型，工具保持禁用；`u8` 当前不开放 |
| compatibility | 新增/兼容修改/破坏性变更 |

`bind` 是数据 owner，不是 UI 标签。工具必须按 owner 限制候选、权限和地址区：

| bind 类别 | 方向/语义 | access | 推荐地址区 |
| --- | --- | --- | --- |
| `point.<input>` | 业务输入采样 | `read` | BOOL 用 `1xxxx`；数值用 `3xxxx` |
| `point.<output>` | 输出业务点；RTU 同地址输出读取寄存器回读，板载输出读取软件目标 | `read` | BOOL 可用只读 `0xxxx`；数值可用只读 `3xxxx` |
| `parameter.<name>` | 跨扫描保持的可写目标，当前易失 | `read_write` | BOOL 用 `0xxxx`；数值用 `4xxxx` |
| `command.<name>` | one-shot 命令 | `read_write` | 当前命令为 BOOL，使用 `0xxxx` |
| `state.<name>` | 逻辑可观测状态 | `read` | BOOL 用 `1xxxx`；数值用 `3xxxx` |

当前 Python 解析器还能接受部分直接 `board.*`/`rtu.*` bind，但可视化工具的新建与规范导出必须经
`point.<业务名>`，这样 OpenCode、北向、需求和物理 source 之间只维护一套业务符号。导入时若遇到直接
物理 bind，应显示迁移诊断，不得静默改写。

地址区规则：

| 地址区 | 类型/权限 |
| --- | --- |
| `00001..09999` Coils | BOOL，可读写命令/参数或只读输出状态 |
| `10001..19999` Discrete Inputs | BOOL，只读 |
| `30001..39999` Input Registers | 数值，只读 |
| `40001..49999` Holding Registers | 数值，可读写参数 |

北向 `reference` 与 RTU 设备侧 PDU 是两套独立地址空间。例如 702 DO1 的设备侧 PDU 是 16，而它完全
可以按项目北向契约发布为 `00009`。工具禁止用设备寄存器地址自动填充北向地址。

工具提供“自动分配”但必须满足：

- 按地址区分别分配；
- 32 位/float 预留连续两个地址；
- 不覆盖已有冻结地址；
- 批量分配前显示完整预览；
- 同一项目内绝不重叠；
- 与上一冻结版本比较时，把删除、移动地址、改类型和改权限标为破坏性变更。

SLE 页面以字段 `name` 显示外部 JSON key，并显示运行时分包预算。`north_key_id` 只能放在诊断详情中，
明确标为“固件内部路由 ID，不进入线协议、不可配置、不可作为上位机身份”。运行时按完整 KV 分包，
每包必须是可独立解析的完整 JSON，不截断 key、value 或 JSON；实际发送路径上限是 730 B 物理帧/
690 B JSON，冻结仍需同时通过当前生成器的保守预检查。前端预估不能替代权威生成器。

#### 7.7.3 安全权限

物理输出虽然可以作为只读状态发布，但默认禁止 `read_write`。工程师如果试图把 `point.pump_run`
设置为可写，界面应解释：这会绕过急停、故障、模式和本地许可；应改为创建 command/parameter，由
`logic.c` 形成最终输出。

#### 7.7.4 北向字段配置示例

```yaml
northbound:
  protocols: [sle, http, modbus_tcp]
  modbus_tcp:
    address_style: modicon_5_digit
    word_order_32: abcd
  fields:
    # 普通输入：读取业务输入采样
    - {name: di_701.di01, bind: point.di_701_di01,
       c_type: bool, access: read, reference: "10113"}

    # 702 DO：项目只配置一个输出业务点；北向运行时自动读取同地址回读影子
    - {name: dio_702.do01, bind: point.dio_702_do01,
       c_type: bool, access: read, reference: "00009"}

    # 705 AO：同样只配置一个业务点，读回原始码 U16
    - {name: io_705.ao01, bind: point.io_705_ao01,
       c_type: u16, access: read, reference: "30011"}

    # 外部控制请求必须先进入 command/parameter，不直接写输出 point
    - {name: command.pump_start, bind: command.pump_start,
       c_type: bool, access: read_write, reference: "00021"}
```

生成预览必须把 `dio_702.do01` 的两层绑定同时展示：配置绑定为 `point.dio_702_do01`，运行时读绑定为
`rtu.dio_702.do01_feedback`。如果预览仍显示软件目标、独立 `dio_702.do01_feedback` 北向字段，或者允许
把 `point.dio_702_do01` 设为 `read_write`，均视为实现错误。

### 7.8 需求与验收

本页不是完整需求管理平台，而是为 OpenCode 输出稳定输入。建议采用“自由文本 + 结构化约束”双视图。

结构化区域至少包含：

| 区域 | 必填内容 |
| --- | --- |
| 模式 | 自动/手动、就地/远程、owner 切换和优先级 |
| 输入 | 正常语义、质量要求、失效行为 |
| 参数 | 默认、范围、单位、生效时机和是否易失 |
| 命令 | one-shot 语义、允许条件、冲突优先级 |
| 状态 | 锁存、清除、可观测要求 |
| 输出 | 正常行为、安全值、是否必须看真实反馈 |
| 时序 | 延时、脉冲、最小启停时间、超时和扫描周期 |
| 故障 | 急停、坏质量、RTU 离线、STOP/FAULT、复位和自动恢复策略 |

Given/When/Then 场景表字段：场景名、Given 初始状态、When 输入/命令序列、Then 输出/状态、时间边界、
验证层级（主机/HIL/现场）。输入点、变量和输出均从已配置符号选择，避免在需求中出现拼写不同的同一
对象。

缺少关键策略时记录为 `unresolved`。允许导出草稿给 OpenCode 做缺口分析，但不能标为可发布生成请求。

### 7.9 工程检查

诊断分四级：

| 级别 | 行为 |
| --- | --- |
| Error | 配置不可生成，阻止冻结 |
| Safety Blocker | 结构可生成，但安全值、反馈或关键失败策略未确认，阻止发布候选 |
| Warning | 可生成但存在兼容性、容量余量或证据风险 |
| Info/TODO | 不阻塞草稿导出，明确后续 HIL/现场项 |

每条诊断包含稳定 code、实体 ID、界面路径、YAML path、中文说明、建议动作和来源校验器。例如：

```json
{
  "code": "DUPLICATE_SLAVE_ADDRESS",
  "severity": "error",
  "entity": "device:pump_io_02",
  "ui_path": "硬件组态/RS485_1/pump_io_02",
  "yaml_path": "project.devices[2].slave_address",
  "message": "RS485_1 的站号 1 已被 pump_io_01 使用",
  "source": "firmware-validator"
}
```

双击诊断必须跳到准确单元格，不能只打开整页。

### 7.10 导出与历史

导出页依次提供：

1. 规范化 YAML 预览；
2. 与最近冻结版本的语义 Diff；
3. 权威校验结果；
4. 未验证项和发布阻塞项确认；
5. 工具自动绑定的产品硬件契约标识与 hash；
6. 导出“单个 YAML”或“OpenCode 工作空间包”。

发布过的快照只读。后续编辑创建工作副本，不在原快照上原地修改。

### 7.11 在线调试工作台（工程契约校验与受控写入）

NP-Tools 通过独立路由提供“在线调试”工作模式，消费控制器已有 HTTP v1 API。进入该模式后自动收窄
全局导航、隐藏无关串口状态并冻结工程编辑；调试会话、样本和写入证据不写回 `project_io.yaml`。
当前固件已提供 `/api/v1/project` 和点位 `GET/POST`。工具按固件生成器的规范重算北向 manifest，只有工程 ID、版本、算法、hash 和点数匹配时才可能申请受控写入；工具构建、诊断读取、owner 接受或读回均不等于 HIL 或生产控制验收。

| 能力 | 当前实现 | 明确边界 |
| --- | --- | --- |
| 本地 HTTP 代理 | Rust/Tauri 后端只允许固定诊断资源、`/api/v1/point/<name>` GET 和严格形状的 POST | 禁止任意 URL、任意路径、URL 凭据、`point/state` 直接写入；仅允许 HTTP 根地址 |
| 固定诊断 | 串行读取 device/hardware/project/network/sle/io/config/services/health | 保留 HTTP status、错误码和原始 body |
| 工程兼容性 | 读取 `/api/v1/project`，重算 ID/版本/点表 manifest/点数 | `matched` 只证明北向访问契约；原始 YAML `configuration_hash`、逻辑与 HIL 不能由工具独立证明 |
| 点位监视 | 从当前北向映射生成本地 descriptor，最多同时轮询 12 点；监视组按工程保存在本机 | 设备不枚举点位；设备质量与工具本地陈旧分别显示 |
| 板级 I/O | DI/AI 标为采样，DO/AO 标为软件目标 | 软件目标、寄存器回读影子和物理反馈不得混称“当前值” |
| Parameter/Command 写入 | BOOL/FLOAT/U32 parameter 和 BOOL 单次 command（含 runtime clear）可在受控门禁下写入 | U16/I16/I32、`point.*`、`state.*`、物理 I/O 和只读字段保持禁用 |
| 写入门禁 | 工程契约匹配、操作员、四项健康、无 active fault、显式依据和 10 分钟许可 | 每次写前重新读取 health/io/project；HTTP 无 CAS、request ID、认证或 TLS，失败不重试 |
| 审计证据 | 记录诊断、写前值、请求值、owner 接受、写后读回和人工备注 | owner 接受、读回或备注不等于逻辑、物理或 HIL 结论 |

兼容性状态为 `unverified`、`partial`、`matched` 或 `mismatch`。认证、TLS、客户端 CAS、command request ID/TTL 和结果细分错误码仍未提供。`/api/v1/io.remote_write_allowed`
是兼容板级投影，不能作为生成点位 POST 权限门禁；详细残余差距见 [KZ3 固件接口差距记录](../../KZ3_F427_SLE_V1/docs/NP-Tools固件接口差距记录.md)。

轮询采用单会话串行调度，同一时刻最多一个在途设备请求。每个周期读取 `/io`、`/health`、一个慢速
诊断资源和用户选择的少量点位，不对全部北向字段进行高频扫描。页面关闭后停止轮询。断开或重连后，
旧会话迟到响应必须丢弃，不能污染新会话状态。

在线调试布局以 PLC Watch Table 为主体：目标身份固定显示，监视表占据首屏，质量和时效紧邻实时值，
监视列与操作列冻结。北向字段按“控制命令、可调参数、状态反馈、过程 I/O、其他上报”固定分组，分组头
同时显示字段数、可写/只读属性和监视数量，并支持独立或整体展开、收起；控制与调参不得和平铺的只读
上报混为同一视觉层级。点表的地址列只显示北向 Modbus `reference`，不重复平铺 `bind` 和值语义；后两者
保留为搜索证据和地址悬停详情。设备、网络、服务和原始板级 I/O 放入可开合诊断侧栏；侧栏默认 400 px，
允许现场工程师拖动左边缘在 340～620 px 内调整并保存本机偏好，窄窗口切换为受视口约束的覆盖模式。该
宽度为后续多扩展模块诊断留出展示空间，但模块内容仍必须来自设备固定诊断接口，不得根据工程配置伪造。
会话日志与证据使用固定底部 Dock。无有效采样时统一显示 `—`、`UNKNOWN` 或“无采样”，严禁把缺失证据
显示为 `0`、`OFF` 或正常值。

在线调参时可从调试页标题栏打开“I/O 拓扑伴随监测”浮窗。桌面窗口支持拖动、右下角缩放、最小化、
Esc 关闭和布局位置本机保存；窄窗口自动降级为底部面板，避免浮窗超出可视区。浮窗按主控板及每个
RS-485 设备切换，提供点位筛选，并允许将具备北向描述符的 Southbound 点加入或移出当前最多 12 点的
监测组。上百点第三方产品只在浮窗内部滚动，不扩大主调试画布。

浮窗必须复用在线调试 Store 中的会话、诊断快照、监测列表和样本，禁止自行连接设备或启动第二套轮询。
板载 DI/AI 来自 `/diagnostic/io` 采样，板载 DO/AO 只能标为软件目标；标准扩展模块的输出回读按 Profile
标为回读影子，仍不得描述为端子物理反馈。浮窗关闭、拖动或最小化不得中断在线调试轮询和写入草稿。

当前写入弹窗与事务语义必须保持以下边界：写入弹窗是稳定的独立合成层，不得因后台周期采样被卸载、重新挂载或触发全屏模糊重绘。弹窗内的
“打开时读值”取打开瞬间快照，目标值和测试依据由本地表单持有；后台监视可以继续刷新，正式提交时仍按
“写前 GET—单次 POST—写后 GET”获取权威写前值和读回证据。提交按钮的可用状态不得直接绑定
`pollInFlight` 等周期性瞬态标志；点击提交后应停止后续轮询、等待当前轮询自然排空，再进入写事务，避免
按钮闪动和读写请求并发。

实时样本、用户写入草稿和提交请求值必须是三份独立状态。数值输入事件只更新用户草稿，任何诊断或点位
轮询响应都不得调用草稿初始化；提交瞬间再次从输入控件读取可见值并固化为 `requestedValue`。目标值一旦
修改，原安全确认立即失效。写前 GET 若发现设备值与弹窗打开快照不同，本次写入取消并要求工程师重新
核对，不能静默覆盖外部变化。

写入类弹窗禁止使用“点击遮罩关闭”。输入框拖选文本时，指针可能在弹窗外释放，不能因此丢弃写入草稿；
仅允许通过右上角关闭按钮、底部取消按钮或流程完成明确退出。

### 7.12 UART1 设备初始化与维护工作台

NP-Tools 使用独立路由 `/devices/controller/maintenance` 提供设备维护页，与工程组态、HTTP 在线调试和
通用自由文本终端分离，但串口物理连接统一复用应用侧边栏底部的 `GlobalSerialBar/serialStore`；维护页
不得再枚举端口或提供第二套连接/断开控件。当前实现由以下区域组成：

1. 公共串口状态：只读显示全局连接和参数匹配状态；端口选择、参数和连接操作均在左下角公共串口完成；
2. 设备总览：展示 SYS、ETH、SLE、IO、DEBUG 的最后查询快照和配置域生效矩阵；
3. 单项维护：类型化表单构造白名单命令，前端先按固件范围、ASCII 和长度约束校验；
4. 生效复核：写入成功后自动发送所属配置组的 SHOW；写入与复核是两条独立会话记录；
5. 实时事务：显示当前在途命令、RX/TX 字节、最近 UART 行和错误；
6. 会话记录：保留命令、时间、串口、最终协议回包、完整原始行、结果和验证边界，可导出 JSON。

连接状态区分 `disconnected/connected/querying/writing/waiting_reboot/error`。串口断开会终止在途事务；
换端口后旧快照标为来自其他串口，不能继续当作当前设备状态。所有写操作弹出明确确认，不提供循环发送；
超时结果记为 `timeout`，只允许用户重新查询或再次明确发送。公共串口不是 `115200 8N1`、无流控时，
维护页只提示参数不匹配并禁用所有 KZ3 查询/写入，不擅自断开或改写其他公共工具正在使用的连接。

Ethernet 页面用三列表对照 RUN/SAVED；只有二者一致且 `REBOOT_REQUIRED=0` 才显示一致。系统角色页面同屏
展示 ACTIVE 与 SAVED、地址、`ACTIVE_RECORD/RECORD`；保存后进入等待重启状态，物理复位后的再次 SHOW
仍由用户执行。SLE 页面使用四层阶梯显示 EEPROM `VALID`、模组 `READY`、`MAC_VALID` 和本轮 AT 参数
`CFG_APPLIED/AT_*`，不使用单一绿色“成功”覆盖不同证据层。配置表单中的 `CFG_ADDR`、`APID` 分别固定
为 `0`、`1` 且不可编辑；命令构造层再次强制使用固定值，设备回读值只用于诊断展示。

当前实现边界：已经通过 TypeScript 静态检查/构建的主机 UI 与协议逻辑不等于串口实机通过；真实 UART
收发、EEPROM 掉电恢复、Ethernet 重启切换、SLE 模组 AT/无线互通、双角色 RS485 owner 与维护安全态仍需
按目标固件和实板记录 HIL 证据。

## 8. 配置模型与 YAML 映射

### 8.1 工具内部领域模型

界面不能直接把 YAML 行号当作对象身份。建议内部实体都带稳定 UUID：

```text
ProjectDocument
├── identity
├── productHardwareContract
├── boardInstance
├── rs485Ports[]
├── deviceInstances[]
├── ioExtensionExports[]     生成 io_extension.exports 和伴生 RTU Profile
├── physicalChannels[]       从固化硬件目录和设备 use 派生
├── businessPoints[]         uid + logicName + sourceRef + description
├── externalVariables[]      uid + category + contract
├── logicResources[]         uid + kind + owner(manual/ai)
├── northFields[]            uid + bindRef + address
├── requirement
├── acceptanceScenarios[]
├── evidenceRefs[]
└── snapshots[]
```

UUID 保存在工具工作区元数据或本地数据库，不必进入当前固件 YAML。YAML 继续以稳定 `logic_name` 和
binding 作为固件交换契约。

### 8.2 YAML 字段来源

| YAML 区域 | 人工编辑 | 自动派生 | AI 是否可改 |
| --- | --- | --- | --- |
| `project.name/id/version` | 是 | schema | 否 |
| `project.board` | 否 | 固定为 `kz3_f427_standard` | 否 |
| `required_profiles` | 否 | 从 devices 去重排序 | 否 |
| `scan_period_ms` | 是 | 默认值可由模板提供 | 否 |
| `features.pid/counter` | 否 | 从 PID/Counter 数量派生 | 只能提案内部资源 |
| `features.retained` | 禁用/固定 false | 当前运行时边界 | 否 |
| `rs485_ports` | 是 | 预算派生 | 否 |
| `devices` | 是 | 通道类型/Profile 细节派生 | 否 |
| `io_extension.exports` | 是，从受限候选点中选择 | reference、类型、Profile 和 `io_map_hash` 派生 | 否 |
| `points` | 是 | direction/type/quality 派生 | 否 |
| parameters/commands | 是 | 系统命令自动加入运行时，不重复写 YAML | 否 |
| 外部 observable states | 是 | 无 | 否 |
| 内部 states/blocks | 可选人工 | OpenCode 可提案 | 仅写 logic definition |
| `pids` | 工程师确认 | AI 可建议是否需要 | 不得发明整定值/物理输出 |
| `northbound` | 是/自动分配后确认 | 类型、宽度、运行时读绑定、SLE 分包预算 | 否 |

### 8.3 AI 内部声明合并

可视化工具导出的 `project_io.yaml` 是外部配置事实。OpenCode 不直接修改它，而是输出：

```text
logic_definition.json
├── internal_states
├── timers/edges/counters/latches
├── debounces/filters/rate_limits
├── runtime 使用声明或引用
└── pid 使用声明或引用
```

最终确定性适配器按以下规则合并：

- 人工声明优先，AI 同名同类型引用允许；
- 同名不同类型、同一资源多 owner 或超容量直接失败；
- AI 新增内部 state/普通功能块允许进入临时 resolved 模型；
- AI 新增 parameter、command、对外 state、physical point、device 或 north field 一律拒绝；
- PID 若缺平台已确认的参数、输出或整定值，返回 unresolved；
- 合并结果可临时物化为 `resolved_project_io.yaml` 供现有生成器使用，但不得覆盖冻结源文件。

这解决了当前生成器要求所有 state/功能块都出现在 YAML，而配置第一步又无法预知全部内部实现资源的
矛盾。

### 8.4 YAML 序列化

导出必须确定性：

- 固定字段顺序、缩进、布尔和数值格式；
- 设备、通道和业务点默认保持工程顺序，不因字典排序随机变化；
- `required_profiles` 由设备集合派生并稳定排序；
- 不输出 UI 布局、选中状态、折叠状态和 UUID；
- 保存前提供语义 Diff，避免大面积无意义格式变化；
- 导入已有 YAML 时使用可保留注释/顺序的 AST；无法保留的注释在保存前明确提示；
- 未识别字段不得静默删除；canonical export 前必须迁移或确认拒绝。

### 8.5 可直接落地的 701/702/704/705 项目示例

下面是一份结构完整、符合当前单字段语义的示例。它演示工具必须生成的全部区域，不代表示例站号、
安全值或北向地址可以直接用于现场。为了演示 705 的 FC16 完整写组，4 路 AO 必须同时声明。

```yaml
schema: kz3-project-io/v2

project:
  name: 扩展模块组态示例
  id: expansion_io_example
  version: 1.0.0
  board: kz3_f427_standard
  required_profiles: [sp4055_701, sp4055_702, sp4055_704, sp4024_705]
  scan_period_ms: 10

  features: {pid: false, counter: false, retained: false}

  rs485_ports:
    rs485_1:
      baud: 9600
      parity: none
      stop_bits: 1
      response_timeout_ms: 100
      retry_count: 1
      offline_backoff_ms: 5000

  devices:
    - name: field_di
      profile: sp4055_701
      port: rs485_1
      slave_address: 8
      poll_period_ms: 500
      stale_after_ms: 1500
      use:
        inputs: [di01]

    - name: field_dio
      profile: sp4055_702
      port: rs485_1
      slave_address: 1
      poll_period_ms: 500
      stale_after_ms: 1500
      use:
        inputs: [di01]
        outputs:
          do01: {safe_value: false, confirm_timeout_ms: 1500}

    - name: field_ai
      profile: sp4055_704
      port: rs485_1
      slave_address: 3
      poll_period_ms: 500
      stale_after_ms: 1500
      use:
        inputs: [ai01]

    - name: field_io
      profile: sp4024_705
      port: rs485_1
      slave_address: 22
      poll_period_ms: 500
      stale_after_ms: 1500
      use:
        inputs: [di01]
        outputs:
          ao01: {safe_value: 0}
          ao02: {safe_value: 0}
          ao03: {safe_value: 0}
          ao04: {safe_value: 0}

  points:
    inputs:
      - {name: remote_allow, source: rtu.field_di.di01,
         description: 701 DI1 远程启动许可}
      - {name: pump_fault, source: rtu.field_dio.di01,
         description: 702 DI1 水泵故障输入}
      - {name: inlet_current_ua, source: rtu.field_ai.ai01,
         description: 704 AI1 输入电流，单位 µA}
      - {name: local_mode, source: rtu.field_io.di01,
         description: 705 DI1 就地模式输入}
    outputs:
      - {name: pump_run, source: rtu.field_dio.do01,
         description: 702 DO1 水泵运行软件目标}
      - {name: valve_position_raw, source: rtu.field_io.ao01,
         description: 705 AO1 阀位输出原始码 0..4095}
      - {name: spare_ao02_raw, source: rtu.field_io.ao02,
         description: 705 AO2 已纳入完整写组，当前保持安全值}
      - {name: spare_ao03_raw, source: rtu.field_io.ao03,
         description: 705 AO3 已纳入完整写组，当前保持安全值}
      - {name: spare_ao04_raw, source: rtu.field_io.ao04,
         description: 705 AO4 已纳入完整写组，当前保持安全值}

  application_variables:
    parameters: []
    commands:
      - {name: pump_start, c_type: bool}
    states:
      - {name: pump_running, c_type: bool, default: false}

  pids: []

  logic_blocks:
    timers: []
    edges: []
    counters: []
    latches: []
    debounces: []
    filters: []
    rate_limits: []
    runtimes: []

  northbound:
    protocols: [sle, http, modbus_tcp]
    modbus_tcp:
      address_style: modicon_5_digit
      word_order_32: abcd
    fields:
      - {name: input.remote_allow, bind: point.remote_allow,
         c_type: bool, access: read, reference: "10001"}
      - {name: input.pump_fault, bind: point.pump_fault,
         c_type: bool, access: read, reference: "10002"}
      - {name: input.inlet_current_ua, bind: point.inlet_current_ua,
         c_type: u16, access: read, reference: "30001"}
      - {name: output.pump_run, bind: point.pump_run,
         c_type: bool, access: read, reference: "00011"}
      - {name: output.valve_position_raw, bind: point.valve_position_raw,
         c_type: u16, access: read, reference: "30002"}
      - {name: command.pump_start, bind: command.pump_start,
         c_type: bool, access: read_write, reference: "00001"}
      - {name: state.pump_running, bind: state.pump_running,
         c_type: bool, access: read, reference: "10003"}
```

这个示例中的 702/705 输出均没有把 `do01_feedback`/`ao01_feedback` 写入 `use.inputs` 或
`points.inputs`。生成后，`output.pump_run` 和 `output.valve_position_raw` 的北向运行时读绑定分别应为
`rtu.field_dio.do01_feedback` 和 `rtu.field_io.ao01_feedback`；逻辑仍只写 `point.pump_run` 和
`point.valve_position_raw` 对应的输出目标。

### 8.6 当前活动工程点位与北向 golden fixture

当前活动项目 `board_io_expansion_point_test` 的正式源位于
`application/projects/全IO扩展模块点位测试/project_io.yaml`，它是工具导入/导出和 UI 回归的基准，
不是新项目默认模板。工具必须无损展示以下 68 个业务点：

| 来源 | 输入业务点 | 输出业务点 | 数量 |
| --- | --- | --- | ---: |
| 板载 | `board_di01..board_di12` | `board_do01..board_do08` | 12 + 8 |
| 701 实例 `di_701` | `di_701_di01..di_701_di16` | 无 | 16 |
| 702 实例 `dio_702` | `dio_702_di01..dio_702_di08` | `dio_702_do01..dio_702_do08` | 8 + 8 |
| 704 实例 `ai_704` | `ai_704_ai01..ai_704_ai08` | 无 | 8 |
| 705 实例 `io_705` | `io_705_di01..io_705_di04` | `io_705_ao01..io_705_ao04` | 4 + 4 |

其中输入共 48 个、输出共 20 个。702/705 的 12 个 `*_feedback` 是运行时内部读回影子，不计入 68 个
项目业务点。当前活动工程有 69 个北向字段，地址布局如下：

| 北向字段组 | c_type/access | reference |
| --- | --- | --- |
| `board.di01..di12` | BOOL/read | `10101..10112` |
| `di_701.di01..di16` | BOOL/read | `10113..10128` |
| `dio_702.di01..di08` | BOOL/read | `10129..10136` |
| `io_705.di01..di04` | BOOL/read | `10145..10148` |
| `board.do01..do08` | BOOL/read，软件目标 | `00001..00008` |
| `dio_702.do01..do08` | BOOL/read，运行时读寄存器回读 | `00009..00016` |
| `ai_704.ai01..ai08` | U16/read，单位 µA | `30001..30008` |
| `test.board_di01_runtime_seconds` | U32/read，占 2 registers | `30009..30010` |
| `io_705.ao01..ao04` | U16/read，运行时读 raw 回读 | `30011..30014` |

`10137..10144` 当前未分配。工具必须保留显式地址，不得因为存在空洞就自动压缩后续字段；只有工程师
执行地址重排并确认外部契约变化时才能移动。golden fixture 的生成预览还必须显示 702 DO/705 AO 的
“配置绑定”和“运行时读绑定”不同，且不生成独立的 `dio_702.doXX_feedback` 北向字段。

## 9. 校验体系

### 9.1 四层校验

```text
单元格即时校验
    ↓
页面/引用关系校验
    ↓
工程领域模型校验
    ↓
固件生成器权威校验 + 临时生成
```

前端即时校验用于交互速度，后端领域校验用于完整引用关系，`point_config_gen.py` 或后续 SDK 是导出前
最终权威。完整检查还要对临时生成的 C/H 执行最小 C11 编译，使 `LogicContext <= 4 KiB` 等
`_Static_assert` 真正生效；只生成文件并不能证明编译期断言通过。相同规则应逐步从 Python 生成器提取
为共享 schema/库，避免前后端手工维护两套数字。

### 9.2 必须覆盖的现行规则

#### 项目身份

- schema 必须为 `kz3-project-io/v2`；
- id/version 为 1..48 位受限 ASCII；
- board 名称与板型定义一致；
- `required_profiles` 与实际 devices 使用集合完全一致；
- scan period 为正整数。

#### 端口和设备

- 只支持 `rs485_1/rs485_2`；
- baud/parity/stop bits 固定为 `9600/N/1`，timeout/retry/backoff 落在生成器范围；
- 同一端口站号唯一，站号 1..247；
- poll/stale 为合法正整数；
- use 通道存在且不重复；
- 输出安全值显式、类型正确、范围合法；
- FC16 写组必须完整；
- 702/703/705 的输出—回读关联必须与固定 Profile 一致，项目不能覆盖 PDU、通道、类型或缩放；
- 同地址输出默认不把 `*_feedback` 加入业务输入；若高级模式显式启用，必须标记为寄存器回读；
- 同一物理输出不能被两个设备实例重复声明。

#### 系统角色与 IO 扩展导出

- 系统角色和本机从站地址不得写入 `project_io.yaml`，只通过 `@CFG,IO,*` 管理 EEPROM；
- `CONTROLLER` 地址固定为 0，`RTU_SLAVE` 地址必须为 1..247；
- 工具不得开放 RS485 从站端口、9600/N/1 或 1500 ms watchdog 的项目级覆盖；
- IO 模式聚合导出只允许 `rs485_1` 已声明的只读输入/反馈，不允许重复导出板载点，也不允许引用
  `rs485_2` 下行点；
- IO 模式不得下发 UART3 输出，导出表不能把下挂输出命令声明为可写 owner；
- 导出类型只允许与源一致的 `bool/u16`，最多 64 项；BOOL reference 从 `10101`、U16 reference 从
  `30101` 按类型连续分配，且不得覆盖固定诊断区；
- 生成的 `rtu_slave_profile.yaml` 必须与 `io_extension.exports` 和 `io_map_hash` 确定性一致；
- 上层 Controller 使用 `kz3_f427_io` 实例时，同一端口站号唯一，且 Profile hash 不匹配必须禁止输出。

#### 业务点

- name 匹配 `[a-z][a-z0-9_]{0,47}`，输入输出全局唯一；
- description 为 1..160 字符；
- source 已启用、方向和类型匹配；
- 一个物理 source 只能映射一次；
- 702/703 DO、705 AO 的普通模式每通道只有一个输出业务点；不自动生成反馈输入业务点；
- 重命名后所有 PID、Runtime、北向和需求引用必须同步或报错。

#### 变量和逻辑资源

- 类型必须是运行时明确支持的类型，禁止未知类型默认为 float；
- 名称和 C 标识符转换后均不能冲突；
- parameter default/min/max 和 apply 合法；
- 系统命令不得重复；
- runtime 自动字段不得由项目重复声明；
- Counter/PID 开关与实例列表一致；
- 每类功能块不超过容量上限。

#### PID

- measurement/setpoint 为 float；
- output 为合法 AO；
- 周期是 scan period 正整数倍；
- direction 为 direct/reverse；
- Kp/Ki/Kd 和限幅为有限数；
- output min < max 且落在物理范围；
- U16 AO 限幅使用整数原始码。

#### 北向

- name 唯一且为 1..48 字节受限 ASCII；
- bind 存在且类型一致；
- reference 是合法 5 位地址；
- BOOL/数值地址区正确；
- 只读区不得 read_write；
- parameter/command 必须 read_write，state 必须 read；
- 可视化工具层 point 只允许 read，禁止直接北向写物理输出；
- 1/2 寄存器宽度不重叠；
- 北向 `reference` 与设备侧 RTU PDU 不得混用或自动互填；
- 可安全合并的 RTU 输出只保留一个北向字段，并验证运行时读绑定指向内部 `*_feedback`；
- 板载模拟量保持当前发布禁用；
- SLE 外部身份使用字段 name，不把内部 `north_key_id` 纳入兼容性检查；
- SLE 同时满足当前生成器保守门禁和 730 B 物理帧/690 B JSON 运行时上限。

#### Runtime

- 最多 16 个；
- 每个必须有唯一只读 U32 seconds 北向字段；
- 暴露 clear 时必须同时暴露只读 clear_pending；
- 未暴露 clear 时不得单独暴露 pending；
- 已冻结项目的顺序变化标为持久化破坏性变更。

### 9.3 资源门禁

| 资源 | 当前上限/阈值 |
| --- | ---: |
| binding | 256 |
| `LogicContext` | 4096 B |
| 北向字段 | 128 |
| 每端口读取块 | 32 |
| RTU 常态占用 | ≤50% |
| RTU 故障退避稳态占用 | ≤80% |
| Timer | 32 |
| Edge | 16 |
| Counter | 16 |
| Latch | 32 |
| Debounce | 16 |
| Filter | 16 |
| RateLimit | 16 |
| PID | 4 |
| Runtime | 16 |

界面数字必须来自生成器能力描述或校验结果，不能在多个前端文件中复制硬编码。上限随固件契约升级时，
旧项目继续按其锁定契约校验。

### 9.4 安全证据校验

结构校验通过不代表现场事实充分。工具另外维护证据状态：

- 来源：原理图、端子图、手册页、抓包、HIL 记录、现场记录；
- 结论：极性、量程、站号、寄存器、安全值、反馈性质；
- 状态：未提供、待复核、软件确认、HIL 确认、现场确认；
- 适用对象：板型、Profile、设备实例、通道或项目；
- 附件路径/hash 和确认人/时间。

这些元数据不进入 MCU，但应进入导出工作空间和发布审查报告。安全值或反馈性质缺证据时允许保存草稿，
默认阻止“发布候选”状态。

## 10. OpenCode 衔接设计

### 10.1 边界

可视化工具决定：

- 有哪些真实输入/输出；
- 它们接到哪个板载端子或 RTU 通道；
- 站号、轮询、量程和安全值；
- 业务 `logic_name`、参数、命令和对外状态；
- 北向名称、类型、权限和地址；
- 工艺需求、故障策略和验收场景。

OpenCode 决定：

- 如何组合点位实现控制需求；
- 需要哪些内部 state、Timer、Edge、Counter 等实例；
- `Logic_Init/Logic_Scan/Logic_Stop` 的具体实现；
- 可在主机执行的场景测试。

AI 没有权限修改前一组内容。

### 10.2 最小 AI 上下文

由工具从冻结工程派生，不直接把完整 YAML 和所有 Profile 细节全部喂给模型：

```text
项目身份与固件逻辑契约版本
扫描周期
工艺需求与验收场景
业务输入：name/type/unit/quality/说明
业务输出：name/type/range/safe_value/说明
参数、命令和对外状态
允许使用的 logic.h 短 API
已人工声明的逻辑资源
强制安全和禁止访问规则
```

RTU 地址、功能码、PDU、板载 driver channel 和北向 Modbus 地址默认不进入 AI 上下文；这些信息对
实现工艺逻辑没有帮助，且会增加 AI 越权风险。

### 10.3 缺口返回

OpenCode 发现需求无法用现有契约实现时，返回结构化 unresolved：

| code | 示例 | 工具动作 |
| --- | --- | --- |
| `MISSING_REQUIRED_POINT` | 缺少过载输入 | 跳回 I/O 点表并创建待配置建议，不自动加点 |
| `REQUIRES_PLATFORM_VARIABLE` | 需要在线阈值 | 跳回参数页，由工程师确认类型、范围和地址 |
| `AMBIGUOUS_FAILURE_POLICY` | 坏质量保持还是停机不明确 | 跳回需求故障策略 |
| `MISSING_PID_TUNING` | 没有 KP/KI/KD | PID 保持禁用草稿 |
| `UNSUPPORTED_LOGIC_BLOCK` | 当前 ABI 无所需块 | 返回固件平台评审，不让 AI 自造接口 |

修改后产生新冻结快照和新 request ID，原生成任务保持可追溯。

### 10.4 生成结果回导

工具可以提供“OpenCode 结果”页，读取：

- `logic_definition.json`；
- `logic.c`；
- `logic_project_test.c`；
- `unresolved.json`；
- `generation_report.json`。

页面重点不是做完整 C IDE，而是：

- 显示 AI 新增的内部资源和容量变化；
- 检查外部契约是否被修改；
- 显示编译/测试错误和重试状态；
- 将结果与输入 hash 绑定；
- 明确验证范围为 `host_only`；
- 允许导出最终源码三件套和报告。

## 11. 导出工作空间与产物

### 11.1 推荐目录

```text
<project-id>-<version>/
├── input/
│   ├── project_io.yaml
│   ├── requirement.md
│   ├── acceptance_scenarios.json
│   ├── generation_request.json
│   ├── evidence_manifest.json
│   └── product_contract.lock.json
├── prepared/                 由生成 SDK 写入
├── ai/                       OpenCode 唯一可写输入结果目录
├── generated/                确定性生成器输出
├── build/                    临时构建，不作为源码事实
├── result/
│   ├── logic.c
│   ├── point_config.c
│   ├── point_config.h
│   └── generation_report.json
└── workspace_manifest.json
```

板型/Profile 随生成 SDK 固化，不由项目工作空间携带和维护。`product_contract.lock.json` 只记录当前工具
自动绑定的固件产品、硬件目录和生成契约身份；生成 SDK 根据该身份加载自身内置的固定定义。如果继续
直接调用当前 `point_config_gen.py`，由 SDK 适配层在临时目录放置内置 `io_definitions`，不能要求项目
工程师复制、选择或维护这些文件。

### 11.2 `project_io.yaml`

这是可视化工具的主产物，保持当前 `kz3-project-io/v2` 兼容。它包含所有人工冻结的外部配置以及人工
预声明的逻辑资源。AI 后续资源通过 overlay 合并，不直接改源文件。

### 11.3 `generation_request.json`

由工具确定性派生，用于对接 OpenCode 生成 SDK：

```json
{
  "schema": "kz3-logic-generation/v1",
  "request_id": "job-20260824-001",
  "firmware_contract": "kz3-f427-logic/v2",
  "project_identity": {"id": "water_station_a", "version": "1.0.0"},
  "input_sha256": "...",
  "product_contract_sha256": "...",
  "requirement_path": "input/requirement.md",
  "configured_project_path": "input/project_io.yaml"
}
```

具体字段以 OpenCode 架构 P0 冻结结果为准，当前文档只规定它必须引用同一冻结快照。

### 11.4 产品契约锁

标准板型和模块完全内置，项目导出时自动记录所绑定的产品契约：

- 固件产品 ID/version；
- 固定 board 名称和实际使用的 Profile 名称；
- 内置硬件目录整体 SHA-256；
- 兼容的固件 contract/schema；
- 工具/生成 SDK 版本和导出时间。

这个文件由工具自动生成且界面只读，不形成“硬件定义版本选择器”。如果产品契约身份不匹配，生成服务
应要求使用对应工具/固件版本，不能让工程师临时选择另一份 Profile 继续生成。

### 11.5 人读产物

除生成器现有 `point_config.md` 外，建议导出：

- I/O 点表 CSV；
- 北向地址表 CSV；
- 设备/端口表；
- 未验证项清单；
- 版本语义 Diff；
- 验证范围声明。

这些文件用于评审和交接，不进入 MCU。

## 12. 软件架构与实现建议

### 12.1 总体架构

```text
Web UI / Desktop Shell
    │
    ├── Project Editor Store
    ├── Table/Topology/Inspector Views
    └── Local API Client
            │
            ▼
Local Application Service
    ├── Project Domain Model
    ├── Definition Library Service
    ├── Import/Migration/Serialization
    ├── Validation Orchestrator
    ├── Generator Adapter
    ├── Diff/Snapshot/Export
    └── OpenCode Workspace Adapter
            │
            ├── point_config_gen.py / future application_codegen.py
            ├── fixed product hardware catalog
            └── local workspace files
```

### 12.2 推荐技术路线

首版推荐“浏览器技术 UI + 本地 Python 服务 + 桌面壳/本地启动器”：

- 前端：TypeScript + React，工程表格使用支持虚拟滚动、固定列、批量粘贴和单元格校验的成熟表格组件；
- 拓扑：只实现端口—设备—通道关系，不上自由 FBD 画布；
- YAML 高级视图：Monaco 等只读/受控编辑器，用于预览；普通工程页面不开放硬件定义编辑；
- 本地服务：Python，直接复用/提取 `point_config_gen.py`、`plc_gen.py` 的模型和校验；
- API：本机 HTTP 或进程 IPC，正式校验和导出都由服务端执行；
- 存储：项目目录为事实源，SQLite 只保存 UI UUID、草稿、快照索引和本机偏好；
- YAML：使用支持 round-trip 的解析器保留顺序和注释，规范导出仍走统一 serializer；
- 打包：优先离线 Windows 桌面包，同时保留浏览器部署能力；桌面壳不得绕过服务端校验。

不建议首版把全部生成器重写成 TypeScript。这样会立即形成两套协议校验，最危险的是安全值、地址宽度和
总线预算发生漂移。前端可以做快速校验，但冻结必须调用 Python 权威实现。

### 12.3 后端模块边界

| 模块 | 职责 |
| --- | --- |
| `domain` | Project、Device、Point、Variable、NorthField 等类型和引用关系 |
| `hardware_catalog` | 只读加载随产品固化的 board/Profile，并提供展示和派生查询 |
| `device_role_protocol` | 组装/解析 `@CFG,IO,SHOW/INIT`，区分 ACTIVE、SAVED、记录状态和重启要求 |
| `device_role_service` | 串行执行查询、保存、受控复位后的复查；不修改项目 YAML |
| `kz3_uart_protocol` | UART1 固定参数、命令白名单、SYS/ETH/SLE/IO/DEBUG 构造与解析、范围/ASCII/255 B/退役入口门禁 |
| `kz3_maintenance_store` | 单命令事务、超时但不重试、日志与协议回包聚合、写后 SHOW、快照陈旧判断和会话导出 |
| `importer` | YAML/schema 检测、迁移、未知字段和注释保留 |
| `validator` | 即时/完整/权威校验编排，统一诊断格式 |
| `serializer` | 规范 YAML、generation request 和人读表生成 |
| `generator_adapter` | 在临时目录调用现有生成器，解析结果和容量 |
| `snapshot` | 内容 hash、冻结、语义 Diff 和只读历史 |
| `workspace_export` | 原子写入完整工作空间，失败不留下半包 |
| `opencode_adapter` | 准备最小上下文、导入 AI 结果、拒绝越权修改 |

### 12.4 建议本地 API

```text
GET    /api/product-hardware
POST   /api/projects/import
POST   /api/projects
GET    /api/projects/{id}
PATCH  /api/projects/{id}
POST   /api/projects/{id}/validate?level=full
POST   /api/projects/{id}/preview-yaml
POST   /api/projects/{id}/diff
POST   /api/projects/{id}/freeze
POST   /api/projects/{id}/export-workspace
POST   /api/projects/{id}/import-opencode-result
```

实际实现可以使用 IPC，但请求/响应边界应保持可测试，不把 UI 状态直接耦合到 Python 全局对象。

### 12.5 原子性与并发

- 自动保存先写草稿数据库，不频繁改正式 YAML；
- 显式“保存到工程”使用临时文件、fsync、原子替换；
- 导出先写临时目录，全部文件和 hash 成功后再原子移动到目标目录；
- 同一项目同时打开时使用工作区锁，并支持只读打开；
- OpenCode 每次任务使用独立目录，不调用共享 `project_configure.py` 覆盖活动项目；
- 用户选择已有非空导出目录时先比较 manifest，不默认覆盖。

## 13. 版本、冻结与兼容性

### 13.1 三种身份

| 身份 | 用途 |
| --- | --- |
| `project.id/version` | 业务发布身份，进入固件与 manifest |
| document UUID | 工具内部对象身份，不进入 MCU |
| snapshot/request hash | 确认一次不可变配置和生成任务 |

不能用文件名或目录名替代项目 ID，也不能只用项目 ID 区分同版本不同内容。

### 13.2 变更分类

| 变更 | 默认分类 |
| --- | --- |
| 修改 description/中文显示名 | 非运行兼容变更，但需重新生成文档 hash |
| 新增未对北发布的输入点 | 兼容扩展，仍需逻辑评审 |
| 修改 `logic_name` | 代码接口破坏性变更 |
| 修改 physical source/站号/Profile | 硬件与安全高风险变更 |
| 修改输出安全值 | 安全关键变更 |
| 修改北向 name/reference/type/access | 外部协议破坏性变更 |
| 修改 scan period | 时序高风险变更 |
| Runtime 重排/改名/删除 | EEPROM 身份破坏性变更 |
| 修改 Kp/Ki/Kd 或 PID 方向 | 控制品质与安全高风险变更 |

工具只提示建议版本级别，最终版本策略由项目流程决定。

### 13.3 冻结规则

冻结时记录：

- 规范 YAML hash；
- 需求和验收 hash；
- 自动绑定的产品硬件契约 hash；
- 固件 contract/schema；
- 权威校验器版本；
- 错误/告警/未验证清单；
- 操作人和时间（如平台提供身份）；
- 上一冻结版本和语义 Diff。

冻结后任何修改都产生新工作副本和新 request，不修改原快照。

## 14. 安全与防误操作

1. 内置板型/Profile 在工具中始终只读；修改必须走固件源码变更、验证和新产品版本发布；
2. `example_only` Profile 不能进入发布候选；
3. 输出通道添加时安全值必须显式确认，不能用 UI 隐式默认值代替项目确认；
4. 高风险字段旁显示来源和证据，不只显示最终数字；
5. 物理输出北向可写默认禁止；
6. 板载模拟量按当前固件边界标为不可发布到北向；
7. 删除设备前列出其业务点、PID、北向和需求引用；
8. 站号、地址、类型和安全值修改必须显示语义 Diff；
9. OpenCode 输出目录之外的写入视为越权；
10. 工具不保存模型密钥到项目包；AI 调用由平台/OpenCode 适配层负责；
11. 工具不提供“强制输出”“在线写寄存器”入口；若未来增加在线调试，必须作为独立高风险设计；
12. 所有“通过”文案带验证范围，例如“配置生成检查通过（host/config only）”。

## 15. 可用性细节

- 所有表格列支持冻结、隐藏、排序、过滤和保存个人视图；
- 端子、通道和地址按自然数排序，避免 `di10` 排在 `di2` 前；
- 数值字段显示单位，保存时使用无单位规范值；
- 枚举字段使用下拉，禁止输入近似字符串；
- 错误单元格保留用户原输入并显示修复建议，不静默纠正；
- 长任务显示阶段：解析、领域校验、生成、编译、报告；
- 任何自动命名/地址分配都支持预览和撤销；
- 撤销/重做按事务工作，批量粘贴算一次事务；
- 断电/崩溃后恢复草稿，但不把未确认草稿冒充正式 YAML；
- 中文为默认 UI，代码名称、类型、bind 和协议术语保持英文；
- 点表支持只读打印模式，适合现场核对；
- 搜索可跨设备名、业务名、端子、站号、北向名和 Modbus 地址。

## 16. 测试与验证设计

### 16.1 领域模型测试

- YAML 正向/负向 fixture 与现有 `test_point_config_gen.py` 保持一致；
- 设备增删、通道选择、点位绑定、引用更新和冲突检测；
- 类型、范围、宽度、地址自动分配和回收；
- Runtime 顺序和破坏性 Diff；
- AI overlay 合并与越权拒绝；
- 同输入、同固化产品硬件契约的规范 YAML/hash 完全确定。

### 16.2 UI 测试

- 新建向导到首次校验的主路径；
- 100+ 点位虚拟滚动、筛选和批量粘贴；
- 添加 701/702/703/704/705，并逐项核对只读功能码、PDU、通道名、类型、量程和 qualification；
- 702/703 DO、705 AO 默认每通道只生成一个输出业务点，北向预览显示内部回读绑定但不新增 feedback 字段；
- 站号冲突、安全值缺失、702/703 FC15 整组所有权提示和 705 FC16 完整写组阻断；
- 删除被引用点位时的影响列表；
- 北向 1/2 寄存器地址碰撞；
- 诊断跳转到准确单元格；
- 冻结后只读和创建新工作副本；
- 崩溃恢复与撤销/重做。

### 16.3 生成器集成测试

- 导出当前三个正式项目后，与现有 `point_config.c/.h/.md` 语义等价；
- 当前活动 golden fixture 必须得到 68 个业务点、69 个北向字段，并准确展开 702/705 的配置绑定与
  运行时读绑定；
- 案例中心项目可以导入、导出并通过生成器；
- 256 binding、128 北向字段、4 KiB context 和功能块边界 fixture；
- 两个 RS485 端口预算和超载拒绝；
- `io_extension.exports` 生成稳定伴生 Profile 和 `io_map_hash`，非法方向、`rs485_2` 引用、地址冲突被拒绝；
- 上层项目实例化 `kz3_f427_io` 后生成完整 DI/AI 读取块和 DO/AO 写组；
- 产品硬件契约 hash 不一致时拒绝重现；
- 临时目录生成不修改仓库活动 `application/`；
- Windows 路径、中文目录和长路径测试。

### 16.4 安全回归

- AI 修改 point/device/northbound 时 finalize 失败；
- 缺安全值、错类型、错方向和重复 owner 无法冻结；
- `example_only` 模块无法成为发布候选；
- 普通 parameter/state 始终显示易失；
- 未执行 HIL 时报告保持“待实板/待现场”；
- HTTP 调试不得开放任意路径、任意点位名或物理 bind 写入；
- command 超时不得自动重试，写入审计的未观测层级保持 `unknown`；
- 工程身份变化、点位 404 mismatch、健康连续失败或 active fault 必须自动解除写入许可；
- 模块寄存器回读始终标为寄存器值，不得显示为端子/接触器/真实电流反馈；
- SLE 对外契约只比较字段 name/type/access，内部路由 ID 变化不报外部协议破坏；
- 编译成功只显示 host/compile 范围。
- 角色保存成功但未重启时必须显示 SAVED 与 ACTIVE 不一致，禁止提前显示“已生效”；
- `INVALID/IO_ERROR` 必须显示维护安全态和恢复入口，不得自动回退后静默继续；
- IO 角色返回 `ERR,MAINTENANCE_ROLE_ONLY` 时不得自动改用旧指令或绕过角色限制；
- 从站地址改变必须二次确认，且不得通过 Modbus RTU 远程修改本机地址。

### 16.5 UART1 维护适配器测试

- 固定 `115200 8N1`；若全局串口以其他参数连接，维护命令在发送前拒绝；
- SYS、ETH、SLE、IO、DEBUG 命令构造覆盖正常值、上下界和非法 ASCII；
- Ethernet `INIT` 只能是完整四参数，SLE `INIT` 只能是严格六字段；
- SLE `INIT` 无论候选状态为何都固定生成 `CFG_ADDR=0`、`APID=1`，其他单字段值在白名单层拒绝；
- 255 B、非 ASCII、退役命令和非白名单文本在真正写入前拒绝；
- 调试日志与协议回包交错时保留所有原始行，最终事务使用最后一条 `OK/ERR`；
- 写超时不自动 retry；写成功后产生独立的 follow-up query 记录；
- ETH RUN/SAVED、IO ACTIVE/SAVED/RECORD、SLE VALID/READY/MAC_VALID/CFG_APPLIED/AT_* 稳定解析；
- 断开、换端口、`INVALID/IO_ERROR` 时不把缓存显示成当前已生效配置。

## 17. 分阶段实现

### 17.1 P0：冻结 schema 与固化产品硬件契约

1. 从现有生成器提取完整字段约束和稳定诊断 code；
2. 定义工具内部领域模型、稳定实体 UUID 和规范 YAML 顺序；
3. 固定 `kz3_f427_standard` 与 701/702/703/704/705 产品硬件目录，定义只读 contract manifest 和 hash；
4. 冻结 OpenCode `generation_request` 与 `logic_definition`；
5. 将三个正式项目和三个案例做成导入/导出 golden fixture；
6. 明确外部 state 与 AI 内部 state 的合并规则；
7. 修复并测试冻结 `i32` 北向宽度和 `u8` 生成契约，收敛 SLE 472 B 保守门禁与 690 B 运行时预算；
   SLE 对外身份固定使用字段 name，内部路由 ID 不进入产品兼容契约。
8. 冻结 UART1 维护命令白名单、字段 schema、响应解析、退役命令列表和固件能力版本。

阶段出口：无 UI 也能把现有 YAML 导入领域模型、规范导出、调用生成器并得到结构化诊断；同一输入的
YAML 和 hash 稳定。

### 17.2 P1：最小可用配置工具

1. 新建/导入项目；
2. 项目总览；
3. 板载 I/O、RS485 端口和标准扩展模块组态；
4. I/O 点表及批量编辑；
5. parameter/command/state；
6. 北向字段和地址冲突检查；
7. 权威生成器检查、YAML 预览和单文件导出；
8. 在硬件组态页面直接展示固定模块资料和 qualification，不建设独立模块库维护页面；
9. 提供 UART1 设备维护页，覆盖五组只读总览、结构化写入、写后查询和会话导出。

阶段出口：PLC 工程师不手写 YAML，可以配置一个板载 + 701/702/704/705 的项目并生成通过当前校验器的
`project_io.yaml`；调试工程师不手写串口命令即可完成受校验的设备本机配置，并得到区分保存值、活动值、
重启待生效和待实板状态的维护记录。

### 17.3 P2：OpenCode 工作空间闭环

1. 需求与 Given/When/Then 编辑；
2. 冻结快照、产品契约 lock 和完整工作空间导出；
3. 最小 AI 上下文生成；
4. `logic_definition` overlay 合并；
5. OpenCode 结果回导、越权 Diff 和结构化 unresolved；
6. 独立目录生成、严格编译和主机测试报告。

阶段出口：从配置到 `logic.c + point_config.c/.h + generation_report.json` 全程不修改共享活动项目。

### 17.4 P3：工程化增强

1. 版本历史和语义 Diff；
2. CSV/Excel 点表导入导出；
3. 地址分配策略模板；
4. 团队后端项目、权限和审批集成；
5. HIL 记录关联和发布候选门禁；
6. 大项目性能和辅助键盘操作优化。

阶段出口：具备团队交付所需的追溯、审核和产品契约治理能力。

## 18. 验收标准

1. 可导入当前 `application/project_io.yaml` 并完整展示所有现行配置维度；
2. 内置现有板型和 701/702/703/704/705 Profile，并正确展示 qualification；
3. 通过 UI 新建的项目能由现有 `point_config_gen.py` 生成 C/H/Markdown；
4. 普通工程师无法修改标准 Profile 的寄存器和功能码；
5. 一个物理点只能绑定一个业务点，输出只有一个 owner；
6. RTU 输出安全值必须显式确认，FC16 整组规则可视化；
7. 点表支持批量粘贴、自动命名、筛选和人读导出；
8. 北向类型、权限、宽度和地址冲突在编辑阶段可见；
9. 页面展示现有全部容量和 RTU 总线门禁，并以生成器结果为最终依据；
10. 普通 parameter/state 不被显示成掉电保持；
11. 需求中的点位引用来自冻结业务符号，不产生同义不同名；
12. 工作空间包包含 YAML、需求、自动生成的产品契约锁、输入 hash 和校验报告；
13. OpenCode 不能修改物理点、设备、安全值和北向契约；
14. AI 内部 state/功能块可通过 overlay 合并，不覆盖源 `project_io.yaml`；
15. 同一冻结输入在隔离目录中生成确定性结果；
16. 所有报告区分配置/主机、HIL 和现场验证范围；
17. 发布快照只读，后续修改生成新快照和 request；
18. 工具崩溃、导出失败或生成失败不会留下看似完整的半成品包；
19. 模块详情能仅凭本文和产品契约包正确展示 701–705 的功能码、PDU、通道、类型、量程和证据状态；
20. 702/703 DO 与 705 AO 普通配置每通道只有一个业务点和一个北向字段，生成预览能区分目标与回读；
21. 北向页面完整说明 name/bind/c_type/access/reference/width、四个地址区及项目地址与设备 PDU 的区别；
22. 当前活动工程作为 golden fixture 导入后显示 48 输入、20 输出、69 北向字段，地址和运行时读绑定
    与第 8.6 节一致。
23. 系统角色页面能查询、保存并在重启后复查 `CONTROLLER` 与 `RTU_SLAVE,1..247`，ACTIVE/SAVED/
    RECORD/REBOOT_REQUIRED 状态展示无混淆；
24. 系统角色不进入项目 YAML，角色写入不覆盖 SN、网络、SLE、SystemLifetime、runtime 或持久化参数；
25. `kz3_f427_io` 以只读产品 Profile 展示 12DI/4AI/8DO/2AO、质量、map hash、固定写组及待 HIL 边界；
26. 可生成并审查项目伴生 `rtu_slave_profile.yaml`，但在真实 RS485 帧、双口并发和 1500 ms watchdog
    HIL 完成前不显示“IO 扩展模块已通过现场验证”。
27. UART1 页面固定 `115200 8N1`，结构化覆盖 SYS/ETH/SLE/IO/DEBUG，字段范围、ASCII、255 B 和退役命令
    均在发送前校验；
28. 写命令超时不自动重试；写成功后执行所属配置组的 SHOW，并分别记录写入与复核结果；
29. Ethernet 同屏比较 RUN/SAVED，系统角色同屏比较 ACTIVE/SAVED/两份记录，未重启复核不显示已生效；
30. SLE 的 `CFG_ADDR/APID` 固定为 `0/1`，前端不可编辑且命令层不可绕过；同时区分本地保存、配置有效、
    模组 ready/MAC 与 AT 参数确认，不把任何单层成功显示为无线链路通过；
31. 维护会话与工程 YAML 分离，可导出包含原始回包和验证边界的 JSON 记录。

## 19. 实施前需要确认的产品决策

这些问题不会改变核心边界，但会影响首版范围和技术选型：

1. 首发目标系统是否以 Windows 为主，是否同时要求 macOS；
2. 工具是独立桌面程序、现有平台中的页面，还是两者共用同一前端；
3. 项目草稿和历史由本地目录管理，还是从首版就接入后端数据库；
4. 首版是否需要 Excel `.xlsx`，还是 CSV 粘贴/导入已经足够；
5. 工程证据附件是否进入工作空间包，还是只保存引用和 hash；
6. 冻结配置由单人确认还是需要电气/工艺双人审核；
7. OpenCode 是本机进程、容器任务还是后端服务；
8. 最终 ARM 构建由同一工作空间完成还是交给独立构建服务；
9. 是否需要将最终结果重新导入工具形成一个完整“项目交付记录”。

若暂时没有答案，建议 P1 使用离线本地工程目录、CSV、固化内置 Profile、单人冻结和本地 Python 校验；
这些选择不会阻塞后续接入平台权限和并发构建服务。

## 20. 与现行文档的关系

- 本文负责可视化配置工具的产品、交互、数据和实现设计；
- [OpenCode 工艺逻辑代码生成架构设计](OpenCode工艺项目AI代码生成架构设计.md)负责配置冻结之后的 AI
  代码生成 SDK、隔离目录和结果契约；
- [application 项目点位别名与物理 I/O 统一映射设计](application项目点位别名与物理IO统一映射设计.md)
  负责现行业务点和物理 binding 的固件语义；
- [KZ3 F427 工艺项目与逻辑代码块开发指南](../逻辑代码块开发指南.md)负责当前人工项目开发、逻辑 API、
  测试和实板流程；
- [逻辑运行时间累计与 EEPROM 掉电保持设计](逻辑运行时间累计与EEPROM掉电保持设计.md)负责 Runtime
  的持久化身份、北向和安全边界。

实现时应优先把现有 Python 生成器变成可复用的权威领域服务，再建设 UI。可视化只是录入方式，真正的
产品契约仍是可追溯、可确定性生成并能被固件门禁证明的项目配置。
