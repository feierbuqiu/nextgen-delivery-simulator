import { describe, expect, it } from 'vitest'

import { ADMINISTRATIVE_DIVISIONS, COUNTY_DIVISIONS } from './administrativeDivisions'
import { createCustomerSeedState, FICTIONAL_ADDRESSES } from './seed'
import {
  POSTAL_ADMINISTRATIVE_DIRECTORY,
  canonicalizeKnownFictionalAddress,
  matchPostalAdministrativeByChannel,
  matchPostalAdministrativeByGis,
  reconcileKnownPostalAddressData,
} from './postalAdministrativeDirectory'

describe('邮编行政区划目录', () => {
  it('为每个区县生成唯一且可回溯的代码和邮编', () => {
    expect(POSTAL_ADMINISTRATIVE_DIRECTORY).toHaveLength(COUNTY_DIVISIONS.length)
    expect(new Set(POSTAL_ADMINISTRATIVE_DIRECTORY.map((row) => row.administrativeCode)).size)
      .toBe(COUNTY_DIVISIONS.length)
    expect(new Set(POSTAL_ADMINISTRATIVE_DIRECTORY.map((row) => row.postalCode)).size)
      .toBe(COUNTY_DIVISIONS.length)

    for (const row of POSTAL_ADMINISTRATIVE_DIRECTORY) {
      expect(row.administrativeCode).toMatch(/^99\d{4}000000$/)
      expect(row.provinceCode).toMatch(/^97\d{4}$/)
      expect(row.prefectureCode).toMatch(/^98\d{4}$/)
      expect(row.countyCode).toMatch(/^99\d{4}$/)
      expect(row.postalCode).toMatch(/^\d{6}$/)
      expect(ADMINISTRATIVE_DIVISIONS.some((division) => (
        division.id === row.countyId && division.fullName === row.countyName
      ))).toBe(true)
    }
  })

  it('区分 GIS 完整层级匹配与营业渠道区县匹配', () => {
    expect(matchPostalAdministrativeByGis('瀚原省栖沄市景麓区新程路 22 号'))
      .toMatchObject({ countyId: 'C022', postalCode: '110022' })
    expect(matchPostalAdministrativeByGis('景麓区新程路 22 号')).toBeNull()
    expect(matchPostalAdministrativeByChannel('景麓区新程路 22 号'))
      .toMatchObject({ countyId: 'C022' })
  })

  it('客户地址库和收寄客户种子使用同一邮编投影', () => {
    for (const address of FICTIONAL_ADDRESSES.filter((entry) => entry.mode === 'domestic')) {
      const matched = matchPostalAdministrativeByGis(address.detailedAddress)
      expect(matched, address.id).not.toBeNull()
      expect(matched?.postalCode, address.id).toBe(address.postalCode)
    }

    const state = createCustomerSeedState()
    const contacts = [
      ...state.agreementAccounts,
      ...state.senderHistory,
      ...state.recipientHistory,
    ].filter((contact) => !contact.detailedAddress.startsWith('远洋演练区'))
    for (const contact of contacts) {
      const matched = matchPostalAdministrativeByChannel(contact.detailedAddress)
      expect(matched, contact.detailedAddress).not.toBeNull()
      expect(matched?.postalCode, contact.detailedAddress).toBe(contact.postalCode)
    }
  })

  it('拒绝上下级互相矛盾的地址', () => {
    expect(matchPostalAdministrativeByChannel('澄岐省瀚原省栖沄市景麓区新程路 22 号'))
      .toBeNull()
  })

  it('只把已知旧演练层级迁移为现行地址和邮编', () => {
    const legacyAddress = "澜京市长风区" + '新程路 8 号'
    expect(canonicalizeKnownFictionalAddress(legacyAddress)).toBe('澜京市栖台区新程路 8 号')

    const reconciled = reconcileKnownPostalAddressData({
      customer: {
        detailedAddress: legacyAddress,
        postalCode: '000000',
      },
      unknown: {
        detailedAddress: '用户自定义地址',
        postalCode: '123456',
      },
    })
    expect(reconciled.customer).toEqual({
      detailedAddress: '澜京市栖台区新程路 8 号',
      postalCode: '380001',
    })
    expect(reconciled.unknown).toEqual({
      detailedAddress: '用户自定义地址',
      postalCode: '123456',
    })
  })
})
