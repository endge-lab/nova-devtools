import type { NovaDevtoolsSerializable } from '@/protocol'

/** Приводит runtime-значение к безопасному JSON-compatible snapshot. */
export function toDevtoolsValue(value: unknown, depth = 0, seen = new WeakSet<object>()): NovaDevtoolsSerializable {
  if (value === null) return null
  if (value === undefined) return null

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
    return value
  }

  const valueType = typeof value
  if (valueType === 'function') return '[Function]'
  if (valueType === 'symbol') return String(value)
  if (valueType !== 'object') return String(value)
  if (depth >= 5) return '[Object]'

  const objectValue = value as object
  if (seen.has(objectValue)) return '[Circular]'
  seen.add(objectValue)

  if (Array.isArray(value)) {
    return value.map(item => toDevtoolsValue(item, depth + 1, seen))
  }

  if (value instanceof Map) {
    const result: Record<string, NovaDevtoolsSerializable> = {}
    for (const [key, item] of value) {
      result[String(key)] = toDevtoolsValue(item, depth + 1, seen)
    }
    return result
  }

  if (value instanceof Set) {
    return [...value].map(item => toDevtoolsValue(item, depth + 1, seen))
  }

  if (value instanceof Date) return value.toISOString()

  const result: Record<string, NovaDevtoolsSerializable> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = toDevtoolsValue(item, depth + 1, seen)
  }
  return result
}

/** Приводит record к безопасному JSON-compatible snapshot. */
export function toDevtoolsRecord(value: unknown): Record<string, NovaDevtoolsSerializable> {
  const snapshot = toDevtoolsValue(value)
  return snapshot && !Array.isArray(snapshot) && typeof snapshot === 'object'
    ? snapshot
    : {}
}
