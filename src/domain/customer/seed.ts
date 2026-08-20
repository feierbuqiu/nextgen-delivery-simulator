import type {
  CustomerWorkspaceState,
  FictionalAddress,
  RecipientProfile,
  SenderProfile,
} from './types'
import {
  LOCAL_PREFECTURE_ID,
} from './administrativeDivisions'
import { POSTAL_ADMINISTRATIVE_DIRECTORY } from './postalAdministrativeDirectory'

export function createEmptySender(): SenderProfile {
  return {
    agreementAccountId: null,
    agreementAccountName: '',
    contact: '',
    name: '',
    identityType: '',
    identityValue: '',
    gender: '',
    detailedAddress: '',
    unit: '',
    postalCode: '',
  }
}

export function createEmptyRecipient(): RecipientProfile {
  return {
    contact: '',
    name: '',
    detailedAddress: '',
    unit: '',
    postalCode: '',
  }
}

function routeZone(
  provinceId: string,
  prefectureId: string,
): FictionalAddress['zone'] {
  if (provinceId === 'P032') return 'special-free-trade-port'
  if (provinceId === 'P033') return 'special-mirror-sea-port'
  if (provinceId === 'P034') return 'special-beautiful-island'
  return prefectureId === LOCAL_PREFECTURE_ID ? 'local' : 'nonlocal'
}

const domesticAddresses: FictionalAddress[] = POSTAL_ADMINISTRATIVE_DIRECTORY.map((record) => {
  return {
    id: `domestic-${record.countyId.toLowerCase()}`,
    mode: 'domestic',
    zone: routeZone(record.provinceId, record.prefectureId),
    kind: [record.provinceSuffix, record.prefectureSuffix, record.countySuffix]
      .filter((part, index, parts) => part !== parts[index - 1])
      .join(' / '),
    hierarchy: [...record.hierarchy],
    detailedAddress: record.sampleDetailedAddress,
    postalCode: record.postalCode,
  }
})

export const FICTIONAL_ADDRESSES: FictionalAddress[] = [
  ...domesticAddresses,
  {
    id: 'overseas-01',
    mode: 'overseas',
    zone: 'international',
    kind: '海外 / 国家',
    hierarchy: ['远洋演练区-021'],
    detailedAddress: '远洋演练区二十一号新程路 88 号',
    postalCode: '2000',
    destinationOffice: 'AU',
  },
  {
    id: 'overseas-02',
    mode: 'overseas',
    zone: 'international',
    kind: '海外 / 国家',
    hierarchy: ['远洋演练区-539'],
    detailedAddress: '远洋演练区五三九号远帆路 12 号',
    postalCode: '90001',
    destinationOffice: 'US',
  },
]

function domesticAddressByCountyId(countyId: string): FictionalAddress {
  const address = FICTIONAL_ADDRESSES.find(
    (candidate) => candidate.id === `domestic-${countyId.toLowerCase()}`,
  )
  if (!address) throw new Error(`Missing demo address for ${countyId}`)
  return address
}

const localPrimaryAddress = domesticAddressByCountyId('C022')
const localSecondaryAddress = domesticAddressByCountyId('C109')
const nonlocalPrimaryAddress = domesticAddressByCountyId('C023')

export function createCustomerSeedState(): CustomerWorkspaceState {
  return {
    schemaVersion: 2,
    draft: null,
    agreementAccounts: [
      {
        id: '91000000000001',
        name: '星河合作社',
        mnemonic: 'XH',
        status: 'active',
        contact: '10000000016',
        senderName: '林澄',
        detailedAddress: localPrimaryAddress.detailedAddress,
        unit: '星河合作社',
        postalCode: localPrimaryAddress.postalCode,
        identityType: 'primary',
        identityValue: '990101199507230035',
        gender: 'male',
        customerType: 'individual',
      },
      {
        id: '91000000000002',
        name: '启航文化中心',
        mnemonic: 'QHWH',
        status: 'active',
        contact: '10000000020',
        senderName: '周安',
        detailedAddress: nonlocalPrimaryAddress.detailedAddress,
        unit: '启航文化中心',
        postalCode: nonlocalPrimaryAddress.postalCode,
        identityType: 'primary',
        identityValue: '990101198805120024',
        gender: 'female',
        customerType: 'organization',
      },
      {
        id: '91000000000003',
        name: '远帆工坊',
        mnemonic: 'YFGF',
        status: 'active',
        contact: '10000000021',
        senderName: '许舟',
        detailedAddress: '远洋演练区二十一号新程路 88 号',
        unit: '远帆工坊',
        postalCode: '2000',
        identityType: 'travel',
        identityValue: 'SIM-TRAVEL-003',
        gender: 'unspecified',
        customerType: 'organization',
      },
    ],
    agreementApplications: [],
    senderHistory: [
      {
        id: 'sender-001',
        contact: '10000000016',
        name: '林澄',
        detailedAddress: localPrimaryAddress.detailedAddress,
        unit: '星河合作社',
        postalCode: localPrimaryAddress.postalCode,
      },
      {
        id: 'sender-002',
        contact: '10000000016',
        name: '林岚',
        detailedAddress: localSecondaryAddress.detailedAddress,
        unit: '晨曦工作室',
        postalCode: localSecondaryAddress.postalCode,
      },
      {
        id: 'sender-003',
        contact: '10000000020',
        name: '周安',
        detailedAddress: nonlocalPrimaryAddress.detailedAddress,
        unit: '启航文化中心',
        postalCode: nonlocalPrimaryAddress.postalCode,
      },
    ],
    recipientHistory: [
      {
        id: 'recipient-001',
        contact: '10000000019',
        name: '顾远',
        detailedAddress: nonlocalPrimaryAddress.detailedAddress,
        unit: '同创设计室',
        postalCode: nonlocalPrimaryAddress.postalCode,
      },
      {
        id: 'recipient-002',
        contact: '10000000019',
        name: '顾宁',
        detailedAddress: localSecondaryAddress.detailedAddress,
        unit: '新城研习社',
        postalCode: localSecondaryAddress.postalCode,
      },
      {
        id: 'recipient-003',
        contact: '10000000022',
        name: '沈禾',
        detailedAddress: '远洋演练区五三九号远帆路 12 号',
        unit: '山谷交流站',
        postalCode: '90001',
      },
    ],
  }
}
