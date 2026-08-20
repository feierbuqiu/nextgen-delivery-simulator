export type ProductFamily =
  | 'standard-delivery'
  | 'basic-letter'
  | 'parcel'
  | 'express'
export type DestinationRegion = 'domestic' | 'overseas'
export type CustomerDestinationZone =
  | 'local'
  | 'nonlocal'
  | 'international'
  | 'special-free-trade-port'
  | 'special-mirror-sea-port'
  | 'special-beautiful-island'
export type IdentityType = '' | 'primary' | 'temporary' | 'residence' | 'travel'
export type Gender = '' | 'female' | 'male' | 'unspecified'
export type AgreementCustomerType = 'individual' | 'organization'
export type AgreementPaymentMethod = 'cash-settlement' | 'credit'
export type AgreementApplicationStatus = 'pending' | 'approved' | 'rejected'

export interface CustomerContact {
  contact: string
  name: string
  detailedAddress: string
  unit: string
  postalCode: string
}

export interface SenderProfile extends CustomerContact {
  agreementAccountId: string | null
  agreementAccountName: string
  identityType: IdentityType
  identityValue: string
  gender: Gender
}

export type RecipientProfile = CustomerContact

export interface AgreementAccount {
  id: string
  name: string
  mnemonic: string
  status: 'active'
  contact: string
  senderName: string
  detailedAddress: string
  unit: string
  postalCode: string
  identityType?: Exclude<IdentityType, ''>
  identityValue?: string
  gender?: Gender
  customerType?: AgreementCustomerType
  paymentMethod?: AgreementPaymentMethod
  registrationApplicationId?: string
  registeredAt?: string
}

export interface AgreementAccountApplication {
  id: string
  appliedAt: string
  legalName: string
  shortName: string
  customerType: AgreementCustomerType
  identityType: Exclude<IdentityType, ''>
  identityValue: string
  contact: string
  senderName: string
  gender: Gender
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
  status: AgreementApplicationStatus
  approvalOpinion: string
  approvedAt: string | null
  accountId: string | null
}

export interface CustomerHistoryRecord extends CustomerContact {
  id: string
}

export interface FictionalAddress {
  id: string
  mode: DestinationRegion
  zone: CustomerDestinationZone
  kind: string
  hierarchy: string[]
  detailedAddress: string
  postalCode: string
  destinationOffice?: string
}

export interface CustomerDraft {
  productFamily: ProductFamily
  destinationRegion: DestinationRegion
  sender: SenderProfile
  recipient: RecipientProfile
  status: 'sender-ready' | 'customer-ready'
  updatedAt: string
}

export interface CustomerWorkspaceState {
  schemaVersion: 2
  draft: CustomerDraft | null
  agreementAccounts: AgreementAccount[]
  agreementApplications: AgreementAccountApplication[]
  senderHistory: CustomerHistoryRecord[]
  recipientHistory: CustomerHistoryRecord[]
}
