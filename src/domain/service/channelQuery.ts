import {
  paymentPlatformSerial,
  thirdPartyPaymentRows,
  thirdPartyPaymentStatusLabel,
  type ThirdPartyPaymentRow,
} from './refundPending'
import type {
  ServiceOperatorSnapshot,
  ServiceTransaction,
  ServiceWorkspaceState,
} from './types'
import { businessCalendarDay } from '../shared/businessTime'

export type ThirdPartyPaymentQueryStatus =
  | 'all'
  | 'successful'
  | 'refund-pending'
  | 'refunded'
  | 'failed'

export interface ThirdPartyPaymentQuery {
  status: ThirdPartyPaymentQueryStatus
  paidDateFrom: string
  paidDateTo: string
  operatorId: string
  workstationCode: string
}

export type FrontDeskOperation = 'all' | 'correction' | 'withdrawal'

export interface FrontDeskLogQuery {
  operation: FrontDeskOperation
  product: string
  operatorId: string
  workstationCode: string
  operatedDateFrom: string
  operatedDateTo: string
}

export interface FrontDeskLogRow {
  id: string
  transactionId: string
  operatedAt: string
  operation: Exclude<FrontDeskOperation, 'all'>
  operationLabel: '修改' | '删除'
  operator: ServiceOperatorSnapshot
  productName: string
  productCode: string
  itemCode: string
  destinationOffice: string
  amountCents: number
  reason: string
}

export type MailTrackingEventKind =
  | 'acceptance'
  | 'correction'
  | 'withdrawal'
  | 'handover'
  | 'sealing'
  | 'dispatch'
  | 'special-handling'
  | 'window-delivery'

export interface MailTrackingEvent {
  id: string
  kind: MailTrackingEventKind
  occurredAt: string
  location: string
  description: string
  operatorName: string
}

export interface MailTrackingResult {
  transaction: ServiceTransaction
  events: MailTrackingEvent[]
}

export interface AcceptedMailQuery {
  querySerial: string
  product: string
  itemCode: string
  operatorId: string
  senderName: string
  recipientName: string
  workstationCode: string
  destinationOffice: string
  agreementAccountId: string
  acceptedDateFrom: string
  acceptedDateTo: string
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN')
}

function contains(value: string | null | undefined, query: string): boolean {
  const needle = normalized(query)
  return !needle || normalized(value ?? '').includes(needle)
}

function datePart(value: string): string {
  return businessCalendarDay(value)
}

function parseDate(value: string, label: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!value || Number.isNaN(parsed.getTime())) throw new Error(`${label}格式无效。`)
  return parsed
}

export function validateDateRange(
  dateFrom: string,
  dateTo: string,
  maximumMonths: number | null = null,
): void {
  if (!dateFrom && !dateTo) return
  if (!dateFrom || !dateTo) throw new Error('查询开始日期和结束日期必须同时填写。')
  const from = parseDate(dateFrom, '查询开始日期')
  const to = parseDate(dateTo, '查询结束日期')
  if (from.getTime() > to.getTime()) throw new Error('查询开始日期不得晚于结束日期。')
  if (maximumMonths !== null) {
    const exclusiveEnd = new Date(from)
    exclusiveEnd.setUTCMonth(exclusiveEnd.getUTCMonth() + maximumMonths)
    if (to.getTime() >= exclusiveEnd.getTime()) {
      throw new Error(`一次只能查询 ${maximumMonths} 个月范围内的信息。`)
    }
  }
}

export function thirdPartyQueryStatus(
  row: ThirdPartyPaymentRow,
): Exclude<ThirdPartyPaymentQueryStatus, 'all'> {
  if (row.refund?.status === 'pending') return 'refund-pending'
  if (row.refund?.status === 'refunded') return 'refunded'
  if (row.refund?.status === 'failed') return 'failed'
  return 'successful'
}

export function queryThirdPartyPayments(
  state: ServiceWorkspaceState,
  query: ThirdPartyPaymentQuery,
): ThirdPartyPaymentRow[] {
  validateDateRange(query.paidDateFrom, query.paidDateTo)
  return thirdPartyPaymentRows(state)
    .filter((row) => query.status === 'all' || thirdPartyQueryStatus(row) === query.status)
    .filter((row) => {
      const paidDate = datePart(row.settlement.settledAt)
      return paidDate >= query.paidDateFrom && paidDate <= query.paidDateTo
    })
    .filter((row) => contains(row.transaction.operator.operatorId, query.operatorId))
    .filter((row) => contains(row.transaction.operator.workstationCode, query.workstationCode))
    .sort((left, right) => right.settlement.settledAt.localeCompare(left.settlement.settledAt))
}

export function thirdPartyPaymentSearchText(row: ThirdPartyPaymentRow): string {
  return [
    row.transaction.id,
    row.transaction.sourceBatchId,
    row.transaction.service.itemCode,
    row.settlement.id,
    paymentPlatformSerial(row.settlement.id),
    thirdPartyPaymentStatusLabel(row.refund),
  ].filter(Boolean).join(' ')
}

export function queryFrontDeskLogs(
  state: ServiceWorkspaceState,
  query: FrontDeskLogQuery,
): FrontDeskLogRow[] {
  validateDateRange(query.operatedDateFrom, query.operatedDateTo)
  const transactions = new Map(state.transactions.map((item) => [item.id, item]))
  const correctionRows = state.corrections.map((record): FrontDeskLogRow | null => {
    const transaction = transactions.get(record.transactionId)
    if (!transaction) return null
    return {
      id: record.id,
      transactionId: transaction.id,
      operatedAt: record.correctedAt,
      operation: 'correction',
      operationLabel: '修改',
      operator: record.correctedBy ?? transaction.operator,
      productName: transaction.product.label,
      productCode: transaction.product.effectiveBusinessCode,
      itemCode: record.correctedService.itemCode,
      destinationOffice: record.correctedService.destinationOffice,
      amountCents: record.correctedCharge.totalCents,
      reason: record.reason,
    }
  }).filter((row): row is FrontDeskLogRow => Boolean(row))
  const withdrawalRows = state.withdrawals.map((record): FrontDeskLogRow | null => {
    const transaction = transactions.get(record.transactionId)
    if (!transaction) return null
    return {
      id: record.id,
      transactionId: transaction.id,
      operatedAt: record.withdrawnAt,
      operation: 'withdrawal',
      operationLabel: '删除',
      operator: record.withdrawnBy ?? transaction.operator,
      productName: transaction.product.label,
      productCode: transaction.product.effectiveBusinessCode,
      itemCode: transaction.service.itemCode,
      destinationOffice: transaction.service.destinationOffice,
      amountCents: transaction.charge.totalCents,
      reason: record.reason,
    }
  }).filter((row): row is FrontDeskLogRow => Boolean(row))

  return [...correctionRows, ...withdrawalRows]
    .filter((row) => query.operation === 'all' || row.operation === query.operation)
    .filter((row) => contains(`${row.productName} ${row.productCode}`, query.product))
    .filter((row) => contains(row.operator.operatorId, query.operatorId))
    .filter((row) => contains(row.operator.workstationCode, query.workstationCode))
    .filter((row) => {
      const operatedDate = datePart(row.operatedAt)
      return operatedDate >= query.operatedDateFrom && operatedDate <= query.operatedDateTo
    })
    .sort((left, right) => right.operatedAt.localeCompare(left.operatedAt))
}

export function parseMailTrackingNumbers(value: string): string[] {
  return [...new Set(value
    .toUpperCase()
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean))]
}

function event(
  id: string,
  kind: MailTrackingEventKind,
  occurredAt: string,
  location: string,
  description: string,
  operatorName: string,
): MailTrackingEvent {
  return { id, kind, occurredAt, location, description, operatorName }
}

function trackingEvents(
  state: ServiceWorkspaceState,
  transaction: ServiceTransaction,
): MailTrackingEvent[] {
  const events: MailTrackingEvent[] = [event(
    `${transaction.id}:accepted`,
    'acceptance',
    transaction.acceptedAt,
    transaction.operator.acceptanceOffice,
    `邮件已收寄，业务产品 ${transaction.product.label}（${transaction.product.effectiveBusinessCode}）`,
    transaction.operator.displayName,
  )]

  for (const correction of state.corrections.filter((item) => item.transactionId === transaction.id)) {
    events.push(event(
      correction.id,
      'correction',
      correction.correctedAt,
      transaction.operator.acceptanceOffice,
      `邮件信息已修改：${correction.reason}`,
      (correction.correctedBy ?? transaction.operator).displayName,
    ))
  }
  for (const withdrawal of state.withdrawals.filter((item) => item.transactionId === transaction.id)) {
    events.push(event(
      withdrawal.id,
      'withdrawal',
      withdrawal.withdrawnAt,
      transaction.operator.acceptanceOffice,
      `邮件已删除：${withdrawal.reason}`,
      (withdrawal.withdrawnBy ?? transaction.operator).displayName,
    ))
  }
  for (const handover of state.looseMailHandovers.filter((item) => item.transactionId === transaction.id)) {
    events.push(event(handover.id, 'handover', handover.handedOverAt, handover.handedOverBy.acceptanceOffice, `散件已交出至 ${handover.receivingOfficeName}`, handover.handedOverBy.displayName))
    if (handover.receivedAt && handover.receivedBy) {
      events.push(event(`${handover.id}:received`, 'handover', handover.receivedAt, handover.receivingOfficeName, '散件交接已接收', handover.receivedBy.displayName))
    }
  }

  const bags = state.dispatchBags.filter((bag) => bag.mailReferences.some((reference) => (
    reference.kind === 'transaction' && reference.transactionId === transaction.id
  )))
  const bagIds = new Set(bags.map((bag) => bag.id))
  for (const bag of bags) {
    events.push(event(bag.id, 'sealing', bag.generatedAt, bag.generatedBy.acceptanceOffice, `邮件已封入总包 ${bag.bagBarcode}`, bag.generatedBy.displayName))
  }
  for (const handover of state.dispatchBagHandovers.filter((item) => bagIds.has(item.bagId))) {
    events.push(event(handover.id, 'handover', handover.handedOverAt, handover.originOfficeName, `总包已交出至 ${handover.receivingOfficeName}`, handover.handedOverBy.displayName))
    if (handover.receivedAt && handover.receivedBy) {
      events.push(event(`${handover.id}:received`, 'handover', handover.receivedAt, handover.receivingOfficeName, '总包已接收', handover.receivedBy.displayName))
    }
  }
  for (const route of state.dispatchRoutes.filter((item) => item.bagIds.some((id) => bagIds.has(id)))) {
    events.push(event(route.id, 'dispatch', route.generatedAt, route.generatedBy.acceptanceOffice, `已生成路单 ${route.routeNumber}`, route.generatedBy.displayName))
    if (route.exportedAt && route.exportedBy) {
      events.push(event(`${route.id}:exported`, 'dispatch', route.exportedAt, route.generatedBy.acceptanceOffice, `路单 ${route.routeNumber} 已出口`, route.exportedBy.displayName))
    }
  }

  for (const application of state.specialHandlingApplications.filter((item) => item.transactionId === transaction.id)) {
    events.push(event(application.id, 'special-handling', application.createdAt, application.createdBy.acceptanceOffice, application.kind === 'withdrawal' ? '已申请邮件撤单' : '已申请邮件改址', application.createdBy.displayName))
    if (application.uploadedAt) events.push(event(`${application.id}:uploaded`, 'special-handling', application.uploadedAt, application.createdBy.acceptanceOffice, '特殊处理申请已上传', application.createdBy.displayName))
  }

  for (const item of state.windowDeliveryItems.filter((candidate) => candidate.itemCode === transaction.service.itemCode)) {
    if (item.receivedAt && item.receivedBy) events.push(event(item.id, 'window-delivery', item.receivedAt, item.receivingOffice, '邮件已进入窗投处理', item.receivedBy.displayName))
    for (const audit of state.windowDeliveryAudits.filter((candidate) => candidate.itemId === item.id)) {
      events.push(event(audit.id, 'window-delivery', audit.operatedAt, audit.operatedBy.acceptanceOffice, audit.detail, audit.operatedBy.displayName))
    }
  }

  return events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
}

export function queryMailTracking(
  state: ServiceWorkspaceState,
  input: string,
): MailTrackingResult[] {
  const numbers = parseMailTrackingNumbers(input)
  if (numbers.length === 0) throw new Error('请输入一个或多个邮件号码。')
  const rank = new Map(numbers.map((number, index) => [number, index]))
  return state.transactions
    .filter((transaction) => rank.has(transaction.service.itemCode.trim().toUpperCase()))
    .map((transaction) => ({ transaction, events: trackingEvents(state, transaction) }))
    .sort((left, right) => (
      (rank.get(left.transaction.service.itemCode.trim().toUpperCase()) ?? 0) -
      (rank.get(right.transaction.service.itemCode.trim().toUpperCase()) ?? 0)
    ))
}

export function queryAcceptedMail(
  state: ServiceWorkspaceState,
  query: AcceptedMailQuery,
): ServiceTransaction[] {
  validateDateRange(query.acceptedDateFrom, query.acceptedDateTo, 3)
  return state.transactions
    .filter((transaction) => contains(transaction.id, query.querySerial) || contains(transaction.sourceBatchId, query.querySerial) || contains(transaction.sourceOrderNumber, query.querySerial))
    .filter((transaction) => contains(`${transaction.product.label} ${transaction.product.searchCode} ${transaction.product.effectiveBusinessCode}`, query.product))
    .filter((transaction) => contains(transaction.service.itemCode, query.itemCode))
    .filter((transaction) => contains(transaction.operator.operatorId, query.operatorId))
    .filter((transaction) => contains(transaction.customer.sender.name, query.senderName))
    .filter((transaction) => contains(transaction.customer.recipient.name, query.recipientName))
    .filter((transaction) => contains(transaction.operator.workstationCode, query.workstationCode))
    .filter((transaction) => contains(transaction.service.destinationOffice, query.destinationOffice))
    .filter((transaction) => contains(transaction.customer.sender.agreementAccountId, query.agreementAccountId))
    .filter((transaction) => {
      const acceptedDate = datePart(transaction.acceptedAt)
      return acceptedDate >= query.acceptedDateFrom && acceptedDate <= query.acceptedDateTo
    })
    .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))
}
