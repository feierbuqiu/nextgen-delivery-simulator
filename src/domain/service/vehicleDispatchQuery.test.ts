import { describe, expect, it } from 'vitest'

import { createServiceSeedState } from './seed'
import type { DispatchRouteRecord, ServiceOperatorSnapshot } from './types'
import {
  CURRENT_DISPATCH_STATION,
  queryVehicleDispatchControls,
  queryVehicleDispatchOrders,
  queryVehicleDispatchStations,
  simulatedVehicleDispatchOrders,
} from './vehicleDispatchQuery'

const operator: ServiceOperatorSnapshot = {
  operatorId: '990001',
  displayName: '林川',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '虚构寄达局',
}

function exportedRoute(
  dispatchOrderNumber: string,
  exportedAt: string,
): DispatchRouteRecord {
  return {
    id: `LD-${dispatchOrderNumber}`,
    kind: 'route',
    routeCode: 'SIM-A01',
    routeName: '栖沄干线邮路',
    routeNumber: '10120001',
    childRouteIds: [],
    manifestTypeCode: 'GNPCXH',
    manifestTypeName: '国内平函',
    manifestNumbers: ['001'],
    shift: '01',
    sealingDate: exportedAt.slice(0, 10),
    directSeal: false,
    localTransfer: false,
    receivingOfficeCode: '99101001',
    receivingOfficeName: '栖沄邮件处理中心',
    bagIds: ['ZB-001'],
    totalBags: 1,
    totalItems: 2,
    totalWeightGrams: 50,
    receptacleType: '1.袋',
    usesBarcodeContainer: false,
    containerTypeCode: '',
    containerTypeName: '',
    containerModelCode: '',
    containerModelName: '',
    containerBarcodes: [],
    containerReturnLines: [],
    source: 'automatic',
    generatedAt: exportedAt,
    generatedBy: operator,
    catchupReceiptDate: null,
    catchupReceivedAt: null,
    catchupReceivedBy: null,
    dispatchOrderNumber,
    exportAuthorizedBy: '90000001',
    exportAuthorizedAt: exportedAt,
    exportedAt,
    exportedBy: operator,
    deletedAt: null,
    deletedBy: null,
  }
}

describe('vehicle dispatch query', () => {
  it('returns the current and deleted control records for a route', () => {
    const rows = queryVehicleDispatchControls({
      routeCode: 'SIM-A01',
      asOf: '2026-08-12',
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      openingProvinceName: '澜京',
      routeCode: 'SIM-A01',
      unsealControlRequirement: '必须',
      deleted: false,
      valid: true,
    })
    expect(rows[1]).toMatchObject({ deleted: true, valid: false })
    expect(() => queryVehicleDispatchControls({ routeCode: '', asOf: '2026-08-12' }))
      .toThrow('请输入邮路代码')
  })

  it('returns usable outbound and return orders issued in the last 30 days', () => {
    const rows = queryVehicleDispatchOrders(createServiceSeedState(), {
      routeCode: 'SIM-A01',
      dispatchOrderNumber: '',
      stationCode: CURRENT_DISPATCH_STATION.code,
      asOf: '2026-08-12',
    })

    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.usable)).toBe(true)
    expect(rows.map((row) => row.currentStation.direction)).toEqual([
      '去程(1)',
      '返程(2)',
    ])
    expect(rows.every((row) => row.currentStation.plannedArrivalAt.startsWith('2026-08-12')))
      .toBe(true)
  })

  it('keeps a 35-day order in the 45-day result but marks it unusable', () => {
    const rows = queryVehicleDispatchOrders(createServiceSeedState(), {
      routeCode: 'SIM-B02',
      dispatchOrderNumber: '',
      stationCode: CURRENT_DISPATCH_STATION.code,
      asOf: '2026-08-12',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ dispatchedDaysAgo: 35, usable: false })
    expect(rows[0]?.unusableReasons).toContain('派车时间超过 30 天')
  })

  it('excludes an order older than 45 days and rejects a deleted current station', () => {
    const rows = queryVehicleDispatchOrders(createServiceSeedState(), {
      routeCode: 'SIM-C03',
      dispatchOrderNumber: '',
      stationCode: CURRENT_DISPATCH_STATION.code,
      asOf: '2026-08-12',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.dispatchOrderNumber).toBe('PCD-20260812-C01')
    expect(rows[0]?.unusableReasons).toContain('当前站序已删除')
  })

  it('prevents reuse within 15 days but permits the same order after 15 days', () => {
    const activeOrder = simulatedVehicleDispatchOrders('2026-08-12')[0]!
    const query = {
      routeCode: 'SIM-A01',
      dispatchOrderNumber: activeOrder.dispatchOrderNumber,
      stationCode: CURRENT_DISPATCH_STATION.code,
      asOf: '2026-08-12',
    }
    const recentState = {
      ...createServiceSeedState(),
      dispatchRoutes: [exportedRoute(activeOrder.dispatchOrderNumber, '2026-08-01T10:00:00+10:00')],
    }
    const oldState = {
      ...createServiceSeedState(),
      dispatchRoutes: [exportedRoute(activeOrder.dispatchOrderNumber, '2026-07-27T10:00:00+10:00')],
    }

    expect(queryVehicleDispatchOrders(recentState, query)[0]).toMatchObject({
      usedWithin15Days: true,
      usable: false,
      unusableReasons: ['15 天内已经使用'],
    })
    expect(queryVehicleDispatchOrders(oldState, query)[0]).toMatchObject({
      usedWithin15Days: false,
      usable: true,
    })
  })

  it('filters and sorts the station detail by route and sequence', () => {
    const order = simulatedVehicleDispatchOrders('2026-08-12')[0]!

    expect(queryVehicleDispatchStations(order, 'SIM-A01')).toMatchObject([
      { stationSequence: 1, unloadingStationName: '景麓营业部' },
      { stationSequence: 2, unloadingStationName: '栖沄交换站' },
    ])
    expect(queryVehicleDispatchStations(order, 'NO-SUCH-ROUTE')).toEqual([])
  })
})
