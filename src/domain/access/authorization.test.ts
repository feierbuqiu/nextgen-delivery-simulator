import { describe, expect, it } from 'vitest'

import { createSeedState } from './seed'
import {
  accessibleInstitutionCodes,
  hasScopedPermission,
  effectiveRoles,
  findOperatorByIdentifier,
  hasPermission,
  selectActiveOperator,
} from './authorization'

describe('access authorization', () => {
  it('lets one outlet employee perform the routine mail chain without management access', async () => {
    const state = await createSeedState()

    expect(effectiveRoles(state).map((role) => role.name)).toEqual(['网点基础营业权限'])
    expect(hasPermission(state, 'workspace.channel.bulk')).toBe(true)
    expect(hasPermission(state, 'workspace.channel.dispatch')).toBe(true)
    expect(hasPermission(state, 'workspace.channel.dispatch.handover')).toBe(true)
    expect(hasPermission(state, 'workspace.channel.dispatch.handover-out')).toBe(true)
    expect(hasPermission(state, 'workspace.channel.dispatch.handover-in')).toBe(true)
    expect(hasPermission(state, 'workspace.channel.dispatch.sealing')).toBe(true)
    expect(hasPermission(state, 'workspace.channel.dispatch.routing')).toBe(true)
    expect(hasPermission(state, 'workspace.channel.dispatch.transport')).toBe(true)
    expect(hasPermission(state, 'workspace.channel.core')).toBe(true)
    expect(hasPermission(state, 'workspace.accounting')).toBe(true)
    expect(hasPermission(state, 'workspace.channel.postage-meter')).toBe(false)
    expect(hasPermission(state, 'workspace.philately')).toBe(false)
    expect(hasPermission(state, 'management.basic.personnel')).toBe(false)
  })

  it('keeps outlet supervision and upper-level administration out of production work', async () => {
    const state = await createSeedState()
    const management = findOperatorByIdentifier(state, '90000001')
    expect(management?.profile?.displayName).toBe('演示主管')

    const selected = selectActiveOperator(state, '90000001')
    expect(selected.operator.id).toBe('90000001')
    expect(selected.operator.profile?.institutionName).toBe('景麓营业部')
    expect(hasPermission(selected, 'management.basic.personnel')).toBe(false)
    expect(hasPermission(selected, 'management.business.attendance.operate')).toBe(true)
    expect(hasPermission(selected, 'workspace.channel.core')).toBe(false)
    expect(hasPermission(selected, 'workspace.channel.dispatch')).toBe(false)
    expect(selected.security).toEqual(selected.securityByOperatorId['90000001'])

    const counter = selectActiveOperator(state, '81000001')
    expect(hasPermission(counter, 'workspace.channel.core')).toBe(true)
    expect(hasPermission(counter, 'workspace.channel.bulk')).toBe(true)
    expect(hasPermission(counter, 'workspace.channel.dispatch.handover-out')).toBe(true)
    expect(hasPermission(counter, 'workspace.channel.dispatch.sealing')).toBe(true)
    expect(hasPermission(counter, 'workspace.channel.dispatch.transport')).toBe(true)
    expect(hasPermission(counter, 'workspace.accounting')).toBe(true)
    expect(findOperatorByIdentifier(state, '81500001')).toBeNull()
    expect(findOperatorByIdentifier(state, '82000001')).toBeNull()
    expect(findOperatorByIdentifier(state, '83000001')).toBeNull()

    const personnelClerk = selectActiveOperator(state, '84000001')
    expect(hasPermission(personnelClerk, 'management.basic.personnel')).toBe(true)
    expect(hasPermission(personnelClerk, 'management.business.personnel-approval')).toBe(false)
    expect(hasPermission(personnelClerk, 'workspace.channel.core')).toBe(false)

    const personnelApprover = selectActiveOperator(state, '91000001')
    expect(hasPermission(personnelApprover, 'management.business.personnel-approval')).toBe(true)
    expect(hasPermission(personnelApprover, 'management.basic.personnel')).toBe(false)

    const roleAdmin = selectActiveOperator(state, '92000001')
    expect(hasPermission(roleAdmin, 'management.basic.roles')).toBe(true)
    expect(hasPermission(roleAdmin, 'management.business.role-approval')).toBe(true)
    expect(hasPermission(roleAdmin, 'management.basic.personnel')).toBe(false)
    expect(hasPermission(roleAdmin, 'management.business.personnel-approval')).toBe(false)
  })

  it('applies self, institution and subordinate data scopes to real records', async () => {
    const state = await createSeedState()
    expect(hasScopedPermission(
      state,
      'management.business.attendance.read',
      '80000001',
      '99901001',
    )).toBe(true)
    expect(hasScopedPermission(
      state,
      'management.business.attendance.read',
      '90000001',
      '99901001',
    )).toBe(false)

    const personnelClerk = selectActiveOperator(state, '84000001')
    expect(accessibleInstitutionCodes(personnelClerk, 'management.basic.personnel'))
      .toEqual(new Set(['99901000', '99901001']))

    const upper = selectActiveOperator(state, '91000001')
    expect(accessibleInstitutionCodes(upper, 'management.basic.personnel'))
      .toEqual(new Set())
    expect(accessibleInstitutionCodes(upper, 'management.business.personnel-approval'))
      .toEqual(new Set(['99900100', '99901000', '99901001']))

    const roleAdmin = selectActiveOperator(state, '92000001')
    expect(accessibleInstitutionCodes(roleAdmin, 'management.business.role-approval'))
      .toEqual(new Set(['99900000', '99900100', '99901000', '99901001']))
  })
})
