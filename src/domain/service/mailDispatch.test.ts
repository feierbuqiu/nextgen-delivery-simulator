import { describe, expect, it } from 'vitest'

import {
  createTestInternalHandoverAuthorization,
  createTestOnSiteAuthorization,
} from '../../test/workAuthorization'
import { createEmptyRecipient, createEmptySender } from '../customer/seed'
import {
  executeMailDispatchCommand,
  queryLooseMailForHandover,
  queryLooseMailForReceipt,
  type LooseMailDispatchQuery,
} from './mailDispatch'
import { queryAvailableUnsealedMail } from './mailSealing'
import { calculateServiceCharge } from './policy'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import { acceptServiceTransaction, settleServiceTransactions } from './transactions'
import {
  withdrawServiceTransactions,
} from './transactionCorrection'
import type { ServiceOperatorSnapshot, ServiceWorkspaceState } from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '林青禾',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '栖沄处理中心',
  institutionCode: '99901001',
}

const baseQuery: LooseMailDispatchQuery = {
  status: 'not-handed-over',
  productTerm: '',
  note: '',
  acceptedDateFrom: '2026-08-10',
  acceptedDateTo: '2026-08-10',
}

function addRegisteredLetter(
  state: ServiceWorkspaceState,
  itemCode: string,
  acceptedAt: string,
  acceptedBy = operator,
): { state: ServiceWorkspaceState; transactionId: string } {
  const product = SERVICE_PRODUCTS.find((item) => item.id === 'registered-letter-200')!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    destinationZone: 'nonlocal' as const,
    itemCode,
    weightGrams: 20,
  }
  const accepted = acceptServiceTransaction(state, {
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: { ...createEmptySender(), name: '训练寄件人' },
      recipient: {
        ...createEmptyRecipient(),
        name: '训练收件人',
        detailedAddress: '瀚原省栖沄市景麓区演练路 8 号',
      },
    },
    draft,
    product,
    operator: acceptedBy,
  })
  return { state: accepted.state, transactionId: accepted.transaction.id }
}

function settledState(): { state: ServiceWorkspaceState; transactionIds: string[] } {
  const first = addRegisteredLetter(
    createServiceSeedState(),
    'RA12345678901',
    '2026-08-10T09:00:00.000Z',
  )
  const second = addRegisteredLetter(
    first.state,
    'RA12345678902',
    '2026-08-10T09:02:00.000Z',
  )
  const settled = settleServiceTransactions(second.state, {
    transactionIds: [first.transactionId, second.transactionId],
    tender: 'cash',
    settledAt: '2026-08-10T09:10:00.000Z',
    amountReceivedCents: second.state.transactions.reduce(
      (total, transaction) => total + transaction.charge.settlementDueCents,
      0,
    ),
  })
  return {
    state: settled.state,
    transactionIds: [first.transactionId, second.transactionId],
  }
}

describe('loose-mail handover and receipt', () => {
  it('only exposes settled mail that is ready to be handed over', () => {
    const first = addRegisteredLetter(
      createServiceSeedState(),
      'RA12345678901',
      '2026-08-10T09:00:00.000Z',
    )
    const second = addRegisteredLetter(
      first.state,
      'RA12345678902',
      '2026-08-10T09:02:00.000Z',
    )
    const settled = settleServiceTransactions(second.state, {
      transactionIds: [first.transactionId],
      tender: 'cash',
      settledAt: '2026-08-10T09:10:00.000Z',
      amountReceivedCents: second.state.transactions[0]!.charge.settlementDueCents,
    })

    expect(queryLooseMailForHandover(settled.state, baseQuery, '99901001')).toMatchObject([
      { transaction: { id: first.transactionId, status: 'settled' }, handover: null },
    ])
    expect(queryLooseMailForHandover(settled.state, {
      ...baseQuery,
      productTerm: '200100',
    }, '99901001')).toHaveLength(1)
  })

  it('isolates loose-mail queries and handover commands by origin institution', () => {
    const remoteOperator: ServiceOperatorSnapshot = {
      ...operator,
      operatorId: '82000001',
      displayName: '异地营业人员',
      acceptanceOffice: '澄野营业部',
      institutionCode: '99902001',
    }
    const local = addRegisteredLetter(
      createServiceSeedState(),
      'RA12345678901',
      '2026-08-10T09:00:00.000Z',
    )
    const remote = addRegisteredLetter(
      local.state,
      'RA12345678999',
      '2026-08-10T09:02:00.000Z',
      remoteOperator,
    )
    const settled = settleServiceTransactions(remote.state, {
      transactionIds: [local.transactionId, remote.transactionId],
      tender: 'cash',
      settledAt: '2026-08-10T09:10:00.000Z',
      amountReceivedCents: remote.state.transactions
        .filter((transaction) => [local.transactionId, remote.transactionId].includes(transaction.id))
        .reduce((total, transaction) => total + transaction.charge.settlementDueCents, 0),
    })

    expect(queryLooseMailForHandover(settled.state, baseQuery, '99901001')
      .map((row) => row.transaction.id)).toEqual([local.transactionId])
    expect(queryLooseMailForHandover(settled.state, baseQuery, '99902001')
      .map((row) => row.transaction.id)).toEqual([remote.transactionId])
    expect(() => executeMailDispatchCommand(settled.state, {
      type: 'hand-over-loose-mail',
      transactionIds: [remote.transactionId],
      scope: 'cross-office',
      receivingOfficeCode: '99101001',
      receivingOfficeName: '栖沄处理中心',
      receivingEmployeeId: '',
      receivingEmployeeName: '',
      originOfficeCode: '99901001',
      note: '',
      performedAt: '2026-08-10T09:20:00.000Z',
      operator,
    })).toThrow('不属于当前交出机构')
  })

  it('requires bound receiving-employee authorization for an internal handover', async () => {
    const fixture = settledState()
    const request = {
      type: 'hand-over-loose-mail' as const,
      transactionIds: [fixture.transactionIds[0]!],
      scope: 'internal' as const,
      receivingOfficeCode: '99901001',
      receivingOfficeName: '景麓营业部',
      receivingEmployeeId: '81000001',
      receivingEmployeeName: '演示柜员',
      originOfficeCode: '99901001',
      note: '平信组',
      performedAt: '2026-08-10T09:20:00.000Z',
      operator,
    }

    expect(() => executeMailDispatchCommand(fixture.state, request))
      .toThrow('真实账号现场确认')

    const result = executeMailDispatchCommand(fixture.state, {
      ...request,
      authorization: await createTestInternalHandoverAuthorization(),
    })
    expect(result.handovers[0]).toMatchObject({
      id: 'JJ-20260810-000001',
      scope: 'internal',
      status: 'received',
      receivingEmployeeId: '81000001',
      receivedBy: { operatorId: '81000001' },
    })
  })

  it('runs cross-office handover, direct-seal, receipt, return and re-handover eligibility', () => {
    const fixture = settledState()
    const handedOver = executeMailDispatchCommand(fixture.state, {
      type: 'hand-over-loose-mail',
      transactionIds: fixture.transactionIds,
      scope: 'cross-office',
      receivingOfficeCode: '99101001',
      receivingOfficeName: '栖沄处理中心',
      receivingEmployeeId: '',
      receivingEmployeeName: '',
      originOfficeCode: '99901001',
      note: '早班',
      performedAt: '2026-08-10T09:20:00.000Z',
      operator,
    })

    expect(queryLooseMailForHandover(handedOver.state, baseQuery, '99901001')).toEqual([])
    expect(queryLooseMailForReceipt(handedOver.state, {
      ...baseQuery,
      status: 'not-received',
    }, '99101001')).toHaveLength(2)

    const receivingOperator: ServiceOperatorSnapshot = {
      ...operator,
      acceptanceOffice: '栖沄处理中心',
      institutionCode: '99101001',
    }

    const direct = executeMailDispatchCommand(handedOver.state, {
      type: 'set-loose-mail-direct-seal',
      handoverIds: [handedOver.handovers[0]!.id],
      directSeal: true,
      receivingOfficeCode: '99101001',
      operator: receivingOperator,
    })
    expect(direct.handovers[0]?.directSeal).toBe(true)

    const received = executeMailDispatchCommand(direct.state, {
      type: 'receive-loose-mail',
      handoverIds: handedOver.handovers.map((record) => record.id),
      receivedAt: '2026-08-10T09:30:00.000Z',
      receivingOfficeCode: '99101001',
      operator: receivingOperator,
    })
    expect(received.handovers.every((record) => record.status === 'received')).toBe(true)

    const returned = executeMailDispatchCommand(received.state, {
      type: 'return-loose-mail',
      handoverIds: [received.handovers[0]!.id],
      returnedAt: '2026-08-10T09:40:00.000Z',
      receivingOfficeCode: '99101001',
      returnNote: '封面信息需复核',
      operator: receivingOperator,
    })
    expect(returned.handovers[0]).toMatchObject({
      status: 'returned',
      returnNote: '封面信息需复核',
    })
    expect(queryLooseMailForHandover(returned.state, baseQuery, '99901001'))
      .toMatchObject([{ transaction: { id: fixture.transactionIds[0] } }])
  })

  it('removes handed-over loose mail from sealing and withdrawal eligibility', async () => {
    const fixture = settledState()
    const transactionId = fixture.transactionIds[0]!
    const handedOver = executeMailDispatchCommand(fixture.state, {
      type: 'hand-over-loose-mail',
      transactionIds: [transactionId],
      scope: 'cross-office',
      receivingOfficeCode: '99101001',
      receivingOfficeName: '栖沄处理中心',
      receivingEmployeeId: '',
      receivingEmployeeName: '',
      originOfficeCode: '99901001',
      note: '早班',
      performedAt: '2026-08-10T09:20:00.000Z',
      operator,
    })

    expect(queryAvailableUnsealedMail(handedOver.state).some((item) =>
      item.reference.kind === 'transaction'
      && item.reference.transactionId === transactionId)).toBe(false)
    const authorization = await createTestOnSiteAuthorization('withdraw-service-transaction')
    expect(() => withdrawServiceTransactions(handedOver.state, {
      transactionIds: [transactionId],
      reason: '客户申请撤销',
      authorization,
      withdrawnAt: '2026-08-10T09:30:00.000Z',
      operator,
    })).toThrow(`已进入散件交接 ${handedOver.handovers[0]!.id}`)
  })

  it('allows changing the receiving office only before receipt', () => {
    const fixture = settledState()
    const handedOver = executeMailDispatchCommand(fixture.state, {
      type: 'hand-over-loose-mail',
      transactionIds: [fixture.transactionIds[0]!],
      scope: 'cross-office',
      receivingOfficeCode: '99101001',
      receivingOfficeName: '栖沄处理中心',
      receivingEmployeeId: '',
      receivingEmployeeName: '',
      originOfficeCode: '99901001',
      note: '',
      performedAt: '2026-08-10T09:20:00.000Z',
      operator,
    })
    const changed = executeMailDispatchCommand(handedOver.state, {
      type: 'change-loose-mail-receiving-office',
      handoverIds: [handedOver.handovers[0]!.id],
      receivingOfficeCode: '99102001',
      receivingOfficeName: '澄野转运中心',
      originOfficeCode: '99901001',
      operator,
    })
    expect(changed.handovers[0]).toMatchObject({ receivingOfficeCode: '99102001' })

    const received = executeMailDispatchCommand(changed.state, {
      type: 'receive-loose-mail',
      handoverIds: [changed.handovers[0]!.id],
      receivedAt: '2026-08-10T09:30:00.000Z',
      receivingOfficeCode: '99102001',
      operator: {
        ...operator,
        acceptanceOffice: '澄野转运中心',
        institutionCode: '99102001',
      },
    })
    expect(() => executeMailDispatchCommand(received.state, {
      type: 'change-loose-mail-receiving-office',
      handoverIds: [changed.handovers[0]!.id],
      receivingOfficeCode: '99103001',
      receivingOfficeName: '镜海埠互换中心',
      originOfficeCode: '99901001',
      operator,
    })).toThrow('不能更改接收机构')
  })
})
