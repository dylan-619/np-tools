import { processRecipe, type CaseConfig, type Scene, type NorthField } from '../types/engineering'
/** Only schema-tagged JSON is considered a candidate; ordinary chat never changes artifacts. */
export function structuredCandidates(text: string): unknown[] {
  const result: unknown[] = []
  for (const match of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) {
    try {
      result.push(JSON.parse(match[1]!))
    } catch {
      /* Incomplete streamed block is not a result. */
    }
  }
  return result
}
export function validateCaseConfig(
  value: unknown,
  version: string,
  caseId = 'two-device-output-sequence'
): CaseConfig {
  const c = value as CaseConfig
  if (
    !c ||
    Object.keys(c).sort().join(',') !==
      [
        'schema',
        'caseId',
        'caseVersion',
        'projectId',
        'projectVersion',
        'bindings',
        'parameters',
        'labels'
      ]
        .sort()
        .join(',')
  )
    throw new Error('案例配置包含缺失或未知字段')
  if (
    !c ||
    c.schema !== 'np-tools-expo-case-config/v1' ||
    c.caseId !== caseId ||
    c.caseVersion !== '1.0.0'
  )
    throw new Error('不是当前固定案例配置')
  const recipe = processRecipe(caseId)
  if (c.projectId !== recipe.projectId || c.projectVersion !== version)
    throw new Error('AI配置的工程身份与当前轮次不一致')
  if (
    Object.keys(c.bindings ?? {}).length !== Object.keys(recipe.bindings).length ||
    Object.entries(recipe.bindings).some(([k, v]) => c.bindings[k] !== v)
  )
    throw new Error('点位绑定与当前工艺不一致')
  if (
    !c.parameters ||
    Object.keys(c.parameters).sort().join(',') !==
      Object.keys(recipe.parameters).sort().join(',') ||
    Object.entries(c.parameters).some(
      ([k, v]) =>
        typeof v !== 'number' ||
        !Number.isFinite(v) ||
        !recipe.parameters[k] ||
        (recipe.parameters[k]?.type !== 'float' && !Number.isInteger(v)) ||
        (recipe.parameters[k]?.type === 'float' &&
          Math.abs(v * 1000 - Math.round(v * 1000)) > 0.00001) ||
        v < recipe.parameters[k]!.min ||
        v > recipe.parameters[k]!.max
    )
  )
    throw new Error('参数超出当前工艺允许范围或精度')
  if (
    caseId === 'three-pump-level-control' &&
    !(
      c.parameters.stopLevelM! < c.parameters.targetLevelM! &&
      c.parameters.targetLevelM! < c.parameters.vfdStartLevelM! &&
      c.parameters.vfdStartLevelM! < c.parameters.assistStartLevelM!
    )
  )
    throw new Error('液位必须满足：停泵 < 调节目标 < 启变频 < 启工频')
  if (
    !c.labels ||
    Object.keys(c.labels).sort().join(',') !== Object.keys(recipe.labels).sort().join(',') ||
    Object.values(c.labels).some(
      (v) => typeof v !== 'string' || !v.trim() || v.length > 40 || /[\x00-\x1f]/.test(v)
    ) ||
    new Set(Object.values(c.labels)).size !== Object.keys(c.labels).length ||
    Object.values(c.labels).includes('联动控制')
  )
    throw new Error('设备名称需为互不重复的1–40个可见字符')
  return c
}
export function validateScene(scene: Scene, fields: NorthField[], config: CaseConfig) {
  if (
    scene.source.projectId !== config.projectId ||
    scene.source.projectVersion !== config.projectVersion
  )
    throw new Error('HMI工程版本不匹配')
  const recipe = processRecipe(config.caseId)
  const allowedParameters = Object.values(recipe.parameters)
  const map = new Map(fields.map((f) => [f.name, f]))
  const names = new Set<string>()
  for (const d of scene.devices) {
    if (names.has(d.name)) throw new Error('HMI设备名称重复')
    names.add(d.name)
    for (const point of Object.values(d.points))
      if (!map.has(point)) throw new Error(`HMI未知字段 ${point}`)
    for (const point of Object.values(d.commands)) {
      const f = map.get(point)
      if (!f || f.access !== 'read_write' || !f.bind.startsWith('command.') || f.c_type !== 'bool')
        throw new Error(`HMI命令不允许 ${point}`)
    }
  }
  for (const p of scene.parameters) {
    const f = map.get(p.point)
    if (
      !f ||
      !f.bind.startsWith('parameter.') ||
      !['u32', 'float'].includes(f.c_type) ||
      f.access !== 'read_write' ||
      !allowedParameters.some(
        (spec) =>
          spec.field === p.point &&
          spec.min === p.min &&
          spec.max === p.max &&
          f.c_type === (spec.type ?? 'u32') &&
          p.unit === (spec.unit ?? 'ms')
      )
    )
      throw new Error(`HMI参数不允许 ${p.point}`)
  }
}
