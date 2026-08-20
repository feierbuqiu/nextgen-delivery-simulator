import { createEmptyAccessSecurityState } from './migration'
import {
  ACCESS_INSTITUTIONS,
  ACCESS_ROLES,
  COUNTER_OPERATOR_PROFILE,
  MANAGEMENT_OPERATOR_PROFILE,
  PERSONNEL_CLERK_OPERATOR_PROFILE,
  ROLE_ADMIN_OPERATOR_PROFILE,
  UPPER_MANAGEMENT_OPERATOR_PROFILE,
} from './catalog'
import type { DemoOperator, SimulatorState } from './types'

export const DEMO_OPERATOR_ID = '80000001'
export const DEMO_BOUND_MOBILE = '10000000009'
export const DEMO_TEMPORARY_SECRET = '6yhn&UJM8ik,'
export const DEMO_TEMPORARY_SECRET_HASH = '09dc0ad357e44018ae86a7f3c266e93a6ccb8b81f817e6a2b4d6df56b0c7d668'
export const DEMO_ONE_TIME_CODE = '246810'
export const DEMO_MANAGEMENT_OPERATOR_ID = '90000001'
export const DEMO_MANAGEMENT_SECRET = 'Supervisor!2026'
export const DEMO_MANAGEMENT_SECRET_HASH = '3b907c5d569e8ccd0f7562837077c6b51050090f11e34ef2a6b40f0f5ced1e76'
export const DEMO_COUNTER_OPERATOR_ID = '81000001'
export const DEMO_COUNTER_SECRET = 'Counter!2026'
export const DEMO_COUNTER_SECRET_HASH = '1180fb93d923ba4c82a73e62c590c7f421eb762595324249aa9bc7579ad0ce29'
export const DEMO_PERSONNEL_CLERK_OPERATOR_ID = '84000001'
export const DEMO_PERSONNEL_CLERK_SECRET = 'Personnel!26'
export const DEMO_PERSONNEL_CLERK_SECRET_HASH = 'd213a7e694b013c746de68e81a0cbe333c169219d457be8e63dcde121f1b18a8'
export const DEMO_UPPER_MANAGEMENT_OPERATOR_ID = '91000001'
export const DEMO_UPPER_MANAGEMENT_SECRET = 'UpperAdmin!26'
export const DEMO_UPPER_MANAGEMENT_SECRET_HASH = '0722a4ad68b36a8c6159725b332f37612641afead4d068cef0ddedfe7d7c7b8c'
export const DEMO_ROLE_ADMIN_OPERATOR_ID = '92000001'
export const DEMO_ROLE_ADMIN_SECRET = 'RoleAdmin!2026'
export const DEMO_ROLE_ADMIN_SECRET_HASH = '0bb7eb74465d9c49f6ea68ba0157b2aca4345ea242bac178ae728e229cd4bacd'

export async function createSeedState(): Promise<SimulatorState> {
  const secretHash = DEMO_TEMPORARY_SECRET_HASH
  const managementSecretHash = DEMO_MANAGEMENT_SECRET_HASH
  const operator: DemoOperator = {
    id: DEMO_OPERATOR_ID,
    boundMobile: DEMO_BOUND_MOBILE,
    secretHash,
    secretHistoryHashes: [secretHash],
    accountStatus: 'active',
    profileCompleted: false,
    requiresSecretChange: true,
    requiresWorkstation: true,
    profile: null,
  }
  const managementOperator: DemoOperator = {
    id: DEMO_MANAGEMENT_OPERATOR_ID,
    boundMobile: MANAGEMENT_OPERATOR_PROFILE.phone,
    secretHash: managementSecretHash,
    secretHistoryHashes: [managementSecretHash],
    accountStatus: 'active',
    profileCompleted: true,
    requiresSecretChange: false,
    requiresWorkstation: true,
    profile: structuredClone(MANAGEMENT_OPERATOR_PROFILE),
  }
  const counterOperator: DemoOperator = {
    id: DEMO_COUNTER_OPERATOR_ID,
    boundMobile: COUNTER_OPERATOR_PROFILE.phone,
    secretHash: DEMO_COUNTER_SECRET_HASH,
    secretHistoryHashes: [DEMO_COUNTER_SECRET_HASH],
    accountStatus: 'active',
    profileCompleted: true,
    requiresSecretChange: false,
    requiresWorkstation: true,
    profile: structuredClone(COUNTER_OPERATOR_PROFILE),
  }
  const personnelClerkOperator: DemoOperator = {
    id: DEMO_PERSONNEL_CLERK_OPERATOR_ID,
    boundMobile: PERSONNEL_CLERK_OPERATOR_PROFILE.phone,
    secretHash: DEMO_PERSONNEL_CLERK_SECRET_HASH,
    secretHistoryHashes: [DEMO_PERSONNEL_CLERK_SECRET_HASH],
    accountStatus: 'active',
    profileCompleted: true,
    requiresSecretChange: false,
    requiresWorkstation: false,
    profile: structuredClone(PERSONNEL_CLERK_OPERATOR_PROFILE),
  }
  const upperManagementOperator: DemoOperator = {
    id: DEMO_UPPER_MANAGEMENT_OPERATOR_ID,
    boundMobile: UPPER_MANAGEMENT_OPERATOR_PROFILE.phone,
    secretHash: DEMO_UPPER_MANAGEMENT_SECRET_HASH,
    secretHistoryHashes: [DEMO_UPPER_MANAGEMENT_SECRET_HASH],
    accountStatus: 'active',
    profileCompleted: true,
    requiresSecretChange: false,
    requiresWorkstation: false,
    profile: structuredClone(UPPER_MANAGEMENT_OPERATOR_PROFILE),
  }
  const roleAdminOperator: DemoOperator = {
    id: DEMO_ROLE_ADMIN_OPERATOR_ID,
    boundMobile: ROLE_ADMIN_OPERATOR_PROFILE.phone,
    secretHash: DEMO_ROLE_ADMIN_SECRET_HASH,
    secretHistoryHashes: [DEMO_ROLE_ADMIN_SECRET_HASH],
    accountStatus: 'active',
    profileCompleted: true,
    requiresSecretChange: false,
    requiresWorkstation: false,
    profile: structuredClone(ROLE_ADMIN_OPERATOR_PROFILE),
  }
  const security = createEmptyAccessSecurityState()
  return {
    schemaVersion: 8,
    operator,
    operators: [
      operator,
      counterOperator,
      personnelClerkOperator,
      managementOperator,
      upperManagementOperator,
      roleAdminOperator,
    ],
    institutions: structuredClone(ACCESS_INSTITUTIONS),
    roles: structuredClone(ACCESS_ROLES),
    roleAssignments: [
      {
        id: 'ROLE-ASG-000001',
        operatorId: DEMO_OPERATOR_ID,
        roleId: 'counter-operator',
        institutionCode: '99901001',
        dataScope: 'self',
        status: 'active',
        assignedAt: '2026-01-01T00:00:00.000Z',
        assignedBy: 'SYSTEM',
      },
      {
        id: 'ROLE-ASG-000008',
        operatorId: DEMO_COUNTER_OPERATOR_ID,
        roleId: 'counter-operator',
        institutionCode: '99901001',
        dataScope: 'self',
        status: 'active',
        assignedAt: '2026-01-01T00:00:00.000Z',
        assignedBy: 'SYSTEM',
      },
      {
        id: 'ROLE-ASG-000004',
        operatorId: DEMO_PERSONNEL_CLERK_OPERATOR_ID,
        roleId: 'personnel-clerk',
        institutionCode: '99901000',
        dataScope: 'subordinate',
        status: 'active',
        assignedAt: '2026-01-01T00:00:00.000Z',
        assignedBy: 'SYSTEM',
      },
      {
        id: 'ROLE-ASG-000005',
        operatorId: DEMO_UPPER_MANAGEMENT_OPERATOR_ID,
        roleId: 'personnel-administrator',
        institutionCode: '99900100',
        dataScope: 'subordinate',
        status: 'active',
        assignedAt: '2026-01-01T00:00:00.000Z',
        assignedBy: 'SYSTEM',
      },
      {
        id: 'ROLE-ASG-000006',
        operatorId: DEMO_MANAGEMENT_OPERATOR_ID,
        roleId: 'outlet-supervisor',
        institutionCode: '99901001',
        dataScope: 'institution',
        status: 'active',
        assignedAt: '2026-01-01T00:00:00.000Z',
        assignedBy: 'SYSTEM',
      },
      {
        id: 'ROLE-ASG-000007',
        operatorId: DEMO_ROLE_ADMIN_OPERATOR_ID,
        roleId: 'role-administrator',
        institutionCode: '99900000',
        dataScope: 'subordinate',
        status: 'active',
        assignedAt: '2026-01-01T00:00:00.000Z',
        assignedBy: 'SYSTEM',
      },
    ],
    personnelRequests: [],
    attendanceRecords: [],
    accessAuditEvents: [],
    nextPersonnelRequestSequence: 1,
    nextAttendanceSequence: 1,
    nextAccessAuditSequence: 1,
    security,
    securityByOperatorId: {
      [operator.id]: structuredClone(security),
      [counterOperator.id]: createEmptyAccessSecurityState(),
      [personnelClerkOperator.id]: createEmptyAccessSecurityState(),
      [managementOperator.id]: createEmptyAccessSecurityState(),
      [upperManagementOperator.id]: createEmptyAccessSecurityState(),
      [roleAdminOperator.id]: createEmptyAccessSecurityState(),
    },
    session: null,
  }
}
