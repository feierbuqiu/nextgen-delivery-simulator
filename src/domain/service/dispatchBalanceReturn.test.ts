import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createEmptyRecipient, createEmptySender } from '../customer/seed'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import {
  executeDispatchBalanceReturnCommand,
  queryDispatchBalanceLedger,
  queryExportedBagForInterchangeReturn,
  verifyExportedBagForInterchangeReturn,
} from './dispatchBalanceReturn'
import { queryDispatchMailStatus, queryUnhandedDispatchMail } from './dispatchInquiry'
import {
  executeDispatchRoutingCommand,
  queryUngeneratedDispatchBags,
} from './dispatchRouting'
import { calculateServiceCharge } from './policy'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import type { DispatchBagRecord, ServiceOperatorSnapshot } from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '990001',
  displayName: '林川',
  workstationCode: '01',
  acceptanceOffice: '长风支局',
  receivingOffice: '栖沄邮件处理中心',
  institutionCode: '99901001',
}

async function addSettledMail(
  repository: MemoryServiceRepository,
  acceptedAt: string,
  itemCode: string,
  weightGrams: number,
) {
  const product = SERVICE_PRODUCTS.find((candidate) => candidate.id === 'ordinary-letter-100')!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    destinationZone: 'nonlocal' as const,
    destinationOffice: '栖沄邮件处理中心',
    itemCode,
    weightGrams,
  }
  const accepted = await repository.accept({
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: { ...createEmptySender(), name: '演练寄件人' },
      recipient: { ...createEmptyRecipient(), name: '演练收件人' },
    },
    draft,
    product,
    operator,
  })
  await repository.settle({
    transactionIds: [accepted.transaction.id],
    tender: 'cash',
    settledAt: acceptedAt,
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  return accepted.transaction.id
}

function bagFor(transactionIds: string[]): DispatchBagRecord {
  return {
    id: 'ZB-20260810-000001',
    bagBarcode: '990101202608105010100000000001',
    manifestTypeCode: 'GNPCXH',
    manifestTypeName: '国内平函',
    bagBarcodeTypeCode: '411',
    bagBarcodeTypeName: '平信袋',
    receivingOfficeCode: '99101001',
    receivingOfficeName: '栖沄邮件处理中心',
    directSeal: false,
    consolidation: true,
    localTransfer: false,
    manifestNumber: '501',
    receptacleType: '1.袋',
    usesBarcodeContainer: false,
    containerBarcode: '',
    rfidBagTagNumber: '',
    shift: '01',
    mailReferences: transactionIds.map((transactionId) => ({
      kind: 'transaction' as const,
      transactionId,
    })),
    totalItems: transactionIds.length,
    mailWeightGrams: 50,
    emptyBagWeightGrams: 5,
    generatedAt: '2026-08-10T10:00:00.000+10:00',
    generatedBy: operator,
    tagPrintDecision: 'skipped',
    tagPrintedAt: null,
    sealingStatus: 'sealed',
    cancelledAt: null,
    cancelledBy: null,
  }
}

describe('dispatch balance ledger and interchange return', () => {
  it('returns an exported bag to sealed status, excludes the problem mail and supports re-export', async () => {
    const repository = MemoryServiceRepository.create()
    const keptTransactionId = await addSettledMail(
      repository,
      '2026-08-10T09:00:00.000+10:00',
      'RA12345678901',
      20,
    )
    const removedTransactionId = await addSettledMail(
      repository,
      '2026-08-10T09:05:00.000+10:00',
      'RA12345678902',
      30,
    )
    const state = await repository.load()
    await repository.restore({
      ...state,
      dispatchBags: [bagFor([keptTransactionId, removedTransactionId])],
    })
    const routed = await repository.executeDispatchRouting({
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-10',
      generatedAt: '2026-08-10T11:00:00.000+10:00',
      operator,
    })
    const route = routed.routes.find((candidate) => candidate.kind === 'route')!
    const exported = await repository.executeDispatchRouting({
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: 'PCD-20260810-A01',
      authorization: await createTestOnSiteAuthorization('export-dispatch-trip', operator.operatorId),
      exportedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    })
    const candidate = queryExportedBagForInterchangeReturn(exported.state, {
      bagBarcode: '990101202608105010100000000001',
      sealingDate: '2026-08-10',
    })!

    expect(candidate.mails).toHaveLength(2)
    expect(queryExportedBagForInterchangeReturn(exported.state, {
      bagBarcode: candidate.bag.bagBarcode,
      sealingDate: '2026-08-10',
    }, '99902001')).toBeNull()
    expect(() => verifyExportedBagForInterchangeReturn(
      exported.state,
      candidate.bag.id,
      '99902001',
    )).toThrow('不属于当前经办机构')
    expect(() => executeDispatchBalanceReturnCommand(exported.state, {
      type: 'return-dispatch-bag-to-interchange',
      bagId: candidate.bag.id,
      keptMailReferenceKeys: [candidate.mails[0]!.key],
      emptyBagWeightGrams: 5,
      bagTotalWeightGrams: 25,
      shift: '02',
      returnedAt: '2026-08-11T08:00:00.000+10:00',
      operator: { ...operator, institutionCode: '99902001' },
    })).toThrow('不属于当前经办机构')
    expect(verifyExportedBagForInterchangeReturn(exported.state, candidate.bag.id))
      .toMatchObject({ totalItems: 2, mailWeightGrams: 50, bagTotalWeightGrams: 55 })
    expect(() => executeDispatchBalanceReturnCommand(exported.state, {
      type: 'return-dispatch-bag-to-interchange',
      bagId: candidate.bag.id,
      keptMailReferenceKeys: candidate.mails.map((mail) => mail.key),
      emptyBagWeightGrams: 5,
      bagTotalWeightGrams: 55,
      shift: '02',
      returnedAt: '2026-08-11T08:00:00.000+10:00',
      operator,
    })).toThrow('请至少剔除一件问题邮件')
    expect(() => executeDispatchBalanceReturnCommand(exported.state, {
      type: 'return-dispatch-bag-to-interchange',
      bagId: candidate.bag.id,
      keptMailReferenceKeys: [candidate.mails[0]!.key],
      emptyBagWeightGrams: 5,
      bagTotalWeightGrams: 24,
      shift: '02',
      returnedAt: '2026-08-11T08:00:00.000+10:00',
      operator,
    })).toThrow('总包重量必须等于邮件重量与空袋重量之和')

    const returned = executeDispatchBalanceReturnCommand(exported.state, {
      type: 'return-dispatch-bag-to-interchange',
      bagId: candidate.bag.id,
      keptMailReferenceKeys: [candidate.mails[0]!.key],
      emptyBagWeightGrams: 5,
      bagTotalWeightGrams: 25,
      shift: '02',
      returnedAt: '2026-08-11T08:00:00.000+10:00',
      operator,
    })

    expect(returned.bag).toMatchObject({
      sealingStatus: 'sealed',
      totalItems: 1,
      mailWeightGrams: 20,
      emptyBagWeightGrams: 5,
      shift: '02',
      generatedAt: '2026-08-11T08:00:00.000+10:00',
    })
    expect(returned.record).toMatchObject({
      previousRouteId: route.id,
      previousTotalItems: 2,
      totalItems: 1,
      removedMailReferences: [{ transactionId: removedTransactionId }],
    })
    expect(returned.state.dispatchRoutes.filter((candidateRoute) =>
      candidateRoute.deletedAt === null)).toEqual([])
    expect(queryExportedBagForInterchangeReturn(returned.state, {
      bagBarcode: returned.bag.bagBarcode,
      sealingDate: '2026-08-11',
    })).toBeNull()
    expect(queryUngeneratedDispatchBags(returned.state, {
      routeCode: 'SIM-A01',
      shift: '02',
      sealingDate: '2026-08-11',
    }).eligibleBags).toMatchObject([{ id: returned.bag.id }])
    expect(queryDispatchMailStatus(returned.state, {
      acceptedDate: '2026-08-10',
      itemNumber: 'RA12345678901',
    })[0]?.currentStatus).toBe('已封发')
    expect(queryUnhandedDispatchMail(returned.state, {
      acceptedDateFrom: '2026-08-10',
      acceptedDateTo: '2026-08-10',
    })).toMatchObject([{ itemNumber: 'RA12345678902' }])

    const rerouted = executeDispatchRoutingCommand(returned.state, {
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-A01',
      shift: '02',
      sealingDate: '2026-08-11',
      generatedAt: '2026-08-11T09:00:00.000+10:00',
      operator,
    })
    const reroute = rerouted.routes.find((candidateRoute) => candidateRoute.kind === 'route')!
    const reexported = executeDispatchRoutingCommand(rerouted.state, {
      type: 'export-dispatch-routes',
      routeIds: [reroute.id],
      exportDate: '2026-08-11',
      dispatchOrderNumber: 'PCD-20260811-A01',
      authorization: await createTestOnSiteAuthorization('export-dispatch-trip', operator.operatorId),
      exportedAt: '2026-08-11T10:00:00.000+10:00',
      operator,
    })
    const ledger = queryDispatchBalanceLedger(reexported.state, {
      institutionCode: '99901001',
      institutionName: '长风支局',
      acceptedDateFrom: '2026-08-10',
      acceptedDateTo: '2026-08-11',
    })
    expect(ledger).toEqual([
      {
        statisticsDate: '2026-08-10',
        localAcceptedItems: 2,
        totalSealedItems: 2,
        sealedForOtherOfficeItems: 0,
        exportedLocalItems: 2,
        exportedForOtherOfficeItems: 0,
      },
      {
        statisticsDate: '2026-08-11',
        localAcceptedItems: 0,
        totalSealedItems: 1,
        sealedForOtherOfficeItems: 0,
        exportedLocalItems: 1,
        exportedForOtherOfficeItems: 0,
      },
    ])
  })

  it('rejects a total bag that has not been exported', () => {
    const state = {
      ...createServiceSeedState(),
      dispatchBags: [bagFor(['JY-20260810-000001'])],
    }
    expect(() => executeDispatchBalanceReturnCommand(state, {
      type: 'return-dispatch-bag-to-interchange',
      bagId: 'ZB-20260810-000001',
      keptMailReferenceKeys: ['transaction:JY-20260810-000001'],
      emptyBagWeightGrams: 5,
      bagTotalWeightGrams: 55,
      shift: '01',
      returnedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    })).toThrow('尚未出口')
  })
})
