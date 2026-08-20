import { selectActiveOperator } from '../domain/access/authorization'
import { appendAccessAudit } from '../domain/access/audit'
import { localWorkDate } from '../domain/access/attendance'
import {
  authorizeDispatchRelationManagement,
  authorizeInternalHandoverReceiver,
  authorizeOnSiteAction,
  type InternalHandoverAuthorization,
  type OnSiteAuthorization,
  type OnSiteAuthorizationAction,
  type DispatchRelationManagementAuthorization,
  type RequestOnSiteAuthorization,
} from '../domain/access/workAuthorization'
import {
  createSeedState,
  DEMO_COUNTER_OPERATOR_ID,
  DEMO_COUNTER_SECRET,
  DEMO_MANAGEMENT_OPERATOR_ID,
  DEMO_MANAGEMENT_SECRET,
  DEMO_OPERATOR_ID,
  DEMO_PERSONNEL_CLERK_OPERATOR_ID,
} from '../domain/access/seed'
import type { SimulatorState } from '../domain/access/types'

const DEFAULT_OCCURRED_AT = '2026-08-04T12:00:00.000Z'
const DEFAULT_INSTITUTION_CODE = '99901001'

async function signedInState(operatorId: string, occurredAt: string) {
  let seed = await createSeedState()
  if (!seed.operators.some((operator) => operator.id === operatorId)) {
    const template = seed.operators.find((operator) => operator.id === DEMO_OPERATOR_ID)!
    seed = {
      ...seed,
      operators: [...seed.operators, {
        ...structuredClone(template),
        id: operatorId,
        boundMobile: `188${operatorId.padStart(8, '0').slice(-8)}`,
      }],
      securityByOperatorId: {
        ...seed.securityByOperatorId,
        [operatorId]: structuredClone(seed.securityByOperatorId[DEMO_OPERATOR_ID]!),
      },
    }
  }
  const state = selectActiveOperator(seed, operatorId)
  return {
    ...state,
    session: {
      operatorId,
      workstationCode: '01',
      signedInAt: occurredAt,
      platformTestDuty: null,
    },
  }
}

export async function createTestOnSiteAuthorization(
  action: OnSiteAuthorizationAction,
  requestedBy = DEMO_OPERATOR_ID,
  institutionCode = DEFAULT_INSTITUTION_CODE,
  occurredAt = DEFAULT_OCCURRED_AT,
): Promise<OnSiteAuthorization> {
  const result = await authorizeOnSiteAction(await signedInState(requestedBy, occurredAt), {
    action,
    authorizerId: DEMO_MANAGEMENT_OPERATOR_ID,
    secret: DEMO_MANAGEMENT_SECRET,
    institutionCode,
    occurredAt,
  })
  return result.authorization
}

export function createTestOnSiteAuthorizer(
  requestedBy = DEMO_OPERATOR_ID,
  institutionCode = DEFAULT_INSTITUTION_CODE,
): RequestOnSiteAuthorization {
  let state: Promise<SimulatorState> = signedInState(requestedBy, DEFAULT_OCCURRED_AT)
  return async (action, authorizerId, secret, occurredAt) => {
    const result = await authorizeOnSiteAction(await state, {
      action,
      authorizerId,
      secret,
      institutionCode,
      occurredAt,
    })
    state = Promise.resolve(result.state)
    return result.authorization
  }
}

export function createTestInternalHandoverAuthorizer(
  requestedBy = DEMO_OPERATOR_ID,
  institutionCode = DEFAULT_INSTITUTION_CODE,
) {
  return async (receiverId: string, secret: string, occurredAt: string) => {
    const state = await signedInState(requestedBy, occurredAt)
    const receiver = state.operators.find((operator) => operator.id === receiverId)
    if (!receiver?.profile) throw new Error('测试接收员工不存在。')
    const workDate = localWorkDate(new Date(occurredAt))
    const dutyState = appendAccessAudit({
      ...state,
      attendanceRecords: [{
        id: 'ATT-TEST-000001',
        workDate,
        institutionCode,
        institutionName: receiver.profile.institutionName,
        operatorId: receiverId,
        operatorName: receiver.profile.displayName,
        workstationCode: '02',
        institutionSignedInAt: occurredAt,
        institutionSignedInBy: receiverId,
        institutionSignedOutAt: null,
        employeeSignedInAt: occurredAt,
        employeeSignedOutAt: null,
        institutionSignOutCancelledAt: null,
        employeeSignOutCancelledAt: null,
      }],
    }, 'institution-signed-in', occurredAt, receiverId,
    `${institutionCode}:${workDate}:manual`, '测试机构人工签到。')
    const result = await authorizeInternalHandoverReceiver(dutyState, {
      receiverId,
      secret,
      institutionCode,
      occurredAt,
    })
    return result.authorization
  }
}

export async function createTestInternalHandoverAuthorization(
  requestedBy = DEMO_OPERATOR_ID,
  receiverId = DEMO_COUNTER_OPERATOR_ID,
  institutionCode = DEFAULT_INSTITUTION_CODE,
  occurredAt = DEFAULT_OCCURRED_AT,
): Promise<InternalHandoverAuthorization> {
  const state = await signedInState(requestedBy, occurredAt)
  const receiver = state.operators.find((operator) => operator.id === receiverId)
  if (!receiver?.profile) throw new Error('测试接收员工不存在。')
  const workDate = localWorkDate(new Date(occurredAt))
  const dutyState = appendAccessAudit({
    ...state,
    attendanceRecords: [{
      id: 'ATT-TEST-000001',
      workDate,
      institutionCode,
      institutionName: receiver.profile.institutionName,
      operatorId: receiverId,
      operatorName: receiver.profile.displayName,
      workstationCode: '02',
      institutionSignedInAt: occurredAt,
      institutionSignedInBy: receiverId,
      institutionSignedOutAt: null,
      employeeSignedInAt: occurredAt,
      employeeSignedOutAt: null,
      institutionSignOutCancelledAt: null,
      employeeSignOutCancelledAt: null,
    }],
  }, 'institution-signed-in', occurredAt, receiverId,
  `${institutionCode}:${workDate}:manual`, '测试机构人工签到。')
  const result = await authorizeInternalHandoverReceiver(dutyState, {
    receiverId,
    secret: DEMO_COUNTER_SECRET,
    institutionCode,
    occurredAt,
  })
  return result.authorization
}

export async function createTestDispatchRelationAuthorization(
  occurredAt = DEFAULT_OCCURRED_AT,
  institutionCode = DEFAULT_INSTITUTION_CODE,
): Promise<DispatchRelationManagementAuthorization> {
  return authorizeDispatchRelationManagement(
    await signedInState(DEMO_PERSONNEL_CLERK_OPERATOR_ID, occurredAt),
    institutionCode,
    occurredAt,
  ).authorization
}
