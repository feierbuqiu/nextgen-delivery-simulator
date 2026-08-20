import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createServiceSeedState } from './seed'
import {
  executeDispatchRoutingCommand,
  queryCatchupDispatchRoutes,
  queryDispatchPrintRows,
  queryDispatchVehicleRoutes,
  queryUngeneratedDispatchBags,
} from './dispatchRouting'
import type {
  DispatchBagHandoverRecord,
  DispatchBagRecord,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '990001',
  displayName: '林川',
  workstationCode: '01',
  acceptanceOffice: '长风支局',
  receivingOffice: '虚构寄达局',
  institutionCode: '99901001',
}

function bag(
  id: string,
  overrides: Partial<DispatchBagRecord> = {},
): DispatchBagRecord {
  return {
    id,
    bagBarcode: `99010000000000000000000000${id.slice(-2)}`.slice(-30),
    manifestTypeCode: 'GNPCXH',
    manifestTypeName: '国内平函',
    bagBarcodeTypeCode: '411',
    bagBarcodeTypeName: '平信袋',
    receivingOfficeCode: '99101001',
    receivingOfficeName: '栖沄邮件处理中心',
    directSeal: false,
    consolidation: true,
    localTransfer: false,
    manifestNumber: id.slice(-3).padStart(3, '0'),
    receptacleType: '1.袋',
    usesBarcodeContainer: false,
    containerBarcode: '',
    rfidBagTagNumber: '',
    shift: '01',
    mailReferences: [],
    totalItems: 2,
    mailWeightGrams: 50,
    emptyBagWeightGrams: 5,
    generatedAt: '2026-08-10T10:00:00.000+10:00',
    generatedBy: operator,
    tagPrintDecision: 'skipped',
    tagPrintedAt: null,
    sealingStatus: 'sealed',
    cancelledAt: null,
    cancelledBy: null,
    ...overrides,
  }
}

function stateWithBags(...bags: DispatchBagRecord[]): ServiceWorkspaceState {
  return { ...createServiceSeedState(), dispatchBags: bags }
}

function handover(
  bagId: string,
  status: DispatchBagHandoverRecord['status'],
): DispatchBagHandoverRecord {
  return {
    id: `ZBJ-${bagId}`,
    bagId,
    status,
    originOfficeCode: '99901001',
    originOfficeName: '长风支局',
    receivingOfficeCode: '99101001',
    receivingOfficeName: '栖沄邮件处理中心',
    handedOverAt: '2026-08-10T10:10:00.000+10:00',
    handedOverBy: operator,
    receivedAt: status === 'received' ? '2026-08-10T10:20:00.000+10:00' : null,
    receivedBy: status === 'received' ? operator : null,
    receiptShift: status === 'received' ? '02' : null,
    shiftTransferredAt: null,
    shiftTransferredBy: null,
    withdrawnAt: null,
    withdrawnBy: null,
    returnedAt: null,
    returnedBy: null,
  }
}

describe('dispatch routing', () => {
  it('groups eligible bags into routes and one master route without duplicate assignment', () => {
    const initial = stateWithBags(
      bag('ZB-001'),
      bag('ZB-002', { manifestNumber: '502' }),
      bag('ZB-003', {
        manifestTypeCode: 'GNTK',
        manifestTypeName: '国内特快',
        manifestNumber: '503',
      }),
    )
    const generated = executeDispatchRoutingCommand(initial, {
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-10',
      generatedAt: '2026-08-10T11:00:00.000+10:00',
      operator,
    })

    expect(generated.routes).toHaveLength(3)
    expect(generated.routes.filter((route) => route.kind === 'route')).toHaveLength(2)
    expect(generated.routes.find((route) => route.kind === 'master-route')).toMatchObject({
      totalBags: 3,
      totalItems: 6,
      totalWeightGrams: 165,
      childRouteIds: expect.arrayContaining([
        'LD-20260810-000001',
        'LD-20260810-000002',
      ]),
    })

    const repeated = executeDispatchRoutingCommand(generated.state, {
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-10',
      generatedAt: '2026-08-10T11:01:00.000+10:00',
      operator,
    })
    expect(repeated.routes).toEqual([])
    expect(repeated.state.dispatchRoutes).toHaveLength(3)
  })

  it('isolates pending bags, routes, and route mutations by institution', () => {
    const remoteOperator: ServiceOperatorSnapshot = {
      ...operator,
      operatorId: '990002',
      displayName: '异地营业人员',
      acceptanceOffice: '澄野营业部',
      institutionCode: '99902001',
    }
    const initial = stateWithBags(
      bag('ZB-001', { originOfficeCode: '99901001' }),
      bag('ZB-901', {
        originOfficeCode: '99902001',
        generatedBy: remoteOperator,
        manifestNumber: '901',
      }),
    )
    const bagQuery = {
      routeCode: 'SIM-A01',
      shift: '01' as const,
      sealingDate: '2026-08-10',
    }
    expect(queryUngeneratedDispatchBags(initial, bagQuery, '99901001')
      .eligibleBags.map((candidate) => candidate.id)).toEqual(['ZB-001'])
    expect(queryUngeneratedDispatchBags(initial, bagQuery, '99902001')
      .eligibleBags.map((candidate) => candidate.id)).toEqual(['ZB-901'])

    const remoteRouted = executeDispatchRoutingCommand(initial, {
      type: 'generate-dispatch-routes',
      ...bagQuery,
      generatedAt: '2026-08-10T11:00:00.000+10:00',
      operator: remoteOperator,
    })
    const routed = executeDispatchRoutingCommand(remoteRouted.state, {
      type: 'generate-dispatch-routes',
      ...bagQuery,
      generatedAt: '2026-08-10T11:01:00.000+10:00',
      operator,
    })
    const routeQuery = {
      routeCode: 'SIM-A01',
      shift: '01' as const,
      handoverDate: '2026-08-10',
      exportStatus: 'not-exported' as const,
    }
    const localRoutes = queryDispatchVehicleRoutes(routed.state, routeQuery, '99901001')
    const remoteRoutes = queryDispatchVehicleRoutes(routed.state, routeQuery, '99902001')
    expect(localRoutes).toHaveLength(1)
    expect(remoteRoutes).toHaveLength(1)
    expect(localRoutes[0]!.bagIds).toEqual(['ZB-001'])
    expect(remoteRoutes[0]!.bagIds).toEqual(['ZB-901'])

    expect(() => executeDispatchRoutingCommand(routed.state, {
      type: 'delete-dispatch-routes',
      routeIds: [remoteRoutes[0]!.id],
      deletedAt: '2026-08-10T11:10:00.000+10:00',
      operator,
    })).toThrow('不属于当前经办机构')
  })

  it('blocks a bag in transit and uses the receipt shift after reception', () => {
    const initial = {
      ...stateWithBags(bag('ZB-001')),
      dispatchBagHandovers: [handover('ZB-001', 'handed-over')],
    }
    expect(queryUngeneratedDispatchBags(initial, {
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-10',
    })).toMatchObject({ eligibleBags: [], blockedBags: [{ id: 'ZB-001' }] })

    const received = {
      ...initial,
      dispatchBagHandovers: [handover('ZB-001', 'received')],
    }
    expect(queryUngeneratedDispatchBags(received, {
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-10',
    }).eligibleBags).toEqual([])
    expect(queryUngeneratedDispatchBags(received, {
      routeCode: 'SIM-A01',
      shift: '02',
      sealingDate: '2026-08-10',
    }).eligibleBags).toMatchObject([{ id: 'ZB-001' }])
  })

  it('validates manual barcode containers and cumulative container clearance stock', () => {
    const initial = createServiceSeedState()
    const first = executeDispatchRoutingCommand(initial, {
      type: 'add-manual-dispatch-route',
      generatedAt: '2026-08-10T11:00:00.000+10:00',
      operator,
      input: {
        kind: 'container-return',
        routeCode: 'SIM-A01',
        routeNumber: '',
        manifestTypeCode: 'container-return',
        manifestTypeName: '容器清退',
        manifestNumber: '',
        shift: '01',
        sealingDate: '2026-08-10',
        directSeal: false,
        localTransfer: false,
        receivingOfficeCode: '',
        receivingOfficeName: '',
        receptacleType: '1.袋',
        usesBarcodeContainer: true,
        containerTypeCode: 'bag',
        containerTypeName: '邮袋',
        containerModelCode: 'standard',
        containerModelName: '标准条码邮袋',
        containerBarcodes: ['9901000000000001'],
        containerReturnLines: [{
          containerTypeCode: 'bag',
          containerTypeName: '邮袋',
          containerModelCode: 'standard',
          containerModelName: '标准条码邮袋',
          inventoryQuantity: 8,
          clearanceQuantity: 6,
        }],
        totalBags: 1,
        totalWeightGrams: 500,
      },
    })
    expect(first.routes[0]).toMatchObject({
      kind: 'container-return',
      containerBarcodes: ['9901000000000001'],
      containerReturnLines: [{ clearanceQuantity: 6 }],
    })

    expect(() => executeDispatchRoutingCommand(first.state, {
      type: 'add-manual-dispatch-route',
      generatedAt: '2026-08-10T11:05:00.000+10:00',
      operator,
      input: {
        ...first.routes[0]!,
        kind: 'container-return',
        routeNumber: '',
        manifestNumber: '',
        containerBarcodes: ['9901000000000002'],
        containerReturnLines: [{
          containerTypeCode: 'bag',
          containerTypeName: '邮袋',
          containerModelCode: 'standard',
          containerModelName: '标准条码邮袋',
          inventoryQuantity: 8,
          clearanceQuantity: 3,
        }],
      },
    })).toThrow('可清退数量仅剩 2')
  })

  it('filters ordinary print records out of the unprinted result', () => {
    const initial = stateWithBags(bag('ZB-001'))
    const query = {
      sealingDate: '2026-08-10',
      shift: '01' as const,
      packageType: '1' as const,
      employeeTerm: '',
      manifestTypeTerm: '',
      dataType: 'unprinted' as const,
    }
    expect(queryDispatchPrintRows(initial, query)).toHaveLength(1)
    const printed = executeDispatchRoutingCommand(initial, {
      type: 'record-dispatch-print',
      documentType: 'manifest',
      targetIds: ['ZB-001'],
      printedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    })
    expect(queryDispatchPrintRows(printed.state, query)).toEqual([])
    expect(queryDispatchPrintRows(printed.state, { ...query, dataType: 'all' })[0])
      .toMatchObject({ targetId: 'ZB-001', printed: true })
  })

  it('collects a dispatch order for a controlled route and cascades export to its master route', async () => {
    const exportAuthorization = await createTestOnSiteAuthorization(
      'export-dispatch-trip',
      operator.operatorId,
    )
    const routed = executeDispatchRoutingCommand(stateWithBags(bag('ZB-001')), {
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-10',
      generatedAt: '2026-08-10T11:00:00.000+10:00',
      operator,
    })
    const route = routed.routes.find((candidate) => candidate.kind === 'route')!

    expect(() => executeDispatchRoutingCommand(routed.state, {
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: '',
      authorization: exportAuthorization,
      exportedAt: '2026-08-11T12:00:00.000+10:00',
      operator,
    })).toThrow('实际出口时间')

    expect(() => executeDispatchRoutingCommand(routed.state, {
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: '',
      authorization: exportAuthorization,
      exportedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    })).toThrow('请输入派车单号')

    expect(() => executeDispatchRoutingCommand(routed.state, {
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: 'PY123456',
      authorization: exportAuthorization,
      exportedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    })).toThrow('未查询到 45 天内')

    expect(() => executeDispatchRoutingCommand(routed.state, {
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: 'PCD-20260810-A01',
      authorization: undefined!,
      exportedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    })).toThrow('真实账号现场授权')
    expect(routed.state.dispatchRoutes.find((candidate) => candidate.id === route.id))
      .toMatchObject({ exportedAt: null, exportAuthorizedBy: null })

    expect(() => executeDispatchRoutingCommand(routed.state, {
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: 'PCD-20260810-A01',
      authorization: exportAuthorization,
      exportedAt: '2026-08-10T12:00:00.000+10:00',
      operator: { ...operator, operatorId: '90000001' },
    })).toThrow('真实账号现场授权')

    const exported = executeDispatchRoutingCommand(routed.state, {
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: 'PCD-20260810-A01',
      authorization: exportAuthorization,
      exportedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    })
    expect(exported.routes).toMatchObject([{
      id: route.id,
      dispatchOrderNumber: 'PCD-20260810-A01',
      exportAuthorizedBy: '90000001',
      exportAuthorizedAt: '2026-08-10T12:00:00.000+10:00',
      exportedAt: '2026-08-10T12:00:00.000+10:00',
    }])
    expect(exported.state.dispatchRoutes.find((candidate) => candidate.kind === 'master-route'))
      .toMatchObject({ exportedAt: '2026-08-10T12:00:00.000+10:00' })
    expect(queryDispatchVehicleRoutes(exported.state, {
      routeCode: 'SIM-A01',
      shift: '01',
      handoverDate: '2026-08-10',
      exportStatus: 'exported',
    })).toMatchObject([{ id: route.id }])

    expect(() => executeDispatchRoutingCommand(exported.state, {
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: 'PCD-20260810-A01',
      authorization: exportAuthorization,
      exportedAt: '2026-08-10T12:05:00.000+10:00',
      operator,
    })).toThrow('已出口，不能重复操作')
  })

  it('rejects a fabricated dispatch order on a route that does not collect one', async () => {
    const exportAuthorization = await createTestOnSiteAuthorization(
      'export-dispatch-trip',
      operator.operatorId,
    )
    const routed = executeDispatchRoutingCommand(stateWithBags(bag('ZB-001', {
      receivingOfficeCode: '99102001',
      receivingOfficeName: '澄野转运中心',
    })), {
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-B02',
      shift: '01',
      sealingDate: '2026-08-10',
      generatedAt: '2026-08-10T11:00:00.000+10:00',
      operator,
    })
    const route = routed.routes.find((candidate) => candidate.kind === 'route')!

    expect(() => executeDispatchRoutingCommand(routed.state, {
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: 'FAKE-ORDER',
      authorization: exportAuthorization,
      exportedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    })).toThrow('当前邮路不采集派车单号')

    const exported = executeDispatchRoutingCommand(routed.state, {
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: '',
      authorization: exportAuthorization,
      exportedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    })
    expect(exported.routes[0]).toMatchObject({
      dispatchOrderNumber: '',
      exportAuthorizedBy: '90000001',
    })
  })

  it('receives an unexported prior-day route into the current trip', async () => {
    const exportAuthorization = await createTestOnSiteAuthorization(
      'export-dispatch-trip',
      operator.operatorId,
    )
    const priorBag = bag('ZB-001', { generatedAt: '2026-08-09T10:00:00.000+10:00' })
    const routed = executeDispatchRoutingCommand(stateWithBags(priorBag), {
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-09',
      generatedAt: '2026-08-09T11:00:00.000+10:00',
      operator,
    })
    const route = queryCatchupDispatchRoutes(routed.state, {
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-09',
    })[0]!
    expect(() => executeDispatchRoutingCommand(routed.state, {
      type: 'receive-catchup-dispatch-routes',
      routeIds: [route.id],
      receiptDate: '2026-08-10',
      receivedAt: '2026-08-11T08:00:00.000+10:00',
      operator,
    })).toThrow('接收日期必须与实际勾挑接收时间属于同一业务日')
    const received = executeDispatchRoutingCommand(routed.state, {
      type: 'receive-catchup-dispatch-routes',
      routeIds: [route.id],
      receiptDate: '2026-08-10',
      receivedAt: '2026-08-10T08:00:00.000+10:00',
      operator,
    })

    expect(received.routes).toMatchObject([{
      catchupReceiptDate: '2026-08-10',
      catchupReceivedAt: '2026-08-10T08:00:00.000+10:00',
    }])
    expect(queryDispatchVehicleRoutes(received.state, {
      routeCode: 'SIM-A01',
      shift: '01',
      handoverDate: '2026-08-10',
      exportStatus: 'not-exported',
    })).toMatchObject([{ id: route.id }])
    expect(queryCatchupDispatchRoutes(received.state, {
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-09',
    })).toEqual([])

    const exported = executeDispatchRoutingCommand(received.state, {
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: 'PCD-20260810-A01',
      authorization: exportAuthorization,
      exportedAt: '2026-08-10T09:00:00.000+10:00',
      operator,
    })
    expect(exported.routes).toMatchObject([{
      id: route.id,
      catchupReceiptDate: '2026-08-10',
      exportedAt: '2026-08-10T09:00:00.000+10:00',
    }])
  })
})
