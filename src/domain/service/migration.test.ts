import { describe, expect, it } from 'vitest'

import { createEmptySender } from '../customer/seed'
import { acceptChannelProductOrder } from './channelProductSales'
import serviceWorkspaceV32Fixture from './fixtures/service-workspace-v32.json'
import { calculateServiceCharge } from './policy'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import { migrateServiceWorkspaceState } from './migration'
import {
  acceptServiceTransaction,
  DEFAULT_SERVICE_OPERATOR,
  settleServiceTransactions,
} from './transactions'

describe('service workspace migration', () => {
  it('rejects primitive or null payloads instead of silently replacing them with seed data', () => {
    for (const value of [null, 'damaged', 37, false]) {
      expect(() => migrateServiceWorkspaceState(value)).toThrow(
        '业务数据结构损坏，原数据未被改写',
      )
    }
    expect(migrateServiceWorkspaceState(undefined).schemaVersion).toBe(38)
  })

  it('upgrades the frozen workspace captured from the real version 32 seed', () => {
    const fixture = structuredClone(serviceWorkspaceV32Fixture)
    const original = structuredClone(fixture)

    expect(fixture.fixtureProvenance).toEqual({
      sourceCommit: 'e9d557c5213e8bfd92986f58ab987fef53b7c6a3',
      sourceFactory: 'src/domain/service/seed.ts#createServiceSeedState',
    })

    const migrated = migrateServiceWorkspaceState(fixture)

    expect(migrated).toMatchObject({
      schemaVersion: 38,
      nextWindowDeliverySequence: 7,
      nextPostalSupplyDocumentSequence: 4,
      nextPersonalRemittanceSequence: 1,
      nextInstitutionRemittanceSequence: 1,
      nextBankDepositSequence: 1,
      nextBusinessReportPrintSequence: 1,
      nextPointsInventoryMovementSequence: 1,
      windowDeliveryBags: [{ id: 'window-bag-001' }, { id: 'window-bag-002' }],
      postalSupplyDocuments: [
        { id: 'YPGL-RK-20260807-000001' },
        { id: 'YPGL-QL-20260808-000002' },
        { id: 'YPGL-QL-20260809-000003' },
      ],
    })
    expect(migrated.windowDeliveryItems).toHaveLength(6)
    expect(migrated.postageMeterDevices).toHaveLength(2)
    expect(migrated.postageMeterDeviceHandoverHistory).toHaveLength(2)
    expect(migrated.spotCheckExercises).toHaveLength(3)
    expect(fixture).toEqual(original)
  })

  it('upgrades schema version 2 without losing accepted or settled records', () => {
    const product = SERVICE_PRODUCTS[0]!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      itemCode: '7000818316568',
      weightGrams: 20,
    }
    const accepted = acceptServiceTransaction(createServiceSeedState(), {
      acceptedAt: '2026-01-15T09:20:00.000Z',
      charge: calculateServiceCharge(draft, product),
      customer: {
        productFamily: 'basic-letter',
        destinationRegion: 'domestic',
        sender: {
          agreementAccountId: null,
          agreementAccountName: '',
          contact: '',
          name: '寄件人',
          detailedAddress: '示范地址',
          unit: '',
          postalCode: '',
          identityType: '',
          identityValue: '',
          gender: '',
        },
        recipient: {
          contact: '',
          name: '收件人',
          detailedAddress: '示范地址',
          unit: '',
          postalCode: '',
        },
      },
      draft,
      product,
    })
    const settled = settleServiceTransactions(accepted.state, {
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: '2026-01-15T09:30:00.000Z',
      amountReceivedCents: 80,
    })
    const legacy = structuredClone(settled.state) as unknown as Record<string, unknown>
    legacy.schemaVersion = 2
    legacy.transactions = settled.state.transactions.map((item) => {
      const transaction = structuredClone(item) as Partial<typeof item>
      delete transaction.operator
      delete transaction.source
      delete transaction.sourceBatchId
      delete transaction.sourceOrderNumber
      const legacyService = transaction.service as Partial<typeof item.service>
      delete legacyService.contentItems
      delete legacyService.returnReceiptRequested
      delete legacyService.appointment
      const legacyCharge = transaction.charge as Partial<typeof item.charge>
      delete legacyCharge.returnReceiptCents
      delete legacyCharge.discountCents
      return transaction
    })
    delete legacy.corrections
    delete legacy.withdrawals
    delete legacy.refunds
    delete legacy.documentActions
    delete legacy.returnReceipts
    delete legacy.bulkBatches
    delete legacy.selfServiceImports
    delete legacy.looseMailHandovers
    delete legacy.dispatchBags
    delete legacy.dispatchBagHandovers
    delete legacy.dispatchBagChanges
    delete legacy.dispatchBagInterchangeReturns
    delete legacy.replyCouponRedemptions
    delete legacy.channelProductOrders
    delete legacy.supplementaryTrafficRecords
    delete legacy.electronicCommerceRecords
    delete legacy.nextCorrectionSequence
    delete legacy.nextWithdrawalSequence
    delete legacy.nextRefundSequence
    delete legacy.nextDocumentActionSequence
    delete legacy.nextReturnReceiptSequence
    delete legacy.nextBulkBatchSequence
    delete legacy.nextSelfServiceImportSequence
    delete legacy.nextLooseMailHandoverSequence
    delete legacy.nextDispatchBagSequence
    delete legacy.nextDispatchManifestSequence
    delete legacy.nextDispatchBagHandoverSequence
    delete legacy.nextDispatchBagChangeSequence
    delete legacy.nextDispatchBagInterchangeReturnSequence
    delete legacy.dispatchRoutes
    delete legacy.dispatchPrintRecords
    delete legacy.nextDispatchRouteSequence
    delete legacy.nextDispatchPrintSequence
    delete legacy.nextReplyCouponSequence
    delete legacy.nextChannelProductSequence
    delete legacy.nextSupplementaryTrafficSequence
    delete legacy.nextElectronicCommerceSequence

    const migrated = migrateServiceWorkspaceState(legacy)

    expect(migrated).toMatchObject({
      schemaVersion: 38,
      channelProductOrders: [],
      supplementaryTrafficRecords: [],
      electronicCommerceRecords: [],
      postalSupplySales: [],
      replyCouponRedemptions: [],
      dispatchBags: [],
      dispatchBagHandovers: [],
      dispatchBagChanges: [],
      dispatchBagInterchangeReturns: [],
      dispatchRoutes: [],
      dispatchPrintRecords: [],
      nextSequence: 2,
      nextSettlementSequence: 2,
      nextPostalSupplySequence: 1,
      nextChannelProductSequence: 1,
      nextSupplementaryTrafficSequence: 1,
      nextElectronicCommerceSequence: 1,
      nextReplyCouponSequence: 1,
      nextDispatchBagSequence: 1,
      nextDispatchManifestSequence: 501,
      nextDispatchBagHandoverSequence: 1,
      nextDispatchBagChangeSequence: 1,
      nextDispatchBagInterchangeReturnSequence: 1,
      nextDispatchRouteSequence: 1,
      nextDispatchPrintSequence: 1,
      transactions: [{
        id: accepted.transaction.id,
        status: 'settled',
        settlementId: 'JS-20260115-000001',
        operator: {
          operatorId: '80000001',
          workstationCode: '01',
        },
        source: 'counter',
        sourceBatchId: null,
        sourceOrderNumber: null,
        service: {
          contentItems: [],
          returnReceiptRequested: false,
          appointment: null,
        },
        charge: { returnReceiptCents: 0, discountCents: 0 },
      }],
      settlements: [{ id: 'JS-20260115-000001' }],
      corrections: [],
      withdrawals: [],
      refunds: [],
      documentActions: [],
      returnReceipts: [],
      bulkBatches: [],
      selfServiceImports: [],
      looseMailHandovers: [],
      nextCorrectionSequence: 1,
      nextWithdrawalSequence: 1,
      nextRefundSequence: 1,
      nextDocumentActionSequence: 1,
      nextReturnReceiptSequence: 1,
      nextBulkBatchSequence: 1,
      nextSelfServiceImportSequence: 1,
      nextLooseMailHandoverSequence: 1,
    })
  })

  it('rejects unknown schema payloads without rewriting the original data', () => {
    const original = { schemaVersion: 99, transactions: [{ id: 'unsafe' }] }
    const snapshot = structuredClone(original)

    expect(() => migrateServiceWorkspaceState(original)).toThrow(
      '业务数据版本 99 不受支持，原数据未被改写',
    )
    expect(original).toEqual(snapshot)
  })

  it('upgrades legacy refund records into the searchable pending state', () => {
    const legacy = structuredClone(createServiceSeedState()) as unknown as Record<string, unknown>
    legacy.schemaVersion = 11
    legacy.refunds = [{
      id: 'TK-20260115-000001',
      transactionId: 'SIM-20260115-000001',
      settlementId: 'JS-20260115-000001',
      createdAt: '2026-01-15T10:00:00.000Z',
      amountCents: 80,
      originalTender: 'third-party',
      route: 'original-payment',
    }]

    expect(migrateServiceWorkspaceState(legacy).refunds[0]).toMatchObject({
      status: 'pending',
      requestedAt: '2026-01-15T10:00:00.000Z',
      requestedBy: null,
      processedAt: null,
      processedBy: null,
      platformRefundId: '',
      failureReason: '',
    })
  })

  it('replaces legacy route-specific products with three-digit products plus derived business codes', () => {
    const product = SERVICE_PRODUCTS[0]!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      itemCode: '107-DEMO-000001',
      weightGrams: 20,
    }
    const accepted = acceptServiceTransaction(createServiceSeedState(), {
      acceptedAt: '2026-01-15T09:20:00.000Z',
      charge: calculateServiceCharge(draft, product),
      customer: {
        productFamily: 'basic-letter',
        destinationRegion: 'domestic',
        sender: {
          agreementAccountId: null,
          agreementAccountName: '',
          contact: '',
          name: '寄件人',
          detailedAddress: '示范地址',
          unit: '',
          postalCode: '',
          identityType: '',
          identityValue: '',
          gender: '',
        },
        recipient: {
          contact: '',
          name: '收件人',
          detailedAddress: '示范地址',
          unit: '',
          postalCode: '',
        },
      },
      draft,
      product,
    })
    const base = structuredClone(accepted.transaction) as unknown as Record<string, unknown>
    const service = structuredClone(accepted.transaction.service) as unknown as Record<string, unknown>
    const legacyBarcode = {
      ...base,
      product: { id: 'barcode-letter-107', label: '条码平信', searchCode: '107' },
      service: { ...service, productId: 'barcode-letter-107', destinationZone: 'local' },
    }
    const legacyRegistered = {
      ...base,
      id: 'SIM-20260115-000002',
      product: { id: 'registered-letter-200', label: '给据信函', searchCode: '200' },
      service: {
        ...service,
        productId: 'registered-letter-200',
        destinationZone: 'nonlocal',
        itemCode: 'XK00000000001',
      },
    }
    const legacyPostcard = {
      ...base,
      id: 'SIM-20260115-000003',
      product: { id: 'ordinary-postcard-local-120000', label: '本埠明信片', searchCode: '120000' },
      service: {
        ...service,
        productId: 'ordinary-postcard-local-120000',
        destinationZone: 'local',
        itemCode: '',
        remark: 'ordinary-letter',
      },
    }
    const retiredCatalogTransaction = {
      ...base,
      id: 'SIM-20260115-000004',
      product: {
        id: 'catalog-106',
        label: '条码平信',
        searchCode: '106',
        effectiveBusinessCode: '106000',
      },
      service: {
        ...service,
        productId: 'catalog-106',
        destinationZone: 'local',
        itemCode: '7000818316568',
      },
    }

    const migrated = migrateServiceWorkspaceState({
      ...accepted.state,
      schemaVersion: 3,
      draft: retiredCatalogTransaction.service,
      transactions: [
        legacyBarcode,
        legacyRegistered,
        legacyPostcard,
        retiredCatalogTransaction,
      ],
    })

    expect(migrated.draft).toMatchObject({ productId: null, itemCode: '' })
    expect(migrated.transactions).toMatchObject([
      {
        product: {
          id: 'barcode-letter-107',
          searchCode: '107',
          effectiveBusinessCode: '107000',
        },
        service: { productId: 'barcode-letter-107', itemCode: '107-DEMO-000001' },
      },
      {
        product: {
          id: 'registered-letter-200',
          searchCode: '200',
          effectiveBusinessCode: '200100',
        },
        service: { productId: 'registered-letter-200' },
      },
      {
        product: {
          id: 'barcode-letter-107',
          searchCode: '107',
          effectiveBusinessCode: '107000',
        },
        service: { productId: 'barcode-letter-107', remark: 'postcard', itemCode: '' },
      },
      {
        product: {
          id: 'catalog-106',
          searchCode: '106',
          effectiveBusinessCode: '106000',
        },
        service: { productId: 'catalog-106', itemCode: '7000818316568' },
      },
    ])
  })

  it('adds channel-product query metadata to schema 17 data', () => {
    const accepted = acceptChannelProductOrder(createServiceSeedState(), {
      submittedAt: '2026-08-04T11:00:00.000Z',
      buyer: createEmptySender(),
      lines: [{ productId: 'channel-cloud-grain-box', skuCode: 'YG-06', quantity: 1 }],
      allocations: [],
    })
    const legacy = structuredClone(accepted.state) as unknown as {
      schemaVersion: number
      channelProductOrders: Array<Record<string, unknown>>
    }
    legacy.schemaVersion = 17
    delete legacy.channelProductOrders[0]!.salesType
    delete legacy.channelProductOrders[0]!.deletedAt
    delete legacy.channelProductOrders[0]!.deletedBy
    delete legacy.channelProductOrders[0]!.receiptPrintedAt

    expect(migrateServiceWorkspaceState(legacy)).toMatchObject({
      schemaVersion: 38,
      channelProductOrders: [{
        salesType: 'offline',
        deletedAt: null,
        deletedBy: null,
        receiptPrintedAt: [],
      }],
    })
  })

  it('upgrades schema 20 bags into the shared sealing and handover model', () => {
    const migrated = migrateServiceWorkspaceState({
      schemaVersion: 20,
      dispatchBags: [{
        id: 'ZB-20260810-000001',
        manifestNumber: '501',
      }],
    })

    expect(migrated).toMatchObject({
      schemaVersion: 38,
      dispatchBags: [{
        id: 'ZB-20260810-000001',
        manifestNumber: '501',
        sealingMode: 'standard',
        sealingStatus: 'sealed',
        cancelledAt: null,
        cancelledBy: null,
      }],
      dispatchBagHandovers: [],
      dispatchBagChanges: [],
      nextDispatchBagHandoverSequence: 1,
      nextDispatchBagChangeSequence: 1,
    })
  })

  it('adds catchup and dispatch-order metadata to schema 22 routes', () => {
    const migrated = migrateServiceWorkspaceState({
      schemaVersion: 22,
      dispatchRoutes: [{ id: 'LD-20260810-000001', routeNumber: '000001' }],
    })

    expect(migrated).toMatchObject({
      schemaVersion: 38,
      dispatchRoutes: [{
        id: 'LD-20260810-000001',
        catchupReceiptDate: null,
        catchupReceivedAt: null,
        catchupReceivedBy: null,
        dispatchOrderNumber: '',
        exportAuthorizedBy: null,
        exportAuthorizedAt: null,
      }],
    })
  })

  it('adds explicit export authorization metadata to schema 36 routes', () => {
    const legacy = structuredClone(createServiceSeedState()) as unknown as Record<string, unknown>
    legacy.schemaVersion = 36
    legacy.dispatchRoutes = [{
      id: 'LD-20260810-000001',
      routeNumber: '000001',
      dispatchOrderNumber: 'PCD-20260810-A01',
      exportedAt: '2026-08-10T12:00:00.000+10:00',
    }]

    expect(migrateServiceWorkspaceState(legacy)).toMatchObject({
      schemaVersion: 38,
      dispatchRoutes: [{
        id: 'LD-20260810-000001',
        exportAuthorizedBy: null,
        exportAuthorizedAt: null,
      }],
    })
  })

  it('binds schema 37 dispatch records to their legacy operator institution', () => {
    const legacy = structuredClone(createServiceSeedState()) as unknown as Record<string, unknown>
    const legacyOperator = { ...DEFAULT_SERVICE_OPERATOR } as Record<string, unknown>
    delete legacyOperator.institutionCode
    legacy.schemaVersion = 37
    legacy.dispatchRelationOverrides = [{
      key: 'registered-letter-200:nonlocal:single',
      productId: 'registered-letter-200',
      destinationZone: 'nonlocal',
      bulk: false,
      manifestTypeCode: 'GNPCXH',
      updatedBy: legacyOperator,
    }]
    legacy.dispatchBags = [{
      id: 'ZB-20260810-000001',
      generatedBy: legacyOperator,
    }]

    const migrated = migrateServiceWorkspaceState(legacy)
    expect(migrated).toMatchObject({
      schemaVersion: 38,
      dispatchRelationOverrides: [{
        key: '99901001:registered-letter-200:nonlocal:single',
        institutionCode: '99901001',
        updatedBy: { institutionCode: '99901001' },
      }],
      dispatchBags: [{
        originOfficeCode: '99901001',
        generatedBy: { institutionCode: '99901001' },
      }],
    })
  })

  it('adds interchange-return storage to schema 23 workspaces', () => {
    const migrated = migrateServiceWorkspaceState({ schemaVersion: 23 })

    expect(migrated).toMatchObject({
      schemaVersion: 38,
      dispatchBagInterchangeReturns: [],
      nextDispatchBagInterchangeReturnSequence: 1,
    })
  })

  it('adds postage-meter devices and ledgers to schema 24 workspaces', () => {
    const migrated = migrateServiceWorkspaceState({ schemaVersion: 24 })

    expect(migrated).toMatchObject({
      schemaVersion: 38,
      postageMeterBatches: [],
      postageMeterRegistrations: [],
      postageMeterDailyBalances: [],
      nextPostageMeterBatchSequence: 1,
      nextPostageMeterRegistrationSequence: 1,
      nextPostageMeterDailyBalanceSequence: 1,
    })
    expect(migrated.postageMeterDevices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'postage-meter-primary',
        counterCode: '99901001',
        networkMode: 'direct',
      }),
    ]))
  })

  it('adds remaining postage-meter operation ledgers to schema 25 workspaces', () => {
    const migrated = migrateServiceWorkspaceState({ schemaVersion: 25 })

    expect(migrated).toMatchObject({
      schemaVersion: 38,
      postageMeterMailHandovers: [],
      postageMeterFundingRequests: [],
      postageMeterRepairRequests: [],
      nextPostageMeterMailHandoverSequence: 1,
      nextPostageMeterFundingSequence: 1,
      nextPostageMeterRepairSequence: 1,
    })
    expect(migrated.postageMeterDeviceHandoverHistory).toHaveLength(2)
  })

  it('adds special-handling storage to schema 26 workspaces', () => {
    const migrated = migrateServiceWorkspaceState({ schemaVersion: 26 })

    expect(migrated).toMatchObject({
      schemaVersion: 38,
      specialHandlingApplications: [],
      nextSpecialHandlingSequence: 1,
    })
  })

  it('adds the shared window-delivery ledger to schema 27 workspaces', () => {
    const migrated = migrateServiceWorkspaceState({ schemaVersion: 27 })

    expect(migrated).toMatchObject({
      schemaVersion: 38,
      nextWindowDeliverySequence: 7,
      nextWindowDeliveryAuditSequence: 1,
    })
    expect(migrated.windowDeliveryBags).toHaveLength(2)
    expect(migrated.windowDeliveryItems).toHaveLength(6)
    expect(migrated.windowDeliverySequenceStarts).toHaveLength(2)
    expect(migrated.windowDeliveryAudits).toEqual([])
  })

  it('adds postal-supply inventory and document ledgers to schema 28 workspaces', () => {
    const migrated = migrateServiceWorkspaceState({ schemaVersion: 28 })

    expect(migrated).toMatchObject({
      schemaVersion: 38,
      nextPostalSupplyDocumentSequence: 4,
    })
    expect(migrated.postalSupplyInventoryBalances).not.toHaveLength(0)
    expect(migrated.postalSupplyDocuments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'inbound', status: 'saved' }),
      expect.objectContaining({ kind: 'requisition', status: 'pending-approval' }),
    ]))
  })

  it('adds the shared fiscal invoice ledger to schema 29 workspaces', () => {
    const legacy = structuredClone(createServiceSeedState()) as unknown as Record<string, unknown>
    legacy.schemaVersion = 29
    delete legacy.fiscalInvoices
    delete legacy.nextFiscalInvoiceSequence

    expect(migrateServiceWorkspaceState(legacy)).toMatchObject({
      schemaVersion: 38,
      fiscalInvoices: [],
      nextFiscalInvoiceSequence: 1,
    })
  })

  it('preserves public-safe institution names in schema 31 data', () => {
    const legacyOffice = "云川邮件处理中心"
    const migrated = migrateServiceWorkspaceState({
      schemaVersion: 31,
      postageMeterDailyBalances: [{
        institutionName: legacyOffice,
      }],
    })

    expect(migrated.schemaVersion).toBe(38)
    expect(migrated.postageMeterDailyBalances[0]?.institutionName)
      .toBe(legacyOffice)
  })

  it('adds personal-remittance storage to schema 32 workspaces', () => {
    const legacy = structuredClone(createServiceSeedState()) as unknown as Record<string, unknown>
    legacy.schemaVersion = 32
    delete legacy.personalRemittances
    delete legacy.nextPersonalRemittanceSequence

    expect(migrateServiceWorkspaceState(legacy)).toMatchObject({
      schemaVersion: 38,
      personalRemittances: [],
      nextPersonalRemittanceSequence: 1,
    })
  })

  it('adds institution accounting storage to schema 33 without resetting existing sequences', () => {
    const legacy = structuredClone(createServiceSeedState()) as unknown as Record<string, unknown>
    legacy.schemaVersion = 33
    legacy.nextPersonalRemittanceSequence = 7
    delete legacy.institutionRemittances
    delete legacy.bankDepositSlips
    delete legacy.businessReportPrints
    delete legacy.nextInstitutionRemittanceSequence
    delete legacy.nextBankDepositSequence
    delete legacy.nextBusinessReportPrintSequence

    expect(migrateServiceWorkspaceState(legacy)).toMatchObject({
      schemaVersion: 38,
      personalRemittances: [],
      institutionRemittances: [],
      bankDepositSlips: [],
      businessReportPrints: [],
      nextPersonalRemittanceSequence: 7,
      nextInstitutionRemittanceSequence: 1,
      nextBankDepositSequence: 1,
      nextBusinessReportPrintSequence: 1,
    })
  })

  it('adds points-product inventory storage to schema 34 workspaces', () => {
    const legacy = structuredClone(createServiceSeedState()) as unknown as Record<string, unknown>
    legacy.schemaVersion = 34
    delete legacy.pointsProductInventory
    delete legacy.pointsInventoryMovements
    delete legacy.nextPointsInventoryMovementSequence

    const migrated = migrateServiceWorkspaceState(legacy)
    expect(migrated).toMatchObject({
      schemaVersion: 38,
      pointsInventoryMovements: [],
      nextPointsInventoryMovementSequence: 1,
    })
    expect(migrated.pointsProductInventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ productNumber: 'JF801', quantity: 6 }),
    ]))
  })

  it('adds persisted dispatch-relation maintenance storage to schema 35 workspaces', () => {
    const legacy = structuredClone(createServiceSeedState()) as unknown as Record<string, unknown>
    legacy.schemaVersion = 35
    delete legacy.dispatchRelationOverrides

    expect(migrateServiceWorkspaceState(legacy)).toMatchObject({
      schemaVersion: 38,
      dispatchRelationOverrides: [],
    })
  })

  it('preserves explicit pending bulk document and invoice choices across storage reads', () => {
    const stored = createServiceSeedState()
    stored.bulkBatches = [{
      id: 'DZ-20260819-000001',
      importedAt: '2026-08-19T09:00:00.000Z',
      acceptanceDate: '2026-08-19',
      sourceFileName: '大宗导入模板.xls',
      product: {
        id: 'catalog-303',
        label: '爱心包裹',
        searchCode: '303',
        effectiveBusinessCode: '303',
      },
      paymentMethod: 'cash-settlement',
      printRequirement: 'normal',
      numberAllocation: 'automatic',
      treatmentType: 'full-no-detail',
      agreementAccountId: '91000000000001',
      agreementAccountName: '星河合作社',
      commonRemarkLabel: 'A款',
      sender: createEmptySender(),
      operator: DEFAULT_SERVICE_OPERATOR,
      rows: [],
      totalCount: 0,
      successCount: 0,
      failedCount: 0,
      totalPostageCents: 0,
      totalSettlementDueCents: 0,
      progressPercent: 100,
      settlementStatus: 'settled',
      settledAt: '2026-08-19T09:10:00.000Z',
      bulkThreshold: 5,
      couponCount: 0,
      couponDiscountCents: 0,
      documentPromptCompletedAt: null,
      documentPrintRecords: [],
      mailLabelPrintRecords: [],
      invoiceRequested: null,
      invoiceRegistration: null,
      seal: null,
    }]

    expect(migrateServiceWorkspaceState(stored).bulkBatches[0]).toMatchObject({
      documentPromptCompletedAt: null,
      invoiceRequested: null,
    })
  })

  it('只协调可唯一识别的旧演练地址', () => {
    const legacy = structuredClone(createServiceSeedState())
    const legacyDistrict = "澜京市长风区"
    const firstItem = legacy.windowDeliveryItems[0]
    if (!firstItem) throw new Error('缺少窗投演练数据。')
    firstItem.recipientAddress = `${legacyDistrict}星河路 26 号`
    const secondItem = legacy.windowDeliveryItems[1]
    if (!secondItem) throw new Error('缺少窗投演练数据。')
    secondItem.recipientAddress = '用户自定义地址'

    const migrated = migrateServiceWorkspaceState(legacy)
    expect(migrated.windowDeliveryItems[0]?.recipientAddress)
      .toBe('澜京市栖台区星河路 26 号')
    expect(migrated.windowDeliveryItems[1]?.recipientAddress)
      .toBe('用户自定义地址')
  })
})
