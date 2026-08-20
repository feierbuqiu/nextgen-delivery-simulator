import { describe, expect, it } from 'vitest'

import { hasPermission, selectActiveOperator } from './authorization'
import { migrateAccessState } from './migration'
import { createSeedState } from './seed'

describe('access duty-separation migration', () => {
  it('removes invented stage accounts, blocks supervisor overreach and preserves additive outlet permissions', async () => {
    const seed = await createSeedState()
    const legacy = structuredClone(seed)
    const supervisorRole = legacy.roles.find((role) => role.id === 'outlet-supervisor')!
    supervisorRole.permissions.push(
      'workspace.channel.core',
      'workspace.channel.dispatch.sealing',
      'management.basic.personnel',
    )
    legacy.roleAssignments.push({
      id: 'ROLE-ASG-999998',
      operatorId: '90000001',
      roleId: 'counter-operator',
      institutionCode: '99901001',
      dataScope: 'institution',
      status: 'active',
      assignedAt: '2026-08-18T00:00:00.000Z',
      assignedBy: 'LEGACY',
    })
    legacy.roles.push({
      id: 'dispatch-operator',
      name: '封发员',
      system: 'production',
      level: 'outlet',
      permissions: ['workspace.channel.dispatch.sealing'],
      custom: true,
      status: 'active',
    })
    legacy.operators.push({
      ...structuredClone(legacy.operators.find((operator) => operator.id === '81000001')!),
      id: '82000001',
    })
    legacy.roleAssignments.push({
      id: 'ROLE-ASG-999997',
      operatorId: '82000001',
      roleId: 'dispatch-operator',
      institutionCode: '99901001',
      dataScope: 'self',
      status: 'active',
      assignedAt: '2026-08-18T00:00:00.000Z',
      assignedBy: 'LEGACY',
    })
    legacy.roleAssignments.push({
      id: 'ROLE-ASG-999996',
      operatorId: '80000001',
      roleId: 'postage-meter-manager',
      institutionCode: '99901001',
      dataScope: 'self',
      status: 'active',
      assignedAt: '2026-08-18T00:00:00.000Z',
      assignedBy: 'LEGACY',
    })
    legacy.roleAssignments.push({
      id: 'ROLE-ASG-999995',
      operatorId: '80000001',
      roleId: 'personnel-clerk',
      institutionCode: '99901001',
      dataScope: 'institution',
      status: 'active',
      assignedAt: '2026-08-18T00:00:00.000Z',
      assignedBy: 'LEGACY',
    })

    const migrated = migrateAccessState(legacy)
    const supervisor = selectActiveOperator(migrated, '90000001')
    const activeAssignments = migrated.roleAssignments.filter((assignment) =>
      assignment.operatorId === '90000001' && assignment.status === 'active')

    expect(activeAssignments).toHaveLength(1)
    expect(activeAssignments[0]?.roleId).toBe('outlet-supervisor')
    expect(hasPermission(supervisor, 'management.business.attendance.operate')).toBe(true)
    expect(hasPermission(supervisor, 'workspace.channel.core')).toBe(false)
    expect(hasPermission(supervisor, 'workspace.channel.dispatch.sealing')).toBe(false)
    expect(hasPermission(supervisor, 'management.basic.personnel')).toBe(false)
    expect(migrated.operators.some((operator) => operator.id === '82000001')).toBe(false)
    expect(migrated.roles.some((role) => role.id === 'dispatch-operator')).toBe(false)
    expect(hasPermission(migrated, 'workspace.channel.dispatch.transport', '80000001')).toBe(true)
    expect(hasPermission(migrated, 'workspace.channel.postage-meter', '80000001')).toBe(true)
    expect(hasPermission(migrated, 'management.basic.personnel', '80000001')).toBe(false)
    expect(migrated.roleAssignments.filter((assignment) => (
      assignment.operatorId === '80000001' && assignment.status === 'active'
    )).map((assignment) => assignment.roleId)).toEqual([
      'counter-operator',
      'postage-meter-manager',
    ])
  })
})
