import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createSeedState } from '../access/seed'
import {
  createSimulatorArchive,
  parseSimulatorArchive,
} from '../archive/simulatorArchive'
import { createEmptyRecipient, createEmptySender } from '../customer/seed'
import { createCustomerSeedState } from '../customer/seed'
import { executeDispatchRoutingCommand } from './dispatchRouting'
import { projectDispatchFlow, recommendedPostRoute } from './dispatchFlow'
import { executeMailSealingCommand } from './mailSealing'
import { calculateServiceCharge } from './policy'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import { acceptServiceTransaction, settleServiceTransactions } from './transactions'
import type { ServiceOperatorSnapshot } from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '林青禾',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '栖沄邮件处理中心',
}

describe('dispatch flow projection', () => {
  it('connects a settled acceptance to a bag, route and manually confirmed transport handover', async () => {
    const product = SERVICE_PRODUCTS.find((item) => item.id === 'ordinary-letter-100')!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      destinationZone: 'nonlocal' as const,
      itemCode: 'XA10000000001',
      weightGrams: 20,
    }
    const accepted = acceptServiceTransaction(createServiceSeedState(), {
      acceptedAt: '2026-08-18T16:00:00.000Z',
      charge: calculateServiceCharge(draft, product),
      customer: {
        productFamily: product.productFamily,
        destinationRegion: 'domestic',
        sender: { ...createEmptySender(), name: '训练寄件人' },
        recipient: { ...createEmptyRecipient(), name: '训练收件人' },
      },
      draft,
      product,
      operator,
    })
    const settled = settleServiceTransactions(accepted.state, {
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: '2026-08-18T16:05:00.000Z',
      amountReceivedCents: accepted.transaction.charge.settlementDueCents,
    }).state

    let flow = projectDispatchFlow(settled, '2026-08-18T16:06:00.000Z')
    expect(flow.businessDay).toBe('2026-08-19')
    expect(flow.unsealedGroups).toHaveLength(1)
    expect(recommendedPostRoute(flow.unsealedGroups[0]!.relation.receivingOfficeCode)?.code)
      .toBe('SIM-A01')

    const bagged = executeMailSealingCommand(settled, {
      type: 'generate-dispatch-bags',
      manifests: [{
        mailReferences: flow.unsealedGroups[0]!.items.map((item) => item.reference),
        manifestNumber: '501',
        receptacleType: '1.袋',
        usesBarcodeContainer: false,
        containerBarcode: '',
        rfidBagTagNumber: '',
      }],
      shift: '01',
      institutionCode: '99901001',
      generatedAt: '2026-08-19T01:10:00.000Z',
      operator,
    })
    flow = projectDispatchFlow(bagged.state, '2026-08-19T01:11:00.000Z')
    expect(flow.bagGroups[0]).toMatchObject({
      postRoute: { code: 'SIM-A01' },
      shift: '01',
      eligibleBags: [{ id: bagged.bags[0]!.id }],
    })

    const routed = executeDispatchRoutingCommand(bagged.state, {
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-19',
      generatedAt: '2026-08-19T01:15:00.000Z',
      operator,
    })
    flow = projectDispatchFlow(routed.state, '2026-08-19T01:16:00.000Z')
    expect(flow.transportGroups[0]).toMatchObject({
      postRoute: { code: 'SIM-A01' },
      shift: '01',
      routes: [expect.objectContaining({ bagIds: [bagged.bags[0]!.id] })],
    })

    const routeIds = routed.routes
      .filter((route) => route.kind === 'route')
      .map((route) => route.id)
    const exported = executeDispatchRoutingCommand(routed.state, {
      type: 'export-dispatch-routes',
      routeIds,
      exportDate: '2026-08-19',
      dispatchOrderNumber: 'PCD-20260819-A01',
      authorization: await createTestOnSiteAuthorization('export-dispatch-trip', operator.operatorId),
      exportedAt: '2026-08-19T01:20:00.000Z',
      operator,
    })
    flow = projectDispatchFlow(exported.state, '2026-08-19T01:21:00.000Z')
    expect(flow.transportGroups).toHaveLength(0)
    expect(flow.exportedRoutes).toEqual([
      expect.objectContaining({
        dispatchOrderNumber: 'PCD-20260819-A01',
        exportAuthorizedBy: '90000001',
        exportedAt: '2026-08-19T01:20:00.000Z',
      }),
    ])

    const archive = createSimulatorArchive(
      await createSeedState(),
      createCustomerSeedState(),
      exported.state,
      '2026-08-19T01:25:00.000Z',
    )
    const restored = parseSimulatorArchive(JSON.stringify(archive))
    const restoredFlow = projectDispatchFlow(
      restored.data.services,
      '2026-08-19T01:26:00.000Z',
    )
    expect(restoredFlow.exportedRoutes).toEqual([
      expect.objectContaining({
        dispatchOrderNumber: 'PCD-20260819-A01',
        exportAuthorizedBy: '90000001',
        exportedAt: '2026-08-19T01:20:00.000Z',
      }),
    ])
  })
})
