import { describe, expect, it } from 'vitest'

import { DEMO_MANAGEMENT_OPERATOR_ID } from '../access/seed'
import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createEmptySender } from '../customer/seed'
import {
  acceptChannelProductOrder,
  channelProductFulfillmentSummary,
  deleteChannelProductOrders,
  queryChannelProductOrders,
  recordChannelProductReceiptPrint,
  remainingChannelPickupStock,
  remainingChannelProductStock,
} from './channelProductSales'
import { createServiceSeedState } from './seed'
import { DEFAULT_SERVICE_OPERATOR, pendingServiceSummary, settleServiceTransactions } from './transactions'

describe('channel product sales', () => {
  it('persists mixed delivery, pickup, and spot quantities before unified settlement', () => {
    const accepted = acceptChannelProductOrder(createServiceSeedState(), {
      submittedAt: '2026-08-04T11:00:00.000Z',
      buyer: { ...createEmptySender(), name: '林澄' },
      lines: [
        { productId: 'channel-cloud-grain-box', skuCode: 'YG-06', quantity: 3 },
        { productId: 'channel-starlight-postcard-set', skuCode: 'XH-12', quantity: 2 },
      ],
      allocations: [
        {
          id: 'FHD-001',
          kind: 'delivery',
          recipient: {
            contact: '10000000019',
            name: '顾远',
            postalCode: '120023',
            detailedAddress: '澄岐省澄野市江洲区远景路 26 号',
          },
          pickup: null,
          lines: [{ productId: 'channel-cloud-grain-box', skuCode: 'YG-06', quantity: 1 }],
        },
        {
          id: 'ZTD-002',
          kind: 'pickup',
          recipient: null,
          pickup: {
            contact: '10000000020',
            name: '叶舟',
            identityType: '',
            identityValue: '',
            gender: '',
            pickupOfficeCode: '99001011',
            pickupOfficeName: '栖沄营业部',
          },
          lines: [
            { productId: 'channel-cloud-grain-box', skuCode: 'YG-06', quantity: 1 },
            { productId: 'channel-starlight-postcard-set', skuCode: 'XH-12', quantity: 1 },
          ],
        },
      ],
    })

    expect(accepted.order).toMatchObject({
      id: 'XS-20260804-000001',
      status: 'pending-settlement',
      totalQuantity: 5,
      totalCents: 22800,
      lines: [
        { productLabel: '云谷杂粮礼盒', skuLabel: '六袋装', amountCents: 20400 },
        { productLabel: '星河风景卡组', skuLabel: '十二枚装', amountCents: 2400 },
      ],
    })
    expect(channelProductFulfillmentSummary(accepted.order)).toEqual({
      deliveryQuantity: 1,
      pickupQuantity: 2,
      spotQuantity: 2,
    })
    expect(remainingChannelProductStock(
      accepted.state,
      'channel-cloud-grain-box',
      'YG-06',
    )).toBe(45)
    expect(remainingChannelPickupStock(
      accepted.state,
      '99001011',
      'channel-cloud-grain-box',
      'YG-06',
    )).toBe(7)
    expect(pendingServiceSummary(accepted.state)).toEqual({
      count: 1,
      totalCents: 22800,
    })

    const settled = settleServiceTransactions(accepted.state, {
      transactionIds: [accepted.order.id],
      tender: 'cash',
      settledAt: '2026-08-04T11:10:00.000Z',
      amountReceivedCents: 23000,
    })
    expect(settled.settlement).toMatchObject({ amountDueCents: 22800, changeCents: 200 })
    expect(settled.state.channelProductOrders[0]).toMatchObject({
      status: 'settled',
      settlementId: settled.settlement.id,
    })
  })

  it('rejects allocation quantities above the shopping-cart remainder', () => {
    expect(() => acceptChannelProductOrder(createServiceSeedState(), {
      submittedAt: '2026-08-04T11:00:00.000Z',
      buyer: createEmptySender(),
      lines: [{ productId: 'channel-cloud-grain-box', skuCode: 'YG-06', quantity: 1 }],
      allocations: [
        {
          id: 'FHD-001',
          kind: 'delivery',
          recipient: {
            contact: '10000000019',
            name: '顾远',
            postalCode: '120023',
            detailedAddress: '澄岐省澄野市江洲区远景路 26 号',
          },
          pickup: null,
          lines: [{ productId: 'channel-cloud-grain-box', skuCode: 'YG-06', quantity: 2 }],
        },
      ],
    })).toThrow('不得超过购物车剩余数量')
  })

  it('enforces pickup-office inventory while exempting non-controlled products', () => {
    const pickup = {
      contact: '10000000020',
      name: '叶舟',
      identityType: '',
      identityValue: '',
      gender: '',
      pickupOfficeCode: '99001011',
      pickupOfficeName: '栖沄营业部',
    }
    expect(() => acceptChannelProductOrder(createServiceSeedState(), {
      submittedAt: '2026-08-04T11:00:00.000Z',
      buyer: createEmptySender(),
      lines: [{ productId: 'channel-cloud-grain-box', skuCode: 'YG-06', quantity: 9 }],
      allocations: [{
        id: 'ZTD-001',
        kind: 'pickup',
        recipient: null,
        pickup,
        lines: [{ productId: 'channel-cloud-grain-box', skuCode: 'YG-06', quantity: 9 }],
      }],
    })).toThrow('自提库存仅剩 8')

    expect(() => acceptChannelProductOrder(createServiceSeedState(), {
      submittedAt: '2026-08-04T11:00:00.000Z',
      buyer: createEmptySender(),
      lines: [{ productId: 'channel-starlight-postcard-set', skuCode: 'XH-12', quantity: 200 }],
      allocations: [{
        id: 'ZTD-001',
        kind: 'pickup',
        recipient: null,
        pickup,
        lines: [{ productId: 'channel-starlight-postcard-set', skuCode: 'XH-12', quantity: 200 }],
      }],
    })).not.toThrow()
  })

  it('queries, records receipt printing, and authorized staff deletes only same-day unpaid sales', async () => {
    const accepted = acceptChannelProductOrder(createServiceSeedState(), {
      submittedAt: '2026-08-04T11:00:00.000Z',
      buyer: { ...createEmptySender(), name: '林澄' },
      lines: [{ productId: 'channel-cloud-grain-box', skuCode: 'YG-06', quantity: 2 }],
      allocations: [],
    })
    const query = {
      querySerial: '000001',
      productTerm: 'YG-06',
      salesDateFrom: '2026-08-04',
      salesDateTo: '2026-08-04',
      operatorId: '80000001',
      workstationCode: '01',
      salesType: 'offline' as const,
    }
    expect(queryChannelProductOrders(accepted.state.channelProductOrders, query))
      .toHaveLength(1)
    expect(queryChannelProductOrders(accepted.state.channelProductOrders, {
      ...query,
      salesType: 'online',
    })).toHaveLength(0)

    const printed = recordChannelProductReceiptPrint(accepted.state, {
      orderId: accepted.order.id,
      printedAt: '2026-08-04T11:05:00.000Z',
    })
    expect(printed.order.receiptPrintedAt).toEqual(['2026-08-04T11:05:00.000Z'])
    expect(() => deleteChannelProductOrders(printed.state, {
      orderIds: [accepted.order.id],
      deletedAt: '2026-08-04T11:06:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
      authorization: undefined!,
    })).toThrow('真实账号现场授权')
    const authorization = await createTestOnSiteAuthorization('delete-channel-product-order')
    expect(() => deleteChannelProductOrders(printed.state, {
      orderIds: [accepted.order.id],
      deletedAt: '2026-08-05T09:00:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
      authorization,
    })).toThrow('不是当天销售记录')

    const validAuthorization = await createTestOnSiteAuthorization(
      'delete-channel-product-order',
    )
    const deleted = deleteChannelProductOrders(printed.state, {
      orderIds: [accepted.order.id],
      deletedAt: '2026-08-04T11:06:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
      authorization: validAuthorization,
    })
    expect(deleted.orders[0]).toMatchObject({
      status: 'deleted',
      deletedBy: DEMO_MANAGEMENT_OPERATOR_ID,
      deletedAt: '2026-08-04T11:06:00.000Z',
    })
    expect(queryChannelProductOrders(deleted.state.channelProductOrders, query)).toHaveLength(0)
    expect(pendingServiceSummary(deleted.state)).toEqual({ count: 0, totalCents: 0 })
    expect(remainingChannelProductStock(
      deleted.state,
      'channel-cloud-grain-box',
      'YG-06',
    )).toBe(48)
  })

  it('rejects deletion after a channel-product order has been settled', async () => {
    const accepted = acceptChannelProductOrder(createServiceSeedState(), {
      submittedAt: '2026-08-04T11:00:00.000Z',
      buyer: createEmptySender(),
      lines: [{ productId: 'channel-cloud-grain-box', skuCode: 'YG-06', quantity: 1 }],
      allocations: [],
    })
    const settled = settleServiceTransactions(accepted.state, {
      transactionIds: [accepted.order.id],
      tender: 'cash',
      settledAt: '2026-08-04T11:05:00.000Z',
      amountReceivedCents: 6800,
    })
    const authorization = await createTestOnSiteAuthorization('delete-channel-product-order')
    expect(() => deleteChannelProductOrders(settled.state, {
      orderIds: [accepted.order.id],
      deletedAt: '2026-08-04T11:06:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
      authorization,
    })).toThrow('已缴款')
  })
})
