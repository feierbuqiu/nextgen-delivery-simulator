import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { calculateServiceCharge } from './policy'
import {
  createEmptyServiceDraft,
  createServiceSeedState,
  SERVICE_PRODUCTS,
} from './seed'
import {
  dispatchReturnReceipt,
  recordReturnReceiptArrival,
  returnReceiptEligibility,
} from './returnReceipt'
import {
  acceptServiceTransaction,
  DEFAULT_SERVICE_OPERATOR,
  settleServiceTransactions,
} from './transactions'
import {
  reviseServiceTransaction,
  withdrawServiceTransactions,
} from './transactionCorrection'
import type { ServiceCustomerSnapshot } from './types'

const acceptedAt = '2026-08-04T01:00:00.000Z'

function acceptRegisteredReturnReceipt() {
  const product = SERVICE_PRODUCTS.find((item) => item.id === 'registered-letter-200')!
  const draft = {
    ...createEmptyServiceDraft(false, 'local'),
    productId: product.id,
    itemCode: 'XK00000000001',
    weightGrams: 20,
    returnReceiptRequested: true,
  }
  const customer: ServiceCustomerSnapshot = {
    productFamily: 'standard-delivery' as const,
    destinationRegion: 'domestic' as const,
    sender: {
      agreementAccountId: null,
      agreementAccountName: '',
      contact: '10000000000',
      name: '练习寄件人',
      detailedAddress: '澜京市栖台区练习路1号',
      unit: '',
      postalCode: '',
      identityType: '',
      identityValue: '',
      gender: '' as const,
    },
    recipient: {
      contact: '10000000007',
      name: '练习收件人',
      detailedAddress: '澄岐省澄野市江洲区模拟路2号',
      unit: '',
      postalCode: '',
    },
  }
  return acceptServiceTransaction(createServiceSeedState(), {
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer,
    draft,
    product,
    operator: DEFAULT_SERVICE_OPERATOR,
  })
}

describe('return receipt chain', () => {
  it('applies the route fee and rejects unsupported routes', () => {
    const product = SERVICE_PRODUCTS.find((item) => item.id === 'registered-letter-200')!
    expect(returnReceiptEligibility(product, 'local')).toMatchObject({
      offered: true,
      eligible: true,
      feeCents: 300,
    })
    expect(returnReceiptEligibility(product, 'international')).toMatchObject({
      eligible: true,
      feeCents: 500,
    })
    expect(returnReceiptEligibility(product, 'special-beautiful-island')).toMatchObject({
      offered: true,
      eligible: false,
      feeCents: 0,
    })
  })

  it('accepts, settles, receives, and dispatches one return receipt', () => {
    const accepted = acceptRegisteredReturnReceipt()
    expect(accepted.transaction.charge).toMatchObject({
      returnReceiptCents: 300,
      postageCents: 680,
      settlementDueCents: 680,
    })
    expect(accepted.state.returnReceipts[0]).toMatchObject({
      originalItemCode: 'XK00000000001',
      status: 'awaiting-return',
      feeCents: 300,
    })
    const receiptId = accepted.state.returnReceipts[0]!.id
    expect(() => recordReturnReceiptArrival(accepted.state, {
      receiptId,
      recipientSigner: '签收人甲',
      deliveredAt: '2026-08-05T09:00',
      receivedAt: '2026-08-06T10:00',
      operator: DEFAULT_SERVICE_OPERATOR,
      note: '',
    })).toThrow('原邮件结算后')

    const settled = settleServiceTransactions(accepted.state, {
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: '2026-08-04T01:05:00.000Z',
      amountReceivedCents: 700,
    })
    expect(() => recordReturnReceiptArrival(settled.state, {
      receiptId,
      recipientSigner: '签收人甲',
      deliveredAt: '2026-08-03T09:00',
      receivedAt: '2026-08-06T10:00',
      operator: DEFAULT_SERVICE_OPERATOR,
      note: '',
    })).toThrow('不得早于原邮件收寄日期')
    const received = recordReturnReceiptArrival(settled.state, {
      receiptId,
      recipientSigner: '签收人甲',
      deliveredAt: '2026-08-05T09:00',
      receivedAt: '2026-08-06T10:00',
      operator: DEFAULT_SERVICE_OPERATOR,
      note: '回执卡面完整',
    })
    expect(received.receipt).toMatchObject({
      status: 'received',
      recipientSigner: '签收人甲',
      receivedBy: DEFAULT_SERVICE_OPERATOR,
    })

    const dispatched = dispatchReturnReceipt(received.state, {
      receiptId,
      returnItemCode: 'XK00000000002',
      returnedAt: '2026-08-06T10:30',
      operator: DEFAULT_SERVICE_OPERATOR,
    })
    expect(dispatched.receipt).toMatchObject({
      status: 'returned',
      returnItemCode: 'XK00000000002',
      returnedBy: DEFAULT_SERVICE_OPERATOR,
    })
  })

  it('cancels an unfinished return receipt when its original mail is withdrawn', async () => {
    const accepted = acceptRegisteredReturnReceipt()
    const withdrawn = withdrawServiceTransactions(accepted.state, {
      transactionIds: [accepted.transaction.id],
      reason: '演示撤销',
      authorization: await createTestOnSiteAuthorization('withdraw-service-transaction'),
      withdrawnAt: '2026-08-04T01:10:00.000Z',
    })
    expect(withdrawn.state.returnReceipts[0]?.status).toBe('cancelled')
  })

  it('keeps the linked original number and route immutable during correction', () => {
    const accepted = acceptRegisteredReturnReceipt()
    const product = SERVICE_PRODUCTS.find((item) => item.id === 'registered-letter-200')!
    const changedDraft = {
      ...accepted.transaction.service,
      itemCode: 'XK00000000003',
    }
    expect(() => reviseServiceTransaction(accepted.state, {
      transactionId: accepted.transaction.id,
      correctedAt: '2026-08-04T01:05:00.000Z',
      reason: '演示查改',
      customer: accepted.transaction.customer,
      draft: changedDraft,
      charge: calculateServiceCharge(changedDraft, product),
      product,
    })).toThrow('原邮件号码不能在查改中修改')
  })

  it('does not allow a return receipt to be added after acceptance through correction', () => {
    const product = SERVICE_PRODUCTS.find((item) => item.id === 'registered-letter-200')!
    const draft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: product.id,
      itemCode: 'XK00000000005',
      weightGrams: 20,
    }
    const accepted = acceptServiceTransaction(createServiceSeedState(), {
      acceptedAt,
      charge: calculateServiceCharge(draft, product),
      customer: acceptRegisteredReturnReceipt().transaction.customer,
      draft,
      product,
      operator: DEFAULT_SERVICE_OPERATOR,
    })
    const changedDraft = {
      ...accepted.transaction.service,
      returnReceiptRequested: true,
    }

    expect(() => reviseServiceTransaction(accepted.state, {
      transactionId: accepted.transaction.id,
      correctedAt: '2026-08-04T01:05:00.000Z',
      reason: '演示查改',
      customer: accepted.transaction.customer,
      draft: changedDraft,
      charge: calculateServiceCharge(changedDraft, product),
      product,
    })).toThrow('回执只能随原邮件收寄办理')
  })
})
