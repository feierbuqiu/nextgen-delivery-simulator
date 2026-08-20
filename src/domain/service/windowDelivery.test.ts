import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createServiceSeedState } from './seed'
import {
  calculateWindowDeliveryBalance,
  EMPTY_WINDOW_DELIVERY_MONEY,
  executeWindowDeliveryCommand,
  queryWindowDeliveryItems,
} from './windowDelivery'
import type { ServiceOperatorSnapshot } from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '云浦寄达局',
}

const timestamp = '2026-08-11T09:00:00.000+10:00'

describe('window delivery domain', () => {
  it('requires the import bag before receiving its mail and records both operations', () => {
    const seed = createServiceSeedState()

    expect(() => executeWindowDeliveryCommand(seed, {
      type: 'receive-window-delivery-items',
      itemIds: ['window-item-import-001'],
      receivedAt: timestamp,
      operator,
    })).toThrow('请先确认接收邮件所属总包')

    const bagResult = executeWindowDeliveryCommand(seed, {
      type: 'receive-window-delivery-bags',
      bagIds: ['window-bag-001'],
      receivedAt: timestamp,
      operator,
    })
    const itemResult = executeWindowDeliveryCommand(bagResult.state, {
      type: 'receive-window-delivery-items',
      itemIds: ['window-item-import-001'],
      receivedAt: '2026-08-11T09:01:00.000+10:00',
      operator,
    })

    expect(itemResult.items[0]).toMatchObject({
      itemCode: 'RA20260808001GN',
      status: 'stored',
      receivedBy: { operatorId: '80000001' },
    })
    expect(itemResult.state.windowDeliveryAudits.map((audit) => audit.kind)).toEqual([
      'bag-received',
      'mail-received',
    ])
  })

  it('protects return-postage supplement entry with real-account authorization', async () => {
    const seed = createServiceSeedState()
    const draft = {
      productCode: '200000',
      productName: '本埠给据信函',
      itemCode: 'RA20260811007GN',
      dispatchListNumber: '',
      receivingOffice: '景麓营业部',
      destinationOffice: '云浦寄达局',
      sendingOffice: '松岚寄递点',
      senderName: '林川',
      senderPhone: '10000000004',
      senderAddress: '瀚原省栖岳市栖砾县春和路 18 号',
      recipientName: '周沐',
      recipientMobile: '10000000005',
      recipientPhone: '',
      recipientAddress: '瀚原省栖沄市景麓区星河路 26 号',
      mailNote: '',
      nonStandard: false,
      pieces: 1,
      innerPieces: 1,
      weightGrams: 20,
      postingDate: '2026-08-10',
      receivedDate: '2026-08-11',
      specialSequence: 12002,
      money: { ...EMPTY_WINDOW_DELIVERY_MONEY, returnPostageCents: 480 },
    }

    expect(() => executeWindowDeliveryCommand(seed, {
      type: 'create-window-delivery-supplement',
      draft,
      createdAt: timestamp,
      operator,
    })).toThrow('真实账号现场授权')

    const result = executeWindowDeliveryCommand(seed, {
      type: 'create-window-delivery-supplement',
      draft,
      createdAt: timestamp,
      operator,
      authorization: await createTestOnSiteAuthorization('create-window-delivery-supplement'),
    })

    expect(result.items[0]).toMatchObject({
      itemCode: 'RA20260811007GN',
      status: 'stored',
      money: { returnPostageCents: 480 },
    })
    expect(result.state.nextWindowDeliverySequence).toBe(8)
  })

  it('supports transfer, same-day recovery, cancellation, printing, balance and query', () => {
    const seed = createServiceSeedState()
    const itemId = 'window-item-stored-001'
    const transferred = executeWindowDeliveryCommand(seed, {
      type: 'transfer-window-delivery-item',
      itemId,
      processedAt: timestamp,
      operator,
      transfer: {
        transferFlag: 'return',
        destinationProvince: '云浦',
        destinationCity: '云浦',
        destinationCounty: '湖岸',
        destinationPostcode: '999001',
        destinationOffice: '松岚寄递点',
        recipientName: '林川',
        recipientPhone: '10000000004',
        recipientAddress: '瀚原省栖岳市栖砾县春和路 18 号',
        reason: '收件人申请退回',
      },
    })
    expect(transferred.items[0]?.status).toBe('transferred')
    expect(() => executeWindowDeliveryCommand(transferred.state, {
      type: 'delete-window-delivery-item',
      itemId,
      deletedAt: '2026-08-11T09:01:00.000+10:00',
      operator,
    })).toThrow('不允许删除')

    const recovered = executeWindowDeliveryCommand(transferred.state, {
      type: 'recover-window-delivery-item',
      itemId,
      recoveredAt: '2026-08-11T09:02:00.000+10:00',
      operator,
    })
    const cancelled = executeWindowDeliveryCommand(recovered.state, {
      type: 'cancel-window-delivery-item',
      itemId,
      cancelledAt: '2026-08-11T09:03:00.000+10:00',
      operator,
      cancellation: {
        claimantName: '沈舟',
        claimantIdentityType: 'primary',
        claimantIdentityNumber: '990101194912310044',
        agentName: '',
        agentIdentityType: null,
        agentIdentityNumber: '',
        tender: 'cash',
      },
    })
    const printed = executeWindowDeliveryCommand(cancelled.state, {
      type: 'record-window-delivery-print',
      itemIds: [itemId],
      kind: 'query-list',
      printedAt: '2026-08-11T09:04:00.000+10:00',
      operator,
    })

    expect(printed.items[0]?.printHistory).toEqual([
      { kind: 'query-list', printedAt: '2026-08-11T09:04:00.000+10:00' },
    ])
    expect(queryWindowDeliveryItems(printed.state, {
      source: '', status: 'cancelled', productCode: '', itemCode: 'RR20260807006GN',
      recipientName: '', recipientMobile: '', receivedDateFrom: '', receivedDateTo: '',
      postingDateFrom: '', postingDateTo: '',
    })).toHaveLength(1)
    expect(calculateWindowDeliveryBalance(printed.state, '2026-08-01', '2026-08-31')).toMatchObject({
      totalItems: 6,
      taxCents: 320,
      storageWaitCents: 200,
    })
  })

  it('advances first reminder, second reminder and overdue-return in order', () => {
    let state = createServiceSeedState()
    for (const stage of ['first', 'second', 'overdue'] as const) {
      state = executeWindowDeliveryCommand(state, {
        type: 'generate-window-delivery-reminder',
        stage,
        operatedAt: timestamp,
        operator,
      }).state
    }
    expect(state.windowDeliveryItems.find((item) => item.id === 'window-item-stored-001')).toMatchObject({
      status: 'overdue-returned',
      reminderStage: 'overdue',
      firstReminderAt: timestamp,
      secondReminderAt: timestamp,
      overdueAt: timestamp,
    })
  })
})
