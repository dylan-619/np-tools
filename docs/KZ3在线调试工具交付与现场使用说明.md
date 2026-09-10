# KZ3 在线调试工具交付与现场使用说明

> 交付状态：HTTP 诊断、工程身份核对、点位观察和受控北向写入已接入；真实设备、HIL 与现场验证未完成。
> 软件版本：NP-Tools 1.0.4；HTTP API：KZ3 v1；文档更新日期：2026-09-10。

## 1. 当前范围

工具提供独立的 KZ3 在线调试模式，用于：

- 读取 `/api/v1/device`、`hardware`、`project`、`network`、`sle`、`io`、`config`、`services`、`health`；
- 用本地工程的北向字段按固件 `point_config_gen.py` 同一算法计算 manifest，并核对设备工程 ID、版本、算法、hash 和点数；
- 从当前本地工程生成最多 12 个点位的观察列表，并读取 `/api/v1/point/<name>`；
- 在严格门禁下，对 BOOL/FLOAT/U32 parameter 和 BOOL 单次 command（含 `runtime.<name>.clear`）执行受控 HTTP 写入；
- 显示设备质量码、本机陈旧状态、请求耗时、健康/网络/服务/I/O 诊断与会话日志；
- 使用 UART 维护页读取保存的 Ethernet 候选地址后，对单一目标做 HTTP 复连；不做 ARP、端口或子网扫描；
- 导出诊断、样本、写入证据和明确的验证边界。

“工程匹配”只表示 ID、版本和北向访问契约匹配。“写入 accepted”只表示当前 HTTP owner 接受了请求。二者都不证明完整 YAML/逻辑、互锁、端子反馈、负载动作或现场验收。

## 2. 工程兼容性与写入门禁

连接时工具读取 `/api/v1/project`。`matched` 的必要条件是：

1. `project_id` 与本地工程 ID 相同；
2. `project_version` 与本地工程版本相同；
3. `point_manifest_algorithm` 为 `sha256-kz3-north-fields-canonical-v1`；
4. `point_manifest_hash` 与工具按字段声明顺序复算的 SHA-256 相同；
5. `point_count` 相同。

工具展示并导出 `schema_version`、`firmware_build_id`、`configuration_hash`、`config_revision`。但 `configuration_hash` 是固件输入 YAML 原始字节的 FNV-1a；桌面端持有的是解析后的工程模型，不能可靠复原原始字节。因此它不会在连接初始把该值解释为完整工程逻辑已验证或不匹配。作为会话漂移保护，若已匹配会话中再次读取到 `configuration_hash`、`firmware_build_id` 或 `schema_version` 改变，工具会立刻上锁。

| 状态 | 含义 | 操作 |
| --- | --- | --- |
| `unverified` | 尚未建立或正在建立会话 | 等待连接/诊断完成 |
| `partial` | `/project` 缺失、不可用、格式无效或 manifest 无法复算 | 可诊断与观察，不可写入 |
| `matched` | ID、版本、算法、manifest hash、点数均匹配 | 可监视；仍需通过全部写入门禁后显式解锁 |
| `mismatch` | 工程/点表不匹配、本地点表变化、点位 404 或返回类型错误 | 保持只读；结束会话后核对工程与设备 |

写入许可还要求：操作员信息已填写、连接在线、四项健康均正常、`controller_fault.active=false`、本地工程未变化，并在弹窗中填写依据、输入“启用写入”确认。许可最多持续 10 分钟；离页、断线、故障、工程变化、写入失败或结果未知会自动解除。

已匹配会话的监视期间，慢速诊断轮询也会周期性刷新 `/project` 并复核 manifest；设备重刷、换工程或点表变化被发现后，会立即解除现有写入许可。

## 3. 当前允许与禁止的写入

| 北向字段 | 当前工具行为 |
| --- | --- |
| `parameter.*` + BOOL | 允许写入 `true` 或 `false`；若工程标记 `persistent`，弹窗明确标为掉电保持参数 |
| `parameter.*` + FLOAT | 允许写入有限的 FLOAT 32 位数值，并遵守工程 min/max；掉电保持参数仍需受控重启后另行复核 |
| `parameter.*` + U32 | 允许写入 `0`～`4294967295` 范围内的整数，并同时遵守工程 min/max；写后按 U32 整数精确读回 |
| `command.*` + BOOL | 仅允许单次 `true`，不允许 false、保持或自动重试 |
| `runtime.<name>.clear` + BOOL | 仅允许单次 `true`；后续要另行核对累计值与清零状态 |
| U16/I16/I32 parameter | 禁用；当前 KZ3 HTTP owner 未实现这些 parameter 写入 |
| `point.*`、`state.*`、直接物理 I/O | 禁用；不得绕过工艺逻辑、互锁与安全 owner |
| 只读字段 | 禁用 |

每次已解锁的写入都按以下顺序执行：停止后续轮询并等待在途请求结束 → 重新读取 `/health`、`/io`、`/project` → 重新校验 manifest → 写前读取目标点 → 单次 POST → 写后读取目标点。HTTP 没有客户端 CAS、request ID、认证或 TLS，且失败状态码粒度有限，因此超时、网络失败或任何不确定结果均不自动重试。

## 4. 使用步骤

1. 确认调试电脑与目标控制器位于授权的隔离网络，填写 HTTP 根地址，例如 `http://192.168.11.59:8080`。
2. 打开准备调试的本地工程。若在会话中编辑 ID、版本或北向字段，工具会立即上锁；应结束会话后重新连接。
3. 点击“连接并预检”。只有看到 `matched` 才可考虑写入；`partial` 或 `mismatch` 时仅做观察和留档。
4. 先选择少量业务点加入监视组，检查质量码、变化时间、健康项和 active fault；不要高频扫描全部字段。
5. 如确有测试授权，填写操作员和测试依据，显式解锁。选择允许的 parameter/command，核对点名、弹窗打开时读值和请求值后再确认。
6. 读取写入事件中的写前值、HTTP owner 接受结果和写后读回；由现场工程师另外标注逻辑效果、物理效果和观察备注。
7. 网络配置仍由 UART 维护页完成。只有得到完整、合法的 `SAVED_IP/SAVED_MASK/SAVED_GW/SAVED_PORT` 后，才可尝试对该唯一地址复连。
8. 导出会话记录。报告中的 HTTP 成功、点位值和人工备注不构成 HIL/现场验收。

## 5. 仍需固件补齐的 P1 能力

- HTTP 写入请求没有 `request_id` 或客户端可传的 `expected_parameter_revision`；无法提供幂等查询或 CAS 冲突证据。
- 成功响应只有 `{name,ok}`；失败主要归并为 `403 point_write_failed`，没有稳定的类型、范围、忙、冲突和持久化错误码。
- HTTP 不提供认证、授权或 TLS；只能在受控隔离网络中使用，不能视为远程生产控制接口。
- 没有 `/api/v1/points` 枚举/批量读取，工具只能按本地已核对的点表逐点读取。
- HTTP 变量/软件输出目标不等于物理反馈；测试模式、反馈映射、互锁和 HIL 需要单独工艺与实板证据。

详细源码差距与接口建议见 [KZ3 固件接口差距记录](../../KZ3_F427_SLE_V1/docs/NP-Tools固件接口差距记录.md)。

## 6. 验证边界

本说明不把工具构建、主机协议测试、HTTP 连通、工程 manifest 匹配、诊断读取、写后读回或人工备注描述为生产、现场或 HIL 通过。电气端子、负载、联锁、PID、RS485、Ethernet 长稳和现场网络均需独立的实板/现场记录。
