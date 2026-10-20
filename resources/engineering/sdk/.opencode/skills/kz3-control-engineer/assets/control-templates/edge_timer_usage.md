# T04 边沿与定时器标准用法

## 边沿

- `context->command.*` 已是扫描级 one-shot，直接消费；不要再套 `R_TRIG`。
- 物理 BOOL 输入先检查质量，再决定是否允许形成业务边沿。简单写成 `good && value` 会在质量丢失时
  人工制造下降沿；如果下降沿会触发轮换、计数或停机完成，必须把质量失效单独进入安全状态。
- 同一业务信号的上升沿和下降沿使用不同 ID；每个 ID 每扫描只调用一次。
- 第一次扫描输入已经为 true 时，`R_TRIG` 会产生上升沿。上电是否允许这个事件必须由项目需求决定；
  不允许时先完成基线观察或设置 rearm 状态。

```c
bool input_good = sample->quality == POINT_CONFIG_QUALITY_GOOD;
bool input_value = input_good && sample->value;

if (!input_good)
{
    context->state.rearm_required = true;
    /* 输出进入项目安全状态，不调用会产生业务动作的边沿路径。 */
}
else
{
    bool rise = R_TRIG(context, POINT_CONFIG_EDGE_SENSOR_RISE, input_value);
    bool fall = F_TRIG(context, POINT_CONFIG_EDGE_SENSOR_FALL, input_value);
    /* rise/fall 各自只消费一次。 */
}
```

## 定时器

- `TON` 用于条件连续成立确认；输入 false 当扫描复位。
- `TOF` 用于条件撤销后的延时保持；首次从未见 true 时不会凭空输出。
- `TP` 用于固定脉宽；业务脉宽至少为一个扫描周期，`preset=0` 不产生可见脉冲。
- 同一 Timer ID 不得混用 TON/TOF/TP，也不得在多个分支调用。
- 测试必须覆盖阈值前 1 ms、正好到时、到时后一拍、输入中途撤销和 `uint32_t` 回绕。

可执行语义证据由 `tests/logic_block_api_compile_test.c` 和
`application/projects/开发测试工程/全IO逻辑块综合HIL测试/logic_project_test.c` 持续验证。
