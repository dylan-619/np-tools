# 官方控制模式参考及 KZ3 适配

核对日期 2026-10-16。以下是原则参考，非代码移植、认证或当前 KZ3 的厂家兼容承诺。需求有差异时先适配，
禁止将安全功能块的 SAFE 类型、认证或电路前提等同于普通 KZ3 控制代码。

| 官方资料 | 控制核心 | KZ3 适配与验收 |
|---|---|---|
| [Siemens S7-1200/1500 Programming Guideline V1.4, 2015](https://cache.industry.siemens.com/dl/files/040/90885040/att_861867/v1/81318674_Programming_guideline_DOCU_v14_en.pdf) | 按功能组织可复用块，使用独立实例管理设备数据 | 单体监督、工艺仲裁、测量与输出分层；每台实例独立；测试改一台参数/复位不影响他台。保留 KZ3 的 LogicContext 和扫描 API，不仿造 S7 指令 |
| [Siemens APL Operator Guide V9.0 SP3, 2019](https://cache.industry.siemens.com/dl/files/588/109781588/att_1029664/v1/AplOpG_b_en-US.pdf?download=true) | 电机操作区分模式、启动/停止、复位以及许可、联锁、保护；保护恢复与操作使能不同 | 建立 REM 许可、故障、可用、阻止原因和实际 RUN 的独立语义；有根因的保护不能仅靠复位解除；HMI 能解释不能启动的原因 |
| [Phoenix Contact PLCnext SF_EDM](https://engineer.plcnext.help/latest/sfedm.htm) | 区分控制请求与反馈监督；监控时间、错误、复位和重启抑制有明确关系 | 参考监督/恢复边界，按本项目冻结 5 s 启动/30 s 停止/5 s 丢失等时限；允许有效复位恢复 READY。不得声称普通 DI/DO 构成安全 EDM；测试反馈粘连与恢复后重新启动 |
| [Phoenix Contact PLCnext TON](https://engineer.plcnext.help/latest/TON.htm) | IN=false 时普通 TON 的 ET 清零，各 FB 实例独立 | 需要“暂停并续计”时不能直接把泵许可接 TON.IN；使用有上限的有效 elapsed 累积，恢复时排除暂停墙钟；测试暂停跨越原截止时刻和 tick 回绕 |

厂商原则不能替代工艺裁决：格栅与压榨机是否同时启动或先下游后上游、手动是否联动、故障恢复是否自动
重启，都来自生效需求。通过当前需求的状态转移表和负向试验确定适用性，不按厂家名为设计背书。
