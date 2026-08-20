import {
  requireOnSiteAuthorization,
  type OnSiteAuthorization,
} from '../access/workAuthorization'
import type {
  ServiceOperatorSnapshot,
  ServiceRefundRecord,
  ServiceTransaction,
  ServiceWorkspaceState,
  SettlementRecord,
} from './types'

export interface RequestThirdPartyRefundRequest {
  refundId: string
  requestedAt: string
  operator: ServiceOperatorSnapshot
}

export interface CompleteThirdPartyRefundRequest {
  refundId: string
  processedAt: string
  operator: ServiceOperatorSnapshot
  authorization: OnSiteAuthorization
}

export interface ThirdPartyRefundResult {
  state: ServiceWorkspaceState
  refund: ServiceRefundRecord
}

export interface ThirdPartyPaymentRow {
  transaction: ServiceTransaction
  settlement: SettlementRecord
  refund: ServiceRefundRecord | null
}

export function paymentPlatformSerial(settlementId: string): string {
  return `MN-ZF-${settlementId.replace(/^JS-/, '')}`
}

export function refundStatusLabel(status: ServiceRefundRecord['status']): string {
  return {
    'application-required': '待申请',
    pending: '未退款',
    refunded: '已退款',
    failed: '退款失败',
  }[status]
}

export function thirdPartyPaymentStatusLabel(
  refund: ServiceRefundRecord | null,
): string {
  if (!refund || refund.status === 'application-required') return '支付成功'
  if (refund.status === 'pending') return '退款申请中'
  if (refund.status === 'refunded') return '已退款'
  return '退款失败'
}

export function thirdPartyPaymentRows(
  state: ServiceWorkspaceState,
): ThirdPartyPaymentRow[] {
  const settlements = new Map(
    state.settlements
      .filter((settlement) => settlement.tender === 'third-party')
      .map((settlement) => [settlement.id, settlement]),
  )
  const refunds = new Map(
    state.refunds
      .filter((refund) => refund.route === 'original-payment')
      .map((refund) => [refund.transactionId, refund]),
  )
  return state.transactions
    .map((transaction): ThirdPartyPaymentRow | null => {
      if (!transaction.settlementId) return null
      const settlement = settlements.get(transaction.settlementId)
      return settlement
        ? { transaction, settlement, refund: refunds.get(transaction.id) ?? null }
        : null
    })
    .filter((row): row is ThirdPartyPaymentRow => Boolean(row))
}

function requiredTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value)
  if (!value.trim() || Number.isNaN(parsed)) throw new Error(`${label}格式无效。`)
  return parsed
}

function refundContext(
  state: ServiceWorkspaceState,
  refundId: string,
): {
  refund: ServiceRefundRecord
  transaction: ServiceTransaction
  settlement: SettlementRecord
} {
  const refund = state.refunds.find((item) => item.id === refundId)
  if (!refund) throw new Error('未找到退款记录。')
  const transaction = state.transactions.find(
    (item) => item.id === refund.transactionId,
  )
  if (!transaction) throw new Error('退款对应的原交易不存在。')
  const settlement = state.settlements.find(
    (item) => item.id === refund.settlementId,
  )
  if (!settlement) throw new Error('退款对应的支付记录不存在。')
  if (
    refund.route !== 'original-payment' ||
    refund.originalTender !== 'third-party' ||
    settlement.tender !== 'third-party'
  ) {
    throw new Error('退款待办查询只处理第三方支付原路退款。')
  }
  return { refund, transaction, settlement }
}

function replaceRefund(
  state: ServiceWorkspaceState,
  refund: ServiceRefundRecord,
): ThirdPartyRefundResult {
  return {
    refund: structuredClone(refund),
    state: {
      ...state,
      refunds: state.refunds.map((item) => item.id === refund.id ? refund : item),
    },
  }
}

export function requestThirdPartyRefund(
  state: ServiceWorkspaceState,
  request: RequestThirdPartyRefundRequest,
): ThirdPartyRefundResult {
  const { refund, transaction } = refundContext(state, request.refundId)
  if (transaction.status !== 'withdrawn') {
    throw new Error('原交易撤销后才能发起退款申请。')
  }
  if (refund.status !== 'application-required') {
    throw new Error('该退款记录已经发起申请，不能重复申请。')
  }
  const requestedAt = requiredTimestamp(request.requestedAt, '退款申请时间')
  if (requestedAt < requiredTimestamp(refund.createdAt, '退款记录生成时间')) {
    throw new Error('退款申请时间不得早于退款记录生成时间。')
  }
  return replaceRefund(state, {
    ...refund,
    status: 'pending',
    requestedAt: request.requestedAt,
    requestedBy: structuredClone(request.operator),
    failureReason: '',
  })
}

export function completeThirdPartyRefund(
  state: ServiceWorkspaceState,
  request: CompleteThirdPartyRefundRequest,
): ThirdPartyRefundResult {
  const { refund } = refundContext(state, request.refundId)
  requireOnSiteAuthorization(
    request.authorization,
    'complete-third-party-refund',
    request.operator.operatorId,
  )
  if (refund.status === 'refunded') {
    throw new Error('该记录已经退款，不允许再次退款。')
  }
  if (refund.status !== 'pending' || !refund.requestedAt) {
    throw new Error('请先从支付状态查询发起退款申请。')
  }
  const processedAt = requiredTimestamp(request.processedAt, '退款时间')
  if (processedAt < requiredTimestamp(refund.requestedAt, '退款申请时间')) {
    throw new Error('退款时间不得早于退款申请时间。')
  }
  return replaceRefund(state, {
    ...refund,
    status: 'refunded',
    processedAt: request.processedAt,
    processedBy: structuredClone(request.operator),
    platformRefundId: `MN-TK-${refund.id.replace(/^TK-/, '')}`,
    failureReason: '',
  })
}
