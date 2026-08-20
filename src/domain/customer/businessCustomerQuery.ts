import { businessCalendarDay } from '../shared/businessTime'
import { isValidResidentIdentity } from './policy'
import { matchPostalAdministrativeByChannel } from './postalAdministrativeDirectory'
import type {
  AgreementAccount,
  CustomerHistoryRecord,
  CustomerWorkspaceState,
  Gender,
  IdentityType,
} from './types'

export interface BusinessCustomerQuery {
  phone: string
  identityValue: string
}

export interface BusinessCustomerProfile {
  id: string
  source: 'agreement-account' | 'sender-history'
  name: string
  gender: Gender
  age: number | null
  birthDate: string
  region: string
  phone: string
  identityType: IdentityType
  identityValue: string
}

function normalizedQuery(query: BusinessCustomerQuery): BusinessCustomerQuery {
  const phone = query.phone.trim()
  const identityValue = query.identityValue.trim().toUpperCase()
  if (!phone && !identityValue) {
    throw new Error('请输入手机号或证件号。')
  }
  if (phone && !/^1\d{10}$/.test(phone)) {
    throw new Error('手机号须为 11 位数字。')
  }
  if (Array.from(identityValue).length > 20) {
    throw new Error('证件号不得超过 20 个字符。')
  }
  return { phone, identityValue }
}

function birthDateFromAccount(account: AgreementAccount): string {
  if (
    account.identityType !== 'primary' ||
    !account.identityValue ||
    !isValidResidentIdentity(account.identityValue)
  ) return ''
  const value = account.identityValue.toUpperCase()
  return `${value.slice(6, 10)}-${value.slice(10, 12)}-${value.slice(12, 14)}`
}

function genderFromAccount(account: AgreementAccount): Gender {
  if (account.gender) return account.gender
  if (
    account.identityType !== 'primary' ||
    !account.identityValue ||
    !isValidResidentIdentity(account.identityValue)
  ) return ''
  return Number(account.identityValue[16]) % 2 === 0 ? 'female' : 'male'
}

function ageOnDay(birthDate: string, asOf: string | Date): number | null {
  if (!birthDate) return null
  const asOfDay = businessCalendarDay(asOf)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDay)) return null
  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number)
  const [year, month, day] = asOfDay.split('-').map(Number)
  if (!birthYear || !birthMonth || !birthDay || !year || !month || !day) return null
  let age = year - birthYear
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1
  return age >= 0 ? age : null
}

function customerRegion(detailedAddress: string): string {
  const match = matchPostalAdministrativeByChannel(detailedAddress)
  return match?.compactHierarchy ?? detailedAddress.trim()
}

function matchesAccount(
  account: AgreementAccount,
  query: BusinessCustomerQuery,
): boolean {
  if (query.phone && account.contact !== query.phone) return false
  if (
    query.identityValue &&
    account.identityValue?.trim().toUpperCase() !== query.identityValue
  ) return false
  return true
}

function accountProfile(
  account: AgreementAccount,
  asOf: string | Date,
): BusinessCustomerProfile {
  const birthDate = birthDateFromAccount(account)
  return {
    id: `agreement:${account.id}`,
    source: 'agreement-account',
    name: account.senderName || account.name,
    gender: genderFromAccount(account),
    age: ageOnDay(birthDate, asOf),
    birthDate,
    region: customerRegion(account.detailedAddress),
    phone: account.contact,
    identityType: account.identityType ?? '',
    identityValue: account.identityValue ?? '',
  }
}

function historyProfile(record: CustomerHistoryRecord): BusinessCustomerProfile {
  return {
    id: `history:${record.id}`,
    source: 'sender-history',
    name: record.name,
    gender: '',
    age: null,
    birthDate: '',
    region: customerRegion(record.detailedAddress),
    phone: record.contact,
    identityType: '',
    identityValue: '',
  }
}

/**
 * 按本地演练规则执行精确查询。协议客户主记录优先于同手机号的历史寄件快照，
 * 查询只读取已经存在的客户事实，不生成外部 CRM 标签或消费画像。
 */
export function queryBusinessCustomer(
  state: CustomerWorkspaceState,
  query: BusinessCustomerQuery,
  asOf: string | Date = new Date(),
): BusinessCustomerProfile | null {
  const exact = normalizedQuery(query)
  const account = state.agreementAccounts.find((candidate) => (
    matchesAccount(candidate, exact)
  ))
  if (account) return accountProfile(account, asOf)

  // 历史寄件快照没有证件号码；证件号查询不得退化成手机号模糊匹配。
  if (exact.identityValue) return null
  const history = state.senderHistory.find((candidate) => candidate.contact === exact.phone)
  return history ? historyProfile(history) : null
}

export function maskBusinessCustomerPhone(value: string): string {
  const phone = value.trim()
  if (!/^1\d{10}$/.test(phone)) return phone ? '***' : '—'
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}
