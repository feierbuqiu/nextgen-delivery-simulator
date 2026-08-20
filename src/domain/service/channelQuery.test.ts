import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createEmptyRecipient, createEmptySender } from '../customer/seed'
import {
  parseMailTrackingNumbers,
  queryAcceptedMail,
  queryFrontDeskLogs,
  queryMailTracking,
  queryThirdPartyPayments,
  validateDateRange,
  type AcceptedMailQuery,
} from './channelQuery'
import { calculateServiceCharge } from './policy'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import {
  reviseServiceTransaction,
  withdrawServiceTransactions,
} from './transactionCorrection'
import {
  acceptServiceTransaction,
  DEFAULT_SERVICE_OPERATOR,
  settleServiceTransactions,
} from './transactions'
import type {
  ServiceCustomerSnapshot,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from './types'

const SECOND_OPERATOR: ServiceOperatorSnapshot = {
  ...DEFAULT_SERVICE_OPERATOR,
  operatorId: '80000002',
  displayName: '查询测试员',
  workstationCode: '02',
}

function customer(
  senderName: string,
  recipientName: string,
  agreementAccountId: string | null = null,
): ServiceCustomerSnapshot {
  return {
    productFamily: 'standard-delivery',
    destinationRegion: 'domestic',
    sender: {
      ...createEmptySender(),
      agreementAccountId,
      agreementAccountName: agreementAccountId ? '星河协议客户' : '',
      contact: '10000000001',
      name: senderName,
      detailedAddress: '瀚原省栖沄市景麓区示范路 1 号',
      identityType: 'primary',
      identityValue: '990101199001010035',
    },
    recipient: {
      ...createEmptyRecipient(),
      contact: '10000000002',
      name: recipientName,
      detailedAddress: '澄岐省澄野市江洲区模拟路 2 号',
    },
  }
}

function acceptRegisteredMail(
  state: ServiceWorkspaceState,
  itemCode: string,
  acceptedAt: string,
  operator: ServiceOperatorSnapshot,
  senderName: string,
  recipientName: string,
) {
  const product = SERVICE_PRODUCTS.find((item) => item.searchCode === '200')!
  const draft = {
    ...createEmptyServiceDraft(false, 'local'),
    productId: product.id,
    itemCode,
    weightGrams: 20,
    destinationOffice: '云州中心局',
  }
  return acceptServiceTransaction(state, {
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: customer(senderName, recipientName),
    draft,
    operator,
    product,
  })
}

function acceptedMailQuery(patch: Partial<AcceptedMailQuery> = {}): AcceptedMailQuery {
  return {
    querySerial: '',
    product: '',
    itemCode: '',
    operatorId: '',
    senderName: '',
    recipientName: '',
    workstationCode: '',
    destinationOffice: '',
    agreementAccountId: '',
    acceptedDateFrom: '2026-01-01',
    acceptedDateTo: '2026-03-31',
    ...patch,
  }
}

describe('Chapter 3.8 channel queries', () => {
  it('returns only third-party settlements and applies status, date, operator and workstation filters', () => {
    const first = acceptRegisteredMail(
      createServiceSeedState(),
      'RR47312482901',
      '2026-01-15T09:20:00.000Z',
      DEFAULT_SERVICE_OPERATOR,
      '周清禾',
      '林远川',
    )
    const second = acceptRegisteredMail(
      first.state,
      'RR47312482902',
      '2026-01-15T09:25:00.000Z',
      SECOND_OPERATOR,
      '顾云舟',
      '沈星河',
    )
    const thirdParty = settleServiceTransactions(second.state, {
      transactionIds: [first.transaction.id],
      tender: 'third-party',
      settledAt: '2026-01-15T09:30:00.000Z',
      amountReceivedCents: first.transaction.charge.settlementDueCents,
    })
    const settled = settleServiceTransactions(thirdParty.state, {
      transactionIds: [second.transaction.id],
      tender: 'cash',
      settledAt: '2026-01-15T09:35:00.000Z',
      amountReceivedCents: second.transaction.charge.settlementDueCents,
    })

    const rows = queryThirdPartyPayments(settled.state, {
      status: 'successful',
      paidDateFrom: '2026-01-15',
      paidDateTo: '2026-01-15',
      operatorId: '80000001',
      workstationCode: '01',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.transaction.id).toBe(first.transaction.id)
    expect(rows[0]?.settlement.tender).toBe('third-party')
    expect(queryThirdPartyPayments(settled.state, {
      status: 'all',
      paidDateFrom: '2026-01-16',
      paidDateTo: '2026-01-16',
      operatorId: '',
      workstationCode: '',
    })).toEqual([])
  })

  it('combines correction and deletion records in the front-desk log with the acting employee and reason', async () => {
    const first = acceptRegisteredMail(
      createServiceSeedState(),
      'RR47312482901',
      '2026-01-15T09:20:00.000Z',
      DEFAULT_SERVICE_OPERATOR,
      '周清禾',
      '林远川',
    )
    const second = acceptRegisteredMail(
      first.state,
      'RR47312482902',
      '2026-01-15T09:25:00.000Z',
      DEFAULT_SERVICE_OPERATOR,
      '顾云舟',
      '沈星河',
    )
    const product = SERVICE_PRODUCTS.find((item) => item.searchCode === '200')!
    const revisedDraft = {
      ...first.transaction.service,
      destinationOffice: '云州交换站',
    }
    const revised = reviseServiceTransaction(second.state, {
      transactionId: first.transaction.id,
      correctedAt: '2026-01-15T10:00:00.000Z',
      operator: SECOND_OPERATOR,
      reason: '寄达局录入更正',
      customer: first.transaction.customer,
      draft: revisedDraft,
      charge: calculateServiceCharge(revisedDraft, product),
      product,
    })
    const withdrawn = withdrawServiceTransactions(revised.state, {
      transactionIds: [second.transaction.id],
      withdrawnAt: '2026-01-15T10:05:00.000Z',
      operator: SECOND_OPERATOR,
      reason: '客户撤回交寄',
      authorization: await createTestOnSiteAuthorization(
        'withdraw-service-transaction',
        SECOND_OPERATOR.operatorId,
      ),
    })

    const rows = queryFrontDeskLogs(withdrawn.state, {
      operation: 'all',
      product: '200',
      operatorId: SECOND_OPERATOR.operatorId,
      workstationCode: SECOND_OPERATOR.workstationCode,
      operatedDateFrom: '2026-01-15',
      operatedDateTo: '2026-01-15',
    })
    expect(rows.map((row) => row.operation)).toEqual(['withdrawal', 'correction'])
    expect(rows.map((row) => row.reason)).toEqual(['客户撤回交寄', '寄达局录入更正'])
    expect(rows.every((row) => row.operator.operatorId === SECOND_OPERATOR.operatorId)).toBe(true)
  })

  it('parses multiple mail numbers and builds an ordered local tracking timeline', () => {
    expect(parseMailTrackingNumbers('rr47312482902, RR47312482901  rr47312482902')).toEqual([
      'RR47312482902',
      'RR47312482901',
    ])
    const first = acceptRegisteredMail(
      createServiceSeedState(),
      'RR47312482901',
      '2026-01-15T09:20:00.000Z',
      DEFAULT_SERVICE_OPERATOR,
      '周清禾',
      '林远川',
    )
    const second = acceptRegisteredMail(
      first.state,
      'RR47312482902',
      '2026-01-15T09:25:00.000Z',
      DEFAULT_SERVICE_OPERATOR,
      '顾云舟',
      '沈星河',
    )
    const product = SERVICE_PRODUCTS.find((item) => item.searchCode === '200')!
    const revised = reviseServiceTransaction(second.state, {
      transactionId: first.transaction.id,
      correctedAt: '2026-01-15T10:00:00.000Z',
      reason: '收件人核对后更正',
      customer: first.transaction.customer,
      draft: first.transaction.service,
      charge: first.transaction.charge,
      product,
    })

    const rows = queryMailTracking(
      revised.state,
      'rr47312482902, RR47312482901  rr47312482902',
    )
    expect(rows.map((row) => row.transaction.service.itemCode)).toEqual([
      'RR47312482902',
      'RR47312482901',
    ])
    expect(rows[0]?.events.map((item) => item.kind)).toEqual(['acceptance'])
    expect(rows[1]?.events.map((item) => item.kind)).toEqual(['correction', 'acceptance'])
    expect(rows[1]?.events[0]?.description).toContain('收件人核对后更正')
    expect(() => queryMailTracking(revised.state, '   ')).toThrow('请输入一个或多个邮件号码')
  })

  it('filters accepted mail across documented fields and enforces the three-month date limit', () => {
    const first = acceptRegisteredMail(
      createServiceSeedState(),
      'RR47312482901',
      '2026-01-15T09:20:00.000Z',
      DEFAULT_SERVICE_OPERATOR,
      '周清禾',
      '林远川',
    )
    const second = acceptRegisteredMail(
      first.state,
      'RR47312482902',
      '2026-02-16T09:25:00.000Z',
      SECOND_OPERATOR,
      '顾云舟',
      '沈星河',
    )

    expect(queryAcceptedMail(second.state, acceptedMailQuery({
      product: '给据信函 200',
      itemCode: '82902',
      operatorId: '80000002',
      senderName: '顾云舟',
      recipientName: '沈星河',
      workstationCode: '02',
      destinationOffice: '云州',
    })).map((item) => item.id)).toEqual([second.transaction.id])
    expect(queryAcceptedMail(second.state, acceptedMailQuery({
      querySerial: first.transaction.id.slice(-6),
    })).map((item) => item.id)).toEqual([first.transaction.id])

    expect(() => validateDateRange('2026-01-01', '2026-04-01', 3)).toThrow(
      '一次只能查询 3 个月范围内的信息',
    )
    expect(() => queryAcceptedMail(second.state, acceptedMailQuery({
      acceptedDateFrom: '2026-03-01',
      acceptedDateTo: '2026-02-01',
    }))).toThrow('查询开始日期不得晚于结束日期')
  })
})
