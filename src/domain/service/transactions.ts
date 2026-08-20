import type {
  AcceptPostalSupplySaleRequest,
  AcceptServiceRequest,
  PostalSupplySaleLine,
  PostalSupplySale,
  ServiceOperatorSnapshot,
  ServiceTransaction,
  ServiceWorkspaceState,
  SettleServiceRequest,
  SettlementRecord,
} from './types'
import { effectiveBusinessCode } from './policy'
import { validateAppointmentAcceptance } from './appointmentCollection'
import { createReturnReceiptRecord } from './returnReceipt'
import { POSTAL_SUPPLY_ITEMS } from './seed'
import { postalSupplyEmployeeInventory } from './postalSupplyManagement'
import { assertAccountingOpen } from './personalRemittance'
import { businessCalendarDay } from '../shared/businessTime'
import { DEFAULT_SERVICE_INSTITUTION_CODE } from './institutionScope'

export const DEFAULT_SERVICE_OPERATOR: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '瀚原示范营业所',
  receivingOffice: '虚构寄达局',
  institutionCode: DEFAULT_SERVICE_INSTITUTION_CODE,
}

function transactionId(acceptedAt: string, sequence: number): string {
  const date = businessCalendarDay(acceptedAt).replaceAll('-', '')
  return `SIM-${date}-${String(sequence).padStart(6, '0')}`
}

function settlementId(settledAt: string, sequence: number): string {
  const date = businessCalendarDay(settledAt).replaceAll('-', '')
  return `JS-${date}-${String(sequence).padStart(6, '0')}`
}

function postalSupplySaleId(acceptedAt: string, sequence: number): string {
  const date = businessCalendarDay(acceptedAt).replaceAll('-', '')
  return `YP-${date}-${String(sequence).padStart(6, '0')}`
}

export interface PendingServiceSummary {
  count: number
  totalCents: number
}

export function pendingServiceSummary(
  state: ServiceWorkspaceState,
): PendingServiceSummary {
  const mail = state.transactions.filter(
    (transaction) => transaction.status === 'pending-settlement',
  )
  const supplies = state.postalSupplySales.filter(
    (sale) => sale.status === 'pending-settlement',
  )
  const channelProducts = state.channelProductOrders.filter(
    (order) => order.status === 'pending-settlement',
  )
  const supplementaryTraffic = state.supplementaryTrafficRecords.filter(
    (record) => record.status === 'pending-settlement',
  )
  const electronicCommerce = state.electronicCommerceRecords.filter(
    (record) => record.status === 'pending-settlement',
  )
  const bulkBatches = state.bulkBatches.filter(
    (batch) => batch.settlementStatus === 'unsettled',
  )
  return {
    count: mail.length + supplies.length + channelProducts.length + supplementaryTraffic.length
      + electronicCommerce.length + bulkBatches.length,
    totalCents:
      mail.reduce(
        (total, transaction) => total + transaction.charge.settlementDueCents,
        0,
      ) + supplies.reduce((total, sale) => total + sale.totalCents, 0)
      + channelProducts.reduce((total, order) => total + order.totalCents, 0)
      + supplementaryTraffic.reduce((total, record) => total + record.amountCents, 0)
      + electronicCommerce.reduce((total, record) => total + record.amountCents, 0)
      + bulkBatches.reduce((total, batch) => (
        total + Math.max(0, batch.totalSettlementDueCents - batch.couponDiscountCents)
      ), 0),
  }
}

export function remainingPostalSupplyStock(
  state: ServiceWorkspaceState,
  itemId: string,
  employeeId = DEFAULT_SERVICE_OPERATOR.operatorId,
): number {
  return postalSupplyEmployeeInventory(state, itemId, employeeId)
}

export function serviceContentStockError(
  state: ServiceWorkspaceState,
  lines: PostalSupplySaleLine[],
): string | null {
  if (lines.length === 0) return '请至少选择一种用邮物品。'
  if (new Set(lines.map((line) => line.itemId)).size !== lines.length) {
    return '同一种用邮物品只能保留一行，请修改数量。'
  }
  for (const line of lines) {
    const item = POSTAL_SUPPLY_ITEMS.find(
      (candidate) => candidate.id === line.itemId,
    )
    if (!item) return `未找到用邮物品 ${line.itemId}。`
    const remaining = remainingPostalSupplyStock(state, item.id)
    if (
      line.label !== item.label ||
      line.mnemonic !== item.mnemonic ||
      line.unit !== item.unit ||
      line.unitPriceCents !== item.unitPriceCents ||
      line.amountCents !== item.unitPriceCents * line.quantity
    ) {
      return `${item.label}的目录信息已变化，请重新选择后保存。`
    }
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > remaining
    ) {
      return `${item.label}数量须为 1 至 ${remaining} 的整数。`
    }
  }
  return null
}

export function acceptServiceTransaction(
  state: ServiceWorkspaceState,
  request: AcceptServiceRequest,
): { state: ServiceWorkspaceState; transaction: ServiceTransaction } {
  const operator = structuredClone(request.operator ?? DEFAULT_SERVICE_OPERATOR)
  assertAccountingOpen(state, operator, request.acceptedAt)
  validateAppointmentAcceptance(state, request)
  if (request.product.searchCode === '301') {
    const contentError = serviceContentStockError(
      state,
      request.draft.contentItems,
    )
    if (contentError) throw new Error(contentError)
  }
  const transaction: ServiceTransaction = {
    id: transactionId(request.acceptedAt, state.nextSequence),
    source: request.draft.appointment ? 'appointment' : 'counter',
    sourceBatchId: null,
    sourceOrderNumber: request.draft.appointment?.orderNumber ?? null,
    status: 'pending-settlement',
    acceptedAt: request.acceptedAt,
    operator,
    customer: structuredClone(request.customer),
    product: {
      id: request.product.id,
      label: request.product.label,
      searchCode: request.product.searchCode,
      effectiveBusinessCode: effectiveBusinessCode(
        request.product,
        request.draft.destinationZone,
      ),
    },
    service: structuredClone(request.draft),
    charge: structuredClone(request.charge),
    settlementId: null,
  }
  const returnReceipt = createReturnReceiptRecord(state, transaction, request.product)
  return {
    transaction,
    state: {
      ...state,
      draft: null,
      transactions: [...state.transactions, transaction],
      returnReceipts: returnReceipt
        ? [...state.returnReceipts, returnReceipt]
        : state.returnReceipts,
      nextSequence: state.nextSequence + 1,
      nextReturnReceiptSequence: state.nextReturnReceiptSequence + (returnReceipt ? 1 : 0),
    },
  }
}

export function acceptPostalSupplySale(
  state: ServiceWorkspaceState,
  request: AcceptPostalSupplySaleRequest,
): { state: ServiceWorkspaceState; sale: PostalSupplySale } {
  if (request.lines.length === 0) throw new Error('请至少增加一种用邮物品。')
  const uniqueIds = new Set(request.lines.map((line) => line.itemId))
  if (uniqueIds.size !== request.lines.length) {
    throw new Error('同一种用邮物品只能保留一行，请修改数量。')
  }

  const operator = structuredClone(request.operator ?? DEFAULT_SERVICE_OPERATOR)
  assertAccountingOpen(state, operator, request.acceptedAt)
  const lines = request.lines.map((draftLine) => {
    const item = POSTAL_SUPPLY_ITEMS.find(
      (candidate) => candidate.id === draftLine.itemId,
    )
    if (!item) throw new Error(`未找到用邮物品 ${draftLine.itemId}。`)
    const remaining = remainingPostalSupplyStock(state, item.id, operator.operatorId)
    if (
      !Number.isInteger(draftLine.quantity) ||
      draftLine.quantity < 1 ||
      draftLine.quantity > remaining
    ) {
      throw new Error(`${item.label}数量须为 1 至 ${remaining} 的整数。`)
    }
    return {
      itemId: item.id,
      label: item.label,
      mnemonic: item.mnemonic,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      quantity: draftLine.quantity,
      amountCents: item.unitPriceCents * draftLine.quantity,
    }
  })
  const totalCents = lines.reduce((total, line) => total + line.amountCents, 0)
  const sale: PostalSupplySale = {
    id: postalSupplySaleId(request.acceptedAt, state.nextPostalSupplySequence),
    status: 'pending-settlement',
    acceptedAt: request.acceptedAt,
    operator,
    sender: structuredClone(request.sender),
    lines,
    totalCents,
    settlementId: null,
    revisions: [],
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    receiptPrintedAt: [],
  }
  return {
    sale,
    state: {
      ...state,
      postalSupplySales: [...state.postalSupplySales, sale],
      nextPostalSupplySequence: state.nextPostalSupplySequence + 1,
    },
  }
}

export function settleServiceTransactions(
  state: ServiceWorkspaceState,
  request: SettleServiceRequest,
): { state: ServiceWorkspaceState; settlement: SettlementRecord } {
  const requestedIds = [...new Set(request.transactionIds)]
  if (requestedIds.length === 0) throw new Error('请选择待结算业务。')

  const selected = requestedIds.map((id) => {
    const transaction = state.transactions.find((item) => item.id === id)
    const supplySale = state.postalSupplySales.find((item) => item.id === id)
    const channelProductOrder = state.channelProductOrders.find((item) => item.id === id)
    const supplementaryTrafficRecord = state.supplementaryTrafficRecords.find((item) => item.id === id)
    const electronicCommerceRecord = state.electronicCommerceRecords.find((item) => item.id === id)
    if (!transaction && !supplySale && !channelProductOrder && !supplementaryTrafficRecord && !electronicCommerceRecord) {
      throw new Error(`未找到待结算业务 ${id}。`)
    }
    const sourceOperator = transaction?.operator ?? supplySale?.operator
      ?? channelProductOrder?.operator ?? supplementaryTrafficRecord?.operator
      ?? electronicCommerceRecord?.operator
    if (sourceOperator) assertAccountingOpen(state, sourceOperator, request.settledAt)
    const status = transaction?.status ?? supplySale?.status ?? channelProductOrder?.status
      ?? supplementaryTrafficRecord?.status ?? electronicCommerceRecord?.status
    if (status !== 'pending-settlement') {
      throw new Error(`${id} 已结算，结算结果不可回退。`)
    }
    if (
      transaction?.source === 'self-service-import' &&
      request.tender !== 'credit'
    ) {
      throw new Error('客户自助导入邮件必须从对应批次进入记欠结算。')
    }
    if (supplementaryTrafficRecord?.paymentMethod === 'credit' && request.tender !== 'credit') {
      throw new Error('付费方式为记欠的补录/交管业务必须选择记欠结算。')
    }
    if (request.tender === 'credit') {
      const creditEligible = transaction?.service.paymentMethod === 'credit'
        || supplementaryTrafficRecord?.paymentMethod === 'credit'
      if (!creditEligible) {
        throw new Error('记欠结算只允许处理付费方式为记欠的业务。')
      }
      return {
        id,
        amountDueCents: transaction?.charge.postageCents
          ?? supplementaryTrafficRecord!.amountCents,
      }
    }
    return transaction
      ? { id, amountDueCents: transaction.charge.settlementDueCents }
      : {
          id,
          amountDueCents: supplySale?.totalCents
            ?? channelProductOrder?.totalCents
            ?? supplementaryTrafficRecord?.amountCents
            ?? electronicCommerceRecord!.amountCents,
        }
  })
  const amountDueCents = selected.reduce(
    (total, item) => total + item.amountDueCents,
    0,
  )
  if (request.tender === 'credit' && request.amountReceivedCents !== 0) {
    throw new Error('记欠结算的现结实收金额必须为 0。')
  }
  if (
    request.tender !== 'credit' &&
    (!Number.isInteger(request.amountReceivedCents) || request.amountReceivedCents < amountDueCents)
  ) {
    throw new Error(`实收金额不得少于 ${amountDueCents} 分。`)
  }
  if (
    request.tender !== 'cash' &&
    request.tender !== 'credit' &&
    request.amountReceivedCents !== amountDueCents
  ) {
    throw new Error('第三方支付和 POS 支付的实收金额必须等于应收金额。')
  }

  const id = settlementId(request.settledAt, state.nextSettlementSequence)
  const settlement: SettlementRecord = {
    id,
    transactionIds: requestedIds,
    tender: request.tender,
    settledAt: request.settledAt,
    amountDueCents,
    amountReceivedCents: request.amountReceivedCents,
    changeCents: request.tender === 'credit'
      ? 0
      : request.amountReceivedCents - amountDueCents,
    invoiceRequested: null,
  }
  const idSet = new Set(requestedIds)
  return {
    settlement,
    state: {
      ...state,
      transactions: state.transactions.map((transaction) =>
        idSet.has(transaction.id)
          ? { ...transaction, status: 'settled', settlementId: id }
          : transaction,
      ),
      postalSupplySales: state.postalSupplySales.map((sale) =>
        idSet.has(sale.id)
          ? { ...sale, status: 'settled', settlementId: id }
          : sale,
      ),
      channelProductOrders: state.channelProductOrders.map((order) =>
        idSet.has(order.id)
          ? { ...order, status: 'settled', settlementId: id }
          : order,
      ),
      supplementaryTrafficRecords: state.supplementaryTrafficRecords.map((record) =>
        idSet.has(record.id)
          ? { ...record, status: 'settled', settlementId: id }
          : record,
      ),
      electronicCommerceRecords: state.electronicCommerceRecords.map((record) =>
        idSet.has(record.id)
          ? { ...record, status: 'settled', settlementId: id }
          : record,
      ),
      settlements: [...state.settlements, settlement],
      nextSettlementSequence: state.nextSettlementSequence + 1,
    },
  }
}

export function recordInvoiceDecision(
  state: ServiceWorkspaceState,
  settlementIdValue: string,
  requested: boolean,
): ServiceWorkspaceState {
  const target = state.settlements.find((item) => item.id === settlementIdValue)
  if (!target) throw new Error('未找到结算记录。')
  if (target.invoiceRequested !== null) throw new Error('发票选择已经记录。')
  return {
    ...state,
    settlements: state.settlements.map((item) =>
      item.id === settlementIdValue
        ? { ...item, invoiceRequested: requested }
        : item,
    ),
  }
}
