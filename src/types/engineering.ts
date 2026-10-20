import catalog from '../../resources/engineering/cases/catalog.json'
export interface CaseConfig {
  schema: 'np-tools-expo-case-config/v1'
  caseId: 'two-device-output-sequence' | 'water-supply-station' | 'three-pump-level-control'
  caseVersion: '1.0.0'
  projectId: string
  projectVersion: string
  bindings: Record<string, string>
  parameters: Record<string, number>
  labels: Record<string, string>
}
export interface EngineeringMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  completed?: boolean
}
export interface NorthField {
  name: string
  bind: string
  c_type: string
  access: string
  reference: string
  description: string
}
export interface Delivery {
  directory: string
  code: string
  yaml: string
  scene: Scene
  bindings: Record<string, unknown>
  log: string
  manifest: {
    identity: Record<string, unknown>
    config: CaseConfig
    fields: NorthField[]
    hostReport: {
      status: string
      scope: string
      log: string
      compiler: string
      runnerSha256: string
    }
  }
}
export interface Scene {
  name: string
  devices: Array<{
    name: string
    type: string
    points: Record<string, string>
    commands: Record<string, string>
  }>
  parameters: Array<{ name: string; point: string; min: number; max: number; unit: string }>
  source: { projectId: string; projectVersion: string }
}
export interface RuntimeSnapshot {
  status: 'starting' | 'running' | 'stopped' | 'failed'
  runId: string
  workspaceId: string
  identity?: Record<string, unknown>
  fields?: Record<string, [boolean | number, number]>
  parameterRevision?: number
  nowMs?: number
  scanSequence?: number
  error?: string
  process?: {
    tankLevelPct: number
    valveOpeningPct?: number
    inflowActive?: boolean
    outflowActive?: boolean
    paused?: boolean
    valveBlocked?: boolean
    pump1NoFeedback?: boolean
    pump2NoFeedback?: boolean
    levelM?: number
    frequencyHz?: number
    inflowMode?: number
    inflowM3s?: number
    plantStarted?: boolean
    levelFailed?: boolean
    frequencyFailed?: boolean
  }
}
export const FIXED_BINDINGS = {
  startButton: 'board.di01',
  stopButton: 'board.di02',
  runPermit: 'board.di03',
  downstreamOutput: 'board.do01',
  upstreamOutput: 'board.do02'
}

export interface ProcessRecipe {
  id: CaseConfig['caseId']
  directory: string
  name: string
  projectId: string
  bindings: Record<string, string>
  parameters: Record<
    string,
    {
      name: string
      field: string
      label: string
      default: number
      min: number
      max: number
      type?: 'float' | 'u32'
      unit?: string
      step?: number
    }
  >
  labels: Record<string, string>
  description: string
  intro?: string
  ioSummary?: string
  exampleRequirement?: string
  highlights?: string[]
  terminals?: Array<{
    terminal: string
    source: string
    name: string
    kind: string
    detail: string
  }>
}
export const PROCESS_RECIPES = catalog as unknown as ProcessRecipe[]
export function processRecipe(id: string): ProcessRecipe {
  const recipe = PROCESS_RECIPES.find((r) => r.id === id)
  if (!recipe) throw new Error('不支持的工艺模板')
  return recipe
}
