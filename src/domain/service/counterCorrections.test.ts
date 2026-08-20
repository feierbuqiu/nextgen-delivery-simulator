import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createEmptySender } from '../customer/seed'
import {
  executeCounterCorrectionCommand,
  queryPostalSupplySales,
  querySupplementaryTrafficCorrections,
} from './counterCorrections'
import { executePersonalRemittanceCommand } from './personalRemittance'
import { createServiceSeedState } from './seed'
import { acceptSupplementaryTraffic } from './supplementaryTraffic'
import {
  acceptPostalSupplySale,
  DEFAULT_SERVICE_OPERATOR,
  remainingPostalSupplyStock,
} from './transactions'

const sender = {
  ...createEmptySender(),
  name: '林澜',
  contact: '10000000016',
  agreementAccountId: '99001000000001',
  agreementAccountName: '澜京长风文书服务中心',
}

describe('counter corrections', () => {
  it('revises and deletes a same-day unsettled postal-supply sale with inventory recovery', async () => {
    const initial = createServiceSeedState()
    const initialStock = remainingPostalSupplyStock(initial, 'supply-standard-envelope')
    const accepted = acceptPostalSupplySale(initial, {
      acceptedAt: '2026-01-15T09:25:00.000Z',
      sender,
      lines: [{ itemId: 'supply-standard-envelope', quantity: 2 }],
    })

    const revised = executeCounterCorrectionCommand(accepted.state, {
      type: 'revise-postal-supply-sale',
      saleId: accepted.sale.id,
      quantities: [{ itemId: 'supply-standard-envelope', quantity: 3 }],
      reason: '更正窗口录入数量',
      operatedAt: '2026-01-15T10:10:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
    })
    expect(revised.state.postalSupplySales[0]).toMatchObject({
      totalCents: 600,
      lines: [{ quantity: 3, amountCents: 600 }],
      revisions: [{ previousTotalCents: 400, nextTotalCents: 600 }],
    })
    expect(remainingPostalSupplyStock(revised.state, 'supply-standard-envelope')).toBe(initialStock - 3)

    const deleted = executeCounterCorrectionCommand(revised.state, {
      type: 'delete-postal-supply-sales',
      saleIds: [accepted.sale.id],
      reason: '客户取消购买',
      operatedAt: '2026-01-15T10:20:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
      authorization: await createTestOnSiteAuthorization('delete-postal-supply-sale'),
    })
    expect(deleted.state.postalSupplySales[0]).toMatchObject({
      status: 'deleted',
      deletionReason: '客户取消购买',
    })
    expect(remainingPostalSupplyStock(deleted.state, 'supply-standard-envelope')).toBe(initialStock)
    expect(queryPostalSupplySales(deleted.state.postalSupplySales, {
      querySerial: accepted.sale.id,
      itemTerm: '',
      customerTerm: '',
      contactTerm: '',
      operatorId: '',
      workstationCode: '',
      acceptedDateFrom: '',
      acceptedDateTo: '',
      status: 'deleted',
    })).toHaveLength(1)
  })

  it('keeps the original supplement as an audit record and creates a replacement', () => {
    const accepted = acceptSupplementaryTraffic(createServiceSeedState(), {
      kind: 'supplementary-income',
      acceptedAt: '2026-01-14T15:59:00.000Z',
      sender,
      subjectCode: '1YWBL01047',
      count: 1,
      amountCents: 1250,
      paymentMethod: 'credit',
    })
    const corrected = executeCounterCorrectionCommand(accepted.state, {
      type: 'replace-supplementary-income',
      recordId: accepted.record.id,
      subjectCode: '1YWBL01048',
      count: 2,
      amountCents: 1800,
      paymentMethod: 'credit',
      reason: '跨日核对后调整科目',
      operatedAt: '2026-01-15T09:30:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
    })

    expect(corrected.state.supplementaryTrafficRecords).toMatchObject([
      {
        id: accepted.record.id,
        status: 'adjusted',
        corrections: [{
          mode: 'cross-day-adjustment',
          previousAmountCents: 1250,
          nextAmountCents: 1800,
        }],
      },
      {
        status: 'pending-settlement',
        subjectCode: '1YWBL01048',
        count: 2,
        amountCents: 1800,
        replacesRecordId: accepted.record.id,
      },
    ])
    const queried = querySupplementaryTrafficCorrections(
      corrected.state.supplementaryTrafficRecords,
      {
        querySerial: '',
        businessKind: 'supplementary-income',
        subjectTerm: '1YWBL01048',
        operatorId: '',
        workstationCode: '',
        acceptedDateFrom: '2026-01-15',
        acceptedDateTo: '2026-01-15',
        status: 'pending-settlement',
      },
    )
    expect(queried).toHaveLength(1)
    expect(queried[0]!.replacesRecordId).toBe(accepted.record.id)
  })

  it('uses the East-8 business day across the UTC midnight boundary', () => {
    const accepted = acceptSupplementaryTraffic(createServiceSeedState(), {
      kind: 'supplementary-income',
      acceptedAt: '2026-01-14T16:00:00.000Z',
      sender,
      subjectCode: '1YWBL01047',
      count: 1,
      amountCents: 1250,
      paymentMethod: 'credit',
    })
    const corrected = executeCounterCorrectionCommand(accepted.state, {
      type: 'replace-supplementary-income',
      recordId: accepted.record.id,
      subjectCode: '1YWBL01048',
      count: 2,
      amountCents: 1800,
      paymentMethod: 'credit',
      reason: '同一业务日更正科目',
      operatedAt: '2026-01-15T09:30:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
    })

    expect(corrected.state.supplementaryTrafficRecords[0]).toMatchObject({
      status: 'deleted',
      corrections: [{ mode: 'same-day-reentry' }],
    })
    expect(querySupplementaryTrafficCorrections(
      corrected.state.supplementaryTrafficRecords,
      {
        querySerial: accepted.record.id,
        businessKind: 'supplementary-income',
        subjectTerm: '',
        operatorId: '',
        workstationCode: '',
        acceptedDateFrom: '2026-01-15',
        acceptedDateTo: '2026-01-15',
        status: 'deleted',
      },
    )).toHaveLength(1)
  })

  it('blocks financial corrections after the owning counter has confirmed remittance', () => {
    const accepted = acceptPostalSupplySale(createServiceSeedState(), {
      acceptedAt: '2026-08-12T01:00:00.000Z',
      sender,
      lines: [{ itemId: 'supply-standard-envelope', quantity: 2 }],
    })
    const generated = executePersonalRemittanceCommand(accepted.state, {
      type: 'generate-personal-remittance',
      workDate: '2026-08-12',
      operator: DEFAULT_SERVICE_OPERATOR,
      institutionCode: '99901001',
      institutionName: '景麓营业部',
      workstationCode: DEFAULT_SERVICE_OPERATOR.workstationCode,
      generatedAt: '2026-08-12T02:00:00.000Z',
      ignoreCurrentDayPending: true,
    })
    const confirmed = executePersonalRemittanceCommand(generated.state, {
      type: 'confirm-personal-remittance',
      remittanceId: generated.remittance.id,
      operator: DEFAULT_SERVICE_OPERATOR,
      confirmedAt: '2026-08-12T02:05:00.000Z',
    })

    expect(() => executeCounterCorrectionCommand(confirmed.state, {
      type: 'revise-postal-supply-sale',
      saleId: accepted.sale.id,
      quantities: [{ itemId: 'supply-standard-envelope', quantity: 3 }],
      reason: '缴款后试图修改',
      operatedAt: '2026-08-12T03:00:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
    })).toThrow('已确认个人缴款单')
  })
})
