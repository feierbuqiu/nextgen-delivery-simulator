import { POSTAL_SUPPLY_ITEMS } from './seed'
import {
  DEFAULT_SERVICE_OPERATOR,
  remainingPostalSupplyStock,
} from './transactions'
import type {
  PostalSupplyDraftLine,
  PostalSupplyItem,
  ReplyCouponPaymentPlatform,
  ReplyCouponRedemption,
  ReplyCouponRedemptionLine,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
  SettlementRecord,
  SettlementTender,
} from './types'
import { assertAccountingOpen } from './personalRemittance'
import { businessCalendarDay } from '../shared/businessTime'

export const REPLY_COUPON_UNIT_VALUE_CENTS = 700 as const

export interface AcceptReplyCouponRedemptionRequest {
  acceptedAt: string
  couponCount: number
  lines: PostalSupplyDraftLine[]
  operator?: ServiceOperatorSnapshot
}

export interface ReviseReplyCouponRedemptionRequest {
  redemptionId: string
  updatedAt: string
  couponCount: number
  lines: PostalSupplyDraftLine[]
}

export interface SettleReplyCouponRedemptionRequest {
  redemptionId: string
  settledAt: string
  tender: Exclude<SettlementTender, 'credit'>
  amountReceivedCents: number
  paymentCode?: string
}

export interface WithdrawReplyCouponRedemptionRequest {
  redemptionId: string
  withdrawnAt: string
}

export interface ReplyCouponRedemptionResult {
  state: ServiceWorkspaceState
  redemption: ReplyCouponRedemption
}

export interface SettledReplyCouponRedemptionResult
  extends ReplyCouponRedemptionResult {
  settlement: SettlementRecord
}

function redemptionId(acceptedAt: string, sequence: number): string {
  const date = businessCalendarDay(acceptedAt).replaceAll('-', '')
  return `HXQ-${date}-${String(sequence).padStart(6, '0')}`
}

function settlementId(settledAt: string, sequence: number): string {
  const date = businessCalendarDay(settledAt).replaceAll('-', '')
  return `JS-${date}-${String(sequence).padStart(6, '0')}`
}

function validCouponCount(couponCount: number): void {
  if (!Number.isInteger(couponCount) || couponCount < 1) {
    throw new Error('回信券张数须为正整数。')
  }
}

function availableStock(
  state: ServiceWorkspaceState,
  itemId: string,
  existing?: ReplyCouponRedemption,
): number {
  const reservedByExisting = existing?.lines.find(
    (line) => line.itemId === itemId,
  )?.quantity ?? 0
  return remainingPostalSupplyStock(state, itemId) + reservedByExisting
}

function buildLines(
  state: ServiceWorkspaceState,
  draftLines: PostalSupplyDraftLine[],
  existing?: ReplyCouponRedemption,
): ReplyCouponRedemptionLine[] {
  if (draftLines.length === 0) {
    throw new Error('请至少选择一种可兑付商品。')
  }
  if (new Set(draftLines.map((line) => line.itemId)).size !== draftLines.length) {
    throw new Error('同一种商品只能保留一行，请修改数量。')
  }

  return draftLines.map((draftLine) => {
    const item = POSTAL_SUPPLY_ITEMS.find(
      (candidate) => candidate.id === draftLine.itemId,
    )
    if (!item?.replyCouponCatalog) {
      throw new Error('国际回信券仅可兑付邮票以及封、片、卡目录商品。')
    }
    const remaining = availableStock(state, item.id, existing)
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
      productCode: item.mnemonic,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      quantity: draftLine.quantity,
      amountCents: item.unitPriceCents * draftLine.quantity,
      catalogKind: item.replyCouponCatalog,
    }
  })
}

function totals(couponCount: number, lines: ReplyCouponRedemptionLine[]) {
  const itemCount = lines.reduce((total, line) => total + line.quantity, 0)
  const merchandiseTotalCents = lines.reduce(
    (total, line) => total + line.amountCents,
    0,
  )
  const couponMaximumCents = couponCount * REPLY_COUPON_UNIT_VALUE_CENTS
  const discountCents = Math.min(merchandiseTotalCents, couponMaximumCents)
  return {
    itemCount,
    merchandiseTotalCents,
    couponMaximumCents,
    discountCents,
    amountDueCents: merchandiseTotalCents - discountCents,
  }
}

export function replyCouponEligibleItems(): PostalSupplyItem[] {
  return POSTAL_SUPPLY_ITEMS.filter((item) => item.replyCouponCatalog)
}

export function replyCouponPlatformFromCode(
  paymentCode: string,
): ReplyCouponPaymentPlatform {
  const prefix = paymentCode.trim().slice(0, 1).toUpperCase()
  if (prefix === 'A') return 'platform-a'
  if (prefix === 'W') return 'platform-b'
  if (prefix === 'U') return 'union-qr'
  if (prefix === 'D') return 'digital-payment'
  return 'generic-third-party'
}

export function replyCouponPlatformLabel(
  platform: ReplyCouponPaymentPlatform | null,
): string {
  switch (platform) {
    case 'platform-a': return '第三方平台甲'
    case 'platform-b': return '第三方平台乙'
    case 'union-qr': return '联合二维码'
    case 'digital-payment': return '数字支付'
    case 'generic-third-party': return '第三方通用平台'
    default: return ''
  }
}

function maskPaymentCode(paymentCode: string): string {
  const normalized = paymentCode.trim()
  return `${'*'.repeat(Math.max(4, normalized.length - 4))}${normalized.slice(-4)}`
}

export function acceptReplyCouponRedemption(
  state: ServiceWorkspaceState,
  request: AcceptReplyCouponRedemptionRequest,
): ReplyCouponRedemptionResult {
  const operator = structuredClone(request.operator ?? DEFAULT_SERVICE_OPERATOR)
  assertAccountingOpen(state, operator, request.acceptedAt)
  validCouponCount(request.couponCount)
  const lines = buildLines(state, request.lines)
  const calculated = totals(request.couponCount, lines)
  const redemption: ReplyCouponRedemption = {
    id: redemptionId(request.acceptedAt, state.nextReplyCouponSequence),
    status: 'pending-settlement',
    acceptedAt: request.acceptedAt,
    updatedAt: request.acceptedAt,
    operator,
    couponCount: request.couponCount,
    couponUnitValueCents: REPLY_COUPON_UNIT_VALUE_CENTS,
    ...calculated,
    lines,
    settlementId: null,
    settledAt: null,
    tender: null,
    amountReceivedCents: 0,
    changeCents: 0,
    paymentPlatform: null,
    paymentCodeMasked: '',
    withdrawnAt: null,
  }
  return {
    redemption,
    state: {
      ...state,
      replyCouponRedemptions: [...state.replyCouponRedemptions, redemption],
      nextReplyCouponSequence: state.nextReplyCouponSequence + 1,
    },
  }
}

export function reviseReplyCouponRedemption(
  state: ServiceWorkspaceState,
  request: ReviseReplyCouponRedemptionRequest,
): ReplyCouponRedemptionResult {
  const current = state.replyCouponRedemptions.find(
    (redemption) => redemption.id === request.redemptionId,
  )
  if (!current) throw new Error('未找到回信券兑付流水。')
  assertAccountingOpen(state, current.operator, request.updatedAt)
  if (current.status !== 'pending-settlement') {
    throw new Error('仅待结算的回信券兑付流水可以修改。')
  }
  validCouponCount(request.couponCount)
  const lines = buildLines(state, request.lines, current)
  const redemption: ReplyCouponRedemption = {
    ...current,
    ...totals(request.couponCount, lines),
    couponCount: request.couponCount,
    lines,
    updatedAt: request.updatedAt,
  }
  return {
    redemption,
    state: {
      ...state,
      replyCouponRedemptions: state.replyCouponRedemptions.map((candidate) =>
        candidate.id === redemption.id ? redemption : candidate,
      ),
    },
  }
}

export function settleReplyCouponRedemption(
  state: ServiceWorkspaceState,
  request: SettleReplyCouponRedemptionRequest,
): SettledReplyCouponRedemptionResult {
  const current = state.replyCouponRedemptions.find(
    (redemption) => redemption.id === request.redemptionId,
  )
  if (!current) throw new Error('未找到回信券兑付流水。')
  assertAccountingOpen(state, current.operator, request.settledAt)
  if (current.status !== 'pending-settlement') {
    throw new Error('该回信券兑付流水已处理，不可重复结算。')
  }
  if ((request.tender as SettlementTender) === 'credit') {
    throw new Error('国际回信券兑付不允许记欠。')
  }

  const due = current.amountDueCents
  if (due === 0) {
    if (request.tender !== 'cash' || request.amountReceivedCents !== 0) {
      throw new Error('无现金金额的兑付应直接结算，实收金额须为 0。')
    }
  } else {
    if (!Number.isInteger(request.amountReceivedCents)) {
      throw new Error('实收金额须精确到分。')
    }
    if (request.tender === 'cash' && request.amountReceivedCents < due) {
      throw new Error('现金实收金额不得少于应收金额。')
    }
    if (
      request.tender !== 'cash' &&
      request.amountReceivedCents !== due
    ) {
      throw new Error('POS 和第三方支付的实收金额必须等于应收金额。')
    }
  }

  let paymentPlatform: ReplyCouponPaymentPlatform | null = null
  let paymentCodeMasked = ''
  if (request.tender === 'third-party' && due > 0) {
    const paymentCode = request.paymentCode?.trim() ?? ''
    if (paymentCode.length < 8) throw new Error('请输入不少于 8 位的付款码。')
    paymentPlatform = replyCouponPlatformFromCode(paymentCode)
    paymentCodeMasked = maskPaymentCode(paymentCode)
  }

  const id = settlementId(request.settledAt, state.nextSettlementSequence)
  const settlement: SettlementRecord = {
    id,
    transactionIds: [current.id],
    tender: request.tender,
    settledAt: request.settledAt,
    amountDueCents: due,
    amountReceivedCents: request.amountReceivedCents,
    changeCents: request.tender === 'cash'
      ? request.amountReceivedCents - due
      : 0,
    invoiceRequested: false,
  }
  const redemption: ReplyCouponRedemption = {
    ...current,
    status: 'settled',
    updatedAt: request.settledAt,
    settlementId: id,
    settledAt: request.settledAt,
    tender: request.tender,
    amountReceivedCents: request.amountReceivedCents,
    changeCents: settlement.changeCents,
    paymentPlatform,
    paymentCodeMasked,
  }
  return {
    redemption,
    settlement,
    state: {
      ...state,
      replyCouponRedemptions: state.replyCouponRedemptions.map((candidate) =>
        candidate.id === redemption.id ? redemption : candidate,
      ),
      settlements: [...state.settlements, settlement],
      nextSettlementSequence: state.nextSettlementSequence + 1,
    },
  }
}

export function withdrawReplyCouponRedemption(
  state: ServiceWorkspaceState,
  request: WithdrawReplyCouponRedemptionRequest,
): ReplyCouponRedemptionResult {
  const current = state.replyCouponRedemptions.find(
    (redemption) => redemption.id === request.redemptionId,
  )
  if (!current) throw new Error('未找到回信券兑付流水。')
  assertAccountingOpen(state, current.operator, request.withdrawnAt)
  if (current.status !== 'pending-settlement') {
    throw new Error('仅待结算的回信券兑付流水可以删除。')
  }
  const redemption: ReplyCouponRedemption = {
    ...current,
    status: 'withdrawn',
    updatedAt: request.withdrawnAt,
    withdrawnAt: request.withdrawnAt,
  }
  return {
    redemption,
    state: {
      ...state,
      replyCouponRedemptions: state.replyCouponRedemptions.map((candidate) =>
        candidate.id === redemption.id ? redemption : candidate,
      ),
    },
  }
}
