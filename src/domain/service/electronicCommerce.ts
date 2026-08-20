import {
  fictionalDetailedAddress,
  postalAdministrativeRecordByCountyId,
} from '../customer/postalAdministrativeDirectory'
import { businessCalendarDay } from '../shared/businessTime'
import { DEFAULT_SERVICE_OPERATOR } from './transactions'
import { assertAccountingOpen } from './personalRemittance'
import type {
  ElectronicCommerceProjectId,
  ElectronicCommerceRecord,
  PhoneTopupRecord,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
  UtilityPaymentRecord,
} from './types'

export interface ElectronicCommerceProvider {
  id: string
  label: string
}

export interface ElectronicCommerceProject {
  id: ElectronicCommerceProjectId
  kind: ElectronicCommerceRecord['kind']
  label: string
  accountLabel: string
  providers: ElectronicCommerceProvider[]
}

export interface ElectronicCommerceAccount {
  projectId: ElectronicCommerceProjectId
  providerId: string
  accountNumber: string
  customerName: string
  customerAddress: string
  dueAmountCents: number | null
  accountBalanceCents: number | null
}

export const ELECTRONIC_COMMERCE_PROJECTS: ElectronicCommerceProject[] = [
  {
    id: 'water',
    kind: 'utility-payment',
    label: '水费',
    accountLabel: '缴费账户',
    providers: [{ id: 'lanjing-water', label: '澜京清流服务站' }],
  },
  {
    id: 'electricity',
    kind: 'utility-payment',
    label: '电费',
    accountLabel: '缴费账户',
    providers: [{ id: 'lanjing-electricity', label: '澜京光明服务站' }],
  },
  {
    id: 'gas',
    kind: 'utility-payment',
    label: '燃气费',
    accountLabel: '缴费账户',
    providers: [{ id: 'lanjing-gas', label: '澜京暖源服务站' }],
  },
  {
    id: 'cable-tv',
    kind: 'utility-payment',
    label: '有线电视费',
    accountLabel: '缴费账户',
    providers: [{ id: 'lanjing-cable', label: '澜京映彩服务站' }],
  },
  {
    id: 'broadband',
    kind: 'utility-payment',
    label: '宽带费',
    accountLabel: '缴费账户',
    providers: [{ id: 'lanjing-broadband', label: '澜京星桥网络服务站' }],
  },
  {
    id: 'mobile',
    kind: 'phone-topup',
    label: '手机缴费',
    accountLabel: '手机号码',
    providers: [{ id: 'lanjing-mobile', label: '澜京星桥通信服务站' }],
  },
  {
    id: 'landline',
    kind: 'phone-topup',
    label: '固话缴费',
    accountLabel: '固话号码',
    providers: [{ id: 'lanjing-landline', label: '澜京长风固话服务站' }],
  },
]

const ELECTRONIC_COMMERCE_ACCOUNTS: ElectronicCommerceAccount[] = [
  {
    projectId: 'water',
    providerId: 'lanjing-water',
    accountNumber: '856461',
    customerName: '周清禾',
    customerAddress: fictionalDetailedAddress('C002', '新程路', 26),
    dueAmountCents: 6000,
    accountBalanceCents: null,
  },
  {
    projectId: 'electricity',
    providerId: 'lanjing-electricity',
    accountNumber: '230118',
    customerName: '林景和',
    customerAddress: fictionalDetailedAddress('C001', '同心路', 18),
    dueAmountCents: 8860,
    accountBalanceCents: null,
  },
  {
    projectId: 'gas',
    providerId: 'lanjing-gas',
    accountNumber: '779921',
    customerName: '沈秋实',
    customerAddress: fictionalDetailedAddress('C022', '新程路', 79),
    dueAmountCents: 4550,
    accountBalanceCents: null,
  },
  {
    projectId: 'cable-tv',
    providerId: 'lanjing-cable',
    accountNumber: '640018',
    customerName: '顾远',
    customerAddress: fictionalDetailedAddress('C003', '和光路', 40),
    dueAmountCents: 2800,
    accountBalanceCents: null,
  },
  {
    projectId: 'broadband',
    providerId: 'lanjing-broadband',
    accountNumber: '830016',
    customerName: '闻澜',
    customerAddress: fictionalDetailedAddress('C002', '新程路', 83),
    dueAmountCents: 9900,
    accountBalanceCents: null,
  },
  {
    projectId: 'mobile',
    providerId: 'lanjing-mobile',
    accountNumber: '10000000038',
    customerName: '林屿',
    customerAddress: postalAdministrativeRecordByCountyId('C002').compactHierarchy,
    dueAmountCents: null,
    accountBalanceCents: 3764,
  },
  {
    projectId: 'landline',
    providerId: 'lanjing-landline',
    accountNumber: '01099001234',
    customerName: '顾远',
    customerAddress: postalAdministrativeRecordByCountyId('C003').compactHierarchy,
    dueAmountCents: null,
    accountBalanceCents: 1260,
  },
]

export interface AcceptElectronicCommerceRequest {
  acceptedAt: string
  projectId: ElectronicCommerceProjectId
  providerId: string
  accountNumber: string
  amountCents: number
  operator?: ServiceOperatorSnapshot
}

export interface AcceptedElectronicCommerceResult {
  state: ServiceWorkspaceState
  record: ElectronicCommerceRecord
}

export interface ElectronicCommerceQuery {
  projectId: '' | ElectronicCommerceProjectId
  status: '' | ElectronicCommerceRecord['status']
  operatorId: string
  acceptedDateFrom: string
  acceptedDateTo: string
}

function normalizeAccountNumber(value: string): string {
  return value.replace(/\s/g, '')
}

function recordId(acceptedAt: string, sequence: number): string {
  const date = businessCalendarDay(acceptedAt).replaceAll('-', '')
  return `DS-${date}-${String(sequence).padStart(6, '0')}`
}

export function electronicCommerceProject(
  projectId: ElectronicCommerceProjectId,
): ElectronicCommerceProject {
  const project = ELECTRONIC_COMMERCE_PROJECTS.find((candidate) => candidate.id === projectId)
  if (!project) throw new Error('请选择有效的缴费项目。')
  return project
}

export function electronicCommerceExampleAccount(
  projectId: ElectronicCommerceProjectId,
): string {
  return ELECTRONIC_COMMERCE_ACCOUNTS.find((candidate) => candidate.projectId === projectId)
    ?.accountNumber ?? ''
}

export function resolveElectronicCommerceAccount(
  state: ServiceWorkspaceState,
  projectId: ElectronicCommerceProjectId,
  providerId: string,
  accountNumber: string,
): ElectronicCommerceAccount {
  const project = electronicCommerceProject(projectId)
  if (!project.providers.some((provider) => provider.id === providerId)) {
    throw new Error('缴费单位与缴费项目不匹配。')
  }
  const normalized = normalizeAccountNumber(accountNumber)
  const fixture = ELECTRONIC_COMMERCE_ACCOUNTS.find((candidate) => (
    candidate.projectId === projectId &&
    candidate.providerId === providerId &&
    candidate.accountNumber === normalized
  ))
  if (!fixture) throw new Error('未查询到该缴费账户，请核对缴费项目、单位和号码。')
  if (project.kind === 'utility-payment') {
    const alreadyPaid = state.electronicCommerceRecords.some((record) => (
      record.kind === 'utility-payment' &&
      record.projectId === projectId &&
      record.providerId === providerId &&
      record.accountNumber === normalized
    ))
    if (alreadyPaid) throw new Error('该账单已经完成业务受理，不能重复缴费。')
  }
  const completedTopups = state.electronicCommerceRecords
    .filter((record) => (
      record.kind === 'phone-topup' &&
      record.projectId === projectId &&
      record.providerId === providerId &&
      record.accountNumber === normalized
    ))
    .reduce((total, record) => total + record.amountCents, 0)
  return {
    ...structuredClone(fixture),
    accountBalanceCents: fixture.accountBalanceCents === null
      ? null
      : fixture.accountBalanceCents + completedTopups,
  }
}

export function acceptElectronicCommerce(
  state: ServiceWorkspaceState,
  request: AcceptElectronicCommerceRequest,
): AcceptedElectronicCommerceResult {
  if (!request.acceptedAt.match(/^\d{4}-\d{2}-\d{2}T/)) {
    throw new Error('业务受理时间格式无效。')
  }
  if (!Number.isInteger(request.amountCents) || request.amountCents < 1) {
    throw new Error('缴费或充值金额必须大于 0 元。')
  }
  const operator = structuredClone(request.operator ?? DEFAULT_SERVICE_OPERATOR)
  assertAccountingOpen(state, operator, request.acceptedAt)
  const project = electronicCommerceProject(request.projectId)
  const account = resolveElectronicCommerceAccount(
    state,
    request.projectId,
    request.providerId,
    request.accountNumber,
  )
  const provider = project.providers.find((candidate) => candidate.id === request.providerId)!
  const base = {
    id: recordId(request.acceptedAt, state.nextElectronicCommerceSequence),
    status: 'pending-settlement' as const,
    acceptedAt: request.acceptedAt,
    operator,
    projectLabel: project.label,
    providerId: provider.id,
    providerLabel: provider.label,
    accountNumber: account.accountNumber,
    customerName: account.customerName,
    customerAddress: account.customerAddress,
    paymentMethod: 'cash-settlement' as const,
    amountCents: request.amountCents,
    settlementId: null,
  }
  let record: ElectronicCommerceRecord
  if (project.kind === 'utility-payment') {
    if (request.amountCents !== account.dueAmountCents) {
      throw new Error('缴费金额必须与应缴总额一致。')
    }
    record = {
      ...base,
      kind: 'utility-payment',
      projectId: request.projectId as UtilityPaymentRecord['projectId'],
      dueAmountCents: account.dueAmountCents!,
      accountBalanceBeforeCents: null,
    } satisfies UtilityPaymentRecord
  } else {
    if (request.amountCents < 100 || request.amountCents > 50000) {
      throw new Error('话费充值金额须为 1.00 至 500.00 元。')
    }
    record = {
      ...base,
      kind: 'phone-topup',
      projectId: request.projectId as PhoneTopupRecord['projectId'],
      dueAmountCents: null,
      accountBalanceBeforeCents: account.accountBalanceCents!,
    } satisfies PhoneTopupRecord
  }
  return {
    record,
    state: {
      ...state,
      electronicCommerceRecords: [...state.electronicCommerceRecords, record],
      nextElectronicCommerceSequence: state.nextElectronicCommerceSequence + 1,
    },
  }
}

export function queryElectronicCommerceRecords(
  records: ElectronicCommerceRecord[],
  query: ElectronicCommerceQuery,
): ElectronicCommerceRecord[] {
  const operator = query.operatorId.trim().toLocaleLowerCase('zh-CN')
  return records
    .filter((record) => !query.projectId || record.projectId === query.projectId)
    .filter((record) => !query.status || record.status === query.status)
    .filter((record) => !operator || (
      record.operator.operatorId.toLocaleLowerCase('zh-CN').includes(operator) ||
      record.operator.displayName.toLocaleLowerCase('zh-CN').includes(operator)
    ))
    .filter((record) => !query.acceptedDateFrom || businessCalendarDay(record.acceptedAt) >= query.acceptedDateFrom)
    .filter((record) => !query.acceptedDateTo || businessCalendarDay(record.acceptedAt) <= query.acceptedDateTo)
    .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))
}

export function electronicCommerceStatusLabel(
  status: ElectronicCommerceRecord['status'],
): string {
  return status === 'settled' ? '成功' : '待结算'
}

export function maskElectronicCommerceAccount(accountNumber: string): string {
  if (accountNumber.length <= 6) return accountNumber
  return `${accountNumber.slice(0, 3)}****${accountNumber.slice(-4)}`
}
