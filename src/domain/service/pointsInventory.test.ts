import { describe, expect, it } from 'vitest'

import {
  executePointsInventoryCommand,
  queryPointsProductInventory,
} from './pointsInventory'
import { createServiceSeedState } from './seed'

const OPERATOR = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '虚构寄达局',
}

describe('points product inventory', () => {
  it('queries barcodes exactly and product names fuzzily', () => {
    const state = createServiceSeedState()

    expect(queryPointsProductInventory(state, {
      barcode: 'SIM-JF-000803',
      productName: '',
    }).map((item) => item.productNumber)).toEqual(['JF803'])
    expect(queryPointsProductInventory(state, {
      barcode: 'sim-jf-000803',
      productName: '',
    })).toEqual([])
    expect(queryPointsProductInventory(state, {
      barcode: '',
      productName: '清洁',
    }).map((item) => item.productNumber)).toEqual(['JF801', 'JF811'])
    expect(queryPointsProductInventory(state, {
      barcode: '',
      productName: '',
    })).toHaveLength(4)
  })

  it('records inbound and outbound movements with balances and simulated sync receipts', () => {
    const state = createServiceSeedState()
    const inbound = executePointsInventoryCommand(state, {
      type: 'adjust-points-inventory',
      productId: 'points-product-803',
      kind: 'inbound',
      quantity: 4,
      operatedAt: '2026-08-19T09:30:00.000Z',
      operator: OPERATOR,
    })

    expect(inbound.movement).toMatchObject({
      id: 'JF-KC-20260819-000001',
      balanceBefore: 1,
      balanceAfter: 5,
      syncStatus: 'acknowledged',
    })
    const outbound = executePointsInventoryCommand(inbound.state, {
      type: 'adjust-points-inventory',
      productId: 'points-product-803',
      kind: 'outbound',
      quantity: 2,
      operatedAt: '2026-08-19T09:35:00.000Z',
      operator: OPERATOR,
    })
    expect(outbound.movement).toMatchObject({
      id: 'JF-KC-20260819-000002',
      balanceBefore: 5,
      balanceAfter: 3,
    })
    expect(outbound.state.pointsInventoryMovements).toHaveLength(2)
  })

  it('rejects invalid quantities and outbound stock deficits', () => {
    const state = createServiceSeedState()
    const command = {
      type: 'adjust-points-inventory' as const,
      productId: 'points-product-803',
      kind: 'outbound' as const,
      quantity: 2,
      operatedAt: '2026-08-19T09:40:00.000Z',
      operator: OPERATOR,
    }

    expect(() => executePointsInventoryCommand(state, command)).toThrow(
      '退库数量不能超过当前库存 1',
    )
    expect(() => executePointsInventoryCommand(state, {
      ...command,
      quantity: 0,
    })).toThrow('出入库数量必须是大于零的整数')
  })
})
