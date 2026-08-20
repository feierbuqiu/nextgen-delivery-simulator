import { sanitizePublicProductData } from '../desensitization/publicText'
import {
  ACCESS_INSTITUTIONS,
  ACCESS_ROLES,
  COUNTER_OPERATOR_PROFILE,
  DEFAULT_OPERATOR_PROFILE,
  MANAGEMENT_OPERATOR_PROFILE,
  PERSONNEL_CLERK_OPERATOR_PROFILE,
  ROLE_ADMIN_OPERATOR_PROFILE,
  UPPER_MANAGEMENT_OPERATOR_PROFILE,
} from './catalog'
import type {
  AccessAuditEvent,
  AccessRole,
  AccessRoleAssignment,
  AccessSecurityEvent,
  AccessSecurityState,
  AttendanceRecord,
  DemoOperator,
  PersonnelRequest,
  SimulatorSession,
  SimulatorState,
} from './types'

const DEFAULT_OPERATOR_ID = '80000001'
const COUNTER_OPERATOR_ID = '81000001'
const PERSONNEL_CLERK_OPERATOR_ID = '84000001'
const MANAGEMENT_OPERATOR_ID = '90000001'
const UPPER_MANAGEMENT_OPERATOR_ID = '91000001'
const ROLE_ADMIN_OPERATOR_ID = '92000001'
const DEFAULT_SECRET_HASH = '09dc0ad357e44018ae86a7f3c266e93a6ccb8b81f817e6a2b4d6df56b0c7d668'
const COUNTER_SECRET_HASH = '1180fb93d923ba4c82a73e62c590c7f421eb762595324249aa9bc7579ad0ce29'
const PERSONNEL_CLERK_SECRET_HASH = 'd213a7e694b013c746de68e81a0cbe333c169219d457be8e63dcde121f1b18a8'
const MANAGEMENT_SECRET_HASH = '3b907c5d569e8ccd0f7562837077c6b51050090f11e34ef2a6b40f0f5ced1e76'
const UPPER_MANAGEMENT_SECRET_HASH = '0722a4ad68b36a8c6159725b332f37612641afead4d068cef0ddedfe7d7c7b8c'
const ROLE_ADMIN_SECRET_HASH = '0bb7eb74465d9c49f6ea68ba0157b2aca4345ea242bac178ae728e229cd4bacd'
const RETIRED_FRAGMENT_OPERATOR_IDS = new Set(['81500001', '82000001', '83000001'])
const RETIRED_FRAGMENT_ROLE_IDS = new Set(['bulk-operator', 'dispatch-operator', 'transport-operator'])
const CANONICAL_DEMO_OPERATOR_IDS = new Set([
  COUNTER_OPERATOR_ID,
  PERSONNEL_CLERK_OPERATOR_ID,
  MANAGEMENT_OPERATOR_ID,
  UPPER_MANAGEMENT_OPERATOR_ID,
  ROLE_ADMIN_OPERATOR_ID,
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createEmptyAccessSecurityState(): AccessSecurityState {
  return {
    failedSecretAttempts: 0,
    lockedAt: null,
    nextEventSequence: 1,
    events: [],
  }
}

function normalizeEvents(value: unknown): AccessSecurityEvent[] {
  if (!Array.isArray(value)) return []
  return value.filter((event): event is AccessSecurityEvent => {
    if (!isRecord(event)) return false
    return typeof event.id === 'string' &&
      typeof event.type === 'string' &&
      typeof event.occurredAt === 'string' &&
      typeof event.actorId === 'string'
  }).map((event) => structuredClone(event))
}

function normalizeSecurity(value: unknown): AccessSecurityState {
  const security = isRecord(value) ? value : {}
  const events = normalizeEvents(security.events)
  const failedSecretAttempts = Number.isInteger(security.failedSecretAttempts)
    ? Math.max(0, Math.min(10, Number(security.failedSecretAttempts)))
    : 0
  const lockedAt = typeof security.lockedAt === 'string' ? security.lockedAt : null
  const highestSequence = events.reduce((highest, event) => {
    const match = /-(\d+)$/.exec(event.id)
    return Math.max(highest, match ? Number(match[1]) : 0)
  }, 0)
  const storedNextSequence = Number.isInteger(security.nextEventSequence)
    ? Number(security.nextEventSequence)
    : 1
  return {
    failedSecretAttempts,
    lockedAt,
    nextEventSequence: Math.max(1, storedNextSequence, highestSequence + 1),
    events,
  }
}

function baseOperator(id: string): DemoOperator {
  if (id === COUNTER_OPERATOR_ID) {
    return {
      id,
      boundMobile: COUNTER_OPERATOR_PROFILE.phone,
      secretHash: COUNTER_SECRET_HASH,
      secretHistoryHashes: [COUNTER_SECRET_HASH],
      accountStatus: 'active',
      profileCompleted: true,
      requiresSecretChange: false,
      requiresWorkstation: true,
      profile: structuredClone(COUNTER_OPERATOR_PROFILE),
    }
  }
  if (id === ROLE_ADMIN_OPERATOR_ID) {
    return {
      id,
      boundMobile: ROLE_ADMIN_OPERATOR_PROFILE.phone,
      secretHash: ROLE_ADMIN_SECRET_HASH,
      secretHistoryHashes: [ROLE_ADMIN_SECRET_HASH],
      accountStatus: 'active',
      profileCompleted: true,
      requiresSecretChange: false,
      requiresWorkstation: false,
      profile: structuredClone(ROLE_ADMIN_OPERATOR_PROFILE),
    }
  }
  if (id === UPPER_MANAGEMENT_OPERATOR_ID) {
    return {
      id,
      boundMobile: UPPER_MANAGEMENT_OPERATOR_PROFILE.phone,
      secretHash: UPPER_MANAGEMENT_SECRET_HASH,
      secretHistoryHashes: [UPPER_MANAGEMENT_SECRET_HASH],
      accountStatus: 'active',
      profileCompleted: true,
      requiresSecretChange: false,
      requiresWorkstation: false,
      profile: structuredClone(UPPER_MANAGEMENT_OPERATOR_PROFILE),
    }
  }
  if (id === MANAGEMENT_OPERATOR_ID) {
    return {
      id,
      boundMobile: MANAGEMENT_OPERATOR_PROFILE.phone,
      secretHash: MANAGEMENT_SECRET_HASH,
      secretHistoryHashes: [MANAGEMENT_SECRET_HASH],
      accountStatus: 'active',
      profileCompleted: true,
      requiresSecretChange: false,
      requiresWorkstation: true,
      profile: structuredClone(MANAGEMENT_OPERATOR_PROFILE),
    }
  }
  if (id === PERSONNEL_CLERK_OPERATOR_ID) {
    return {
      id,
      boundMobile: PERSONNEL_CLERK_OPERATOR_PROFILE.phone,
      secretHash: PERSONNEL_CLERK_SECRET_HASH,
      secretHistoryHashes: [PERSONNEL_CLERK_SECRET_HASH],
      accountStatus: 'active',
      profileCompleted: true,
      requiresSecretChange: false,
      requiresWorkstation: false,
      profile: structuredClone(PERSONNEL_CLERK_OPERATOR_PROFILE),
    }
  }
  return {
    id,
    boundMobile: DEFAULT_OPERATOR_PROFILE.phone,
    secretHash: DEFAULT_SECRET_HASH,
    secretHistoryHashes: [DEFAULT_SECRET_HASH],
    accountStatus: 'active',
    profileCompleted: false,
    requiresSecretChange: true,
    requiresWorkstation: true,
    profile: null,
  }
}

function normalizeOperator(value: unknown, fallback: DemoOperator): DemoOperator {
  if (!isRecord(value)) return structuredClone(fallback)
  const secretHash = typeof value.secretHash === 'string'
    ? value.secretHash
    : fallback.secretHash
  const history = Array.isArray(value.secretHistoryHashes)
    ? value.secretHistoryHashes.filter((item): item is string => typeof item === 'string')
    : []
  const rawProfile = isRecord(value.profile) ? value.profile : null
  const fallbackProfile = fallback.profile ?? DEFAULT_OPERATOR_PROFILE
  return {
    id: typeof value.id === 'string' ? value.id : fallback.id,
    boundMobile: typeof value.boundMobile === 'string'
      ? value.boundMobile
      : fallback.boundMobile,
    secretHash,
    secretHistoryHashes: Array.from(new Set([
      ...history,
      secretHash,
    ])),
    accountStatus: value.accountStatus === 'disabled' ? 'disabled' : 'active',
    profileCompleted: typeof value.profileCompleted === 'boolean'
      ? value.profileCompleted
      : fallback.profileCompleted,
    requiresSecretChange: typeof value.requiresSecretChange === 'boolean'
      ? value.requiresSecretChange
      : fallback.requiresSecretChange,
    requiresWorkstation: typeof value.requiresWorkstation === 'boolean'
      ? value.requiresWorkstation
      : fallback.requiresWorkstation,
    profile: rawProfile
      ? { ...structuredClone(fallbackProfile), ...structuredClone(rawProfile) }
      : null,
  } as DemoOperator
}

function normalizeStoredOperator(value: unknown, id: string): DemoOperator {
  const fallback = baseOperator(id)
  const normalized = normalizeOperator(value, fallback)
  if (!CANONICAL_DEMO_OPERATOR_IDS.has(id)) return normalized
  return {
    ...normalized,
    id,
    boundMobile: fallback.boundMobile,
    profileCompleted: true,
    requiresWorkstation: fallback.requiresWorkstation,
    profile: structuredClone(fallback.profile),
  }
}

function normalizeSession(value: unknown): SimulatorSession | null {
  if (!isRecord(value)) return null
  if (typeof value.operatorId !== 'string' ||
      typeof value.workstationCode !== 'string' ||
      typeof value.signedInAt !== 'string') return null
  return {
    operatorId: value.operatorId,
    workstationCode: value.workstationCode,
    signedInAt: value.signedInAt,
    platformTestDuty: normalizePlatformTestDuty(value.platformTestDuty),
  }
}

function normalizePlatformTestDuty(value: unknown): SimulatorSession['platformTestDuty'] {
  if (!isRecord(value)) return null
  if (typeof value.enabledAt !== 'string' ||
      typeof value.expiresAt !== 'string' ||
      typeof value.enabledBy !== 'string' ||
      !Number.isFinite(Date.parse(value.enabledAt)) ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= Date.parse(value.enabledAt)) return null
  return {
    enabledAt: value.enabledAt,
    expiresAt: value.expiresAt,
    enabledBy: value.enabledBy,
  }
}

function mergeRoles(value: unknown): AccessRole[] {
  const stored = Array.isArray(value)
    ? value.filter((item): item is AccessRole => (
        isRecord(item) &&
        typeof item.id === 'string' &&
        !RETIRED_FRAGMENT_ROLE_IDS.has(item.id)
      ))
    : []
  const byId = new Map(ACCESS_ROLES.map((role) => [role.id, structuredClone(role)]))
  for (const role of stored) {
    const canonical = byId.get(role.id)
    // 目录中登记的角色始终跟随当前职责基线；只有未知 ID 的用户自定义角色原样保留。
    byId.set(role.id, canonical
      ? { ...structuredClone(role), ...structuredClone(canonical) }
      : structuredClone(role))
  }
  return Array.from(byId.values())
}

function normalizeAssignments(
  value: unknown,
  operators: DemoOperator[],
  roles: AccessRole[],
): AccessRoleAssignment[] {
  const operatorIds = new Set(operators.map((operator) => operator.id))
  let stored = Array.isArray(value)
    ? value.filter((item): item is AccessRoleAssignment => (
      isRecord(item) &&
      typeof item.id === 'string' &&
      typeof item.operatorId === 'string' &&
      typeof item.roleId === 'string' &&
      operatorIds.has(item.operatorId)
    )).map((item) => ({
      ...structuredClone(item),
      dataScope: (item.dataScope === 'institution' || item.dataScope === 'subordinate'
        ? item.dataScope
        : 'self') as AccessRoleAssignment['dataScope'],
      status: (item.status === 'inactive' ? 'inactive' : 'active') as AccessRoleAssignment['status'],
      assignedAt: typeof item.assignedAt === 'string'
        ? item.assignedAt
        : '1970-01-01T00:00:00.000Z',
      assignedBy: typeof item.assignedBy === 'string' ? item.assignedBy : 'SYSTEM',
    }))
    : []
  const activeRoleIds = new Set(roles
    .filter((role) => role.status === 'active')
    .map((role) => role.id))
  const rolesById = new Map(roles.map((role) => [role.id, role]))
  stored = stored.map((assignment) => (
    assignment.status === 'active' && !activeRoleIds.has(assignment.roleId)
      ? { ...assignment, status: 'inactive' }
      : assignment
  ))
  let nextAssignmentSequence = stored.reduce((highest, assignment) => {
    const match = /-(\d+)$/.exec(assignment.id)
    return Math.max(highest, match ? Number(match[1]) : 0)
  }, 0) + 1
  const createAssignment = (
    operatorId: string,
    roleId: string,
    dataScope: AccessRoleAssignment['dataScope'],
  ) => {
    if (!operators.some((operator) => operator.id === operatorId)) return
    stored.push({
      id: `ROLE-ASG-${String(nextAssignmentSequence).padStart(6, '0')}`,
      operatorId,
      roleId,
      institutionCode: operators.find((operator) => operator.id === operatorId)
        ?.profile?.institutionCode ?? '99901001',
      dataScope,
      status: 'active',
      assignedAt: '2026-01-01T00:00:00.000Z',
      assignedBy: 'SYSTEM',
    })
    nextAssignmentSequence += 1
  }

  const activateRole = (
    operatorId: string,
    roleId: string,
    dataScope: AccessRoleAssignment['dataScope'],
    exclusive: boolean,
  ) => {
    const existing = stored
      .filter((assignment) => assignment.operatorId === operatorId &&
        assignment.roleId === roleId)
      .sort((left, right) => (
        `${right.assignedAt}:${right.id}`.localeCompare(`${left.assignedAt}:${left.id}`)
      ))[0]
    stored = stored.map((assignment) => {
      if (assignment.operatorId !== operatorId) return assignment
      if (assignment.roleId === roleId) {
        return {
          ...assignment,
          status: assignment.id === existing?.id ? 'active' : 'inactive',
          ...(assignment.id === existing?.id ? { dataScope } : {}),
        }
      }
      const assignedRole = rolesById.get(assignment.roleId)
      if (assignment.status === 'active' && (
        exclusive || assignedRole?.system === 'management'
      )) return { ...assignment, status: 'inactive' }
      return assignment
    })
    if (!existing) createAssignment(operatorId, roleId, dataScope)
  }

  const fixedRoles = new Map<string, {
    roleId: string
    dataScope: AccessRoleAssignment['dataScope']
    exclusive: boolean
  }>([
    [DEFAULT_OPERATOR_ID, {
      roleId: 'counter-operator', dataScope: 'self', exclusive: false,
    }],
    [COUNTER_OPERATOR_ID, {
      roleId: 'counter-operator', dataScope: 'self', exclusive: false,
    }],
    [PERSONNEL_CLERK_OPERATOR_ID, {
      roleId: 'personnel-clerk', dataScope: 'subordinate', exclusive: true,
    }],
    [MANAGEMENT_OPERATOR_ID, {
      roleId: 'outlet-supervisor', dataScope: 'institution', exclusive: true,
    }],
    [UPPER_MANAGEMENT_OPERATOR_ID, {
      roleId: 'personnel-administrator',
      dataScope: 'subordinate',
      exclusive: true,
    }],
    [ROLE_ADMIN_OPERATOR_ID, {
      roleId: 'role-administrator', dataScope: 'subordinate', exclusive: true,
    }],
  ])

  for (const [operatorId, fixed] of fixedRoles) {
    if (!operators.some((operator) => operator.id === operatorId)) continue
    activateRole(operatorId, fixed.roleId, fixed.dataScope, fixed.exclusive)
  }

  for (const operator of operators) {
    if (fixedRoles.has(operator.id)) continue
    const institutionLevel = ACCESS_INSTITUTIONS.find((institution) => (
      institution.code === operator.profile?.institutionCode
    ))?.level
    if (!institutionLevel || institutionLevel === 'outlet') {
      activateRole(operator.id, 'counter-operator', 'self', false)
    } else {
      stored = stored.map((assignment) => assignment.operatorId === operator.id &&
        assignment.status === 'active' &&
        rolesById.get(assignment.roleId)?.system === 'production'
        ? { ...assignment, status: 'inactive' }
        : assignment)
    }
  }
  return stored
}

function normalizeRequests(value: unknown): PersonnelRequest[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is PersonnelRequest => (
    isRecord(item) &&
    typeof item.id === 'string' &&
    typeof item.kind === 'string' &&
    typeof item.applicantOperatorId === 'string' &&
    typeof item.targetOperatorId === 'string' &&
    typeof item.status === 'string'
  )).map((item) => structuredClone(item))
}

function normalizeAttendance(value: unknown): AttendanceRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is AttendanceRecord => (
    isRecord(item) &&
    typeof item.id === 'string' &&
    typeof item.workDate === 'string' &&
    typeof item.operatorId === 'string' &&
    typeof item.employeeSignedInAt === 'string'
  )).map((item) => structuredClone(item))
}

function normalizeAuditEvents(value: unknown): AccessAuditEvent[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is AccessAuditEvent => (
    isRecord(item) &&
    typeof item.id === 'string' &&
    typeof item.action === 'string' &&
    typeof item.occurredAt === 'string' &&
    typeof item.actorId === 'string'
  )).map((item) => structuredClone(item))
}

function nextSequence(value: unknown, records: Array<{ id: string }>): number {
  const highest = records.reduce((result, record) => {
    const match = /-(\d+)$/.exec(record.id)
    return Math.max(result, match ? Number(match[1]) : 0)
  }, 0)
  return Math.max(Number.isInteger(value) ? Number(value) : 1, highest + 1, 1)
}

export function migrateAccessState(current: SimulatorState | unknown): SimulatorState {
  const stored = isRecord(current) ? current : {}
  const storedOperators = Array.isArray(stored.operators) ? stored.operators : []
  const operatorsById = new Map<string, DemoOperator>()
  for (const value of storedOperators) {
    const id = isRecord(value) && typeof value.id === 'string' ? value.id : DEFAULT_OPERATOR_ID
    if (RETIRED_FRAGMENT_OPERATOR_IDS.has(id)) continue
    operatorsById.set(id, normalizeStoredOperator(value, id))
  }

  const storedActiveId = isRecord(stored.operator) && typeof stored.operator.id === 'string'
    ? stored.operator.id
    : DEFAULT_OPERATOR_ID
  const rawActiveId = RETIRED_FRAGMENT_OPERATOR_IDS.has(storedActiveId)
    ? COUNTER_OPERATOR_ID
    : storedActiveId
  const activeOperator = normalizeStoredOperator(
    rawActiveId === storedActiveId ? stored.operator : operatorsById.get(rawActiveId),
    rawActiveId,
  )
  operatorsById.set(activeOperator.id, activeOperator)
  if (!operatorsById.has(DEFAULT_OPERATOR_ID)) {
    operatorsById.set(DEFAULT_OPERATOR_ID, baseOperator(DEFAULT_OPERATOR_ID))
  }
  if (!operatorsById.has(MANAGEMENT_OPERATOR_ID)) {
    operatorsById.set(MANAGEMENT_OPERATOR_ID, baseOperator(MANAGEMENT_OPERATOR_ID))
  }
  if (!operatorsById.has(COUNTER_OPERATOR_ID)) {
    operatorsById.set(COUNTER_OPERATOR_ID, baseOperator(COUNTER_OPERATOR_ID))
  }
  if (!operatorsById.has(PERSONNEL_CLERK_OPERATOR_ID)) {
    operatorsById.set(PERSONNEL_CLERK_OPERATOR_ID, baseOperator(PERSONNEL_CLERK_OPERATOR_ID))
  }
  if (!operatorsById.has(UPPER_MANAGEMENT_OPERATOR_ID)) {
    operatorsById.set(UPPER_MANAGEMENT_OPERATOR_ID, baseOperator(UPPER_MANAGEMENT_OPERATOR_ID))
  }
  if (!operatorsById.has(ROLE_ADMIN_OPERATOR_ID)) {
    operatorsById.set(ROLE_ADMIN_OPERATOR_ID, baseOperator(ROLE_ADMIN_OPERATOR_ID))
  }
  const operators = Array.from(operatorsById.values())
  const normalizedSession = normalizeSession(stored.session)
  const session = normalizedSession && operatorsById.has(normalizedSession.operatorId)
    ? normalizedSession
    : null
  const sessionOperator = session
    ? operators.find((operator) => operator.id === session.operatorId)
    : undefined
  const operator = sessionOperator ?? activeOperator

  const storedSecurityByOperator = isRecord(stored.securityByOperatorId)
    ? stored.securityByOperatorId
    : {}
  const securityByOperatorId: Record<string, AccessSecurityState> = {}
  for (const candidate of operators) {
    securityByOperatorId[candidate.id] = normalizeSecurity(
      candidate.id === activeOperator.id && storedActiveId === activeOperator.id
        ? stored.security
        : storedSecurityByOperator[candidate.id],
    )
  }
  const security = securityByOperatorId[operator.id] ?? createEmptyAccessSecurityState()

  const personnelRequests = normalizeRequests(stored.personnelRequests)
  const attendanceRecords = normalizeAttendance(stored.attendanceRecords)
  const accessAuditEvents = normalizeAuditEvents(stored.accessAuditEvents)
  const roles = mergeRoles(stored.roles)
  const roleAssignments = normalizeAssignments(stored.roleAssignments, operators, roles)
  const institutions = Array.isArray(stored.institutions)
    ? stored.institutions.filter((item) => isRecord(item) && typeof item.code === 'string')
    : ACCESS_INSTITUTIONS

  const migrated: SimulatorState = {
    schemaVersion: 8,
    operator,
    operators,
    institutions: structuredClone(institutions) as SimulatorState['institutions'],
    roles,
    roleAssignments,
    personnelRequests,
    attendanceRecords,
    accessAuditEvents,
    nextPersonnelRequestSequence: nextSequence(
      stored.nextPersonnelRequestSequence,
      personnelRequests,
    ),
    nextAttendanceSequence: nextSequence(stored.nextAttendanceSequence, attendanceRecords),
    nextAccessAuditSequence: nextSequence(stored.nextAccessAuditSequence, accessAuditEvents),
    security,
    securityByOperatorId,
    session,
  }
  return sanitizePublicProductData(migrated)
}
