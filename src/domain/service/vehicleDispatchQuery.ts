import { SIMULATED_POST_ROUTES } from './dispatchConfiguration'
import type { ServiceWorkspaceState } from './types'
import { businessCalendarDay } from '../shared/businessTime'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

export const CURRENT_DISPATCH_STATION = {
  code: '99901001',
  name: '景麓营业部',
} as const

export type UnsealControlRequirement = '必须' | '非必须'

export interface VehicleDispatchControl {
  id: string
  openingProvinceCode: string
  openingProvinceName: string
  routeCode: string
  routeName: string
  unsealControlRequirement: UnsealControlRequirement
  deleted: boolean
  effectiveAt: string
  expiresAt: string
  updatedAt: string
}

const ROUTE_PROVINCES: Readonly<Record<string, { code: string; name: string }>> = {
  'SIM-A01': { code: '990000', name: '澜京' },
  'SIM-B02': { code: '991000', name: '云岚' },
  'SIM-C03': { code: '992000', name: '镜海埠' },
}

export const VEHICLE_DISPATCH_CONTROLS: readonly VehicleDispatchControl[] = [
  ...SIMULATED_POST_ROUTES.map((route): VehicleDispatchControl => ({
    id: `${route.code}:active`,
    openingProvinceCode: ROUTE_PROVINCES[route.code]?.code ?? '999000',
    openingProvinceName: ROUTE_PROVINCES[route.code]?.name ?? '瀚原',
    routeCode: route.code,
    routeName: route.name,
    unsealControlRequirement: route.requiresDispatchOrderNumber ? '必须' : '非必须',
    deleted: false,
    effectiveAt: '2026-01-01T00:00:00+10:00',
    expiresAt: '2099-12-31T23:59:59+10:00',
    updatedAt: '2026-08-01T09:30:00+10:00',
  })),
  {
    id: 'SIM-A01:deleted-history',
    openingProvinceCode: '990000',
    openingProvinceName: '澜京',
    routeCode: 'SIM-A01',
    routeName: '栖沄干线邮路',
    unsealControlRequirement: '必须',
    deleted: true,
    effectiveAt: '2025-01-01T00:00:00+10:00',
    expiresAt: '2026-03-31T23:59:59+10:00',
    updatedAt: '2026-04-01T08:15:00+10:00',
  },
] as const

function parseDay(value: string, field: string): string {
  const day = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`${field}必须使用 YYYY-MM-DD 格式。`)
  const [year, month, date] = day.split('-').map(Number)
  const parsed = new Date(Date.UTC(year!, month! - 1, date!))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== date
  ) throw new Error(`${field}不是有效日期。`)
  return day
}

function dayNumber(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return Date.UTC(year!, month! - 1, date!)
}

function dayDifference(earlier: string, later: string): number {
  return Math.floor((dayNumber(later) - dayNumber(earlier)) / DAY_MILLISECONDS)
}

function shiftDay(day: string, offset: number): string {
  const shifted = new Date(dayNumber(day) + offset * DAY_MILLISECONDS)
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

function atTime(day: string, time: string): string {
  return `${day}T${time}+10:00`
}

function includes(value: string, term: string): boolean {
  const normalized = term.trim().toLocaleLowerCase('zh-CN')
  return !normalized || value.toLocaleLowerCase('zh-CN').includes(normalized)
}

export interface DispatchControlQuery {
  routeCode: string
  asOf: string
}

export interface DispatchControlQueryRow extends VehicleDispatchControl {
  valid: boolean
}

export function queryVehicleDispatchControls(
  query: DispatchControlQuery,
): DispatchControlQueryRow[] {
  const routeCode = query.routeCode.trim()
  if (!routeCode) throw new Error('请输入邮路代码。')
  const asOf = parseDay(query.asOf, '查询日期')
  return VEHICLE_DISPATCH_CONTROLS
    .filter((row) => includes(`${row.routeCode} ${row.routeName}`, routeCode))
    .map((row) => ({
      ...structuredClone(row),
      valid: !row.deleted && businessCalendarDay(row.effectiveAt) <= asOf && businessCalendarDay(row.expiresAt) >= asOf,
    }))
    .sort((left, right) => Number(right.valid) - Number(left.valid) || right.updatedAt.localeCompare(left.updatedAt))
}

export interface VehicleDispatchStation {
  id: string
  direction: '去程(1)' | '返程(2)'
  unloadingStationName: string
  stationSequence: number
  stationCode: string
  routeCode: string
  plannedArrivalAt: string
  plannedDepartureAt: string
  deleted: boolean
}

export interface VehicleDispatchOrder {
  id: string
  dispatchingUnitCode: string
  dispatchOrderNumber: string
  waybillSerialNumber: string
  outboundRouteCode: string
  outboundRouteName: string
  returnRouteCode: string
  licensePlate: string
  driverName: string
  dispatchedAt: string
  stations: VehicleDispatchStation[]
}

function station(
  orderId: string,
  routeCode: string,
  direction: VehicleDispatchStation['direction'],
  sequence: number,
  stationCode: string,
  stationName: string,
  day: string,
  arrivalTime: string,
  departureTime: string,
  deleted = false,
): VehicleDispatchStation {
  return {
    id: `${orderId}:${direction}:${sequence}`,
    direction,
    unloadingStationName: stationName,
    stationSequence: sequence,
    stationCode,
    routeCode,
    plannedArrivalAt: atTime(day, arrivalTime),
    plannedDepartureAt: atTime(day, departureTime),
    deleted,
  }
}

export function simulatedVehicleDispatchOrders(asOf: string): VehicleDispatchOrder[] {
  const day = parseDay(asOf, '查询日期')
  const compactDay = day.replaceAll('-', '')
  const activeA = `PCD-${compactDay}-A01`
  const returnA = `PCD-${compactDay}-A02`
  const staleB = `PCD-${compactDay}-B01`
  const deletedC = `PCD-${compactDay}-C01`
  const expiredC = `PCD-${compactDay}-C99`
  return [
    {
      id: activeA,
      dispatchingUnitCode: '99801001',
      dispatchOrderNumber: activeA,
      waybillSerialNumber: '10120001',
      outboundRouteCode: 'SIM-A01',
      outboundRouteName: '栖沄干线邮路',
      returnRouteCode: 'SIM-A01-R',
      licensePlate: '演A00001',
      driverName: '林川',
      dispatchedAt: atTime(shiftDay(day, -2), '09:07:23'),
      stations: [
        station(activeA, 'SIM-A01', '去程(1)', 1, CURRENT_DISPATCH_STATION.code, CURRENT_DISPATCH_STATION.name, day, '09:07:23', '19:07:23'),
        station(activeA, 'SIM-A01', '去程(1)', 2, '99101011', '栖沄交换站', day, '20:07:23', '21:07:23'),
      ],
    },
    {
      id: returnA,
      dispatchingUnitCode: '99801001',
      dispatchOrderNumber: returnA,
      waybillSerialNumber: '10120002',
      outboundRouteCode: 'SIM-A01',
      outboundRouteName: '栖沄干线邮路',
      returnRouteCode: 'SIM-A01-R',
      licensePlate: '演A00002',
      driverName: '周原',
      dispatchedAt: atTime(shiftDay(day, -10), '08:35:00'),
      stations: [
        station(returnA, 'SIM-A01', '返程(2)', 1, CURRENT_DISPATCH_STATION.code, CURRENT_DISPATCH_STATION.name, day, '08:35:00', '18:35:00'),
      ],
    },
    {
      id: staleB,
      dispatchingUnitCode: '99802001',
      dispatchOrderNumber: staleB,
      waybillSerialNumber: '11010001',
      outboundRouteCode: 'SIM-B02',
      outboundRouteName: '澄野市内邮路',
      returnRouteCode: 'SIM-B02-R',
      licensePlate: '演B00001',
      driverName: '陈岳',
      dispatchedAt: atTime(shiftDay(day, -35), '09:07:23'),
      stations: [
        station(staleB, 'SIM-B02', '去程(1)', 1, CURRENT_DISPATCH_STATION.code, CURRENT_DISPATCH_STATION.name, day, '09:07:23', '19:07:23'),
      ],
    },
    {
      id: deletedC,
      dispatchingUnitCode: '99803001',
      dispatchOrderNumber: deletedC,
      waybillSerialNumber: '12030001',
      outboundRouteCode: 'SIM-C03',
      outboundRouteName: '镜海埠互换邮路',
      returnRouteCode: 'SIM-C03-R',
      licensePlate: '演C00001',
      driverName: '苏青',
      dispatchedAt: atTime(shiftDay(day, -4), '10:15:00'),
      stations: [
        station(deletedC, 'SIM-C03', '去程(1)', 1, CURRENT_DISPATCH_STATION.code, CURRENT_DISPATCH_STATION.name, day, '10:15:00', '20:15:00', true),
      ],
    },
    {
      id: expiredC,
      dispatchingUnitCode: '99803001',
      dispatchOrderNumber: expiredC,
      waybillSerialNumber: '12039999',
      outboundRouteCode: 'SIM-C03',
      outboundRouteName: '镜海埠互换邮路',
      returnRouteCode: 'SIM-C03-R',
      licensePlate: '演C00099',
      driverName: '顾山',
      dispatchedAt: atTime(shiftDay(day, -46), '10:15:00'),
      stations: [
        station(expiredC, 'SIM-C03', '去程(1)', 1, CURRENT_DISPATCH_STATION.code, CURRENT_DISPATCH_STATION.name, day, '10:15:00', '20:15:00'),
      ],
    },
  ]
}

export interface VehicleDispatchOrderQuery {
  routeCode: string
  dispatchOrderNumber: string
  stationCode: string
  asOf: string
}

export interface VehicleDispatchOrderQueryRow extends VehicleDispatchOrder {
  dispatchedDaysAgo: number
  usedWithin15Days: boolean
  currentStation: VehicleDispatchStation
  usable: boolean
  unusableReasons: string[]
}

export interface VehicleDispatchExportValidation {
  routeCode: string
  dispatchOrderNumber: string
  exportDate: string
}

function wasUsedWithin15Days(
  state: ServiceWorkspaceState,
  orderNumber: string,
  asOf: string,
): boolean {
  return state.dispatchRoutes.some((route) => {
    if (route.kind === 'master-route' || route.deletedAt !== null) return false
    if (route.dispatchOrderNumber !== orderNumber || !route.exportedAt) return false
    const age = dayDifference(businessCalendarDay(route.exportedAt), asOf)
    return age >= 0 && age <= 15
  })
}

export function queryVehicleDispatchOrders(
  state: ServiceWorkspaceState,
  query: VehicleDispatchOrderQuery,
): VehicleDispatchOrderQueryRow[] {
  const routeCode = query.routeCode.trim()
  if (!routeCode) throw new Error('请输入邮路代码。')
  const stationCode = query.stationCode.trim()
  if (!stationCode) throw new Error('缺少当前站序代码。')
  const asOf = parseDay(query.asOf, '查询日期')
  const activeControlCodes = new Set(queryVehicleDispatchControls({ routeCode, asOf })
    .filter((row) => row.valid)
    .map((row) => row.routeCode))

  return simulatedVehicleDispatchOrders(asOf)
    .filter((order) => includes(`${order.outboundRouteCode} ${order.outboundRouteName}`, routeCode))
    .filter((order) => includes(order.dispatchOrderNumber, query.dispatchOrderNumber))
    .map((order) => {
      const currentStation = order.stations.find((candidate) => candidate.stationCode === stationCode)
      if (!currentStation) return null
      const dispatchedDaysAgo = dayDifference(businessCalendarDay(order.dispatchedAt), asOf)
      if (dispatchedDaysAgo < 0 || dispatchedDaysAgo > 45) return null
      const usedWithin15Days = wasUsedWithin15Days(state, order.dispatchOrderNumber, asOf)
      const unusableReasons: string[] = []
      if (dispatchedDaysAgo > 30) unusableReasons.push('派车时间超过 30 天')
      if (businessCalendarDay(currentStation.plannedArrivalAt) !== asOf || businessCalendarDay(currentStation.plannedDepartureAt) !== asOf) unusableReasons.push('计划到达或离开时间不是当天')
      if (currentStation.deleted) unusableReasons.push('当前站序已删除')
      if (usedWithin15Days) unusableReasons.push('15 天内已经使用')
      if (!activeControlCodes.has(order.outboundRouteCode)) unusableReasons.push('邮路控制关系无效')
      return {
        ...structuredClone(order),
        dispatchedDaysAgo,
        usedWithin15Days,
        currentStation: structuredClone(currentStation),
        usable: unusableReasons.length === 0,
        unusableReasons,
      }
    })
    .filter((row): row is VehicleDispatchOrderQueryRow => row !== null)
    .sort((left, right) => right.dispatchedAt.localeCompare(left.dispatchedAt))
}

export function assertUsableVehicleDispatchOrder(
  state: ServiceWorkspaceState,
  validation: VehicleDispatchExportValidation,
): VehicleDispatchOrderQueryRow {
  const dispatchOrderNumber = validation.dispatchOrderNumber.trim()
  const matches = queryVehicleDispatchOrders(state, {
    routeCode: validation.routeCode,
    dispatchOrderNumber,
    stationCode: CURRENT_DISPATCH_STATION.code,
    asOf: validation.exportDate,
  })
  const order = matches.find((candidate) => (
    candidate.dispatchOrderNumber === dispatchOrderNumber
  ))
  if (!order) {
    throw new Error('未查询到 45 天内与当前邮路、站序匹配的派车单。')
  }
  if (!order.usable) {
    throw new Error(`派车单不可用：${order.unusableReasons.join('；')}。`)
  }
  return order
}

export function queryVehicleDispatchStations(
  order: VehicleDispatchOrder,
  routeCode: string,
): VehicleDispatchStation[] {
  const term = routeCode.trim()
  return order.stations
    .filter((row) => !term || includes(row.routeCode, term))
    .map((row) => structuredClone(row))
    .sort((left, right) => left.stationSequence - right.stationSequence)
}
