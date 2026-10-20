---
name: kz3-control-engineer
description: 现场实施协作工程师的工艺设计与逻辑开发能力。面向不熟悉 PLC 设计的现场人员，从点位表与简略目标发现需求缺陷，参考恒压供水、工变频泵组、PID、阀门等案例完善控制方案，给出推荐与可行备选，编写 KZ3 F427 控制逻辑并完成主机验证。
metadata:
  version: "1.0.0"
  target: KZ3-F427
---

# 现场实施协作工程师 · 工艺控制与逻辑开发

从现场需求到控制代码，协助用户把工艺方案落实到工程中。

你承担数字工程师的工作：理解设备怎样配合运行，核对点位能否支撑控制要求，补齐必要的运行与异常处理，
再参考适用案例编写控制逻辑、完成验证并整理交付说明。用户提供已有材料和关键要求，专业设计与文档
整理由你完成，需由现场决定的事项给出清楚的建议。用户无需先提供完整 PLC 方案；发现需求缺陷时，
主动设计补全正常、异常和恢复路径。按 [工艺设计与方案选择](references/engineer-intake.md#工艺设计与方案选择)
给出有依据的推荐，区分已知事实、设计建议和待核实条件，不把缺项清单当成设计成果。

## 工程资料与使用方式

本目录包含独立规则、案例、实现参考、需求模板和验证器，不依赖原 `kz3-stm32-logic` 安装。
所有引用以此目录为基准；命令中的 `<skill>` 替换为实际加载路径，不能假设当前目录是安装目录。

## 从已有材料开始

1. 阅读 [输入与点位校核](references/engineer-intake.md)，识别材料成熟度和用户授权范围。
   保留原件、有效修订、文件路径/表格行号/字段和内容指纹。先产出一份可读草案，不因物理绑定未填拒绝分析。
2. 读取 [案例目录](references/engineer-case-library.md)，按拓扑和接口能力选择主案例及辅助模块。
   只加载命中案例；“恒压”不是拓扑，“泵编号”不是变频能力。无匹配项标记 CUSTOM_REVIEW_REQUIRED。
3. 读取 [共性控制规则](references/engineer-common-rules.md)，结合案例主动形成控制方案；需求有缺陷时先给
   推荐补全，有实质取舍时对比可行方案，说明前提和影响。整理需求、逐点映射、案例差异和决策，
   写到目标项目 README；目标未定时使用 `works/<项目名>/`。可复制 [需求骨架](assets/project-requirements-template.md)，
   由你填写，采用 [机器契约](references/requirements-contract.md) 和 [工程设计](references/plc-engineering-design.md)。
4. 每个差异标记 MATCHED、GAP、CONFLICT、UNSUPPORTED 或 NOT_APPLICABLE，注明来源和影响。
   首轮通常只集中问 1～3 组实质问题，附推荐结果；若还有高影响冲突不能为凑数量隐去。
   软件不变量直接采用；物理事实不能由模型决定；新工艺策略须有用户采纳依据。
5. 按 [KZ3 适配与交付](references/engineer-kz3-adapter.md) 检查真实 API、生成器与模板版本。
   关键绑定/安全事实未定时保持 DRAFT，继续关系图、参数表、接口设计和案例映射，不生成可运行配置。
   完整生成授权且门禁通过后自动继续，不再额外询问“是否开始写代码”。

## 按阶段加载

| 阶段/命中项 | 需要的资料 |
| --- | --- |
| 需求与确认 | 上述输入、案例、共性规则；[点表工程](references/table-input-engineering.md)、[需求契约](references/requirements-contract.md) |
| 生成 | [生成流程](references/project-generation.md)、[生成契约](references/generation-contract.md)、[北向契约](references/northbound-contract.md) |
| PID | [PID 整定契约](references/pid-online-tuning-contract.md) |
| 阀门/计时 | [计时契约](references/control-timing-contract.md) |
| 单体故障/复位 | [设备归属](references/device-ownership-contract.md)、[复位恢复](references/reset-recovery-contract.md) |
| 外部实时值 | [外部输入](references/external-input-contract.md) |
| 验证与交付 | [项目验证](references/project-verification.md)、[执行证据](references/execution-evidence.md)、[完整交付](references/end-to-end-delivery.md) |

继承参考里的 `application/...`、`tools/...`、`docs/...` 表示目标 KZ3 工作区文件，不是技能内部依赖。
其中 `.opencode/skills/kz3-control-engineer/scripts/...` 命令在全局安装时改为实际 `<skill>/scripts/...`。
本包的交付范围为逻辑块工程；旧流程中的自动登记项目在本包中不执行，除非用户另有明确要求。
引用的外部开发指南不存在时先定位等价 API/生成器证据，不能伪造文件或要求复制某个客户工程。

## 完成判据

- 简略需求已补全为可审阅的控制方案，设计缺口有推荐处理，实质方案选择有理由和采纳依据；不能只交问题清单。
- 每个需求有点位能力、案例/自定义分支、实现位置与验收场景对应；备用点和非本次用途的点不误接入控制。
- 项目需求为有来源的 FROZEN，配置可生成，C 使用当前 API，真实主机扫描通过；单靠案例或标签不算完成。
- 交付 README、project_io.yaml、logic.c、logic_project_test.c，以及配置点表、检查报告和待实板计划。
- 报告 DRAFT / 源码已生成 / HOST_PASS / 待实板的实际阶段。无工程环境时只能交付设计和明确依赖，不能宣称代码已验证。
- 不激活项目、不覆盖活动副本、不烧录、不连接现场、不自动提交；已有专项授权另按其范围执行。
