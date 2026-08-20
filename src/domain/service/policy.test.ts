import { describe, expect, it } from 'vitest'

import {
  internationalTariffGroup,
  isValidS10,
  isValidRegisteredS10,
  s10CheckDigit,
} from './international'
import {
  calculateServiceCharge,
  destinationZoneLabel,
  effectiveBusinessCode,
  searchServiceProducts,
  serviceChargeableWeightGrams,
  serviceContentItemsTotalCents,
  serviceContentSummary,
  serviceItemCodeRule,
  serviceMaxWeightGrams,
  serviceVolumeWeightGrams,
  validateServiceDraft,
  yuanToCents,
} from './policy'
import {
  POSTAL_SUPPLY_ITEMS,
  SERVICE_PRODUCT_GROUPS,
  SERVICE_PRODUCTS,
  createEmptyServiceDraft,
} from './seed'
import type {
  ServiceDestinationZone,
  ServiceDraft,
  ServiceProduct,
  ServiceProductId,
  ServiceRemark,
} from './types'

function product(id: ServiceProductId): ServiceProduct {
  const match = SERVICE_PRODUCTS.find((item) => item.id === id)
  if (!match) throw new Error(`Missing service product ${id}`)
  return match
}

function productByCode(code: string): ServiceProduct {
  const match = SERVICE_PRODUCTS.find((item) => item.searchCode === code)
  if (!match) throw new Error(`Missing service product code ${code}`)
  return match
}

describe('money conversion', () => {
  it('converts decimal yuan to exact integer cents', () => {
    expect(yuanToCents('8.2')).toBe(820)
    expect(yuanToCents(8.2)).toBe(820)
    expect(yuanToCents('0.01')).toBe(1)
    expect(() => yuanToCents('8.201')).toThrow('最多两位小数')
  })
})

function validDraftForProduct(selected: ServiceProduct): {
  draft: ServiceDraft
  hasAgreement: boolean
} {
  const destinationZone = selected.destinationZones[0]!
  const hasAgreement = selected.requiresAgreement
  const rule = serviceItemCodeRule(selected, destinationZone)
  const itemCode = rule === 'seven-prefix-13-digits'
    ? '7000818316568'
    : rule === 'registered-domestic-13'
      ? 'XK00000000001'
      : rule === 'registered-international-s10'
        ? 'RR473124829CN'
        : rule === 'parcel-domestic-13'
          ? 'PM13131313435'
          : rule === 'parcel-international-s10'
            ? 'CP123456785CN'
            : rule === 'express-domestic-12'
              ? '901234567835'
              : rule === 'express-international-s10'
                ? 'EE123456785CN'
                : rule === 'standard-express-13'
                  ? '8970000000X99'
                   : ''
  const contentItem = POSTAL_SUPPLY_ITEMS[0]!

  return {
    hasAgreement,
    draft: {
      ...createEmptyServiceDraft(hasAgreement, destinationZone),
      productId: selected.id,
      destinationOffice: destinationZone === 'international' ? 'AU' : '',
      itemCode,
      remark: selected.remarkOptions[0] ?? 'ordinary-letter',
      weightGrams: Math.min(20, selected.maxWeightGrams),
      postcardBarcode: selected.tariffKind === 'fixed-parcel-sticker'
        ? '12345678901234'
        : '',
      parcelTariffZone:
        selected.tariffKind === 'ordinary-parcel' || selected.searchCode === '404'
          ? '1'
          : '',
      platformQuoteCents:
        selected.tariffKind === 'platform-parcel' ||
        selected.tariffKind === 'platform-express'
          ? 1200
          : null,
      contentItems: selected.searchCode === '301'
        ? [{
            itemId: contentItem.id,
            label: contentItem.label,
            mnemonic: contentItem.mnemonic,
            unit: contentItem.unit,
            unitPriceCents: contentItem.unitPriceCents,
            quantity: 1,
            amountCents: contentItem.unitPriceCents,
          }]
        : [],
    },
  }
}

describe('service policy', () => {
  it('exposes two-digit parents and only three-digit operator-selectable products', () => {
    const basicProducts = SERVICE_PRODUCTS.filter(
      (item) => item.productFamily === 'basic-letter',
    )
    expect(searchServiceProducts(basicProducts, '107').map((item) => item.id))
      .toEqual(['barcode-letter-107'])
    expect(searchServiceProducts(basicProducts, '条码平信').map((item) => item.searchCode))
      .toEqual(['107', '108'])
    expect(searchServiceProducts(basicProducts, '106')).toEqual([])
    expect(SERVICE_PRODUCTS.every((item) => item.searchCode.length === 3)).toBe(true)
    expect(SERVICE_PRODUCT_GROUPS.find((group) => group.code === '11')).toMatchObject({
      label: '平常印刷品',
      items: [
        { code: '110', label: '平常印刷品' },
        { code: '111', label: '盲人邮件' },
        { code: '112', label: '平常印刷品专袋' },
        { code: '113', label: '跨境平常印刷品' },
        { code: '114', label: '协议平常印刷品' },
        { code: '115', label: '协议客户平常印刷品' },
        { code: '117', label: '条码平刷' },
        { code: '118', label: '巡视平刷' },
      ],
    })
    expect(SERVICE_PRODUCTS.find((item) => item.searchCode === '114')).toMatchObject({
      label: '协议平常印刷品',
      destinationZones: ['local', 'nonlocal'],
      requiresAgreement: true,
      pricingBasis: 'agreement-baseline',
    })
  })

  it('maps every catalog child to one executable product and a valid route', () => {
    const catalogItems = SERVICE_PRODUCT_GROUPS.flatMap((group) => group.items)
    const catalogCodes = catalogItems.map((item) => item.code)
    const productCodes = SERVICE_PRODUCTS.map((item) => item.searchCode)

    expect(catalogItems).toHaveLength(92)
    expect(new Set(catalogCodes).size).toBe(catalogItems.length)
    expect(new Set(productCodes).size).toBe(SERVICE_PRODUCTS.length)
    expect(productCodes).toEqual(catalogCodes)

    for (const selected of SERVICE_PRODUCTS) {
      const { draft, hasAgreement } = validDraftForProduct(selected)
      expect(
        validateServiceDraft(draft, SERVICE_PRODUCTS, hasAgreement),
        `${selected.searchCode} ${selected.label}`,
      ).toEqual({ valid: true, errors: {} })
      expect(effectiveBusinessCode(selected, draft.destinationZone))
        .toMatch(new RegExp(`^${selected.searchCode}\\d{3}$`))
      const charge = calculateServiceCharge(draft, selected)
      expect(Number.isFinite(charge.postageCents)).toBe(true)
      expect(charge.postageCents).toBeGreaterThanOrEqual(0)
    }
  })

  it('exposes the complete parcel and express product trees with three-character products', () => {
    expect(SERVICE_PRODUCT_GROUPS.find((group) => group.code === '30')?.items)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: '300', label: '普通包裹' }),
        expect.objectContaining({ code: '307', label: '家乡包裹贴' }),
        expect.objectContaining({ code: '30A', label: '巡视普通包裹' }),
      ]))
    expect(SERVICE_PRODUCT_GROUPS.find((group) => group.code === '31')?.items)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: '310', label: '快递包裹' }),
        expect.objectContaining({ code: '31A', label: '巡视快递包裹' }),
      ]))
    expect(SERVICE_PRODUCT_GROUPS.find((group) => group.code === '40')?.items)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: '400', label: '特快专递' }),
        expect.objectContaining({ code: '403', label: '投递揽收特快' }),
        expect.objectContaining({ code: '404', label: '标准快递' }),
      ]))
    expect(productByCode('4A0').destinationZones).toEqual([
      'international',
      'special-free-trade-port',
      'special-mirror-sea-port',
      'special-beautiful-island',
    ])
  })

  it('prices domestic ordinary parcels by tariff zone and chargeable volume weight', () => {
    const selected = productByCode('300')
    const draft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: selected.id,
      itemCode: 'PM13131313435',
      parcelTariffZone: '3' as const,
      weightGrams: 1500,
    }
    expect(validateServiceDraft(draft, [selected], false)).toEqual({
      valid: true,
      errors: {},
    })
    expect(calculateServiceCharge(draft, selected)).toMatchObject({
      baseWeightCents: 700,
      additionalWeightCents: 200,
      postageCents: 900,
    })

    const bulky = { ...draft, lengthCm: 65, widthCm: 22, heightCm: 23 }
    expect(serviceVolumeWeightGrams(bulky, selected)).toBe(5482)
    expect(serviceChargeableWeightGrams(bulky, selected)).toBe(5482)
    expect(calculateServiceCharge(bulky, selected).postageCents).toBe(1700)
  })

  it('enforces the 307 fixed bands, volumetric limit, and 14-digit postcard barcode', () => {
    const selected = productByCode('307')
    const base = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: selected.id,
      itemCode: 'PU13131313435',
      postcardBarcode: '12345678901234',
      remark: 'parcel-4' as const,
      weightGrams: 900,
    }
    expect(calculateServiceCharge(base, selected).postageCents).toBe(400)
    const bulky = { ...base, lengthCm: 20, widthCm: 20, heightCm: 51 }
    expect(serviceVolumeWeightGrams(bulky, selected)).toBe(3400)
    expect(validateServiceDraft(bulky, [selected], false).errors.weightGrams)
      .toContain('计费重量')
    expect(validateServiceDraft(
      { ...bulky, remark: 'parcel-11' },
      [selected],
      false,
    )).toEqual({ valid: true, errors: {} })
    expect(calculateServiceCharge(
      { ...bulky, remark: 'parcel-11' },
      selected,
    ).postageCents).toBe(1100)
    expect(validateServiceDraft(
      { ...base, postcardBarcode: '1234' },
      [selected],
      false,
    ).errors.postcardBarcode).toContain('14 位')
  })

  it('requires valid selected item lines for 301 and derives their read-only summary', () => {
    const selected = productByCode('301')
    const item = POSTAL_SUPPLY_ITEMS[0]!
    const base = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: selected.id,
      itemCode: 'PA13131313435',
      weightGrams: 1000,
      platformQuoteCents: 2000,
    }
    expect(validateServiceDraft(base, [selected], false).errors.contentItems)
      .toContain('至少一种内件')

    const line = {
      itemId: item.id,
      label: item.label,
      mnemonic: item.mnemonic,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      quantity: 2,
      amountCents: item.unitPriceCents * 2,
    }
    const complete = {
      ...base,
      contents: serviceContentSummary([line]),
      contentItems: [line],
    }
    expect(validateServiceDraft(complete, [selected], false))
      .toEqual({ valid: true, errors: {} })
    expect(complete.contents).toBe(`${item.label}×2`)
    expect(serviceContentItemsTotalCents(complete.contentItems))
      .toBe(item.unitPriceCents * 2)
    expect(validateServiceDraft({
      ...complete,
      contentItems: [{ ...line, amountCents: 1 }],
    }, [selected], false).errors.contentItems).toContain('无效')
  })

  it('keeps platform-priced fast parcels executable without inventing a fixed tariff', () => {
    const selected = productByCode('310')
    const draft = {
      ...createEmptyServiceDraft(false, 'nonlocal'),
      productId: selected.id,
      itemCode: 'KM13131313435',
      weightGrams: 20000,
      platformQuoteCents: 1850,
    }
    expect(validateServiceDraft(draft, [selected], false)).toEqual({
      valid: true,
      errors: {},
    })
    expect(calculateServiceCharge(draft, selected).postageCents).toBe(1850)
    expect(validateServiceDraft(
      { ...draft, platformQuoteCents: null },
      [selected],
      false,
    ).errors.platformQuoteCents).toContain('模拟报价')
    expect(validateServiceDraft(
      { ...draft, weightGrams: 20001 },
      [selected],
      false,
    ).errors.weightGrams).toContain('20000 克')
  })

  it('separates general express S10 rules from the 404 number range and volumetric divisor', () => {
    expect(isValidS10('EE123456785CN', 'express')).toBe(true)
    expect(isValidS10('CP123456785CN', 'parcel')).toBe(true)

    const general = productByCode('400')
    const generalDraft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: general.id,
      itemCode: '901234567835',
      remark: 'document' as const,
      weightGrams: 500,
      platformQuoteCents: 2100,
    }
    expect(validateServiceDraft(generalDraft, [general], false)).toEqual({
      valid: true,
      errors: {},
    })
    expect(validateServiceDraft(
      { ...generalDraft, remark: 'goods', contents: '' },
      [general],
      false,
    ).errors.contents).toContain('内件信息')

    const standard = productByCode('404')
    const standardDraft = {
      ...createEmptyServiceDraft(false, 'nonlocal'),
      productId: standard.id,
      itemCode: '8970000000X99',
      remark: 'goods' as const,
      contents: '演示文件袋',
      lengthCm: 50,
      widthCm: 30,
      heightCm: 20,
      parcelTariffZone: '6' as const,
      weightGrams: 1000,
      platformQuoteCents: 2200,
    }
    expect(serviceVolumeWeightGrams(standardDraft, standard)).toBe(6000)
    expect(validateServiceDraft(standardDraft, [standard], false)).toEqual({
      valid: true,
      errors: {},
    })
    expect(calculateServiceCharge(standardDraft, standard).postageCents).toBe(2200)
    expect(validateServiceDraft(
      { ...standardDraft, itemCode: '8900000000X99' },
      [standard],
      false,
    ).errors.itemCode).toContain('89 + 8 位流水号 + X99')
    expect(validateServiceDraft(
      { ...standardDraft, paymentMethod: 'stamp', stampAmountCents: 2200 },
      [standard],
      false,
    ).errors.paymentMethod).toContain('不提供贴票')
    expect(validateServiceDraft(
      { ...standardDraft, declaredValueCents: 5_000_001 },
      [standard],
      false,
    ).errors.declaredValueCents).toContain('50000.00 元')
  })

  it('keeps route availability aligned with the detailed product table', () => {
    const routeProfiles: Array<{
      codes: string[]
      zones: ServiceDestinationZone[]
    }> = [
      {
        codes: ['100', '101', '110', '111', '120', '130', '200', '201', '210', '211', '220', '230'],
        zones: ['local', 'nonlocal', 'international', 'special-free-trade-port', 'special-mirror-sea-port', 'special-beautiful-island'],
      },
      {
        codes: ['102', '103', '107', '108', '113', '114', '117', '118', '131', '132', '133', '140', '208', '213', '214', '218', '231', '232', '233', '240', '241', '242', '243', '244', '252', '258', '260', '261'],
        zones: ['local', 'nonlocal'],
      },
      {
        codes: ['105', '115', '151', '152', '205', '215', '251', '257'],
        zones: ['international'],
      },
      {
        codes: ['112', '150', '212', '250'],
        zones: ['international', 'special-free-trade-port', 'special-mirror-sea-port', 'special-beautiful-island'],
      },
      {
        codes: ['104'],
        zones: ['international', 'special-free-trade-port', 'special-mirror-sea-port'],
      },
      {
        codes: ['253'],
        zones: ['international', 'special-beautiful-island'],
      },
      {
        codes: ['255', '256'],
        zones: ['special-beautiful-island'],
      },
    ]

    expect(routeProfiles.flatMap((profile) => profile.codes)).toHaveLength(56)
    for (const profile of routeProfiles) {
      for (const code of profile.codes) {
        expect(productByCode(code).destinationZones, code).toEqual(profile.zones)
      }
    }

    expect(productByCode('103').label).toBe('跨境平常信函')
    expect(productByCode('130').label).toBe('平常商业信函')
    expect(productByCode('151')).toMatchObject({
      label: '协议平常小包',
      destinationZones: ['international'],
      requiresAgreement: true,
    })
    expect(productByCode('201')).toMatchObject({
      label: '给据邮简',
      tariffKind: 'mailgram',
    })
    expect(productByCode('215')).toMatchObject({
      label: '协议客户印刷品',
      destinationZones: ['international'],
    })
    expect(productByCode('230').label).toBe('给据商业信函')
  })

  it('combines the three-digit product and required region into the final business code', () => {
    const barcodeLetter = product('barcode-letter-107')
    const registeredLetter = product('registered-letter-200')

    expect(effectiveBusinessCode(barcodeLetter, 'local')).toBe('107000')
    expect(effectiveBusinessCode(barcodeLetter, 'nonlocal')).toBe('107100')
    expect(effectiveBusinessCode(registeredLetter, 'international')).toBe('200200')
    expect(effectiveBusinessCode(
      productByCode('253'),
      'special-beautiful-island',
    )).toBe('253400')
    expect(effectiveBusinessCode(registeredLetter, '')).toBe('')
  })

  it('keeps three special-region semantics behind neutral public aliases', () => {
    expect(destinationZoneLabel('special-free-trade-port')).toBe('特区（自贸港）')
    expect(destinationZoneLabel('special-mirror-sea-port')).toBe('特区（镜海埠）')
    expect(destinationZoneLabel('special-beautiful-island')).toBe('特区（美丽岛）')
    expect(destinationZoneLabel('')).toBe('未选择')
  })

  it('calculates the same 107 product across address-derived domestic regions', () => {
    const selected = product('barcode-letter-107')
    const local20 = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: selected.id,
      itemCode: '7000818316568',
      weightGrams: 20,
    }
    expect(calculateServiceCharge(local20, selected)).toMatchObject({
      baseWeightCents: 80,
      additionalWeightCents: 0,
      postageCents: 80,
      settlementDueCents: 80,
    })
    expect(calculateServiceCharge(
      { ...local20, weightGrams: 101 },
      selected,
    ).postageCents).toBe(520)
    expect(calculateServiceCharge(
      { ...local20, destinationZone: 'nonlocal', weightGrams: 101 },
      selected,
    ).postageCents).toBe(800)
  })

  it('uses the 107 remark to price both domestic postcard routes at 0.80', () => {
    const selected = product('barcode-letter-107')
    const localDraft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: selected.id,
      itemCode: '7000818316568',
      remark: 'postcard' as const,
      weightGrams: 20,
    }
    const nonlocalDraft = { ...localDraft, destinationZone: 'nonlocal' as const }

    expect(calculateServiceCharge(localDraft, selected).postageCents).toBe(80)
    expect(calculateServiceCharge(nonlocalDraft, selected).postageCents).toBe(80)
    expect(serviceMaxWeightGrams(localDraft, selected)).toBe(20)
    expect(validateServiceDraft(
      { ...localDraft, weightGrams: 21 },
      [selected],
      false,
    ).errors.weightGrams).toContain('1 至 20 克')
  })

  it('prices international 100 letters by destination group and 120 postcards per item', () => {
    expect(internationalTariffGroup('JP')).toBe(1)
    expect(internationalTariffGroup('SG')).toBe(2)
    expect(internationalTariffGroup('AU')).toBe(3)
    expect(internationalTariffGroup('BR')).toBe(4)

    const letter = product('ordinary-letter-100')
    const draft = {
      ...createEmptyServiceDraft(false, 'international'),
      productId: letter.id,
      destinationOffice: 'AU',
      weightGrams: 20,
    }
    expect(calculateServiceCharge(draft, letter).postageCents).toBe(600)
    expect(calculateServiceCharge({ ...draft, weightGrams: 21 }, letter).postageCents)
      .toBe(780)

    const postcard = product('ordinary-postcard-120')
    expect(calculateServiceCharge(
      { ...draft, productId: postcard.id, weightGrams: 12 },
      postcard,
    ).postageCents).toBe(500)
  })

  it.each([
    ['barcode-letter-107', '107', '107000', 'local', 'ordinary-letter', 80],
    ['barcode-letter-107', '107', '107100', 'nonlocal', 'ordinary-letter', 120],
    ['barcode-letter-107', '107', '107000', 'local', 'postcard', 80],
    ['barcode-letter-107', '107', '107100', 'nonlocal', 'postcard', 80],
    ['barcode-printed-matter-117', '117', '117000', 'local', 'ordinary-letter', 80],
    ['barcode-printed-matter-117', '117', '117100', 'nonlocal', 'ordinary-letter', 120],
    ['ordinary-letter-100', '100', '100200', 'international', 'ordinary-letter', 600],
    ['ordinary-postcard-120', '120', '120200', 'international', 'ordinary-letter', 500],
    ['registered-letter-200', '200', '200000', 'local', 'ordinary-letter', 380],
    ['registered-letter-200', '200', '200100', 'nonlocal', 'ordinary-letter', 420],
    ['registered-letter-200', '200', '200200', 'international', 'ordinary-letter', 2200],
    ['registered-printed-matter-210', '210', '210000', 'local', 'ordinary-letter', 380],
    ['registered-printed-matter-210', '210', '210100', 'nonlocal', 'ordinary-letter', 420],
    ['registered-postcard-220', '220', '220000', 'local', 'ordinary-letter', 380],
    ['registered-postcard-220', '220', '220100', 'nonlocal', 'ordinary-letter', 380],
    ['registered-postcard-220', '220', '220200', 'international', 'ordinary-letter', 2100],
  ] as const)(
    'validates product %s and derives business %s',
    (productId, productCode, businessCode, destinationZone, remark, expectedPostageCents) => {
      const selected = product(productId)
      const international = destinationZone === 'international'
      const registered = productId.startsWith('registered-')
      const barcode = productId.startsWith('barcode-')
      const draft = {
        ...createEmptyServiceDraft(false, destinationZone as ServiceDestinationZone),
        productId: selected.id,
        destinationOffice: international ? 'AU' : '',
        itemCode: registered
          ? international ? 'RR473124829CN' : 'XK00000000001'
          : barcode ? '7000818316568' : '',
        remark: remark as ServiceRemark,
        weightGrams: 20,
      }

      expect(selected.searchCode).toBe(productCode)
      expect(selected.destinationZones).toContain(destinationZone)
      expect(effectiveBusinessCode(selected, draft.destinationZone)).toBe(businessCode)
      expect(validateServiceDraft(draft, [selected], false)).toEqual({
        valid: true,
        errors: {},
      })
      expect(calculateServiceCharge(draft, selected).postageCents)
        .toBe(expectedPostageCents)
    },
  )

  it('switches the 200 product number rule by region and validates S10', () => {
    expect(s10CheckDigit('47312482')).toBe(9)
    expect(isValidRegisteredS10('RR473124829CN')).toBe(true)
    expect(isValidRegisteredS10('RR473124820CN')).toBe(false)

    const registered = product('registered-letter-200')
    expect(serviceItemCodeRule(registered, 'local')).toBe('registered-domestic-13')
    expect(serviceItemCodeRule(registered, 'international'))
      .toBe('registered-international-s10')
    const draft = {
      ...createEmptyServiceDraft(false, 'international'),
      productId: registered.id,
      destinationOffice: 'AU',
      itemCode: 'RR473124829CN',
      weightGrams: 20,
    }
    expect(validateServiceDraft(draft, [registered], false)).toEqual({
      valid: true,
      errors: {},
    })
    expect(calculateServiceCharge(draft, registered)).toMatchObject({
      baseWeightCents: 600,
      postageCents: 2200,
      settlementDueCents: 2200,
    })
    expect(validateServiceDraft(
      { ...draft, itemCode: 'XK00000000001' },
      [registered],
      false,
    ).errors.itemCode).toContain('S10')
  })

  it('requires an explicit region and keeps international ordinary items numberless', () => {
    const international = product('ordinary-letter-100')
    const valid = {
      ...createEmptyServiceDraft(false, 'international'),
      productId: international.id,
      destinationOffice: 'AU',
      itemCode: '',
      weightGrams: 20,
    }
    expect(validateServiceDraft(valid, [international], false)).toEqual({
      valid: true,
      errors: {},
    })
    expect(validateServiceDraft(
      { ...valid, destinationZone: '', destinationOffice: '' },
      [international],
      false,
    ).errors.destinationZone).toBe('请选择区域。')
    const restricted = productByCode('104')
    expect(validateServiceDraft(
      {
        ...valid,
        productId: restricted.id,
        destinationZone: 'local',
        destinationOffice: '',
      },
      [restricted],
      false,
    ).errors.destinationZone).toContain('不支持所选区域')
  })

  it('reuses the established public tariff formulas across the full families', () => {
    const cases: Array<{
      code: string
      zone: ServiceDestinationZone
      weight: number
      destinationOffice?: string
      expected: number
    }> = [
      { code: '101', zone: 'local', weight: 20, expected: 80 },
      { code: '101', zone: 'nonlocal', weight: 20, expected: 120 },
      { code: '102', zone: 'local', weight: 20, expected: 0 },
      { code: '111', zone: 'local', weight: 20, expected: 0 },
      { code: '114', zone: 'local', weight: 20, expected: 80 },
      { code: '110', zone: 'special-free-trade-port', weight: 20, expected: 450 },
      { code: '112', zone: 'international', destinationOffice: 'AU', weight: 5000, expected: 73000 },
      { code: '150', zone: 'international', destinationOffice: 'AU', weight: 101, expected: 6800 },
      { code: '201', zone: 'local', weight: 20, expected: 380 },
      { code: '240', zone: 'local', weight: 20, expected: 580 },
    ]

    for (const fixture of cases) {
      const selected = productByCode(fixture.code)
      const draft = {
        ...createEmptyServiceDraft(selected.requiresAgreement, fixture.zone),
        productId: selected.id,
        destinationOffice: fixture.destinationOffice ?? '',
        itemCode: selected.productFamily === 'standard-delivery'
          ? fixture.zone === 'international'
            ? 'RR473124829CN'
            : 'XK00000000001'
          : '',
        weightGrams: fixture.weight,
      }
      expect(calculateServiceCharge(draft, selected).postageCents,
        `${fixture.code} ${fixture.zone}`,
      ).toBe(fixture.expected)
    }
  })

  it('requires an agreement account for agreement-only catalog products', () => {
    const agreementPrintedMatter = productByCode('114')
    const printedMatterDraft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: agreementPrintedMatter.id,
      weightGrams: 20,
    }
    expect(validateServiceDraft(
      printedMatterDraft,
      [agreementPrintedMatter],
      false,
    ).errors.productId).toContain('仅允许已选择协议账户')
    expect(validateServiceDraft(
      { ...printedMatterDraft, paymentMethod: 'credit' },
      [agreementPrintedMatter],
      true,
    )).toEqual({ valid: true, errors: {} })

    const selected = productByCode('240')
    const draft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: selected.id,
      itemCode: 'XK00000000001',
      weightGrams: 20,
    }
    expect(validateServiceDraft(draft, [selected], false).errors.productId)
      .toContain('仅允许已选择协议账户')
    expect(validateServiceDraft(
      { ...draft, paymentMethod: 'credit' },
      [selected],
      true,
    )).toEqual({ valid: true, errors: {} })
  })

  it('requires a 7-prefix 13-digit barcode for 107', () => {
    const selected = product('barcode-letter-107')
    const draft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: selected.id,
      itemCode: '9000818316568',
      weightGrams: 20,
    }
    expect(validateServiceDraft(draft, [selected], false).errors.itemCode)
      .toContain('7 开头的 13 位')
    expect(validateServiceDraft(
      { ...draft, itemCode: '7000818316568' },
      [selected],
      false,
    )).toEqual({ valid: true, errors: {} })
  })

  it('applies the verified printed-matter steps to 117 and 210', () => {
    const ordinary = product('barcode-printed-matter-117')
    const ordinaryDraft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: ordinary.id,
      itemCode: '7000818316568',
      weightGrams: 101,
    }
    expect(calculateServiceCharge(ordinaryDraft, ordinary)).toMatchObject({
      baseWeightCents: 80,
      additionalWeightCents: 20,
      postageCents: 100,
    })

    const registered = product('registered-printed-matter-210')
    const registeredDraft = {
      ...createEmptyServiceDraft(false, 'nonlocal'),
      productId: registered.id,
      itemCode: 'XK00000000001',
      weightGrams: 101,
    }
    expect(validateServiceDraft(registeredDraft, [registered], false))
      .toEqual({ valid: true, errors: {} })
    expect(calculateServiceCharge(registeredDraft, registered)).toMatchObject({
      baseWeightCents: 120,
      additionalWeightCents: 40,
      postageCents: 460,
    })
  })

  it('keeps the verified zero-postage people-letter behavior on 107', () => {
    const selected = product('barcode-letter-107')
    const draft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: selected.id,
      itemCode: '7000818316568',
      remark: 'people-letter' as const,
      paymentMethod: 'self-affixed' as const,
      weightGrams: 20,
    }
    expect(validateServiceDraft(draft, [selected], false)).toEqual({
      valid: true,
      errors: {},
    })
    expect(calculateServiceCharge(draft, selected)).toMatchObject({
      postageCents: 0,
      settlementDueCents: 0,
    })
  })

  it('only allows an agreement customer to enter more than one item', () => {
    const registered = product('registered-letter-200')
    const draft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: registered.id,
      itemCode: 'XK00000000001',
      weightGrams: 20,
      quantity: 2,
    }
    expect(validateServiceDraft(draft, [registered], false).errors.quantity)
      .toContain('协议客户')
    expect(validateServiceDraft(draft, [registered], true)).toEqual({
      valid: true,
      errors: {},
    })
  })

  it('separates cash, purchased stamps, and self-affixed postage', () => {
    const letter = product('barcode-letter-107')
    const base = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: letter.id,
      itemCode: '7000818316568',
      weightGrams: 20,
    }
    expect(calculateServiceCharge(base, letter).settlementDueCents).toBe(80)
    expect(calculateServiceCharge(
      { ...base, paymentMethod: 'self-affixed' },
      letter,
    )).toMatchObject({ postageCents: 80, settlementDueCents: 0 })
    const stamp = {
      ...base,
      paymentMethod: 'stamp' as const,
      stampAmountCents: 100,
    }
    expect(calculateServiceCharge(stamp, letter)).toMatchObject({
      stampSaleCents: 100,
      settlementDueCents: 100,
    })
  })
})
