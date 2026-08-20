import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import {
  ignoreIndexedDbIssue,
  reportIndexedDbIssue,
  type IndexedDbIssueReporter,
} from './IndexedDbAvailability'

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
import { migrateRetiredStateDatabase } from './legacyDatabaseMigration'

const STATE_KEY = 'current'

interface ServiceDatabase extends DBSchema {
  state: {
    key: typeof STATE_KEY
    value: unknown
  }
}

export class IndexedDbServiceRepository implements ServiceRepository {
  private readonly databasePromise: Promise<IDBPDatabase<ServiceDatabase>>
  private database: IDBPDatabase<ServiceDatabase> | null = null

  constructor(
    databaseName = 'local-delivery-training-services-v2',
    reportIssue: IndexedDbIssueReporter = ignoreIndexedDbIssue,
  ) {
    const migration = databaseName === 'local-delivery-training-services-v2'
      ? migrateRetiredStateDatabase(databaseName, '-simulator-services-v2')
      : Promise.resolve()
    this.databasePromise = migration.catch(() => undefined).then(() => openDB<ServiceDatabase>(databaseName, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('state')) {
          database.createObjectStore('state')
        }
      },
      blocked: () => reportIndexedDbIssue(
        reportIssue,
        '业务与交割数据',
        'blocked',
      ),
      blocking: () => {
        reportIndexedDbIssue(reportIssue, '业务与交割数据', 'blocking')
        this.database?.close()
        this.database = null
      },
      terminated: () => {
        reportIndexedDbIssue(reportIssue, '业务与交割数据', 'terminated')
        this.database = null
      },
    })).then((database) => {
      this.database = database
      return database
    }).catch((error: unknown) => {
      reportIndexedDbIssue(reportIssue, '业务与交割数据', 'unavailable', error)
      throw error
    })
  }

  private async mutate<TResult>(
    operation: (current: ServiceWorkspaceState) => {
      state: ServiceWorkspaceState
      result: TResult
    },
  ): Promise<TResult> {
    const database = await this.databasePromise
    const transaction = database.transaction('state', 'readwrite')
    try {
      const stored = await transaction.store.get(STATE_KEY)
      const current = stored === undefined
        ? createServiceSeedState()
        : migrateServiceWorkspaceState(stored)
      const mutation = operation(current)
      await transaction.store.put(mutation.state, STATE_KEY)
      await transaction.done
      return structuredClone(mutation.result)
    } catch (error) {
      try {
        transaction.abort()
      } catch {
        // The failed request may already have closed the transaction.
      }
      try {
        await transaction.done
      } catch {
        // Preserve the original domain or storage failure below.
      }
      throw error
    }
  }

  private mutateResult<TResult extends { state: ServiceWorkspaceState }>(
    operation: (current: ServiceWorkspaceState) => TResult,
  ): Promise<TResult> {
    return this.mutate((current) => {
      const result = operation(current)
      return { state: result.state, result }
    })
  }

  private mutateState(
    operation: (current: ServiceWorkspaceState) => ServiceWorkspaceState,
  ): Promise<ServiceWorkspaceState> {
    return this.mutate((current) => {
      const state = operation(current)
      return { state, result: state }
    })
  }

  private async replace(state: ServiceWorkspaceState): Promise<ServiceWorkspaceState> {
    const database = await this.databasePromise
    const transaction = database.transaction('state', 'readwrite')
    await transaction.store.put(state, STATE_KEY)
    await transaction.done
    return structuredClone(state)
  }

  async load(): Promise<ServiceWorkspaceState> {
    return this.mutateState((current) => current)
  }

  async saveDraft(draft: ServiceDraft): Promise<ServiceWorkspaceState> {
    return this.mutateState((current) => ({
      ...current,
      draft: structuredClone(draft),
    }))
  }

  async accept(request: AcceptServiceRequest): Promise<AcceptedServiceResult> {
    return this.mutateResult((current) => acceptServiceTransaction(current, request))
  }

  async acceptPostalSupplySale(
    request: AcceptPostalSupplySaleRequest,
  ): Promise<AcceptedPostalSupplySaleResult> {
    return this.mutateResult((current) => acceptPostalSupplySale(current, request))
  }

  async acceptChannelProductOrder(request: AcceptChannelProductOrderRequest) {
    return this.mutateResult((current) => acceptChannelProductOrder(current, request))
  }

  async recordChannelProductReceiptPrint(
    request: RecordChannelProductReceiptPrintRequest,
  ) {
    return this.mutateResult((current) => recordChannelProductReceiptPrint(current, request))
  }

  async deleteChannelProductOrders(request: DeleteChannelProductOrdersRequest) {
    return this.mutateResult((current) => deleteChannelProductOrders(current, request))
  }

  async acceptSupplementaryTraffic(request: AcceptSupplementaryTrafficRequest) {
    return this.mutateResult((current) => acceptSupplementaryTraffic(current, request))
  }

  async acceptElectronicCommerce(request: AcceptElectronicCommerceRequest) {
    return this.mutateResult((current) => acceptElectronicCommerce(current, request))
  }

  async settle(request: SettleServiceRequest): Promise<SettledServiceResult> {
    return this.mutateResult((current) => settleServiceTransactions(current, request))
  }

  async revise(request: ReviseServiceRequest): Promise<RevisedServiceResult> {
    return this.mutateResult((current) => reviseServiceTransaction(current, request))
  }

  async withdraw(request: WithdrawServiceRequest): Promise<WithdrawnServiceResult> {
    return this.mutateResult((current) => withdrawServiceTransactions(current, request))
  }

  async recordDocumentAction(
    request: RecordServiceDocumentActionRequest,
  ): Promise<ServiceDocumentActionResult> {
    return this.mutateResult((current) => recordServiceDocumentAction(current, request))
  }

  async recordInvoiceDecision(
    settlementId: string,
    requested: boolean,
  ): Promise<ServiceWorkspaceState> {
    return this.mutateState((current) => (
      recordInvoiceDecision(current, settlementId, requested)
    ))
  }

  async recordReturnReceiptArrival(
    request: RecordReturnReceiptArrivalRequest,
  ): Promise<ReturnReceiptResult> {
    return this.mutateResult((current) => recordReturnReceiptArrival(current, request))
  }

  async dispatchReturnReceipt(
    request: DispatchReturnReceiptRequest,
  ): Promise<ReturnReceiptResult> {
    return this.mutateResult((current) => dispatchReturnReceipt(current, request))
  }

  async requestThirdPartyRefund(
    request: RequestThirdPartyRefundRequest,
  ): Promise<ThirdPartyRefundResult> {
    return this.mutateResult((current) => requestThirdPartyRefund(current, request))
  }

  async completeThirdPartyRefund(
    request: CompleteThirdPartyRefundRequest,
  ): Promise<ThirdPartyRefundResult> {
    return this.mutateResult((current) => completeThirdPartyRefund(current, request))
  }

  async acceptReplyCouponRedemption(
    request: AcceptReplyCouponRedemptionRequest,
  ) {
    return this.mutateResult((current) => acceptReplyCouponRedemption(current, request))
  }

  async reviseReplyCouponRedemption(
    request: ReviseReplyCouponRedemptionRequest,
  ) {
    return this.mutateResult((current) => reviseReplyCouponRedemption(current, request))
  }

  async settleReplyCouponRedemption(
    request: SettleReplyCouponRedemptionRequest,
  ) {
    return this.mutateResult((current) => settleReplyCouponRedemption(current, request))
  }

  async withdrawReplyCouponRedemption(
    request: WithdrawReplyCouponRedemptionRequest,
  ) {
    return this.mutateResult((current) => withdrawReplyCouponRedemption(current, request))
  }

  async importBulkBatch(request: ImportBulkBatchRequest) {
    return this.mutateResult((current) => importBulkBatch(current, request))
  }

  async settleBulkBatch(batchId: string, settledAt: string) {
    return this.mutateResult((current) => settleBulkBatch(current, batchId, settledAt))
  }

  async recordBulkDocumentPrompt(request: RecordBulkDocumentPromptRequest) {
    return this.mutateResult((current) => recordBulkDocumentPrompt(current, request))
  }

  async recordBulkMailLabelPrint(request: RecordBulkMailLabelPrintRequest) {
    return this.mutateResult((current) => recordBulkMailLabelPrint(current, request))
  }

  async recordBulkInvoiceChoice(batchId: string, requested: boolean) {
    return this.mutateResult((current) => (
      recordBulkInvoiceChoice(current, batchId, requested)
    ))
  }

  async registerBulkInvoice(request: RegisterBulkInvoiceRequest) {
    return this.mutateResult((current) => registerBulkInvoice(current, request))
  }

  async recordBulkInvoiceDelivery(request: RecordBulkInvoiceDeliveryRequest) {
    return this.mutateResult((current) => recordBulkInvoiceDelivery(current, request))
  }

  async deleteBulkBatch(batchId: string): Promise<ServiceWorkspaceState> {
    return this.mutateState((current) => deleteBulkBatch(current, batchId))
  }

  async sealBulkBatch(request: SealBulkBatchRequest) {
    return this.mutateResult((current) => sealBulkBatch(current, request))
  }

  async recordBulkSealTagDecision(request: RecordBulkSealTagDecisionRequest) {
    return this.mutateResult((current) => recordBulkSealTagDecision(current, request))
  }

  async querySelfServiceReservation(reservationNumber: string) {
    return querySelfServiceReservation(reservationNumber)
  }

  async importSelfServiceReservation(request: ImportSelfServiceReservationRequest) {
    return this.mutateResult((current) => importSelfServiceReservation(current, request))
  }

  async settleSelfServiceImport(batchId: string, settledAt: string) {
    return this.mutateResult((current) => (
      settleSelfServiceImport(current, batchId, settledAt)
    ))
  }

  async deleteSelfServiceImport(batchId: string): Promise<ServiceWorkspaceState> {
    return this.mutateState((current) => deleteSelfServiceImport(current, batchId))
  }

  async executeMailDispatch(command: MailDispatchCommand) {
    return this.mutateResult((current) => executeMailDispatchCommand(current, command))
  }

  async executeMailSealing(command: MailSealingCommand) {
    return this.mutateResult((current) => executeMailSealingCommand(current, command))
  }

  async executeDispatchBagHandover(command: DispatchBagHandoverCommand) {
    return this.mutateResult((current) => (
      executeDispatchBagHandoverCommand(current, command)
    ))
  }

  async executeDispatchRouting(command: DispatchRoutingCommand) {
    return this.mutateResult((current) => executeDispatchRoutingCommand(current, command))
  }

  async executeDispatchBalanceReturn(command: DispatchBalanceReturnCommand) {
    return this.mutateResult((current) => (
      executeDispatchBalanceReturnCommand(current, command)
    ))
  }

  async executePostageMeter(command: PostageMeterCommand) {
    return this.mutateResult((current) => executePostageMeterCommand(current, command))
  }

  async executeSpecialHandling(command: SpecialHandlingCommand) {
    return this.mutateResult((current) => executeSpecialHandlingCommand(current, command))
  }

  async executeWindowDelivery(command: WindowDeliveryCommand) {
    return this.mutateResult((current) => executeWindowDeliveryCommand(current, command))
  }

  async executePostalSupplyManagement(command: PostalSupplyManagementCommand) {
    return this.mutateResult((current) => (
      executePostalSupplyManagementCommand(current, command)
    ))
  }

  async executePointsInventory(command: PointsInventoryCommand) {
    return this.mutateResult((current) => executePointsInventoryCommand(current, command))
  }

  async executeCounterCorrection(command: CounterCorrectionCommand) {
    return this.mutateResult((current) => executeCounterCorrectionCommand(current, command))
  }

  async executeInvoiceManagement(command: InvoiceManagementCommand) {
    return this.mutateResult((current) => executeInvoiceManagementCommand(current, command))
  }

  async executeSpotCheckExercise(command: SpotCheckExerciseCommand) {
    return this.mutateResult((current) => executeSpotCheckExerciseCommand(current, command))
  }

  async executePersonalRemittance(command: PersonalRemittanceCommand) {
    return this.mutateResult((current) => executePersonalRemittanceCommand(current, command))
  }

  async executeInstitutionAccounting(command: InstitutionAccountingCommand) {
    return this.mutateResult((current) => (
      executeInstitutionAccountingCommand(current, command)
    ))
  }

  async restore(state: ServiceWorkspaceState): Promise<ServiceWorkspaceState> {
    return this.replace(migrateServiceWorkspaceState(state))
  }

  async reset(): Promise<ServiceWorkspaceState> {
    return this.replace(createServiceSeedState())
  }

  async close(): Promise<void> {
    const database = await this.databasePromise
    database.close()
    this.database = null
  }
}
