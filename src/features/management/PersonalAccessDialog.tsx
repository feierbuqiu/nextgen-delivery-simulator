import { useMemo, useState } from 'react'

import {
  ACCESS_PERMISSION_LABELS,
  REQUESTABLE_ROLE_BY_PERMISSION,
  REQUESTABLE_ROLE_IDS,
} from '../../domain/access/catalog'
import {
  effectivePermissions,
  effectiveRoles,
} from '../../domain/access/authorization'
import { EAST_EIGHT_TIME_ZONE } from '../../domain/access/attendance'
import {
  submitRoleRequest,
  updateSelfServiceProfile,
} from '../../domain/access/management'
import type {
  AccessPermission,
  PersonnelRequestStatus,
  SimulatorState,
} from '../../domain/access/types'
import { Modal } from '../../ui/Modal'

export type PersonalAccessTab = 'profile' | 'permissions' | 'requests'

interface PersonalAccessDialogProps {
  initialPermission?: AccessPermission | null
  initialTab: PersonalAccessTab
  onClose: () => void
  onStateChange: (state: SimulatorState) => Promise<void>
  state: SimulatorState
}

const statusLabels: Record<PersonnelRequestStatus, string> = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
}

export function PersonalAccessDialog({
  initialPermission = null,
  initialTab,
  onClose,
  onStateChange,
  state,
}: PersonalAccessDialogProps) {
  const profile = state.operator.profile
  const [activeTab, setActiveTab] = useState<PersonalAccessTab>(initialTab)
  const [phone, setPhone] = useState(profile?.phone ?? state.operator.boundMobile)
  const [receiveSmsType, setReceiveSmsType] = useState(profile?.receiveSmsType ?? 'disabled')
  const [receiveSmsTime, setReceiveSmsTime] = useState(profile?.receiveSmsTime ?? '')
  const [responsibleStoreOutlet, setResponsibleStoreOutlet] = useState(profile?.responsibleStoreOutlet ?? '')
  const [performanceSourceOutlet, setPerformanceSourceOutlet] = useState(profile?.performanceSourceOutlet ?? '')
  const [performanceEvaluation, setPerformanceEvaluation] = useState(profile?.performanceEvaluation ?? '')
  const [requestedRoleId, setRequestedRoleId] = useState(
    initialPermission ? REQUESTABLE_ROLE_BY_PERMISSION[initialPermission] ?? '' : '',
  )
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const currentRoles = useMemo(() => effectiveRoles(state), [state])
  const currentPermissions = useMemo(() => (
    Array.from(effectivePermissions(state)).sort((left, right) => (
      ACCESS_PERMISSION_LABELS[left].localeCompare(ACCESS_PERMISSION_LABELS[right], 'zh-CN')
    ))
  ), [state])
  const currentPermissionSet = useMemo(() => new Set(currentPermissions), [currentPermissions])
  const pendingRoleIds = useMemo(() => new Set(state.personnelRequests
    .filter((request) => request.targetOperatorId === state.operator.id &&
      request.kind === 'role-change' && request.status === 'pending' && request.requestedRoleId)
    .map((request) => request.requestedRoleId as string)), [state])
  const availableRoles = state.roles.filter((role) => (
    REQUESTABLE_ROLE_IDS.includes(role.id as typeof REQUESTABLE_ROLE_IDS[number]) &&
    role.status === 'active' &&
    !pendingRoleIds.has(role.id) &&
    !currentRoles.some((currentRole) => currentRole.id === role.id) &&
    !role.permissions.every((permission) => currentPermissionSet.has(permission))
  ))
  const myRequests = state.personnelRequests
    .filter((request) => request.applicantOperatorId === state.operator.id ||
      request.targetOperatorId === state.operator.id)
    .slice()
    .reverse()
  const permissionCatalog = (Object.keys(ACCESS_PERMISSION_LABELS) as AccessPermission[])
    .filter((permission) => permission.startsWith('workspace.') ||
      permission === 'management.basic.personnel' ||
      permission === 'management.business.attendance.read')

  async function saveProfile(): Promise<void> {
    try {
      const next = updateSelfServiceProfile(state, {
        phone,
        receiveSmsType,
        receiveSmsTime,
        responsibleStoreOutlet,
        performanceSourceOutlet,
        performanceEvaluation,
      }, new Date().toISOString())
      await onStateChange(next)
      setMessage('个人联系与通知信息已保存。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '个人信息保存失败。')
      setMessage('')
    }
  }

  async function requestRole(): Promise<void> {
    try {
      if (!requestedRoleId) throw new Error('请选择需要申请的岗位角色。')
      const submittedAt = new Date().toISOString()
      const next = submitRoleRequest(
        state,
        requestedRoleId,
        reason,
        submittedAt,
      )
      await onStateChange(next)
      setRequestedRoleId('')
      setReason('')
      setActiveTab('requests')
      setMessage('岗位与权限申请已经提交，等待具备权限的管理人员登录后手工审批。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '岗位与权限申请失败。')
      setMessage('')
    }
  }

  return (
    <Modal eyebrow="人员中心" title="个人设置" wide>
      <div className="personnel-dialog">
        <nav aria-label="个人设置栏目" className="management-tabs">
          <button aria-current={activeTab === 'profile' ? 'page' : undefined} onClick={() => setActiveTab('profile')} type="button">个人设置</button>
          <button aria-current={activeTab === 'permissions' ? 'page' : undefined} onClick={() => setActiveTab('permissions')} type="button">我的岗位与权限</button>
          <button aria-current={activeTab === 'requests' ? 'page' : undefined} onClick={() => setActiveTab('requests')} type="button">我的申请</button>
        </nav>

        {activeTab === 'profile' ? (
          <section aria-label="个人信息维护" className="management-panel">
            <div className="management-form-grid management-form-grid--readonly">
              <label><span>人员姓名</span><input readOnly value={profile?.displayName ?? ''} /></label>
              <label><span>人员身份证</span><input readOnly value={profile?.identityCode ?? ''} /></label>
              <label><span>机构编码</span><input readOnly value={profile?.institutionCode ?? ''} /></label>
              <label><span>机构名称</span><input readOnly value={profile?.institutionName ?? ''} /></label>
              <label><span>人员状态</span><input readOnly value={profile?.personnelStatus === 'active' ? '在岗' : '非在岗'} /></label>
              <label><span>权限组合</span><input readOnly value={currentRoles.map((role) => role.name).join('、')} /></label>
            </div>
            <p className="management-hint">机构、身份、人员状态和岗位属于受控信息，需要通过人员管理流程变更。</p>
            <div className="management-form-grid">
              <label><span>手机号码</span><input aria-label="个人手机号码" onChange={(event) => setPhone(event.target.value)} value={phone} /></label>
              <label><span>接收短信类型</span><select aria-label="个人接收短信类型" onChange={(event) => setReceiveSmsType(event.target.value)} value={receiveSmsType}><option value="business-and-security">业务及安全提醒</option><option value="business">业务提醒</option><option value="security">安全提醒</option><option value="disabled">不接收</option></select></label>
              <label><span>接收短信时间</span><input aria-label="个人接收短信时间" onChange={(event) => setReceiveSmsTime(event.target.value)} placeholder="08:00-20:00" value={receiveSmsTime} /></label>
              <label><span>负责巡店网点</span><input aria-label="个人负责巡店网点" onChange={(event) => setResponsibleStoreOutlet(event.target.value)} value={responsibleStoreOutlet} /></label>
              <label><span>业绩来源网点</span><input aria-label="个人业绩来源网点" onChange={(event) => setPerformanceSourceOutlet(event.target.value)} value={performanceSourceOutlet} /></label>
              <label><span>业绩评价</span><input aria-label="个人业绩评价" onChange={(event) => setPerformanceEvaluation(event.target.value)} value={performanceEvaluation} /></label>
            </div>
            <div className="management-actions"><button className="primary-button primary-button--compact" onClick={() => void saveProfile()} type="button">保存个人设置</button></div>
          </section>
        ) : null}

        {activeTab === 'permissions' ? (
          <section aria-label="我的岗位与权限" className="management-panel">
            {initialPermission && !currentPermissionSet.has(initialPermission) ? (
              <div className="permission-entry-notice" role="note">
                <strong>{ACCESS_PERMISSION_LABELS[initialPermission]}</strong>
                <span>功能目录对当前员工可见，办理能力尚未开通。</span>
              </div>
            ) : null}
            <div className="permission-summary">
              <div><h3>当前权限组合</h3><div className="role-chip-list">{currentRoles.map((role) => <span key={role.id}>{role.name}</span>)}</div></div>
              <div><h3>已授权功能</h3><ul>{currentPermissions.map((permission) => <li key={permission}>{ACCESS_PERMISSION_LABELS[permission]}</li>)}</ul></div>
            </div>
            <div className="permission-catalog" role="region" aria-label="可见功能目录">
              <div className="permission-catalog-heading"><h3>可见功能目录</h3><span>可见不等于可用</span></div>
              <div className="permission-catalog-list">
                {permissionCatalog.map((permission) => {
                  const roleId = REQUESTABLE_ROLE_BY_PERMISSION[permission]
                  const role = roleId ? state.roles.find((candidate) => candidate.id === roleId) : null
                  const authorized = currentPermissionSet.has(permission)
                  const pending = Boolean(roleId && pendingRoleIds.has(roleId))
                  return (
                    <div className={authorized ? 'permission-catalog-row permission-catalog-row--open' : 'permission-catalog-row'} key={permission}>
                      <span>{ACCESS_PERMISSION_LABELS[permission]}</span>
                      <small>{role?.name ?? (authorized ? '当前权限' : '由上级配置')}</small>
                      {authorized ? <strong>已开通</strong> : pending ? <strong>待审批</strong> : roleId ? (
                        <button onClick={() => {
                          setRequestedRoleId(roleId)
                          setError('')
                          setMessage('')
                        }} type="button">申请使用</button>
                      ) : <strong>受控</strong>}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="permission-request-form">
              <label><span>申请专项权限</span><select aria-label="申请专项权限" onChange={(event) => setRequestedRoleId(event.target.value)} value={requestedRoleId}><option value="">请选择</option>{availableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
              <p className="management-hint">审批不会自动通过。申请提交后，必须由另一名具备管辖权限的管理人员登录并手工核准。</p>
              <label><span>申请原因</span><textarea aria-label="权限申请原因" onChange={(event) => setReason(event.target.value)} rows={3} value={reason} /></label>
              <button className="primary-button primary-button--compact" disabled={availableRoles.length === 0} onClick={() => void requestRole()} type="button">提交申请</button>
            </div>
          </section>
        ) : null}

        {activeTab === 'requests' ? (
          <section aria-label="我的人员与权限申请" className="management-panel management-table-wrap">
            <table className="management-table">
              <thead><tr><th>申请编号</th><th>类型</th><th>申请内容</th><th>提交时间</th><th>状态</th><th>审批人</th><th>审批意见</th></tr></thead>
              <tbody>{myRequests.map((request) => <tr key={request.id}><td>{request.id}</td><td>{request.kind === 'role-change' ? '岗位权限' : request.kind === 'profile-change' ? '人员变更' : request.kind === 'deactivation' ? '人员停用' : '新增人员'}</td><td>{request.requestedRoleId ? state.roles.find((role) => role.id === request.requestedRoleId)?.name : request.reason}</td><td>{new Date(request.submittedAt).toLocaleString('zh-CN', { timeZone: EAST_EIGHT_TIME_ZONE, hour12: false })}</td><td><span className={`management-status management-status--${request.status}`}>{statusLabels[request.status]}</span></td><td>{request.reviewedBy || '—'}</td><td>{request.reviewComment || '—'}</td></tr>)}</tbody>
            </table>
            {myRequests.length === 0 ? <p className="management-empty">暂无申请记录。</p> : null}
          </section>
        ) : null}

        {message ? <p className="customer-form-success" role="status">{message}</p> : null}
        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
        <div className="modal-actions"><button className="secondary-button" onClick={onClose} type="button">关闭</button></div>
      </div>
    </Modal>
  )
}
