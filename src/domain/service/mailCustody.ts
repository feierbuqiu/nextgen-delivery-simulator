import type { ServiceWorkspaceState } from './types'

export type TransactionMailCustody =
  | { kind: 'dispatch-bag'; reference: string }
  | { kind: 'loose-mail-handover'; reference: string }
  | { kind: 'postage-meter-batch'; reference: string }
  | { kind: 'postage-meter-handover'; reference: string }

export function transactionMailCustody(
  state: ServiceWorkspaceState,
  transactionId: string,
): TransactionMailCustody | null {
  const bag = state.dispatchBags.find((candidate) =>
    candidate.sealingStatus === 'sealed'
    && candidate.mailReferences.some((reference) =>
      reference.kind === 'transaction' && reference.transactionId === transactionId))
  if (bag) return { kind: 'dispatch-bag', reference: bag.id }

  const looseHandover = state.looseMailHandovers
    .slice()
    .reverse()
    .find((candidate) => candidate.transactionId === transactionId)
  if (looseHandover && looseHandover.status !== 'returned') {
    return { kind: 'loose-mail-handover', reference: looseHandover.id }
  }

  const meterBatch = state.postageMeterBatches.find((candidate) =>
    candidate.items.some((item) => item.transactionId === transactionId))
  if (meterBatch) return { kind: 'postage-meter-batch', reference: meterBatch.id }

  const meterHandover = state.postageMeterMailHandovers
    .slice()
    .reverse()
    .find((candidate) => candidate.items.some((item) => item.transactionId === transactionId))
  if (meterHandover && meterHandover.status !== 'returned') {
    return { kind: 'postage-meter-handover', reference: meterHandover.id }
  }
  return null
}

export function transactionMailCustodyLabel(custody: TransactionMailCustody): string {
  if (custody.kind === 'dispatch-bag') return `总包 ${custody.reference}`
  if (custody.kind === 'loose-mail-handover') return `散件交接 ${custody.reference}`
  if (custody.kind === 'postage-meter-batch') return `邮资机批次 ${custody.reference}`
  return `邮资机委托交接 ${custody.reference}`
}

export function assertTransactionMailCustodyReleased(
  state: ServiceWorkspaceState,
  transactionId: string,
  action: string,
): void {
  const custody = transactionMailCustody(state, transactionId)
  if (custody) {
    throw new Error(
      `${transactionId} 已进入${transactionMailCustodyLabel(custody)}，请先完成撤销或退回后再${action}。`,
    )
  }
}
