import type { ShellIconName } from './ShellIcon'
import type { AccessPermission } from '../../domain/access/types'
import {
  getCapabilityLabel,
  type PublicCapabilityId,
} from './capabilityNavigation.generated'

/**
 * 工作台可打开视图的稳定标识。
 *
 * 标识只描述导航目标，不承担组件装配。新增功能时，应先在这里登记，
 * 再由工作台渲染层接入对应的功能工作区。
 */
export type ActiveView =
  | 'dashboard'
  | 'recommendation'
  | 'bulk'
  | 'self-service-import'
  | 'service'
  | 'channel-product-sales'
  | 'correction'
  | 'settlement'
  | 'personal-remittance'
  | 'refund-pending'
  | 'return-receipt'
  | 'reply-coupon'
  | 'channel-product-query'
  | 'mail-handover'
  | 'mail-sealing'
  | 'dispatch-route'
  | 'dispatch-print'
  | 'dispatch-export'
  | 'dispatch-query'
  | 'dispatch-interchange-return'
  | 'postage-meter-batch'
  | 'postage-meter-registration'
  | 'postage-meter-balance'
  | 'postage-meter-daily'
  | 'postage-meter-maintenance'
  | 'postage-meter-handover-out'
  | 'postage-meter-handover-in'
  | 'postage-meter-funding'
  | 'postage-meter-repair'
  | 'postage-meter-handover-history'
  | 'postage-meter-usage-ledger'
  | 'special-handling-application'
  | 'special-handling-status'
  | 'window-delivery-import'
  | 'window-delivery-supplement'
  | 'window-delivery-return-receive'
  | 'window-delivery-transfer-receive'
  | 'window-delivery-maintenance'
  | 'window-delivery-transfer'
  | 'window-delivery-reminder'
  | 'window-delivery-cancellation'
  | 'window-delivery-balance'
  | 'window-delivery-query'
  | 'postal-supply-inbound'
  | 'postal-supply-requisition'
  | 'postal-supply-approval'
  | 'postal-supply-receipt'
  | 'postal-supply-issue'
  | 'postal-supply-return'
  | 'postal-supply-inventory'
  | 'postal-supply-balance'
  | 'postal-supply-sales'
  | 'points-inventory'
  | 'invoice-legacy-red-flush'
  | 'invoice-financial-red-flush'
  | 'query-third-party-payment'
  | 'query-front-desk-log'
  | 'query-mail-tracking'
  | 'query-accepted-mail'
  | 'query-post-route-comparison'
  | 'query-network-export-relationship'
  | 'query-branch-export-relationship'
  | 'query-vehicle-dispatch'
  | 'query-spot-check-exercise'
  | 'query-postal-administrative'
  | 'query-business-customer'
  | 'capability-matrix'
  | 'business-management'
  | 'basic-management'
  | 'placeholder'

type OperationalView = Exclude<ActiveView, 'dashboard' | 'placeholder'>

export interface WorkspaceTab {
  id: string
  label: string
  view: ActiveView
  topLabel: string
  leafLabel: string | null
  placeholderLabel: string
  capabilityId?: PublicCapabilityId
  attendanceRequired?: boolean
}

export interface ShellLeaf {
  capabilityId: PublicCapabilityId
  label: string
  view?: OperationalView
  permission?: AccessPermission
}

export interface ShellGroup {
  id: string
  label: string
  icon: ShellIconName
  permission: AccessPermission
  children: ShellLeaf[]
  entry?: ShellLeaf
}

export interface TopNavigationItem extends ShellLeaf {
  icon?: ShellIconName
  permission: AccessPermission
}

function leaf(
  capabilityId: PublicCapabilityId,
  view?: OperationalView,
  permission?: AccessPermission,
): ShellLeaf {
  return {
    capabilityId,
    label: getCapabilityLabel(capabilityId),
    ...(view ? { view } : {}),
    ...(permission ? { permission } : {}),
  }
}

function top(
  capabilityId: PublicCapabilityId,
  permission: AccessPermission,
  icon?: ShellIconName,
): TopNavigationItem {
  return {
    ...leaf(capabilityId),
    permission,
    ...(icon ? { icon } : {}),
  }
}

export const topNavigation: ReadonlyArray<TopNavigationItem> = [
  top('top.dashboard', 'workspace.dashboard', 'workbench'),
  top('top.favorites', 'workspace.dashboard'),
  top('top.channel', 'workspace.channel.access'),
  top('top.periodicals', 'workspace.periodicals'),
  top('top.accounting', 'workspace.accounting'),
  top('top.philately', 'workspace.philately'),
]

export const moreApplications: ShellLeaf[] = [
  leaf('more.distribution', undefined, 'workspace.distribution'),
  leaf('more.points', undefined, 'workspace.channel.points'),
  leaf('more.settlement', 'settlement', 'workspace.channel.core'),
  leaf('more.analytics', undefined, 'workspace.accounting'),
  leaf('management.business', 'business-management', 'management.business.access'),
  leaf('management.basic', 'basic-management', 'management.basic.access'),
]

export const attendanceLabels = ['机构签到', '机构签退', '员工签到', '员工签退'] as const

/** 不打开独立工作区、但在工作台壳层直接提供的用户能力。 */
export const shellUtilities: ReadonlyArray<ShellLeaf> = []

export const homeWorkspaceTab: WorkspaceTab = {
  id: 'dashboard',
  label: '主页',
  view: 'dashboard',
  topLabel: '工作台',
  leafLabel: null,
  placeholderLabel: '',
  capabilityId: 'top.dashboard',
  attendanceRequired: false,
}

/** 只描述信息架构；业务组件及其依赖仍由工作台渲染层装配。 */
export const navigationGroups: ShellGroup[] = [
  {
    id: 'business',
    label: '业务办理',
    icon: 'business',
    permission: 'workspace.channel.core',
    children: [
      leaf('channel.business.recommendation', 'recommendation'),
      leaf('channel.business.intake', 'service'),
      leaf('channel.business.bulk', 'bulk', 'workspace.channel.bulk'),
      leaf('channel.business.overlay-entry'),
      leaf('channel.business.commercial-bulk'),
      leaf('channel.business.public-welfare-bulk'),
      leaf('channel.business.correction', 'correction'),
      leaf('channel.business.refund', 'refund-pending'),
      leaf('channel.business.return-receipt', 'return-receipt'),
      leaf('channel.business.reply-coupon'),
      leaf('channel.business.self-service-import', 'self-service-import'),
      leaf('channel.business.settlement-correction'),
      leaf('channel.business.channel-sales-entry', 'channel-product-sales'),
      leaf('channel.business.channel-sales-query', 'channel-product-query'),
      leaf('channel.business.insurance', undefined, 'workspace.insurance'),
    ],
  },
  {
    id: 'dispatch',
    label: '邮件封发',
    icon: 'dispatch',
    permission: 'workspace.channel.dispatch',
    children: [
      leaf('channel.dispatch.handover', 'mail-handover', 'workspace.channel.dispatch.handover'),
      leaf('channel.dispatch.sealing', 'mail-sealing', 'workspace.channel.dispatch.sealing'),
      leaf('channel.dispatch.route', 'dispatch-route', 'workspace.channel.dispatch.routing'),
      leaf('channel.dispatch.print', 'dispatch-print', 'workspace.channel.dispatch.routing'),
      leaf('channel.dispatch.export', 'dispatch-export', 'workspace.channel.dispatch.transport'),
      leaf('channel.dispatch.query', 'dispatch-query', 'workspace.channel.dispatch.query'),
      leaf('channel.dispatch.interchange-return', 'dispatch-interchange-return', 'workspace.channel.dispatch.interchange-return'),
    ],
  },
  {
    id: 'special',
    label: '特殊处理',
    icon: 'special',
    permission: 'workspace.channel.special',
    children: [
      leaf('channel.special.application', 'special-handling-application'),
      leaf('channel.special.status', 'special-handling-status'),
    ],
  },
  {
    id: 'counter',
    label: '窗投业务',
    icon: 'counter',
    permission: 'workspace.channel.window-delivery',
    children: [
      leaf('channel.window.import', 'window-delivery-import'),
      leaf('channel.window.supplement', 'window-delivery-supplement'),
      leaf('channel.window.return-receive', 'window-delivery-return-receive'),
      leaf('channel.window.transfer-receive', 'window-delivery-transfer-receive'),
      leaf('channel.window.maintenance', 'window-delivery-maintenance'),
      leaf('channel.window.transfer', 'window-delivery-transfer'),
      leaf('channel.window.reminder', 'window-delivery-reminder'),
      leaf('channel.window.cancellation', 'window-delivery-cancellation'),
      leaf('channel.window.balance', 'window-delivery-balance'),
      leaf('channel.window.query', 'window-delivery-query'),
    ],
  },
  {
    id: 'meter',
    label: '邮资机业务',
    icon: 'meter',
    permission: 'workspace.channel.postage-meter',
    children: [
      leaf('channel.meter.handover-out', 'postage-meter-handover-out'),
      leaf('channel.meter.handover-in', 'postage-meter-handover-in'),
      leaf('channel.meter.batch', 'postage-meter-batch'),
      leaf('channel.meter.registration', 'postage-meter-registration'),
      leaf('channel.meter.balance', 'postage-meter-balance'),
      leaf('channel.meter.daily', 'postage-meter-daily'),
      leaf('channel.meter.funding', 'postage-meter-funding'),
      leaf('channel.meter.repair', 'postage-meter-repair'),
      leaf('channel.meter.maintenance', 'postage-meter-maintenance'),
      leaf('channel.meter.handover-history', 'postage-meter-handover-history'),
      leaf('channel.meter.usage-ledger', 'postage-meter-usage-ledger'),
    ],
  },
  {
    id: 'supplies',
    label: '用邮物品管理',
    icon: 'supplies',
    permission: 'workspace.channel.postal-supply',
    children: [
      leaf('channel.supplies.inbound', 'postal-supply-inbound'),
      leaf('channel.supplies.requisition', 'postal-supply-requisition'),
      leaf('channel.supplies.approval', 'postal-supply-approval'),
      leaf('channel.supplies.receipt', 'postal-supply-receipt'),
      leaf('channel.supplies.issue', 'postal-supply-issue'),
      leaf('channel.supplies.return', 'postal-supply-return'),
      leaf('channel.supplies.inventory', 'postal-supply-inventory'),
      leaf('channel.supplies.balance', 'postal-supply-balance'),
      leaf('channel.supplies.sales', 'postal-supply-sales'),
    ],
  },
  {
    id: 'commercial-bill',
    label: '商函账单处理',
    icon: 'commercial-bill',
    permission: 'workspace.channel.core',
    children: [],
    entry: leaf('channel.commercial-bill'),
  },
  {
    id: 'invoice',
    label: '票据管理',
    icon: 'invoice',
    permission: 'workspace.channel.invoice',
    children: [
      leaf('channel.invoice.legacy-red', 'invoice-legacy-red-flush'),
      leaf('channel.invoice.financial-red', 'invoice-financial-red-flush'),
    ],
  },
  {
    id: 'query',
    label: '查询',
    icon: 'query',
    permission: 'workspace.channel.query',
    children: [
      leaf('channel.query.third-party-payment', 'query-third-party-payment'),
      leaf('channel.query.front-desk-log', 'query-front-desk-log'),
      leaf('channel.query.mail-tracking', 'query-mail-tracking'),
      leaf('channel.query.accepted-mail', 'query-accepted-mail'),
      leaf('channel.query.route-comparison', 'query-post-route-comparison'),
      leaf('channel.query.network-export', 'query-network-export-relationship'),
      leaf('channel.query.branch-export', 'query-branch-export-relationship'),
      leaf('channel.query.vehicle-dispatch', 'query-vehicle-dispatch'),
      leaf('channel.query.spot-check', 'query-spot-check-exercise'),
      leaf('channel.query.postal-administrative', 'query-postal-administrative'),
      leaf('channel.query.inspection-mailbox'),
      leaf('channel.query.customer', 'query-business-customer'),
      leaf('channel.query.offline-loan'),
    ],
  },
  {
    id: 'points',
    label: '积分业务',
    icon: 'points',
    permission: 'workspace.channel.points',
    children: [
      leaf('channel.points.inventory', 'points-inventory'),
      leaf('channel.points.redemption'),
      leaf('channel.points.history'),
      leaf('channel.points.statistics'),
    ],
  },
  {
    id: 'help',
    label: '帮助中心',
    icon: 'help',
    permission: 'workspace.dashboard',
    children: [
      leaf('help.capability-matrix', 'capability-matrix'),
      leaf('help.operation'),
    ],
  },
]

export function requiredPermissionForView(view: ActiveView): AccessPermission | null {
  if (view === 'dashboard' || view === 'placeholder') return 'workspace.dashboard'
  if (view === 'capability-matrix') return 'workspace.dashboard'
  if (view === 'business-management') return 'management.business.access'
  if (view === 'basic-management') return 'management.basic.access'
  if (view === 'personal-remittance') return 'workspace.accounting'
  if (view === 'bulk') return 'workspace.channel.bulk'
  if (view === 'mail-handover') return 'workspace.channel.dispatch.handover'
  if (view === 'mail-sealing') return 'workspace.channel.dispatch.sealing'
  if (view === 'dispatch-route' || view === 'dispatch-print') {
    return 'workspace.channel.dispatch.routing'
  }
  if (view === 'dispatch-export') return 'workspace.channel.dispatch.transport'
  if (view === 'dispatch-query') return 'workspace.channel.dispatch.query'
  if (view === 'dispatch-interchange-return') {
    return 'workspace.channel.dispatch.interchange-return'
  }
  if (view.startsWith('postage-meter-')) return 'workspace.channel.postage-meter'
  if (view.startsWith('special-handling-')) return 'workspace.channel.special'
  if (view.startsWith('window-delivery-')) return 'workspace.channel.window-delivery'
  if (view.startsWith('postal-supply-')) return 'workspace.channel.postal-supply'
  if (view.startsWith('points-')) return 'workspace.channel.points'
  if (view.startsWith('invoice-')) return 'workspace.channel.invoice'
  if (view.startsWith('query-')) return 'workspace.channel.query'
  return 'workspace.channel.core'
}

export function permissionRequiresAttendance(permission: AccessPermission): boolean {
  return permission.startsWith('workspace.') &&
    permission !== 'workspace.dashboard' &&
    permission !== 'workspace.channel.query'
}

export function viewRequiresAttendance(view: ActiveView): boolean {
  if (view === 'dashboard' ||
      view === 'placeholder' ||
      view === 'capability-matrix' ||
      view === 'business-management' ||
      view === 'basic-management' ||
      view === 'personal-remittance' ||
      view.startsWith('query-')) return false
  return true
}
