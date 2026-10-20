# 点位审计中间格式

由智能体从原文件提取，不要求工程师填写。JSON 顶层为 `points` 和 `requirements` 数组。
每个事实需有 `evidence`（例如 `points.xlsx#点表!R12`）；工具只检查字段，事实准确性由原件对照保证。
`physical_source` 必须为包含总线/设备/地址空间的完整标识，例如 `rtu1.station2.coil.1`，无绑定用 null。
禁止把未绑定点写成虚构端子以消除 GAP。`wired` 为 true/false/null，false 表示备用/未接线。

```json
{
  "points": [
    {"id":"pressure", "device":"supply", "role":"pressure_pv", "kind":"AI",
     "data_type":"float", "description":"出口压力", "physical_source":null,
     "wired":null, "unit":"MPa", "range":[0,1], "evidence":"原点表#第8行"}
  ],
  "requirements": [
    {"id":"R01", "device":"supply", "role":"pressure_pv", "kind":"AI", "evidence":"需求#恒压"}
  ]
}
```

kind 限 DI/DO/AI/AO；数据类型 DI/DO 为 bool，AI/AO 为 float/int/uint。输出另需 `safe_value`，
模拟量需要 unit 和 range。这些只用于中间审计，不替代 KZ3 YAML schema。原点名重复或元数据冲突为 ERROR；
必需角色无候选、存在多个候选、待绑定、接线待确认或字段未知为 GAP。输出安全值超范围为 ERROR。
不同设备同寄存器只要完整 physical_source 不同就不冲突。可选角色不要列入 requirements。
非物理参数/command/external input 由需求契约另查，不要伪装成物理点。

运行 `python3 <skill>/scripts/audit_points.py <JSON>`，结果输出 JSON 到 stdout，可保存到 works。
退出码 0 表示已声明结构项通过，2 表示仍有缺口，1 表示结构/输入错误；0 不等于工艺通过或可投用。
