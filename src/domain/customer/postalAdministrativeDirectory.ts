import {
  ADMINISTRATIVE_DIVISIONS,
  COUNTY_DIVISIONS,
  type AdministrativeDivision,
} from './administrativeDivisions'

export interface AdministrativeDivisionRoute {
  province: AdministrativeDivision
  prefecture: AdministrativeDivision
  county: AdministrativeDivision
}

export interface PostalAdministrativeRecord {
  countyId: string
  provinceId: string
  prefectureId: string
  provinceCode: string
  provinceName: string
  provinceShortName: string
  provinceSuffix: string
  prefectureCode: string
  prefectureName: string
  prefectureShortName: string
  prefectureSuffix: string
  countyCode: string
  countyName: string
  countyShortName: string
  countySuffix: string
  administrativeCode: string
  deliveryRegionCode: string
  postalCode: string
  hierarchy: readonly string[]
  compactHierarchy: string
  sampleDetailedAddress: string
}

interface LegacyAdministrativeAlias {
  prefix: string
  countyId: string
}

const divisionById = new Map<string, AdministrativeDivision>(
  ADMINISTRATIVE_DIVISIONS.map((division) => [division.id, division]),
)

function numericSequence(id: string): string {
  return id.slice(1).padStart(4, '0')
}

function compactHierarchy(parts: readonly string[]): string {
  return parts
    .filter((part, index) => part && part !== parts[index - 1])
    .join('')
}

export function administrativeDivisionRoute(
  county: AdministrativeDivision,
): AdministrativeDivisionRoute {
  if (county.level !== 'county') throw new Error(`行政区划 ${county.id} 不是区县级记录。`)
  const directParent = divisionById.get(county.parentId ?? '')
  if (!directParent) throw new Error(`行政区划 ${county.id} 缺少上级。`)
  const province = directParent.level === 'province'
    ? directParent
    : divisionById.get(directParent.parentId ?? '')
  if (!province || province.level !== 'province') {
    throw new Error(`行政区划 ${county.id} 缺少省级记录。`)
  }
  return { province, prefecture: directParent, county }
}

function createPostalAdministrativeRecord(
  county: AdministrativeDivision,
): PostalAdministrativeRecord {
  const route = administrativeDivisionRoute(county)
  const provinceSequence = numericSequence(route.province.id)
  const prefectureSequence = numericSequence(route.prefecture.id)
  const countySequence = numericSequence(route.county.id)
  const hierarchy = [
    route.province.fullName,
    route.prefecture.fullName,
    route.county.fullName,
  ]
  const compact = compactHierarchy(hierarchy)
  const postalProvinceSequence = String(Number(route.province.id.slice(1)) + 10)
    .padStart(2, '0')

  return {
    countyId: route.county.id,
    provinceId: route.province.id,
    prefectureId: route.prefecture.id,
    provinceCode: `97${provinceSequence}`,
    provinceName: route.province.fullName,
    provinceShortName: route.province.body,
    provinceSuffix: route.province.suffix,
    prefectureCode: `98${prefectureSequence}`,
    prefectureName: route.prefecture.fullName,
    prefectureShortName: route.prefecture.body,
    prefectureSuffix: route.prefecture.suffix,
    countyCode: `99${countySequence}`,
    countyName: route.county.fullName,
    countyShortName: route.county.body,
    countySuffix: route.county.suffix,
    administrativeCode: `99${countySequence}000000`,
    deliveryRegionCode: `99${route.county.id.slice(1).padStart(6, '0')}`,
    postalCode: `${postalProvinceSequence}${countySequence}`,
    hierarchy,
    compactHierarchy: compact,
    sampleDetailedAddress: `${compact}新程路 ${Number(route.county.id.slice(1))} 号`,
  }
}

/**
 * 虚构行政区划、六位邮编和合成区划代码的唯一投影。
 *
 * 展示名始终来自 `administrativeDivisions.ts`；邮编和代码只是公开
 * 模拟器内部使用的确定性合成值，不代表现实区划配置。
 */
export const POSTAL_ADMINISTRATIVE_DIRECTORY: readonly PostalAdministrativeRecord[] =
  COUNTY_DIVISIONS.map(createPostalAdministrativeRecord)

const recordByCountyId = new Map(
  POSTAL_ADMINISTRATIVE_DIRECTORY.map((record) => [record.countyId, record]),
)

export function postalAdministrativeRecordByCountyId(
  countyId: string,
): PostalAdministrativeRecord {
  const record = recordByCountyId.get(countyId.toUpperCase())
  if (!record) throw new Error(`未找到虚构区县 ${countyId}。`)
  return structuredClone(record)
}

export function fictionalDetailedAddress(
  countyId: string,
  streetName = '新程路',
  streetNumber?: number,
): string {
  const record = postalAdministrativeRecordByCountyId(countyId)
  const number = streetNumber ?? Number(record.countyId.slice(1))
  return `${record.compactHierarchy}${streetName} ${number} 号`
}


// 只用于把旧版演练数据迁移到现行目录，不作为新建地址选项。
const LEGACY_ADMINISTRATIVE_ALIASES: readonly LegacyAdministrativeAlias[] = [
  { prefix: "澜京市长风区", countyId: 'C001' },
  { prefix: "澜京市清禾区", countyId: 'C002' },
  { prefix: "澜京市镜湖区", countyId: 'C003' },
  { prefix: "澜京市星桥区", countyId: 'C001' },
  { prefix: "云浦市湖岸区", countyId: 'C049' },
  { prefix: "云州市清河区", countyId: 'C022' },
  { prefix: "示范省新城市启航区", countyId: 'C022' },
  { prefix: "协作省同创市星桥区", countyId: 'C023' },
]

export function canonicalizeKnownFictionalAddress(value: string): string {
  const address = value.trim()
  const alias = LEGACY_ADMINISTRATIVE_ALIASES.find((candidate) => (
    address.startsWith(candidate.prefix)
  ))
  if (!alias) return address
  const record = recordByCountyId.get(alias.countyId)
  if (!record) return address
  return `${record.compactHierarchy}${address.slice(alias.prefix.length)}`
}

function normalizedMatchText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s,，。;；:：]+/gu, '')
}

function divisionMentioned(
  normalizedAddress: string,
  division: AdministrativeDivision,
): boolean {
  return normalizedAddress.includes(normalizedMatchText(division.fullName)) ||
    normalizedAddress.includes(normalizedMatchText(division.body))
}

export function matchPostalAdministrativeByGis(
  value: string,
): PostalAdministrativeRecord | null {
  const address = normalizedMatchText(value)
  const matched = POSTAL_ADMINISTRATIVE_DIRECTORY.find((record) => (
    address.includes(normalizedMatchText(record.compactHierarchy))
  ))
  return matched ? structuredClone(matched) : null
}

export function matchPostalAdministrativeByChannel(
  value: string,
): PostalAdministrativeRecord | null {
  const canonicalAddress = canonicalizeKnownFictionalAddress(value)
  const normalizedAddress = normalizedMatchText(canonicalAddress)
  if (!normalizedAddress) return null

  const mentionedDivisions = ADMINISTRATIVE_DIVISIONS.filter((division) => (
    divisionMentioned(normalizedAddress, division)
  ))
  const mentionedCounties = mentionedDivisions.filter((division) => division.level === 'county')
  if (mentionedCounties.length !== 1) return null

  const candidate = recordByCountyId.get(mentionedCounties[0]!.id)
  if (!candidate) return null
  const compatible = mentionedDivisions.every((division) => {
    if (division.level === 'province') return division.id === candidate.provinceId
    if (division.level === 'prefecture') return division.id === candidate.prefectureId
    return division.id === candidate.countyId
  })
  return compatible ? structuredClone(candidate) : null
}

const ADDRESS_POSTAL_PAIRS = {
  detailedAddress: 'postalCode',
  recipientAddress: 'recipientPostalCode',
  senderAddress: 'senderPostalCode',
} as const

const RECONCILABLE_ADDRESS_KEYS = new Set([
  'detailedAddress',
  'recipientAddress',
  'senderAddress',
  'customerAddress',
  'buyerAddress',
])

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * 读取旧 IndexedDB 或备份时，只修复能被现行目录唯一识别的地址。
 * 不可确认的用户自定义地址保持原样，避免静默误改历史数据。
 */
export function reconcileKnownPostalAddressData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => reconcileKnownPostalAddressData(item)) as T
  }
  if (!value || typeof value !== 'object' || !isPlainRecord(value)) return value

  const reconciled = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      reconcileKnownPostalAddressData(entry),
    ]),
  )

  for (const key of RECONCILABLE_ADDRESS_KEYS) {
    const currentAddress = reconciled[key]
    if (typeof currentAddress !== 'string' || !currentAddress.trim()) continue
    const canonicalAddress = canonicalizeKnownFictionalAddress(currentAddress)
    reconciled[key] = canonicalAddress
    const matched = matchPostalAdministrativeByChannel(canonicalAddress)
    const postalKey = ADDRESS_POSTAL_PAIRS[key as keyof typeof ADDRESS_POSTAL_PAIRS]
    if (matched && postalKey && Object.hasOwn(reconciled, postalKey)) {
      reconciled[postalKey] = matched.postalCode
    }
  }

  return reconciled as T
}
