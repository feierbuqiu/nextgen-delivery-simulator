import { effectiveBusinessCode, yuanToCents } from './policy'
import { sanitizePublicProductData } from '../desensitization/publicText'
import { reconcileKnownPostalAddressData } from '../customer/postalAdministrativeDirectory'
import { businessCalendarDay } from '../shared/businessTime'
import { createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import {
  serviceOperatorInstitutionCode,
} from './institutionScope'
import { reconcileServiceWorkspaceSequences } from './sequenceIntegrity'
import { DEFAULT_SERVICE_OPERATOR } from './transactions'
import type {
  BulkBatch,
  ChannelProductOrder,
  ChargeSummary,
  FiscalInvoiceRecord,
  ServiceDestinationZone,
  ServiceDraft,
  ServiceOperatorSnapshot,
  ServiceProduct,
  ServiceProductSnapshot,
  ServiceRefundRecord,
  ServiceTransaction,
  ServiceWorkspaceState,
} from './types'

type StoredDraft = Omit<
  ServiceDraft,
  'productId' | 'contentItems' | 'returnReceiptRequested' | 'appointment'
> & {
  productId: string | null
  contentItems?: ServiceDraft['contentItems']
  returnReceiptRequested?: boolean
  appointment?: ServiceDraft['appointment']
}

type StoredCharge = Omit<ChargeSummary, 'returnReceiptCents'> &
  Partial<Pick<ChargeSummary, 'returnReceiptCents'>>

type StoredProductSnapshot = Omit<
  ServiceProductSnapshot,
  'id' | 'effectiveBusinessCode'
> & {
  id: string
  effectiveBusinessCode?: string
}

type StoredTransaction = Omit<
  ServiceTransaction,
  | 'operator'
  | 'product'
  | 'service'
  | 'charge'
  | 'source'
  | 'sourceBatchId'
  | 'sourceOrderNumber'
> & {
  operator?: ServiceOperatorSnapshot
  product: StoredProductSnapshot
  service: StoredDraft
  charge: StoredCharge
  source?: ServiceTransaction['source']
  sourceBatchId?: string | null
  sourceOrderNumber?: string | null
}

type StoredWorkspace = Omit<
  Partial<ServiceWorkspaceState>,
  | 'schemaVersion'
  | 'draft'
  | 'transactions'
  | 'refunds'
  | 'bulkBatches'
  | 'channelProductOrders'
> & {
  schemaVersion?: number
  draft?: StoredDraft | null
  transactions?: StoredTransaction[]
  refunds?: StoredRefundRecord[]
  bulkBatches?: StoredBulkBatch[]
  channelProductOrders?: StoredChannelProductOrder[]
}

type StoredChannelProductOrder = Omit<
  ChannelProductOrder,
  'salesType' | 'deletedAt' | 'deletedBy' | 'receiptPrintedAt'
> & Partial<Pick<
  ChannelProductOrder,
  'salesType' | 'deletedAt' | 'deletedBy' | 'receiptPrintedAt'
>>

type StoredRefundRecord = Omit<
  ServiceRefundRecord,
  | 'status'
  | 'requestedAt'
  | 'requestedBy'
  | 'processedAt'
  | 'processedBy'
  | 'platformRefundId'
  | 'failureReason'
> & Partial<Pick<
  ServiceRefundRecord,
  | 'status'
  | 'requestedAt'
  | 'requestedBy'
  | 'processedAt'
  | 'processedBy'
  | 'platformRefundId'
  | 'failureReason'
>>

type StoredBulkBatch = Omit<
  BulkBatch,
  | 'bulkThreshold'
  | 'couponCount'
  | 'couponDiscountCents'
  | 'documentPromptCompletedAt'
  | 'documentPrintRecords'
  | 'invoiceRequested'
  | 'invoiceRegistration'
> & Partial<Pick<
  BulkBatch,
  | 'bulkThreshold'
  | 'couponCount'
  | 'couponDiscountCents'
  | 'documentPromptCompletedAt'
  | 'documentPrintRecords'
  | 'invoiceRequested'
  | 'invoiceRegistration'
>>

export const MIN_SERVICE_SCHEMA_VERSION = 2
export const CURRENT_SERVICE_SCHEMA_VERSION = 38

export function isSupportedServiceSchemaVersion(value: unknown): value is number {
  return Number.isInteger(value)
    && Number(value) >= MIN_SERVICE_SCHEMA_VERSION
    && Number(value) <= CURRENT_SERVICE_SCHEMA_VERSION
}

function sequence(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function productById(id: ServiceProduct['id']): ServiceProduct | null {
  return SERVICE_PRODUCTS.find((product) => product.id === id) ?? null
}

const RETIRED_CURRENT_PRODUCT_IDS = new Set(['catalog-106'])

function routeProduct(
  productId: string | null,
  searchCode: string | null,
  destinationZone: ServiceDestinationZone,
): ServiceProduct | null {
  if (!productId && !searchCode) return null

  // Preserve an already accepted 106 snapshot as history instead of silently
  // rewriting it to a different current product.
  if (productId && RETIRED_CURRENT_PRODUCT_IDS.has(productId)) return null

  const current = SERVICE_PRODUCTS.find((product) => product.id === productId)
  if (current) return current

  const legacyDomesticOrdinary = new Set([
    'barcode-letter-local-106000',
    'barcode-letter-nonlocal-107000',
    'barcode-letter-107',
    'ordinary-letter-local-100000',
    'ordinary-letter-nonlocal-100100',
    'ordinary-postcard-local-120000',
    'ordinary-postcard-nonlocal-120100',
  ])
  if (productId && legacyDomesticOrdinary.has(productId)) {
    return productById('barcode-letter-107')
  }

  const idMappings: Record<string, ServiceProduct['id']> = {
    'ordinary-letter-international-100200': 'ordinary-letter-100',
    'ordinary-postcard-international-120200': 'ordinary-postcard-120',
    'registered-letter-local-200000': 'registered-letter-200',
    'registered-letter-nonlocal-200100': 'registered-letter-200',
    'registered-letter-international-200200': 'registered-letter-200',
    'registered-letter-200': 'registered-letter-200',
    'registered-postcard-local-220000': 'registered-postcard-220',
    'registered-postcard-nonlocal-220100': 'registered-postcard-220',
    'registered-postcard-international-220200': 'registered-postcard-220',
    'registered-postcard-220': 'registered-postcard-220',
  }
  if (productId && idMappings[productId]) return productById(idMappings[productId])

  const code = (searchCode ?? '').replace(/\D/g, '').slice(0, 3)
  if ((code === '100' || code === '106' || code === '107' || code === '120') &&
    (destinationZone === 'local' || destinationZone === 'nonlocal')) {
    return productById('barcode-letter-107')
  }
  const codeMappings: Record<string, ServiceProduct['id']> = {
    '100': 'ordinary-letter-100',
    '107': 'barcode-letter-107',
    '117': 'barcode-printed-matter-117',
    '120': 'ordinary-postcard-120',
    '200': 'registered-letter-200',
    '210': 'registered-printed-matter-210',
    '220': 'registered-postcard-220',
  }
  return codeMappings[code] ? productById(codeMappings[code]) : null
}

function migrateDraft(
  stored: StoredDraft,
  preserveRetiredSelection = false,
): ServiceDraft {
  const isRetiredSelection = Boolean(
    stored.productId && RETIRED_CURRENT_PRODUCT_IDS.has(stored.productId),
  )
  const product = routeProduct(stored.productId, null, stored.destinationZone)
  const migrated = {
    ...structuredClone(stored),
    productId: isRetiredSelection && !preserveRetiredSelection
      ? null
      : product?.id ?? stored.productId,
    itemCode: isRetiredSelection && !preserveRetiredSelection
      ? ''
      : stored.itemCode,
    packaging: stored.packaging ?? '',
    lengthCm: stored.lengthCm ?? null,
    widthCm: stored.widthCm ?? null,
    heightCm: stored.heightCm ?? null,
    declaredValueCents: stored.declaredValueCents ?? null,
    insuranceValueCents: stored.insuranceValueCents ?? null,
    contents: stored.contents ?? '',
    contentItems: Array.isArray(stored.contentItems)
      ? structuredClone(stored.contentItems)
      : [],
    postcardBarcode: stored.postcardBarcode ?? '',
    parcelTariffZone: stored.parcelTariffZone ?? '',
    platformQuoteCents: stored.platformQuoteCents ?? null,
    returnReceiptRequested: stored.returnReceiptRequested ?? false,
    appointment: structuredClone(stored.appointment ?? null),
  }
  if (
    stored.productId === 'ordinary-postcard-local-120000' ||
    stored.productId === 'ordinary-postcard-nonlocal-120100'
  ) {
    migrated.remark = 'postcard'
  }
  return migrated as ServiceDraft
}

function migrateTransaction(stored: StoredTransaction): ServiceTransaction {
  const service = migrateDraft(stored.service, true)
  const product = routeProduct(
    stored.product.id,
    stored.product.searchCode,
    stored.service.destinationZone,
  )
  return {
    ...structuredClone(stored),
    source: stored.source ?? 'counter',
    sourceBatchId: stored.sourceBatchId ?? null,
    sourceOrderNumber: stored.sourceOrderNumber ?? null,
    operator: migrateServiceOperator(stored.operator),
    product: product
      ? {
          id: product.id,
          label: product.label,
          searchCode: product.searchCode,
          effectiveBusinessCode: effectiveBusinessCode(
            product,
            service.destinationZone,
          ),
        }
      : {
          ...structuredClone(stored.product) as ServiceProductSnapshot,
          effectiveBusinessCode:
            stored.product.effectiveBusinessCode ?? stored.product.searchCode,
        },
    service,
    charge: {
      ...structuredClone(stored.charge),
      returnReceiptCents: stored.charge.returnReceiptCents ?? 0,
      discountCents: stored.charge.discountCents ?? 0,
    },
  }
}

function migrateServiceOperator(
  stored: ServiceOperatorSnapshot | null | undefined,
): ServiceOperatorSnapshot {
  const operator = structuredClone(stored ?? DEFAULT_SERVICE_OPERATOR)
  return {
    ...operator,
    institutionCode: serviceOperatorInstitutionCode(operator),
  }
}

function migrateRefund(stored: StoredRefundRecord): ServiceRefundRecord {
  return {
    ...structuredClone(stored),
    status: stored.status ?? 'pending',
    requestedAt: stored.requestedAt === undefined
      ? stored.createdAt
      : stored.requestedAt,
    requestedBy: structuredClone(stored.requestedBy ?? null),
    processedAt: stored.processedAt ?? null,
    processedBy: structuredClone(stored.processedBy ?? null),
    platformRefundId: stored.platformRefundId ?? '',
    failureReason: stored.failureReason ?? '',
  }
}

function migrateChannelProductOrder(stored: StoredChannelProductOrder): ChannelProductOrder {
  return {
    ...structuredClone(stored),
    salesType: stored.salesType ?? 'offline',
    deletedAt: stored.deletedAt ?? null,
    deletedBy: stored.deletedBy ?? null,
    receiptPrintedAt: structuredClone(stored.receiptPrintedAt ?? []),
  }
}

function migrateFiscalInvoices(stored: StoredWorkspace): FiscalInvoiceRecord[] {
  const existing = structuredClone(stored.fiscalInvoices ?? [])
  if (existing.length > 0) {
    return existing.map((invoice) => ({
      ...invoice,
      redFlushAuthorizedBy: invoice.redFlushAuthorizedBy ?? null,
    }))
  }
  return (stored.bulkBatches ?? []).flatMap((batch, index): FiscalInvoiceRecord[] => {
    const registration = batch.invoiceRegistration
    if (!registration) return []
    const sequenceValue = index + 1
    return [{
      id: `FP-${businessCalendarDay(registration.issuedAt).replaceAll('-', '')}-${String(sequenceValue).padStart(6, '0')}`,
      sourceKind: 'bulk',
      sourceId: batch.id,
      invoiceCode: `SIM${registration.issuedAt.slice(2, 7).replaceAll('-', '')}`,
      invoiceNumber: String(sequenceValue).padStart(8, '0'),
      issuedAt: registration.issuedAt,
      issuedBy: structuredClone(batch.operator),
      buyerType: registration.buyerType,
      buyerName: registration.buyerName,
      taxpayerId: registration.taxpayerId,
      deliveryPhone: registration.deliveryPhone,
      buyerPhone: registration.buyerPhone,
      deliveryEmail: registration.deliveryEmail,
      buyerAddress: registration.buyerAddress,
      bankName: registration.bankName,
      bankAccount: registration.bankAccount,
      reviewer: registration.reviewer,
      remark: registration.remark,
      deliveryRequested: registration.deliveryRequested,
      deliveredAt: registration.deliveredAt,
      totalCents: Math.max(0, batch.totalSettlementDueCents - (batch.couponDiscountCents ?? 0)),
      status: 'issued',
      redFlushedAt: null,
      redFlushedBy: null,
      redFlushAuthorizedBy: null,
      businessLines: batch.rows.filter((row) => row.status === 'success').map((row) => ({
        sourceTransactionId: `${batch.id}:${row.recordSequence}`,
        productName: batch.product.label,
        itemCode: row.allocatedItemCode,
        paymentMethod: batch.paymentMethod === 'credit' ? '计欠' : '现结',
        itemName: row.contents || batch.commonRemarkLabel || batch.product.label,
        quantity: 1,
        amountCents: row.settlementDueCents,
        stampAmountCents: yuanToCents(row.affixedPostage || 0),
      })),
    }]
  })
}

export function migrateServiceWorkspaceState(value: unknown): ServiceWorkspaceState {
  if (value === undefined) return createServiceSeedState()
  if (value === null || typeof value !== 'object') {
    throw new Error('业务数据结构损坏，原数据未被改写。')
  }
  const stored = value as StoredWorkspace
  if (!isSupportedServiceSchemaVersion(stored.schemaVersion)) {
    const version = stored.schemaVersion === undefined ? '缺失' : String(stored.schemaVersion)
    throw new Error(`业务数据版本 ${version} 不受支持，原数据未被改写。`)
  }
  const seed = createServiceSeedState()
  const fiscalInvoices = migrateFiscalInvoices(stored)
  const sanitized = sanitizePublicProductData({
    schemaVersion: CURRENT_SERVICE_SCHEMA_VERSION,
    draft: stored.draft ? migrateDraft(stored.draft) : null,
    transactions: (stored.transactions ?? []).map(migrateTransaction),
    postalSupplySales: structuredClone(stored.postalSupplySales ?? []),
    channelProductOrders: (stored.channelProductOrders ?? []).map(migrateChannelProductOrder),
    supplementaryTrafficRecords: structuredClone(stored.supplementaryTrafficRecords ?? []),
    electronicCommerceRecords: structuredClone(stored.electronicCommerceRecords ?? []),
    replyCouponRedemptions: structuredClone(stored.replyCouponRedemptions ?? []),
    settlements: structuredClone(stored.settlements ?? []),
    personalRemittances: structuredClone(stored.personalRemittances ?? []),
    institutionRemittances: structuredClone(stored.institutionRemittances ?? []),
    bankDepositSlips: structuredClone(stored.bankDepositSlips ?? []),
    businessReportPrints: structuredClone(stored.businessReportPrints ?? []),
    corrections: structuredClone(stored.corrections ?? []),
    withdrawals: structuredClone(stored.withdrawals ?? []),
    refunds: (stored.refunds ?? []).map(migrateRefund),
    documentActions: structuredClone(stored.documentActions ?? []),
    fiscalInvoices,
    returnReceipts: structuredClone(stored.returnReceipts ?? []),
    bulkBatches: structuredClone(stored.bulkBatches ?? []).map((batch) => ({
      ...batch,
      operator: migrateServiceOperator(batch.operator),
      commonRemarkLabel: batch.commonRemarkLabel ?? '',
      bulkThreshold: batch.bulkThreshold ?? 5,
      couponCount: batch.couponCount ?? 0,
      couponDiscountCents: batch.couponDiscountCents ?? 0,
      documentPromptCompletedAt: batch.documentPromptCompletedAt === undefined
        ? (batch.settlementStatus === 'settled' ? batch.settledAt ?? batch.importedAt : null)
        : batch.documentPromptCompletedAt,
      documentPrintRecords: structuredClone(batch.documentPrintRecords ?? []),
      mailLabelPrintRecords: structuredClone(batch.mailLabelPrintRecords ?? []),
      invoiceRequested: batch.invoiceRequested === undefined
        ? (batch.settlementStatus === 'settled' ? false : null)
        : batch.invoiceRequested,
      invoiceRegistration: structuredClone(batch.invoiceRegistration ?? null),
    })),
    selfServiceImports: structuredClone(stored.selfServiceImports ?? []),
    looseMailHandovers: structuredClone(stored.looseMailHandovers ?? []).map((handover) => {
      const handedOverBy = migrateServiceOperator(handover.handedOverBy)
      return {
        ...handover,
        originOfficeCode: handover.originOfficeCode ?? handedOverBy.institutionCode,
        handedOverBy,
        receivedBy: handover.receivedBy ? migrateServiceOperator(handover.receivedBy) : null,
        returnedBy: handover.returnedBy ? migrateServiceOperator(handover.returnedBy) : null,
      }
    }),
    dispatchRelationOverrides: structuredClone(stored.dispatchRelationOverrides ?? [])
      .map((relation) => {
        const updatedBy = migrateServiceOperator(relation.updatedBy)
        const institutionCode = relation.institutionCode || updatedBy.institutionCode!
        return {
          ...relation,
          institutionCode,
          key: `${institutionCode}:${relation.productId}:${relation.destinationZone}:${relation.bulk ? 'bulk' : 'single'}`,
          updatedBy,
        }
      }),
    dispatchBags: structuredClone(stored.dispatchBags ?? []).map((bag) => {
      const generatedBy = migrateServiceOperator(bag.generatedBy)
      return {
        ...bag,
        originOfficeCode: bag.originOfficeCode ?? generatedBy.institutionCode,
        generatedBy,
        sealingMode: bag.sealingMode ?? 'standard',
        sealingStatus: bag.sealingStatus ?? 'sealed',
        cancelledAt: bag.cancelledAt ?? null,
        cancelledBy: bag.cancelledBy ? migrateServiceOperator(bag.cancelledBy) : null,
      }
    }),
    dispatchBagHandovers: structuredClone(stored.dispatchBagHandovers ?? []),
    dispatchBagChanges: structuredClone(stored.dispatchBagChanges ?? []),
    dispatchBagInterchangeReturns: structuredClone(
      stored.dispatchBagInterchangeReturns ?? [],
    ),
    dispatchRoutes: structuredClone(stored.dispatchRoutes ?? []).map((route) => ({
      ...route,
      generatedBy: migrateServiceOperator(route.generatedBy),
      catchupReceiptDate: route.catchupReceiptDate ?? null,
      catchupReceivedAt: route.catchupReceivedAt ?? null,
      catchupReceivedBy: route.catchupReceivedBy
        ? migrateServiceOperator(route.catchupReceivedBy)
        : null,
      dispatchOrderNumber: route.dispatchOrderNumber ?? '',
      exportAuthorizedBy: route.exportAuthorizedBy ?? null,
      exportAuthorizedAt: route.exportAuthorizedAt ?? null,
      exportedBy: route.exportedBy ? migrateServiceOperator(route.exportedBy) : null,
      deletedBy: route.deletedBy ? migrateServiceOperator(route.deletedBy) : null,
    })),
    dispatchPrintRecords: structuredClone(stored.dispatchPrintRecords ?? []).map((record) => ({
      ...record,
      printedBy: migrateServiceOperator(record.printedBy),
    })),
    postageMeterDevices: structuredClone(
      stored.postageMeterDevices ?? seed.postageMeterDevices,
    ),
    postageMeterBatches: structuredClone(stored.postageMeterBatches ?? []),
    postageMeterRegistrations: structuredClone(
      stored.postageMeterRegistrations ?? [],
    ),
    postageMeterDailyBalances: structuredClone(
      stored.postageMeterDailyBalances ?? [],
    ),
    postageMeterMailHandovers: structuredClone(
      stored.postageMeterMailHandovers ?? [],
    ),
    postageMeterFundingRequests: structuredClone(
      stored.postageMeterFundingRequests ?? [],
    ),
    postageMeterRepairRequests: structuredClone(
      stored.postageMeterRepairRequests ?? [],
    ),
    postageMeterDeviceHandoverHistory: structuredClone(
      stored.postageMeterDeviceHandoverHistory ?? seed.postageMeterDeviceHandoverHistory,
    ),
    specialHandlingApplications: structuredClone(
      stored.specialHandlingApplications ?? [],
    ),
    windowDeliveryBags: structuredClone(
      stored.windowDeliveryBags ?? seed.windowDeliveryBags,
    ),
    windowDeliveryItems: structuredClone(
      stored.windowDeliveryItems ?? seed.windowDeliveryItems,
    ),
    windowDeliverySequenceStarts: structuredClone(
      stored.windowDeliverySequenceStarts ?? seed.windowDeliverySequenceStarts,
    ),
    windowDeliveryAudits: structuredClone(stored.windowDeliveryAudits ?? []),
    postalSupplyInventoryBalances: structuredClone(
      stored.postalSupplyInventoryBalances ?? seed.postalSupplyInventoryBalances,
    ),
    postalSupplyDocuments: structuredClone(
      stored.postalSupplyDocuments ?? seed.postalSupplyDocuments,
    ),
    pointsProductInventory: structuredClone(
      stored.pointsProductInventory ?? seed.pointsProductInventory,
    ),
    pointsInventoryMovements: structuredClone(stored.pointsInventoryMovements ?? []),
    spotCheckExercises: structuredClone(
      stored.spotCheckExercises ?? seed.spotCheckExercises,
    ),
    nextSequence: sequence(stored.nextSequence, seed.nextSequence),
    nextPostalSupplySequence: sequence(
      stored.nextPostalSupplySequence,
      seed.nextPostalSupplySequence,
    ),
    nextChannelProductSequence: sequence(
      stored.nextChannelProductSequence,
      seed.nextChannelProductSequence,
    ),
    nextSupplementaryTrafficSequence: sequence(
      stored.nextSupplementaryTrafficSequence,
      seed.nextSupplementaryTrafficSequence,
    ),
    nextElectronicCommerceSequence: sequence(
      stored.nextElectronicCommerceSequence,
      seed.nextElectronicCommerceSequence,
    ),
    nextReplyCouponSequence: sequence(
      stored.nextReplyCouponSequence,
      seed.nextReplyCouponSequence,
    ),
    nextSettlementSequence: sequence(
      stored.nextSettlementSequence,
      seed.nextSettlementSequence,
    ),
    nextPersonalRemittanceSequence: sequence(
      stored.nextPersonalRemittanceSequence,
      seed.nextPersonalRemittanceSequence,
    ),
    nextInstitutionRemittanceSequence: sequence(
      stored.nextInstitutionRemittanceSequence,
      seed.nextInstitutionRemittanceSequence,
    ),
    nextBankDepositSequence: sequence(
      stored.nextBankDepositSequence,
      seed.nextBankDepositSequence,
    ),
    nextBusinessReportPrintSequence: sequence(
      stored.nextBusinessReportPrintSequence,
      seed.nextBusinessReportPrintSequence,
    ),
    nextCorrectionSequence: sequence(
      stored.nextCorrectionSequence,
      seed.nextCorrectionSequence,
    ),
    nextWithdrawalSequence: sequence(
      stored.nextWithdrawalSequence,
      seed.nextWithdrawalSequence,
    ),
    nextRefundSequence: sequence(stored.nextRefundSequence, seed.nextRefundSequence),
    nextDocumentActionSequence: sequence(
      stored.nextDocumentActionSequence,
      seed.nextDocumentActionSequence,
    ),
    nextFiscalInvoiceSequence: sequence(
      stored.nextFiscalInvoiceSequence,
      Math.max(seed.nextFiscalInvoiceSequence, fiscalInvoices.length + 1),
    ),
    nextReturnReceiptSequence: sequence(
      stored.nextReturnReceiptSequence,
      seed.nextReturnReceiptSequence,
    ),
    nextBulkBatchSequence: sequence(
      stored.nextBulkBatchSequence,
      seed.nextBulkBatchSequence,
    ),
    nextSelfServiceImportSequence: sequence(
      stored.nextSelfServiceImportSequence,
      seed.nextSelfServiceImportSequence,
    ),
    nextLooseMailHandoverSequence: sequence(
      stored.nextLooseMailHandoverSequence,
      seed.nextLooseMailHandoverSequence,
    ),
    nextDispatchBagSequence: sequence(
      stored.nextDispatchBagSequence,
      seed.nextDispatchBagSequence,
    ),
    nextDispatchManifestSequence: sequence(
      stored.nextDispatchManifestSequence,
      seed.nextDispatchManifestSequence,
    ),
    nextDispatchBagHandoverSequence: sequence(
      stored.nextDispatchBagHandoverSequence,
      seed.nextDispatchBagHandoverSequence,
    ),
    nextDispatchBagChangeSequence: sequence(
      stored.nextDispatchBagChangeSequence,
      seed.nextDispatchBagChangeSequence,
    ),
    nextDispatchBagInterchangeReturnSequence: sequence(
      stored.nextDispatchBagInterchangeReturnSequence,
      seed.nextDispatchBagInterchangeReturnSequence,
    ),
    nextDispatchRouteSequence: sequence(
      stored.nextDispatchRouteSequence,
      seed.nextDispatchRouteSequence,
    ),
    nextDispatchPrintSequence: sequence(
      stored.nextDispatchPrintSequence,
      seed.nextDispatchPrintSequence,
    ),
    nextPostageMeterBatchSequence: sequence(
      stored.nextPostageMeterBatchSequence,
      seed.nextPostageMeterBatchSequence,
    ),
    nextPostageMeterRegistrationSequence: sequence(
      stored.nextPostageMeterRegistrationSequence,
      seed.nextPostageMeterRegistrationSequence,
    ),
    nextPostageMeterDailyBalanceSequence: sequence(
      stored.nextPostageMeterDailyBalanceSequence,
      seed.nextPostageMeterDailyBalanceSequence,
    ),
    nextPostageMeterMailHandoverSequence: sequence(
      stored.nextPostageMeterMailHandoverSequence,
      seed.nextPostageMeterMailHandoverSequence,
    ),
    nextPostageMeterFundingSequence: sequence(
      stored.nextPostageMeterFundingSequence,
      seed.nextPostageMeterFundingSequence,
    ),
    nextPostageMeterRepairSequence: sequence(
      stored.nextPostageMeterRepairSequence,
      seed.nextPostageMeterRepairSequence,
    ),
    nextSpecialHandlingSequence: sequence(
      stored.nextSpecialHandlingSequence,
      seed.nextSpecialHandlingSequence,
    ),
    nextWindowDeliverySequence: sequence(
      stored.nextWindowDeliverySequence,
      seed.nextWindowDeliverySequence,
    ),
    nextWindowDeliveryAuditSequence: sequence(
      stored.nextWindowDeliveryAuditSequence,
      seed.nextWindowDeliveryAuditSequence,
    ),
    nextPostalSupplyDocumentSequence: sequence(
      stored.nextPostalSupplyDocumentSequence,
      seed.nextPostalSupplyDocumentSequence,
    ),
    nextPointsInventoryMovementSequence: sequence(
      stored.nextPointsInventoryMovementSequence,
      seed.nextPointsInventoryMovementSequence,
    ),
  } as ServiceWorkspaceState)
  return reconcileServiceWorkspaceSequences(
    reconcileKnownPostalAddressData(sanitized),
  )
}
