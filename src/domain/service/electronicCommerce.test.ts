import { describe, expect, it } from 'vitest'

import {
  acceptElectronicCommerce,
  queryElectronicCommerceRecords,
  resolveElectronicCommerceAccount,
} from './electronicCommerce'
import { createServiceSeedState } from './seed'
import { settleServiceTransactions } from './transactions'

const acceptedAt = '2026-08-10T10:20:00.000Z'

describe('electronic commerce', () => {
  it('requires a utility payment to equal the queried balance and prevents duplicates', () => {
    const seed = createServiceSeedState()
    expect(resolveElectronicCommerceAccount(
      seed,
      'water',
      'lanjing-water',
      '856461',
    )).toMatchObject({ customerName: '周清禾', dueAmountCents: 6000 })

    expect(() => acceptElectronicCommerce(seed, {
      acceptedAt,
      projectId: 'water',
      providerId: 'lanjing-water',
      accountNumber: '856461',
      amountCents: 1000,
    })).toThrow('缴费金额必须与应缴总额一致。')

    const accepted = acceptElectronicCommerce(seed, {
      acceptedAt,
      projectId: 'water',
      providerId: 'lanjing-water',
      accountNumber: '856461',
      amountCents: 6000,
    })
    expect(accepted.record).toMatchObject({
      id: 'DS-20260810-000001',
      kind: 'utility-payment',
      projectLabel: '水费',
      amountCents: 6000,
      status: 'pending-settlement',
    })
    expect(() => resolveElectronicCommerceAccount(
      accepted.state,
      'water',
      'lanjing-water',
      '856461',
    )).toThrow('该账单已经完成业务受理，不能重复缴费。')
  })

  it('records repeatable phone top-ups and carries the updated balance into the next query', () => {
    const first = acceptElectronicCommerce(createServiceSeedState(), {
      acceptedAt,
      projectId: 'mobile',
      providerId: 'lanjing-mobile',
      accountNumber: '10000000038',
      amountCents: 1000,
    })
    expect(first.record).toMatchObject({
      kind: 'phone-topup',
      accountBalanceBeforeCents: 3764,
      amountCents: 1000,
    })
    expect(resolveElectronicCommerceAccount(
      first.state,
      'mobile',
      'lanjing-mobile',
      '10000000038',
    ).accountBalanceCents).toBe(4764)
  })

  it('settles and queries electronic-commerce records through the shared transaction ledger', () => {
    const accepted = acceptElectronicCommerce(createServiceSeedState(), {
      acceptedAt,
      projectId: 'landline',
      providerId: 'lanjing-landline',
      accountNumber: '01099001234',
      amountCents: 2000,
    })
    const settled = settleServiceTransactions(accepted.state, {
      transactionIds: [accepted.record.id],
      tender: 'cash',
      settledAt: '2026-08-10T10:25:00.000Z',
      amountReceivedCents: 2000,
    })
    expect(settled.state.electronicCommerceRecords[0]).toMatchObject({
      status: 'settled',
      settlementId: 'JS-20260810-000001',
    })
    expect(queryElectronicCommerceRecords(settled.state.electronicCommerceRecords, {
      projectId: 'landline',
      status: 'settled',
      operatorId: '80000001',
      acceptedDateFrom: '2026-08-10',
      acceptedDateTo: '2026-08-10',
    })).toHaveLength(1)
  })
})
