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
  ServiceWorkspaceState,
  WindowDeliveryAuditRecord,
  WindowDeliveryBag,
  WindowDeliveryCancellationInfo,
  WindowDeliveryItem,
  WindowDeliveryMoney,
  WindowDeliveryPrintKind,
  WindowDeliveryReminderStage,
  WindowDeliverySequenceStart,
  WindowDeliverySource,
  WindowDeliveryStatus,
  WindowDeliveryTransferInfo,
} from './types'

export const EMPTY_WINDOW_DELIVERY_MONEY: WindowDeliveryMoney = {
  taxCents: 0,
  inspectionCents: 0,
  returnPostageCents: 0,
  redirectedReturnPostageCents: 0,
  underpaidPostageCents: 0,
  underpaidHandlingCents: 0,
  storageWaitCents: 0,
  extensionServiceCents: 0,
  codPaymentCents: 0,
  insuranceValueCents: 0,
  insuranceFeeCents: 0,
  insuredAmountCents: 0,
}

export interface WindowDeliverySupplementDraft {
  productCode: string
  productName: string
  itemCode: string
  dispatchListNumber: string
  receivingOffice: string
  destinationOffice: string
  sendingOffice: string
  senderName: string
  senderPhone: string
  senderAddress: string
  recipientName: string
  recipientMobile: string
  recipientPhone: string
  recipientAddress: string
  mailNote: string
  nonStandard: boolean
  pieces: number
  innerPieces: number
  weightGrams: number
  postingDate: string
  receivedDate: string
  specialSequence: number
  money: WindowDeliveryMoney
}

export interface WindowDeliveryItemRevision {
  recipientName: string
  recipientMobile: string
  recipientPhone: string
  recipientAddress: string
  mailNote: string
  pieces: number
  innerPieces: number
  weightGrams: number
  money: WindowDeliveryMoney
}

export type WindowDeliveryCommand =
  | {
      type: 'receive-window-delivery-bags'
      bagIds: string[]
      receivedAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'receive-window-delivery-items'
      itemIds: string[]
      receivedAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'delete-window-delivery-pending-items'
      itemIds: string[]
      deletedAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'unbind-window-delivery-dispatch'
      dispatchListNumber: string
      bagIds: string[]
      receivedAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'set-window-delivery-sequence-start'
      productCode: string
      productName: string
      startNumber: number
      operatedAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'create-window-delivery-supplement'
      draft: WindowDeliverySupplementDraft
      createdAt: string
      operator: ServiceOperatorSnapshot
      authorization?: OnSiteAuthorization
    }
  | {
      type: 'revise-window-delivery-item'
      itemId: string
      revision: WindowDeliveryItemRevision
      revisedAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'recover-window-delivery-item'
      itemId: string
      recoveredAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'delete-window-delivery-item'
      itemId: string
      deletedAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'transfer-window-delivery-item'
      itemId: string
      transfer: WindowDeliveryTransferInfo
      processedAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'generate-window-delivery-reminder'
      stage: Exclude<WindowDeliveryReminderStage, 'none'>
      operatedAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'cancel-window-delivery-item'
      itemId: string
      cancellation: WindowDeliveryCancellationInfo
      cancelledAt: string
      operator: ServiceOperatorSnapshot
    }
  | {
      type: 'record-window-delivery-print'
      itemIds: string[]
      kind: WindowDeliveryPrintKind
      printedAt: string
      operator: ServiceOperatorSnapshot
    }

export interface WindowDeliveryResult {
  state: ServiceWorkspaceState
  items: WindowDeliveryItem[]
  bags: WindowDeliveryBag[]
  audits: WindowDeliveryAuditRecord[]
}

export interface WindowDeliveryBagQuery {
  bagCode: string
  routeCode: string
  itemCode: string
}

export interface WindowDeliveryItemQuery {
  source: WindowDeliverySource | ''
  status: WindowDeliveryStatus | ''
  productCode: string
  itemCode: string
  recipientName: string
  recipientMobile: string
  receivedDateFrom: string
  receivedDateTo: string
  postingDateFrom: string
  postingDateTo: string
}

export interface WindowDeliveryBalanceRow {
  productCode: string
  productName: string
  carriedForward: number
  imported: number
  cancelled: number
  overdueReturned: number
  transferred: number
  stored: number
}

export interface WindowDeliveryBalance {
  taxCents: number
  totalItems: number
  inspectionCents: number
  returnPostageCents: number
  redirectedReturnPostageCents: number
  underpaidPostageCents: number
  underpaidHandlingCents: number
  storageWaitCents: number
  extensionServiceCents: number
  codPaymentCents: number
  rows: WindowDeliveryBalanceRow[]
}

function requiredTimestamp(value: string, label: string): void {
  if (!value.trim() || Number.isNaN(Date.parse(value))) throw new Error(`${label}格式无效。`)
}

function requiredDate(value: string, label: string): string {
  const normalized = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T12:00:00`))) {
    throw new Error(`${label}须使用 YYYY-MM-DD 格式。`)
  }
  return normalized
}

function normalizedCode(value: string): string {
  return value.trim().toUpperCase()
}

function requiredProductCode(value: string): string {
  const normalized = normalizedCode(value)
  if (!/^[0-9A-Z]{6}$/.test(normalized)) throw new Error('业务产品代码须为 6 位字母或数字。')
  return normalized
}

function requiredPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label}须为正整数。`)
  return value
}

function validateMoney(money: WindowDeliveryMoney): WindowDeliveryMoney {
  for (const [key, value] of Object.entries(money)) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${key}金额格式无效。`)
  }
  return structuredClone(money)
}

function itemById(state: ServiceWorkspaceState, itemId: string): WindowDeliveryItem {
  const item = state.windowDeliveryItems.find((candidate) => candidate.id === itemId)
  if (!item) throw new Error('未找到窗投邮件。')
  return item
}

function bagById(state: ServiceWorkspaceState, bagId: string): WindowDeliveryBag {
  const bag = state.windowDeliveryBags.find((candidate) => candidate.id === bagId)
  if (!bag) throw new Error('未找到窗投进口总包。')
  return bag
}

function datedId(prefix: string, at: string, sequence: number): string {
  return `${prefix}-${businessCalendarDay(at).replaceAll('-', '')}-${String(sequence).padStart(6, '0')}`
}

function audit(
  state: ServiceWorkspaceState,
  itemId: string | null,
  bagId: string | null,
  kind: string,
  detail: string,
  operatedAt: string,
  operator: ServiceOperatorSnapshot,
): { state: ServiceWorkspaceState; record: WindowDeliveryAuditRecord } {
  const record: WindowDeliveryAuditRecord = {
    id: datedId('CTA', operatedAt, state.nextWindowDeliveryAuditSequence),
    itemId,
    bagId,
    kind,
    detail,
    operatedAt,
    operatedBy: structuredClone(operator),
  }
  return {
    state: {
      ...state,
      windowDeliveryAudits: [...state.windowDeliveryAudits, record],
      nextWindowDeliveryAuditSequence: state.nextWindowDeliveryAuditSequence + 1,
    },
    record,
  }
}

function replaceItems(
  state: ServiceWorkspaceState,
  replacements: WindowDeliveryItem[],
): ServiceWorkspaceState {
  const byId = new Map(replacements.map((item) => [item.id, item]))
  return {
    ...state,
    windowDeliveryItems: state.windowDeliveryItems.map((item) => byId.get(item.id) ?? item),
  }
}

function receiveBags(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'receive-window-delivery-bags' }>,
): WindowDeliveryResult {
  requiredTimestamp(command.receivedAt, '接收时间')
  const ids = [...new Set(command.bagIds)]
  if (ids.length === 0) throw new Error('请勾选待接收总包。')
  const bags = ids.map((id) => bagById(state, id))
  if (bags.some((bag) => bag.receivedAt)) throw new Error('所选总包中包含已接收记录。')
  const replacements = bags.map((bag): WindowDeliveryBag => ({
    ...bag,
    receivedAt: command.receivedAt,
    receivedBy: structuredClone(command.operator),
  }))
  const replacementMap = new Map(replacements.map((bag) => [bag.id, bag]))
  let next: ServiceWorkspaceState = {
    ...state,
    windowDeliveryBags: state.windowDeliveryBags.map((bag) => replacementMap.get(bag.id) ?? bag),
  }
  const records: WindowDeliveryAuditRecord[] = []
  for (const bag of replacements) {
    const result = audit(next, null, bag.id, 'bag-received', `确认接收总包 ${bag.bagCode}`, command.receivedAt, command.operator)
    next = result.state
    records.push(result.record)
  }
  return { state: next, items: [], bags: structuredClone(replacements), audits: records }
}

function receiveItems(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'receive-window-delivery-items' }>,
): WindowDeliveryResult {
  requiredTimestamp(command.receivedAt, '接收时间')
  const ids = [...new Set(command.itemIds)]
  if (ids.length === 0) throw new Error('请勾选待接收邮件。')
  const items = ids.map((id) => itemById(state, id))
  if (items.some((item) => item.status !== 'pending-receipt')) throw new Error('所选邮件中包含非待接收记录。')
  for (const item of items) {
    if (item.source === 'import-bag' && item.bagId && !bagById(state, item.bagId).receivedAt) {
      throw new Error('请先确认接收邮件所属总包。')
    }
  }
  const replacements = items.map((item): WindowDeliveryItem => ({
    ...item,
    status: 'stored',
    receivedAt: command.receivedAt,
    receivedBy: structuredClone(command.operator),
  }))
  let next = replaceItems(state, replacements)
  const records: WindowDeliveryAuditRecord[] = []
  for (const item of replacements) {
    const result = audit(next, item.id, item.bagId, 'mail-received', `确认接收邮件 ${item.itemCode}`, command.receivedAt, command.operator)
    next = result.state
    records.push(result.record)
  }
  return { state: next, items: structuredClone(replacements), bags: [], audits: records }
}

function deletePendingItems(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'delete-window-delivery-pending-items' }>,
): WindowDeliveryResult {
  requiredTimestamp(command.deletedAt, '删除时间')
  const ids = [...new Set(command.itemIds)]
  if (ids.length === 0) throw new Error('请勾选待删除邮件。')
  const items = ids.map((id) => itemById(state, id))
  if (items.some((item) => item.status !== 'pending-receipt')) throw new Error('只能批量删除尚未接收的邮件。')
  const replacements = items.map((item): WindowDeliveryItem => ({
    ...item,
    status: 'deleted',
    deletedAt: command.deletedAt,
  }))
  let next = replaceItems(state, replacements)
  const records: WindowDeliveryAuditRecord[] = []
  for (const item of replacements) {
    const result = audit(next, item.id, item.bagId, 'pending-mail-deleted', `删除待接收邮件 ${item.itemCode}`, command.deletedAt, command.operator)
    next = result.state
    records.push(result.record)
  }
  return { state: next, items: structuredClone(replacements), bags: [], audits: records }
}

function unbindDispatch(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'unbind-window-delivery-dispatch' }>,
): WindowDeliveryResult {
  requiredTimestamp(command.receivedAt, '解车时间')
  const dispatchListNumber = normalizedCode(command.dispatchListNumber)
  if (!dispatchListNumber) throw new Error('请输入派车单号。')
  const ids = [...new Set(command.bagIds)]
  const bags = ids.map((id) => bagById(state, id))
  if (bags.length === 0) throw new Error('请勾选派车单中的待接收总包。')
  if (bags.some((bag) => normalizedCode(bag.dispatchListNumber) !== dispatchListNumber)) {
    throw new Error('所选总包不属于该派车单。')
  }
  if (bags.some((bag) => bag.receivedAt)) throw new Error('所选总包中包含已接收记录。')
  const replacements = bags.map((bag): WindowDeliveryBag => ({
    ...bag,
    unboundAt: command.receivedAt,
    receivedAt: command.receivedAt,
    receivedBy: structuredClone(command.operator),
  }))
  const byId = new Map(replacements.map((bag) => [bag.id, bag]))
  let next: ServiceWorkspaceState = {
    ...state,
    windowDeliveryBags: state.windowDeliveryBags.map((bag) => byId.get(bag.id) ?? bag),
  }
  const records: WindowDeliveryAuditRecord[] = []
  for (const bag of replacements) {
    const result = audit(next, null, bag.id, 'dispatch-unbound', `派车单 ${dispatchListNumber} 解车并接收总包 ${bag.bagCode}`, command.receivedAt, command.operator)
    next = result.state
    records.push(result.record)
  }
  return { state: next, items: [], bags: structuredClone(replacements), audits: records }
}

function setSequenceStart(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'set-window-delivery-sequence-start' }>,
): WindowDeliveryResult {
  requiredTimestamp(command.operatedAt, '维护时间')
  const productCode = requiredProductCode(command.productCode)
  const productName = command.productName.trim()
  if (!productName) throw new Error('请输入业务产品名称。')
  const startNumber = requiredPositiveInteger(command.startNumber, '接收专号起号')
  const entry: WindowDeliverySequenceStart = { productCode, productName, startNumber }
  const exists = state.windowDeliverySequenceStarts.some((item) => item.productCode === productCode)
  let next: ServiceWorkspaceState = {
    ...state,
    windowDeliverySequenceStarts: exists
      ? state.windowDeliverySequenceStarts.map((item) => item.productCode === productCode ? entry : item)
      : [...state.windowDeliverySequenceStarts, entry],
  }
  const result = audit(next, null, null, 'sequence-start-maintained', `业务产品 ${productCode} 接收专号从 ${startNumber} 起`, command.operatedAt, command.operator)
  next = result.state
  return { state: next, items: [], bags: [], audits: [result.record] }
}

function validateSupplement(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'create-window-delivery-supplement' }>,
): WindowDeliverySupplementDraft {
  requiredTimestamp(command.createdAt, '补录时间')
  const draft = structuredClone(command.draft)
  draft.productCode = requiredProductCode(draft.productCode)
  draft.productName = draft.productName.trim()
  draft.itemCode = normalizedCode(draft.itemCode)
  if (!draft.productName) throw new Error('请输入业务产品名称。')
  if (!draft.itemCode) throw new Error('请输入邮件号码。')
  if (state.windowDeliveryItems.some((item) => normalizedCode(item.itemCode) === draft.itemCode)) {
    throw new Error('该邮件号码已经存在于窗投台账。')
  }
  if (!draft.receivingOffice.trim()) throw new Error('请选择收寄局。')
  if (!draft.destinationOffice.trim()) throw new Error('请输入寄达局。')
  if (!draft.recipientName.trim()) throw new Error('请输入收件人姓名。')
  if (!draft.recipientAddress.trim()) throw new Error('请输入收件人地址。')
  if (draft.recipientMobile.trim() && !isValidContact(draft.recipientMobile)) {
    throw new Error('收件人手机格式无效。')
  }
  draft.pieces = requiredPositiveInteger(draft.pieces, '件数')
  draft.innerPieces = Math.max(0, Math.trunc(draft.innerPieces))
  draft.weightGrams = requiredPositiveInteger(draft.weightGrams, '邮件重量')
  draft.postingDate = requiredDate(draft.postingDate, '投单日期')
  draft.receivedDate = requiredDate(draft.receivedDate, '接收日期')
  if (draft.receivedDate < draft.postingDate) throw new Error('接收日期不能早于投单日期。')
  draft.specialSequence = requiredPositiveInteger(draft.specialSequence, '接收专号')
  draft.money = validateMoney(draft.money)
  const authorizationRequired = draft.money.returnPostageCents > 0 || draft.productCode === '250200'
  if (authorizationRequired) {
    requireOnSiteAuthorization(
      command.authorization,
      'create-window-delivery-supplement',
      command.operator.operatorId,
    )
  }
  return draft
}

function createSupplement(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'create-window-delivery-supplement' }>,
): WindowDeliveryResult {
  const draft = validateSupplement(state, command)
  const item: WindowDeliveryItem = {
    id: datedId('CT', command.createdAt, state.nextWindowDeliverySequence),
    source: 'supplement',
    bagId: null,
    dispatchListNumber: draft.dispatchListNumber.trim(),
    productCode: draft.productCode,
    productName: draft.productName,
    itemCode: draft.itemCode,
    sendingOffice: draft.sendingOffice.trim(),
    receivingOffice: draft.receivingOffice.trim(),
    destinationOffice: draft.destinationOffice.trim(),
    senderName: draft.senderName.trim(),
    senderPhone: draft.senderPhone.trim(),
    senderAddress: draft.senderAddress.trim(),
    recipientName: draft.recipientName.trim(),
    recipientMobile: draft.recipientMobile.trim(),
    recipientPhone: draft.recipientPhone.trim(),
    recipientAddress: draft.recipientAddress.trim(),
    mailNote: draft.mailNote.trim(),
    nonStandard: draft.nonStandard,
    pieces: draft.pieces,
    innerPieces: draft.innerPieces,
    weightGrams: draft.weightGrams,
    postingDate: draft.postingDate,
    receivedAt: `${draft.receivedDate}T12:00:00.000Z`,
    receivedBy: structuredClone(command.operator),
    specialSequence: draft.specialSequence,
    money: draft.money,
    status: 'stored',
    processedAt: null,
    processedBy: null,
    transfer: null,
    cancellation: null,
    reminderStage: 'none',
    firstReminderAt: null,
    secondReminderAt: null,
    overdueAt: null,
    deletedAt: null,
    printHistory: [],
  }
  let next: ServiceWorkspaceState = {
    ...state,
    windowDeliveryItems: [...state.windowDeliveryItems, item],
    nextWindowDeliverySequence: state.nextWindowDeliverySequence + 1,
  }
  const result = audit(next, item.id, null, 'supplement-created', `补录窗投邮件 ${item.itemCode}`, command.createdAt, command.operator)
  next = result.state
  return { state: next, items: [structuredClone(item)], bags: [], audits: [result.record] }
}

function validateRevision(revision: WindowDeliveryItemRevision): WindowDeliveryItemRevision {
  const normalized = structuredClone(revision)
  normalized.recipientName = normalized.recipientName.trim()
  normalized.recipientMobile = normalized.recipientMobile.trim()
  normalized.recipientPhone = normalized.recipientPhone.trim()
  normalized.recipientAddress = normalized.recipientAddress.trim()
  normalized.mailNote = normalized.mailNote.trim()
  if (!normalized.recipientName) throw new Error('请输入收件人姓名。')
  if (!normalized.recipientAddress) throw new Error('请输入收件人地址。')
  if (normalized.recipientMobile && !isValidContact(normalized.recipientMobile)) {
    throw new Error('收件人手机格式无效。')
  }
  normalized.pieces = requiredPositiveInteger(normalized.pieces, '件数')
  normalized.innerPieces = Math.max(0, Math.trunc(normalized.innerPieces))
  normalized.weightGrams = requiredPositiveInteger(normalized.weightGrams, '邮件重量')
  normalized.money = validateMoney(normalized.money)
  return normalized
}

function reviseItem(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'revise-window-delivery-item' }>,
): WindowDeliveryResult {
  requiredTimestamp(command.revisedAt, '修改时间')
  const current = itemById(state, command.itemId)
  if (current.status === 'deleted') throw new Error('已删除的窗投邮件不能修改。')
  const revision = validateRevision(command.revision)
  const item: WindowDeliveryItem = { ...current, ...revision }
  let next = replaceItems(state, [item])
  const result = audit(next, item.id, item.bagId, 'mail-revised', `修改窗投邮件 ${item.itemCode}`, command.revisedAt, command.operator)
  next = result.state
  return { state: next, items: [structuredClone(item)], bags: [], audits: [result.record] }
}

function recoverItem(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'recover-window-delivery-item' }>,
): WindowDeliveryResult {
  requiredTimestamp(command.recoveredAt, '恢复时间')
  const current = itemById(state, command.itemId)
  if (!['transferred', 'overdue-returned', 'cancelled'].includes(current.status)) {
    throw new Error('只有已销号、已转退或已逾退的邮件可以恢复。')
  }
  if (!current.processedAt || businessCalendarDay(current.processedAt) !== businessCalendarDay(command.recoveredAt)) {
    throw new Error('销号、转退或逾退邮件只能在处理当天恢复。')
  }
  const item: WindowDeliveryItem = {
    ...current,
    status: 'stored',
    processedAt: null,
    processedBy: null,
    transfer: null,
    cancellation: null,
    reminderStage: 'none',
    firstReminderAt: null,
    secondReminderAt: null,
    overdueAt: null,
  }
  let next = replaceItems(state, [item])
  const result = audit(next, item.id, item.bagId, 'mail-recovered', `恢复窗投邮件 ${item.itemCode}`, command.recoveredAt, command.operator)
  next = result.state
  return { state: next, items: [structuredClone(item)], bags: [], audits: [result.record] }
}

function deleteItem(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'delete-window-delivery-item' }>,
): WindowDeliveryResult {
  requiredTimestamp(command.deletedAt, '删除时间')
  const current = itemById(state, command.itemId)
  if (['cancelled', 'transferred', 'overdue-returned'].includes(current.status)) {
    throw new Error('已销号、转退或逾退的窗投邮件不允许删除。')
  }
  if (current.status === 'deleted') throw new Error('该窗投邮件已经删除。')
  const item: WindowDeliveryItem = { ...current, status: 'deleted', deletedAt: command.deletedAt }
  let next = replaceItems(state, [item])
  const result = audit(next, item.id, item.bagId, 'mail-deleted', `删除窗投邮件 ${item.itemCode}`, command.deletedAt, command.operator)
  next = result.state
  return { state: next, items: [structuredClone(item)], bags: [], audits: [result.record] }
}

function transferItem(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'transfer-window-delivery-item' }>,
): WindowDeliveryResult {
  requiredTimestamp(command.processedAt, '转退时间')
  const current = itemById(state, command.itemId)
  if (current.status !== 'stored') throw new Error('只有库存中的窗投邮件可以办理转退。')
  const transfer = structuredClone(command.transfer)
  transfer.destinationPostcode = transfer.destinationPostcode.trim()
  transfer.destinationOffice = transfer.destinationOffice.trim()
  transfer.recipientName = transfer.recipientName.trim()
  transfer.recipientPhone = transfer.recipientPhone.trim()
  transfer.recipientAddress = transfer.recipientAddress.trim()
  transfer.reason = transfer.reason.trim()
  if (!/^\d{6}$/.test(transfer.destinationPostcode)) throw new Error('邮政编码须为 6 位数字。')
  if (!transfer.destinationOffice) throw new Error('请输入寄达局。')
  if (!transfer.recipientName || !transfer.recipientAddress) throw new Error('请输入转退收件人和地址。')
  if (!transfer.reason) throw new Error('请选择转退原因。')
  const item: WindowDeliveryItem = {
    ...current,
    status: 'transferred',
    processedAt: command.processedAt,
    processedBy: structuredClone(command.operator),
    transfer,
  }
  let next = replaceItems(state, [item])
  const result = audit(next, item.id, item.bagId, 'mail-transferred', `转退窗投邮件 ${item.itemCode}：${transfer.reason}`, command.processedAt, command.operator)
  next = result.state
  return { state: next, items: [structuredClone(item)], bags: [], audits: [result.record] }
}

function generateReminder(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'generate-window-delivery-reminder' }>,
): WindowDeliveryResult {
  requiredTimestamp(command.operatedAt, '催领处理时间')
  const candidates = state.windowDeliveryItems.filter((item) => {
    if (item.status !== 'stored') return false
    if (command.stage === 'first') return item.reminderStage === 'none'
    if (command.stage === 'second') return item.reminderStage === 'first'
    return item.reminderStage === 'second'
  })
  if (candidates.length === 0) throw new Error('当前没有可生成该清单的窗投邮件。')
  const replacements = candidates.map((item): WindowDeliveryItem => {
    if (command.stage === 'first') {
      return { ...item, reminderStage: 'first', firstReminderAt: command.operatedAt }
    }
    if (command.stage === 'second') {
      return { ...item, reminderStage: 'second', secondReminderAt: command.operatedAt }
    }
    return {
      ...item,
      status: 'overdue-returned',
      reminderStage: 'overdue',
      overdueAt: command.operatedAt,
      processedAt: command.operatedAt,
      processedBy: structuredClone(command.operator),
    }
  })
  let next = replaceItems(state, replacements)
  const records: WindowDeliveryAuditRecord[] = []
  for (const item of replacements) {
    const result = audit(next, item.id, item.bagId, `reminder-${command.stage}`, `${item.itemCode} 生成${command.stage === 'first' ? '一催' : command.stage === 'second' ? '二催' : '逾退'}记录`, command.operatedAt, command.operator)
    next = result.state
    records.push(result.record)
  }
  return { state: next, items: structuredClone(replacements), bags: [], audits: records }
}

function validateIdentity(type: WindowDeliveryCancellationInfo['claimantIdentityType'], number: string): void {
  const normalized = number.trim()
  if (!normalized) throw new Error('请输入领件人证件号码。')
  if (type === 'primary' && !isValidResidentIdentity(normalized)) {
    throw new Error('居民身份证号码须为 18 位并通过校验。')
  }
  if (type !== 'primary' && Array.from(normalized).length > 20) {
    throw new Error('其他身份证明号码不得超过 20 个字符。')
  }
}

function cancelItem(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'cancel-window-delivery-item' }>,
): WindowDeliveryResult {
  requiredTimestamp(command.cancelledAt, '销号时间')
  const current = itemById(state, command.itemId)
  if (current.status !== 'stored') throw new Error('只有库存中的窗投邮件可以销号。')
  const cancellation = structuredClone(command.cancellation)
  cancellation.claimantName = cancellation.claimantName.trim()
  cancellation.claimantIdentityNumber = cancellation.claimantIdentityNumber.trim().toUpperCase()
  cancellation.agentName = cancellation.agentName.trim()
  cancellation.agentIdentityNumber = cancellation.agentIdentityNumber.trim().toUpperCase()
  if (!cancellation.claimantName) throw new Error('请输入领件人姓名。')
  validateIdentity(cancellation.claimantIdentityType, cancellation.claimantIdentityNumber)
  if (cancellation.agentName) {
    if (!cancellation.agentIdentityType) throw new Error('请选择代领人证件名称。')
    validateIdentity(cancellation.agentIdentityType, cancellation.agentIdentityNumber)
  }
  const item: WindowDeliveryItem = {
    ...current,
    status: 'cancelled',
    processedAt: command.cancelledAt,
    processedBy: structuredClone(command.operator),
    cancellation,
  }
  let next = replaceItems(state, [item])
  const result = audit(next, item.id, item.bagId, 'mail-cancelled', `窗投邮件 ${item.itemCode} 销号成功`, command.cancelledAt, command.operator)
  next = result.state
  return { state: next, items: [structuredClone(item)], bags: [], audits: [result.record] }
}

function recordPrint(
  state: ServiceWorkspaceState,
  command: Extract<WindowDeliveryCommand, { type: 'record-window-delivery-print' }>,
): WindowDeliveryResult {
  requiredTimestamp(command.printedAt, '打印时间')
  const ids = [...new Set(command.itemIds)]
  if (ids.length === 0) throw new Error('请勾选需要打印的窗投邮件。')
  const items = ids.map((id) => itemById(state, id))
  const replacements = items.map((item): WindowDeliveryItem => ({
    ...item,
    printHistory: [...item.printHistory, { kind: command.kind, printedAt: command.printedAt }],
  }))
  let next = replaceItems(state, replacements)
  const records: WindowDeliveryAuditRecord[] = []
  for (const item of replacements) {
    const result = audit(next, item.id, item.bagId, 'document-printed', `${item.itemCode} 打印 ${command.kind}`, command.printedAt, command.operator)
    next = result.state
    records.push(result.record)
  }
  return { state: next, items: structuredClone(replacements), bags: [], audits: records }
}

export function executeWindowDeliveryCommand(
  state: ServiceWorkspaceState,
  command: WindowDeliveryCommand,
): WindowDeliveryResult {
  if (command.type === 'cancel-window-delivery-item') {
    assertAccountingOpen(state, command.operator, command.cancelledAt)
  }
  if (command.type === 'receive-window-delivery-bags') return receiveBags(state, command)
  if (command.type === 'receive-window-delivery-items') return receiveItems(state, command)
  if (command.type === 'delete-window-delivery-pending-items') return deletePendingItems(state, command)
  if (command.type === 'unbind-window-delivery-dispatch') return unbindDispatch(state, command)
  if (command.type === 'set-window-delivery-sequence-start') return setSequenceStart(state, command)
  if (command.type === 'create-window-delivery-supplement') return createSupplement(state, command)
  if (command.type === 'revise-window-delivery-item') return reviseItem(state, command)
  if (command.type === 'recover-window-delivery-item') return recoverItem(state, command)
  if (command.type === 'delete-window-delivery-item') return deleteItem(state, command)
  if (command.type === 'transfer-window-delivery-item') return transferItem(state, command)
  if (command.type === 'generate-window-delivery-reminder') return generateReminder(state, command)
  if (command.type === 'cancel-window-delivery-item') return cancelItem(state, command)
  return recordPrint(state, command)
}

export function queryWindowDeliveryBags(
  state: ServiceWorkspaceState,
  query: WindowDeliveryBagQuery,
): WindowDeliveryBag[] {
  const bagCode = normalizedCode(query.bagCode)
  const routeCode = normalizedCode(query.routeCode)
  const itemCode = normalizedCode(query.itemCode)
  const matchingBagIds = new Set(state.windowDeliveryItems
    .filter((item) => !itemCode || normalizedCode(item.itemCode).includes(itemCode))
    .map((item) => item.bagId)
    .filter((value): value is string => Boolean(value)))
  return state.windowDeliveryBags
    .filter((bag) => !bagCode || normalizedCode(bag.bagCode).includes(bagCode))
    .filter((bag) => !routeCode || normalizedCode(bag.routeCode).includes(routeCode))
    .filter((bag) => !itemCode || matchingBagIds.has(bag.id))
    .sort((left, right) => right.postingDate.localeCompare(left.postingDate))
    .map((bag) => structuredClone(bag))
}

export function queryWindowDeliveryItems(
  state: ServiceWorkspaceState,
  query: WindowDeliveryItemQuery,
): WindowDeliveryItem[] {
  const productCode = normalizedCode(query.productCode)
  const itemCode = normalizedCode(query.itemCode)
  const recipientName = query.recipientName.trim().toLocaleLowerCase('zh-CN')
  const recipientMobile = query.recipientMobile.trim()
  return state.windowDeliveryItems
    .filter((item) => item.status !== 'deleted')
    .filter((item) => !query.source || item.source === query.source)
    .filter((item) => !query.status || item.status === query.status)
    .filter((item) => !productCode || normalizedCode(item.productCode).includes(productCode))
    .filter((item) => !itemCode || normalizedCode(item.itemCode).includes(itemCode))
    .filter((item) => !recipientName || item.recipientName.toLocaleLowerCase('zh-CN').includes(recipientName))
    .filter((item) => !recipientMobile || item.recipientMobile.includes(recipientMobile))
    .filter((item) => {
      const receivedDate = item.receivedAt ? businessCalendarDay(item.receivedAt) : ''
      return (!query.receivedDateFrom || receivedDate >= query.receivedDateFrom) &&
        (!query.receivedDateTo || receivedDate <= query.receivedDateTo)
    })
    .filter((item) => (!query.postingDateFrom || item.postingDate >= query.postingDateFrom) &&
      (!query.postingDateTo || item.postingDate <= query.postingDateTo))
    .sort((left, right) => (right.receivedAt ?? right.postingDate).localeCompare(left.receivedAt ?? left.postingDate))
    .map((item) => structuredClone(item))
}

export function windowDeliveryMoneyTotal(money: WindowDeliveryMoney): number {
  return money.taxCents + money.inspectionCents + money.returnPostageCents +
    money.redirectedReturnPostageCents + money.underpaidPostageCents +
    money.underpaidHandlingCents + money.storageWaitCents +
    money.extensionServiceCents + money.codPaymentCents + money.insuranceFeeCents
}

export function calculateWindowDeliveryBalance(
  state: ServiceWorkspaceState,
  dateFrom: string,
  dateTo: string,
): WindowDeliveryBalance {
  requiredDate(dateFrom, '统计开始日期')
  requiredDate(dateTo, '统计结束日期')
  if (dateFrom > dateTo) throw new Error('统计开始日期不能晚于结束日期。')
  const active = state.windowDeliveryItems.filter((item) => item.status !== 'deleted')
  const within = active.filter((item) => {
    const date = item.receivedAt ? businessCalendarDay(item.receivedAt) : item.postingDate
    return date >= dateFrom && date <= dateTo
  })
  const products = new Map<string, WindowDeliveryBalanceRow>()
  for (const item of active) {
    if (!products.has(item.productCode)) {
      products.set(item.productCode, {
        productCode: item.productCode,
        productName: item.productName,
        carriedForward: 0,
        imported: 0,
        cancelled: 0,
        overdueReturned: 0,
        transferred: 0,
        stored: 0,
      })
    }
    const row = products.get(item.productCode)!
    const receivedDate = item.receivedAt ? businessCalendarDay(item.receivedAt) : item.postingDate
    if (receivedDate < dateFrom && item.status === 'stored') row.carriedForward += item.pieces
  }
  for (const item of within) {
    const row = products.get(item.productCode)!
    row.imported += item.pieces
    if (item.status === 'cancelled') row.cancelled += item.pieces
    if (item.status === 'overdue-returned') row.overdueReturned += item.pieces
    if (item.status === 'transferred') row.transferred += item.pieces
    if (item.status === 'stored') row.stored += item.pieces
  }
  const sum = (selector: (money: WindowDeliveryMoney) => number) => within.reduce((total, item) => total + selector(item.money), 0)
  return {
    taxCents: sum((money) => money.taxCents),
    totalItems: within.reduce((total, item) => total + item.pieces, 0),
    inspectionCents: sum((money) => money.inspectionCents),
    returnPostageCents: sum((money) => money.returnPostageCents),
    redirectedReturnPostageCents: sum((money) => money.redirectedReturnPostageCents),
    underpaidPostageCents: sum((money) => money.underpaidPostageCents),
    underpaidHandlingCents: sum((money) => money.underpaidHandlingCents),
    storageWaitCents: sum((money) => money.storageWaitCents),
    extensionServiceCents: sum((money) => money.extensionServiceCents),
    codPaymentCents: sum((money) => money.codPaymentCents),
    rows: [...products.values()].sort((left, right) => left.productCode.localeCompare(right.productCode)),
  }
}

export function windowDeliverySourceLabel(source: WindowDeliverySource): string {
  if (source === 'import-bag') return '进口总包'
  if (source === 'supplement') return '窗投补录'
  if (source === 'delivery-return') return '投递转退'
  return '投递转窗投'
}

export function windowDeliveryStatusLabel(status: WindowDeliveryStatus): string {
  if (status === 'pending-receipt') return '待接收'
  if (status === 'stored') return '库存'
  if (status === 'transferred') return '转退'
  if (status === 'overdue-returned') return '逾退'
  if (status === 'cancelled') return '已销号'
  return '已删除'
}
