import type {
  ChargeSummary,
  PostalSupplySaleLine,
  ServiceDestinationZone,
  ServiceDraft,
  ServicePaymentMethod,
  ServiceProduct,
} from './types'
import {
  INTERNATIONAL_DESTINATIONS,
  internationalTariffGroup,
  isValidS10,
  isValidRegisteredS10,
} from './international'
import { returnReceiptEligibility } from './returnReceipt'

export type ServiceField =
  | 'productId'
  | 'destinationZone'
  | 'destinationOffice'
  | 'itemCode'
  | 'remark'
  | 'weightGrams'
  | 'quantity'
  | 'paymentMethod'
  | 'stampAmountCents'
  | 'packaging'
  | 'lengthCm'
  | 'widthCm'
  | 'heightCm'
  | 'declaredValueCents'
  | 'insuranceValueCents'
  | 'contents'
  | 'contentItems'
  | 'postcardBarcode'
  | 'parcelTariffZone'
  | 'platformQuoteCents'
  | 'returnReceiptRequested'
  | 'operatorNote'
  | 'form'

export type ServiceErrors = Partial<Record<ServiceField, string>>

export interface ServiceValidationResult {
  valid: boolean
  errors: ServiceErrors
}

const DOMESTIC_ZONES: ServiceDestinationZone[] = ['local', 'nonlocal']
const INTERNATIONAL_LIKE_ZONES: ServiceDestinationZone[] = [
  'international',
  'special-free-trade-port',
  'special-mirror-sea-port',
  'special-beautiful-island',
]

export function serviceContentItemsTotalCents(
  lines: PostalSupplySaleLine[],
): number {
  return lines.reduce(
    (total, line) => total + line.unitPriceCents * line.quantity,
    0,
  )
}

export function serviceContentSummary(lines: PostalSupplySaleLine[]): string {
  return lines.map((line) => `${line.label}×${line.quantity}`).join('、')
}

export type ResolvedItemCodeRule =
  | 'none'
  | 'seven-prefix-13-digits'
  | 'registered-domestic-13'
  | 'registered-international-s10'
  | 'parcel-domestic-13'
  | 'parcel-international-s10'
  | 'express-domestic-12'
  | 'express-international-s10'
  | 'standard-express-13'

export function isDomesticBarcodeLetter(product: ServiceProduct): boolean {
  return product.parentCode === '10' &&
    product.itemCodeRule === 'seven-prefix-13-digits'
}

export function serviceItemCodeRule(
  product: ServiceProduct,
  zone: ServiceDestinationZone,
): ResolvedItemCodeRule {
  if (product.itemCodeRule === 'parcel-by-zone') {
    return INTERNATIONAL_LIKE_ZONES.includes(zone)
      ? 'parcel-international-s10'
      : 'parcel-domestic-13'
  }
  if (product.itemCodeRule === 'express-by-zone') {
    return INTERNATIONAL_LIKE_ZONES.includes(zone)
      ? 'express-international-s10'
      : 'express-domestic-12'
  }
  if (product.itemCodeRule !== 'registered-by-zone') return product.itemCodeRule
  if (!zone) return 'none'
  return INTERNATIONAL_LIKE_ZONES.includes(zone)
    ? 'registered-international-s10'
    : 'registered-domestic-13'
}

export function serviceRegistrationFeeCents(
  product: ServiceProduct,
  zone: ServiceDestinationZone,
): number {
  const registrationFee = INTERNATIONAL_LIKE_ZONES.includes(zone)
    ? product.internationalRegistrationFeeCents
    : product.domesticRegistrationFeeCents
  return registrationFee + product.additionalServiceFeeCents
}

export function effectiveBusinessCode(
  product: ServiceProduct,
  zone: ServiceDestinationZone,
): string {
  const suffixes: Record<ServiceDestinationZone, string> = {
    '': '',
    local: '000',
    nonlocal: '100',
    international: '200',
    'special-free-trade-port': '300',
    'special-mirror-sea-port': '300',
    'special-beautiful-island': '400',
  }
  return zone ? `${product.searchCode}${suffixes[zone]}` : ''
}

export function usesPostcardTariff(
  draft: ServiceDraft,
  product: ServiceProduct,
): boolean {
  return product.tariffKind === 'domestic-postcard' ||
    product.tariffKind === 'return-card' ||
    (product.remarkOptions.includes('postcard') && draft.remark === 'postcard')
}

export function serviceMaxWeightGrams(
  draft: ServiceDraft,
  product: ServiceProduct,
): number {
  if (product.tariffKind === 'fixed-parcel-sticker') {
    const limits = {
      'parcel-4': 1000,
      'parcel-6': 3000,
      'parcel-11': 5000,
    } as const
    if (draft.remark in limits) {
      return limits[draft.remark as keyof typeof limits]
    }
  }
  if (usesPostcardTariff(draft, product)) return 20
  if (
    INTERNATIONAL_LIKE_ZONES.includes(draft.destinationZone) &&
    product.tariffKind === 'domestic-printed-matter'
  ) {
    return 2000
  }
  return product.maxWeightGrams
}

export function serviceRequiresPlatformQuote(
  draft: ServiceDraft,
  product: ServiceProduct,
): boolean {
  if (
    product.productFamily === 'parcel' &&
    (draft.declaredValueCents !== null || draft.insuranceValueCents !== null)
  ) return true
  if (product.tariffKind === 'platform-parcel' ||
    product.tariffKind === 'platform-express') return true
  return product.tariffKind === 'ordinary-parcel' &&
    !DOMESTIC_ZONES.includes(draft.destinationZone)
}

function validDimension(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function hasCompleteDimensions(draft: ServiceDraft): boolean {
  return validDimension(draft.lengthCm) &&
    validDimension(draft.widthCm) &&
    validDimension(draft.heightCm)
}

export function serviceVolumeWeightGrams(
  draft: ServiceDraft,
  product: ServiceProduct,
): number {
  if (!hasCompleteDimensions(draft)) return 0
  const length = draft.lengthCm!
  const width = draft.widthCm!
  const height = draft.heightCm!
  const volume = length * width * height

  if (product.searchCode === '404') {
    if (length + width + height < 100) return 0
    const route = Number(draft.parcelTariffZone)
    const divisor = route >= 6 ? 5000 : 8000
    return Math.ceil((volume / divisor) * 1000)
  }
  if (product.productFamily === 'parcel') {
    if (Math.max(length, width, height) <= 50) return 0
    return Math.ceil((volume / 6000) * 1000)
  }
  if (product.productFamily === 'express') {
    return Math.ceil((volume / 6000) * 1000)
  }
  return 0
}

export function serviceChargeableWeightGrams(
  draft: ServiceDraft,
  product: ServiceProduct,
): number {
  return Math.max(draft.weightGrams ?? 0, serviceVolumeWeightGrams(draft, product))
}

export function serviceDeclaredValueLimitCents(product: ServiceProduct): number {
  if (product.searchCode === '404') return 5_000_000
  if (product.searchCode === '310') return 3_000_000
  if (product.productFamily === 'express') return 50_000_000
  return 10_000_000
}

function normalizedCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function searchServiceProducts(
  products: ServiceProduct[],
  query: string,
): ServiceProduct[] {
  const term = query.trim()
  if (!term) return products
  const codeTerm = normalizedCode(term)
  if (codeTerm.length >= 2 && /^[A-Z0-9-]+$/i.test(term)) {
    return products.filter((product) =>
      normalizedCode(product.searchCode).includes(codeTerm),
    )
  }
  if (Array.from(term).length < 2) return []
  return products.filter((product) => product.label.includes(term))
}

function domesticBaseRate(zone: ServiceDestinationZone): number {
  return zone === 'local' ? 80 : 120
}

const INTERNATIONAL_AIR_LETTER_BASE_CENTS = [500, 550, 600, 700] as const
const INTERNATIONAL_AIR_LETTER_ADDITIONAL_CENTS = [100, 150, 180, 230] as const
const INTERNATIONAL_AIR_PRINTED_BASE_CENTS = [450, 500, 600] as const
const INTERNATIONAL_AIR_PRINTED_ADDITIONAL_CENTS = [220, 250, 280] as const
const INTERNATIONAL_AIR_BLIND_CENTS = [60, 80, 100] as const
const INTERNATIONAL_AIR_PACKET_BASE_CENTS = [2500, 3000, 3500] as const
const INTERNATIONAL_AIR_PACKET_ADDITIONAL_CENTS = [2300, 2700, 3300] as const
const INTERNATIONAL_AIR_BAG_BASE_CENTS = [48500, 61000, 73000] as const
const INTERNATIONAL_AIR_BAG_ADDITIONAL_CENTS = [10000, 12000, 14500] as const

interface TariffComponents {
  baseWeightCents: number
  additionalWeightCents: number
}

function stepsBeyond(weight: number, firstWeight: number, stepWeight: number): number {
  return Math.max(0, Math.ceil((weight - firstWeight) / stepWeight))
}

function effectiveTariffKind(
  draft: ServiceDraft,
  product: ServiceProduct,
): ServiceProduct['tariffKind'] {
  return usesPostcardTariff(draft, product)
    ? 'domestic-postcard'
    : product.tariffKind
}

function domesticTariff(
  weight: number,
  zone: ServiceDestinationZone,
  tariffKind: ServiceProduct['tariffKind'],
): TariffComponents {
  if (tariffKind === 'conscript-mail' || tariffKind === 'blind-mail') {
    return { baseWeightCents: 0, additionalWeightCents: 0 }
  }
  if (tariffKind === 'domestic-postcard' || tariffKind === 'return-card') {
    return { baseWeightCents: 80, additionalWeightCents: 0 }
  }
  if (tariffKind === 'mailgram') {
    return {
      baseWeightCents: zone === 'local' ? 80 : 120,
      additionalWeightCents: 0,
    }
  }
  if (tariffKind === 'domestic-letter') {
    const unit = domesticBaseRate(zone)
    if (weight <= 100) {
      return {
        baseWeightCents: Math.ceil(weight / 20) * unit,
        additionalWeightCents: 0,
      }
    }
    return {
      baseWeightCents: unit * 5,
      additionalWeightCents:
        stepsBeyond(weight, 100, 100) * (zone === 'local' ? 120 : 200),
    }
  }
  if (tariffKind === 'domestic-printed-matter') {
    return {
      baseWeightCents: weight > 0 ? domesticBaseRate(zone) : 0,
      additionalWeightCents:
        stepsBeyond(weight, 100, 100) * (zone === 'local' ? 20 : 40),
    }
  }
  if (tariffKind === 'small-packet') {
    return {
      baseWeightCents: zone === 'local' ? 500 : 600,
      additionalWeightCents:
        stepsBeyond(weight, 1000, 500) * (zone === 'local' ? 100 : 150),
    }
  }
  return { baseWeightCents: 0, additionalWeightCents: 0 }
}

function internationalTariff(
  weight: number,
  destinationOffice: string,
  tariffKind: ServiceProduct['tariffKind'],
): TariffComponents {
  const group = internationalTariffGroup(destinationOffice)
  const zoneIndex = group - 1
  const groupIndex = Math.min(2, zoneIndex)
  if (tariffKind === 'domestic-postcard' || tariffKind === 'return-card') {
    return { baseWeightCents: 500, additionalWeightCents: 0 }
  }
  if (tariffKind === 'mailgram') {
    return { baseWeightCents: 550, additionalWeightCents: 0 }
  }
  if (tariffKind === 'blind-mail') {
    return {
      baseWeightCents: 0,
      additionalWeightCents:
        INTERNATIONAL_AIR_BLIND_CENTS[groupIndex]! * Math.ceil(weight / 10),
    }
  }
  if (tariffKind === 'domestic-printed-matter') {
    return {
      baseWeightCents: INTERNATIONAL_AIR_PRINTED_BASE_CENTS[groupIndex]!,
      additionalWeightCents:
        stepsBeyond(weight, 20, 10) *
        INTERNATIONAL_AIR_PRINTED_ADDITIONAL_CENTS[groupIndex]!,
    }
  }
  if (tariffKind === 'small-packet') {
    return {
      baseWeightCents: INTERNATIONAL_AIR_PACKET_BASE_CENTS[groupIndex]!,
      additionalWeightCents:
        stepsBeyond(weight, 100, 100) *
        INTERNATIONAL_AIR_PACKET_ADDITIONAL_CENTS[groupIndex]!,
    }
  }
  if (tariffKind === 'printed-matter-bag') {
    return {
      baseWeightCents: INTERNATIONAL_AIR_BAG_BASE_CENTS[groupIndex]!,
      additionalWeightCents:
        stepsBeyond(weight, 5000, 1000) *
        INTERNATIONAL_AIR_BAG_ADDITIONAL_CENTS[groupIndex]!,
    }
  }
  return {
    baseWeightCents: INTERNATIONAL_AIR_LETTER_BASE_CENTS[zoneIndex]!,
    additionalWeightCents:
      stepsBeyond(weight, 20, 10) *
      INTERNATIONAL_AIR_LETTER_ADDITIONAL_CENTS[zoneIndex]!,
  }
}

function specialLetterSurfaceCents(weight: number): number {
  const bands = [
    [20, 150],
    [50, 280],
    [100, 400],
    [250, 850],
    [500, 1670],
    [1000, 3170],
    [2000, 5580],
  ] as const
  return bands.find(([limit]) => weight <= limit)?.[1] ?? 0
}

function specialTariff(
  weight: number,
  tariffKind: ServiceProduct['tariffKind'],
): TariffComponents {
  const airFee = 50 * Math.ceil(weight / 10)
  if (tariffKind === 'domestic-postcard' || tariffKind === 'return-card') {
    return { baseWeightCents: 350, additionalWeightCents: 50 }
  }
  if (tariffKind === 'mailgram') {
    return { baseWeightCents: 180, additionalWeightCents: 0 }
  }
  if (tariffKind === 'blind-mail') {
    return { baseWeightCents: 0, additionalWeightCents: airFee }
  }
  if (tariffKind === 'domestic-printed-matter') {
    return {
      baseWeightCents: 350,
      additionalWeightCents: 130 * stepsBeyond(weight, 20, 10) + airFee,
    }
  }
  if (tariffKind === 'small-packet') {
    return {
      baseWeightCents: 1500,
      additionalWeightCents: 1300 * stepsBeyond(weight, 100, 100) + airFee,
    }
  }
  if (tariffKind === 'printed-matter-bag') {
    return {
      baseWeightCents: 18000,
      additionalWeightCents: 4500 * stepsBeyond(weight, 5000, 1000) + airFee,
    }
  }
  return {
    baseWeightCents: specialLetterSurfaceCents(weight),
    additionalWeightCents: airFee,
  }
}

function ordinaryParcelTariff(
  weightGrams: number,
  tariffZone: ServiceDraft['parcelTariffZone'],
): TariffComponents {
  const rates = {
    '1': [500, 100],
    '2': [600, 150],
    '3': [700, 200],
    '4': [800, 300],
    '5': [900, 400],
    '6': [1000, 500],
  } as const
  const [firstKilogramCents, continuationCents] =
    rates[tariffZone as keyof typeof rates] ?? [0, 0]
  return {
    baseWeightCents: weightGrams > 0 ? firstKilogramCents : 0,
    additionalWeightCents:
      stepsBeyond(weightGrams, 1000, 1000) * continuationCents,
  }
}

function parcelOrExpressTariff(
  draft: ServiceDraft,
  product: ServiceProduct,
): TariffComponents | null {
  const weight = serviceChargeableWeightGrams(draft, product)
  if (serviceRequiresPlatformQuote(draft, product)) {
    return {
      baseWeightCents: draft.platformQuoteCents ?? 0,
      additionalWeightCents: 0,
    }
  }
  if (product.tariffKind === 'fixed-parcel-sticker') {
    const fixed = {
      'parcel-4': 400,
      'parcel-6': 600,
      'parcel-11': 1100,
    } as const
    return {
      baseWeightCents: fixed[draft.remark as keyof typeof fixed] ?? 0,
      additionalWeightCents: 0,
    }
  }
  if (
    product.tariffKind === 'ordinary-parcel' &&
    DOMESTIC_ZONES.includes(draft.destinationZone)
  ) {
    return ordinaryParcelTariff(weight, draft.parcelTariffZone)
  }
  return null
}

export function calculateServiceCharge(
  draft: ServiceDraft,
  product: ServiceProduct,
): ChargeSummary {
  const weight = draft.weightGrams ?? 0
  const isPeopleLetter =
    isDomesticBarcodeLetter(product) && draft.remark === 'people-letter'
  const tariffKind = effectiveTariffKind(draft, product)
  let components: TariffComponents
  const parcelOrExpress = parcelOrExpressTariff(draft, product)
  if (parcelOrExpress) {
    components = parcelOrExpress
  } else if (isPeopleLetter) {
    components = { baseWeightCents: 0, additionalWeightCents: 0 }
  } else if (DOMESTIC_ZONES.includes(draft.destinationZone)) {
    components = domesticTariff(weight, draft.destinationZone, tariffKind)
  } else if (draft.destinationZone === 'international') {
    components = internationalTariff(weight, draft.destinationOffice, tariffKind)
  } else {
    components = specialTariff(weight, tariffKind)
  }

  const { baseWeightCents, additionalWeightCents } = components

  const registrationFeeCents = serviceRegistrationFeeCents(
    product,
    draft.destinationZone,
  )
  const returnReceiptCents = draft.returnReceiptRequested
    ? returnReceiptEligibility(product, draft.destinationZone).feeCents * draft.quantity
    : 0
  const undiscountedPostageCents =
    (baseWeightCents + additionalWeightCents + registrationFeeCents) *
    draft.quantity + returnReceiptCents
  const discountCents = Math.min(
    Math.max(0, draft.appointment?.discountCents ?? 0),
    undiscountedPostageCents,
  )
  const postageCents = undiscountedPostageCents - discountCents
  const stampSaleCents = draft.paymentMethod === 'stamp'
    ? (draft.stampAmountCents ?? 0)
    : 0
  const settlementDueCents = settlementDueForPayment(
    draft.paymentMethod,
    postageCents,
    stampSaleCents,
  )

  return {
    baseWeightCents: baseWeightCents * draft.quantity,
    additionalWeightCents: additionalWeightCents * draft.quantity,
    returnReceiptCents,
    discountCents,
    postageCents,
    stampSaleCents,
    settlementDueCents,
    totalCents: postageCents,
  }
}

function settlementDueForPayment(
  method: ServicePaymentMethod,
  postageCents: number,
  stampSaleCents: number,
): number {
  if (method === 'cash-settlement') return postageCents
  if (method === 'stamp') return stampSaleCents
  return 0
}

export function validateServiceDraft(
  draft: ServiceDraft,
  products: ServiceProduct[],
  hasAgreement: boolean,
): ServiceValidationResult {
  const errors: ServiceErrors = {}
  const product = products.find((item) => item.id === draft.productId)

  if (!product) errors.productId = '请选择业务产品。'
  if (product?.requiresAgreement && !hasAgreement) {
    errors.productId = `${product.label}（${product.searchCode}）仅允许已选择协议账户的客户办理。`
  }
  if (draft.returnReceiptRequested && product) {
    const eligibility = returnReceiptEligibility(product, draft.destinationZone)
    if (!eligibility.eligible) {
      errors.returnReceiptRequested = eligibility.reason
    } else if (draft.quantity !== 1) {
      errors.returnReceiptRequested = '回执业务须逐件办理，每笔收寄件数必须为 1。'
    }
  }
  if (!draft.destinationZone) {
    errors.destinationZone = '请选择区域。'
  } else if (product && !product.destinationZones.includes(draft.destinationZone)) {
    errors.destinationZone = `业务产品 ${product.label}（${product.searchCode}）不支持所选区域，请重新选择区域。`
  }
  if (draft.destinationZone === 'international' && !draft.destinationOffice.trim()) {
    errors.destinationOffice = '国际区域需要选择寄达局（目标国家或地区）。'
  } else if (
    draft.destinationZone === 'international' &&
    !INTERNATIONAL_DESTINATIONS.some(
      (destination) => destination.code === draft.destinationOffice.trim().toUpperCase(),
    )
  ) {
    errors.destinationOffice = '请选择列表中的国际寄达局。'
  }
  const itemCodeRule = product
    ? serviceItemCodeRule(product, draft.destinationZone)
    : 'none'
  if (
    product &&
    itemCodeRule === 'seven-prefix-13-digits' &&
    !/^7\d{12}$/.test(draft.itemCode.trim())
  ) {
    errors.itemCode = `${product.label}（${product.searchCode}）的邮件条码必须为 7 开头的 13 位纯数字。`
  }
  if (
    product &&
    itemCodeRule === 'registered-domestic-13' &&
    !/^[A-Z]{2}\d{11}$/.test(draft.itemCode.trim())
  ) {
    errors.itemCode = `${product.label}（${product.searchCode}）的邮件号码须为 13 位：前 2 位大写字母，后 11 位数字。`
  }
  if (
    product &&
    itemCodeRule === 'registered-international-s10' &&
    !isValidRegisteredS10(draft.itemCode)
  ) {
    errors.itemCode = `${product.label}（${product.searchCode}）须使用有效的 13 位 S10 号码：R 开头、8 位流水号、1 位校验码和 2 位签发国代码。`
  }
  if (
    product &&
    itemCodeRule === 'parcel-domestic-13' &&
    !/^[A-Z]{2}\d{11}$/.test(draft.itemCode.trim().toUpperCase())
  ) {
    errors.itemCode = `${product.label}（${product.searchCode}）的国内邮件号码须为 13 位：前 2 位大写字母，后 11 位数字。`
  }
  if (
    product &&
    itemCodeRule === 'parcel-international-s10' &&
    !isValidS10(draft.itemCode, 'parcel')
  ) {
    errors.itemCode = `${product.label}（${product.searchCode}）须使用有效的 13 位 C 类 S10 包裹号码。`
  }
  if (
    product &&
    itemCodeRule === 'express-domestic-12' &&
    !/^\d{12}$/.test(draft.itemCode.trim())
  ) {
    errors.itemCode = `${product.label}（${product.searchCode}）的国内邮件条码须为 12 位纯数字。`
  }
  if (
    product &&
    itemCodeRule === 'express-international-s10' &&
    !isValidS10(draft.itemCode, 'express')
  ) {
    errors.itemCode = `${product.label}（${product.searchCode}）须使用有效的 13 位 E 类 S10 特快号码。`
  }
  if (product && itemCodeRule === 'standard-express-13') {
    const match = /^89(\d{8})X99$/.exec(draft.itemCode.trim().toUpperCase())
    if (!match || Number(match[1]) < 1) {
      errors.itemCode = `${product.label}（${product.searchCode}）须使用 89 + 8 位流水号 + X99 的 13 位号码；流水号范围为 00000001 至 99999999。`
    }
  }
  if (
    product?.tariffKind === 'fixed-parcel-sticker' &&
    !/^\d{14}$/.test(draft.postcardBarcode.trim())
  ) {
    errors.postcardBarcode = '家乡包裹贴必须录入 14 位纯数字明信片条码。'
  }
  if (product?.searchCode === '301') {
    if (draft.contentItems.length === 0) {
      errors.contentItems = '家乡包裹必须从用邮物品信息窗口选择至少一种内件。'
    } else {
      const itemIds = new Set(draft.contentItems.map((line) => line.itemId))
      const malformed = itemIds.size !== draft.contentItems.length ||
        draft.contentItems.some((line) =>
          !line.itemId ||
          !line.label.trim() ||
          !Number.isInteger(line.unitPriceCents) ||
          line.unitPriceCents < 0 ||
          !Number.isInteger(line.quantity) ||
          line.quantity < 1 ||
          line.amountCents !== line.unitPriceCents * line.quantity,
        )
      if (malformed) {
        errors.contentItems = '用邮物品明细无效，请重新打开选择窗口并保存。'
      }
    }
  }
  if (
    product &&
    product.remarkOptions.length > 0 &&
    !product.remarkOptions.includes(draft.remark)
  ) {
    errors.remark = '请选择该业务产品支持的邮件备注。'
  }
  const maxWeightGrams = product
    ? serviceMaxWeightGrams(draft, product)
    : 2000
  if (
    !Number.isInteger(draft.weightGrams) ||
    (draft.weightGrams ?? 0) < 1 ||
    (draft.weightGrams ?? 0) > maxWeightGrams
  ) {
    errors.weightGrams = `重量须为 1 至 ${maxWeightGrams} 克的整数。`
  }
  if (
    product &&
    !errors.weightGrams &&
    serviceChargeableWeightGrams(draft, product) > maxWeightGrams
  ) {
    errors.weightGrams = `计费重量（实际重量与体积重量取大值）不得超过 ${maxWeightGrams} 克。`
  }
  const dimensions = [
    ['lengthCm', draft.lengthCm],
    ['widthCm', draft.widthCm],
    ['heightCm', draft.heightCm],
  ] as const
  const hasAnyDimension = dimensions.some(([, value]) => value !== null)
  if (hasAnyDimension || (product?.productFamily === 'express' && draft.remark === 'goods')) {
    for (const [field, value] of dimensions) {
      if (!validDimension(value) || value > 300) {
        errors[field] = '长、宽、高须成套填写，且每项须大于 0 并不超过 300 厘米。'
      }
    }
  }
  if (product?.productFamily === 'express' && draft.remark === 'goods' && !draft.contents.trim()) {
    errors.contents = '邮件备注为“物”时必须选择或填写内件信息。'
  }
  if (Array.from(draft.contents).length > 60) {
    errors.contents = '内件信息不得超过 60 个字符。'
  }
  if (Array.from(draft.packaging).length > 40) {
    errors.packaging = '包装物说明不得超过 40 个字符。'
  }
  if (
    product?.tariffKind === 'ordinary-parcel' &&
    DOMESTIC_ZONES.includes(draft.destinationZone) &&
    !['1', '2', '3', '4', '5', '6'].includes(draft.parcelTariffZone)
  ) {
    errors.parcelTariffZone = '普通包裹须选择 1 至 6 区的公开资费区档。'
  }
  if (
    product?.searchCode === '404' &&
    !['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(draft.parcelTariffZone)
  ) {
    errors.parcelTariffZone = '标准快递须选择寄递平台返回的 1 至 10 区。'
  }
  if (product && serviceRequiresPlatformQuote(draft, product)) {
    if (!Number.isInteger(draft.platformQuoteCents) || (draft.platformQuoteCents ?? 0) < 1) {
      errors.platformQuoteCents = '请输入本次寄递平台返回的每件模拟报价。'
    }
  }
  if (draft.declaredValueCents !== null && draft.insuranceValueCents !== null) {
    errors.declaredValueCents = '保价金额与保险金额互斥，只能填写一项。'
    errors.insuranceValueCents = '保价金额与保险金额互斥，只能填写一项。'
  }
  if (product) {
    const valueLimit = serviceDeclaredValueLimitCents(product)
    for (const [field, value] of [
      ['declaredValueCents', draft.declaredValueCents],
      ['insuranceValueCents', draft.insuranceValueCents],
    ] as const) {
      if (value !== null && (!Number.isInteger(value) || value < 1 || value > valueLimit)) {
        errors[field] = `金额须大于 0 且不得超过 ${formatCents(valueLimit)} 元。`
      }
    }
  }
  if (!Number.isInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > 99) {
    errors.quantity = '件数须为 1 至 99 的整数。'
  }
  if (!hasAgreement && draft.quantity !== 1) {
    errors.quantity = '零星客户每次按 1 件受理；协议客户才允许录入邮件件数。'
  }
  if (draft.paymentMethod === 'credit' && !hasAgreement) {
    errors.paymentMethod = '记欠只对已选择协议账户的客户开放。'
  }
  if (
    product?.searchCode === '404' &&
    (draft.paymentMethod === 'stamp' || draft.paymentMethod === 'self-affixed')
  ) {
    errors.paymentMethod = '标准快递不提供贴票或自贴票付费方式。'
  }
  if (Array.from(draft.operatorNote).length > 80) {
    errors.operatorNote = '办理备注不得超过 80 个字符。'
  }
  if (product && draft.paymentMethod === 'stamp') {
    const charge = calculateServiceCharge(draft, product)
    if (
      !Number.isInteger(draft.stampAmountCents) ||
      (draft.stampAmountCents ?? 0) < charge.postageCents
    ) {
      errors.stampAmountCents = `贴票总金额不得少于资费 ${formatCents(charge.postageCents)} 元。`
    }
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** Converts decimal yuan to integer cents without binary float multiplication. */
export function yuanToCents(value: string | number): number {
  const normalized = String(value).trim()
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/u.exec(normalized)
  if (!match) throw new Error('金额须为最多两位小数的数字。')
  const sign = match[1] === '-' ? -1n : 1n
  const cents = sign * (
    BigInt(match[2]!) * 100n
    + BigInt((match[3] ?? '').padEnd(2, '0') || '0')
  )
  const result = Number(cents)
  if (!Number.isSafeInteger(result)) throw new Error('金额超出安全范围。')
  return result
}

export function destinationZoneLabel(zone: ServiceDestinationZone): string {
  const labels: Record<ServiceDestinationZone, string> = {
    '': '未选择',
    local: '本埠',
    nonlocal: '外埠',
    international: '国际',
    'special-free-trade-port': '特区（自贸港）',
    'special-mirror-sea-port': '特区（镜海埠）',
    'special-beautiful-island': '特区（美丽岛）',
  }
  return labels[zone]
}

export function paymentMethodLabel(method: ServicePaymentMethod): string {
  const labels: Record<ServicePaymentMethod, string> = {
    'cash-settlement': '现结',
    stamp: '贴票',
    'self-affixed': '自贴票',
    credit: '记欠',
  }
  return labels[method]
}
