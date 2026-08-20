import { describe, expect, it } from 'vitest'

import { createServiceSeedState } from './seed'
import {
  deleteSelfServiceImport,
  importSelfServiceReservation,
  querySelfServiceReservation,
  settleSelfServiceImport,
} from './selfServiceImport'
import { queryServiceTransactions } from './transactionCorrection'
import {
  DEFAULT_SERVICE_OPERATOR,
  settleServiceTransactions,
} from './transactions'
import type { ServiceTransactionQuery } from './types'

const reservationNumber = '88202608040000001'
const importedAt = '2026-08-04T09:00:00.000Z'

function query(querySerial: string): ServiceTransactionQuery {
  return {
    querySerial,
    productCode: '',
    itemCode: '',
    paymentMethod: '',
    operatorId: '',
    workstationCode: '',
    dataType: 'all',
    acceptedDateFrom: '',
    acceptedDateTo: '',
    settledDateFrom: '',
    settledDateTo: '',
    sort: 'accepted-desc',
  }
}

function importReservation() {
  return importSelfServiceReservation(createServiceSeedState(), {
    reservationNumber,
    importedAt,
    operator: DEFAULT_SERVICE_OPERATOR,
  })
}

describe('customer self-service batch import', () => {
  it('queries the deterministic upstream reservation and validates its number', () => {
    const reservation = querySelfServiceReservation(reservationNumber)
    expect(reservation.agreementAccountName).toBe('星河合作社')
    expect(reservation.items).toHaveLength(5)
    expect(reservation.items.every((item) => item.productId === 'catalog-300')).toBe(true)
    expect(() => querySelfServiceReservation('123')).toThrow('17 位数字')
    expect(() => querySelfServiceReservation('88202608040000002')).toThrow(
      '未查询到已预受理',
    )
  })

  it('imports five ordinary parcels and exposes them to query correction', () => {
    const imported = importReservation()

    expect(imported.batch).toMatchObject({
      reservationNumber,
      totalCount: 5,
      successCount: 5,
      failedCount: 0,
      totalSuccessfulAmountCents: 3400,
      progressPercent: 100,
      settlementId: null,
    })
    expect(imported.state.transactions).toHaveLength(5)
    expect(imported.state.transactions.every((transaction) =>
      transaction.source === 'self-service-import' &&
      transaction.sourceBatchId === imported.batch.id &&
      transaction.service.paymentMethod === 'credit',
    )).toBe(true)
    expect(queryServiceTransactions(imported.state, query(imported.batch.id))).toHaveLength(5)
    expect(queryServiceTransactions(imported.state, {
      ...query(imported.batch.id),
      acceptedDateFrom: '2026-01-15',
      acceptedDateTo: '2026-01-15',
    })).toHaveLength(5)
    expect(queryServiceTransactions(
      imported.state,
      query(imported.batch.rows[0]!.orderNumber),
    )).toHaveLength(1)
    expect(() => importSelfServiceReservation(imported.state, {
      reservationNumber,
      importedAt,
      operator: DEFAULT_SERVICE_OPERATOR,
    })).toThrow('不能重复处理')
  })

  it('settles the successful batch as direct credit with zero cash received', () => {
    const imported = importReservation()
    expect(() => settleServiceTransactions(imported.state, {
      transactionIds: imported.batch.rows.flatMap(
        (row) => row.transactionId ? [row.transactionId] : [],
      ),
      tender: 'cash',
      settledAt: '2026-08-04T09:09:00.000Z',
      amountReceivedCents: 3400,
    })).toThrow('必须从对应批次进入记欠结算')
    const settled = settleSelfServiceImport(
      imported.state,
      imported.batch.id,
      '2026-08-04T09:10:00.000Z',
    )

    expect(settled.batch.settlementId).toBeTruthy()
    expect(settled.state.transactions.every(
      (transaction) => transaction.status === 'settled',
    )).toBe(true)
    expect(settled.state.settlements).toEqual([
      expect.objectContaining({
        tender: 'credit',
        amountDueCents: 3400,
        amountReceivedCents: 0,
        changeCents: 0,
        invoiceRequested: false,
      }),
    ])
    expect(() => settleSelfServiceImport(
      settled.state,
      settled.batch.id,
      '2026-08-04T09:11:00.000Z',
    )).toThrow('已经结算')
  })

  it('removes an unsettled import and its generated transactions together', () => {
    const imported = importReservation()
    const deleted = deleteSelfServiceImport(imported.state, imported.batch.id)

    expect(deleted.selfServiceImports).toEqual([])
    expect(deleted.transactions).toEqual([])
  })
})
