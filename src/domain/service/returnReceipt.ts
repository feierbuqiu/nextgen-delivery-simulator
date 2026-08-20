import { isValidRegisteredS10 } from './international'
import { businessCalendarDay } from '../shared/businessTime'
import type {
  ReturnReceiptRecord,
  ServiceDestinationZone,
  ServiceOperatorSnapshot,
  ServiceProduct,
  ServiceTransaction,
  ServiceWorkspaceState,
} from './types'

const RETURN_RECEIPT_PARENT_CODES = new Set(['20', '21', '22', '23', '24'])
const RETURN_RECEIPT_TARIFF_KINDS = new Set<ServiceProduct['tariffKind']>([
  'domestic-letter',
  'domestic-postcard',
  'domestic-printed-matter',
  'mailgram',
])

export interface ReturnReceiptEligibility {
  offered: boolean
  eligible: boolean
  feeCents: number
  reason: string
}

export interface RecordReturnReceiptArrivalRequest {
  receiptId: string
  recipientSigner: string
  deliveredAt: string
  receivedAt: string
  operator: ServiceOperatorSnapshot
  note: string
}

export interface DispatchReturnReceiptRequest {
  receiptId: string
  returnItemCode: string
  returnedAt: string
  operator: ServiceOperatorSnapshot
}

export interface ReturnReceiptResult {
  state: ServiceWorkspaceState
  receipt: ReturnReceiptRecord
}

export function returnReceiptEligibility(
  product: ServiceProduct,
  zone: ServiceDestinationZone,
): ReturnReceiptEligibility {
  const offered = product.productFamily === 'standard-delivery' &&
    RETURN_RECEIPT_PARENT_CODES.has(product.parentCode) &&
    RETURN_RECEIPT_TARIFF_KINDS.has(product.tariffKind)
  if (!offered) {
    return {
      offered: false,
      eligible: false,
      feeCents: 0,
      reason: '当前业务产品不办理回执。',
    }
  }
  if (!zone) {
    return {
      offered: true,
      eligible: false,
      feeCents: 0,
      reason: '请选择区域后再办理回执。',
    }
  }
  if (zone === 'special-beautiful-island') {
    return {
      offered: true,
      eligible: false,
      feeCents: 0,
      reason: '美丽岛路向不办理回执。',
    }
  }
  return {
    offered: true,
    eligible: true,
    feeCents: zone === 'international' ? 500 : 300,
    reason: '',
  }
}

export function returnReceiptStatusLabel(status: ReturnReceiptRecord['status']): string {
  const labels: Record<ReturnReceiptRecord['status'], string> = {
    'awaiting-return': '待回执',
    received: '已收到待寄回',
    returned: '已寄回',
    cancelled: '已取消',
  }
  return labels[status]
}

function receiptId(requestedAt: string, sequence: number): string {
  const date = businessCalendarDay(requestedAt).replaceAll('-', '')
  return `HZ-${date}-${String(sequence).padStart(6, '0')}`
}

export function createReturnReceiptRecord(
  state: ServiceWorkspaceState,
  transaction: ServiceTransaction,
  product: ServiceProduct,
): ReturnReceiptRecord | null {
  if (!transaction.service.returnReceiptRequested) return null
  const eligibility = returnReceiptEligibility(product, transaction.service.destinationZone)
  if (!eligibility.eligible) throw new Error(eligibility.reason)
  if (transaction.service.quantity !== 1) {
    throw new Error('回执业务须逐件办理，每笔收寄件数必须为 1。')
  }
  if (transaction.charge.returnReceiptCents !== eligibility.feeCents) {
    throw new Error('回执费与当前业务产品及路向不一致，请重新计费。')
  }
  return {
    id: receiptId(transaction.acceptedAt, state.nextReturnReceiptSequence),
    transactionId: transaction.id,
    originalItemCode: transaction.service.itemCode,
    requestedAt: transaction.acceptedAt,
    feeCents: eligibility.feeCents,
    status: 'awaiting-return',
    recipientSigner: '',
    deliveredAt: null,
    receivedAt: null,
    receivedBy: null,
    returnItemCode: '',
    returnedAt: null,
    returnedBy: null,
    note: '',
  }
}

function requiredTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value)
  if (!value.trim() || Number.isNaN(parsed)) throw new Error(`${label}格式无效。`)
  return parsed
}

function findReceipt(
  state: ServiceWorkspaceState,
  receiptIdValue: string,
): { receipt: ReturnReceiptRecord; transaction: ServiceTransaction } {
  const receipt = state.returnReceipts.find((item) => item.id === receiptIdValue)
  if (!receipt) throw new Error('未找到回执记录。')
  const transaction = state.transactions.find((item) => item.id === receipt.transactionId)
  if (!transaction) throw new Error('回执对应的原邮件记录不存在。')
  if (transaction.status === 'withdrawn' || receipt.status === 'cancelled') {
    throw new Error('原邮件已经撤销，不能继续办理回执。')
  }
  return { receipt, transaction }
}

function replaceReceipt(
  state: ServiceWorkspaceState,
  receipt: ReturnReceiptRecord,
): ReturnReceiptResult {
  return {
    receipt: structuredClone(receipt),
    state: {
      ...state,
      returnReceipts: state.returnReceipts.map((item) =>
        item.id === receipt.id ? receipt : item,
      ),
    },
  }
}

export function recordReturnReceiptArrival(
  state: ServiceWorkspaceState,
  request: RecordReturnReceiptArrivalRequest,
): ReturnReceiptResult {
  const { receipt, transaction } = findReceipt(state, request.receiptId)
  if (transaction.status !== 'settled') throw new Error('原邮件结算后才能登记回执。')
  if (receipt.status !== 'awaiting-return') throw new Error('当前回执不是待接收状态。')
  const signer = request.recipientSigner.trim()
  if (!signer) throw new Error('请输入回执签收人。')
  if (Array.from(signer).length > 40) throw new Error('回执签收人不得超过 40 个字符。')
  const deliveredAt = requiredTimestamp(request.deliveredAt, '邮件妥投日期')
  const receivedAt = requiredTimestamp(request.receivedAt, '回执收到日期')
  if (deliveredAt < requiredTimestamp(transaction.acceptedAt, '原邮件收寄日期')) {
    throw new Error('邮件妥投日期不得早于原邮件收寄日期。')
  }
  if (deliveredAt > receivedAt) throw new Error('回执收到日期不得早于邮件妥投日期。')
  const note = request.note.trim()
  if (Array.from(note).length > 80) throw new Error('回执备注不得超过 80 个字符。')
  return replaceReceipt(state, {
    ...receipt,
    status: 'received',
    recipientSigner: signer,
    deliveredAt: request.deliveredAt,
    receivedAt: request.receivedAt,
    receivedBy: structuredClone(request.operator),
    note,
  })
}

function validReturnItemCode(
  code: string,
  zone: ServiceDestinationZone,
): boolean {
  if (zone === 'local' || zone === 'nonlocal') return /^[A-Z]{2}\d{11}$/.test(code)
  return isValidRegisteredS10(code)
}

export function dispatchReturnReceipt(
  state: ServiceWorkspaceState,
  request: DispatchReturnReceiptRequest,
): ReturnReceiptResult {
  const { receipt, transaction } = findReceipt(state, request.receiptId)
  if (receipt.status !== 'received' || !receipt.receivedAt) {
    throw new Error('请先登记收到回执，再办理寄回。')
  }
  const returnItemCode = request.returnItemCode.trim().toUpperCase()
  if (!validReturnItemCode(returnItemCode, transaction.service.destinationZone)) {
    throw new Error(
      transaction.service.destinationZone === 'local' ||
        transaction.service.destinationZone === 'nonlocal'
        ? '国内寄回邮件号码须为 13 位：前 2 位大写字母，后 11 位数字。'
        : '国际及特区寄回邮件须使用有效的 R 类 S10 号码。',
    )
  }
  if (returnItemCode === receipt.originalItemCode.toUpperCase()) {
    throw new Error('寄回邮件号码不能与原邮件号码相同。')
  }
  if (state.returnReceipts.some(
    (item) => item.id !== receipt.id && item.returnItemCode === returnItemCode,
  )) {
    throw new Error('寄回邮件号码已经被其他回执使用。')
  }
  if (state.transactions.some(
    (item) => item.service.itemCode.trim().toUpperCase() === returnItemCode,
  )) {
    throw new Error('寄回邮件号码已经被其他收寄邮件使用。')
  }
  const returnedAt = requiredTimestamp(request.returnedAt, '回执寄回日期')
  if (returnedAt < requiredTimestamp(receipt.receivedAt, '回执收到日期')) {
    throw new Error('回执寄回日期不得早于回执收到日期。')
  }
  return replaceReceipt(state, {
    ...receipt,
    status: 'returned',
    returnItemCode,
    returnedAt: request.returnedAt,
    returnedBy: structuredClone(request.operator),
  })
}
