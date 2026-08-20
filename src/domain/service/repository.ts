import type {
  AcceptPostalSupplySaleRequest,
  AcceptServiceRequest,
  PostalSupplySale,
  RecordServiceDocumentActionRequest,
  ReviseServiceRequest,
  ServiceCorrectionRecord,
  ServiceDocumentAction,
  ServiceDraft,
  ServiceRefundRecord,
  SelfServiceImportBatch,
  SelfServiceReservation,
  ServiceTransaction,
  ServiceWithdrawalRecord,
  ServiceWorkspaceState,
  SettleServiceRequest,
  SettlementRecord,
  WithdrawServiceRequest,
} from './types'
import type {
  ImportBulkBatchRequest,
  RecordBulkDocumentPromptRequest,
  RecordBulkMailLabelPrintRequest,
  RecordBulkInvoiceDeliveryRequest,
  RecordBulkSealTagDecisionRequest,
  RegisterBulkInvoiceRequest,
  SealBulkBatchRequest,
} from './bulk'
import type { BulkBatch } from './types'
import type { ImportSelfServiceReservationRequest } from './selfServiceImport'
import type {
  DispatchReturnReceiptRequest,
  RecordReturnReceiptArrivalRequest,
  ReturnReceiptResult,
} from './returnReceipt'
import type {
  CompleteThirdPartyRefundRequest,
  RequestThirdPartyRefundRequest,
  ThirdPartyRefundResult,
} from './refundPending'
import type {
  AcceptReplyCouponRedemptionRequest,
  ReplyCouponRedemptionResult,
  ReviseReplyCouponRedemptionRequest,
  SettleReplyCouponRedemptionRequest,
  SettledReplyCouponRedemptionResult,
  WithdrawReplyCouponRedemptionRequest,
} from './replyCoupon'
import type {
  AcceptChannelProductOrderRequest,
  AcceptedChannelProductOrderResult,
  ChannelProductOrderResult,
  DeleteChannelProductOrdersRequest,
  DeletedChannelProductOrdersResult,
  RecordChannelProductReceiptPrintRequest,
} from './channelProductSales'
import type {
  AcceptSupplementaryTrafficRequest,
  AcceptedSupplementaryTrafficResult,
} from './supplementaryTraffic'
import type {
  AcceptElectronicCommerceRequest,
  AcceptedElectronicCommerceResult,
} from './electronicCommerce'
import type {
  MailDispatchCommand,
  MailDispatchResult,
} from './mailDispatch'
import type {
  MailSealingCommand,
  MailSealingResult,
} from './mailSealing'
import type {
  DispatchBagHandoverCommand,
  DispatchBagHandoverResult,
} from './dispatchBagHandover'
import type {
  DispatchRoutingCommand,
  DispatchRoutingResult,
} from './dispatchRouting'
import type {
  DispatchBalanceReturnCommand,
  DispatchBalanceReturnResult,
} from './dispatchBalanceReturn'
import type { PostageMeterCommand, PostageMeterResult } from './postageMeter'
import type {
  SpecialHandlingCommand,
  SpecialHandlingResult,
} from './specialHandling'
import type {
  WindowDeliveryCommand,
  WindowDeliveryResult,
} from './windowDelivery'
import type {
  PostalSupplyManagementCommand,
  PostalSupplyManagementResult,
} from './postalSupplyManagement'
import type {
  PointsInventoryCommand,
  PointsInventoryResult,
} from './pointsInventory'
import type {
  InvoiceManagementCommand,
  InvoiceManagementResult,
} from './invoiceManagement'
import type {
  SpotCheckExerciseCommand,
  SpotCheckExerciseResult,
} from './spotCheckExercise'
import type {
  PersonalRemittanceCommand,
  PersonalRemittanceResult,
} from './personalRemittance'
import type {
  InstitutionAccountingCommand,
  InstitutionAccountingResult,
} from './institutionAccounting'
import type {
  CounterCorrectionCommand,
  CounterCorrectionResult,
} from './counterCorrections'

export interface AcceptedServiceResult {
  state: ServiceWorkspaceState
  transaction: ServiceTransaction
}

export interface AcceptedPostalSupplySaleResult {
  state: ServiceWorkspaceState
  sale: PostalSupplySale
}

export interface SettledServiceResult {
  state: ServiceWorkspaceState
  settlement: SettlementRecord
}

export interface RevisedServiceResult {
  state: ServiceWorkspaceState
  transaction: ServiceTransaction
  correction: ServiceCorrectionRecord
}

export interface WithdrawnServiceResult {
  state: ServiceWorkspaceState
  withdrawals: ServiceWithdrawalRecord[]
  refunds: ServiceRefundRecord[]
}

export interface ServiceDocumentActionResult {
  state: ServiceWorkspaceState
  action: ServiceDocumentAction
}

export interface BulkBatchResult {
  state: ServiceWorkspaceState
  batch: BulkBatch
}

export interface SelfServiceImportResult {
  state: ServiceWorkspaceState
  batch: SelfServiceImportBatch
}

export interface ServiceRepository {
  load(): Promise<ServiceWorkspaceState>
  saveDraft(draft: ServiceDraft): Promise<ServiceWorkspaceState>
  accept(request: AcceptServiceRequest): Promise<AcceptedServiceResult>
  acceptPostalSupplySale(
    request: AcceptPostalSupplySaleRequest,
  ): Promise<AcceptedPostalSupplySaleResult>
  acceptChannelProductOrder(
    request: AcceptChannelProductOrderRequest,
  ): Promise<AcceptedChannelProductOrderResult>
  recordChannelProductReceiptPrint(
    request: RecordChannelProductReceiptPrintRequest,
  ): Promise<ChannelProductOrderResult>
  deleteChannelProductOrders(
    request: DeleteChannelProductOrdersRequest,
  ): Promise<DeletedChannelProductOrdersResult>
  acceptSupplementaryTraffic(
    request: AcceptSupplementaryTrafficRequest,
  ): Promise<AcceptedSupplementaryTrafficResult>
  acceptElectronicCommerce(
    request: AcceptElectronicCommerceRequest,
  ): Promise<AcceptedElectronicCommerceResult>
  settle(request: SettleServiceRequest): Promise<SettledServiceResult>
  revise(request: ReviseServiceRequest): Promise<RevisedServiceResult>
  withdraw(request: WithdrawServiceRequest): Promise<WithdrawnServiceResult>
  recordDocumentAction(
    request: RecordServiceDocumentActionRequest,
  ): Promise<ServiceDocumentActionResult>
  recordInvoiceDecision(
    settlementId: string,
    requested: boolean,
  ): Promise<ServiceWorkspaceState>
  recordReturnReceiptArrival(
    request: RecordReturnReceiptArrivalRequest,
  ): Promise<ReturnReceiptResult>
  dispatchReturnReceipt(
    request: DispatchReturnReceiptRequest,
  ): Promise<ReturnReceiptResult>
  requestThirdPartyRefund(
    request: RequestThirdPartyRefundRequest,
  ): Promise<ThirdPartyRefundResult>
  completeThirdPartyRefund(
    request: CompleteThirdPartyRefundRequest,
  ): Promise<ThirdPartyRefundResult>
  acceptReplyCouponRedemption(
    request: AcceptReplyCouponRedemptionRequest,
  ): Promise<ReplyCouponRedemptionResult>
  reviseReplyCouponRedemption(
    request: ReviseReplyCouponRedemptionRequest,
  ): Promise<ReplyCouponRedemptionResult>
  settleReplyCouponRedemption(
    request: SettleReplyCouponRedemptionRequest,
  ): Promise<SettledReplyCouponRedemptionResult>
  withdrawReplyCouponRedemption(
    request: WithdrawReplyCouponRedemptionRequest,
  ): Promise<ReplyCouponRedemptionResult>
  importBulkBatch(request: ImportBulkBatchRequest): Promise<BulkBatchResult>
  settleBulkBatch(batchId: string, settledAt: string): Promise<BulkBatchResult>
  recordBulkDocumentPrompt(
    request: RecordBulkDocumentPromptRequest,
  ): Promise<BulkBatchResult>
  recordBulkMailLabelPrint(
    request: RecordBulkMailLabelPrintRequest,
  ): Promise<BulkBatchResult>
  recordBulkInvoiceChoice(
    batchId: string,
    requested: boolean,
  ): Promise<BulkBatchResult>
  registerBulkInvoice(request: RegisterBulkInvoiceRequest): Promise<BulkBatchResult>
  recordBulkInvoiceDelivery(
    request: RecordBulkInvoiceDeliveryRequest,
  ): Promise<BulkBatchResult>
  deleteBulkBatch(batchId: string): Promise<ServiceWorkspaceState>
  sealBulkBatch(request: SealBulkBatchRequest): Promise<BulkBatchResult>
  recordBulkSealTagDecision(
    request: RecordBulkSealTagDecisionRequest,
  ): Promise<BulkBatchResult>
  querySelfServiceReservation(reservationNumber: string): Promise<SelfServiceReservation>
  importSelfServiceReservation(
    request: ImportSelfServiceReservationRequest,
  ): Promise<SelfServiceImportResult>
  settleSelfServiceImport(
    batchId: string,
    settledAt: string,
  ): Promise<SelfServiceImportResult>
  deleteSelfServiceImport(batchId: string): Promise<ServiceWorkspaceState>
  executeMailDispatch(command: MailDispatchCommand): Promise<MailDispatchResult>
  executeMailSealing(command: MailSealingCommand): Promise<MailSealingResult>
  executeDispatchBagHandover(
    command: DispatchBagHandoverCommand,
  ): Promise<DispatchBagHandoverResult>
  executeDispatchRouting(
    command: DispatchRoutingCommand,
  ): Promise<DispatchRoutingResult>
  executeDispatchBalanceReturn(
    command: DispatchBalanceReturnCommand,
  ): Promise<DispatchBalanceReturnResult>
  executePostageMeter(command: PostageMeterCommand): Promise<PostageMeterResult>
  executeSpecialHandling(
    command: SpecialHandlingCommand,
  ): Promise<SpecialHandlingResult>
  executeWindowDelivery(
    command: WindowDeliveryCommand,
  ): Promise<WindowDeliveryResult>
  executePostalSupplyManagement(
    command: PostalSupplyManagementCommand,
  ): Promise<PostalSupplyManagementResult>
  executePointsInventory(
    command: PointsInventoryCommand,
  ): Promise<PointsInventoryResult>
  executeCounterCorrection(
    command: CounterCorrectionCommand,
  ): Promise<CounterCorrectionResult>
  executeInvoiceManagement(
    command: InvoiceManagementCommand,
  ): Promise<InvoiceManagementResult>
  executeSpotCheckExercise(
    command: SpotCheckExerciseCommand,
  ): Promise<SpotCheckExerciseResult>
  executePersonalRemittance(
    command: PersonalRemittanceCommand,
  ): Promise<PersonalRemittanceResult>
  executeInstitutionAccounting(
    command: InstitutionAccountingCommand,
  ): Promise<InstitutionAccountingResult>
  restore(state: ServiceWorkspaceState): Promise<ServiceWorkspaceState>
  reset(): Promise<ServiceWorkspaceState>
}
