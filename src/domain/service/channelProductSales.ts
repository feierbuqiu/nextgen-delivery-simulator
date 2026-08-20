import {
  fictionalDetailedAddress,
  postalAdministrativeRecordByCountyId,
} from '../customer/postalAdministrativeDirectory'
import type { SenderProfile } from '../customer/types'
import { businessCalendarDay } from '../shared/businessTime'
import type {
  ChannelProductAllocation,
  ChannelProductCatalogItem,
  ChannelProductOrder,
  ChannelProductOrderDraftLine,
  ChannelProductOrderLine,
  ChannelProductSalesType,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from './types'
import { DEFAULT_SERVICE_OPERATOR } from './transactions'
import { assertAccountingOpen } from './personalRemittance'
import {
  requireOnSiteAuthorization,
  type OnSiteAuthorization,
} from '../access/workAuthorization'

export interface ChannelPickupOffice {
  code: string
  name: string
  province: string
  city: string
  district: string
  address: string
  contact: string
  inventory: Record<string, number>
}

export interface AcceptChannelProductOrderRequest {
  submittedAt: string
  buyer: SenderProfile
  lines: ChannelProductOrderDraftLine[]
  allocations: ChannelProductAllocation[]
  operator?: ServiceOperatorSnapshot
}

export interface AcceptedChannelProductOrderResult {
  state: ServiceWorkspaceState
  order: ChannelProductOrder
}

export interface ChannelProductOrderQuery {
  querySerial: string
  productTerm: string
  salesDateFrom: string
  salesDateTo: string
  operatorId: string
  workstationCode: string
  salesType: ChannelProductSalesType
}

export interface RecordChannelProductReceiptPrintRequest {
  orderId: string
  printedAt: string
}

export interface DeleteChannelProductOrdersRequest {
  orderIds: string[]
  deletedAt: string
  operator: ServiceOperatorSnapshot
  authorization: OnSiteAuthorization
}

export interface ChannelProductOrderResult {
  state: ServiceWorkspaceState
  order: ChannelProductOrder
}

export interface DeletedChannelProductOrdersResult {
  state: ServiceWorkspaceState
  orders: ChannelProductOrder[]
}

export const CHANNEL_PRODUCT_CATALOG: ChannelProductCatalogItem[] = [
  {
    id: 'channel-cloud-grain-box',
    label: '云谷杂粮礼盒',
    barcode: 'XS10010001',
    category: '特色商品',
    secondaryCategory: '地方风物',
    unit: '盒',
    description: '组合装谷物礼盒，适合窗口现售、寄递或到店自提。',
    accent: '#c48a45',
    skus: [
      { code: 'YG-06', label: '六袋装', unitPriceCents: 6800, stock: 48, inventoryControlled: true },
      { code: 'YG-10', label: '十袋装', unitPriceCents: 9800, stock: 32, inventoryControlled: true },
    ],
  },
  {
    id: 'channel-mist-canvas-bag',
    label: '青岚帆布袋',
    barcode: 'XS10010002',
    category: '出售品',
    secondaryCategory: '文创用品',
    unit: '只',
    description: '耐用帆布手提袋，提供两种规格。',
    accent: '#5fa99f',
    skus: [
      { code: 'QL-S', label: '标准款', unitPriceCents: 3600, stock: 86, inventoryControlled: true },
      { code: 'QL-L', label: '加大款', unitPriceCents: 4600, stock: 55, inventoryControlled: true },
    ],
  },
  {
    id: 'channel-woodland-notebook',
    label: '木棉线装笔记本',
    barcode: 'XS10010003',
    category: '出售品',
    secondaryCategory: '文创用品',
    unit: '本',
    description: '线装方格笔记本，适合日常记录。',
    accent: '#9a765d',
    skus: [
      { code: 'MM-A5', label: 'A5 方格', unitPriceCents: 1800, stock: 120, inventoryControlled: true },
      { code: 'MM-B6', label: 'B6 横线', unitPriceCents: 1500, stock: 96, inventoryControlled: true },
    ],
  },
  {
    id: 'channel-starlight-postcard-set',
    label: '星河风景卡组',
    barcode: 'XS10010004',
    category: '营销用品',
    secondaryCategory: '宣传卡片',
    unit: '套',
    description: '十二枚风景卡片组成的窗口营销用品。',
    accent: '#627fa8',
    skus: [
      { code: 'XH-12', label: '十二枚装', unitPriceCents: 1200, stock: 180, inventoryControlled: false },
    ],
  },
  {
    id: 'channel-ridge-tea-box',
    label: '青岭茶点礼盒',
    barcode: 'XS10010005',
    category: '特色商品',
    secondaryCategory: '地方风物',
    unit: '盒',
    description: '茶点组合礼盒，按规格形成不同 SKU。',
    accent: '#7e9b64',
    skus: [
      { code: 'QL-08', label: '八枚装', unitPriceCents: 5200, stock: 44, inventoryControlled: true },
      { code: 'QL-16', label: '十六枚装', unitPriceCents: 8800, stock: 26, inventoryControlled: true },
    ],
  },
  {
    id: 'channel-sunrise-umbrella',
    label: '朝霞便携伞',
    barcode: 'XS10010006',
    category: '营销用品',
    secondaryCategory: '便民用品',
    unit: '把',
    description: '轻量折叠伞，适合窗口便民销售。',
    accent: '#b06d7b',
    skus: [
      { code: 'CX-BL', label: '雾蓝', unitPriceCents: 4200, stock: 73, inventoryControlled: true },
      { code: 'CX-BG', label: '米白', unitPriceCents: 4200, stock: 68, inventoryControlled: true },
    ],
  },
]

export const CHANNEL_PICKUP_OFFICES: ChannelPickupOffice[] = [
  {
    code: '99001011',
    name: '栖沄营业部',
    province: postalAdministrativeRecordByCountyId('C022').provinceShortName,
    city: postalAdministrativeRecordByCountyId('C022').prefectureShortName,
    district: postalAdministrativeRecordByCountyId('C022').countyShortName,
    address: fictionalDetailedAddress('C022', '云杉路', 11),
    contact: '010-99001011',
    inventory: { 'QL-S': 18, 'QL-L': 9, 'YG-06': 8, 'YG-10': 5, 'MM-A5': 20, 'MM-B6': 18, 'QL-08': 7, 'QL-16': 3, 'CX-BL': 12, 'CX-BG': 10 },
  },
  {
    code: '99001026',
    name: '星桥营业所',
    province: postalAdministrativeRecordByCountyId('C001').provinceShortName,
    city: postalAdministrativeRecordByCountyId('C001').prefectureShortName,
    district: postalAdministrativeRecordByCountyId('C001').countyShortName,
    address: fictionalDetailedAddress('C001', '星桥街', 26),
    contact: '010-99001026',
    inventory: { 'QL-S': 11, 'QL-L': 6, 'YG-06': 5, 'YG-10': 4, 'MM-A5': 15, 'MM-B6': 14, 'QL-08': 6, 'QL-16': 2, 'CX-BL': 8, 'CX-BG': 7 },
  },
  {
    code: '35000104',
    name: '松涛支局',
    province: postalAdministrativeRecordByCountyId('C023').provinceShortName,
    city: postalAdministrativeRecordByCountyId('C023').prefectureShortName,
    district: postalAdministrativeRecordByCountyId('C023').countyShortName,
    address: fictionalDetailedAddress('C023', '松涛路', 104),
    contact: '0591-35000104',
    inventory: { 'QL-S': 15, 'QL-L': 8, 'YG-06': 7, 'YG-10': 4, 'MM-A5': 16, 'MM-B6': 16, 'QL-08': 8, 'QL-16': 4, 'CX-BL': 9, 'CX-BG': 9 },
  },
  {
    code: '62000218',
    name: '望海营业所',
    province: postalAdministrativeRecordByCountyId('C049').provinceShortName,
    city: postalAdministrativeRecordByCountyId('C049').prefectureShortName,
    district: postalAdministrativeRecordByCountyId('C049').countyShortName,
    address: fictionalDetailedAddress('C049', '望海路', 218),
    contact: '0931-62000218',
    inventory: { 'QL-S': 9, 'QL-L': 5, 'YG-06': 4, 'YG-10': 3, 'MM-A5': 12, 'MM-B6': 10, 'QL-08': 5, 'QL-16': 2, 'CX-BL': 6, 'CX-BG': 6 },
  },
]

export function channelProductLineKey(productId: string, skuCode: string): string {
  return `${productId}::${skuCode}`
}

function catalogEntry(productId: string, skuCode: string) {
  const product = CHANNEL_PRODUCT_CATALOG.find((item) => item.id === productId)
  const sku = product?.skus.find((item) => item.code === skuCode)
  if (!product || !sku) throw new Error(`未找到商品规格 ${productId}/${skuCode}。`)
  return { product, sku }
}

export function remainingChannelProductStock(
  state: ServiceWorkspaceState,
  productId: string,
  skuCode: string,
): number {
  const { sku } = catalogEntry(productId, skuCode)
  if (!sku.inventoryControlled) return sku.stock
  const sold = state.channelProductOrders.reduce(
    (total, order) => total + (order.status !== 'deleted' ? (
      order.lines.find(
        (line) => line.productId === productId && line.skuCode === skuCode,
      )?.quantity ?? 0
    ) : 0),
    0,
  )
  return Math.max(0, sku.stock - sold)
}

export function remainingChannelPickupStock(
  state: ServiceWorkspaceState,
  officeCode: string,
  productId: string,
  skuCode: string,
): number {
  const { sku } = catalogEntry(productId, skuCode)
  if (!sku.inventoryControlled) return sku.stock
  const office = CHANNEL_PICKUP_OFFICES.find((item) => item.code === officeCode)
  if (!office) return 0
  const allocated = state.channelProductOrders.reduce((orderTotal, order) => (
    orderTotal + (order.status !== 'deleted' ? order.allocations.reduce((allocationTotal, allocation) => (
      allocationTotal + (
        allocation.kind === 'pickup' && allocation.pickup?.pickupOfficeCode === officeCode
          ? allocation.lines.find(
              (line) => line.productId === productId && line.skuCode === skuCode,
            )?.quantity ?? 0
          : 0
      )
    ), 0) : 0)
  ), 0)
  return Math.max(0, (office.inventory[skuCode] ?? 0) - allocated)
}

function orderId(submittedAt: string, sequence: number): string {
  const date = businessCalendarDay(submittedAt).replaceAll('-', '')
  return `XS-${date}-${String(sequence).padStart(6, '0')}`
}

function validateContact(value: string, label: string): void {
  if (!/^\d{6,20}$/.test(value.trim())) {
    throw new Error(`${label}联系电话须为 6 至 20 位数字。`)
  }
}

export function acceptChannelProductOrder(
  state: ServiceWorkspaceState,
  request: AcceptChannelProductOrderRequest,
): AcceptedChannelProductOrderResult {
  const operator = structuredClone(request.operator ?? DEFAULT_SERVICE_OPERATOR)
  assertAccountingOpen(state, operator, request.submittedAt)
  if (request.lines.length === 0) throw new Error('购物车中没有商品。')
  const keys = request.lines.map((line) => channelProductLineKey(line.productId, line.skuCode))
  if (new Set(keys).size !== keys.length) throw new Error('同一商品规格只能保留一行。')

  const lines: ChannelProductOrderLine[] = request.lines.map((draftLine) => {
    const { product, sku } = catalogEntry(draftLine.productId, draftLine.skuCode)
    const remaining = remainingChannelProductStock(state, product.id, sku.code)
    if (!Number.isInteger(draftLine.quantity) || draftLine.quantity < 1) {
      throw new Error(`${product.label}（${sku.label}）数量须为正整数。`)
    }
    if (sku.inventoryControlled && draftLine.quantity > remaining) {
      throw new Error(`${product.label}（${sku.label}）数量不得超过可售库存 ${remaining}。`)
    }
    return {
      productId: product.id,
      productLabel: product.label,
      barcode: product.barcode,
      category: product.category,
      skuCode: sku.code,
      skuLabel: sku.label,
      unit: product.unit,
      unitPriceCents: sku.unitPriceCents,
      quantity: draftLine.quantity,
      amountCents: sku.unitPriceCents * draftLine.quantity,
    }
  })

  if (new Set(request.allocations.map((allocation) => allocation.id)).size !== request.allocations.length) {
    throw new Error('寄递或自提登记编号重复。')
  }

  const lineQuantities = new Map(
    lines.map((line) => [channelProductLineKey(line.productId, line.skuCode), line.quantity]),
  )
  const allocated = new Map<string, number>()
  const pickupRequested = new Map<string, number>()

  for (const allocation of request.allocations) {
    if (allocation.lines.length === 0) throw new Error('寄递或自提登记至少需要选择一种商品。')
    if (allocation.kind === 'delivery') {
      if (!allocation.recipient || allocation.pickup) throw new Error('寄递登记的收件人信息不完整。')
      validateContact(allocation.recipient.contact, '收件人')
      if (allocation.recipient.name.trim().length < 2) throw new Error('收件人姓名至少填写 2 个字符。')
      if (!/^\d{6}$/.test(allocation.recipient.postalCode.trim())) throw new Error('寄递邮编须为 6 位数字。')
      if (allocation.recipient.detailedAddress.trim().length < 7) throw new Error('寄递详细地址至少填写 7 个字符。')
    } else {
      if (!allocation.pickup || allocation.recipient) throw new Error('到店自提登记的联系人信息不完整。')
      validateContact(allocation.pickup.contact, '自提人')
      if (allocation.pickup.name.trim().length < 2) throw new Error('自提人姓名至少填写 2 个字符。')
      const office = CHANNEL_PICKUP_OFFICES.find(
        (item) => item.code === allocation.pickup?.pickupOfficeCode,
      )
      if (!office || office.name !== allocation.pickup.pickupOfficeName) {
        throw new Error('请选择有效的自提配置机构。')
      }
    }

    const allocationKeys = allocation.lines.map(
      (line) => channelProductLineKey(line.productId, line.skuCode),
    )
    if (new Set(allocationKeys).size !== allocationKeys.length) {
      throw new Error('同一次登记中同一商品规格只能保留一行。')
    }

    for (const allocationLine of allocation.lines) {
      const key = channelProductLineKey(allocationLine.productId, allocationLine.skuCode)
      const cartQuantity = lineQuantities.get(key)
      if (!cartQuantity) throw new Error('登记的商品不在当前购物车中。')
      if (!Number.isInteger(allocationLine.quantity) || allocationLine.quantity < 1) {
        throw new Error('寄递或自提数量须为正整数。')
      }
      const nextAllocated = (allocated.get(key) ?? 0) + allocationLine.quantity
      if (nextAllocated > cartQuantity) throw new Error('已填数量不得超过购物车剩余数量。')
      allocated.set(key, nextAllocated)

      if (allocation.kind === 'pickup' && allocation.pickup) {
        const { product, sku } = catalogEntry(allocationLine.productId, allocationLine.skuCode)
        if (sku.inventoryControlled) {
          const pickupKey = `${allocation.pickup.pickupOfficeCode}::${key}`
          const nextPickup = (pickupRequested.get(pickupKey) ?? 0) + allocationLine.quantity
          const pickupRemaining = remainingChannelPickupStock(
            state,
            allocation.pickup.pickupOfficeCode,
            product.id,
            sku.code,
          )
          if (nextPickup > pickupRemaining) {
            throw new Error(`${allocation.pickup.pickupOfficeName}的${product.label}（${sku.label}）自提库存仅剩 ${pickupRemaining}。`)
          }
          pickupRequested.set(pickupKey, nextPickup)
        }
      }
    }
  }

  const totalQuantity = lines.reduce((total, line) => total + line.quantity, 0)
  const totalCents = lines.reduce((total, line) => total + line.amountCents, 0)
  const order: ChannelProductOrder = {
    id: orderId(request.submittedAt, state.nextChannelProductSequence),
    status: 'pending-settlement',
    salesType: 'offline',
    submittedAt: request.submittedAt,
    operator,
    buyer: structuredClone(request.buyer),
    lines,
    allocations: structuredClone(request.allocations),
    totalQuantity,
    totalCents,
    settlementId: null,
    deletedAt: null,
    deletedBy: null,
    receiptPrintedAt: [],
  }
  return {
    order,
    state: {
      ...state,
      channelProductOrders: [...state.channelProductOrders, order],
      nextChannelProductSequence: state.nextChannelProductSequence + 1,
    },
  }
}

function includesNormalized(value: string, term: string): boolean {
  return value.toLocaleLowerCase('zh-CN').includes(term.toLocaleLowerCase('zh-CN'))
}

export function queryChannelProductOrders(
  orders: ChannelProductOrder[],
  query: ChannelProductOrderQuery,
): ChannelProductOrder[] {
  const serial = query.querySerial.trim()
  const productTerm = query.productTerm.trim()
  const operatorTerm = query.operatorId.trim()
  const workstation = query.workstationCode.trim()

  return orders
    .filter((order) => order.status !== 'deleted')
    .filter((order) => (order.salesType ?? 'offline') === query.salesType)
    .filter((order) => !serial || includesNormalized(order.id, serial))
    .filter((order) => !productTerm || order.lines.some((line) => [
      line.productLabel,
      line.barcode,
      line.skuCode,
      line.skuLabel,
    ].some((value) => includesNormalized(value, productTerm))))
    .filter((order) => !operatorTerm || [
      order.operator.operatorId,
      order.operator.displayName,
    ].some((value) => includesNormalized(value, operatorTerm)))
    .filter((order) => !workstation || order.operator.workstationCode === workstation)
    .filter((order) => !query.salesDateFrom || businessCalendarDay(order.submittedAt) >= query.salesDateFrom)
    .filter((order) => !query.salesDateTo || businessCalendarDay(order.submittedAt) <= query.salesDateTo)
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt))
}

function activeChannelProductOrder(
  state: ServiceWorkspaceState,
  orderIdValue: string,
): ChannelProductOrder {
  const order = state.channelProductOrders.find((item) => item.id === orderIdValue)
  if (!order || order.status === 'deleted') {
    throw new Error(`未找到渠道商品销售记录 ${orderIdValue}。`)
  }
  return order
}

export function recordChannelProductReceiptPrint(
  state: ServiceWorkspaceState,
  request: RecordChannelProductReceiptPrintRequest,
): ChannelProductOrderResult {
  const order = activeChannelProductOrder(state, request.orderId)
  if ((order.salesType ?? 'offline') !== 'offline') {
    throw new Error('线上销售记录不提供窗口小票打印。')
  }
  const printedAt = request.printedAt.trim()
  if (!printedAt) throw new Error('小票打印时间不能为空。')
  const updated: ChannelProductOrder = {
    ...order,
    receiptPrintedAt: [...(order.receiptPrintedAt ?? []), printedAt],
  }
  return {
    order: updated,
    state: {
      ...state,
      channelProductOrders: state.channelProductOrders.map((item) =>
        item.id === updated.id ? updated : item,
      ),
    },
  }
}

export function deleteChannelProductOrders(
  state: ServiceWorkspaceState,
  request: DeleteChannelProductOrdersRequest,
): DeletedChannelProductOrdersResult {
  const orderIds = [...new Set(request.orderIds)]
  if (orderIds.length === 0) throw new Error('请选择需要删除的渠道商品销售记录。')
  const authorization = requireOnSiteAuthorization(
    request.authorization,
    'delete-channel-product-order',
    request.operator.operatorId,
  )
  const deletedDate = businessCalendarDay(request.deletedAt)
  const orders = orderIds.map((id) => activeChannelProductOrder(state, id))
  for (const order of orders) {
    if (order.status !== 'pending-settlement' || order.settlementId) {
      throw new Error(`${order.id} 已缴款，不能从商品销售查改中删除。`)
    }
    if (!deletedDate || businessCalendarDay(order.submittedAt) !== deletedDate) {
      throw new Error(`${order.id} 不是当天销售记录，不能删除。`)
    }
  }
  const idSet = new Set(orderIds)
  const updatedOrders = orders.map((order): ChannelProductOrder => ({
    ...order,
    status: 'deleted',
    deletedAt: request.deletedAt,
    deletedBy: authorization.authorizerId,
  }))
  const updates = new Map(updatedOrders.map((order) => [order.id, order]))
  return {
    orders: structuredClone(updatedOrders),
    state: {
      ...state,
      channelProductOrders: state.channelProductOrders.map((order) =>
        idSet.has(order.id) ? updates.get(order.id)! : order,
      ),
    },
  }
}

export function channelProductFulfillmentSummary(order: ChannelProductOrder): {
  deliveryQuantity: number
  pickupQuantity: number
  spotQuantity: number
} {
  const deliveryQuantity = order.allocations
    .filter((allocation) => allocation.kind === 'delivery')
    .reduce((total, allocation) => total + allocation.lines.reduce(
      (lineTotal, line) => lineTotal + line.quantity,
      0,
    ), 0)
  const pickupQuantity = order.allocations
    .filter((allocation) => allocation.kind === 'pickup')
    .reduce((total, allocation) => total + allocation.lines.reduce(
      (lineTotal, line) => lineTotal + line.quantity,
      0,
    ), 0)
  return {
    deliveryQuantity,
    pickupQuantity,
    spotQuantity: order.totalQuantity - deliveryQuantity - pickupQuantity,
  }
}
