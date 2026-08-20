import type {
  BankDepositSlipDetail,
  BankDepositSlipRecord,
  BusinessReportCategory,
  BusinessReportPeriod,
  BusinessReportPrintRecord,
  BusinessReportScope,
  InstitutionRemittanceRecord,
  PersonalRemittanceCategory,
  PersonalRemittanceRecord,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from './types'
import { businessCalendarDay } from '../shared/businessTime'
import {
  businessDate,
  projectPersonalRemittance,
  settledSourceLines,
  type RemittanceSourceLine,
} from './personalRemittance'

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/

export interface InstitutionWorkstationStatus {
  operator: ServiceOperatorSnapshot
  status: 'confirmed' | 'unclosed'
  personalRemittanceId: string | null
  pendingReferences: string[]
}

export interface InstitutionRemittanceProjection {
  workDate: string
  institutionCode: string
  institutionName: string
  workstationStatuses: InstitutionWorkstationStatus[]
  unclosedWorkstations: InstitutionWorkstationStatus[]
  pendingReferences: string[]
  categories: PersonalRemittanceCategory[]
  personalRemittanceIds: string[]
  sourceReferences: string[]
  totalCount: number
  totalAmountCents: number
  cashAmountCents: number
  posAmountCents: number
  thirdPartyAmountCents: number
  creditAmountCents: number
}

export interface BankDepositProjection {
  workDate: string
  rangeStart: string
  rangeEnd: string
  details: BankDepositSlipDetail[]
  sourceReferences: string[]
  totalAmountCents: number
}

export interface BusinessReportProjection {
  scope: BusinessReportScope
  period: BusinessReportPeriod
  startDate: string
  endDate: string
  categories: BusinessReportCategory[]
  totalCount: number
  totalAmountCents: number
  totalTaxCents: number
  totalGrossAmountCents: number
}

export type InstitutionAccountingCommand =
  | {
      type: 'generate-institution-remittance'
      workDate: string
      institutionCode: string
      institutionName: string
      operator: ServiceOperatorSnapshot
      generatedAt: string
      managerAuthorized: boolean
    }
  | {
      type: 'confirm-institution-remittance'
      remittanceId: string
      operator: ServiceOperatorSnapshot
      confirmedAt: string
      managerAuthorized: boolean
    }
  | {
      type: 'cancel-institution-remittance'
      remittanceId: string
      operator: ServiceOperatorSnapshot
      cancelledAt: string
      reason: string
      managerAuthorized: boolean
    }
  | {
      type: 'print-institution-remittance'
      remittanceId: string
      printedAt: string
    }
  | {
      type: 'generate-bank-deposit'
      workDate: string
      institutionCode: string
      institutionName: string
      rangeStart: string
      rangeEnd: string
      operator: ServiceOperatorSnapshot
      generatedAt: string
      managerAuthorized: boolean
    }
  | {
      type: 'cancel-bank-deposit'
      slipId: string
      operator: ServiceOperatorSnapshot
      cancelledAt: string
      reason: string
      managerAuthorized: boolean
    }
  | {
      type: 'print-bank-deposit'
      slipId: string
      printedAt: string
    }
  | {
      type: 'print-business-report'
      scope: BusinessReportScope
      period: BusinessReportPeriod
      startDate: string
      endDate: string
      institutionCode: string
      institutionName: string
      subjectOperatorId: string | null
      subjectOperatorName: string
      workstationCode: string
      operator: ServiceOperatorSnapshot
      printedAt: string
      managerAuthorized: boolean
    }

export interface InstitutionAccountingResult {
  state: ServiceWorkspaceState
  institutionRemittance: InstitutionRemittanceRecord | null
  bankDepositSlip: BankDepositSlipRecord | null
  businessReportPrint: BusinessReportPrintRecord | null
}

function assertManager(authorized: boolean): void {
  if (!authorized) throw new Error('支局账务操作需要营业主管权限。')
}

function requiredTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) throw new Error(`${label}无效。`)
  return timestamp
}

function assertDate(value: string, label = '统计日期'): void {
  if (!DAY_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00+08:00`))) {
    throw new Error(`${label}格式无效。`)
  }
}

function timeTimestamp(workDate: string, value: string, label: string): number {
  assertDate(workDate)
  if (!TIME_PATTERN.test(value)) throw new Error(`${label}格式无效。`)
  return requiredTimestamp(`${workDate}T${value}+08:00`, label)
}

function uniqueOperators(
  state: ServiceWorkspaceState,
  institutionCode: string,
  institutionName: string,
): ServiceOperatorSnapshot[] {
  const operators = new Map<string, ServiceOperatorSnapshot>()
  const add = (operator: ServiceOperatorSnapshot | null | undefined): void => {
    if (!operator || operator.acceptanceOffice !== institutionName) return
    operators.set(`${operator.operatorId}:${operator.workstationCode}`, structuredClone(operator))
  }

  state.transactions.forEach((item) => add(item.operator))
  state.postalSupplySales.forEach((item) => add(item.operator))
  state.channelProductOrders.forEach((item) => add(item.operator))
  state.supplementaryTrafficRecords.forEach((item) => add(item.operator))
  state.electronicCommerceRecords.forEach((item) => add(item.operator))
  state.replyCouponRedemptions.forEach((item) => add(item.operator))
  state.bulkBatches.forEach((item) => add(item.operator))
  state.specialHandlingApplications.forEach((item) => add(item.createdBy))
  state.windowDeliveryItems.forEach((item) => add(item.processedBy))
  state.personalRemittances
    .filter((item) => item.institutionCode === institutionCode)
    .forEach((item) => add(item.operator))

  return [...operators.values()]
}

function activePersonalRemittance(
  state: ServiceWorkspaceState,
  workDate: string,
  operator: ServiceOperatorSnapshot,
  institutionCode: string,
): PersonalRemittanceRecord | null {
  return state.personalRemittances
    .slice()
    .reverse()
    .find((item) => item.workDate === workDate
      && item.operator.operatorId === operator.operatorId
      && item.workstationCode === operator.workstationCode
      && item.institutionCode === institutionCode
      && item.status !== 'cancelled') ?? null
}

function aggregateCategories(
  remittances: PersonalRemittanceRecord[],
): PersonalRemittanceCategory[] {
  const grouped = new Map<string, PersonalRemittanceCategory>()
  for (const remittance of remittances) {
    for (const category of remittance.categories) {
      const current = grouped.get(category.code) ?? {
        code: category.code,
        label: category.label,
        count: 0,
        amountCents: 0,
      }
      current.count += category.count
      current.amountCents += category.amountCents
      grouped.set(category.code, current)
    }
  }
  return [...grouped.values()]
}

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightMembers = new Set(right)
  return left.every((item) => rightMembers.has(item))
}

export function projectInstitutionRemittance(
  state: ServiceWorkspaceState,
  workDate: string,
  institutionCode: string,
  institutionName: string,
): InstitutionRemittanceProjection {
  assertDate(workDate)
  const statuses: InstitutionWorkstationStatus[] = []

  for (const operator of uniqueOperators(state, institutionCode, institutionName)) {
    const projection = projectPersonalRemittance(
      state,
      workDate,
      operator.operatorId,
      operator.workstationCode,
    )
    const remittance = activePersonalRemittance(
      state,
      workDate,
      operator,
      institutionCode,
    )
    const hasBusiness = projection.sourceReferences.length > 0
      || projection.pendingReferences.length > 0
      || projection.previousDayPendingReferences.length > 0
      || remittance !== null
    if (!hasBusiness) continue
    statuses.push({
      operator,
      status: remittance?.status === 'confirmed' ? 'confirmed' : 'unclosed',
      personalRemittanceId: remittance?.id ?? null,
      pendingReferences: [
        ...projection.previousDayPendingReferences,
        ...projection.pendingReferences,
      ],
    })
  }

  const confirmed = statuses
    .map((status) => state.personalRemittances.find((item) =>
      item.id === status.personalRemittanceId && item.status === 'confirmed'))
    .filter((item): item is PersonalRemittanceRecord => Boolean(item))
  const categories = aggregateCategories(confirmed)
  return {
    workDate,
    institutionCode,
    institutionName,
    workstationStatuses: statuses,
    unclosedWorkstations: statuses.filter((item) => item.status !== 'confirmed'),
    pendingReferences: [...new Set(statuses.flatMap((item) => item.pendingReferences))],
    categories,
    personalRemittanceIds: confirmed.map((item) => item.id),
    sourceReferences: [...new Set(confirmed.flatMap((item) => item.sourceReferences))],
    totalCount: categories.reduce((total, item) => total + item.count, 0),
    totalAmountCents: categories.reduce((total, item) => total + item.amountCents, 0),
    cashAmountCents: confirmed.reduce((total, item) => total + item.cashAmountCents, 0),
    posAmountCents: confirmed.reduce((total, item) => total + item.posAmountCents, 0),
    thirdPartyAmountCents: confirmed.reduce(
      (total, item) => total + item.thirdPartyAmountCents,
      0,
    ),
    creditAmountCents: confirmed.reduce((total, item) => total + item.creditAmountCents, 0),
  }
}

function institutionSourceLines(
  state: ServiceWorkspaceState,
  workDate: string,
  institutionCode: string,
  institutionName: string,
): RemittanceSourceLine[] {
  return uniqueOperators(state, institutionCode, institutionName)
    .flatMap((operator) => settledSourceLines(
      state,
      workDate,
      operator.operatorId,
      operator.workstationCode,
    ))
}

function depositDetails(lines: RemittanceSourceLine[]): BankDepositSlipDetail[] {
  return lines.map((line) => ({
    reference: line.reference,
    categoryCode: line.categoryCode,
    categoryLabel: line.categoryLabel,
    count: line.count,
    amountCents: line.amountCents,
    settledAt: line.settledAt,
  }))
}

export function projectBankDeposit(
  state: ServiceWorkspaceState,
  workDate: string,
  institutionCode: string,
  institutionName: string,
  rangeStart: string,
  rangeEnd: string,
): BankDepositProjection {
  const start = timeTimestamp(workDate, rangeStart, '缴款起始时间')
  const end = timeTimestamp(workDate, rangeEnd, '缴款截止时间')
  if (end < start) throw new Error('缴款截止时间不得早于起始时间。')
  const deposited = new Set(
    state.bankDepositSlips
      .filter((item) => item.workDate === workDate
        && item.institutionCode === institutionCode
        && item.status === 'active')
      .flatMap((item) => item.sourceReferences),
  )
  const lines = institutionSourceLines(state, workDate, institutionCode, institutionName)
    .filter((line) => line.tender === 'cash')
    .filter((line) => {
      const settledAt = requiredTimestamp(line.settledAt, '结算时间')
      return settledAt >= start && settledAt <= end && !deposited.has(line.reference)
    })
    .sort((left, right) => left.settledAt.localeCompare(right.settledAt))
  return {
    workDate,
    rangeStart,
    rangeEnd,
    details: depositDetails(lines),
    sourceReferences: lines.map((line) => line.reference),
    totalAmountCents: lines.reduce((total, line) => total + line.amountCents, 0),
  }
}

function dateRange(startDate: string, endDate: string): string[] {
  assertDate(startDate, '开始日期')
  assertDate(endDate, '结束日期')
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (end < start) throw new Error('结束日期不得早于开始日期。')
  const dates: string[] = []
  for (let current = start; current <= end; current += 86_400_000) {
    dates.push(businessCalendarDay(new Date(current)))
  }
  return dates
}

export function projectBusinessReport(
  state: ServiceWorkspaceState,
  request: {
    scope: BusinessReportScope
    period: BusinessReportPeriod
    startDate: string
    endDate: string
    institutionCode: string
    institutionName: string
    operatorId: string | null
    workstationCode: string
    asOf: string
  },
): BusinessReportProjection {
  const dates = dateRange(request.startDate, request.endDate)
  const today = businessDate(request.asOf)
  if (request.endDate >= today) {
    throw new Error('当日业务需在次日零点汇总后才能查询和打印营业日报。')
  }
  const lines: RemittanceSourceLine[] = []
  if (request.scope === 'personal') {
    if (!request.operatorId) throw new Error('个人日报必须指定营业员工号。')
    const personalOperators = request.workstationCode
      ? uniqueOperators(state, request.institutionCode, request.institutionName)
        .filter((item) => item.operatorId === request.operatorId
          && item.workstationCode === request.workstationCode)
      : uniqueOperators(state, request.institutionCode, request.institutionName)
        .filter((item) => item.operatorId === request.operatorId)
    for (const workDate of dates) {
      for (const operator of personalOperators) {
        lines.push(...settledSourceLines(
          state,
          workDate,
          request.operatorId,
          operator.workstationCode,
        ))
      }
    }
  } else {
    for (const workDate of dates) {
      lines.push(...institutionSourceLines(
        state,
        workDate,
        request.institutionCode,
        request.institutionName,
      ))
    }
  }

  const grouped = new Map<string, BusinessReportCategory>()
  for (const line of lines) {
    const current = grouped.get(line.categoryCode) ?? {
      code: line.categoryCode,
      label: line.categoryLabel,
      count: 0,
      amountCents: 0,
      taxCents: 0,
      grossAmountCents: 0,
    }
    current.count += line.count
    current.amountCents += line.amountCents
    current.grossAmountCents += line.amountCents
    grouped.set(line.categoryCode, current)
  }
  const categories = [...grouped.values()]
  return {
    scope: request.scope,
    period: request.period,
    startDate: request.startDate,
    endDate: request.endDate,
    categories,
    totalCount: categories.reduce((total, item) => total + item.count, 0),
    totalAmountCents: categories.reduce((total, item) => total + item.amountCents, 0),
    totalTaxCents: categories.reduce((total, item) => total + item.taxCents, 0),
    totalGrossAmountCents: categories.reduce(
      (total, item) => total + item.grossAmountCents,
      0,
    ),
  }
}

function institutionRemittanceId(workDate: string, sequence: number): string {
  return `ZJJK-${workDate.replaceAll('-', '')}-${String(sequence).padStart(6, '0')}`
}

function bankDepositId(workDate: string, sequence: number): string {
  return `CX-${workDate.replaceAll('-', '')}-${String(sequence).padStart(6, '0')}`
}

function reportPrintId(sequence: number): string {
  return `YBR-${String(sequence).padStart(8, '0')}`
}

function activeInstitutionRemittance(
  state: ServiceWorkspaceState,
  id: string,
): InstitutionRemittanceRecord {
  const remittance = state.institutionRemittances.find((item) => item.id === id)
  if (!remittance) throw new Error('未找到支局缴款单。')
  return remittance
}

function activeDepositSlip(
  state: ServiceWorkspaceState,
  id: string,
): BankDepositSlipRecord {
  const slip = state.bankDepositSlips.find((item) => item.id === id)
  if (!slip) throw new Error('未找到存行单。')
  return slip
}

function createDepositSlip(
  state: ServiceWorkspaceState,
  request: {
    workDate: string
    institutionCode: string
    institutionName: string
    source: BankDepositSlipRecord['source']
    institutionRemittanceId: string | null
    rangeStart: string
    rangeEnd: string
    operator: ServiceOperatorSnapshot
    generatedAt: string
  },
): { state: ServiceWorkspaceState; slip: BankDepositSlipRecord | null } {
  const projection = projectBankDeposit(
    state,
    request.workDate,
    request.institutionCode,
    request.institutionName,
    request.rangeStart,
    request.rangeEnd,
  )
  if (projection.totalAmountCents <= 0) return { state, slip: null }
  const slip: BankDepositSlipRecord = {
    id: bankDepositId(request.workDate, state.nextBankDepositSequence),
    workDate: request.workDate,
    institutionCode: request.institutionCode,
    institutionName: request.institutionName,
    source: request.source,
    institutionRemittanceId: request.institutionRemittanceId,
    status: 'active',
    rangeStart: request.rangeStart,
    rangeEnd: request.rangeEnd,
    details: projection.details,
    sourceReferences: projection.sourceReferences,
    totalAmountCents: projection.totalAmountCents,
    generatedAt: request.generatedAt,
    generatedBy: structuredClone(request.operator),
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: '',
    printHistory: [],
  }
  return {
    slip,
    state: {
      ...state,
      bankDepositSlips: [...state.bankDepositSlips, slip],
      nextBankDepositSequence: state.nextBankDepositSequence + 1,
    },
  }
}

function result(
  state: ServiceWorkspaceState,
  institutionRemittance: InstitutionRemittanceRecord | null = null,
  bankDepositSlip: BankDepositSlipRecord | null = null,
  businessReportPrint: BusinessReportPrintRecord | null = null,
): InstitutionAccountingResult {
  return {
    state,
    institutionRemittance: institutionRemittance
      ? structuredClone(institutionRemittance)
      : null,
    bankDepositSlip: bankDepositSlip ? structuredClone(bankDepositSlip) : null,
    businessReportPrint: businessReportPrint
      ? structuredClone(businessReportPrint)
      : null,
  }
}

export function executeInstitutionAccountingCommand(
  state: ServiceWorkspaceState,
  command: InstitutionAccountingCommand,
): InstitutionAccountingResult {
  if (command.type === 'generate-institution-remittance') {
    assertManager(command.managerAuthorized)
    requiredTimestamp(command.generatedAt, '生成时间')
    const hasActive = state.institutionRemittances.some((item) =>
      item.workDate === command.workDate
      && item.institutionCode === command.institutionCode
      && item.status !== 'cancelled')
    if (hasActive) throw new Error('当前统计日期已经存在有效支局缴款单。')
    const projection = projectInstitutionRemittance(
      state,
      command.workDate,
      command.institutionCode,
      command.institutionName,
    )
    if (projection.workstationStatuses.length === 0) {
      throw new Error('当前统计日期没有可生成的支局缴款数据。')
    }
    if (projection.unclosedWorkstations.length > 0) {
      throw new Error(`仍有 ${projection.unclosedWorkstations.length} 个做业务的台席未完成个人缴款日终。`)
    }
    if (projection.pendingReferences.length > 0) {
      throw new Error(`仍有 ${projection.pendingReferences.length} 笔未结算业务，不能生成支局缴款单。`)
    }
    const remittance: InstitutionRemittanceRecord = {
      id: institutionRemittanceId(
        command.workDate,
        state.nextInstitutionRemittanceSequence,
      ),
      workDate: command.workDate,
      institutionCode: command.institutionCode,
      institutionName: command.institutionName,
      status: 'generated',
      categories: projection.categories,
      personalRemittanceIds: projection.personalRemittanceIds,
      sourceReferences: projection.sourceReferences,
      totalCount: projection.totalCount,
      totalAmountCents: projection.totalAmountCents,
      cashAmountCents: projection.cashAmountCents,
      posAmountCents: projection.posAmountCents,
      thirdPartyAmountCents: projection.thirdPartyAmountCents,
      creditAmountCents: projection.creditAmountCents,
      generatedAt: command.generatedAt,
      generatedBy: structuredClone(command.operator),
      confirmedAt: null,
      confirmedBy: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: '',
      linkedBankDepositSlipIds: [],
      printHistory: [],
    }
    return result({
      ...state,
      institutionRemittances: [...state.institutionRemittances, remittance],
      nextInstitutionRemittanceSequence: state.nextInstitutionRemittanceSequence + 1,
    }, remittance)
  }

  if (command.type === 'generate-bank-deposit') {
    assertManager(command.managerAuthorized)
    requiredTimestamp(command.generatedAt, '生成时间')
    const currentDate = businessDate(command.generatedAt)
    if (command.workDate > currentDate) throw new Error('不能生成未来日期的存行单。')
    if (command.workDate < currentDate && state.bankDepositSlips.some((item) =>
      item.workDate === command.workDate
      && item.institutionCode === command.institutionCode)) {
      throw new Error('历史日期只允许补生成一张存行单。')
    }
    const created = createDepositSlip(state, {
      ...command,
      source: 'manual',
      institutionRemittanceId: null,
    })
    if (!created.slip) throw new Error('所选时间范围内没有尚未存行的现金结算。')
    return result(created.state, null, created.slip)
  }

  if (command.type === 'print-business-report') {
    if (command.scope === 'institution') assertManager(command.managerAuthorized)
    const projection = projectBusinessReport(state, {
      scope: command.scope,
      period: command.period,
      startDate: command.startDate,
      endDate: command.endDate,
      institutionCode: command.institutionCode,
      institutionName: command.institutionName,
      operatorId: command.subjectOperatorId,
      workstationCode: command.workstationCode,
      asOf: command.printedAt,
    })
    const printRecord: BusinessReportPrintRecord = {
      id: reportPrintId(state.nextBusinessReportPrintSequence),
      ...projection,
      institutionCode: command.institutionCode,
      institutionName: command.institutionName,
      operatorId: command.subjectOperatorId,
      operatorName: command.subjectOperatorName,
      workstationCode: command.workstationCode,
      printedAt: command.printedAt,
      printedBy: structuredClone(command.operator),
    }
    return result({
      ...state,
      businessReportPrints: [...state.businessReportPrints, printRecord],
      nextBusinessReportPrintSequence: state.nextBusinessReportPrintSequence + 1,
    }, null, null, printRecord)
  }

  if (command.type === 'print-bank-deposit' || command.type === 'cancel-bank-deposit') {
    const slip = activeDepositSlip(state, command.slipId)
    if (slip.status === 'cancelled') throw new Error('该存行单已经注销。')
    if (command.type === 'print-bank-deposit') {
      requiredTimestamp(command.printedAt, '打印时间')
      const updated = {
        ...slip,
        printHistory: [...slip.printHistory, command.printedAt],
      }
      return result({
        ...state,
        bankDepositSlips: state.bankDepositSlips.map((item) =>
          item.id === updated.id ? updated : item),
      }, null, updated)
    }
    assertManager(command.managerAuthorized)
    if (businessDate(command.cancelledAt) !== slip.workDate) {
      throw new Error('只允许注销当天生成的存行单。')
    }
    const reason = command.reason.trim()
    if (reason.length < 2) throw new Error('请输入至少两个字的注销原因。')
    const updated: BankDepositSlipRecord = {
      ...slip,
      status: 'cancelled',
      cancelledAt: command.cancelledAt,
      cancelledBy: structuredClone(command.operator),
      cancelReason: reason,
    }
    return result({
      ...state,
      bankDepositSlips: state.bankDepositSlips.map((item) =>
        item.id === updated.id ? updated : item),
    }, null, updated)
  }

  const remittance = activeInstitutionRemittance(state, command.remittanceId)
  if (command.type === 'print-institution-remittance') {
    if (remittance.status === 'cancelled') throw new Error('已注销的支局缴款单不能打印。')
    requiredTimestamp(command.printedAt, '打印时间')
    const updated = {
      ...remittance,
      printHistory: [...remittance.printHistory, command.printedAt],
    }
    return result({
      ...state,
      institutionRemittances: state.institutionRemittances.map((item) =>
        item.id === updated.id ? updated : item),
    }, updated)
  }

  assertManager(command.managerAuthorized)
  if (command.type === 'confirm-institution-remittance') {
    if (remittance.status !== 'generated') throw new Error('只有待确认的支局缴款单可以确认。')
    if (requiredTimestamp(command.confirmedAt, '确认时间')
      < requiredTimestamp(remittance.generatedAt, '生成时间')) {
      throw new Error('确认时间不得早于生成时间。')
    }
    const projection = projectInstitutionRemittance(
      state,
      remittance.workDate,
      remittance.institutionCode,
      remittance.institutionName,
    )
    if (projection.unclosedWorkstations.length > 0) {
      throw new Error(`仍有 ${projection.unclosedWorkstations.length} 个做业务的台席未完成个人缴款日终。`)
    }
    if (projection.pendingReferences.length > 0) {
      throw new Error(`仍有 ${projection.pendingReferences.length} 笔未结算业务，不能确认支局缴款单。`)
    }
    if (!sameMembers(remittance.personalRemittanceIds, projection.personalRemittanceIds)
      || !sameMembers(remittance.sourceReferences, projection.sourceReferences)
      || remittance.totalCount !== projection.totalCount
      || remittance.totalAmountCents !== projection.totalAmountCents) {
      throw new Error('支局缴款数据已变化，请注销后重新生成。')
    }
    const confirmed: InstitutionRemittanceRecord = {
      ...remittance,
      status: 'confirmed',
      confirmedAt: command.confirmedAt,
      confirmedBy: structuredClone(command.operator),
    }
    let nextState: ServiceWorkspaceState = {
      ...state,
      institutionRemittances: state.institutionRemittances.map((item) =>
        item.id === confirmed.id ? confirmed : item),
    }
    let deposit: BankDepositSlipRecord | null = null
    if (confirmed.cashAmountCents > 0) {
      const created = createDepositSlip(nextState, {
        workDate: confirmed.workDate,
        institutionCode: confirmed.institutionCode,
        institutionName: confirmed.institutionName,
        source: 'institution-remittance',
        institutionRemittanceId: confirmed.id,
        rangeStart: '00:00:00',
        rangeEnd: '23:59:59',
        operator: command.operator,
        generatedAt: command.confirmedAt,
      })
      nextState = created.state
      deposit = created.slip
      if (deposit) {
        confirmed.linkedBankDepositSlipIds = [deposit.id]
        nextState = {
          ...nextState,
          institutionRemittances: nextState.institutionRemittances.map((item) =>
            item.id === confirmed.id ? confirmed : item),
        }
      }
    }
    return result(nextState, confirmed, deposit)
  }

  if (remittance.status === 'cancelled') throw new Error('该支局缴款单已经注销。')
  if (businessDate(command.cancelledAt) !== remittance.workDate) {
    throw new Error('只允许注销当天的支局缴款单。')
  }
  const reason = command.reason.trim()
  if (reason.length < 2) throw new Error('请输入至少两个字的注销原因。')
  const cancelled: InstitutionRemittanceRecord = {
    ...remittance,
    status: 'cancelled',
    cancelledAt: command.cancelledAt,
    cancelledBy: structuredClone(command.operator),
    cancelReason: reason,
  }
  const linked = new Set(remittance.linkedBankDepositSlipIds)
  const bankDepositSlips = state.bankDepositSlips.map((item) => {
    if (!linked.has(item.id)
      || item.source !== 'institution-remittance'
      || item.status === 'cancelled') return item
    return {
      ...item,
      status: 'cancelled' as const,
      cancelledAt: command.cancelledAt,
      cancelledBy: structuredClone(command.operator),
      cancelReason: `随支局缴款单 ${remittance.id} 注销：${reason}`,
    }
  })
  return result({
    ...state,
    institutionRemittances: state.institutionRemittances.map((item) =>
      item.id === cancelled.id ? cancelled : item),
    bankDepositSlips,
  }, cancelled)
}
