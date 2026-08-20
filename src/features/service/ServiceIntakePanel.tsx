import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { CustomerRepository } from '../../domain/customer/repository'
import type { CustomerDraft, CustomerWorkspaceState } from '../../domain/customer/types'
import { validateSender } from '../../domain/customer/policy'
import {
  calculateServiceCharge,
  destinationZoneLabel,
  formatCents,
  isDomesticBarcodeLetter,
  searchServiceProducts,
  serviceChargeableWeightGrams,
  serviceContentSummary,
  serviceItemCodeRule,
  serviceMaxWeightGrams,
  serviceRegistrationFeeCents,
  serviceRequiresPlatformQuote,
  serviceVolumeWeightGrams,
  usesPostcardTariff,
  validateServiceDraft,
  type ResolvedItemCodeRule,
  type ServiceErrors,
  type ServiceField,
} from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import { isRegisteredReceiptTransaction } from '../../domain/service/receipt'
import { returnReceiptEligibility } from '../../domain/service/returnReceipt'
import {
  pendingServiceSummary,
  remainingPostalSupplyStock,
  serviceContentStockError,
} from '../../domain/service/transactions'
import { INTERNATIONAL_DESTINATIONS } from '../../domain/service/international'
import type { ServiceRecommendationTransfer } from '../../domain/service/recommendation'
import type { AppointmentOrder } from '../../domain/service/appointmentCollection'
import {
  createEmptyServiceDraft,
  SERVICE_PRODUCT_GROUPS,
  SERVICE_PRODUCTS,
} from '../../domain/service/seed'
import type {
  ChargeSummary,
  PostalSupplyItem,
  PostalSupplySaleLine,
  ServiceDestinationZone,
  ServiceDraft,
  ServiceProduct,
  ServiceProductCatalogItem,
  ServiceTransaction,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { CurrencyInput } from '../../ui/CurrencyInput'
import { ServiceContentItemsModal } from './ServiceContentItemsModal'
import { ServiceReceiptModal } from './ServiceReceiptModal'
import { AppointmentCollectionModal } from './AppointmentCollectionModal'

interface ServiceSummary {
  count: number
  totalCents: number
}

const SERVICE_ZONE_OPTIONS: Array<{
  value: Exclude<ServiceDestinationZone, ''>
  label: string
}> = [
  { value: 'local', label: '本埠' },
  { value: 'nonlocal', label: '外埠' },
  { value: 'international', label: '国际' },
  { value: 'special-free-trade-port', label: '特区（自贸港）' },
  { value: 'special-mirror-sea-port', label: '特区（镜海埠）' },
  { value: 'special-beautiful-island', label: '特区（美丽岛）' },
]

interface ServiceIntakePanelProps {
  addressDestinationZone?: ServiceDestinationZone
  addressDestinationOffice?: string
  customerDraft: CustomerDraft
  customerRepository: CustomerRepository
  initialRecommendation?: ServiceRecommendationTransfer | null
  repository: ServiceRepository
  onCustomerCommitted: (workspace: CustomerWorkspaceState) => void
  onAppointmentCustomerLoaded?: (order: AppointmentOrder) => Promise<void>
  onAppointmentLockChange?: (locked: boolean) => void
  onDestinationZoneChange?: (zone: ServiceDestinationZone) => void
  onOpenSettlement: () => void
  onRequestSenderIdentity?: () => void
  onSummaryChange: (summary: ServiceSummary) => void
  renderRecipientSection?: (context: RecipientSectionContext) => ReactNode
}

export interface RecipientSectionContext {
  hidden: boolean
  required: boolean
  disabled: boolean
}

const AGREEMENT_DOMESTIC_RECEIPT_OPT_OUT_KEY =
  'local-delivery-training-agreement-domestic-receipt-opt-out'
const RETIRED_AGREEMENT_DOMESTIC_RECEIPT_OPT_OUT_KEY = `${"retired-public-namespace"}-agreement-domestic-receipt-opt-out`

function isDomesticReceipt(transaction: ServiceTransaction): boolean {
  return transaction.service.destinationZone === 'local' ||
    transaction.service.destinationZone === 'nonlocal'
}

function agreementDomesticReceiptOptedOut(): boolean {
  try {
    if (window.localStorage.getItem(AGREEMENT_DOMESTIC_RECEIPT_OPT_OUT_KEY) === '1') {
      return true
    }
    if (window.localStorage.getItem(RETIRED_AGREEMENT_DOMESTIC_RECEIPT_OPT_OUT_KEY) !== '1') {
      return false
    }
    window.localStorage.setItem(AGREEMENT_DOMESTIC_RECEIPT_OPT_OUT_KEY, '1')
    window.localStorage.removeItem(RETIRED_AGREEMENT_DOMESTIC_RECEIPT_OPT_OUT_KEY)
    return true
  } catch {
    return false
  }
}

function rememberAgreementDomesticReceiptOptOut(): void {
  try {
    window.localStorage.setItem(AGREEMENT_DOMESTIC_RECEIPT_OPT_OUT_KEY, '1')
    window.localStorage.removeItem(RETIRED_AGREEMENT_DOMESTIC_RECEIPT_OPT_OUT_KEY)
  } catch {
    // The current prompt can still be dismissed when browser storage is disabled.
  }
}

function summaryFromState(state: ServiceWorkspaceState): ServiceSummary {
  return pendingServiceSummary(state)
}

function ServiceFieldError({ message }: { message?: string }) {
  if (!message) return null
  return <span className="customer-field-error">{message}</span>
}

function itemCodeCopy(rule: ResolvedItemCodeRule): {
  inputMode: 'numeric' | 'text'
  label: string
  placeholder: string
  hint: string
} {
  if (rule === 'seven-prefix-13-digits') {
    return {
      inputMode: 'numeric',
      label: '邮件条码',
      placeholder: '7 开头的 13 位数字',
      hint: '13 位纯数字，首位必须为 7。',
    }
  }
  if (rule === 'registered-domestic-13' || rule === 'parcel-domestic-13') {
    return {
      inputMode: 'text',
      label: '邮件号码',
      placeholder: '例如 PM13131313435',
      hint: '国内邮件号码共 13 位：前 2 位大写字母，后 11 位数字。',
    }
  }
  if (rule === 'registered-international-s10') {
    return {
      inputMode: 'text',
      label: '邮件号码',
      placeholder: '例如 RR473124829CN',
      hint: '国际给据邮件使用 R 类 S10 号码，并核验流水号校验位。',
    }
  }
  if (rule === 'parcel-international-s10') {
    return {
      inputMode: 'text',
      label: '邮件号码',
      placeholder: '例如 CP123456785CN',
      hint: '国际包裹使用 C 类 S10 号码，并核验流水号校验位。',
    }
  }
  if (rule === 'express-international-s10') {
    return {
      inputMode: 'text',
      label: '邮件条码',
      placeholder: '例如 EE123456785CN',
      hint: '国际特快使用 E 类 S10 号码，并核验流水号校验位。',
    }
  }
  if (rule === 'express-domestic-12') {
    return {
      inputMode: 'numeric',
      label: '邮件条码',
      placeholder: '12 位纯数字',
      hint: '国内特快邮件条码为 12 位纯数字。',
    }
  }
  if (rule === 'standard-express-13') {
    return {
      inputMode: 'text',
      label: '邮件条码',
      placeholder: '例如 8970000000X99',
      hint: '标准快递使用 89 + 8 位流水号 + X99；预置与非预置号段合计覆盖 00000001 至 99999999。',
    }
  }
  return {
    inputMode: 'text',
    label: '邮件条码',
    placeholder: '扫描或输入邮件条码',
    hint: '请按当前业务产品的号码规则录入。',
  }
}

export function ServiceIntakePanel({
  addressDestinationZone,
  addressDestinationOffice = '',
  customerDraft,
  customerRepository,
  initialRecommendation = null,
  repository,
  onCustomerCommitted,
  onAppointmentCustomerLoaded,
  onAppointmentLockChange,
  onDestinationZoneChange,
  onOpenSettlement,
  onRequestSenderIdentity,
  onSummaryChange,
  renderRecipientSection,
}: ServiceIntakePanelProps) {
  const hasAgreement = Boolean(customerDraft.sender.agreementAccountId)
  const products = useMemo(
    () => SERVICE_PRODUCTS.filter(
      (product) => product.productFamily === customerDraft.productFamily,
    ),
    [customerDraft.productFamily],
  )
  const isRegisteredMail = customerDraft.productFamily === 'standard-delivery'
  const isParcel = customerDraft.productFamily === 'parcel'
  const isExpress = customerDraft.productFamily === 'express'
  const addressControlled = addressDestinationZone !== undefined
  const addressDestinationRef = useRef({
    office: addressDestinationOffice,
    zone: addressDestinationZone,
  })
  addressDestinationRef.current = {
    office: addressDestinationOffice,
    zone: addressDestinationZone,
  }
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [draft, setDraft] = useState<ServiceDraft>(() =>
    createEmptyServiceDraft(hasAgreement, addressDestinationZone ?? ''),
  )
  const [productQuery, setProductQuery] = useState('')
  const [productMenuOpen, setProductMenuOpen] = useState(false)
  const [expandedProductGroups, setExpandedProductGroups] = useState<Set<string>>(
    () => new Set(),
  )
  const [errors, setErrors] = useState<ServiceErrors>({})
  const [quote, setQuote] = useState<ChargeSummary | null>(null)
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [contentItemsOpen, setContentItemsOpen] = useState(false)
  const [appointmentOpen, setAppointmentOpen] = useState(false)
  const [receiptTransaction, setReceiptTransaction] =
    useState<ServiceTransaction | null>(null)

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      const recommendedProduct = initialRecommendation
        ? products.find((product) => product.id === initialRecommendation.productId)
        : undefined
      const restoredProduct = products.find(
        (product) => product.id === loaded.draft?.productId,
      )
      onAppointmentLockChange?.(Boolean(
        !recommendedProduct && restoredProduct &&
        loaded.draft?.appointment?.mailInformationLocked,
      ))
      const controlledDestination = addressDestinationRef.current
      if (recommendedProduct && initialRecommendation) {
        setDraft({
          ...createEmptyServiceDraft(hasAgreement, initialRecommendation.destinationZone),
          productId: recommendedProduct.id,
          destinationOffice: initialRecommendation.destinationOffice,
          weightGrams: initialRecommendation.weightGrams,
          remark: initialRecommendation.remark,
        })
        setProductQuery(recommendedProduct.label)
      } else if (loaded.draft && restoredProduct) {
        setDraft({
          ...loaded.draft,
          ...(controlledDestination.zone === undefined
            ? {}
            : {
                destinationZone: controlledDestination.zone,
                destinationOffice: controlledDestination.office,
              }),
        })
        setProductQuery(restoredProduct.label)
      } else {
        const nextZone = controlledDestination.zone ?? ''
        setDraft({
          ...createEmptyServiceDraft(hasAgreement, nextZone),
          destinationOffice: controlledDestination.office,
        })
        setProductQuery('')
      }
      onSummaryChange(summaryFromState(loaded))
    })
    return () => {
      active = false
    }
  }, [
    hasAgreement,
    initialRecommendation,
    onAppointmentLockChange,
    onSummaryChange,
    products,
    repository,
  ])

  useEffect(() => {
    if (addressDestinationZone === undefined) return
    setDraft((current) => {
      const nextOffice = addressDestinationOffice
      if (
        current.destinationZone === addressDestinationZone &&
        current.destinationOffice === nextOffice
      ) {
        return current
      }
      return {
        ...current,
        destinationZone: addressDestinationZone,
        destinationOffice: nextOffice,
        itemCode: '',
        returnReceiptRequested: false,
        parcelTariffZone: '',
        platformQuoteCents: null,
        updatedAt: new Date().toISOString(),
      }
    })
    setQuote(null)
    setErrors((current) => ({
      ...current,
      destinationOffice: undefined,
      destinationZone: undefined,
      form: undefined,
    }))
  }, [addressDestinationOffice, addressDestinationZone])

  const productGroups = useMemo(
    () => SERVICE_PRODUCT_GROUPS.filter(
      (group) => group.productFamily === customerDraft.productFamily,
    ),
    [customerDraft.productFamily],
  )

  const productResults = useMemo(
    () => searchServiceProducts(products, productQuery),
    [products, productQuery],
  )
  const productIndex = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  )
  const visibleProductGroups = useMemo(() => {
    const term = productQuery.trim()
    if (!term) return productGroups
    const normalized = term.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const isCodeSearch = normalized.length >= 2 && /^[A-Z0-9-]+$/i.test(term)
    const isLabelSearch = Array.from(term).length >= 2
    if (!isCodeSearch && !isLabelSearch) return []
    const matchedProductIds = new Set(productResults.map((product) => product.id))

    return productGroups.flatMap((group) => {
      const groupMatches = isCodeSearch
        ? group.code.includes(normalized)
        : group.label.includes(term)
      const items = groupMatches
        ? group.items
        : group.items.filter((item) =>
            matchedProductIds.has(item.productId) ||
            (isCodeSearch
              ? item.code.includes(normalized)
              : item.label.includes(term)),
          )
      return groupMatches || items.length > 0 ? [{ ...group, items }] : []
    })
  }, [productGroups, productQuery, productResults])
  const selectedProduct = products.find(
    (product) => product.id === draft.productId,
  )
  const appointmentProductLocked = Boolean(draft.appointment)
  const appointmentMailLocked = Boolean(
    draft.appointment?.mailInformationLocked,
  )
  const itemCodeRule = selectedProduct
    ? serviceItemCodeRule(selectedProduct, draft.destinationZone)
    : 'none'
  const itemCodePresentation = itemCodeCopy(itemCodeRule)
  const supportsRemark = (selectedProduct?.remarkOptions.length ?? 0) > 0
  const selectedIsDomesticBarcodeLetter = selectedProduct
    ? isDomesticBarcodeLetter(selectedProduct)
    : false
  const latestTransaction = workspace?.transactions.at(-1) ?? null
  const peopleLetter =
    selectedIsDomesticBarcodeLetter && draft.remark === 'people-letter'
  const recipientRequired = selectedProduct?.requiresRecipient ?? (
    isRegisteredMail || isParcel || isExpress
  )
  const recipientSectionHidden =
    draft.destinationZone === 'international' && !recipientRequired
  const isInternationalTariff = draft.destinationZone === 'international'
  const isSpecialTariff = draft.destinationZone.startsWith('special-')
  const isOverseasTariff = isInternationalTariff || isSpecialTariff
  const isPostcard = selectedProduct
    ? usesPostcardTariff(draft, selectedProduct)
    : false
  const maxWeightGrams = selectedProduct
    ? serviceMaxWeightGrams(draft, selectedProduct)
    : 2000
  const isParcelSticker = selectedProduct?.tariffKind === 'fixed-parcel-sticker'
  const isHomeParcel = selectedProduct?.searchCode === '301'
  const isStandardExpress = selectedProduct?.searchCode === '404'
  const requiresTariffZone = Boolean(
    selectedProduct && (
      (selectedProduct.tariffKind === 'ordinary-parcel' &&
        (draft.destinationZone === 'local' || draft.destinationZone === 'nonlocal')) ||
      isStandardExpress
    ),
  )
  const tariffZoneMaximum = isStandardExpress ? 10 : 6
  const requiresPlatformQuote = selectedProduct
    ? serviceRequiresPlatformQuote(draft, selectedProduct)
    : false
  const volumeWeightGrams = selectedProduct
    ? serviceVolumeWeightGrams(draft, selectedProduct)
    : 0
  const chargeableWeightGrams = selectedProduct
    ? serviceChargeableWeightGrams(draft, selectedProduct)
    : (draft.weightGrams ?? 0)
  const baseChargeLabel = requiresPlatformQuote
    ? '平台总报价'
    : isParcelSticker
      ? '固定基本资费'
      : isParcel || isExpress
        ? '首千克资费'
      : isPostcard
    ? '明信片基本资费'
    : selectedProduct?.tariffKind === 'printed-matter-bag'
      ? '5 千克及以内'
      : selectedProduct?.tariffKind === 'small-packet'
        ? isOverseasTariff ? '100 克及以内' : '1 千克及以内'
        : selectedProduct?.tariffKind === 'mailgram'
          ? '每件基本资费'
          : isInternationalTariff
            ? '20 克及以内'
            : isSpecialTariff
              ? '非航空重量分档'
              : '100 克及以内'
  const additionalChargeLabel = isParcel || isExpress
    ? isParcelSticker || requiresPlatformQuote ? '续重资费' : '首千克以上部分'
    : isPostcard
    ? isSpecialTariff ? '航空费' : '续重资费'
    : selectedProduct?.tariffKind === 'printed-matter-bag'
      ? isSpecialTariff ? '续重与航空费' : '5 千克以上部分'
      : selectedProduct?.tariffKind === 'small-packet'
        ? isSpecialTariff
          ? '续重与航空费'
          : isInternationalTariff ? '100 克以上部分' : '1 千克以上部分'
        : isSpecialTariff
          ? '续重与航空费'
          : isInternationalTariff
            ? '20 克以上部分'
            : '100 克以上部分'
  const registrationFeeCents = selectedProduct
    ? serviceRegistrationFeeCents(selectedProduct, draft.destinationZone)
    : 0
  const returnReceipt = selectedProduct
    ? returnReceiptEligibility(selectedProduct, draft.destinationZone)
    : null
  const familyHeading = isRegisteredMail
    ? '给据函件收寄'
    : isParcel
      ? '包裹收寄'
      : isExpress
        ? '特快收寄'
        : '平常函件收寄'
  function updateDraft(
    patch: Partial<ServiceDraft>,
    field?: ServiceField,
  ): void {
    setDraft((current) => ({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    }))
    setQuote(null)
    setNotice('')
    if (field) {
      setErrors((current) => ({ ...current, [field]: undefined, form: undefined }))
    } else {
      setErrors({})
    }
  }

  function contentItemStock(item: PostalSupplyItem): number {
    return workspace ? remainingPostalSupplyStock(workspace, item.id) : item.stock
  }

  function saveContentItems(lines: PostalSupplySaleLine[]): void {
    updateDraft({
      contentItems: lines,
      contents: serviceContentSummary(lines),
    }, 'contentItems')
    setErrors((current) => ({
      ...current,
      contentItems: undefined,
      contents: undefined,
      form: undefined,
    }))
    setContentItemsOpen(false)
  }

  function chooseProduct(product: ServiceProduct): void {
    const destinationZone = addressControlled
      ? addressDestinationZone ?? ''
      : product.destinationZones.includes(draft.destinationZone)
        ? draft.destinationZone
        : ''
    const destinationOffice = destinationZone === 'international'
      ? addressControlled
        ? addressDestinationOffice
        : draft.destinationOffice
      : ''
    updateDraft({
      productId: product.id,
      destinationZone,
      destinationOffice,
      itemCode: '',
      returnReceiptRequested: false,
      remark: product.remarkOptions[0] ?? 'ordinary-letter',
      packaging: '',
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      declaredValueCents: null,
      insuranceValueCents: null,
      contents: '',
      contentItems: [],
      postcardBarcode: '',
      parcelTariffZone: '',
      platformQuoteCents: null,
      paymentMethod: product.tariffKind === 'conscript-mail'
        ? 'self-affixed'
        : 'cash-settlement',
      stampAmountCents: null,
    }, 'productId')
    if (!addressControlled && destinationZone !== draft.destinationZone) {
      onDestinationZoneChange?.(destinationZone)
    }
    if (destinationZone && !product.destinationZones.includes(destinationZone)) {
      setErrors({
        destinationZone: `当前详细地址生成“${destinationZoneLabel(destinationZone)}”，业务产品 ${product.label}（${product.searchCode}）不支持该区域。`,
      })
    }
    setProductQuery(product.label)
    setProductMenuOpen(false)
    setContentItemsOpen(product.searchCode === '301')
  }

  function chooseCatalogItem(item: ServiceProductCatalogItem): void {
    const product = productIndex.get(item.productId)
    if (product) {
      chooseProduct(product)
      return
    }
    setErrors({ productId: `产品目录数据异常：${item.label}（${item.code}）缺少可执行规则。` })
    setNotice('产品规则未载入，请恢复初始数据后重试。')
  }

  function handleProductQuery(value: string): void {
    setProductQuery(value)
    setProductMenuOpen(true)
    setContentItemsOpen(false)
    setDraft((current) => ({
      ...current,
      productId: null,
      returnReceiptRequested: false,
      contents: '',
      contentItems: [],
      updatedAt: new Date().toISOString(),
    }))
    setQuote(null)
    setErrors((current) => ({ ...current, productId: undefined, form: undefined }))
  }

  function chooseDestinationZone(zone: ServiceDestinationZone): void {
    if (addressControlled) return
    setProductMenuOpen(false)
    updateDraft({
      destinationZone: zone,
      destinationOffice: '',
      itemCode: '',
      returnReceiptRequested: false,
      parcelTariffZone: '',
      platformQuoteCents: null,
    }, 'destinationZone')
    if (zone) onDestinationZoneChange?.(zone)
  }

  async function applyAppointmentOrder(order: AppointmentOrder): Promise<void> {
    const product = SERVICE_PRODUCTS.find(
      (candidate) => candidate.id === order.draft.productId,
    )
    if (!product) throw new Error('预约业务产品未载入，请恢复初始数据后重试。')
    const nextState = await repository.saveDraft(order.draft)
    await onAppointmentCustomerLoaded?.(order)
    setWorkspace(nextState)
    setDraft(structuredClone(order.draft))
    setProductQuery(product.label)
    setProductMenuOpen(false)
    setExpandedProductGroups(new Set([product.parentCode]))
    setQuote(null)
    setErrors({})
    setAppointmentOpen(false)
    onDestinationZoneChange?.(order.draft.destinationZone)
    onAppointmentLockChange?.(order.draft.appointment?.mailInformationLocked ?? false)
    const appointment = order.draft.appointment
    setNotice(
      appointment?.labelAlreadyPrinted
        ? `已载入预约单 ${order.orderNumber}；外部面单已预制，本次不重复打印。`
        : `已载入预约单 ${order.orderNumber}，请核对信息后计费。`,
    )
  }

  async function priceService(): Promise<void> {
    const validation = validateServiceDraft(draft, products, hasAgreement)
    if (isHomeParcel && workspace) {
      const contentError = serviceContentStockError(workspace, draft.contentItems)
      if (contentError) {
        validation.valid = false
        validation.errors.contentItems = contentError
      }
    }
    if ((isParcel || isExpress) && !validateSender(customerDraft.sender, true).valid) {
      validation.valid = false
      validation.errors.form = '包裹与特快要求寄件人完成实名信息校验，请先修改寄件资料。'
      onRequestSenderIdentity?.()
    }
    if (selectedProduct?.requiresRecipient && customerDraft.status !== 'customer-ready') {
      validation.valid = false
      validation.errors.form = '当前业务必须先保存收件资料，再进行计费。'
    }
    if (!validation.valid || !selectedProduct) {
      setErrors(validation.errors)
      setNotice('请修正标注字段后重新计费。')
      return
    }
    const nextQuote = calculateServiceCharge(draft, selectedProduct)
    const nextState = await repository.saveDraft(draft)
    setWorkspace(nextState)
    setQuote(nextQuote)
    setErrors({})
    setNotice('计费完成。修改任一业务字段后必须重新计费，确认无误后再提交。')
  }

  async function submitService(): Promise<void> {
    if (!quote || !selectedProduct || submitting) return
    const validation = validateServiceDraft(draft, products, hasAgreement)
    if (isHomeParcel && workspace) {
      const contentError = serviceContentStockError(workspace, draft.contentItems)
      if (contentError) {
        validation.valid = false
        validation.errors.contentItems = contentError
      }
    }
    if ((isParcel || isExpress) && !validateSender(customerDraft.sender, true).valid) {
      validation.valid = false
      validation.errors.form = '包裹与特快要求寄件人完成实名信息校验，请先修改寄件资料。'
      onRequestSenderIdentity?.()
    }
    if (selectedProduct.requiresRecipient && customerDraft.status !== 'customer-ready') {
      validation.valid = false
      validation.errors.form = '当前业务必须先保存收件资料，再提交受理。'
    }
    if (!validation.valid) {
      setErrors(validation.errors)
      setQuote(null)
      setNotice('业务字段已经变化，请修正后重新计费。')
      return
    }
    setSubmitting(true)
    try {
      const accepted = await repository.accept({
        acceptedAt: new Date().toISOString(),
        charge: quote,
        customer: {
          productFamily: customerDraft.productFamily,
          destinationRegion: customerDraft.destinationRegion,
          sender: customerDraft.sender,
          recipient: customerDraft.recipient,
        },
        draft,
        product: selectedProduct,
      })
      setWorkspace(accepted.state)
      onSummaryChange(summaryFromState(accepted.state))
      setQuote(null)
      setDraft(createEmptyServiceDraft(hasAgreement, ''))
      setProductQuery('')
      setExpandedProductGroups(new Set())
      setErrors({})
      setNotice(`提交成功，${accepted.transaction.id} 已进入结算中心。`)
      onAppointmentLockChange?.(false)

      const agreementDomesticOptOut = Boolean(
        accepted.transaction.customer.sender.agreementAccountId,
      ) && isDomesticReceipt(accepted.transaction) &&
        agreementDomesticReceiptOptedOut()
      if (
        isRegisteredReceiptTransaction(accepted.transaction) &&
        !agreementDomesticOptOut
      ) {
        setReceiptTransaction(accepted.transaction)
      }

      try {
        const customerWorkspace = await customerRepository.promoteDraft(customerDraft)
        onCustomerCommitted(customerWorkspace)
      } catch {
        setNotice(
          `提交成功，${accepted.transaction.id} 已持久化；客户历史暂未更新。`,
        )
      }
    } catch (caught) {
      setErrors((current) => ({
        ...current,
        form: caught instanceof Error
          ? `${caught.message}；客户历史未更新，可保留当前输入后重试。`
          : '交易写入失败，客户历史未更新；可保留当前输入后重试。',
      }))
      setNotice('提交未完成，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  function closeInitialReceipt(reason: 'cancelled' | 'printed'): void {
    if (
      reason === 'cancelled' &&
      receiptTransaction?.customer.sender.agreementAccountId &&
      isDomesticReceipt(receiptTransaction)
    ) {
      rememberAgreementDomesticReceiptOptOut()
    }
    setReceiptTransaction(null)
  }

  if (!workspace) {
    return (
      <section className="service-intake service-intake--loading" aria-live="polite">
        正在准备业务受理数据…
      </section>
    )
  }

  return (
    <section className="service-intake" aria-labelledby="service-intake-title">
      <div className="section-title-row service-section-title">
        <div>
          <span className="section-caret">⌄</span>
          <strong id="service-intake-title">{familyHeading}</strong>
        </div>
        <div className="service-title-actions">
          {(isParcel || isExpress) ? (
            <button
              className="appointment-collection-button"
              onClick={() => setAppointmentOpen(true)}
              type="button"
            >
              预约收寄
            </button>
          ) : null}
          <button
            className="settlement-center-button"
            onClick={onOpenSettlement}
            type="button"
          >
            结算中心（{summaryFromState(workspace).count}）
          </button>
        </div>
      </div>

      {latestTransaction ? (
        <article className="accepted-transaction" aria-label="最近受理结果">
          <div>
            <span className="accepted-transaction__eyebrow">最近受理</span>
            <strong>{latestTransaction.id}</strong>
            <small>
              {latestTransaction.product.label} · 产品 {latestTransaction.product.searchCode} ·
              业务 {latestTransaction.product.effectiveBusinessCode}
            </small>
            {latestTransaction.source === 'appointment' ? (
              <small>
                预约来源 {latestTransaction.service.appointment?.sourceLabel} ·
                预约单 {latestTransaction.sourceOrderNumber}
              </small>
            ) : null}
          </div>
          <div>
            <span>总资费</span>
            <strong>¥ {formatCents(latestTransaction.charge.postageCents)}</strong>
          </div>
          <div>
            <span>结算应收</span>
            <strong>¥ {formatCents(latestTransaction.charge.settlementDueCents)}</strong>
          </div>
          <span className={latestTransaction.status === 'settled' ? 'queue-status queue-status--settled' : 'queue-status'}>
            {latestTransaction.status === 'settled' ? '已结算' : '待结算'}
          </span>
        </article>
      ) : null}

      {draft.appointment ? (
        <div className="appointment-loaded-banner" role="status">
          <div>
            <strong>{draft.appointment.sourceLabel}</strong>
            <span>预约单 {draft.appointment.orderNumber}</span>
          </div>
          <span>
            {draft.appointment.mailInformationLocked ? '预约信息已锁定' : '预约信息可核改'}
          </span>
          {draft.appointment.discountCents > 0 ? (
            <span>平台优惠 ¥ {formatCents(draft.appointment.discountCents)}</span>
          ) : null}
          {draft.appointment.labelAlreadyPrinted ? <span>面单已预制</span> : null}
        </div>
      ) : null}

      <fieldset
        className="service-form-grid service-routing-grid service-fieldset-reset"
        disabled={appointmentProductLocked}
      >
        <label className="product-lookup-field">
          <span><b>*</b> 业务产品</span>
          <input
            aria-controls="service-product-options"
            aria-expanded={productMenuOpen}
            aria-label="业务产品检索"
            onChange={(event) => handleProductQuery(event.target.value)}
            onFocus={() => setProductMenuOpen(true)}
            placeholder="输入至少两位产品代码或两个汉字"
            role="combobox"
            value={productQuery}
          />
          {productMenuOpen ? (
            <div className="product-results" id="service-product-options" role="tree">
              {visibleProductGroups.map((group) => {
                const queryActive = Boolean(productQuery.trim())
                const expanded = queryActive || expandedProductGroups.has(group.code)
                return (
                  <div className="product-tree-group" key={group.code}>
                    <button
                      aria-expanded={expanded}
                      aria-label={`${expanded ? '收起' : '展开'} ${group.label} ${group.code}`}
                      className="product-tree-parent"
                      onClick={() => setExpandedProductGroups((current) => {
                        const next = new Set(current)
                        if (next.has(group.code)) next.delete(group.code)
                        else next.add(group.code)
                        return next
                      })}
                      role="treeitem"
                      type="button"
                    >
                      <span className="product-tree-caret">{expanded ? '⌄' : '›'}</span>
                      <strong>{group.label}（{group.code}）</strong>
                    </button>
                    {expanded ? (
                      <div className="product-tree-children" role="group">
                        {group.items.map((item) => {
                          const product = productIndex.get(item.productId)
                          return (
                            <button
                              aria-label={`选择 ${item.label} ${item.code}`}
                              className={product?.requiresAgreement
                                ? 'product-tree-agreement'
                                : ''}
                              key={item.code}
                              onClick={() => chooseCatalogItem(item)}
                              role="treeitem"
                              type="button"
                            >
                              <strong>{item.label}（{item.code}）</strong>
                              {product?.requiresAgreement ? <span>协议</span> : null}
                            </button>
                          )
                        })}
                        {group.items.length === 0 ? <p>暂无可选业务产品</p> : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {visibleProductGroups.length === 0 ? <p>没有匹配的业务产品</p> : null}
            </div>
          ) : null}
          <ServiceFieldError message={errors.productId} />
        </label>

        <label>
          <span><b>*</b> 区域</span>
          <select
            aria-label="服务区域"
            disabled={addressControlled}
            onChange={(event) => chooseDestinationZone(
              event.target.value as ServiceDraft['destinationZone'],
            )}
            value={draft.destinationZone}
          >
            <option value="">请选择区域</option>
            {SERVICE_ZONE_OPTIONS.map((option) => (
              <option
                disabled={Boolean(
                  selectedProduct &&
                  !selectedProduct.destinationZones.includes(option.value),
                )}
                key={option.value}
                value={option.value}
              >
                {option.label}
              </option>
            ))}
          </select>
          <ServiceFieldError message={errors.destinationZone} />
        </label>

        {draft.destinationZone === 'international' ? (
          <label>
            <span><b>*</b> 寄达局（目标国家/地区）</span>
            <select
              aria-label="国际寄达局"
              disabled={addressControlled}
              onChange={(event) => updateDraft(
                { destinationOffice: event.target.value },
                'destinationOffice',
              )}
              value={draft.destinationOffice}
            >
              <option value="">请选择海外寄达局</option>
              {INTERNATIONAL_DESTINATIONS.map((destination) => (
                <option key={destination.code} value={destination.code}>
                  {destination.label}
                </option>
              ))}
            </select>
            <ServiceFieldError message={errors.destinationOffice} />
          </label>
        ) : null}
      </fieldset>

      {renderRecipientSection?.({
        hidden: recipientSectionHidden,
        required: recipientRequired,
        disabled: appointmentMailLocked,
      })}

      <div className="section-title-row service-mail-section-title">
        <div>
          <span className="section-caret">⌄</span>
          <strong>邮件信息</strong>
        </div>
      </div>

      <fieldset
        className="service-form-grid service-fieldset-reset"
        disabled={appointmentMailLocked}
      >

        {selectedProduct && itemCodeRule !== 'none' ? (
          <label>
            <span><b>*</b> {itemCodePresentation.label}</span>
            <input
              aria-label={itemCodePresentation.label}
              inputMode={itemCodePresentation.inputMode}
              maxLength={13}
              onChange={(event) => updateDraft(
                { itemCode: event.target.value.toUpperCase() },
                'itemCode',
              )}
              placeholder={itemCodePresentation.placeholder}
              value={draft.itemCode}
            />
            <ServiceFieldError message={errors.itemCode} />
          </label>
        ) : null}

        {isParcelSticker ? (
          <label>
            <span><b>*</b> 明信片条码</span>
            <input
              aria-label="明信片条码"
              inputMode="numeric"
              maxLength={14}
              onChange={(event) => updateDraft(
                { postcardBarcode: event.target.value },
                'postcardBarcode',
              )}
              placeholder="14 位纯数字"
              value={draft.postcardBarcode}
            />
            <ServiceFieldError message={errors.postcardBarcode} />
          </label>
        ) : null}

        {supportsRemark ? (
          <label>
            <span><b>*</b> 邮件备注</span>
            <select
              aria-label="邮件备注"
              onChange={(event) => {
                const remark = event.target.value as ServiceDraft['remark']
                updateDraft({
                  remark,
                  ...(remark === 'people-letter'
                    ? { paymentMethod: 'self-affixed' as const, stampAmountCents: null }
                    : {}),
                })
              }}
              value={draft.remark}
            >
              {selectedProduct?.remarkOptions.includes('ordinary-letter') ? (
                <option value="ordinary-letter">{selectedIsDomesticBarcodeLetter ? '平信' : '无'}</option>
              ) : null}
              {selectedProduct?.remarkOptions.includes('postcard') ? (
                <option value="postcard">明信片</option>
              ) : null}
              {selectedProduct?.remarkOptions.includes('people-letter') ? (
                <option value="people-letter">人民来信</option>
              ) : null}
              {selectedProduct?.remarkOptions.includes('parcel-4') ? (
                <option value="parcel-4">4元</option>
              ) : null}
              {selectedProduct?.remarkOptions.includes('parcel-6') ? (
                <option value="parcel-6">6元</option>
              ) : null}
              {selectedProduct?.remarkOptions.includes('parcel-11') ? (
                <option value="parcel-11">11元</option>
              ) : null}
              {selectedProduct?.remarkOptions.includes('document') ? (
                <option value="document">文</option>
              ) : null}
              {selectedProduct?.remarkOptions.includes('goods') ? (
                <option value="goods">物</option>
              ) : null}
            </select>
            <ServiceFieldError message={errors.remark} />
          </label>
        ) : null}

        <label>
          <span><b>*</b> 邮件重量（克）</span>
          <div className="field-with-action service-weight-field">
            <input
              aria-label="邮件重量"
              inputMode="numeric"
              onChange={(event) => updateDraft(
                {
                  weightGrams: event.target.value === ''
                    ? null
                    : Number(event.target.value),
                },
                'weightGrams',
              )}
              max={maxWeightGrams}
              min={1}
              placeholder={`1 至 ${maxWeightGrams}`}
              type="number"
              value={draft.weightGrams ?? ''}
            />
            <button
              onClick={() => updateDraft(
                { weightGrams: isParcel ? 1000 : isExpress ? 500 : 20 },
                'weightGrams',
              )}
              type="button"
            >
              计重
            </button>
          </div>
          <ServiceFieldError message={errors.weightGrams} />
        </label>

        {(isParcel || isExpress) ? (
          <>
            <label>
              <span>包装物</span>
              <input
                aria-label="包装物"
                maxLength={40}
                onChange={(event) => updateDraft(
                  { packaging: event.target.value },
                  'packaging',
                )}
                placeholder="选择或输入包装物"
                value={draft.packaging}
              />
              <ServiceFieldError message={errors.packaging} />
            </label>

            {isHomeParcel ? (
              <div className="service-content-summary-field">
                <span><b>*</b> 内件信息</span>
                <div className="field-with-action">
                  <input
                    aria-label="内件信息"
                    placeholder="从用邮物品信息窗口选择"
                    readOnly
                    value={draft.contents}
                  />
                  <button onClick={() => setContentItemsOpen(true)} type="button">
                    {draft.contentItems.length > 0 ? '重新选择物品' : '选择物品'}
                  </button>
                </div>
                <ServiceFieldError message={errors.contentItems} />
                <ServiceFieldError message={errors.contents} />
              </div>
            ) : null}

            {requiresTariffZone ? (
              <label>
                <span><b>*</b> {isStandardExpress ? '寄递平台分区' : '普通包裹资费区档'}</span>
                <select
                  aria-label={isStandardExpress ? '寄递平台分区' : '普通包裹资费区档'}
                  onChange={(event) => updateDraft(
                    { parcelTariffZone: event.target.value as ServiceDraft['parcelTariffZone'] },
                    'parcelTariffZone',
                  )}
                  value={draft.parcelTariffZone}
                >
                  <option value="">请选择</option>
                  {Array.from({ length: tariffZoneMaximum }, (_, index) => index + 1).map((zone) => (
                    <option key={zone} value={String(zone)}>{zone} 区</option>
                  ))}
                </select>
                <ServiceFieldError message={errors.parcelTariffZone} />
              </label>
            ) : null}

            <label>
              <span>{isExpress && draft.remark === 'goods' ? <b>*</b> : null} 邮件长（厘米）</span>
              <input
                aria-label="邮件长"
                min={0}
                onChange={(event) => updateDraft(
                  { lengthCm: event.target.value === '' ? null : Number(event.target.value) },
                  'lengthCm',
                )}
                step="0.1"
                type="number"
                value={draft.lengthCm ?? ''}
              />
              <ServiceFieldError message={errors.lengthCm} />
            </label>
            <label>
              <span>{isExpress && draft.remark === 'goods' ? <b>*</b> : null} 邮件宽（厘米）</span>
              <input
                aria-label="邮件宽"
                min={0}
                onChange={(event) => updateDraft(
                  { widthCm: event.target.value === '' ? null : Number(event.target.value) },
                  'widthCm',
                )}
                step="0.1"
                type="number"
                value={draft.widthCm ?? ''}
              />
              <ServiceFieldError message={errors.widthCm} />
            </label>
            <label>
              <span>{isExpress && draft.remark === 'goods' ? <b>*</b> : null} 邮件高（厘米）</span>
              <input
                aria-label="邮件高"
                min={0}
                onChange={(event) => updateDraft(
                  { heightCm: event.target.value === '' ? null : Number(event.target.value) },
                  'heightCm',
                )}
                step="0.1"
                type="number"
                value={draft.heightCm ?? ''}
              />
              <ServiceFieldError message={errors.heightCm} />
            </label>

            {isExpress ? (
              <label>
                <span>{draft.remark === 'goods' ? <b>*</b> : null} 内件信息</span>
                <input
                  aria-label="内件信息"
                  maxLength={60}
                  onChange={(event) => updateDraft(
                    { contents: event.target.value },
                    'contents',
                  )}
                  placeholder={draft.remark === 'goods' ? '“物”类必填' : '“文”类可选'}
                  value={draft.contents}
                />
                <ServiceFieldError message={errors.contents} />
              </label>
            ) : null}

            <label>
              <span>保价金额（元）</span>
              <CurrencyInput
                aria-label="保价金额"
                onValueChange={(valueCents) => updateDraft(
                  { declaredValueCents: valueCents },
                  'declaredValueCents',
                )}
                valueCents={draft.declaredValueCents}
              />
              <ServiceFieldError message={errors.declaredValueCents} />
            </label>
            <label>
              <span>保险金额（元）</span>
              <CurrencyInput
                aria-label="保险金额"
                onValueChange={(valueCents) => updateDraft(
                  { insuranceValueCents: valueCents },
                  'insuranceValueCents',
                )}
                valueCents={draft.insuranceValueCents}
              />
              <ServiceFieldError message={errors.insuranceValueCents} />
            </label>

            {requiresPlatformQuote ? (
              <label>
                <span><b>*</b> 寄递平台总报价（元/件）</span>
                <CurrencyInput
                  aria-label="寄递平台报价"
                  onValueChange={(valueCents) => updateDraft(
                    { platformQuoteCents: valueCents },
                    'platformQuoteCents',
                  )}
                  valueCents={draft.platformQuoteCents}
                />
                <ServiceFieldError message={errors.platformQuoteCents} />
              </label>
            ) : null}

            <div className="service-weight-metrics" role="note">
              <span>体积重量 <strong>{volumeWeightGrams} 克</strong></span>
              <span>计费重量 <strong>{chargeableWeightGrams} 克</strong></span>
            </div>
          </>
        ) : null}

        <label>
          <span><b>*</b> 件数</span>
          <input
            aria-label="邮件件数"
            disabled={!hasAgreement}
            inputMode="numeric"
            min={1}
            onChange={(event) => updateDraft(
              { quantity: Number(event.target.value) },
              'quantity',
            )}
            type="number"
            value={draft.quantity}
          />
          <ServiceFieldError message={errors.quantity} />
        </label>

        <label>
          <span><b>*</b> 付费方式</span>
          <select
            aria-label="付费方式"
            disabled={peopleLetter}
            onChange={(event) => updateDraft({
              paymentMethod: event.target.value as ServiceDraft['paymentMethod'],
              stampAmountCents: null,
            }, 'paymentMethod')}
            value={draft.paymentMethod}
          >
            <option value="cash-settlement">现结</option>
            {!isStandardExpress ? <option value="stamp">贴票</option> : null}
            {!isStandardExpress ? <option value="self-affixed">自贴票</option> : null}
            {hasAgreement ? <option value="credit">记欠</option> : null}
          </select>
          <ServiceFieldError message={errors.paymentMethod} />
        </label>

        {draft.paymentMethod === 'stamp' ? (
          <label>
            <span><b>*</b> 贴票总金额（元）</span>
            <CurrencyInput
              aria-label="贴票总金额"
              onValueChange={(valueCents) => updateDraft(
                { stampAmountCents: valueCents },
                'stampAmountCents',
              )}
              valueCents={draft.stampAmountCents}
            />
            <ServiceFieldError message={errors.stampAmountCents} />
          </label>
        ) : null}

        {returnReceipt?.offered ? (
          <label className="service-return-receipt-field">
            <span>回执</span>
            <span className="service-checkbox-line">
              <input
                aria-label="办理回执"
                checked={draft.returnReceiptRequested}
                disabled={!returnReceipt.eligible}
                onChange={(event) => updateDraft(
                  { returnReceiptRequested: event.target.checked },
                  'returnReceiptRequested',
                )}
                type="checkbox"
              />
              <span>
                {returnReceipt.eligible
                  ? `办理回执（每件 ¥ ${formatCents(returnReceipt.feeCents)}）`
                  : returnReceipt.reason}
              </span>
            </span>
            <ServiceFieldError message={errors.returnReceiptRequested} />
          </label>
        ) : null}

        <label className="service-note-field">
          <span>办理备注</span>
          <input
            aria-label="办理备注"
            maxLength={80}
            onChange={(event) => updateDraft(
              { operatorNote: event.target.value },
              'operatorNote',
            )}
            placeholder="最多 80 个字符"
            value={draft.operatorNote}
          />
          <ServiceFieldError message={errors.operatorNote} />
        </label>
      </fieldset>

      {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
      {errors.form ? <p className="customer-form-error" role="alert">{errors.form}</p> : null}

      <div className="charge-strip" aria-label="费用摘要">
        <div>
          <span>{baseChargeLabel}</span>
          <strong>¥ {formatCents(quote?.baseWeightCents ?? 0)}</strong>
        </div>
        <div>
          <span>{additionalChargeLabel}</span>
          <strong>¥ {formatCents(quote?.additionalWeightCents ?? 0)}</strong>
        </div>
        {isRegisteredMail ? (
          <div>
            <span>{selectedProduct?.additionalServiceFeeCents ? '给据/约投费' : '挂号费'}</span>
            <strong>
              ¥ {formatCents(
                quote && selectedProduct
                  ? registrationFeeCents * draft.quantity
                  : 0,
              )}
            </strong>
          </div>
        ) : null}
        {returnReceipt?.offered ? (
          <div>
            <span>回执费</span>
            <strong>¥ {formatCents(quote?.returnReceiptCents ?? 0)}</strong>
          </div>
        ) : null}
        {(quote?.discountCents ?? 0) > 0 ? (
          <div className="charge-discount">
            <span>平台优惠</span>
            <strong>- ¥ {formatCents(quote?.discountCents ?? 0)}</strong>
          </div>
        ) : null}
        <div>
          <span>贴票销售</span>
          <strong>¥ {formatCents(quote?.stampSaleCents ?? 0)}</strong>
        </div>
        <div>
          <span>结算应收</span>
          <strong>¥ {formatCents(quote?.settlementDueCents ?? 0)}</strong>
        </div>
        <div className="charge-total">
          <span>总资费</span>
          <strong>¥ {formatCents(quote?.postageCents ?? 0)}</strong>
        </div>
      </div>
      <div className="service-primary-action">
        {quote ? (
          <button
            className="primary-button primary-button--compact"
            disabled={submitting}
            onClick={() => void submitService()}
            type="button"
          >
            {submitting ? '正在提交…' : '提交'}
          </button>
        ) : (
          <button
            className="primary-button primary-button--compact"
            onClick={() => void priceService()}
            type="button"
          >
            计费
          </button>
        )}
      </div>
      {contentItemsOpen && isHomeParcel ? (
        <ServiceContentItemsModal
          initialLines={draft.contentItems}
          onCancel={() => setContentItemsOpen(false)}
          onSave={saveContentItems}
          stockFor={contentItemStock}
        />
      ) : null}
      {appointmentOpen ? (
        <AppointmentCollectionModal
          onCancel={() => setAppointmentOpen(false)}
          onSelect={applyAppointmentOrder}
          workspace={workspace}
        />
      ) : null}
      {receiptTransaction ? (
        <ServiceReceiptModal
          mode="initial"
          onClose={closeInitialReceipt}
          transaction={receiptTransaction}
        />
      ) : null}
    </section>
  )
}

export type { ServiceSummary }
