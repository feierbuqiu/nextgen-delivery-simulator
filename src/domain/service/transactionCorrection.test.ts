import { describe, expect, it } from 'vitest'

import { DEMO_MANAGEMENT_OPERATOR_ID } from '../access/seed'
import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { calculateServiceCharge } from './policy'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import {
  queryServiceTransactions,
  recordServiceDocumentAction,
  reviseServiceTransaction,
  withdrawServiceTransactions,
} from './transactionCorrection'
import { acceptServiceTransaction, settleServiceTransactions } from './transactions'
import type {
  ServiceCustomerSnapshot,
  ServiceDestinationZone,
  ServiceDraft,
  ServiceProduct,
  ServiceTransactionQuery,
  ServiceWorkspaceState,
} from './types'

const CUSTOMER: ServiceCustomerSnapshot = {
  productFamily: 'basic-letter',
  destinationRegion: 'domestic',
  sender: {
    agreementAccountId: null,
    agreementAccountName: '',
    contact: '10000000001',
    name: '演示寄件人',
      detailedAddress: '瀚原省栖沄市景麓区新程路 1 号',
    unit: '',
      postalCode: '110022',
    identityType: '',
    identityValue: '',
    gender: '',
  },
  recipient: {
    contact: '10000000002',
    name: '演示收件人',
      detailedAddress: '澄岐省澄野市江洲区远帆路 2 号',
    unit: '',
      postalCode: '120023',
  },
}

function draftFor(
  product: ServiceProduct,
  itemCode: string,
  destinationZone: ServiceDestinationZone = product.destinationZones[0] ?? 'local',
): ServiceDraft {
  return {
    ...createEmptyServiceDraft(false, destinationZone),
    productId: product.id,
    itemCode,
    weightGrams: 20,
  }
}

function accept(
  state: ServiceWorkspaceState,
  product: ServiceProduct,
  itemCode: string,
  acceptedAt: string,
  destinationZone?: ServiceDestinationZone,
) {
  const draft = draftFor(product, itemCode, destinationZone)
  return acceptServiceTransaction(state, {
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: CUSTOMER,
    draft,
    product,
  })
}

function query(patch: Partial<ServiceTransactionQuery> = {}): ServiceTransactionQuery {
  return {
    querySerial: '',
    productCode: '',
    itemCode: '',
    paymentMethod: '',
    operatorId: '',
    workstationCode: '',
    dataType: 'all',
    acceptedDateFrom: '2026-01-15',
    acceptedDateTo: '2026-01-15',
    settledDateFrom: '',
    settledDateTo: '',
    sort: 'accepted-desc',
    ...patch,
  }
}

describe('service transaction query and correction', () => {
  it('filters by three-digit products or six-digit derived business codes', () => {
    const product = SERVICE_PRODUCTS.find((item) => item.searchCode === '107')!
    const first = accept(
      createServiceSeedState(),
      product,
      '7000818316568',
      '2026-01-15T09:20:00.000Z',
    )
    const second = accept(
      first.state,
      product,
      '7000818316576',
      '2026-01-15T10:20:00.000Z',
      'nonlocal',
    )
    const settled = settleServiceTransactions(second.state, {
      transactionIds: [first.transaction.id],
      tender: 'cash',
      settledAt: '2026-01-15T10:30:00.000Z',
      amountReceivedCents: first.transaction.charge.settlementDueCents,
    })

    expect(queryServiceTransactions(settled.state, query()).map((item) => item.id)).toEqual([
      second.transaction.id,
      first.transaction.id,
    ])
    expect(queryServiceTransactions(settled.state, query({ productCode: '107000' }))).toHaveLength(1)
    expect(queryServiceTransactions(settled.state, query({ productCode: '107100' }))).toHaveLength(1)
    expect(queryServiceTransactions(settled.state, query({ productCode: '107' }))).toHaveLength(2)
    expect(queryServiceTransactions(settled.state, query({ itemCode: '6576' }))[0]?.id).toBe(second.transaction.id)
    expect(queryServiceTransactions(settled.state, query({ operatorId: '80000001' }))).toHaveLength(2)
    expect(queryServiceTransactions(settled.state, query({ workstationCode: '01' }))).toHaveLength(2)
    expect(queryServiceTransactions(settled.state, query({ dataType: 'settled' }))[0]?.id).toBe(first.transaction.id)
    expect(queryServiceTransactions(settled.state, query({
      settledDateFrom: '2026-01-15',
      settledDateTo: '2026-01-15',
    }))).toHaveLength(1)
  })

  it('requires a reason and preserves before-and-after snapshots for correction', () => {
    const product = SERVICE_PRODUCTS[0]!
    const accepted = accept(
      createServiceSeedState(),
      product,
      '7000818316568',
      '2026-01-15T09:20:00.000Z',
    )
    const correctedCustomer = structuredClone(CUSTOMER)
    correctedCustomer.recipient.name = '查改后收件人'
    const correctedDraft = { ...accepted.transaction.service, operatorNote: '核对地址后修改' }

    expect(() => reviseServiceTransaction(accepted.state, {
      transactionId: accepted.transaction.id,
      correctedAt: '2026-01-15T10:00:00.000Z',
      reason: '   ',
      customer: correctedCustomer,
      draft: correctedDraft,
      charge: accepted.transaction.charge,
      product,
    })).toThrow('请输入修改邮件原因')

    expect(() => reviseServiceTransaction(accepted.state, {
      transactionId: accepted.transaction.id,
      correctedAt: '2026-01-15T10:00:00.000Z',
      reason: '错误计费测试',
      customer: correctedCustomer,
      draft: correctedDraft,
      charge: {
        ...accepted.transaction.charge,
        postageCents: accepted.transaction.charge.postageCents + 1,
      },
      product,
    })).toThrow('查改计费结果与业务规则不一致')

    const revised = reviseServiceTransaction(accepted.state, {
      transactionId: accepted.transaction.id,
      correctedAt: '2026-01-15T10:00:00.000Z',
      reason: '客户核对后更正',
      customer: correctedCustomer,
      draft: correctedDraft,
      charge: accepted.transaction.charge,
      product,
    })

    expect(revised.transaction.customer.recipient.name).toBe('查改后收件人')
    expect(revised.correction).toMatchObject({
      id: 'XG-20260115-000001',
      reason: '客户核对后更正',
      previousCustomer: { recipient: { name: '演示收件人' } },
      correctedCustomer: { recipient: { name: '查改后收件人' } },
    })
    expect(revised.state.nextCorrectionSequence).toBe(2)
  })

  it('blocks a price-changing correction after settlement', () => {
    const product = SERVICE_PRODUCTS[0]!
    const accepted = accept(
      createServiceSeedState(),
      product,
      '7000818316568',
      '2026-01-15T09:20:00.000Z',
    )
    const settled = settleServiceTransactions(accepted.state, {
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: '2026-01-15T09:30:00.000Z',
      amountReceivedCents: 80,
    })
    const heavierDraft = { ...accepted.transaction.service, weightGrams: 40 }

    expect(() => reviseServiceTransaction(settled.state, {
      transactionId: accepted.transaction.id,
      correctedAt: '2026-01-15T10:00:00.000Z',
      reason: '重新称重',
      customer: CUSTOMER,
      draft: heavierDraft,
      charge: calculateServiceCharge(heavierDraft, product),
      product,
    })).toThrow('已结算邮件暂不允许修改影响资费或结算金额的字段')
  })

  it('requires a real-account authorization and creates original-route refund audit records', async () => {
    const product = SERVICE_PRODUCTS[0]!
    const accepted = accept(
      createServiceSeedState(),
      product,
      '7000818316568',
      '2026-01-15T09:20:00.000Z',
    )
    const settled = settleServiceTransactions(accepted.state, {
      transactionIds: [accepted.transaction.id],
      tender: 'third-party',
      settledAt: '2026-01-15T09:30:00.000Z',
      amountReceivedCents: 80,
    })

    expect(() => withdrawServiceTransactions(settled.state, {
      transactionIds: [accepted.transaction.id],
      withdrawnAt: '2026-01-15T10:00:00.000Z',
      reason: '客户申请撤销',
      authorization: undefined!,
    })).toThrow('真实账号现场授权')

    const authorization = await createTestOnSiteAuthorization('withdraw-service-transaction')
    const withdrawn = withdrawServiceTransactions(settled.state, {
      transactionIds: [accepted.transaction.id],
      withdrawnAt: '2026-01-15T10:00:00.000Z',
      reason: '客户申请撤销',
      authorization,
    })
    expect(withdrawn.state.transactions[0]?.status).toBe('withdrawn')
    expect(withdrawn.withdrawals[0]).toMatchObject({
      id: 'CX-20260115-000001',
      reason: '客户申请撤销',
      authorizedBy: DEMO_MANAGEMENT_OPERATOR_ID,
    })
    expect(withdrawn.refunds[0]).toMatchObject({
      id: 'TK-20260115-000001',
      amountCents: 80,
      originalTender: 'third-party',
      route: 'original-payment',
      status: 'application-required',
      requestedAt: null,
    })
  })

  it('keeps batch withdrawal atomic and records document actions separately', async () => {
    const product = SERVICE_PRODUCTS[0]!
    const first = accept(
      createServiceSeedState(),
      product,
      '7000818316568',
      '2026-01-15T09:20:00.000Z',
    )
    const second = accept(
      first.state,
      product,
      '7000818316576',
      '2026-01-15T09:21:00.000Z',
    )
    const authorization = await createTestOnSiteAuthorization('withdraw-service-transaction')

    expect(() => withdrawServiceTransactions(second.state, {
      transactionIds: [first.transaction.id, 'missing-id'],
      withdrawnAt: '2026-01-15T10:00:00.000Z',
      reason: '批量撤销',
      authorization,
    })).toThrow('未找到收寄记录')
    expect(second.state.transactions.every((transaction) => transaction.status === 'pending-settlement')).toBe(true)

    const recorded = recordServiceDocumentAction(second.state, {
      transactionId: second.transaction.id,
      kind: 'receipt-reprint',
      requestedAt: '2026-01-15T10:05:00.000Z',
    })
    expect(recorded.action).toMatchObject({
      id: 'DJ-20260115-000001',
      transactionId: second.transaction.id,
      kind: 'receipt-reprint',
    })
    const reinvoiced = recordServiceDocumentAction(recorded.state, {
      transactionId: second.transaction.id,
      kind: 'invoice-reissue',
      requestedAt: '2026-01-15T10:06:00.000Z',
    })
    expect(reinvoiced.action).toMatchObject({
      id: 'DJ-20260115-000002',
      kind: 'invoice-reissue',
    })
    expect(reinvoiced.state.documentActions).toHaveLength(2)
  })
})
