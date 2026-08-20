import { fictionalDetailedAddress } from '../customer/postalAdministrativeDirectory'
import { FICTIONAL_ADDRESSES } from '../customer/seed'
import { businessCalendarDay } from '../shared/businessTime'
import type { FictionalAddress } from '../customer/types'
import {
  calculateServiceCharge,
  effectiveBusinessCode,
  validateServiceDraft,
} from './policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from './seed'
import {
  acceptServiceTransaction,
  settleServiceTransactions,
} from './transactions'
import type {
  ParcelTariffZone,
  SelfServiceImportBatch,
  SelfServiceImportRow,
  SelfServiceReservation,
  SelfServiceReservationItem,
  ServiceOperatorSnapshot,
  ServiceProduct,
  ServiceWorkspaceState,
} from './types'

export interface ImportSelfServiceReservationRequest {
  reservationNumber: string
  importedAt: string
  operator: ServiceOperatorSnapshot
}

const DEMO_RESERVATION_NUMBER = '88202608040000001'

function requireProduct(searchCode: string): ServiceProduct {
  const product = SERVICE_PRODUCTS.find((candidate) => candidate.searchCode === searchCode)
  if (!product) throw new Error(`缺少业务产品 ${searchCode}。`)
  return product
}

function requireNonlocalAddresses(): FictionalAddress[] {
  const addresses = FICTIONAL_ADDRESSES.filter(
    (candidate) => candidate.mode === 'domestic' && candidate.zone === 'nonlocal',
  ).slice(0, 5)
  if (addresses.length !== 5) throw new Error('虚构地址库不足，无法生成预约单。')
  return addresses
}

function hierarchyPart(address: FictionalAddress, index: number): string {
  return address.hierarchy[index] ?? address.hierarchy.at(-1) ?? ''
}

function reservationItem(
  address: FictionalAddress,
  index: number,
  parcelTariffZone: ParcelTariffZone,
): SelfServiceReservationItem {
  const sequence = String(index + 1).padStart(4, '0')
  return {
    orderNumber: `ZZDD20260804${sequence}`,
    productId: requireProduct('300').id,
    itemCode: `CP${String(10001 + index).padStart(11, '0')}`,
    destinationZone: 'nonlocal',
    destinationProvince: hierarchyPart(address, 0),
    destinationCity: hierarchyPart(address, 1),
    destinationCounty: hierarchyPart(address, 2),
    destinationPostcode: address.postalCode,
    destinationOfficeName: hierarchyPart(address, 2),
    recipientName: ['顾远', '沈宁', '周禾', '林舟', '许安'][index]!,
    recipientAddress: address.detailedAddress,
    recipientPhone: `1880000010${index + 1}`,
    senderName: '林澄',
    senderAddress: FICTIONAL_ADDRESSES.find(
      (candidate) => candidate.mode === 'domestic' && candidate.zone === 'local',
    )?.detailedAddress ?? fictionalDetailedAddress('C022', '新程路', 1),
    senderPhone: '10000000016',
    weightGrams: 1000,
    parcelTariffZone,
    contents: '教学资料',
  }
}

const successReservation: SelfServiceReservation = {
  reservationNumber: DEMO_RESERVATION_NUMBER,
  agreementAccountId: '91000000000001',
  agreementAccountName: '星河合作社',
  preacceptedAt: '2026-08-04T08:30:00.000Z',
  items: requireNonlocalAddresses().map((address, index) =>
    reservationItem(address, index, ['4', '1', '4', '4', '1'][index] as ParcelTariffZone),
  ),
}

export const SELF_SERVICE_RESERVATIONS: readonly SelfServiceReservation[] = [
  successReservation,
]

export function querySelfServiceReservation(
  reservationNumber: string,
): SelfServiceReservation {
  const normalized = reservationNumber.trim()
  if (!/^\d{17}$/.test(normalized)) {
    throw new Error('预约单号须为 17 位数字。')
  }
  const reservation = SELF_SERVICE_RESERVATIONS.find(
    (candidate) => candidate.reservationNumber === normalized,
  )
  if (!reservation) throw new Error('未查询到已预受理的预约单。')
  return structuredClone(reservation)
}

function importBatchId(importedAt: string, sequence: number): string {
  const date = businessCalendarDay(importedAt).replaceAll('-', '')
  return `ZZ-${date}-${String(sequence).padStart(6, '0')}`
}

function failedRow(
  item: SelfServiceReservationItem,
  importedAt: string,
  reason: string,
): SelfServiceImportRow {
  return {
    ...structuredClone(item),
    status: 'failed',
    failureReason: reason,
    transactionId: null,
    effectiveBusinessCode: '',
    postageCents: 0,
    updatedAt: importedAt,
  }
}

export function importSelfServiceReservation(
  state: ServiceWorkspaceState,
  request: ImportSelfServiceReservationRequest,
): { state: ServiceWorkspaceState; batch: SelfServiceImportBatch } {
  const reservation = querySelfServiceReservation(request.reservationNumber)
  if (state.selfServiceImports.some(
    (batch) => batch.reservationNumber === reservation.reservationNumber,
  )) {
    throw new Error('该预约单已经导入，不能重复处理。')
  }

  const id = importBatchId(request.importedAt, state.nextSelfServiceImportSequence)
  const usedItemCodes = new Set(
    state.transactions.map((transaction) => transaction.service.itemCode).filter(Boolean),
  )
  let nextState = state
  const rows: SelfServiceImportRow[] = []

  for (const item of reservation.items) {
    const product = SERVICE_PRODUCTS.find((candidate) => candidate.id === item.productId)
    if (!product) {
      rows.push(failedRow(item, request.importedAt, '业务产品不存在'))
      continue
    }
    if (usedItemCodes.has(item.itemCode)) {
      rows.push(failedRow(item, request.importedAt, '邮件号码已存在'))
      continue
    }

    const draft = {
      ...createEmptyServiceDraft(true, item.destinationZone),
      productId: product.id,
      destinationOffice: item.destinationOfficeName,
      itemCode: item.itemCode,
      weightGrams: item.weightGrams,
      paymentMethod: 'credit' as const,
      parcelTariffZone: item.parcelTariffZone,
      contents: item.contents,
      operatorNote: `客户自助导入 ${id}`,
      updatedAt: request.importedAt,
    }
    const validation = validateServiceDraft(draft, SERVICE_PRODUCTS, true)
    if (!validation.valid) {
      rows.push(failedRow(
        item,
        request.importedAt,
        [...new Set(Object.values(validation.errors))].join('；'),
      ))
      continue
    }

    const charge = calculateServiceCharge(draft, product)
    const accepted = acceptServiceTransaction(nextState, {
      acceptedAt: request.importedAt,
      charge,
      customer: {
        productFamily: product.productFamily,
        destinationRegion: 'domestic',
        sender: {
          agreementAccountId: reservation.agreementAccountId,
          agreementAccountName: reservation.agreementAccountName,
          contact: item.senderPhone,
          name: item.senderName,
          identityType: 'primary',
          identityValue: '',
          gender: '',
          detailedAddress: item.senderAddress,
          unit: reservation.agreementAccountName,
          postalCode: '',
        },
        recipient: {
          contact: item.recipientPhone,
          name: item.recipientName,
          detailedAddress: item.recipientAddress,
          unit: '',
          postalCode: item.destinationPostcode,
        },
      },
      draft,
      product,
      operator: {
        ...request.operator,
        receivingOffice: item.destinationOfficeName,
      },
    })
    const importedTransaction = {
      ...accepted.transaction,
      source: 'self-service-import' as const,
      sourceBatchId: id,
      sourceOrderNumber: item.orderNumber,
    }
    nextState = {
      ...accepted.state,
      transactions: accepted.state.transactions.map((transaction) =>
        transaction.id === importedTransaction.id ? importedTransaction : transaction,
      ),
    }
    usedItemCodes.add(item.itemCode)
    rows.push({
      ...structuredClone(item),
      status: 'success',
      failureReason: '',
      transactionId: importedTransaction.id,
      effectiveBusinessCode: effectiveBusinessCode(product, item.destinationZone),
      postageCents: charge.postageCents,
      updatedAt: request.importedAt,
    })
  }

  const successRows = rows.filter((row) => row.status === 'success')
  const batch: SelfServiceImportBatch = {
    id,
    reservationNumber: reservation.reservationNumber,
    importedAt: request.importedAt,
    status: 'processed',
    agreementAccountId: reservation.agreementAccountId,
    agreementAccountName: reservation.agreementAccountName,
    operator: structuredClone(request.operator),
    importOfficeCode: '99901001',
    importOfficeName: request.operator.acceptanceOffice,
    rows,
    totalCount: rows.length,
    successCount: successRows.length,
    failedCount: rows.length - successRows.length,
    totalSuccessfulAmountCents: successRows.reduce(
      (total, row) => total + row.postageCents,
      0,
    ),
    progressPercent: 100,
    settlementId: null,
  }
  const finalState: ServiceWorkspaceState = {
    ...nextState,
    selfServiceImports: [...nextState.selfServiceImports, batch],
    nextSelfServiceImportSequence: nextState.nextSelfServiceImportSequence + 1,
  }
  return { state: finalState, batch: structuredClone(batch) }
}

export function settleSelfServiceImport(
  state: ServiceWorkspaceState,
  batchId: string,
  settledAt: string,
): { state: ServiceWorkspaceState; batch: SelfServiceImportBatch } {
  const batch = state.selfServiceImports.find((candidate) => candidate.id === batchId)
  if (!batch) throw new Error('未找到客户自助导入批次。')
  if (batch.settlementId) throw new Error('该批次已经结算。')
  if (batch.successCount === 0) throw new Error('该批次没有可结算的成功邮件。')
  if (batch.failedCount > 0) throw new Error('请先处理失败邮件，再进入结算中心。')

  const settled = settleServiceTransactions(state, {
    transactionIds: batch.rows.flatMap((row) => row.transactionId ? [row.transactionId] : []),
    tender: 'credit',
    settledAt,
    amountReceivedCents: 0,
  })
  const updatedBatch: SelfServiceImportBatch = {
    ...batch,
    settlementId: settled.settlement.id,
  }
  const nextState: ServiceWorkspaceState = {
    ...settled.state,
    settlements: settled.state.settlements.map((record) =>
      record.id === settled.settlement.id
        ? { ...record, invoiceRequested: false }
        : record,
    ),
    selfServiceImports: settled.state.selfServiceImports.map((candidate) =>
      candidate.id === batch.id ? updatedBatch : candidate,
    ),
  }
  return { state: nextState, batch: structuredClone(updatedBatch) }
}

export function deleteSelfServiceImport(
  state: ServiceWorkspaceState,
  batchId: string,
): ServiceWorkspaceState {
  const batch = state.selfServiceImports.find((candidate) => candidate.id === batchId)
  if (!batch) throw new Error('未找到客户自助导入批次。')
  if (batch.settlementId) {
    throw new Error('已结算批次不能删除，请到查改处理办理后续业务。')
  }
  const transactionIds = new Set(
    batch.rows.flatMap((row) => row.transactionId ? [row.transactionId] : []),
  )
  return {
    ...state,
    transactions: state.transactions.filter(
      (transaction) => !transactionIds.has(transaction.id),
    ),
    corrections: state.corrections.filter(
      (record) => !transactionIds.has(record.transactionId),
    ),
    withdrawals: state.withdrawals.filter(
      (record) => !transactionIds.has(record.transactionId),
    ),
    refunds: state.refunds.filter(
      (record) => !transactionIds.has(record.transactionId),
    ),
    documentActions: state.documentActions.filter(
      (record) => !transactionIds.has(record.transactionId),
    ),
    selfServiceImports: state.selfServiceImports.filter(
      (candidate) => candidate.id !== batchId,
    ),
  }
}

function escapeCell(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function createSelfServiceImportWorkbook(
  batch: SelfServiceImportBatch,
  view: 'success' | 'processing',
): string {
  const successHeaders = [
    '订单号', '邮件号码', '机构编号', '寄达局', '收件人', '收件地址',
    '总资费（分）', '更新日期', '创建日期',
  ]
  const failureHeaders = [
    '订单号', '邮件号码', '省份代码', '机构编号', '异常原因', '更新日期',
  ]
  const rows = view === 'success'
    ? batch.rows.filter((row) => row.status === 'success').map((row) => [
        row.orderNumber,
        row.itemCode,
        batch.importOfficeCode,
        row.destinationOfficeName,
        row.recipientName,
        row.recipientAddress,
        row.postageCents,
        row.updatedAt,
        batch.importedAt,
      ])
    : batch.rows.filter((row) => row.status === 'failed').map((row) => [
        row.orderNumber,
        row.itemCode,
        row.destinationProvince,
        batch.importOfficeCode,
        row.failureReason,
        row.updatedAt,
      ])
  const headers = view === 'success' ? successHeaders : failureHeaders
  const tableRows = [headers, ...rows]
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeCell(cell)}</td>`).join('')}</tr>`)
    .join('')
  return `<html><head><meta charset="utf-8"></head><body><table>${tableRows}</table></body></html>`
}
