import type {
  PostageMeterBatch,
  PostageMeterBatchItem,
  PostageMeterBatchStatus,
  PostageMeterDailyBalance,
  PostageMeterDevice,
  PostageMeterFundingRequest,
  PostageMeterMailHandover,
  PostageMeterMailHandoverStatus,
  PostageMeterNetworkMode,
  PostageMeterRepairMatter,
  PostageMeterRepairRequest,
  PostageMeterRegistration,
  PostageMeterTerminalPort,
  ServiceOperatorSnapshot,
  ServiceTransaction,
  ServiceWorkspaceState,
} from './types'
import { businessCalendarDay } from '../shared/businessTime'
import { transactionMailCustody } from './mailCustody'
import {
  requireOnSiteAuthorization,
  type OnSiteAuthorization,
} from '../access/workAuthorization'

export interface PostageMeterBatchQuery {
  createdDateFrom: string
  createdDateTo: string
  status: PostageMeterBatchStatus | ''
}

export interface PostageMeterRegistrationQuery {
  registeredDateFrom: string
  registeredDateTo: string
  batchNumber: string
  deviceId: string
}

export interface PostageMeterMailHandoverQuery {
  handedOverDateFrom: string
  handedOverDateTo: string
  status: PostageMeterMailHandoverStatus | ''
  sourceInstitution: string
  targetInstitution: string
  agreementAccount: string
  handoverNumber: string
}

export interface PostageMeterUsageLedgerRow {
  registration: PostageMeterRegistration
  batch: PostageMeterBatch
  agreementAccountIds: string[]
  differenceItemCount: number
  differencePostageCents: number
}

interface CreatePostageMeterBatchCommand {
  type: 'create-postage-meter-batch'
  transactionIds: string[]
  createdAt: string
  operator: ServiceOperatorSnapshot
}

interface AppendPostageMeterBatchCommand {
  type: 'append-postage-meter-batch'
  batchId: string
  transactionIds: string[]
}

interface DeletePostageMeterBatchCommand {
  type: 'delete-postage-meter-batch'
  batchId: string
}

interface RegisterPostageMeterReadingCommand {
  type: 'register-postage-meter-reading'
  batchId: string
  deviceId: string
  startCount: number
  endCount: number
  cancelledCount: number
  startAmountCents: number
  endAmountCents: number
  cancelledAmountCents: number
  authorization?: OnSiteAuthorization
  registeredAt: string
  operator: ServiceOperatorSnapshot
}

interface RecordPostageMeterDiscrepancyCommand {
  type: 'record-postage-meter-discrepancy'
  batchId: string
  reason: string
}

interface UpdatePostageMeterDeviceCommand {
  type: 'update-postage-meter-device'
  deviceId: string
  counterCode: string
  networkMode: PostageMeterNetworkMode
  terminalPort: PostageMeterTerminalPort
  updatedAt: string
}

interface GeneratePostageMeterDailyBalanceCommand {
  type: 'generate-postage-meter-daily-balance'
  institutionCode: string
  institutionName: string
  statisticDate: string
  deviceId: string
  generatedAt: string
}

interface UploadPostageMeterDailyBalanceCommand {
  type: 'upload-postage-meter-daily-balance'
  balanceId: string
  uploadedAt: string
  operator: ServiceOperatorSnapshot
}

interface CreatePostageMeterMailHandoverCommand {
  type: 'create-postage-meter-mail-handover'
  transactionIds: string[]
  sourceInstitutionCode: string
  sourceInstitutionName: string
  targetInstitutionCode: string
  targetInstitutionName: string
  sourceCounterCode: string
  handedOverAt: string
  operator: ServiceOperatorSnapshot
}

interface ReceivePostageMeterMailHandoversCommand {
  type: 'receive-postage-meter-mail-handovers'
  handoverIds: string[]
  receivedAt: string
  operator: ServiceOperatorSnapshot
}

interface ReturnPostageMeterMailHandoverCommand {
  type: 'return-postage-meter-mail-handover'
  handoverId: string
  returnedAt: string
  operator: ServiceOperatorSnapshot
}

interface RequestPostageMeterMailHandoverReturnCommand {
  type: 'request-postage-meter-mail-handover-return'
  handoverId: string
  requestedAt: string
  operator: ServiceOperatorSnapshot
}

interface ApprovePostageMeterMailHandoverReturnCommand {
  type: 'approve-postage-meter-mail-handover-return'
  handoverId: string
  approvedAt: string
  operator: ServiceOperatorSnapshot
}

interface SubmitPostageMeterFundingRequestCommand {
  type: 'submit-postage-meter-funding-request'
  deviceId: string
  amountCents: number
  requestedAt: string
  operator: ServiceOperatorSnapshot
}

interface SubmitPostageMeterRepairRequestCommand {
  type: 'submit-postage-meter-repair-request'
  deviceId: string
  matter: PostageMeterRepairMatter
  requestedAt: string
  operator: ServiceOperatorSnapshot
}

export type PostageMeterCommand =
  | CreatePostageMeterBatchCommand
  | AppendPostageMeterBatchCommand
  | DeletePostageMeterBatchCommand
  | RegisterPostageMeterReadingCommand
  | RecordPostageMeterDiscrepancyCommand
  | UpdatePostageMeterDeviceCommand
  | GeneratePostageMeterDailyBalanceCommand
  | UploadPostageMeterDailyBalanceCommand
  | CreatePostageMeterMailHandoverCommand
  | ReceivePostageMeterMailHandoversCommand
  | ReturnPostageMeterMailHandoverCommand
  | RequestPostageMeterMailHandoverReturnCommand
  | ApprovePostageMeterMailHandoverReturnCommand
  | SubmitPostageMeterFundingRequestCommand
  | SubmitPostageMeterRepairRequestCommand

export interface PostageMeterResult {
  state: ServiceWorkspaceState
  batch: PostageMeterBatch | null
  registration: PostageMeterRegistration | null
  device: PostageMeterDevice | null
  balance: PostageMeterDailyBalance | null
  handover?: PostageMeterMailHandover | null
  handovers?: PostageMeterMailHandover[]
  fundingRequest?: PostageMeterFundingRequest | null
  repairRequest?: PostageMeterRepairRequest | null
}

function datedId(prefix: string, at: string, sequence: number): string {
  return `${prefix}-${businessCalendarDay(at).replaceAll('-', '')}-${String(sequence).padStart(6, '0')}`
}

function numericBatchNumber(at: string, sequence: number): string {
  const timestamp = at.replace(/\D/g, '').slice(0, 14).padEnd(14, '0')
  return `99${timestamp}${String(sequence).padStart(4, '0')}`
}

function numericHandoverNumber(at: string, sequence: number): string {
  const timestamp = at.replace(/\D/g, '').slice(0, 14).padEnd(14, '0')
  return `98${timestamp}${String(sequence).padStart(4, '0')}`
}

function requiredIds(ids: string[], label: string): string[] {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (unique.length === 0) throw new Error(`请选择需要${label}的记录。`)
  return unique
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`请输入${label}。`)
  return trimmed
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label}必须是非负整数。`)
  }
  return value
}

function matchesDate(value: string, from: string, to: string): boolean {
  const day = businessCalendarDay(value)
  return (!from || day >= from) && (!to || day <= to)
}

function transactionById(
  state: ServiceWorkspaceState,
  transactionId: string,
): ServiceTransaction {
  const transaction = state.transactions.find((candidate) => candidate.id === transactionId)
  if (!transaction) throw new Error(`未找到业务记录 ${transactionId}。`)
  return transaction
}

function batchById(state: ServiceWorkspaceState, batchId: string): PostageMeterBatch {
  const batch = state.postageMeterBatches.find((candidate) => candidate.id === batchId)
  if (!batch) throw new Error(`未找到过戳批次 ${batchId}。`)
  return batch
}

function deviceById(state: ServiceWorkspaceState, deviceId: string): PostageMeterDevice {
  const device = state.postageMeterDevices.find((candidate) => candidate.id === deviceId)
  if (!device) throw new Error('请选择邮资机。')
  return device
}

function mailHandoverById(
  state: ServiceWorkspaceState,
  handoverId: string,
): PostageMeterMailHandover {
  const handover = state.postageMeterMailHandovers.find(
    (candidate) => candidate.id === handoverId,
  )
  if (!handover) throw new Error(`未找到委托交接记录 ${handoverId}。`)
  return handover
}

function handoverHasBatchedMail(
  state: ServiceWorkspaceState,
  handover: PostageMeterMailHandover,
): boolean {
  const transactionIds = new Set(handover.items.map((item) => item.transactionId))
  return state.postageMeterBatches.some((batch) =>
    batch.items.some((item) => transactionIds.has(item.transactionId)))
}

function transactionItem(transaction: ServiceTransaction): PostageMeterBatchItem {
  const agreementAccountId = transaction.customer.sender.agreementAccountId?.trim() ?? ''
  if (!agreementAccountId) throw new Error(`${transaction.id} 不是协议客户邮件。`)
  if (transaction.status !== 'settled') {
    throw new Error(`${transaction.service.itemCode || transaction.id} 尚未结算。`)
  }
  return {
    transactionId: transaction.id,
    querySerial: transaction.id,
    agreementAccountId,
    agreementAccountName:
      transaction.customer.sender.agreementAccountName.trim() || '协议客户',
    productName: transaction.product.label,
    itemNumber: transaction.service.itemCode.trim() || transaction.id,
    quantity: transaction.service.quantity,
    expectedPostageCents: transaction.charge.postageCents,
    acceptanceOffice: transaction.operator.acceptanceOffice,
    acceptedAt: transaction.acceptedAt,
  }
}

function summarizeItems(items: PostageMeterBatchItem[]) {
  return {
    expectedItemCount: items.reduce((total, item) => total + item.quantity, 0),
    expectedPostageCents: items.reduce(
      (total, item) => total + item.expectedPostageCents,
      0,
    ),
  }
}

export function queryPostageMeterPendingTransactions(
  state: ServiceWorkspaceState,
): ServiceTransaction[] {
  const assigned = new Set(
    state.postageMeterBatches.flatMap((batch) =>
      batch.items.map((item) => item.transactionId)),
  )
  const awaitingHandover = new Set(
    state.postageMeterMailHandovers
      .filter((handover) =>
        handover.status === 'pending-receipt' || handover.status === 'return-requested')
      .flatMap((handover) => handover.items.map((item) => item.transactionId)),
  )
  return state.transactions
    .filter((transaction) => transaction.status === 'settled')
    .filter((transaction) => Boolean(transaction.customer.sender.agreementAccountId))
    .filter((transaction) => !assigned.has(transaction.id))
    .filter((transaction) => !awaitingHandover.has(transaction.id))
    .filter((transaction) => {
      const custody = transactionMailCustody(state, transaction.id)
      return custody?.kind !== 'dispatch-bag' && custody?.kind !== 'loose-mail-handover'
    })
    .sort((left, right) => left.acceptedAt.localeCompare(right.acceptedAt))
}

export function queryPostageMeterDelegableTransactions(
  state: ServiceWorkspaceState,
): ServiceTransaction[] {
  const assigned = new Set(
    state.postageMeterBatches.flatMap((batch) =>
      batch.items.map((item) => item.transactionId)),
  )
  const delegated = new Set(
    state.postageMeterMailHandovers
      .filter((handover) => handover.status !== 'returned')
      .flatMap((handover) => handover.items.map((item) => item.transactionId)),
  )
  return state.transactions
    .filter((transaction) => transaction.status === 'settled')
    .filter((transaction) => Boolean(transaction.customer.sender.agreementAccountId))
    .filter((transaction) => !assigned.has(transaction.id))
    .filter((transaction) => !delegated.has(transaction.id))
    .filter((transaction) => {
      const custody = transactionMailCustody(state, transaction.id)
      return custody?.kind !== 'dispatch-bag' && custody?.kind !== 'loose-mail-handover'
    })
    .sort((left, right) => left.acceptedAt.localeCompare(right.acceptedAt))
}

export function queryPostageMeterMailHandovers(
  state: ServiceWorkspaceState,
  query: PostageMeterMailHandoverQuery,
): PostageMeterMailHandover[] {
  const sourceTerm = query.sourceInstitution.trim()
  const targetTerm = query.targetInstitution.trim()
  const agreementTerm = query.agreementAccount.trim()
  const handoverTerm = query.handoverNumber.trim()
  return state.postageMeterMailHandovers
    .filter((handover) =>
      matchesDate(handover.handedOverAt, query.handedOverDateFrom, query.handedOverDateTo))
    .filter((handover) => !query.status || handover.status === query.status)
    .filter((handover) => !sourceTerm ||
      handover.sourceInstitutionName.includes(sourceTerm) ||
      handover.sourceInstitutionCode.includes(sourceTerm))
    .filter((handover) => !targetTerm ||
      handover.targetInstitutionName.includes(targetTerm) ||
      handover.targetInstitutionCode.includes(targetTerm))
    .filter((handover) => !handoverTerm || handover.handoverNumber.includes(handoverTerm))
    .filter((handover) => !agreementTerm || handover.items.some((item) =>
      item.agreementAccountId.includes(agreementTerm) ||
      item.agreementAccountName.includes(agreementTerm)))
    .sort((left, right) => right.handedOverAt.localeCompare(left.handedOverAt))
}

export function queryPostageMeterUsageLedger(
  state: ServiceWorkspaceState,
  registeredDateFrom: string,
  registeredDateTo: string,
  deviceId: string,
): PostageMeterUsageLedgerRow[] {
  return state.postageMeterRegistrations
    .filter((record) =>
      matchesDate(record.registeredAt, registeredDateFrom, registeredDateTo))
    .filter((record) => !deviceId || record.deviceId === deviceId)
    .map((registration) => {
      const batch = batchById(state, registration.batchId)
      return {
        registration,
        batch,
        agreementAccountIds: [...new Set(batch.items.map((item) => item.agreementAccountId))],
        differenceItemCount: batch.expectedItemCount - registration.actualItemCount,
        differencePostageCents:
          batch.expectedPostageCents - registration.actualPostageCents,
      }
    })
    .sort((left, right) =>
      right.registration.registeredAt.localeCompare(left.registration.registeredAt))
}

export function queryPostageMeterBatches(
  state: ServiceWorkspaceState,
  query: PostageMeterBatchQuery,
): PostageMeterBatch[] {
  return state.postageMeterBatches
    .filter((batch) => matchesDate(batch.createdAt, query.createdDateFrom, query.createdDateTo))
    .filter((batch) => !query.status || batch.status === query.status)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function queryPostageMeterRegistrations(
  state: ServiceWorkspaceState,
  query: PostageMeterRegistrationQuery,
): PostageMeterRegistration[] {
  const batchTerm = query.batchNumber.trim()
  return state.postageMeterRegistrations
    .filter((record) =>
      matchesDate(record.registeredAt, query.registeredDateFrom, query.registeredDateTo))
    .filter((record) => !batchTerm || record.batchNumber.includes(batchTerm))
    .filter((record) => !query.deviceId || record.deviceId === query.deviceId)
    .sort((left, right) => right.registeredAt.localeCompare(left.registeredAt))
}

export function postageMeterBatchDifference(batch: PostageMeterBatch) {
  return {
    itemCount: batch.expectedItemCount - batch.actualItemCount,
    postageCents: batch.expectedPostageCents - batch.actualPostageCents,
  }
}

function createBatch(
  state: ServiceWorkspaceState,
  command: CreatePostageMeterBatchCommand,
): PostageMeterResult {
  const transactionIds = requiredIds(command.transactionIds, '生成批次')
  const pending = new Set(
    queryPostageMeterPendingTransactions(state).map((transaction) => transaction.id),
  )
  const items = transactionIds.map((transactionId) => {
    if (!pending.has(transactionId)) {
      throw new Error(`业务记录 ${transactionId} 已入批次或不符合待过戳条件。`)
    }
    return transactionItem(transactionById(state, transactionId))
  })
  const totals = summarizeItems(items)
  const sequence = state.nextPostageMeterBatchSequence
  const batch: PostageMeterBatch = {
    id: datedId('YZPC', command.createdAt, sequence),
    batchNumber: numericBatchNumber(command.createdAt, sequence),
    createdAt: command.createdAt,
    createdBy: structuredClone(command.operator),
    items,
    ...totals,
    actualItemCount: 0,
    actualPostageCents: 0,
    cancelledItemCount: 0,
    cancelledPostageCents: 0,
    status: 'pending',
    discrepancyReason: '',
  }
  return {
    state: {
      ...state,
      postageMeterBatches: [...state.postageMeterBatches, batch],
      nextPostageMeterBatchSequence: sequence + 1,
    },
    batch,
    registration: null,
    device: null,
    balance: null,
  }
}

function appendBatch(
  state: ServiceWorkspaceState,
  command: AppendPostageMeterBatchCommand,
): PostageMeterResult {
  const batch = batchById(state, command.batchId)
  if (batch.status !== 'pending' ||
      state.postageMeterRegistrations.some((record) => record.batchId === batch.id)) {
    throw new Error('已经开始过戳的批次不能追加记录。')
  }
  const transactionIds = requiredIds(command.transactionIds, '追加')
  const pending = new Set(
    queryPostageMeterPendingTransactions(state).map((transaction) => transaction.id),
  )
  const additions = transactionIds.map((transactionId) => {
    if (!pending.has(transactionId)) {
      throw new Error(`业务记录 ${transactionId} 已入批次或不符合待过戳条件。`)
    }
    return transactionItem(transactionById(state, transactionId))
  })
  const items = [...batch.items, ...additions]
  const updated: PostageMeterBatch = { ...batch, items, ...summarizeItems(items) }
  return {
    state: {
      ...state,
      postageMeterBatches: state.postageMeterBatches.map((candidate) =>
        candidate.id === updated.id ? updated : candidate),
    },
    batch: updated,
    registration: null,
    device: null,
    balance: null,
  }
}

function deleteBatch(
  state: ServiceWorkspaceState,
  command: DeletePostageMeterBatchCommand,
): PostageMeterResult {
  const batch = batchById(state, command.batchId)
  if (state.postageMeterRegistrations.some((record) => record.batchId === batch.id)) {
    throw new Error('已经登记过戳的批次不能删除。')
  }
  return {
    state: {
      ...state,
      postageMeterBatches: state.postageMeterBatches.filter(
        (candidate) => candidate.id !== batch.id,
      ),
    },
    batch,
    registration: null,
    device: null,
    balance: null,
  }
}

function registerReading(
  state: ServiceWorkspaceState,
  command: RegisterPostageMeterReadingCommand,
): PostageMeterResult {
  const batch = batchById(state, command.batchId)
  const device = deviceById(state, command.deviceId)
  if (device.validity !== 'valid') throw new Error('该邮资机当前无效，不能过戳。')
  if (device.reportStatus !== 'enabled') throw new Error('该邮资机尚未启用。')
  if (batch.status === 'balanced') throw new Error('已完成平衡的批次不能再次过戳。')
  if (state.postageMeterRegistrations.some((record) => record.batchId === batch.id)) {
    throw new Error('该批次已经完成过戳登记。')
  }

  const startCount = nonNegativeInteger(command.startCount, '起始数量')
  const endCount = nonNegativeInteger(command.endCount, '终止数量')
  const cancelledCount = nonNegativeInteger(command.cancelledCount, '注销数量')
  const startAmountCents = nonNegativeInteger(command.startAmountCents, '起始金额')
  const endAmountCents = nonNegativeInteger(command.endAmountCents, '终止金额')
  const cancelledAmountCents = nonNegativeInteger(
    command.cancelledAmountCents,
    '注销金额',
  )
  if (endCount < startCount || endAmountCents < startAmountCents) {
    throw new Error('终止读数不能小于起始读数。')
  }
  const grossCount = endCount - startCount
  const grossAmountCents = endAmountCents - startAmountCents
  if (cancelledCount > grossCount || cancelledAmountCents > grossAmountCents) {
    throw new Error('注销数量和金额不能超过本期使用量。')
  }
  if (endAmountCents > device.totalPostageCents) {
    throw new Error('终止金额不能超过邮资机总邮资。')
  }
  if (
    startCount !== device.cumulativeImprintCount ||
    startAmountCents !== device.cumulativePostageCents
  ) {
    requireOnSiteAuthorization(
      command.authorization,
      'adjust-postage-meter-reading',
      command.operator.operatorId,
    )
  }

  const registrationSequence = state.nextPostageMeterRegistrationSequence
  const actualItemCount = grossCount - cancelledCount
  const actualPostageCents = grossAmountCents - cancelledAmountCents
  const registration: PostageMeterRegistration = {
    id: datedId('YZDJ', command.registeredAt, registrationSequence),
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    deviceId: device.id,
    registeredAt: command.registeredAt,
    registeredBy: structuredClone(command.operator),
    startCount,
    endCount,
    cancelledCount,
    startAmountCents,
    endAmountCents,
    cancelledAmountCents,
    actualItemCount,
    actualPostageCents,
  }
  const updatedBatch: PostageMeterBatch = {
    ...batch,
    actualItemCount,
    actualPostageCents,
    cancelledItemCount: cancelledCount,
    cancelledPostageCents: cancelledAmountCents,
    status: 'registered',
  }
  const updatedDevice: PostageMeterDevice = {
    ...device,
    cumulativeImprintCount: endCount,
    cumulativePostageCents: endAmountCents,
    remainingPostageCents: device.totalPostageCents - endAmountCents,
    updatedAt: command.registeredAt,
  }
  return {
    state: {
      ...state,
      postageMeterBatches: state.postageMeterBatches.map((candidate) =>
        candidate.id === batch.id ? updatedBatch : candidate),
      postageMeterDevices: state.postageMeterDevices.map((candidate) =>
        candidate.id === device.id ? updatedDevice : candidate),
      postageMeterRegistrations: [
        ...state.postageMeterRegistrations,
        registration,
      ],
      nextPostageMeterRegistrationSequence: registrationSequence + 1,
    },
    batch: updatedBatch,
    registration,
    device: updatedDevice,
    balance: null,
  }
}

function recordDiscrepancy(
  state: ServiceWorkspaceState,
  command: RecordPostageMeterDiscrepancyCommand,
): PostageMeterResult {
  const batch = batchById(state, command.batchId)
  if (batch.status !== 'registered') throw new Error('该批次尚未完成过戳登记。')
  const difference = postageMeterBatchDifference(batch)
  const reason = command.reason.trim()
  if ((difference.itemCount !== 0 || difference.postageCents !== 0) && !reason) {
    throw new Error('存在差错时必须填写差错原因。')
  }
  const updated: PostageMeterBatch = {
    ...batch,
    status: 'balanced',
    discrepancyReason: reason,
  }
  return {
    state: {
      ...state,
      postageMeterBatches: state.postageMeterBatches.map((candidate) =>
        candidate.id === batch.id ? updated : candidate),
    },
    batch: updated,
    registration: null,
    device: null,
    balance: null,
  }
}

function updateDevice(
  state: ServiceWorkspaceState,
  command: UpdatePostageMeterDeviceCommand,
): PostageMeterResult {
  const device = deviceById(state, command.deviceId)
  const counterCode = requiredText(command.counterCode, '台席代码')
  if (!/^\d{8}$/.test(counterCode)) throw new Error('台席代码必须为 8 位数字。')
  const updated: PostageMeterDevice = {
    ...device,
    counterCode,
    networkMode: command.networkMode,
    terminalPort: command.terminalPort,
    updatedAt: command.updatedAt,
  }
  return {
    state: {
      ...state,
      postageMeterDevices: state.postageMeterDevices.map((candidate) =>
        candidate.id === device.id ? updated : candidate),
    },
    batch: null,
    registration: null,
    device: updated,
    balance: null,
  }
}

function createMailHandover(
  state: ServiceWorkspaceState,
  command: CreatePostageMeterMailHandoverCommand,
): PostageMeterResult {
  const transactionIds = requiredIds(command.transactionIds, '委托交出')
  const delegable = new Set(
    queryPostageMeterDelegableTransactions(state).map((transaction) => transaction.id),
  )
  const unavailable = transactionIds.filter((id) => !delegable.has(id))
  if (unavailable.length > 0) {
    throw new Error(`所选邮件已进入其他批次或委托记录：${unavailable.join('、')}。`)
  }
  const sourceInstitutionCode = requiredText(
    command.sourceInstitutionCode,
    '交出机构代码',
  )
  const targetInstitutionCode = requiredText(
    command.targetInstitutionCode,
    '过戳机构代码',
  )
  if (sourceInstitutionCode === targetInstitutionCode) {
    throw new Error('委托交出必须选择其他过戳机构。')
  }
  const items = transactionIds.map((id) => transactionItem(transactionById(state, id)))
  const summary = summarizeItems(items)
  const sequence = state.nextPostageMeterMailHandoverSequence
  const handover: PostageMeterMailHandover = {
    id: datedId('YZWJ', command.handedOverAt, sequence),
    handoverNumber: numericHandoverNumber(command.handedOverAt, sequence),
    items,
    ...summary,
    sourceInstitutionCode,
    sourceInstitutionName: requiredText(
      command.sourceInstitutionName,
      '交出机构名称',
    ),
    targetInstitutionCode,
    targetInstitutionName: requiredText(
      command.targetInstitutionName,
      '过戳机构名称',
    ),
    sourceCounterCode: requiredText(command.sourceCounterCode, '台席'),
    handedOverAt: command.handedOverAt,
    handedOverBy: structuredClone(command.operator),
    status: 'pending-receipt',
    receivedAt: null,
    receivedBy: null,
    returnRequestedAt: null,
    returnRequestedBy: null,
    returnedAt: null,
    returnedBy: null,
  }
  return {
    state: {
      ...state,
      postageMeterMailHandovers: [...state.postageMeterMailHandovers, handover],
      nextPostageMeterMailHandoverSequence: sequence + 1,
    },
    batch: null,
    registration: null,
    device: null,
    balance: null,
    handover,
  }
}

function receiveMailHandovers(
  state: ServiceWorkspaceState,
  command: ReceivePostageMeterMailHandoversCommand,
): PostageMeterResult {
  const handoverIds = requiredIds(command.handoverIds, '接收')
  const selected = handoverIds.map((id) => mailHandoverById(state, id))
  const unavailable = selected.filter((handover) => handover.status !== 'pending-receipt')
  if (unavailable.length > 0) throw new Error('所选委托记录已经接收或退回。')
  const idSet = new Set(handoverIds)
  const received = selected.map((handover): PostageMeterMailHandover => ({
    ...handover,
    status: 'received',
    receivedAt: command.receivedAt,
    receivedBy: structuredClone(command.operator),
  }))
  const receivedMap = new Map(received.map((handover) => [handover.id, handover]))
  return {
    state: {
      ...state,
      postageMeterMailHandovers: state.postageMeterMailHandovers.map((handover) =>
        idSet.has(handover.id) ? receivedMap.get(handover.id)! : handover),
    },
    batch: null,
    registration: null,
    device: null,
    balance: null,
    handover: received[0] ?? null,
    handovers: received,
  }
}

function returnMailHandover(
  state: ServiceWorkspaceState,
  command: ReturnPostageMeterMailHandoverCommand,
): PostageMeterResult {
  const handover = mailHandoverById(state, command.handoverId)
  if (handover.status !== 'received') throw new Error('只有已接收记录可以直接退回。')
  if (handoverHasBatchedMail(state, handover)) {
    throw new Error('该委托邮件已经进入过戳批次，不能退回。')
  }
  const returned: PostageMeterMailHandover = {
    ...handover,
    status: 'returned',
    returnedAt: command.returnedAt,
    returnedBy: structuredClone(command.operator),
  }
  return {
    state: {
      ...state,
      postageMeterMailHandovers: state.postageMeterMailHandovers.map((candidate) =>
        candidate.id === returned.id ? returned : candidate),
    },
    batch: null,
    registration: null,
    device: null,
    balance: null,
    handover: returned,
  }
}

function requestMailHandoverReturn(
  state: ServiceWorkspaceState,
  command: RequestPostageMeterMailHandoverReturnCommand,
): PostageMeterResult {
  const handover = mailHandoverById(state, command.handoverId)
  if (handover.status !== 'received') {
    throw new Error('只有已接收记录可以提交退回申请。')
  }
  if (handoverHasBatchedMail(state, handover)) {
    throw new Error('该委托邮件已经进入过戳批次，不能申请退回。')
  }
  const requested: PostageMeterMailHandover = {
    ...handover,
    status: 'return-requested',
    returnRequestedAt: command.requestedAt,
    returnRequestedBy: structuredClone(command.operator),
  }
  return {
    state: {
      ...state,
      postageMeterMailHandovers: state.postageMeterMailHandovers.map((candidate) =>
        candidate.id === requested.id ? requested : candidate),
    },
    batch: null,
    registration: null,
    device: null,
    balance: null,
    handover: requested,
  }
}

function approveMailHandoverReturn(
  state: ServiceWorkspaceState,
  command: ApprovePostageMeterMailHandoverReturnCommand,
): PostageMeterResult {
  const handover = mailHandoverById(state, command.handoverId)
  if (handover.status !== 'return-requested') throw new Error('该记录没有待审批退回申请。')
  if (handoverHasBatchedMail(state, handover)) {
    throw new Error('该委托邮件已经进入过戳批次，不能批准退回。')
  }
  const returned: PostageMeterMailHandover = {
    ...handover,
    status: 'returned',
    returnedAt: command.approvedAt,
    returnedBy: structuredClone(command.operator),
  }
  return {
    state: {
      ...state,
      postageMeterMailHandovers: state.postageMeterMailHandovers.map((candidate) =>
        candidate.id === returned.id ? returned : candidate),
    },
    batch: null,
    registration: null,
    device: null,
    balance: null,
    handover: returned,
  }
}

function submitFundingRequest(
  state: ServiceWorkspaceState,
  command: SubmitPostageMeterFundingRequestCommand,
): PostageMeterResult {
  const device = deviceById(state, command.deviceId)
  if (device.validity !== 'valid') throw new Error('该邮资机当前无效，不能申请注资。')
  const amountCents = nonNegativeInteger(command.amountCents, '申请注资金额')
  if (amountCents === 0) throw new Error('申请注资金额必须大于 0。')
  const sequence = state.nextPostageMeterFundingSequence
  const fundingRequest: PostageMeterFundingRequest = {
    id: datedId('YZZZ', command.requestedAt, sequence),
    requestNumber: datedId('ZZSQ', command.requestedAt, sequence),
    deviceId: device.id,
    amountCents,
    status: 'pending-external-approval',
    requestedAt: command.requestedAt,
    requestedBy: structuredClone(command.operator),
  }
  return {
    state: {
      ...state,
      postageMeterFundingRequests: [
        ...state.postageMeterFundingRequests,
        fundingRequest,
      ],
      nextPostageMeterFundingSequence: sequence + 1,
    },
    batch: null,
    registration: null,
    device,
    balance: null,
    fundingRequest,
  }
}

function submitRepairRequest(
  state: ServiceWorkspaceState,
  command: SubmitPostageMeterRepairRequestCommand,
): PostageMeterResult {
  const device = deviceById(state, command.deviceId)
  if (device.validity !== 'valid') throw new Error('该邮资机当前无效。')
  if (command.matter === 'repair' && device.reportStatus === 'disabled') {
    throw new Error('该邮资机已经处于报修状态。')
  }
  if (command.matter === 'enable' && device.reportStatus === 'enabled') {
    throw new Error('该邮资机已经启用，无需再次申请。')
  }
  const hasPending = state.postageMeterRepairRequests.some((request) =>
    request.deviceId === device.id &&
    request.matter === command.matter &&
    request.status === 'submitted')
  if (hasPending) throw new Error('该邮资机已有同类待处理申请。')
  const sequence = state.nextPostageMeterRepairSequence
  const repairRequest: PostageMeterRepairRequest = {
    id: datedId('YZBX', command.requestedAt, sequence),
    requestNumber: datedId('BXSQ', command.requestedAt, sequence),
    deviceId: device.id,
    matter: command.matter,
    status: 'submitted',
    requestedAt: command.requestedAt,
    requestedBy: structuredClone(command.operator),
    activatedAt: null,
    activatedBy: null,
  }
  const updatedDevice: PostageMeterDevice = command.matter === 'repair'
    ? { ...device, reportStatus: 'disabled', updatedAt: command.requestedAt }
    : device
  return {
    state: {
      ...state,
      postageMeterDevices: state.postageMeterDevices.map((candidate) =>
        candidate.id === updatedDevice.id ? updatedDevice : candidate),
      postageMeterRepairRequests: [
        ...state.postageMeterRepairRequests,
        repairRequest,
      ],
      nextPostageMeterRepairSequence: sequence + 1,
    },
    batch: null,
    registration: null,
    device: updatedDevice,
    balance: null,
    repairRequest,
  }
}

function generateDailyBalance(
  state: ServiceWorkspaceState,
  command: GeneratePostageMeterDailyBalanceCommand,
): PostageMeterResult {
  const statisticDate = requiredText(command.statisticDate, '统计日期')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statisticDate)) {
    throw new Error('统计日期格式必须为 YYYY-MM-DD。')
  }
  const device = deviceById(state, command.deviceId)
  const registrations = state.postageMeterRegistrations.filter(
    (record) => record.deviceId === device.id &&
      businessCalendarDay(record.registeredAt) === statisticDate,
  )
  const batches = registrations.map((record) => batchById(state, record.batchId))
  const expectedItemCount = batches.reduce(
    (total, batch) => total + batch.expectedItemCount,
    0,
  )
  const expectedPostageCents = batches.reduce(
    (total, batch) => total + batch.expectedPostageCents,
    0,
  )
  const actualItemCount = registrations.reduce(
    (total, record) => total + record.actualItemCount,
    0,
  )
  const actualPostageCents = registrations.reduce(
    (total, record) => total + record.actualPostageCents,
    0,
  )
  const cancelledItemCount = registrations.reduce(
    (total, record) => total + record.cancelledCount,
    0,
  )
  const cancelledPostageCents = registrations.reduce(
    (total, record) => total + record.cancelledAmountCents,
    0,
  )
  const existing = state.postageMeterDailyBalances.find(
    (balance) => balance.statisticDate === statisticDate && balance.deviceId === device.id,
  )
  if (existing?.uploadedAt) throw new Error('该邮资机当日平衡已经上传。')
  const sequence = state.nextPostageMeterDailyBalanceSequence
  const balance: PostageMeterDailyBalance = {
    id: existing?.id ?? datedId('YZRZ', command.generatedAt, sequence),
    institutionCode: requiredText(command.institutionCode, '过戳机构代码'),
    institutionName: requiredText(command.institutionName, '过戳机构'),
    statisticDate,
    deviceId: device.id,
    expectedItemCount,
    expectedPostageCents,
    actualItemCount,
    actualPostageCents,
    cancelledItemCount,
    cancelledPostageCents,
    differenceItemCount: expectedItemCount - actualItemCount,
    differencePostageCents: expectedPostageCents - actualPostageCents,
    generatedAt: command.generatedAt,
    uploadedAt: null,
    uploadedBy: null,
  }
  return {
    state: {
      ...state,
      postageMeterDailyBalances: existing
        ? state.postageMeterDailyBalances.map((candidate) =>
            candidate.id === existing.id ? balance : candidate)
        : [...state.postageMeterDailyBalances, balance],
      nextPostageMeterDailyBalanceSequence: existing ? sequence : sequence + 1,
    },
    batch: null,
    registration: null,
    device,
    balance,
  }
}

function uploadDailyBalance(
  state: ServiceWorkspaceState,
  command: UploadPostageMeterDailyBalanceCommand,
): PostageMeterResult {
  const balance = state.postageMeterDailyBalances.find(
    (candidate) => candidate.id === command.balanceId,
  )
  if (!balance) throw new Error('请先执行日终统计。')
  if (balance.uploadedAt) throw new Error('该日终平衡已经上传。')
  const updated: PostageMeterDailyBalance = {
    ...balance,
    uploadedAt: command.uploadedAt,
    uploadedBy: structuredClone(command.operator),
  }
  const pendingEnableRequest = [...state.postageMeterRepairRequests]
    .reverse()
    .find((request) =>
      request.deviceId === balance.deviceId &&
      request.matter === 'enable' &&
      request.status === 'submitted')
  const device = deviceById(state, balance.deviceId)
  const updatedDevice: PostageMeterDevice = pendingEnableRequest
    ? { ...device, reportStatus: 'enabled', updatedAt: command.uploadedAt }
    : device
  return {
    state: {
      ...state,
      postageMeterDailyBalances: state.postageMeterDailyBalances.map((candidate) =>
        candidate.id === balance.id ? updated : candidate),
      postageMeterDevices: state.postageMeterDevices.map((candidate) =>
        candidate.id === updatedDevice.id ? updatedDevice : candidate),
      postageMeterRepairRequests: state.postageMeterRepairRequests.map((request) =>
        request.id === pendingEnableRequest?.id
          ? {
              ...request,
              status: 'activated',
              activatedAt: command.uploadedAt,
              activatedBy: structuredClone(command.operator),
            }
          : request),
    },
    batch: null,
    registration: null,
    device: updatedDevice,
    balance: updated,
  }
}

export function executePostageMeterCommand(
  state: ServiceWorkspaceState,
  command: PostageMeterCommand,
): PostageMeterResult {
  switch (command.type) {
    case 'create-postage-meter-batch':
      return createBatch(state, command)
    case 'append-postage-meter-batch':
      return appendBatch(state, command)
    case 'delete-postage-meter-batch':
      return deleteBatch(state, command)
    case 'register-postage-meter-reading':
      return registerReading(state, command)
    case 'record-postage-meter-discrepancy':
      return recordDiscrepancy(state, command)
    case 'update-postage-meter-device':
      return updateDevice(state, command)
    case 'generate-postage-meter-daily-balance':
      return generateDailyBalance(state, command)
    case 'upload-postage-meter-daily-balance':
      return uploadDailyBalance(state, command)
    case 'create-postage-meter-mail-handover':
      return createMailHandover(state, command)
    case 'receive-postage-meter-mail-handovers':
      return receiveMailHandovers(state, command)
    case 'return-postage-meter-mail-handover':
      return returnMailHandover(state, command)
    case 'request-postage-meter-mail-handover-return':
      return requestMailHandoverReturn(state, command)
    case 'approve-postage-meter-mail-handover-return':
      return approveMailHandoverReturn(state, command)
    case 'submit-postage-meter-funding-request':
      return submitFundingRequest(state, command)
    case 'submit-postage-meter-repair-request':
      return submitRepairRequest(state, command)
  }
}
