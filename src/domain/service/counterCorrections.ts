import { businessCalendarDay } from '../shared/businessTime'
import { POSTAL_SUPPLY_ITEMS } from './seed'
import { SUPPLEMENTARY_SUBJECTS, supplementaryTrafficRecordId } from './supplementaryTraffic'
import { assertAccountingOpen } from './personalRemittance'
import {
  requireOnSiteAuthorization,
  type OnSiteAuthorization,
} from '../access/workAuthorization'
import { remainingPostalSupplyStock } from './transactions'
import type {
  PostalSupplySale,
  PostalSupplySaleLine,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
  SupplementaryIncomeRecord,
  SupplementaryTrafficKind,
  SupplementaryTrafficRecord,
} from './types'

export interface PostalSupplySaleQuery {
  querySerial: string
  itemTerm: string
  customerTerm: string
  contactTerm: string
  operatorId: string
  workstationCode: string
  acceptedDateFrom: string
  acceptedDateTo: string
  status: '' | PostalSupplySale['status']
}

export interface SupplementaryTrafficCorrectionQuery {
  querySerial: string
  businessKind: '' | SupplementaryTrafficKind
  subjectTerm: string
  operatorId: string
  workstationCode: string
  acceptedDateFrom: string
  acceptedDateTo: string
  status: '' | SupplementaryTrafficRecord['status']
}

export type CounterCorrectionCommand =
  | {
      type: 'revise-postal-supply-sale'
      saleId: string
      quantities: Array<{ itemId: string; quantity: number }>
      reason: string
      operatedAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'delete-postal-supply-sales'
      saleIds: string[]
      reason: string
      operatedAt: string
      operator: ServiceOperatorSnapshot
      authorization: OnSiteAuthorization
    }
  | {
      type: 'record-postal-supply-receipt-print'
      saleId: string
      printedAt: string
    }
  | {
      type: 'replace-supplementary-income'
      recordId: string
      subjectCode: string
      count: number
      amountCents: number
      paymentMethod: 'cash-settlement' | 'credit'
      reason: string
      operatedAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'delete-supplementary-traffic-record'
      recordId: string
      reason: string
      operatedAt: string
      operator: ServiceOperatorSnapshot
      authorization: OnSiteAuthorization
    }

export interface CounterCorrectionResult {
  state: ServiceWorkspaceState
  affectedIds: string[]
}

function includesNormalized(value: string, term: string): boolean {
  return value.toLocaleLowerCase('zh-CN').includes(term.toLocaleLowerCase('zh-CN'))
}

function normalizedReason(value: string): string {
  const reason = value.trim()
  if (reason.length < 2) throw new Error('查改原因至少填写 2 个字符。')
  return reason
}

function assertOperatedAt(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) throw new Error('查改时间格式无效。')
}

export function queryPostalSupplySales(
  sales: PostalSupplySale[],
  query: PostalSupplySaleQuery,
): PostalSupplySale[] {
  const serial = query.querySerial.trim()
  const itemTerm = query.itemTerm.trim()
  const customerTerm = query.customerTerm.trim()
  const contactTerm = query.contactTerm.trim()
  const operatorTerm = query.operatorId.trim()
  const workstation = query.workstationCode.trim()
  return sales
    .filter((sale) => !query.status || sale.status === query.status)
    .filter((sale) => !serial || includesNormalized(sale.id, serial))
    .filter((sale) => !itemTerm || sale.lines.some((line) => [
      line.label,
      line.mnemonic,
      line.itemId,
    ].some((value) => includesNormalized(value, itemTerm))))
    .filter((sale) => !customerTerm || [
      sale.sender.name,
      sale.sender.unit,
      sale.sender.agreementAccountId ?? '',
      sale.sender.agreementAccountName ?? '',
    ].some((value) => includesNormalized(value, customerTerm)))
    .filter((sale) => !contactTerm || sale.sender.contact.includes(contactTerm))
    .filter((sale) => !operatorTerm || [
      sale.operator.operatorId,
      sale.operator.displayName,
    ].some((value) => includesNormalized(value, operatorTerm)))
    .filter((sale) => !workstation || sale.operator.workstationCode === workstation)
    .filter((sale) => !query.acceptedDateFrom || businessCalendarDay(sale.acceptedAt) >= query.acceptedDateFrom)
    .filter((sale) => !query.acceptedDateTo || businessCalendarDay(sale.acceptedAt) <= query.acceptedDateTo)
    .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))
}

export function querySupplementaryTrafficCorrections(
  records: SupplementaryTrafficRecord[],
  query: SupplementaryTrafficCorrectionQuery,
): SupplementaryTrafficRecord[] {
  const serial = query.querySerial.trim()
  const subjectTerm = query.subjectTerm.trim()
  const operatorTerm = query.operatorId.trim()
  const workstation = query.workstationCode.trim()
  return records
    .filter((record) => !query.status || record.status === query.status)
    .filter((record) => !query.businessKind || record.kind === query.businessKind)
    .filter((record) => !serial || includesNormalized(record.id, serial))
    .filter((record) => !subjectTerm || (
      record.kind === 'supplementary-income'
        ? [record.subjectCode, record.subjectLabel, record.subjectCategoryLabel]
          .some((value) => includesNormalized(value, subjectTerm))
        : [record.mail.mailNumber, record.mail.productLabel]
          .some((value) => includesNormalized(value, subjectTerm))
    ))
    .filter((record) => !operatorTerm || [
      record.operator.operatorId,
      record.operator.displayName,
    ].some((value) => includesNormalized(value, operatorTerm)))
    .filter((record) => !workstation || record.operator.workstationCode === workstation)
    .filter((record) => !query.acceptedDateFrom || businessCalendarDay(record.acceptedAt) >= query.acceptedDateFrom)
    .filter((record) => !query.acceptedDateTo || businessCalendarDay(record.acceptedAt) <= query.acceptedDateTo)
    .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))
}

export function postalSupplySaleStatusLabel(status: PostalSupplySale['status']): string {
  if (status === 'pending-settlement') return '未结算'
  if (status === 'settled') return '已结算'
  return '已删除'
}

export function supplementaryCorrectionStatusLabel(
  status: SupplementaryTrafficRecord['status'],
): string {
  if (status === 'pending-settlement') return '未结算'
  if (status === 'settled') return '已结算'
  if (status === 'adjusted') return '已调账'
  return '已删除'
}

function activePostalSupplySale(state: ServiceWorkspaceState, saleId: string): PostalSupplySale {
  const sale = state.postalSupplySales.find((candidate) => candidate.id === saleId)
  if (!sale || sale.status === 'deleted') throw new Error(`未找到有效用邮物品销售记录 ${saleId}。`)
  return sale
}

function assertSameDayPending(
  id: string,
  status: 'pending-settlement' | 'settled' | 'deleted' | 'adjusted',
  settlementId: string | null,
  acceptedAt: string,
  operatedAt: string,
): void {
  if (status !== 'pending-settlement' || settlementId) {
    throw new Error(`${id} 已缴款，不能直接修改或删除。`)
  }
  if (businessCalendarDay(acceptedAt) !== businessCalendarDay(operatedAt)) {
    throw new Error(`${id} 不是当天记录，不能直接修改或删除。`)
  }
}

function revisePostalSupplySale(
  state: ServiceWorkspaceState,
  command: Extract<CounterCorrectionCommand, { type: 'revise-postal-supply-sale' }>,
): CounterCorrectionResult {
  assertOperatedAt(command.operatedAt)
  const reason = normalizedReason(command.reason)
  const sale = activePostalSupplySale(state, command.saleId)
  assertSameDayPending(sale.id, sale.status, sale.settlementId, sale.acceptedAt, command.operatedAt)
  assertAccountingOpen(state, sale.operator, command.operatedAt)
  if (command.quantities.length !== sale.lines.length) throw new Error('请完整填写每一种物品的修改数量。')
  const quantityMap = new Map(command.quantities.map((line) => [line.itemId, line.quantity]))
  if (quantityMap.size !== sale.lines.length) throw new Error('用邮物品修改明细存在重复或缺失。')
  const lines = sale.lines.map((line): PostalSupplySaleLine => {
    const quantity = quantityMap.get(line.itemId)
    if (quantity === undefined) throw new Error(`缺少 ${line.label} 的修改数量。`)
    const catalog = POSTAL_SUPPLY_ITEMS.find((item) => item.id === line.itemId)
    if (!catalog) throw new Error(`未找到用邮物品 ${line.itemId}。`)
    const available = remainingPostalSupplyStock(state, line.itemId, sale.operator.operatorId) + line.quantity
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > available) {
      throw new Error(`${line.label}修改数量须为 1 至 ${available} 的整数。`)
    }
    return {
      ...line,
      quantity,
      amountCents: line.unitPriceCents * quantity,
    }
  })
  const nextTotalCents = lines.reduce((total, line) => total + line.amountCents, 0)
  const revisionNumber = (sale.revisions?.length ?? 0) + 1
  const revised: PostalSupplySale = {
    ...sale,
    lines,
    totalCents: nextTotalCents,
    revisions: [
      ...(sale.revisions ?? []),
      {
        id: `${sale.id}-XG-${String(revisionNumber).padStart(2, '0')}`,
        revisedAt: command.operatedAt,
        revisedBy: structuredClone(command.operator),
        reason,
        lines: sale.lines.map((line, index) => {
          const nextLine = lines[index]
          if (!nextLine) throw new Error(`缺少 ${line.label} 的修改结果。`)
          return {
            itemId: line.itemId,
            label: line.label,
            previousQuantity: line.quantity,
            nextQuantity: nextLine.quantity,
            previousAmountCents: line.amountCents,
            nextAmountCents: nextLine.amountCents,
          }
        }),
        previousTotalCents: sale.totalCents,
        nextTotalCents,
      },
    ],
  }
  return {
    affectedIds: [revised.id],
    state: {
      ...state,
      postalSupplySales: state.postalSupplySales.map((candidate) =>
        candidate.id === revised.id ? revised : candidate,
      ),
    },
  }
}

function deletePostalSupplySales(
  state: ServiceWorkspaceState,
  command: Extract<CounterCorrectionCommand, { type: 'delete-postal-supply-sales' }>,
): CounterCorrectionResult {
  assertOperatedAt(command.operatedAt)
  const reason = normalizedReason(command.reason)
  const ids = [...new Set(command.saleIds)]
  if (ids.length === 0) throw new Error('请选择需要删除的用邮物品销售记录。')
  requireOnSiteAuthorization(
    command.authorization,
    'delete-postal-supply-sale',
    command.operator.operatorId,
  )
  const sales = ids.map((id) => activePostalSupplySale(state, id))
  for (const sale of sales) {
    assertSameDayPending(sale.id, sale.status, sale.settlementId, sale.acceptedAt, command.operatedAt)
    assertAccountingOpen(state, sale.operator, command.operatedAt)
  }
  const updates = new Map(sales.map((sale) => [sale.id, {
    ...sale,
    status: 'deleted' as const,
    deletedAt: command.operatedAt,
    deletedBy: structuredClone(command.operator),
    deletionReason: reason,
  }]))
  return {
    affectedIds: ids,
    state: {
      ...state,
      postalSupplySales: state.postalSupplySales.map((sale) => updates.get(sale.id) ?? sale),
    },
  }
}

function recordPostalSupplyReceiptPrint(
  state: ServiceWorkspaceState,
  command: Extract<CounterCorrectionCommand, { type: 'record-postal-supply-receipt-print' }>,
): CounterCorrectionResult {
  assertOperatedAt(command.printedAt)
  const sale = activePostalSupplySale(state, command.saleId)
  const updated: PostalSupplySale = {
    ...sale,
    receiptPrintedAt: [...(sale.receiptPrintedAt ?? []), command.printedAt],
  }
  return {
    affectedIds: [updated.id],
    state: {
      ...state,
      postalSupplySales: state.postalSupplySales.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    },
  }
}

function activeSupplementaryRecord(
  state: ServiceWorkspaceState,
  recordId: string,
): SupplementaryTrafficRecord {
  const record = state.supplementaryTrafficRecords.find((candidate) => candidate.id === recordId)
  if (!record || record.status === 'deleted' || record.status === 'adjusted') {
    throw new Error(`未找到有效补录/交管记录 ${recordId}。`)
  }
  return record
}

function replaceSupplementaryIncome(
  state: ServiceWorkspaceState,
  command: Extract<CounterCorrectionCommand, { type: 'replace-supplementary-income' }>,
): CounterCorrectionResult {
  assertOperatedAt(command.operatedAt)
  const reason = normalizedReason(command.reason)
  const target = activeSupplementaryRecord(state, command.recordId)
  if (target.kind !== 'supplementary-income') throw new Error('当前记录不是可调账重录的补录科目。')
  assertAccountingOpen(state, target.operator, command.operatedAt)
  if (
    target.operator.operatorId !== command.operator.operatorId
    || target.operator.workstationCode !== command.operator.workstationCode
  ) {
    assertAccountingOpen(state, command.operator, command.operatedAt)
  }
  const subject = SUPPLEMENTARY_SUBJECTS.find((candidate) => candidate.code === command.subjectCode)
  if (!subject) throw new Error('请选择有效的补录科目。')
  if (!Number.isInteger(command.count) || command.count < 1) throw new Error('件／笔数必须为正整数。')
  if (!Number.isInteger(command.amountCents) || command.amountCents < 1) throw new Error('补录金额必须大于 0 元。')
  if (command.paymentMethod === 'credit' && !target.agreementAccountId) {
    throw new Error('零星客户不能选择记欠。')
  }
  const sameDay = businessCalendarDay(target.acceptedAt) === businessCalendarDay(command.operatedAt)
  if (sameDay && (target.status !== 'pending-settlement' || target.settlementId)) {
    throw new Error(`${target.id} 当天已经缴款，不能删除重录。`)
  }
  const replacementId = supplementaryTrafficRecordId(
    target.kind,
    command.operatedAt,
    state.nextSupplementaryTrafficSequence,
  )
  const mode = sameDay ? 'same-day-reentry' as const : 'cross-day-adjustment' as const
  const correctionNumber = (target.corrections?.length ?? 0) + 1
  const correction = {
    id: `${target.id}-TZ-${String(correctionNumber).padStart(2, '0')}`,
    correctedAt: command.operatedAt,
    correctedBy: structuredClone(command.operator),
    reason,
    mode,
    previousAmountCents: target.amountCents,
    nextAmountCents: command.amountCents,
    previousCount: target.count,
    nextCount: command.count,
    replacementRecordId: replacementId,
  }
  const previous: SupplementaryIncomeRecord = {
    ...target,
    status: sameDay ? 'deleted' : 'adjusted',
    corrections: [...(target.corrections ?? []), correction],
    replacementRecordId: replacementId,
    deletedAt: sameDay ? command.operatedAt : target.deletedAt ?? null,
    deletedBy: sameDay ? structuredClone(command.operator) : target.deletedBy ?? null,
    deletionReason: sameDay ? reason : target.deletionReason ?? null,
  }
  const replacement: SupplementaryIncomeRecord = {
    ...target,
    id: replacementId,
    status: 'pending-settlement',
    acceptedAt: command.operatedAt,
    operator: structuredClone(command.operator),
    paymentMethod: command.paymentMethod,
    amountCents: command.amountCents,
    settlementId: null,
    subjectCategoryCode: subject.categoryCode,
    subjectCategoryLabel: subject.categoryLabel,
    subjectCode: subject.code,
    subjectLabel: subject.label,
    count: command.count,
    creditAllowed: subject.creditAllowed,
    bulkAllowed: subject.bulkAllowed,
    corrections: [],
    replacesRecordId: target.id,
    replacementRecordId: null,
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
  }
  return {
    affectedIds: [previous.id, replacement.id],
    state: {
      ...state,
      supplementaryTrafficRecords: [
        ...state.supplementaryTrafficRecords.map((record) =>
          record.id === previous.id ? previous : record,
        ),
        replacement,
      ],
      nextSupplementaryTrafficSequence: state.nextSupplementaryTrafficSequence + 1,
    },
  }
}

function deleteSupplementaryTrafficRecord(
  state: ServiceWorkspaceState,
  command: Extract<CounterCorrectionCommand, { type: 'delete-supplementary-traffic-record' }>,
): CounterCorrectionResult {
  assertOperatedAt(command.operatedAt)
  const reason = normalizedReason(command.reason)
  requireOnSiteAuthorization(
    command.authorization,
    'delete-supplementary-traffic',
    command.operator.operatorId,
  )
  const target = activeSupplementaryRecord(state, command.recordId)
  assertSameDayPending(target.id, target.status, target.settlementId, target.acceptedAt, command.operatedAt)
  assertAccountingOpen(state, target.operator, command.operatedAt)
  const updated: SupplementaryTrafficRecord = {
    ...target,
    status: 'deleted',
    deletedAt: command.operatedAt,
    deletedBy: structuredClone(command.operator),
    deletionReason: reason,
  }
  return {
    affectedIds: [updated.id],
    state: {
      ...state,
      supplementaryTrafficRecords: state.supplementaryTrafficRecords.map((record) =>
        record.id === updated.id ? updated : record,
      ),
    },
  }
}

export function executeCounterCorrectionCommand(
  state: ServiceWorkspaceState,
  command: CounterCorrectionCommand,
): CounterCorrectionResult {
  switch (command.type) {
    case 'revise-postal-supply-sale':
      return revisePostalSupplySale(state, command)
    case 'delete-postal-supply-sales':
      return deletePostalSupplySales(state, command)
    case 'record-postal-supply-receipt-print':
      return recordPostalSupplyReceiptPrint(state, command)
    case 'replace-supplementary-income':
      return replaceSupplementaryIncome(state, command)
    case 'delete-supplementary-traffic-record':
      return deleteSupplementaryTrafficRecord(state, command)
  }
}
