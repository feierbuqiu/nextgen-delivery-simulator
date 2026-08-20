import { describe, expect, it } from 'vitest'

import { calculateServiceCharge } from './policy'
import { acceptReplyCouponRedemption } from './replyCoupon'
import { createEmptySender } from '../customer/seed'
import {
  createEmptyServiceDraft,
  createServiceSeedState,
  POSTAL_SUPPLY_ITEMS,
  SERVICE_PRODUCTS,
} from './seed'
import {
  acceptPostalSupplySale,
  acceptServiceTransaction,
  pendingServiceSummary,
  remainingPostalSupplyStock,
  recordInvoiceDecision,
  settleServiceTransactions,
} from './transactions'

function acceptedState(acceptedAt = '2026-01-15T09:20:00.000Z') {
  const product = SERVICE_PRODUCTS[0]!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    itemCode: '7000818316568',
    weightGrams: 20,
  }
  return acceptServiceTransaction(createServiceSeedState(), {
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: {
        agreementAccountId: null,
        agreementAccountName: '',
        contact: '',
        name: '寄件人',
        detailedAddress: '示范地址',
        unit: '',
        postalCode: '',
        identityType: '',
        identityValue: '',
        gender: '',
      },
      recipient: {
        contact: '',
        name: '收件人',
        detailedAddress: '示范地址',
        unit: '',
        postalCode: '',
      },
    },
    draft,
    product,
  })
}

describe('service settlement transactions', () => {
  it('uses the east-eight business day for live acceptance and settlement identifiers', () => {
    const accepted = acceptedState('2026-08-18T16:05:00.000Z')
    expect(accepted.transaction.id).toBe('SIM-20260819-000001')

    const settled = settleServiceTransactions(accepted.state, {
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: '2026-08-18T16:10:00.000Z',
      amountReceivedCents: accepted.transaction.charge.settlementDueCents,
    })
    expect(settled.settlement.id).toBe('JS-20260819-000001')
  })

  it('settles a pending batch, records invoice choice afterwards, and refuses rollback', () => {
    const accepted = acceptedState()
    const settled = settleServiceTransactions(accepted.state, {
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: '2026-01-15T09:30:00.000Z',
      amountReceivedCents: 100,
    })
    expect(settled.settlement).toMatchObject({
      id: 'JS-20260115-000001',
      amountDueCents: 80,
      amountReceivedCents: 100,
      changeCents: 20,
      invoiceRequested: null,
    })
    expect(settled.state.transactions[0]).toMatchObject({
      status: 'settled',
      settlementId: 'JS-20260115-000001',
    })

    const invoiced = recordInvoiceDecision(
      settled.state,
      settled.settlement.id,
      false,
    )
    expect(invoiced.settlements[0]?.invoiceRequested).toBe(false)
    expect(() => settleServiceTransactions(invoiced, {
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: '2026-01-15T09:31:00.000Z',
      amountReceivedCents: 80,
    })).toThrow('不可回退')
  })

  it('accepts postal supplies, decrements stock, and settles them with mail', () => {
    const accepted = acceptedState()
    const supplies = acceptPostalSupplySale(accepted.state, {
      acceptedAt: '2026-01-15T09:25:00.000Z',
      sender: createEmptySender(),
      lines: [{ itemId: 'supply-standard-envelope', quantity: 2 }],
    })
    expect(supplies.sale).toMatchObject({
      id: 'YP-20260115-000001',
      status: 'pending-settlement',
      totalCents: 400,
      lines: [{ label: '演示标准信封', quantity: 2, amountCents: 400 }],
    })
    expect(remainingPostalSupplyStock(
      supplies.state,
      'supply-standard-envelope',
    )).toBe(118)
    expect(pendingServiceSummary(supplies.state)).toEqual({
      count: 2,
      totalCents: 480,
    })

    const settled = settleServiceTransactions(supplies.state, {
      transactionIds: [accepted.transaction.id, supplies.sale.id],
      tender: 'cash',
      settledAt: '2026-01-15T09:30:00.000Z',
      amountReceivedCents: 500,
    })
    expect(settled.settlement).toMatchObject({
      amountDueCents: 480,
      changeCents: 20,
    })
    expect(settled.state.transactions[0]?.status).toBe('settled')
    expect(settled.state.postalSupplySales[0]).toMatchObject({
      status: 'settled',
      settlementId: settled.settlement.id,
    })
  })

  it('keeps retired pending reply-coupon history out of active settlement blockers', () => {
    const initial = createServiceSeedState()
    const legacy = acceptReplyCouponRedemption(initial, {
      acceptedAt: '2026-08-04T10:00:00.000Z',
      couponCount: 1,
      lines: [{ itemId: 'supply-redeem-ticket-600', quantity: 1 }],
    })

    expect(legacy.state.replyCouponRedemptions).toHaveLength(1)
    expect(pendingServiceSummary(legacy.state)).toEqual({ count: 0, totalCents: 0 })
  })

  it('rejects duplicate and over-stock postal-supply lines', () => {
    const state = createServiceSeedState()
    expect(() => acceptPostalSupplySale(state, {
      acceptedAt: '2026-01-15T09:25:00.000Z',
      sender: createEmptySender(),
      lines: [
        { itemId: 'supply-standard-envelope', quantity: 1 },
        { itemId: 'supply-standard-envelope', quantity: 1 },
      ],
    })).toThrow('只能保留一行')
    expect(() => acceptPostalSupplySale(state, {
      acceptedAt: '2026-01-15T09:25:00.000Z',
      sender: createEmptySender(),
      lines: [{ itemId: 'supply-standard-envelope', quantity: 121 }],
    })).toThrow('1 至 120')
  })

  it('reserves selected 301 content stock and rejects a stale over-stock draft', () => {
    const product = SERVICE_PRODUCTS.find((item) => item.searchCode === '301')!
    const item = POSTAL_SUPPLY_ITEMS.find(
      (candidate) => candidate.id === 'supply-demo-grain-gift-box',
    )!
    const contentLine = {
      itemId: item.id,
      label: item.label,
      mnemonic: item.mnemonic,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      quantity: 1,
      amountCents: item.unitPriceCents,
    }
    const draft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: product.id,
      itemCode: 'PA13131313435',
      weightGrams: 1000,
      platformQuoteCents: 2000,
      contents: `${item.label}×1`,
      contentItems: [contentLine],
    }
    const customer = {
      ...acceptedState().transaction.customer,
      productFamily: 'parcel' as const,
    }
    const accepted = acceptServiceTransaction(createServiceSeedState(), {
      acceptedAt: '2026-01-15T09:20:00.000Z',
      charge: calculateServiceCharge(draft, product),
      customer,
      draft,
      product,
    })

    expect(remainingPostalSupplyStock(accepted.state, item.id)).toBe(39)
    expect(() => acceptServiceTransaction(accepted.state, {
      acceptedAt: '2026-01-15T09:21:00.000Z',
      charge: calculateServiceCharge(draft, product),
      customer,
      draft: {
        ...draft,
        contentItems: [{
          ...contentLine,
          quantity: 40,
          amountCents: item.unitPriceCents * 40,
        }],
      },
      product,
    })).toThrow('1 至 39')
  })
})
