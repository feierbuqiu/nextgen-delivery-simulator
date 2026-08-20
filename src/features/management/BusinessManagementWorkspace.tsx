import { useEffect, useMemo, useState } from 'react'

import {
  EAST_EIGHT_TIME_ZONE,
  authorizeAttendanceAction,
  cancelEmployeeSignOut,
  cancelInstitutionSignOut,
  localWorkDate,
  projectInstitutionAttendance,
  signInEmployee,
  signInInstitution,
  signOutEmployee,
  signOutInstitution,
} from '../../domain/access/attendance'
import {
  accessibleInstitutionCodes,
  canOperateInstitution,
  hasPermission,
  hasScopedPermission,
  operatorInstitutionCode,
} from '../../domain/access/authorization'
import { reviewPersonnelRequest } from '../../domain/access/management'
import type {
  PersonnelRequest,
  SimulatorState,
} from '../../domain/access/types'
import type { ServiceRepository } from '../../domain/service/repository'
import {
  confirmedPersonalRemittance,
  projectPersonalRemittance,
} from '../../domain/service/personalRemittance'
import { Modal } from '../../ui/Modal'

interface BusinessManagementWorkspaceProps {
  onBack: () => void
  onOpenPersonalRemittance?: () => void
  onStateChange: (state: SimulatorState) => Promise<void>
  pendingBusinessCount?: number
  pendingBusinessTotalCents?: number
  serviceRepository?: ServiceRepository
  state: SimulatorState
}

type AttendanceAction =
  | 'employee-in'
  | 'employee-out'
  | 'employee-cancel'
  | 'institution-in'
  | 'institution-out'
  | 'institution-cancel'

interface AttendanceActionTarget {
  action: AttendanceAction
  recordId?: string
}

function dateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: EAST_EIGHT_TIME_ZONE,
    hour12: false,
  })
}

function requestKindLabel(request: PersonnelRequest): string {
  if (request.kind === 'new-employee') return '人员新增'
  if (request.kind === 'profile-change') return '人员信息修改'
  if (request.kind === 'deactivation') return '人员删除'
  return '岗位权限变更'
}

export function BusinessManagementWorkspace({
  onBack,
  onOpenPersonalRemittance,
  onStateChange,
  pendingBusinessCount = 0,
  pendingBusinessTotalCents = 0,
  serviceRepository,
  state,
}: BusinessManagementWorkspaceProps) {
  const canReadAttendance = hasPermission(state, 'management.business.attendance.read')
  const canApprovePersonnel = hasPermission(
    state,
    'management.business.personnel-approval',
  )
  const canApproveRoles = hasPermission(state, 'management.business.role-approval')
  const canApprove = canApprovePersonnel || canApproveRoles
  const canOperateAttendance = hasPermission(state, 'management.business.attendance.operate')
  const [section, setSection] = useState<'attendance' | 'approval'>(() => (
    canReadAttendance ? 'attendance' : 'approval'
  ))
  const currentWorkDate = localWorkDate(new Date())
  const [workDate, setWorkDate] = useState(currentWorkDate)
  const ownInstitutionCode = state.operator.profile?.institutionCode ?? '99901001'
  const [institutionCode, setInstitutionCode] = useState(ownInstitutionCode)
  const [employeeTerm, setEmployeeTerm] = useState('')
  const [reviewTarget, setReviewTarget] = useState<PersonnelRequest | null>(null)
  const [reviewComment, setReviewComment] = useState('')
  const [attendanceAction, setAttendanceAction] = useState<AttendanceActionTarget | null>(null)
  const [attendanceSecret, setAttendanceSecret] = useState('')
  const [attendanceAcknowledged, setAttendanceAcknowledged] = useState(false)
  const [attendanceActionError, setAttendanceActionError] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [remittanceStatus, setRemittanceStatus] = useState<'loading' | 'not-required' | 'required' | 'confirmed' | 'error'>(
    serviceRepository ? 'loading' : 'not-required',
  )
  const [remittanceId, setRemittanceId] = useState('')

  const readableInstitutions = useMemo(() => {
    if (!canReadAttendance) return []
    const codes = accessibleInstitutionCodes(state, 'management.business.attendance.read')
    return state.institutions.filter((institution) => (
      institution.status === 'active' && codes.has(institution.code)
    ))
  }, [canReadAttendance, state])
  const selectedInstitutionCode = readableInstitutions.some((institution) => institution.code === institutionCode)
    ? institutionCode
    : ownInstitutionCode
  const canOperateSelectedInstitution = canOperateInstitution(
    state,
    'management.business.attendance.operate',
    selectedInstitutionCode,
  )
  const attendanceRecords = useMemo(() => state.attendanceRecords.filter((record) => {
    if (record.workDate !== workDate) return false
    if (record.institutionCode !== selectedInstitutionCode) return false
    if (!hasScopedPermission(
      state,
      'management.business.attendance.read',
      record.operatorId,
      record.institutionCode,
    )) return false
    const term = employeeTerm.trim().toLocaleLowerCase('zh-CN')
    return !term || `${record.operatorId}${record.operatorName}`.toLocaleLowerCase('zh-CN').includes(term)
  }).slice().reverse(), [
    employeeTerm,
    selectedInstitutionCode,
    state,
    workDate,
  ])
  const institutionAttendance = projectInstitutionAttendance(
    state,
    selectedInstitutionCode,
    workDate,
  )
  const currentEmployeeOpenRecord = state.attendanceRecords.slice().reverse().find((record) => (
    record.institutionCode === ownInstitutionCode &&
    record.operatorId === state.operator.id &&
    record.employeeSignedOutAt === null
  )) ?? null
  const accountingWorkDate = currentEmployeeOpenRecord?.workDate ?? currentWorkDate
  const viewingOwnCurrentAttendance = workDate === currentWorkDate &&
    selectedInstitutionCode === ownInstitutionCode
  const requests = state.personnelRequests.filter((request) => {
    const approvalPermission = request.kind === 'role-change'
      ? 'management.business.role-approval' as const
      : 'management.business.personnel-approval' as const
    if (!hasPermission(state, approvalPermission)) return false
    const targetInstitutionCode = request.proposedEmployee?.profile.institutionCode ??
      request.proposedProfile?.institutionCode ??
      operatorInstitutionCode(state, request.targetOperatorId)
    return hasScopedPermission(
      state,
      approvalPermission,
      request.targetOperatorId,
      targetInstitutionCode,
    )
  }).slice().reverse()
  const attendanceTargetRecord = attendanceAction?.recordId
    ? state.attendanceRecords.find((record) => record.id === attendanceAction.recordId) ?? null
    : null

  useEffect(() => {
    if (!serviceRepository) return
    let active = true
    void serviceRepository.load().then((serviceState) => {
      if (!active) return
      const workstationCode = state.session?.workstationCode ?? '01'
      const confirmed = confirmedPersonalRemittance(
        serviceState,
        state.operator.id,
        workstationCode,
        accountingWorkDate,
      )
      if (confirmed) {
        setRemittanceId(confirmed.id)
        setRemittanceStatus('confirmed')
        return
      }
      const projection = projectPersonalRemittance(
        serviceState,
        accountingWorkDate,
        state.operator.id,
        workstationCode,
      )
      const generated = serviceState.personalRemittances.some((item) =>
        item.workDate === accountingWorkDate
        && item.operator.operatorId === state.operator.id
        && item.workstationCode === workstationCode
        && item.status === 'generated')
      setRemittanceStatus(projection.sourceReferences.length > 0 || generated
        ? 'required'
        : 'not-required')
      setRemittanceId('')
    }).catch(() => {
      if (active) setRemittanceStatus('error')
    })
    return () => { active = false }
  }, [accountingWorkDate, serviceRepository, state.operator.id, state.session?.workstationCode])

  function openAttendanceAction(action: AttendanceAction, recordId?: string): void {
    setAttendanceAction({ action, recordId })
    setAttendanceSecret('')
    setAttendanceAcknowledged(false)
    setAttendanceActionError('')
    setError('')
  }

  async function confirmAttendanceAction(): Promise<void> {
    if (!attendanceAction) return
    try {
      if (!attendanceAcknowledged) throw new Error('请确认当前考勤操作由本人办理。')
      if (!attendanceSecret) throw new Error('请输入当前登录密码。')
      const authorization = await authorizeAttendanceAction(state, attendanceSecret)
      const targetRecord = attendanceAction.recordId
        ? state.attendanceRecords.find((record) => record.id === attendanceAction.recordId)
        : null
      const blocksOwnSignOut = attendanceAction.action === 'employee-out' &&
        targetRecord?.operatorId === state.operator.id &&
        pendingBusinessCount > 0
      if (blocksOwnSignOut) {
        throw new Error(`仍有 ${pendingBusinessCount} 笔待结算业务，请先结算或中断后再签退。`)
      }
      const blocksForRemittance = attendanceAction.action === 'employee-out'
        && targetRecord?.operatorId === state.operator.id
        && remittanceStatus !== 'confirmed'
        && remittanceStatus !== 'not-required'
      if (blocksForRemittance) {
        throw new Error(remittanceStatus === 'required'
          ? '当日已有结算业务，请先完成并确认个人缴款后再签退。'
          : '个人缴款状态尚未核验，请稍后重试。')
      }
      const now = new Date().toISOString()
      const next = attendanceAction.action === 'employee-in'
        ? signInEmployee(
          state,
          now,
          localWorkDate(new Date(now)),
          state.session?.workstationCode ?? '01',
          authorization,
        )
        : attendanceAction.action === 'employee-out' && attendanceAction.recordId
          ? signOutEmployee(state, attendanceAction.recordId, state.operator.id, now, authorization)
          : attendanceAction.action === 'employee-cancel' && attendanceAction.recordId
            ? cancelEmployeeSignOut(state, attendanceAction.recordId, state.operator.id, now, authorization)
            : attendanceAction.action === 'institution-in'
              ? signInInstitution(state, selectedInstitutionCode, workDate, state.operator.id, now, authorization)
              : attendanceAction.action === 'institution-out'
                ? signOutInstitution(state, selectedInstitutionCode, workDate, state.operator.id, now, authorization)
                : attendanceAction.action === 'institution-cancel'
                  ? cancelInstitutionSignOut(state, selectedInstitutionCode, workDate, state.operator.id, now, authorization)
                  : state
      await onStateChange(next)
      setMessage(attendanceAction.action === 'employee-in'
        ? '员工签到完成。'
        : attendanceAction.action === 'employee-out'
          ? '员工签退完成。'
          : attendanceAction.action === 'employee-cancel'
            ? '员工签退已撤销。'
            : attendanceAction.action === 'institution-in'
              ? '机构签到完成。'
              : attendanceAction.action === 'institution-out'
                ? '机构签退完成。'
                : '机构签退已撤销。')
      setError('')
      setAttendanceAction(null)
      setAttendanceSecret('')
      setAttendanceAcknowledged(false)
      setAttendanceActionError('')
    } catch (caught) {
      setAttendanceActionError(caught instanceof Error ? caught.message : '签到签退操作失败。')
      setMessage('')
    }
  }

  async function review(decision: 'approved' | 'rejected'): Promise<void> {
    if (!reviewTarget) return
    try {
      const next = reviewPersonnelRequest(
        state,
        reviewTarget.id,
        decision,
        reviewComment,
        new Date().toISOString(),
      )
      await onStateChange(next)
      setReviewTarget(null)
      setReviewComment('')
      setMessage(decision === 'approved' ? '人员申请审批通过。' : '人员申请已驳回。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '人员申请审批失败。')
    }
  }

  return (
    <>
      <section aria-label="业务管理" className="management-workspace">
        <div className="customer-breadcrumb"><button onClick={onBack} type="button">主页</button><span>/</span><strong>业务管理</strong></div>
        <header className="management-heading"><div><h1>业务管理</h1><p>签到签退、人员审批与岗位角色审批</p></div><span>{state.operator.profile?.institutionName} {ownInstitutionCode}</span></header>
        <nav aria-label="业务管理栏目" className="management-tabs">
          {canReadAttendance ? <button aria-current={section === 'attendance' ? 'page' : undefined} onClick={() => setSection('attendance')} type="button">签到签退查询</button> : null}
          {canApprove ? <button aria-current={section === 'approval' ? 'page' : undefined} onClick={() => setSection('approval')} type="button">人员与岗位审批</button> : null}
        </nav>

        {message ? <p className="customer-form-success" role="status">{message}</p> : null}
        {error && !reviewTarget ? <p className="customer-form-error" role="alert">{error}</p> : null}

        {section === 'attendance' ? (
          <section aria-label="签到签退查询" className="management-panel">
            <div className="management-toolbar management-toolbar--filters">
              <label><span>工作日期</span><input aria-label="签到签退工作日期" onChange={(event) => setWorkDate(event.target.value)} type="date" value={workDate} /></label>
              <label><span>机构</span><select aria-label="签到签退查询机构" onChange={(event) => setInstitutionCode(event.target.value)} value={selectedInstitutionCode}>{readableInstitutions.map((institution) => <option key={institution.code} value={institution.code}>{institution.name}</option>)}</select></label>
              <label><span>员工</span><input aria-label="签到签退员工查询" onChange={(event) => setEmployeeTerm(event.target.value)} placeholder="工号或姓名" value={employeeTerm} /></label>
              <div className="management-toolbar-actions">
                {viewingOwnCurrentAttendance && !canOperateAttendance ? currentEmployeeOpenRecord ? (
                  <button aria-label="当前员工签退" onClick={() => openAttendanceAction('employee-out', currentEmployeeOpenRecord.id)} type="button">员工签退</button>
                ) : (
                  <button aria-label="当前员工签到" onClick={() => openAttendanceAction('employee-in')} type="button">员工签到</button>
                ) : null}
                {canOperateAttendance && canOperateSelectedInstitution && workDate === currentWorkDate ? <>{institutionAttendance.status === 'signed-in' ? <button onClick={() => openAttendanceAction('institution-out')} type="button">机构签退</button> : <button aria-label="当前机构签到" onClick={() => openAttendanceAction('institution-in')} type="button">机构签到</button>}<button disabled={!institutionAttendance.hasSupervisorSignOut} onClick={() => openAttendanceAction('institution-cancel')} type="button">撤销机构签退</button></> : null}
              </div>
            </div>
            <div className="attendance-summary"><div><span>机构签到方式</span><strong>管理人员手工确认</strong></div><div><span>身份约束</span><strong>机构与员工由不同工号确认</strong></div><div><span>机构状态</span><strong>{institutionAttendance.statusLabel}</strong></div><div><span>当日员工记录</span><strong>{attendanceRecords.length}</strong></div></div>
            <div className="management-table-wrap"><table className="management-table"><thead><tr><th>机构</th><th>员工</th><th>台席</th><th>员工签到</th><th>员工签退</th><th>操作</th></tr></thead><tbody>{attendanceRecords.map((record) => {
              const mayOperateEmployee = record.operatorId === state.operator.id || hasScopedPermission(state, 'management.business.attendance.operate', record.operatorId, record.institutionCode)
              return <tr key={record.id}><td>{record.institutionName}<small>{record.institutionCode}</small></td><td>{record.operatorName}<small>{record.operatorId}</small></td><td>{record.workstationCode}</td><td>{dateTime(record.employeeSignedInAt)}</td><td>{record.employeeSignedOutAt ? dateTime(record.employeeSignedOutAt) : '还未签退'}</td><td><div className="management-row-actions">{mayOperateEmployee ? record.employeeSignedOutAt ? <button onClick={() => openAttendanceAction('employee-cancel', record.id)} type="button">撤销员工签退</button> : <button onClick={() => openAttendanceAction('employee-out', record.id)} type="button">员工签退</button> : <span>仅查询</span>}</div></td></tr>
            })}</tbody></table>{attendanceRecords.length === 0 ? <p className="management-empty">当前条件下没有签到签退记录。</p> : null}</div>
          </section>
        ) : (
          <section aria-label="人员与岗位审批" className="management-panel management-table-wrap">
            <div className="management-toolbar"><p>审批结果将写入人员、角色和审计台账；申请人不得审批本人为本人提交的申请。</p></div>
            <table className="management-table"><thead><tr><th>申请编号</th><th>申请类型</th><th>申请人</th><th>目标人员</th><th>原因</th><th>状态</th><th>操作</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td>{request.id}</td><td>{requestKindLabel(request)}</td><td>{request.applicantOperatorId}</td><td>{request.targetOperatorId}</td><td>{request.reason}</td><td>{request.status === 'pending' ? '待审批' : request.status === 'approved' ? '已通过' : '已驳回'}</td><td>{request.status === 'pending' ? request.applicantOperatorId === state.operator.id ? <span>待上级审批</span> : <button onClick={() => { setReviewTarget(request); setReviewComment(''); setError('') }} type="button">审批</button> : <button onClick={() => { setReviewTarget(request); setReviewComment(request.reviewComment); setError('') }} type="button">详情</button>}</td></tr>)}</tbody></table>
            {requests.length === 0 ? <p className="management-empty">暂无人员审批记录。</p> : null}
          </section>
        )}
      </section>

      {reviewTarget ? (
        <Modal eyebrow="人员与岗位审批" title={`${requestKindLabel(reviewTarget)} ${reviewTarget.id}`} wide>
          <div className="modal-form management-review">
            <dl><div><dt>申请人</dt><dd>{reviewTarget.applicantOperatorId}</dd></div><div><dt>目标人员</dt><dd>{reviewTarget.targetOperatorId}</dd></div><div><dt>申请时间</dt><dd>{dateTime(reviewTarget.submittedAt)}</dd></div><div><dt>申请状态</dt><dd>{reviewTarget.status}</dd></div><div><dt>申请原因</dt><dd>{reviewTarget.reason}</dd></div><div><dt>申请角色</dt><dd>{reviewTarget.requestedRoleId ? state.roles.find((role) => role.id === reviewTarget.requestedRoleId)?.name : '—'}</dd></div></dl>
            <label><span>审批意见</span><textarea aria-label="人员审批意见" disabled={reviewTarget.status !== 'pending'} onChange={(event) => setReviewComment(event.target.value)} rows={4} value={reviewComment} /></label>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setReviewTarget(null); setError('') }} type="button">关闭</button>{reviewTarget.status === 'pending' ? <><button className="secondary-button" onClick={() => void review('rejected')} type="button">驳回</button><button className="primary-button primary-button--compact" onClick={() => void review('approved')} type="button">审批通过</button></> : null}</div>
          </div>
        </Modal>
      ) : null}

      {attendanceAction ? (
        <Modal
          compact
          eyebrow="签到签退确认"
          title={attendanceAction.action === 'employee-in'
            ? '员工签到'
            : attendanceAction.action === 'employee-out'
              ? '员工签退'
              : attendanceAction.action === 'employee-cancel'
                ? '撤销员工签退'
                : attendanceAction.action === 'institution-in'
                  ? '机构签到'
                  : attendanceAction.action === 'institution-out'
                    ? '机构签退'
                    : '撤销机构签退'}
        >
          <div className="modal-form attendance-confirmation">
            <dl>
              <div><dt>当前人员</dt><dd>{state.operator.profile?.displayName ?? state.operator.id}（{state.operator.id}）</dd></div>
              {attendanceTargetRecord && attendanceTargetRecord.operatorId !== state.operator.id ? <div><dt>目标员工</dt><dd>{attendanceTargetRecord.operatorName}（{attendanceTargetRecord.operatorId}）</dd></div> : null}
              <div><dt>当前机构</dt><dd>{state.operator.profile?.institutionName ?? '景麓营业部'}（{ownInstitutionCode}）</dd></div>
              <div><dt>当前台席</dt><dd>{state.session?.workstationCode ?? '—'}</dd></div>
              <div><dt>东八区时间</dt><dd>{dateTime(new Date().toISOString())}</dd></div>
              {attendanceAction.action === 'employee-out' ? <div><dt>待结算业务</dt><dd>{pendingBusinessCount} 笔 / ¥{(pendingBusinessTotalCents / 100).toFixed(2)}</dd></div> : null}
              {attendanceAction.action === 'employee-out' ? <div><dt>个人缴款</dt><dd>{remittanceStatus === 'confirmed' ? `已确认 ${remittanceId}` : remittanceStatus === 'not-required' ? '当日无须缴款' : remittanceStatus === 'required' ? '尚未确认' : remittanceStatus === 'loading' ? '正在核验' : '核验失败'}</dd></div> : null}
            </dl>
            {attendanceAction.action === 'employee-out' && pendingBusinessCount > 0 ? (
              <p className="customer-form-error" role="alert">请先完成结算或中断当前待结算业务，系统才允许员工签退。</p>
            ) : null}
            {attendanceAction.action === 'employee-out' && remittanceStatus === 'required' ? (
              <p className="customer-form-error" role="alert">当日已有已结算业务，必须先完成并确认个人缴款。{onOpenPersonalRemittance ? <button className="text-button" onClick={() => { setAttendanceAction(null); onOpenPersonalRemittance() }} type="button">前往个人缴款</button> : null}</p>
            ) : null}
            <label><span>当前登录密码</span><input aria-label="签到签退当前登录密码" autoComplete="current-password" onChange={(event) => setAttendanceSecret(event.target.value)} type="password" value={attendanceSecret} /></label>
            <label className="attendance-confirmation-check"><input checked={attendanceAcknowledged} onChange={(event) => setAttendanceAcknowledged(event.target.checked)} type="checkbox" /><span>{attendanceAction.action.includes('out') ? '本人已核对待办、账务及邮件交接情况，确认执行本次签退。' : '本人确认当前操作身份、机构和台席信息无误。'}</span></label>
            {attendanceActionError ? <p className="customer-form-error" role="alert">{attendanceActionError}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setAttendanceAction(null); setAttendanceActionError('') }} type="button">取消</button><button className="primary-button primary-button--compact" disabled={!attendanceSecret || !attendanceAcknowledged || (attendanceAction.action === 'employee-out' && (pendingBusinessCount > 0 || (remittanceStatus !== 'confirmed' && remittanceStatus !== 'not-required')))} onClick={() => void confirmAttendanceAction()} type="button">确认办理</button></div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
