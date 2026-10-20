import MarkdownIt, { type Token } from 'markdown-it'
import type { ProcessRecipe } from '../types/engineering'

export function chineseUnit(unit = 'ms') {
  const units: Record<string, string> = { mA: '毫安', ms: '毫秒', Hz: '赫兹', cm: '厘米', mm: '毫米', m: '米', s: '秒' }
  return unit.replace(/mA|ms|Hz|cm|mm|m|s/g, (value) => units[value]!)
}

/** Presentation only: raw replies remain unchanged for schema and version checks. */
export function chineseEngineeringText(source: string, recipe: ProcessRecipe) {
  const aliases: Record<string, string> = {
    'np-tools-expo-case-config/v1': '工程参数表',
    'np-tools-expo-hmi-request/v1': '操作界面配置',
    [recipe.id]: recipe.name,
    [recipe.projectId]: '当前工程',
    DEG_STA: '投入工频降级',
    SYS_STA: '投入变频自动',
    SYS_STP: '正常停止',
    SYS_TRIP: '立即停止',
    caseId: '工艺方案',
    caseVersion: '案例版本',
    projectId: '工程名称',
    projectVersion: '工程版本',
    host_simulation: '本地仿真',
    pumpNAuto: '各泵远程自动许可'
  }
  for (const [key, spec] of Object.entries(recipe.parameters))
    for (const alias of [key, spec.name, spec.field, `parameter.${spec.name}`])
      aliases[alias] = spec.label
  for (const [key, source] of Object.entries(recipe.bindings)) {
    const point = recipe.terminals?.find((p) => p.source === source)
    if (point) aliases[key] = point.name
  }
  const keys = Object.keys(aliases).sort((a, b) => b.length - a.length)
  const names = new Map(Object.entries(aliases).map(([key, value]) => [key.toLowerCase(), value]))
  const pattern = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return source
    .replace(
      new RegExp(`(^|[^A-Za-z0-9_])(${pattern})(?=$|[^A-Za-z0-9_])`, 'gi'),
      (_, prefix: string, key: string) => prefix + names.get(key.toLowerCase())
    )
    .replace(/\bJSON\b/gi, '工程配置')
    .replace(/\bHMI\b/g, '操作界面')
    .replace(/\bRecommended\b/gi, '推荐')
    .replace(/\bPID\b/g, '比例积分微分调节')
    .replace(/\bPI\b/g, '比例积分调节')
    .replace(/\bmA\b/g, '毫安')
    .replace(/\bms\b/g, '毫秒')
    .replace(/\bHz\b/g, '赫兹')
    .replace(/\bcm\b/g, '厘米')
    .replace(/\bmm\b/g, '毫米')
    .replace(/\bm\b/g, '米')
    .replace(/\bs\b/g, '秒')
    .replace(/(\d)(ms|Hz|mA|cm|mm|s|m)(?=$|[^A-Za-z])/g, (_, value: string, unit: string) => value + chineseUnit(unit))
    .replace(/请回复[“"「『\s]*(?:采用|确认)[”"」』\s]*/g, '请在下方核对方案参数')
}

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true })
markdown.disable('image')
// Conversation references do not navigate the desktop webview or load external content.
markdown.renderer.rules.link_open = () => '<span class="message-reference">'
markdown.renderer.rules.link_close = () => '</span>'
markdown.renderer.rules.fence = (tokens, index, _, env) => {
  const token = tokens[index]!
  if (!token.content.trim()) return ''
  if (
    /^(?:json|ya?ml|c|cpp|javascript|typescript)\b/i.test(token.info.trim()) ||
    /^\s*[{[]/.test(token.content)
  )
    return ''
  const recipe = env?.recipe as ProcessRecipe | undefined
  if (!recipe) return ''
  return `<p>${markdown.utils.escapeHtml(chineseEngineeringText(token.content, recipe)).trim().replace(/\n/g, '<br>')}</p>`
}
markdown.renderer.rules.code_block = () => ''

export function renderEngineeringReply(source: string, recipe: ProcessRecipe) {
  const text = source
    .split('<np-tools-context>')[0]!
    .replace(/^\s*\{\s*"schema"\s*:\s*"np-tools-expo-[\s\S]*$/m, '')
  const tokens = markdown.parse(text, {})
  const translate = (items: Token[]) => {
    for (const token of items) {
      if (token.type === 'text' || token.type === 'code_inline')
        token.content = chineseEngineeringText(token.content, recipe)
      if (token.children) translate(token.children)
    }
  }
  translate(tokens)
  return markdown.renderer.render(tokens, markdown.options, { recipe })
}

export function engineeringModelLabel(id: string, name?: string) {
  if (/deepseek.*flash/i.test(id)) return '深度求索 · 快速模型'
  if (/deepseek.*pro/i.test(id)) return '深度求索 · 专业模型'
  return name || id
}

export function conversationError(text: string) {
  const message = text.replace(/^(?:Error|TypeError):\s*/, '')
  if (/MessageAbortedError|(?:request|operation|message) (?:was )?aborted/i.test(message))
    return '本次回复已停止，已发送的需求仍保留，可继续补充或重新请求。'
  return /[\u4e00-\u9fff]/.test(message) ? message : '本次请求未完成，请检查智能服务连接后重试。'
}
