import {
  canOperateInstitution,
  hasPermission,
  hasScopedPermission,
  operatorInstitutionCode,
  replaceOperator,
} from './authorization'
import { DEMO_TEMPORARY_SECRET_HASH } from './seed'
import { REQUESTABLE_ROLE_IDS } from './catalog'
import { appendAccessAudit } from './audit'
import type {
  DemoOperator,
  OperatorProfile,
  PersonnelRequest,
  ProposedEmployee,
  SimulatorState,
} from './types'

export type SelfServiceProfilePatch = Pick<OperatorProfile,
  | 'phone'
  | 'receiveSmsType'
  | 'receiveSmsTime'
  | 'responsibleStoreOutlet'
  | 'performanceSourceOutlet'
  | 'performanceEvaluation'
>

function requireProfile(operator: DemoOperator): OperatorProfile {
  if (!operator.profile) throw new Error('人员资料尚未完成，不能执行该操作。')
  return operator.profile
}

function validatePhone(phone: string): void {
  if (!/^1\d{10}$/.test(phone.trim())) throw new Error('手机号码须为 11 位号码。')
}

function validateIdentityCode(identityCode: string): void {
  if (!/^\d{17}[\dXx]$/.test(identityCode.trim())) {
    throw new Error('人员身份证须为 18 位证件号码。')
  }
}

function ensureUniqueContact(
  state: SimulatorState,
  operatorId: string,
  phone: string,
  identityCode?: string,
): void {
  if (state.operators.some((operator) => (
    operator.id !== operatorId && operator.boundMobile === phone.trim()
  ))) throw new Error('手机号码已经绑定其他员工。')
  if (identityCode && state.operators.some((operator) => (
    operator.id !== operatorId && operator.profile?.identityCode.toLocaleUpperCase() === identityCode.trim().toLocaleUpperCase()
  ))) throw new Error('人员身份证已经登记。')
}

export function updateSelfServiceProfile(
  state: SimulatorState,
  patch: SelfServiceProfilePatch,
  occurredAt: string,
): SimulatorState {
  validatePhone(patch.phone)
  ensureUniqueContact(state, state.operator.id, patch.phone)
  const profile = requireProfile(state.operator)
  const updatedOperator: DemoOperator = {
    ...state.operator,
    boundMobile: patch.phone.trim(),
    profile: {
      ...profile,
      ...patch,
      phone: patch.phone.trim(),
      receiveSmsTime: patch.receiveSmsTime.trim(),
      responsibleStoreOutlet: patch.responsibleStoreOutlet.trim(),
      performanceSourceOutlet: patch.performanceSourceOutlet.trim(),
      performanceEvaluation: patch.performanceEvaluation.trim(),
    },
  }
  return appendAccessAudit(
    replaceOperator(state, updatedOperator),
    'personal-profile-updated',
    occurredAt,
    state.operator.id,
    state.operator.id,
    '员工通过个人设置维护联系与通知信息。',
  )
}

function createRequest(
  state: SimulatorState,
  request: Omit<PersonnelRequest, 'id' | 'status' | 'submittedAt' | 'reviewedAt' | 'reviewedBy' | 'reviewComment'>,
  submittedAt: string,
): SimulatorState {
  const sequence = state.nextPersonnelRequestSequence
  const record: PersonnelRequest = {
    ...request,
    id: `PERSON-${String(sequence).padStart(6, '0')}`,
    status: 'pending',
    submittedAt,
    reviewedAt: null,
    reviewedBy: null,
    reviewComment: '',
  }
  return appendAccessAudit({
    ...state,
    nextPersonnelRequestSequence: sequence + 1,
    personnelRequests: [...state.personnelRequests, record],
  }, 'personnel-request-submitted', submittedAt, request.applicantOperatorId, record.id, request.reason)
}

export function submitRoleRequest(
  state: SimulatorState,
  requestedRoleId: string,
  reason: string,
  submittedAt: string,
  targetOperatorId = state.operator.id,
): SimulatorState {
  if (!hasPermission(state, 'management.permission.request', state.operator.id) &&
      !hasPermission(state, 'management.basic.personnel', state.operator.id)) {
    throw new Error('没有岗位与权限申请权限。')
  }
  if (!state.roles.some((role) => role.id === requestedRoleId && role.status === 'active')) {
    throw new Error('申请的角色不存在或已经停用。')
  }
  if (!REQUESTABLE_ROLE_IDS.includes(
    requestedRoleId as typeof REQUESTABLE_ROLE_IDS[number],
  )) {
    throw new Error('该管理岗位不能通过个人权限申请取得。')
  }
  if (!state.operators.some((operator) => operator.id === targetOperatorId)) {
    throw new Error('申请人员不存在。')
  }
  const targetInstitutionCode = operatorInstitutionCode(state, targetOperatorId)
  if (targetOperatorId !== state.operator.id && !hasScopedPermission(
    state,
    'management.basic.personnel',
    targetOperatorId,
    targetInstitutionCode,
  )) throw new Error('不能为管辖范围外的人员申请专项权限。')
  if (state.roleAssignments.some((assignment) => (
    assignment.operatorId === targetOperatorId &&
    assignment.roleId === requestedRoleId &&
    assignment.status === 'active'
  ))) throw new Error('该人员已经具备此角色。')
  if (state.personnelRequests.some((request) => (
    request.kind === 'role-change' &&
    request.targetOperatorId === targetOperatorId &&
    request.requestedRoleId === requestedRoleId &&
    request.status === 'pending'
  ))) throw new Error('相同角色申请已经在审批中。')
  if (!reason.trim()) throw new Error('请填写权限申请原因。')
  return createRequest(state, {
    kind: 'role-change',
    applicantOperatorId: state.operator.id,
    targetOperatorId,
    requestedRoleId,
    proposedProfile: null,
    proposedEmployee: null,
    reason: reason.trim(),
  }, submittedAt)
}

export function submitProfileChangeRequest(
  state: SimulatorState,
  targetOperatorId: string,
  proposedProfile: OperatorProfile,
  reason: string,
  submittedAt: string,
): SimulatorState {
  if (!hasPermission(state, 'management.basic.personnel')) {
    throw new Error('没有人员资料维护权限。')
  }
  if (!state.operators.some((operator) => operator.id === targetOperatorId)) {
    throw new Error('待修改人员不存在。')
  }
  if (!hasScopedPermission(
    state,
    'management.basic.personnel',
    targetOperatorId,
    proposedProfile.institutionCode,
  )) throw new Error('不能修改管辖范围外的人员资料。')
  validatePhone(proposedProfile.phone)
  validateIdentityCode(proposedProfile.identityCode)
  ensureUniqueContact(state, targetOperatorId, proposedProfile.phone, proposedProfile.identityCode)
  if (!reason.trim()) throw new Error('请填写人员资料变更原因。')
  return createRequest(state, {
    kind: 'profile-change',
    applicantOperatorId: state.operator.id,
    targetOperatorId,
    requestedRoleId: null,
    proposedProfile: structuredClone(proposedProfile),
    proposedEmployee: null,
    reason: reason.trim(),
  }, submittedAt)
}

export function submitDeactivationRequest(
  state: SimulatorState,
  targetOperatorId: string,
  reason: string,
  submittedAt: string,
): SimulatorState {
  if (!hasPermission(state, 'management.basic.personnel')) {
    throw new Error('没有人员停用申请权限。')
  }
  const target = state.operators.find((operator) => operator.id === targetOperatorId)
  if (!target) throw new Error('待停用人员不存在。')
  if (!hasScopedPermission(
    state,
    'management.basic.personnel',
    targetOperatorId,
    operatorInstitutionCode(state, targetOperatorId),
  )) throw new Error('不能停用管辖范围外的人员。')
  if (target.accountStatus === 'disabled') throw new Error('该人员账户已经停用。')
  if (target.id === state.operator.id) throw new Error('不能提交停用本人账户的申请。')
  if (!reason.trim()) throw new Error('请填写人员停用原因。')
  return createRequest(state, {
    kind: 'deactivation',
    applicantOperatorId: state.operator.id,
    targetOperatorId,
    requestedRoleId: null,
    proposedProfile: null,
    proposedEmployee: null,
    reason: reason.trim(),
  }, submittedAt)
}

export function submitNewEmployeeRequest(
  state: SimulatorState,
  proposedEmployee: ProposedEmployee,
  reason: string,
  submittedAt: string,
): SimulatorState {
  if (!hasPermission(state, 'management.basic.personnel')) {
    throw new Error('没有新增人员申请权限。')
  }
  if (!/^\d{8}$/.test(proposedEmployee.id)) throw new Error('员工工号须为 8 位数字。')
  if (state.operators.some((operator) => operator.id === proposedEmployee.id)) {
    throw new Error('员工工号已经存在。')
  }
  validatePhone(proposedEmployee.boundMobile)
  if (proposedEmployee.profile.phone.trim() !== proposedEmployee.boundMobile.trim()) {
    throw new Error('登录手机号必须与人员资料手机号一致。')
  }
  validateIdentityCode(proposedEmployee.profile.identityCode)
  ensureUniqueContact(
    state,
    proposedEmployee.id,
    proposedEmployee.boundMobile,
    proposedEmployee.profile.identityCode,
  )
  if (!proposedEmployee.profile.displayName.trim()) throw new Error('请填写员工姓名。')
  if (!state.institutions.some((institution) => (
    institution.code === proposedEmployee.profile.institutionCode && institution.status === 'active'
  ))) throw new Error('所属机构不存在或已经停用。')
  if (!canOperateInstitution(
    state,
    'management.basic.personnel',
    proposedEmployee.profile.institutionCode,
  )) throw new Error('不能在管辖范围外新增人员。')
  if (state.personnelRequests.some((request) => (
    request.kind === 'new-employee' &&
    request.status === 'pending' &&
    (request.targetOperatorId === proposedEmployee.id ||
      request.proposedEmployee?.boundMobile === proposedEmployee.boundMobile ||
      request.proposedEmployee?.profile.identityCode.toLocaleUpperCase() ===
        proposedEmployee.profile.identityCode.toLocaleUpperCase())
  ))) throw new Error('相同人员的新增申请已经在审批中。')
  if (!reason.trim()) throw new Error('请填写新增人员原因。')
  return createRequest(state, {
    kind: 'new-employee',
    applicantOperatorId: state.operator.id,
    targetOperatorId: proposedEmployee.id,
    requestedRoleId: 'counter-operator',
    proposedProfile: null,
    proposedEmployee: structuredClone(proposedEmployee),
    reason: reason.trim(),
  }, submittedAt)
}

function nextAssignmentId(state: SimulatorState): string {
  const highest = state.roleAssignments.reduce((result, assignment) => {
    const match = /-(\d+)$/.exec(assignment.id)
    return Math.max(result, match ? Number(match[1]) : 0)
  }, 0)
  return `ROLE-ASG-${String(highest + 1).padStart(6, '0')}`
}

function applyApprovedRequest(state: SimulatorState, request: PersonnelRequest, reviewedAt: string): SimulatorState {
  if (request.kind === 'role-change' && request.requestedRoleId) {
    const target = state.operators.find((operator) => operator.id === request.targetOperatorId)
    if (!target) throw new Error('申请人员不存在，无法批准。')
    if (state.roleAssignments.some((assignment) => (
      assignment.operatorId === target.id &&
      assignment.roleId === request.requestedRoleId &&
      assignment.status === 'active'
    ))) return state
    const next: SimulatorState = {
      ...state,
      roleAssignments: [...state.roleAssignments, {
        id: nextAssignmentId(state),
        operatorId: target.id,
        roleId: request.requestedRoleId,
        institutionCode: target.profile?.institutionCode ?? '99901001',
        dataScope: 'self',
        status: 'active',
        assignedAt: reviewedAt,
        assignedBy: state.operator.id,
      }],
    }
    return next
  }
  if (request.kind === 'profile-change' && request.proposedProfile) {
    const target = state.operators.find((operator) => operator.id === request.targetOperatorId)
    if (!target) throw new Error('待修改人员不存在，无法批准。')
    return replaceOperator(state, {
      ...target,
      boundMobile: request.proposedProfile.phone,
      profileCompleted: true,
      profile: structuredClone(request.proposedProfile),
    })
  }
  if (request.kind === 'deactivation') {
    const target = state.operators.find((operator) => operator.id === request.targetOperatorId)
    if (!target) throw new Error('待停用人员不存在，无法批准。')
    return replaceOperator(state, {
      ...target,
      accountStatus: 'disabled',
      profile: target.profile ? { ...target.profile, personnelStatus: 'leave' } : null,
    })
  }
  if (request.kind === 'new-employee' && request.proposedEmployee) {
    if (state.operators.some((operator) => operator.id === request.proposedEmployee?.id)) {
      throw new Error('员工工号已经存在，无法批准。')
    }
    const operator: DemoOperator = {
      id: request.proposedEmployee.id,
      boundMobile: request.proposedEmployee.boundMobile,
      secretHash: DEMO_TEMPORARY_SECRET_HASH,
      secretHistoryHashes: [DEMO_TEMPORARY_SECRET_HASH],
      accountStatus: 'active',
      profileCompleted: true,
      requiresSecretChange: true,
      requiresWorkstation: request.proposedEmployee.requiresWorkstation,
      profile: structuredClone(request.proposedEmployee.profile),
    }
    const withOperator = replaceOperator(state, operator)
    return {
      ...withOperator,
      roleAssignments: [...withOperator.roleAssignments, {
        id: nextAssignmentId(withOperator),
        operatorId: operator.id,
        roleId: 'counter-operator',
        institutionCode: operator.profile?.institutionCode ?? '99901001',
        dataScope: 'self',
        status: 'active',
        assignedAt: reviewedAt,
        assignedBy: state.operator.id,
      }],
      securityByOperatorId: {
        ...withOperator.securityByOperatorId,
        [operator.id]: {
          failedSecretAttempts: 0,
          lockedAt: null,
          nextEventSequence: 1,
          events: [],
        },
      },
    }
  }
  throw new Error('该申请缺少可执行的变更内容。')
}

export function reviewPersonnelRequest(
  state: SimulatorState,
  requestId: string,
  decision: 'approved' | 'rejected',
  reviewComment: string,
  reviewedAt: string,
): SimulatorState {
  const request = state.personnelRequests.find((candidate) => candidate.id === requestId)
  if (!request) throw new Error('人员申请不存在。')
  const approvalPermission = request.kind === 'role-change'
    ? 'management.business.role-approval' as const
    : 'management.business.personnel-approval' as const
  if (!hasPermission(state, approvalPermission)) {
    throw new Error(request.kind === 'role-change'
      ? '没有岗位角色审批权限。'
      : '没有人员审批权限。')
  }
  if (request.status !== 'pending') throw new Error('该人员申请已经处理。')
  if (request.applicantOperatorId === state.operator.id) {
    throw new Error('申请人不能审批自己提交的申请。')
  }
  const targetInstitutionCode = request.proposedEmployee?.profile.institutionCode ??
    request.proposedProfile?.institutionCode ??
    operatorInstitutionCode(state, request.targetOperatorId)
  if (!hasScopedPermission(
    state,
    approvalPermission,
    request.targetOperatorId,
    targetInstitutionCode,
  )) throw new Error('不能审批管辖范围外的人员申请。')
  if (!reviewComment.trim()) throw new Error('请填写审批意见。')
  let next = decision === 'approved'
    ? applyApprovedRequest(state, request, reviewedAt)
    : state
  next = {
    ...next,
    personnelRequests: next.personnelRequests.map((candidate) => candidate.id === requestId
      ? {
        ...candidate,
        status: decision,
        reviewedAt,
        reviewedBy: state.operator.id,
        reviewComment: reviewComment.trim(),
      }
      : candidate),
  }
  return appendAccessAudit(
    next,
    decision === 'approved' ? 'personnel-request-approved' : 'personnel-request-rejected',
    reviewedAt,
    state.operator.id,
    requestId,
    reviewComment.trim(),
  )
}
