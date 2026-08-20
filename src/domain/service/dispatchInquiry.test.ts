import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createEmptyRecipient, createEmptySender } from '../customer/seed'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import {
  queryDispatchBagExportTimes,
  queryDispatchMailStatus,
  queryUnhandedDispatchMail,
} from './dispatchInquiry'
import { executeDispatchRoutingCommand } from './dispatchRouting'
import { calculateServiceCharge } from './policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from './seed'
import type {
  DispatchBagRecord,
  ServiceOperatorSnapshot,
} from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '990001',
  displayName: '林川',
  workstationCode: '01',
  acceptanceOffice: '长风支局',
  receivingOffice: '栖沄邮件处理中心',
  institutionCode: '99901001',
}

async function settledMail() {
  const repository = MemoryServiceRepository.create()
  const product = SERVICE_PRODUCTS.find((candidate) => candidate.id === 'ordinary-letter-100')!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    destinationZone: 'nonlocal' as const,
    destinationOffice: '栖沄邮件处理中心',
    weightGrams: 20,
  }
  const accepted = await repository.accept({
    acceptedAt: '2026-08-10T09:00:00.000+10:00',
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
    settledAt: '2026-08-10T09:05:00.000+10:00',
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  return { repository, transactionId: accepted.transaction.id }
}

function bagFor(transactionId: string): DispatchBagRecord {
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
    mailReferences: [{ kind: 'transaction', transactionId }],
    totalItems: 1,
    mailWeightGrams: 20,
    emptyBagWeightGrams: 0,
    generatedAt: '2026-08-10T10:00:00.000+10:00',
    generatedBy: operator,
    tagPrintDecision: 'skipped',
    tagPrintedAt: null,
    sealingStatus: 'sealed',
    cancelledAt: null,
    cancelledBy: null,
  }
}

describe('dispatch inquiry', () => {
  it('derives unhanded, routed and exported status from the existing chain', async () => {
    const { repository, transactionId } = await settledMail()
    const initial = await repository.load()
    expect(queryUnhandedDispatchMail(initial, {
      acceptedDateFrom: '2026-08-10',
      acceptedDateTo: '2026-08-10',
    })).toMatchObject([{ mailId: transactionId }])
    expect(queryUnhandedDispatchMail(initial, {
      acceptedDateFrom: '2026-08-10',
      acceptedDateTo: '2026-08-10',
    }, '99902001')).toEqual([])
    expect(queryDispatchMailStatus(initial, {
      acceptedDate: '2026-08-10',
      itemNumber: '',
    })).toMatchObject([{ currentStatus: '未交接' }])
    expect(queryDispatchMailStatus(initial, {
      acceptedDate: '2026-08-10',
      itemNumber: '',
    }, '99902001')).toEqual([])

    const withBag = { ...initial, dispatchBags: [bagFor(transactionId)] }
    expect(queryUnhandedDispatchMail(withBag, {
      acceptedDateFrom: '2026-08-10',
      acceptedDateTo: '2026-08-10',
    })).toEqual([])
    expect(queryDispatchMailStatus(withBag, {
      acceptedDate: '2026-08-10',
      itemNumber: '',
    })).toMatchObject([{ currentStatus: '已封发', manifestNumber: '501' }])

    const routed = executeDispatchRoutingCommand(withBag, {
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-10',
      generatedAt: '2026-08-10T11:00:00.000+10:00',
      operator,
    })
    expect(queryDispatchMailStatus(routed.state, {
      acceptedDate: '2026-08-10',
      itemNumber: '',
    })).toMatchObject([{ currentStatus: '待出口' }])

    const route = routed.routes.find((candidate) => candidate.kind === 'route')!
    const exported = executeDispatchRoutingCommand(routed.state, {
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: 'PCD-20260810-A01',
      authorization: await createTestOnSiteAuthorization('export-dispatch-trip', operator.operatorId),
      exportedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    })
    expect(queryDispatchMailStatus(exported.state, {
      acceptedDate: '2026-08-10',
      itemNumber: '',
    })).toMatchObject([{ currentStatus: '已出口' }])
    expect(queryDispatchBagExportTimes(exported.state, {
      manifestTypeTerm: '国内平函',
      routeCode: 'SIM-A01',
      exportDateFrom: '2026-08-10',
      exportDateTo: '2026-08-10',
    })).toMatchObject([{
      bagBarcode: '990101202608105010100000000001',
      exported: true,
      confirmedExportAt: '2026-08-10T12:00:00.000+10:00',
    }])
    expect(queryDispatchBagExportTimes(exported.state, {
      manifestTypeTerm: '',
      routeCode: '',
      exportDateFrom: '2026-08-10',
      exportDateTo: '2026-08-10',
    }, '99902001')).toEqual([])
  })
})
