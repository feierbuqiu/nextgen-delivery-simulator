import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { calculateServiceCharge } from './policy'
import {
  completeThirdPartyRefund,
  requestThirdPartyRefund,
  thirdPartyPaymentRows,
} from './refundPending'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import { withdrawServiceTransactions } from './transactionCorrection'
import {
  acceptServiceTransaction,
  DEFAULT_SERVICE_OPERATOR,
  settleServiceTransactions,
} from './transactions'

async function createWithdrawnThirdPartyState() {
  const product = SERVICE_PRODUCTS.find((item) => item.searchCode === '107')!
  const draft = {
    ...createEmptyServiceDraft(false, 'local'),
    productId: product.id,
    itemCode: '7000818316568',
    weightGrams: 20,
  }
  const accepted = acceptServiceTransaction(createServiceSeedState(), {
    acceptedAt: '2026-01-15T09:20:00.000Z',
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: {
        agreementAccountId: null,
        agreementAccountName: '',
        contact: '10000000001',
        name: '演示寄件人',
        detailedAddress: '澜京市栖台区练习路 1 号',
        unit: '',
        postalCode: '',
        identityType: '',
        identityValue: '',
        gender: '',
      },
      recipient: {
        contact: '10000000002',
        name: '演示收件人',
        detailedAddress: '澄岐省澄野市江洲区模拟路 2 号',
        unit: '',
        postalCode: '',
      },
    },
    draft,
    product,
    operator: DEFAULT_SERVICE_OPERATOR,
  })
  const settled = settleServiceTransactions(accepted.state, {
    transactionIds: [accepted.transaction.id],
    tender: 'third-party',
    settledAt: '2026-01-15T09:30:00.000Z',
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  return withdrawServiceTransactions(settled.state, {
    transactionIds: [accepted.transaction.id],
    withdrawnAt: '2026-01-15T10:00:00.000Z',
    reason: '客户申请撤销',
    authorization: await createTestOnSiteAuthorization('withdraw-service-transaction'),
  })
}

describe('third-party refund pending flow', () => {
  it('moves from payment status request to pending refund and completed refund', async () => {
    const withdrawn = await createWithdrawnThirdPartyState()
    const refund = withdrawn.refunds[0]!
    expect(refund).toMatchObject({
      route: 'original-payment',
      status: 'application-required',
      requestedAt: null,
    })
    expect(thirdPartyPaymentRows(withdrawn.state)).toHaveLength(1)
    const preRequestAuthorization = await createTestOnSiteAuthorization('complete-third-party-refund')
    expect(() => completeThirdPartyRefund(withdrawn.state, {
      refundId: refund.id,
      processedAt: '2026-01-15T10:02:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
      authorization: preRequestAuthorization,
    })).toThrow('请先从支付状态查询发起退款申请')

    const requested = requestThirdPartyRefund(withdrawn.state, {
      refundId: refund.id,
      requestedAt: '2026-01-15T10:01:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
    })
    expect(requested.refund).toMatchObject({
      status: 'pending',
      requestedAt: '2026-01-15T10:01:00.000Z',
      requestedBy: DEFAULT_SERVICE_OPERATOR,
    })
    expect(() => requestThirdPartyRefund(requested.state, {
      refundId: refund.id,
      requestedAt: '2026-01-15T10:02:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
    })).toThrow('不能重复申请')
    expect(() => completeThirdPartyRefund(requested.state, {
      refundId: refund.id,
      processedAt: '2026-01-15T10:02:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
      authorization: undefined!,
    })).toThrow('真实账号现场授权')

    const completionAuthorization = await createTestOnSiteAuthorization('complete-third-party-refund')
    const completed = completeThirdPartyRefund(requested.state, {
      refundId: refund.id,
      processedAt: '2026-01-15T10:02:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
      authorization: completionAuthorization,
    })
    expect(completed.refund).toMatchObject({
      status: 'refunded',
      processedAt: '2026-01-15T10:02:00.000Z',
      processedBy: DEFAULT_SERVICE_OPERATOR,
      platformRefundId: 'MN-TK-20260115-000001',
    })
    const repeatedAuthorization = await createTestOnSiteAuthorization(
      'complete-third-party-refund',
    )
    expect(() => completeThirdPartyRefund(completed.state, {
      refundId: refund.id,
      processedAt: '2026-01-15T10:03:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
      authorization: repeatedAuthorization,
    })).toThrow('不允许再次退款')
  })

  it('rejects an application time before the withdrawal generated the record', async () => {
    const withdrawn = await createWithdrawnThirdPartyState()
    expect(() => requestThirdPartyRefund(withdrawn.state, {
      refundId: withdrawn.refunds[0]!.id,
      requestedAt: '2026-01-15T09:59:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
    })).toThrow('不得早于退款记录生成时间')
  })
})
