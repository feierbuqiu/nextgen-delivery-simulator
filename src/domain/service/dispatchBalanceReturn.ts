import { dispatchMailReferenceKey } from './mailSealing'
import {
  businessCalendarDay,
  isValidBusinessCalendarDay,
} from '../shared/businessTime'
import {
  DEFAULT_SERVICE_INSTITUTION_CODE,
  serviceOperatorInstitutionCode,
} from './institutionScope'
import type {
  DispatchBagInterchangeReturnRecord,
  DispatchBagRecord,
  DispatchBagShift,
  DispatchMailReference,
  DispatchRouteRecord,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from './types'

export interface DispatchBalanceQuery {
  institutionCode: string
  institutionName: string
  acceptedDateFrom: string
  acceptedDateTo: string
}

export interface DispatchBalanceRow {
  statisticsDate: string
  localAcceptedItems: number
  totalSealedItems: number
  sealedForOtherOfficeItems: number
  exportedLocalItems: number
  exportedForOtherOfficeItems: number
}

export interface DispatchInterchangeReturnQuery {
  bagBarcode: string
  sealingDate: string
}

export interface DispatchInterchangeReturnMailRow {
  key: string
  reference: DispatchMailReference
  productName: string
  itemNumber: string
  destinationOffice: string
  note: string
  weightGrams: number
  quantity: number
  reviewerName: string
}

type ExportedDispatchRoute = DispatchRouteRecord & { exportedAt: string }

export interface DispatchInterchangeReturnCandidate {
  bag: DispatchBagRecord
  route: ExportedDispatchRoute
  mails: DispatchInterchangeReturnMailRow[]
  totalItems: number
  mailWeightGrams: number
}

export interface DispatchInterchangeVerification {
  bagId: string
  routeId: string
  totalItems: number
  mailWeightGrams: number
  bagTotalWeightGrams: number
}

interface ReturnBagToInterchangeCommand {
  type: 'return-dispatch-bag-to-interchange'
  bagId: string
  keptMailReferenceKeys: string[]
  emptyBagWeightGrams: number
  bagTotalWeightGrams: number
  shift: DispatchBagShift
  returnedAt: string
  operator: ServiceOperatorSnapshot
}

export type DispatchBalanceReturnCommand = ReturnBagToInterchangeCommand

export interface DispatchBalanceReturnResult {
  state: ServiceWorkspaceState
  bag: DispatchBagRecord
  record: DispatchBagInterchangeReturnRecord
}

interface MailSnapshot {
  key: string
  reference: DispatchMailReference
  acceptedAt: string
  acceptanceOffice: string
  institutionCode: string
  productName: string
  itemNumber: string
  destinationOffice: string
  note: string
  weightGrams: number
  quantity: number
}

function validDay(value: string): boolean {
  return isValidBusinessCalendarDay(value)
}

function validateDateRange(from: string, to: string, label: string): void {
  if (from && !validDay(from)) throw new Error(`${label}开始日期必须使用 YYYY-MM-DD 格式。`)
  if (to && !validDay(to)) throw new Error(`${label}结束日期必须使用 YYYY-MM-DD 格式。`)
  if (from && to && from > to) throw new Error(`${label}开始日期不能晚于结束日期。`)
}

function matchesDate(value: string, from: string, to: string): boolean {
  const day = businessCalendarDay(value)
  return (!from || day >= from) && (!to || day <= to)
}

function transactionMailSnapshots(state: ServiceWorkspaceState): MailSnapshot[] {
  return state.transactions
    .filter((transaction) => transaction.status === 'settled')
    .map((transaction) => {
      const reference = { kind: 'transaction' as const, transactionId: transaction.id }
      const quantity = Math.max(1, transaction.service.quantity)
      return {
        key: dispatchMailReferenceKey(reference),
        reference,
        acceptedAt: transaction.acceptedAt,
        acceptanceOffice: transaction.operator.acceptanceOffice,
        institutionCode: serviceOperatorInstitutionCode(transaction.operator),
        productName: transaction.product.label,
        itemNumber: transaction.service.itemCode.trim() || transaction.id,
        destinationOffice: transaction.service.destinationOffice,
        note: transaction.service.operatorNote,
        weightGrams: Math.max(0, transaction.service.weightGrams ?? 0) * quantity,
        quantity,
      }
    })
}

function bulkMailSnapshots(state: ServiceWorkspaceState): MailSnapshot[] {
  return state.bulkBatches.flatMap((batch) => {
    if (batch.settlementStatus !== 'settled') return []
    return batch.rows.flatMap((row, rowIndex) => {
      if (row.status !== 'success') return []
      const reference = { kind: 'bulk-row' as const, batchId: batch.id, rowIndex }
      return [{
        key: dispatchMailReferenceKey(reference),
        reference,
        acceptedAt: batch.settledAt ?? `${batch.acceptanceDate}T00:00:00.000Z`,
        acceptanceOffice: batch.operator.acceptanceOffice,
        institutionCode: serviceOperatorInstitutionCode(batch.operator),
        productName: batch.product.label,
        itemNumber: row.allocatedItemCode || `${batch.id}-${rowIndex + 1}`,
        destinationOffice: row.destinationOfficeName,
        note: row.mailRemark,
        weightGrams: Math.max(0, row.resolvedWeightGrams ?? 0),
        quantity: 1,
      }]
    })
  })
}

function allMailSnapshots(state: ServiceWorkspaceState): MailSnapshot[] {
  return [...transactionMailSnapshots(state), ...bulkMailSnapshots(state)]
}

function snapshotsForReferences(
  state: ServiceWorkspaceState,
  references: DispatchMailReference[],
): MailSnapshot[] {
  const snapshotByKey = new Map(allMailSnapshots(state).map((snapshot) => [snapshot.key, snapshot]))
  return references.map((reference) => {
    const key = dispatchMailReferenceKey(reference)
    const snapshot = snapshotByKey.get(key)
    if (!snapshot) throw new Error(`未找到总包内邮件 ${key}。`)
    return snapshot
  })
}

function exportedRouteForBag(
  state: ServiceWorkspaceState,
  bagId: string,
  institutionCode: string,
): ExportedDispatchRoute | null {
  const route = state.dispatchRoutes
    .filter((candidate) =>
      candidate.deletedAt === null &&
      candidate.kind !== 'master-route' &&
      candidate.exportedAt !== null &&
      serviceOperatorInstitutionCode(candidate.generatedBy) === institutionCode &&
      candidate.bagIds.includes(bagId))
    .sort((left, right) => (right.exportedAt ?? '').localeCompare(left.exportedAt ?? ''))[0]
  return route?.exportedAt ? route as ExportedDispatchRoute : null
}

function addBalanceValue(
  rows: Map<string, DispatchBalanceRow>,
  date: string,
  key: Exclude<keyof DispatchBalanceRow, 'statisticsDate'>,
  value: number,
  query: DispatchBalanceQuery,
): void {
  if (!matchesDate(date, query.acceptedDateFrom, query.acceptedDateTo)) return
  const day = businessCalendarDay(date)
  const row = rows.get(day) ?? {
    statisticsDate: day,
    localAcceptedItems: 0,
    totalSealedItems: 0,
    sealedForOtherOfficeItems: 0,
    exportedLocalItems: 0,
    exportedForOtherOfficeItems: 0,
  }
  row[key] += value
  rows.set(day, row)
}

function addSealingEvent(
  state: ServiceWorkspaceState,
  rows: Map<string, DispatchBalanceRow>,
  query: DispatchBalanceQuery,
  generatedAt: string,
  references: DispatchMailReference[],
): void {
  const snapshots = snapshotsForReferences(state, references)
  addBalanceValue(
    rows,
    generatedAt,
    'totalSealedItems',
    snapshots.reduce((sum, snapshot) => sum + snapshot.quantity, 0),
    query,
  )
  addBalanceValue(
    rows,
    generatedAt,
    'sealedForOtherOfficeItems',
    snapshots
      .filter((snapshot) => snapshot.institutionCode !== query.institutionCode)
      .reduce((sum, snapshot) => sum + snapshot.quantity, 0),
    query,
  )
}

function addExportEvent(
  state: ServiceWorkspaceState,
  rows: Map<string, DispatchBalanceRow>,
  query: DispatchBalanceQuery,
  exportedAt: string,
  references: DispatchMailReference[],
): void {
  const snapshots = snapshotsForReferences(state, references)
  addBalanceValue(
    rows,
    exportedAt,
    'exportedLocalItems',
    snapshots
      .filter((snapshot) => snapshot.institutionCode === query.institutionCode)
      .reduce((sum, snapshot) => sum + snapshot.quantity, 0),
    query,
  )
  addBalanceValue(
    rows,
    exportedAt,
    'exportedForOtherOfficeItems',
    snapshots
      .filter((snapshot) => snapshot.institutionCode !== query.institutionCode)
      .reduce((sum, snapshot) => sum + snapshot.quantity, 0),
    query,
  )
}

export function queryDispatchBalanceLedger(
  state: ServiceWorkspaceState,
  query: DispatchBalanceQuery,
): DispatchBalanceRow[] {
  if (!query.institutionCode.trim()) throw new Error('机构代码不能为空。')
  if (!query.institutionName.trim()) throw new Error('机构名称不能为空。')
  validateDateRange(query.acceptedDateFrom, query.acceptedDateTo, '收寄')
  const rows = new Map<string, DispatchBalanceRow>()
  const snapshots = allMailSnapshots(state)

  for (const snapshot of snapshots) {
    if (snapshot.institutionCode !== query.institutionCode) continue
    addBalanceValue(
      rows,
      snapshot.acceptedAt,
      'localAcceptedItems',
      snapshot.quantity,
      query,
    )
  }

  const returnsByBag = new Map<string, DispatchBagInterchangeReturnRecord[]>()
  for (const record of state.dispatchBagInterchangeReturns) {
    returnsByBag.set(record.bagId, [...(returnsByBag.get(record.bagId) ?? []), record])
  }
  for (const bag of state.dispatchBags) {
    if (
      (bag.originOfficeCode ?? serviceOperatorInstitutionCode(bag.generatedBy)) !==
      query.institutionCode
    ) continue
    const records = (returnsByBag.get(bag.id) ?? [])
      .sort((left, right) => left.returnedAt.localeCompare(right.returnedAt))
    for (const record of records) {
      addSealingEvent(
        state,
        rows,
        query,
        record.previousGeneratedAt,
        record.previousMailReferences,
      )
    }
    addSealingEvent(state, rows, query, bag.generatedAt, bag.mailReferences)
  }

  const bagById = new Map(state.dispatchBags.map((bag) => [bag.id, bag]))
  for (const route of state.dispatchRoutes) {
    if (
      route.deletedAt !== null ||
      route.kind === 'master-route' ||
      !route.exportedAt ||
      serviceOperatorInstitutionCode(route.generatedBy) !== query.institutionCode
    ) continue
    for (const bagId of route.bagIds) {
      const bag = bagById.get(bagId)
      if (bag) addExportEvent(state, rows, query, route.exportedAt, bag.mailReferences)
    }
  }
  for (const record of state.dispatchBagInterchangeReturns) {
    if (
      serviceOperatorInstitutionCode(
        record.previousExportedBy ?? record.previousGeneratedBy,
      ) !== query.institutionCode
    ) continue
    addExportEvent(
      state,
      rows,
      query,
      record.previousExportedAt,
      record.previousMailReferences,
    )
  }

  return [...rows.values()].sort((left, right) =>
    left.statisticsDate.localeCompare(right.statisticsDate))
}

export function queryExportedBagForInterchangeReturn(
  state: ServiceWorkspaceState,
  query: DispatchInterchangeReturnQuery,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): DispatchInterchangeReturnCandidate | null {
  const barcode = query.bagBarcode.trim()
  if (!barcode) throw new Error('请输入总包条码。')
  if (!validDay(query.sealingDate)) throw new Error('封发日期必须使用 YYYY-MM-DD 格式。')
  const bag = state.dispatchBags.find((candidate) =>
    candidate.sealingStatus === 'sealed' &&
    (candidate.originOfficeCode ?? serviceOperatorInstitutionCode(candidate.generatedBy)) ===
      institutionCode &&
    candidate.bagBarcode === barcode &&
    businessCalendarDay(candidate.generatedAt) === query.sealingDate)
  if (!bag) return null
  const route = exportedRouteForBag(state, bag.id, institutionCode)
  if (!route) return null
  const snapshots = snapshotsForReferences(state, bag.mailReferences)
  const mails = snapshots.map((snapshot) => ({
    key: snapshot.key,
    reference: structuredClone(snapshot.reference),
    productName: snapshot.productName,
    itemNumber: snapshot.itemNumber,
    destinationOffice: snapshot.destinationOffice,
    note: snapshot.note,
    weightGrams: snapshot.weightGrams,
    quantity: snapshot.quantity,
    reviewerName: route.exportedBy?.displayName ?? '',
  }))
  return {
    bag: structuredClone(bag),
    route: structuredClone(route),
    mails,
    totalItems: mails.reduce((sum, mail) => sum + mail.quantity, 0),
    mailWeightGrams: mails.reduce((sum, mail) => sum + mail.weightGrams, 0),
  }
}

export function verifyExportedBagForInterchangeReturn(
  state: ServiceWorkspaceState,
  bagId: string,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): DispatchInterchangeVerification {
  const bag = state.dispatchBags.find((candidate) => candidate.id === bagId)
  if (!bag || bag.sealingStatus !== 'sealed') throw new Error('未找到有效总包。')
  if (
    (bag.originOfficeCode ?? serviceOperatorInstitutionCode(bag.generatedBy)) !== institutionCode
  ) throw new Error('该总包不属于当前经办机构。')
  const route = exportedRouteForBag(state, bag.id, institutionCode)
  if (!route) throw new Error('该总包尚未出口，不能进行电子勾核。')
  const snapshots = snapshotsForReferences(state, bag.mailReferences)
  const totalItems = snapshots.reduce((sum, snapshot) => sum + snapshot.quantity, 0)
  const mailWeightGrams = snapshots.reduce((sum, snapshot) => sum + snapshot.weightGrams, 0)
  if (totalItems !== bag.totalItems || mailWeightGrams !== bag.mailWeightGrams) {
    throw new Error('电子勾核未通过：总包件数或邮件重量与封发记录不一致。')
  }
  if (
    route.totalItems < bag.totalItems ||
    route.totalWeightGrams < bag.mailWeightGrams + bag.emptyBagWeightGrams
  ) {
    throw new Error('电子勾核未通过：总包与出口路单汇总不一致。')
  }
  return {
    bagId: bag.id,
    routeId: route.id,
    totalItems,
    mailWeightGrams,
    bagTotalWeightGrams: mailWeightGrams + bag.emptyBagWeightGrams,
  }
}

function recomputeRouteFromBags(
  route: DispatchRouteRecord,
  bags: DispatchBagRecord[],
): DispatchRouteRecord {
  return {
    ...route,
    bagIds: bags.map((bag) => bag.id),
    manifestNumbers: [...new Set(bags.map((bag) => bag.manifestNumber))],
    totalBags: bags.length,
    totalItems: bags.reduce((sum, bag) => sum + bag.totalItems, 0),
    totalWeightGrams: bags.reduce(
      (sum, bag) => sum + bag.mailWeightGrams + bag.emptyBagWeightGrams,
      0,
    ),
    containerBarcodes: bags.map((bag) => bag.containerBarcode).filter(Boolean),
  }
}

function detachBagFromExportedRoutes(
  state: ServiceWorkspaceState,
  route: ExportedDispatchRoute,
  bagId: string,
  returnedAt: string,
  operator: ServiceOperatorSnapshot,
): DispatchRouteRecord[] {
  const bagById = new Map(state.dispatchBags.map((bag) => [bag.id, bag]))
  let routes = [...state.dispatchRoutes]
  const routeIndex = routes.findIndex((candidate) => candidate.id === route.id)
  if (!route.bagIds.includes(bagId) || routeIndex < 0) {
    throw new Error('总包与出口路单关系无效。')
  }
  const remainingBags = route.bagIds
    .filter((candidate) => candidate !== bagId)
    .map((candidate) => bagById.get(candidate))
    .filter((bag): bag is DispatchBagRecord => Boolean(bag))
  routes[routeIndex] = remainingBags.length === 0
    ? {
        ...route,
        deletedAt: returnedAt,
        deletedBy: structuredClone(operator),
      }
    : recomputeRouteFromBags(route, remainingBags)

  routes = routes.map((master) => {
    if (
      master.kind !== 'master-route' ||
      master.deletedAt !== null ||
      !master.childRouteIds.includes(route.id)
    ) return master
    const children = master.childRouteIds
      .map((id) => routes.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is DispatchRouteRecord =>
        Boolean(candidate && candidate.deletedAt === null))
    if (children.length === 0) {
      return {
        ...master,
        deletedAt: returnedAt,
        deletedBy: structuredClone(operator),
      }
    }
    return {
      ...master,
      childRouteIds: children.map((child) => child.id),
      bagIds: [...new Set(children.flatMap((child) => child.bagIds))],
      manifestNumbers: [...new Set(children.flatMap((child) => child.manifestNumbers))],
      totalBags: children.reduce((sum, child) => sum + child.totalBags, 0),
      totalItems: children.reduce((sum, child) => sum + child.totalItems, 0),
      totalWeightGrams: children.reduce((sum, child) => sum + child.totalWeightGrams, 0),
      containerBarcodes: [...new Set(children.flatMap((child) => child.containerBarcodes))],
    }
  })
  return routes
}

function returnBagToInterchange(
  state: ServiceWorkspaceState,
  command: ReturnBagToInterchangeCommand,
): DispatchBalanceReturnResult {
  const bag = state.dispatchBags.find((candidate) => candidate.id === command.bagId)
  if (!bag || bag.sealingStatus !== 'sealed') throw new Error('未找到有效总包。')
  const institutionCode = serviceOperatorInstitutionCode(command.operator)
  if (
    (bag.originOfficeCode ?? serviceOperatorInstitutionCode(bag.generatedBy)) !== institutionCode
  ) throw new Error('该总包不属于当前经办机构。')
  const route = exportedRouteForBag(state, bag.id, institutionCode)
  if (!route) throw new Error('该总包尚未出口，不能退回互换局。')
  if (!['01', '02', '03'].includes(command.shift)) throw new Error('请选择封发班次。')
  if (Number.isNaN(new Date(command.returnedAt).getTime())) throw new Error('退回时间无效。')

  const previousKeys = bag.mailReferences.map(dispatchMailReferenceKey)
  const keptKeys = [...new Set(command.keptMailReferenceKeys.map((key) => key.trim()).filter(Boolean))]
  if (keptKeys.length === 0) throw new Error('总包退回后至少保留一件邮件。')
  if (keptKeys.some((key) => !previousKeys.includes(key))) {
    throw new Error('所选邮件不属于当前总包。')
  }
  const keptKeySet = new Set(keptKeys)
  const keptMailReferences = bag.mailReferences
    .filter((reference) => keptKeySet.has(dispatchMailReferenceKey(reference)))
  const removedMailReferences = bag.mailReferences
    .filter((reference) => !keptKeySet.has(dispatchMailReferenceKey(reference)))
  if (removedMailReferences.length === 0) throw new Error('请至少剔除一件问题邮件。')

  const keptSnapshots = snapshotsForReferences(state, keptMailReferences)
  const totalItems = keptSnapshots.reduce((sum, snapshot) => sum + snapshot.quantity, 0)
  const mailWeightGrams = keptSnapshots.reduce((sum, snapshot) => sum + snapshot.weightGrams, 0)
  if (!Number.isInteger(command.emptyBagWeightGrams) || command.emptyBagWeightGrams < 0) {
    throw new Error('空袋重量必须为非负整数克数。')
  }
  if (!Number.isInteger(command.bagTotalWeightGrams) || command.bagTotalWeightGrams <= 0) {
    throw new Error('总包重量必须为大于零的整数克数。')
  }
  if (command.bagTotalWeightGrams !== mailWeightGrams + command.emptyBagWeightGrams) {
    throw new Error('总包重量必须等于邮件重量与空袋重量之和。')
  }

  const changedBag: DispatchBagRecord = {
    ...bag,
    mailReferences: structuredClone(keptMailReferences),
    totalItems,
    mailWeightGrams,
    emptyBagWeightGrams: command.emptyBagWeightGrams,
    shift: command.shift,
    generatedAt: command.returnedAt,
    generatedBy: structuredClone(command.operator),
  }
  const record: DispatchBagInterchangeReturnRecord = {
    id: `THHJ-${String(state.nextDispatchBagInterchangeReturnSequence).padStart(6, '0')}`,
    bagId: bag.id,
    bagBarcode: bag.bagBarcode,
    previousRouteId: route.id,
    previousRouteNumber: route.routeNumber,
    previousRouteCode: route.routeCode,
    previousRouteName: route.routeName,
    previousExportedAt: route.exportedAt,
    previousExportedBy: structuredClone(route.exportedBy),
    previousGeneratedAt: bag.generatedAt,
    previousGeneratedBy: structuredClone(bag.generatedBy),
    previousShift: bag.shift,
    previousMailReferences: structuredClone(bag.mailReferences),
    previousTotalItems: bag.totalItems,
    previousMailWeightGrams: bag.mailWeightGrams,
    previousEmptyBagWeightGrams: bag.emptyBagWeightGrams,
    keptMailReferences: structuredClone(keptMailReferences),
    removedMailReferences: structuredClone(removedMailReferences),
    emptyBagWeightGrams: command.emptyBagWeightGrams,
    bagTotalWeightGrams: command.bagTotalWeightGrams,
    mailWeightGrams,
    totalItems,
    shift: command.shift,
    returnedAt: command.returnedAt,
    returnedBy: structuredClone(command.operator),
  }
  return {
    bag: changedBag,
    record,
    state: {
      ...state,
      dispatchBags: state.dispatchBags.map((candidate) =>
        candidate.id === bag.id ? changedBag : candidate),
      dispatchRoutes: detachBagFromExportedRoutes(
        state,
        route,
        bag.id,
        command.returnedAt,
        command.operator,
      ),
      dispatchBagInterchangeReturns: [...state.dispatchBagInterchangeReturns, record],
      nextDispatchBagInterchangeReturnSequence:
        state.nextDispatchBagInterchangeReturnSequence + 1,
    },
  }
}

export function executeDispatchBalanceReturnCommand(
  state: ServiceWorkspaceState,
  command: DispatchBalanceReturnCommand,
): DispatchBalanceReturnResult {
  switch (command.type) {
    case 'return-dispatch-bag-to-interchange':
      return returnBagToInterchange(state, command)
  }
}
