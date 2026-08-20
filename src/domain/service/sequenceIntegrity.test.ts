import { describe, expect, it } from 'vitest'

import { createServiceSeedState } from './seed'
import { reconcileServiceWorkspaceSequences } from './sequenceIntegrity'
import type { ServiceWorkspaceState } from './types'

const recordSequenceCases = [
  ['nextSequence', 'transactions', 'SIM-20260819-000101', 102],
  ['nextPostalSupplySequence', 'postalSupplySales', 'YP-20260819-000102', 103],
  ['nextChannelProductSequence', 'channelProductOrders', 'XS-20260819-000103', 104],
  ['nextSupplementaryTrafficSequence', 'supplementaryTrafficRecords', 'BL-20260819-000104', 105],
  ['nextElectronicCommerceSequence', 'electronicCommerceRecords', 'DS-20260819-000105', 106],
  ['nextReplyCouponSequence', 'replyCouponRedemptions', 'HXQ-20260819-000106', 107],
  ['nextPersonalRemittanceSequence', 'personalRemittances', 'JK-20260819-000107', 108],
  ['nextInstitutionRemittanceSequence', 'institutionRemittances', 'ZJJK-20260819-000108', 109],
  ['nextBankDepositSequence', 'bankDepositSlips', 'CX-20260819-000109', 110],
  ['nextBusinessReportPrintSequence', 'businessReportPrints', 'YBR-00000110', 111],
  ['nextCorrectionSequence', 'corrections', 'XG-20260819-000111', 112],
  ['nextWithdrawalSequence', 'withdrawals', 'CX-20260819-000112', 113],
  ['nextRefundSequence', 'refunds', 'TK-20260819-000113', 114],
  ['nextDocumentActionSequence', 'documentActions', 'DJ-20260819-000114', 115],
  ['nextFiscalInvoiceSequence', 'fiscalInvoices', 'FP-20260819-000115', 116],
  ['nextReturnReceiptSequence', 'returnReceipts', 'HZ-20260819-000116', 117],
  ['nextBulkBatchSequence', 'bulkBatches', 'DZ-20260819-000117', 118],
  ['nextSelfServiceImportSequence', 'selfServiceImports', 'ZZ-20260819-000118', 119],
  ['nextLooseMailHandoverSequence', 'looseMailHandovers', 'JJ-20260819-000119', 120],
  ['nextDispatchBagSequence', 'dispatchBags', 'ZB-20260819-000120', 121],
  ['nextDispatchBagHandoverSequence', 'dispatchBagHandovers', 'ZBJ-000121', 122],
  ['nextDispatchBagChangeSequence', 'dispatchBagChanges', 'ZBG-000122', 123],
  ['nextDispatchBagInterchangeReturnSequence', 'dispatchBagInterchangeReturns', 'THHJ-000123', 124],
  ['nextDispatchRouteSequence', 'dispatchRoutes', 'LD-20260819-000124', 125],
  ['nextDispatchPrintSequence', 'dispatchPrintRecords', 'DY-000125', 126],
  ['nextPostageMeterBatchSequence', 'postageMeterBatches', 'YZPC-20260819-000126', 127],
  ['nextPostageMeterRegistrationSequence', 'postageMeterRegistrations', 'YZDJ-20260819-000127', 128],
  ['nextPostageMeterDailyBalanceSequence', 'postageMeterDailyBalances', 'YZRZ-20260819-000128', 129],
  ['nextPostageMeterMailHandoverSequence', 'postageMeterMailHandovers', 'YZWJ-20260819-000129', 130],
  ['nextPostageMeterFundingSequence', 'postageMeterFundingRequests', 'YZZZ-20260819-000130', 131],
  ['nextPostageMeterRepairSequence', 'postageMeterRepairRequests', 'YZBX-20260819-000131', 132],
  ['nextSpecialHandlingSequence', 'specialHandlingApplications', 'TC-20260819-000132', 133],
  ['nextWindowDeliverySequence', 'windowDeliveryBags', 'CT-20260819-000133', 134],
  ['nextWindowDeliveryAuditSequence', 'windowDeliveryAudits', 'CTA-20260819-000134', 135],
  ['nextPostalSupplyDocumentSequence', 'postalSupplyDocuments', 'YPGL-RK-20260819-000135', 136],
  ['nextPointsInventoryMovementSequence', 'pointsInventoryMovements', 'JF-KC-20260819-000136', 137],
] as const satisfies ReadonlyArray<readonly [
  keyof ServiceWorkspaceState,
  keyof ServiceWorkspaceState,
  string,
  number,
]>

describe('service workspace sequence integrity', () => {
  it.each(recordSequenceCases)(
    'recovers %s from the retained %s ledger',
    (counter, collection, id, expected) => {
      const state = createServiceSeedState()
      const stored = state as unknown as Record<string, unknown>
      stored[counter] = 1
      stored[collection] = [{ id }]

      expect(reconcileServiceWorkspaceSequences(state)[counter]).toBe(expected)
    },
  )

  it('recovers the shared settlement counter from every retained reference', () => {
    const state = createServiceSeedState()
    const stored = state as unknown as Record<string, unknown>
    stored.nextSettlementSequence = 1
    stored.settlements = [{ id: 'JS-20260819-000140' }]
    stored.transactions = [{ id: 'SIM-20260819-000001', settlementId: 'JS-20260819-000141' }]
    stored.replyCouponRedemptions = [{ id: 'HXQ-20260819-000001', settlementId: 'JS-20260819-000142' }]

    expect(reconcileServiceWorkspaceSequences(state).nextSettlementSequence).toBe(143)
  })

  it('recovers manifest numbers from both bag and route history', () => {
    const state = createServiceSeedState()
    const stored = state as unknown as Record<string, unknown>
    stored.nextDispatchManifestSequence = 1
    stored.dispatchBags = [{ id: 'ZB-20260819-000001', manifestNumber: '000890' }]
    stored.dispatchRoutes = [{ id: 'LD-20260819-000001', manifestNumbers: ['000891'] }]

    expect(reconcileServiceWorkspaceSequences(state).nextDispatchManifestSequence).toBe(892)
  })

  it('does not reduce a stored counter when historical numbers contain gaps', () => {
    const state = createServiceSeedState()
    state.nextSequence = 900
    state.transactions = []

    expect(reconcileServiceWorkspaceSequences(state).nextSequence).toBe(900)
  })

  it('ignores malformed or unsafe historical sequence text', () => {
    const state = createServiceSeedState()
    const stored = state as unknown as Record<string, unknown>
    state.nextSequence = 7
    state.nextDispatchManifestSequence = 700
    stored.transactions = [
      { id: 'SIM-not-a-sequence' },
      { id: 'SIM-20260819-9007199254740992' },
    ]
    stored.dispatchBags = [{
      id: 'ZB-20260819-000001',
      manifestNumber: '89A',
    }]
    stored.dispatchRoutes = []

    const reconciled = reconcileServiceWorkspaceSequences(state)
    expect(reconciled.nextSequence).toBe(7)
    expect(reconciled.nextDispatchManifestSequence).toBe(700)
  })
})
