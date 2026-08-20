import 'fake-indexeddb/auto'

import { deleteDB } from 'idb'
import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createServiceSeedState } from '../../domain/service/seed'
import type {
  DispatchBagRecord,
  ServiceOperatorSnapshot,
} from '../../domain/service/types'
import { IndexedDbServiceRepository } from './IndexedDbServiceRepository'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '栖沄邮件处理中心',
}

const bag: DispatchBagRecord = {
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
  mailReferences: [],
  totalItems: 2,
  mailWeightGrams: 80,
  emptyBagWeightGrams: 0,
  generatedAt: '2026-08-10T10:00:00.000+10:00',
  generatedBy: operator,
  tagPrintDecision: 'skipped',
  tagPrintedAt: null,
  sealingStatus: 'sealed',
  cancelledAt: null,
  cancelledBy: null,
}

describe('IndexedDB transport export recovery', () => {
  it('serializes two-tab export, preserves authorization, and survives restore', async () => {
    const databaseName = `transport-recovery-${crypto.randomUUID()}`
    const first = new IndexedDbServiceRepository(databaseName)
    const second = new IndexedDbServiceRepository(databaseName)
    await first.restore({ ...createServiceSeedState(), dispatchBags: [bag] })
    const routed = await first.executeDispatchRouting({
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-10',
      generatedAt: '2026-08-10T11:00:00.000+10:00',
      operator,
    })
    const route = routed.routes.find((candidate) => candidate.kind === 'route')!
    const command = {
      type: 'export-dispatch-routes' as const,
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: 'PCD-20260810-A01',
      authorization: await createTestOnSiteAuthorization('export-dispatch-trip', operator.operatorId),
      exportedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    }

    const concurrent = await Promise.allSettled([
      first.executeDispatchRouting(command),
      second.executeDispatchRouting(command),
    ])
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1)

    const exported = await first.load()
    expect(exported.dispatchRoutes.find((candidate) => candidate.id === route.id))
      .toMatchObject({
        dispatchOrderNumber: 'PCD-20260810-A01',
        exportAuthorizedBy: '90000001',
        exportAuthorizedAt: '2026-08-10T12:00:00.000+10:00',
        exportedAt: '2026-08-10T12:00:00.000+10:00',
      })

    await first.reset()
    await first.restore(exported)
    await first.close()
    await second.close()
    const reloaded = new IndexedDbServiceRepository(databaseName)
    expect((await reloaded.load()).dispatchRoutes.find((candidate) => candidate.id === route.id))
      .toMatchObject({ exportAuthorizedBy: '90000001', exportedAt: expect.any(String) })
    await reloaded.close()
    await deleteDB(databaseName)
  })
})
