import { paymentMethodLabel, yuanToCents } from './policy'
import { businessCalendarDay } from '../shared/businessTime'
import {
  requireOnSiteAuthorization,
  type OnSiteAuthorization,
} from '../access/workAuthorization'
import type {
  BulkBatch,
  BulkInvoiceBuyerType,
  FiscalInvoiceBusinessLine,
  FiscalInvoiceRecord,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
  SettlementRecord,
} from './types'

export interface FiscalInvoiceRegistrationDraft {
  buyerType: BulkInvoiceBuyerType
  buyerName: string
  taxpayerId: string
  deliveryPhone: string
  buyerPhone: string
  deliveryEmail: string
  buyerAddress: string
  bankName: string
  bankAccount: string
  reviewer: string
  remark: string
}

export type InvoiceManagementCommand =
  | {
      type: 'issue-settlement-invoice'
      settlementId: string
      issuedAt: string
      operator: ServiceOperatorSnapshot
      registration: FiscalInvoiceRegistrationDraft
    }
  | {
      type: 'record-invoice-delivery'
      invoiceId: string
      requested: boolean
      decidedAt: string
    }
  | {
      type: 'red-flush-invoice'
      invoiceId: string
      redFlushedAt: string
      operator: ServiceOperatorSnapshot
      authorization: OnSiteAuthorization
    }

export interface InvoiceManagementResult {
  state: ServiceWorkspaceState
  invoice: FiscalInvoiceRecord
}

function invoiceId(issuedAt: string, sequence: number): string {
  const date = businessCalendarDay(issuedAt).replaceAll('-', '')
  return `FP-${date}-${String(sequence).padStart(6, '0')}`
}

function invoiceCode(issuedAt: string): string {
  return `SIM${issuedAt.slice(2, 7).replaceAll('-', '')}`
}

function required(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label}不能为空。`)
  return normalized
}

function normalizeRegistration(
  registration: FiscalInvoiceRegistrationDraft,
): FiscalInvoiceRegistrationDraft {
  const deliveryPhone = registration.deliveryPhone.trim()
  const deliveryEmail = registration.deliveryEmail.trim()
  if (!deliveryPhone && !deliveryEmail) {
    throw new Error('交付电话和交付邮箱至少填写一项。')
  }
  return {
    buyerType: registration.buyerType,
    buyerName: required(registration.buyerName, '购方名称'),
    taxpayerId: required(registration.taxpayerId, '购方纳税人识别号'),
    deliveryPhone,
    buyerPhone: registration.buyerPhone.trim(),
    deliveryEmail,
    buyerAddress: registration.buyerAddress.trim(),
    bankName: registration.bankName.trim(),
    bankAccount: registration.bankAccount.trim(),
    reviewer: registration.reviewer.trim(),
    remark: registration.remark.trim(),
  }
}

function settlementById(
  state: ServiceWorkspaceState,
  settlementIdValue: string,
): SettlementRecord {
  const settlement = state.settlements.find((candidate) => candidate.id === settlementIdValue)
  if (!settlement) throw new Error('未找到结算记录。')
  return settlement
}

function settlementBusinessLines(
  state: ServiceWorkspaceState,
  settlement: SettlementRecord,
): FiscalInvoiceBusinessLine[] {
  return settlement.transactionIds.flatMap((sourceId): FiscalInvoiceBusinessLine[] => {
    const transaction = state.transactions.find((candidate) => candidate.id === sourceId)
    if (transaction) {
      return [{
        sourceTransactionId: transaction.id,
        productName: transaction.product.label,
        itemCode: transaction.service.itemCode,
        paymentMethod: paymentMethodLabel(transaction.service.paymentMethod),
        itemName: transaction.service.contents || transaction.product.label,
        quantity: transaction.service.quantity,
        amountCents: transaction.charge.settlementDueCents,
        stampAmountCents: transaction.charge.stampSaleCents,
      }]
    }

    const supplySale = state.postalSupplySales.find((candidate) => candidate.id === sourceId)
    if (supplySale) {
      return supplySale.lines.map((line) => ({
        sourceTransactionId: supplySale.id,
        productName: '用邮物品',
        itemCode: '',
        paymentMethod: '现结',
        itemName: line.label,
        quantity: line.quantity,
        amountCents: line.amountCents,
        stampAmountCents: 0,
      }))
    }

    const channelOrder = state.channelProductOrders.find((candidate) => candidate.id === sourceId)
    if (channelOrder) {
      return channelOrder.lines.map((line) => ({
        sourceTransactionId: channelOrder.id,
        productName: '渠道商品',
        itemCode: line.skuCode,
        paymentMethod: '现结',
        itemName: `${line.productLabel}·${line.skuLabel}`,
        quantity: line.quantity,
        amountCents: line.amountCents,
        stampAmountCents: 0,
      }))
    }

    const traffic = state.supplementaryTrafficRecords.find((candidate) => candidate.id === sourceId)
    if (traffic) {
      const productName = traffic.kind === 'supplementary-income'
        ? traffic.subjectLabel
        : traffic.mail.productLabel
      const itemCodeValue = traffic.kind === 'supplementary-income'
        ? traffic.subjectCode
        : traffic.mail.mailNumber
      return [{
        sourceTransactionId: traffic.id,
        productName,
        itemCode: itemCodeValue,
        paymentMethod: paymentMethodLabel(traffic.paymentMethod),
        itemName: productName,
        quantity: traffic.kind === 'supplementary-income' ? traffic.count : 1,
        amountCents: traffic.amountCents,
        stampAmountCents: 0,
      }]
    }

    const electronic = state.electronicCommerceRecords.find((candidate) => candidate.id === sourceId)
    if (electronic) {
      return [{
        sourceTransactionId: electronic.id,
        productName: electronic.kind === 'utility-payment' ? '生活缴费' : '话费充值',
        itemCode: electronic.accountNumber,
        paymentMethod: '现结',
        itemName: `${electronic.providerLabel}·${electronic.projectLabel}`,
        quantity: 1,
        amountCents: electronic.amountCents,
        stampAmountCents: 0,
      }]
    }
    return []
  })
}

function createInvoice(
  state: ServiceWorkspaceState,
  sourceKind: FiscalInvoiceRecord['sourceKind'],
  sourceId: string,
  issuedAt: string,
  operator: ServiceOperatorSnapshot,
  registration: FiscalInvoiceRegistrationDraft,
  businessLines: FiscalInvoiceBusinessLine[],
  totalCents: number,
): FiscalInvoiceRecord {
  if (!issuedAt.trim()) throw new Error('开票时间不能为空。')
  if (businessLines.length === 0) throw new Error('当前记录没有可开票的业务明细。')
  const normalized = normalizeRegistration(registration)
  return {
    id: invoiceId(issuedAt, state.nextFiscalInvoiceSequence),
    sourceKind,
    sourceId,
    invoiceCode: invoiceCode(issuedAt),
    invoiceNumber: String(state.nextFiscalInvoiceSequence).padStart(8, '0'),
    issuedAt,
    issuedBy: structuredClone(operator),
    ...normalized,
    deliveryRequested: null,
    deliveredAt: null,
    totalCents,
    status: 'issued',
    redFlushedAt: null,
    redFlushedBy: null,
    redFlushAuthorizedBy: null,
    businessLines: structuredClone(businessLines),
  }
}

function replaceInvoice(
  state: ServiceWorkspaceState,
  invoice: FiscalInvoiceRecord,
): InvoiceManagementResult {
  return {
    invoice: structuredClone(invoice),
    state: {
      ...state,
      fiscalInvoices: state.fiscalInvoices.map((candidate) =>
        candidate.id === invoice.id ? invoice : candidate,
      ),
    },
  }
}

function issueSettlementInvoice(
  state: ServiceWorkspaceState,
  command: Extract<InvoiceManagementCommand, { type: 'issue-settlement-invoice' }>,
): InvoiceManagementResult {
  const settlement = settlementById(state, command.settlementId)
  const existing = state.fiscalInvoices.find((candidate) =>
    candidate.sourceKind === 'settlement' && candidate.sourceId === settlement.id,
  )
  if (existing) throw new Error('该结算记录已经开具发票。')
  const invoice = createInvoice(
    state,
    'settlement',
    settlement.id,
    command.issuedAt,
    command.operator,
    command.registration,
    settlementBusinessLines(state, settlement),
    settlement.amountDueCents,
  )
  return {
    invoice: structuredClone(invoice),
    state: {
      ...state,
      settlements: state.settlements.map((candidate) =>
        candidate.id === settlement.id ? { ...candidate, invoiceRequested: true } : candidate,
      ),
      fiscalInvoices: [...state.fiscalInvoices, invoice],
      nextFiscalInvoiceSequence: state.nextFiscalInvoiceSequence + 1,
    },
  }
}

function recordDelivery(
  state: ServiceWorkspaceState,
  command: Extract<InvoiceManagementCommand, { type: 'record-invoice-delivery' }>,
): InvoiceManagementResult {
  const target = state.fiscalInvoices.find((candidate) => candidate.id === command.invoiceId)
  if (!target) throw new Error('未找到发票记录。')
  if (target.status !== 'issued') throw new Error('已冲红发票不能再次交付。')
  if (target.deliveryRequested !== null) throw new Error('发票交付选择已经记录。')
  return replaceInvoice(state, {
    ...target,
    deliveryRequested: command.requested,
    deliveredAt: command.requested ? command.decidedAt : null,
  })
}

function redFlush(
  state: ServiceWorkspaceState,
  command: Extract<InvoiceManagementCommand, { type: 'red-flush-invoice' }>,
): InvoiceManagementResult {
  const target = state.fiscalInvoices.find((candidate) => candidate.id === command.invoiceId)
  if (!target) throw new Error('未找到发票记录。')
  if (target.status === 'red-flushed') throw new Error('该发票已经冲红。')
  const authorization = requireOnSiteAuthorization(
    command.authorization,
    'red-flush-invoice',
    command.operator.operatorId,
  )
  return replaceInvoice(state, {
    ...target,
    status: 'red-flushed',
    redFlushedAt: command.redFlushedAt,
    redFlushedBy: structuredClone(command.operator),
    redFlushAuthorizedBy: authorization.authorizerId,
  })
}

export function executeInvoiceManagementCommand(
  state: ServiceWorkspaceState,
  command: InvoiceManagementCommand,
): InvoiceManagementResult {
  if (command.type === 'issue-settlement-invoice') {
    return issueSettlementInvoice(state, command)
  }
  if (command.type === 'record-invoice-delivery') return recordDelivery(state, command)
  return redFlush(state, command)
}

function bulkBusinessLines(batch: BulkBatch): FiscalInvoiceBusinessLine[] {
  return batch.rows.filter((row) => row.status === 'success').map((row) => ({
    sourceTransactionId: `${batch.id}:${row.recordSequence}`,
    productName: batch.product.label,
    itemCode: row.allocatedItemCode,
    paymentMethod: paymentMethodLabel(batch.paymentMethod),
    itemName: row.contents || batch.commonRemarkLabel || batch.product.label,
    quantity: 1,
    amountCents: row.settlementDueCents,
    stampAmountCents: yuanToCents(row.affixedPostage || 0),
  }))
}

export function syncBulkFiscalInvoice(
  state: ServiceWorkspaceState,
  batch: BulkBatch,
): ServiceWorkspaceState {
  const registration = batch.invoiceRegistration
  if (!registration) return state
  const existing = state.fiscalInvoices.find((candidate) =>
    candidate.sourceKind === 'bulk' && candidate.sourceId === batch.id,
  )
  const registrationDraft: FiscalInvoiceRegistrationDraft = {
    buyerType: registration.buyerType,
    buyerName: registration.buyerName,
    taxpayerId: registration.taxpayerId,
    deliveryPhone: registration.deliveryPhone,
    buyerPhone: registration.buyerPhone,
    deliveryEmail: registration.deliveryEmail,
    buyerAddress: registration.buyerAddress,
    bankName: registration.bankName,
    bankAccount: registration.bankAccount,
    reviewer: registration.reviewer,
    remark: registration.remark,
  }
  if (existing) {
    return {
      ...state,
      fiscalInvoices: state.fiscalInvoices.map((candidate) => candidate.id === existing.id
        ? {
            ...candidate,
            ...normalizeRegistration(registrationDraft),
            deliveryRequested: registration.deliveryRequested,
            deliveredAt: registration.deliveredAt,
          }
        : candidate),
    }
  }
  const invoice = createInvoice(
    state,
    'bulk',
    batch.id,
    registration.issuedAt,
    batch.operator,
    registrationDraft,
    bulkBusinessLines(batch),
    Math.max(0, batch.totalSettlementDueCents - batch.couponDiscountCents),
  )
  return {
    ...state,
    fiscalInvoices: [...state.fiscalInvoices, {
      ...invoice,
      deliveryRequested: registration.deliveryRequested,
      deliveredAt: registration.deliveredAt,
    }],
    nextFiscalInvoiceSequence: state.nextFiscalInvoiceSequence + 1,
  }
}
