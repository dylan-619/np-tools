# KZ3 工程依赖与交付

独立部署指智能体规则/案例可搬迁，不是另造固件工具链。无 KZ3 工程可完成需求与设计；
生成可运行配置/C 与主机验收需要用户提供匹配的 KZ3 工作区或具备等价契约的 SDK。
不索取原开发者整台电脑，不复制客户工程，不自动下载未知版本 SDK。

生成前定位目标根目录并读取适用项目约定；实际检查：
- application/logic.h、User/Inc/logic_block_api.h、当前生成器和生成类型；
- application/io_definitions 中实际板型/Profile，application/case_center/standard_templates/catalog.yaml；
- tools/point_config_gen.py、DataManager/LogicManager、主机测试假底座；
- 当前开发指南、参数/runtime 约束和已有项目接口。

脚本入口：`python3 <skill>/scripts/preflight.py --workspace <KZ3根目录>`。
它只检查文件可用性，不证明版本兼容或硬件正确；比较模板/签名/schema 与生成器后再决定适配。
包内 assets/control-templates 是可离线查看的源码快照；生成时优先匹配目标仓库模板，版本不同先审查，
不能覆盖目标模板。缺 SDK 依赖只阻止实现/编译，不阻止需求工作。

正式输出在 `application/projects/<项目叶子目录>/`。用户仅要独立逻辑块也应附所需配置与接口说明，
不能交付引用不存在字段的 C。默认不登记、不激活项目；用户明确要求登记时按平台工具处理。

按 [工程生成](project-generation.md) 和 [生成契约](generation-contract.md) 执行；本包覆盖其中默认登记步骤。
输入文件有未提交改动先保存证据并保留，源文件变化后重核受影响内容。

```sh
python3 <skill>/scripts/verify_project.py --requirements-file <需求.md> --require-engineering-review
python3 <skill>/scripts/verify_project.py <项目目录> --requirements-only --require-frozen --require-engineering-review
python3 <skill>/scripts/verify_project.py <项目目录> --strict-quality --require-engineering-review --require-execution-evidence
```

第三条使用原技能隔离验证器，依赖 Python/PyYAML、C 编译器及 KZ3 主机运行环境。它不激活工程。
语义审查仍需核对需求→点位→状态机→代码→断言，尤其泵组容量、双向阀拒令和 PID owner。
需求门禁失败不能通过伪造 FROZEN、删除场景或放宽检查解决。
最终给出文件、实际命令和退出结果，区分源码审查、HOST_PASS、HIL_PREPARED、实板和现场验收。
