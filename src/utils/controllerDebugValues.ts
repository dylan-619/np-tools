import type { Kz3Scalar, PointDescriptor } from '../types/controllerDebug'
import type { NorthboundField } from '../types/controllerIo'

type PointType = NorthboundField['c_type']

const INTEGER_RANGES = {
  u16: { min: 0, max: 65535 },
  u32: { min: 0, max: 4294967295 },
  i16: { min: -32768, max: 32767 },
  i32: { min: -2147483648, max: 2147483647 }
} as const

function integerRange(type: PointType) {
  return type === 'bool' || type === 'float' ? undefined : INTEGER_RANGES[type]
}

export function numericWriteConstraints(descriptor: PointDescriptor) {
  const range = integerRange(descriptor.c_type)
  return {
    min: range ? Math.max(range.min, descriptor.min ?? range.min) : descriptor.min,
    max: range ? Math.min(range.max, descriptor.max ?? range.max) : descriptor.max,
    step: range ? 1 : 'any'
  }
}

export function isRuntimeClearBinding(binding: string): boolean {
  return /^runtime\.[A-Za-z0-9_-]+\.clear$/.test(binding)
}

export function pointValueMatchesType(type: PointType, value: unknown): value is Kz3Scalar {
  if (type === 'bool') return typeof value === 'boolean'
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const range = integerRange(type)
  return !range || (Number.isInteger(value) && value >= range.min && value <= range.max)
}

// 只有 FLOAT 允许固件序列化产生的舍入误差；整数变化 1 也必须被观察到。
export function pointValuesEqual(a: Kz3Scalar, b: Kz3Scalar, type?: PointType): boolean {
  if (type === 'float' && typeof a === 'number' && typeof b === 'number') {
    return (
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) <= Math.max(1e-6, Math.abs(a) * 1e-6)
    )
  }
  return a === b
}

// 弹窗预校验与最终写入共用规则，不能仅依赖 input 的 min/max/step。
export function writeValueError(descriptor: PointDescriptor, value: unknown): string | null {
  if (!descriptor.writeSupported) return descriptor.writeDisabledReason || '当前点位不可写'
  if (descriptor.category === 'command') {
    return descriptor.c_type === 'bool' && value === true
      ? null
      : 'BOOL command 只允许触发一次 JSON true，不允许 false 或数值'
  }
  if (descriptor.c_type === 'bool') {
    return typeof value === 'boolean' ? null : 'BOOL parameter 必须写入 true 或 false'
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return '请输入有限数值'
  const range = integerRange(descriptor.c_type)
  if (range && !Number.isInteger(value)) return `${descriptor.c_type.toUpperCase()} 必须写入整数`
  if (descriptor.c_type === 'float' && !Number.isFinite(Math.fround(value))) {
    return '写入值超出 FLOAT 32 位有限数值范围'
  }
  const { min, max } = numericWriteConstraints(descriptor)
  if (min !== undefined && value < min) return `写入值不得小于 ${min}`
  if (max !== undefined && value > max) return `写入值不得大于 ${max}`
  return null
}
