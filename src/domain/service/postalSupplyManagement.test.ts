import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createServiceSeedState } from './seed'
import {
  calculatePostalSupplyBalance,
  executePostalSupplyManagementCommand,
  postalSupplyEmployeeInventory,
  postalSupplyInstitutionInventory,
  postalSupplySuperiorInventory,
  queryPostalSupplySalesStats,
  type PostalSupplyManagementContext,
} from './postalSupplyManagement'

const itemId = 'supply-standard-envelope'

function context(operatedAt: string): PostalSupplyManagementContext {
  return {
    operatedAt,
    institutionCode: '99901001',
    institutionName: '景麓营业部',
    superiorInstitutionCode: '99800000',
    superiorInstitutionName: '云浦运营中心',
    operator: {
      operatorId: '80000001',
      displayName: '演示营业员',
      workstationCode: '01',
      acceptanceOffice: '景麓营业部',
      receivingOffice: '虚构寄达局',
    },
  }
}

describe('postal supply management', () => {
  it('records an institution inbound document and increases branch stock', () => {
    const initial = createServiceSeedState()
    const before = postalSupplyInstitutionInventory(initial, itemId)

    const result = executePostalSupplyManagementCommand(initial, {
      type: 'record-postal-supply-inbound',
      context: context('2026-08-11T08:00:00.000Z'),
      lines: [{ itemId, quantity: 4 }],
    })

    expect(result.document).toMatchObject({ kind: 'inbound', status: 'saved' })
    expect(result.document.lines[0]).toMatchObject({ requestedQuantity: 4, actualQuantity: 4 })
    expect(postalSupplyInstitutionInventory(result.state, itemId)).toBe(before + 4)
  })

  it('runs requisition approval, quantity revision, and receipt as one stock chain', () => {
    const initial = createServiceSeedState()
    const superiorBefore = postalSupplySuperiorInventory(initial, itemId)
    const institutionBefore = postalSupplyInstitutionInventory(initial, itemId)
    const submitted = executePostalSupplyManagementCommand(initial, {
      type: 'submit-postal-supply-requisition',
      context: context('2026-08-11T08:10:00.000Z'),
      lines: [{ itemId, quantity: 6 }],
    })
    const approved = executePostalSupplyManagementCommand(submitted.state, {
      type: 'approve-postal-supply-request',
      context: context('2026-08-11T08:20:00.000Z'),
      documentId: submitted.document.id,
      lines: [{ itemId, actualQuantity: 5 }],
    })

    expect(postalSupplySuperiorInventory(approved.state, itemId)).toBe(superiorBefore - 5)
    const revised = executePostalSupplyManagementCommand(approved.state, {
      type: 'revise-approved-postal-supply-quantities',
      context: context('2026-08-11T08:30:00.000Z'),
      documentId: submitted.document.id,
      lines: [{ itemId, actualQuantity: 4 }],
    })
    expect(postalSupplySuperiorInventory(revised.state, itemId)).toBe(superiorBefore - 4)

    const received = executePostalSupplyManagementCommand(revised.state, {
      type: 'receive-postal-supply-requisition',
      context: context('2026-08-11T08:40:00.000Z'),
      documentId: submitted.document.id,
    })
    expect(received.document.status).toBe('received')
    expect(postalSupplyInstitutionInventory(received.state, itemId)).toBe(institutionBefore + 4)
  })

  it('restores reserved branch stock when an institution return is rejected', () => {
    const initial = createServiceSeedState()
    const before = postalSupplyInstitutionInventory(initial, itemId)
    const submitted = executePostalSupplyManagementCommand(initial, {
      type: 'submit-postal-supply-institution-return',
      context: context('2026-08-11T09:00:00.000Z'),
      lines: [{ itemId, quantity: 3 }],
    })
    expect(postalSupplyInstitutionInventory(submitted.state, itemId)).toBe(before - 3)

    const rejected = executePostalSupplyManagementCommand(submitted.state, {
      type: 'reject-postal-supply-request',
      context: context('2026-08-11T09:10:00.000Z'),
      documentId: submitted.document.id,
    })
    expect(rejected.document.status).toBe('rejected')
    expect(postalSupplyInstitutionInventory(rejected.state, itemId)).toBe(before)
  })

  it('moves stock between branch and employee inventories', () => {
    const initial = createServiceSeedState()
    const branchBefore = postalSupplyInstitutionInventory(initial, itemId)
    const employeeBefore = postalSupplyEmployeeInventory(initial, itemId, '80000002')
    const issued = executePostalSupplyManagementCommand(initial, {
      type: 'issue-postal-supplies-to-employee',
      context: context('2026-08-11T09:20:00.000Z'),
      employeeId: '80000002',
      employeeName: '周沏',
      lines: [{ itemId, quantity: 7 }],
    })
    expect(postalSupplyInstitutionInventory(issued.state, itemId)).toBe(branchBefore - 7)
    expect(postalSupplyEmployeeInventory(issued.state, itemId, '80000002')).toBe(employeeBefore + 7)

    const returned = executePostalSupplyManagementCommand(issued.state, {
      type: 'return-postal-supplies-from-employee',
      context: context('2026-08-11T09:30:00.000Z'),
      employeeId: '80000002',
      employeeName: '周沏',
      lines: [{ itemId, quantity: 2 }],
    })
    expect(postalSupplyInstitutionInventory(returned.state, itemId)).toBe(branchBefore - 5)
    expect(postalSupplyEmployeeInventory(returned.state, itemId, '80000002')).toBe(employeeBefore + 5)
  })

  it('accepts zero counts and requires real-account authorization for discrepancies', async () => {
    const initial = createServiceSeedState()
    const command = {
      type: 'count-postal-supply-inventory' as const,
      context: context('2026-08-11T10:00:00.000Z'),
      target: 'employee' as const,
      employeeId: '80000002',
      employeeName: '周沏',
      lines: [{ itemId, quantity: 0 }],
    }

    expect(() => executePostalSupplyManagementCommand(initial, command)).not.toThrow()
    expect(() => executePostalSupplyManagementCommand(initial, {
      ...command,
      lines: [{ itemId, quantity: 0 }, { itemId, quantity: 0 }],
    })).toThrow('只能保留一行')

    const differing = {
      ...command,
      employeeId: '80000001',
      employeeName: '演示营业员',
    }
    expect(() => executePostalSupplyManagementCommand(initial, differing)).toThrow('真实账号现场授权')

    const authorized = executePostalSupplyManagementCommand(initial, {
      ...differing,
      authorization: await createTestOnSiteAuthorization('count-postal-supply-inventory'),
    })
    expect(postalSupplyEmployeeInventory(authorized.state, itemId, '80000001')).toBe(0)
  })

  it('calculates balance rows and limits counter sales statistics to parcel content items', () => {
    const state = createServiceSeedState()
    const balance = calculatePostalSupplyBalance(state, 'institution', '2026-08-01', '2026-08-31')
    const envelope = balance.find((row) => row.item.id === itemId)
    expect(envelope?.inboundQuantity).toBe(10)
    expect(envelope?.closingQuantity).toBe(postalSupplyInstitutionInventory(state, itemId))

    const sales = queryPostalSupplySalesStats(state)
    expect(sales.every((row) => ['postal-supply-sale', 'counter-mail'].includes(row.source))).toBe(true)
    expect(sales.filter((row) => row.source === 'counter-mail').every((row) => (
      state.transactions.find((transaction) => transaction.id === row.id)?.product.searchCode === '301'
    ))).toBe(true)
  })
})
