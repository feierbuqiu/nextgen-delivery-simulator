import type {
  AgreementAccount,
  CustomerContact,
  CustomerHistoryRecord,
  SenderProfile,
} from './types'

export type CustomerField =
  | keyof CustomerContact
  | 'identityType'
  | 'identityValue'

export type CustomerErrors = Partial<Record<CustomerField | 'form', string>>

export interface CustomerValidationResult {
  valid: boolean
  errors: CustomerErrors
}

export function isValidContact(value: string): boolean {
  const contact = value.trim()
  if (!contact) return true
  return /^1\d{10}$/.test(contact) || /^0\d{2,3}-\d{7,8}(?:-\d{1,6})?$/.test(contact)
}

export function resolvePostalCode(
  value: string,
  knownCodes: string[],
): string | null {
  const postalCode = value.trim()
  if (!/^\d{1,6}$/.test(postalCode)) return null
  if (postalCode.length === 6) return postalCode
  return [...knownCodes].sort().find((code) => code.startsWith(postalCode)) ?? null
}

export function isValidResidentIdentity(value: string): boolean {
  const identity = value.trim().toUpperCase()
  if (!/^\d{17}[\dX]$/.test(identity)) return false
  if (identity.slice(0, 6) === '000000' || identity.slice(14, 17) === '000') {
    return false
  }

  const year = Number(identity.slice(6, 10))
  const month = Number(identity.slice(10, 12))
  const day = Number(identity.slice(12, 14))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false
  }

  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const sum = identity
    .slice(0, 17)
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0)
  return checks[sum % 11] === identity[17]
}

function validateBaseCustomer(customer: CustomerContact): CustomerErrors {
  const errors: CustomerErrors = {}
  if (!customer.contact.trim() && !customer.name.trim()) {
    errors.form = '联系电话和姓名至少填写一项。'
  }
  if (!isValidContact(customer.contact)) {
    errors.contact = '请输入 11 位手机号，或使用连字符分隔的固定电话。'
  }
  if (!customer.detailedAddress.trim() && !customer.unit.trim()) {
    errors.detailedAddress = '详细地址和单位至少填写一项。'
  }
  if (customer.postalCode.trim() && !/^\d{1,6}$/.test(customer.postalCode.trim())) {
    errors.postalCode = '邮编只能包含 1 至 6 位数字。'
  }
  return errors
}

export function validateSender(
  sender: SenderProfile,
  identityRequired: boolean,
): CustomerValidationResult {
  const errors = validateBaseCustomer(sender)
  if (identityRequired && !sender.identityType) {
    errors.identityType = '当前产品需要选择身份证明类型。'
  }
  if (identityRequired && !sender.identityValue.trim()) {
    errors.identityValue = '当前产品需要填写身份证明号码。'
  }
  if (sender.identityValue.trim()) {
    const length = Array.from(sender.identityValue.trim()).length
    if (sender.identityType === 'primary' && !isValidResidentIdentity(sender.identityValue)) {
      errors.identityValue = '居民身份证号码须为 18 位，末位可为 X，并通过出生日期和校验码检查。'
    }
    if (sender.identityType !== 'primary' && length > 20) {
      errors.identityValue = '其他身份证明号码不得超过 20 个字符。'
    }
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

export function validateRecipient(
  recipient: CustomerContact,
): CustomerValidationResult {
  const errors = validateBaseCustomer(recipient)
  return { valid: Object.keys(errors).length === 0, errors }
}

export function searchAgreementAccounts(
  accounts: AgreementAccount[],
  query: string,
): AgreementAccount[] {
  const term = query.trim()
  if (!term) return accounts
  if (/^\d+$/.test(term)) {
    return accounts.filter((account) => account.id.includes(term))
  }
  if (/^[A-Za-z]+$/.test(term)) {
    const mnemonic = term.toUpperCase()
    return accounts.filter((account) => account.mnemonic.includes(mnemonic))
  }
  return accounts.filter((account) => account.name === term)
}

export function searchCustomerHistory(
  records: CustomerHistoryRecord[],
  contact: string,
  name: string,
): CustomerHistoryRecord[] {
  const normalizedContact = contact.trim()
  const normalizedName = name.trim()
  if (!normalizedContact && !normalizedName) return []
  return records.filter(
    (record) =>
      (normalizedContact && record.contact === normalizedContact) ||
      (normalizedName && record.name.includes(normalizedName)),
  )
}
