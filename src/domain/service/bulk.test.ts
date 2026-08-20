import { describe, expect, it } from 'vitest'

import { createEmptySender } from '../customer/seed'
import {
  activeBulkSealBags,
  createBulkTemplateWorkbook,
  importBulkBatch,
  parseBulkTemplate,
  recordBulkDocumentPrompt,
  recordBulkMailLabelPrint,
  recordBulkInvoiceChoice,
  recordBulkInvoiceDelivery,
  registerBulkInvoice,
  recordBulkSealTagDecision,
  sealBulkBatch,
  settleBulkBatch,
  type ImportBulkBatchRequest,
} from './bulk'
import { createServiceSeedState } from './seed'
import { projectDispatchFlow } from './dispatchFlow'
import { executeMailSealingCommand, queryAvailableUnsealedMail } from './mailSealing'
import { DEFAULT_SERVICE_OPERATOR } from './transactions'

function request(
  overrides: Partial<ImportBulkBatchRequest> = {},
): ImportBulkBatchRequest {
  const sender = {
    ...createEmptySender(),
    agreementAccountId: '91000000000001',
    agreementAccountName: '星河合作社',
    contact: '10000000016',
    name: '林澄',
    identityType: 'travel' as const,
    identityValue: 'SIM-BULK-001',
    gender: 'unspecified' as const,
    detailedAddress: '澜京市栖台区新程路1号',
    unit: '星河合作社',
    postalCode: '110001',
  }
  return {
    importedAt: '2026-08-04T09:00:00.000Z',
    acceptanceDate: '2026-08-04',
    sourceFileName: '大宗导入模板.xls',
    productId: 'catalog-300',
    paymentMethod: 'cash-settlement',
    printRequirement: 'normal',
    numberAllocation: 'automatic',
    startingItemCode: 'CP00000000001',
    fallbackDestinationZone: 'nonlocal',
    internationalDestinationCode: '',
    agreementAccountId: '91000000000001',
    agreementAccountName: '星河合作社',
    sender,
    operator: DEFAULT_SERVICE_OPERATOR,
    common: {
      remark: 'ordinary-letter',
      remarkLabel: '无',
      weightGrams: null,
      insuranceValueCents: null,
      declaredValueCents: null,
      stampAmountCents: null,
      contents: '演练资料',
      parcelTariffZone: '1',
      platformQuoteCents: null,
    },
    rows: parseBulkTemplate(createBulkTemplateWorkbook('91000000000001')),
    ...overrides,
  }
}

describe('bulk intake', () => {
  it('round-trips the annotated xls-compatible template', () => {
    const workbook = createBulkTemplateWorkbook('91000000000001')
    const rows = parseBulkTemplate(workbook)

    expect(workbook).toContain('Excel.Sheet')
    expect(rows).toHaveLength(6)
    expect(rows[0]).toMatchObject({
      recordSequence: '1',
      itemCode: '.',
      destinationPostcode: '.',
      agreementAccountId: '91000000000001',
    })
  })

  it('removes encoded and nested markup from spreadsheet cell values', () => {
    const workbook = createBulkTemplateWorkbook('91000000000001').replace(
      '<Data ss:Type="String">1</Data>',
      '<Data ss:Type="String">&lt;script&gt;alert(1)&lt;/script&gt;</Data>',
    )

    const [row] = parseBulkTemplate(workbook)

    expect(row?.recordSequence).toBe('alert(1)')
    expect(row?.recordSequence).not.toMatch(/[<>]/u)
  })

  it('imports an ordinary-parcel batch, derives the route, assigns numbers, and settles it', () => {
    const imported = importBulkBatch(createServiceSeedState(), request())

    expect(imported.batch).toMatchObject({
      id: 'DZ-20260804-000001',
      totalCount: 6,
      successCount: 6,
      failedCount: 0,
      progressPercent: 100,
      settlementStatus: 'unsettled',
    })
    expect(imported.batch.rows.map((row) => row.allocatedItemCode)).toEqual([
      'CP00000000001',
      'CP00000000002',
      'CP00000000003',
      'CP00000000004',
      'CP00000000005',
      'CP00000000006',
    ])
    expect(imported.batch.rows.every(
      (row) => row.effectiveBusinessCode === '300100' && row.postageCents > 0,
    )).toBe(true)

    const settled = settleBulkBatch(
      imported.state,
      imported.batch.id,
      '2026-08-04T09:10:00.000Z',
    )
    expect(settled.batch.settlementStatus).toBe('settled')
  })

  it('keeps invalid rows and failure reasons visible instead of silently dropping them', () => {
    const base = request()
    const rows = structuredClone(base.rows)
    rows[0]!.recordSequence = '2'
    rows[1]!.dispatchFlag = '1'

    const imported = importBulkBatch(createServiceSeedState(), {
      ...base,
      rows,
    })

    expect(imported.batch.failedCount).toBe(2)
    expect(imported.batch.rows[0]?.failureReason).toContain('记录序号')
    expect(imported.batch.rows[1]?.failureReason).toContain('封发标志')
    expect(() => settleBulkBatch(
      imported.state,
      imported.batch.id,
      '2026-08-04T09:10:00.000Z',
    )).toThrow('失败邮件')
  })

  it('rejects fewer than five mail items and accepts six registered letters', () => {
    const base = request()
    expect(() => importBulkBatch(createServiceSeedState(), {
      ...base,
      rows: base.rows.slice(0, 4),
    })).toThrow('每批至少需要 5 件')

    const registered = importBulkBatch(createServiceSeedState(), {
      ...base,
      productId: 'registered-letter-200',
      startingItemCode: 'XK00000000001',
      common: {
        ...base.common,
        parcelTariffZone: '',
      },
    })
    expect(registered.batch).toMatchObject({
      totalCount: 6,
      successCount: 6,
      failedCount: 0,
      product: { searchCode: '200' },
    })
    expect(registered.batch.rows.map((row) => row.allocatedItemCode)).toEqual([
      'XK00000000001',
      'XK00000000002',
      'XK00000000003',
      'XK00000000004',
      'XK00000000005',
      'XK00000000006',
    ])
    expect(registered.batch.rows.every(
      (row) => row.effectiveBusinessCode === '200100' && row.postageCents === 420,
    )).toBe(true)
  })

  it('treats exactly five items as bulk and records the two settlement documents before invoicing', () => {
    const base = request()
    const imported = importBulkBatch(createServiceSeedState(), {
      ...base,
      rows: base.rows.slice(0, 5),
    })
    expect(imported.batch).toMatchObject({
      totalCount: 5,
      bulkThreshold: 5,
      couponCount: 0,
      couponDiscountCents: 0,
      documentPromptCompletedAt: null,
      documentPrintRecords: [],
      invoiceRequested: null,
    })

    const settled = settleBulkBatch(
      imported.state,
      imported.batch.id,
      '2026-08-04T09:10:00.000Z',
    )
    expect(() => recordBulkInvoiceChoice(
      settled.state,
      imported.batch.id,
      false,
    )).toThrow('先处理大宗单据打印提示')

    const documented = recordBulkDocumentPrompt(settled.state, {
      batchId: imported.batch.id,
      documentKinds: ['bulk-mailing-list', 'consolidated-posting-summary'],
      handledAt: '2026-08-04T09:11:00.000Z',
      fromSequence: 1,
      toSequence: 5,
    })
    expect(documented.batch.documentPrintRecords).toEqual([
      expect.objectContaining({ kind: 'bulk-mailing-list', fromSequence: 1, toSequence: 5 }),
      expect.objectContaining({ kind: 'consolidated-posting-summary', fromSequence: 1, toSequence: 5 }),
    ])

    const labels = recordBulkMailLabelPrint(documented.state, {
      batchId: imported.batch.id,
      printedAt: '2026-08-04T09:11:30.000Z',
      fromSequence: 2,
      toSequence: 4,
      detailSheet: false,
    })
    expect(labels.batch.mailLabelPrintRecords).toEqual([
      expect.objectContaining({ fromSequence: 2, toSequence: 4 }),
    ])

    const requested = recordBulkInvoiceChoice(
      labels.state,
      imported.batch.id,
      true,
    )
    const registered = registerBulkInvoice(requested.state, {
      batchId: imported.batch.id,
      buyerType: 'organization',
      buyerName: '星河合作社',
      taxpayerId: 'SIM-BULK-001',
      deliveryPhone: '10000000016',
      buyerPhone: '',
      deliveryEmail: '',
      buyerAddress: '澜京市栖台区新程路1号',
      bankName: '',
      bankAccount: '',
      reviewer: '林澄',
      remark: '',
      issuedAt: '2026-08-04T09:12:00.000Z',
    })
    const delivered = recordBulkInvoiceDelivery(registered.state, {
      batchId: imported.batch.id,
      requested: true,
      decidedAt: '2026-08-04T09:13:00.000Z',
    })
    expect(delivered.batch).toMatchObject({
      invoiceRequested: true,
      invoiceRegistration: {
        buyerName: '星河合作社',
        deliveryRequested: true,
        deliveredAt: '2026-08-04T09:13:00.000Z',
      },
    })
  })

  it('persists the charity-parcel remark and supports direct sealing after settlement', () => {
    const base = request()
    const imported = importBulkBatch(createServiceSeedState(), {
      ...base,
      productId: 'catalog-303',
      common: {
        ...base.common,
        remarkLabel: 'A',
        platformQuoteCents: 500,
      },
    })

    expect(imported.batch.commonRemarkLabel).toBe('A')
    expect(imported.batch.rows.every((row) => row.mailRemark === 'A')).toBe(true)

    const settled = settleBulkBatch(
      imported.state,
      imported.batch.id,
      '2026-08-04T09:10:00.000Z',
    )
    const sealingOperator = {
      ...DEFAULT_SERVICE_OPERATOR,
      operatorId: '90000001',
      displayName: '演示主管',
    }
    const sealRequest = {
      batchId: imported.batch.id,
      sealedAt: '2026-08-04T09:15:00.000Z',
      dispatchShift: '01' as const,
      receptacleType: '1.袋' as const,
      itemsPerBag: 3,
      institutionCode: '99901001',
      operator: sealingOperator,
    }
    const sealed = sealBulkBatch(settled.state, sealRequest)

    expect(sealed.batch.seal).toMatchObject({
      dispatchShift: '01',
      receptacleType: '1.袋',
      itemsPerBag: 3,
      bagIds: ['ZB-20260804-000001', 'ZB-20260804-000002'],
      tagPrintDecision: null,
    })
    expect(sealed.state.dispatchBags).toHaveLength(2)
    expect(sealed.state.dispatchBags.map((bag) => bag.totalItems)).toEqual([3, 3])
    expect(sealed.state.dispatchBags.every((bag) => (
      bag.generatedBy.operatorId === sealingOperator.operatorId
    ))).toBe(true)
    expect(queryAvailableUnsealedMail(sealed.state).filter((item) => (
      item.reference.kind === 'bulk-row' && item.reference.batchId === imported.batch.id
    ))).toEqual([])
    expect(projectDispatchFlow(
      sealed.state,
      '2026-08-04T09:15:30.000Z',
    ).bagGroups[0]?.eligibleBags).toHaveLength(2)

    const decided = recordBulkSealTagDecision(sealed.state, {
      batchId: imported.batch.id,
      print: true,
      decidedAt: '2026-08-04T09:16:00.000Z',
    })
    expect(decided.batch.seal).toMatchObject({
      tagPrintDecision: 'printed',
      tagPrintedAt: '2026-08-04T09:16:00.000Z',
    })
    expect(decided.state.dispatchBags.every(
      (bag) => bag.tagPrintDecision === 'printed',
    )).toBe(true)

    expect(() => sealBulkBatch(sealed.state, sealRequest)).toThrow(
      '该爱心包裹批次已经完成直封',
    )

    const legacyBatch = structuredClone(sealed.batch)
    if (legacyBatch.seal) delete legacyBatch.seal.bagIds
    const legacyState = {
      ...sealed.state,
      bulkBatches: sealed.state.bulkBatches.map((batch) => (
        batch.id === legacyBatch.id ? legacyBatch : batch
      )),
    }
    expect(() => recordBulkSealTagDecision(legacyState, {
      batchId: imported.batch.id,
      print: false,
      decidedAt: '2026-08-04T09:16:30.000Z',
    })).toThrow('旧版直封记录未生成统一总包')

    const cancelled = executeMailSealingCommand(sealed.state, {
      type: 'cancel-dispatch-bags',
      bagIds: sealed.batch.seal?.bagIds ?? [],
      cancelledAt: '2026-08-04T09:17:00.000Z',
      operator: sealingOperator,
    })
    expect(activeBulkSealBags(cancelled.state, sealed.batch)).toEqual([])
    expect(() => recordBulkSealTagDecision(cancelled.state, {
      batchId: imported.batch.id,
      print: false,
      decidedAt: '2026-08-04T09:17:30.000Z',
    })).toThrow('当前直封总包均已撤销')

    const resealed = sealBulkBatch(cancelled.state, {
      ...sealRequest,
      sealedAt: '2026-08-04T09:18:00.000Z',
    })
    expect(activeBulkSealBags(resealed.state, resealed.batch)).toHaveLength(2)
    expect(resealed.batch.seal?.bagIds).not.toEqual(sealed.batch.seal?.bagIds)
  })

  it('rejects direct sealing after any row has entered another bag', () => {
    const base = request()
    const imported = importBulkBatch(createServiceSeedState(), {
      ...base,
      productId: 'catalog-303',
      common: { ...base.common, remarkLabel: 'A', platformQuoteCents: 500 },
    })
    const settled = settleBulkBatch(
      imported.state,
      imported.batch.id,
      '2026-08-04T09:10:00.000Z',
    )
    const first = queryAvailableUnsealedMail(settled.state).find((item) => (
      item.reference.kind === 'bulk-row' && item.reference.batchId === imported.batch.id
    ))!
    const partlySealed = executeMailSealingCommand(settled.state, {
      type: 'generate-dispatch-bags',
      manifests: [{
        mailReferences: [first.reference],
        manifestNumber: '001',
        receptacleType: '1.袋',
        usesBarcodeContainer: false,
        containerBarcode: '',
        rfidBagTagNumber: '',
      }],
      shift: '01',
      institutionCode: '99901001',
      generatedAt: '2026-08-04T09:12:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
    })

    expect(() => sealBulkBatch(partlySealed.state, {
      batchId: imported.batch.id,
      sealedAt: '2026-08-04T09:15:00.000Z',
      dispatchShift: '01',
      receptacleType: '1.袋',
      itemsPerBag: 3,
      institutionCode: '99901001',
      operator: DEFAULT_SERVICE_OPERATOR,
    })).toThrow('该批次已有邮件进入其他总包')
  })

  it('rejects mail numbers already used by an earlier intake batch', () => {
    const first = importBulkBatch(createServiceSeedState(), request())
    const repeated = importBulkBatch(first.state, request({
      importedAt: '2026-08-04T09:20:00.000Z',
    }))

    expect(repeated.batch.successCount).toBe(0)
    expect(repeated.batch.failedCount).toBe(6)
    expect(repeated.batch.rows.every((row) => (
      row.failureReason.includes('历史收寄记录')
    ))).toBe(true)
  })
})
