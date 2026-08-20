import { describe, expect, it } from 'vitest'

import { DEMO_MANAGEMENT_OPERATOR_ID } from '../access/seed'
import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { calculateServiceCharge } from './policy'
import { createEmptyRecipient, createEmptySender } from '../customer/seed'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import {
  executeInvoiceManagementCommand,
  type FiscalInvoiceRegistrationDraft,
} from './invoiceManagement'
import { acceptServiceTransaction, settleServiceTransactions } from './transactions'

const OPERATOR = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '虚构寄达局',
}

const REGISTRATION: FiscalInvoiceRegistrationDraft = {
  buyerType: 'organization',
  buyerName: '星河合作社',
  taxpayerId: 'SIM-TAX-0001',
  deliveryPhone: '10000000001',
  buyerPhone: '10000000001',
  deliveryEmail: '',
  buyerAddress: '瀚原省栖沄市景麓区示范路 1 号',
  bankName: '示范银行',
  bankAccount: 'SIM-ACCOUNT-001',
  reviewer: '林川',
  remark: '窗口业务',
}

function settledState() {
  const product = SERVICE_PRODUCTS[0]!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    itemCode: '7000818316568',
    weightGrams: 20,
  }
  const accepted = acceptServiceTransaction(createServiceSeedState(), {
    acceptedAt: '2026-01-15T09:20:00.000Z',
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: {
        ...createEmptySender(),
        name: '周清禾',
        unit: '星河合作社',
        contact: '10000000001',
        identityValue: 'SIM-TAX-0001',
      },
      recipient: createEmptyRecipient(),
    },
    draft,
    product,
    operator: OPERATOR,
  })
  return settleServiceTransactions(accepted.state, {
    transactionIds: [accepted.transaction.id],
    tender: 'cash',
    settledAt: '2026-01-15T09:30:00.000Z',
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
}

describe('invoice management', () => {
  it('issues, delivers and authorized staff red-flushes one shared invoice record', async () => {
    const settled = settledState()
    const issued = executeInvoiceManagementCommand(settled.state, {
      type: 'issue-settlement-invoice',
      settlementId: settled.settlement.id,
      issuedAt: '2026-01-15T10:00:00.000Z',
      operator: OPERATOR,
      registration: REGISTRATION,
    })

    expect(issued.invoice).toMatchObject({
      id: 'FP-20260115-000001',
      sourceKind: 'settlement',
      sourceId: 'JS-20260115-000001',
      invoiceCode: 'SIM2601',
      invoiceNumber: '00000001',
      status: 'issued',
      buyerName: '星河合作社',
      totalCents: 80,
      businessLines: [{
        sourceTransactionId: 'SIM-20260115-000001',
        itemCode: '7000818316568',
        quantity: 1,
        amountCents: 80,
      }],
    })
    expect(issued.state.settlements[0]?.invoiceRequested).toBe(true)
    expect(issued.state.nextFiscalInvoiceSequence).toBe(2)

    const delivered = executeInvoiceManagementCommand(issued.state, {
      type: 'record-invoice-delivery',
      invoiceId: issued.invoice.id,
      requested: true,
      decidedAt: '2026-01-15T10:01:00.000Z',
    })
    expect(delivered.invoice).toMatchObject({
      deliveryRequested: true,
      deliveredAt: '2026-01-15T10:01:00.000Z',
    })

    expect(() => executeInvoiceManagementCommand(delivered.state, {
      type: 'red-flush-invoice',
      invoiceId: issued.invoice.id,
      redFlushedAt: '2026-01-15T10:02:00.000Z',
      operator: OPERATOR,
      authorization: undefined!,
    })).toThrow('真实账号现场授权')

    const authorization = await createTestOnSiteAuthorization('red-flush-invoice')
    const redFlushed = executeInvoiceManagementCommand(delivered.state, {
      type: 'red-flush-invoice',
      invoiceId: issued.invoice.id,
      redFlushedAt: '2026-01-15T10:02:00.000Z',
      operator: OPERATOR,
      authorization,
    })
    expect(redFlushed.invoice).toMatchObject({
      status: 'red-flushed',
      redFlushedAt: '2026-01-15T10:02:00.000Z',
      redFlushAuthorizedBy: DEMO_MANAGEMENT_OPERATOR_ID,
    })
  })

  it('requires purchaser identity, one delivery channel and a unique invoice per settlement', () => {
    const settled = settledState()
    expect(() => executeInvoiceManagementCommand(settled.state, {
      type: 'issue-settlement-invoice',
      settlementId: settled.settlement.id,
      issuedAt: '2026-01-15T10:00:00.000Z',
      operator: OPERATOR,
      registration: { ...REGISTRATION, deliveryPhone: '', deliveryEmail: '' },
    })).toThrow('至少填写一项')

    const issued = executeInvoiceManagementCommand(settled.state, {
      type: 'issue-settlement-invoice',
      settlementId: settled.settlement.id,
      issuedAt: '2026-01-15T10:00:00.000Z',
      operator: OPERATOR,
      registration: REGISTRATION,
    })
    expect(() => executeInvoiceManagementCommand(issued.state, {
      type: 'issue-settlement-invoice',
      settlementId: settled.settlement.id,
      issuedAt: '2026-01-15T10:03:00.000Z',
      operator: OPERATOR,
      registration: REGISTRATION,
    })).toThrow('已经开具发票')
  })
})
