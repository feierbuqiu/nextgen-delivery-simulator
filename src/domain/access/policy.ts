export interface SecretPolicyResult {
  valid: boolean
  violations: string[]
}

export async function hashSecret(secret: string): Promise<string> {
  const payload = new TextEncoder().encode(secret)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', payload)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export async function secretMatches(
  candidate: string,
  expectedHash: string,
): Promise<boolean> {
  return (await hashSecret(candidate)) === expectedHash
}

export function validateSecret(secret: string): SecretPolicyResult {
  const violations: string[] = []
  const length = Array.from(secret).length
  if (length < 12 || length > 15) {
    violations.push('长度必须为 12 至 15 个字符')
  }
  if (!/[A-Z]/.test(secret)) {
    violations.push('必须包含大写字母')
  }
  if (!/[a-z]/.test(secret)) {
    violations.push('必须包含小写字母')
  }
  if (!/[0-9]/.test(secret)) {
    violations.push('必须包含数字')
  }
  if (!/[^A-Za-z0-9]/.test(secret)) {
    violations.push('必须包含特殊字符')
  }
  return { valid: violations.length === 0, violations }
}

export function normalizeWorkstationCode(value: string): string | null {
  const trimmed = value.trim()
  if (!/^\d{1,2}$/.test(trimmed)) {
    return null
  }
  return trimmed.padStart(2, '0')
}
