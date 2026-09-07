import type { NorthboundField } from '../types/controllerIo'

/** 与 KZ3 `point_config_gen.py::_point_manifest()` 一致的点表契约。 */
export const KZ3_POINT_MANIFEST_ALGORITHM = 'sha256-kz3-north-fields-canonical-v1'

export interface Kz3PointManifest {
  algorithm: typeof KZ3_POINT_MANIFEST_ALGORITHM
  canonicalJson: string
  hash: string
  pointCount: number
}

function manifestType(type: NorthboundField['c_type']): string {
  switch (type) {
    case 'float':
      return 'f32'
    case 'bool':
    case 'u16':
    case 'u32':
    case 'i32':
      return type
    default:
      // 当前 KZ3 生成器不会为 i16 产生北向 manifest；不能用工具侧猜测替代。
      throw new Error(`当前 KZ3 manifest 算法不支持本地点位类型 ${type}`)
  }
}

function firmwareFieldWidth(type: NorthboundField['c_type']): number {
  // 必须镜像 point_config_gen.py::field_width()，包含其当前 i32=1 的行为。
  return type === 'float' || type === 'u32' ? 2 : 1
}

async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前运行环境不支持 Web Crypto SHA-256，不能验证 KZ3 点表 manifest')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('')
}

/**
 * 以固件生成器冻结的字段顺序、类型名、reference 字符串和寄存器宽度生成 SHA-256。
 * 这个 hash 仅覆盖北向点表，不等同于 project_io.yaml 原始字节的 configuration_hash。
 */
export async function buildKz3PointManifest(
  fields: readonly NorthboundField[]
): Promise<Kz3PointManifest> {
  const canonicalFields = fields.map((field) => [
    String(field.name),
    String(field.bind),
    manifestType(field.c_type),
    String(field.access),
    String(field.reference),
    firmwareFieldWidth(field.c_type)
  ])
  const canonicalJson = JSON.stringify(['kz3-point-manifest/v1', canonicalFields])
  return {
    algorithm: KZ3_POINT_MANIFEST_ALGORITHM,
    canonicalJson,
    hash: await sha256Hex(canonicalJson),
    pointCount: fields.length
  }
}
