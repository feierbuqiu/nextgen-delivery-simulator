import type { ServiceWorkspaceState } from './types'

type IdentifiedRecord = Readonly<{ id: string }>

function sequenceFromIdentifier(value: unknown): number {
  if (typeof value !== 'string') return 0
  const match = /-([0-9]+)$/u.exec(value.trim())
  if (!match) return 0
  const parsed = Number(match[1])
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

function nextFromIdentifiers(current: number, identifiers: readonly unknown[]): number {
  return identifiers.reduce<number>(
    (next, identifier) => Math.max(next, sequenceFromIdentifier(identifier) + 1),
    current,
  )
}

function recordIds(records: readonly IdentifiedRecord[]): string[] {
  return records.map((record) => record.id)
}

function numericSequence(value: unknown): number {
  if (typeof value !== 'string' || !/^[0-9]+$/u.test(value.trim())) return 0
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Makes every persisted counter at least one greater than the highest sequence
 * already present in its historical ledger. Stored counters are never reduced:
 * gaps can represent abandoned documents and must not be reused.
 */
export function reconcileServiceWorkspaceSequences(
  state: ServiceWorkspaceState,
): ServiceWorkspaceState {
  const settlementIdentifiers = [
    ...recordIds(state.settlements),
    ...state.transactions.map((record) => record.settlementId),
    ...state.replyCouponRedemptions.map((record) => record.settlementId),
  ]
  const manifestNumbers = [
    ...state.dispatchBags.map((record) => record.manifestNumber),
    ...state.dispatchRoutes.flatMap((record) => record.manifestNumbers),
  ]
  const nextDispatchManifestSequence = manifestNumbers.reduce(
    (next, manifestNumber) => Math.max(next, numericSequence(manifestNumber) + 1),
    state.nextDispatchManifestSequence,
  )

  return {
    ...state,
    nextSequence: nextFromIdentifiers(state.nextSequence, recordIds(state.transactions)),
    nextPostalSupplySequence: nextFromIdentifiers(
      state.nextPostalSupplySequence,
      recordIds(state.postalSupplySales),
    ),
    nextChannelProductSequence: nextFromIdentifiers(
      state.nextChannelProductSequence,
      recordIds(state.channelProductOrders),
    ),
    nextSupplementaryTrafficSequence: nextFromIdentifiers(
      state.nextSupplementaryTrafficSequence,
      recordIds(state.supplementaryTrafficRecords),
    ),
    nextElectronicCommerceSequence: nextFromIdentifiers(
      state.nextElectronicCommerceSequence,
      recordIds(state.electronicCommerceRecords),
    ),
    nextReplyCouponSequence: nextFromIdentifiers(
      state.nextReplyCouponSequence,
      recordIds(state.replyCouponRedemptions),
    ),
    nextSettlementSequence: nextFromIdentifiers(
      state.nextSettlementSequence,
      settlementIdentifiers,
    ),
    nextPersonalRemittanceSequence: nextFromIdentifiers(
      state.nextPersonalRemittanceSequence,
      recordIds(state.personalRemittances),
    ),
    nextInstitutionRemittanceSequence: nextFromIdentifiers(
      state.nextInstitutionRemittanceSequence,
      recordIds(state.institutionRemittances),
    ),
    nextBankDepositSequence: nextFromIdentifiers(
      state.nextBankDepositSequence,
      recordIds(state.bankDepositSlips),
    ),
    nextBusinessReportPrintSequence: nextFromIdentifiers(
      state.nextBusinessReportPrintSequence,
      recordIds(state.businessReportPrints),
    ),
    nextCorrectionSequence: nextFromIdentifiers(
      state.nextCorrectionSequence,
      recordIds(state.corrections),
    ),
    nextWithdrawalSequence: nextFromIdentifiers(
      state.nextWithdrawalSequence,
      recordIds(state.withdrawals),
    ),
    nextRefundSequence: nextFromIdentifiers(state.nextRefundSequence, recordIds(state.refunds)),
    nextDocumentActionSequence: nextFromIdentifiers(
      state.nextDocumentActionSequence,
      recordIds(state.documentActions),
    ),
    nextFiscalInvoiceSequence: nextFromIdentifiers(
      state.nextFiscalInvoiceSequence,
      recordIds(state.fiscalInvoices),
    ),
    nextReturnReceiptSequence: nextFromIdentifiers(
      state.nextReturnReceiptSequence,
      recordIds(state.returnReceipts),
    ),
    nextBulkBatchSequence: nextFromIdentifiers(
      state.nextBulkBatchSequence,
      recordIds(state.bulkBatches),
    ),
    nextSelfServiceImportSequence: nextFromIdentifiers(
      state.nextSelfServiceImportSequence,
      recordIds(state.selfServiceImports),
    ),
    nextLooseMailHandoverSequence: nextFromIdentifiers(
      state.nextLooseMailHandoverSequence,
      recordIds(state.looseMailHandovers),
    ),
    nextDispatchBagSequence: nextFromIdentifiers(
      state.nextDispatchBagSequence,
      recordIds(state.dispatchBags),
    ),
    nextDispatchManifestSequence,
    nextDispatchBagHandoverSequence: nextFromIdentifiers(
      state.nextDispatchBagHandoverSequence,
      recordIds(state.dispatchBagHandovers),
    ),
    nextDispatchBagChangeSequence: nextFromIdentifiers(
      state.nextDispatchBagChangeSequence,
      recordIds(state.dispatchBagChanges),
    ),
    nextDispatchBagInterchangeReturnSequence: nextFromIdentifiers(
      state.nextDispatchBagInterchangeReturnSequence,
      recordIds(state.dispatchBagInterchangeReturns),
    ),
    nextDispatchRouteSequence: nextFromIdentifiers(
      state.nextDispatchRouteSequence,
      recordIds(state.dispatchRoutes),
    ),
    nextDispatchPrintSequence: nextFromIdentifiers(
      state.nextDispatchPrintSequence,
      recordIds(state.dispatchPrintRecords),
    ),
    nextPostageMeterBatchSequence: nextFromIdentifiers(
      state.nextPostageMeterBatchSequence,
      recordIds(state.postageMeterBatches),
    ),
    nextPostageMeterRegistrationSequence: nextFromIdentifiers(
      state.nextPostageMeterRegistrationSequence,
      recordIds(state.postageMeterRegistrations),
    ),
    nextPostageMeterDailyBalanceSequence: nextFromIdentifiers(
      state.nextPostageMeterDailyBalanceSequence,
      recordIds(state.postageMeterDailyBalances),
    ),
    nextPostageMeterMailHandoverSequence: nextFromIdentifiers(
      state.nextPostageMeterMailHandoverSequence,
      recordIds(state.postageMeterMailHandovers),
    ),
    nextPostageMeterFundingSequence: nextFromIdentifiers(
      state.nextPostageMeterFundingSequence,
      recordIds(state.postageMeterFundingRequests),
    ),
    nextPostageMeterRepairSequence: nextFromIdentifiers(
      state.nextPostageMeterRepairSequence,
      recordIds(state.postageMeterRepairRequests),
    ),
    nextSpecialHandlingSequence: nextFromIdentifiers(
      state.nextSpecialHandlingSequence,
      recordIds(state.specialHandlingApplications),
    ),
    nextWindowDeliverySequence: nextFromIdentifiers(
      state.nextWindowDeliverySequence,
      recordIds(state.windowDeliveryBags),
    ),
    nextWindowDeliveryAuditSequence: nextFromIdentifiers(
      state.nextWindowDeliveryAuditSequence,
      recordIds(state.windowDeliveryAudits),
    ),
    nextPostalSupplyDocumentSequence: nextFromIdentifiers(
      state.nextPostalSupplyDocumentSequence,
      recordIds(state.postalSupplyDocuments),
    ),
    nextPointsInventoryMovementSequence: nextFromIdentifiers(
      state.nextPointsInventoryMovementSequence,
      recordIds(state.pointsInventoryMovements),
    ),
  }
}
