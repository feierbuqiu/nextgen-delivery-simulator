import type {
  DestinationRegion,
  IdentityType,
  ProductFamily,
  RecipientProfile,
  SenderProfile,
} from '../customer/types'
import type { OnSiteAuthorization } from '../access/workAuthorization'

export type ServiceProductId =
  | 'ordinary-letter-100'
  | 'barcode-letter-107'
  | 'barcode-printed-matter-117'
  | 'ordinary-postcard-120'
  | 'registered-letter-200'
  | 'registered-printed-matter-210'
  | 'registered-postcard-220'
  | `catalog-${string}`
export type ServiceDestinationZone =
  | ''
  | 'local'
  | 'nonlocal'
  | 'international'
  | 'special-free-trade-port'
  | 'special-mirror-sea-port'
  | 'special-beautiful-island'
export type ServicePaymentMethod =
  | 'cash-settlement'
  | 'stamp'
  | 'self-affixed'
  | 'credit'
export type ServiceRemark =
  | 'ordinary-letter'
  | 'postcard'
  | 'people-letter'
  | 'parcel-4'
  | 'parcel-6'
  | 'parcel-11'
  | 'document'
  | 'goods'
export type ParcelTariffZone =
  | ''
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
export type SettlementTender = 'cash' | 'third-party' | 'pos' | 'credit'
export type ServiceTransactionSource =
  | 'counter'
  | 'self-service-import'
  | 'appointment'
export type ServiceAppointmentSource =
  | 'online-reservation'
  | 'parcel-partner'
  | 'delivery-platform'
  | 'express-channel'
  | 'customer-self-service'
export type ServiceTransactionStatus =
  | 'pending-settlement'
  | 'settled'
  | 'withdrawn'
export type ServiceDocumentActionKind = 'receipt-reprint' | 'invoice-reissue'
export type ServiceRefundRoute =
  | 'cash-desk'
  | 'original-payment'
  | 'pos-terminal'
  | 'credit-account'
export type ServiceRefundStatus =
  | 'application-required'
  | 'pending'
  | 'refunded'
  | 'failed'
export type BulkNumberAllocation = 'automatic' | 'manual'
export type BulkPrintRequirement = 'normal' | 'all' | 'none'
export type BulkRowStatus = 'success' | 'failed'
export type BulkSettlementStatus = 'unsettled' | 'settled'
export type BulkDocumentKind =
  | 'bulk-mailing-list'
  | 'consolidated-posting-summary'
export type BulkInvoiceBuyerType = 'organization' | 'individual'
export type FiscalInvoiceStatus = 'issued' | 'red-flushed'
export type FiscalInvoiceSourceKind = 'settlement' | 'bulk'
export type ReturnReceiptStatus =
  | 'awaiting-return'
  | 'received'
  | 'returned'
  | 'cancelled'
export type ReplyCouponCatalogKind = 'communication-ticket' | 'postal-card'
export type ReplyCouponRedemptionStatus =
  | 'pending-settlement'
  | 'settled'
  | 'withdrawn'
export type ReplyCouponPaymentPlatform =
  | 'platform-a'
  | 'platform-b'
  | 'union-qr'
  | 'digital-payment'
  | 'generic-third-party'

export interface ServiceProduct {
  id: ServiceProductId
  label: string
  searchCode: string
  parentCode: string
  parentLabel: string
  productFamily: ProductFamily
  destinationZones: ServiceDestinationZone[]
  tariffKind:
    | 'domestic-letter'
    | 'domestic-postcard'
    | 'domestic-printed-matter'
    | 'mailgram'
    | 'blind-mail'
    | 'conscript-mail'
    | 'small-packet'
    | 'printed-matter-bag'
    | 'return-card'
    | 'ordinary-parcel'
    | 'fixed-parcel-sticker'
    | 'platform-parcel'
    | 'platform-express'
  pricingBasis:
    | 'public-standard'
    | 'agreement-baseline'
    | 'channel-baseline'
  itemCodeRule:
    | 'none'
    | 'seven-prefix-13-digits'
    | 'registered-by-zone'
    | 'parcel-by-zone'
    | 'express-by-zone'
    | 'standard-express-13'
  remarkOptions: ServiceRemark[]
  requiresRecipient: boolean
  requiresAgreement: boolean
  domesticRegistrationFeeCents: number
  internationalRegistrationFeeCents: number
  additionalServiceFeeCents: number
  maxWeightGrams: number
}

export interface ServiceProductCatalogItem {
  code: string
  label: string
  productId: ServiceProductId
}

export interface PostalSupplyItem {
  id: string
  label: string
  mnemonic: string
  unit: string
  unitPriceCents: number
  stock: number
  primaryCategory: string
  secondaryCategory: string
  replyCouponCatalog?: ReplyCouponCatalogKind
}

export interface PostalSupplyDraftLine {
  itemId: string
  quantity: number
}

export interface PostalSupplySaleLine {
  itemId: string
  label: string
  mnemonic: string
  unit: string
  unitPriceCents: number
  quantity: number
  amountCents: number
}

export interface PostalSupplySaleRevisionLine {
  itemId: string
  label: string
  previousQuantity: number
  nextQuantity: number
  previousAmountCents: number
  nextAmountCents: number
}

export interface PostalSupplySaleRevision {
  id: string
  revisedAt: string
  revisedBy: ServiceOperatorSnapshot
  reason: string
  lines: PostalSupplySaleRevisionLine[]
  previousTotalCents: number
  nextTotalCents: number
}

export interface PostalSupplySale {
  id: string
  status: 'pending-settlement' | 'settled' | 'deleted'
  acceptedAt: string
  operator: ServiceOperatorSnapshot
  sender: SenderProfile
  lines: PostalSupplySaleLine[]
  totalCents: number
  settlementId: string | null
  revisions?: PostalSupplySaleRevision[]
  deletedAt?: string | null
  deletedBy?: ServiceOperatorSnapshot | null
  deletionReason?: string | null
  receiptPrintedAt?: string[]
}

export type PostalSupplyDocumentKind =
  | 'inbound'
  | 'requisition'
  | 'institution-return'
  | 'employee-issue'
  | 'employee-return'
  | 'inventory-count'

export type PostalSupplyDocumentStatus =
  | 'saved'
  | 'pending-approval'
  | 'approved'
  | 'rejected'
  | 'received'
  | 'deleted'

export interface PostalSupplyInventoryBalance {
  itemId: string
  superiorQuantity: number
  institutionQuantity: number
  employeeQuantities: Record<string, number>
}

export interface PostalSupplyDocumentLine {
  itemId: string
  label: string
  mnemonic: string
  unit: string
  unitPriceCents: number
  requestedQuantity: number
  actualQuantity: number
  amountCents: number
}

export interface PostalSupplyDocument {
  id: string
  kind: PostalSupplyDocumentKind
  status: PostalSupplyDocumentStatus
  institutionCode: string
  institutionName: string
  superiorInstitutionCode: string
  superiorInstitutionName: string
  employeeId: string | null
  employeeName: string | null
  createdAt: string
  createdBy: ServiceOperatorSnapshot
  updatedAt: string
  approvedAt: string | null
  approvedBy: ServiceOperatorSnapshot | null
  rejectedAt: string | null
  rejectedBy: ServiceOperatorSnapshot | null
  receivedAt: string | null
  receivedBy: ServiceOperatorSnapshot | null
  deletedAt: string | null
  lines: PostalSupplyDocumentLine[]
}

export interface PointsProductInventoryItem {
  id: string
  productNumber: string
  barcode: string
  name: string
  exchangeOffice: string
  quantity: number
}

export type PointsInventoryMovementKind = 'inbound' | 'outbound'

export interface PointsInventoryMovement {
  id: string
  productId: string
  productNumber: string
  barcode: string
  productName: string
  kind: PointsInventoryMovementKind
  quantity: number
  balanceBefore: number
  balanceAfter: number
  operatedAt: string
  operator: ServiceOperatorSnapshot
  syncTarget: '外部积分平台（模拟）'
  syncStatus: 'acknowledged'
}

export type ChannelProductCategory = '出售品' | '特色商品' | '营销用品'
export type ChannelProductFulfillmentKind = 'delivery' | 'pickup'
export type ChannelProductSalesType = 'offline' | 'online'

export interface ChannelProductSku {
  code: string
  label: string
  unitPriceCents: number
  stock: number
  inventoryControlled: boolean
}

export interface ChannelProductCatalogItem {
  id: string
  label: string
  barcode: string
  category: ChannelProductCategory
  secondaryCategory: string
  unit: string
  description: string
  accent: string
  skus: ChannelProductSku[]
}

export interface ChannelProductOrderDraftLine {
  productId: string
  skuCode: string
  quantity: number
}

export interface ChannelProductAllocationLine {
  productId: string
  skuCode: string
  quantity: number
}

export interface ChannelProductDeliveryProfile {
  contact: string
  name: string
  postalCode: string
  detailedAddress: string
}

export interface ChannelProductPickupProfile {
  contact: string
  name: string
  identityType: string
  identityValue: string
  gender: string
  pickupOfficeCode: string
  pickupOfficeName: string
}

export interface ChannelProductAllocation {
  id: string
  kind: ChannelProductFulfillmentKind
  recipient: ChannelProductDeliveryProfile | null
  pickup: ChannelProductPickupProfile | null
  lines: ChannelProductAllocationLine[]
}

export interface ChannelProductOrderLine {
  productId: string
  productLabel: string
  barcode: string
  category: ChannelProductCategory
  skuCode: string
  skuLabel: string
  unit: string
  unitPriceCents: number
  quantity: number
  amountCents: number
}

export interface ChannelProductOrder {
  id: string
  status: 'pending-settlement' | 'settled' | 'deleted'
  salesType: ChannelProductSalesType
  submittedAt: string
  operator: ServiceOperatorSnapshot
  buyer: SenderProfile
  lines: ChannelProductOrderLine[]
  allocations: ChannelProductAllocation[]
  totalQuantity: number
  totalCents: number
  settlementId: string | null
  deletedAt: string | null
  deletedBy: string | null
  receiptPrintedAt: string[]
}

export type SupplementaryTrafficKind =
  | 'supplementary-income'
  | 'traffic-bulk-mail'
  | 'single-journey-payment'
  | 'round-trip-return'
export type SupplementaryCustomerKind = 'retail' | 'agreement'
export type SupplementaryAcceptanceMethod = 'counter'
export type TrafficMailRemark = 'single-document' | 'round-trip-document'

export interface TrafficMailSnapshot {
  productSearchCode: '405'
  productLabel: '交管专项特快'
  effectiveBusinessCode: '405000' | '405100'
  destinationZone: 'local' | 'nonlocal'
  mailNumber: string
  recipientName: string
  recipientTelephone: string
  recipientMobile: string
  recipientAddress: string
  recipientPostalCode: string
  remark: TrafficMailRemark
  weightGrams: number
}

interface SupplementaryTrafficRecordBase {
  id: string
  kind: SupplementaryTrafficKind
  status: 'pending-settlement' | 'settled' | 'deleted' | 'adjusted'
  acceptedAt: string
  operator: ServiceOperatorSnapshot
  customerKind: SupplementaryCustomerKind
  customerName: string
  agreementAccountId: string
  paymentMethod: ServicePaymentMethod
  amountCents: number
  settlementId: string | null
  corrections?: SupplementaryTrafficCorrection[]
  replacesRecordId?: string | null
  replacementRecordId?: string | null
  deletedAt?: string | null
  deletedBy?: ServiceOperatorSnapshot | null
  deletionReason?: string | null
}

export interface SupplementaryTrafficCorrection {
  id: string
  correctedAt: string
  correctedBy: ServiceOperatorSnapshot
  reason: string
  mode: 'same-day-reentry' | 'cross-day-adjustment'
  previousAmountCents: number
  nextAmountCents: number
  previousCount: number | null
  nextCount: number | null
  replacementRecordId: string
}

export interface SupplementaryIncomeRecord
  extends SupplementaryTrafficRecordBase {
  kind: 'supplementary-income'
  subjectCategoryCode: string
  subjectCategoryLabel: string
  subjectCode: string
  subjectLabel: string
  count: number
  acceptanceMethod: SupplementaryAcceptanceMethod
  creditAllowed: boolean
  bulkAllowed: boolean
}

export interface TrafficBulkMailRecord
  extends SupplementaryTrafficRecordBase {
  kind: 'traffic-bulk-mail'
  mail: TrafficMailSnapshot
  productionFeeCents: number
  totalPostageCents: number
}

export interface SingleJourneyPaymentRecord
  extends SupplementaryTrafficRecordBase {
  kind: 'single-journey-payment'
  mail: TrafficMailSnapshot
  collectOnDeliveryCents: number
  productionFeeCents: number
}

export interface RoundTripReturnRecord
  extends SupplementaryTrafficRecordBase {
  kind: 'round-trip-return'
  mail: TrafficMailSnapshot
  productionFeeCents: number
  quotedPostageCents: number
}

export type SupplementaryTrafficRecord =
  | SupplementaryIncomeRecord
  | TrafficBulkMailRecord
  | SingleJourneyPaymentRecord
  | RoundTripReturnRecord

export type ElectronicCommerceKind = 'utility-payment' | 'phone-topup'
export type ElectronicCommerceProjectId =
  | 'water'
  | 'electricity'
  | 'gas'
  | 'cable-tv'
  | 'broadband'
  | 'mobile'
  | 'landline'

interface ElectronicCommerceRecordBase {
  id: string
  kind: ElectronicCommerceKind
  status: 'pending-settlement' | 'settled'
  acceptedAt: string
  operator: ServiceOperatorSnapshot
  projectId: ElectronicCommerceProjectId
  projectLabel: string
  providerId: string
  providerLabel: string
  accountNumber: string
  customerName: string
  customerAddress: string
  paymentMethod: 'cash-settlement'
  amountCents: number
  settlementId: string | null
}

export interface UtilityPaymentRecord extends ElectronicCommerceRecordBase {
  kind: 'utility-payment'
  projectId: Exclude<ElectronicCommerceProjectId, 'mobile' | 'landline'>
  dueAmountCents: number
  accountBalanceBeforeCents: null
}

export interface PhoneTopupRecord extends ElectronicCommerceRecordBase {
  kind: 'phone-topup'
  projectId: Extract<ElectronicCommerceProjectId, 'mobile' | 'landline'>
  dueAmountCents: null
  accountBalanceBeforeCents: number
}

export type ElectronicCommerceRecord = UtilityPaymentRecord | PhoneTopupRecord

export interface ReplyCouponRedemptionLine {
  itemId: string
  label: string
  productCode: string
  unit: string
  unitPriceCents: number
  quantity: number
  amountCents: number
  catalogKind: ReplyCouponCatalogKind
}

export interface ReplyCouponRedemption {
  id: string
  status: ReplyCouponRedemptionStatus
  acceptedAt: string
  updatedAt: string
  operator: ServiceOperatorSnapshot
  couponCount: number
  couponUnitValueCents: 700
  couponMaximumCents: number
  lines: ReplyCouponRedemptionLine[]
  itemCount: number
  merchandiseTotalCents: number
  discountCents: number
  amountDueCents: number
  settlementId: string | null
  settledAt: string | null
  tender: Exclude<SettlementTender, 'credit'> | null
  amountReceivedCents: number
  changeCents: number
  paymentPlatform: ReplyCouponPaymentPlatform | null
  paymentCodeMasked: string
  withdrawnAt: string | null
}

export interface ServiceProductGroup {
  code: string
  label: string
  productFamily: ProductFamily
  items: ServiceProductCatalogItem[]
}

export interface ServiceAppointmentSnapshot {
  source: ServiceAppointmentSource
  sourceLabel: string
  orderNumber: string
  discountCents: number
  mailInformationLocked: boolean
  labelAlreadyPrinted: boolean
  retrievedAt: string
}

export interface ServiceDraft {
  productId: ServiceProductId | null
  destinationZone: ServiceDestinationZone
  destinationOffice: string
  itemCode: string
  remark: ServiceRemark
  weightGrams: number | null
  quantity: number
  paymentMethod: ServicePaymentMethod
  stampAmountCents: number | null
  packaging: string
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
  declaredValueCents: number | null
  insuranceValueCents: number | null
  contents: string
  contentItems: PostalSupplySaleLine[]
  postcardBarcode: string
  parcelTariffZone: ParcelTariffZone
  platformQuoteCents: number | null
  returnReceiptRequested: boolean
  appointment: ServiceAppointmentSnapshot | null
  operatorNote: string
  updatedAt: string
}

export interface ChargeSummary {
  baseWeightCents: number
  additionalWeightCents: number
  returnReceiptCents: number
  discountCents?: number
  postageCents: number
  stampSaleCents: number
  settlementDueCents: number
  totalCents: number
}

export interface ServiceCustomerSnapshot {
  productFamily: ProductFamily
  destinationRegion: DestinationRegion
  sender: SenderProfile
  recipient: RecipientProfile
}

export interface ServiceProductSnapshot {
  id: ServiceProductId
  label: string
  searchCode: string
  effectiveBusinessCode: string
}

export interface ServiceOperatorSnapshot {
  operatorId: string
  displayName: string
  workstationCode: string
  acceptanceOffice: string
  receivingOffice: string
  institutionCode?: string
}

export interface ServiceTransaction {
  id: string
  source: ServiceTransactionSource
  sourceBatchId: string | null
  sourceOrderNumber: string | null
  status: ServiceTransactionStatus
  acceptedAt: string
  operator: ServiceOperatorSnapshot
  customer: ServiceCustomerSnapshot
  product: ServiceProductSnapshot
  service: ServiceDraft
  charge: ChargeSummary
  settlementId: string | null
}

export type LooseMailHandoverScope = 'internal' | 'cross-office'
export type LooseMailHandoverStatus = 'handed-over' | 'received' | 'returned'

export interface LooseMailHandoverRecord {
  id: string
  transactionId: string
  scope: LooseMailHandoverScope
  status: LooseMailHandoverStatus
  originOfficeCode?: string
  receivingOfficeCode: string
  receivingOfficeName: string
  receivingEmployeeId: string
  receivingEmployeeName: string
  directSeal: boolean
  note: string
  handedOverAt: string
  handedOverBy: ServiceOperatorSnapshot
  receivedAt: string | null
  receivedBy: ServiceOperatorSnapshot | null
  returnedAt: string | null
  returnedBy: ServiceOperatorSnapshot | null
  returnNote: string
}

export type DispatchMailReference =
  | { kind: 'transaction'; transactionId: string }
  | { kind: 'bulk-row'; batchId: string; rowIndex: number }

export type DispatchTagPrintDecision = 'printed' | 'skipped' | null
export type DispatchBagSealingStatus = 'sealed' | 'cancelled'
export type DispatchBagSealingMode = 'standard' | 'loose-outbound' | 'sorting'
export type DispatchBagHandoverStatus =
  | 'handed-over'
  | 'received'
  | 'withdrawn'
  | 'returned'
export type DispatchBagShift = '01' | '02' | '03'

export interface DispatchRelationOverride {
  key: string
  institutionCode: string
  productId: string
  productSearchCode: string
  productLabel: string
  destinationZone: ServiceDestinationZone
  bulk: boolean
  manifestTypeCode: string
  manifestTypeName: string
  bagBarcodeTypeCode: string
  bagBarcodeTypeName: string
  receivingOfficeCode: string
  receivingOfficeName: string
  routeCode: string
  directSeal: boolean
  consolidation: boolean
  localTransfer: boolean
  updatedAt: string
  updatedBy: ServiceOperatorSnapshot
}

export interface DispatchBagRecord {
  id: string
  bagBarcode: string
  originOfficeCode?: string
  /** Defaults to standard for workspaces created before the specialized sealing flows. */
  sealingMode?: DispatchBagSealingMode
  manifestTypeCode: string
  manifestTypeName: string
  bagBarcodeTypeCode: string
  bagBarcodeTypeName: string
  receivingOfficeCode: string
  receivingOfficeName: string
  directSeal: boolean
  consolidation: boolean
  localTransfer: boolean
  manifestNumber: string
  receptacleType: '1.袋'
  usesBarcodeContainer: boolean
  containerBarcode: string
  rfidBagTagNumber: string
  shift: DispatchBagShift
  mailReferences: DispatchMailReference[]
  totalItems: number
  mailWeightGrams: number
  emptyBagWeightGrams: number
  generatedAt: string
  generatedBy: ServiceOperatorSnapshot
  tagPrintDecision: DispatchTagPrintDecision
  tagPrintedAt: string | null
  sealingStatus: DispatchBagSealingStatus
  cancelledAt: string | null
  cancelledBy: ServiceOperatorSnapshot | null
}

export interface DispatchBagHandoverRecord {
  id: string
  bagId: string
  status: DispatchBagHandoverStatus
  originOfficeCode: string
  originOfficeName: string
  receivingOfficeCode: string
  receivingOfficeName: string
  handedOverAt: string
  handedOverBy: ServiceOperatorSnapshot
  receivedAt: string | null
  receivedBy: ServiceOperatorSnapshot | null
  receiptShift: DispatchBagShift | null
  shiftTransferredAt: string | null
  shiftTransferredBy: ServiceOperatorSnapshot | null
  withdrawnAt: string | null
  withdrawnBy: ServiceOperatorSnapshot | null
  returnedAt: string | null
  returnedBy: ServiceOperatorSnapshot | null
}

export type DispatchBagChangeKind =
  | 'manifest-number-changed'
  | 'mail-membership-changed'
  | 'shift-transferred'
  | 'sealing-cancelled'

export interface DispatchBagChangeRecord {
  id: string
  bagId: string
  kind: DispatchBagChangeKind
  changedAt: string
  changedBy: ServiceOperatorSnapshot
  previousManifestNumber: string | null
  newManifestNumber: string | null
  addedMailReferences: DispatchMailReference[]
  removedMailReferences: DispatchMailReference[]
  previousShift: DispatchBagShift | null
  newShift: DispatchBagShift | null
}

export interface DispatchBagInterchangeReturnRecord {
  id: string
  bagId: string
  bagBarcode: string
  previousRouteId: string
  previousRouteNumber: string
  previousRouteCode: string
  previousRouteName: string
  previousExportedAt: string
  previousExportedBy: ServiceOperatorSnapshot | null
  previousGeneratedAt: string
  previousGeneratedBy: ServiceOperatorSnapshot
  previousShift: DispatchBagShift
  previousMailReferences: DispatchMailReference[]
  previousTotalItems: number
  previousMailWeightGrams: number
  previousEmptyBagWeightGrams: number
  keptMailReferences: DispatchMailReference[]
  removedMailReferences: DispatchMailReference[]
  emptyBagWeightGrams: number
  bagTotalWeightGrams: number
  mailWeightGrams: number
  totalItems: number
  shift: DispatchBagShift
  returnedAt: string
  returnedBy: ServiceOperatorSnapshot
}

export type DispatchRouteKind =
  | 'route'
  | 'master-route'
  | 'manual-route'
  | 'container-return'

export interface DispatchContainerReturnLine {
  containerTypeCode: string
  containerTypeName: string
  containerModelCode: string
  containerModelName: string
  inventoryQuantity: number
  clearanceQuantity: number
}

export interface DispatchRouteRecord {
  id: string
  kind: DispatchRouteKind
  routeCode: string
  routeName: string
  routeNumber: string
  childRouteIds: string[]
  manifestTypeCode: string
  manifestTypeName: string
  manifestNumbers: string[]
  shift: DispatchBagShift
  sealingDate: string
  directSeal: boolean
  localTransfer: boolean
  receivingOfficeCode: string
  receivingOfficeName: string
  bagIds: string[]
  totalBags: number
  totalItems: number
  totalWeightGrams: number
  receptacleType: string
  usesBarcodeContainer: boolean
  containerTypeCode: string
  containerTypeName: string
  containerModelCode: string
  containerModelName: string
  containerBarcodes: string[]
  containerReturnLines: DispatchContainerReturnLine[]
  source: 'automatic' | 'manual'
  generatedAt: string
  generatedBy: ServiceOperatorSnapshot
  catchupReceiptDate: string | null
  catchupReceivedAt: string | null
  catchupReceivedBy: ServiceOperatorSnapshot | null
  dispatchOrderNumber: string
  exportAuthorizedBy: string | null
  exportAuthorizedAt: string | null
  exportedAt: string | null
  exportedBy: ServiceOperatorSnapshot | null
  deletedAt: string | null
  deletedBy: ServiceOperatorSnapshot | null
}

export type DispatchPrintDocumentType =
  | 'manifest'
  | 'route'
  | 'master-route'
  | 'bag-tag'
  | 'receipt-bag-tag'
  | 'address-bag-tag'
  | 'premade-bag-tag'

export interface DispatchPrintRecord {
  id: string
  documentType: DispatchPrintDocumentType
  targetId: string
  printedAt: string
  printedBy: ServiceOperatorSnapshot
  weightGrams: number | null
  remark: string
}

export type PostageMeterNetworkMode = 'direct' | 'indirect'
export type PostageMeterValidity = 'valid' | 'invalid'
export type PostageMeterReportStatus = 'enabled' | 'disabled'
export type PostageMeterTerminalPort = '1' | '2' | '3'

export interface PostageMeterDevice {
  id: string
  name: string
  meterHeadNumber: string
  baseNumber: string
  validity: PostageMeterValidity
  counterCode: string
  networkMode: PostageMeterNetworkMode
  terminalPort: PostageMeterTerminalPort
  reportStatus: PostageMeterReportStatus
  totalPostageCents: number
  remainingPostageCents: number
  cumulativeImprintCount: number
  cumulativePostageCents: number
  updatedAt: string
}

export interface PostageMeterBatchItem {
  transactionId: string
  querySerial: string
  agreementAccountId: string
  agreementAccountName: string
  productName: string
  itemNumber: string
  quantity: number
  expectedPostageCents: number
  acceptanceOffice: string
  acceptedAt: string
}

export type PostageMeterBatchStatus = 'pending' | 'registered' | 'balanced'

export interface PostageMeterBatch {
  id: string
  batchNumber: string
  createdAt: string
  createdBy: ServiceOperatorSnapshot
  items: PostageMeterBatchItem[]
  expectedItemCount: number
  expectedPostageCents: number
  actualItemCount: number
  actualPostageCents: number
  cancelledItemCount: number
  cancelledPostageCents: number
  status: PostageMeterBatchStatus
  discrepancyReason: string
}

export interface PostageMeterRegistration {
  id: string
  batchId: string
  batchNumber: string
  deviceId: string
  registeredAt: string
  registeredBy: ServiceOperatorSnapshot
  startCount: number
  endCount: number
  cancelledCount: number
  startAmountCents: number
  endAmountCents: number
  cancelledAmountCents: number
  actualItemCount: number
  actualPostageCents: number
}

export interface PostageMeterDailyBalance {
  id: string
  institutionCode: string
  institutionName: string
  statisticDate: string
  deviceId: string
  expectedItemCount: number
  expectedPostageCents: number
  actualItemCount: number
  actualPostageCents: number
  cancelledItemCount: number
  cancelledPostageCents: number
  differenceItemCount: number
  differencePostageCents: number
  generatedAt: string
  uploadedAt: string | null
  uploadedBy: ServiceOperatorSnapshot | null
}

export type PostageMeterMailHandoverStatus =
  | 'pending-receipt'
  | 'received'
  | 'return-requested'
  | 'returned'

export interface PostageMeterMailHandover {
  id: string
  handoverNumber: string
  items: PostageMeterBatchItem[]
  expectedItemCount: number
  expectedPostageCents: number
  sourceInstitutionCode: string
  sourceInstitutionName: string
  targetInstitutionCode: string
  targetInstitutionName: string
  sourceCounterCode: string
  handedOverAt: string
  handedOverBy: ServiceOperatorSnapshot
  status: PostageMeterMailHandoverStatus
  receivedAt: string | null
  receivedBy: ServiceOperatorSnapshot | null
  returnRequestedAt: string | null
  returnRequestedBy: ServiceOperatorSnapshot | null
  returnedAt: string | null
  returnedBy: ServiceOperatorSnapshot | null
}

export type PostageMeterFundingStatus = 'pending-external-approval'

export interface PostageMeterFundingRequest {
  id: string
  requestNumber: string
  deviceId: string
  amountCents: number
  status: PostageMeterFundingStatus
  requestedAt: string
  requestedBy: ServiceOperatorSnapshot
}

export type PostageMeterRepairMatter = 'repair' | 'enable'
export type PostageMeterRepairStatus = 'submitted' | 'activated'

export interface PostageMeterRepairRequest {
  id: string
  requestNumber: string
  deviceId: string
  matter: PostageMeterRepairMatter
  status: PostageMeterRepairStatus
  requestedAt: string
  requestedBy: ServiceOperatorSnapshot
  activatedAt: string | null
  activatedBy: ServiceOperatorSnapshot | null
}

export interface PostageMeterDeviceHandoverHistory {
  id: string
  deviceId: string
  sourceInstitutionName: string
  sourceEmployeeName: string
  receivingInstitutionName: string
  receivingEmployeeName: string
  operatedAt: string
}

export type SpecialHandlingKind = 'withdrawal' | 'redirect'
export type SpecialHandlingTender = 'cash' | 'pos' | 'third-party'
export type SpecialHandlingUploadStatus =
  | 'not-uploaded'
  | 'succeeded'
  | 'failed'
export type SpecialHandlingRefundStatus = 'none' | 'pending' | 'refunded'

export interface SpecialHandlingApplication {
  id: string
  transactionId: string
  kind: SpecialHandlingKind
  mailItemCode: string
  applicantName: string
  applicantPhone: string
  applicantIdentityType: Exclude<IdentityType, ''>
  applicantIdentityNumber: string
  recipientName: string
  recipientPhone: string
  recipientAddress: string
  redirectedAddress: string
  redirectedPostalCode: string
  redirectedDestinationOffice: string
  reason: string
  feeCents: number
  quoteSource: 'simulated-delivery-interface'
  quotedAt: string
  createdAt: string
  createdBy: ServiceOperatorSnapshot
  settlementTender: SpecialHandlingTender | null
  settledAt: string | null
  uploadStatus: SpecialHandlingUploadStatus
  uploadAttempts: number
  uploadedAt: string | null
  uploadFailureReason: string
  cancelledAt: string | null
  cancelledBy: ServiceOperatorSnapshot | null
  refundStatus: SpecialHandlingRefundStatus
  refundedAt: string | null
  refundedBy: ServiceOperatorSnapshot | null
}

export type WindowDeliverySource =
  | 'import-bag'
  | 'supplement'
  | 'delivery-return'
  | 'delivery-to-window'
export type WindowDeliveryStatus =
  | 'pending-receipt'
  | 'stored'
  | 'transferred'
  | 'overdue-returned'
  | 'cancelled'
  | 'deleted'
export type WindowDeliveryTender = 'cash' | 'pos' | 'third-party'
export type WindowDeliveryReminderStage = 'none' | 'first' | 'second' | 'overdue'
export type WindowDeliveryPrintKind =
  | 'pickup-notice'
  | 'first-reminder-list'
  | 'second-reminder-list'
  | 'overdue-return-list'
  | 'query-list'

export interface WindowDeliveryMoney {
  taxCents: number
  inspectionCents: number
  returnPostageCents: number
  redirectedReturnPostageCents: number
  underpaidPostageCents: number
  underpaidHandlingCents: number
  storageWaitCents: number
  extensionServiceCents: number
  codPaymentCents: number
  insuranceValueCents: number
  insuranceFeeCents: number
  insuredAmountCents: number
}

export interface WindowDeliveryTransferInfo {
  transferFlag: 'return'
  destinationProvince: string
  destinationCity: string
  destinationCounty: string
  destinationPostcode: string
  destinationOffice: string
  recipientName: string
  recipientPhone: string
  recipientAddress: string
  reason: string
}

export interface WindowDeliveryCancellationInfo {
  claimantName: string
  claimantIdentityType: Exclude<IdentityType, ''>
  claimantIdentityNumber: string
  agentName: string
  agentIdentityType: Exclude<IdentityType, ''> | null
  agentIdentityNumber: string
  tender: WindowDeliveryTender
}

export interface WindowDeliveryItem {
  id: string
  source: WindowDeliverySource
  bagId: string | null
  dispatchListNumber: string
  productCode: string
  productName: string
  itemCode: string
  sendingOffice: string
  receivingOffice: string
  destinationOffice: string
  senderName: string
  senderPhone: string
  senderAddress: string
  recipientName: string
  recipientMobile: string
  recipientPhone: string
  recipientAddress: string
  mailNote: string
  nonStandard: boolean
  pieces: number
  innerPieces: number
  weightGrams: number
  postingDate: string
  receivedAt: string | null
  receivedBy: ServiceOperatorSnapshot | null
  specialSequence: number
  money: WindowDeliveryMoney
  status: WindowDeliveryStatus
  processedAt: string | null
  processedBy: ServiceOperatorSnapshot | null
  transfer: WindowDeliveryTransferInfo | null
  cancellation: WindowDeliveryCancellationInfo | null
  reminderStage: WindowDeliveryReminderStage
  firstReminderAt: string | null
  secondReminderAt: string | null
  overdueAt: string | null
  deletedAt: string | null
  printHistory: Array<{ kind: WindowDeliveryPrintKind; printedAt: string }>
}

export interface WindowDeliveryBag {
  id: string
  bagCode: string
  dispatchListNumber: string
  routeCode: string
  postingDate: string
  itemIds: string[]
  receivedAt: string | null
  receivedBy: ServiceOperatorSnapshot | null
  unboundAt: string | null
}

export interface WindowDeliverySequenceStart {
  productCode: string
  productName: string
  startNumber: number
}

export interface WindowDeliveryAuditRecord {
  id: string
  itemId: string | null
  bagId: string | null
  kind: string
  detail: string
  operatedAt: string
  operatedBy: ServiceOperatorSnapshot
}

export interface ServiceCorrectionRecord {
  id: string
  transactionId: string
  correctedAt: string
  correctedBy?: ServiceOperatorSnapshot
  reason: string
  previousCustomer: ServiceCustomerSnapshot
  correctedCustomer: ServiceCustomerSnapshot
  previousService: ServiceDraft
  correctedService: ServiceDraft
  previousCharge: ChargeSummary
  correctedCharge: ChargeSummary
}

export interface ServiceWithdrawalRecord {
  id: string
  transactionId: string
  withdrawnAt: string
  withdrawnBy?: ServiceOperatorSnapshot
  reason: string
  authorizedBy: string
}

export interface ServiceRefundRecord {
  id: string
  transactionId: string
  settlementId: string
  createdAt: string
  amountCents: number
  originalTender: SettlementTender
  route: ServiceRefundRoute
  status: ServiceRefundStatus
  requestedAt: string | null
  requestedBy: ServiceOperatorSnapshot | null
  processedAt: string | null
  processedBy: ServiceOperatorSnapshot | null
  platformRefundId: string
  failureReason: string
}

export interface ServiceDocumentAction {
  id: string
  transactionId: string
  kind: ServiceDocumentActionKind
  requestedAt: string
}

export interface ReturnReceiptRecord {
  id: string
  transactionId: string
  originalItemCode: string
  requestedAt: string
  feeCents: number
  status: ReturnReceiptStatus
  recipientSigner: string
  deliveredAt: string | null
  receivedAt: string | null
  receivedBy: ServiceOperatorSnapshot | null
  returnItemCode: string
  returnedAt: string | null
  returnedBy: ServiceOperatorSnapshot | null
  note: string
}

export interface SettlementRecord {
  id: string
  transactionIds: string[]
  tender: SettlementTender
  settledAt: string
  amountDueCents: number
  amountReceivedCents: number
  changeCents: number
  invoiceRequested: boolean | null
}

export type PersonalRemittanceStatus = 'generated' | 'confirmed' | 'cancelled'

export interface PersonalRemittanceCategory {
  code: string
  label: string
  count: number
  amountCents: number
}

export interface PersonalRemittanceRecord {
  id: string
  workDate: string
  workstationCode: string
  operator: ServiceOperatorSnapshot
  institutionCode: string
  institutionName: string
  status: PersonalRemittanceStatus
  categories: PersonalRemittanceCategory[]
  settlementIds: string[]
  sourceReferences: string[]
  ignoredPendingReferences: string[]
  totalCount: number
  totalAmountCents: number
  cashAmountCents: number
  posAmountCents: number
  thirdPartyAmountCents: number
  creditAmountCents: number
  generatedAt: string
  confirmedAt: string | null
  confirmedBy: ServiceOperatorSnapshot | null
  cancelledAt: string | null
  cancelledBy: ServiceOperatorSnapshot | null
  cancelReason: string
  printHistory: string[]
}

export type InstitutionRemittanceStatus = 'generated' | 'confirmed' | 'cancelled'

export interface InstitutionRemittanceRecord {
  id: string
  workDate: string
  institutionCode: string
  institutionName: string
  status: InstitutionRemittanceStatus
  categories: PersonalRemittanceCategory[]
  personalRemittanceIds: string[]
  sourceReferences: string[]
  totalCount: number
  totalAmountCents: number
  cashAmountCents: number
  posAmountCents: number
  thirdPartyAmountCents: number
  creditAmountCents: number
  generatedAt: string
  generatedBy: ServiceOperatorSnapshot
  confirmedAt: string | null
  confirmedBy: ServiceOperatorSnapshot | null
  cancelledAt: string | null
  cancelledBy: ServiceOperatorSnapshot | null
  cancelReason: string
  linkedBankDepositSlipIds: string[]
  printHistory: string[]
}

export type BankDepositSlipStatus = 'active' | 'cancelled'
export type BankDepositSlipSource = 'institution-remittance' | 'manual'

export interface BankDepositSlipDetail {
  reference: string
  categoryCode: string
  categoryLabel: string
  count: number
  amountCents: number
  settledAt: string
}

export interface BankDepositSlipRecord {
  id: string
  workDate: string
  institutionCode: string
  institutionName: string
  source: BankDepositSlipSource
  institutionRemittanceId: string | null
  status: BankDepositSlipStatus
  rangeStart: string
  rangeEnd: string
  details: BankDepositSlipDetail[]
  sourceReferences: string[]
  totalAmountCents: number
  generatedAt: string
  generatedBy: ServiceOperatorSnapshot
  cancelledAt: string | null
  cancelledBy: ServiceOperatorSnapshot | null
  cancelReason: string
  printHistory: string[]
}

export type BusinessReportScope = 'personal' | 'institution'
export type BusinessReportPeriod = 'daily' | 'monthly'

export interface BusinessReportCategory {
  code: string
  label: string
  count: number
  amountCents: number
  taxCents: number
  grossAmountCents: number
}

export interface BusinessReportPrintRecord {
  id: string
  scope: BusinessReportScope
  period: BusinessReportPeriod
  startDate: string
  endDate: string
  institutionCode: string
  institutionName: string
  operatorId: string | null
  operatorName: string
  workstationCode: string
  categories: BusinessReportCategory[]
  totalCount: number
  totalAmountCents: number
  totalTaxCents: number
  totalGrossAmountCents: number
  printedAt: string
  printedBy: ServiceOperatorSnapshot
}

export interface BulkTemplateRow {
  recordSequence: string
  customerSequence: string
  itemCode: string
  destinationPostcode: string
  destinationOfficeName: string
  recipientName: string
  recipientAddress: string
  recipientPhone: string
  weightGrams: string
  unitWeightGrams: string
  mailRemark: string
  contents: string
  contentsEnglish: string
  countryEnglish: string
  stateEnglish: string
  cityEnglish: string
  senderNameEnglish: string
  senderProvinceEnglish: string
  senderCityEnglish: string
  senderAddressEnglish: string
  senderPhone: string
  contentsTypeCode: string
  unitPriceUsd: string
  agreementAccountId: string
  dispatchFlag: string
  affixedPostage: string
}

export interface BulkProcessedRow extends BulkTemplateRow {
  status: BulkRowStatus
  failureReason: string
  allocatedItemCode: string
  destinationZone: ServiceDestinationZone
  effectiveBusinessCode: string
  resolvedWeightGrams: number | null
  postageCents: number
  settlementDueCents: number
}

export interface BulkSealRecord {
  sealedAt: string
  dispatchShift: string
  receptacleType: string
  itemsPerBag: number
  /** 旧版记录没有总包关联；新直封记录必须落入统一封发状态链。 */
  bagIds?: string[]
  bagBarcodes?: string[]
  tagPrintDecision?: DispatchTagPrintDecision
  tagPrintedAt?: string | null
}

export interface BulkMailLabelPrintRecord {
  printedAt: string
  fromSequence: number
  toSequence: number
  detailSheet: boolean
}

export interface BulkDocumentPrintRecord {
  kind: BulkDocumentKind
  printedAt: string
  fromSequence: number
  toSequence: number
}

export interface BulkInvoiceRegistration {
  buyerType: BulkInvoiceBuyerType
  buyerName: string
  taxpayerId: string
  deliveryPhone: string
  buyerPhone: string
  deliveryEmail: string
  buyerAddress: string
  bankName: string
  bankAccount: string
  reviewer: string
  remark: string
  issuedAt: string
  deliveryRequested: boolean | null
  deliveredAt: string | null
}

export interface FiscalInvoiceBusinessLine {
  sourceTransactionId: string
  productName: string
  itemCode: string
  paymentMethod: string
  itemName: string
  quantity: number
  amountCents: number
  stampAmountCents: number
}

export interface FiscalInvoiceRecord {
  id: string
  sourceKind: FiscalInvoiceSourceKind
  sourceId: string
  invoiceCode: string
  invoiceNumber: string
  issuedAt: string
  issuedBy: ServiceOperatorSnapshot
  buyerType: BulkInvoiceBuyerType
  buyerName: string
  taxpayerId: string
  deliveryPhone: string
  buyerPhone: string
  deliveryEmail: string
  buyerAddress: string
  bankName: string
  bankAccount: string
  reviewer: string
  remark: string
  deliveryRequested: boolean | null
  deliveredAt: string | null
  totalCents: number
  status: FiscalInvoiceStatus
  redFlushedAt: string | null
  redFlushedBy: ServiceOperatorSnapshot | null
  redFlushAuthorizedBy: string | null
  businessLines: FiscalInvoiceBusinessLine[]
}

export interface BulkBatch {
  id: string
  importedAt: string
  acceptanceDate: string
  sourceFileName: string
  product: ServiceProductSnapshot
  paymentMethod: ServicePaymentMethod
  printRequirement: BulkPrintRequirement
  numberAllocation: BulkNumberAllocation
  treatmentType: 'full-no-detail'
  agreementAccountId: string
  agreementAccountName: string
  commonRemarkLabel: string
  sender: SenderProfile
  operator: ServiceOperatorSnapshot
  rows: BulkProcessedRow[]
  totalCount: number
  successCount: number
  failedCount: number
  totalPostageCents: number
  totalSettlementDueCents: number
  progressPercent: number
  settlementStatus: BulkSettlementStatus
  settledAt: string | null
  bulkThreshold: number
  couponCount: number
  couponDiscountCents: number
  documentPromptCompletedAt: string | null
  documentPrintRecords: BulkDocumentPrintRecord[]
  /** 可选用于兼容第 37 版以前已持久化的大宗批次。 */
  mailLabelPrintRecords?: BulkMailLabelPrintRecord[]
  invoiceRequested: boolean | null
  invoiceRegistration: BulkInvoiceRegistration | null
  seal: BulkSealRecord | null
}

export type SelfServiceImportRowStatus = 'success' | 'failed'
export type SelfServiceImportStatus = 'processed'

export interface SelfServiceReservationItem {
  orderNumber: string
  productId: ServiceProductId
  itemCode: string
  destinationZone: Exclude<ServiceDestinationZone, ''>
  destinationProvince: string
  destinationCity: string
  destinationCounty: string
  destinationPostcode: string
  destinationOfficeName: string
  recipientName: string
  recipientAddress: string
  recipientPhone: string
  senderName: string
  senderAddress: string
  senderPhone: string
  weightGrams: number
  parcelTariffZone: ParcelTariffZone
  contents: string
}

export interface SelfServiceReservation {
  reservationNumber: string
  agreementAccountId: string
  agreementAccountName: string
  preacceptedAt: string
  items: SelfServiceReservationItem[]
}

export interface SelfServiceImportRow extends SelfServiceReservationItem {
  status: SelfServiceImportRowStatus
  failureReason: string
  transactionId: string | null
  effectiveBusinessCode: string
  postageCents: number
  updatedAt: string
}

export interface SelfServiceImportBatch {
  id: string
  reservationNumber: string
  importedAt: string
  status: SelfServiceImportStatus
  agreementAccountId: string
  agreementAccountName: string
  operator: ServiceOperatorSnapshot
  importOfficeCode: string
  importOfficeName: string
  rows: SelfServiceImportRow[]
  totalCount: number
  successCount: number
  failedCount: number
  totalSuccessfulAmountCents: number
  progressPercent: number
  settlementId: string | null
}

export interface AcceptServiceRequest {
  acceptedAt: string
  charge: ChargeSummary
  customer: ServiceCustomerSnapshot
  draft: ServiceDraft
  product: ServiceProduct
  operator?: ServiceOperatorSnapshot
}

export interface AcceptPostalSupplySaleRequest {
  acceptedAt: string
  sender: SenderProfile
  lines: PostalSupplyDraftLine[]
  operator?: ServiceOperatorSnapshot
}

export interface SettleServiceRequest {
  transactionIds: string[]
  tender: SettlementTender
  settledAt: string
  amountReceivedCents: number
}

export interface ReviseServiceRequest {
  transactionId: string
  correctedAt: string
  operator?: ServiceOperatorSnapshot
  reason: string
  customer: ServiceCustomerSnapshot
  draft: ServiceDraft
  charge: ChargeSummary
  product: ServiceProduct
}

export interface WithdrawServiceRequest {
  transactionIds: string[]
  withdrawnAt: string
  operator?: ServiceOperatorSnapshot
  reason: string
  authorization: OnSiteAuthorization
}

export interface RecordServiceDocumentActionRequest {
  transactionId: string
  kind: ServiceDocumentActionKind
  requestedAt: string
}

export type ServiceQueryDataType =
  | 'all'
  | 'pending-settlement'
  | 'settled'
  | 'withdrawn'

export type ServiceQuerySort = 'accepted-desc' | 'accepted-asc'

export interface ServiceTransactionQuery {
  querySerial: string
  productCode: string
  itemCode: string
  paymentMethod: ServicePaymentMethod | ''
  operatorId: string
  workstationCode: string
  dataType: ServiceQueryDataType
  acceptedDateFrom: string
  acceptedDateTo: string
  settledDateFrom: string
  settledDateTo: string
  sort: ServiceQuerySort
}

export type SpotCheckReceiptStatus = 'unsigned' | 'signed'
export type SpotCheckCompletionStatus = 'incomplete' | 'completed'

export interface SpotCheckExerciseRecord {
  id: string
  institutionCode: string
  institutionName: string
  employeeId: string
  employeeName: string
  inspectionType: '抽查演练'
  questionType: string
  questionNumber: string
  receiptStatus: SpotCheckReceiptStatus
  completionStatus: SpotCheckCompletionStatus
  inspectedAt: string
  signedAt: string | null
  signedBy: ServiceOperatorSnapshot | null
  completedAt: string | null
  completedBy: ServiceOperatorSnapshot | null
  answerValue: string | null
}

export interface ServiceWorkspaceState {
  schemaVersion: 38
  draft: ServiceDraft | null
  transactions: ServiceTransaction[]
  postalSupplySales: PostalSupplySale[]
  channelProductOrders: ChannelProductOrder[]
  supplementaryTrafficRecords: SupplementaryTrafficRecord[]
  electronicCommerceRecords: ElectronicCommerceRecord[]
  replyCouponRedemptions: ReplyCouponRedemption[]
  settlements: SettlementRecord[]
  personalRemittances: PersonalRemittanceRecord[]
  institutionRemittances: InstitutionRemittanceRecord[]
  bankDepositSlips: BankDepositSlipRecord[]
  businessReportPrints: BusinessReportPrintRecord[]
  corrections: ServiceCorrectionRecord[]
  withdrawals: ServiceWithdrawalRecord[]
  refunds: ServiceRefundRecord[]
  documentActions: ServiceDocumentAction[]
  fiscalInvoices: FiscalInvoiceRecord[]
  returnReceipts: ReturnReceiptRecord[]
  bulkBatches: BulkBatch[]
  selfServiceImports: SelfServiceImportBatch[]
  looseMailHandovers: LooseMailHandoverRecord[]
  dispatchRelationOverrides: DispatchRelationOverride[]
  dispatchBags: DispatchBagRecord[]
  dispatchBagHandovers: DispatchBagHandoverRecord[]
  dispatchBagChanges: DispatchBagChangeRecord[]
  dispatchBagInterchangeReturns: DispatchBagInterchangeReturnRecord[]
  dispatchRoutes: DispatchRouteRecord[]
  dispatchPrintRecords: DispatchPrintRecord[]
  postageMeterDevices: PostageMeterDevice[]
  postageMeterBatches: PostageMeterBatch[]
  postageMeterRegistrations: PostageMeterRegistration[]
  postageMeterDailyBalances: PostageMeterDailyBalance[]
  postageMeterMailHandovers: PostageMeterMailHandover[]
  postageMeterFundingRequests: PostageMeterFundingRequest[]
  postageMeterRepairRequests: PostageMeterRepairRequest[]
  postageMeterDeviceHandoverHistory: PostageMeterDeviceHandoverHistory[]
  specialHandlingApplications: SpecialHandlingApplication[]
  windowDeliveryBags: WindowDeliveryBag[]
  windowDeliveryItems: WindowDeliveryItem[]
  windowDeliverySequenceStarts: WindowDeliverySequenceStart[]
  windowDeliveryAudits: WindowDeliveryAuditRecord[]
  postalSupplyInventoryBalances: PostalSupplyInventoryBalance[]
  postalSupplyDocuments: PostalSupplyDocument[]
  pointsProductInventory: PointsProductInventoryItem[]
  pointsInventoryMovements: PointsInventoryMovement[]
  spotCheckExercises: SpotCheckExerciseRecord[]
  nextSequence: number
  nextPostalSupplySequence: number
  nextChannelProductSequence: number
  nextSupplementaryTrafficSequence: number
  nextElectronicCommerceSequence: number
  nextReplyCouponSequence: number
  nextSettlementSequence: number
  nextPersonalRemittanceSequence: number
  nextInstitutionRemittanceSequence: number
  nextBankDepositSequence: number
  nextBusinessReportPrintSequence: number
  nextCorrectionSequence: number
  nextWithdrawalSequence: number
  nextRefundSequence: number
  nextDocumentActionSequence: number
  nextFiscalInvoiceSequence: number
  nextReturnReceiptSequence: number
  nextBulkBatchSequence: number
  nextSelfServiceImportSequence: number
  nextLooseMailHandoverSequence: number
  nextDispatchBagSequence: number
  nextDispatchManifestSequence: number
  nextDispatchBagHandoverSequence: number
  nextDispatchBagChangeSequence: number
  nextDispatchBagInterchangeReturnSequence: number
  nextDispatchRouteSequence: number
  nextDispatchPrintSequence: number
  nextPostageMeterBatchSequence: number
  nextPostageMeterRegistrationSequence: number
  nextPostageMeterDailyBalanceSequence: number
  nextPostageMeterMailHandoverSequence: number
  nextPostageMeterFundingSequence: number
  nextPostageMeterRepairSequence: number
  nextSpecialHandlingSequence: number
  nextWindowDeliverySequence: number
  nextWindowDeliveryAuditSequence: number
  nextPostalSupplyDocumentSequence: number
  nextPointsInventoryMovementSequence: number
}
