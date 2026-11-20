# IEC 双泵导入回归夹具

`project_io.yaml` 来自 KZ3 固件工程 `projects/场景验证/双泵控制-时间交替/`，2026-11-20 核对时固件 HEAD 为 `36f5449`。

`expected-debug.json` 通过该工程配套 `plc.xml`、当前 `sdk/tools/iec/model.py::ProjectModel.derive()` 和 `sdk/generators/point_config_gen.py::_point_manifest()` 生成。测试固定了 46 个活动字段的顺序、类型、权限、地址及 manifest；XML 不作为工具导入输入。

保留原 YAML 的 `reference: 00008`，用于覆盖 Python / JavaScript YAML 解析器差异；导出必须保留原字节。禁止用工具自身的转换结果刷新期望 hash。
