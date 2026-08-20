import type {
  RecordServiceDocumentActionRequest,
  ReviseServiceRequest,
  ServiceCorrectionRecord,
  ServiceDocumentAction,
  ServiceRefundRecord,
  ServiceRefundRoute,
  ServiceTransaction,
  ServiceTransactionQuery,
  ServiceWithdrawalRecord,
  ServiceWorkspaceState,
  SettlementRecord,
  SettlementTender,
  WithdrawServiceRequest,
} from './types'
import { assertAccountingOpen } from './personalRemittance'
import { assertTransactionMailCustodyReleased } from './mailCustody'
import {
  calculateServiceCharge,
  effectiveBusinessCode,
  validateServiceDraft,
} from './policy'
import { SERVICE_PRODUCTS } from './seed'
import { businessCalendarDay } from '../shared/businessTime'
import { requireOnSiteAuthorization } from '../access/workAuthorization'

function datedId(prefix: string, at: string, sequence: number): string {
  const date = businessCalendarDay(at).replaceAll('-', '')
  return `${prefix}-${date}-${String(sequence).padStart(6, '0')}`
}

function requiredReason(value: string): string {
  const reason = value.trim()
  if (!reason) throw new Error('请输入修改邮件原因。')
  return reason
}

function transactionById(
  state: ServiceWorkspaceState,
  transactionId: string,
): ServiceTransaction {
  const transaction = state.transactions.find((item) => item.id === transactionId)
  if (!transaction) throw new Error(`未找到收寄记录 ${transactionId}。`)
  if (transaction.status === 'withdrawn') {
    throw new Error(`${transactionId} 已撤销，不允许重复查改。`)
  }
  return transaction
}

function moneyChanged(
  previous: ServiceTransaction['charge'],
  corrected: ServiceTransaction['charge'],
): boolean {
  return previous.postageCents !== corrected.postageCents ||
    previous.returnReceiptCents !== corrected.returnReceiptCents ||
    previous.settlementDueCents !== corrected.settlementDueCents ||
    previous.stampSaleCents !== corrected.stampSaleCents ||
    previous.totalCents !== corrected.totalCents
}

function chargesMatch(
  left: ServiceTransaction['charge'],
  right: ServiceTransaction['charge'],
): boolean {
  return left.baseWeightCents === right.baseWeightCents &&
    left.additionalWeightCents === right.additionalWeightCents &&
    left.returnReceiptCents === right.returnReceiptCents &&
    left.postageCents === right.postageCents &&
    left.stampSaleCents === right.stampSaleCents &&
    left.settlementDueCents === right.settlementDueCents &&
    left.totalCents === right.totalCents
}

export function reviseServiceTransaction(
  state: ServiceWorkspaceState,
  request: ReviseServiceRequest,
): {
  state: ServiceWorkspaceState
  transaction: ServiceTransaction
  correction: ServiceCorrectionRecord
} {
  const current = transactionById(state, request.transactionId)
  assertAccountingOpen(state, request.operator ?? current.operator, request.correctedAt)
  const reason = requiredReason(request.reason)
  if (request.product.id !== current.product.id) {
    throw new Error('当前证据包不支持在查改中更换业务产品。')
  }
  if (
    current.service.returnReceiptRequested &&
    request.draft.returnReceiptRequested !== current.service.returnReceiptRequested
  ) {
    throw new Error('已办理回执的邮件不能在查改中取消回执。')
  }
  if (
    !current.service.returnReceiptRequested &&
    request.draft.returnReceiptRequested
  ) {
    throw new Error('回执只能随原邮件收寄办理，不能在查改中补办。')
  }
  if (
    current.service.returnReceiptRequested &&
    request.draft.itemCode.trim().toUpperCase() !== current.service.itemCode.trim().toUpperCase()
  ) {
    throw new Error('已办理回执的原邮件号码不能在查改中修改。')
  }
  if (
    current.service.returnReceiptRequested &&
    request.draft.destinationZone !== current.service.destinationZone
  ) {
    throw new Error('已办理回执的邮件不能在查改中变更区域。')
  }
  if (request.draft.productId !== current.product.id) {
    throw new Error('查改邮件信息与原业务产品不一致。')
  }
  const product = SERVICE_PRODUCTS.find((item) => item.id === current.product.id)
  if (!product) throw new Error('当前历史产品没有可验证的查改规则。')
  const validation = validateServiceDraft(
    request.draft,
    SERVICE_PRODUCTS,
    Boolean(request.customer.sender.agreementAccountId),
  )
  if (!validation.valid) {
    throw new Error(Object.values(validation.errors)[0] ?? '查改邮件信息校验失败。')
  }
  if (
    product.requiresRecipient &&
    (!request.customer.recipient.contact.trim() ||
      !request.customer.recipient.name.trim() ||
      !request.customer.recipient.detailedAddress.trim())
  ) {
    throw new Error('当前业务必须保留完整的收件联系电话、姓名和详细地址。')
  }
  const correctedCharge = calculateServiceCharge(request.draft, product)
  if (!chargesMatch(request.charge, correctedCharge)) {
    throw new Error('查改计费结果与业务规则不一致，请重新计费。')
  }
  if (current.status === 'settled' && moneyChanged(current.charge, correctedCharge)) {
    throw new Error('已结算邮件暂不允许修改影响资费或结算金额的字段。')
  }

  const correction: ServiceCorrectionRecord = {
    id: datedId('XG', request.correctedAt, state.nextCorrectionSequence),
    transactionId: current.id,
    correctedAt: request.correctedAt,
    correctedBy: structuredClone(request.operator ?? current.operator),
    reason,
    previousCustomer: structuredClone(current.customer),
    correctedCustomer: structuredClone(request.customer),
    previousService: structuredClone(current.service),
    correctedService: structuredClone(request.draft),
    previousCharge: structuredClone(current.charge),
    correctedCharge: structuredClone(correctedCharge),
  }
  const revised: ServiceTransaction = {
    ...current,
    customer: structuredClone(request.customer),
    product: {
      id: product.id,
      label: product.label,
      searchCode: product.searchCode,
      effectiveBusinessCode: effectiveBusinessCode(
        product,
        request.draft.destinationZone,
      ),
    },
    service: structuredClone(request.draft),
    charge: structuredClone(correctedCharge),
  }
  return {
    transaction: structuredClone(revised),
    correction: structuredClone(correction),
    state: {
      ...state,
      transactions: state.transactions.map((transaction) =>
        transaction.id === revised.id ? revised : transaction,
      ),
      corrections: [...state.corrections, correction],
      nextCorrectionSequence: state.nextCorrectionSequence + 1,
    },
  }
}

function refundRoute(tender: SettlementTender): ServiceRefundRoute {
  if (tender === 'third-party') return 'original-payment'
  if (tender === 'pos') return 'pos-terminal'
  if (tender === 'credit') return 'credit-account'
  return 'cash-desk'
}

function settlementFor(
  transaction: ServiceTransaction,
  settlements: SettlementRecord[],
): SettlementRecord | null {
  if (!transaction.settlementId) return null
  return settlements.find((settlement) => settlement.id === transaction.settlementId) ?? null
}

export function withdrawServiceTransactions(
  state: ServiceWorkspaceState,
  request: WithdrawServiceRequest,
): {
  state: ServiceWorkspaceState
  withdrawals: ServiceWithdrawalRecord[]
  refunds: ServiceRefundRecord[]
} {
  const transactionIds = [...new Set(request.transactionIds)]
  if (transactionIds.length === 0) throw new Error('请选择需要删除的收寄记录。')
  const reason = requiredReason(request.reason)
  const transactions = transactionIds.map((id) => transactionById(state, id))
  const operator = request.operator ?? transactions[0]!.operator
  const authorization = requireOnSiteAuthorization(
    request.authorization,
    'withdraw-service-transaction',
    operator.operatorId,
  )
  for (const transaction of transactions) {
    assertAccountingOpen(state, request.operator ?? transaction.operator, request.withdrawnAt)
    assertTransactionMailCustodyReleased(state, transaction.id, '撤销收寄')
    if (transaction.status === 'settled' && !settlementFor(transaction, state.settlements)) {
      throw new Error(`${transaction.id} 缺少结算记录，不能生成退款记录。`)
    }
  }

  const withdrawals = transactions.map((transaction, index): ServiceWithdrawalRecord => ({
    id: datedId('CX', request.withdrawnAt, state.nextWithdrawalSequence + index),
    transactionId: transaction.id,
    withdrawnAt: request.withdrawnAt,
    withdrawnBy: structuredClone(request.operator ?? transaction.operator),
    reason,
    authorizedBy: authorization.authorizerId,
  }))
  const refunds: ServiceRefundRecord[] = []
  for (const transaction of transactions) {
    const settlement = settlementFor(transaction, state.settlements)
    const refundAmount = settlement?.tender === 'credit'
      ? transaction.charge.postageCents
      : transaction.charge.settlementDueCents
    if (!settlement || refundAmount <= 0) continue
    refunds.push({
      id: datedId('TK', request.withdrawnAt, state.nextRefundSequence + refunds.length),
      transactionId: transaction.id,
      settlementId: settlement.id,
      createdAt: request.withdrawnAt,
      amountCents: refundAmount,
      originalTender: settlement.tender,
      route: refundRoute(settlement.tender),
      status: settlement.tender === 'third-party'
        ? 'application-required'
        : 'pending',
      requestedAt: settlement.tender === 'third-party'
        ? null
        : request.withdrawnAt,
      requestedBy: null,
      processedAt: null,
      processedBy: null,
      platformRefundId: '',
      failureReason: '',
    })
  }
  const idSet = new Set(transactionIds)
  return {
    withdrawals: structuredClone(withdrawals),
    refunds: structuredClone(refunds),
    state: {
      ...state,
      transactions: state.transactions.map((transaction) =>
        idSet.has(transaction.id)
          ? { ...transaction, status: 'withdrawn' as const }
          : transaction,
      ),
      returnReceipts: state.returnReceipts.map((receipt) =>
        idSet.has(receipt.transactionId) && receipt.status !== 'returned'
          ? { ...receipt, status: 'cancelled' as const }
          : receipt,
      ),
      withdrawals: [...state.withdrawals, ...withdrawals],
      refunds: [...state.refunds, ...refunds],
      nextWithdrawalSequence: state.nextWithdrawalSequence + withdrawals.length,
      nextRefundSequence: state.nextRefundSequence + refunds.length,
    },
  }
}

export function recordServiceDocumentAction(
  state: ServiceWorkspaceState,
  request: RecordServiceDocumentActionRequest,
): { state: ServiceWorkspaceState; action: ServiceDocumentAction } {
  transactionById(state, request.transactionId)
  const action: ServiceDocumentAction = {
    id: datedId('DJ', request.requestedAt, state.nextDocumentActionSequence),
    transactionId: request.transactionId,
    kind: request.kind,
    requestedAt: request.requestedAt,
  }
  return {
    action: structuredClone(action),
    state: {
      ...state,
      documentActions: [...state.documentActions, action],
      nextDocumentActionSequence: state.nextDocumentActionSequence + 1,
    },
  }
}

function datePart(value: string): string {
  return businessCalendarDay(value)
}

function includesNormalized(value: string, query: string): boolean {
  return value.toLocaleLowerCase('zh-CN').includes(query.trim().toLocaleLowerCase('zh-CN'))
}

export function queryServiceTransactions(
  state: ServiceWorkspaceState,
  query: ServiceTransactionQuery,
): ServiceTransaction[] {
  const hasSerialQuery = Boolean(query.querySerial.trim())
  const matches = state.transactions.filter((transaction) => {
    if (query.dataType === 'all' && transaction.status === 'withdrawn') return false
    if (query.dataType !== 'all' && transaction.status !== query.dataType) return false
    if (
      query.querySerial &&
      !includesNormalized(transaction.id, query.querySerial) &&
      !includesNormalized(transaction.sourceBatchId ?? '', query.querySerial) &&
      !includesNormalized(transaction.sourceOrderNumber ?? '', query.querySerial)
    ) return false
    if (
      query.productCode &&
      !includesNormalized(transaction.product.searchCode, query.productCode) &&
      !includesNormalized(transaction.product.effectiveBusinessCode, query.productCode) &&
      !includesNormalized(transaction.product.label, query.productCode)
    ) return false
    if (query.itemCode && !includesNormalized(transaction.service.itemCode, query.itemCode)) return false
    if (query.paymentMethod && transaction.service.paymentMethod !== query.paymentMethod) return false
    if (query.operatorId && !includesNormalized(transaction.operator.operatorId, query.operatorId)) return false
    if (
      query.workstationCode &&
      !includesNormalized(transaction.operator.workstationCode, query.workstationCode)
    ) return false

    const acceptedDate = datePart(transaction.acceptedAt)
    if (!hasSerialQuery && query.acceptedDateFrom && acceptedDate < query.acceptedDateFrom) return false
    if (!hasSerialQuery && query.acceptedDateTo && acceptedDate > query.acceptedDateTo) return false

    if (query.settledDateFrom || query.settledDateTo) {
      const settlement = settlementFor(transaction, state.settlements)
      if (!settlement) return false
      const settledDate = datePart(settlement.settledAt)
      if (query.settledDateFrom && settledDate < query.settledDateFrom) return false
      if (query.settledDateTo && settledDate > query.settledDateTo) return false
    }
    return true
  })
  return [...matches].sort((left, right) =>
    query.sort === 'accepted-asc'
      ? left.acceptedAt.localeCompare(right.acceptedAt)
      : right.acceptedAt.localeCompare(left.acceptedAt),
  )
}
