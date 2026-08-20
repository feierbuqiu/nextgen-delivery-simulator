import { latestDispatchBagHandover } from './dispatchBagHandover'
import {
  businessCalendarDay,
  isValidBusinessCalendarDay,
} from '../shared/businessTime'
import {
  dispatchMailReferenceKey,
  dispatchRelationForMail,
  type UnsealedMailItem,
} from './mailSealing'
import {
  DEFAULT_SERVICE_INSTITUTION_CODE,
  serviceOperatorInstitutionCode,
} from './institutionScope'
import type {
  DispatchBagRecord,
  DispatchMailReference,
  DispatchRouteRecord,
  LooseMailHandoverRecord,
  ServiceWorkspaceState,
} from './types'

export interface DispatchMailStatusQuery {
  acceptedDate: string
  itemNumber: string
}

export interface DispatchMailStatusRow {
  key: string
  itemNumber: string
  productCode: string
  productName: string
  workstationCode: string
  operatorId: string
  operatorName: string
  acceptanceOffice: string
  destinationOffice: string
  recipientName: string
  quantity: number
  postageCents: number
  acceptedAt: string
  shift: string
  manifestTypeCode: string
  manifestTypeName: string
  manifestNumber: string
  bagBarcode: string
  currentCustodianId: string
  currentCustodianName: string
  currentCustodyOffice: string
  currentStatus: string
}

export interface DispatchBagExportTimeQuery {
  manifestTypeTerm: string
  routeCode: string
  exportDateFrom: string
  exportDateTo: string
}

export interface DispatchBagExportTimeRow {
  key: string
  bagBarcode: string
  routeKindName: string
  routeNumber: string
  routeCode: string
  routeName: string
  manifestTypeCode: string
  manifestTypeName: string
  manifestNumber: string
  confirmedExportAt: string | null
  exported: boolean
}

export interface DispatchUnhandedMailQuery {
  acceptedDateFrom: string
  acceptedDateTo: string
}

export interface DispatchUnhandedMailRow {
  key: string
  itemNumber: string
  productCode: string
  productName: string
  manifestTypeCode: string
  manifestTypeName: string
  note: string
  destinationOffice: string
  operatorId: string
  operatorName: string
  workstationCode: string
  acceptedAt: string
  custodianName: string
  mailId: string
}

interface DispatchMailSnapshot {
  item: UnsealedMailItem
  recipientName: string
  postageCents: number
  note: string
  destinationOffice: string
  mailId: string
}

function validDay(value: string): boolean {
  return isValidBusinessCalendarDay(value)
}

function matchesDate(value: string, from: string, to: string): boolean {
  const day = businessCalendarDay(value)
  return (!from || day >= from) && (!to || day <= to)
}

function matchesTerm(values: string[], term: string): boolean {
  const normalized = term.trim().toLocaleLowerCase('zh-CN')
  return !normalized || values.some((value) =>
    value.toLocaleLowerCase('zh-CN').includes(normalized))
}

function transactionSnapshots(state: ServiceWorkspaceState): DispatchMailSnapshot[] {
  return state.transactions
    .filter((transaction) => transaction.status === 'settled')
    .map((transaction) => {
      const reference = { kind: 'transaction' as const, transactionId: transaction.id }
      return {
        item: {
          key: dispatchMailReferenceKey(reference),
          reference,
          acceptedAt: transaction.acceptedAt,
          operator: structuredClone(transaction.operator),
          product: structuredClone(transaction.product),
          destinationZone: transaction.service.destinationZone,
          itemNumber: transaction.service.itemCode.trim() || transaction.id,
          recipientName: transaction.customer.recipient.name,
          recipientPhone: transaction.customer.recipient.contact,
          destinationOffice: transaction.service.destinationOffice,
          quantity: Math.max(1, transaction.service.quantity),
          weightGrams: Math.max(0, transaction.service.weightGrams ?? 0) *
            Math.max(1, transaction.service.quantity),
          bulk: Boolean(transaction.sourceBatchId),
        },
        recipientName: transaction.customer.recipient.name,
        postageCents: transaction.charge.postageCents,
        note: transaction.service.operatorNote,
        destinationOffice: transaction.service.destinationOffice,
        mailId: transaction.id,
      }
    })
}

function bulkSnapshots(state: ServiceWorkspaceState): DispatchMailSnapshot[] {
  return state.bulkBatches.flatMap((batch) => {
    if (batch.settlementStatus !== 'settled') return []
    return batch.rows.flatMap((row, rowIndex) => {
      if (row.status !== 'success') return []
      const reference = { kind: 'bulk-row' as const, batchId: batch.id, rowIndex }
      return [{
        item: {
          key: dispatchMailReferenceKey(reference),
          reference,
          acceptedAt: batch.settledAt ?? `${batch.acceptanceDate}T00:00:00.000Z`,
          operator: structuredClone(batch.operator),
          product: structuredClone(batch.product),
          destinationZone: row.destinationZone,
          itemNumber: row.allocatedItemCode || `${batch.id}-${rowIndex + 1}`,
          recipientName: row.recipientName,
          recipientPhone: row.recipientPhone,
          destinationOffice: row.destinationOfficeName === '.' ? '' : row.destinationOfficeName,
          quantity: 1,
          weightGrams: Math.max(0, row.resolvedWeightGrams ?? 0),
          bulk: true,
        },
        recipientName: row.recipientName,
        postageCents: row.postageCents,
        note: row.mailRemark,
        destinationOffice: row.destinationOfficeName,
        mailId: `${batch.id}:${rowIndex + 1}`,
      }]
    })
  })
}

function allMailSnapshots(state: ServiceWorkspaceState): DispatchMailSnapshot[] {
  return [...transactionSnapshots(state), ...bulkSnapshots(state)]
}

function latestLooseHandover(
  state: ServiceWorkspaceState,
  reference: DispatchMailReference,
): LooseMailHandoverRecord | null {
  if (reference.kind !== 'transaction') return null
  for (let index = state.looseMailHandovers.length - 1; index >= 0; index -= 1) {
    const handover = state.looseMailHandovers[index]
    if (handover?.transactionId === reference.transactionId) return handover
  }
  return null
}

function activeBagForMail(
  state: ServiceWorkspaceState,
  reference: DispatchMailReference,
): DispatchBagRecord | null {
  const key = dispatchMailReferenceKey(reference)
  for (let index = state.dispatchBags.length - 1; index >= 0; index -= 1) {
    const bag = state.dispatchBags[index]
    if (
      bag?.sealingStatus === 'sealed' &&
      bag.mailReferences.some((candidate) => dispatchMailReferenceKey(candidate) === key)
    ) return bag
  }
  return null
}

function activeRouteForBag(
  state: ServiceWorkspaceState,
  bagId: string,
): DispatchRouteRecord | null {
  for (let index = state.dispatchRoutes.length - 1; index >= 0; index -= 1) {
    const route = state.dispatchRoutes[index]
    if (
      route?.deletedAt === null &&
      route.kind !== 'master-route' &&
      route.bagIds.includes(bagId)
    ) return route
  }
  return null
}

function custodyFor(
  state: ServiceWorkspaceState,
  snapshot: DispatchMailSnapshot,
  bag: DispatchBagRecord | null,
  route: DispatchRouteRecord | null,
): Pick<DispatchMailStatusRow,
  'currentCustodianId' | 'currentCustodianName' | 'currentCustodyOffice' | 'currentStatus'> {
  if (route?.exportedAt) {
    return {
      currentCustodianId: route.exportedBy?.operatorId ?? '',
      currentCustodianName: route.exportedBy?.displayName ?? '',
      currentCustodyOffice: route.receivingOfficeName || route.routeName,
      currentStatus: '已出口',
    }
  }
  if (route) {
    return {
      currentCustodianId: route.generatedBy.operatorId,
      currentCustodianName: route.generatedBy.displayName,
      currentCustodyOffice: route.generatedBy.acceptanceOffice,
      currentStatus: '待出口',
    }
  }
  if (bag) {
    const handover = latestDispatchBagHandover(state, bag.id)
    if (handover?.status === 'handed-over') {
      return {
        currentCustodianId: '',
        currentCustodianName: '',
        currentCustodyOffice: handover.receivingOfficeName,
        currentStatus: '总包交接中',
      }
    }
    if (handover?.status === 'received') {
      return {
        currentCustodianId: handover.receivedBy?.operatorId ?? '',
        currentCustodianName: handover.receivedBy?.displayName ?? '',
        currentCustodyOffice: handover.receivingOfficeName,
        currentStatus: '已接收总包',
      }
    }
    return {
      currentCustodianId: bag.generatedBy.operatorId,
      currentCustodianName: bag.generatedBy.displayName,
      currentCustodyOffice: bag.generatedBy.acceptanceOffice,
      currentStatus: '已封发',
    }
  }
  const handover = latestLooseHandover(state, snapshot.item.reference)
  if (handover?.status === 'handed-over') {
    return {
      currentCustodianId: handover.receivingEmployeeId,
      currentCustodianName: handover.receivingEmployeeName,
      currentCustodyOffice: handover.receivingOfficeName,
      currentStatus: '交接中',
    }
  }
  if (handover?.status === 'received') {
    return {
      currentCustodianId: handover.receivedBy?.operatorId ?? handover.receivingEmployeeId,
      currentCustodianName: handover.receivedBy?.displayName ?? handover.receivingEmployeeName,
      currentCustodyOffice: handover.receivingOfficeName,
      currentStatus: '已交接',
    }
  }
  if (handover?.status === 'returned') {
    return {
      currentCustodianId: handover.returnedBy?.operatorId ?? snapshot.item.operator.operatorId,
      currentCustodianName: handover.returnedBy?.displayName ?? snapshot.item.operator.displayName,
      currentCustodyOffice: snapshot.item.operator.acceptanceOffice,
      currentStatus: '已退回',
    }
  }
  return {
    currentCustodianId: snapshot.item.operator.operatorId,
    currentCustodianName: snapshot.item.operator.displayName,
    currentCustodyOffice: snapshot.item.operator.acceptanceOffice,
    currentStatus: '未交接',
  }
}

export function queryDispatchMailStatus(
  state: ServiceWorkspaceState,
  query: DispatchMailStatusQuery,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): DispatchMailStatusRow[] {
  if (!validDay(query.acceptedDate)) throw new Error('收寄日期必须使用 YYYY-MM-DD 格式。')
  return allMailSnapshots(state)
    .filter((snapshot) =>
      serviceOperatorInstitutionCode(snapshot.item.operator) === institutionCode)
    .filter((snapshot) => businessCalendarDay(snapshot.item.acceptedAt) === query.acceptedDate)
    .filter((snapshot) => matchesTerm([snapshot.item.itemNumber], query.itemNumber))
    .map((snapshot) => {
      const bag = activeBagForMail(state, snapshot.item.reference)
      const route = bag ? activeRouteForBag(state, bag.id) : null
      const custody = custodyFor(state, snapshot, bag, route)
      return {
        key: snapshot.item.key,
        itemNumber: snapshot.item.itemNumber,
        productCode: snapshot.item.product.effectiveBusinessCode,
        productName: snapshot.item.product.label,
        workstationCode: snapshot.item.operator.workstationCode,
        operatorId: snapshot.item.operator.operatorId,
        operatorName: snapshot.item.operator.displayName,
        acceptanceOffice: snapshot.item.operator.acceptanceOffice,
        destinationOffice: snapshot.destinationOffice,
        recipientName: snapshot.recipientName,
        quantity: snapshot.item.quantity,
        postageCents: snapshot.postageCents,
        acceptedAt: snapshot.item.acceptedAt,
        shift: route?.shift ?? bag?.shift ?? '',
        manifestTypeCode: bag?.manifestTypeCode ?? '',
        manifestTypeName: bag?.manifestTypeName ?? '',
        manifestNumber: bag?.manifestNumber ?? '',
        bagBarcode: bag?.bagBarcode ?? '',
        ...custody,
      }
    })
    .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))
}

function routeKindName(route: DispatchRouteRecord): string {
  if (route.kind === 'manual-route') return '手工路单'
  if (route.kind === 'container-return') return '容器清退'
  return '路单'
}

export function queryDispatchBagExportTimes(
  state: ServiceWorkspaceState,
  query: DispatchBagExportTimeQuery,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): DispatchBagExportTimeRow[] {
  if (query.exportDateFrom && !validDay(query.exportDateFrom)) {
    throw new Error('出口开始日期必须使用 YYYY-MM-DD 格式。')
  }
  if (query.exportDateTo && !validDay(query.exportDateTo)) {
    throw new Error('出口结束日期必须使用 YYYY-MM-DD 格式。')
  }
  if (query.exportDateFrom && query.exportDateTo && query.exportDateFrom > query.exportDateTo) {
    throw new Error('出口开始日期不能晚于结束日期。')
  }
  const bagById = new Map(state.dispatchBags
    .filter((bag) => bag.sealingStatus === 'sealed')
    .filter((bag) => (
      bag.originOfficeCode ?? serviceOperatorInstitutionCode(bag.generatedBy)
    ) === institutionCode)
    .map((bag) => [bag.id, bag]))

  return state.dispatchRoutes
    .filter((route) => route.deletedAt === null && route.kind !== 'master-route')
    .filter((route) => serviceOperatorInstitutionCode(route.generatedBy) === institutionCode)
    .filter((route) => matchesTerm([route.routeCode, route.routeName], query.routeCode))
    .filter((route) => matchesTerm([
      route.manifestTypeCode,
      route.manifestTypeName,
    ], query.manifestTypeTerm))
    .filter((route) => matchesDate(
      route.exportedAt ?? `${route.catchupReceiptDate ?? route.sealingDate}T12:00:00+08:00`,
      query.exportDateFrom,
      query.exportDateTo,
    ))
    .flatMap((route) => route.bagIds.flatMap((bagId) => {
      const bag = bagById.get(bagId)
      if (!bag) return []
      return [{
        key: `${route.id}:${bag.id}`,
        bagBarcode: bag.bagBarcode,
        routeKindName: routeKindName(route),
        routeNumber: route.routeNumber,
        routeCode: route.routeCode,
        routeName: route.routeName,
        manifestTypeCode: bag.manifestTypeCode,
        manifestTypeName: bag.manifestTypeName,
        manifestNumber: bag.manifestNumber,
        confirmedExportAt: route.exportedAt,
        exported: route.exportedAt !== null,
      }]
    }))
    .sort((left, right) => right.routeNumber.localeCompare(left.routeNumber))
}

export function queryUnhandedDispatchMail(
  state: ServiceWorkspaceState,
  query: DispatchUnhandedMailQuery,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): DispatchUnhandedMailRow[] {
  if (query.acceptedDateFrom && !validDay(query.acceptedDateFrom)) {
    throw new Error('收寄开始日期必须使用 YYYY-MM-DD 格式。')
  }
  if (query.acceptedDateTo && !validDay(query.acceptedDateTo)) {
    throw new Error('收寄结束日期必须使用 YYYY-MM-DD 格式。')
  }
  if (
    query.acceptedDateFrom &&
    query.acceptedDateTo &&
    query.acceptedDateFrom > query.acceptedDateTo
  ) throw new Error('收寄开始日期不能晚于结束日期。')

  return allMailSnapshots(state)
    .filter((snapshot) =>
      serviceOperatorInstitutionCode(snapshot.item.operator) === institutionCode)
    .filter((snapshot) => matchesDate(
      snapshot.item.acceptedAt,
      query.acceptedDateFrom,
      query.acceptedDateTo,
    ))
    .filter((snapshot) => activeBagForMail(state, snapshot.item.reference) === null)
    .filter((snapshot) => {
      const handover = latestLooseHandover(state, snapshot.item.reference)
      return !handover || handover.status === 'returned'
    })
    .map((snapshot) => {
      const relation = dispatchRelationForMail(snapshot.item, state.dispatchRelationOverrides)
      return {
        key: snapshot.item.key,
        itemNumber: snapshot.item.itemNumber,
        productCode: snapshot.item.product.effectiveBusinessCode,
        productName: snapshot.item.product.label,
        manifestTypeCode: relation?.manifestTypeCode ?? '',
        manifestTypeName: relation?.manifestTypeName ?? '',
        note: snapshot.note,
        destinationOffice: snapshot.destinationOffice,
        operatorId: snapshot.item.operator.operatorId,
        operatorName: snapshot.item.operator.displayName,
        workstationCode: snapshot.item.operator.workstationCode,
        acceptedAt: snapshot.item.acceptedAt,
        custodianName: snapshot.item.operator.displayName,
        mailId: snapshot.mailId,
      }
    })
    .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))
}
