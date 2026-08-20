import {
  isValidContact,
  isValidResidentIdentity,
} from '../customer/policy'
import { businessCalendarDay } from '../shared/businessTime'
import { assertAccountingOpen } from './personalRemittance'
import {
  requireOnSiteAuthorization,
  type OnSiteAuthorization,
} from '../access/workAuthorization'
import type {
  ServiceOperatorSnapshot,
  ServiceTransaction,
  ServiceWorkspaceState,
  SpecialHandlingApplication,
  SpecialHandlingKind,
  SpecialHandlingTender,
  SpecialHandlingUploadStatus,
} from './types'

const WITHDRAWAL_EXAMPLE_FEE_CENTS = 500
const REDIRECT_EXAMPLE_FEE_CENTS = 800

export interface SpecialHandlingApplicationDraft {
  kind: SpecialHandlingKind
  mailItemCode: string
  applicantName: string
  applicantPhone: string
  applicantIdentityType: SpecialHandlingApplication['applicantIdentityType'] | ''
  applicantIdentityNumber: string
  redirectedAddress: string
  redirectedPostalCode: string
  redirectedDestinationOffice: string
  reason: string
}

export interface SpecialHandlingQuote {
  transactionId: string
  mailItemCode: string
  recipientName: string
  recipientPhone: string
  recipientAddress: string
  feeCents: number
  quoteSource: SpecialHandlingApplication['quoteSource']
  quotedAt: string
}

export interface CreateSpecialHandlingApplicationRequest {
  draft: SpecialHandlingApplicationDraft
  quotedAt: string
  createdAt: string
  operator: ServiceOperatorSnapshot
}

export interface SettleSpecialHandlingApplicationRequest {
  applicationId: string
  tender: SpecialHandlingTender
  settledAt: string
  uploadOutcome: Exclude<SpecialHandlingUploadStatus, 'not-uploaded'>
  uploadFailureReason?: string
}

export interface RetrySpecialHandlingUploadRequest {
  applicationId: string
  uploadedAt: string
  uploadOutcome: Exclude<SpecialHandlingUploadStatus, 'not-uploaded'>
  uploadFailureReason?: string
}

export interface CancelSpecialHandlingWithdrawalRequest {
  applicationId: string
  deliveryStageDecision: 'entered-delivery' | 'not-entered-delivery'
  cancelledAt: string
  operator: ServiceOperatorSnapshot
}

export interface CompleteSpecialHandlingRefundRequest {
  applicationId: string
  refundedAt: string
  operator: ServiceOperatorSnapshot
  authorization: OnSiteAuthorization
}

export type SpecialHandlingCommand =
  | ({ type: 'create-special-handling-application' } & CreateSpecialHandlingApplicationRequest)
  | ({ type: 'settle-special-handling-application' } & SettleSpecialHandlingApplicationRequest)
  | ({ type: 'retry-special-handling-upload' } & RetrySpecialHandlingUploadRequest)
  | { type: 'delete-special-handling-application'; applicationId: string }
  | ({ type: 'cancel-special-handling-withdrawal' } & CancelSpecialHandlingWithdrawalRequest)
  | ({ type: 'complete-special-handling-refund' } & CompleteSpecialHandlingRefundRequest)

export interface SpecialHandlingResult {
  state: ServiceWorkspaceState
  application: SpecialHandlingApplication | null
  deletedApplicationId: string | null
}

export interface SpecialHandlingQuery {
  mailItemCode: string
  operatorId: string
  kind: SpecialHandlingKind | ''
  operatedDateFrom: string
  operatedDateTo: string
}

function dateId(prefix: string, at: string, sequence: number): string {
  return `${prefix}-${businessCalendarDay(at).replaceAll('-', '')}-${String(sequence).padStart(6, '0')}`
}

function requiredTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value)
  if (!value.trim() || Number.isNaN(timestamp)) throw new Error(`${label}格式无效。`)
  return timestamp
}

function normalizedItemCode(value: string): string {
  return value.trim().toUpperCase()
}

function transactionForItemCode(
  state: ServiceWorkspaceState,
  itemCode: string,
): ServiceTransaction {
  const normalized = normalizedItemCode(itemCode)
  if (!normalized) throw new Error('请输入邮件号码。')
  const transaction = [...state.transactions]
    .reverse()
    .find((item) => normalizedItemCode(item.service.itemCode) === normalized)
  if (!transaction) {
    throw new Error('未获取到该邮件的收寄信息。')
  }
  if (transaction.status !== 'settled') {
    throw new Error('该邮件尚未完成原收寄结算，不能办理撤单或改址。')
  }
  return transaction
}

export function isSpecialHandlingEligibleTransaction(
  transaction: ServiceTransaction,
): boolean {
  const domestic = transaction.service.destinationZone === 'local' ||
    transaction.service.destinationZone === 'nonlocal'
  if (!domestic) return false
  const code = transaction.product.searchCode.toUpperCase()
  return code === '310' || (code.startsWith('4') && code !== '408')
}

function validateIdentity(
  type: SpecialHandlingApplicationDraft['applicantIdentityType'],
  number: string,
): asserts type is SpecialHandlingApplication['applicantIdentityType'] {
  if (!type) throw new Error('请选择申请人证件名称。')
  const normalized = number.trim()
  if (!normalized) throw new Error('请输入申请人证件号码。')
  if (type === 'primary' && !isValidResidentIdentity(normalized)) {
    throw new Error('居民身份证号码须为 18 位并通过校验。')
  }
  if (type !== 'primary' && Array.from(normalized).length > 20) {
    throw new Error('其他身份证明号码不得超过 20 个字符。')
  }
}

function validateApplicationDraft(
  state: ServiceWorkspaceState,
  draft: SpecialHandlingApplicationDraft,
): ServiceTransaction {
  const transaction = transactionForItemCode(state, draft.mailItemCode)
  if (!isSpecialHandlingEligibleTransaction(transaction)) {
    throw new Error('寄递接口返回：当前业务产品不允许办理撤单或改址。')
  }
  if (!draft.applicantName.trim()) throw new Error('请输入申请人姓名。')
  if (!draft.applicantPhone.trim()) throw new Error('请输入申请人电话。')
  if (!isValidContact(draft.applicantPhone)) throw new Error('申请人电话格式无效。')
  if (!transaction.customer.sender.contact.trim()) {
    throw new Error('原邮件没有可供核对的寄件客户电话。')
  }
  if (draft.applicantPhone.trim() !== transaction.customer.sender.contact.trim()) {
    throw new Error('申请人电话必须与原邮件寄件客户电话保持一致。')
  }
  validateIdentity(draft.applicantIdentityType, draft.applicantIdentityNumber)
  if (!draft.reason.trim()) throw new Error('请输入申请原因。')
  if (draft.kind === 'redirect') {
    if (!draft.redirectedAddress.trim()) throw new Error('请输入改址后的详细地址。')
    if (!/^\d{6}$/.test(draft.redirectedPostalCode.trim())) {
      throw new Error('改址后的收件人邮编须为 6 位数字。')
    }
  }
  const duplicate = state.specialHandlingApplications.some((application) => (
    normalizedItemCode(application.mailItemCode) === normalizedItemCode(draft.mailItemCode) &&
    application.refundStatus !== 'refunded'
  ))
  if (duplicate) throw new Error('该邮件已有未完结的撤单或改址申请。')
  return transaction
}

export function quoteSpecialHandlingApplication(
  state: ServiceWorkspaceState,
  draft: SpecialHandlingApplicationDraft,
  quotedAt: string,
): SpecialHandlingQuote {
  requiredTimestamp(quotedAt, '计费时间')
  const transaction = validateApplicationDraft(state, draft)
  return {
    transactionId: transaction.id,
    mailItemCode: transaction.service.itemCode,
    recipientName: transaction.customer.recipient.name,
    recipientPhone: transaction.customer.recipient.contact,
    recipientAddress: transaction.customer.recipient.detailedAddress,
    feeCents: draft.kind === 'withdrawal'
      ? WITHDRAWAL_EXAMPLE_FEE_CENTS
      : REDIRECT_EXAMPLE_FEE_CENTS,
    quoteSource: 'simulated-delivery-interface',
    quotedAt,
  }
}

function applicationById(
  state: ServiceWorkspaceState,
  applicationId: string,
): SpecialHandlingApplication {
  const application = state.specialHandlingApplications.find((item) => item.id === applicationId)
  if (!application) throw new Error('未找到邮件撤改申请。')
  return application
}

function replaceApplication(
  state: ServiceWorkspaceState,
  application: SpecialHandlingApplication,
): SpecialHandlingResult {
  return {
    application: structuredClone(application),
    deletedApplicationId: null,
    state: {
      ...state,
      specialHandlingApplications: state.specialHandlingApplications.map((item) => (
        item.id === application.id ? application : item
      )),
    },
  }
}

function createApplication(
  state: ServiceWorkspaceState,
  request: CreateSpecialHandlingApplicationRequest,
): SpecialHandlingResult {
  assertAccountingOpen(state, request.operator, request.createdAt)
  const createdTimestamp = requiredTimestamp(request.createdAt, '提交时间')
  const quote = quoteSpecialHandlingApplication(state, request.draft, request.quotedAt)
  if (createdTimestamp < requiredTimestamp(request.quotedAt, '计费时间')) {
    throw new Error('提交时间不得早于计费时间。')
  }
  const transaction = transactionForItemCode(state, request.draft.mailItemCode)
  const application: SpecialHandlingApplication = {
    id: dateId('TC', request.createdAt, state.nextSpecialHandlingSequence),
    transactionId: quote.transactionId,
    kind: request.draft.kind,
    mailItemCode: quote.mailItemCode,
    applicantName: request.draft.applicantName.trim(),
    applicantPhone: request.draft.applicantPhone.trim(),
    applicantIdentityType: request.draft.applicantIdentityType as SpecialHandlingApplication['applicantIdentityType'],
    applicantIdentityNumber: request.draft.applicantIdentityNumber.trim().toUpperCase(),
    recipientName: transaction.customer.recipient.name,
    recipientPhone: transaction.customer.recipient.contact,
    recipientAddress: transaction.customer.recipient.detailedAddress,
    redirectedAddress: request.draft.kind === 'redirect'
      ? request.draft.redirectedAddress.trim()
      : '',
    redirectedPostalCode: request.draft.kind === 'redirect'
      ? request.draft.redirectedPostalCode.trim()
      : '',
    redirectedDestinationOffice: request.draft.kind === 'redirect'
      ? request.draft.redirectedDestinationOffice.trim()
      : '',
    reason: request.draft.reason.trim(),
    feeCents: quote.feeCents,
    quoteSource: quote.quoteSource,
    quotedAt: quote.quotedAt,
    createdAt: request.createdAt,
    createdBy: structuredClone(request.operator),
    settlementTender: null,
    settledAt: null,
    uploadStatus: 'not-uploaded',
    uploadAttempts: 0,
    uploadedAt: null,
    uploadFailureReason: '',
    cancelledAt: null,
    cancelledBy: null,
    refundStatus: 'none',
    refundedAt: null,
    refundedBy: null,
  }
  return {
    application: structuredClone(application),
    deletedApplicationId: null,
    state: {
      ...state,
      specialHandlingApplications: [...state.specialHandlingApplications, application],
      nextSpecialHandlingSequence: state.nextSpecialHandlingSequence + 1,
    },
  }
}

function settleApplication(
  state: ServiceWorkspaceState,
  request: SettleSpecialHandlingApplicationRequest,
): SpecialHandlingResult {
  const application = applicationById(state, request.applicationId)
  assertAccountingOpen(state, application.createdBy, request.settledAt)
  if (application.settledAt) throw new Error('该撤改申请已经结算。')
  const settledTimestamp = requiredTimestamp(request.settledAt, '结算时间')
  if (settledTimestamp < requiredTimestamp(application.createdAt, '提交时间')) {
    throw new Error('结算时间不得早于提交时间。')
  }
  const settled: SpecialHandlingApplication = {
    ...application,
    settlementTender: request.tender,
    settledAt: request.settledAt,
    uploadStatus: request.uploadOutcome,
    uploadAttempts: 1,
    uploadedAt: request.uploadOutcome === 'succeeded' ? request.settledAt : null,
    uploadFailureReason: request.uploadOutcome === 'failed'
      ? request.uploadFailureReason?.trim() || '寄递接口暂未确认，请重新上传。'
      : '',
  }
  return replaceApplication(state, settled)
}

function retryUpload(
  state: ServiceWorkspaceState,
  request: RetrySpecialHandlingUploadRequest,
): SpecialHandlingResult {
  const application = applicationById(state, request.applicationId)
  if (!application.settledAt) throw new Error('请先完成撤改手续费结算。')
  if (application.uploadStatus !== 'failed') throw new Error('当前记录不需要重新上传。')
  if (application.cancelledAt) throw new Error('已经取消的撤单申请不能重新上传。')
  const uploadedTimestamp = requiredTimestamp(request.uploadedAt, '上传时间')
  if (uploadedTimestamp < requiredTimestamp(application.settledAt, '结算时间')) {
    throw new Error('上传时间不得早于结算时间。')
  }
  return replaceApplication(state, {
    ...application,
    uploadStatus: request.uploadOutcome,
    uploadAttempts: application.uploadAttempts + 1,
    uploadedAt: request.uploadOutcome === 'succeeded' ? request.uploadedAt : null,
    uploadFailureReason: request.uploadOutcome === 'failed'
      ? request.uploadFailureReason?.trim() || '寄递接口暂未确认，请重新上传。'
      : '',
  })
}

function deleteApplication(
  state: ServiceWorkspaceState,
  applicationId: string,
): SpecialHandlingResult {
  const application = applicationById(state, applicationId)
  if (application.uploadStatus === 'succeeded') {
    throw new Error('上传成功后的撤改申请不允许删除。')
  }
  return {
    application: null,
    deletedApplicationId: application.id,
    state: {
      ...state,
      specialHandlingApplications: state.specialHandlingApplications.filter((item) => (
        item.id !== application.id
      )),
    },
  }
}

function cancelWithdrawal(
  state: ServiceWorkspaceState,
  request: CancelSpecialHandlingWithdrawalRequest,
): SpecialHandlingResult {
  const application = applicationById(state, request.applicationId)
  if (application.kind !== 'withdrawal') throw new Error('只有撤单申请可以办理取消。')
  if (application.uploadStatus !== 'succeeded') throw new Error('撤单申请上传成功后才能办理取消。')
  if (application.cancelledAt) throw new Error('该撤单申请已经取消。')
  if (request.deliveryStageDecision !== 'entered-delivery') {
    throw new Error('寄递接口返回：邮件尚未进入投递阶段，不允许取消撤单。')
  }
  const cancelledTimestamp = requiredTimestamp(request.cancelledAt, '取消时间')
  if (cancelledTimestamp < requiredTimestamp(application.uploadedAt ?? '', '上传时间')) {
    throw new Error('取消时间不得早于上传时间。')
  }
  return replaceApplication(state, {
    ...application,
    cancelledAt: request.cancelledAt,
    cancelledBy: structuredClone(request.operator),
    refundStatus: 'pending',
  })
}

function completeRefund(
  state: ServiceWorkspaceState,
  request: CompleteSpecialHandlingRefundRequest,
): SpecialHandlingResult {
  const application = applicationById(state, request.applicationId)
  if (application.refundStatus !== 'pending' || !application.cancelledAt) {
    throw new Error('该撤单申请当前没有待办退款。')
  }
  requireOnSiteAuthorization(
    request.authorization,
    'complete-special-handling-refund',
    request.operator.operatorId,
  )
  const refundedTimestamp = requiredTimestamp(request.refundedAt, '退款时间')
  if (refundedTimestamp < requiredTimestamp(application.cancelledAt, '取消时间')) {
    throw new Error('退款时间不得早于撤单取消时间。')
  }
  return replaceApplication(state, {
    ...application,
    refundStatus: 'refunded',
    refundedAt: request.refundedAt,
    refundedBy: structuredClone(request.operator),
  })
}

export function executeSpecialHandlingCommand(
  state: ServiceWorkspaceState,
  command: SpecialHandlingCommand,
): SpecialHandlingResult {
  if (command.type === 'create-special-handling-application') {
    return createApplication(state, command)
  }
  if (command.type === 'settle-special-handling-application') {
    return settleApplication(state, command)
  }
  if (command.type === 'retry-special-handling-upload') {
    return retryUpload(state, command)
  }
  if (command.type === 'delete-special-handling-application') {
    return deleteApplication(state, command.applicationId)
  }
  if (command.type === 'cancel-special-handling-withdrawal') {
    return cancelWithdrawal(state, command)
  }
  return completeRefund(state, command)
}

export function querySpecialHandlingApplications(
  state: ServiceWorkspaceState,
  query: SpecialHandlingQuery,
): SpecialHandlingApplication[] {
  const itemCode = normalizedItemCode(query.mailItemCode)
  const operator = query.operatorId.trim().toLocaleLowerCase('zh-CN')
  return state.specialHandlingApplications
    .filter((application) => !itemCode || normalizedItemCode(application.mailItemCode).includes(itemCode))
    .filter((application) => !operator || (
      application.createdBy.operatorId.toLocaleLowerCase('zh-CN').includes(operator) ||
      application.createdBy.displayName.toLocaleLowerCase('zh-CN').includes(operator)
    ))
    .filter((application) => !query.kind || application.kind === query.kind)
    .filter((application) => {
      const date = businessCalendarDay(application.createdAt)
      return (!query.operatedDateFrom || date >= query.operatedDateFrom) &&
        (!query.operatedDateTo || date <= query.operatedDateTo)
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((application) => structuredClone(application))
}

export function specialHandlingKindLabel(kind: SpecialHandlingKind): string {
  return kind === 'withdrawal' ? '撤单' : '改址'
}

export function specialHandlingTenderLabel(tender: SpecialHandlingTender | null): string {
  if (tender === 'cash') return '现金支付'
  if (tender === 'pos') return 'POS支付'
  if (tender === 'third-party') return '第三方支付'
  return '未结算'
}
