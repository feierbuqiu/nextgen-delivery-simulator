import type {
  PostalSupplyItem,
  ServiceDraft,
  ServiceDestinationZone,
  ServiceProduct,
  ServiceProductGroup,
  ServiceProductId,
  ServiceRemark,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
  WindowDeliveryItem,
  WindowDeliveryMoney,
} from './types'
import { fictionalDetailedAddress } from '../customer/postalAdministrativeDirectory'
import { createSpotCheckExerciseSeedRecords } from './spotCheckExercise'

const DOMESTIC_ROUTES = ['local', 'nonlocal'] as const
const SPECIAL_COMBINED_ROUTES = [
  'special-free-trade-port',
  'special-mirror-sea-port',
] as const
const SPECIAL_ROUTES = [
  ...SPECIAL_COMBINED_ROUTES,
  'special-beautiful-island',
] as const
const OVERSEAS_ROUTES = ['international', ...SPECIAL_ROUTES] as const
const INTERNATIONAL_AND_COMBINED_SPECIAL_ROUTES = [
  'international',
  ...SPECIAL_COMBINED_ROUTES,
] as const
const ALL_ROUTES = [...DOMESTIC_ROUTES, ...OVERSEAS_ROUTES] as const

type ProductFamily = ServiceProduct['productFamily']
type TariffKind = ServiceProduct['tariffKind']
type PricingBasis = ServiceProduct['pricingBasis']

interface ProductDefinition {
  code: string
  label: string
  tariffKind: TariffKind
  zones: readonly ServiceDestinationZone[]
  id?: ServiceProductId
  itemCodeRule?: ServiceProduct['itemCodeRule']
  remarkOptions?: ServiceRemark[]
  requiresRecipient?: boolean
  requiresAgreement?: boolean
  domesticRegistrationFeeCents?: number
  internationalRegistrationFeeCents?: number
  additionalServiceFeeCents?: number
  maxWeightGrams?: number
  pricingBasis?: PricingBasis
}

interface ProductGroupDefinition {
  code: string
  label: string
  productFamily: ProductFamily
  items: ProductDefinition[]
}

const PRODUCT_ID_OVERRIDES: Partial<Record<string, ServiceProductId>> = {
  '100': 'ordinary-letter-100',
  '107': 'barcode-letter-107',
  '117': 'barcode-printed-matter-117',
  '120': 'ordinary-postcard-120',
  '200': 'registered-letter-200',
  '210': 'registered-printed-matter-210',
  '220': 'registered-postcard-220',
}

function defaultMaxWeight(tariffKind: TariffKind): number {
  const limits: Record<TariffKind, number> = {
    'domestic-letter': 2000,
    'domestic-postcard': 20,
    'domestic-printed-matter': 35000,
    mailgram: 20,
    'blind-mail': 7000,
    'conscript-mail': 20,
    'small-packet': 2000,
    'printed-matter-bag': 30000,
    'return-card': 20,
    'ordinary-parcel': 20000,
    'fixed-parcel-sticker': 5000,
    'platform-parcel': 20000,
    'platform-express': 30000,
  }
  return limits[tariffKind]
}

function p(
  code: string,
  label: string,
  tariffKind: TariffKind,
  zones: readonly ServiceDestinationZone[],
  overrides: Omit<ProductDefinition, 'code' | 'label' | 'tariffKind' | 'zones'> = {},
): ProductDefinition {
  return { code, label, tariffKind, zones, ...overrides }
}

const PRODUCT_GROUP_DEFINITIONS: ProductGroupDefinition[] = [
  {
    code: '10',
    label: '平常信函',
    productFamily: 'basic-letter',
    items: [
      p('100', '平常信函', 'domestic-letter', ALL_ROUTES),
      p('101', '邮简', 'mailgram', ALL_ROUTES),
      p('102', '义务兵函件', 'conscript-mail', DOMESTIC_ROUTES),
      p('103', '跨境平常信函', 'domestic-letter', DOMESTIC_ROUTES),
      p('104', '国际优先函件', 'domestic-letter', INTERNATIONAL_AND_COMBINED_SPECIAL_ROUTES),
      p('105', '协议客户平常信函', 'domestic-letter', ['international'], {
        requiresAgreement: true,
        pricingBasis: 'agreement-baseline',
      }),
      p('107', '条码平信', 'domestic-letter', DOMESTIC_ROUTES, {
        itemCodeRule: 'seven-prefix-13-digits',
        remarkOptions: ['ordinary-letter', 'postcard', 'people-letter'],
        requiresRecipient: true,
      }),
      p('108', '巡视条码平信', 'domestic-letter', DOMESTIC_ROUTES, {
        itemCodeRule: 'seven-prefix-13-digits',
        remarkOptions: ['ordinary-letter', 'postcard'],
        requiresRecipient: true,
      }),
    ],
  },
  {
    code: '11',
    label: '平常印刷品',
    productFamily: 'basic-letter',
    items: [
      p('110', '平常印刷品', 'domestic-printed-matter', ALL_ROUTES),
      p('111', '盲人邮件', 'blind-mail', ALL_ROUTES),
      p('112', '平常印刷品专袋', 'printed-matter-bag', OVERSEAS_ROUTES),
      p('113', '跨境平常印刷品', 'domestic-printed-matter', DOMESTIC_ROUTES, {
        pricingBasis: 'channel-baseline',
      }),
      p('114', '协议平常印刷品', 'domestic-printed-matter', DOMESTIC_ROUTES, {
        requiresAgreement: true,
        pricingBasis: 'agreement-baseline',
      }),
      p('115', '协议客户平常印刷品', 'domestic-printed-matter', ['international'], {
        requiresAgreement: true,
        pricingBasis: 'agreement-baseline',
      }),
      p('117', '条码平刷', 'domestic-printed-matter', DOMESTIC_ROUTES, {
        itemCodeRule: 'seven-prefix-13-digits',
        requiresRecipient: true,
      }),
      p('118', '巡视平刷', 'domestic-printed-matter', DOMESTIC_ROUTES, {
        itemCodeRule: 'seven-prefix-13-digits',
        requiresRecipient: true,
      }),
    ],
  },
  {
    code: '12',
    label: '明信片',
    productFamily: 'basic-letter',
    items: [p('120', '明信片', 'domestic-postcard', ALL_ROUTES)],
  },
  {
    code: '13',
    label: '平常商业函件',
    productFamily: 'basic-letter',
    items: [
      p('130', '平常商业信函', 'domestic-letter', ALL_ROUTES, { pricingBasis: 'channel-baseline' }),
      p('131', '平常商业印刷品', 'domestic-printed-matter', DOMESTIC_ROUTES, { pricingBasis: 'channel-baseline' }),
      p('132', '平常账单', 'domestic-letter', DOMESTIC_ROUTES, { pricingBasis: 'channel-baseline' }),
      p('133', '非邮平常账单', 'domestic-letter', DOMESTIC_ROUTES, { pricingBasis: 'channel-baseline' }),
    ],
  },
  {
    code: '14',
    label: '回音卡',
    productFamily: 'basic-letter',
    items: [p('140', '回音卡', 'return-card', DOMESTIC_ROUTES)],
  },
  {
    code: '15',
    label: '平常小包',
    productFamily: 'basic-letter',
    items: [
      p('150', '国际平常小包', 'small-packet', OVERSEAS_ROUTES),
      p('151', '协议平常小包', 'small-packet', ['international'], {
        requiresAgreement: true,
        pricingBasis: 'agreement-baseline',
      }),
      p('152', '国际线上平常小包', 'small-packet', ['international'], { pricingBasis: 'channel-baseline' }),
    ],
  },
  {
    code: '20',
    label: '给据信函',
    productFamily: 'standard-delivery',
    items: [
      p('200', '给据信函', 'domestic-letter', ALL_ROUTES, { remarkOptions: ['ordinary-letter', 'people-letter'] }),
      p('201', '给据邮简', 'mailgram', ALL_ROUTES),
      p('205', '协议客户信函', 'domestic-letter', ['international'], {
        requiresAgreement: true,
        pricingBasis: 'agreement-baseline',
      }),
      p('208', '巡视挂信', 'domestic-letter', DOMESTIC_ROUTES),
    ],
  },
  {
    code: '21',
    label: '给据印刷品',
    productFamily: 'standard-delivery',
    items: [
      p('210', '给据印刷品', 'domestic-printed-matter', ALL_ROUTES),
      p('211', '给据盲人邮件', 'blind-mail', ALL_ROUTES),
      p('212', '给据印刷品专袋', 'printed-matter-bag', OVERSEAS_ROUTES, {
        internationalRegistrationFeeCents: 8000,
      }),
      p('213', '给据贺卡奖品', 'domestic-printed-matter', DOMESTIC_ROUTES, { pricingBasis: 'channel-baseline' }),
      p('214', '协议给据印刷品', 'domestic-printed-matter', DOMESTIC_ROUTES, {
        requiresAgreement: true,
        pricingBasis: 'agreement-baseline',
      }),
      p('215', '协议客户印刷品', 'domestic-printed-matter', ['international'], {
        requiresAgreement: true,
        pricingBasis: 'agreement-baseline',
      }),
      p('218', '巡视挂刷', 'domestic-printed-matter', DOMESTIC_ROUTES),
    ],
  },
  {
    code: '22',
    label: '给据明信片',
    productFamily: 'standard-delivery',
    items: [p('220', '给据明信片', 'domestic-postcard', ALL_ROUTES)],
  },
  {
    code: '23',
    label: '给据商业函件',
    productFamily: 'standard-delivery',
    items: [
      p('230', '给据商业信函', 'domestic-letter', ALL_ROUTES, { pricingBasis: 'channel-baseline' }),
      p('231', '给据商业印刷品', 'domestic-printed-matter', DOMESTIC_ROUTES, { pricingBasis: 'channel-baseline' }),
      p('232', '给据账单', 'domestic-letter', DOMESTIC_ROUTES, { pricingBasis: 'channel-baseline' }),
      p('233', '非邮给据账单', 'domestic-letter', DOMESTIC_ROUTES, { pricingBasis: 'channel-baseline' }),
    ],
  },
  {
    code: '24',
    label: '约投挂号信函',
    productFamily: 'standard-delivery',
    items: [
      p('240', '约投挂号账单标资', 'domestic-letter', DOMESTIC_ROUTES, { maxWeightGrams: 500 }),
      p('241', '约投挂号商函标资', 'domestic-letter', DOMESTIC_ROUTES, { maxWeightGrams: 500 }),
      p('242', '约投挂号账单优惠', 'domestic-letter', DOMESTIC_ROUTES, { maxWeightGrams: 500 }),
      p('243', '约投挂号商函优惠', 'domestic-letter', DOMESTIC_ROUTES, { maxWeightGrams: 500 }),
      p('244', '约投挂号邮资封', 'domestic-letter', DOMESTIC_ROUTES, { maxWeightGrams: 500 }),
    ].map((item) => ({
      ...item,
      requiresAgreement: true,
      pricingBasis: 'agreement-baseline' as const,
      additionalServiceFeeCents: 200,
    })),
  },
  {
    code: '25',
    label: '给据小包',
    productFamily: 'standard-delivery',
    items: [
      p('250', '给据小包', 'small-packet', OVERSEAS_ROUTES, { pricingBasis: 'channel-baseline' }),
      p('251', '协议给据小包', 'small-packet', ['international'], {
        requiresAgreement: true,
        pricingBasis: 'agreement-baseline',
      }),
      p('252', '国内小包', 'small-packet', DOMESTIC_ROUTES, { pricingBasis: 'channel-baseline' }),
      p('253', '增强产品', 'small-packet', [
        'international',
        'special-beautiful-island',
      ], { pricingBasis: 'channel-baseline' }),
      p('255', '集货小包', 'small-packet', ['special-beautiful-island'], { pricingBasis: 'channel-baseline' }),
      p('256', '特区往来小包', 'small-packet', ['special-beautiful-island'], { pricingBasis: 'channel-baseline' }),
      p('257', '跨境小包', 'small-packet', ['international'], { pricingBasis: 'channel-baseline' }),
      p('258', '退换货小包', 'small-packet', DOMESTIC_ROUTES, { pricingBasis: 'channel-baseline' }),
    ],
  },
  {
    code: '26',
    label: '定时递',
    productFamily: 'standard-delivery',
    items: [
      p('260', '定时递明信片', 'domestic-postcard', DOMESTIC_ROUTES, {
        requiresAgreement: true,
        pricingBasis: 'agreement-baseline',
      }),
      p('261', '定时递贺卡', 'domestic-postcard', DOMESTIC_ROUTES, {
        requiresAgreement: true,
        pricingBasis: 'agreement-baseline',
      }),
    ],
  },
  {
    code: '30',
    label: '普通包裹',
    productFamily: 'parcel',
    items: [
      p('300', '普通包裹', 'ordinary-parcel', ALL_ROUTES, {
        itemCodeRule: 'parcel-by-zone',
        requiresRecipient: true,
      }),
      p('301', '家乡包裹', 'platform-parcel', DOMESTIC_ROUTES),
      p('302', '项目包裹', 'platform-parcel', DOMESTIC_ROUTES),
      p('303', '爱心包裹', 'platform-parcel', DOMESTIC_ROUTES),
      p('304', '家乡包裹（函包）', 'platform-parcel', DOMESTIC_ROUTES),
      p('305', '母亲邮包', 'platform-parcel', DOMESTIC_ROUTES),
      p('306', '数字大礼包', 'platform-parcel', DOMESTIC_ROUTES),
      p('307', '家乡包裹贴', 'fixed-parcel-sticker', DOMESTIC_ROUTES, {
        remarkOptions: ['parcel-4', 'parcel-6', 'parcel-11'],
        maxWeightGrams: 5000,
      }),
      p('308', '捐赠包裹', 'platform-parcel', DOMESTIC_ROUTES),
      p('309', '旧包裹', 'platform-parcel', DOMESTIC_ROUTES),
      p('30A', '巡视普通包裹', 'platform-parcel', DOMESTIC_ROUTES),
    ].map((item) => ({
      ...item,
      itemCodeRule: item.itemCodeRule ?? 'parcel-by-zone' as const,
      requiresRecipient: true,
      pricingBasis: item.pricingBasis ?? (
        item.tariffKind === 'ordinary-parcel' ||
        item.tariffKind === 'fixed-parcel-sticker'
          ? 'public-standard' as const
          : 'channel-baseline' as const
      ),
    })),
  },
  {
    code: '31',
    label: '快递包裹',
    productFamily: 'parcel',
    items: [
      p('310', '快递包裹', 'platform-parcel', DOMESTIC_ROUTES, {
        maxWeightGrams: 20000,
      }),
      p('311', '小型筒装快包', 'platform-parcel', DOMESTIC_ROUTES),
      p('31A', '巡视快递包裹', 'platform-parcel', DOMESTIC_ROUTES),
    ].map((item) => ({
      ...item,
      itemCodeRule: 'parcel-by-zone' as const,
      requiresRecipient: true,
      pricingBasis: 'channel-baseline' as const,
    })),
  },
  {
    code: '40',
    label: '特快专递',
    productFamily: 'express',
    items: [
      p('400', '特快专递', 'platform-express', ALL_ROUTES),
      p('401', '超常规特快', 'platform-express', DOMESTIC_ROUTES),
      p('402', '文书专递', 'platform-express', DOMESTIC_ROUTES),
      p('403', '投递揽收特快', 'platform-express', ALL_ROUTES),
      p('404', '标准快递', 'platform-express', DOMESTIC_ROUTES, {
        itemCodeRule: 'standard-express-13',
        maxWeightGrams: 30000,
      }),
      p('405', '交管专项特快', 'platform-express', DOMESTIC_ROUTES),
      p('406', '证照专项特快', 'platform-express', DOMESTIC_ROUTES),
      p('408', '巡视特快', 'platform-express', DOMESTIC_ROUTES),
      p('409', '书报专递', 'platform-express', DOMESTIC_ROUTES),
      p('40B', '网购退件', 'platform-express', DOMESTIC_ROUTES),
    ],
  },
  {
    code: '41',
    label: '限时递特快',
    productFamily: 'express',
    items: [
      p('410', '次晨递', 'platform-express', DOMESTIC_ROUTES),
      p('411', '次日递', 'platform-express', DOMESTIC_ROUTES),
      p('412', '同城及时递特快', 'platform-express', ['local']),
    ],
  },
  {
    code: '43',
    label: '专项服务',
    productFamily: 'express',
    items: [
      p('430', '思乡月专项', 'platform-express', ALL_ROUTES),
      p('431', '节庆联送', 'platform-express', ALL_ROUTES),
    ],
  },
  {
    code: '44',
    label: '礼仪特快',
    productFamily: 'express',
    items: [p('440', '鲜花礼仪特快', 'platform-express', DOMESTIC_ROUTES)],
  },
  {
    code: '46',
    label: '特惠箱',
    productFamily: 'express',
    items: [
      p('460', '特惠箱', 'platform-express', ALL_ROUTES),
      p('461', '好运箱', 'platform-express', DOMESTIC_ROUTES),
    ],
  },
  {
    code: '47',
    label: '代收货款',
    productFamily: 'express',
    items: [p('470', '代收货款', 'platform-express', DOMESTIC_ROUTES)],
  },
  {
    code: '48',
    label: '特快物流',
    productFamily: 'express',
    items: [
      p('480', '直属特快', 'platform-express', [
        'local',
        'nonlocal',
        ...SPECIAL_COMBINED_ROUTES,
      ]),
      p('481', '空运特快', 'platform-express', ALL_ROUTES),
    ],
  },
  {
    code: '4A',
    label: '留学速递',
    productFamily: 'express',
    items: [p('4A0', '留学速递', 'platform-express', OVERSEAS_ROUTES)],
  },
]

function toServiceProduct(
  group: ProductGroupDefinition,
  definition: ProductDefinition,
): ServiceProduct {
  const registered = group.productFamily === 'standard-delivery'
  const parcel = group.productFamily === 'parcel'
  const express = group.productFamily === 'express'
  return {
    id: definition.id ?? PRODUCT_ID_OVERRIDES[definition.code] ?? `catalog-${definition.code}`,
    label: definition.label,
    searchCode: definition.code,
    parentCode: group.code,
    parentLabel: group.label,
    productFamily: group.productFamily,
    destinationZones: [...definition.zones],
    tariffKind: definition.tariffKind,
    pricingBasis: definition.pricingBasis ?? (
      definition.tariffKind === 'platform-parcel' ||
      definition.tariffKind === 'platform-express'
        ? 'channel-baseline'
        : 'public-standard'
    ),
    itemCodeRule: definition.itemCodeRule ?? (
      registered
        ? 'registered-by-zone'
        : parcel
          ? 'parcel-by-zone'
          : express
            ? 'express-by-zone'
            : 'none'
    ),
    remarkOptions: definition.remarkOptions ?? (express ? ['document', 'goods'] : []),
    requiresRecipient: definition.requiresRecipient ?? (registered || parcel || express),
    requiresAgreement: definition.requiresAgreement ?? false,
    domesticRegistrationFeeCents:
      definition.domesticRegistrationFeeCents ?? (registered ? 300 : 0),
    internationalRegistrationFeeCents:
      definition.internationalRegistrationFeeCents ?? (registered ? 1600 : 0),
    additionalServiceFeeCents: definition.additionalServiceFeeCents ?? 0,
    maxWeightGrams:
      definition.maxWeightGrams ?? defaultMaxWeight(definition.tariffKind),
  }
}

export const SERVICE_PRODUCTS: ServiceProduct[] = PRODUCT_GROUP_DEFINITIONS.flatMap(
  (group) => group.items.map((definition) => toServiceProduct(group, definition)),
)

export const POSTAL_SUPPLY_ITEMS: PostalSupplyItem[] = [
  {
    id: 'supply-demo-grain-gift-box',
    label: '演示谷物礼盒',
    mnemonic: 'GWLH',
    unit: '箱',
    unitPriceCents: 6800,
    stock: 40,
    primaryCategory: '演示家乡产品',
    secondaryCategory: '食品礼盒',
  },
  {
    id: 'supply-demo-dried-fruit-box',
    label: '演示果干礼盒',
    mnemonic: 'GGLH',
    unit: '盒',
    unitPriceCents: 5200,
    stock: 35,
    primaryCategory: '演示家乡产品',
    secondaryCategory: '食品礼盒',
  },
  {
    id: 'supply-demo-handwoven-item',
    label: '演示手作织物',
    mnemonic: 'SZZW',
    unit: '件',
    unitPriceCents: 8800,
    stock: 20,
    primaryCategory: '演示家乡产品',
    secondaryCategory: '手工制品',
  },
  {
    id: 'supply-standard-envelope',
    label: '演示标准信封',
    mnemonic: 'BZSF',
    unit: '个',
    unitPriceCents: 200,
    stock: 120,
    primaryCategory: '邮务用品',
    secondaryCategory: '封装用品',
  },
  {
    id: 'supply-padded-mailer',
    label: '演示缓冲封套',
    mnemonic: 'HCFT',
    unit: '个',
    unitPriceCents: 450,
    stock: 80,
    primaryCategory: '邮务用品',
    secondaryCategory: '封装用品',
  },
  {
    id: 'supply-address-label',
    label: '演示地址标签',
    mnemonic: 'DZBQ',
    unit: '张',
    unitPriceCents: 50,
    stock: 300,
    primaryCategory: '邮务用品',
    secondaryCategory: '书写用品',
  },
  {
    id: 'supply-international-reply-coupon',
    label: '演示国际回信券',
    mnemonic: 'GJHXQ',
    unit: '张',
    unitPriceCents: 1200,
    stock: 30,
    primaryCategory: '其他出售品',
    secondaryCategory: '国际回信券',
  },
  {
    id: 'supply-redeem-ticket-010',
    label: '练习邮票0.10元',
    mnemonic: 'TXP010',
    unit: '枚',
    unitPriceCents: 10,
    stock: 99999,
    primaryCategory: '邮票',
    secondaryCategory: '邮票',
    replyCouponCatalog: 'communication-ticket',
  },
  {
    id: 'supply-redeem-ticket-040',
    label: '练习邮票0.40元',
    mnemonic: 'TXP040',
    unit: '枚',
    unitPriceCents: 40,
    stock: 99999,
    primaryCategory: '邮票',
    secondaryCategory: '邮票',
    replyCouponCatalog: 'communication-ticket',
  },
  {
    id: 'supply-redeem-ticket-120',
    label: '练习邮票1.20元',
    mnemonic: 'TXP120',
    unit: '枚',
    unitPriceCents: 120,
    stock: 99999,
    primaryCategory: '邮票',
    secondaryCategory: '邮票',
    replyCouponCatalog: 'communication-ticket',
  },
  {
    id: 'supply-redeem-ticket-250',
    label: '练习邮票2.50元',
    mnemonic: 'TXP250',
    unit: '枚',
    unitPriceCents: 250,
    stock: 99999,
    primaryCategory: '邮票',
    secondaryCategory: '邮票',
    replyCouponCatalog: 'communication-ticket',
  },
  {
    id: 'supply-redeem-ticket-600',
    label: '练习邮票6.00元',
    mnemonic: 'TXP600',
    unit: '枚',
    unitPriceCents: 600,
    stock: 99999,
    primaryCategory: '邮票',
    secondaryCategory: '邮票',
    replyCouponCatalog: 'communication-ticket',
  },
  {
    id: 'supply-redeem-postcard-120',
    label: '练习普通明信片',
    mnemonic: 'MXP120',
    unit: '枚',
    unitPriceCents: 120,
    stock: 1000,
    primaryCategory: '封片卡',
    secondaryCategory: '明信片',
    replyCouponCatalog: 'postal-card',
  },
  {
    id: 'supply-redeem-envelope-160',
    label: '练习邮资封',
    mnemonic: 'YZF160',
    unit: '枚',
    unitPriceCents: 160,
    stock: 999,
    primaryCategory: '封片卡',
    secondaryCategory: '邮资封',
    replyCouponCatalog: 'postal-card',
  },
  {
    id: 'supply-redeem-card-160',
    label: '练习邮资卡',
    mnemonic: 'YZK160',
    unit: '枚',
    unitPriceCents: 160,
    stock: 992,
    primaryCategory: '封片卡',
    secondaryCategory: '邮资卡',
    replyCouponCatalog: 'postal-card',
  },
]

export const SERVICE_PRODUCT_GROUPS: ServiceProductGroup[] =
  PRODUCT_GROUP_DEFINITIONS.map((group) => ({
    code: group.code,
    label: group.label,
    productFamily: group.productFamily,
    items: group.items.map((item) => ({
      code: item.code,
      label: item.label,
      productId: item.id ?? PRODUCT_ID_OVERRIDES[item.code] ?? `catalog-${item.code}`,
    })),
  }))

export function createEmptyServiceDraft(
  _hasAgreement: boolean,
  destinationZone: ServiceDraft['destinationZone'] = 'local',
): ServiceDraft {
  return {
    productId: null,
    destinationZone,
    destinationOffice: '',
    itemCode: '',
    remark: 'ordinary-letter',
    weightGrams: null,
    quantity: 1,
    paymentMethod: 'cash-settlement',
    stampAmountCents: null,
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
    returnReceiptRequested: false,
    appointment: null,
    operatorNote: '',
    updatedAt: '2026-01-15T09:10:00.000Z',
  }
}

const WINDOW_DELIVERY_SEED_OPERATOR: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '云浦寄达局',
}

const WINDOW_DELIVERY_ZERO_MONEY: WindowDeliveryMoney = {
  taxCents: 0,
  inspectionCents: 0,
  returnPostageCents: 0,
  redirectedReturnPostageCents: 0,
  underpaidPostageCents: 0,
  underpaidHandlingCents: 0,
  storageWaitCents: 0,
  extensionServiceCents: 0,
  codPaymentCents: 0,
  insuranceValueCents: 0,
  insuranceFeeCents: 0,
  insuredAmountCents: 0,
}

function createWindowDeliverySeedItem(
  overrides: Partial<WindowDeliveryItem> & Pick<
    WindowDeliveryItem,
    'id' | 'source' | 'productCode' | 'productName' | 'itemCode' | 'status'
  >,
): WindowDeliveryItem {
  const {
    id,
    source,
    productCode,
    productName,
    itemCode,
    status,
    ...optionalOverrides
  } = overrides
  return {
    id,
    source,
    bagId: null,
    dispatchListNumber: '',
    productCode,
    productName,
    itemCode,
    sendingOffice: '松岚寄递点',
    receivingOffice: '景麓营业部',
    destinationOffice: '云浦寄达局',
    senderName: '林川',
    senderPhone: '10000000004',
    senderAddress: fictionalDetailedAddress('C049', '春和路', 18),
    recipientName: '周沐',
    recipientMobile: '10000000005',
    recipientPhone: '',
    recipientAddress: fictionalDetailedAddress('C022', '星河路', 26),
    mailNote: '',
    nonStandard: false,
    pieces: 1,
    innerPieces: 1,
    weightGrams: 120,
    postingDate: '2026-08-08',
    receivedAt: null,
    receivedBy: null,
    specialSequence: 0,
    money: { ...WINDOW_DELIVERY_ZERO_MONEY },
    status,
    processedAt: null,
    processedBy: null,
    transfer: null,
    cancellation: null,
    reminderStage: 'none',
    firstReminderAt: null,
    secondReminderAt: null,
    overdueAt: null,
    deletedAt: null,
    printHistory: [],
    ...structuredClone(optionalOverrides),
  }
}

function createPostalSupplySeedLine(itemId: string, requestedQuantity: number, actualQuantity = requestedQuantity) {
  const item = POSTAL_SUPPLY_ITEMS.find((candidate) => candidate.id === itemId)
  if (!item) throw new Error(`Missing postal-supply seed item ${itemId}`)
  return {
    itemId: item.id,
    label: item.label,
    mnemonic: item.mnemonic,
    unit: item.unit,
    unitPriceCents: item.unitPriceCents,
    requestedQuantity,
    actualQuantity,
    amountCents: item.unitPriceCents * actualQuantity,
  }
}

export function createServiceSeedState(): ServiceWorkspaceState {
  return {
    schemaVersion: 38,
    draft: null,
    transactions: [],
    postalSupplySales: [],
    channelProductOrders: [],
    supplementaryTrafficRecords: [],
    electronicCommerceRecords: [],
    replyCouponRedemptions: [],
    settlements: [],
    personalRemittances: [],
    institutionRemittances: [],
    bankDepositSlips: [],
    businessReportPrints: [],
    corrections: [],
    withdrawals: [],
    refunds: [],
    documentActions: [],
    fiscalInvoices: [],
    returnReceipts: [],
    bulkBatches: [],
    selfServiceImports: [],
    looseMailHandovers: [],
    dispatchRelationOverrides: [],
    dispatchBags: [],
    dispatchBagHandovers: [],
    dispatchBagChanges: [],
    dispatchBagInterchangeReturns: [],
    dispatchRoutes: [],
    dispatchPrintRecords: [],
    postageMeterDevices: [
      {
        id: 'postage-meter-primary',
        name: '练习联网邮资机 PM-01',
        meterHeadNumber: 'PMH000101',
        baseNumber: 'PMB000101',
        validity: 'valid',
        counterCode: '99901001',
        networkMode: 'direct',
        terminalPort: '1',
        reportStatus: 'enabled',
        totalPostageCents: 1_000_000,
        remainingPostageCents: 995_100,
        cumulativeImprintCount: 3,
        cumulativePostageCents: 4_900,
        updatedAt: '2026-01-15T09:10:00.000Z',
      },
      {
        id: 'postage-meter-secondary',
        name: '练习备用邮资机 PM-02',
        meterHeadNumber: 'PMH000102',
        baseNumber: 'PMB000102',
        validity: 'valid',
        counterCode: '99901001',
        networkMode: 'indirect',
        terminalPort: '2',
        reportStatus: 'enabled',
        totalPostageCents: 500_000,
        remainingPostageCents: 500_000,
        cumulativeImprintCount: 0,
        cumulativePostageCents: 0,
        updatedAt: '2026-01-15T09:10:00.000Z',
      },
    ],
    postageMeterBatches: [],
    postageMeterRegistrations: [],
    postageMeterDailyBalances: [],
    postageMeterMailHandovers: [],
    postageMeterFundingRequests: [],
    postageMeterRepairRequests: [],
    postageMeterDeviceHandoverHistory: [
      {
        id: 'postage-meter-device-handover-001',
        deviceId: 'postage-meter-primary',
        sourceInstitutionName: '云浦设备管理点',
        sourceEmployeeName: '林川',
        receivingInstitutionName: '景麓营业部',
        receivingEmployeeName: '演示营业员',
        operatedAt: '2026-01-15T09:10:00.000Z',
      },
      {
        id: 'postage-meter-device-handover-002',
        deviceId: 'postage-meter-secondary',
        sourceInstitutionName: '松岚设备管理点',
        sourceEmployeeName: '周沐',
        receivingInstitutionName: '景麓营业部',
        receivingEmployeeName: '演示营业员',
        operatedAt: '2026-01-15T09:15:00.000Z',
      },
    ],
    specialHandlingApplications: [],
    windowDeliveryBags: [
      {
        id: 'window-bag-001',
        bagCode: 'CTB202608080001',
        dispatchListNumber: 'PCD20260808001',
        routeCode: 'YPLJ-CF',
        postingDate: '2026-08-08',
        itemIds: ['window-item-import-001', 'window-item-import-002'],
        receivedAt: null,
        receivedBy: null,
        unboundAt: null,
      },
      {
        id: 'window-bag-002',
        bagCode: 'CTB202608090002',
        dispatchListNumber: 'PCD20260809002',
        routeCode: 'SL-CF',
        postingDate: '2026-08-09',
        itemIds: ['window-item-import-003'],
        receivedAt: null,
        receivedBy: null,
        unboundAt: null,
      },
    ],
    windowDeliveryItems: [
      createWindowDeliverySeedItem({
        id: 'window-item-import-001',
        source: 'import-bag',
        bagId: 'window-bag-001',
        dispatchListNumber: 'PCD20260808001',
        productCode: '200000',
        productName: '本埠给据信函',
        itemCode: 'RA20260808001GN',
        status: 'pending-receipt',
      }),
      createWindowDeliverySeedItem({
        id: 'window-item-import-002',
        source: 'import-bag',
        bagId: 'window-bag-001',
        dispatchListNumber: 'PCD20260808001',
        productCode: '220000',
        productName: '本埠给据明信片',
        itemCode: 'RP20260808002GN',
        recipientName: '苏清',
        status: 'pending-receipt',
      }),
      createWindowDeliverySeedItem({
        id: 'window-item-import-003',
        source: 'import-bag',
        bagId: 'window-bag-002',
        dispatchListNumber: 'PCD20260809002',
        productCode: '250200',
        productName: '国际给据小包',
        itemCode: 'RR20260809003GN',
        status: 'pending-receipt',
      }),
      createWindowDeliverySeedItem({
        id: 'window-item-delivery-return-001',
        source: 'delivery-return',
        productCode: '299199',
        productName: '外埠给据信函',
        itemCode: 'RA20260809004GN',
        status: 'pending-receipt',
      }),
      createWindowDeliverySeedItem({
        id: 'window-item-delivery-window-001',
        source: 'delivery-to-window',
        productCode: '220100',
        productName: '外埠给据明信片',
        itemCode: 'RP20260809005GN',
        status: 'pending-receipt',
      }),
      createWindowDeliverySeedItem({
        id: 'window-item-stored-001',
        source: 'supplement',
        productCode: '200200',
        productName: '国际给据信函',
        itemCode: 'RR20260807006GN',
        status: 'stored',
        postingDate: '2026-08-07',
        receivedAt: '2026-08-08T09:20:00.000Z',
        receivedBy: WINDOW_DELIVERY_SEED_OPERATOR,
        specialSequence: 12001,
        recipientName: '沈舟',
        recipientAddress: '海外示范地址',
        money: {
          ...WINDOW_DELIVERY_ZERO_MONEY,
          taxCents: 320,
          storageWaitCents: 200,
        },
      }),
    ],
    windowDeliverySequenceStarts: [
      { productCode: '200000', productName: '本埠给据信函', startNumber: 12001 },
      { productCode: '250200', productName: '国际给据小包', startNumber: 22001 },
    ],
    windowDeliveryAudits: [],
    postalSupplyInventoryBalances: POSTAL_SUPPLY_ITEMS.map((item) => ({
      itemId: item.id,
      superiorQuantity: item.stock * 5 - (item.id === 'supply-demo-dried-fruit-box' ? 2 : 0),
      institutionQuantity: item.stock * 2 + (item.id === 'supply-standard-envelope' ? 10 : 0),
      employeeQuantities: { '80000001': item.stock },
    })),
    postalSupplyDocuments: [
      {
        id: 'YPGL-RK-20260807-000001',
        kind: 'inbound',
        status: 'saved',
        institutionCode: '99901001',
        institutionName: '景麓营业部',
        superiorInstitutionCode: '99800000',
        superiorInstitutionName: '云浦运营中心',
        employeeId: null,
        employeeName: null,
        createdAt: '2026-08-07T08:40:00.000Z',
        createdBy: WINDOW_DELIVERY_SEED_OPERATOR,
        updatedAt: '2026-08-07T08:40:00.000Z',
        approvedAt: null,
        approvedBy: null,
        rejectedAt: null,
        rejectedBy: null,
        receivedAt: null,
        receivedBy: null,
        deletedAt: null,
        lines: [createPostalSupplySeedLine('supply-standard-envelope', 10)],
      },
      {
        id: 'YPGL-QL-20260808-000002',
        kind: 'requisition',
        status: 'pending-approval',
        institutionCode: '99901001',
        institutionName: '景麓营业部',
        superiorInstitutionCode: '99800000',
        superiorInstitutionName: '云浦运营中心',
        employeeId: null,
        employeeName: null,
        createdAt: '2026-08-08T09:05:00.000Z',
        createdBy: WINDOW_DELIVERY_SEED_OPERATOR,
        updatedAt: '2026-08-08T09:05:00.000Z',
        approvedAt: null,
        approvedBy: null,
        rejectedAt: null,
        rejectedBy: null,
        receivedAt: null,
        receivedBy: null,
        deletedAt: null,
        lines: [createPostalSupplySeedLine('supply-demo-grain-gift-box', 3)],
      },
      {
        id: 'YPGL-QL-20260809-000003',
        kind: 'requisition',
        status: 'approved',
        institutionCode: '99901001',
        institutionName: '景麓营业部',
        superiorInstitutionCode: '99800000',
        superiorInstitutionName: '云浦运营中心',
        employeeId: null,
        employeeName: null,
        createdAt: '2026-08-09T09:15:00.000Z',
        createdBy: WINDOW_DELIVERY_SEED_OPERATOR,
        updatedAt: '2026-08-09T10:20:00.000Z',
        approvedAt: '2026-08-09T10:20:00.000Z',
        approvedBy: WINDOW_DELIVERY_SEED_OPERATOR,
        rejectedAt: null,
        rejectedBy: null,
        receivedAt: null,
        receivedBy: null,
        deletedAt: null,
        lines: [createPostalSupplySeedLine('supply-demo-dried-fruit-box', 3, 2)],
      },
    ],
    pointsProductInventory: [
      {
        id: 'points-product-801',
        productNumber: 'JF801',
        barcode: 'SIM-JF-000801',
        name: '练习织物清洁液',
        exchangeOffice: '景麓营业部',
        quantity: 6,
      },
      {
        id: 'points-product-803',
        productNumber: 'JF803',
        barcode: 'SIM-JF-000803',
        name: '练习清香洗护液',
        exchangeOffice: '景麓营业部',
        quantity: 1,
      },
      {
        id: 'points-product-809',
        productNumber: 'JF809',
        barcode: 'SIM-JF-000809',
        name: '练习衣物护理套装',
        exchangeOffice: '景麓营业部',
        quantity: 8,
      },
      {
        id: 'points-product-811',
        productNumber: 'JF811',
        barcode: 'SIM-JF-000811',
        name: '练习日用清洁套装',
        exchangeOffice: '景麓营业部',
        quantity: 10,
      },
    ],
    pointsInventoryMovements: [],
    spotCheckExercises: createSpotCheckExerciseSeedRecords(),
    nextSequence: 1,
    nextPostalSupplySequence: 1,
    nextChannelProductSequence: 1,
    nextSupplementaryTrafficSequence: 1,
    nextElectronicCommerceSequence: 1,
    nextReplyCouponSequence: 1,
    nextSettlementSequence: 1,
    nextPersonalRemittanceSequence: 1,
    nextInstitutionRemittanceSequence: 1,
    nextBankDepositSequence: 1,
    nextBusinessReportPrintSequence: 1,
    nextCorrectionSequence: 1,
    nextWithdrawalSequence: 1,
    nextRefundSequence: 1,
    nextDocumentActionSequence: 1,
    nextFiscalInvoiceSequence: 1,
    nextReturnReceiptSequence: 1,
    nextBulkBatchSequence: 1,
    nextSelfServiceImportSequence: 1,
    nextLooseMailHandoverSequence: 1,
    nextDispatchBagSequence: 1,
    nextDispatchManifestSequence: 501,
    nextDispatchBagHandoverSequence: 1,
    nextDispatchBagChangeSequence: 1,
    nextDispatchBagInterchangeReturnSequence: 1,
    nextDispatchRouteSequence: 1,
    nextDispatchPrintSequence: 1,
    nextPostageMeterBatchSequence: 1,
    nextPostageMeterRegistrationSequence: 1,
    nextPostageMeterDailyBalanceSequence: 1,
    nextPostageMeterMailHandoverSequence: 1,
    nextPostageMeterFundingSequence: 1,
    nextPostageMeterRepairSequence: 1,
    nextSpecialHandlingSequence: 1,
    nextWindowDeliverySequence: 7,
    nextWindowDeliveryAuditSequence: 1,
    nextPostalSupplyDocumentSequence: 4,
    nextPointsInventoryMovementSequence: 1,
  }
}
