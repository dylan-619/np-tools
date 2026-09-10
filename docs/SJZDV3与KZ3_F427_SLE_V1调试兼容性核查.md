# SJZDV3 与 KZ3 F427 调试兼容性核查

> 核查日期：2026-09-09；范围：`np-tools` 对照同级固件源码。本文是工具接入判断，不是实机、现场或生产验收记录。

## 1. 核查对象与结论

用户提供的目录名称在当前工作区中对应为：

| 产品 | 实际目录 | 核查分支 | 结论 |
| --- | --- | --- | --- |
| SJZDV3 采集终端 | `../SJZDV3` | `4G` | 工具的设备信息、SN、SLE、4G/MQTT、Modbus、维护和 F412 烧录路径均有对应固件协议；可作为串口调试工具使用。 |
| KZ3 F427 控制器 | `../KZ3_F427_SLE_V1` | `TCP_NETTY` | 工具的 UART1 配置、HTTP 在线调试、I/O 工程配置和 F427 application 烧录路径均可对接；原工具的旧版 `@CFG,IO,*` 角色入口与本分支不兼容，已改为本分支实际提供的 Edge TCP 管理。 |

两者可以在同一桌面工具中先后调试，但当前公共串口连接是**单端口、单会话**模型：不能在一个工具实例中同时占用两台设备的 UART；切换产品前应断开旧设备、选择新端口并确认对应串口参数。

## 2. 协议与功能对照

### 2.1 SJZDV3

| 工具入口 | 固件侧证据 | 工具侧处理 | 源码对照结论 |
| --- | --- | --- | --- |
| 设备信息 / SN | UART1 `DEVINFO`、定长 `SN:<12 位十进制>` | 信息读取、12 位 SN 校验与写入 | 支持 |
| 星闪 SLE | `SLE:LIST`、`SLE_*`、`SLE_BRIDGE` | 配置事务、桥接 owner 确认和 AT 透传隔离 | 支持 |
| 4G Cat.1 / MQTT | `WLAN_TYPE`、`4G_CONFIG`、4G 配置/重连命令 | 完整事务读取、保存后 revision 复核、凭证不回显 | 支持 |
| RS485 / Modbus | `RS485_CONFIG`、`MB_DEBUG` | 点位管理、单点诊断与事务完整性校验 | 支持 |
| 维护 | 日志、频率、`@RST`、`@EEP` 等维护命令 | 高风险操作确认和状态提示 | 支持（操作仍需现场许可） |
| 固件烧录 | STM32F412 / ST-Link profile | `sjzdv3_f412`，Flash `0x08000000..0x0807FFFF` | 配置匹配 |

SJZDV3 的 PC 工装口为 USART1 `115200 8N1`。无线模组使用 UART2，4G 模式为 `115200`，SLE 模式为 `230400`；这不是 PC 工装口的波特率。若已开启 `SLE_BRIDGE`，UART1 owner 转给无线模组时，工具会阻止 MCU 配置命令，必须先按 `SLE_BRIDGE:ACK` 确认 owner 再继续。

### 2.2 KZ3 F427 (`TCP_NETTY`)

| 工具入口 | 当前固件 UART1 / HTTP 合约 | 工具侧处理 | 源码对照结论 |
| --- | --- | --- | --- |
| 生产身份 | `@CFG,SYS,SHOW` / `@CFG,SYS,SN,<12 位>` | 白名单、SN 校验、写后 SHOW | 支持 |
| Ethernet | `@CFG,ETH,SHOW` 与 IP/MASK/GW/PORT 配置命令 | 分项写入、RUN/SAVED 对照、单一已知 SAVED HTTP 地址复连 | 支持 |
| SLE / 无线 / Cat.1 | `@CFG,SLE,*`、`@CFG,WIRELESS,*`、`@CFG,4G,*` | 固定参数限制、凭证脱敏、写后 SHOW | 支持 |
| Edge TCP | `@CFG,EDGE,SHOW`、`@CFG,EDGE,SET,<ip>,<port>,<0|1>` | 运行/保存值、ONLINE/STATE/错误码、原子保存和重启提示 | 支持（本次补齐） |
| DEBUG / 复位 / 指示灯 | `@DEBUG`、`@DEBUG=0/1`、`@RST`、`GRN/RED/OFF` | 白名单、危险操作确认、会话审计 | 支持 |
| HTTP 在线调试 | `/api/v1` diagnostics、project、point | 工程身份/manifest 核验后才可受控写入 | 支持，受既有安全门限限制 |
| 固件烧录 | STM32F427 application image | `kz3_f427_app`，Flash `0x08020000..0x0807FFFF` | 配置匹配 |

KZ3 UART1 固定为 `115200 8N1`、无流控。当前分支没有 `@CFG,IO,SHOW` 或 `@CFG,IO,INIT,...` 的处理路径；旧入口会返回不支持错误。因此 KZ3 维护页与内置 KZ3 预置不再把“系统角色”暴露为可写菜单，也不会自动发送该类命令；通用串口终端仍是人工原始报文工具，操作者不应手工发送这些旧指令。

### 2.3 Edge TCP 的实际边界

`@CFG,EDGE,SET` 是单条原子保存命令。当前固件要求：

- 服务端 IPv4 为固件接受的单播地址；
- 端口为 `1..65535`；
- 即使 `enabled=0`，也要提供合法 IP 和非零端口，关闭只是关闭启动时客户端，不是清空记录；
- 成功保存后须重启，并通过 `RUN_*` 与 `SAVED_*` 再次确认。

工具将 `ONLINE=1` 标为“固件 TCP 客户端在线”，但不将其描述为网关已接入、下行已执行、数据已被平台消费或现场工艺已验收。当前代码中直连 Edge TCP 的网关路由和最新镜像 Ethernet HIL 仍需独立验证。

## 3. 本次工具调整

1. 增加“设备调试导航”首页，按 SJZDV3 / KZ3 产品线展示串口前置条件、能力范围和快捷入口。
2. 侧边栏按“工程与运行 / 设备维护 / 状态与拓扑”“初始化与无线 / 点位与现场 / 维护”等任务维度分组，避免把不同固件协议混在同一层。
3. KZ3 UART1 维护页、快速命令和发送白名单从旧 `@CFG,IO,*` 收敛为当前分支的 `@CFG,EDGE,*`。
4. 新增 Edge TCP 表单：保存前校验 IP/端口，写后自动 SHOW，显示 RUN/SAVED、VALID、STATE、ONLINE、LAST_ERROR 与 RECONNECTS。
5. 补充协议回归测试，确保工具不会重新放行旧 `@CFG,IO,SHOW`，且 Edge TCP 指令与当前固件格式一致。

## 4. 验证边界与建议执行顺序

本次结论来自工具源码和固件源码的静态对照，以及工具侧协议回归/构建验证。**没有连接实际 SJZDV3 或 KZ3，没有执行 ST-Link 烧录、SLE/4G/RS485、Ethernet、Edge TCP、HTTP 网关或现场联锁 HIL。** 我不知道（I don't know）实际接线、适配器、设备版本和目标网络是否与这些源码一致；需要用目标设备按以下顺序补证。

1. 读取设备当前固件版本和 UART1 首条只读查询，留存原始回包。
2. 对 SJZDV3 先查询 `SLE_BRIDGE` owner；对 KZ3 先查询 `SYS/ETH/SLE/WIRELESS/4G/EDGE/DEBUG` 七组快照。
3. 仅在现场许可下写入一项可恢复的测试值，重启后读取 RUN/SAVED 或 revision 证据。
4. 分别验证无线入网、RS485/Modbus 通信、HTTP 调试、Edge TCP 客户端和网关路由；每一项都以对端可观测证据和现场行为为准。
5. 最后执行受控 ST-Link 烧录和完整功能回归；工具构建通过不能替代实机结果。
