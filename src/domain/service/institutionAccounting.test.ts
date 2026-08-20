import { describe, expect, it } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../customer/seed'
import {
  executeInstitutionAccountingCommand,
  projectBankDeposit,
  projectBusinessReport,
  projectInstitutionRemittance,
} from './institutionAccounting'
import { executePersonalRemittanceCommand } from './personalRemittance'
import { calculateServiceCharge } from './policy'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import { acceptServiceTransaction, settleServiceTransactions } from './transactions'
import type { ServiceOperatorSnapshot, ServiceWorkspaceState } from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '虚构寄达局',
}

const supervisor: ServiceOperatorSnapshot = {
  operatorId: '90000001',
  displayName: '演示主管',
  workstationCode: '02',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '虚构寄达局',
}

function acceptAndSettle(
  state: ServiceWorkspaceState,
  acceptedAt: string,
  settledAt: string,
  serviceOperator: ServiceOperatorSnapshot = operator,
): ServiceWorkspaceState {
  const product = SERVICE_PRODUCTS[0]!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    itemCode: `7000818316${String(state.nextSequence).padStart(3, '0')}`,
    weightGrams: 20,
    paymentMethod: 'cash-settlement' as const,
  }
  const accepted = acceptServiceTransaction(state, {
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: {
        ...createEmptySender(),
        name: '林澄',
        detailedAddress: '澜京市栖台区新程路 1 号',
      },
      recipient: {
        ...createEmptyRecipient(),
        name: '顾远',
        detailedAddress: '澄岐省澄野市江洲区远帆路 2 号',
      },
    },
    draft,
    product,
    operator: serviceOperator,
  })
  return settleServiceTransactions(accepted.state, {
    transactionIds: [accepted.transaction.id],
    tender: 'cash',
    settledAt,
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  }).state
}

function withConfirmedPersonalRemittance(
  workDate = '2026-08-12',
): ServiceWorkspaceState {
  const settled = acceptAndSettle(
    createServiceSeedState(),
    `${workDate}T01:00:00.000Z`,
    `${workDate}T01:05:00.000Z`,
  )
  const generated = executePersonalRemittanceCommand(settled, {
    type: 'generate-personal-remittance',
    workDate,
    operator,
    institutionCode: '99901001',
    institutionName: '景麓营业部',
    workstationCode: '01',
    generatedAt: `${workDate}T02:00:00.000Z`,
    ignoreCurrentDayPending: false,
  })
  return executePersonalRemittanceCommand(generated.state, {
    type: 'confirm-personal-remittance',
    remittanceId: generated.remittance.id,
    operator,
    confirmedAt: `${workDate}T02:05:00.000Z`,
  }).state
}

function generateInstitution(state: ServiceWorkspaceState, workDate = '2026-08-12') {
  return executeInstitutionAccountingCommand(state, {
    type: 'generate-institution-remittance',
    workDate,
    institutionCode: '99901001',
    institutionName: '景麓营业部',
    operator: supervisor,
    generatedAt: `${workDate}T02:10:00.000Z`,
    managerAuthorized: true,
  })
}

describe('institution accounting', () => {
  it('requires every business workstation to finish personal day-end', () => {
    const settled = acceptAndSettle(
      createServiceSeedState(),
      '2026-08-12T01:00:00.000Z',
      '2026-08-12T01:05:00.000Z',
    )
    const projection = projectInstitutionRemittance(
      settled,
      '2026-08-12',
      '99901001',
      '景麓营业部',
    )
    expect(projection.unclosedWorkstations).toHaveLength(1)
    expect(() => generateInstitution(settled)).toThrow('台席未完成个人缴款日终')
  })

  it('confirms branch remittance and automatically creates a cash deposit slip', () => {
    const generated = generateInstitution(withConfirmedPersonalRemittance())
    expect(generated.institutionRemittance).toMatchObject({
      status: 'generated',
      totalCount: 1,
      cashAmountCents: 80,
    })

    const confirmed = executeInstitutionAccountingCommand(generated.state, {
      type: 'confirm-institution-remittance',
      remittanceId: generated.institutionRemittance!.id,
      operator: supervisor,
      confirmedAt: '2026-08-12T02:15:00.000Z',
      managerAuthorized: true,
    })
    expect(confirmed.institutionRemittance).toMatchObject({ status: 'confirmed' })
    expect(confirmed.bankDepositSlip).toMatchObject({
      source: 'institution-remittance',
      totalAmountCents: 80,
      status: 'active',
    })
  })

  it('rechecks workstation day-end before confirming a generated branch remittance', () => {
    const generated = generateInstitution(withConfirmedPersonalRemittance())
    const lateOperator: ServiceOperatorSnapshot = {
      ...operator,
      operatorId: '80000002',
      displayName: '演示营业员乙',
      workstationCode: '03',
    }
    const changed = acceptAndSettle(
      generated.state,
      '2026-08-12T03:00:00.000Z',
      '2026-08-12T03:05:00.000Z',
      lateOperator,
    )

    expect(() => executeInstitutionAccountingCommand(changed, {
      type: 'confirm-institution-remittance',
      remittanceId: generated.institutionRemittance!.id,
      operator: supervisor,
      confirmedAt: '2026-08-12T03:10:00.000Z',
      managerAuthorized: true,
    })).toThrow('台席未完成个人缴款日终')
  })

  it('cascades same-day branch cancellation to its deposit slip and then unlocks personal cancellation', () => {
    const personalState = withConfirmedPersonalRemittance()
    const personal = personalState.personalRemittances[0]!
    const generated = generateInstitution(personalState)
    expect(() => executePersonalRemittanceCommand(generated.state, {
      type: 'cancel-personal-remittance',
      remittanceId: personal.id,
      operator,
      cancelledAt: '2026-08-12T02:12:00.000Z',
      reason: '账务修正',
    })).toThrow('请先注销支局缴款单')
    const confirmed = executeInstitutionAccountingCommand(generated.state, {
      type: 'confirm-institution-remittance',
      remittanceId: generated.institutionRemittance!.id,
      operator: supervisor,
      confirmedAt: '2026-08-12T02:15:00.000Z',
      managerAuthorized: true,
    })

    expect(() => executePersonalRemittanceCommand(confirmed.state, {
      type: 'cancel-personal-remittance',
      remittanceId: personal.id,
      operator,
      cancelledAt: '2026-08-12T02:20:00.000Z',
      reason: '账务修正',
    })).toThrow('请先注销支局缴款单')

    const cancelled = executeInstitutionAccountingCommand(confirmed.state, {
      type: 'cancel-institution-remittance',
      remittanceId: generated.institutionRemittance!.id,
      operator: supervisor,
      cancelledAt: '2026-08-12T02:20:00.000Z',
      reason: '账务修正',
      managerAuthorized: true,
    })
    expect(cancelled.state.bankDepositSlips[0]).toMatchObject({ status: 'cancelled' })
    expect(() => executePersonalRemittanceCommand(cancelled.state, {
      type: 'cancel-personal-remittance',
      remittanceId: personal.id,
      operator,
      cancelledAt: '2026-08-12T02:25:00.000Z',
      reason: '账务修正',
    })).not.toThrow()
  })

  it('supports multiple current-day deposit ranges without depositing one source twice', () => {
    let state = acceptAndSettle(
      createServiceSeedState(),
      '2026-08-12T01:00:00.000Z',
      '2026-08-12T01:05:00.000Z',
    )
    state = acceptAndSettle(
      state,
      '2026-08-12T04:00:00.000Z',
      '2026-08-12T04:05:00.000Z',
    )
    const first = executeInstitutionAccountingCommand(state, {
      type: 'generate-bank-deposit',
      workDate: '2026-08-12',
      institutionCode: '99901001',
      institutionName: '景麓营业部',
      rangeStart: '09:00:00',
      rangeEnd: '10:00:00',
      operator: supervisor,
      generatedAt: '2026-08-12T05:00:00.000Z',
      managerAuthorized: true,
    })
    const secondProjection = projectBankDeposit(
      first.state,
      '2026-08-12',
      '99901001',
      '景麓营业部',
      '09:00:00',
      '13:00:00',
    )
    expect(first.bankDepositSlip?.totalAmountCents).toBe(80)
    expect(secondProjection.totalAmountCents).toBe(80)
    expect(secondProjection.sourceReferences).not.toContain(
      first.bankDepositSlip?.sourceReferences[0],
    )
  })

  it('allows only one historical make-up deposit slip for a day', () => {
    const state = acceptAndSettle(
      createServiceSeedState(),
      '2026-08-11T01:00:00.000Z',
      '2026-08-11T01:05:00.000Z',
    )
    const generated = executeInstitutionAccountingCommand(state, {
      type: 'generate-bank-deposit',
      workDate: '2026-08-11',
      institutionCode: '99901001',
      institutionName: '景麓营业部',
      rangeStart: '00:00:00',
      rangeEnd: '23:59:59',
      operator: supervisor,
      generatedAt: '2026-08-12T02:00:00.000Z',
      managerAuthorized: true,
    })
    expect(() => executeInstitutionAccountingCommand(generated.state, {
      type: 'generate-bank-deposit',
      workDate: '2026-08-11',
      institutionCode: '99901001',
      institutionName: '景麓营业部',
      rangeStart: '00:00:00',
      rangeEnd: '23:59:59',
      operator: supervisor,
      generatedAt: '2026-08-12T02:05:00.000Z',
      managerAuthorized: true,
    })).toThrow('历史日期只允许补生成一张存行单')
  })

  it('makes daily reports available only after the following day aggregation', () => {
    const state = acceptAndSettle(
      createServiceSeedState(),
      '2026-08-11T01:00:00.000Z',
      '2026-08-11T01:05:00.000Z',
    )
    const report = projectBusinessReport(state, {
      scope: 'institution',
      period: 'daily',
      startDate: '2026-08-11',
      endDate: '2026-08-11',
      institutionCode: '99901001',
      institutionName: '景麓营业部',
      operatorId: null,
      workstationCode: '',
      asOf: '2026-08-12T02:00:00.000Z',
    })
    expect(report).toMatchObject({ totalCount: 1, totalAmountCents: 80 })
    expect(() => projectBusinessReport(state, {
      scope: 'institution',
      period: 'daily',
      startDate: '2026-08-12',
      endDate: '2026-08-12',
      institutionCode: '99901001',
      institutionName: '景麓营业部',
      operatorId: null,
      workstationCode: '',
      asOf: '2026-08-12T02:00:00.000Z',
    })).toThrow('次日零点汇总后')
  })
})
