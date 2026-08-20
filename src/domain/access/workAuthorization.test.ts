import { describe, expect, it } from 'vitest'

import { selectActiveOperator } from './authorization'
import { createSeedState, DEMO_COUNTER_OPERATOR_ID, DEMO_MANAGEMENT_SECRET } from './seed'
import {
  authorizeDispatchRelationManagement,
  authorizeInternalHandoverReceiver,
  authorizeOnSiteAction,
  eligibleInternalHandoverReceivers,
  requireDispatchRelationManagementAuthorization,
  requireInternalHandoverAuthorization,
  requireOnSiteAuthorization,
} from './workAuthorization'

function signedIn(state: Awaited<ReturnType<typeof createSeedState>>, operatorId: string) {
  const selected = selectActiveOperator(state, operatorId)
  return {
    ...selected,
    session: {
      operatorId,
      workstationCode: '01',
      signedInAt: '2026-08-20T01:00:00.000Z',
      platformTestDuty: null,
    },
  }
}

describe('真实账号现场授权', () => {
  it('使用当前主管密码、同机构权限和独立工号签发一次性凭证', async () => {
    const state = signedIn(await createSeedState(), DEMO_COUNTER_OPERATOR_ID)
    const result = await authorizeOnSiteAction(state, {
      action: 'withdraw-service-transaction',
      authorizerId: '90000001',
      secret: DEMO_MANAGEMENT_SECRET,
      institutionCode: '99901001',
      occurredAt: '2026-08-20T01:05:00.000Z',
    })

    expect(requireOnSiteAuthorization(
      result.authorization,
      'withdraw-service-transaction',
      DEMO_COUNTER_OPERATOR_ID,
    ).authorizerId).toBe('90000001')
    expect(result.state.accessAuditEvents.at(-1)?.action).toBe('on-site-action-authorized')
    expect(() => requireOnSiteAuthorization(
      result.authorization,
      'withdraw-service-transaction',
      DEMO_COUNTER_OPERATOR_ID,
    )).toThrow('已经使用')
    expect(() => requireOnSiteAuthorization(
      result.authorization,
      'red-flush-invoice',
      DEMO_COUNTER_OPERATOR_ID,
    )).toThrow('真实账号现场授权')
  })

  it('拒绝固定旧密码、当前经办人自批和无管辖范围账号', async () => {
    const state = signedIn(await createSeedState(), DEMO_COUNTER_OPERATOR_ID)
    await expect(authorizeOnSiteAction(state, {
      action: 'withdraw-service-transaction',
      authorizerId: '90000001',
      secret: 'wrong-password',
      institutionCode: '99901001',
      occurredAt: '2026-08-20T01:05:00.000Z',
    })).rejects.toThrow('密码校验失败')
    await expect(authorizeOnSiteAction(state, {
      action: 'withdraw-service-transaction',
      authorizerId: DEMO_COUNTER_OPERATOR_ID,
      secret: 'Counter!2026',
      institutionCode: '99901001',
      occurredAt: '2026-08-20T01:05:00.000Z',
    })).rejects.toThrow('另一名有权人员')
    await expect(authorizeOnSiteAction(state, {
      action: 'withdraw-service-transaction',
      authorizerId: '92000001',
      secret: 'RoleAdmin!2026',
      institutionCode: '99901001',
      occurredAt: '2026-08-20T01:05:00.000Z',
    })).rejects.toThrow('现场授权权限')
  })

  it('只有本机构另一名已签到且有接收权限的员工可确认内部交接', async () => {
    const base = signedIn(await createSeedState(), DEMO_COUNTER_OPERATOR_ID)
    expect(eligibleInternalHandoverReceivers(
      base,
      '99901001',
      '2026-08-20T01:05:00.000Z',
    )).toEqual([])

    const completed = {
      ...base,
      operators: base.operators.map((operator) => operator.id === '80000001'
        ? {
            ...operator,
            profileCompleted: true,
            requiresSecretChange: false,
            profile: {
              ...base.operators.find((candidate) => candidate.id === DEMO_COUNTER_OPERATOR_ID)!.profile!,
              displayName: '演示营业人员乙',
            },
          }
        : operator),
      attendanceRecords: [{
        id: 'ATT-000001',
        workDate: '2026-08-20',
        institutionCode: '99901001',
        institutionName: '景麓营业部',
        operatorId: '80000001',
        operatorName: '演示营业人员乙',
        workstationCode: '02',
        institutionSignedInAt: '2026-08-20T00:55:00.000Z',
        institutionSignedOutAt: null,
        employeeSignedInAt: '2026-08-20T01:00:00.000Z',
        employeeSignedOutAt: null,
        institutionSignOutCancelledAt: null,
        employeeSignOutCancelledAt: null,
      }],
      accessAuditEvents: [{
        id: 'ACCESS-AUDIT-000001',
        action: 'institution-signed-in' as const,
        occurredAt: '2026-08-20T00:55:00.000Z',
        actorId: '90000001',
        targetId: '99901001:2026-08-20:manual',
        detail: '机构人工签到。',
      }],
      nextAccessAuditSequence: 2,
    }
    const receiver = eligibleInternalHandoverReceivers(
      completed,
      '99901001',
      '2026-08-20T01:05:00.000Z',
    )
    expect(receiver.map((operator) => operator.id)).toEqual(['80000001'])

    const result = await authorizeInternalHandoverReceiver(completed, {
      receiverId: '80000001',
      secret: '6yhn&UJM8ik,',
      institutionCode: '99901001',
      occurredAt: '2026-08-20T01:05:00.000Z',
    })
    expect(requireInternalHandoverAuthorization(
      result.authorization,
      DEMO_COUNTER_OPERATOR_ID,
      '80000001',
      '99901001',
    ).receiverName).toBe('演示营业人员乙')
  })

  it('县级基础管理账号只能为管辖机构签发一次性封发关系维护凭证', async () => {
    const state = signedIn(await createSeedState(), '84000001')
    const result = authorizeDispatchRelationManagement(
      state,
      '99901001',
      '2026-08-20T01:05:00.000Z',
    )

    expect(() => requireDispatchRelationManagementAuthorization(
      result.authorization,
      '84000001',
      '99900100',
    )).toThrow('上级基础管理人员')
    expect(requireDispatchRelationManagementAuthorization(
      result.authorization,
      '84000001',
      '99901001',
    ).institutionCode).toBe('99901001')
    expect(() => requireDispatchRelationManagementAuthorization(
      result.authorization,
      '84000001',
      '99901001',
    )).toThrow('已经使用')
    expect(() => authorizeDispatchRelationManagement(
      state,
      '99900100',
      '2026-08-20T01:06:00.000Z',
    )).toThrow('目标机构')
  })
})
