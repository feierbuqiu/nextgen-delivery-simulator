/** 公开基座不携带私有研发仓库的历史名称或编码迁移词表。 */
export function sanitizePublicProductText(value: string): string {
  return value
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function sanitizePublicProductData<T>(value: T): T {
  if (typeof value === 'string') return sanitizePublicProductText(value) as T
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePublicProductData(item)) as T
  }
  if (value && typeof value === 'object' && isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizePublicProductData(entry),
      ]),
    ) as T
  }
  return value
}

export function containsLegacyPublicProductText(_value: string): boolean {
  void _value
  return false
}
