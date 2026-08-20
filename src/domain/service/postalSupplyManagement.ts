import { POSTAL_SUPPLY_ITEMS } from './seed'
import { businessCalendarDay } from '../shared/businessTime'
import {
  requireOnSiteAuthorization,
  type OnSiteAuthorization,
} from '../access/workAuthorization'
import type {
  PostalSupplyDocument,
  PostalSupplyDocumentKind,
  PostalSupplyDocumentLine,
  PostalSupplyDocumentStatus,
  PostalSupplyInventoryBalance,
  PostalSupplyItem,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from './types'

export const DEFAULT_POSTAL_SUPPLY_EMPLOYEE_ID = '80000001'

export interface PostalSupplyQuantityLine {
  itemId: string
  quantity: number
}

export interface PostalSupplyActualLine {
  itemId: string
  actualQuantity: number
}

export interface PostalSupplyManagementContext {
  operatedAt: string
  operator: ServiceOperatorSnapshot
  institutionCode: string
  institutionName: string
  superiorInstitutionCode: string
  superiorInstitutionName: string
}

export type PostalSupplyManagementCommand =
  | { type: 'record-postal-supply-inbound'; context: PostalSupplyManagementContext; lines: PostalSupplyQuantityLine[] }
  | { type: 'submit-postal-supply-requisition'; context: PostalSupplyManagementContext; lines: PostalSupplyQuantityLine[] }
  | { type: 'submit-postal-supply-institution-return'; context: PostalSupplyManagementContext; lines: PostalSupplyQuantityLine[] }
  | { type: 'revise-postal-supply-request'; context: PostalSupplyManagementContext; documentId: string; lines: PostalSupplyQuantityLine[] }
  | { type: 'delete-postal-supply-request'; context: PostalSupplyManagementContext; documentId: string }
  | { type: 'approve-postal-supply-request'; context: PostalSupplyManagementContext; documentId: string; lines: PostalSupplyActualLine[] }
  | { type: 'reject-postal-supply-request'; context: PostalSupplyManagementContext; documentId: string }
  | { type: 'revise-approved-postal-supply-quantities'; context: PostalSupplyManagementContext; documentId: string; lines: PostalSupplyActualLine[] }
  | { type: 'receive-postal-supply-requisition'; context: PostalSupplyManagementContext; documentId: string }
  | { type: 'issue-postal-supplies-to-employee'; context: PostalSupplyManagementContext; employeeId: string; employeeName: string; lines: PostalSupplyQuantityLine[] }
  | { type: 'return-postal-supplies-from-employee'; context: PostalSupplyManagementContext; employeeId: string; employeeName: string; lines: PostalSupplyQuantityLine[] }
  | { type: 'count-postal-supply-inventory'; context: PostalSupplyManagementContext; target: 'institution' | 'employee'; employeeId: string | null; employeeName: string | null; lines: PostalSupplyQuantityLine[]; authorization?: OnSiteAuthorization }

export interface PostalSupplyManagementResult {
  state: ServiceWorkspaceState
  document: PostalSupplyDocument
}

export interface PostalSupplyDocumentQuery {
  kind?: PostalSupplyDocumentKind | ''
  status?: PostalSupplyDocumentStatus | ''
  dateFrom?: string
  dateTo?: string
  itemTerm?: string
  employeeId?: string
}

export interface PostalSupplyInventoryRow {
  item: PostalSupplyItem
  expectedQuantity: number
  amountCents: number
}

export interface PostalSupplyBalanceRow {
  item: PostalSupplyItem
  openingQuantity: number
  inboundQuantity: number
  receivedQuantity: number
  issuedQuantity: number
  salesQuantity: number
  returnedByEmployeeQuantity: number
  returnedToSuperiorQuantity: number
  adjustmentQuantity: number
  closingQuantity: number
}

export interface PostalSupplySalesStatRow {
  id: string
  source: 'postal-supply-sale' | 'counter-mail'
  acceptedAt: string
  itemId: string
  label: string
  mnemonic: string
  unit: string
  unitPriceCents: number
  quantity: number
  amountCents: number
  operator: ServiceOperatorSnapshot
}

const DOCUMENT_PREFIX: Record<PostalSupplyDocumentKind, string> = {
  inbound: 'RK',
  requisition: 'QL',
  'institution-return': 'JT',
  'employee-issue': 'XF',
  'employee-return': 'GT',
  'inventory-count': 'PD',
}

function requireTimestamp(value: string): void {
  if (Number.isNaN(Date.parse(value))) throw new Error('操作时间无效。')
}

function datePart(value: string): string {
  return businessCalendarDay(value)
}

function documentId(kind: PostalSupplyDocumentKind, operatedAt: string, sequence: number): string {
  return `YPGL-${DOCUMENT_PREFIX[kind]}-${datePart(operatedAt).replaceAll('-', '')}-${String(sequence).padStart(6, '0')}`
}

function itemById(itemId: string): PostalSupplyItem {
  const item = POSTAL_SUPPLY_ITEMS.find((candidate) => candidate.id === itemId)
  if (!item) throw new Error(`未找到用邮物品 ${itemId}。`)
  return item
}

function normalizeLines(lines: PostalSupplyQuantityLine[]): PostalSupplyDocumentLine[] {
  if (lines.length === 0) throw new Error('请至少添加一种用邮物品。')
  if (new Set(lines.map((line) => line.itemId)).size !== lines.length) {
    throw new Error('同一种用邮物品只能保留一行。')
  }
  return lines.map((line) => {
    const item = itemById(line.itemId)
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new Error(`${item.label}数量必须为正整数。`)
    }
    return {
      itemId: item.id,
      label: item.label,
      mnemonic: item.mnemonic,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      requestedQuantity: line.quantity,
      actualQuantity: line.quantity,
      amountCents: item.unitPriceCents * line.quantity,
    }
  })
}

function balancesFor(state: ServiceWorkspaceState): PostalSupplyInventoryBalance[] {
  return POSTAL_SUPPLY_ITEMS.map((item) => {
    const stored = state.postalSupplyInventoryBalances.find((candidate) => candidate.itemId === item.id)
    return stored
      ? structuredClone(stored)
      : {
          itemId: item.id,
          superiorQuantity: item.stock * 5,
          institutionQuantity: item.stock * 2,
          employeeQuantities: { [DEFAULT_POSTAL_SUPPLY_EMPLOYEE_ID]: item.stock },
        }
  })
}

function balanceFor(balances: PostalSupplyInventoryBalance[], itemId: string): PostalSupplyInventoryBalance {
  const balance = balances.find((candidate) => candidate.itemId === itemId)
  if (!balance) throw new Error(`未找到用邮物品 ${itemId} 的库存。`)
  return balance
}

function createdDocument(
  state: ServiceWorkspaceState,
  kind: PostalSupplyDocumentKind,
  status: PostalSupplyDocumentStatus,
  context: PostalSupplyManagementContext,
  lines: PostalSupplyDocumentLine[],
  employeeId: string | null = null,
  employeeName: string | null = null,
): PostalSupplyDocument {
  requireTimestamp(context.operatedAt)
  return {
    id: documentId(kind, context.operatedAt, state.nextPostalSupplyDocumentSequence),
    kind,
    status,
    institutionCode: context.institutionCode.trim(),
    institutionName: context.institutionName.trim(),
    superiorInstitutionCode: context.superiorInstitutionCode.trim(),
    superiorInstitutionName: context.superiorInstitutionName.trim(),
    employeeId,
    employeeName,
    createdAt: context.operatedAt,
    createdBy: structuredClone(context.operator),
    updatedAt: context.operatedAt,
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    receivedAt: null,
    receivedBy: null,
    deletedAt: null,
    lines,
  }
}

function appendDocument(
  state: ServiceWorkspaceState,
  balances: PostalSupplyInventoryBalance[],
  document: PostalSupplyDocument,
): PostalSupplyManagementResult {
  const nextState: ServiceWorkspaceState = {
    ...state,
    postalSupplyInventoryBalances: balances,
    postalSupplyDocuments: [...state.postalSupplyDocuments, document],
    nextPostalSupplyDocumentSequence: state.nextPostalSupplyDocumentSequence + 1,
  }
  return { state: nextState, document }
}

function replaceDocument(
  state: ServiceWorkspaceState,
  balances: PostalSupplyInventoryBalance[],
  document: PostalSupplyDocument,
): PostalSupplyManagementResult {
  return {
    document,
    state: {
      ...state,
      postalSupplyInventoryBalances: balances,
      postalSupplyDocuments: state.postalSupplyDocuments.map((candidate) => candidate.id === document.id ? document : candidate),
    },
  }
}

function existingDocument(state: ServiceWorkspaceState, id: string): PostalSupplyDocument {
  const document = state.postalSupplyDocuments.find((candidate) => candidate.id === id)
  if (!document || document.status === 'deleted') throw new Error('未找到用邮物品业务记录。')
  return document
}

function requestedQuantities(document: PostalSupplyDocument): Map<string, number> {
  return new Map(document.lines.map((line) => [line.itemId, line.requestedQuantity]))
}

function applyActualLines(document: PostalSupplyDocument, actualLines: PostalSupplyActualLine[]): PostalSupplyDocumentLine[] {
  const requested = requestedQuantities(document)
  const actual = new Map(actualLines.map((line) => [line.itemId, line.actualQuantity]))
  if (actual.size !== document.lines.length) throw new Error('请维护全部物品的实发数量。')
  return document.lines.map((line) => {
    const quantity = actual.get(line.itemId)
    if (!Number.isInteger(quantity) || quantity === undefined || quantity < 0 || quantity > (requested.get(line.itemId) ?? 0)) {
      throw new Error(`${line.label}实发数量须为 0 至 ${line.requestedQuantity} 的整数。`)
    }
    return {
      ...line,
      actualQuantity: quantity,
      amountCents: line.unitPriceCents * quantity,
    }
  })
}

function consumedByEmployee(state: ServiceWorkspaceState, itemId: string, employeeId: string): number {
  const sold = state.postalSupplySales.reduce((total, sale) => total + (
    sale.status !== 'deleted' && sale.operator.operatorId === employeeId
      ? sale.lines.find((line) => line.itemId === itemId)?.quantity ?? 0
      : 0
  ), 0)
  const attached = state.transactions.reduce((total, transaction) => total + (
    transaction.status !== 'withdrawn' &&
    transaction.operator.operatorId === employeeId &&
    transaction.product.searchCode === '301'
      ? transaction.service.contentItems.find((line) => line.itemId === itemId)?.quantity ?? 0
      : 0
  ), 0)
  const redeemed = state.replyCouponRedemptions.reduce((total, redemption) => total + (
    redemption.status !== 'withdrawn' && redemption.operator.operatorId === employeeId
      ? redemption.lines.find((line) => line.itemId === itemId)?.quantity ?? 0
      : 0
  ), 0)
  return sold + attached + redeemed
}

export function postalSupplyEmployeeInventory(
  state: ServiceWorkspaceState,
  itemId: string,
  employeeId = DEFAULT_POSTAL_SUPPLY_EMPLOYEE_ID,
): number {
  const item = POSTAL_SUPPLY_ITEMS.find((candidate) => candidate.id === itemId)
  if (!item) return 0
  const balance = state.postalSupplyInventoryBalances.find((candidate) => candidate.itemId === itemId)
  const base = balance?.employeeQuantities[employeeId] ?? (employeeId === DEFAULT_POSTAL_SUPPLY_EMPLOYEE_ID ? item.stock : 0)
  return Math.max(0, base - consumedByEmployee(state, itemId, employeeId))
}

export function postalSupplyInstitutionInventory(state: ServiceWorkspaceState, itemId: string): number {
  return state.postalSupplyInventoryBalances.find((candidate) => candidate.itemId === itemId)?.institutionQuantity ?? 0
}

export function postalSupplySuperiorInventory(state: ServiceWorkspaceState, itemId: string): number {
  return state.postalSupplyInventoryBalances.find((candidate) => candidate.itemId === itemId)?.superiorQuantity ?? 0
}

function recordInbound(state: ServiceWorkspaceState, command: Extract<PostalSupplyManagementCommand, { type: 'record-postal-supply-inbound' }>): PostalSupplyManagementResult {
  const lines = normalizeLines(command.lines)
  const balances = balancesFor(state)
  for (const line of lines) balanceFor(balances, line.itemId).institutionQuantity += line.actualQuantity
  return appendDocument(state, balances, createdDocument(state, 'inbound', 'saved', command.context, lines))
}

function submitRequisition(state: ServiceWorkspaceState, command: Extract<PostalSupplyManagementCommand, { type: 'submit-postal-supply-requisition' }>): PostalSupplyManagementResult {
  const lines = normalizeLines(command.lines)
  const balances = balancesFor(state)
  return appendDocument(state, balances, createdDocument(state, 'requisition', 'pending-approval', command.context, lines))
}

function submitInstitutionReturn(state: ServiceWorkspaceState, command: Extract<PostalSupplyManagementCommand, { type: 'submit-postal-supply-institution-return' }>): PostalSupplyManagementResult {
  const lines = normalizeLines(command.lines)
  const balances = balancesFor(state)
  for (const line of lines) {
    const balance = balanceFor(balances, line.itemId)
    if (line.actualQuantity > balance.institutionQuantity) throw new Error(`${line.label}支局库存不足。`)
    balance.institutionQuantity -= line.actualQuantity
  }
  return appendDocument(state, balances, createdDocument(state, 'institution-return', 'pending-approval', command.context, lines))
}

function reviseRequest(state: ServiceWorkspaceState, command: Extract<PostalSupplyManagementCommand, { type: 'revise-postal-supply-request' }>): PostalSupplyManagementResult {
  const current = existingDocument(state, command.documentId)
  if (current.status !== 'pending-approval' || !['requisition', 'institution-return'].includes(current.kind)) {
    throw new Error('仅未审批的请领或机构退回记录允许修改。')
  }
  const lines = normalizeLines(command.lines)
  const balances = balancesFor(state)
  if (current.kind === 'institution-return') {
    for (const line of current.lines) balanceFor(balances, line.itemId).institutionQuantity += line.requestedQuantity
    for (const line of lines) {
      const balance = balanceFor(balances, line.itemId)
      if (line.requestedQuantity > balance.institutionQuantity) throw new Error(`${line.label}支局库存不足。`)
      balance.institutionQuantity -= line.requestedQuantity
    }
  }
  const document = { ...current, lines, updatedAt: command.context.operatedAt }
  return replaceDocument(state, balances, document)
}

function deleteRequest(state: ServiceWorkspaceState, command: Extract<PostalSupplyManagementCommand, { type: 'delete-postal-supply-request' }>): PostalSupplyManagementResult {
  const current = existingDocument(state, command.documentId)
  if (current.status !== 'pending-approval' || !['requisition', 'institution-return'].includes(current.kind)) {
    throw new Error('仅未审批记录允许删除。')
  }
  const balances = balancesFor(state)
  if (current.kind === 'institution-return') {
    for (const line of current.lines) balanceFor(balances, line.itemId).institutionQuantity += line.requestedQuantity
  }
  const document = { ...current, status: 'deleted' as const, deletedAt: command.context.operatedAt, updatedAt: command.context.operatedAt }
  return replaceDocument(state, balances, document)
}

function approveRequest(state: ServiceWorkspaceState, command: Extract<PostalSupplyManagementCommand, { type: 'approve-postal-supply-request' }>): PostalSupplyManagementResult {
  const current = existingDocument(state, command.documentId)
  if (current.status !== 'pending-approval' || !['requisition', 'institution-return'].includes(current.kind)) {
    throw new Error('该记录当前不可核发。')
  }
  const lines = applyActualLines(current, command.lines)
  const balances = balancesFor(state)
  if (current.kind === 'requisition') {
    for (const line of lines) {
      const balance = balanceFor(balances, line.itemId)
      if (line.actualQuantity > balance.superiorQuantity) throw new Error(`${line.label}上级库存数量不足。`)
      balance.superiorQuantity -= line.actualQuantity
    }
  } else {
    for (const line of lines) {
      const balance = balanceFor(balances, line.itemId)
      balance.institutionQuantity += line.requestedQuantity - line.actualQuantity
      balance.superiorQuantity += line.actualQuantity
    }
  }
  const document: PostalSupplyDocument = {
    ...current,
    status: 'approved',
    lines,
    approvedAt: command.context.operatedAt,
    approvedBy: structuredClone(command.context.operator),
    updatedAt: command.context.operatedAt,
  }
  return replaceDocument(state, balances, document)
}

function rejectRequest(state: ServiceWorkspaceState, command: Extract<PostalSupplyManagementCommand, { type: 'reject-postal-supply-request' }>): PostalSupplyManagementResult {
  const current = existingDocument(state, command.documentId)
  if (current.status !== 'pending-approval' || !['requisition', 'institution-return'].includes(current.kind)) {
    throw new Error('该记录当前不可拒绝核发。')
  }
  const balances = balancesFor(state)
  if (current.kind === 'institution-return') {
    for (const line of current.lines) balanceFor(balances, line.itemId).institutionQuantity += line.requestedQuantity
  }
  const document: PostalSupplyDocument = {
    ...current,
    status: 'rejected',
    rejectedAt: command.context.operatedAt,
    rejectedBy: structuredClone(command.context.operator),
    updatedAt: command.context.operatedAt,
  }
  return replaceDocument(state, balances, document)
}

function reviseApprovedQuantities(state: ServiceWorkspaceState, command: Extract<PostalSupplyManagementCommand, { type: 'revise-approved-postal-supply-quantities' }>): PostalSupplyManagementResult {
  const current = existingDocument(state, command.documentId)
  if (current.kind !== 'requisition' || current.status !== 'approved' || current.receivedAt) {
    throw new Error('仅已核发且尚未接收的请领记录允许调整实发数量。')
  }
  const lines = applyActualLines(current, command.lines)
  const balances = balancesFor(state)
  for (const line of lines) {
    const previous = current.lines.find((candidate) => candidate.itemId === line.itemId)?.actualQuantity ?? 0
    const delta = line.actualQuantity - previous
    const balance = balanceFor(balances, line.itemId)
    if (delta > balance.superiorQuantity) throw new Error(`${line.label}上级库存数量不足。`)
    balance.superiorQuantity -= delta
  }
  const document = { ...current, lines, updatedAt: command.context.operatedAt }
  return replaceDocument(state, balances, document)
}

function receiveRequisition(state: ServiceWorkspaceState, command: Extract<PostalSupplyManagementCommand, { type: 'receive-postal-supply-requisition' }>): PostalSupplyManagementResult {
  const current = existingDocument(state, command.documentId)
  if (current.kind !== 'requisition' || current.status !== 'approved') throw new Error('仅已核发请领记录允许确认接收。')
  const balances = balancesFor(state)
  for (const line of current.lines) balanceFor(balances, line.itemId).institutionQuantity += line.actualQuantity
  const document: PostalSupplyDocument = {
    ...current,
    status: 'received',
    receivedAt: command.context.operatedAt,
    receivedBy: structuredClone(command.context.operator),
    updatedAt: command.context.operatedAt,
  }
  return replaceDocument(state, balances, document)
}

function issueToEmployee(state: ServiceWorkspaceState, command: Extract<PostalSupplyManagementCommand, { type: 'issue-postal-supplies-to-employee' }>): PostalSupplyManagementResult {
  const employeeId = command.employeeId.trim()
  const employeeName = command.employeeName.trim()
  if (!employeeId || !employeeName) throw new Error('请选择下发员工。')
  const lines = normalizeLines(command.lines)
  const balances = balancesFor(state)
  for (const line of lines) {
    const balance = balanceFor(balances, line.itemId)
    if (line.actualQuantity > balance.institutionQuantity) throw new Error(`${line.label}支局库存数量不足。`)
    balance.institutionQuantity -= line.actualQuantity
    balance.employeeQuantities[employeeId] = (balance.employeeQuantities[employeeId] ?? 0) + line.actualQuantity
  }
  return appendDocument(state, balances, createdDocument(state, 'employee-issue', 'saved', command.context, lines, employeeId, employeeName))
}

function returnFromEmployee(state: ServiceWorkspaceState, command: Extract<PostalSupplyManagementCommand, { type: 'return-postal-supplies-from-employee' }>): PostalSupplyManagementResult {
  const employeeId = command.employeeId.trim()
  const employeeName = command.employeeName.trim()
  if (!employeeId || !employeeName) throw new Error('请选择退回员工。')
  const lines = normalizeLines(command.lines)
  const balances = balancesFor(state)
  for (const line of lines) {
    const available = postalSupplyEmployeeInventory(state, line.itemId, employeeId)
    if (line.actualQuantity > available) throw new Error(`${line.label}个人库存数量不足。`)
    const balance = balanceFor(balances, line.itemId)
    balance.employeeQuantities[employeeId] = (balance.employeeQuantities[employeeId] ?? 0) - line.actualQuantity
    balance.institutionQuantity += line.actualQuantity
  }
  return appendDocument(state, balances, createdDocument(state, 'employee-return', 'saved', command.context, lines, employeeId, employeeName))
}

function countInventory(state: ServiceWorkspaceState, command: Extract<PostalSupplyManagementCommand, { type: 'count-postal-supply-inventory' }>): PostalSupplyManagementResult {
  if (command.target === 'employee' && (!command.employeeId?.trim() || !command.employeeName?.trim())) {
    throw new Error('盘点个人库存时必须选择员工。')
  }
  if (command.lines.length === 0) throw new Error('请录入至少一种盘点物品。')
  if (new Set(command.lines.map((line) => line.itemId)).size !== command.lines.length) {
    throw new Error('同一种用邮物品只能保留一行。')
  }
  const counted = command.lines.map((line) => {
    const item = itemById(line.itemId)
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      throw new Error(`${item.label} 的盘点数量必须为非负整数。`)
    }
    return {
      itemId: item.id,
      label: item.label,
      mnemonic: item.mnemonic,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      requestedQuantity: line.quantity,
      actualQuantity: line.quantity,
      amountCents: item.unitPriceCents * line.quantity,
    }
  })
  const balances = balancesFor(state)
  const lines = counted.map((line) => {
    const expected = command.target === 'institution'
      ? postalSupplyInstitutionInventory(state, line.itemId)
      : postalSupplyEmployeeInventory(state, line.itemId, command.employeeId ?? '')
    return {
      ...line,
      requestedQuantity: expected,
      actualQuantity: line.requestedQuantity,
      amountCents: line.unitPriceCents * line.requestedQuantity,
    }
  })
  if (lines.some((line) => line.requestedQuantity !== line.actualQuantity)) {
    requireOnSiteAuthorization(
      command.authorization,
      'count-postal-supply-inventory',
      command.context.operator.operatorId,
    )
  }
  for (const line of lines) {
    const balance = balanceFor(balances, line.itemId)
    if (command.target === 'institution') {
      balance.institutionQuantity = line.actualQuantity
    } else {
      const employeeId = command.employeeId ?? ''
      balance.employeeQuantities[employeeId] = line.actualQuantity + consumedByEmployee(state, line.itemId, employeeId)
    }
  }
  return appendDocument(state, balances, createdDocument(
    state,
    'inventory-count',
    'saved',
    command.context,
    lines,
    command.target === 'employee' ? command.employeeId : null,
    command.target === 'employee' ? command.employeeName : null,
  ))
}

export function executePostalSupplyManagementCommand(
  state: ServiceWorkspaceState,
  command: PostalSupplyManagementCommand,
): PostalSupplyManagementResult {
  requireTimestamp(command.context.operatedAt)
  switch (command.type) {
    case 'record-postal-supply-inbound': return recordInbound(state, command)
    case 'submit-postal-supply-requisition': return submitRequisition(state, command)
    case 'submit-postal-supply-institution-return': return submitInstitutionReturn(state, command)
    case 'revise-postal-supply-request': return reviseRequest(state, command)
    case 'delete-postal-supply-request': return deleteRequest(state, command)
    case 'approve-postal-supply-request': return approveRequest(state, command)
    case 'reject-postal-supply-request': return rejectRequest(state, command)
    case 'revise-approved-postal-supply-quantities': return reviseApprovedQuantities(state, command)
    case 'receive-postal-supply-requisition': return receiveRequisition(state, command)
    case 'issue-postal-supplies-to-employee': return issueToEmployee(state, command)
    case 'return-postal-supplies-from-employee': return returnFromEmployee(state, command)
    case 'count-postal-supply-inventory': return countInventory(state, command)
  }
}

export function queryPostalSupplyDocuments(
  state: ServiceWorkspaceState,
  query: PostalSupplyDocumentQuery = {},
): PostalSupplyDocument[] {
  const term = query.itemTerm?.trim().toUpperCase() ?? ''
  return state.postalSupplyDocuments
    .filter((document) => document.status !== 'deleted')
    .filter((document) => !query.kind || document.kind === query.kind)
    .filter((document) => !query.status || document.status === query.status)
    .filter((document) => !query.dateFrom || datePart(document.createdAt) >= query.dateFrom)
    .filter((document) => !query.dateTo || datePart(document.createdAt) <= query.dateTo)
    .filter((document) => !query.employeeId || document.employeeId === query.employeeId)
    .filter((document) => !term || document.lines.some((line) => line.label.includes(query.itemTerm?.trim() ?? '') || line.mnemonic.includes(term)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
}

export function postalSupplyInventoryRows(
  state: ServiceWorkspaceState,
  target: 'institution' | 'employee',
  employeeId = DEFAULT_POSTAL_SUPPLY_EMPLOYEE_ID,
): PostalSupplyInventoryRow[] {
  return POSTAL_SUPPLY_ITEMS.map((item) => {
    const expectedQuantity = target === 'institution'
      ? postalSupplyInstitutionInventory(state, item.id)
      : postalSupplyEmployeeInventory(state, item.id, employeeId)
    return { item, expectedQuantity, amountCents: expectedQuantity * item.unitPriceCents }
  })
}

function documentQuantity(
  documents: PostalSupplyDocument[],
  kind: PostalSupplyDocumentKind,
  itemId: string,
  statuses: PostalSupplyDocumentStatus[],
  employeeId?: string,
): number {
  return documents.reduce((total, document) => total + (
    document.kind === kind &&
    statuses.includes(document.status) &&
    (!employeeId || document.employeeId === employeeId)
      ? document.lines.find((line) => line.itemId === itemId)?.actualQuantity ?? 0
      : 0
  ), 0)
}

export function queryPostalSupplySalesStats(
  state: ServiceWorkspaceState,
  dateFrom = '',
  dateTo = '',
  source: PostalSupplySalesStatRow['source'] | 'all' = 'all',
): PostalSupplySalesStatRow[] {
  const rows: PostalSupplySalesStatRow[] = []
  if (source === 'all' || source === 'postal-supply-sale') {
    for (const sale of state.postalSupplySales) {
      if (sale.status === 'deleted') continue
      for (const line of sale.lines) rows.push({
        id: sale.id,
        source: 'postal-supply-sale',
        acceptedAt: sale.acceptedAt,
        itemId: line.itemId,
        label: line.label,
        mnemonic: line.mnemonic,
        unit: line.unit,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
        amountCents: line.amountCents,
        operator: structuredClone(sale.operator),
      })
    }
  }
  if (source === 'all' || source === 'counter-mail') {
    for (const transaction of state.transactions.filter((candidate) => (
      candidate.status !== 'withdrawn' && candidate.product.searchCode === '301'
    ))) {
      for (const line of transaction.service.contentItems) rows.push({
        id: transaction.id,
        source: 'counter-mail',
        acceptedAt: transaction.acceptedAt,
        itemId: line.itemId,
        label: line.label,
        mnemonic: line.mnemonic,
        unit: line.unit,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
        amountCents: line.amountCents,
        operator: structuredClone(transaction.operator),
      })
    }
  }
  return rows
    .filter((row) => !dateFrom || datePart(row.acceptedAt) >= dateFrom)
    .filter((row) => !dateTo || datePart(row.acceptedAt) <= dateTo)
    .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt) || right.id.localeCompare(left.id))
}

export function calculatePostalSupplyBalance(
  state: ServiceWorkspaceState,
  target: 'institution' | 'employee',
  dateFrom: string,
  dateTo: string,
  employeeId = DEFAULT_POSTAL_SUPPLY_EMPLOYEE_ID,
): PostalSupplyBalanceRow[] {
  if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('统计开始日期不能晚于结束日期。')
  const documents = queryPostalSupplyDocuments(state, { dateFrom, dateTo })
  const sales = queryPostalSupplySalesStats(state, dateFrom, dateTo)
    .filter((row) => target === 'institution' || row.operator.operatorId === employeeId)
  return POSTAL_SUPPLY_ITEMS.map((item) => {
    const inboundQuantity = target === 'institution'
      ? documentQuantity(documents, 'inbound', item.id, ['saved'])
      : 0
    const receivedQuantity = target === 'institution'
      ? documentQuantity(documents, 'requisition', item.id, ['received'])
      : documentQuantity(documents, 'employee-issue', item.id, ['saved'], employeeId)
    const issuedQuantity = target === 'institution'
      ? documentQuantity(documents, 'employee-issue', item.id, ['saved'])
      : 0
    const returnedByEmployeeQuantity = target === 'institution'
      ? documentQuantity(documents, 'employee-return', item.id, ['saved'])
      : documentQuantity(documents, 'employee-return', item.id, ['saved'], employeeId)
    const returnedToSuperiorQuantity = target === 'institution'
      ? documentQuantity(documents, 'institution-return', item.id, ['approved'])
      : 0
    const salesQuantity = sales.reduce((total, row) => total + (row.itemId === item.id ? row.quantity : 0), 0)
    const adjustmentQuantity = documents.reduce((total, document) => total + (
      document.kind === 'inventory-count' &&
      ((target === 'institution' && !document.employeeId) || (target === 'employee' && document.employeeId === employeeId))
        ? (() => {
            const line = document.lines.find((candidate) => candidate.itemId === item.id)
            return line ? line.actualQuantity - line.requestedQuantity : 0
          })()
        : 0
    ), 0)
    const closingQuantity = target === 'institution'
      ? postalSupplyInstitutionInventory(state, item.id)
      : postalSupplyEmployeeInventory(state, item.id, employeeId)
    const net = target === 'institution'
      ? inboundQuantity + receivedQuantity - issuedQuantity + returnedByEmployeeQuantity - returnedToSuperiorQuantity + adjustmentQuantity
      : receivedQuantity - salesQuantity - returnedByEmployeeQuantity + adjustmentQuantity
    return {
      item,
      openingQuantity: closingQuantity - net,
      inboundQuantity,
      receivedQuantity,
      issuedQuantity,
      salesQuantity,
      returnedByEmployeeQuantity,
      returnedToSuperiorQuantity,
      adjustmentQuantity,
      closingQuantity,
    }
  })
}

export function postalSupplyDocumentKindLabel(kind: PostalSupplyDocumentKind): string {
  return ({
    inbound: '入库',
    requisition: '请领',
    'institution-return': '机构退回',
    'employee-issue': '员工下发',
    'employee-return': '个人退回',
    'inventory-count': '库存盘点',
  } as const)[kind]
}

export function postalSupplyDocumentStatusLabel(status: PostalSupplyDocumentStatus): string {
  return ({
    saved: '已保存',
    'pending-approval': '待审批',
    approved: '已审批',
    rejected: '已拒绝',
    received: '已接收',
    deleted: '已删除',
  } as const)[status]
}
