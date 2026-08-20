import { describe, expect, it } from 'vitest'

import type { SimulatorState } from '../../domain/access/types'
import { MemoryAccessRepository } from './MemoryAccessRepository'

describe('MemoryAccessRepository', () => {
  it('applies the same public-data sanitization contract on save and restore', async () => {
    const repository = await MemoryAccessRepository.create()
    const seed = await repository.load()
    const legacyOffice = "青禾支局"
    const profiledOperator = seed.operators.find((operator) => operator.profile !== null)
    if (!profiledOperator?.profile) throw new Error('测试夹具缺少已建档员工。')
    const unsafe: SimulatorState = {
      ...seed,
      operator: {
        ...profiledOperator,
        profileCompleted: true,
        profile: { ...profiledOperator.profile, institutionName: legacyOffice },
      },
    }

    await repository.save(unsafe)
    await expect(repository.load()).resolves.toMatchObject({
      operator: { profile: { institutionName: '景麓营业部' } },
    })

    const restored = await repository.restore(unsafe)
    expect(restored).toMatchObject({
      operator: { profile: { institutionName: '景麓营业部' } },
    })
  })
})
