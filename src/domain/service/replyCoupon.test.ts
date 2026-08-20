import { describe, expect, it } from 'vitest'

import { createServiceSeedState } from './seed'
import {
  acceptReplyCouponRedemption,
  reviseReplyCouponRedemption,
  settleReplyCouponRedemption,
  withdrawReplyCouponRedemption,
} from './replyCoupon'
import { remainingPostalSupplyStock } from './transactions'

const ACCEPTED_AT = '2026-08-04T10:00:00.000Z'

describe('international reply coupon redemption', () => {
  it('redeems eligible goods with a seven-yuan-per-coupon ceiling and no-cash settlement', () => {
    const accepted = acceptReplyCouponRedemption(createServiceSeedState(), {
      acceptedAt: ACCEPTED_AT,
      couponCount: 2,
      lines: [
        { itemId: 'supply-redeem-ticket-600', quantity: 1 },
        { itemId: 'supply-redeem-postcard-120', quantity: 1 },
      ],
    })

    expect(accepted.redemption).toMatchObject({
      id: 'HXQ-20260804-000001',
      couponCount: 2,
      couponMaximumCents: 1400,
      itemCount: 2,
      merchandiseTotalCents: 720,
      discountCents: 720,
      amountDueCents: 0,
      status: 'pending-settlement',
    })

    const settled = settleReplyCouponRedemption(accepted.state, {
      redemptionId: accepted.redemption.id,
      settledAt: '2026-08-04T10:01:00.000Z',
      tender: 'cash',
      amountReceivedCents: 0,
    })

    expect(settled.redemption).toMatchObject({
      status: 'settled',
      settlementId: 'JS-20260804-000001',
      amountReceivedCents: 0,
      changeCents: 0,
    })
    expect(settled.settlement).toMatchObject({
      transactionIds: ['HXQ-20260804-000001'],
      amountDueCents: 0,
      invoiceRequested: false,
    })
  })

  it('charges only the amount above the coupon ceiling and masks third-party codes', () => {
    const accepted = acceptReplyCouponRedemption(createServiceSeedState(), {
      acceptedAt: ACCEPTED_AT,
      couponCount: 1,
      lines: [{ itemId: 'supply-redeem-ticket-600', quantity: 2 }],
    })
    expect(accepted.redemption).toMatchObject({
      merchandiseTotalCents: 1200,
      discountCents: 700,
      amountDueCents: 500,
    })

    const settled = settleReplyCouponRedemption(accepted.state, {
      redemptionId: accepted.redemption.id,
      settledAt: '2026-08-04T10:02:00.000Z',
      tender: 'third-party',
      amountReceivedCents: 500,
      paymentCode: 'A123456789',
    })
    expect(settled.redemption).toMatchObject({
      paymentPlatform: 'platform-a',
      paymentCodeMasked: '******6789',
      amountReceivedCents: 500,
    })
  })

  it('rejects ineligible goods, credit settlement, short payment codes, and duplicate settlement', () => {
    expect(() => acceptReplyCouponRedemption(createServiceSeedState(), {
      acceptedAt: ACCEPTED_AT,
      couponCount: 1,
      lines: [{ itemId: 'supply-international-reply-coupon', quantity: 1 }],
    })).toThrow('仅可兑付邮票以及封、片、卡目录商品')

    const accepted = acceptReplyCouponRedemption(createServiceSeedState(), {
      acceptedAt: ACCEPTED_AT,
      couponCount: 1,
      lines: [{ itemId: 'supply-redeem-ticket-600', quantity: 2 }],
    })
    expect(() => settleReplyCouponRedemption(accepted.state, {
      redemptionId: accepted.redemption.id,
      settledAt: '2026-08-04T10:02:00.000Z',
      tender: 'credit' as never,
      amountReceivedCents: 0,
    })).toThrow('不允许记欠')
    expect(() => settleReplyCouponRedemption(accepted.state, {
      redemptionId: accepted.redemption.id,
      settledAt: '2026-08-04T10:02:00.000Z',
      tender: 'third-party',
      amountReceivedCents: 500,
      paymentCode: 'A123',
    })).toThrow('不少于 8 位')

    const settled = settleReplyCouponRedemption(accepted.state, {
      redemptionId: accepted.redemption.id,
      settledAt: '2026-08-04T10:02:00.000Z',
      tender: 'pos',
      amountReceivedCents: 500,
    })
    expect(() => settleReplyCouponRedemption(settled.state, {
      redemptionId: accepted.redemption.id,
      settledAt: '2026-08-04T10:03:00.000Z',
      tender: 'cash',
      amountReceivedCents: 500,
    })).toThrow('不可重复结算')
  })

  it('revises pending lines against reserved stock and releases stock when withdrawn', () => {
    const accepted = acceptReplyCouponRedemption(createServiceSeedState(), {
      acceptedAt: ACCEPTED_AT,
      couponCount: 1,
      lines: [{ itemId: 'supply-redeem-card-160', quantity: 2 }],
    })
    expect(remainingPostalSupplyStock(
      accepted.state,
      'supply-redeem-card-160',
    )).toBe(990)

    const revised = reviseReplyCouponRedemption(accepted.state, {
      redemptionId: accepted.redemption.id,
      updatedAt: '2026-08-04T10:01:00.000Z',
      couponCount: 1,
      lines: [{ itemId: 'supply-redeem-card-160', quantity: 3 }],
    })
    expect(revised.redemption.itemCount).toBe(3)
    expect(remainingPostalSupplyStock(
      revised.state,
      'supply-redeem-card-160',
    )).toBe(989)

    const withdrawn = withdrawReplyCouponRedemption(revised.state, {
      redemptionId: revised.redemption.id,
      withdrawnAt: '2026-08-04T10:02:00.000Z',
    })
    expect(withdrawn.redemption.status).toBe('withdrawn')
    expect(remainingPostalSupplyStock(
      withdrawn.state,
      'supply-redeem-card-160',
    )).toBe(992)
  })
})
