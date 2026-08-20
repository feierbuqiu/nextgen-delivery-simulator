import {
  POSTAL_ADMINISTRATIVE_DIRECTORY,
  type PostalAdministrativeRecord,
} from '../customer/postalAdministrativeDirectory'
import {
  TRAINING_MANIFEST_TYPE_OPTIONS,
  SIMULATED_POST_ROUTES,
} from './dispatchRouting'
import { SERVICE_PRODUCTS } from './seed'

export type RelationshipValidity = 'all' | 'valid' | 'invalid'
export type LocalTransferFilter = 'all' | 'local' | 'transfer' | 'undivided'

export interface RelationshipOrganization {
  code: string
  name: string
  level: 'center' | 'province' | 'prefecture' | 'branch'
}

export const RELATIONSHIP_ORGANIZATIONS: readonly RelationshipOrganization[] = [
  { code: '99901001', name: '景麓营业部', level: 'branch' },
  { code: '99900100', name: '澜京市寄递中心', level: 'prefecture' },
  { code: '99900010', name: '瀚原寄递中心', level: 'province' },
  { code: '99900001', name: '大国邮运枢纽', level: 'center' },
] as const

export interface PostalRouteStation {
  sequence: number
  institutionCode: string
  institutionName: string
  segmentLevel: number
  owningInstitutionCode: string
  owningInstitutionName: string
}

export interface PostalRouteComparison {
  id: string
  sourceInstitutionCode: string
  sourceInstitutionName: string
  routeCode: string
  routeName: string
  direction: '上行' | '下行' | '不分上下行'
  valid: boolean
  stations: PostalRouteStation[]
}

function station(
  sequence: number,
  institutionCode: string,
  institutionName: string,
  segmentLevel: number,
  owningInstitutionCode: string,
  owningInstitutionName: string,
): PostalRouteStation {
  return {
    sequence,
    institutionCode,
    institutionName,
    segmentLevel,
    owningInstitutionCode,
    owningInstitutionName,
  }
}

const routeStations: Record<string, PostalRouteStation[]> = {
  'SIM-A01': [
    station(1, '99901001', '景麓营业部', 1, '99900100', '澜京市寄递中心'),
    station(2, '99101011', '栖沄交换站', 2, '99101001', '栖沄邮件处理中心'),
    station(3, '99101001', '栖沄邮件处理中心', 3, '99900001', '大国邮运枢纽'),
  ],
  'SIM-B02': [
    station(1, '99901001', '景麓营业部', 1, '99900100', '澜京市寄递中心'),
    station(2, '99102011', '澄野营业站', 2, '99102001', '澄野转运中心'),
    station(3, '99102001', '澄野转运中心', 3, '99900001', '大国邮运枢纽'),
  ],
  'SIM-C03': [
    station(1, '99901001', '景麓营业部', 1, '99900100', '澜京市寄递中心'),
    station(2, '99103011', '镜海埠互换站', 2, '99103001', '镜海埠互换中心'),
    station(3, '99103001', '镜海埠互换中心', 3, '99900001', '大国邮运枢纽'),
  ],
}

export const POSTAL_ROUTE_COMPARISONS: readonly PostalRouteComparison[] = [
  ...SIMULATED_POST_ROUTES.map((route, index): PostalRouteComparison => ({
    id: `${route.code}:outbound`,
    sourceInstitutionCode: '99901001',
    sourceInstitutionName: '景麓营业部',
    routeCode: route.code,
    routeName: route.name,
    direction: index === 1 ? '不分上下行' : '上行',
    valid: true,
    stations: structuredClone(routeStations[route.code] ?? []),
  })),
  {
    id: 'SIM-A01:return',
    sourceInstitutionCode: '99901001',
    sourceInstitutionName: '景麓营业部',
    routeCode: 'SIM-A01',
    routeName: '栖沄干线邮路',
    direction: '下行',
    valid: false,
    stations: structuredClone([...(routeStations['SIM-A01'] ?? [])].reverse())
      .map((item, index) => ({ ...item, sequence: index + 1 })),
  },
] as const

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN')
}

function includes(value: string, query: string): boolean {
  const term = normalized(query)
  return !term || normalized(value).includes(term)
}

export interface PostalRouteComparisonQuery {
  organizationTerm: string
  validity: RelationshipValidity
}

export function queryPostalRouteComparisons(
  query: PostalRouteComparisonQuery,
): PostalRouteComparison[] {
  return POSTAL_ROUTE_COMPARISONS
    .filter((row) => query.validity === 'all' || row.valid === (query.validity === 'valid'))
    .filter((row) => includes([
      row.sourceInstitutionCode,
      row.sourceInstitutionName,
      row.routeCode,
      row.routeName,
      ...row.stations.flatMap((item) => [item.institutionCode, item.institutionName]),
    ].join(' '), query.organizationTerm))
    .map((row) => structuredClone(row))
}

export interface NetworkExportRelationship {
  id: string
  institutionCode: string
  institutionName: string
  productStart: '1' | '2' | '3' | '4'
  mailKindName: string
  routeCode: string
  routeName: string
  receivingOfficeCode: string
  receivingOfficeName: string
  localTransfer: Exclude<LocalTransferFilter, 'all'>
  issuedDate: string
}

export interface NetworkExportRelationshipQuery {
  institutionCode: string
  productStart: '' | NetworkExportRelationship['productStart']
  localTransfer: LocalTransferFilter
  receivingOfficeCode: string
  routeTerm: string
}

export const NETWORK_EXPORT_RELATIONSHIPS: readonly NetworkExportRelationship[] = [
  { id: 'NW-001', institutionCode: '99901001', institutionName: '景麓营业部', productStart: '1', mailKindName: '平常邮件', routeCode: 'SIM-B02', routeName: '澄野市内邮路', receivingOfficeCode: '99102001', receivingOfficeName: '澄野转运中心', localTransfer: 'local', issuedDate: '2026-01-15' },
  { id: 'NW-002', institutionCode: '99901001', institutionName: '景麓营业部', productStart: '2', mailKindName: '给据邮件', routeCode: 'SIM-A01', routeName: '栖沄干线邮路', receivingOfficeCode: '99101001', receivingOfficeName: '栖沄邮件处理中心', localTransfer: 'transfer', issuedDate: '2026-01-15' },
  { id: 'NW-003', institutionCode: '99901001', institutionName: '景麓营业部', productStart: '3', mailKindName: '包裹', routeCode: 'SIM-A01', routeName: '栖沄干线邮路', receivingOfficeCode: '99101001', receivingOfficeName: '栖沄邮件处理中心', localTransfer: 'transfer', issuedDate: '2026-01-15' },
  { id: 'NW-004', institutionCode: '99901001', institutionName: '景麓营业部', productStart: '4', mailKindName: '特快', routeCode: 'SIM-C03', routeName: '镜海埠互换邮路', receivingOfficeCode: '99103001', receivingOfficeName: '镜海埠互换中心', localTransfer: 'undivided', issuedDate: '2026-01-15' },
] as const

export function queryNetworkExportRelationships(
  query: NetworkExportRelationshipQuery,
): NetworkExportRelationship[] {
  return NETWORK_EXPORT_RELATIONSHIPS
    .filter((row) => !query.institutionCode || row.institutionCode === query.institutionCode)
    .filter((row) => !query.productStart || row.productStart === query.productStart)
    .filter((row) => query.localTransfer === 'all' || row.localTransfer === query.localTransfer)
    .filter((row) => includes(row.receivingOfficeCode, query.receivingOfficeCode))
    .filter((row) => includes(`${row.routeCode} ${row.routeName}`, query.routeTerm))
    .map((row) => structuredClone(row))
}

export interface BranchExportRelationship {
  id: string
  institutionCode: string
  institutionName: string
  baseProductCode: string
  baseProductName: string
  openingOfficeCode: string
  openingOfficeName: string
  destinationPostalAreaCode: string
  destinationPostalAreaName: string
  localTransfer: Exclude<LocalTransferFilter, 'all'>
  deleted: boolean
}

export interface BranchExportRelationshipQuery {
  institutionCode: string
  productTerm: string
  openingOfficeCode: string
  destinationPostalAreaCode: string
  localTransfer: LocalTransferFilter
  deletionFlag: 'all' | 'active' | 'deleted'
}

function productName(code: string): string {
  return SERVICE_PRODUCTS.find((product) => product.searchCode === code)?.label ?? code
}

export const BRANCH_EXPORT_RELATIONSHIPS: readonly BranchExportRelationship[] = [
  { id: 'BR-001', institutionCode: '99901001', institutionName: '景麓营业部', baseProductCode: '100', baseProductName: productName('100'), openingOfficeCode: '99102001', openingOfficeName: '澄野转运中心', destinationPostalAreaCode: '99-L', destinationPostalAreaName: '本埠邮区', localTransfer: 'local', deleted: false },
  { id: 'BR-002', institutionCode: '99901001', institutionName: '景麓营业部', baseProductCode: '200', baseProductName: productName('200'), openingOfficeCode: '99101001', openingOfficeName: '栖沄邮件处理中心', destinationPostalAreaCode: '99-D', destinationPostalAreaName: '国内邮区', localTransfer: 'transfer', deleted: false },
  { id: 'BR-003', institutionCode: '99901001', institutionName: '景麓营业部', baseProductCode: '300', baseProductName: productName('300'), openingOfficeCode: '99101001', openingOfficeName: '栖沄邮件处理中心', destinationPostalAreaCode: '99-D', destinationPostalAreaName: '国内邮区', localTransfer: 'transfer', deleted: false },
  { id: 'BR-004', institutionCode: '99901001', institutionName: '景麓营业部', baseProductCode: '404', baseProductName: productName('404'), openingOfficeCode: '99103001', openingOfficeName: '镜海埠互换中心', destinationPostalAreaCode: '99-I', destinationPostalAreaName: '国际邮区', localTransfer: 'undivided', deleted: false },
  { id: 'BR-005', institutionCode: '99900100', institutionName: '澜京市寄递中心', baseProductCode: '151', baseProductName: productName('151'), openingOfficeCode: '99103001', openingOfficeName: '镜海埠互换中心', destinationPostalAreaCode: '99-I', destinationPostalAreaName: '国际邮区', localTransfer: 'undivided', deleted: true },
] as const

export function queryBranchExportRelationships(
  query: BranchExportRelationshipQuery,
): BranchExportRelationship[] {
  return BRANCH_EXPORT_RELATIONSHIPS
    .filter((row) => !query.institutionCode || row.institutionCode === query.institutionCode)
    .filter((row) => includes(`${row.baseProductCode} ${row.baseProductName}`, query.productTerm))
    .filter((row) => includes(row.openingOfficeCode, query.openingOfficeCode))
    .filter((row) => includes(row.destinationPostalAreaCode, query.destinationPostalAreaCode))
    .filter((row) => query.localTransfer === 'all' || row.localTransfer === query.localTransfer)
    .filter((row) => query.deletionFlag === 'all' || row.deleted === (query.deletionFlag === 'deleted'))
    .map((row) => structuredClone(row))
}

export interface BagUnloadingRelationship {
  id: string
  institutionCode: string
  institutionName: string
  bagTypeCode: string
  bagTypeName: string
  routeCode: string
  receivingOfficeCode: string
  unloadingStationCode: string
  unloadingStationName: string
  localTransfer: Exclude<LocalTransferFilter, 'all'>
}

export interface BagUnloadingRelationshipQuery {
  institutionCode: string
  bagTypeTerm: string
  routeCode: string
  receivingOfficeCode: string
  unloadingStationCode: string
  localTransfer: LocalTransferFilter
}

export const BAG_UNLOADING_RELATIONSHIPS: readonly BagUnloadingRelationship[] =
  TRAINING_MANIFEST_TYPE_OPTIONS.slice(0, 6).map((manifest, index) => {
    const route = SIMULATED_POST_ROUTES[index % SIMULATED_POST_ROUTES.length]!
    return {
      id: `UL-${String(index + 1).padStart(3, '0')}`,
      institutionCode: '99901001',
      institutionName: '景麓营业部',
      bagTypeCode: manifest.code,
      bagTypeName: manifest.name,
      routeCode: route.code,
      receivingOfficeCode: route.receivingOfficeCodes[0] ?? '',
      unloadingStationCode: `9910${String(index + 11).padStart(4, '0')}`,
      unloadingStationName: route.unloadingStation,
      localTransfer: index === 0 ? 'local' : index === 1 ? 'undivided' : 'transfer',
    }
  })

export function queryBagUnloadingRelationships(
  query: BagUnloadingRelationshipQuery,
): BagUnloadingRelationship[] {
  return BAG_UNLOADING_RELATIONSHIPS
    .filter((row) => !query.institutionCode || row.institutionCode === query.institutionCode)
    .filter((row) => includes(`${row.bagTypeCode} ${row.bagTypeName}`, query.bagTypeTerm))
    .filter((row) => includes(row.routeCode, query.routeCode))
    .filter((row) => includes(row.receivingOfficeCode, query.receivingOfficeCode))
    .filter((row) => includes(row.unloadingStationCode, query.unloadingStationCode))
    .filter((row) => query.localTransfer === 'all' || row.localTransfer === query.localTransfer)
    .map((row) => structuredClone(row))
}

function receivingOfficeFor(record: PostalAdministrativeRecord): { code: string; name: string } {
  if (record.provinceId === 'P032' || record.provinceId === 'P033' || record.provinceId === 'P034') {
    return { code: '99103001', name: '镜海埠互换中心' }
  }
  if (record.prefectureId === 'F001') return { code: '99102001', name: '栖沄转运中心' }
  return { code: '99101001', name: '栖沄邮件处理中心' }
}

export interface DirectSealRelationship {
  id: string
  provinceName: string
  prefectureName: string
  countyName: string
  administrativeCode: string
  bagReceivingOfficeCode: string
  bagReceivingOfficeName: string
}

export interface DirectSealRelationshipQuery {
  provinceName: string
  prefectureName: string
  countyName: string
}

export const DIRECT_SEAL_RELATIONSHIPS: readonly DirectSealRelationship[] =
  POSTAL_ADMINISTRATIVE_DIRECTORY.slice(0, 36).map((record) => {
    const office = receivingOfficeFor(record)
    return {
      id: `DS-${record.countyId}`,
      provinceName: record.provinceShortName,
      prefectureName: record.prefectureShortName,
      countyName: record.countyShortName,
      administrativeCode: record.countyCode,
      bagReceivingOfficeCode: office.code,
      bagReceivingOfficeName: office.name,
    }
  })

export function queryDirectSealRelationships(
  query: DirectSealRelationshipQuery,
): DirectSealRelationship[] {
  return DIRECT_SEAL_RELATIONSHIPS
    .filter((row) => !query.provinceName || row.provinceName === query.provinceName)
    .filter((row) => !query.prefectureName || row.prefectureName === query.prefectureName)
    .filter((row) => !query.countyName || row.countyName === query.countyName)
    .map((row) => structuredClone(row))
}

export interface InternationalOrdinaryExportRelationship {
  id: string
  provinceCode: string
  internationalMailCode: string
  destinationCountryCode: string
  receivingOfficeName: string
  effectiveDate: string
  expiryDate: string
}

export const INTERNATIONAL_ORDINARY_EXPORT_RELATIONSHIPS:
readonly InternationalOrdinaryExportRelationship[] = [
  { id: 'IO-001', provinceCode: '99', internationalMailCode: '100200', destinationCountryCode: 'AU', receivingOfficeName: '镜海埠互换中心', effectiveDate: '2026-01-01', expiryDate: '2099-12-31' },
  { id: 'IO-002', provinceCode: '99', internationalMailCode: '120200', destinationCountryCode: 'US', receivingOfficeName: '镜海埠互换中心', effectiveDate: '2026-01-01', expiryDate: '2099-12-31' },
  { id: 'IO-003', provinceCode: '99', internationalMailCode: '110200', destinationCountryCode: 'JP', receivingOfficeName: '镜海埠互换中心', effectiveDate: '2026-01-01', expiryDate: '2099-12-31' },
] as const

export interface AdministrativePostalRelationship {
  id: string
  administrativeCode: string
  administrativeName: string
  regionCode: string
  regionName: string
  regionLevel: number
  postalCodeStart: string
  postalCodeEnd: string
  postalOfficeCode: string
  postalOfficeName: string
  parentAdministrativeCode: string
}

export const ADMINISTRATIVE_POSTAL_RELATIONSHIPS: readonly AdministrativePostalRelationship[] =
  POSTAL_ADMINISTRATIVE_DIRECTORY.map((record) => {
    const office = receivingOfficeFor(record)
    return {
      id: `AP-${record.countyId}`,
      administrativeCode: record.countyCode,
      administrativeName: record.countyName,
      regionCode: record.deliveryRegionCode,
      regionName: record.prefectureName,
      regionLevel: 3,
      postalCodeStart: record.postalCode,
      postalCodeEnd: record.postalCode,
      postalOfficeCode: office.code,
      postalOfficeName: office.name,
      parentAdministrativeCode: record.prefectureCode,
    }
  })

export function queryAdministrativePostalRelationships(
  value: string,
): AdministrativePostalRelationship[] {
  const code = value.trim()
  if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位行政区划代码。')
  return ADMINISTRATIVE_POSTAL_RELATIONSHIPS
    .filter((row) => row.administrativeCode === code)
    .map((row) => structuredClone(row))
}

export interface HierarchicalHubRelationship {
  id: string
  deliveryRegionCode: string
  institutionCode: string
  institutionName: string
  level: number
  provinceInstitutionCode: string
  provinceInstitutionName: string
  prefectureInstitutionCode: string
  prefectureInstitutionName: string
  parentInstitutionCode: string
  parentInstitutionName: string
}

export const HIERARCHICAL_HUB_RELATIONSHIPS: readonly HierarchicalHubRelationship[] =
  POSTAL_ADMINISTRATIVE_DIRECTORY.map((record) => {
    return {
      id: `HH-${record.countyId}`,
      deliveryRegionCode: record.deliveryRegionCode,
      institutionCode: `97${record.countyId.slice(1).padStart(6, '0')}`,
      institutionName: `${record.countyShortName}营业部`,
      level: 3,
      provinceInstitutionCode: `9600${record.provinceId.slice(1).padStart(4, '0')}`,
      provinceInstitutionName: `${record.provinceShortName}寄递中心`,
      prefectureInstitutionCode: `9601${record.prefectureId.slice(1).padStart(4, '0')}`,
      prefectureInstitutionName: `${record.prefectureShortName}分拨中心`,
      parentInstitutionCode: `9602${record.prefectureId.slice(1).padStart(4, '0')}`,
      parentInstitutionName: `${record.prefectureShortName}集散中心`,
    }
  })

export function queryHierarchicalHubRelationships(
  value: string,
): HierarchicalHubRelationship[] {
  const code = value.trim()
  if (!/^\d{8}$/.test(code)) throw new Error('请输入 8 位投递局区域码。')
  return HIERARCHICAL_HUB_RELATIONSHIPS
    .filter((row) => row.deliveryRegionCode === code)
    .map((row) => structuredClone(row))
}

export function localTransferLabel(value: Exclude<LocalTransferFilter, 'all'>): string {
  return { local: '本转', transfer: '转口', undivided: '本转不分' }[value]
}
