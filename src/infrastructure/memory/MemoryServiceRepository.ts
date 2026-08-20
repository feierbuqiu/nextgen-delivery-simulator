import type {
  AcceptedPostalSupplySaleResult,
  AcceptedServiceResult,
  RevisedServiceResult,
  ServiceDocumentActionResult,
  ServiceRepository,
  SettledServiceResult,
  WithdrawnServiceResult,
} from '../../domain/service/repository'
import { migrateServiceWorkspaceState } from '../../domain/service/migration'
import { createServiceSeedState } from '../../domain/service/seed'
import {
  recordServiceDocumentAction,
  reviseServiceTransaction,
  withdrawServiceTransactions,
} from '../../domain/service/transactionCorrection'
import {
  acceptPostalSupplySale,
  acceptServiceTransaction,
  recordInvoiceDecision,
  settleServiceTransactions,
} from '../../domain/service/transactions'
import {
  deleteBulkBatch,
  importBulkBatch,
  recordBulkDocumentPrompt,
  recordBulkMailLabelPrint,
  recordBulkInvoiceChoice,
  recordBulkInvoiceDelivery,
  registerBulkInvoice,
  recordBulkSealTagDecision,
  sealBulkBatch,
  settleBulkBatch,
  type ImportBulkBatchRequest,
  type RecordBulkDocumentPromptRequest,
  type RecordBulkMailLabelPrintRequest,
  type RecordBulkInvoiceDeliveryRequest,
  type RegisterBulkInvoiceRequest,
  type RecordBulkSealTagDecisionRequest,
  type SealBulkBatchRequest,
} from '../../domain/service/bulk'
import {
  deleteSelfServiceImport,
  importSelfServiceReservation,
  querySelfServiceReservation,
  settleSelfServiceImport,
  type ImportSelfServiceReservationRequest,
} from '../../domain/service/selfServiceImport'
import {
  dispatchReturnReceipt,
  recordReturnReceiptArrival,
  type DispatchReturnReceiptRequest,
  type RecordReturnReceiptArrivalRequest,
  type ReturnReceiptResult,
} from '../../domain/service/returnReceipt'
import {
  completeThirdPartyRefund,
  requestThirdPartyRefund,
  type CompleteThirdPartyRefundRequest,
  type RequestThirdPartyRefundRequest,
  type ThirdPartyRefundResult,
} from '../../domain/service/refundPending'
import {
  acceptReplyCouponRedemption,
  reviseReplyCouponRedemption,
  settleReplyCouponRedemption,
  withdrawReplyCouponRedemption,
  type AcceptReplyCouponRedemptionRequest,
  type ReviseReplyCouponRedemptionRequest,
  type SettleReplyCouponRedemptionRequest,
  type WithdrawReplyCouponRedemptionRequest,
} from '../../domain/service/replyCoupon'
import {
  acceptChannelProductOrder,
  deleteChannelProductOrders,
  recordChannelProductReceiptPrint,
  type AcceptChannelProductOrderRequest,
  type DeleteChannelProductOrdersRequest,
  type RecordChannelProductReceiptPrintRequest,
} from '../../domain/service/channelProductSales'
import {
  acceptSupplementaryTraffic,
  type AcceptSupplementaryTrafficRequest,
} from '../../domain/service/supplementaryTraffic'
import {
  acceptElectronicCommerce,
  type AcceptElectronicCommerceRequest,
} from '../../domain/service/electronicCommerce'
import {
  executeMailDispatchCommand,
  type MailDispatchCommand,
} from '../../domain/service/mailDispatch'
import {
  executeMailSealingCommand,
  type MailSealingCommand,
} from '../../domain/service/mailSealing'
import {
  executeDispatchBagHandoverCommand,
  type DispatchBagHandoverCommand,
} from '../../domain/service/dispatchBagHandover'
import {
  executeDispatchRoutingCommand,
  type DispatchRoutingCommand,
} from '../../domain/service/dispatchRouting'
import {
  executeDispatchBalanceReturnCommand,
  type DispatchBalanceReturnCommand,
} from '../../domain/service/dispatchBalanceReturn'
import {
  executePostageMeterCommand,
  type PostageMeterCommand,
} from '../../domain/service/postageMeter'
import {
  executeSpecialHandlingCommand,
  type SpecialHandlingCommand,
} from '../../domain/service/specialHandling'
import {
  executeWindowDeliveryCommand,
  type WindowDeliveryCommand,
} from '../../domain/service/windowDelivery'
import {
  executePostalSupplyManagementCommand,
  type PostalSupplyManagementCommand,
} from '../../domain/service/postalSupplyManagement'
import {
  executePointsInventoryCommand,
  type PointsInventoryCommand,
} from '../../domain/service/pointsInventory'
import {
  executeCounterCorrectionCommand,
  type CounterCorrectionCommand,
} from '../../domain/service/counterCorrections'
import {
  executeInvoiceManagementCommand,
  type InvoiceManagementCommand,
} from '../../domain/service/invoiceManagement'
import {
  executeSpotCheckExerciseCommand,
  type SpotCheckExerciseCommand,
} from '../../domain/service/spotCheckExercise'
import type {
  AcceptPostalSupplySaleRequest,
  AcceptServiceRequest,
  RecordServiceDocumentActionRequest,
  ReviseServiceRequest,
  ServiceDraft,
  ServiceWorkspaceState,
  SettleServiceRequest,
  WithdrawServiceRequest,
} from '../../domain/service/types'
import {
  executePersonalRemittanceCommand,
  type PersonalRemittanceCommand,
} from '../../domain/service/personalRemittance'
import {
  executeInstitutionAccountingCommand,
  type InstitutionAccountingCommand,
} from '../../domain/service/institutionAccounting'

function cloneState(state: ServiceWorkspaceState): ServiceWorkspaceState {
  return structuredClone(state)
}

export class MemoryServiceRepository implements ServiceRepository {
  private constructor(private state: ServiceWorkspaceState) {}

  static create(): MemoryServiceRepository {
    return new MemoryServiceRepository(createServiceSeedState())
  }

  static fromState(state: ServiceWorkspaceState): MemoryServiceRepository {
    return new MemoryServiceRepository(migrateServiceWorkspaceState(state))
  }

  async load(): Promise<ServiceWorkspaceState> {
    return cloneState(this.state)
  }

  async saveDraft(draft: ServiceDraft): Promise<ServiceWorkspaceState> {
    this.state = { ...this.state, draft: structuredClone(draft) }
    return cloneState(this.state)
  }

  async accept(request: AcceptServiceRequest): Promise<AcceptedServiceResult> {
    const accepted = acceptServiceTransaction(this.state, request)
    this.state = accepted.state
    return structuredClone(accepted)
  }

  async acceptPostalSupplySale(
    request: AcceptPostalSupplySaleRequest,
  ): Promise<AcceptedPostalSupplySaleResult> {
    const accepted = acceptPostalSupplySale(this.state, request)
    this.state = accepted.state
    return structuredClone(accepted)
  }

  async acceptChannelProductOrder(request: AcceptChannelProductOrderRequest) {
    const accepted = acceptChannelProductOrder(this.state, request)
    this.state = accepted.state
    return structuredClone(accepted)
  }

  async recordChannelProductReceiptPrint(
    request: RecordChannelProductReceiptPrintRequest,
  ) {
    const recorded = recordChannelProductReceiptPrint(this.state, request)
    this.state = recorded.state
    return structuredClone(recorded)
  }

  async deleteChannelProductOrders(request: DeleteChannelProductOrdersRequest) {
    const deleted = deleteChannelProductOrders(this.state, request)
    this.state = deleted.state
    return structuredClone(deleted)
  }

  async acceptSupplementaryTraffic(request: AcceptSupplementaryTrafficRequest) {
    const accepted = acceptSupplementaryTraffic(this.state, request)
    this.state = accepted.state
    return structuredClone(accepted)
  }

  async acceptElectronicCommerce(request: AcceptElectronicCommerceRequest) {
    const accepted = acceptElectronicCommerce(this.state, request)
    this.state = accepted.state
    return structuredClone(accepted)
  }

  async settle(request: SettleServiceRequest): Promise<SettledServiceResult> {
    const settled = settleServiceTransactions(this.state, request)
    this.state = settled.state
    return structuredClone(settled)
  }

  async revise(request: ReviseServiceRequest): Promise<RevisedServiceResult> {
    const revised = reviseServiceTransaction(this.state, request)
    this.state = revised.state
    return structuredClone(revised)
  }

  async withdraw(request: WithdrawServiceRequest): Promise<WithdrawnServiceResult> {
    const withdrawn = withdrawServiceTransactions(this.state, request)
    this.state = withdrawn.state
    return structuredClone(withdrawn)
  }

  async recordDocumentAction(
    request: RecordServiceDocumentActionRequest,
  ): Promise<ServiceDocumentActionResult> {
    const recorded = recordServiceDocumentAction(this.state, request)
    this.state = recorded.state
    return structuredClone(recorded)
  }

  async recordInvoiceDecision(
    settlementId: string,
    requested: boolean,
  ): Promise<ServiceWorkspaceState> {
    this.state = recordInvoiceDecision(this.state, settlementId, requested)
    return cloneState(this.state)
  }

  async recordReturnReceiptArrival(
    request: RecordReturnReceiptArrivalRequest,
  ): Promise<ReturnReceiptResult> {
    const recorded = recordReturnReceiptArrival(this.state, request)
    this.state = recorded.state
    return structuredClone(recorded)
  }

  async dispatchReturnReceipt(
    request: DispatchReturnReceiptRequest,
  ): Promise<ReturnReceiptResult> {
    const dispatched = dispatchReturnReceipt(this.state, request)
    this.state = dispatched.state
    return structuredClone(dispatched)
  }

  async requestThirdPartyRefund(
    request: RequestThirdPartyRefundRequest,
  ): Promise<ThirdPartyRefundResult> {
    const requested = requestThirdPartyRefund(this.state, request)
    this.state = requested.state
    return structuredClone(requested)
  }

  async completeThirdPartyRefund(
    request: CompleteThirdPartyRefundRequest,
  ): Promise<ThirdPartyRefundResult> {
    const completed = completeThirdPartyRefund(this.state, request)
    this.state = completed.state
    return structuredClone(completed)
  }

  async acceptReplyCouponRedemption(
    request: AcceptReplyCouponRedemptionRequest,
  ) {
    const accepted = acceptReplyCouponRedemption(this.state, request)
    this.state = accepted.state
    return structuredClone(accepted)
  }

  async reviseReplyCouponRedemption(
    request: ReviseReplyCouponRedemptionRequest,
  ) {
    const revised = reviseReplyCouponRedemption(this.state, request)
    this.state = revised.state
    return structuredClone(revised)
  }

  async settleReplyCouponRedemption(
    request: SettleReplyCouponRedemptionRequest,
  ) {
    const settled = settleReplyCouponRedemption(this.state, request)
    this.state = settled.state
    return structuredClone(settled)
  }

  async withdrawReplyCouponRedemption(
    request: WithdrawReplyCouponRedemptionRequest,
  ) {
    const withdrawn = withdrawReplyCouponRedemption(this.state, request)
    this.state = withdrawn.state
    return structuredClone(withdrawn)
  }

  async importBulkBatch(request: ImportBulkBatchRequest) {
    const imported = importBulkBatch(this.state, request)
    this.state = imported.state
    return structuredClone(imported)
  }

  async settleBulkBatch(batchId: string, settledAt: string) {
    const settled = settleBulkBatch(this.state, batchId, settledAt)
    this.state = settled.state
    return structuredClone(settled)
  }

  async recordBulkDocumentPrompt(request: RecordBulkDocumentPromptRequest) {
    const recorded = recordBulkDocumentPrompt(this.state, request)
    this.state = recorded.state
    return structuredClone(recorded)
  }

  async recordBulkMailLabelPrint(request: RecordBulkMailLabelPrintRequest) {
    const recorded = recordBulkMailLabelPrint(this.state, request)
    this.state = recorded.state
    return structuredClone(recorded)
  }

  async recordBulkInvoiceChoice(batchId: string, requested: boolean) {
    const recorded = recordBulkInvoiceChoice(this.state, batchId, requested)
    this.state = recorded.state
    return structuredClone(recorded)
  }

  async registerBulkInvoice(request: RegisterBulkInvoiceRequest) {
    const recorded = registerBulkInvoice(this.state, request)
    this.state = recorded.state
    return structuredClone(recorded)
  }

  async recordBulkInvoiceDelivery(request: RecordBulkInvoiceDeliveryRequest) {
    const recorded = recordBulkInvoiceDelivery(this.state, request)
    this.state = recorded.state
    return structuredClone(recorded)
  }

  async deleteBulkBatch(batchId: string): Promise<ServiceWorkspaceState> {
    this.state = deleteBulkBatch(this.state, batchId)
    return cloneState(this.state)
  }

  async sealBulkBatch(request: SealBulkBatchRequest) {
    const sealed = sealBulkBatch(this.state, request)
    this.state = sealed.state
    return structuredClone(sealed)
  }

  async recordBulkSealTagDecision(request: RecordBulkSealTagDecisionRequest) {
    const recorded = recordBulkSealTagDecision(this.state, request)
    this.state = recorded.state
    return structuredClone(recorded)
  }

  async querySelfServiceReservation(reservationNumber: string) {
    return querySelfServiceReservation(reservationNumber)
  }

  async importSelfServiceReservation(request: ImportSelfServiceReservationRequest) {
    const imported = importSelfServiceReservation(this.state, request)
    this.state = imported.state
    return structuredClone(imported)
  }

  async settleSelfServiceImport(batchId: string, settledAt: string) {
    const settled = settleSelfServiceImport(this.state, batchId, settledAt)
    this.state = settled.state
    return structuredClone(settled)
  }

  async deleteSelfServiceImport(batchId: string): Promise<ServiceWorkspaceState> {
    this.state = deleteSelfServiceImport(this.state, batchId)
    return cloneState(this.state)
  }

  async executeMailDispatch(command: MailDispatchCommand) {
    const result = executeMailDispatchCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executeMailSealing(command: MailSealingCommand) {
    const result = executeMailSealingCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executeDispatchBagHandover(command: DispatchBagHandoverCommand) {
    const result = executeDispatchBagHandoverCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executeDispatchRouting(command: DispatchRoutingCommand) {
    const result = executeDispatchRoutingCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executeDispatchBalanceReturn(command: DispatchBalanceReturnCommand) {
    const result = executeDispatchBalanceReturnCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executePostageMeter(command: PostageMeterCommand) {
    const result = executePostageMeterCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executeSpecialHandling(command: SpecialHandlingCommand) {
    const result = executeSpecialHandlingCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executeWindowDelivery(command: WindowDeliveryCommand) {
    const result = executeWindowDeliveryCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executePostalSupplyManagement(command: PostalSupplyManagementCommand) {
    const result = executePostalSupplyManagementCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executePointsInventory(command: PointsInventoryCommand) {
    const result = executePointsInventoryCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executeCounterCorrection(command: CounterCorrectionCommand) {
    const result = executeCounterCorrectionCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executeInvoiceManagement(command: InvoiceManagementCommand) {
    const result = executeInvoiceManagementCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executeSpotCheckExercise(command: SpotCheckExerciseCommand) {
    const result = executeSpotCheckExerciseCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executePersonalRemittance(command: PersonalRemittanceCommand) {
    const result = executePersonalRemittanceCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async executeInstitutionAccounting(command: InstitutionAccountingCommand) {
    const result = executeInstitutionAccountingCommand(this.state, command)
    this.state = result.state
    return structuredClone(result)
  }

  async restore(state: ServiceWorkspaceState): Promise<ServiceWorkspaceState> {
    this.state = migrateServiceWorkspaceState(state)
    return cloneState(this.state)
  }

  async reset(): Promise<ServiceWorkspaceState> {
    this.state = createServiceSeedState()
    return cloneState(this.state)
  }
}
