import type {
  LooseMailHandoverRecord,
  LooseMailHandoverScope,
  ServiceOperatorSnapshot,
  ServiceTransaction,
  ServiceWorkspaceState,
} from './types'
import { businessCalendarDay } from '../shared/businessTime'
import {
  assertTransactionMailCustodyReleased,
  transactionMailCustody,
} from './mailCustody'
import {
  assertServiceOperatorInstitution,
  serviceOperatorInstitutionCode,
} from './institutionScope'
import {
  requireInternalHandoverAuthorization,
  type InternalHandoverAuthorization,
} from '../access/workAuthorization'

export type LooseMailHandoverQueryStatus = 'not-handed-over' | 'handed-over'
export type LooseMailReceiptQueryStatus = 'not-received' | 'received'

export interface LooseMailDispatchQuery {
  status: LooseMailHandoverQueryStatus | LooseMailReceiptQueryStatus
  productTerm: string
  note: string
  acceptedDateFrom: string
  acceptedDateTo: string
}

export interface LooseMailDispatchRow {
  transaction: ServiceTransaction
  handover: LooseMailHandoverRecord | null
}

interface HandOverLooseMailCommand {
  type: 'hand-over-loose-mail'
  transactionIds: string[]
  scope: LooseMailHandoverScope
  receivingOfficeCode: string
  receivingOfficeName: string
  receivingEmployeeId: string
  receivingEmployeeName: string
  originOfficeCode: string
  authorization?: InternalHandoverAuthorization
  note: string
  performedAt: string
  operator: ServiceOperatorSnapshot
}

interface ChangeLooseMailReceivingOfficeCommand {
  type: 'change-loose-mail-receiving-office'
  handoverIds: string[]
  receivingOfficeCode: string
  receivingOfficeName: string
  originOfficeCode: string
  operator: ServiceOperatorSnapshot
}

interface SetLooseMailDirectSealCommand {
  type: 'set-loose-mail-direct-seal'
  handoverIds: string[]
  directSeal: boolean
  receivingOfficeCode: string
  operator: ServiceOperatorSnapshot
}

interface ReceiveLooseMailCommand {
  type: 'receive-loose-mail'
  handoverIds: string[]
  receivedAt: string
  receivingOfficeCode: string
  operator: ServiceOperatorSnapshot
}

interface ReturnLooseMailCommand {
  type: 'return-loose-mail'
  handoverIds: string[]
  returnedAt: string
  receivingOfficeCode: string
  returnNote: string
  operator: ServiceOperatorSnapshot
}

export type MailDispatchCommand =
  | HandOverLooseMailCommand
  | ChangeLooseMailReceivingOfficeCommand
  | SetLooseMailDirectSealCommand
  | ReceiveLooseMailCommand
  | ReturnLooseMailCommand

export interface MailDispatchResult {
  state: ServiceWorkspaceState
  handovers: LooseMailHandoverRecord[]
}

function datedId(prefix: string, at: string, sequence: number): string {
  const date = businessCalendarDay(at).replaceAll('-', '')
  return `${prefix}-${date}-${String(sequence).padStart(6, '0')}`
}

function requiredIds(ids: string[], label: string): string[] {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (unique.length === 0) throw new Error(`请选择需要${label}的邮件。`)
  return unique
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`请选择${label}。`)
  return trimmed
}

function latestHandover(
  state: ServiceWorkspaceState,
  transactionId: string,
): LooseMailHandoverRecord | null {
  return [...state.looseMailHandovers]
    .reverse()
    .find((record) => record.transactionId === transactionId) ?? null
}

function transactionById(
  state: ServiceWorkspaceState,
  transactionId: string,
): ServiceTransaction {
  const transaction = state.transactions.find((item) => item.id === transactionId)
  if (!transaction) throw new Error(`未找到邮件 ${transactionId}。`)
  return transaction
}

function handoverById(
  state: ServiceWorkspaceState,
  handoverId: string,
): LooseMailHandoverRecord {
  const record = state.looseMailHandovers.find((item) => item.id === handoverId)
  if (!record) throw new Error(`未找到交接记录 ${handoverId}。`)
  return record
}

function matchesDate(value: string, from: string, to: string): boolean {
  const day = businessCalendarDay(value)
  return (!from || day >= from) && (!to || day <= to)
}

function matchesTransaction(
  transaction: ServiceTransaction,
  query: LooseMailDispatchQuery,
): boolean {
  const term = query.productTerm.trim().toLocaleLowerCase('zh-CN')
  const productText = [
    transaction.product.label,
    transaction.product.searchCode,
    transaction.product.effectiveBusinessCode,
  ].join(' ').toLocaleLowerCase('zh-CN')
  return (!term || productText.includes(term)) &&
    matchesDate(transaction.acceptedAt, query.acceptedDateFrom, query.acceptedDateTo)
}

function matchesNote(
  transaction: ServiceTransaction,
  record: LooseMailHandoverRecord | null,
  note: string,
): boolean {
  const term = note.trim().toLocaleLowerCase('zh-CN')
  if (!term) return true
  return [record?.note ?? '', transaction.service.operatorNote]
    .some((value) => value.toLocaleLowerCase('zh-CN').includes(term))
}

export function looseMailDisplayNumber(transaction: ServiceTransaction): string {
  return transaction.service.itemCode.trim() || transaction.id
}

export function queryLooseMailForHandover(
  state: ServiceWorkspaceState,
  query: LooseMailDispatchQuery,
  originOfficeCode: string,
): LooseMailDispatchRow[] {
  if (query.status === 'not-handed-over') {
    return state.transactions
      .filter((transaction) => transaction.status === 'settled')
      .filter((transaction) =>
        serviceOperatorInstitutionCode(transaction.operator) === originOfficeCode)
      .filter((transaction) => transactionMailCustody(state, transaction.id) === null)
      .filter((transaction) => matchesTransaction(transaction, query))
      .filter((transaction) => matchesNote(transaction, null, query.note))
      .map((transaction) => ({ transaction, handover: null }))
  }

  return state.looseMailHandovers
    .filter((handover) => (
      handover.originOfficeCode ?? serviceOperatorInstitutionCode(handover.handedOverBy)
    ) === originOfficeCode)
    .map((handover) => ({
      handover,
      transaction: transactionById(state, handover.transactionId),
    }))
    .filter(({ transaction }) => matchesTransaction(transaction, query))
    .filter(({ transaction, handover }) => matchesNote(transaction, handover, query.note))
}

export function queryLooseMailForReceipt(
  state: ServiceWorkspaceState,
  query: LooseMailDispatchQuery,
  receivingOfficeCode: string,
): LooseMailDispatchRow[] {
  const acceptedStatuses = query.status === 'not-received'
    ? new Set(['handed-over'])
    : new Set(['received', 'returned'])
  return state.looseMailHandovers
    .filter((handover) => handover.scope === 'cross-office')
    .filter((handover) => handover.receivingOfficeCode === receivingOfficeCode)
    .filter((handover) => acceptedStatuses.has(handover.status))
    .map((handover) => ({
      handover,
      transaction: transactionById(state, handover.transactionId),
    }))
    .filter(({ transaction }) => matchesTransaction(transaction, query))
    .filter(({ transaction, handover }) => matchesNote(transaction, handover, query.note))
}

function handOverLooseMail(
  state: ServiceWorkspaceState,
  command: HandOverLooseMailCommand,
): MailDispatchResult {
  const transactionIds = requiredIds(command.transactionIds, '交出')
  const receivingOfficeCode = requiredText(command.receivingOfficeCode, '接收机构')
  const receivingOfficeName = requiredText(command.receivingOfficeName, '接收机构')
  const originOfficeCode = requiredText(command.originOfficeCode, '交出机构')
  assertServiceOperatorInstitution(command.operator, originOfficeCode)
  const receivingEmployeeId = command.receivingEmployeeId.trim()
  const receivingEmployeeName = command.receivingEmployeeName.trim()

  if (command.scope === 'internal') {
    if (receivingOfficeCode !== originOfficeCode) {
      throw new Error('本局交接的接收机构必须是当前机构。')
    }
    if (!receivingEmployeeId || !receivingEmployeeName) {
      throw new Error('本局交接必须选择接收员工。')
    }
    requireInternalHandoverAuthorization(
      command.authorization,
      command.operator.operatorId,
      receivingEmployeeId,
      originOfficeCode,
    )
  }

  const created: LooseMailHandoverRecord[] = []
  let sequence = state.nextLooseMailHandoverSequence
  for (const transactionId of transactionIds) {
    const transaction = transactionById(state, transactionId)
    if (serviceOperatorInstitutionCode(transaction.operator) !== originOfficeCode) {
      throw new Error(`${looseMailDisplayNumber(transaction)} 不属于当前交出机构。`)
    }
    if (transaction.status !== 'settled') {
      throw new Error(`${looseMailDisplayNumber(transaction)} 尚未结算，不能交出。`)
    }
    const latest = latestHandover(state, transaction.id)
    if (latest && latest.status !== 'returned') {
      throw new Error(`${looseMailDisplayNumber(transaction)} 已交出，不能重复交接。`)
    }
    assertTransactionMailCustodyReleased(state, transaction.id, '交出')

    const internalReceiver: ServiceOperatorSnapshot | null = command.scope === 'internal'
      ? {
          operatorId: receivingEmployeeId,
          displayName: receivingEmployeeName,
          workstationCode: command.operator.workstationCode,
          acceptanceOffice: command.operator.acceptanceOffice,
          receivingOffice: receivingOfficeName,
          institutionCode: originOfficeCode,
        }
      : null
    created.push({
      id: datedId('JJ', command.performedAt, sequence),
      transactionId,
      scope: command.scope,
      status: command.scope === 'internal' ? 'received' : 'handed-over',
      originOfficeCode,
      receivingOfficeCode,
      receivingOfficeName,
      receivingEmployeeId: command.scope === 'internal' ? receivingEmployeeId : '',
      receivingEmployeeName: command.scope === 'internal' ? receivingEmployeeName : '',
      directSeal: false,
      note: command.note.trim(),
      handedOverAt: command.performedAt,
      handedOverBy: structuredClone(command.operator),
      receivedAt: command.scope === 'internal' ? command.performedAt : null,
      receivedBy: internalReceiver,
      returnedAt: null,
      returnedBy: null,
      returnNote: '',
    })
    sequence += 1
  }

  return {
    state: {
      ...state,
      looseMailHandovers: [...state.looseMailHandovers, ...created],
      nextLooseMailHandoverSequence: sequence,
    },
    handovers: created,
  }
}

function changeReceivingOffice(
  state: ServiceWorkspaceState,
  command: ChangeLooseMailReceivingOfficeCommand,
): MailDispatchResult {
  const ids = requiredIds(command.handoverIds, '更改接收机构')
  const code = requiredText(command.receivingOfficeCode, '接收机构')
  const name = requiredText(command.receivingOfficeName, '接收机构')
  const originOfficeCode = assertServiceOperatorInstitution(
    command.operator,
    requiredText(command.originOfficeCode, '交出机构'),
  )
  const changed = ids.map((id) => {
    const record = handoverById(state, id)
    if (
      (record.originOfficeCode ?? serviceOperatorInstitutionCode(record.handedOverBy)) !==
      originOfficeCode
    ) {
      throw new Error(`${record.id} 不属于当前交出机构。`)
    }
    if (record.status !== 'handed-over') {
      throw new Error(`${record.id} 已被接收或退回，不能更改接收机构。`)
    }
    return {
      ...record,
      scope: 'cross-office' as const,
      receivingOfficeCode: code,
      receivingOfficeName: name,
      receivingEmployeeId: '',
      receivingEmployeeName: '',
    }
  })
  const changedById = new Map(changed.map((record) => [record.id, record]))
  return {
    state: {
      ...state,
      looseMailHandovers: state.looseMailHandovers.map(
        (record) => changedById.get(record.id) ?? record,
      ),
    },
    handovers: changed,
  }
}

function setDirectSeal(
  state: ServiceWorkspaceState,
  command: SetLooseMailDirectSealCommand,
): MailDispatchResult {
  const ids = requiredIds(command.handoverIds, '切换直封状态')
  const receivingOfficeCode = assertServiceOperatorInstitution(
    command.operator,
    command.receivingOfficeCode,
  )
  const changed = ids.map((id) => {
    const record = handoverById(state, id)
    if (record.receivingOfficeCode !== receivingOfficeCode) {
      throw new Error(`${record.id} 不属于当前接收机构。`)
    }
    if (record.scope !== 'cross-office' || record.status !== 'handed-over') {
      throw new Error(`${record.id} 当前不能切换直封状态。`)
    }
    return { ...record, directSeal: command.directSeal }
  })
  const changedById = new Map(changed.map((record) => [record.id, record]))
  return {
    state: {
      ...state,
      looseMailHandovers: state.looseMailHandovers.map(
        (record) => changedById.get(record.id) ?? record,
      ),
    },
    handovers: changed,
  }
}

function receiveLooseMail(
  state: ServiceWorkspaceState,
  command: ReceiveLooseMailCommand,
): MailDispatchResult {
  const ids = requiredIds(command.handoverIds, '接收')
  const receivingOfficeCode = assertServiceOperatorInstitution(
    command.operator,
    command.receivingOfficeCode,
  )
  const changed = ids.map((id) => {
    const record = handoverById(state, id)
    if (record.receivingOfficeCode !== receivingOfficeCode) {
      throw new Error(`${record.id} 不属于当前接收机构。`)
    }
    if (record.scope !== 'cross-office' || record.status !== 'handed-over') {
      throw new Error(`${record.id} 当前不能接收。`)
    }
    return {
      ...record,
      status: 'received' as const,
      receivedAt: command.receivedAt,
      receivedBy: structuredClone(command.operator),
    }
  })
  const changedById = new Map(changed.map((record) => [record.id, record]))
  return {
    state: {
      ...state,
      looseMailHandovers: state.looseMailHandovers.map(
        (record) => changedById.get(record.id) ?? record,
      ),
    },
    handovers: changed,
  }
}

function returnLooseMail(
  state: ServiceWorkspaceState,
  command: ReturnLooseMailCommand,
): MailDispatchResult {
  const ids = requiredIds(command.handoverIds, '退回')
  const receivingOfficeCode = assertServiceOperatorInstitution(
    command.operator,
    command.receivingOfficeCode,
  )
  const returnNote = command.returnNote.trim()
  if (!returnNote) throw new Error('请输入退回原因。')
  const changed = ids.map((id) => {
    const record = handoverById(state, id)
    if (record.receivingOfficeCode !== receivingOfficeCode) {
      throw new Error(`${record.id} 不属于当前接收机构。`)
    }
    if (record.scope !== 'cross-office' || record.status !== 'received') {
      throw new Error(`${record.id} 当前不能退回。`)
    }
    return {
      ...record,
      status: 'returned' as const,
      returnedAt: command.returnedAt,
      returnedBy: structuredClone(command.operator),
      returnNote,
    }
  })
  const changedById = new Map(changed.map((record) => [record.id, record]))
  return {
    state: {
      ...state,
      looseMailHandovers: state.looseMailHandovers.map(
        (record) => changedById.get(record.id) ?? record,
      ),
    },
    handovers: changed,
  }
}

export function executeMailDispatchCommand(
  state: ServiceWorkspaceState,
  command: MailDispatchCommand,
): MailDispatchResult {
  if (command.type === 'hand-over-loose-mail') return handOverLooseMail(state, command)
  if (command.type === 'change-loose-mail-receiving-office') {
    return changeReceivingOffice(state, command)
  }
  if (command.type === 'set-loose-mail-direct-seal') return setDirectSeal(state, command)
  if (command.type === 'receive-loose-mail') return receiveLooseMail(state, command)
  return returnLooseMail(state, command)
}
