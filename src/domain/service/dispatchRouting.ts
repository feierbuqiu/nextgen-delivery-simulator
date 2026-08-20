import { latestDispatchBagHandover } from './dispatchBagHandover'
import {
  SIMULATED_POST_ROUTES,
  type SimulatedPostRoute,
} from './dispatchConfiguration'
import { dispatchBagSealingMode, SIMULATED_CONTAINER_INVENTORY } from './mailSealing'
import { assertUsableVehicleDispatchOrder } from './vehicleDispatchQuery'
import {
  DEFAULT_SERVICE_INSTITUTION_CODE,
  serviceOperatorInstitutionCode,
} from './institutionScope'
import {
  requireOnSiteAuthorization,
  type OnSiteAuthorization,
} from '../access/workAuthorization'
import {
  businessCalendarDay,
  isValidBusinessCalendarDay,
} from '../shared/businessTime'
import type {
  DispatchBagRecord,
  DispatchBagShift,
  DispatchContainerReturnLine,
  DispatchPrintDocumentType,
  DispatchPrintRecord,
  DispatchRouteKind,
  DispatchRouteRecord,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from './types'

export { SIMULATED_POST_ROUTES, type SimulatedPostRoute } from './dispatchConfiguration'

export interface SimulatedContainerStock {
  containerTypeCode: string
  containerTypeName: string
  containerModelCode: string
  containerModelName: string
  inventoryQuantity: number
}

export const SIMULATED_CONTAINER_RETURN_STOCK: readonly SimulatedContainerStock[] = [
  {
    containerTypeCode: 'bag',
    containerTypeName: '邮袋',
    containerModelCode: 'standard',
    containerModelName: '标准条码邮袋',
    inventoryQuantity: 8,
  },
  {
    containerTypeCode: 'box',
    containerTypeName: '周转箱',
    containerModelCode: 'small',
    containerModelName: '小型周转箱',
    inventoryQuantity: 5,
  },
] as const

export const TRAINING_MANIFEST_TYPE_OPTIONS = [
  { code: 'GNPCXH', name: '国内平函' },
  { code: 'BBPCXH', name: '本埠平刷' },
  { code: 'BBGS', name: '本埠挂刷' },
  { code: 'GNTK', name: '国内特快' },
  { code: 'DZPCXB', name: '大宗平常小包' },
  { code: 'GHXYXB', name: '协议挂号小包' },
  { code: 'GLSXB', name: 'GLS国际小包' },
  { code: 'JHXB', name: '集货小包' },
  { code: 'JZBG', name: '捐赠包裹' },
  { code: 'CHZB', name: '出航普包' },
] as const

export interface DispatchRouteQuery {
  routeCode: string
  shift: DispatchBagShift | ''
  sealingDate: string
}

export interface DispatchVehicleQuery {
  routeCode: string
  shift: DispatchBagShift | ''
  handoverDate: string
  exportStatus: 'not-exported' | 'exported' | 'all'
}

export interface DispatchCatchupQuery {
  routeCode: string
  shift: DispatchBagShift | ''
  sealingDate: string
}

export interface UngeneratedDispatchBagQueryResult {
  eligibleBags: DispatchBagRecord[]
  blockedBags: DispatchBagRecord[]
}

export interface DispatchPrintQuery {
  sealingDate: string
  shift: DispatchBagShift | ''
  packageType: '1' | '3' | '4'
  employeeTerm: string
  manifestTypeTerm: string
  dataType: 'unprinted' | 'all'
}

export interface DispatchPrintRow {
  targetId: string
  targetKind: 'bag' | 'route'
  documentNumber: string
  documentTypeName: '清单' | '路单' | '总路单'
  routeCode: string
  routeName: string
  manifestTypeCode: string
  manifestTypeName: string
  manifestNumbers: string[]
  receivingOfficeCode: string
  receivingOfficeName: string
  shift: DispatchBagShift
  sealingDate: string
  employeeId: string
  employeeName: string
  totalBags: number
  totalItems: number
  totalWeightGrams: number
  printed: boolean
}

interface GenerateDispatchRoutesCommand {
  type: 'generate-dispatch-routes'
  routeCode: string
  shift: DispatchBagShift
  sealingDate: string
  generatedAt: string
  operator: ServiceOperatorSnapshot
}

export interface ManualDispatchRouteInput {
  kind: Extract<DispatchRouteKind, 'manual-route' | 'container-return'>
  routeCode: string
  routeNumber: string
  manifestTypeCode: string
  manifestTypeName: string
  manifestNumber: string
  shift: DispatchBagShift
  sealingDate: string
  directSeal: boolean
  localTransfer: boolean
  receivingOfficeCode: string
  receivingOfficeName: string
  receptacleType: string
  usesBarcodeContainer: boolean
  containerTypeCode: string
  containerTypeName: string
  containerModelCode: string
  containerModelName: string
  containerBarcodes: string[]
  containerReturnLines: DispatchContainerReturnLine[]
  totalBags: number
  totalWeightGrams: number
}

interface AddManualDispatchRouteCommand {
  type: 'add-manual-dispatch-route'
  input: ManualDispatchRouteInput
  generatedAt: string
  operator: ServiceOperatorSnapshot
}

interface DeleteDispatchRoutesCommand {
  type: 'delete-dispatch-routes'
  routeIds: string[]
  deletedAt: string
  operator: ServiceOperatorSnapshot
}

interface RecordDispatchPrintCommand {
  type: 'record-dispatch-print'
  documentType: DispatchPrintDocumentType
  targetIds: string[]
  printedAt: string
  operator: ServiceOperatorSnapshot
  weightGrams?: number | null
  remark?: string
}

interface ReceiveCatchupDispatchRoutesCommand {
  type: 'receive-catchup-dispatch-routes'
  routeIds: string[]
  receiptDate: string
  receivedAt: string
  operator: ServiceOperatorSnapshot
}

interface ExportDispatchRoutesCommand {
  type: 'export-dispatch-routes'
  routeIds: string[]
  exportDate: string
  dispatchOrderNumber: string
  authorization: OnSiteAuthorization
  exportedAt: string
  operator: ServiceOperatorSnapshot
}

export type DispatchRoutingCommand =
  | GenerateDispatchRoutesCommand
  | AddManualDispatchRouteCommand
  | DeleteDispatchRoutesCommand
  | RecordDispatchPrintCommand
  | ReceiveCatchupDispatchRoutesCommand
  | ExportDispatchRoutesCommand

export interface DispatchRoutingResult {
  state: ServiceWorkspaceState
  routes: DispatchRouteRecord[]
  printRecords: DispatchPrintRecord[]
}

function uniqueIds(values: string[], action: string): string[] {
  const ids = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  if (ids.length === 0) throw new Error(`请选择需要${action}的记录。`)
  return ids
}

function validDay(value: string): boolean {
  return isValidBusinessCalendarDay(value)
}

function requiredPostRoute(code: string): SimulatedPostRoute {
  const route = SIMULATED_POST_ROUTES.find((candidate) => candidate.code === code.trim())
  if (!route) throw new Error('请选择邮路代码。')
  return route
}

function validateRouteQuery(query: DispatchRouteQuery): SimulatedPostRoute {
  const route = requiredPostRoute(query.routeCode)
  if (!['01', '02', '03'].includes(query.shift)) throw new Error('请选择班次。')
  if (!validDay(query.sealingDate)) throw new Error('封发日期必须使用 YYYY-MM-DD 格式。')
  return route
}

function effectiveBagShift(state: ServiceWorkspaceState, bag: DispatchBagRecord): DispatchBagShift {
  const latest = latestDispatchBagHandover(state, bag.id)
  return latest?.status === 'received' && latest.receiptShift
    ? latest.receiptShift
    : bag.shift
}

function bagInstitutionCode(bag: DispatchBagRecord): string {
  return bag.originOfficeCode ?? serviceOperatorInstitutionCode(bag.generatedBy)
}

function routeInstitutionCode(route: DispatchRouteRecord): string {
  return serviceOperatorInstitutionCode(route.generatedBy)
}

function assignedBagIds(state: ServiceWorkspaceState): Set<string> {
  return new Set(state.dispatchRoutes
    .filter((route) => route.deletedAt === null && route.kind !== 'master-route')
    .flatMap((route) => route.bagIds))
}

function routeCandidates(
  state: ServiceWorkspaceState,
  query: DispatchRouteQuery,
  institutionCode: string,
): UngeneratedDispatchBagQueryResult {
  const route = validateRouteQuery(query)
  const assigned = assignedBagIds(state)
  const eligibleBags: DispatchBagRecord[] = []
  const blockedBags: DispatchBagRecord[] = []

  for (const bag of state.dispatchBags) {
    if (bag.sealingStatus !== 'sealed' || assigned.has(bag.id)) continue
    if (bagInstitutionCode(bag) !== institutionCode) continue
    if (!route.receivingOfficeCodes.includes(bag.receivingOfficeCode)) continue
    if (businessCalendarDay(bag.generatedAt) !== query.sealingDate) continue
    if (effectiveBagShift(state, bag) !== query.shift) continue
    const handover = latestDispatchBagHandover(state, bag.id)
    if (handover?.status === 'handed-over') blockedBags.push(bag)
    else eligibleBags.push(bag)
  }

  const newestFirst = (left: DispatchBagRecord, right: DispatchBagRecord) =>
    right.generatedAt.localeCompare(left.generatedAt)
  return {
    eligibleBags: eligibleBags.sort(newestFirst),
    blockedBags: blockedBags.sort(newestFirst),
  }
}

export function queryUngeneratedDispatchBags(
  state: ServiceWorkspaceState,
  query: DispatchRouteQuery,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): UngeneratedDispatchBagQueryResult {
  return routeCandidates(state, query, institutionCode)
}

export function queryDispatchRoutes(
  state: ServiceWorkspaceState,
  query: DispatchRouteQuery,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): DispatchRouteRecord[] {
  const route = validateRouteQuery(query)
  return state.dispatchRoutes
    .filter((record) => record.deletedAt === null)
    .filter((record) => routeInstitutionCode(record) === institutionCode)
    .filter((record) => record.routeCode === route.code)
    .filter((record) => record.shift === query.shift)
    .filter((record) => record.sealingDate === query.sealingDate)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
}

function activeOutboundRoutes(
  state: ServiceWorkspaceState,
  institutionCode: string,
): DispatchRouteRecord[] {
  return state.dispatchRoutes.filter((route) =>
    route.deletedAt === null && route.kind !== 'master-route' &&
    routeInstitutionCode(route) === institutionCode)
}

export function queryDispatchVehicleRoutes(
  state: ServiceWorkspaceState,
  query: DispatchVehicleQuery,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): DispatchRouteRecord[] {
  const route = requiredPostRoute(query.routeCode)
  if (!['01', '02', '03'].includes(query.shift)) throw new Error('请选择班次。')
  if (!validDay(query.handoverDate)) throw new Error('交接日期必须使用 YYYY-MM-DD 格式。')

  return activeOutboundRoutes(state, institutionCode)
    .filter((record) => record.routeCode === route.code)
    .filter((record) => record.shift === query.shift)
    .filter((record) =>
      record.sealingDate === query.handoverDate ||
      record.catchupReceiptDate === query.handoverDate)
    .filter((record) => query.exportStatus === 'all' || (
      query.exportStatus === 'exported' ? record.exportedAt !== null : record.exportedAt === null
    ))
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
}

export function queryCatchupDispatchRoutes(
  state: ServiceWorkspaceState,
  query: DispatchCatchupQuery,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): DispatchRouteRecord[] {
  const route = requiredPostRoute(query.routeCode)
  if (!['01', '02', '03'].includes(query.shift)) throw new Error('请选择班次。')
  if (!validDay(query.sealingDate)) throw new Error('封发日期必须使用 YYYY-MM-DD 格式。')

  return activeOutboundRoutes(state, institutionCode)
    .filter((record) => record.routeCode === route.code)
    .filter((record) => record.shift === query.shift)
    .filter((record) => record.sealingDate === query.sealingDate)
    .filter((record) => record.exportedAt === null && record.catchupReceivedAt === null)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
}

function routeRecordId(prefix: 'LD' | 'ZLD', sealingDate: string, sequence: number): string {
  return `${prefix}-${sealingDate.replaceAll('-', '')}-${String(sequence).padStart(6, '0')}`
}

function automaticRoute(
  bags: DispatchBagRecord[],
  postRoute: SimulatedPostRoute,
  command: GenerateDispatchRoutesCommand,
  sequence: number,
): DispatchRouteRecord {
  const first = bags[0]!
  return {
    id: routeRecordId('LD', command.sealingDate, sequence),
    kind: 'route',
    routeCode: postRoute.code,
    routeName: postRoute.name,
    routeNumber: String(sequence).padStart(6, '0'),
    childRouteIds: [],
    manifestTypeCode: first.manifestTypeCode,
    manifestTypeName: first.manifestTypeName,
    manifestNumbers: [...new Set(bags.map((bag) => bag.manifestNumber))],
    shift: command.shift,
    sealingDate: command.sealingDate,
    directSeal: first.directSeal,
    localTransfer: first.localTransfer,
    receivingOfficeCode: first.receivingOfficeCode,
    receivingOfficeName: first.receivingOfficeName,
    bagIds: bags.map((bag) => bag.id),
    totalBags: bags.length,
    totalItems: bags.reduce((sum, bag) => sum + bag.totalItems, 0),
    totalWeightGrams: bags.reduce(
      (sum, bag) => sum + bag.mailWeightGrams + bag.emptyBagWeightGrams,
      0,
    ),
    receptacleType: first.receptacleType,
    usesBarcodeContainer: bags.some((bag) => bag.usesBarcodeContainer),
    containerTypeCode: '',
    containerTypeName: '',
    containerModelCode: '',
    containerModelName: '',
    containerBarcodes: bags.map((bag) => bag.containerBarcode).filter(Boolean),
    containerReturnLines: [],
    source: 'automatic',
    generatedAt: command.generatedAt,
    generatedBy: structuredClone(command.operator),
    catchupReceiptDate: null,
    catchupReceivedAt: null,
    catchupReceivedBy: null,
    dispatchOrderNumber: '',
    exportAuthorizedBy: null,
    exportAuthorizedAt: null,
    exportedAt: null,
    exportedBy: null,
    deletedAt: null,
    deletedBy: null,
  }
}

function generateRoutes(
  state: ServiceWorkspaceState,
  command: GenerateDispatchRoutesCommand,
): DispatchRoutingResult {
  const postRoute = requiredPostRoute(command.routeCode)
  const institutionCode = serviceOperatorInstitutionCode(command.operator)
  const candidates = routeCandidates(state, command, institutionCode)
  if (candidates.eligibleBags.length === 0) {
    return { state, routes: [], printRecords: [] }
  }

  const groups = new Map<string, DispatchBagRecord[]>()
  for (const bag of candidates.eligibleBags) {
    const key = [
      bag.manifestTypeCode,
      bag.receivingOfficeCode,
      String(bag.directSeal),
      String(bag.localTransfer),
    ].join('|')
    groups.set(key, [...(groups.get(key) ?? []), bag])
  }

  let sequence = state.nextDispatchRouteSequence
  const routes: DispatchRouteRecord[] = []
  for (const bags of groups.values()) {
    routes.push(automaticRoute(bags, postRoute, command, sequence))
    sequence += 1
  }
  const allBags = routes.flatMap((route) => route.bagIds)
  const receivingOffices = [...new Map(routes.map((route) => [
    route.receivingOfficeCode,
    route.receivingOfficeName,
  ])).entries()]
  const master: DispatchRouteRecord = {
    id: routeRecordId('ZLD', command.sealingDate, sequence),
    kind: 'master-route',
    routeCode: postRoute.code,
    routeName: postRoute.name,
    routeNumber: String(sequence).padStart(6, '0'),
    childRouteIds: routes.map((route) => route.id),
    manifestTypeCode: '',
    manifestTypeName: '多种清单',
    manifestNumbers: [...new Set(routes.flatMap((route) => route.manifestNumbers))],
    shift: command.shift,
    sealingDate: command.sealingDate,
    directSeal: routes.every((route) => route.directSeal),
    localTransfer: routes.every((route) => route.localTransfer),
    receivingOfficeCode: receivingOffices.length === 1 ? receivingOffices[0]![0] : '',
    receivingOfficeName: receivingOffices.length === 1 ? receivingOffices[0]![1] : '多接收局',
    bagIds: [...new Set(allBags)],
    totalBags: routes.reduce((sum, route) => sum + route.totalBags, 0),
    totalItems: routes.reduce((sum, route) => sum + route.totalItems, 0),
    totalWeightGrams: routes.reduce((sum, route) => sum + route.totalWeightGrams, 0),
    receptacleType: '汇总',
    usesBarcodeContainer: routes.some((route) => route.usesBarcodeContainer),
    containerTypeCode: '',
    containerTypeName: '',
    containerModelCode: '',
    containerModelName: '',
    containerBarcodes: [...new Set(routes.flatMap((route) => route.containerBarcodes))],
    containerReturnLines: [],
    source: 'automatic',
    generatedAt: command.generatedAt,
    generatedBy: structuredClone(command.operator),
    catchupReceiptDate: null,
    catchupReceivedAt: null,
    catchupReceivedBy: null,
    dispatchOrderNumber: '',
    exportAuthorizedBy: null,
    exportAuthorizedAt: null,
    exportedAt: null,
    exportedBy: null,
    deletedAt: null,
    deletedBy: null,
  }
  sequence += 1
  const created = [...routes, master]
  return {
    routes: created,
    printRecords: [],
    state: {
      ...state,
      dispatchRoutes: [...state.dispatchRoutes, ...created],
      nextDispatchRouteSequence: sequence,
    },
  }
}

function clearanceAlreadyUsed(
  state: ServiceWorkspaceState,
  line: DispatchContainerReturnLine,
  institutionCode: string,
): number {
  return state.dispatchRoutes
    .filter((route) => route.deletedAt === null && route.kind === 'container-return')
    .filter((route) => routeInstitutionCode(route) === institutionCode)
    .flatMap((route) => route.containerReturnLines)
    .filter((candidate) =>
      candidate.containerTypeCode === line.containerTypeCode &&
      candidate.containerModelCode === line.containerModelCode)
    .reduce((sum, candidate) => sum + candidate.clearanceQuantity, 0)
}

function validateContainerReturnLines(
  state: ServiceWorkspaceState,
  lines: DispatchContainerReturnLine[],
  institutionCode: string,
): DispatchContainerReturnLine[] {
  const meaningful = lines.filter((line) => Number(line.clearanceQuantity) > 0)
  if (meaningful.length === 0) throw new Error('请维护清退容器列表。')
  return meaningful.map((line) => {
    const stock = SIMULATED_CONTAINER_RETURN_STOCK.find((candidate) =>
      candidate.containerTypeCode === line.containerTypeCode &&
      candidate.containerModelCode === line.containerModelCode)
    if (!stock) throw new Error('所选清退容器不在演练库存中。')
    if (!Number.isInteger(line.clearanceQuantity)) throw new Error('清退数量必须为整数。')
    const available = stock.inventoryQuantity - clearanceAlreadyUsed(
      state,
      line,
      institutionCode,
    )
    if (line.clearanceQuantity > available) {
      throw new Error(`${stock.containerModelName} 可清退数量仅剩 ${available}。`)
    }
    return {
      ...stock,
      clearanceQuantity: line.clearanceQuantity,
    }
  })
}

function addManualRoute(
  state: ServiceWorkspaceState,
  command: AddManualDispatchRouteCommand,
): DispatchRoutingResult {
  const input = command.input
  const institutionCode = serviceOperatorInstitutionCode(command.operator)
  const postRoute = requiredPostRoute(input.routeCode)
  if (!['01', '02', '03'].includes(input.shift)) throw new Error('请选择班次。')
  if (!validDay(input.sealingDate)) throw new Error('封发日期必须使用 YYYY-MM-DD 格式。')
  if (!input.manifestTypeCode.trim() || !input.manifestTypeName.trim()) {
    throw new Error('请选择清单种类。')
  }
  const manifestNumber = input.manifestNumber.trim()
  if (manifestNumber && !/^\d{3}$/.test(manifestNumber)) {
    throw new Error('清单号必须为 3 位数字。')
  }
  if (!input.receptacleType.trim() || !input.containerTypeName.trim()) {
    throw new Error('请选择容器种类。')
  }
  if (!Number.isInteger(input.totalBags) || input.totalBags <= 0) {
    throw new Error('总包数量必须为大于零的整数。')
  }
  if (!Number.isInteger(input.totalWeightGrams) || input.totalWeightGrams <= 0) {
    throw new Error('总包重量必须为大于零的整数克数。')
  }

  let containerBarcodes: string[] = []
  if (input.usesBarcodeContainer) {
    if (!input.containerModelName.trim()) throw new Error('请选择容器条码型号。')
    containerBarcodes = [...new Set(input.containerBarcodes.map((value) => value.trim()).filter(Boolean))]
    if (containerBarcodes.length === 0) throw new Error('请输入容器条码。')
    const occupied = new Set([
      ...state.dispatchBags
        .filter((bag) => bag.sealingStatus === 'sealed')
        .filter((bag) => bagInstitutionCode(bag) === institutionCode)
        .map((bag) => bag.containerBarcode)
        .filter(Boolean),
      ...state.dispatchRoutes
        .filter((route) => route.deletedAt === null)
        .filter((route) => routeInstitutionCode(route) === institutionCode)
        .flatMap((route) => route.containerBarcodes),
    ])
    for (const barcode of containerBarcodes) {
      if (!/^\d{16}$/.test(barcode)) throw new Error('容器条码必须为 16 位数字。')
      if (!SIMULATED_CONTAINER_INVENTORY.includes(
        barcode as (typeof SIMULATED_CONTAINER_INVENTORY)[number],
      )) throw new Error(`容器条码 ${barcode} 未入库。`)
      if (occupied.has(barcode)) throw new Error(`容器条码 ${barcode} 已被使用。`)
    }
  }

  const containerReturnLines = input.kind === 'container-return'
    ? validateContainerReturnLines(state, input.containerReturnLines, institutionCode)
    : []
  const sequence = state.nextDispatchRouteSequence
  const route: DispatchRouteRecord = {
    id: routeRecordId('LD', input.sealingDate, sequence),
    kind: input.kind,
    routeCode: postRoute.code,
    routeName: postRoute.name,
    routeNumber: input.routeNumber.trim() || String(sequence).padStart(6, '0'),
    childRouteIds: [],
    manifestTypeCode: input.manifestTypeCode.trim(),
    manifestTypeName: input.manifestTypeName.trim(),
    manifestNumbers: manifestNumber ? [manifestNumber] : [],
    shift: input.shift,
    sealingDate: input.sealingDate,
    directSeal: input.directSeal,
    localTransfer: input.localTransfer,
    receivingOfficeCode: input.receivingOfficeCode.trim(),
    receivingOfficeName: input.receivingOfficeName.trim(),
    bagIds: [],
    totalBags: input.totalBags,
    totalItems: 0,
    totalWeightGrams: input.totalWeightGrams,
    receptacleType: input.receptacleType.trim(),
    usesBarcodeContainer: input.usesBarcodeContainer,
    containerTypeCode: input.containerTypeCode.trim(),
    containerTypeName: input.containerTypeName.trim(),
    containerModelCode: input.containerModelCode.trim(),
    containerModelName: input.containerModelName.trim(),
    containerBarcodes,
    containerReturnLines,
    source: 'manual',
    generatedAt: command.generatedAt,
    generatedBy: structuredClone(command.operator),
    catchupReceiptDate: null,
    catchupReceivedAt: null,
    catchupReceivedBy: null,
    dispatchOrderNumber: '',
    exportAuthorizedBy: null,
    exportAuthorizedAt: null,
    exportedAt: null,
    exportedBy: null,
    deletedAt: null,
    deletedBy: null,
  }
  return {
    routes: [route],
    printRecords: [],
    state: {
      ...state,
      dispatchRoutes: [...state.dispatchRoutes, route],
      nextDispatchRouteSequence: sequence + 1,
    },
  }
}

function deleteRoutes(
  state: ServiceWorkspaceState,
  command: DeleteDispatchRoutesCommand,
): DispatchRoutingResult {
  const ids = uniqueIds(command.routeIds, '删除')
  const institutionCode = serviceOperatorInstitutionCode(command.operator)
  const selected = ids.map((id) => {
    const route = state.dispatchRoutes.find((candidate) => candidate.id === id)
    if (!route || route.deletedAt !== null) throw new Error(`未找到有效路单 ${id}。`)
    if (routeInstitutionCode(route) !== institutionCode) {
      throw new Error(`${route.routeNumber} 不属于当前经办机构。`)
    }
    if (route.exportedAt) throw new Error(`${route.routeNumber} 已出口，不能删除。`)
    return route
  })
  const selectedIds = new Set(selected.map((route) => route.id))
  for (const master of state.dispatchRoutes) {
    if (
      master.kind === 'master-route' && master.deletedAt === null && master.exportedAt &&
      master.childRouteIds.some((id) => selectedIds.has(id))
    ) throw new Error(`总路单 ${master.routeNumber} 已出口，不能删除其子路单。`)
  }

  const deleted = selected.map((route) => ({
    ...route,
    deletedAt: command.deletedAt,
    deletedBy: structuredClone(command.operator),
  }))
  const byId = new Map(deleted.map((route) => [route.id, route]))
  let routes = state.dispatchRoutes.map((route) => byId.get(route.id) ?? route)
  routes = routes.map((master) => {
    if (master.kind !== 'master-route' || master.deletedAt !== null || selectedIds.has(master.id)) {
      return master
    }
    const remainingChildren = master.childRouteIds
      .filter((id) => !selectedIds.has(id))
      .map((id) => routes.find((route) => route.id === id))
      .filter((route): route is DispatchRouteRecord => Boolean(route && route.deletedAt === null))
    if (remainingChildren.length === master.childRouteIds.length) return master
    if (remainingChildren.length === 0) {
      return {
        ...master,
        deletedAt: command.deletedAt,
        deletedBy: structuredClone(command.operator),
      }
    }
    const offices = [...new Map(remainingChildren.map((route) => [
      route.receivingOfficeCode,
      route.receivingOfficeName,
    ])).entries()]
    return {
      ...master,
      childRouteIds: remainingChildren.map((route) => route.id),
      bagIds: [...new Set(remainingChildren.flatMap((route) => route.bagIds))],
      manifestNumbers: [...new Set(remainingChildren.flatMap((route) => route.manifestNumbers))],
      receivingOfficeCode: offices.length === 1 ? offices[0]![0] : '',
      receivingOfficeName: offices.length === 1 ? offices[0]![1] : '多接收局',
      totalBags: remainingChildren.reduce((sum, route) => sum + route.totalBags, 0),
      totalItems: remainingChildren.reduce((sum, route) => sum + route.totalItems, 0),
      totalWeightGrams: remainingChildren.reduce((sum, route) => sum + route.totalWeightGrams, 0),
    }
  })

  return {
    routes: deleted,
    printRecords: [],
    state: { ...state, dispatchRoutes: routes },
  }
}

function requiredOutboundRoute(
  state: ServiceWorkspaceState,
  routeId: string,
  institutionCode: string,
): DispatchRouteRecord {
  const route = state.dispatchRoutes.find((candidate) => candidate.id === routeId)
  if (!route || route.deletedAt !== null || route.kind === 'master-route') {
    throw new Error(`未找到有效路单 ${routeId}。`)
  }
  if (routeInstitutionCode(route) !== institutionCode) {
    throw new Error(`${route.routeNumber} 不属于当前经办机构。`)
  }
  return route
}

function receiveCatchupRoutes(
  state: ServiceWorkspaceState,
  command: ReceiveCatchupDispatchRoutesCommand,
): DispatchRoutingResult {
  const routeIds = uniqueIds(command.routeIds, '接收')
  const institutionCode = serviceOperatorInstitutionCode(command.operator)
  if (!validDay(command.receiptDate)) throw new Error('接收日期必须使用 YYYY-MM-DD 格式。')
  if (businessCalendarDay(command.receivedAt) !== command.receiptDate) {
    throw new Error('接收日期必须与实际勾挑接收时间属于同一业务日。')
  }
  const routes = routeIds.map((routeId) => {
    const route = requiredOutboundRoute(state, routeId, institutionCode)
    if (route.exportedAt) throw new Error(`${route.routeNumber} 已出口，不能勾挑接收。`)
    if (route.catchupReceivedAt) throw new Error(`${route.routeNumber} 已完成勾挑接收。`)
    if (route.sealingDate >= command.receiptDate) {
      throw new Error(`${route.routeNumber} 不是隔天未出口路单。`)
    }
    return {
      ...route,
      catchupReceiptDate: command.receiptDate,
      catchupReceivedAt: command.receivedAt,
      catchupReceivedBy: structuredClone(command.operator),
    }
  })
  const byId = new Map(routes.map((route) => [route.id, route]))
  return {
    routes,
    printRecords: [],
    state: {
      ...state,
      dispatchRoutes: state.dispatchRoutes.map((route) => byId.get(route.id) ?? route),
    },
  }
}

function exportRoutes(
  state: ServiceWorkspaceState,
  command: ExportDispatchRoutesCommand,
): DispatchRoutingResult {
  const routeIds = uniqueIds(command.routeIds, '出口')
  const institutionCode = serviceOperatorInstitutionCode(command.operator)
  if (!validDay(command.exportDate)) throw new Error('交接日期必须使用 YYYY-MM-DD 格式。')
  if (businessCalendarDay(command.exportedAt) !== command.exportDate) {
    throw new Error('交接日期必须与实际出口时间属于同一业务日。')
  }
  const originals = routeIds.map((routeId) => requiredOutboundRoute(
    state,
    routeId,
    institutionCode,
  ))
  const routeCodes = new Set(originals.map((route) => route.routeCode))
  const shifts = new Set(originals.map((route) => route.shift))
  if (routeCodes.size !== 1 || shifts.size !== 1) throw new Error('一次只能出口同一邮路、同一班次的路单。')
  originals.forEach((route) => {
    if (route.exportedAt) throw new Error(`${route.routeNumber} 已出口，不能重复操作。`)
    if (
      route.sealingDate !== command.exportDate &&
      route.catchupReceiptDate !== command.exportDate
    ) throw new Error(`${route.routeNumber} 未在当前交接日期待出口。`)
  })

  const postRoute = requiredPostRoute(originals[0]!.routeCode)
  const dispatchOrderNumber = command.dispatchOrderNumber.trim()
  if (postRoute.requiresDispatchOrderNumber && !dispatchOrderNumber) {
    throw new Error('请输入派车单号。')
  }
  if (!postRoute.requiresDispatchOrderNumber && dispatchOrderNumber) {
    throw new Error('当前邮路不采集派车单号。')
  }
  if (dispatchOrderNumber.length > 32) throw new Error('派车单号不能超过 32 个字符。')
  if (postRoute.requiresDispatchOrderNumber) {
    assertUsableVehicleDispatchOrder(state, {
      routeCode: postRoute.code,
      dispatchOrderNumber,
      exportDate: command.exportDate,
    })
  }
  const authorization = requireOnSiteAuthorization(
    command.authorization,
    'export-dispatch-trip',
    command.operator.operatorId,
    institutionCode,
  )
  const authorizedEmployeeId = authorization.authorizerId

  const exported = originals.map((route) => {
    return {
      ...route,
      dispatchOrderNumber,
      exportAuthorizedBy: authorizedEmployeeId,
      exportAuthorizedAt: command.exportedAt,
      exportedAt: command.exportedAt,
      exportedBy: structuredClone(command.operator),
    }
  })
  const exportedById = new Map(exported.map((route) => [route.id, route]))
  let dispatchRoutes = state.dispatchRoutes.map((route) => exportedById.get(route.id) ?? route)
  dispatchRoutes = dispatchRoutes.map((master) => {
    if (master.kind !== 'master-route' || master.deletedAt !== null || master.exportedAt) return master
    const children = master.childRouteIds
      .map((id) => dispatchRoutes.find((candidate) => candidate.id === id))
      .filter((route): route is DispatchRouteRecord => Boolean(route && route.deletedAt === null))
    if (children.length === 0 || children.some((route) => route.exportedAt === null)) return master
    return {
      ...master,
      dispatchOrderNumber: [...new Set(children.map((route) => route.dispatchOrderNumber).filter(Boolean))]
        .join('、'),
      exportAuthorizedBy: [...new Set(children
        .map((route) => route.exportAuthorizedBy)
        .filter((value): value is string => Boolean(value)))]
        .join('、') || authorizedEmployeeId,
      exportAuthorizedAt: command.exportedAt,
      exportedAt: command.exportedAt,
      exportedBy: structuredClone(command.operator),
    }
  })

  return {
    routes: exported,
    printRecords: [],
    state: { ...state, dispatchRoutes },
  }
}

function ordinaryPrintType(packageType: DispatchPrintQuery['packageType']): DispatchPrintDocumentType {
  if (packageType === '1') return 'manifest'
  if (packageType === '3') return 'route'
  return 'master-route'
}

function printedTargetIds(
  state: ServiceWorkspaceState,
  documentType: DispatchPrintDocumentType,
): Set<string> {
  return new Set(state.dispatchPrintRecords
    .filter((record) => record.documentType === documentType)
    .map((record) => record.targetId))
}

function matchesTerm(values: string[], term: string): boolean {
  const normalized = term.trim().toLocaleLowerCase('zh-CN')
  return !normalized || values.some((value) => value.toLocaleLowerCase('zh-CN').includes(normalized))
}

export function queryDispatchPrintRows(
  state: ServiceWorkspaceState,
  query: DispatchPrintQuery,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): DispatchPrintRow[] {
  if (!validDay(query.sealingDate)) throw new Error('封发日期必须使用 YYYY-MM-DD 格式。')
  if (!['01', '02', '03'].includes(query.shift)) throw new Error('请选择班次。')
  const documentType = ordinaryPrintType(query.packageType)
  const printed = printedTargetIds(state, documentType)
  let rows: DispatchPrintRow[]

  if (query.packageType === '1') {
    rows = state.dispatchBags
      .filter((bag) => bag.sealingStatus === 'sealed')
      .filter((bag) => bagInstitutionCode(bag) === institutionCode)
      .map((bag) => ({
        targetId: bag.id,
        targetKind: 'bag' as const,
        documentNumber: bag.manifestNumber,
        documentTypeName: '清单' as const,
        routeCode: '',
        routeName: '',
        manifestTypeCode: bag.manifestTypeCode,
        manifestTypeName: bag.manifestTypeName,
        manifestNumbers: [bag.manifestNumber],
        receivingOfficeCode: bag.receivingOfficeCode,
        receivingOfficeName: bag.receivingOfficeName,
        shift: effectiveBagShift(state, bag),
        sealingDate: businessCalendarDay(bag.generatedAt),
        employeeId: bag.generatedBy.operatorId,
        employeeName: bag.generatedBy.displayName,
        totalBags: 1,
        totalItems: bag.totalItems,
        totalWeightGrams: bag.mailWeightGrams + bag.emptyBagWeightGrams,
        printed: printed.has(bag.id),
      }))
  } else {
    rows = state.dispatchRoutes
      .filter((route) => route.deletedAt === null)
      .filter((route) => routeInstitutionCode(route) === institutionCode)
      .filter((route) => query.packageType === '4'
        ? route.kind === 'master-route'
        : route.kind !== 'master-route')
      .map((route) => ({
        targetId: route.id,
        targetKind: 'route' as const,
        documentNumber: route.routeNumber,
        documentTypeName: route.kind === 'master-route' ? '总路单' as const : '路单' as const,
        routeCode: route.routeCode,
        routeName: route.routeName,
        manifestTypeCode: route.manifestTypeCode,
        manifestTypeName: route.manifestTypeName,
        manifestNumbers: structuredClone(route.manifestNumbers),
        receivingOfficeCode: route.receivingOfficeCode,
        receivingOfficeName: route.receivingOfficeName,
        shift: route.shift,
        sealingDate: route.sealingDate,
        employeeId: route.generatedBy.operatorId,
        employeeName: route.generatedBy.displayName,
        totalBags: route.totalBags,
        totalItems: route.totalItems,
        totalWeightGrams: route.totalWeightGrams,
        printed: printed.has(route.id),
      }))
  }

  return rows
    .filter((row) => row.sealingDate === query.sealingDate && row.shift === query.shift)
    .filter((row) => matchesTerm([row.employeeId, row.employeeName], query.employeeTerm))
    .filter((row) => matchesTerm([
      row.manifestTypeCode,
      row.manifestTypeName,
    ], query.manifestTypeTerm))
    .filter((row) => query.dataType === 'all' || !row.printed)
    .sort((left, right) => right.documentNumber.localeCompare(left.documentNumber))
}

function printTargetExists(
  state: ServiceWorkspaceState,
  documentType: DispatchPrintDocumentType,
  targetId: string,
  institutionCode: string,
): boolean {
  if (['manifest', 'bag-tag', 'receipt-bag-tag', 'address-bag-tag', 'premade-bag-tag']
    .includes(documentType)) {
    return state.dispatchBags.some((bag) =>
      bag.id === targetId && bag.sealingStatus === 'sealed' &&
      bagInstitutionCode(bag) === institutionCode)
  }
  return state.dispatchRoutes.some((route) =>
    route.id === targetId && route.deletedAt === null &&
    routeInstitutionCode(route) === institutionCode &&
    (documentType === 'master-route'
      ? route.kind === 'master-route'
      : route.kind !== 'master-route'))
}

function recordPrint(
  state: ServiceWorkspaceState,
  command: RecordDispatchPrintCommand,
): DispatchRoutingResult {
  const targetIds = uniqueIds(command.targetIds, '打印')
  const institutionCode = serviceOperatorInstitutionCode(command.operator)
  for (const targetId of targetIds) {
    if (!printTargetExists(state, command.documentType, targetId, institutionCode)) {
      throw new Error(`打印目标 ${targetId} 不存在或类型不匹配。`)
    }
  }
  if (['bag-tag', 'receipt-bag-tag', 'address-bag-tag', 'premade-bag-tag']
    .includes(command.documentType)) {
    const looseOutbound = targetIds.some((targetId) => {
      const bag = state.dispatchBags.find((candidate) => candidate.id === targetId)
      return bag && dispatchBagSealingMode(bag) === 'loose-outbound'
    })
    if (looseOutbound) throw new Error('散件外走邮件不允许打印袋牌。')
  }
  if (command.documentType === 'premade-bag-tag') {
    if (targetIds.length !== 1) throw new Error('预制袋牌每次只能处理一个清单。')
    if (!Number.isInteger(command.weightGrams) || Number(command.weightGrams) < 0) {
      throw new Error('预制袋牌重量必须为非负整数克数。')
    }
  }

  let sequence = state.nextDispatchPrintSequence
  const records = targetIds.map((targetId) => {
    const record: DispatchPrintRecord = {
      id: `DY-${String(sequence).padStart(6, '0')}`,
      documentType: command.documentType,
      targetId,
      printedAt: command.printedAt,
      printedBy: structuredClone(command.operator),
      weightGrams: command.documentType === 'premade-bag-tag'
        ? Number(command.weightGrams)
        : null,
      remark: command.remark?.trim() ?? '',
    }
    sequence += 1
    return record
  })
  return {
    routes: [],
    printRecords: records,
    state: {
      ...state,
      dispatchPrintRecords: [...state.dispatchPrintRecords, ...records],
      nextDispatchPrintSequence: sequence,
    },
  }
}

export function executeDispatchRoutingCommand(
  state: ServiceWorkspaceState,
  command: DispatchRoutingCommand,
): DispatchRoutingResult {
  switch (command.type) {
    case 'generate-dispatch-routes': return generateRoutes(state, command)
    case 'add-manual-dispatch-route': return addManualRoute(state, command)
    case 'delete-dispatch-routes': return deleteRoutes(state, command)
    case 'record-dispatch-print': return recordPrint(state, command)
    case 'receive-catchup-dispatch-routes': return receiveCatchupRoutes(state, command)
    case 'export-dispatch-routes': return exportRoutes(state, command)
  }
}
