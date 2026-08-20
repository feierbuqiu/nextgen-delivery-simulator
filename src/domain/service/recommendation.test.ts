import { describe, expect, it } from 'vitest'

import { SERVICE_PRODUCTS } from './seed'
import {
  normalizeRecommendationCriteria,
  recommendServiceProducts,
} from './recommendation'

describe('recommendServiceProducts', () => {
  it('reproduces the public-tariff rows in the Chapter 3 document example', () => {
    const rows = recommendServiceProducts(SERVICE_PRODUCTS, {
      mailType: 'document',
      weightGrams: 300,
      destinationZone: 'nonlocal',
      destinationOffice: '澄野市',
      destinationLabel: '澄岐省 / 澄野市',
      requestedDeliveryDays: null,
    }, false)

    expect(rows.map((row) => row.effectiveBusinessCode)).toEqual([
      '100100',
      '110100',
      '200100',
      '210100',
      '400100',
    ])
    expect(rows.slice(0, 4).map((row) => row.charge?.postageCents)).toEqual([
      1000,
      200,
      1300,
      500,
    ])
    expect(rows[4]?.charge).toBeNull()
    expect(rows.every((row) => row.recommendationLevel === 1)).toBe(true)
  })

  it('uses the goods candidate set and rejects products over their weight limit', () => {
    const rows = recommendServiceProducts(SERVICE_PRODUCTS, {
      mailType: 'goods',
      weightGrams: 2500,
      destinationZone: 'nonlocal',
      destinationOffice: '云港区',
      destinationLabel: '瀚原 / 栖沄 / 云港',
      requestedDeliveryDays: 5,
    }, false)

    expect(rows.map((row) => row.product.searchCode)).toEqual(['300', '310', '400'])
    expect(rows.every((row) => row.product.destinationZones.includes('nonlocal'))).toBe(true)
  })

  it('keeps recommendation criteria validation in the domain layer', () => {
    const valid = {
      mailType: 'document' as const,
      weightGrams: 300,
      destinationZone: 'nonlocal' as const,
      destinationOffice: ' 澄野市 ',
      destinationLabel: ' 澄岐省 / 澄野市 ',
      requestedDeliveryDays: null,
    }
    expect(normalizeRecommendationCriteria(valid)).toMatchObject({
      destinationOffice: '澄野市',
      destinationLabel: '澄岐省 / 澄野市',
    })
    expect(() => normalizeRecommendationCriteria({
      ...valid,
      weightGrams: 0,
    })).toThrow('请输入大于 0 的整数重量')
    expect(() => normalizeRecommendationCriteria({
      ...valid,
      destinationOffice: '',
    })).toThrow('请选择寄达局')
    expect(() => normalizeRecommendationCriteria({
      ...valid,
      requestedDeliveryDays: 0,
    })).toThrow('寄达时限须为大于 0 的整数天数')
  })
})
