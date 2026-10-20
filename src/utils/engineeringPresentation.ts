import type { CaseConfig, ProcessRecipe } from '../types/engineering'
import { chineseUnit } from './engineeringConversation'

interface ScenarioPresentation {
  purpose: string
  equipment: string
  sequence: string
  protection: string
  observations: Array<{ title: string; action: string; expected: string }>
}

// 展示与需求提纲共用案例说明；控制参数仍取自工艺目录，不在界面另设默认值。
export const SCENARIO_PRESENTATIONS: Record<CaseConfig['caseId'], ScenarioPresentation> = {
  'three-pump-level-control': {
    purpose: '在来水变化和单泵故障下，协调排水能力与集水井液位。',
    equipment: 'P101 变频主调，P102 工频增援，P103 工频备用；正常最多两台同时运行。',
    sequence: '低位停泵，到启变频液位先启 P101；实际满频且高位持续不下降，再投入 P102。负荷回落后减泵，P103 仅在需要接替时投入。',
    protection: 'P102 故障须确认停稳后由 P103 接替；P101 故障退出正常调节，工频降级由操作员明确投入。许可或有效液位丢失退出自动，恢复后重新投入。',
    observations: [
      { title: '单泵调节', action: '部署后保留“日常来水”，点击“投入变频自动”。', expected: '液位到达启变频等级并满足确认时间后，P101 先运行，频率随液位变化；P102、P103 待机。' },
      { title: '按需增援', action: '将“上游来水”切换为“来水增加”，保持运行。', expected: '液位超过启工频等级、实际满频且高位持续不下降，满足连续确认后 P102 加入；正常最多两台。' },
      { title: '备用接替', action: '在 P101、P102 联合排水时，开启“工频泵故障”。', expected: 'P102 隔离，确认其停稳并满足切换间隔后 P103 接替；P101 继续调节。解除故障后，在 P102 卡片复位。' },
      { title: '减泵停机', action: '将“上游来水”切换为“来水停止”。', expected: '负荷降低并满足减泵条件后退出工频泵；到停泵液位全部自动泵停止。重新演示可重新部署，清除本轮模拟工况。' }
    ]
  },
  'water-supply-station': {
    purpose: '让清水箱补水、双泵供水和阀门联锁协同运行。',
    equipment: 'TK101 清水箱、XV101 双向进水阀、P101 主供泵、P102 备用泵。',
    sequence: '低位开阀补水，高位关阀；有供水需求且水位允许时，优先由 P101 供水。主泵故障停稳并经过切换间隔后，由 P102 接替。',
    protection: '缺水停泵，水源不可用停止补水；阀门到位断电、行程超时报警，全断开满 2 秒才允许换向。故障独立复位，运行许可恢复后需重新投入。',
    observations: [
      { title: '补水联动', action: '部署后投入自动，观察低位补水与高位关阀。', expected: '阀门状态与到位反馈一致，开关方向不会同时输出。' },
      { title: '主备供水', action: '启用供水需求，随后在主泵运行时触发主泵故障。', expected: '水位允许时主泵供水；主泵停稳并经过切换间隔后备用泵接替。' },
      { title: '保护恢复', action: '撤销运行许可，再恢复许可。', expected: '设备先停止，恢复许可不会自动重启；重新投入后继续工艺。' }
    ]
  },
  'two-device-output-sequence': {
    purpose: '通过前后级设备的顺序启停，验证联锁与延时控制。',
    equipment: 'DI1 启动、DI2 正常停止、DI3 运行许可；DO1 后级设备、DO2 前级设备。',
    sequence: '启动时先接通后级，再延时接通前级；正常停止时先断开前级，后级延时断开。',
    protection: '运行许可撤销、输入质量异常或立即停止时，两路输出立即断开；恢复许可后需要新的启动命令。',
    observations: [
      { title: '顺序启动', action: '打开 DI3 运行许可，再点击“启动”或 DI1。', expected: '后级先接通，经过启动间隔后前级接通。' },
      { title: '顺序停止', action: '点击“正常停止”或 DI2。', expected: '前级先断开，后级经过停止延时再断开。' },
      { title: '许可联锁', action: '运行时关闭 DI3，再重新打开。', expected: '两路立即断开；恢复许可不会自行启动。' }
    ]
  }
}

export function scenarioPresentation(recipe: ProcessRecipe) {
  return SCENARIO_PRESENTATIONS[recipe.id]
}

export function requirementDraft(recipe: ProcessRecipe) {
  const p = scenarioPresentation(recipe)
  const primary = Object.values(recipe.parameters).slice(0, 4)
    .map((spec) => `${spec.label} ${spec.default} ${chineseUnit(spec.unit)}`).join('；')
  return [
    `请设计${recipe.name}，用于本机软件联调。`,
    `【控制目标】${p.purpose}`,
    `【设备分工】${p.equipment}`,
    `【启停与联动】${p.sequence}`,
    `【建议参数】${primary}。其余时序与调节参数请按已验证案例列出建议值，供我确认。`,
    `【故障与保护】${p.protection}`,
    `【联调与交付】需要控制逻辑、工程点表、北向点位说明；后续生成可操作的工艺画面，观察${p.observations.map((x) => x.title).join('、')}。`,
    '请结合已导入点表，核对设备与信号是否匹配，补全必要的控制边界；区分我已提出的要求、你的建议和仍待确认的事项，先给出方案。'
  ].join('\n\n')
}

export function workflowCompleted(state: {
  workspaceId: string
  delivery: unknown
  hostPassed: boolean
  currentRuntime: boolean
}) {
  // 页面可访问不等于完成；HMI 操作与实板写入没有验收记录，不能自动标为已通过。
  return [!!state.workspaceId, !!state.delivery, state.hostPassed, state.currentRuntime, false, false]
}
