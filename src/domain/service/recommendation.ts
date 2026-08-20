import type { ProductFamily } from '../customer/types'
import {
  calculateServiceCharge,
  effectiveBusinessCode,
  serviceMaxWeightGrams,
  serviceRequiresPlatformQuote,
} from './policy'
import { createEmptyServiceDraft } from './seed'
import type {
  ChargeSummary,
  ServiceDestinationZone,
  ServiceProduct,
  ServiceProductId,
  ServiceRemark,
} from './types'

export type RecommendationMailType = 'document' | 'goods'

export interface RecommendationCriteria {
  mailType: RecommendationMailType
  weightGrams: number
  destinationZone: Exclude<ServiceDestinationZone, ''>
  destinationOffice: string
  destinationLabel: string
  requestedDeliveryDays: number | null
}

export interface ServiceRecommendation {
  product: ServiceProduct
  effectiveBusinessCode: string
  recommendationLevel: 1
  remark: ServiceRemark
  charge: ChargeSummary | null
  deliveryDays: number | null
}

export interface ServiceRecommendationTransfer {
  id: string
  productId: ServiceProductId
  productFamily: ProductFamily
  destinationZone: Exclude<ServiceDestinationZone, ''>
  destinationOffice: string
  destinationLabel: string
  weightGrams: number
  remark: ServiceRemark
}

const DOCUMENT_PRODUCT_CODES = ['100', '110', '200', '210', '400'] as const
const GOODS_PRODUCT_CODES = ['150', '250', '300', '310', '400'] as const

export function normalizeRecommendationCriteria(
  criteria: RecommendationCriteria,
): RecommendationCriteria {
  if (!Number.isInteger(criteria.weightGrams) || criteria.weightGrams < 1) {
    throw new Error('请输入大于 0 的整数重量。')
  }
  if (!criteria.destinationOffice.trim() || !criteria.destinationLabel.trim()) {
    throw new Error('请选择寄达局。')
  }
  if (
    criteria.requestedDeliveryDays !== null &&
    (!Number.isInteger(criteria.requestedDeliveryDays) ||
      criteria.requestedDeliveryDays < 1)
  ) {
    throw new Error('寄达时限须为大于 0 的整数天数。')
  }
  return {
    ...criteria,
    destinationOffice: criteria.destinationOffice.trim(),
    destinationLabel: criteria.destinationLabel.trim(),
  }
}

function candidateCodes(type: RecommendationMailType): readonly string[] {
  return type === 'document' ? DOCUMENT_PRODUCT_CODES : GOODS_PRODUCT_CODES
}

function recommendationRemark(
  product: ServiceProduct,
  mailType: RecommendationMailType,
): ServiceRemark {
  if (mailType === 'document' && product.remarkOptions.includes('document')) {
    return 'document'
  }
  if (mailType === 'goods' && product.remarkOptions.includes('goods')) {
    return 'goods'
  }
  return product.remarkOptions[0] ?? 'ordinary-letter'
}

function recommendationCharge(
  product: ServiceProduct,
  criteria: RecommendationCriteria,
  remark: ServiceRemark,
): ChargeSummary | null {
  const draft = {
    ...createEmptyServiceDraft(false, criteria.destinationZone),
    productId: product.id,
    destinationOffice: criteria.destinationOffice,
    weightGrams: criteria.weightGrams,
    remark,
  }

  // Platform-returned prices and route-zone prices are not derivable from the
  // guide alone. Keeping them unresolved avoids fabricating an authoritative
  // amount in the recommendation table.
  if (
    serviceRequiresPlatformQuote(draft, product) ||
    product.tariffKind === 'ordinary-parcel'
  ) {
    return null
  }

  return calculateServiceCharge(draft, product)
}

export function recommendServiceProducts(
  products: ServiceProduct[],
  criteria: RecommendationCriteria,
  hasAgreement: boolean,
): ServiceRecommendation[] {
  const normalized = normalizeRecommendationCriteria(criteria)
  const orderedCodes = candidateCodes(normalized.mailType)
  const order = new Map(orderedCodes.map((code, index) => [code, index]))

  return products
    .filter((product) => order.has(product.searchCode))
    .filter((product) => product.destinationZones.includes(normalized.destinationZone))
    .filter((product) => hasAgreement || !product.requiresAgreement)
    .filter((product) => {
      const remark = recommendationRemark(product, normalized.mailType)
      const draft = {
        ...createEmptyServiceDraft(hasAgreement, normalized.destinationZone),
        remark,
      }
      return normalized.weightGrams <= serviceMaxWeightGrams(draft, product)
    })
    .sort((left, right) =>
      (order.get(left.searchCode) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.searchCode) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((product) => {
      const remark = recommendationRemark(product, normalized.mailType)
      return {
        product,
        effectiveBusinessCode: effectiveBusinessCode(
          product,
          normalized.destinationZone,
        ),
        recommendationLevel: 1,
        remark,
        charge: recommendationCharge(product, normalized, remark),
        // The inspected Chapter 3 example leaves this result column blank.
        // Preserve that state until an evidence-backed time-limit table exists.
        deliveryDays: null,
      }
    })
}

export function createRecommendationTransfer(
  recommendation: ServiceRecommendation,
  criteria: RecommendationCriteria,
): ServiceRecommendationTransfer {
  return {
    id: `${Date.now()}-${recommendation.product.id}`,
    productId: recommendation.product.id,
    productFamily: recommendation.product.productFamily,
    destinationZone: criteria.destinationZone,
    destinationOffice: criteria.destinationOffice,
    destinationLabel: criteria.destinationLabel,
    weightGrams: criteria.weightGrams,
    remark: recommendation.remark,
  }
}
