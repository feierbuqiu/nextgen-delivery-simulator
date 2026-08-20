import type {
  DispatchBagHandoverRecord,
  DispatchBagRecord,
  DispatchBagShift,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from './types'
import { businessCalendarDay } from '../shared/businessTime'
import {
  assertServiceOperatorInstitution,
  serviceOperatorInstitutionCode,
} from './institutionScope'

export type DispatchBagHandoverQueryStatus = 'not-handed-over' | 'handed-over'
export type DispatchBagReceiptQueryStatus = 'not-received' | 'received'

export interface DispatchBagQuery {
  status: DispatchBagHandoverQueryStatus | DispatchBagReceiptQueryStatus
  originOfficeTerm: string
  manifestTypeTerm: string
  shift: DispatchBagShift | ''
  sealedDateFrom: string
  sealedDateTo: string
}

export interface DispatchBagHandoverRow {
  bag: DispatchBagRecord
  handover: DispatchBagHandoverRecord | null
}

interface HandOverDispatchBagsCommand {
  type: 'hand-over-dispatch-bags'
  bagIds: string[]
  originOfficeCode: string
  receivingOfficeCode: string
  receivingOfficeName: string
  performedAt: string
  operator: ServiceOperatorSnapshot
}

interface WithdrawDispatchBagHandoversCommand {
  type: 'withdraw-dispatch-bag-handovers'
  handoverIds: string[]
  performedAt: string
  operator: ServiceOperatorSnapshot
  originOfficeCode: string
}

interface ReceiveDispatchBagHandoversCommand {
  type: 'receive-dispatch-bag-handovers'
  handoverIds: string[]
  shift: DispatchBagShift
  performedAt: string
  operator: ServiceOperatorSnapshot
  receivingOfficeCode: string
}

interface TransferReceivedBagShiftCommand {
  type: 'transfer-received-bag-shift'
  handoverIds: string[]
  shift: DispatchBagShift
  performedAt: string
  operator: ServiceOperatorSnapshot
  receivingOfficeCode: string
}

interface ReturnReceivedDispatchBagsCommand {
  type: 'return-received-dispatch-bags'
  handoverIds: string[]
  performedAt: string
  operator: ServiceOperatorSnapshot
  receivingOfficeCode: string
}

export type DispatchBagHandoverCommand =
  | HandOverDispatchBagsCommand
  | WithdrawDispatchBagHandoversCommand
  | ReceiveDispatchBagHandoversCommand
  | TransferReceivedBagShiftCommand
  | ReturnReceivedDispatchBagsCommand

export interface DispatchBagHandoverResult {
  state: ServiceWorkspaceState
  handovers: DispatchBagHandoverRecord[]
  bags: DispatchBagRecord[]
}

function uniqueIds(values: string[], action: string): string[] {
  const ids = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  if (ids.length === 0) throw new Error(`请选择需要${action}的总包。`)
  return ids
}

export function latestDispatchBagHandover(
  state: ServiceWorkspaceState,
  bagId: string,
): DispatchBagHandoverRecord | null {
  for (let index = state.dispatchBagHandovers.length - 1; index >= 0; index -= 1) {
    const handover = state.dispatchBagHandovers[index]
    if (handover?.bagId === bagId) return handover
  }
  return null
}

function matchesTerm(values: string[], term: string): boolean {
  const normalized = term.trim().toLocaleLowerCase('zh-CN')
  return !normalized || values.some((value) => value.toLocaleLowerCase('zh-CN').includes(normalized))
}

function matchesDate(value: string, from: string, to: string): boolean {
  const day = businessCalendarDay(value)
  return (!from || day >= from) && (!to || day <= to)
}

function baseRows(state: ServiceWorkspaceState, query: DispatchBagQuery): DispatchBagHandoverRow[] {
  return state.dispatchBags
    .filter((bag) => bag.sealingStatus === 'sealed')
    .map((bag) => ({ bag, handover: latestDispatchBagHandover(state, bag.id) }))
    .filter(({ bag, handover }) => matchesTerm([
      bag.generatedBy.acceptanceOffice,
      handover?.originOfficeCode ?? '',
      handover?.originOfficeName ?? '',
    ], query.originOfficeTerm))
    .filter(({ bag }) => matchesTerm([
      bag.manifestTypeCode,
      bag.manifestTypeName,
    ], query.manifestTypeTerm))
    .filter(({ bag }) => !query.shift || bag.shift === query.shift)
    .filter(({ bag }) => matchesDate(bag.generatedAt, query.sealedDateFrom, query.sealedDateTo))
    .sort((left, right) => right.bag.generatedAt.localeCompare(left.bag.generatedAt))
}

export function queryDispatchBagsForHandover(
  state: ServiceWorkspaceState,
  query: DispatchBagQuery,
  originOfficeCode: string,
): DispatchBagHandoverRow[] {
  return baseRows(state, query)
    .filter(({ bag, handover }) => (
      (handover?.originOfficeCode ?? bag.originOfficeCode ??
        serviceOperatorInstitutionCode(bag.generatedBy)) === originOfficeCode
    ))
    .filter(({ handover }) => query.status === 'not-handed-over'
      ? !handover || handover.status === 'withdrawn' || handover.status === 'returned'
      : handover?.status === 'handed-over')
}

export function queryDispatchBagsForReceipt(
  state: ServiceWorkspaceState,
  query: DispatchBagQuery,
  receivingOfficeCode: string,
): DispatchBagHandoverRow[] {
  return baseRows(state, query)
    .filter(({ handover }) => handover?.receivingOfficeCode === receivingOfficeCode)
    .filter(({ handover }) => query.status === 'not-received'
      ? handover?.status === 'handed-over'
      : handover?.status === 'received')
}

function requiredBag(state: ServiceWorkspaceState, id: string): DispatchBagRecord {
  const bag = state.dispatchBags.find((candidate) => candidate.id === id)
  if (!bag) throw new Error(`未找到总包 ${id}。`)
  if (bag.sealingStatus !== 'sealed') throw new Error(`${id} 已撤销封发，不能交接。`)
  return bag
}

function requiredHandover(
  state: ServiceWorkspaceState,
  id: string,
  status: DispatchBagHandoverRecord['status'],
): DispatchBagHandoverRecord {
  const handover = state.dispatchBagHandovers.find((candidate) => candidate.id === id)
  if (!handover) throw new Error(`未找到总包交接记录 ${id}。`)
  if (handover.status !== status) throw new Error(`${id} 当前状态不能执行该操作。`)
  return handover
}

function handOver(
  state: ServiceWorkspaceState,
  command: HandOverDispatchBagsCommand,
): DispatchBagHandoverResult {
  const ids = uniqueIds(command.bagIds, '交出')
  const originOfficeCode = assertServiceOperatorInstitution(
    command.operator,
    command.originOfficeCode,
  )
  const receivingOfficeCode = command.receivingOfficeCode.trim()
  const receivingOfficeName = command.receivingOfficeName.trim()
  if (!receivingOfficeCode || !receivingOfficeName) throw new Error('请选择总包接收机构。')
  const bags = ids.map((id) => requiredBag(state, id))
  for (const bag of bags) {
    if (
      (bag.originOfficeCode ?? serviceOperatorInstitutionCode(bag.generatedBy)) !==
      originOfficeCode
    ) {
      throw new Error(`${bag.id} 不属于当前交出机构。`)
    }
    const latest = latestDispatchBagHandover(state, bag.id)
    if (latest && (latest.status === 'handed-over' || latest.status === 'received')) {
      throw new Error(`${bag.id} 已交出，不能重复交出。`)
    }
  }
  let sequence = state.nextDispatchBagHandoverSequence
  const handovers = bags.map((bag) => {
    const record: DispatchBagHandoverRecord = {
      id: `ZBJ-${String(sequence).padStart(6, '0')}`,
      bagId: bag.id,
      status: 'handed-over',
      originOfficeCode,
      originOfficeName: bag.generatedBy.acceptanceOffice,
      receivingOfficeCode,
      receivingOfficeName,
      handedOverAt: command.performedAt,
      handedOverBy: structuredClone(command.operator),
      receivedAt: null,
      receivedBy: null,
      receiptShift: null,
      shiftTransferredAt: null,
      shiftTransferredBy: null,
      withdrawnAt: null,
      withdrawnBy: null,
      returnedAt: null,
      returnedBy: null,
    }
    sequence += 1
    return record
  })
  return {
    bags,
    handovers,
    state: {
      ...state,
      dispatchBagHandovers: [...state.dispatchBagHandovers, ...handovers],
      nextDispatchBagHandoverSequence: sequence,
    },
  }
}

function updateHandovers(
  state: ServiceWorkspaceState,
  changed: DispatchBagHandoverRecord[],
): ServiceWorkspaceState {
  const byId = new Map(changed.map((handover) => [handover.id, handover]))
  return {
    ...state,
    dispatchBagHandovers: state.dispatchBagHandovers.map((handover) => byId.get(handover.id) ?? handover),
  }
}

function withdraw(
  state: ServiceWorkspaceState,
  command: WithdrawDispatchBagHandoversCommand,
): DispatchBagHandoverResult {
  const originOfficeCode = assertServiceOperatorInstitution(
    command.operator,
    command.originOfficeCode,
  )
  const handovers = uniqueIds(command.handoverIds, '撤回').map((id) => {
    const handover = requiredHandover(state, id, 'handed-over')
    if (handover.originOfficeCode !== originOfficeCode) {
      throw new Error(`${id} 不属于当前交出机构。`)
    }
    return {
      ...handover,
      status: 'withdrawn' as const,
      withdrawnAt: command.performedAt,
      withdrawnBy: structuredClone(command.operator),
    }
  })
  return {
    state: updateHandovers(state, handovers),
    handovers,
    bags: handovers.map((handover) => requiredBag(state, handover.bagId)),
  }
}

function receive(
  state: ServiceWorkspaceState,
  command: ReceiveDispatchBagHandoversCommand,
): DispatchBagHandoverResult {
  const receivingOfficeCode = assertServiceOperatorInstitution(
    command.operator,
    command.receivingOfficeCode,
  )
  if (!['01', '02'].includes(command.shift)) throw new Error('请选择接收班次。')
  const handovers = uniqueIds(command.handoverIds, '接收').map((id) => {
    const handover = requiredHandover(state, id, 'handed-over')
    if (handover.receivingOfficeCode !== receivingOfficeCode) {
      throw new Error(`${id} 不属于当前接收机构。`)
    }
    return {
      ...handover,
      status: 'received' as const,
      receivedAt: command.performedAt,
      receivedBy: structuredClone(command.operator),
      receiptShift: command.shift,
    }
  })
  return {
    state: updateHandovers(state, handovers),
    handovers,
    bags: handovers.map((handover) => requiredBag(state, handover.bagId)),
  }
}

function transferShift(
  state: ServiceWorkspaceState,
  command: TransferReceivedBagShiftCommand,
): DispatchBagHandoverResult {
  const receivingOfficeCode = assertServiceOperatorInstitution(
    command.operator,
    command.receivingOfficeCode,
  )
  if (!['01', '02'].includes(command.shift)) throw new Error('请选择接收班次。')
  const originals = uniqueIds(command.handoverIds, '转移班次')
    .map((id) => requiredHandover(state, id, 'received'))
  if (originals.some((handover) => handover.receivingOfficeCode !== receivingOfficeCode)) {
    throw new Error('所选总包中包含不属于当前接收机构的记录。')
  }
  if (originals.every((handover) => handover.receiptShift === command.shift)) {
    throw new Error('请选择不同的目标班次。')
  }
  const handovers = originals.map((handover) => ({
    ...handover,
    receiptShift: command.shift,
    shiftTransferredAt: command.performedAt,
    shiftTransferredBy: structuredClone(command.operator),
  }))
  return {
    state: updateHandovers(state, handovers),
    handovers,
    bags: handovers.map((handover) => requiredBag(state, handover.bagId)),
  }
}

function returnReceived(
  state: ServiceWorkspaceState,
  command: ReturnReceivedDispatchBagsCommand,
): DispatchBagHandoverResult {
  const receivingOfficeCode = assertServiceOperatorInstitution(
    command.operator,
    command.receivingOfficeCode,
  )
  const handovers = uniqueIds(command.handoverIds, '退回').map((id) => {
    const handover = requiredHandover(state, id, 'received')
    if (handover.receivingOfficeCode !== receivingOfficeCode) {
      throw new Error(`${id} 不属于当前接收机构。`)
    }
    return {
      ...handover,
      status: 'returned' as const,
      returnedAt: command.performedAt,
      returnedBy: structuredClone(command.operator),
    }
  })
  return {
    state: updateHandovers(state, handovers),
    handovers,
    bags: handovers.map((handover) => requiredBag(state, handover.bagId)),
  }
}

export function executeDispatchBagHandoverCommand(
  state: ServiceWorkspaceState,
  command: DispatchBagHandoverCommand,
): DispatchBagHandoverResult {
  switch (command.type) {
    case 'hand-over-dispatch-bags': return handOver(state, command)
    case 'withdraw-dispatch-bag-handovers': return withdraw(state, command)
    case 'receive-dispatch-bag-handovers': return receive(state, command)
    case 'transfer-received-bag-shift': return transferShift(state, command)
    case 'return-received-dispatch-bags': return returnReceived(state, command)
  }
}
