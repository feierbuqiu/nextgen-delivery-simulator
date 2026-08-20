import {
  isValidContact,
  isValidResidentIdentity,
} from './policy'
import type {
  AgreementAccount,
  AgreementAccountApplication,
  AgreementCustomerType,
  AgreementPaymentMethod,
  CustomerWorkspaceState,
  Gender,
  IdentityType,
} from './types'
import { sanitizePublicProductData } from '../desensitization/publicText'
import { reconcileKnownPostalAddressData } from './postalAdministrativeDirectory'
import { businessCalendarDay } from '../shared/businessTime'

export const MINIMUM_BULK_ITEM_COUNT = 5

export function localAgreementTimestamp(value = new Date()): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  const seconds = String(value.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
}

export interface AgreementApplicationDraft {
  appliedAt: string
  legalName: string
  shortName: string
  customerType: AgreementCustomerType
  identityType: Exclude<IdentityType, ''> | ''
  identityValue: string
  contact: string
  senderName: string
  detailedAddress: string
  unit: string
  postalCode: string
  mnemonic: string
  expectedItemCount: number
  productCategoryCode: string
  paymentMethod: AgreementPaymentMethod
  allowCredit: boolean
  businessScope: string
  certificateFileName: string
  contractFileName: string
  gender: Gender
}

export type AgreementApplicationErrors = Partial<Record<
  keyof AgreementApplicationDraft | 'form',
  string
>>

export function normalizeCustomerWorkspaceState(
  state: CustomerWorkspaceState | (Omit<CustomerWorkspaceState, 'agreementApplications'> & {
    agreementApplications?: AgreementAccountApplication[]
  }),
): CustomerWorkspaceState {
  const sanitized = sanitizePublicProductData({
    ...structuredClone(state),
    schemaVersion: 2,
    agreementApplications: structuredClone(state.agreementApplications ?? []),
  } as CustomerWorkspaceState)
  return reconcileKnownPostalAddressData(sanitized)
}

export function validateAgreementApplication(
  draft: AgreementApplicationDraft,
): AgreementApplicationErrors {
  const errors: AgreementApplicationErrors = {}
  if (!draft.legalName.trim()) errors.legalName = '请输入法定客户名称。'
  if (!draft.shortName.trim()) errors.shortName = '请输入客户简称。'
  if (!draft.identityType) errors.identityType = '请选择证件类型。'
  if (!draft.identityValue.trim()) {
    errors.identityValue = '请输入证件号码。'
  } else if (
    draft.identityType === 'primary' &&
    !isValidResidentIdentity(draft.identityValue)
  ) {
    errors.identityValue = '居民身份证号码未通过格式、日期或校验码检查。'
  } else if (Array.from(draft.identityValue.trim()).length > 20) {
    errors.identityValue = '证件号码不得超过 20 个字符。'
  }
  if (!draft.senderName.trim()) errors.senderName = '请输入寄件人姓名。'
  if (!draft.contact.trim()) {
    errors.contact = '请输入联系电话。'
  } else if (!isValidContact(draft.contact)) {
    errors.contact = '请输入 11 位手机号，或使用连字符分隔的固定电话。'
  }
  if (!draft.detailedAddress.trim() && !draft.unit.trim()) {
    errors.detailedAddress = '详细地址和单位至少填写一项。'
  }
  if (draft.postalCode.trim() && !/^\d{1,6}$/.test(draft.postalCode.trim())) {
    errors.postalCode = '邮编只能包含 1 至 6 位数字。'
  }
  const mnemonic = draft.mnemonic.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(mnemonic)) {
    errors.mnemonic = '输入简码须为 2 至 12 位大写字母或数字。'
  }
  if (
    !Number.isInteger(draft.expectedItemCount) ||
    draft.expectedItemCount < MINIMUM_BULK_ITEM_COUNT
  ) {
    errors.expectedItemCount = `大宗申请的预计交寄件数不得少于 ${MINIMUM_BULK_ITEM_COUNT} 件。`
  }
  if (!draft.productCategoryCode.trim()) {
    errors.productCategoryCode = '请选择产品类别。'
  }
  if (!draft.businessScope.trim()) errors.businessScope = '请输入业务范围。'
  if (draft.paymentMethod === 'credit' && !draft.allowCredit) {
    errors.allowCredit = '选择记欠时必须同时允许记欠。'
  }
  return errors
}

function nextApplicationId(
  state: CustomerWorkspaceState,
  appliedAt: string,
): string {
  const date = businessCalendarDay(appliedAt).replaceAll('-', '')
  const sequence = state.agreementApplications.reduce((maximum, application) => {
    const match = /-(\d{4})$/.exec(application.id)
    return Math.max(maximum, match ? Number(match[1]) : 0)
  }, 0) + 1
  return `XY-${date}-${String(sequence).padStart(4, '0')}`
}

function nextAgreementAccountId(state: CustomerWorkspaceState): string {
  const maximum = state.agreementAccounts.reduce((current, account) => {
    if (!/^\d{14}$/.test(account.id)) return current
    const value = BigInt(account.id)
    return value > current ? value : current
  }, 91000000000000n)
  return (maximum + 1n).toString().padStart(14, '0')
}

export function submitAgreementApplication(
  state: CustomerWorkspaceState,
  draft: AgreementApplicationDraft,
): { state: CustomerWorkspaceState; application: AgreementAccountApplication } {
  const normalized = normalizeCustomerWorkspaceState(state)
  const errors = validateAgreementApplication(draft)
  if (Object.keys(errors).length > 0) {
    throw new Error(Object.values(errors)[0] ?? '协议客户注册申请信息不完整。')
  }
  const identity = draft.identityValue.trim().toUpperCase()
  if (normalized.agreementApplications.some(
    (application) => application.identityValue === identity && application.status !== 'rejected',
  ) || normalized.agreementAccounts.some((account) => account.identityValue === identity)) {
    throw new Error('该证件号码已有有效协议客户或待审批申请。')
  }
  const application: AgreementAccountApplication = {
    id: nextApplicationId(normalized, draft.appliedAt),
    appliedAt: draft.appliedAt,
    legalName: draft.legalName.trim(),
    shortName: draft.shortName.trim(),
    customerType: draft.customerType,
    identityType: draft.identityType as Exclude<IdentityType, ''>,
    identityValue: identity,
    contact: draft.contact.trim(),
    senderName: draft.senderName.trim(),
    gender: draft.gender,
    detailedAddress: draft.detailedAddress.trim(),
    unit: draft.unit.trim(),
    postalCode: draft.postalCode.trim(),
    mnemonic: draft.mnemonic.trim().toUpperCase(),
    expectedItemCount: draft.expectedItemCount,
    productCategoryCode: draft.productCategoryCode.trim(),
    paymentMethod: draft.paymentMethod,
    allowCredit: draft.allowCredit,
    businessScope: draft.businessScope.trim(),
    certificateFileName: draft.certificateFileName,
    contractFileName: draft.contractFileName,
    status: 'pending',
    approvalOpinion: '',
    approvedAt: null,
    accountId: null,
  }
  return {
    application,
    state: {
      ...normalized,
      agreementApplications: [...normalized.agreementApplications, application],
    },
  }
}

export function approveAgreementApplication(
  state: CustomerWorkspaceState,
  applicationId: string,
  approvedAt: string,
): {
  state: CustomerWorkspaceState
  application: AgreementAccountApplication
  account: AgreementAccount
} {
  const normalized = normalizeCustomerWorkspaceState(state)
  const target = normalized.agreementApplications.find(
    (application) => application.id === applicationId,
  )
  if (!target) throw new Error('未找到协议客户注册申请。')
  if (target.status !== 'pending') throw new Error('该协议客户注册申请已经处理。')
  const accountId = nextAgreementAccountId(normalized)
  const application: AgreementAccountApplication = {
    ...target,
    status: 'approved',
    approvalOpinion: `符合 ${MINIMUM_BULK_ITEM_COUNT} 件及以上大宗受理条件`,
    approvedAt,
    accountId,
  }
  const account: AgreementAccount = {
    id: accountId,
    name: target.shortName,
    mnemonic: target.mnemonic,
    status: 'active',
    contact: target.contact,
    senderName: target.senderName,
    detailedAddress: target.detailedAddress,
    unit: target.unit,
    postalCode: target.postalCode,
    identityType: target.identityType,
    identityValue: target.identityValue,
    gender: target.gender,
    customerType: target.customerType,
    paymentMethod: target.paymentMethod,
    registrationApplicationId: target.id,
    registeredAt: approvedAt,
  }
  return {
    application,
    account,
    state: {
      ...normalized,
      agreementApplications: normalized.agreementApplications.map((candidate) =>
        candidate.id === applicationId ? application : candidate,
      ),
      agreementAccounts: [...normalized.agreementAccounts, account],
    },
  }
}
