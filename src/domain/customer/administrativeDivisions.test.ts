import { describe, expect, it } from 'vitest'

import {
  ADDRESS_PICKER_PROVINCES,
  ADMINISTRATIVE_DIVISIONS,
  COUNTY_DIVISIONS,
  PREFECTURE_DIVISIONS,
  PROVINCE_DIVISIONS,
} from './administrativeDivisions'
import { FICTIONAL_ADDRESSES } from './seed'

describe('fictional administrative division catalog', () => {
  it('preserves the approved 34 / 87 / 120 hierarchy without duplicates', () => {
    expect(PROVINCE_DIVISIONS).toHaveLength(34)
    expect(PREFECTURE_DIVISIONS).toHaveLength(87)
    expect(COUNTY_DIVISIONS).toHaveLength(120)
    expect(ADMINISTRATIVE_DIVISIONS).toHaveLength(241)

    expect(new Set(ADMINISTRATIVE_DIVISIONS.map(({ id }) => id)).size).toBe(241)
    expect(new Set(ADMINISTRATIVE_DIVISIONS.map(({ body }) => body)).size).toBe(241)
    expect(new Set(ADMINISTRATIVE_DIVISIONS.map(({ fullName }) => fullName)).size)
      .toBe(241)
  })

  it('resolves every parent and leaves every prefecture selectable', () => {
    const byId = new Map(
      ADMINISTRATIVE_DIVISIONS.map((division) => [division.id, division]),
    )

    for (const division of [...PREFECTURE_DIVISIONS, ...COUNTY_DIVISIONS]) {
      expect(division.parentId).not.toBeNull()
      expect(byId.has(division.parentId!)).toBe(true)
    }

    for (const prefecture of PREFECTURE_DIVISIONS) {
      expect(COUNTY_DIVISIONS.some(({ parentId }) => parentId === prefecture.id))
        .toBe(true)
    }
  })

  it('orders province-level short names for the legacy picker', () => {
    expect(ADDRESS_PICKER_PROVINCES).toHaveLength(34)
    expect(ADDRESS_PICKER_PROVINCES.slice(0, 2).map(({ body }) => body)).toEqual([
      '澜京',
      '玄津',
    ])
    expect(ADDRESS_PICKER_PROVINCES.slice(-3).map(({ body }) => body)).toEqual([
      '美丽岛',
      '自贸港',
      '镜海埠',
    ])
    expect(PROVINCE_DIVISIONS.filter(({ suffix }) => suffix === '自治区'))
      .toHaveLength(5)
    expect(ADDRESS_PICKER_PROVINCES.findIndex(({ id }) => id === 'P031'))
      .toBeLessThan(ADDRESS_PICKER_PROVINCES.findIndex(({ id }) => id === 'P023'))

    const directMunicipalities = PROVINCE_DIVISIONS.filter(({ id }) =>
      ['P028', 'P029', 'P030', 'P031'].includes(id))
    expect(directMunicipalities.map(({ suffix }) => suffix)).toEqual([
      '市',
      '市',
      '市',
      '市',
    ])
    expect(directMunicipalities.map(({ fullName }) => fullName)).toEqual([
      '澜京市',
      '玄津市',
      '海垣市',
      '曜城市',
    ])
  })

  it('turns every county-level record into one deterministic address route', () => {
    const domestic = FICTIONAL_ADDRESSES.filter(({ mode }) => mode === 'domestic')
    expect(domestic).toHaveLength(120)
    expect(new Set(domestic.map(({ postalCode }) => postalCode)).size).toBe(120)
    expect(domestic.every(({ postalCode }) => /^\d{6}$/.test(postalCode))).toBe(true)

    expect(domestic.filter(({ zone }) => zone === 'local')).toHaveLength(2)
    expect(domestic.filter(({ zone }) => zone === 'nonlocal')).toHaveLength(109)
    expect(domestic.filter(({ zone }) => zone === 'special-free-trade-port'))
      .toHaveLength(3)
    expect(domestic.filter(({ zone }) => zone === 'special-mirror-sea-port'))
      .toHaveLength(3)
    expect(domestic.filter(({ zone }) => zone === 'special-beautiful-island'))
      .toHaveLength(3)

    expect(domestic.some(({ hierarchy }) =>
      hierarchy[0] === '自贸港特别行政区')).toBe(true)
    expect(domestic.some(({ hierarchy }) =>
      hierarchy[0] === '镜海埠特别行政区')).toBe(true)
    expect(domestic.some(({ hierarchy }) =>
      hierarchy[0] === '美丽岛特别行政区')).toBe(true)
  })
})
