import { describe, expect, it } from 'vitest'

import {
  ADMINISTRATIVE_POSTAL_RELATIONSHIPS,
  DIRECT_SEAL_RELATIONSHIPS,
  HIERARCHICAL_HUB_RELATIONSHIPS,
  queryAdministrativePostalRelationships,
  queryBagUnloadingRelationships,
  queryBranchExportRelationships,
  queryDirectSealRelationships,
  queryHierarchicalHubRelationships,
  queryNetworkExportRelationships,
  queryPostalRouteComparisons,
} from './routingRelationshipQuery'

describe('routing relationship queries', () => {
  it('distinguishes effective postal routes and exposes their station order', () => {
    const valid = queryPostalRouteComparisons({ organizationTerm: '景麓', validity: 'valid' })
    const invalid = queryPostalRouteComparisons({ organizationTerm: '', validity: 'invalid' })

    expect(valid).toHaveLength(3)
    expect(valid.every((row) => row.direction === '上行' || row.direction === '不分上下行')).toBe(true)
    expect(valid[0]?.stations[0]).toMatchObject({ institutionCode: '99901001', sequence: 1 })
    expect(invalid).toHaveLength(1)
    expect(invalid[0]).toMatchObject({ direction: '下行', valid: false })
  })

  it('filters network and branch export relationships by the PDF query fields', () => {
    const network = queryNetworkExportRelationships({
      institutionCode: '99901001',
      productStart: '4',
      localTransfer: 'undivided',
      receivingOfficeCode: '99103',
      routeTerm: '镜海埠',
    })
    const branch = queryBranchExportRelationships({
      institutionCode: '99901001',
      productTerm: '300',
      openingOfficeCode: '',
      destinationPostalAreaCode: '',
      localTransfer: 'all',
      deletionFlag: 'active',
    })
    const deleted = queryBranchExportRelationships({
      institutionCode: '',
      productTerm: '151',
      openingOfficeCode: '',
      destinationPostalAreaCode: '',
      localTransfer: 'all',
      deletionFlag: 'deleted',
    })

    expect(network).toHaveLength(1)
    expect(network[0]?.mailKindName).toBe('特快')
    expect(branch).toHaveLength(1)
    expect(branch[0]?.baseProductName).toBe('普通包裹')
    expect(deleted).toHaveLength(1)
    expect(deleted[0]?.deleted).toBe(true)
  })

  it('filters unloading and direct-seal relations without inventing transaction data', () => {
    const unloading = queryBagUnloadingRelationships({
      institutionCode: '99901001',
      bagTypeTerm: '',
      routeCode: 'SIM-A01',
      receivingOfficeCode: '',
      unloadingStationCode: '',
      localTransfer: 'all',
    })
    const sample = DIRECT_SEAL_RELATIONSHIPS[0]!
    const direct = queryDirectSealRelationships({
      provinceName: sample.provinceName,
      prefectureName: sample.prefectureName,
      countyName: sample.countyName,
    })

    expect(unloading.length).toBeGreaterThan(0)
    expect(unloading.every((row) => row.routeCode === 'SIM-A01')).toBe(true)
    expect(direct).toEqual([sample])
  })

  it('requires exact administrative and delivery-region code lengths', () => {
    expect(() => queryAdministrativePostalRelationships('12345')).toThrow('请输入 6 位行政区划代码。')
    expect(() => queryHierarchicalHubRelationships('1234567')).toThrow('请输入 8 位投递局区域码。')

    const administrative = ADMINISTRATIVE_POSTAL_RELATIONSHIPS[0]!
    const hierarchy = HIERARCHICAL_HUB_RELATIONSHIPS[0]!
    expect(queryAdministrativePostalRelationships(administrative.administrativeCode)).toEqual([administrative])
    expect(queryHierarchicalHubRelationships(hierarchy.deliveryRegionCode)).toEqual([hierarchy])
  })
})
