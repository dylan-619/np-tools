# PLC 工业控制标准符合性声明

## 对外可声明的层级

| 标准或规范 | 当前项目可声明 | 说明与证据边界 |
| --- | --- | --- |
| `KZ3 PLC_STYLE_V1` | 严格验证通过后可声明“符合（host-only）” | 本项目自定义、可执行的扫描模型、安全收敛、代码结构、复杂度和测试门禁 |
| IEC 61131-3:2025 | 只能声明“工程概念对齐/参考” | 使用周期扫描、功能块/状态、确定性 I/O 等 PLC 工程概念；产物是 C，不是该标准定义的 ST、LD、FBD 或 SFC 语言合规实现 |
| PLCopen Software Construction Guidelines / Quality Metrics | 只能声明“选定原则对齐” | 对齐模块化、命名、单一输出 owner、复杂度预算、可测试性和代码审查原则；不宣称 PLCopen 认证 |
| IEC 61131-2:2017 | 不得由项目 host 验证声明符合 | 属于 PLC 设备要求与试验，需要硬件、电气、环境、EMC 等产品级证据 |
| IEC 61508、IEC 62061、SIL | 不得声明符合或认证 | 需要功能安全生命周期、风险分析、安全完整性架构、独立评估及目标硬件/系统证据 |
| MISRA C | 不得声明符合 | 当前门禁不是 MISRA 静态分析，未建立规则集、偏差记录和合规报告 |

## README 固定写法

每个新项目 README 必须有“标准与符合性”章节，并按实际结果写：

```text
- KZ3 PLC_STYLE_V1：PASS / FAIL / NOT_RUN（只有 --strict-quality 通过才写 PASS，且标注 host-only）
- IEC 61131-3:2025：工程概念对齐；C 产物不构成 IEC 61131-3 编程语言符合性
- PLCopen Software Construction Guidelines：选定工程原则对齐；未做 PLCopen 认证
- IEC 61131-2、IEC 61508、IEC 62061、SIL、MISRA C：本次未建立符合性证据，不作合规声明
```

不得把“参考”“对齐”“host-only 通过”改写为“通过 IEC 认证”“达到 SIL”等更强结论。若未来取得产品级
测试报告、认证证书或合规矩阵，只能引用证书明确覆盖的硬件版本、固件版本、范围和有效期。

## 适用资料

- IEC 61131-3:2025：PLC 编程语言的语法与语义；
- IEC 61131-2:2017：PLC 设备要求与试验；
- IEC 61508、IEC 62061：功能安全与机械安全相关控制系统；
- PLCopen Software Construction Guidelines 与 Quality Metrics：PLC 软件构造、编码规则和质量度量指导。

版本号用于固定本规则编写时的对齐基线。正式投标、认证或法规声明前，必须由负责人员复核采购的标准
正文、适用市场和最新版本。
