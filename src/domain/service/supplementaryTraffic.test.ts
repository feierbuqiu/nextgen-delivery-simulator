import { describe, expect, it } from 'vitest'

import { createEmptySender } from '../customer/seed'
import type { SenderProfile } from '../customer/types'
import { createServiceSeedState } from './seed'
import {
  SUPPLEMENTARY_SUBJECTS,
  acceptSupplementaryTraffic,
  matchTrafficMail,
  queryTrafficStatistics,
  roundTripQuoteCents,
} from './supplementaryTraffic'
import { pendingServiceSummary, settleServiceTransactions } from './transactions'

const acceptedAt = '2026-08-10T10:00:00.000Z'

function retailSender(): SenderProfile {
  return {
    ...createEmptySender(),
    name: '顾客甲',
  }
}

function agreementSender(): SenderProfile {
  return {
    ...retailSender(),
    agreementAccountId: '99001000000001',
    agreementAccountName: '澜京长风文书服务中心',
  }
}

describe('supplementary and traffic workflows', () => {
  it('keeps the observed BL04 subject codes and rejects retail credit', () => {
    expect(SUPPLEMENTARY_SUBJECTS.map((subject) => subject.code)).toEqual([
      '1YWBL01047',
      '1YWBL01048',
    ])

    expect(() => acceptSupplementaryTraffic(createServiceSeedState(), {
      kind: 'supplementary-income',
      acceptedAt,
      sender: retailSender(),
      subjectCode: '1YWBL01047',
      count: 2,
      amountCents: 500,
      paymentMethod: 'credit',
    })).toThrow('零星客户不能选择记欠')
  })

  it('records agreement bulk mail with the matched 405 business snapshot', () => {
    const accepted = acceptSupplementaryTraffic(createServiceSeedState(), {
      kind: 'traffic-bulk-mail',
      acceptedAt,
      sender: agreementSender(),
      mailNumber: '1115206600001',
    })

    expect(accepted.record).toMatchObject({
      id: 'JG-20260810-000001',
      kind: 'traffic-bulk-mail',
      customerKind: 'agreement',
      paymentMethod: 'credit',
      amountCents: 1500,
      mail: {
        productSearchCode: '405',
        effectiveBusinessCode: '405100',
        mailNumber: '1115206600001',
      },
    })
    expect(pendingServiceSummary(accepted.state)).toEqual({ count: 1, totalCents: 1500 })
  })

  it('records a positive single-journey payment and settles it in cash', () => {
    const accepted = acceptSupplementaryTraffic(createServiceSeedState(), {
      kind: 'single-journey-payment',
      acceptedAt,
      sender: retailSender(),
      mailNumber: '1115206600002',
      collectOnDeliveryCents: 1800,
    })
    const settled = settleServiceTransactions(accepted.state, {
      transactionIds: [accepted.record.id],
      tender: 'cash',
      settledAt: '2026-08-10T10:01:00.000Z',
      amountReceivedCents: 2000,
    })

    expect(settled.settlement).toMatchObject({
      amountDueCents: 1800,
      amountReceivedCents: 2000,
      changeCents: 200,
    })
    expect(settled.state.supplementaryTrafficRecords[0]).toMatchObject({
      status: 'settled',
      settlementId: settled.settlement.id,
    })
  })

  it('derives the round-trip quote from zone and weight and guards the 405 area suffix', () => {
    const nonlocal = matchTrafficMail('1115202400001', 'round-trip').mail
    const local = matchTrafficMail('1115202400002', 'round-trip').mail

    expect(roundTripQuoteCents(nonlocal)).toBe(1250)
    expect(roundTripQuoteCents(local)).toBe(1000)
    expect(roundTripQuoteCents({ ...nonlocal, weightGrams: 1001 })).toBe(2250)
    expect(() => roundTripQuoteCents({
      ...local,
      effectiveBusinessCode: '405100',
    })).toThrow('业务代码与区域不一致')
  })

  it('filters the desensitized traffic statistics by type, date and remark', () => {
    const single = acceptSupplementaryTraffic(createServiceSeedState(), {
      kind: 'single-journey-payment',
      acceptedAt,
      sender: retailSender(),
      mailNumber: '1115206600002',
      collectOnDeliveryCents: 1800,
    })
    const roundMail = matchTrafficMail('1115202400001', 'round-trip').mail
    const round = acceptSupplementaryTraffic(single.state, {
      kind: 'round-trip-return',
      acceptedAt: '2026-08-10T10:02:00.000Z',
      sender: retailSender(),
      mail: roundMail,
      productionFeeCents: 0,
    })

    expect(queryTrafficStatistics(round.state.supplementaryTrafficRecords, {
      mailNumber: '2400001',
      acceptedDateFrom: '2026-08-10',
      acceptedDateTo: '2026-08-10',
      kind: 'round-trip-return',
      remark: 'round-trip-document',
    })).toEqual([round.record])
  })
})
