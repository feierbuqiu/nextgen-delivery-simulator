import { describe, expect, it } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../customer/seed'
import {
  assertAccountingOpen,
  executePersonalRemittanceCommand,
  projectPersonalRemittance,
} from './personalRemittance'
import { calculateServiceCharge } from './policy'
import { acceptReplyCouponRedemption } from './replyCoupon'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import { acceptServiceTransaction, settleServiceTransactions } from './transactions'
import type {
  ServiceOperatorSnapshot,
  ServicePaymentMethod,
  ServiceWorkspaceState,
} from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '林澄',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '虚构寄达局',
}

function acceptLetter(
  state: ServiceWorkspaceState,
  acceptedAt: string,
  paymentMethod: ServicePaymentMethod = 'cash-settlement',
) {
  const product = SERVICE_PRODUCTS[0]!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    itemCode: `7000818316${String(state.nextSequence).padStart(3, '0')}`,
    weightGrams: 20,
    paymentMethod,
  }
  return acceptServiceTransaction(state, {
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: { ...createEmptySender(), name: '林澄', detailedAddress: '澜京市栖台区新程路 1 号' },
      recipient: { ...createEmptyRecipient(), name: '顾远', detailedAddress: '澄岐省澄野市江洲区远帆路 2 号' },
    },
    draft,
    product,
    operator,
  })
}

function settledCashState(): ServiceWorkspaceState {
  const accepted = acceptLetter(createServiceSeedState(), '2026-08-12T01:00:00.000Z')
  return settleServiceTransactions(accepted.state, {
    transactionIds: [accepted.transaction.id],
    tender: 'cash',
    settledAt: '2026-08-12T01:05:00.000Z',
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  }).state
}

function generate(state: ServiceWorkspaceState, ignoreCurrentDayPending = false) {
  return executePersonalRemittanceCommand(state, {
    type: 'generate-personal-remittance',
    workDate: '2026-08-12',
    operator,
    institutionCode: '99901001',
    institutionName: '景麓营业部',
    workstationCode: '01',
    generatedAt: '2026-08-12T02:00:00.000Z',
    ignoreCurrentDayPending,
  })
}

describe('personal remittance', () => {
  it('aggregates settled business and excludes self-affixed postage', () => {
    const cash = settledCashState()
    const selfAffixed = acceptLetter(cash, '2026-08-12T01:10:00.000Z', 'self-affixed')
    const settled = settleServiceTransactions(selfAffixed.state, {
      transactionIds: [selfAffixed.transaction.id],
      tender: 'cash',
      settledAt: '2026-08-12T01:15:00.000Z',
      amountReceivedCents: 0,
    })

    const projection = projectPersonalRemittance(settled.state, '2026-08-12', '80000001', '01')
    expect(projection).toMatchObject({
      totalCount: 1,
      totalAmountCents: 80,
      cashAmountCents: 80,
      pendingReferences: [],
    })
    expect(projection.sourceReferences).toHaveLength(1)
  })

  it('requires explicit confirmation to ignore current-day pending business', () => {
    const pending = acceptLetter(createServiceSeedState(), '2026-08-12T01:00:00.000Z')
    expect(() => generate(pending.state)).toThrow('当天还有 1 笔未结算业务')

    const result = generate(pending.state, true)
    expect(result.remittance).toMatchObject({
      status: 'generated',
      totalCount: 0,
      ignoredPendingReferences: [pending.transaction.id],
    })
  })

  it('blocks generation while historical pending business exists', () => {
    const pending = acceptLetter(createServiceSeedState(), '2026-08-10T01:00:00.000Z')
    expect(() => generate(pending.state, true)).toThrow('历史未结算业务')
  })

  it('does not treat retired pending reply-coupon history as an open counter item', () => {
    const legacy = acceptReplyCouponRedemption(createServiceSeedState(), {
      acceptedAt: '2026-08-10T01:00:00.000Z',
      couponCount: 1,
      lines: [{ itemId: 'supply-redeem-ticket-600', quantity: 1 }],
      operator,
    })

    expect(projectPersonalRemittance(
      legacy.state,
      '2026-08-12',
      operator.operatorId,
      operator.workstationCode,
    )).toMatchObject({
      pendingReferences: [],
      previousDayPendingReferences: [],
    })
  })

  it('locks same-day accounting after confirmation and unlocks after cancellation', () => {
    const generated = generate(settledCashState())
    const confirmed = executePersonalRemittanceCommand(generated.state, {
      type: 'confirm-personal-remittance',
      remittanceId: generated.remittance.id,
      operator,
      confirmedAt: '2026-08-12T02:05:00.000Z',
    })

    expect(() => assertAccountingOpen(
      confirmed.state,
      operator,
      '2026-08-12T03:00:00.000Z',
    )).toThrow(generated.remittance.id)
    expect(() => acceptLetter(
      confirmed.state,
      '2026-08-12T03:00:00.000Z',
    )).toThrow('已确认个人缴款单')

    const cancelled = executePersonalRemittanceCommand(confirmed.state, {
      type: 'cancel-personal-remittance',
      remittanceId: generated.remittance.id,
      operator,
      cancelledAt: '2026-08-12T02:10:00.000Z',
      reason: '补录遗漏业务',
    })
    expect(() => assertAccountingOpen(
      cancelled.state,
      operator,
      '2026-08-12T03:00:00.000Z',
    )).not.toThrow()
    expect(generate(cancelled.state).remittance.id).not.toBe(generated.remittance.id)
  })

  it('records print history without changing confirmation state', () => {
    const generated = generate(settledCashState())
    const printed = executePersonalRemittanceCommand(generated.state, {
      type: 'print-personal-remittance',
      remittanceId: generated.remittance.id,
      printedAt: '2026-08-12T02:03:00.000Z',
    })
    expect(printed.remittance).toMatchObject({
      status: 'generated',
      printHistory: ['2026-08-12T02:03:00.000Z'],
    })
  })
})
