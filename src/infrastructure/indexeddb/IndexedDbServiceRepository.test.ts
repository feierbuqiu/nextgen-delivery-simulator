import 'fake-indexeddb/auto'

import { deleteDB, openDB } from 'idb'
import { describe, expect, it } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { DEMO_MANAGEMENT_OPERATOR_ID } from '../../domain/access/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { APPOINTMENT_ORDERS } from '../../domain/service/appointmentCollection'
import { queryUnsealedMail } from '../../domain/service/mailSealing'
import { SERVICE_PRODUCTS, createEmptyServiceDraft } from '../../domain/service/seed'
import { DEFAULT_SERVICE_OPERATOR } from '../../domain/service/transactions'
import {
  createTestDispatchRelationAuthorization,
  createTestOnSiteAuthorization,
} from '../../test/workAuthorization'
import { IndexedDbServiceRepository } from './IndexedDbServiceRepository'

describe('IndexedDbServiceRepository', () => {
  it('keeps a primitive payload unchanged when loading or mutating fails closed', async () => {
    const databaseName = `service-corrupt-test-${crypto.randomUUID()}`
    const rawDatabase = await openDB(databaseName, 1, {
      upgrade(database) {
        database.createObjectStore('state')
      },
    })
    await rawDatabase.put('state', 'damaged-payload', 'current')
    rawDatabase.close()

    const repository = new IndexedDbServiceRepository(databaseName)
    try {
      await expect(repository.load()).rejects.toThrow(
        '业务数据结构损坏，原数据未被改写',
      )
      await expect(repository.saveDraft(createEmptyServiceDraft(false))).rejects.toThrow(
        '业务数据结构损坏，原数据未被改写',
      )
      const verificationDatabase = await openDB(databaseName, 1)
      await expect(verificationDatabase.get('state', 'current')).resolves.toBe(
        'damaged-payload',
      )
      verificationDatabase.close()
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists intake, settlement, correction audit, document action, and withdrawal refund', async () => {
    const databaseName = `service-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)
    const product = SERVICE_PRODUCTS[0]!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      itemCode: '7000818316568',
      weightGrams: 20,
    }

    try {
      await repository.saveDraft(draft)
      const accepted = await repository.accept({
        acceptedAt: '2026-01-15T09:20:00.000Z',
        charge: calculateServiceCharge(draft, product),
        customer: {
          productFamily: 'basic-letter',
          destinationRegion: 'domestic',
          sender: {
            ...createEmptySender(),
            contact: '10000000001',
            name: '演示寄件人',
            detailedAddress: '瀚原省栖沄市景麓区新程路 1 号',
            postalCode: '110022',
          },
          recipient: {
            ...createEmptyRecipient(),
            contact: '10000000002',
            name: '演示收件人',
            detailedAddress: '澄岐省澄野市江洲区远帆路 2 号',
            postalCode: '120023',
          },
        },
        draft,
        product,
      })
      expect(accepted.transaction).toMatchObject({
        id: 'SIM-20260115-000001',
        status: 'pending-settlement',
        charge: { postageCents: 80, settlementDueCents: 80 },
      })

      const settled = await repository.settle({
        transactionIds: [accepted.transaction.id],
        tender: 'cash',
        settledAt: '2026-01-15T09:30:00.000Z',
        amountReceivedCents: 100,
      })
      expect(settled.settlement).toMatchObject({
        id: 'JS-20260115-000001',
        changeCents: 20,
        invoiceRequested: null,
      })
      await repository.recordInvoiceDecision(settled.settlement.id, false)
      await repository.revise({
        transactionId: accepted.transaction.id,
        correctedAt: '2026-01-15T09:40:00.000Z',
        reason: '补充办理备注',
        customer: accepted.transaction.customer,
        draft: { ...draft, operatorNote: '已核对' },
        charge: accepted.transaction.charge,
        product,
      })
      await repository.recordDocumentAction({
        transactionId: accepted.transaction.id,
        kind: 'receipt-reprint',
        requestedAt: '2026-01-15T09:45:00.000Z',
      })
      await repository.withdraw({
        transactionIds: [accepted.transaction.id],
        withdrawnAt: '2026-01-15T09:50:00.000Z',
        reason: '客户申请撤销',
        authorization: await createTestOnSiteAuthorization('withdraw-service-transaction'),
      })

      await expect(repository.load()).resolves.toMatchObject({
        schemaVersion: 38,
        postalSupplySales: [],
        draft: null,
        nextSequence: 2,
        nextSettlementSequence: 2,
        nextCorrectionSequence: 2,
        nextWithdrawalSequence: 2,
        nextRefundSequence: 2,
        nextDocumentActionSequence: 2,
        transactions: [{ status: 'withdrawn' }],
        settlements: [{ invoiceRequested: false }],
        corrections: [{ reason: '补充办理备注' }],
        withdrawals: [{ reason: '客户申请撤销' }],
        refunds: [{ amountCents: 80, route: 'cash-desk', status: 'pending' }],
        documentActions: [{ kind: 'receipt-reprint' }],
      })
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists issued, delivered and red-flushed invoice records atomically', async () => {
    const databaseName = `service-invoice-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)
    const product = SERVICE_PRODUCTS[0]!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      itemCode: '7000818316568',
      weightGrams: 20,
    }

    try {
      const accepted = await repository.accept({
        acceptedAt: '2026-01-15T09:20:00.000Z',
        charge: calculateServiceCharge(draft, product),
        customer: {
          productFamily: 'basic-letter',
          destinationRegion: 'domestic',
          sender: createEmptySender(),
          recipient: createEmptyRecipient(),
        },
        draft,
        product,
      })
      const settled = await repository.settle({
        transactionIds: [accepted.transaction.id],
        tender: 'cash',
        settledAt: '2026-01-15T09:30:00.000Z',
        amountReceivedCents: 80,
      })
      const issued = await repository.executeInvoiceManagement({
        type: 'issue-settlement-invoice',
        settlementId: settled.settlement.id,
        issuedAt: '2026-01-15T10:00:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
        registration: {
          buyerType: 'organization',
          buyerName: '星河合作社',
          taxpayerId: 'SIM-TAX-0001',
          deliveryPhone: '10000000001',
          buyerPhone: '',
          deliveryEmail: '',
          buyerAddress: '',
          bankName: '',
          bankAccount: '',
          reviewer: '演示营业员',
          remark: '',
        },
      })
      await repository.executeInvoiceManagement({
        type: 'record-invoice-delivery',
        invoiceId: issued.invoice.id,
        requested: true,
        decidedAt: '2026-01-15T10:01:00.000Z',
      })
      await repository.executeInvoiceManagement({
        type: 'red-flush-invoice',
        invoiceId: issued.invoice.id,
        redFlushedAt: '2026-01-15T10:02:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
        authorization: await createTestOnSiteAuthorization('red-flush-invoice'),
      })

      const reloaded = await repository.load()
      expect(reloaded.nextFiscalInvoiceSequence).toBe(2)
      expect(reloaded.fiscalInvoices).toEqual([expect.objectContaining({
        id: 'FP-20260115-000001',
        status: 'red-flushed',
        deliveryRequested: true,
        redFlushAuthorizedBy: DEMO_MANAGEMENT_OPERATOR_ID,
      })])
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists the third-party refund application and completed refund status', async () => {
    const databaseName = `refund-pending-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)
    const product = SERVICE_PRODUCTS[0]!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      itemCode: '7000818316568',
      weightGrams: 20,
    }

    try {
      const accepted = await repository.accept({
        acceptedAt: '2026-01-15T09:20:00.000Z',
        charge: calculateServiceCharge(draft, product),
        customer: {
          productFamily: 'basic-letter',
          destinationRegion: 'domestic',
          sender: { ...createEmptySender(), name: '演示寄件人' },
          recipient: { ...createEmptyRecipient(), name: '演示收件人' },
        },
        draft,
        product,
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.settle({
        transactionIds: [accepted.transaction.id],
        tender: 'third-party',
        settledAt: '2026-01-15T09:30:00.000Z',
        amountReceivedCents: accepted.transaction.charge.settlementDueCents,
      })
      const withdrawn = await repository.withdraw({
        transactionIds: [accepted.transaction.id],
        withdrawnAt: '2026-01-15T10:00:00.000Z',
        reason: '客户申请撤销',
        authorization: await createTestOnSiteAuthorization('withdraw-service-transaction'),
      })
      await repository.requestThirdPartyRefund({
        refundId: withdrawn.refunds[0]!.id,
        requestedAt: '2026-01-15T10:01:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.completeThirdPartyRefund({
        refundId: withdrawn.refunds[0]!.id,
        processedAt: '2026-01-15T10:02:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
        authorization: await createTestOnSiteAuthorization('complete-third-party-refund'),
      })

      await expect(repository.load()).resolves.toMatchObject({
        schemaVersion: 38,
        refunds: [{
          status: 'refunded',
          requestedBy: DEFAULT_SERVICE_OPERATOR,
          processedBy: DEFAULT_SERVICE_OPERATOR,
          platformRefundId: 'MN-TK-20260115-000001',
        }],
      })
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists a self-service reservation import and direct-credit settlement', async () => {
    const databaseName = `self-service-import-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)

    try {
      const preview = await repository.querySelfServiceReservation('88202608040000001')
      expect(preview.items).toHaveLength(5)
      const imported = await repository.importSelfServiceReservation({
        reservationNumber: preview.reservationNumber,
        importedAt: '2026-08-04T09:00:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.settleSelfServiceImport(
        imported.batch.id,
        '2026-08-04T09:10:00.000Z',
      )

      await expect(repository.load()).resolves.toMatchObject({
        schemaVersion: 38,
        selfServiceImports: [{
          id: imported.batch.id,
          totalSuccessfulAmountCents: 3400,
          settlementId: expect.any(String),
        }],
        transactions: Array.from({ length: 5 }, () => ({
          source: 'self-service-import',
          sourceBatchId: imported.batch.id,
          status: 'settled',
        })),
        settlements: [{
          tender: 'credit',
          amountDueCents: 3400,
          amountReceivedCents: 0,
        }],
      })
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists international reply coupon acceptance and settlement', async () => {
    const databaseName = `reply-coupon-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)

    try {
      const accepted = await repository.acceptReplyCouponRedemption({
        acceptedAt: '2026-08-04T10:00:00.000Z',
        couponCount: 1,
        lines: [{ itemId: 'supply-redeem-ticket-600', quantity: 2 }],
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.settleReplyCouponRedemption({
        redemptionId: accepted.redemption.id,
        settledAt: '2026-08-04T10:02:00.000Z',
        tender: 'third-party',
        amountReceivedCents: 500,
        paymentCode: 'A123456789',
      })

      await expect(repository.load()).resolves.toMatchObject({
        schemaVersion: 38,
        nextReplyCouponSequence: 2,
        nextSettlementSequence: 2,
        replyCouponRedemptions: [{
          id: accepted.redemption.id,
          status: 'settled',
          discountCents: 700,
          amountDueCents: 500,
          paymentPlatform: 'platform-a',
          paymentCodeMasked: '******6789',
        }],
        settlements: [{
          transactionIds: [accepted.redemption.id],
          tender: 'third-party',
          amountDueCents: 500,
          invoiceRequested: false,
        }],
      })
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists a channel product order with delivery allocation and settlement', async () => {
    const databaseName = `channel-product-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)

    try {
      const accepted = await repository.acceptChannelProductOrder({
        submittedAt: '2026-08-04T11:00:00.000Z',
        buyer: { ...createEmptySender(), name: '林澄' },
        lines: [{
          productId: 'channel-cloud-grain-box',
          skuCode: 'YG-06',
          quantity: 2,
        }],
        allocations: [{
          id: 'FHD-001',
          kind: 'delivery',
          recipient: {
            contact: '10000000019',
            name: '顾远',
            postalCode: '120023',
            detailedAddress: '澄岐省澄野市江洲区远景路 26 号',
          },
          pickup: null,
          lines: [{
            productId: 'channel-cloud-grain-box',
            skuCode: 'YG-06',
            quantity: 1,
          }],
        }],
      })
      await repository.settle({
        transactionIds: [accepted.order.id],
        tender: 'pos',
        settledAt: '2026-08-04T11:10:00.000Z',
        amountReceivedCents: 13600,
      })

      await expect(repository.load()).resolves.toMatchObject({
        schemaVersion: 38,
        nextChannelProductSequence: 2,
        channelProductOrders: [{
          id: 'XS-20260804-000001',
          status: 'settled',
          totalQuantity: 2,
          totalCents: 13600,
          allocations: [{ kind: 'delivery' }],
          settlementId: 'JS-20260804-000001',
        }],
        settlements: [{
          transactionIds: ['XS-20260804-000001'],
          tender: 'pos',
          amountDueCents: 13600,
        }],
      })
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists channel-product receipt history and supervisor deletion audit', async () => {
    const databaseName = `channel-product-query-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)

    try {
      const accepted = await repository.acceptChannelProductOrder({
        submittedAt: '2026-08-04T11:00:00.000Z',
        buyer: { ...createEmptySender(), name: '林澄' },
        lines: [{
          productId: 'channel-cloud-grain-box',
          skuCode: 'YG-06',
          quantity: 1,
        }],
        allocations: [],
      })
      await repository.recordChannelProductReceiptPrint({
        orderId: accepted.order.id,
        printedAt: '2026-08-04T11:05:00.000Z',
      })
      await repository.deleteChannelProductOrders({
        orderIds: [accepted.order.id],
        deletedAt: '2026-08-04T11:06:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
        authorization: await createTestOnSiteAuthorization('delete-channel-product-order'),
      })

      await expect(repository.load()).resolves.toMatchObject({
        schemaVersion: 38,
        channelProductOrders: [{
          id: 'XS-20260804-000001',
          status: 'deleted',
          salesType: 'offline',
          deletedBy: DEMO_MANAGEMENT_OPERATOR_ID,
          receiptPrintedAt: ['2026-08-04T11:05:00.000Z'],
        }],
      })
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists supplementary traffic records and credit settlement', async () => {
    const databaseName = `supplementary-traffic-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)

    try {
      const accepted = await repository.acceptSupplementaryTraffic({
        kind: 'traffic-bulk-mail',
        acceptedAt: '2026-08-10T10:00:00.000Z',
        sender: {
          ...createEmptySender(),
          agreementAccountId: '99001000000001',
          agreementAccountName: '澜京长风文书服务中心',
        },
        mailNumber: '1115206600001',
      })
      await repository.settle({
        transactionIds: [accepted.record.id],
        tender: 'credit',
        settledAt: '2026-08-10T10:05:00.000Z',
        amountReceivedCents: 0,
      })

      await expect(repository.load()).resolves.toMatchObject({
        schemaVersion: 38,
        nextSupplementaryTrafficSequence: 2,
        supplementaryTrafficRecords: [{
          id: 'JG-20260810-000001',
          status: 'settled',
          amountCents: 1500,
          mail: {
            productSearchCode: '405',
            effectiveBusinessCode: '405100',
          },
          settlementId: 'JS-20260810-000001',
        }],
        settlements: [{
          transactionIds: ['JG-20260810-000001'],
          tender: 'credit',
          amountDueCents: 1500,
          amountReceivedCents: 0,
        }],
      })
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists electronic-commerce records and common settlement', async () => {
    const databaseName = `electronic-commerce-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)

    try {
      const accepted = await repository.acceptElectronicCommerce({
        acceptedAt: '2026-08-10T10:20:00.000Z',
        projectId: 'mobile',
        providerId: 'lanjing-mobile',
        accountNumber: '10000000038',
        amountCents: 1000,
      })
      await repository.settle({
        transactionIds: [accepted.record.id],
        tender: 'third-party',
        settledAt: '2026-08-10T10:25:00.000Z',
        amountReceivedCents: 1000,
      })

      await expect(repository.load()).resolves.toMatchObject({
        schemaVersion: 38,
        nextElectronicCommerceSequence: 2,
        electronicCommerceRecords: [{
          id: 'DS-20260810-000001',
          kind: 'phone-topup',
          status: 'settled',
          accountNumber: '10000000038',
          amountCents: 1000,
          settlementId: 'JS-20260810-000001',
        }],
        settlements: [{
          transactionIds: ['DS-20260810-000001'],
          tender: 'third-party',
          amountDueCents: 1000,
        }],
      })
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists appointment source, discount, and order number', async () => {
    const databaseName = `appointment-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)
    const order = APPOINTMENT_ORDERS.find(
      (candidate) => candidate.source === 'delivery-platform',
    )!
    const product = SERVICE_PRODUCTS.find(
      (candidate) => candidate.id === order.draft.productId,
    )!

    try {
      await repository.accept({
        acceptedAt: '2026-08-10T10:30:00.000Z',
        charge: calculateServiceCharge(order.draft, product),
        customer: {
          productFamily: order.customer.productFamily,
          destinationRegion: order.customer.destinationRegion,
          sender: order.customer.sender,
          recipient: order.customer.recipient,
        },
        draft: order.draft,
        product,
      })

      await expect(repository.load()).resolves.toMatchObject({
        schemaVersion: 38,
        transactions: [{
          source: 'appointment',
          sourceOrderNumber: order.orderNumber,
          service: {
            appointment: {
              source: 'delivery-platform',
              discountCents: 200,
            },
          },
          charge: {
            discountCents: 200,
            postageCents: 600,
          },
        }],
      })
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists loose-mail handover and receipt lifecycle', async () => {
    const databaseName = `mail-handover-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)
    const product = SERVICE_PRODUCTS.find(
      (candidate) => candidate.id === 'registered-letter-200',
    )!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      destinationZone: 'nonlocal' as const,
      itemCode: 'RA12345678901',
      weightGrams: 20,
    }

    try {
      const accepted = await repository.accept({
        acceptedAt: '2026-08-10T11:00:00.000Z',
        charge: calculateServiceCharge(draft, product),
        customer: {
          productFamily: 'basic-letter',
          destinationRegion: 'domestic',
          sender: { ...createEmptySender(), name: '训练寄件人' },
          recipient: { ...createEmptyRecipient(), name: '训练收件人' },
        },
        draft,
        product,
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.settle({
        transactionIds: [accepted.transaction.id],
        tender: 'cash',
        settledAt: '2026-08-10T11:05:00.000Z',
        amountReceivedCents: accepted.transaction.charge.settlementDueCents,
      })
      const handedOver = await repository.executeMailDispatch({
        type: 'hand-over-loose-mail',
        transactionIds: [accepted.transaction.id],
        scope: 'cross-office',
        receivingOfficeCode: '99101001',
        receivingOfficeName: '栖沄邮件处理中心',
        receivingEmployeeId: '',
        receivingEmployeeName: '',
        originOfficeCode: '99901001',
        note: '早班',
        performedAt: '2026-08-10T11:10:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.executeMailDispatch({
        type: 'receive-loose-mail',
        handoverIds: [handedOver.handovers[0]!.id],
        receivedAt: '2026-08-10T11:20:00.000Z',
        receivingOfficeCode: '99101001',
        operator: {
          ...DEFAULT_SERVICE_OPERATOR,
          acceptanceOffice: '栖沄邮件处理中心',
          institutionCode: '99101001',
        },
      })

      await expect(repository.load()).resolves.toMatchObject({
        schemaVersion: 38,
        nextLooseMailHandoverSequence: 2,
        looseMailHandovers: [{
          id: 'JJ-20260810-000001',
          transactionId: accepted.transaction.id,
          status: 'received',
          receivingOfficeCode: '99101001',
          receivedAt: '2026-08-10T11:20:00.000Z',
        }],
      })
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists maintained dispatch relations, generated bags, and the tag-print decision', async () => {
    const databaseName = `mail-sealing-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)
    const product = SERVICE_PRODUCTS.find(
      (candidate) => candidate.id === 'registered-letter-200',
    )!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      destinationZone: 'nonlocal' as const,
      itemCode: 'XA10000000002',
      weightGrams: 20,
    }

    try {
      const accepted = await repository.accept({
        acceptedAt: '2026-08-10T12:00:00.000Z',
        charge: calculateServiceCharge(draft, product),
        customer: {
          productFamily: 'basic-letter',
          destinationRegion: 'domestic',
          sender: { ...createEmptySender(), name: '训练寄件人' },
          recipient: { ...createEmptyRecipient(), name: '训练收件人' },
        },
        draft,
        product,
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.settle({
        transactionIds: [accepted.transaction.id],
        tender: 'cash',
        settledAt: '2026-08-10T12:05:00.000Z',
        amountReceivedCents: accepted.transaction.charge.settlementDueCents,
      })
      await repository.executeMailSealing({
        type: 'upsert-dispatch-relation',
        product: accepted.transaction.product,
        destinationZone: 'nonlocal',
        bulk: false,
        manifestTypeCode: 'GNPCXH',
        routeCode: 'SIM-A01',
        receivingOfficeCode: '99101001',
        directSeal: false,
        consolidation: true,
        localTransfer: false,
        institutionCode: '99901001',
        updatedAt: '2026-08-10T12:06:00.000Z',
        operator: { ...DEFAULT_SERVICE_OPERATOR, operatorId: '84000001' },
        authorization: await createTestDispatchRelationAuthorization(
          '2026-08-10T12:06:00.000Z',
        ),
      })
      const state = await repository.load()
      const group = queryUnsealedMail(state, {
        operatorId: '',
        bulkFlag: 'all',
        acceptedDateFrom: '2026-08-10',
        acceptedDateTo: '2026-08-10',
      }).groups[0]!
      const generated = await repository.executeMailSealing({
        type: 'generate-dispatch-bags',
        manifests: [{
          mailReferences: group.items.map((item) => item.reference),
          manifestNumber: '501',
          receptacleType: '1.袋',
          usesBarcodeContainer: false,
          containerBarcode: '',
          rfidBagTagNumber: '',
        }],
        shift: '03',
        institutionCode: '99901001',
        generatedAt: '2026-08-10T12:10:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.executeMailSealing({
        type: 'record-dispatch-bag-tag-decision',
        bagIds: [generated.bags[0]!.id],
        print: false,
        decidedAt: '2026-08-10T12:11:00.000Z',
        institutionCode: '99901001',
      })
      await repository.executeMailSealing({
        type: 'revise-dispatch-bag-manifest',
        bagId: generated.bags[0]!.id,
        manifestNumber: '502',
        changedAt: '2026-08-10T12:12:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      const handedOver = await repository.executeDispatchBagHandover({
        type: 'hand-over-dispatch-bags',
        bagIds: [generated.bags[0]!.id],
        originOfficeCode: '99901001',
        receivingOfficeCode: '99101001',
        receivingOfficeName: '栖沄邮件处理中心',
        performedAt: '2026-08-10T12:13:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.executeDispatchBagHandover({
        type: 'receive-dispatch-bag-handovers',
        handoverIds: [handedOver.handovers[0]!.id],
        shift: '02',
        performedAt: '2026-08-10T12:14:00.000Z',
        receivingOfficeCode: '99101001',
        operator: {
          ...DEFAULT_SERVICE_OPERATOR,
          acceptanceOffice: '栖沄邮件处理中心',
          institutionCode: '99101001',
        },
      })
      const routed = await repository.executeDispatchRouting({
        type: 'generate-dispatch-routes',
        routeCode: 'SIM-A01',
        shift: '02',
        sealingDate: '2026-08-10',
        generatedAt: '2026-08-10T12:15:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.executeDispatchRouting({
        type: 'record-dispatch-print',
        documentType: 'route',
        targetIds: [routed.routes.find((route) => route.kind === 'route')!.id],
        printedAt: '2026-08-10T12:16:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })

      const reloadedRepository = new IndexedDbServiceRepository(databaseName)
      try {
        await expect(reloadedRepository.load()).resolves.toMatchObject({
          schemaVersion: 38,
          nextDispatchBagSequence: 2,
          nextDispatchManifestSequence: 503,
          nextDispatchBagHandoverSequence: 2,
          nextDispatchBagChangeSequence: 2,
          nextDispatchRouteSequence: 3,
          nextDispatchPrintSequence: 2,
          dispatchRelationOverrides: [{
            key: '99901001:registered-letter-200:nonlocal:single',
            institutionCode: '99901001',
            manifestTypeCode: 'GNPCXH',
            routeCode: 'SIM-A01',
            receivingOfficeCode: '99101001',
            updatedBy: { operatorId: '84000001' },
          }],
          dispatchBags: [{
            id: 'ZB-20260810-000001',
            manifestTypeCode: 'GNPCXH',
            manifestNumber: '502',
            shift: '03',
            totalItems: 1,
            tagPrintDecision: 'skipped',
          }],
          dispatchBagHandovers: [{
            id: 'ZBJ-000001',
            status: 'received',
            receiptShift: '02',
          }],
          dispatchBagChanges: [{
            id: 'ZBG-000001',
            kind: 'manifest-number-changed',
          }],
          dispatchRoutes: [{
            id: 'LD-20260810-000001',
            kind: 'route',
            bagIds: ['ZB-20260810-000001'],
          }, {
            id: 'ZLD-20260810-000002',
            kind: 'master-route',
            totalBags: 1,
          }],
          dispatchPrintRecords: [{
            id: 'DY-000001',
            documentType: 'route',
            targetId: 'LD-20260810-000001',
          }],
        })
      } finally {
        await reloadedRepository.close()
      }
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists an interchange return and its resealed total bag state', async () => {
    const databaseName = `interchange-return-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)
    const product = SERVICE_PRODUCTS.find(
      (candidate) => candidate.id === 'ordinary-letter-100',
    )!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      destinationZone: 'nonlocal' as const,
      destinationOffice: '栖沄邮件处理中心',
      weightGrams: 20,
    }

    try {
      const first = await repository.accept({
        acceptedAt: '2026-08-10T09:00:00.000Z',
        charge: calculateServiceCharge({ ...draft, itemCode: 'RA12345678901' }, product),
        customer: {
          productFamily: 'basic-letter',
          destinationRegion: 'domestic',
          sender: { ...createEmptySender(), name: '训练寄件人' },
          recipient: { ...createEmptyRecipient(), name: '训练收件人甲' },
        },
        draft: { ...draft, itemCode: 'RA12345678901' },
        product,
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      const second = await repository.accept({
        acceptedAt: '2026-08-10T09:05:00.000Z',
        charge: calculateServiceCharge({ ...draft, itemCode: 'RA12345678902' }, product),
        customer: {
          productFamily: 'basic-letter',
          destinationRegion: 'domestic',
          sender: { ...createEmptySender(), name: '训练寄件人' },
          recipient: { ...createEmptyRecipient(), name: '训练收件人乙' },
        },
        draft: { ...draft, itemCode: 'RA12345678902' },
        product,
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.settle({
        transactionIds: [first.transaction.id, second.transaction.id],
        tender: 'cash',
        settledAt: '2026-08-10T09:10:00.000Z',
        amountReceivedCents:
          first.transaction.charge.settlementDueCents +
          second.transaction.charge.settlementDueCents,
      })
      const group = queryUnsealedMail(await repository.load(), {
        operatorId: '',
        bulkFlag: 'all',
        acceptedDateFrom: '2026-08-10',
        acceptedDateTo: '2026-08-10',
      }).groups[0]!
      const sealed = await repository.executeMailSealing({
        type: 'generate-dispatch-bags',
        manifests: [{
          mailReferences: group.items.map((item) => item.reference),
          manifestNumber: '501',
          receptacleType: '1.袋',
          usesBarcodeContainer: false,
          containerBarcode: '',
          rfidBagTagNumber: '',
        }],
        shift: '01',
        institutionCode: '99901001',
        generatedAt: '2026-08-10T10:00:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      const routed = await repository.executeDispatchRouting({
        type: 'generate-dispatch-routes',
        routeCode: 'SIM-A01',
        shift: '01',
        sealingDate: '2026-08-10',
        generatedAt: '2026-08-10T11:00:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      const route = routed.routes.find((candidate) => candidate.kind === 'route')!
      await repository.executeDispatchRouting({
        type: 'export-dispatch-routes',
        routeIds: [route.id],
        exportDate: '2026-08-10',
        dispatchOrderNumber: 'PCD-20260810-A01',
        authorization: await createTestOnSiteAuthorization('export-dispatch-trip'),
        exportedAt: '2026-08-10T12:00:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.executeDispatchBalanceReturn({
        type: 'return-dispatch-bag-to-interchange',
        bagId: sealed.bags[0]!.id,
        keptMailReferenceKeys: [group.items[0]!.key],
        emptyBagWeightGrams: 0,
        bagTotalWeightGrams: 20,
        shift: '02',
        returnedAt: '2026-08-11T08:00:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })

      const reloadedRepository = new IndexedDbServiceRepository(databaseName)
      try {
        await expect(reloadedRepository.load()).resolves.toMatchObject({
          schemaVersion: 38,
          nextDispatchBagInterchangeReturnSequence: 2,
          dispatchBags: [{
            id: sealed.bags[0]!.id,
            totalItems: 1,
            mailWeightGrams: 20,
            shift: '02',
            generatedAt: '2026-08-11T08:00:00.000Z',
          }],
          dispatchBagInterchangeReturns: [{
            id: 'THHJ-000001',
            previousRouteId: route.id,
            previousTotalItems: 2,
            totalItems: 1,
          }],
          dispatchRoutes: [{ deletedAt: '2026-08-11T08:00:00.000Z' }, {
            deletedAt: '2026-08-11T08:00:00.000Z',
          }],
        })
      } finally {
        await reloadedRepository.close()
      }
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists postage-meter batch, reading, balance and upload state', async () => {
    const databaseName = `service-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)
    const product = SERVICE_PRODUCTS.find((candidate) => candidate.id === 'ordinary-letter-100')!
    const draft = {
      ...createEmptyServiceDraft(true),
      productId: product.id,
      destinationZone: 'local' as const,
      itemCode: 'GNPM00002001',
      weightGrams: 20,
    }

    try {
      const accepted = await repository.accept({
        acceptedAt: '2026-08-10T09:00:00.000Z',
        charge: calculateServiceCharge(draft, product),
        customer: {
          productFamily: 'basic-letter',
          destinationRegion: 'domestic',
          sender: {
            ...createEmptySender(),
            agreementAccountId: '99000000000001',
            agreementAccountName: '景麓通信演示中心',
          },
          recipient: createEmptyRecipient(),
        },
        draft,
        product,
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.settle({
        transactionIds: [accepted.transaction.id],
        tender: 'cash',
        settledAt: '2026-08-10T09:05:00.000Z',
        amountReceivedCents: accepted.transaction.charge.settlementDueCents,
      })
      const created = await repository.executePostageMeter({
        type: 'create-postage-meter-batch',
        transactionIds: [accepted.transaction.id],
        createdAt: '2026-08-10T10:00:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      const device = created.state.postageMeterDevices[0]!
      const registered = await repository.executePostageMeter({
        type: 'register-postage-meter-reading',
        batchId: created.batch!.id,
        deviceId: device.id,
        startCount: device.cumulativeImprintCount,
        endCount: device.cumulativeImprintCount + 1,
        cancelledCount: 0,
        startAmountCents: device.cumulativePostageCents,
        endAmountCents:
          device.cumulativePostageCents + created.batch!.expectedPostageCents,
        cancelledAmountCents: 0,
        registeredAt: '2026-08-10T11:00:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.executePostageMeter({
        type: 'record-postage-meter-discrepancy',
        batchId: registered.batch!.id,
        reason: '',
      })
      const generated = await repository.executePostageMeter({
        type: 'generate-postage-meter-daily-balance',
        institutionCode: '99901001',
        institutionName: '景麓营业部',
        statisticDate: '2026-08-10',
        deviceId: device.id,
        generatedAt: '2026-08-10T18:00:00.000Z',
      })
      await repository.executePostageMeter({
        type: 'upload-postage-meter-daily-balance',
        balanceId: generated.balance!.id,
        uploadedAt: '2026-08-10T18:05:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      const delegatedAccepted = await repository.accept({
        acceptedAt: '2026-08-10T12:00:00.000Z',
        charge: calculateServiceCharge(
          { ...draft, itemCode: 'GNPM00002002' },
          product,
        ),
        customer: {
          productFamily: 'basic-letter',
          destinationRegion: 'domestic',
          sender: {
            ...createEmptySender(),
            agreementAccountId: '99000000000002',
            agreementAccountName: '松岚通信服务中心',
          },
          recipient: createEmptyRecipient(),
        },
        draft: { ...draft, itemCode: 'GNPM00002002' },
        product,
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.settle({
        transactionIds: [delegatedAccepted.transaction.id],
        tender: 'cash',
        settledAt: '2026-08-10T12:05:00.000Z',
        amountReceivedCents: delegatedAccepted.transaction.charge.settlementDueCents,
      })
      const handedOver = await repository.executePostageMeter({
        type: 'create-postage-meter-mail-handover',
        transactionIds: [delegatedAccepted.transaction.id],
        sourceInstitutionCode: '99901001',
        sourceInstitutionName: '景麓营业部',
        targetInstitutionCode: '99902001',
        targetInstitutionName: '松岚支局',
        sourceCounterCode: '01',
        handedOverAt: '2026-08-10T12:10:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.executePostageMeter({
        type: 'receive-postage-meter-mail-handovers',
        handoverIds: [handedOver.handover!.id],
        receivedAt: '2026-08-10T12:20:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.executePostageMeter({
        type: 'submit-postage-meter-funding-request',
        deviceId: device.id,
        amountCents: 12_345,
        requestedAt: '2026-08-10T12:30:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.executePostageMeter({
        type: 'submit-postage-meter-repair-request',
        deviceId: device.id,
        matter: 'repair',
        requestedAt: '2026-08-10T12:40:00.000Z',
        operator: DEFAULT_SERVICE_OPERATOR,
      })

      const reloadedRepository = new IndexedDbServiceRepository(databaseName)
      try {
        await expect(reloadedRepository.load()).resolves.toMatchObject({
          schemaVersion: 38,
          nextPostageMeterBatchSequence: 2,
          nextPostageMeterRegistrationSequence: 2,
          nextPostageMeterDailyBalanceSequence: 2,
          nextPostageMeterMailHandoverSequence: 2,
          nextPostageMeterFundingSequence: 2,
          nextPostageMeterRepairSequence: 2,
          postageMeterBatches: [{ status: 'balanced', actualItemCount: 1 }],
          postageMeterRegistrations: [{ actualItemCount: 1 }],
          postageMeterDailyBalances: [{
            statisticDate: '2026-08-10',
            actualItemCount: 1,
            uploadedAt: '2026-08-10T18:05:00.000Z',
          }],
          postageMeterMailHandovers: [{ status: 'received', expectedItemCount: 1 }],
          postageMeterFundingRequests: [{
            amountCents: 12_345,
            status: 'pending-external-approval',
          }],
          postageMeterRepairRequests: [{ matter: 'repair', status: 'submitted' }],
          postageMeterDevices: expect.arrayContaining([
            expect.objectContaining({ id: device.id, reportStatus: 'disabled' }),
          ]),
        })
      } finally {
        await reloadedRepository.close()
      }
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists special-handling applications and their refund state', async () => {
    const databaseName = `service-special-handling-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)
    const product = SERVICE_PRODUCTS.find((item) => item.searchCode === '310')!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      destinationZone: 'nonlocal' as const,
      destinationOffice: '栖沄邮件处理中心',
      itemCode: 'PA13131313435',
      weightGrams: 1000,
      platformQuoteCents: 1_200,
    }

    try {
      const accepted = await repository.accept({
        acceptedAt: '2026-08-11T09:00:00.000+10:00',
        charge: calculateServiceCharge(draft, product),
        customer: {
          productFamily: 'parcel',
          destinationRegion: 'domestic',
          sender: {
            ...createEmptySender(),
            contact: '10000000001',
            name: '演练申请人',
          },
          recipient: {
            ...createEmptyRecipient(),
            contact: '10000000008',
            name: '演练收件人',
          },
        },
        draft,
        product,
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.settle({
        transactionIds: [accepted.transaction.id],
        tender: 'cash',
        settledAt: '2026-08-11T09:05:00.000+10:00',
        amountReceivedCents: accepted.transaction.charge.settlementDueCents,
      })
      const created = await repository.executeSpecialHandling({
        type: 'create-special-handling-application',
        draft: {
          kind: 'withdrawal',
          mailItemCode: draft.itemCode,
          applicantName: '演练申请人',
          applicantPhone: '10000000001',
          applicantIdentityType: 'travel',
          applicantIdentityNumber: 'SIMULATOR-001',
          redirectedAddress: '',
          redirectedPostalCode: '',
          redirectedDestinationOffice: '',
          reason: '寄件人申请撤单',
        },
        quotedAt: '2026-08-11T10:00:00.000+10:00',
        createdAt: '2026-08-11T10:01:00.000+10:00',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.executeSpecialHandling({
        type: 'settle-special-handling-application',
        applicationId: created.application!.id,
        tender: 'cash',
        settledAt: '2026-08-11T10:02:00.000+10:00',
        uploadOutcome: 'succeeded',
      })
      await repository.executeSpecialHandling({
        type: 'cancel-special-handling-withdrawal',
        applicationId: created.application!.id,
        deliveryStageDecision: 'entered-delivery',
        cancelledAt: '2026-08-11T10:03:00.000+10:00',
        operator: DEFAULT_SERVICE_OPERATOR,
      })

      const reloadedRepository = new IndexedDbServiceRepository(databaseName)
      try {
        await expect(reloadedRepository.load()).resolves.toMatchObject({
          schemaVersion: 38,
          nextSpecialHandlingSequence: 2,
          specialHandlingApplications: [{
            mailItemCode: 'PA13131313435',
            uploadStatus: 'succeeded',
            refundStatus: 'pending',
          }],
        })
      } finally {
        await reloadedRepository.close()
      }
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists the shared window-delivery receipt ledger', async () => {
    const databaseName = `service-window-delivery-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)

    try {
      await repository.executeWindowDelivery({
        type: 'receive-window-delivery-bags',
        bagIds: ['window-bag-001'],
        receivedAt: '2026-08-11T11:00:00.000+10:00',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.executeWindowDelivery({
        type: 'receive-window-delivery-items',
        itemIds: ['window-item-import-001'],
        receivedAt: '2026-08-11T11:01:00.000+10:00',
        operator: DEFAULT_SERVICE_OPERATOR,
      })

      const reloadedRepository = new IndexedDbServiceRepository(databaseName)
      try {
        const reloaded = await reloadedRepository.load()
        expect(reloaded.schemaVersion).toBe(38)
        expect(reloaded.windowDeliveryBags.find((bag) => bag.id === 'window-bag-001')?.receivedAt)
          .toBe('2026-08-11T11:00:00.000+10:00')
        expect(reloaded.windowDeliveryItems.find((item) => item.id === 'window-item-import-001'))
          .toMatchObject({ status: 'stored', receivedBy: { operatorId: '80000001' } })
        expect(reloaded.windowDeliveryAudits).toHaveLength(2)
      } finally {
        await reloadedRepository.close()
      }
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists postal-supply management documents and inventory changes', async () => {
    const databaseName = `service-postal-supply-management-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)

    try {
      await repository.executePostalSupplyManagement({
        type: 'record-postal-supply-inbound',
        context: {
          operatedAt: '2026-08-11T12:00:00.000+10:00',
          operator: DEFAULT_SERVICE_OPERATOR,
          institutionCode: '99901001',
          institutionName: '景麓营业部',
          superiorInstitutionCode: '99800000',
          superiorInstitutionName: '云浦运营中心',
        },
        lines: [{ itemId: 'supply-standard-envelope', quantity: 4 }],
      })

      const reloadedRepository = new IndexedDbServiceRepository(databaseName)
      try {
        const reloaded = await reloadedRepository.load()
        expect(reloaded.schemaVersion).toBe(38)
        expect(reloaded.nextPostalSupplyDocumentSequence).toBe(5)
        expect(reloaded.postalSupplyDocuments).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: 'inbound', status: 'saved' }),
        ]))
        expect(reloaded.postalSupplyInventoryBalances.find((row) => row.itemId === 'supply-standard-envelope'))
          .toMatchObject({ institutionQuantity: 254 })
      } finally {
        await reloadedRepository.close()
      }
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists points-product inventory movements and balances', async () => {
    const databaseName = `service-points-inventory-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)

    try {
      await repository.executePointsInventory({
        type: 'adjust-points-inventory',
        productId: 'points-product-803',
        kind: 'inbound',
        quantity: 4,
        operatedAt: '2026-08-19T09:30:00.000+10:00',
        operator: DEFAULT_SERVICE_OPERATOR,
      })

      const reloadedRepository = new IndexedDbServiceRepository(databaseName)
      try {
        const reloaded = await reloadedRepository.load()
        expect(reloaded.schemaVersion).toBe(38)
        expect(reloaded.pointsProductInventory.find((item) => item.id === 'points-product-803'))
          .toMatchObject({ quantity: 5 })
        expect(reloaded.pointsInventoryMovements).toEqual([
          expect.objectContaining({
            id: 'JF-KC-20260819-000001',
            kind: 'inbound',
            balanceBefore: 1,
            balanceAfter: 5,
            syncStatus: 'acknowledged',
          }),
        ])
        expect(reloaded.nextPointsInventoryMovementSequence).toBe(2)
      } finally {
        await reloadedRepository.close()
      }
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists spot-check signing and exercise completion', async () => {
    const databaseName = `service-spot-check-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)

    try {
      const initial = await repository.load()
      expect(initial.spotCheckExercises.find((record) => record.id === 'CCYL-20260812-000001'))
        .toMatchObject({ receiptStatus: 'unsigned', completionStatus: 'incomplete' })

      await repository.executeSpotCheckExercise({
        type: 'sign-spot-check-exercise',
        exerciseId: 'CCYL-20260812-000001',
        signedAt: '2026-08-12T10:02:00+10:00',
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.executeSpotCheckExercise({
        type: 'complete-spot-check-exercise',
        exerciseId: 'CCYL-20260812-000001',
        answerValue: '6',
        completedAt: '2026-08-12T10:05:00+10:00',
        operator: DEFAULT_SERVICE_OPERATOR,
      })

      const reloadedRepository = new IndexedDbServiceRepository(databaseName)
      try {
        const reloaded = await reloadedRepository.load()
        expect(reloaded.schemaVersion).toBe(38)
        expect(reloaded.spotCheckExercises.find((record) => record.id === 'CCYL-20260812-000001'))
          .toMatchObject({
            receiptStatus: 'signed',
            completionStatus: 'completed',
            answerValue: '6',
            signedAt: '2026-08-12T10:02:00+10:00',
            completedAt: '2026-08-12T10:05:00+10:00',
          })
      } finally {
        await reloadedRepository.close()
      }
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists the personal-to-institution remittance, deposit, and report ledgers', async () => {
    const databaseName = `service-remittance-test-${crypto.randomUUID()}`
    const repository = new IndexedDbServiceRepository(databaseName)
    const product = SERVICE_PRODUCTS[0]!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      itemCode: '7000818316568',
      weightGrams: 20,
    }

    try {
      const accepted = await repository.accept({
        acceptedAt: '2026-08-12T01:00:00.000Z',
        charge: calculateServiceCharge(draft, product),
        customer: {
          productFamily: 'basic-letter',
          destinationRegion: 'domestic',
          sender: { ...createEmptySender(), name: '林澄', detailedAddress: '澜京市栖台区新程路 1 号' },
          recipient: { ...createEmptyRecipient(), name: '顾远', detailedAddress: '澄岐省澄野市江洲区远帆路 2 号' },
        },
        draft,
        product,
        operator: DEFAULT_SERVICE_OPERATOR,
      })
      await repository.settle({
        transactionIds: [accepted.transaction.id],
        tender: 'cash',
        settledAt: '2026-08-12T01:05:00.000Z',
        amountReceivedCents: accepted.transaction.charge.settlementDueCents,
      })
      const generated = await repository.executePersonalRemittance({
        type: 'generate-personal-remittance',
        workDate: '2026-08-12',
        operator: DEFAULT_SERVICE_OPERATOR,
        institutionCode: '99901001',
        institutionName: '景麓营业部',
        workstationCode: '01',
        generatedAt: '2026-08-12T02:00:00.000Z',
        ignoreCurrentDayPending: false,
      })
      await repository.executePersonalRemittance({
        type: 'confirm-personal-remittance',
        remittanceId: generated.remittance.id,
        operator: DEFAULT_SERVICE_OPERATOR,
        confirmedAt: '2026-08-12T02:05:00.000Z',
      })
      await repository.executePersonalRemittance({
        type: 'print-personal-remittance',
        remittanceId: generated.remittance.id,
        printedAt: '2026-08-12T02:06:00.000Z',
      })
      const institutionGenerated = await repository.executeInstitutionAccounting({
        type: 'generate-institution-remittance',
        workDate: '2026-08-12',
        institutionCode: '99901001',
        institutionName: DEFAULT_SERVICE_OPERATOR.acceptanceOffice,
        operator: DEFAULT_SERVICE_OPERATOR,
        generatedAt: '2026-08-12T02:10:00.000Z',
        managerAuthorized: true,
      })
      const institutionConfirmed = await repository.executeInstitutionAccounting({
        type: 'confirm-institution-remittance',
        remittanceId: institutionGenerated.institutionRemittance!.id,
        operator: DEFAULT_SERVICE_OPERATOR,
        confirmedAt: '2026-08-12T02:11:00.000Z',
        managerAuthorized: true,
      })
      await repository.executeInstitutionAccounting({
        type: 'print-bank-deposit',
        slipId: institutionConfirmed.bankDepositSlip!.id,
        printedAt: '2026-08-12T02:12:00.000Z',
      })
      await repository.executeInstitutionAccounting({
        type: 'print-business-report',
        scope: 'institution',
        period: 'daily',
        startDate: '2026-08-11',
        endDate: '2026-08-11',
        institutionCode: '99901001',
        institutionName: DEFAULT_SERVICE_OPERATOR.acceptanceOffice,
        subjectOperatorId: null,
        subjectOperatorName: '',
        workstationCode: '',
        operator: DEFAULT_SERVICE_OPERATOR,
        printedAt: '2026-08-12T02:13:00.000Z',
        managerAuthorized: true,
      })

      const reloadedRepository = new IndexedDbServiceRepository(databaseName)
      try {
        await expect(reloadedRepository.load()).resolves.toMatchObject({
          schemaVersion: 38,
          personalRemittances: [{
            id: generated.remittance.id,
            status: 'confirmed',
            totalCount: 1,
            totalAmountCents: 80,
            printHistory: ['2026-08-12T02:06:00.000Z'],
          }],
          institutionRemittances: [{
            id: institutionGenerated.institutionRemittance!.id,
            status: 'confirmed',
            totalAmountCents: 80,
          }],
          bankDepositSlips: [{
            id: institutionConfirmed.bankDepositSlip!.id,
            source: 'institution-remittance',
            totalAmountCents: 80,
            printHistory: ['2026-08-12T02:12:00.000Z'],
          }],
          businessReportPrints: [{
            scope: 'institution',
            period: 'daily',
            startDate: '2026-08-11',
            endDate: '2026-08-11',
          }],
        })
      } finally {
        await reloadedRepository.close()
      }
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('serializes saveDraft with another state mutation instead of losing either update', async () => {
    const databaseName = `service-concurrency-test-${crypto.randomUUID()}`
    const firstRepository = new IndexedDbServiceRepository(databaseName)
    const secondRepository = new IndexedDbServiceRepository(databaseName)
    const product = SERVICE_PRODUCTS[0]!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      itemCode: '7000818316999',
      weightGrams: 20,
    }

    try {
      const accepted = await firstRepository.accept({
        acceptedAt: '2026-01-15T09:20:00.000Z',
        charge: calculateServiceCharge(draft, product),
        customer: {
          productFamily: 'basic-letter',
          destinationRegion: 'domestic',
          sender: { ...createEmptySender(), name: '并发演练寄件人' },
          recipient: { ...createEmptyRecipient(), name: '并发演练收件人' },
        },
        draft,
        product,
      })
      const settled = await firstRepository.settle({
        transactionIds: [accepted.transaction.id],
        tender: 'cash',
        settledAt: '2026-01-15T09:30:00.000Z',
        amountReceivedCents: accepted.transaction.charge.settlementDueCents,
      })
      const savedDraft = { ...draft, operatorNote: '并发保存草稿' }

      await Promise.all([
        firstRepository.saveDraft(savedDraft),
        secondRepository.recordInvoiceDecision(settled.settlement.id, true),
      ])

      await expect(firstRepository.load()).resolves.toMatchObject({
        draft: { operatorNote: '并发保存草稿' },
        settlements: [{ id: settled.settlement.id, invoiceRequested: true }],
      })
    } finally {
      await firstRepository.close()
      await secondRepository.close()
      await deleteDB(databaseName)
    }
  })
})
