import { businessCalendarDay } from '../shared/businessTime'
import {
  queryDispatchVehicleRoutes,
  queryUngeneratedDispatchBags,
  SIMULATED_POST_ROUTES,
  type SimulatedPostRoute,
} from './dispatchRouting'
import {
  dispatchRelationForMail,
  queryAvailableUnsealedMail,
  queryUnsealedMail,
  type UnsealedMailGroup,
  type UnsealedMailItem,
} from './mailSealing'
import {
  DEFAULT_SERVICE_INSTITUTION_CODE,
  serviceOperatorInstitutionCode,
} from './institutionScope'
import type {
  DispatchBagRecord,
  DispatchBagShift,
  DispatchRouteRecord,
  ServiceWorkspaceState,
} from './types'

const SHIFTS: readonly DispatchBagShift[] = ['01', '02', '03']

export interface DispatchFlowBagGroup {
  key: string
  postRoute: SimulatedPostRoute
  shift: DispatchBagShift
  eligibleBags: DispatchBagRecord[]
  blockedBags: DispatchBagRecord[]
}

export interface DispatchFlowTransportGroup {
  key: string
  postRoute: SimulatedPostRoute
  shift: DispatchBagShift
  routes: DispatchRouteRecord[]
}

export interface DispatchFlowProjection {
  businessDay: string
  pendingSettlementCount: number
  unsealedGroups: UnsealedMailGroup[]
  unconfiguredItems: UnsealedMailItem[]
  bagGroups: DispatchFlowBagGroup[]
  transportGroups: DispatchFlowTransportGroup[]
  sealedBags: DispatchBagRecord[]
  exportedRoutes: DispatchRouteRecord[]
}

function sameBusinessDay(value: string, businessDay: string): boolean {
  return businessCalendarDay(value) === businessDay
}

/**
 * 把分散在收寄、封发、路单和出口模块中的同一条状态链投影为可连续操作的工作清单。
 * 本函数只诊断和归组，不替操作员执行封发、生成路单或确认运输交割。
 */
export function projectDispatchFlow(
  state: ServiceWorkspaceState,
  occurredAt = new Date().toISOString(),
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): DispatchFlowProjection {
  const businessDay = businessCalendarDay(occurredAt)
  const availableMail = queryAvailableUnsealedMail(state, institutionCode)
    .filter((item) => sameBusinessDay(item.acceptedAt, businessDay))
  const unsealed = queryUnsealedMail(state, {
    operatorId: '',
    bulkFlag: 'all',
    acceptedDateFrom: businessDay,
    acceptedDateTo: businessDay,
  }, institutionCode)
  const unconfiguredItems = availableMail.filter((item) => (
    dispatchRelationForMail(item, state.dispatchRelationOverrides) === null
  ))

  const bagGroups = SIMULATED_POST_ROUTES.flatMap((postRoute) => SHIFTS.flatMap((shift) => {
    const candidates = queryUngeneratedDispatchBags(state, {
      routeCode: postRoute.code,
      shift,
      sealingDate: businessDay,
    }, institutionCode)
    if (candidates.eligibleBags.length === 0 && candidates.blockedBags.length === 0) return []
    return [{
      key: `${postRoute.code}:${shift}`,
      postRoute,
      shift,
      ...candidates,
    }]
  }))

  const transportGroups = SIMULATED_POST_ROUTES.flatMap((postRoute) => SHIFTS.flatMap((shift) => {
    const routes = queryDispatchVehicleRoutes(state, {
      routeCode: postRoute.code,
      shift,
      handoverDate: businessDay,
      exportStatus: 'not-exported',
    }, institutionCode)
    if (routes.length === 0) return []
    return [{
      key: `${postRoute.code}:${shift}`,
      postRoute,
      shift,
      routes,
    }]
  }))

  return {
    businessDay,
    pendingSettlementCount: state.transactions.filter((transaction) => (
      transaction.status === 'pending-settlement' &&
      serviceOperatorInstitutionCode(transaction.operator) === institutionCode &&
      sameBusinessDay(transaction.acceptedAt, businessDay)
    )).length + state.bulkBatches.reduce((count, batch) => (
      batch.settlementStatus === 'unsettled' &&
      serviceOperatorInstitutionCode(batch.operator) === institutionCode &&
      batch.acceptanceDate === businessDay
        ? count + batch.successCount
        : count
    ), 0),
    unsealedGroups: unsealed.groups,
    unconfiguredItems,
    bagGroups,
    transportGroups,
    sealedBags: state.dispatchBags.filter((bag) => (
      bag.sealingStatus === 'sealed' &&
      (bag.originOfficeCode ?? serviceOperatorInstitutionCode(bag.generatedBy)) ===
        institutionCode &&
      sameBusinessDay(bag.generatedAt, businessDay)
    )),
    exportedRoutes: state.dispatchRoutes.filter((route) => (
      route.kind !== 'master-route' &&
      route.deletedAt === null &&
      route.exportedAt !== null &&
      serviceOperatorInstitutionCode(route.generatedBy) === institutionCode &&
      sameBusinessDay(route.exportedAt, businessDay)
    )),
  }
}

export function recommendedPostRoute(receivingOfficeCode: string): SimulatedPostRoute | null {
  return SIMULATED_POST_ROUTES.find((route) => (
    route.receivingOfficeCodes.includes(receivingOfficeCode)
  )) ?? null
}
