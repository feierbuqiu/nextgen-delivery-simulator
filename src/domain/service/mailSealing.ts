import { SERVICE_PRODUCTS } from './seed'
import {
  requireDispatchRelationManagementAuthorization,
  type DispatchRelationManagementAuthorization,
} from '../access/workAuthorization'
import { businessCalendarDay } from '../shared/businessTime'
import { transactionMailCustody } from './mailCustody'
import {
  assertServiceOperatorInstitution,
  DEFAULT_SERVICE_INSTITUTION_CODE,
  serviceOperatorInstitutionCode,
} from './institutionScope'
import type {
  DispatchBagChangeKind,
  DispatchBagRecord,
  DispatchBagSealingMode,
  DispatchBagShift,
  DispatchRelationOverride,
  DispatchMailReference,
  ServiceDestinationZone,
  ServiceOperatorSnapshot,
  ServiceProduct,
  ServiceProductSnapshot,
  ServiceWorkspaceState,
} from './types'

export type DispatchBulkFlag = 'all' | 'bulk' | 'single'

export interface UnsealedMailQuery {
  operatorId: string
  bulkFlag: DispatchBulkFlag
  acceptedDateFrom: string
  acceptedDateTo: string
}

export interface DispatchRelation {
  manifestTypeCode: string
  manifestTypeName: string
  bagBarcodeTypeCode: string
  bagBarcodeTypeName: string
  receivingOfficeCode: string
  receivingOfficeName: string
  directSeal: boolean
  consolidation: boolean
  localTransfer: boolean
}

export interface UnsealedMailItem {
  key: string
  reference: DispatchMailReference
  acceptedAt: string
  operator: ServiceOperatorSnapshot
  product: ServiceProductSnapshot
  destinationZone: ServiceDestinationZone
  itemNumber: string
  recipientName: string
  recipientPhone: string
  destinationOffice: string
  quantity: number
  weightGrams: number
  bulk: boolean
}

export interface UnsealedMailGroup {
  key: string
  relation: DispatchRelation
  items: UnsealedMailItem[]
  totalItems: number
  mailWeightGrams: number
}

export interface UnsealedMailQueryResult {
  groups: UnsealedMailGroup[]
  unconfiguredCount: number
  unconfiguredItems: UnsealedMailItem[]
}

export interface DispatchManifestInput {
  mailReferences: DispatchMailReference[]
  manifestNumber: string
  receptacleType: '1.袋'
  usesBarcodeContainer: boolean
  containerBarcode: string
  rfidBagTagNumber: string
}

export interface LooseOutboundMailQuery {
  productTerm: string
  acceptedDateFrom: string
  acceptedDateTo: string
}

interface GenerateDispatchBagsCommand {
  type: 'generate-dispatch-bags'
  manifests: DispatchManifestInput[]
  shift: '01' | '02' | '03'
  institutionCode: string
  generatedAt: string
  operator: ServiceOperatorSnapshot
  sealingMode?: DispatchBagSealingMode
}

interface RecordDispatchBagTagDecisionCommand {
  type: 'record-dispatch-bag-tag-decision'
  bagIds: string[]
  print: boolean
  decidedAt: string
  institutionCode: string
}

interface ReviseDispatchBagManifestCommand {
  type: 'revise-dispatch-bag-manifest'
  bagId: string
  manifestNumber: string
  changedAt: string
  operator: ServiceOperatorSnapshot
}

interface ReviseDispatchBagMailsCommand {
  type: 'revise-dispatch-bag-mails'
  bagId: string
  addMailReferences: DispatchMailReference[]
  removeMailReferences: DispatchMailReference[]
  changedAt: string
  operator: ServiceOperatorSnapshot
}

interface TransferSealedBagShiftCommand {
  type: 'transfer-sealed-bag-shift'
  bagIds: string[]
  shift: DispatchBagShift
  changedAt: string
  operator: ServiceOperatorSnapshot
}

interface CancelDispatchBagsCommand {
  type: 'cancel-dispatch-bags'
  bagIds: string[]
  cancelledAt: string
  operator: ServiceOperatorSnapshot
}

interface UpsertDispatchRelationCommand {
  type: 'upsert-dispatch-relation'
  product: ServiceProductSnapshot
  destinationZone: ServiceDestinationZone
  bulk: boolean
  manifestTypeCode: string
  routeCode: string
  receivingOfficeCode: string
  directSeal: boolean
  consolidation: boolean
  localTransfer: boolean
  institutionCode: string
  updatedAt: string
  operator: ServiceOperatorSnapshot
  authorization: DispatchRelationManagementAuthorization
}

export type MailSealingCommand =
  | GenerateDispatchBagsCommand
  | RecordDispatchBagTagDecisionCommand
  | ReviseDispatchBagManifestCommand
  | ReviseDispatchBagMailsCommand
  | TransferSealedBagShiftCommand
  | CancelDispatchBagsCommand
  | UpsertDispatchRelationCommand

export interface MailSealingResult {
  state: ServiceWorkspaceState
  bags: DispatchBagRecord[]
}

export const SIMULATED_CONTAINER_INVENTORY = [
  '9901000000000001',
  '9901000000000002',
  '9901000000000003',
] as const

export const DISPATCH_RELATION_MANIFEST_OPTIONS = [
  { code: 'GNPCXH', name: '国内平函', bagBarcodeTypeCode: '411', bagBarcodeTypeName: '平信袋' },
  { code: 'BBPCXH', name: '本埠平刷', bagBarcodeTypeCode: '411', bagBarcodeTypeName: '平信袋' },
  { code: 'BBGS', name: '本埠挂刷', bagBarcodeTypeCode: '741', bagBarcodeTypeName: '挂刷袋' },
  { code: 'GNTK', name: '国内特快', bagBarcodeTypeCode: '', bagBarcodeTypeName: '' },
  { code: 'DZPCXB', name: '大宗平常小包', bagBarcodeTypeCode: '245', bagBarcodeTypeName: '协议平常小包' },
  { code: 'GHXYXB', name: '协议挂号小包', bagBarcodeTypeCode: '257', bagBarcodeTypeName: '协议挂号小包' },
  { code: 'GLSXB', name: 'GLS国际小包', bagBarcodeTypeCode: '256', bagBarcodeTypeName: '国际小包' },
  { code: 'JHXB', name: '集货小包', bagBarcodeTypeCode: '446', bagBarcodeTypeName: '集货小包' },
  { code: 'JZBG', name: '捐赠包裹', bagBarcodeTypeCode: '821', bagBarcodeTypeName: '包裹袋' },
  { code: 'CHZB', name: '出航普包', bagBarcodeTypeCode: '218', bagBarcodeTypeName: '出航普包' },
] as const

export const SIMULATED_DISPATCH_RECEIVERS = [
  { code: '99101001', name: '栖沄邮件处理中心', routeCode: 'SIM-A01' },
  { code: '99102001', name: '澄野转运中心', routeCode: 'SIM-B02' },
  { code: '99103001', name: '镜海埠互换中心', routeCode: 'SIM-C03' },
] as const

const LOCAL_RECEIVER = SIMULATED_DISPATCH_RECEIVERS[1]
const DOMESTIC_RECEIVER = SIMULATED_DISPATCH_RECEIVERS[0]
const OVERSEAS_RECEIVER = SIMULATED_DISPATCH_RECEIVERS[2]

function relation(
  manifestTypeCode: string,
  manifestTypeName: string,
  bagBarcodeTypeCode: string,
  bagBarcodeTypeName: string,
  destinationZone: ServiceDestinationZone,
  flags: Pick<DispatchRelation, 'directSeal' | 'consolidation' | 'localTransfer'>,
): DispatchRelation {
  const receiver = destinationZone === 'local'
    ? LOCAL_RECEIVER
    : destinationZone === 'nonlocal'
      ? DOMESTIC_RECEIVER
      : OVERSEAS_RECEIVER
  return {
    manifestTypeCode,
    manifestTypeName,
    bagBarcodeTypeCode,
    bagBarcodeTypeName,
    receivingOfficeCode: receiver.code,
    receivingOfficeName: receiver.name,
    ...flags,
  }
}

function productDefinition(snapshot: ServiceProductSnapshot): ServiceProduct | null {
  return SERVICE_PRODUCTS.find((product) => product.id === snapshot.id) ??
    SERVICE_PRODUCTS.find((product) => product.searchCode === snapshot.searchCode) ??
    null
}

export function dispatchRelationOverrideKey(
  productId: string,
  destinationZone: ServiceDestinationZone,
  bulk: boolean,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): string {
  return `${institutionCode}:${productId}:${destinationZone}:${bulk ? 'bulk' : 'single'}`
}

function relationFromOverride(override: DispatchRelationOverride): DispatchRelation {
  return {
    manifestTypeCode: override.manifestTypeCode,
    manifestTypeName: override.manifestTypeName,
    bagBarcodeTypeCode: override.bagBarcodeTypeCode,
    bagBarcodeTypeName: override.bagBarcodeTypeName,
    receivingOfficeCode: override.receivingOfficeCode,
    receivingOfficeName: override.receivingOfficeName,
    directSeal: override.directSeal,
    consolidation: override.consolidation,
    localTransfer: override.localTransfer,
  }
}

export function dispatchRelationForMail(
  item: UnsealedMailItem,
  overrides: readonly DispatchRelationOverride[] = [],
): DispatchRelation | null {
  const institutionCode = serviceOperatorInstitutionCode(item.operator)
  const override = overrides.find((candidate) => (
    candidate.key === dispatchRelationOverrideKey(
      item.product.id,
      item.destinationZone,
      item.bulk,
      institutionCode,
    ) || (
      candidate.institutionCode === institutionCode &&
      candidate.productSearchCode === item.product.searchCode &&
      candidate.destinationZone === item.destinationZone &&
      candidate.bulk === item.bulk
    )
  ))
  if (override) return relationFromOverride(override)
  const product = productDefinition(item.product)
  if (!product) return null
  const code = product.searchCode
  const domestic = item.destinationZone === 'local' || item.destinationZone === 'nonlocal'
  const ordinaryLetterGroup = ['10', '11', '12', '13', '14'].includes(product.parentCode)

  if (domestic && product.parentCode === '11' && item.destinationZone === 'local') {
    return relation('BBPCXH', '本埠平刷', '411', '平信袋', item.destinationZone, {
      directSeal: false,
      consolidation: false,
      localTransfer: true,
    })
  }
  if (domestic && ordinaryLetterGroup) {
    return relation('GNPCXH', '国内平函', '411', '平信袋', item.destinationZone, {
      directSeal: false,
      consolidation: item.destinationZone === 'nonlocal',
      localTransfer: item.destinationZone === 'local',
    })
  }
  if (
    item.destinationZone === 'local' &&
    ['210', '211', '214', '218'].includes(code)
  ) {
    return relation('BBGS', '本埠挂刷', '741', '挂刷袋', item.destinationZone, {
      directSeal: false,
      consolidation: false,
      localTransfer: true,
    })
  }
  if (domestic && product.productFamily === 'express') {
    return relation('GNTK', '国内特快', '', '', item.destinationZone, {
      directSeal: item.destinationZone === 'nonlocal',
      consolidation: false,
      localTransfer: item.destinationZone === 'local',
    })
  }
  if (code === '151' && item.bulk) {
    return relation('DZPCXB', '大宗平常小包', '245', '协议平常小包', item.destinationZone, {
      directSeal: true,
      consolidation: false,
      localTransfer: false,
    })
  }
  if (code === '251') {
    return relation('GHXYXB', '协议挂号小包', '257', '协议挂号小包', item.destinationZone, {
      directSeal: true,
      consolidation: false,
      localTransfer: false,
    })
  }
  if (code === '255') {
    return relation('JHXB', '集货小包', '446', '集货小包', item.destinationZone, {
      directSeal: true,
      consolidation: false,
      localTransfer: false,
    })
  }
  if (code === '303') {
    return relation('JZBG', '爱心包裹', '821', '包裹袋', item.destinationZone, {
      directSeal: true,
      consolidation: false,
      localTransfer: item.destinationZone === 'local',
    })
  }
  if (code === '308') {
    return relation('JZBG', '捐赠包裹', '821', '包裹袋', item.destinationZone, {
      directSeal: false,
      consolidation: true,
      localTransfer: item.destinationZone === 'local',
    })
  }
  if (code === '300' && !domestic) {
    return relation('CHZB', '出航普包', '218', '出航普包', item.destinationZone, {
      directSeal: true,
      consolidation: false,
      localTransfer: false,
    })
  }
  return null
}

export function dispatchMailReferenceKey(reference: DispatchMailReference): string {
  return reference.kind === 'transaction'
    ? `transaction:${reference.transactionId}`
    : `bulk:${reference.batchId}:${reference.rowIndex}`
}

function transactionMailItem(
  transaction: ServiceWorkspaceState['transactions'][number],
): UnsealedMailItem {
  return {
      key: dispatchMailReferenceKey({ kind: 'transaction', transactionId: transaction.id }),
      reference: { kind: 'transaction' as const, transactionId: transaction.id },
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
  }
}

function transactionMailItems(state: ServiceWorkspaceState): UnsealedMailItem[] {
  return state.transactions
    .filter((transaction) => transaction.status === 'settled')
    .map(transactionMailItem)
}

function bulkMailItems(state: ServiceWorkspaceState): UnsealedMailItem[] {
  return state.bulkBatches.flatMap((batch) => {
    if (batch.settlementStatus !== 'settled') return []
    return batch.rows.flatMap((row, rowIndex) => {
      if (row.status !== 'success') return []
      const reference = { kind: 'bulk-row' as const, batchId: batch.id, rowIndex }
      return [{
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
      }]
    })
  })
}

function allMailItems(state: ServiceWorkspaceState): UnsealedMailItem[] {
  return [...transactionMailItems(state), ...bulkMailItems(state)]
}

function matchesDate(value: string, from: string, to: string): boolean {
  const day = businessCalendarDay(value)
  return (!from || day >= from) && (!to || day <= to)
}

export function dispatchRelationKey(relationValue: DispatchRelation): string {
  return [
    relationValue.manifestTypeCode,
    relationValue.receivingOfficeCode,
    relationValue.directSeal ? '1' : '0',
    relationValue.consolidation ? '1' : '0',
    relationValue.localTransfer ? '1' : '0',
  ].join(':')
}

export function dispatchBagSealingMode(bag: DispatchBagRecord): DispatchBagSealingMode {
  return bag.sealingMode ?? 'standard'
}

export function queryAvailableUnsealedMail(
  state: ServiceWorkspaceState,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): UnsealedMailItem[] {
  const sealed = new Set(state.dispatchBags
    .filter((bag) => bag.sealingStatus === 'sealed')
    .flatMap((bag) => bag.mailReferences.map(dispatchMailReferenceKey)))
  return allMailItems(state)
    .filter((item) => serviceOperatorInstitutionCode(item.operator) === institutionCode)
    .filter((item) => !sealed.has(item.key))
    .filter((item) => item.reference.kind !== 'transaction'
      || transactionMailCustody(state, item.reference.transactionId) === null)
}

export function queryLooseOutboundMail(
  state: ServiceWorkspaceState,
  query: LooseOutboundMailQuery,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): UnsealedMailItem[] {
  const term = query.productTerm.trim().toLocaleLowerCase('zh-CN')
  return queryAvailableUnsealedMail(state, institutionCode)
    .filter((item) => item.quantity === 1 && dispatchRelationForMail(
      item,
      state.dispatchRelationOverrides,
    ) !== null)
    .filter((item) => matchesDate(item.acceptedAt, query.acceptedDateFrom, query.acceptedDateTo))
    .filter((item) => !term || [
      item.product.label,
      item.product.searchCode,
      item.product.effectiveBusinessCode,
    ].some((value) => value.toLocaleLowerCase('zh-CN').includes(term)))
    .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))
}

export function queryUnsealedMail(
  state: ServiceWorkspaceState,
  query: UnsealedMailQuery,
  institutionCode = DEFAULT_SERVICE_INSTITUTION_CODE,
): UnsealedMailQueryResult {
  const candidates = queryAvailableUnsealedMail(state, institutionCode)
    .filter((item) => !query.operatorId || item.operator.operatorId === query.operatorId)
    .filter((item) => query.bulkFlag === 'all' || (
      query.bulkFlag === 'bulk' ? item.bulk : !item.bulk
    ))
    .filter((item) => matchesDate(item.acceptedAt, query.acceptedDateFrom, query.acceptedDateTo))

  const groups = new Map<string, UnsealedMailGroup>()
  let unconfiguredCount = 0
  const unconfiguredItems: UnsealedMailItem[] = []
  for (const item of candidates) {
    const resolved = dispatchRelationForMail(item, state.dispatchRelationOverrides)
    if (!resolved) {
      unconfiguredCount += item.quantity
      unconfiguredItems.push(item)
      continue
    }
    const key = dispatchRelationKey(resolved)
    const current = groups.get(key)
    if (current) {
      current.items.push(item)
      current.totalItems += item.quantity
      current.mailWeightGrams += item.weightGrams
    } else {
      groups.set(key, {
        key,
        relation: resolved,
        items: [item],
        totalItems: item.quantity,
        mailWeightGrams: item.weightGrams,
      })
    }
  }
  return {
    groups: [...groups.values()].sort((left, right) =>
      left.relation.manifestTypeCode.localeCompare(right.relation.manifestTypeCode)),
    unconfiguredCount,
    unconfiguredItems,
  }
}

function requiredIds(values: string[], label: string): string[] {
  const ids = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  if (ids.length === 0) throw new Error(`请选择需要${label}的记录。`)
  return ids
}

function mailItemByReference(
  state: ServiceWorkspaceState,
  reference: DispatchMailReference,
): UnsealedMailItem {
  const key = dispatchMailReferenceKey(reference)
  const item = allMailItems(state).find((candidate) => candidate.key === key)
  if (item) return item
  if (reference.kind === 'transaction') {
    const historical = state.transactions.find(
      (candidate) => candidate.id === reference.transactionId,
    )
    if (historical) return transactionMailItem(historical)
  }
  throw new Error(`未找到待封发邮件 ${key}。`)
}

function generatedBagBarcode(
  institutionCode: string,
  generatedAt: string,
  manifestNumber: string,
  shift: string,
  sequence: number,
): string {
  const office = institutionCode.replace(/\D/g, '').padStart(8, '9').slice(-8)
  const day = businessCalendarDay(generatedAt).replaceAll('-', '').padEnd(8, '0').slice(0, 8)
  const serial = String(sequence).padStart(6, '0')
  const body = `${office}${day}${manifestNumber}${shift}${serial}`
  const checksum = String(
    body.split('').reduce((sum, digit, index) => sum + Number(digit) * (index + 1), 0) % 1000,
  ).padStart(3, '0')
  return `${body}${checksum}`
}

function generateDispatchBags(
  state: ServiceWorkspaceState,
  command: GenerateDispatchBagsCommand,
): MailSealingResult {
  if (command.manifests.length === 0) throw new Error('请先采集清单信息。')
  const institutionCode = assertServiceOperatorInstitution(
    command.operator,
    command.institutionCode,
  )
  const sealingMode = command.sealingMode ?? 'standard'
  if (sealingMode === 'loose-outbound' && command.manifests.length !== 1) {
    throw new Error('散件外走每次只能单独封发一件邮件。')
  }
  const activeBags = state.dispatchBags.filter((bag) =>
    bag.sealingStatus === 'sealed' &&
    (bag.originOfficeCode ?? serviceOperatorInstitutionCode(bag.generatedBy)) === institutionCode)
  const usedReferenceKeys = new Set(activeBags.flatMap((bag) =>
    bag.mailReferences.map(dispatchMailReferenceKey)))
  const usedManifestNumbers = new Set(activeBags.map((bag) => bag.manifestNumber))
  const usedContainerBarcodes = new Set(activeBags
    .filter((bag) => bag.usesBarcodeContainer)
    .map((bag) => bag.containerBarcode))
  const requestReferenceKeys = new Set<string>()
  const requestManifestNumbers = new Set<string>()
  const requestContainerBarcodes = new Set<string>()
  const requestRelationKeys = new Set<string>()
  const availableReferenceKeys = new Set(
    queryAvailableUnsealedMail(state, institutionCode).map((item) => item.key),
  )
  let sequence = state.nextDispatchBagSequence
  const bags: DispatchBagRecord[] = []

  for (const manifest of command.manifests) {
    if (!/^\d{3}$/.test(manifest.manifestNumber)) {
      throw new Error('清单号码必须为 3 位数字。')
    }
    if (
      usedManifestNumbers.has(manifest.manifestNumber) ||
      requestManifestNumbers.has(manifest.manifestNumber)
    ) throw new Error(`清单号码 ${manifest.manifestNumber} 已使用。`)
    requestManifestNumbers.add(manifest.manifestNumber)

    if (manifest.receptacleType !== '1.袋') throw new Error('请选择有效容器。')
    const containerBarcode = manifest.containerBarcode.trim()
    if (manifest.usesBarcodeContainer) {
      if (!/^\d{16}$/.test(containerBarcode)) {
        throw new Error('容器条码必须为 16 位数字。')
      }
      if (!SIMULATED_CONTAINER_INVENTORY.includes(
        containerBarcode as (typeof SIMULATED_CONTAINER_INVENTORY)[number],
      )) throw new Error('容器条码未入库，不能使用。')
      if (
        usedContainerBarcodes.has(containerBarcode) ||
        requestContainerBarcodes.has(containerBarcode)
      ) throw new Error(`容器条码 ${containerBarcode} 已被使用。`)
      requestContainerBarcodes.add(containerBarcode)
    }

    if (manifest.mailReferences.length === 0) throw new Error('清单中没有待封发邮件。')
    if (sealingMode === 'loose-outbound' && manifest.mailReferences.length !== 1) {
      throw new Error('散件外走每次只能单独封发一件邮件。')
    }
    const items = manifest.mailReferences.map((reference) => {
      const key = dispatchMailReferenceKey(reference)
      if (usedReferenceKeys.has(key) || requestReferenceKeys.has(key)) {
        throw new Error(`邮件 ${key} 已经封发。`)
      }
      if (!availableReferenceKeys.has(key)) {
        throw new Error(`邮件 ${key} 当前已交接、已过戳或不符合封发条件。`)
      }
      requestReferenceKeys.add(key)
      return mailItemByReference(state, reference)
    })
    const relations = items.map((item) => dispatchRelationForMail(
      item,
      state.dispatchRelationOverrides,
    ))
    if (relations.some((item) => item === null)) {
      throw new Error('所选邮件存在未维护封发关系的业务产品。')
    }
    const resolved = relations[0]!
    if (relations.some((item) => dispatchRelationKey(item!) !== dispatchRelationKey(resolved))) {
      throw new Error('不同封发关系的邮件不能使用同一清单。')
    }
    const relationKey = dispatchRelationKey(resolved)
    if (sealingMode === 'sorting' && requestRelationKeys.has(relationKey)) {
      throw new Error('分拣封发会按封发种类和接收局自动合并，同一封发关系不能拆分。')
    }
    requestRelationKeys.add(relationKey)

    if (sealingMode === 'loose-outbound') {
      if (items[0]!.quantity !== 1) {
        throw new Error('散件外走每次只能单独封发一件邮件。')
      }
      if (manifest.usesBarcodeContainer) {
        throw new Error('散件外走不能使用条码容器。')
      }
    }

    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0)
    const mailWeightGrams = items.reduce((sum, item) => sum + item.weightGrams, 0)
    const businessDay = businessCalendarDay(command.generatedAt).replaceAll('-', '')
    const id = `ZB-${businessDay}-${String(sequence).padStart(6, '0')}`
    bags.push({
      id,
      originOfficeCode: institutionCode,
      bagBarcode: sealingMode === 'loose-outbound'
        ? items[0]!.itemNumber
        : generatedBagBarcode(
          institutionCode,
          command.generatedAt,
          manifest.manifestNumber,
          command.shift,
          sequence,
        ),
      sealingMode,
      ...resolved,
      manifestNumber: manifest.manifestNumber,
      receptacleType: manifest.receptacleType,
      usesBarcodeContainer: manifest.usesBarcodeContainer,
      containerBarcode: manifest.usesBarcodeContainer ? containerBarcode : '',
      rfidBagTagNumber: manifest.rfidBagTagNumber.trim(),
      shift: command.shift,
      mailReferences: structuredClone(manifest.mailReferences),
      totalItems,
      mailWeightGrams,
      emptyBagWeightGrams: 0,
      generatedAt: command.generatedAt,
      generatedBy: structuredClone(command.operator),
      tagPrintDecision: sealingMode === 'loose-outbound' ? 'skipped' : null,
      tagPrintedAt: null,
      sealingStatus: 'sealed',
      cancelledAt: null,
      cancelledBy: null,
    })
    sequence += 1
  }

  return {
    bags,
    state: {
      ...state,
      dispatchBags: [...state.dispatchBags, ...bags],
      nextDispatchBagSequence: sequence,
      nextDispatchManifestSequence: Math.max(
        state.nextDispatchManifestSequence,
        ...bags.map((bag) => Number(bag.manifestNumber) + 1),
      ),
    },
  }
}

function activeBagHandoverExists(state: ServiceWorkspaceState, bagId: string): boolean {
  return state.dispatchBagHandovers.some((handover) =>
    handover.bagId === bagId &&
    (handover.status === 'handed-over' || handover.status === 'received'))
}

function editableBag(
  state: ServiceWorkspaceState,
  bagId: string,
  changedAt: string,
  operator: ServiceOperatorSnapshot,
): DispatchBagRecord {
  const bag = state.dispatchBags.find((candidate) => candidate.id === bagId)
  if (!bag) throw new Error(`未找到总包 ${bagId}。`)
  if (
    (bag.originOfficeCode ?? serviceOperatorInstitutionCode(bag.generatedBy)) !==
    serviceOperatorInstitutionCode(operator)
  ) throw new Error(`${bagId} 不属于当前经办机构。`)
  if (bag.sealingStatus !== 'sealed') throw new Error(`${bagId} 已撤销封发，不能查改。`)
  if (businessCalendarDay(bag.generatedAt) !== businessCalendarDay(changedAt)) {
    throw new Error(`${bagId} 不是当日封发总包，不能查改。`)
  }
  if (activeBagHandoverExists(state, bag.id)) {
    throw new Error(`${bagId} 已交出或已接收，不能查改。`)
  }
  return bag
}

function appendBagChange(
  state: ServiceWorkspaceState,
  input: {
    bagId: string
    kind: DispatchBagChangeKind
    changedAt: string
    changedBy: ServiceOperatorSnapshot
    previousManifestNumber?: string | null
    newManifestNumber?: string | null
    addedMailReferences?: DispatchMailReference[]
    removedMailReferences?: DispatchMailReference[]
    previousShift?: DispatchBagShift | null
    newShift?: DispatchBagShift | null
  },
): ServiceWorkspaceState {
  const change = {
    id: `ZBG-${String(state.nextDispatchBagChangeSequence).padStart(6, '0')}`,
    bagId: input.bagId,
    kind: input.kind,
    changedAt: input.changedAt,
    changedBy: structuredClone(input.changedBy),
    previousManifestNumber: input.previousManifestNumber ?? null,
    newManifestNumber: input.newManifestNumber ?? null,
    addedMailReferences: structuredClone(input.addedMailReferences ?? []),
    removedMailReferences: structuredClone(input.removedMailReferences ?? []),
    previousShift: input.previousShift ?? null,
    newShift: input.newShift ?? null,
  }
  return {
    ...state,
    dispatchBagChanges: [...state.dispatchBagChanges, change],
    nextDispatchBagChangeSequence: state.nextDispatchBagChangeSequence + 1,
  }
}

function reviseManifestNumber(
  state: ServiceWorkspaceState,
  command: ReviseDispatchBagManifestCommand,
): MailSealingResult {
  const bag = editableBag(state, command.bagId, command.changedAt, command.operator)
  const manifestNumber = command.manifestNumber.trim()
  if (!/^\d{3}$/.test(manifestNumber)) throw new Error('新清单号码必须为 3 位数字。')
  if (bag.manifestNumber === manifestNumber) throw new Error('新清单号码不能与原清单号码相同。')
  if (state.dispatchBags.some((candidate) =>
    candidate.id !== bag.id && candidate.sealingStatus === 'sealed' &&
    candidate.manifestNumber === manifestNumber)) {
    throw new Error(`清单号码 ${manifestNumber} 已使用。`)
  }
  const changed = { ...bag, manifestNumber }
  let next = {
    ...state,
    dispatchBags: state.dispatchBags.map((candidate) => candidate.id === bag.id ? changed : candidate),
    nextDispatchManifestSequence: Math.max(state.nextDispatchManifestSequence, Number(manifestNumber) + 1),
  }
  next = appendBagChange(next, {
    bagId: bag.id,
    kind: 'manifest-number-changed',
    changedAt: command.changedAt,
    changedBy: command.operator,
    previousManifestNumber: bag.manifestNumber,
    newManifestNumber: manifestNumber,
  })
  return { state: next, bags: [changed] }
}

function reviseBagMails(
  state: ServiceWorkspaceState,
  command: ReviseDispatchBagMailsCommand,
): MailSealingResult {
  const bag = editableBag(state, command.bagId, command.changedAt, command.operator)
  if (dispatchBagSealingMode(bag) === 'loose-outbound') {
    throw new Error('散件外走记录不能查改包内邮件，请撤销后重新生成。')
  }
  const addedKeys = new Set(command.addMailReferences.map(dispatchMailReferenceKey))
  const removedKeys = new Set(command.removeMailReferences.map(dispatchMailReferenceKey))
  if (addedKeys.size === 0 && removedKeys.size === 0) {
    throw new Error('请选择需要追加或删除的邮件。')
  }
  if ([...addedKeys].some((key) => removedKeys.has(key))) {
    throw new Error('同一邮件不能同时追加和删除。')
  }
  const currentKeys = new Set(bag.mailReferences.map(dispatchMailReferenceKey))
  if ([...removedKeys].some((key) => !currentKeys.has(key))) {
    throw new Error('待删除邮件不在当前总包内。')
  }
  const sealedElsewhere = new Set(state.dispatchBags
    .filter((candidate) => candidate.id !== bag.id && candidate.sealingStatus === 'sealed')
    .flatMap((candidate) => candidate.mailReferences.map(dispatchMailReferenceKey)))
  if ([...addedKeys].some((key) => currentKeys.has(key) || sealedElsewhere.has(key))) {
    throw new Error('待追加邮件已封发。')
  }
  const bagItems = bag.mailReferences.map((reference) => mailItemByReference(state, reference))
  const firstBagItem = bagItems[0]
  if (!firstBagItem) throw new Error('当前总包内没有邮件。')
  const bagRelation = dispatchRelationForMail(firstBagItem, state.dispatchRelationOverrides)
  if (!bagRelation) throw new Error('当前总包封发关系无效。')
  const addedItems = command.addMailReferences.map((reference) => mailItemByReference(state, reference))
  const availableKeys = new Set(queryAvailableUnsealedMail(
    state,
    serviceOperatorInstitutionCode(command.operator),
  ).map((item) => item.key))
  if ([...addedKeys].some((key) => !availableKeys.has(key))) {
    throw new Error('待追加邮件已交接、已过戳或不符合封发条件。')
  }
  if (addedItems.some((item) => {
    const itemRelation = dispatchRelationForMail(item, state.dispatchRelationOverrides)
    return !itemRelation || dispatchRelationKey(itemRelation) !== dispatchRelationKey(bagRelation)
  })) throw new Error('待追加邮件与当前总包封发关系不一致。')
  const references = [
    ...bag.mailReferences.filter((reference) => !removedKeys.has(dispatchMailReferenceKey(reference))),
    ...command.addMailReferences,
  ]
  if (references.length === 0) throw new Error('总包内至少保留一件邮件。')
  const items = references.map((reference) => mailItemByReference(state, reference))
  const changed = {
    ...bag,
    mailReferences: structuredClone(references),
    totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
    mailWeightGrams: items.reduce((sum, item) => sum + item.weightGrams, 0),
  }
  let next = {
    ...state,
    dispatchBags: state.dispatchBags.map((candidate) => candidate.id === bag.id ? changed : candidate),
  }
  next = appendBagChange(next, {
    bagId: bag.id,
    kind: 'mail-membership-changed',
    changedAt: command.changedAt,
    changedBy: command.operator,
    addedMailReferences: command.addMailReferences,
    removedMailReferences: command.removeMailReferences,
  })
  return { state: next, bags: [changed] }
}

function transferSealedBagShift(
  state: ServiceWorkspaceState,
  command: TransferSealedBagShiftCommand,
): MailSealingResult {
  const ids = requiredIds(command.bagIds, '转移班次')
  const bags = ids.map((id) => editableBag(state, id, command.changedAt, command.operator))
  if (bags.every((bag) => bag.shift === command.shift)) throw new Error('请选择不同的目标班次。')
  let next = state
  const changed = bags.map((bag) => ({ ...bag, shift: command.shift }))
  const changedById = new Map(changed.map((bag) => [bag.id, bag]))
  next = {
    ...next,
    dispatchBags: next.dispatchBags.map((bag) => changedById.get(bag.id) ?? bag),
  }
  for (const bag of bags) {
    if (bag.shift === command.shift) continue
    next = appendBagChange(next, {
      bagId: bag.id,
      kind: 'shift-transferred',
      changedAt: command.changedAt,
      changedBy: command.operator,
      previousShift: bag.shift,
      newShift: command.shift,
    })
  }
  return { state: next, bags: changed }
}

function cancelDispatchBags(
  state: ServiceWorkspaceState,
  command: CancelDispatchBagsCommand,
): MailSealingResult {
  const ids = requiredIds(command.bagIds, '撤销封发')
  const bags = ids.map((id) => editableBag(state, id, command.cancelledAt, command.operator))
  const changed = bags.map((bag) => ({
    ...bag,
    sealingStatus: 'cancelled' as const,
    cancelledAt: command.cancelledAt,
    cancelledBy: structuredClone(command.operator),
  }))
  const changedById = new Map(changed.map((bag) => [bag.id, bag]))
  let next = {
    ...state,
    dispatchBags: state.dispatchBags.map((bag) => changedById.get(bag.id) ?? bag),
  }
  for (const bag of bags) {
    next = appendBagChange(next, {
      bagId: bag.id,
      kind: 'sealing-cancelled',
      changedAt: command.cancelledAt,
      changedBy: command.operator,
      removedMailReferences: bag.mailReferences,
    })
  }
  return { state: next, bags: changed }
}

function recordTagDecision(
  state: ServiceWorkspaceState,
  command: RecordDispatchBagTagDecisionCommand,
): MailSealingResult {
  const ids = requiredIds(command.bagIds, '记录袋牌打印决定')
  const changed = ids.map((id) => {
    const bag = state.dispatchBags.find((candidate) => candidate.id === id)
    if (!bag) throw new Error(`未找到总包 ${id}。`)
    if (
      (bag.originOfficeCode ?? serviceOperatorInstitutionCode(bag.generatedBy)) !==
      command.institutionCode
    ) throw new Error(`${id} 不属于当前经办机构。`)
    if (bag.sealingStatus !== 'sealed') throw new Error(`${id} 已撤销封发，不能记录袋牌打印决定。`)
    if (dispatchBagSealingMode(bag) === 'loose-outbound') {
      throw new Error('散件外走邮件不允许打印袋牌。')
    }
    if (bag.tagPrintDecision !== null) throw new Error(`${id} 已记录袋牌打印决定。`)
    return {
      ...bag,
      tagPrintDecision: command.print ? 'printed' as const : 'skipped' as const,
      tagPrintedAt: command.print ? command.decidedAt : null,
    }
  })
  const changedById = new Map(changed.map((bag) => [bag.id, bag]))
  return {
    bags: changed,
    state: {
      ...state,
      dispatchBags: state.dispatchBags.map((bag) => changedById.get(bag.id) ?? bag),
    },
  }
}

function upsertDispatchRelation(
  state: ServiceWorkspaceState,
  command: UpsertDispatchRelationCommand,
): MailSealingResult {
  requireDispatchRelationManagementAuthorization(
    command.authorization,
    command.operator.operatorId,
    command.institutionCode,
  )
  const institutionCode = command.institutionCode.trim()
  const productId = command.product.id.trim()
  const productSearchCode = command.product.searchCode.trim()
  const productLabel = command.product.label.trim()
  if (!productId || !productSearchCode || !productLabel) {
    throw new Error('待维护邮件缺少完整的业务产品信息。')
  }
  const manifest = DISPATCH_RELATION_MANIFEST_OPTIONS.find(
    (candidate) => candidate.code === command.manifestTypeCode,
  )
  if (!manifest) throw new Error('请选择可用的清单种类。')
  const receiver = SIMULATED_DISPATCH_RECEIVERS.find(
    (candidate) => candidate.code === command.receivingOfficeCode,
  )
  if (!receiver) throw new Error('请选择可用的总包接收局。')
  const routeCode = command.routeCode.trim()
  if (!routeCode) throw new Error('请选择可用邮路。')
  if (receiver.routeCode !== routeCode) {
    throw new Error('所选邮路不能到达该总包接收局。')
  }
  if (Number.isNaN(new Date(command.updatedAt).getTime())) {
    throw new Error('关系维护时间无效。')
  }
  const key = dispatchRelationOverrideKey(
    productId,
    command.destinationZone,
    command.bulk,
    institutionCode,
  )
  const override: DispatchRelationOverride = {
    key,
    institutionCode,
    productId,
    productSearchCode,
    productLabel,
    destinationZone: command.destinationZone,
    bulk: command.bulk,
    manifestTypeCode: manifest.code,
    manifestTypeName: manifest.name,
    bagBarcodeTypeCode: manifest.bagBarcodeTypeCode,
    bagBarcodeTypeName: manifest.bagBarcodeTypeName,
    receivingOfficeCode: receiver.code,
    receivingOfficeName: receiver.name,
    routeCode,
    directSeal: command.directSeal,
    consolidation: command.consolidation,
    localTransfer: command.localTransfer,
    updatedAt: command.updatedAt,
    updatedBy: structuredClone(command.operator),
  }
  return {
    bags: [],
    state: {
      ...state,
      dispatchRelationOverrides: [
        ...state.dispatchRelationOverrides.filter((candidate) => candidate.key !== key),
        override,
      ],
    },
  }
}

export function executeMailSealingCommand(
  state: ServiceWorkspaceState,
  command: MailSealingCommand,
): MailSealingResult {
  switch (command.type) {
    case 'generate-dispatch-bags': return generateDispatchBags(state, command)
    case 'record-dispatch-bag-tag-decision': return recordTagDecision(state, command)
    case 'revise-dispatch-bag-manifest': return reviseManifestNumber(state, command)
    case 'revise-dispatch-bag-mails': return reviseBagMails(state, command)
    case 'transfer-sealed-bag-shift': return transferSealedBagShift(state, command)
    case 'cancel-dispatch-bags': return cancelDispatchBags(state, command)
    case 'upsert-dispatch-relation': return upsertDispatchRelation(state, command)
  }
}
