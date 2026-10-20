# 新项目的真实测试执行证据

适用于本轮新生成项目。旧项目保持原测试格式，只报告旧门禁证据范围，不自动编辑已有项目测试。

README 契约 `verification` 增加 `execution_profile: PLC_EXECUTED_V1`。
新项目最终验证必须加 `--require-execution-evidence`，并保留 `--strict-quality --require-engineering-review`。
验证器在编译测试翻译单元时强制包含技能的 `assets/plc_test_evidence.h`，不修改产品代码或测试源码。

每个 `required_scenarios` ID 都要有独立执行区段：

```c
/* PLC_TEST: RESET_FAULTS
 * Given 故障已经解除；When 复位；Then READY 但不恢复旧启动。 */
PLC_BEGIN("RESET_FAULTS");
/* 准备真实 DataManager / LogicManager，注入点位和命令。 */
PLC_CHECK(LogicManager_Step(&manager, now_ms));
PLC_CHECK(/* 通过真实输出/状态验证业务结果的布尔表达式 */);
PLC_END();
```

PLC_CHECK 失败立即以非零状态退出；BEGIN/END 之间至少一个实际成功的 LogicManager_Step 和一个实际断言。
可把项目 CHECK 定义为 PLC_CHECK；初始化等断言也须位于场景内。每段建议独立初始化，只有验证持续过程时共享。
BEGIN 不得嵌套；END 才写验证器独占临时目录的执行记录。只调用初始化/返回成功、贴标签、未调用测试函数、
提前 return 0、漏场景、零断言或零扫描都不能通过。普通不带此选项的旧测试不具备此执行证明。

执行次数不等于独立场景数，也不证明断言正确。每个场景仍须包含实际业务断言（不能只有 Step 成功）。
审查时至少选两个高风险禁止动作进行独立反例/故障注入，例如暂停计时被清零、复位恢复旧启动、
坏质量继续动作、手动被自动改写。证明测试可检出错误，之后还原并重跑；不把同一工具生成的正向测试当安全认证。
这不是对恶意伪造测试的沙箱，执行记录只是防止无意漏执行；语义覆盖与硬件结果分别验收。
