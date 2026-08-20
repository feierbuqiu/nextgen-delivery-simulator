import { FICTIONAL_ADDRESSES } from '../customer/seed'
import type {
  CustomerDraft,
  DestinationRegion,
  RecipientProfile,
  SenderProfile,
} from '../customer/types'
import { createEmptyServiceDraft } from './seed'
import type {
  AcceptServiceRequest,
  ServiceAppointmentSnapshot,
  ServiceAppointmentSource,
  ServiceDestinationZone,
  ServiceDraft,
  ServiceProductId,
  ServiceWorkspaceState,
} from './types'

export interface AppointmentSourceOption {
  value: ServiceAppointmentSource
  label: string
  description: string
}

export interface AppointmentOrder {
  source: ServiceAppointmentSource
  sourceLabel: string
  orderNumber: string
  lookupPhone: string
  customer: CustomerDraft
  draft: ServiceDraft
}

export const APPOINTMENT_SOURCE_OPTIONS: AppointmentSourceOption[] = [
  {
    value: 'online-reservation',
    label: '预约下单',
    description: '按预约单号或联系电话查询。',
  },
  {
    value: 'parcel-partner',
    label: '包裹伙伴',
    description: '查询后寄收件人与邮件信息不可修改。',
  },
  {
    value: 'delivery-platform',
    label: '快递平台',
    description: '带入平台预约信息与平台优惠。',
  },
  {
    value: 'express-channel',
    label: '特快公众号/小程序',
    description: '带入线上预约的特快信息。',
  },
  {
    value: 'customer-self-service',
    label: '客户自助',
    description: '扫描预约单号或邮件条码，按协议记欠收寄。',
  },
]

const RETRIEVED_AT = '2026-08-10T09:30:00.000Z'

function fictionalAddress(id: string) {
  const address = FICTIONAL_ADDRESSES.find((candidate) => candidate.id === id)
  if (!address) throw new Error(`预约演示地址不存在：${id}`)
  return address
}

function sender(
  addressId: string,
  values: Pick<SenderProfile, 'contact' | 'name' | 'identityValue' | 'gender'> &
    Partial<Pick<SenderProfile, 'agreementAccountId' | 'agreementAccountName' | 'unit'>>,
): SenderProfile {
  const address = fictionalAddress(addressId)
  return {
    agreementAccountId: values.agreementAccountId ?? null,
    agreementAccountName: values.agreementAccountName ?? '',
    contact: values.contact,
    name: values.name,
    identityType: values.identityValue ? 'primary' : '',
    identityValue: values.identityValue,
    gender: values.gender,
    detailedAddress: address.detailedAddress,
    unit: values.unit ?? '',
    postalCode: address.postalCode,
  }
}

function recipient(
  addressId: string,
  values: Pick<RecipientProfile, 'contact' | 'name'> &
    Partial<Pick<RecipientProfile, 'unit'>>,
): RecipientProfile {
  const address = fictionalAddress(addressId)
  return {
    contact: values.contact,
    name: values.name,
    detailedAddress: address.detailedAddress,
    unit: values.unit ?? '',
    postalCode: address.postalCode,
  }
}

interface AppointmentFixture {
  source: ServiceAppointmentSource
  orderNumber: string
  lookupPhone: string
  productId: ServiceProductId
  productFamily: CustomerDraft['productFamily']
  destinationRegion: DestinationRegion
  destinationZone: Exclude<ServiceDestinationZone, ''>
  destinationOffice?: string
  sender: SenderProfile
  recipient: RecipientProfile
  itemCode: string
  weightGrams: number
  packaging: string
  contents?: string
  parcelTariffZone?: ServiceDraft['parcelTariffZone']
  platformQuoteCents?: number
  paymentMethod?: ServiceDraft['paymentMethod']
  discountCents?: number
  mailInformationLocked?: boolean
  labelAlreadyPrinted?: boolean
}

function makeOrder(fixture: AppointmentFixture): AppointmentOrder {
  const source = APPOINTMENT_SOURCE_OPTIONS.find(
    (candidate) => candidate.value === fixture.source,
  )
  if (!source) throw new Error(`预约来源不存在：${fixture.source}`)
  const appointment: ServiceAppointmentSnapshot = {
    source: fixture.source,
    sourceLabel: source.label,
    orderNumber: fixture.orderNumber,
    discountCents: fixture.discountCents ?? 0,
    mailInformationLocked: fixture.mailInformationLocked ?? false,
    labelAlreadyPrinted: fixture.labelAlreadyPrinted ?? false,
    retrievedAt: RETRIEVED_AT,
  }
  const draft: ServiceDraft = {
    ...createEmptyServiceDraft(Boolean(fixture.sender.agreementAccountId), fixture.destinationZone),
    productId: fixture.productId,
    destinationOffice: fixture.destinationOffice ?? '',
    itemCode: fixture.itemCode,
    weightGrams: fixture.weightGrams,
    paymentMethod: fixture.paymentMethod ?? 'cash-settlement',
    packaging: fixture.packaging,
    contents: fixture.contents ?? '',
    parcelTariffZone: fixture.parcelTariffZone ?? '',
    platformQuoteCents: fixture.platformQuoteCents ?? null,
    appointment,
    operatorNote: `预约单 ${fixture.orderNumber}`,
    updatedAt: RETRIEVED_AT,
  }
  return {
    source: fixture.source,
    sourceLabel: source.label,
    orderNumber: fixture.orderNumber,
    lookupPhone: fixture.lookupPhone,
    customer: {
      productFamily: fixture.productFamily,
      destinationRegion: fixture.destinationRegion,
      sender: structuredClone(fixture.sender),
      recipient: structuredClone(fixture.recipient),
      status: 'customer-ready',
      updatedAt: RETRIEVED_AT,
    },
    draft,
  }
}

export const APPOINTMENT_ORDERS: AppointmentOrder[] = [
  makeOrder({
    source: 'online-reservation',
    orderNumber: 'YY2608100001',
    lookupPhone: '10000000029',
    productId: 'catalog-300',
    productFamily: 'parcel',
    destinationRegion: 'domestic',
    destinationZone: 'nonlocal',
    sender: sender('domestic-c022', {
      contact: '10000000029',
      name: '林澈',
      identityValue: '',
      gender: '',
      unit: '晨光手作室',
    }),
    recipient: recipient('domestic-c023', {
      contact: '10000000033',
      name: '顾遥',
      unit: '远行研习社',
    }),
    itemCode: 'PA26081000001',
    weightGrams: 1110,
    packaging: '纸箱',
    contents: '练习用品',
    parcelTariffZone: '2',
  }),
  makeOrder({
    source: 'parcel-partner',
    orderNumber: 'YY2608100002',
    lookupPhone: '10000000030',
    productId: 'catalog-310',
    productFamily: 'parcel',
    destinationRegion: 'domestic',
    destinationZone: 'nonlocal',
    sender: sender('domestic-c109', {
      contact: '10000000030',
      name: '周砚',
      identityValue: '990101199001010019',
      gender: 'male',
      unit: '星湾工坊',
    }),
    recipient: recipient('domestic-c023', {
      contact: '10000000034',
      name: '沈禾',
      unit: '云桥书屋',
    }),
    itemCode: 'PX26081000002',
    weightGrams: 2000,
    packaging: '标准纸箱',
    contents: '书籍',
    platformQuoteCents: 1680,
    mailInformationLocked: true,
  }),
  makeOrder({
    source: 'delivery-platform',
    orderNumber: 'YY2608100003',
    lookupPhone: '10000000031',
    productId: 'catalog-310',
    productFamily: 'parcel',
    destinationRegion: 'domestic',
    destinationZone: 'nonlocal',
    sender: sender('domestic-c022', {
      contact: '10000000031',
      name: '许舟',
      identityValue: '990101198805120024',
      gender: 'female',
      unit: '清风设计室',
    }),
    recipient: recipient('domestic-c023', {
      contact: '10000000035',
      name: '苏澄',
      unit: '青岚社',
    }),
    itemCode: 'PX26081000003',
    weightGrams: 1000,
    packaging: '文件袋',
    contents: '资料',
    platformQuoteCents: 800,
    discountCents: 200,
  }),
  makeOrder({
    source: 'express-channel',
    orderNumber: 'YY2608100004',
    lookupPhone: '10000000032',
    productId: 'catalog-400',
    productFamily: 'express',
    destinationRegion: 'domestic',
    destinationZone: 'nonlocal',
    sender: sender('domestic-c109', {
      contact: '10000000032',
      name: '叶青',
      identityValue: '990101199507230035',
      gender: 'female',
      unit: '新程工作室',
    }),
    recipient: recipient('domestic-c023', {
      contact: '10000000036',
      name: '方远',
      unit: '山海研究室',
    }),
    itemCode: '260810000004',
    weightGrams: 1200,
    packaging: '特快封套',
    contents: '文件',
    platformQuoteCents: 1200,
  }),
  makeOrder({
    source: 'customer-self-service',
    orderNumber: 'YY2608100005',
    lookupPhone: '10000000016',
    productId: 'catalog-300',
    productFamily: 'parcel',
    destinationRegion: 'domestic',
    destinationZone: 'nonlocal',
    sender: sender('domestic-c022', {
      agreementAccountId: '91000000000001',
      agreementAccountName: '星河合作社',
      contact: '10000000016',
      name: '林澄',
      identityValue: '99010119921108004X',
      gender: 'male',
      unit: '星河合作社',
    }),
    recipient: recipient('domestic-c023', {
      contact: '10000000037',
      name: '唐宁',
      unit: '同创练习中心',
    }),
    itemCode: 'PA26081000005',
    weightGrams: 1000,
    packaging: '客户自备纸箱',
    contents: '样品',
    parcelTariffZone: '2',
    paymentMethod: 'credit',
    mailInformationLocked: true,
    labelAlreadyPrinted: true,
  }),
]

function acceptedAppointment(
  state: ServiceWorkspaceState,
  orderNumber: string,
): boolean {
  return state.transactions.some(
    (transaction) =>
      transaction.source === 'appointment' &&
      transaction.sourceOrderNumber === orderNumber,
  )
}

export function queryAppointmentOrder(
  state: ServiceWorkspaceState,
  source: ServiceAppointmentSource,
  query: string,
): AppointmentOrder {
  const normalized = query.trim().toUpperCase()
  if (!normalized) throw new Error('请输入预约单号或联系电话。')
  const order = APPOINTMENT_ORDERS.find((candidate) => {
    if (candidate.source !== source) return false
    if (candidate.orderNumber.toUpperCase() === normalized) return true
    if (source === 'customer-self-service') {
      return candidate.draft.itemCode.toUpperCase() === normalized
    }
    return candidate.lookupPhone === normalized
  })
  if (!order) throw new Error('未查询到对应预约信息，请核对来源与查询条件。')
  if (acceptedAppointment(state, order.orderNumber)) {
    throw new Error('该预约单已经完成收寄，不可重复办理。')
  }
  return structuredClone(order)
}

function appointmentOrderBySnapshot(
  appointment: ServiceAppointmentSnapshot,
): AppointmentOrder | null {
  return APPOINTMENT_ORDERS.find(
    (order) =>
      order.source === appointment.source &&
      order.orderNumber === appointment.orderNumber,
  ) ?? null
}

function lockedDraftProjection(draft: ServiceDraft) {
  return {
    productId: draft.productId,
    destinationZone: draft.destinationZone,
    destinationOffice: draft.destinationOffice,
    itemCode: draft.itemCode,
    remark: draft.remark,
    weightGrams: draft.weightGrams,
    quantity: draft.quantity,
    paymentMethod: draft.paymentMethod,
    packaging: draft.packaging,
    lengthCm: draft.lengthCm,
    widthCm: draft.widthCm,
    heightCm: draft.heightCm,
    contents: draft.contents,
    parcelTariffZone: draft.parcelTariffZone,
    platformQuoteCents: draft.platformQuoteCents,
  }
}

function customerProjection(customer: AcceptServiceRequest['customer']) {
  return {
    productFamily: customer.productFamily,
    destinationRegion: customer.destinationRegion,
    sender: {
      agreementAccountId: customer.sender.agreementAccountId,
      agreementAccountName: customer.sender.agreementAccountName,
      contact: customer.sender.contact,
      name: customer.sender.name,
      identityType: customer.sender.identityType,
      identityValue: customer.sender.identityValue,
      gender: customer.sender.gender,
      detailedAddress: customer.sender.detailedAddress,
      unit: customer.sender.unit,
      postalCode: customer.sender.postalCode,
    },
    recipient: {
      contact: customer.recipient.contact,
      name: customer.recipient.name,
      detailedAddress: customer.recipient.detailedAddress,
      unit: customer.recipient.unit,
      postalCode: customer.recipient.postalCode,
    },
  }
}

export function validateAppointmentAcceptance(
  state: ServiceWorkspaceState,
  request: AcceptServiceRequest,
): void {
  const appointment = request.draft.appointment
  if (!appointment) return
  const order = appointmentOrderBySnapshot(appointment)
  if (!order) throw new Error('预约单来源或单号已失效，请重新查询。')
  if (acceptedAppointment(state, appointment.orderNumber)) {
    throw new Error('该预约单已经完成收寄，不可重复办理。')
  }
  if (
    request.product.id !== order.draft.productId ||
    request.draft.productId !== order.draft.productId
  ) {
    throw new Error('预约业务产品与原预约不一致，请重新查询。')
  }
  const expectedAppointment = order.draft.appointment
  if (
    !expectedAppointment ||
    appointment.source !== expectedAppointment.source ||
    appointment.sourceLabel !== expectedAppointment.sourceLabel ||
    appointment.orderNumber !== expectedAppointment.orderNumber ||
    appointment.discountCents !== expectedAppointment.discountCents ||
    appointment.mailInformationLocked !== expectedAppointment.mailInformationLocked ||
    appointment.labelAlreadyPrinted !== expectedAppointment.labelAlreadyPrinted ||
    appointment.retrievedAt !== expectedAppointment.retrievedAt
  ) {
    throw new Error('预约来源、优惠或面单状态发生变化，请重新查询。')
  }
  if (
    appointment.source === 'customer-self-service' &&
    (!request.customer.sender.agreementAccountId || request.draft.paymentMethod !== 'credit')
  ) {
    throw new Error('客户自助预约必须使用对应协议账户记欠收寄。')
  }
  if (appointment.mailInformationLocked) {
    if (
      JSON.stringify(customerProjection(request.customer)) !== JSON.stringify(customerProjection({
        productFamily: order.customer.productFamily,
        destinationRegion: order.customer.destinationRegion,
        sender: order.customer.sender,
        recipient: order.customer.recipient,
      })) ||
      JSON.stringify(lockedDraftProjection(request.draft)) !==
        JSON.stringify(lockedDraftProjection(order.draft))
    ) {
      throw new Error('该预约来源的寄收件人与邮件信息不可修改，请重新查询。')
    }
  }
}
