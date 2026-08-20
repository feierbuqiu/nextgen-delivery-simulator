import {
  canOperateInstitution,
  hasScopedPermission,
} from './authorization'
import type {
  AccessAuditEvent,
  AttendanceRecord,
  SimulatorState,
} from './types'
import { appendAccessAudit } from './audit'
import { EAST_EIGHT_TIME_ZONE } from '../shared/businessTime'
import { secretMatches } from './policy'

export { EAST_EIGHT_TIME_ZONE }

export type InstitutionAttendancePeriodKey = 'manual'

export interface InstitutionAttendancePeriod {
  key: InstitutionAttendancePeriodKey
  label: string
  scheduledSignedInAt: string
  scheduledSignedOutAt: string
  signedInAt: string | null
  signedInBy: string
  signedOutAt: string | null
  source: 'manual'
}

export interface InstitutionAttendanceProjection {
  workDate: string
  isWorkday: boolean
  periods: InstitutionAttendancePeriod[]
  focusPeriod: InstitutionAttendancePeriod | null
  activePeriod: InstitutionAttendancePeriod | null
  status: 'non-working-day' | 'not-signed-in' | 'signed-in' | 'signed-out'
  statusLabel: string
  hasSupervisorSignOut: boolean
}

export type EmployeeDutyStatus =
  | 'on-duty'
  | 'not-signed-in'
  | 'signed-out'
  | 'institution-closed'
  | 'previous-period-open'

export interface EmployeeDutyProjection {
  workDate: string
  status: EmployeeDutyStatus
  statusLabel: string
  attendance: AttendanceRecord | null
  institution: InstitutionAttendanceProjection
}

const attendanceAuthorizationBrand = Symbol('attendance-authorization')

export interface AttendanceAuthorization {
  readonly actorId: string
  readonly [attendanceAuthorizationBrand]: true
}

export async function authorizeAttendanceAction(
  state: SimulatorState,
  secret: string,
): Promise<AttendanceAuthorization> {
  if (!state.session || state.session.operatorId !== state.operator.id) {
    throw new Error('请先由当前人员登录系统。')
  }
  if (!(await secretMatches(secret, state.operator.secretHash))) {
    throw new Error('当前登录密码校验失败。')
  }
  return Object.freeze({
    actorId: state.operator.id,
    [attendanceAuthorizationBrand]: true as const,
  })
}

function requireAttendanceAuthorization(
  state: SimulatorState,
  actorId: string,
  authorization: AttendanceAuthorization,
): void {
  if (
    authorization?.[attendanceAuthorizationBrand] !== true
    || authorization.actorId !== actorId
    || state.session?.operatorId !== actorId
  ) {
    throw new Error('签到签退必须由当前登录人员重新验证密码后手工确认。')
  }
}

function eastEightParts(value: Date): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: EAST_EIGHT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value).map((part) => [part.type, part.value]))
}

export function localWorkDate(value: Date): string {
  const parts = eastEightParts(value)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function institutionAuditTarget(
  institutionCode: string,
  workDate: string,
  period: InstitutionAttendancePeriodKey,
): string {
  return `${institutionCode}:${workDate}:${period}`
}

function institutionAttendanceEvents(
  state: SimulatorState,
  institutionCode: string,
  occurredAt: string,
): AccessAuditEvent[] {
  const prefix = `${institutionCode}:`
  const timestamp = Date.parse(occurredAt)
  return state.accessAuditEvents.filter((event) => (
    event.targetId.startsWith(prefix) &&
    (event.action === 'institution-signed-in' ||
      event.action === 'institution-signed-out' ||
      event.action === 'institution-sign-out-cancelled') &&
    Date.parse(event.occurredAt) <= timestamp
  )).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
}

export function projectInstitutionAttendance(
  state: SimulatorState,
  institutionCode: string,
  workDate: string,
  occurredAt = new Date().toISOString(),
): InstitutionAttendanceProjection {
  const now = Date.parse(occurredAt)
  const validWorkDate = /^\d{4}-\d{2}-\d{2}$/.test(workDate)
  if (!validWorkDate || Number.isNaN(now)) {
    return {
      workDate,
      isWorkday: false,
      periods: [],
      focusPeriod: null,
      activePeriod: null,
      status: 'non-working-day',
      statusLabel: '日期无效',
      hasSupervisorSignOut: false,
    }
  }

  const lifecycleEvents = institutionAttendanceEvents(state, institutionCode, occurredAt)
  const events = workDate === localWorkDate(new Date(occurredAt))
    ? lifecycleEvents
    : lifecycleEvents.filter((event) => event.targetId.startsWith(`${institutionCode}:${workDate}:`))
  const latestEvent = events.at(-1) ?? null
  const latestCycleEvents = latestEvent
    ? events.filter((event) => event.targetId === latestEvent.targetId)
    : []
  const latestCycleEvent = latestCycleEvents.at(-1) ?? null
  const latestSignIn = latestCycleEvents.slice().reverse().find((event) => (
    event.action === 'institution-signed-in'
  )) ?? null
  const signedOutAt = latestCycleEvent?.action === 'institution-signed-out'
    ? latestCycleEvent.occurredAt
    : null
  const period: InstitutionAttendancePeriod | null = latestSignIn ? {
    key: 'manual',
    label: '本次营业',
    scheduledSignedInAt: latestSignIn.occurredAt,
    scheduledSignedOutAt: signedOutAt ?? '',
    signedInAt: latestSignIn.occurredAt,
    signedInBy: latestSignIn.actorId,
    signedOutAt,
    source: 'manual',
  } : null
  const activePeriod = period && latestCycleEvent?.action !== 'institution-signed-out'
    ? period
    : null
  const status = activePeriod ? 'signed-in' : period ? 'signed-out' : 'not-signed-in'
  return {
    workDate,
    isWorkday: true,
    periods: period ? [period] : [],
    focusPeriod: period,
    activePeriod,
    status,
    statusLabel: status === 'signed-in'
      ? '机构已人工签到'
      : status === 'signed-out'
        ? '机构已签退'
        : '机构尚未人工签到',
    hasSupervisorSignOut: latestCycleEvent?.action === 'institution-signed-out',
  }
}

/** 机构签到必须由当前已登录且具备考勤操作权限的人员手工确认。 */
export function signInInstitution(
  state: SimulatorState,
  institutionCode: string,
  workDate: string,
  actorId: string,
  occurredAt: string,
  authorization: AttendanceAuthorization,
): SimulatorState {
  requireAttendanceAuthorization(state, actorId, authorization)
  requireInstitutionOperation(state, institutionCode, actorId)
  if (state.session?.operatorId !== actorId) {
    throw new Error('请由当前登录人员本人完成机构签到。')
  }
  if (workDate !== localWorkDate(new Date(occurredAt))) {
    throw new Error('机构签到只能登记东八区当天记录。')
  }
  const projection = projectInstitutionAttendance(state, institutionCode, workDate, occurredAt)
  if (projection.activePeriod) throw new Error('该机构已经人工签到，无需重复办理。')
  return appendAccessAudit(
    state,
    'institution-signed-in',
    occurredAt,
    actorId,
    institutionAuditTarget(institutionCode, workDate, 'manual'),
    '管理人员登录后手工确认机构签到。',
  )
}

/** 员工签到是独立操作；登录系统不会调用本函数。 */
export function signInEmployee(
  state: SimulatorState,
  occurredAt: string,
  workDate: string,
  workstationCode: string,
  authorization: AttendanceAuthorization,
): SimulatorState {
  requireAttendanceAuthorization(state, state.operator.id, authorization)
  if (state.session?.operatorId !== state.operator.id) {
    throw new Error('请先登录系统，再办理员工签到。')
  }
  if (workDate !== localWorkDate(new Date(occurredAt))) {
    throw new Error('员工签到只能登记东八区当天记录。')
  }
  const profile = state.operator.profile
  const institutionCode = profile?.institutionCode ?? '99901001'
  const institutionName = profile?.institutionName ?? '景麓营业部'
  const institutionAttendance = projectInstitutionAttendance(
    state,
    institutionCode,
    workDate,
    occurredAt,
  )
  if (!institutionAttendance.activePeriod) {
    throw new Error('请先由有权限的管理人员完成机构人工签到。')
  }
  if (institutionAttendance.activePeriod.signedInBy === state.operator.id) {
    throw new Error('机构签到与员工签到必须由不同工号分别手工确认。')
  }
  const openRecord = state.attendanceRecords.slice().reverse().find((record) => (
    record.operatorId === state.operator.id &&
    record.employeeSignedOutAt === null
  ))
  if (openRecord?.institutionSignedInAt === institutionAttendance.activePeriod.signedInAt) {
    throw new Error('当前员工已经签到，无需重复签到。')
  }
  if (openRecord) {
    throw new Error(`存在上一条未签退记录 ${openRecord.id}，请先完成签退。`)
  }

  const sequence = state.nextAttendanceSequence
  const record: AttendanceRecord = {
    id: `ATT-${String(sequence).padStart(6, '0')}`,
    workDate,
    institutionCode,
    institutionName,
    operatorId: state.operator.id,
    operatorName: profile?.displayName ?? state.operator.id,
    workstationCode,
    institutionSignedInAt: institutionAttendance.activePeriod.signedInAt ?? occurredAt,
    institutionSignedInBy: institutionAttendance.activePeriod.signedInBy,
    institutionSignedOutAt: institutionAttendance.activePeriod.signedOutAt,
    employeeSignedInAt: occurredAt,
    employeeSignedOutAt: null,
    institutionSignOutCancelledAt: null,
    employeeSignOutCancelledAt: null,
  }
  const next: SimulatorState = {
    ...state,
    nextAttendanceSequence: sequence + 1,
    attendanceRecords: [...state.attendanceRecords, record],
  }
  return appendAccessAudit(
    next,
    'employee-signed-in',
    occurredAt,
    state.operator.id,
    record.id,
    `台席 ${workstationCode} 员工手动签到。`,
  )
}

function attendanceRecord(state: SimulatorState, recordId: string): AttendanceRecord {
  const record = state.attendanceRecords.find((candidate) => candidate.id === recordId)
  if (!record) throw new Error('未找到签到签退记录。')
  return record
}

function canOperateEmployee(
  state: SimulatorState,
  record: AttendanceRecord,
  actorId: string,
): boolean {
  return record.operatorId === actorId || hasScopedPermission(
    state,
    'management.business.attendance.operate',
    record.operatorId,
    record.institutionCode,
    actorId,
  )
}

export function signOutEmployee(
  state: SimulatorState,
  recordId: string,
  actorId: string,
  occurredAt: string,
  authorization: AttendanceAuthorization,
): SimulatorState {
  requireAttendanceAuthorization(state, actorId, authorization)
  const record = attendanceRecord(state, recordId)
  if (!canOperateEmployee(state, record, actorId)) throw new Error('没有员工签退操作权限。')
  if (record.employeeSignedOutAt) throw new Error('该员工已经签退。')
  if (Date.parse(occurredAt) < Date.parse(record.employeeSignedInAt)) {
    throw new Error('员工签退时间不能早于签到时间。')
  }
  const next = {
    ...state,
    attendanceRecords: state.attendanceRecords.map((candidate) => candidate.id === recordId
      ? { ...candidate, employeeSignedOutAt: occurredAt, employeeSignOutCancelledAt: null }
      : candidate),
  }
  return appendAccessAudit(
    next,
    'employee-signed-out',
    occurredAt,
    actorId,
    recordId,
    `员工 ${record.operatorName} 完成签退。`,
  )
}

export function cancelEmployeeSignOut(
  state: SimulatorState,
  recordId: string,
  actorId: string,
  occurredAt: string,
  authorization: AttendanceAuthorization,
): SimulatorState {
  requireAttendanceAuthorization(state, actorId, authorization)
  const record = attendanceRecord(state, recordId)
  if (!canOperateEmployee(state, record, actorId)) throw new Error('没有撤销员工签退权限。')
  if (!record.employeeSignedOutAt) throw new Error('该员工尚未签退，无需撤销。')
  if (state.attendanceRecords.some((candidate) => (
    candidate.id !== record.id &&
    candidate.operatorId === record.operatorId &&
    candidate.employeeSignedOutAt === null
  ))) throw new Error('该员工已有另一条未签退记录，不能撤销。')
  const next = {
    ...state,
    attendanceRecords: state.attendanceRecords.map((candidate) => candidate.id === recordId
      ? { ...candidate, employeeSignedOutAt: null, employeeSignOutCancelledAt: occurredAt }
      : candidate),
  }
  return appendAccessAudit(
    next,
    'employee-sign-out-cancelled',
    occurredAt,
    actorId,
    recordId,
    `撤销员工 ${record.operatorName} 的签退。`,
  )
}

function requireInstitutionOperation(
  state: SimulatorState,
  institutionCode: string,
  actorId: string,
): void {
  if (!canOperateInstitution(
    state,
    'management.business.attendance.operate',
    institutionCode,
    actorId,
  )) {
    throw new Error('没有机构签到签退操作权限。')
  }
}

export function signOutInstitution(
  state: SimulatorState,
  institutionCode: string,
  workDate: string,
  actorId: string,
  occurredAt: string,
  authorization: AttendanceAuthorization,
): SimulatorState {
  requireAttendanceAuthorization(state, actorId, authorization)
  requireInstitutionOperation(state, institutionCode, actorId)
  if (state.session?.operatorId !== actorId) {
    throw new Error('请由当前登录人员本人完成机构签退。')
  }
  if (workDate !== localWorkDate(new Date(occurredAt))) {
    throw new Error('机构签退只能登记东八区当天记录。')
  }
  const projection = projectInstitutionAttendance(state, institutionCode, workDate, occurredAt)
  if (!projection.activePeriod) throw new Error('该机构当前没有有效的人工签到。')
  const cycleWorkDate = localWorkDate(new Date(projection.activePeriod.signedInAt ?? occurredAt))
  const targetId = institutionAuditTarget(institutionCode, cycleWorkDate, projection.activePeriod.key)
  const next: SimulatorState = {
    ...state,
    attendanceRecords: state.attendanceRecords.map((record) => (
      record.institutionCode === institutionCode &&
      record.institutionSignedInAt === projection.activePeriod?.signedInAt
        ? { ...record, institutionSignedOutAt: occurredAt, institutionSignOutCancelledAt: null }
        : record
    )),
  }
  return appendAccessAudit(
    next,
    'institution-signed-out',
    occurredAt,
    actorId,
    targetId,
    `主管完成机构${projection.activePeriod.label}时段签退。`,
  )
}

export function cancelInstitutionSignOut(
  state: SimulatorState,
  institutionCode: string,
  workDate: string,
  actorId: string,
  occurredAt: string,
  authorization: AttendanceAuthorization,
): SimulatorState {
  requireAttendanceAuthorization(state, actorId, authorization)
  requireInstitutionOperation(state, institutionCode, actorId)
  if (state.session?.operatorId !== actorId) {
    throw new Error('请由当前登录人员本人撤销机构签退。')
  }
  if (workDate !== localWorkDate(new Date(occurredAt))) {
    throw new Error('只能撤销东八区当天的机构签退。')
  }
  const latest = institutionAttendanceEvents(
    state,
    institutionCode,
    occurredAt,
  ).at(-1) ?? null
  if (!latest || latest.action !== 'institution-signed-out') {
    throw new Error('该机构当前没有可撤销的人工签退记录。')
  }
  const next: SimulatorState = {
    ...state,
    attendanceRecords: state.attendanceRecords.map((record) => (
      record.institutionCode === institutionCode
      && record.institutionSignedOutAt === latest.occurredAt
        ? { ...record, institutionSignedOutAt: null, institutionSignOutCancelledAt: occurredAt }
        : record
    )),
  }
  return appendAccessAudit(
    next,
    'institution-sign-out-cancelled',
    occurredAt,
    actorId,
    latest.targetId,
    '管理人员手工撤销机构签退，恢复本次人工签到。',
  )
}

export function latestAttendanceForOperator(
  state: SimulatorState,
  operatorId = state.operator.id,
  workDate?: string,
): AttendanceRecord | null {
  return state.attendanceRecords.slice().reverse()
    .find((record) => record.operatorId === operatorId &&
      (!workDate || record.workDate === workDate)) ?? null
}

/**
 * 生产办理使用的在岗投影。
 *
 * 登录会话、机构人工签到和员工考勤是三个独立条件；只有机构已经由有权限人员手工
 * 签到，且员工在本次机构签到后完成本人签到，才视为可以办理生产业务。
 */
export function projectEmployeeDuty(
  state: SimulatorState,
  occurredAt = new Date().toISOString(),
  operatorId = state.operator.id,
): EmployeeDutyProjection {
  const timestamp = new Date(occurredAt)
  const workDate = localWorkDate(timestamp)
  const operator = state.operator.id === operatorId
    ? state.operator
    : state.operators.find((candidate) => candidate.id === operatorId) ?? null
  const institutionCode = operator?.profile?.institutionCode ?? '99901001'
  const institution = projectInstitutionAttendance(
    state,
    institutionCode,
    workDate,
    occurredAt,
  )
  const attendance = latestAttendanceForOperator(state, operatorId, workDate)
  const openAttendance = state.attendanceRecords.slice().reverse().find((record) => (
    record.operatorId === operatorId &&
    record.employeeSignedOutAt === null
  )) ?? null

  if (!institution.activePeriod) {
    return {
      workDate,
      status: 'institution-closed',
      statusLabel: institution.status === 'signed-out' ? '机构已经人工签退' : '机构尚未人工签到',
      attendance: openAttendance ?? attendance,
      institution,
    }
  }
  if (openAttendance &&
      openAttendance.institutionSignedInAt === institution.activePeriod.signedInAt) {
    return {
      workDate,
      status: 'on-duty',
      statusLabel: '员工已签到',
      attendance: openAttendance,
      institution,
    }
  }
  if (openAttendance) {
    return {
      workDate,
      status: 'previous-period-open',
      statusLabel: '上个营业时段尚未签退',
      attendance: openAttendance,
      institution,
    }
  }
  if (attendance?.employeeSignedOutAt) {
    return {
      workDate,
      status: 'signed-out',
      statusLabel: '员工已签退',
      attendance,
      institution,
    }
  }
  return {
    workDate,
    status: 'not-signed-in',
    statusLabel: '员工还未签到',
    attendance,
    institution,
  }
}
