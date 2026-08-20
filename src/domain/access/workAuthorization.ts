import { appendAccessAudit } from './audit'
import {
  canOperateInstitution,
  hasPermission,
} from './authorization'
import { projectEmployeeDuty } from './attendance'
import { secretMatches } from './policy'
import type { DemoOperator, SimulatorState } from './types'

export type OnSiteAuthorizationAction =
  | 'withdraw-service-transaction'
  | 'delete-channel-product-order'
  | 'delete-postal-supply-sale'
  | 'delete-supplementary-traffic'
  | 'export-dispatch-trip'
  | 'red-flush-invoice'
  | 'adjust-postage-meter-reading'
  | 'count-postal-supply-inventory'
  | 'complete-third-party-refund'
  | 'complete-special-handling-refund'
  | 'create-window-delivery-supplement'
  | 'view-accepted-mail-private-data'

const onSiteAuthorizationBrand = Symbol('on-site-authorization')
const internalHandoverAuthorizationBrand = Symbol('internal-handover-authorization')
const dispatchRelationManagementAuthorizationBrand = Symbol(
  'dispatch-relation-management-authorization',
)
const usedOnSiteAuthorizations = new WeakSet<object>()
const usedInternalHandoverAuthorizations = new WeakSet<object>()
const usedDispatchRelationAuthorizations = new WeakSet<object>()

export interface OnSiteAuthorization {
  readonly id: string
  readonly action: OnSiteAuthorizationAction
  readonly requestedBy: string
  readonly authorizerId: string
  readonly authorizerName: string
  readonly institutionCode: string
  readonly issuedAt: string
  readonly [onSiteAuthorizationBrand]: true
}

export interface InternalHandoverAuthorization {
  readonly id: string
  readonly requestedBy: string
  readonly receiverId: string
  readonly receiverName: string
  readonly institutionCode: string
  readonly issuedAt: string
  readonly [internalHandoverAuthorizationBrand]: true
}

export interface DispatchRelationManagementAuthorization {
  readonly id: string
  readonly operatorId: string
  readonly institutionCode: string
  readonly issuedAt: string
  readonly [dispatchRelationManagementAuthorizationBrand]: true
}

export interface OnSiteAuthorizationRequest {
  action: OnSiteAuthorizationAction
  authorizerId: string
  secret: string
  institutionCode: string
  occurredAt: string
}

export interface InternalHandoverAuthorizationRequest {
  receiverId: string
  secret: string
  institutionCode: string
  occurredAt: string
}

export interface WorkAuthorizationResult<Authorization> {
  state: SimulatorState
  authorization: Authorization
}

export type RequestOnSiteAuthorization = (
  action: OnSiteAuthorizationAction,
  authorizerId: string,
  secret: string,
  occurredAt: string,
) => Promise<OnSiteAuthorization>

function currentRequester(state: SimulatorState): DemoOperator {
  if (!state.session || state.session.operatorId !== state.operator.id) {
    throw new Error('请先由当前经办人员登录系统。')
  }
  if (state.operator.accountStatus !== 'active') {
    throw new Error('当前经办人员账号已停用。')
  }
  return state.operator
}

function activeOperator(state: SimulatorState, operatorId: string, label: string): DemoOperator {
  const operator = state.operators.find((candidate) => candidate.id === operatorId.trim())
  if (!operator) throw new Error(`${label}工号不存在。`)
  if (operator.accountStatus !== 'active') throw new Error(`${label}账号已停用。`)
  if (!operator.profileCompleted || !operator.profile) throw new Error(`${label}资料尚未完整。`)
  if (state.securityByOperatorId[operator.id]?.lockedAt) throw new Error(`${label}账号已锁定。`)
  return operator
}

function requiredTimestamp(value: string): string {
  if (!value || Number.isNaN(Date.parse(value))) throw new Error('授权时间无效。')
  return value
}

function authorizationId(prefix: string, state: SimulatorState): string {
  return `${prefix}-${String(state.nextAccessAuditSequence).padStart(6, '0')}`
}

export async function authorizeOnSiteAction(
  state: SimulatorState,
  request: OnSiteAuthorizationRequest,
): Promise<WorkAuthorizationResult<OnSiteAuthorization>> {
  const requester = currentRequester(state)
  const issuedAt = requiredTimestamp(request.occurredAt)
  const institutionCode = request.institutionCode.trim()
  if (!institutionCode) throw new Error('当前经办机构无效。')
  const authorizer = activeOperator(state, request.authorizerId, '授权人员')
  if (authorizer.id === requester.id) {
    throw new Error('现场授权必须由另一名有权人员确认。')
  }
  if (!hasPermission(state, 'management.business.on-site-authorization', authorizer.id) ||
      !canOperateInstitution(
        state,
        'management.business.on-site-authorization',
        institutionCode,
        authorizer.id,
      )) {
    throw new Error('该账号没有当前机构的现场授权权限。')
  }
  if (!(await secretMatches(request.secret, authorizer.secretHash))) {
    throw new Error('授权人员密码校验失败。')
  }

  const authorization: OnSiteAuthorization = Object.freeze({
    id: authorizationId('SITE-AUTH', state),
    action: request.action,
    requestedBy: requester.id,
    authorizerId: authorizer.id,
    authorizerName: authorizer.profile?.displayName ?? authorizer.id,
    institutionCode,
    issuedAt,
    [onSiteAuthorizationBrand]: true as const,
  })
  return {
    authorization,
    state: appendAccessAudit(
      state,
      'on-site-action-authorized',
      issuedAt,
      authorizer.id,
      `${request.action}:${requester.id}:${institutionCode}`,
      `${authorizer.profile?.displayName ?? authorizer.id}现场授权${requester.profile?.displayName ?? requester.id}执行${request.action}。`,
    ),
  }
}

export function requireOnSiteAuthorization(
  authorization: OnSiteAuthorization | undefined,
  action: OnSiteAuthorizationAction,
  requestedBy: string,
  institutionCode?: string,
): OnSiteAuthorization {
  if (
    authorization?.[onSiteAuthorizationBrand] !== true ||
    authorization.action !== action ||
    authorization.requestedBy !== requestedBy ||
    (institutionCode !== undefined && authorization.institutionCode !== institutionCode)
  ) {
    throw new Error('本次操作需要有权人员使用真实账号现场授权。')
  }
  if (usedOnSiteAuthorizations.has(authorization)) {
    throw new Error('本次现场授权已经使用，请由有权人员重新现场授权。')
  }
  usedOnSiteAuthorizations.add(authorization)
  return authorization
}

export function eligibleInternalHandoverReceivers(
  state: SimulatorState,
  institutionCode: string,
  occurredAt: string,
): DemoOperator[] {
  const requester = currentRequester(state)
  return state.operators.filter((operator) => (
    operator.id !== requester.id &&
    operator.accountStatus === 'active' &&
    operator.profileCompleted &&
    operator.profile?.institutionCode === institutionCode &&
    hasPermission(state, 'workspace.channel.dispatch.handover-in', operator.id) &&
    projectEmployeeDuty(state, occurredAt, operator.id).status === 'on-duty'
  ))
}

export async function authorizeInternalHandoverReceiver(
  state: SimulatorState,
  request: InternalHandoverAuthorizationRequest,
): Promise<WorkAuthorizationResult<InternalHandoverAuthorization>> {
  const requester = currentRequester(state)
  const issuedAt = requiredTimestamp(request.occurredAt)
  const institutionCode = request.institutionCode.trim()
  const receiver = activeOperator(state, request.receiverId, '接收员工')
  if (receiver.id === requester.id) throw new Error('交出人与接收员工不能是同一人。')
  if (receiver.profile?.institutionCode !== institutionCode) {
    throw new Error('接收员工不属于当前机构。')
  }
  if (!hasPermission(state, 'workspace.channel.dispatch.handover-in', receiver.id)) {
    throw new Error('接收员工没有邮件接收权限。')
  }
  if (projectEmployeeDuty(state, issuedAt, receiver.id).status !== 'on-duty') {
    throw new Error('接收员工当前未签到在岗。')
  }
  if (!(await secretMatches(request.secret, receiver.secretHash))) {
    throw new Error('接收员工密码校验失败。')
  }

  const authorization: InternalHandoverAuthorization = Object.freeze({
    id: authorizationId('HANDOVER-AUTH', state),
    requestedBy: requester.id,
    receiverId: receiver.id,
    receiverName: receiver.profile?.displayName ?? receiver.id,
    institutionCode,
    issuedAt,
    [internalHandoverAuthorizationBrand]: true as const,
  })
  return {
    authorization,
    state: appendAccessAudit(
      state,
      'internal-handover-authorized',
      issuedAt,
      receiver.id,
      `${requester.id}:${institutionCode}`,
      `${receiver.profile?.displayName ?? receiver.id}现场确认接收${requester.profile?.displayName ?? requester.id}交出的邮件。`,
    ),
  }
}

export function requireInternalHandoverAuthorization(
  authorization: InternalHandoverAuthorization | undefined,
  requestedBy: string,
  receiverId: string,
  institutionCode: string,
): InternalHandoverAuthorization {
  if (
    authorization?.[internalHandoverAuthorizationBrand] !== true ||
    authorization.requestedBy !== requestedBy ||
    authorization.receiverId !== receiverId ||
    authorization.institutionCode !== institutionCode
  ) {
    throw new Error('本局交接必须由所选接收员工使用真实账号现场确认。')
  }
  if (usedInternalHandoverAuthorizations.has(authorization)) {
    throw new Error('本次接收确认已经使用，请由接收员工重新现场确认。')
  }
  usedInternalHandoverAuthorizations.add(authorization)
  return authorization
}

export function authorizeDispatchRelationManagement(
  state: SimulatorState,
  institutionCode: string,
  occurredAt: string,
): WorkAuthorizationResult<DispatchRelationManagementAuthorization> {
  const operator = currentRequester(state)
  const issuedAt = requiredTimestamp(occurredAt)
  const targetInstitutionCode = institutionCode.trim()
  if (!targetInstitutionCode || !canOperateInstitution(
    state,
    'management.basic.dispatch-relations',
    targetInstitutionCode,
    operator.id,
  )) {
    throw new Error('当前账号没有目标机构的封发关系管理权限。')
  }
  const authorization: DispatchRelationManagementAuthorization = Object.freeze({
    id: authorizationId('RELATION-AUTH', state),
    operatorId: operator.id,
    institutionCode: targetInstitutionCode,
    issuedAt,
    [dispatchRelationManagementAuthorizationBrand]: true as const,
  })
  return {
    authorization,
    state: appendAccessAudit(
      state,
      'dispatch-relation-management-authorized',
      issuedAt,
      operator.id,
      targetInstitutionCode,
      `${operator.profile?.displayName ?? operator.id}确认保存机构 ${targetInstitutionCode} 的封发关系。`,
    ),
  }
}

export function requireDispatchRelationManagementAuthorization(
  authorization: DispatchRelationManagementAuthorization | undefined,
  operatorId: string,
  institutionCode: string,
): DispatchRelationManagementAuthorization {
  if (
    authorization?.[dispatchRelationManagementAuthorizationBrand] !== true ||
    authorization.operatorId !== operatorId ||
    authorization.institutionCode !== institutionCode
  ) {
    throw new Error('封发关系只能由已登录的上级基础管理人员维护。')
  }
  if (usedDispatchRelationAuthorizations.has(authorization)) {
    throw new Error('本次封发关系维护授权已经使用，请重新确认保存。')
  }
  usedDispatchRelationAuthorizations.add(authorization)
  return authorization
}
