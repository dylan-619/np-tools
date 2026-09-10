import type { PointConfig, ProjectIoDocument } from '../types/controllerIo'
import { KZ3_BOARD_DEF, resolveDeviceProfile } from './controllerIoCatalog'

type PointDirection = 'input' | 'output'

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' })
}
function orderedDevices(doc: ProjectIoDocument) {
  return [...doc.project.devices].sort(
    (left, right) =>
      naturalCompare(left.port, right.port) ||
      left.slave_address - right.slave_address ||
      naturalCompare(left.name, right.name),
  )
}

/**
 * 按物理拓扑生成点位源顺序：板载在前，随后按总线、站号排列扩展模块，
 * 每个模块内部遵循板型/Profile 声明的 DI/DO/AI/AO 通道顺序。
 */
export function controllerSourceOrder(
  doc: ProjectIoDocument,
  direction: PointDirection,
): string[] {
  const boardSources = KZ3_BOARD_DEF.channels
    .filter((channel) => channel.direction === direction)
    .map((channel) => `board.${channel.code}`)

  const deviceSources = orderedDevices(doc).flatMap((device) => {
    const profile = resolveDeviceProfile(doc, device)
    const signals = direction === 'input' ? profile.inputs : profile.outputs
    return signals.map((signal) => `rtu.${device.name}.${signal.code}`)
  })

  return [...boardSources, ...deviceSources]
}

/** 返回新数组，不改变工程数据中对象的引用，确保表格内 v-model 仍能直接编辑。 */
export function sortControllerPoints(
  points: PointConfig[],
  sourceOrder: string[],
): PointConfig[] {
  const ranks = new Map(sourceOrder.map((source, index) => [source, index]))
  const fallbackRank = sourceOrder.length

  return [...points].sort((left, right) => {
    const leftRank = ranks.get(left.source) ?? fallbackRank
    const rightRank = ranks.get(right.source) ?? fallbackRank
    return (
      leftRank - rightRank ||
      naturalCompare(left.source, right.source) ||
      naturalCompare(left.name, right.name) ||
      naturalCompare(left.id, right.id)
    )
  })
}
