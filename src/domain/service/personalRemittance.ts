import type {
  PersonalRemittanceCategory,
  PersonalRemittanceRecord,
  ServiceOperatorSnapshot,
  ServiceTransaction,
  ServiceWorkspaceState,
  SettlementRecord,
  SettlementTender,
  WindowDeliveryMoney,
} from './types'

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface RemittanceSourceLine {
  reference: string
  categoryCode: string
  categoryLabel: string
  count: number
  amountCents: number
  tender: SettlementTender
  settlementId: string
  settledAt: string
}

interface PendingReference {
  reference: string
  acceptedAt: string
}

export interface PersonalRemittanceProjection {
  workDate: string
  operatorId: string
  workstationCode: string
  categories: PersonalRemittanceCategory[]
  settlementIds: string[]
  sourceReferences: string[]
  pendingReferences: string[]
  previousDayPendingReferences: string[]
  totalCount: number
  totalAmountCents: number
  cashAmountCents: number
  posAmountCents: number
  thirdPartyAmountCents: number
  creditAmountCents: number
}

export type PersonalRemittanceCommand =
  | {
      type: 'generate-personal-remittance'
      workDate: string
      operator: ServiceOperatorSnapshot
      institutionCode: string
      institutionName: string
      workstationCode: string
      generatedAt: string
      ignoreCurrentDayPending: boolean
    }
  | {
      type: 'confirm-personal-remittance'
      remittanceId: string
      operator: ServiceOperatorSnapshot
      confirmedAt: string
    }
  | {
      type: 'cancel-personal-remittance'
      remittanceId: string
      operator: ServiceOperatorSnapshot
      cancelledAt: string
      reason: string
      managerAuthorized?: boolean
    }
  | {
      type: 'print-personal-remittance'
      remittanceId: string
      printedAt: string
    }

export interface PersonalRemittanceResult {
  state: ServiceWorkspaceState
  remittance: PersonalRemittanceRecord
}

export function businessDate(value: string): string {
  if (DAY_PATTERN.test(value)) return value
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) throw new Error('业务时间无效。')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(timestamp)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function requiredTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) throw new Error(`${label}无效。`)
  return timestamp
}

function remittanceId(workDate: string, sequence: number): string {
  return `JK-${workDate.replaceAll('-', '')}-${String(sequence).padStart(6, '0')}`
}

function activeRemittance(
  state: ServiceWorkspaceState,
  id: string,
): PersonalRemittanceRecord {
  const remittance = state.personalRemittances.find((item) => item.id === id)
  if (!remittance) throw new Error('未找到个人缴款单。')
  return remittance
}

function settlementFor(
  settlements: Map<string, SettlementRecord>,
  settlementId: string | null,
): SettlementRecord | null {
  if (!settlementId) return null
  return settlements.get(settlementId) ?? null
}

function transactionLine(
  transaction: ServiceTransaction,
  settlement: SettlementRecord,
): RemittanceSourceLine | null {
  if (transaction.service.paymentMethod === 'self-affixed') return null
  return {
    reference: transaction.id,
    categoryCode: 'mail',
    categoryLabel: '函件、包裹及寄递业务收入',
    count: 1,
    amountCents: settlement.tender === 'credit'
      ? transaction.charge.postageCents
      : transaction.charge.settlementDueCents,
    tender: settlement.tender,
    settlementId: settlement.id,
    settledAt: settlement.settledAt,
  }
}

function windowDeliveryMoneyTotal(money: WindowDeliveryMoney): number {
  return money.taxCents + money.inspectionCents + money.returnPostageCents
    + money.redirectedReturnPostageCents + money.underpaidPostageCents
    + money.underpaidHandlingCents + money.storageWaitCents
    + money.extensionServiceCents + money.codPaymentCents + money.insuranceFeeCents
}

export function settledSourceLines(
  state: ServiceWorkspaceState,
  workDate: string,
  operatorId: string,
  workstationCode: string,
): RemittanceSourceLine[] {
  const settlements = new Map(state.settlements.map((item) => [item.id, item]))
  const matches = (
    operator: ServiceOperatorSnapshot,
    settledAt: string,
  ): boolean => operator.operatorId === operatorId
    && operator.workstationCode === workstationCode
    && businessDate(settledAt) === workDate
  const lines: RemittanceSourceLine[] = []

  for (const transaction of state.transactions) {
    if (transaction.status !== 'settled') continue
    const settlement = settlementFor(settlements, transaction.settlementId)
    if (!settlement || !matches(transaction.operator, settlement.settledAt)) continue
    const line = transactionLine(transaction, settlement)
    if (line) lines.push(line)
  }

  for (const sale of state.postalSupplySales) {
    const settlement = settlementFor(settlements, sale.settlementId)
    if (sale.status !== 'settled' || !settlement || !matches(sale.operator, settlement.settledAt)) continue
    lines.push({
      reference: sale.id,
      categoryCode: 'postal-supply',
      categoryLabel: '用邮物品销售收入',
      count: sale.lines.reduce((total, line) => total + line.quantity, 0),
      amountCents: sale.totalCents,
      tender: settlement.tender,
      settlementId: settlement.id,
      settledAt: settlement.settledAt,
    })
  }

  for (const order of state.channelProductOrders) {
    const settlement = settlementFor(settlements, order.settlementId)
    if (order.status !== 'settled' || !settlement || !matches(order.operator, settlement.settledAt)) continue
    lines.push({
      reference: order.id,
      categoryCode: 'channel-product',
      categoryLabel: '商品销售收入',
      count: order.totalQuantity,
      amountCents: order.totalCents,
      tender: settlement.tender,
      settlementId: settlement.id,
      settledAt: settlement.settledAt,
    })
  }

  for (const record of state.supplementaryTrafficRecords) {
    const settlement = settlementFor(settlements, record.settlementId)
    if (record.status !== 'settled' || !settlement || !matches(record.operator, settlement.settledAt)) continue
    lines.push({
      reference: record.id,
      categoryCode: 'supplementary',
      categoryLabel: '补录及交管业务收入',
      count: 1,
      amountCents: record.amountCents,
      tender: settlement.tender,
      settlementId: settlement.id,
      settledAt: settlement.settledAt,
    })
  }

  for (const record of state.electronicCommerceRecords) {
    const settlement = settlementFor(settlements, record.settlementId)
    if (record.status !== 'settled' || !settlement || !matches(record.operator, settlement.settledAt)) continue
    lines.push({
      reference: record.id,
      categoryCode: 'ecommerce',
      categoryLabel: '电子商务收入',
      count: 1,
      amountCents: record.amountCents,
      tender: settlement.tender,
      settlementId: settlement.id,
      settledAt: settlement.settledAt,
    })
  }

  for (const batch of state.bulkBatches) {
    if (batch.paymentMethod === 'self-affixed') continue
    if (batch.settlementStatus !== 'settled' || !batch.settledAt || !matches(batch.operator, batch.settledAt)) continue
    lines.push({
      reference: batch.id,
      categoryCode: 'bulk',
      categoryLabel: '大宗寄递收入',
      count: batch.successCount,
      amountCents: Math.max(0, batch.totalSettlementDueCents - batch.couponDiscountCents),
      tender: batch.paymentMethod === 'credit' ? 'credit' : 'cash',
      settlementId: `BULK:${batch.id}`,
      settledAt: batch.settledAt,
    })
  }

  for (const redemption of state.replyCouponRedemptions) {
    if (redemption.status !== 'settled' || !redemption.settledAt || !redemption.tender) continue
    if (!matches(redemption.operator, redemption.settledAt)) continue
    lines.push({
      reference: redemption.id,
      categoryCode: 'reply-coupon',
      categoryLabel: '国际回信券兑付收入',
      count: redemption.itemCount,
      amountCents: redemption.amountDueCents,
      tender: redemption.tender,
      settlementId: redemption.settlementId ?? `COUPON:${redemption.id}`,
      settledAt: redemption.settledAt,
    })
  }

  for (const application of state.specialHandlingApplications) {
    if (!application.settledAt || !application.settlementTender || application.cancelledAt) continue
    if (!matches(application.createdBy, application.settledAt)) continue
    lines.push({
      reference: application.id,
      categoryCode: 'special-handling',
      categoryLabel: '特殊处理收入',
      count: 1,
      amountCents: application.feeCents,
      tender: application.settlementTender,
      settlementId: `SPECIAL:${application.id}`,
      settledAt: application.settledAt,
    })
  }

  for (const item of state.windowDeliveryItems) {
    if (item.status !== 'cancelled' || !item.processedAt || !item.processedBy || !item.cancellation) continue
    if (!matches(item.processedBy, item.processedAt)) continue
    lines.push({
      reference: item.id,
      categoryCode: 'window-delivery',
      categoryLabel: '窗投业务收入',
      count: 1,
      amountCents: windowDeliveryMoneyTotal(item.money),
      tender: item.cancellation.tender,
      settlementId: `WINDOW:${item.id}`,
      settledAt: item.processedAt,
    })
  }

  const refundedReferences = new Set(
    state.refunds
      .filter((refund) => refund.status === 'refunded'
        && refund.processedAt
        && businessDate(refund.processedAt) <= workDate)
      .map((refund) => refund.transactionId),
  )
  return lines.filter((line) => !refundedReferences.has(line.reference))
}

function pendingReferences(
  state: ServiceWorkspaceState,
  operatorId: string,
  workstationCode: string,
): PendingReference[] {
  const matches = (operator: ServiceOperatorSnapshot): boolean =>
    operator.operatorId === operatorId && operator.workstationCode === workstationCode
  return [
    ...state.transactions
      .filter((item) => item.status === 'pending-settlement' && matches(item.operator))
      .map((item) => ({ reference: item.id, acceptedAt: item.acceptedAt })),
    ...state.postalSupplySales
      .filter((item) => item.status === 'pending-settlement' && matches(item.operator))
      .map((item) => ({ reference: item.id, acceptedAt: item.acceptedAt })),
    ...state.channelProductOrders
      .filter((item) => item.status === 'pending-settlement' && matches(item.operator))
      .map((item) => ({ reference: item.id, acceptedAt: item.submittedAt })),
    ...state.supplementaryTrafficRecords
      .filter((item) => item.status === 'pending-settlement' && matches(item.operator))
      .map((item) => ({ reference: item.id, acceptedAt: item.acceptedAt })),
    ...state.electronicCommerceRecords
      .filter((item) => item.status === 'pending-settlement' && matches(item.operator))
      .map((item) => ({ reference: item.id, acceptedAt: item.acceptedAt })),
    ...state.bulkBatches
      .filter((item) => item.settlementStatus === 'unsettled' && matches(item.operator))
      .map((item) => ({ reference: item.id, acceptedAt: item.importedAt })),
  ]
}

export function projectPersonalRemittance(
  state: ServiceWorkspaceState,
  workDate: string,
  operatorId: string,
  workstationCode: string,
): PersonalRemittanceProjection {
  if (!DAY_PATTERN.test(workDate)) throw new Error('统计日期格式无效。')
  const lines = settledSourceLines(state, workDate, operatorId, workstationCode)
  const grouped = new Map<string, PersonalRemittanceCategory>()
  for (const line of lines) {
    const current = grouped.get(line.categoryCode) ?? {
      code: line.categoryCode,
      label: line.categoryLabel,
      count: 0,
      amountCents: 0,
    }
    current.count += line.count
    current.amountCents += line.amountCents
    grouped.set(line.categoryCode, current)
  }
  const pending = pendingReferences(state, operatorId, workstationCode)
  return {
    workDate,
    operatorId,
    workstationCode,
    categories: [...grouped.values()],
    settlementIds: [...new Set(lines.map((line) => line.settlementId))],
    sourceReferences: lines.map((line) => line.reference),
    pendingReferences: pending
      .filter((item) => businessDate(item.acceptedAt) === workDate)
      .map((item) => item.reference),
    previousDayPendingReferences: pending
      .filter((item) => businessDate(item.acceptedAt) < workDate)
      .map((item) => item.reference),
    totalCount: lines.reduce((total, line) => total + line.count, 0),
    totalAmountCents: lines.reduce((total, line) => total + line.amountCents, 0),
    cashAmountCents: lines
      .filter((line) => line.tender === 'cash')
      .reduce((total, line) => total + line.amountCents, 0),
    posAmountCents: lines
      .filter((line) => line.tender === 'pos')
      .reduce((total, line) => total + line.amountCents, 0),
    thirdPartyAmountCents: lines
      .filter((line) => line.tender === 'third-party')
      .reduce((total, line) => total + line.amountCents, 0),
    creditAmountCents: lines
      .filter((line) => line.tender === 'credit')
      .reduce((total, line) => total + line.amountCents, 0),
  }
}

export function confirmedPersonalRemittance(
  state: ServiceWorkspaceState,
  operatorId: string,
  workstationCode: string,
  workDate: string,
): PersonalRemittanceRecord | null {
  return state.personalRemittances
    .slice()
    .reverse()
    .find((item) => item.operator.operatorId === operatorId
      && item.workstationCode === workstationCode
      && item.workDate === workDate
      && item.status === 'confirmed') ?? null
}

function replaceRemittance(
  state: ServiceWorkspaceState,
  remittance: PersonalRemittanceRecord,
): PersonalRemittanceResult {
  return {
    remittance: structuredClone(remittance),
    state: {
      ...state,
      personalRemittances: state.personalRemittances.map((item) =>
        item.id === remittance.id ? remittance : item),
    },
  }
}

export function executePersonalRemittanceCommand(
  state: ServiceWorkspaceState,
  command: PersonalRemittanceCommand,
): PersonalRemittanceResult {
  if (command.type === 'generate-personal-remittance') {
    requiredTimestamp(command.generatedAt, '生成时间')
    if (command.operator.workstationCode !== command.workstationCode) {
      throw new Error('所选台席与当前操作员台席不一致。')
    }
    const hasActive = state.personalRemittances.some((item) =>
      item.workDate === command.workDate
      && item.operator.operatorId === command.operator.operatorId
      && item.workstationCode === command.workstationCode
      && item.status !== 'cancelled')
    if (hasActive) throw new Error('当前统计日期和台席已经存在有效个人缴款单。')

    const projection = projectPersonalRemittance(
      state,
      command.workDate,
      command.operator.operatorId,
      command.workstationCode,
    )
    if (projection.previousDayPendingReferences.length > 0) {
      throw new Error(`存在 ${projection.previousDayPendingReferences.length} 笔历史未结算业务，结算完成后才能生成个人缴款单。`)
    }
    if (projection.pendingReferences.length > 0 && !command.ignoreCurrentDayPending) {
      throw new Error(`当天还有 ${projection.pendingReferences.length} 笔未结算业务，请确认是否忽略后生成。`)
    }
    if (projection.sourceReferences.length === 0 && projection.pendingReferences.length === 0) {
      throw new Error('当前统计日期和台席没有可生成的缴款数据。')
    }

    const remittance: PersonalRemittanceRecord = {
      id: remittanceId(command.workDate, state.nextPersonalRemittanceSequence),
      workDate: command.workDate,
      workstationCode: command.workstationCode,
      operator: structuredClone(command.operator),
      institutionCode: command.institutionCode,
      institutionName: command.institutionName,
      status: 'generated',
      categories: projection.categories,
      settlementIds: projection.settlementIds,
      sourceReferences: projection.sourceReferences,
      ignoredPendingReferences: command.ignoreCurrentDayPending
        ? projection.pendingReferences
        : [],
      totalCount: projection.totalCount,
      totalAmountCents: projection.totalAmountCents,
      cashAmountCents: projection.cashAmountCents,
      posAmountCents: projection.posAmountCents,
      thirdPartyAmountCents: projection.thirdPartyAmountCents,
      creditAmountCents: projection.creditAmountCents,
      generatedAt: command.generatedAt,
      confirmedAt: null,
      confirmedBy: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: '',
      printHistory: [],
    }
    return {
      remittance,
      state: {
        ...state,
        personalRemittances: [...state.personalRemittances, remittance],
        nextPersonalRemittanceSequence: state.nextPersonalRemittanceSequence + 1,
      },
    }
  }

  const current = activeRemittance(state, command.remittanceId)
  if (command.type === 'confirm-personal-remittance') {
    if (current.status !== 'generated') throw new Error('只有待确认的个人缴款单可以确认缴款。')
    if (command.operator.operatorId !== current.operator.operatorId) {
      throw new Error('只能确认本人生成的个人缴款单。')
    }
    if (requiredTimestamp(command.confirmedAt, '确认时间')
      < requiredTimestamp(current.generatedAt, '生成时间')) {
      throw new Error('确认时间不得早于生成时间。')
    }
    return replaceRemittance(state, {
      ...current,
      status: 'confirmed',
      confirmedAt: command.confirmedAt,
      confirmedBy: structuredClone(command.operator),
    })
  }

  if (command.type === 'cancel-personal-remittance') {
    if (current.status === 'cancelled') throw new Error('该个人缴款单已经注销。')
    const institutionRemittance = state.institutionRemittances.find((item) =>
      item.status !== 'cancelled' && item.personalRemittanceIds.includes(current.id))
    if (institutionRemittance) {
      throw new Error(`个人缴款单已纳入支局缴款单 ${institutionRemittance.id}，请先注销支局缴款单。`)
    }
    if (current.operator.operatorId !== command.operator.operatorId
      && !command.managerAuthorized) {
      throw new Error('当前仅允许本人注销个人缴款单。')
    }
    const reason = command.reason.trim()
    if (reason.length < 2) throw new Error('请输入至少两个字的注销原因。')
    if (requiredTimestamp(command.cancelledAt, '注销时间')
      < requiredTimestamp(current.generatedAt, '生成时间')) {
      throw new Error('注销时间不得早于生成时间。')
    }
    return replaceRemittance(state, {
      ...current,
      status: 'cancelled',
      cancelledAt: command.cancelledAt,
      cancelledBy: structuredClone(command.operator),
      cancelReason: reason,
    })
  }

  if (current.status === 'cancelled') throw new Error('已注销的个人缴款单不能打印。')
  requiredTimestamp(command.printedAt, '打印时间')
  return replaceRemittance(state, {
    ...current,
    printHistory: [...current.printHistory, command.printedAt],
  })
}

export function remittanceLocksAccounting(
  state: ServiceWorkspaceState,
  operatorId: string,
  workstationCode: string,
  occurredAt: string,
): PersonalRemittanceRecord | null {
  return confirmedPersonalRemittance(
    state,
    operatorId,
    workstationCode,
    businessDate(occurredAt),
  )
}

export function assertAccountingOpen(
  state: ServiceWorkspaceState,
  operator: ServiceOperatorSnapshot,
  occurredAt: string,
): void {
  const remittance = remittanceLocksAccounting(
    state,
    operator.operatorId,
    operator.workstationCode,
    occurredAt,
  )
  if (remittance) {
    throw new Error(`台席 ${operator.workstationCode} 已确认个人缴款单 ${remittance.id}，请先注销缴款单后再办理影响账务的操作。`)
  }
}
