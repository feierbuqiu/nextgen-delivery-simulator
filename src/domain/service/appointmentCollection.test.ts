import { describe, expect, it } from 'vitest'

import {
  APPOINTMENT_ORDERS,
  APPOINTMENT_SOURCE_OPTIONS,
  queryAppointmentOrder,
} from './appointmentCollection'
import { calculateServiceCharge } from './policy'
import { createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import { acceptServiceTransaction } from './transactions'
import type { AppointmentOrder } from './appointmentCollection'
import type { ServiceWorkspaceState } from './types'

function acceptOrder(
  state: ServiceWorkspaceState,
  order: AppointmentOrder,
) {
  const product = SERVICE_PRODUCTS.find(
    (candidate) => candidate.id === order.draft.productId,
  )
  if (!product) throw new Error('test product missing')
  return acceptServiceTransaction(state, {
    acceptedAt: '2026-08-10T09:40:00.000Z',
    product,
    draft: order.draft,
    charge: calculateServiceCharge(order.draft, product),
    customer: {
      productFamily: order.customer.productFamily,
      destinationRegion: order.customer.destinationRegion,
      sender: order.customer.sender,
      recipient: order.customer.recipient,
    },
  })
}

describe('appointment collection', () => {
  it('queries every de-identified source by its appointment number', () => {
    const state = createServiceSeedState()

    expect(APPOINTMENT_SOURCE_OPTIONS).toHaveLength(5)
    for (const fixture of APPOINTMENT_ORDERS) {
      expect(
        queryAppointmentOrder(state, fixture.source, fixture.orderNumber),
      ).toMatchObject({
        source: fixture.source,
        sourceLabel: fixture.sourceLabel,
        orderNumber: fixture.orderNumber,
      })
    }
  })

  it('supports phone lookup and customer self-service barcode scanning', () => {
    const state = createServiceSeedState()
    const online = APPOINTMENT_ORDERS[0]!
    const customerSelfService = APPOINTMENT_ORDERS[4]!

    expect(queryAppointmentOrder(
      state,
      online.source,
      online.lookupPhone,
    ).orderNumber).toBe(online.orderNumber)
    expect(queryAppointmentOrder(
      state,
      customerSelfService.source,
      customerSelfService.draft.itemCode,
    )).toMatchObject({
      orderNumber: customerSelfService.orderNumber,
      draft: {
        paymentMethod: 'credit',
        appointment: {
          labelAlreadyPrinted: true,
          mailInformationLocked: true,
        },
      },
    })
  })

  it('applies the delivery-platform discount to postage and settlement due', () => {
    const order = APPOINTMENT_ORDERS.find(
      (candidate) => candidate.source === 'delivery-platform',
    )!
    const product = SERVICE_PRODUCTS.find(
      (candidate) => candidate.id === order.draft.productId,
    )!

    expect(calculateServiceCharge(order.draft, product)).toMatchObject({
      baseWeightCents: 800,
      discountCents: 200,
      postageCents: 600,
      settlementDueCents: 600,
    })
  })

  it('records the appointment source and blocks duplicate acceptance', () => {
    const order = APPOINTMENT_ORDERS[2]!
    const accepted = acceptOrder(createServiceSeedState(), order)

    expect(accepted.transaction).toMatchObject({
      source: 'appointment',
      sourceOrderNumber: order.orderNumber,
      service: { appointment: { source: 'delivery-platform' } },
    })
    expect(() => queryAppointmentOrder(
      accepted.state,
      order.source,
      order.orderNumber,
    )).toThrow('已经完成收寄')
    expect(() => acceptOrder(accepted.state, order)).toThrow('已经完成收寄')
  })

  it('rejects changes to locked partner information', () => {
    const order = structuredClone(APPOINTMENT_ORDERS[1]!)
    order.customer.recipient.name = '被改动的收件人'

    expect(() => acceptOrder(createServiceSeedState(), order)).toThrow(
      '寄收件人与邮件信息不可修改',
    )
  })

  it('requires agreement credit settlement for customer self-service', () => {
    const order = structuredClone(APPOINTMENT_ORDERS[4]!)
    order.draft.paymentMethod = 'cash-settlement'

    expect(() => acceptOrder(createServiceSeedState(), order)).toThrow(
      '协议账户记欠收寄',
    )
  })
})
