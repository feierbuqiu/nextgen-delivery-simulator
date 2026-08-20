import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'

import type { AccessPermission, SimulatorState } from '../../domain/access/types'
import { hasPermission } from '../../domain/access/authorization'
import {
  EAST_EIGHT_TIME_ZONE,
  latestAttendanceForOperator,
  localWorkDate,
  projectEmployeeDuty,
  projectInstitutionAttendance,
} from '../../domain/access/attendance'
import {
  authorizeInternalHandoverReceiver,
  authorizeOnSiteAction,
  eligibleInternalHandoverReceivers,
  type OnSiteAuthorizationAction,
} from '../../domain/access/workAuthorization'
import type { CustomerRepository } from '../../domain/customer/repository'
import type { ServiceRepository } from '../../domain/service/repository'
import type { ServiceRecommendationTransfer } from '../../domain/service/recommendation'
import type { ServiceSummary } from '../service/ServiceIntakePanel'
import { pendingServiceSummary } from '../../domain/service/transactions'
import { HomeDashboard } from './HomeDashboard'
import {
  PersonalAccessDialog,
  type PersonalAccessTab,
} from '../management/PersonalAccessDialog'
import { ShellIcon } from './ShellIcon'
import { Modal } from '../../ui/Modal'
import {
  attendanceLabels,
  homeWorkspaceTab,
  moreApplications,
  navigationGroups,
  permissionRequiresAttendance,
  requiredPermissionForView,
  topNavigation,
  viewRequiresAttendance,
  type ActiveView,
  type ShellLeaf,
  type TopNavigationItem,
  type WorkspaceTab,
} from './navigation'
import {
  AccountingWorkspace,
  BasicManagementWorkspace,
  BulkIntakeWorkspace,
  BusinessCustomerQueryWorkspace,
  BusinessManagementWorkspace,
  CapabilityBoundaryWorkspace,
  CapabilityMatrixWorkspace,
  ChannelProductQueryWorkspace,
  ChannelQueryWorkspace,
  CustomerIntakeWorkspace,
  DispatchBagInterchangeReturnWorkspace,
  DispatchPrintWorkspace,
  DispatchQueryWorkspace,
  DispatchRouteWorkspace,
  DispatchTripExportWorkspace,
  InvoiceManagementWorkspace,
  MailHandoverWorkspace,
  MailSealingWorkspace,
  PointsInventoryWorkspace,
  PostalSupplyManagementWorkspace,
  PostageMeterOperationsWorkspace,
  PostageMeterWorkspace,
  PostalAdministrativeQueryWorkspace,
  RecommendationWorkspace,
  RefundPendingWorkspace,
  ReplyCouponWorkspace,
  ReturnReceiptWorkspace,
  RoutingRelationshipWorkspace,
  SelfServiceBatchImportWorkspace,
  SettlementWorkspace,
  SpecialHandlingWorkspace,
  SpotCheckExerciseWorkspace,
  TransactionQueryWorkspace,
  VehicleDispatchQueryWorkspace,
  WindowDeliveryWorkspace,
} from './workspaceLoaders'

interface SimulatorShellProps {
  state: SimulatorState
  customerRepository: CustomerRepository
  serviceRepository: ServiceRepository
  onExportArchive: () => Promise<void>
  onImportArchive: (file: File) => Promise<void>
  onAccessStateChange: (state: SimulatorState) => Promise<void>
  onChangeSecret: () => void
  onLogout: () => Promise<void>
  onReset: () => Promise<void>
  clock?: () => Date
}

const systemClock = () => new Date()

function formatAttendanceTime(value: string | undefined): string {
  if (!value) return '还未签到'
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return '还未签到'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: EAST_EIGHT_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(timestamp)
}

function formatWorkbenchClock(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: EAST_EIGHT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(value).replaceAll('/', '-')
}

function WorkbenchClock({ clock }: { clock: () => Date }) {
  const [current, setCurrent] = useState(clock)
  useEffect(() => {
    const timer = window.setInterval(() => setCurrent(clock()), 1000)
    return () => window.clearInterval(timer)
  }, [clock])
  return (
    <time dateTime={current.toISOString()}>
      {formatWorkbenchClock(current)}
    </time>
  )
}

export function SimulatorShell({
  state,
  customerRepository,
  serviceRepository,
  onExportArchive,
  onImportArchive,
  onAccessStateChange,
  onChangeSecret,
  onLogout,
  onReset,
  clock = systemClock,
}: SimulatorShellProps) {
  const [requestedActiveView, setActiveView] = useState<ActiveView>('dashboard')
  const [requestedTopNavigation, setActiveTopNavigation] = useState<string>('工作台')
  const [requestedLeaf, setActiveLeaf] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(['business']),
  )
  const [placeholderLabel, setPlaceholderLabel] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [personalAccessTab, setPersonalAccessTab] = useState<PersonalAccessTab | null>(null)
  const [personalAccessPermission, setPersonalAccessPermission] = useState<AccessPermission | null>(null)
  const [attendanceGateLabel, setAttendanceGateLabel] = useState<string | null>(null)
  const [logoutPrompt, setLogoutPrompt] = useState<'open-attendance' | 'not-attended' | null>(null)
  const [archiveMessage, setArchiveMessage] = useState('')
  const [archiveError, setArchiveError] = useState(false)
  const archiveInputRef = useRef<HTMLInputElement>(null)
  const [storedWorkspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([homeWorkspaceTab])
  const [requestedWorkspaceTabId, setActiveWorkspaceTabId] = useState(homeWorkspaceTab.id)
  const [serviceSummary, setServiceSummary] = useState<ServiceSummary>({
    count: 0,
    totalCents: 0,
  })
  const [recommendationSelection, setRecommendationSelection] =
    useState<ServiceRecommendationTransfer | null>(null)
  const [attendanceClock, setAttendanceClock] = useState(clock)
  const displayName = state.operator.profile?.displayName ?? '营业员'
  const institutionName = state.operator.profile?.institutionName?.trim() || '景麓营业部'
  const institutionCode = state.operator.profile?.institutionCode?.trim() || '99901001'
  const currentWorkDate = localWorkDate(attendanceClock)
  const currentAttendance = latestAttendanceForOperator(state, state.operator.id, currentWorkDate)
  const institutionAttendance = projectInstitutionAttendance(
    state,
    institutionCode,
    currentWorkDate,
    attendanceClock.toISOString(),
  )
  const employeeDuty = projectEmployeeDuty(
    state,
    attendanceClock.toISOString(),
    state.operator.id,
  )
  const employeeOnDuty = employeeDuty.status === 'on-duty'
  const internalHandoverReceivers = state.session
    ? eligibleInternalHandoverReceivers(
        state,
        institutionCode,
        attendanceClock.toISOString(),
      ).map((operator) => ({
        id: operator.id,
        name: operator.profile?.displayName ?? operator.id,
      }))
    : []
  const attendanceTimes = [
    formatAttendanceTime(institutionAttendance.focusPeriod?.signedInAt ?? undefined),
    institutionAttendance.focusPeriod?.signedOutAt
      ? formatAttendanceTime(institutionAttendance.focusPeriod.signedOutAt)
      : '还未签退',
    formatAttendanceTime(currentAttendance?.employeeSignedInAt),
    currentAttendance?.employeeSignedOutAt
      ? formatAttendanceTime(currentAttendance.employeeSignedOutAt)
      : '还未签退',
  ]
  const requestedPermission = requiredPermissionForView(requestedActiveView)
  const requestedWorkspaceTab = storedWorkspaceTabs.find((tab) => (
    tab.id === requestedWorkspaceTabId
  ))
  const requestedAttendanceRequired = requestedWorkspaceTab?.attendanceRequired ??
    viewRequiresAttendance(requestedActiveView)
  const mayRenderRequestedView = (!requestedPermission || hasPermission(state, requestedPermission)) &&
    (!requestedAttendanceRequired || employeeOnDuty)
  const activeView: ActiveView = mayRenderRequestedView ? requestedActiveView : 'dashboard'
  const workspaceTabs = storedWorkspaceTabs.filter((tab) => {
    const permission = requiredPermissionForView(tab.view)
    return !permission || hasPermission(state, permission)
  })
  const activeWorkspaceTabId = mayRenderRequestedView && workspaceTabs.some((tab) => (
    tab.id === requestedWorkspaceTabId
  )) ? requestedWorkspaceTabId : homeWorkspaceTab.id
  const activeTopNavigation = mayRenderRequestedView ? requestedTopNavigation : '工作台'
  const activeLeaf = mayRenderRequestedView ? requestedLeaf : null

  async function exportArchive(): Promise<void> {
    setArchiveMessage('')
    setArchiveError(false)
    try {
      await onExportArchive()
      setArchiveMessage('演示数据备份已导出。')
    } catch (error) {
      setArchiveError(true)
      setArchiveMessage(error instanceof Error ? error.message : '演示数据备份导出失败。')
    }
  }

  async function importArchive(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setArchiveMessage('')
    setArchiveError(false)
    try {
      await onImportArchive(file)
      setArchiveMessage('演示数据已从备份恢复。')
    } catch (error) {
      setArchiveError(true)
      setArchiveMessage(error instanceof Error ? error.message : '演示数据备份恢复失败。')
    }
  }

  useEffect(() => {
    let active = true
    void serviceRepository.load().then((loaded) => {
      if (!active) return
      setServiceSummary(pendingServiceSummary(loaded))
    })
    return () => {
      active = false
    }
  }, [serviceRepository])

  const handleServiceSummary = useCallback((summary: ServiceSummary) => {
    setServiceSummary(summary)
  }, [])

  const handleAccessStateChange = useCallback(async (next: SimulatorState) => {
    await onAccessStateChange(next)
    setAttendanceClock(clock())
  }, [clock, onAccessStateChange])

  const handleInternalHandoverAuthorization = useCallback(async (
    receiverId: string,
    secret: string,
    occurredAt: string,
  ) => {
    const result = await authorizeInternalHandoverReceiver(state, {
      receiverId,
      secret,
      institutionCode,
      occurredAt,
    })
    await handleAccessStateChange(result.state)
    return result.authorization
  }, [handleAccessStateChange, institutionCode, state])

  const handleOnSiteAuthorization = useCallback(async (
    action: OnSiteAuthorizationAction,
    authorizerId: string,
    secret: string,
    occurredAt: string,
  ) => {
    const result = await authorizeOnSiteAction(state, {
      action,
      authorizerId,
      secret,
      institutionCode,
      occurredAt,
    })
    await handleAccessStateChange(result.state)
    return result.authorization
  }, [handleAccessStateChange, institutionCode, state])

  function activateWorkspaceTab(tab: WorkspaceTab) {
    const attendanceRequired = tab.attendanceRequired ?? viewRequiresAttendance(tab.view)
    if (attendanceRequired && !employeeOnDuty) {
      setAttendanceGateLabel(tab.label)
      setMoreOpen(false)
      setUserMenuOpen(false)
      return
    }
    setActiveWorkspaceTabId(tab.id)
    setActiveTopNavigation(tab.topLabel)
    setActiveLeaf(tab.leafLabel)
    setPlaceholderLabel(tab.placeholderLabel)
    setActiveView(tab.view)
    setMoreOpen(false)
    setUserMenuOpen(false)
  }

  function openPermissionRequest(permission: AccessPermission) {
    setPersonalAccessPermission(permission)
    setPersonalAccessTab('permissions')
    setMoreOpen(false)
    setUserMenuOpen(false)
  }

  function openWorkspaceTab(tab: WorkspaceTab) {
    const requiredPermission = requiredPermissionForView(tab.view)
    if (requiredPermission && !hasPermission(state, requiredPermission)) {
      openPermissionRequest(requiredPermission)
      return
    }
    const attendanceRequired = tab.attendanceRequired ?? viewRequiresAttendance(tab.view)
    if (attendanceRequired && !employeeOnDuty) {
      setAttendanceGateLabel(tab.label)
      setMoreOpen(false)
      setUserMenuOpen(false)
      return
    }
    setWorkspaceTabs((current) => {
      const existingIndex = current.findIndex((candidate) => candidate.id === tab.id)
      if (existingIndex < 0) return [...current, tab]
      return current.map((candidate, index) => index === existingIndex ? tab : candidate)
    })
    activateWorkspaceTab(tab)
  }

  function closeWorkspaceTab(tabId: string) {
    if (tabId === homeWorkspaceTab.id) return
    const tabIndex = workspaceTabs.findIndex((tab) => tab.id === tabId)
    if (tabIndex < 0) return

    const remainingTabs = workspaceTabs.filter((tab) => tab.id !== tabId)
    setWorkspaceTabs((current) => current.filter((tab) => tab.id !== tabId))
    if (activeWorkspaceTabId === tabId) {
      const fallbackTab = remainingTabs[Math.max(0, tabIndex - 1)] ?? homeWorkspaceTab
      activateWorkspaceTab(fallbackTab)
    }
  }

  function openDashboard(topLabel = '工作台') {
    openWorkspaceTab({ ...homeWorkspaceTab, topLabel })
  }

  function openPlaceholder(
    item: ShellLeaf,
    topLabel = '营业渠道',
  ) {
    openWorkspaceTab({
      id: `placeholder:${item.capabilityId}`,
      label: item.label,
      view: 'placeholder',
      topLabel,
      leafLabel: topLabel === '营业渠道' ? item.label : null,
      placeholderLabel: item.label,
      capabilityId: item.capabilityId,
      // 规划中入口只展示产品边界，不执行、保存或伪造业务结果。
      attendanceRequired: false,
    })
  }

  function openLeaf(
    item: ShellLeaf,
    preserveRecommendation = false,
    inheritedPermission?: AccessPermission,
  ) {
    const requiredPermission = item.permission ?? (
      item.view ? requiredPermissionForView(item.view) : inheritedPermission ?? null
    )
    if (requiredPermission && !hasPermission(state, requiredPermission)) {
      openPermissionRequest(requiredPermission)
      return
    }
    if ((item.view === 'service' || item.view === 'channel-product-sales') && !preserveRecommendation) {
      setRecommendationSelection(null)
    }
    if (item.view) {
      openWorkspaceTab({
        id: `view:${item.view}`,
        label: item.label,
        view: item.view,
        topLabel: item.view === 'business-management' || item.view === 'basic-management'
          ? item.label
          : '营业渠道',
        leafLabel: item.label,
        placeholderLabel: '',
        capabilityId: item.capabilityId,
        attendanceRequired: requiredPermission
          ? permissionRequiresAttendance(requiredPermission)
          : viewRequiresAttendance(item.view),
      })
      return
    }
    openPlaceholder(item)
  }

  function openTopNavigation(item: TopNavigationItem) {
    const { label, permission } = item
    if (!hasPermission(state, permission)) {
      openPermissionRequest(permission)
      return
    }
    if (label === '工作台' || label === '营业渠道') {
      openDashboard(label)
      return
    }
    if (label === '账务处理') {
      openWorkspaceTab({
        id: 'view:personal-remittance',
        label: '账务处理',
        view: 'personal-remittance',
        topLabel: '账务处理',
        leafLabel: '缴款处理',
        placeholderLabel: '',
        capabilityId: item.capabilityId,
        attendanceRequired: false,
      })
      return
    }
    openPlaceholder(item, label)
  }

  function openAttendanceWorkspace(): void {
    setAttendanceGateLabel(null)
    setLogoutPrompt(null)
    openWorkspaceTab({
      id: 'view:business-management',
      label: '签到签退',
      view: 'business-management',
      topLabel: '业务管理',
      leafLabel: '签到签退查询',
      placeholderLabel: '',
      attendanceRequired: false,
    })
  }

  function requestLogout(): void {
    setUserMenuOpen(false)
    if (currentAttendance && !currentAttendance.employeeSignedOutAt) {
      setLogoutPrompt('open-attendance')
      return
    }
    if (!currentAttendance) {
      setLogoutPrompt('not-attended')
      return
    }
    void onLogout()
  }

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  return (
    <div className="simulator-shell">
      <header className="shell-header">
        <div className="shell-brand">
          <div>
            <strong>本地寄递演练</strong>
            <WorkbenchClock clock={clock} />
          </div>
        </div>

        <nav aria-label="全局业务导航" className="shell-global-navigation">
          {topNavigation.map((item) => {
            const { icon, label, permission } = item
            const authorized = hasPermission(state, permission)
            return (
              <button
                aria-current={activeTopNavigation === label ? 'page' : undefined}
                aria-label={authorized ? label : `${label}（未授权，点击申请）`}
                className={`${activeTopNavigation === label ? 'shell-global-link shell-global-link--active' : 'shell-global-link'}${authorized ? '' : ' shell-global-link--locked'}`}
                key={label}
                onClick={() => openTopNavigation(item)}
                type="button"
              >
                {icon ? <ShellIcon className="shell-global-icon" name={icon} /> : null}
                {label}
                {!authorized ? <small className="shell-access-mark">未授权</small> : null}
              </button>
            )
          })}
        </nav>

        <div className="shell-launcher">
          <button
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            aria-label="展开更多栏目"
            className="shell-launcher-button"
            onClick={() => {
              setMoreOpen((current) => !current)
              setUserMenuOpen(false)
            }}
            type="button"
          >
            <span aria-hidden="true" className="nine-grid">
              {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
            </span>
          </button>
          {moreOpen ? (
            <div aria-label="更多栏目" className="shell-popover shell-applications" role="menu">
              {moreApplications.map((item) => {
                const permission = item.permission ?? (item.view
                  ? requiredPermissionForView(item.view)
                  : null)
                const authorized = !permission || hasPermission(state, permission)
                return (
                  <button className={authorized ? '' : 'shell-application--locked'} key={item.label} onClick={() => openLeaf(item)} role="menuitem" type="button">
                    <span aria-hidden="true">{item.label.slice(0, 1)}</span>
                    {item.label}
                    {!authorized ? <small>未授权</small> : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        <dl aria-label="机构与员工签到时间" className="shell-attendance" role="group">
          {attendanceLabels.map((label, index) => (
            <div className="shell-attendance-item" key={label}>
              <dt>{label}</dt>
              <dd>{attendanceTimes[index]}</dd>
            </div>
          ))}
        </dl>

        <div className="shell-user-menu">
          <button
            aria-label={`人员信息：${institutionName} ${institutionCode}，台席 ${state.session?.workstationCode ?? '--'}，欢迎 ${displayName}，工号 ${state.operator.id}`}
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            className="shell-user-trigger"
            onClick={() => {
              setUserMenuOpen((current) => !current)
              setMoreOpen(false)
            }}
            type="button"
          >
            <span className="shell-user-matrix">
              <span className="shell-user-column">
                <strong>{institutionName} {institutionCode}</strong>
                <small>台席：{state.session?.workstationCode ?? '--'}</small>
              </span>
              <span className="shell-user-column">
                <strong>欢迎 {displayName}</strong>
                <small>工号：{state.operator.id}</small>
              </span>
            </span>
            <span aria-hidden="true" className="shell-user-chevron">▾</span>
          </button>
          {userMenuOpen ? (
            <div aria-label="人员菜单" className="shell-popover shell-user-popover" role="menu">
              <div>
                <strong>{institutionName} {institutionCode}</strong>
                <small>欢迎 {displayName}</small>
                <small>台席：{state.session?.workstationCode ?? '--'} · 工号：{state.operator.id}</small>
              </div>
              <input
                accept="application/json,.json"
                aria-label="选择演示数据备份文件"
                className="sr-only"
                onChange={(event) => void importArchive(event)}
                ref={archiveInputRef}
                type="file"
              />
              <button onClick={() => void exportArchive()} role="menuitem" type="button">
                导出演示数据
              </button>
              <button onClick={() => archiveInputRef.current?.click()} role="menuitem" type="button">
                导入演示数据
              </button>
              <button onClick={() => { setPersonalAccessPermission(null); setPersonalAccessTab('profile'); setUserMenuOpen(false) }} role="menuitem" type="button">
                个人设置
              </button>
              <button onClick={() => { setPersonalAccessPermission(null); setPersonalAccessTab('permissions'); setUserMenuOpen(false) }} role="menuitem" type="button">
                我的岗位与权限
              </button>
              <button onClick={() => { setPersonalAccessPermission(null); setPersonalAccessTab('requests'); setUserMenuOpen(false) }} role="menuitem" type="button">
                我的申请
              </button>
              <button onClick={openAttendanceWorkspace} role="menuitem" type="button">
                签到签退
              </button>
              <button onClick={() => { setUserMenuOpen(false); onChangeSecret() }} role="menuitem" type="button">
                修改密码
              </button>
              {archiveMessage ? (
                <output
                  className={archiveError ? 'shell-archive-message shell-archive-message--error' : 'shell-archive-message'}
                >
                  {archiveMessage}
                </output>
              ) : null}
              <button onClick={() => void onReset()} role="menuitem" type="button">
                恢复初始数据
              </button>
              <button onClick={requestLogout} role="menuitem" type="button">
                退出系统
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="shell-body">
        <aside className="shell-sidebar">
          <div className="shell-sidebar-heading">营业渠道</div>
          <nav aria-label="营业渠道功能菜单" className="shell-accordion-navigation">
            {navigationGroups.map((group) => {
              const expanded = expandedGroups.has(group.id)
              const groupActive = group.children.some((item) => item.label === activeLeaf) ||
                group.entry?.label === activeLeaf
              const groupAuthorized = hasPermission(state, group.permission)
              return (
                <div className="shell-menu-group" key={group.id}>
                  <button
                    aria-controls={group.children.length > 0 ? `shell-menu-${group.id}` : undefined}
                    aria-expanded={group.children.length > 0 ? expanded : undefined}
                    className={`${groupActive ? 'shell-parent-item shell-parent-item--active' : 'shell-parent-item'}${groupAuthorized ? '' : ' shell-parent-item--locked'}`}
                    onClick={() => group.children.length > 0
                      ? toggleGroup(group.id)
                      : group.entry && openLeaf(group.entry, false, group.permission)}
                    type="button"
                  >
                    <ShellIcon
                      className={`shell-menu-icon shell-menu-icon--${group.id}`}
                      name={group.icon}
                    />
                    <span>{group.label}{!groupAuthorized ? <small className="shell-access-mark">未授权</small> : null}</span>
                    {group.children.length > 0 ? (
                      <span aria-hidden="true" className={expanded ? 'shell-menu-chevron shell-menu-chevron--open' : 'shell-menu-chevron'}>›</span>
                    ) : null}
                  </button>
                  {expanded ? (
                    <div className="shell-child-menu" id={`shell-menu-${group.id}`}>
                      {group.children.map((item) => {
                        const permission = item.permission ?? (item.view
                          ? requiredPermissionForView(item.view)
                          : group.permission)
                        const authorized = !permission || hasPermission(state, permission)
                        return (
                          <button
                            aria-current={item.label === activeLeaf ? 'page' : undefined}
                            aria-label={authorized ? item.label : `${item.label}（未授权，点击申请）`}
                            className={`${item.label === activeLeaf ? 'shell-child-item shell-child-item--active' : 'shell-child-item'}${authorized ? '' : ' shell-child-item--locked'}`}
                            key={item.label}
                            onClick={() => openLeaf(item, false, group.permission)}
                            type="button"
                          >
                            {item.label}
                            {!authorized ? <small className="shell-access-mark">未授权</small> : null}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </nav>
        </aside>

        <main className="shell-content">
          <nav aria-label="已打开工作页" className="workspace-tabs">
            {workspaceTabs.map((tab) => {
              const active = tab.id === activeWorkspaceTabId
              return (
                <div
                  className={active ? 'workspace-tab workspace-tab--active' : 'workspace-tab'}
                  key={tab.id}
                >
                  <button
                    aria-current={active ? 'page' : undefined}
                    className="workspace-tab-select"
                    onClick={() => activateWorkspaceTab(tab)}
                    type="button"
                  >
                    {tab.label}
                  </button>
                  {tab.id !== homeWorkspaceTab.id ? (
                    <button
                      aria-label={`关闭${tab.label}选项卡`}
                      className="workspace-tab-close"
                      onClick={() => closeWorkspaceTab(tab.id)}
                      type="button"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              )
            })}
          </nav>

          {!employeeOnDuty ? (
            <div className="shell-duty-banner" role="status">
              <strong>{employeeDuty.statusLabel}</strong>
              <span>业务办理与生产处理已暂停；请由有权限的管理人员人工完成机构签到，再由当前员工本人签到。系统直接使用当前真实时间，不再提供测试值守绕行。</span>
              <div className="shell-duty-actions">
                <button onClick={openAttendanceWorkspace} type="button">前往签到签退</button>
              </div>
            </div>
          ) : null}

          <div className={activeView !== 'dashboard' && activeView !== 'placeholder'
            ? 'shell-page-stage shell-page-stage--intake'
            : 'shell-page-stage'}>
            <Suspense fallback={<p aria-live="polite" role="status">正在加载工作区……</p>}>
              {activeView === 'bulk' ? (
              <BulkIntakeWorkspace
                customerRepository={customerRepository}
                institutionCode={institutionCode}
                onBack={() => openDashboard()}
                operator={{
                  operatorId: state.operator.id,
                  displayName,
                  workstationCode: state.session?.workstationCode ?? '01',
                  acceptanceOffice: institutionName,
                  receivingOffice: '虚构寄达局',
                }}
                serviceRepository={serviceRepository}
              />
            ) : activeView === 'self-service-import' ? (
              <SelfServiceBatchImportWorkspace
                onBack={() => openDashboard()}
                onSummaryChange={handleServiceSummary}
                operator={{
                  operatorId: state.operator.id,
                  displayName,
                  workstationCode: state.session?.workstationCode ?? '01',
                  acceptanceOffice: institutionName,
                  receivingOffice: '虚构寄达局',
                }}
                serviceRepository={serviceRepository}
              />
            ) : activeView === 'recommendation' ? (
              <RecommendationWorkspace
                onBack={() => openDashboard()}
                onSelect={(selection) => {
                  setRecommendationSelection(selection)
                  openLeaf({
                    capabilityId: 'channel.business.intake',
                    label: '综合受理',
                    view: 'service',
                  }, true)
                }}
                repository={customerRepository}
              />
            ) : activeView === 'service' || activeView === 'channel-product-sales' ? (
            <CustomerIntakeWorkspace
              initialRecommendation={recommendationSelection}
              initialServiceTab={activeView === 'channel-product-sales' ? 'channel-products' : undefined}
              onBack={() => openDashboard()}
              onOpenSettlement={() => {
                openWorkspaceTab({
                  id: 'view:settlement',
                  label: '结算中心',
                  view: 'settlement',
                  topLabel: '营业渠道',
                  leafLabel: '结算处理',
                  placeholderLabel: '',
                })
              }}
              onServiceSummaryChange={handleServiceSummary}
              repository={customerRepository}
              serviceRepository={serviceRepository}
            />
          ) : activeView === 'settlement' ? (
            <SettlementWorkspace
              onBack={() => {
                openLeaf({
                  capabilityId: 'channel.business.intake',
                  label: '综合受理',
                  view: 'service',
                })
              }}
              onSummaryChange={handleServiceSummary}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'personal-remittance' ? (
            <AccountingWorkspace
              canManageInstitution={hasPermission(
                state,
                'management.business.attendance.operate',
              )}
              institutionCode={institutionCode}
              institutionName={institutionName}
              onBack={() => openDashboard('账务处理')}
              onOpenSettlement={() => {
                openWorkspaceTab({
                  id: 'view:settlement',
                  label: '结算中心',
                  view: 'settlement',
                  topLabel: '营业渠道',
                  leafLabel: '结算处理',
                  placeholderLabel: '',
                })
              }}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'correction' ? (
            <TransactionQueryWorkspace
              authorizeOnSite={handleOnSiteAuthorization}
              onBack={() => openDashboard()}
              onSummaryChange={handleServiceSummary}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'channel-product-query' ? (
            <ChannelProductQueryWorkspace
              authorizeOnSite={handleOnSiteAuthorization}
              onBack={() => openDashboard()}
              onSummaryChange={handleServiceSummary}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'refund-pending' ? (
            <RefundPendingWorkspace
              authorizeOnSite={handleOnSiteAuthorization}
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'return-receipt' ? (
            <ReturnReceiptWorkspace
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'reply-coupon' ? (
            <ReplyCouponWorkspace
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'mail-handover' ? (
            <MailHandoverWorkspace
              authorizeInternalHandover={handleInternalHandoverAuthorization}
              canHandOverLoose={hasPermission(
                state,
                'workspace.channel.dispatch.handover-out',
              )}
              canProcessReceivedMail={hasPermission(
                state,
                'workspace.channel.dispatch.handover-in',
              )}
              institutionCode={institutionCode}
              receivingEmployees={internalHandoverReceivers}
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
                institutionCode,
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'mail-sealing' ? (
            <MailSealingWorkspace
              institutionCode={institutionCode}
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'dispatch-route' ? (
            <DispatchRouteWorkspace
              onBack={() => openDashboard()}
              onOpenPrint={() => {
                openWorkspaceTab({
                  id: 'view:dispatch-print',
                  label: '路单/清单打印',
                  view: 'dispatch-print',
                  topLabel: '营业渠道',
                  leafLabel: '路单/清单打印',
                  placeholderLabel: '',
                })
              }}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'dispatch-print' ? (
            <DispatchPrintWorkspace
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'dispatch-export' ? (
            <DispatchTripExportWorkspace
              authorizeOnSite={handleOnSiteAuthorization}
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'dispatch-query' ? (
            <DispatchQueryWorkspace
              institutionCode={institutionCode}
              institutionName={institutionName}
              onBack={() => openDashboard()}
              repository={serviceRepository}
            />
          ) : activeView === 'dispatch-interchange-return' ? (
            <DispatchBagInterchangeReturnWorkspace
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'postage-meter-batch' ||
              activeView === 'postage-meter-registration' ||
              activeView === 'postage-meter-balance' ||
              activeView === 'postage-meter-daily' ||
              activeView === 'postage-meter-maintenance' ? (
            <PostageMeterWorkspace
              authorizeOnSite={handleOnSiteAuthorization}
              institutionCode={institutionCode}
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
              section={activeView === 'postage-meter-batch'
                ? 'batch'
                : activeView === 'postage-meter-registration'
                  ? 'registration'
                  : activeView === 'postage-meter-balance'
                    ? 'balance'
                    : activeView === 'postage-meter-daily'
                      ? 'daily'
                       : 'maintenance'}
            />
          ) : activeView === 'postage-meter-handover-out' ||
              activeView === 'postage-meter-handover-in' ||
              activeView === 'postage-meter-funding' ||
              activeView === 'postage-meter-repair' ||
              activeView === 'postage-meter-handover-history' ||
              activeView === 'postage-meter-usage-ledger' ? (
            <PostageMeterOperationsWorkspace
              institutionCode={institutionCode}
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
              section={activeView === 'postage-meter-handover-out'
                ? 'handover-out'
                : activeView === 'postage-meter-handover-in'
                  ? 'handover-in'
                  : activeView === 'postage-meter-funding'
                    ? 'funding'
                    : activeView === 'postage-meter-repair'
                      ? 'repair'
                      : activeView === 'postage-meter-handover-history'
                        ? 'handover-history'
                        : 'usage-ledger'}
            />
          ) : activeView === 'special-handling-application' ||
              activeView === 'special-handling-status' ? (
            <SpecialHandlingWorkspace
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
              section={activeView === 'special-handling-application' ? 'application' : 'status'}
            />
          ) : activeView === 'window-delivery-import' ||
              activeView === 'window-delivery-supplement' ||
              activeView === 'window-delivery-return-receive' ||
              activeView === 'window-delivery-transfer-receive' ||
              activeView === 'window-delivery-maintenance' ||
              activeView === 'window-delivery-transfer' ||
              activeView === 'window-delivery-reminder' ||
              activeView === 'window-delivery-cancellation' ||
              activeView === 'window-delivery-balance' ||
              activeView === 'window-delivery-query' ? (
            <WindowDeliveryWorkspace
              authorizeOnSite={handleOnSiteAuthorization}
              key={activeView}
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
              section={activeView === 'window-delivery-import'
                ? 'import'
                : activeView === 'window-delivery-supplement'
                  ? 'supplement'
                  : activeView === 'window-delivery-return-receive'
                    ? 'delivery-return'
                    : activeView === 'window-delivery-transfer-receive'
                      ? 'delivery-to-window'
                      : activeView === 'window-delivery-maintenance'
                        ? 'maintenance'
                        : activeView === 'window-delivery-transfer'
                          ? 'transfer'
                          : activeView === 'window-delivery-reminder'
                            ? 'reminder'
                            : activeView === 'window-delivery-cancellation'
                              ? 'cancellation'
                              : activeView === 'window-delivery-balance'
                                ? 'balance'
                                : 'query'}
            />
          ) : activeView === 'postal-supply-inbound' ||
              activeView === 'postal-supply-requisition' ||
              activeView === 'postal-supply-approval' ||
              activeView === 'postal-supply-receipt' ||
              activeView === 'postal-supply-issue' ||
              activeView === 'postal-supply-return' ||
              activeView === 'postal-supply-inventory' ||
              activeView === 'postal-supply-balance' ||
              activeView === 'postal-supply-sales' ? (
            <PostalSupplyManagementWorkspace
              authorizeOnSite={handleOnSiteAuthorization}
              institutionCode={institutionCode}
              key={activeView}
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
              section={activeView === 'postal-supply-inbound'
                ? 'inbound'
                : activeView === 'postal-supply-requisition'
                  ? 'requisition'
                  : activeView === 'postal-supply-approval'
                    ? 'approval'
                    : activeView === 'postal-supply-receipt'
                      ? 'receipt'
                      : activeView === 'postal-supply-issue'
                        ? 'issue'
                        : activeView === 'postal-supply-return'
                          ? 'return'
                          : activeView === 'postal-supply-inventory'
                            ? 'inventory'
                            : activeView === 'postal-supply-balance'
                              ? 'balance'
                              : 'sales'}
            />
          ) : activeView === 'points-inventory' ? (
            <PointsInventoryWorkspace
              clock={clock}
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'invoice-legacy-red-flush' ||
              activeView === 'invoice-financial-red-flush' ? (
            <InvoiceManagementWorkspace
              authorizeOnSite={handleOnSiteAuthorization}
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
              section={activeView === 'invoice-legacy-red-flush' ? 'legacy' : 'financial'}
            />
          ) : activeView === 'query-third-party-payment' ||
              activeView === 'query-front-desk-log' ||
              activeView === 'query-mail-tracking' ||
              activeView === 'query-accepted-mail' ? (
            <ChannelQueryWorkspace
              authorizeOnSite={handleOnSiteAuthorization}
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
              section={activeView === 'query-third-party-payment'
                ? 'third-party-payment'
                : activeView === 'query-front-desk-log'
                  ? 'front-desk-log'
                  : activeView === 'query-mail-tracking'
                    ? 'mail-tracking'
                    : 'accepted-mail'}
            />
          ) : activeView === 'query-post-route-comparison' ||
              activeView === 'query-network-export-relationship' ||
              activeView === 'query-branch-export-relationship' ? (
            <RoutingRelationshipWorkspace
              onBack={() => openDashboard()}
              section={activeView === 'query-post-route-comparison'
                ? 'post-route-comparison'
                : activeView === 'query-network-export-relationship'
                  ? 'network-export-relationship'
                  : 'branch-export-relationship'}
            />
          ) : activeView === 'query-vehicle-dispatch' ? (
            <VehicleDispatchQueryWorkspace
              onBack={() => openDashboard()}
              repository={serviceRepository}
            />
          ) : activeView === 'query-spot-check-exercise' ? (
            <SpotCheckExerciseWorkspace
              institutionCode={institutionCode}
              institutionName={institutionName}
              onBack={() => openDashboard()}
              operator={{
                operatorId: state.operator.id,
                displayName,
                workstationCode: state.session?.workstationCode ?? '01',
                acceptanceOffice: institutionName,
                receivingOffice: '虚构寄达局',
              }}
              repository={serviceRepository}
            />
          ) : activeView === 'query-postal-administrative' ? (
            <PostalAdministrativeQueryWorkspace onBack={() => openDashboard()} />
          ) : activeView === 'query-business-customer' ? (
            <BusinessCustomerQueryWorkspace
              clock={clock}
              onBack={() => openDashboard()}
              repository={customerRepository}
            />
          ) : activeView === 'capability-matrix' ? (
            <CapabilityMatrixWorkspace onBack={() => openDashboard()} />
          ) : activeView === 'business-management' ? (
            <BusinessManagementWorkspace
              onBack={() => openDashboard()}
              onOpenPersonalRemittance={() => {
                openWorkspaceTab({
                  id: 'view:personal-remittance',
                  label: '账务处理',
                  view: 'personal-remittance',
                  topLabel: '账务处理',
                  leafLabel: '缴款处理',
                  placeholderLabel: '',
                  attendanceRequired: false,
                })
              }}
              onStateChange={handleAccessStateChange}
              pendingBusinessCount={serviceSummary.count}
              pendingBusinessTotalCents={serviceSummary.totalCents}
              serviceRepository={serviceRepository}
              state={state}
            />
          ) : activeView === 'basic-management' ? (
            <BasicManagementWorkspace
              onBack={() => openDashboard()}
              onStateChange={handleAccessStateChange}
              repository={serviceRepository}
              state={state}
            />
          ) : activeView === 'placeholder' ? (
            <CapabilityBoundaryWorkspace
              capabilityId={requestedWorkspaceTab?.capabilityId ?? ''}
              fallbackLabel={placeholderLabel}
              onBack={() => openDashboard()}
            />
          ) : (
            <HomeDashboard summary={serviceSummary} />
              )}
            </Suspense>
          </div>
        </main>
      </div>
      {personalAccessTab ? (
        <PersonalAccessDialog
          initialPermission={personalAccessPermission}
          initialTab={personalAccessTab}
          onClose={() => {
            setPersonalAccessTab(null)
            setPersonalAccessPermission(null)
          }}
          onStateChange={handleAccessStateChange}
          state={state}
        />
      ) : null}
      {attendanceGateLabel ? (
        <Modal compact eyebrow="上岗校验" title="当前员工未处于有效签到状态">
          <div className="modal-form shell-gate-dialog">
            <p><strong>{attendanceGateLabel}</strong> 属于业务办理或生产处理功能，正常办理必须同时满足机构有效签到和员工本人签到。</p>
            <p>当前状态：{employeeDuty.statusLabel}。</p>
            <p>机构签到、员工签到和所有主管审批均需由真实登录人员手工确认；当前时间不会触发模拟值守或自动考勤。</p>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setAttendanceGateLabel(null)} type="button">取消</button>
              <button className="secondary-button" onClick={openAttendanceWorkspace} type="button">前往签到签退</button>
            </div>
          </div>
        </Modal>
      ) : null}
      {logoutPrompt ? (
        <Modal
          compact
          eyebrow="退出确认"
          title={logoutPrompt === 'open-attendance' ? '当前员工尚未签退' : '今日尚未签到'}
        >
          <div className="modal-form shell-gate-dialog">
            <p>{logoutPrompt === 'open-attendance'
              ? '退出系统不会代替员工签退。建议先核对待结算业务和邮件交接，再完成员工签退。'
              : '当前会话没有今天的员工签到记录；退出只会结束系统会话，不会生成任何签到或审批记录。'}</p>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setLogoutPrompt(null)} type="button">取消</button>
              {logoutPrompt === 'open-attendance' ? <button className="secondary-button" onClick={openAttendanceWorkspace} type="button">返回签到签退</button> : null}
              <button className="primary-button primary-button--compact" onClick={() => void onLogout()} type="button">{logoutPrompt === 'open-attendance' ? '仅退出系统' : '继续退出'}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
