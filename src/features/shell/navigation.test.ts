import { describe, expect, it } from 'vitest'

import {
  CAPABILITY_CATALOG,
  getCapability,
} from '../governance/capabilityCatalog'
import {
  moreApplications,
  navigationGroups,
  permissionRequiresAttendance,
  requiredPermissionForView,
  shellUtilities,
  topNavigation,
  viewRequiresAttendance,
} from './navigation'

describe('shell attendance guards', () => {
  it('requires active attendance for production workspaces but not read-only or management access', () => {
    expect(permissionRequiresAttendance('workspace.channel.core')).toBe(true)
    expect(permissionRequiresAttendance('workspace.channel.dispatch')).toBe(true)
    expect(permissionRequiresAttendance('workspace.channel.query')).toBe(false)
    expect(permissionRequiresAttendance('management.business.attendance.read')).toBe(false)

    expect(viewRequiresAttendance('service')).toBe(true)
    expect(viewRequiresAttendance('mail-sealing')).toBe(true)
    expect(viewRequiresAttendance('query-accepted-mail')).toBe(false)
    expect(viewRequiresAttendance('query-business-customer')).toBe(false)
    expect(viewRequiresAttendance('business-management')).toBe(false)
    expect(viewRequiresAttendance('personal-remittance')).toBe(false)
    expect(viewRequiresAttendance('dashboard')).toBe(false)
  })

  it('keeps every visible navigation entry linked to exactly one capability record', () => {
    const navigationEntries = [
      ...shellUtilities,
      ...topNavigation,
      ...moreApplications,
      ...navigationGroups.flatMap((group) => [
        ...(group.entry ? [group.entry] : []),
        ...group.children,
      ]),
    ]
    const ids = navigationEntries.map((entry) => entry.capabilityId)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids)).toEqual(new Set(CAPABILITY_CATALOG.map((entry) => entry.id)))
    for (const entry of navigationEntries) {
      expect(getCapability(entry.capabilityId).label).toBe(entry.label)
    }
  })

  it('does not route planned sidebar and launcher capabilities into fake workspaces', () => {
    const routableEntries = [
      ...moreApplications,
      ...navigationGroups.flatMap((group) => [
        ...(group.entry ? [group.entry] : []),
        ...group.children,
      ]),
    ]

    for (const entry of routableEntries) {
      const capability = getCapability(entry.capabilityId)
      if (capability.maturity === 'planned') {
        expect(entry.view, capability.id).toBeUndefined()
      } else {
        expect(entry.view, capability.id).toBeDefined()
      }
    }
  })

  it('routes the simple channel-sales entry to the embedded sales workspace', () => {
    const business = navigationGroups.find((group) => group.id === 'business')
    const entry = business?.children.find(
      (item) => item.capabilityId === 'channel.business.channel-sales-entry',
    )

    expect(entry).toMatchObject({
      label: '多渠道商品简易销售',
      view: 'channel-product-sales',
    })
  })

  it('routes points-product inventory to its authorized operational workspace', () => {
    const points = navigationGroups.find((group) => group.id === 'points')
    expect(points?.children.find((item) => item.capabilityId === 'channel.points.inventory'))
      .toMatchObject({ view: 'points-inventory' })
    expect(requiredPermissionForView('points-inventory')).toBe('workspace.channel.points')
    expect(viewRequiresAttendance('points-inventory')).toBe(true)
  })

  it('routes business-customer query to the read-only query workspace', () => {
    const query = navigationGroups.find((group) => group.id === 'query')
    expect(query?.children.find((item) => item.capabilityId === 'channel.query.customer'))
      .toMatchObject({ view: 'query-business-customer' })
    expect(requiredPermissionForView('query-business-customer'))
      .toBe('workspace.channel.query')
    expect(viewRequiresAttendance('query-business-customer')).toBe(false)
  })

  it('exposes only the seven PDF-native dispatch pages with separated permissions', () => {
    const dispatch = navigationGroups.find((group) => group.id === 'dispatch')
    expect(dispatch?.children.map((entry) => entry.label)).toEqual([
      '交接处理',
      '封发处理',
      '路单生成',
      '路单/清单打印',
      '趟车出口',
      '封发查询',
      '总包退回互换局',
    ])
    expect(dispatch?.children.some((entry) => entry.label === '全流程作业')).toBe(false)
    expect(requiredPermissionForView('mail-handover'))
      .toBe('workspace.channel.dispatch.handover')
    expect(requiredPermissionForView('mail-sealing'))
      .toBe('workspace.channel.dispatch.sealing')
    expect(requiredPermissionForView('dispatch-route'))
      .toBe('workspace.channel.dispatch.routing')
    expect(requiredPermissionForView('dispatch-export'))
      .toBe('workspace.channel.dispatch.transport')
  })
})
