import { describe, expect, it } from 'vitest'

import { DEFAULT_OPERATOR_PROFILE } from './catalog'
import {
  hasPermission,
  selectActiveOperator,
} from './authorization'
import {
  reviewPersonnelRequest,
  submitDeactivationRequest,
  submitNewEmployeeRequest,
  submitRoleRequest,
  updateSelfServiceProfile,
} from './management'
import { createSeedState } from './seed'

describe('access personnel management', () => {
  it('allows self-service contact changes without changing controlled fields', async () => {
    const seed = await createSeedState()
    const completed = {
      ...seed,
      operator: {
        ...seed.operator,
        profileCompleted: true,
        profile: structuredClone(DEFAULT_OPERATOR_PROFILE),
      },
    }
    const changed = updateSelfServiceProfile(completed, {
      phone: '10000000015',
      receiveSmsType: 'security',
      receiveSmsTime: '09:00-18:00',
      responsibleStoreOutlet: '景麓营业部',
      performanceSourceOutlet: '景麓营业部',
      performanceEvaluation: '良好',
    }, '2026-08-12T08:10:00.000Z')

    expect(changed.operator.profile).toMatchObject({
      phone: '10000000015',
      institutionCode: '99901001',
      jobInformation: 'counter-operator',
    })
    expect(changed.operator.boundMobile).toBe('10000000015')
    expect(changed.accessAuditEvents.at(-1)?.action).toBe('personal-profile-updated')
  })

  it('activates a requested specialist role only after another employee approves it', async () => {
    const seed = await createSeedState()
    const requested = submitRoleRequest(
      seed,
      'postage-meter-manager',
      '承担邮资机日常登记工作',
      '2026-08-12T08:20:00.000Z',
    )
    expect(hasPermission(requested, 'workspace.channel.postage-meter')).toBe(false)

    const manager = selectActiveOperator(requested, '92000001')
    const approved = reviewPersonnelRequest(
      manager,
      requested.personnelRequests[0]!.id,
      'approved',
      '岗位培训记录齐全，同意开通。',
      '2026-08-12T08:30:00.000Z',
    )
    expect(hasPermission(approved, 'workspace.channel.postage-meter', '80000001')).toBe(true)
    expect(hasPermission(approved, 'workspace.channel.core', '80000001')).toBe(true)
    expect(approved.roleAssignments.filter((assignment) => (
      assignment.operatorId === '80000001' && assignment.status === 'active'
    ))).toHaveLength(2)
    expect(approved.personnelRequests[0]?.status).toBe('approved')
  })

  it('routes manager-created personnel changes to an upper personnel administrator', async () => {
    const seed = await createSeedState()
    const manager = selectActiveOperator(seed, '84000001')
    expect(() => submitNewEmployeeRequest(manager, {
      id: '80000003',
      boundMobile: '10000000018',
      requiresWorkstation: true,
      profile: {
        ...structuredClone(DEFAULT_OPERATOR_PROFILE),
        displayName: '越界演练人员',
        identityCode: '990101199601010018',
        phone: '10000000018',
        institutionCode: '99900100',
        institutionName: '栖沄市业务管理中心',
      },
    }, '越界新增', '2026-08-12T08:55:00.000Z'))
      .toThrow('不能在管辖范围外新增人员')
    const newEmployeeRequest = submitNewEmployeeRequest(manager, {
      id: '80000002',
      boundMobile: '10000000017',
      requiresWorkstation: true,
      profile: {
        ...structuredClone(DEFAULT_OPERATOR_PROFILE),
        displayName: '演练新员工',
        phone: '10000000017',
      },
    }, '网点新增营业岗位人员', '2026-08-12T09:00:00.000Z')
    expect(() => submitNewEmployeeRequest(newEmployeeRequest, {
      id: '80000002',
      boundMobile: '10000000017',
      requiresWorkstation: true,
      profile: {
        ...structuredClone(DEFAULT_OPERATOR_PROFILE),
        displayName: '重复申请人员',
        phone: '10000000017',
      },
    }, '重复提交', '2026-08-12T09:01:00.000Z'))
      .toThrow('相同人员的新增申请已经在审批中')
    expect(() => reviewPersonnelRequest(
      newEmployeeRequest,
      newEmployeeRequest.personnelRequests[0]!.id,
      'approved',
      '同意',
      '2026-08-12T09:05:00.000Z',
    )).toThrow('没有人员审批权限')

    const upper = selectActiveOperator(newEmployeeRequest, '91000001')
    const approved = reviewPersonnelRequest(
      upper,
      newEmployeeRequest.personnelRequests[0]!.id,
      'approved',
      '资料完整，同意新增。',
      '2026-08-12T09:10:00.000Z',
    )
    expect(approved.operators.find((operator) => operator.id === '80000002')).toMatchObject({
      accountStatus: 'active',
      requiresSecretChange: true,
    })

    const managerAgain = selectActiveOperator(approved, '84000001')
    const deactivation = submitDeactivationRequest(
      managerAgain,
      '80000002',
      '演练人员离岗',
      '2026-08-12T10:00:00.000Z',
    )
    const upperAgain = selectActiveOperator(deactivation, '91000001')
    const disabled = reviewPersonnelRequest(
      upperAgain,
      deactivation.personnelRequests.at(-1)!.id,
      'approved',
      '确认离岗，同意停用账户。',
      '2026-08-12T10:10:00.000Z',
    )
    expect(disabled.operators.find((operator) => operator.id === '80000002')?.accountStatus)
      .toBe('disabled')
  })
})
