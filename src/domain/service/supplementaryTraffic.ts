import type { SenderProfile } from '../customer/types'
import {
  fictionalDetailedAddress,
  postalAdministrativeRecordByCountyId,
} from '../customer/postalAdministrativeDirectory'
import { businessCalendarDay } from '../shared/businessTime'
import { DEFAULT_SERVICE_OPERATOR } from './transactions'
import { assertAccountingOpen } from './personalRemittance'
import type {
  RoundTripReturnRecord,
  ServiceOperatorSnapshot,
  ServicePaymentMethod,
  ServiceWorkspaceState,
  SingleJourneyPaymentRecord,
  SupplementaryIncomeRecord,
  SupplementaryCustomerKind,
  SupplementaryTrafficRecord,
  TrafficBulkMailRecord,
  TrafficMailRemark,
  TrafficMailSnapshot,
} from './types'

export interface SupplementarySubject {
  categoryCode: 'BL04'
  categoryLabel: '电子商务和代理补录'
  sequence: 71 | 74
  code: '1YWBL01047' | '1YWBL01048'
  label: '第三方平台产品推广' | '普惠保险协办费'
  creditAllowed: true
  bulkAllowed: true
}

export const SUPPLEMENTARY_SUBJECTS: SupplementarySubject[] = [
  {
    categoryCode: 'BL04',
    categoryLabel: '电子商务和代理补录',
    sequence: 71,
    code: '1YWBL01047',
    label: '第三方平台产品推广',
    creditAllowed: true,
    bulkAllowed: true,
  },
  {
    categoryCode: 'BL04',
    categoryLabel: '电子商务和代理补录',
    sequence: 74,
    code: '1YWBL01048',
    label: '普惠保险协办费',
    creditAllowed: true,
    bulkAllowed: true,
  },
]

interface TrafficMailFixture {
  mail: TrafficMailSnapshot
  productionFeeCents: number
  bulkPostageCents: number | null
  singleJourneyEligible: boolean
  roundTripEligible: boolean
}

const TRAFFIC_MAIL_FIXTURES: TrafficMailFixture[] = [
  {
    mail: {
      productSearchCode: '405',
      productLabel: '交管专项特快',
      effectiveBusinessCode: '405100',
      destinationZone: 'nonlocal',
      mailNumber: '1115206600001',
      recipientName: '顾远',
      recipientTelephone: '01099001001',
      recipientMobile: '10000000019',
      recipientAddress: fictionalDetailedAddress('C023'),
      recipientPostalCode: postalAdministrativeRecordByCountyId('C023').postalCode,
      remark: 'single-document',
      weightGrams: 100,
    },
    productionFeeCents: 0,
    bulkPostageCents: 1500,
    singleJourneyEligible: false,
    roundTripEligible: false,
  },
  {
    mail: {
      productSearchCode: '405',
      productLabel: '交管专项特快',
      effectiveBusinessCode: '405100',
      destinationZone: 'nonlocal',
      mailNumber: '1115206600002',
      recipientName: '沈禾',
      recipientTelephone: '02199001002',
      recipientMobile: '10000000022',
      recipientAddress: fictionalDetailedAddress('C049', '新程路', 38),
      recipientPostalCode: postalAdministrativeRecordByCountyId('C049').postalCode,
      remark: 'single-document',
      weightGrams: 100,
    },
    productionFeeCents: 1500,
    bulkPostageCents: null,
    singleJourneyEligible: true,
    roundTripEligible: false,
  },
  {
    mail: {
      productSearchCode: '405',
      productLabel: '交管专项特快',
      effectiveBusinessCode: '405100',
      destinationZone: 'nonlocal',
      mailNumber: '1115202400001',
      recipientName: '闻澄',
      recipientTelephone: '087199001003',
      recipientMobile: '10000000023',
      recipientAddress: fictionalDetailedAddress('C050', '新程路', 52),
      recipientPostalCode: postalAdministrativeRecordByCountyId('C050').postalCode,
      remark: 'round-trip-document',
      weightGrams: 100,
    },
    productionFeeCents: 0,
    bulkPostageCents: null,
    singleJourneyEligible: false,
    roundTripEligible: true,
  },
  {
    mail: {
      productSearchCode: '405',
      productLabel: '交管专项特快',
      effectiveBusinessCode: '405000',
      destinationZone: 'local',
      mailNumber: '1115202400002',
      recipientName: '林岚',
      recipientTelephone: '01099001004',
      recipientMobile: '10000000024',
      recipientAddress: fictionalDetailedAddress('C022', '新程路', 109),
      recipientPostalCode: postalAdministrativeRecordByCountyId('C022').postalCode,
      remark: 'round-trip-document',
      weightGrams: 100,
    },
    productionFeeCents: 0,
    bulkPostageCents: null,
    singleJourneyEligible: false,
    roundTripEligible: true,
  },
]

export type TrafficMailPurpose = 'bulk' | 'single-journey' | 'round-trip'

export interface TrafficMailMatch {
  mail: TrafficMailSnapshot
  productionFeeCents: number
  bulkPostageCents: number | null
}

interface AcceptRequestBase {
  acceptedAt: string
  sender: SenderProfile
  operator?: ServiceOperatorSnapshot
}

export interface AcceptSupplementaryIncomeRequest extends AcceptRequestBase {
  kind: 'supplementary-income'
  subjectCode: string
  count: number
  amountCents: number
  paymentMethod: ServicePaymentMethod
}

export interface AcceptTrafficBulkMailRequest extends AcceptRequestBase {
  kind: 'traffic-bulk-mail'
  mailNumber: string
}

export interface AcceptSingleJourneyPaymentRequest extends AcceptRequestBase {
  kind: 'single-journey-payment'
  mailNumber: string
  collectOnDeliveryCents: number
}

export interface AcceptRoundTripReturnRequest extends AcceptRequestBase {
  kind: 'round-trip-return'
  mail: TrafficMailSnapshot
  productionFeeCents: number
}

export type AcceptSupplementaryTrafficRequest =
  | AcceptSupplementaryIncomeRequest
  | AcceptTrafficBulkMailRequest
  | AcceptSingleJourneyPaymentRequest
  | AcceptRoundTripReturnRequest

export interface AcceptedSupplementaryTrafficResult {
  state: ServiceWorkspaceState
  record: SupplementaryTrafficRecord
}

function customerName(sender: SenderProfile): string {
  return sender.agreementAccountName.trim() || sender.name.trim() || sender.unit.trim()
}

export function supplementaryTrafficRecordId(
  kind: SupplementaryTrafficRecord['kind'],
  acceptedAt: string,
  sequence: number,
): string {
  const prefixes: Record<SupplementaryTrafficRecord['kind'], string> = {
    'supplementary-income': 'BL',
    'traffic-bulk-mail': 'JG',
    'single-journey-payment': 'DC',
    'round-trip-return': 'SC',
  }
  const date = businessCalendarDay(acceptedAt).replaceAll('-', '')
  return `${prefixes[kind]}-${date}-${String(sequence).padStart(6, '0')}`
}

function normalizedMailNumber(value: string): string {
  return value.replace(/\s/g, '')
}

function validContact(value: string): boolean {
  return /^\d{6,20}$/.test(value)
}

function validateMailSnapshot(mail: TrafficMailSnapshot): void {
  if (!/^\d{13}$/.test(mail.mailNumber)) throw new Error('邮件号码必须为 13 位数字。')
  if (mail.productSearchCode !== '405' || mail.productLabel !== '交管专项特快') {
    throw new Error('匹配业务产品必须为交管专项特快（405）。')
  }
  const expectedCode = mail.destinationZone === 'local' ? '405000' : '405100'
  if (mail.effectiveBusinessCode !== expectedCode) throw new Error('业务代码与区域不一致。')
  if (mail.recipientName.trim().length < 2) throw new Error('收件人姓名至少填写 2 个字符。')
  if (!validContact(mail.recipientTelephone) || !validContact(mail.recipientMobile)) {
    throw new Error('收件人电话和手机必须为 6 至 20 位数字。')
  }
  if (mail.recipientAddress.trim().length < 7) throw new Error('收件人地址至少填写 7 个字符。')
  if (!/^\d{6}$/.test(mail.recipientPostalCode)) throw new Error('收件人邮编必须为 6 位数字。')
  if (!Number.isInteger(mail.weightGrams) || mail.weightGrams < 1 || mail.weightGrams > 30000) {
    throw new Error('邮件重量必须为 1 至 30000 克的整数。')
  }
}

export function matchTrafficMail(mailNumber: string, purpose: TrafficMailPurpose): TrafficMailMatch {
  const normalized = normalizedMailNumber(mailNumber)
  const fixture = TRAFFIC_MAIL_FIXTURES.find((candidate) => {
    if (candidate.mail.mailNumber !== normalized) return false
    if (purpose === 'bulk') return candidate.bulkPostageCents !== null
    if (purpose === 'single-journey') return candidate.singleJourneyEligible
    return candidate.roundTripEligible
  })
  if (!fixture) throw new Error('未匹配到该邮件号码对应的可办理记录。')
  return structuredClone({
    mail: fixture.mail,
    productionFeeCents: fixture.productionFeeCents,
    bulkPostageCents: fixture.bulkPostageCents,
  })
}

export function trafficMailExample(purpose: TrafficMailPurpose): string {
  const fixture = TRAFFIC_MAIL_FIXTURES.find((candidate) => (
    purpose === 'bulk'
      ? candidate.bulkPostageCents !== null
      : purpose === 'single-journey'
      ? candidate.singleJourneyEligible
      : candidate.roundTripEligible
  ))
  return fixture?.mail.mailNumber ?? ''
}

export function roundTripQuoteCents(mail: TrafficMailSnapshot): number {
  validateMailSnapshot(mail)
  const firstWeightCents = mail.destinationZone === 'local' ? 1000 : 1250
  const additionalUnits = Math.max(0, Math.ceil((mail.weightGrams - 500) / 500))
  return firstWeightCents + additionalUnits * 500
}

function alreadyRecorded(
  state: ServiceWorkspaceState,
  kind: SupplementaryTrafficRecord['kind'],
  mailNumber: string,
): boolean {
  return state.supplementaryTrafficRecords.some((record) => (
    record.status !== 'deleted' && record.status !== 'adjusted' &&
    record.kind === kind && record.kind !== 'supplementary-income' &&
    record.mail.mailNumber === mailNumber
  ))
}

export function acceptSupplementaryTraffic(
  state: ServiceWorkspaceState,
  request: AcceptSupplementaryTrafficRequest,
): AcceptedSupplementaryTrafficResult {
  if (!request.acceptedAt.match(/^\d{4}-\d{2}-\d{2}T/)) throw new Error('录入时间格式无效。')
  const operator = structuredClone(request.operator ?? DEFAULT_SERVICE_OPERATOR)
  assertAccountingOpen(state, operator, request.acceptedAt)
  const name = customerName(request.sender)
  if (!name) throw new Error('请先维护当前客户名称。')
  const customerKind: SupplementaryCustomerKind = request.sender.agreementAccountId
    ? 'agreement'
    : 'retail'
  const base = {
    id: supplementaryTrafficRecordId(
      request.kind,
      request.acceptedAt,
      state.nextSupplementaryTrafficSequence,
    ),
    status: 'pending-settlement' as const,
    acceptedAt: request.acceptedAt,
    operator,
    customerKind,
    customerName: name,
    agreementAccountId: request.sender.agreementAccountId ?? '',
    settlementId: null,
    corrections: [],
    replacesRecordId: null,
    replacementRecordId: null,
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
  }

  let record: SupplementaryTrafficRecord
  if (request.kind === 'supplementary-income') {
    const subject = SUPPLEMENTARY_SUBJECTS.find((candidate) => candidate.code === request.subjectCode)
    if (!subject) throw new Error('请选择有效的补录科目。')
    if (!Number.isInteger(request.count) || request.count < 1) throw new Error('件／笔数必须为正整数。')
    if (!Number.isInteger(request.amountCents) || request.amountCents < 1) throw new Error('补录金额必须大于 0 元。')
    if (request.paymentMethod !== 'cash-settlement' && request.paymentMethod !== 'credit') {
      throw new Error('补录付费方式仅支持现结或记欠。')
    }
    if (request.paymentMethod === 'credit' && customerKind !== 'agreement') {
      throw new Error('零星客户不能选择记欠，请先维护协议客户信息。')
    }
    record = {
      ...base,
      kind: request.kind,
      paymentMethod: request.paymentMethod,
      amountCents: request.amountCents,
      subjectCategoryCode: subject.categoryCode,
      subjectCategoryLabel: subject.categoryLabel,
      subjectCode: subject.code,
      subjectLabel: subject.label,
      count: request.count,
      acceptanceMethod: 'counter',
      creditAllowed: subject.creditAllowed,
      bulkAllowed: subject.bulkAllowed,
    } satisfies SupplementaryIncomeRecord
  } else if (request.kind === 'traffic-bulk-mail') {
    if (customerKind !== 'agreement') throw new Error('请先维护协议客户信息。')
    const matched = matchTrafficMail(request.mailNumber, 'bulk')
    if (alreadyRecorded(state, request.kind, matched.mail.mailNumber)) throw new Error('该邮件已经完成交管大宗收寄。')
    record = {
      ...base,
      kind: request.kind,
      paymentMethod: 'credit',
      amountCents: matched.bulkPostageCents!,
      mail: matched.mail,
      productionFeeCents: matched.productionFeeCents,
      totalPostageCents: matched.bulkPostageCents!,
    } satisfies TrafficBulkMailRecord
  } else if (request.kind === 'single-journey-payment') {
    const matched = matchTrafficMail(request.mailNumber, 'single-journey')
    if (alreadyRecorded(state, request.kind, matched.mail.mailNumber)) throw new Error('该邮件已经完成单程投递缴款。')
    if (!Number.isInteger(request.collectOnDeliveryCents) || request.collectOnDeliveryCents < 1) {
      throw new Error('到付邮费必须大于 0 元。')
    }
    record = {
      ...base,
      kind: request.kind,
      paymentMethod: 'cash-settlement',
      amountCents: request.collectOnDeliveryCents,
      mail: matched.mail,
      collectOnDeliveryCents: request.collectOnDeliveryCents,
      productionFeeCents: matched.productionFeeCents,
    } satisfies SingleJourneyPaymentRecord
  } else {
    const matched = matchTrafficMail(request.mail.mailNumber, 'round-trip')
    if (alreadyRecorded(state, request.kind, matched.mail.mailNumber)) throw new Error('该邮件已经完成双程返程收寄。')
    validateMailSnapshot(request.mail)
    if (request.mail.remark !== 'round-trip-document') throw new Error('双程返程收寄必须选择双程证件备注。')
    if (!Number.isInteger(request.productionFeeCents) || request.productionFeeCents < 0) {
      throw new Error('工本费必须为不小于 0 的金额。')
    }
    const quotedPostageCents = roundTripQuoteCents(request.mail)
    record = {
      ...base,
      kind: request.kind,
      paymentMethod: 'cash-settlement',
      amountCents: quotedPostageCents,
      mail: structuredClone(request.mail),
      productionFeeCents: request.productionFeeCents,
      quotedPostageCents,
    } satisfies RoundTripReturnRecord
  }

  return {
    record,
    state: {
      ...state,
      supplementaryTrafficRecords: [...state.supplementaryTrafficRecords, record],
      nextSupplementaryTrafficSequence: state.nextSupplementaryTrafficSequence + 1,
    },
  }
}

export interface TrafficStatisticsQuery {
  mailNumber: string
  acceptedDateFrom: string
  acceptedDateTo: string
  kind: '' | Exclude<SupplementaryTrafficRecord['kind'], 'supplementary-income'>
  remark: '' | TrafficMailRemark
}

export function queryTrafficStatistics(
  records: SupplementaryTrafficRecord[],
  query: TrafficStatisticsQuery,
): Array<TrafficBulkMailRecord | SingleJourneyPaymentRecord | RoundTripReturnRecord> {
  const normalized = normalizedMailNumber(query.mailNumber)
  return records
    .filter((record): record is TrafficBulkMailRecord | SingleJourneyPaymentRecord | RoundTripReturnRecord => (
      record.kind !== 'supplementary-income'
    ))
    .filter((record) => record.status !== 'deleted' && record.status !== 'adjusted')
    .filter((record) => !normalized || record.mail.mailNumber.includes(normalized))
    .filter((record) => !query.acceptedDateFrom || businessCalendarDay(record.acceptedAt) >= query.acceptedDateFrom)
    .filter((record) => !query.acceptedDateTo || businessCalendarDay(record.acceptedAt) <= query.acceptedDateTo)
    .filter((record) => !query.kind || record.kind === query.kind)
    .filter((record) => !query.remark || record.mail.remark === query.remark)
    .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))
}

export function supplementaryTrafficKindLabel(kind: SupplementaryTrafficRecord['kind']): string {
  const labels: Record<SupplementaryTrafficRecord['kind'], string> = {
    'supplementary-income': '补录操作',
    'traffic-bulk-mail': '交管大宗邮件收寄',
    'single-journey-payment': '单程邮件投递缴款',
    'round-trip-return': '双程邮件返程收寄',
  }
  return labels[kind]
}

export function trafficRemarkLabel(remark: TrafficMailRemark): string {
  return remark === 'single-document' ? '单程证件' : '双程证件'
}
