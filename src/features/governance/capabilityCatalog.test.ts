import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CAPABILITY_CATALOG } from './capabilityCatalog'

describe('capability catalog evidence', () => {
  it('only cites existing specifications and executable test files', () => {
    for (const capability of CAPABILITY_CATALOG) {
      expect(
        existsSync(resolve(capability.specification)),
        `${capability.id} 的规格路径不存在：${capability.specification}`,
      ).toBe(true)
      for (const evidence of capability.evidence) {
        expect(evidence, `${capability.id} 的证据不是测试文件`)
          .toMatch(/\.test\.[cm]?[jt]sx?$/u)
        expect(
          existsSync(resolve(evidence)),
          `${capability.id} 的证据路径不存在：${evidence}`,
        ).toBe(true)
      }
    }
  })

  it('does not present an implemented capability without executable evidence', () => {
    for (const capability of CAPABILITY_CATALOG) {
      if (capability.maturity === 'planned') {
        expect(capability.evidence, capability.id).toHaveLength(0)
        expect(capability.verification, capability.id).toBe('none')
      } else {
        expect(capability.evidence.length, capability.id).toBeGreaterThan(0)
        expect(capability.verification, capability.id).not.toBe('none')
      }
    }
  })
})
