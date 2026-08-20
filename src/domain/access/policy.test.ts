import { describe, expect, it } from 'vitest'

import {
  hashSecret,
  normalizeWorkstationCode,
  secretMatches,
  validateSecret,
} from './policy'
import { DEMO_TEMPORARY_SECRET } from './seed'

describe('access policy', () => {
  it('requires every observed secret category and length rule', () => {
    expect(validateSecret('short').valid).toBe(false)
    expect(validateSecret('alllowercase12!').violations).toContain(
      '必须包含大写字母',
    )
    expect(validateSecret('ALLUPPERCASE12!').violations).toContain(
      '必须包含小写字母',
    )
    expect(validateSecret('NoNumbersHere!').violations).toContain('必须包含数字')
    expect(validateSecret('NoSpecials123').violations).toContain('必须包含特殊字符')
    expect(validateSecret('Fresh!Access26')).toEqual({
      valid: true,
      violations: [],
    })
    expect(validateSecret(DEMO_TEMPORARY_SECRET)).toEqual({
      valid: true,
      violations: [],
    })
  })

  it('hashes and verifies demo secrets without storing plaintext', async () => {
    const hash = await hashSecret('Fresh!Access26')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    await expect(secretMatches('Fresh!Access26', hash)).resolves.toBe(true)
    await expect(secretMatches('Wrong!Access26', hash)).resolves.toBe(false)
  })

  it('normalizes one-digit workstation values and rejects other input', () => {
    expect(normalizeWorkstationCode('1')).toBe('01')
    expect(normalizeWorkstationCode(' 08 ')).toBe('08')
    expect(normalizeWorkstationCode('001')).toBeNull()
    expect(normalizeWorkstationCode('A1')).toBeNull()
  })
})
