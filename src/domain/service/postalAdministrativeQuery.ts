import {
  canonicalizeKnownFictionalAddress,
  matchPostalAdministrativeByChannel,
  matchPostalAdministrativeByGis,
  type PostalAdministrativeRecord,
} from '../customer/postalAdministrativeDirectory'

export type PostalAdministrativeQueryMethod = 'gis' | 'administrative'
export type PostalAdministrativeMatchedBy = 'gis' | 'administrative-fallback' | 'administrative'

export interface PostalAdministrativeQueryRow {
  id: string
  inputAddress: string
  queryResult: '查询成功' | '查询失败'
  matchedBy: PostalAdministrativeMatchedBy | null
  administrativeCode: string
  fullAddressDescription: string
  provinceCode: string
  provinceName: string
  prefectureCode: string
  prefectureName: string
  countyCode: string
  countyName: string
  postalCode: string
}

function inputAddresses(value: string): string[] {
  const addresses = value
    .split(/\r?\n/gu)
    .map((address) => address.trim())
    .filter(Boolean)
  if (addresses.length === 0) throw new Error('请输入邮件详细地址信息。')
  if (addresses.length > 100) throw new Error('一次最多支持 100 条地址查询。')
  return addresses
}

function successfulRow(
  record: PostalAdministrativeRecord,
  inputAddress: string,
  matchedBy: PostalAdministrativeMatchedBy,
  index: number,
): PostalAdministrativeQueryRow {
  return {
    id: `${index + 1}-${record.countyId}`,
    inputAddress,
    queryResult: '查询成功',
    matchedBy,
    administrativeCode: record.administrativeCode,
    fullAddressDescription: record.compactHierarchy,
    provinceCode: record.provinceCode,
    provinceName: record.provinceName,
    prefectureCode: record.prefectureCode,
    prefectureName: record.prefectureName,
    countyCode: record.countyCode,
    countyName: record.countyName,
    postalCode: record.postalCode,
  }
}

function failedRow(inputAddress: string, index: number): PostalAdministrativeQueryRow {
  return {
    id: `${index + 1}-unmatched`,
    inputAddress,
    queryResult: '查询失败',
    matchedBy: null,
    administrativeCode: '',
    fullAddressDescription: '',
    provinceCode: '',
    provinceName: '',
    prefectureCode: '',
    prefectureName: '',
    countyCode: '',
    countyName: '',
    postalCode: '',
  }
}

export function queryPostalAdministrativeDivisions(
  value: string,
  method: PostalAdministrativeQueryMethod,
): PostalAdministrativeQueryRow[] {
  return inputAddresses(value).map((inputAddress, index) => {
    if (method === 'administrative') {
      const matched = matchPostalAdministrativeByChannel(inputAddress)
      return matched
        ? successfulRow(matched, inputAddress, 'administrative', index)
        : failedRow(inputAddress, index)
    }

    const gisMatched = matchPostalAdministrativeByGis(inputAddress)
    if (gisMatched) return successfulRow(gisMatched, inputAddress, 'gis', index)
    const fallbackMatched = matchPostalAdministrativeByChannel(inputAddress)
    return fallbackMatched
      ? successfulRow(
          fallbackMatched,
          canonicalizeKnownFictionalAddress(inputAddress),
          'administrative-fallback',
          index,
        )
      : failedRow(inputAddress, index)
  })
}
