import { createEmptyAccessSecurityState } from './migration'
import type {
  AccessPermission,
  AccessRole,
  DemoOperator,
  SimulatorState,
} from './types'

export function synchronizeActiveIdentity(state: SimulatorState): SimulatorState {
  const operators = state.operators.some((operator) => operator.id === state.operator.id)
    ? state.operators.map((operator) => operator.id === state.operator.id
      ? structuredClone(state.operator)
      : structuredClone(operator))
    : [...state.operators.map((operator) => structuredClone(operator)), structuredClone(state.operator)]
  return {
    ...state,
    operators,
    securityByOperatorId: {
      ...state.securityByOperatorId,
      [state.operator.id]: structuredClone(state.security),
    },
  }
}

export function selectActiveOperator(
  state: SimulatorState,
  operatorId: string,
): SimulatorState {
  const synchronized = synchronizeActiveIdentity(state)
  const operator = synchronized.operators.find((candidate) => candidate.id === operatorId)
  if (!operator) throw new Error('演示账户不存在。')
  return {
    ...synchronized,
    operator: structuredClone(operator),
    security: structuredClone(
      synchronized.securityByOperatorId[operatorId] ?? createEmptyAccessSecurityState(),
    ),
    session: synchronized.session?.operatorId === operatorId
      ? synchronized.session
      : null,
  }
}

export function findOperatorByIdentifier(
  state: SimulatorState,
  identifier: string,
): DemoOperator | null {
  const normalized = identifier.trim()
  return state.operators.find((operator) => (
    operator.id === normalized || operator.boundMobile === normalized
  )) ?? null
}

export function replaceOperator(
  state: SimulatorState,
  operator: DemoOperator,
): SimulatorState {
  const operators = state.operators.some((candidate) => candidate.id === operator.id)
    ? state.operators.map((candidate) => candidate.id === operator.id
      ? structuredClone(operator)
      : candidate)
    : [...state.operators, structuredClone(operator)]
  return {
    ...state,
    operator: state.operator.id === operator.id ? structuredClone(operator) : state.operator,
    operators,
  }
}

export function effectiveRoles(
  state: SimulatorState,
  operatorId = state.operator.id,
): AccessRole[] {
  const roleIds = new Set(state.roleAssignments
    .filter((assignment) => assignment.operatorId === operatorId && assignment.status === 'active')
    .map((assignment) => assignment.roleId))
  return state.roles.filter((role) => role.status === 'active' && roleIds.has(role.id))
}

export function effectivePermissions(
  state: SimulatorState,
  operatorId = state.operator.id,
): Set<AccessPermission> {
  return new Set(effectiveRoles(state, operatorId).flatMap((role) => role.permissions))
}

export function hasPermission(
  state: SimulatorState,
  permission: AccessPermission,
  operatorId = state.operator.id,
): boolean {
  return effectivePermissions(state, operatorId).has(permission)
}

export function roleNamesForOperator(
  state: SimulatorState,
  operatorId: string,
): string[] {
  return effectiveRoles(state, operatorId).map((role) => role.name)
}

export function operatorInstitutionCode(
  state: SimulatorState,
  operatorId: string,
): string {
  return state.operators.find((operator) => operator.id === operatorId)?.profile?.institutionCode ??
    state.roleAssignments.find((assignment) => (
      assignment.operatorId === operatorId && assignment.status === 'active'
    ))?.institutionCode ?? ''
}

function assignmentsForPermission(
  state: SimulatorState,
  permission: AccessPermission,
  operatorId: string,
) {
  const roleIds = new Set(state.roles
    .filter((role) => role.status === 'active' && role.permissions.includes(permission))
    .map((role) => role.id))
  return state.roleAssignments.filter((assignment) => (
    assignment.operatorId === operatorId &&
    assignment.status === 'active' &&
    roleIds.has(assignment.roleId)
  ))
}

function institutionCodesAtOrBelow(
  state: SimulatorState,
  rootCode: string,
): Set<string> {
  const result = new Set<string>([rootCode])
  let changed = true
  while (changed) {
    changed = false
    for (const institution of state.institutions) {
      if (institution.parentCode && result.has(institution.parentCode) && !result.has(institution.code)) {
        result.add(institution.code)
        changed = true
      }
    }
  }
  return result
}

export function accessibleInstitutionCodes(
  state: SimulatorState,
  permission: AccessPermission,
  operatorId = state.operator.id,
): Set<string> {
  const result = new Set<string>()
  const operatorInstitution = operatorInstitutionCode(state, operatorId)
  for (const assignment of assignmentsForPermission(state, permission, operatorId)) {
    if (assignment.dataScope === 'subordinate') {
      for (const code of institutionCodesAtOrBelow(state, assignment.institutionCode)) result.add(code)
    } else if (assignment.dataScope === 'institution') {
      result.add(assignment.institutionCode)
    } else if (operatorInstitution) {
      result.add(operatorInstitution)
    }
  }
  return result
}

export function hasScopedPermission(
  state: SimulatorState,
  permission: AccessPermission,
  targetOperatorId: string,
  institutionCode: string,
  operatorId = state.operator.id,
): boolean {
  return assignmentsForPermission(state, permission, operatorId).some((assignment) => {
    if (assignment.dataScope === 'self') return targetOperatorId === operatorId
    if (assignment.dataScope === 'institution') return institutionCode === assignment.institutionCode
    return institutionCodesAtOrBelow(state, assignment.institutionCode).has(institutionCode)
  })
}

export function canOperateInstitution(
  state: SimulatorState,
  permission: AccessPermission,
  institutionCode: string,
  operatorId = state.operator.id,
): boolean {
  return assignmentsForPermission(state, permission, operatorId).some((assignment) => {
    if (assignment.dataScope === 'self') return false
    if (assignment.dataScope === 'institution') return institutionCode === assignment.institutionCode
    return institutionCodesAtOrBelow(state, assignment.institutionCode).has(institutionCode)
  })
}
