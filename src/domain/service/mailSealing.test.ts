import { describe, expect, it } from 'vitest'

import {
  createTestDispatchRelationAuthorization,
  createTestOnSiteAuthorization,
} from '../../test/workAuthorization'
import { createEmptyRecipient, createEmptySender } from '../customer/seed'
import {
  executeDispatchBagHandoverCommand,
  queryDispatchBagsForHandover,
  queryDispatchBagsForReceipt,
} from './dispatchBagHandover'
import {
  executeMailSealingCommand,
  queryLooseOutboundMail,
  queryUnsealedMail,
  SIMULATED_CONTAINER_INVENTORY,
  type DispatchManifestInput,
  type UnsealedMailQuery,
} from './mailSealing'
import { executeDispatchRoutingCommand } from './dispatchRouting'
import { calculateServiceCharge } from './policy'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import { acceptServiceTransaction, settleServiceTransactions } from './transactions'
import {
  withdrawServiceTransactions,
} from './transactionCorrection'
import type { ServiceOperatorSnapshot, ServiceProductId, ServiceWorkspaceState } from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '林青禾',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '栖沄邮件处理中心',
  institutionCode: '99901001',
}

const baseQuery: UnsealedMailQuery = {
  operatorId: '',
  bulkFlag: 'all',
  acceptedDateFrom: '2026-08-10',
  acceptedDateTo: '2026-08-10',
}

function acceptMail(
  state: ServiceWorkspaceState,
  productId: ServiceProductId,
  acceptedAt: string,
  acceptedBy = operator,
  destinationZone: 'local' | 'nonlocal' = 'nonlocal',
  itemCode = '',
): { state: ServiceWorkspaceState; transactionId: string } {
  const product = SERVICE_PRODUCTS.find((item) => item.id === productId)!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    destinationZone,
    itemCode,
    weightGrams: 20,
  }
  const accepted = acceptServiceTransaction(state, {
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: product.productFamily,
      destinationRegion: 'domestic',
      sender: { ...createEmptySender(), name: '训练寄件人' },
      recipient: {
        ...createEmptyRecipient(),
        name: '训练收件人',
        detailedAddress: '瀚原省栖沄市景麓区演练路 8 号',
      },
    },
    draft,
    product,
    operator: acceptedBy,
  })
  return { state: accepted.state, transactionId: accepted.transaction.id }
}

function settleOne(
  state: ServiceWorkspaceState,
  transactionId: string,
  settledAt: string,
): ServiceWorkspaceState {
  const transaction = state.transactions.find((item) => item.id === transactionId)!
  return settleServiceTransactions(state, {
    transactionIds: [transactionId],
    tender: 'cash',
    settledAt,
    amountReceivedCents: transaction.charge.settlementDueCents,
  }).state
}

function twoSettledOrdinaryLetters(): ServiceWorkspaceState {
  const first = acceptMail(
    createServiceSeedState(),
    'ordinary-letter-100',
    '2026-08-10T09:00:00.000Z',
  )
  const second = acceptMail(
    first.state,
    'ordinary-letter-100',
    '2026-08-10T09:02:00.000Z',
  )
  const amount = second.state.transactions.reduce(
    (total, transaction) => total + transaction.charge.settlementDueCents,
    0,
  )
  return settleServiceTransactions(second.state, {
    transactionIds: [first.transactionId, second.transactionId],
    tender: 'cash',
    settledAt: '2026-08-10T09:10:00.000Z',
    amountReceivedCents: amount,
  }).state
}

function manifestForState(
  state: ServiceWorkspaceState,
  overrides: Partial<DispatchManifestInput> = {},
): DispatchManifestInput {
  const group = queryUnsealedMail(state, baseQuery).groups[0]!
  return {
    mailReferences: group.items.map((item) => item.reference),
    manifestNumber: '501',
    receptacleType: '1.袋',
    usesBarcodeContainer: false,
    containerBarcode: '',
    rfidBagTagNumber: '',
    ...overrides,
  }
}

function generate(
  state: ServiceWorkspaceState,
  manifest = manifestForState(state),
  generatedAt = '2026-08-10T09:20:00.000Z',
) {
  return executeMailSealingCommand(state, {
    type: 'generate-dispatch-bags',
    manifests: [manifest],
    shift: '01',
    institutionCode: '99901001',
    generatedAt,
    operator,
  })
}

describe('unsealed-mail bag generation', () => {
  it('only exposes settled mail and groups it by a proven dispatch relation', () => {
    const first = acceptMail(
      createServiceSeedState(),
      'ordinary-letter-100',
      '2026-08-10T09:00:00.000Z',
    )
    const second = acceptMail(
      first.state,
      'ordinary-letter-100',
      '2026-08-10T09:02:00.000Z',
    )
    const partlySettled = settleOne(
      second.state,
      first.transactionId,
      '2026-08-10T09:10:00.000Z',
    )

    const result = queryUnsealedMail(partlySettled, baseQuery)
    expect(result.unconfiguredCount).toBe(0)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({
      relation: {
        manifestTypeCode: 'GNPCXH',
        manifestTypeName: '国内平函',
        bagBarcodeTypeCode: '411',
        bagBarcodeTypeName: '平信袋',
      },
      totalItems: 1,
      mailWeightGrams: 20,
    })
  })

  it('isolates unsealed mail and bag maintenance by institution', () => {
    const remoteOperator: ServiceOperatorSnapshot = {
      ...operator,
      operatorId: '82000001',
      displayName: '异地营业人员',
      acceptanceOffice: '澄野营业部',
      institutionCode: '99902001',
    }
    const local = acceptMail(
      createServiceSeedState(),
      'ordinary-letter-100',
      '2026-08-10T09:00:00.000Z',
    )
    const remote = acceptMail(
      local.state,
      'ordinary-letter-100',
      '2026-08-10T09:02:00.000Z',
      remoteOperator,
    )
    const localSettled = settleOne(
      remote.state,
      local.transactionId,
      '2026-08-10T09:10:00.000Z',
    )
    const settled = settleOne(localSettled, remote.transactionId, '2026-08-10T09:11:00.000Z')
    const transactionIds = (institutionCode: string) => queryUnsealedMail(
      settled,
      baseQuery,
      institutionCode,
    ).groups.flatMap((group) => group.items).flatMap((item) => (
      item.reference.kind === 'transaction' ? [item.reference.transactionId] : []
    ))

    expect(transactionIds('99901001')).toEqual([local.transactionId])
    expect(transactionIds('99902001')).toEqual([remote.transactionId])

    const generated = generate(settled)
    expect(() => executeMailSealingCommand(generated.state, {
      type: 'revise-dispatch-bag-manifest',
      bagId: generated.bags[0]!.id,
      manifestNumber: '502',
      changedAt: '2026-08-10T09:21:00.000Z',
      operator: remoteOperator,
    })).toThrow('不属于当前经办机构')
    expect(() => executeMailSealingCommand(generated.state, {
      type: 'record-dispatch-bag-tag-decision',
      bagIds: [generated.bags[0]!.id],
      print: false,
      decidedAt: '2026-08-10T09:21:00.000Z',
      institutionCode: '99902001',
    })).toThrow('不属于当前经办机构')
  })

  it('filters by employee, bulk flag and acceptance date', () => {
    const otherOperator = { ...operator, operatorId: '80000002', displayName: '周明川' }
    const first = acceptMail(
      createServiceSeedState(),
      'ordinary-letter-100',
      '2026-08-09T09:00:00.000Z',
    )
    const second = acceptMail(
      first.state,
      'ordinary-letter-100',
      '2026-08-10T09:02:00.000Z',
      otherOperator,
    )
    const markedBulk = {
      ...second.state,
      transactions: second.state.transactions.map((transaction) => transaction.id === second.transactionId
        ? { ...transaction, sourceBatchId: 'DZ-TEST-1' }
        : transaction),
    }
    const amount = markedBulk.transactions.reduce(
      (total, transaction) => total + transaction.charge.settlementDueCents,
      0,
    )
    const settled = settleServiceTransactions(markedBulk, {
      transactionIds: [first.transactionId, second.transactionId],
      tender: 'cash',
      settledAt: '2026-08-10T09:10:00.000Z',
      amountReceivedCents: amount,
    }).state

    const filtered = queryUnsealedMail(settled, {
      ...baseQuery,
      operatorId: '80000002',
      bulkFlag: 'bulk',
    })
    expect(filtered.groups[0]?.items).toHaveLength(1)
    expect(filtered.groups[0]?.items[0]).toMatchObject({
      bulk: true,
      operator: { operatorId: '80000002' },
    })
    expect(queryUnsealedMail(settled, {
      ...baseQuery,
      bulkFlag: 'single',
    }).groups).toEqual([])
  })

  it('reports an unconfigured relation instead of inventing a standard code', () => {
    const accepted = acceptMail(
      createServiceSeedState(),
      'registered-letter-200',
      '2026-08-10T09:00:00.000Z',
    )
    const settled = settleOne(
      accepted.state,
      accepted.transactionId,
      '2026-08-10T09:10:00.000Z',
    )

    expect(queryUnsealedMail(settled, baseQuery)).toMatchObject({
      groups: [],
      unconfiguredCount: 1,
      unconfiguredItems: [{ itemNumber: 'SIM-20260810-000001' }],
    })
  })

  it('persists an upper-management verified relation and immediately unlocks bag generation', async () => {
    const accepted = acceptMail(
      createServiceSeedState(),
      'registered-letter-200',
      '2026-08-10T09:00:00.000Z',
    )
    const settled = settleOne(
      accepted.state,
      accepted.transactionId,
      '2026-08-10T09:10:00.000Z',
    )
    const product = settled.transactions[0]!.product

    const maintained = executeMailSealingCommand(settled, {
      type: 'upsert-dispatch-relation',
      product,
      destinationZone: 'nonlocal',
      bulk: false,
      manifestTypeCode: 'BBGS',
      routeCode: 'SIM-A01',
      receivingOfficeCode: '99101001',
      directSeal: false,
      consolidation: true,
      localTransfer: false,
      institutionCode: '99901001',
      updatedAt: '2026-08-10T09:12:00.000Z',
      operator: { ...operator, operatorId: '84000001' },
      authorization: await createTestDispatchRelationAuthorization(),
    })

    expect(maintained.state.dispatchRelationOverrides).toEqual([
      expect.objectContaining({
        key: '99901001:registered-letter-200:nonlocal:single',
        institutionCode: '99901001',
        manifestTypeCode: 'BBGS',
        routeCode: 'SIM-A01',
        receivingOfficeCode: '99101001',
        updatedBy: { ...operator, operatorId: '84000001' },
      }),
    ])
    expect(queryUnsealedMail(maintained.state, baseQuery).groups[0]).toMatchObject({
      relation: {
        manifestTypeCode: 'BBGS',
        receivingOfficeCode: '99101001',
        consolidation: true,
      },
      totalItems: 1,
    })

    const generated = generate(maintained.state)
    expect(generated.bags[0]).toMatchObject({
      manifestTypeCode: 'BBGS',
      receivingOfficeCode: '99101001',
      totalItems: 1,
    })
    expect(queryUnsealedMail(generated.state, baseQuery).groups).toEqual([])
  })

  it('rejects a maintained route that cannot reach the selected receiving office', async () => {
    const product = SERVICE_PRODUCTS.find((item) => item.id === 'registered-letter-200')!
    const authorization = await createTestDispatchRelationAuthorization()
    expect(() => executeMailSealingCommand(createServiceSeedState(), {
      type: 'upsert-dispatch-relation',
      product: {
        id: product.id,
        label: product.label,
        searchCode: product.searchCode,
        effectiveBusinessCode: '200100',
      },
      destinationZone: 'nonlocal',
      bulk: false,
      manifestTypeCode: 'BBGS',
      routeCode: 'SIM-B02',
      receivingOfficeCode: '99101001',
      directSeal: false,
      consolidation: true,
      localTransfer: false,
      institutionCode: '99901001',
      updatedAt: '2026-08-10T09:12:00.000Z',
      operator: { ...operator, operatorId: '84000001' },
      authorization,
    })).toThrow('所选邮路不能到达该总包接收局')
  })

  it('generates a persisted 30-digit bag barcode and removes sealed mail from the pool', () => {
    const state = twoSettledOrdinaryLetters()
    const result = generate(state)

    expect(result.bags).toHaveLength(1)
    expect(result.bags[0]).toMatchObject({
      id: 'ZB-20260810-000001',
      manifestNumber: '501',
      shift: '01',
      totalItems: 2,
      mailWeightGrams: 40,
      emptyBagWeightGrams: 0,
      tagPrintDecision: null,
    })
    expect(result.bags[0]?.bagBarcode).toMatch(/^\d{30}$/)
    expect(result.state.nextDispatchBagSequence).toBe(2)
    expect(result.state.nextDispatchManifestSequence).toBe(502)
    expect(queryUnsealedMail(result.state, baseQuery).groups).toEqual([])
  })

  it('blocks withdrawal after mail has entered a sealed bag', async () => {
    const state = twoSettledOrdinaryLetters()
    const generated = generate(state)
    const transactionId = state.transactions[0]!.id
    const authorization = await createTestOnSiteAuthorization('withdraw-service-transaction')

    expect(() => withdrawServiceTransactions(generated.state, {
      transactionIds: [transactionId],
      reason: '客户申请撤销',
      authorization,
      withdrawnAt: '2026-08-10T09:30:00.000Z',
      operator,
    })).toThrow(`已进入总包 ${generated.bags[0]!.id}`)
  })

  it('keeps imported legacy bag contents readable even if a member was already withdrawn', () => {
    const generated = generate(twoSettledOrdinaryLetters())
    const bag = generated.bags[0]!
    const withdrawnReference = bag.mailReferences[0]!
    if (withdrawnReference.kind !== 'transaction') throw new Error('测试邮件引用类型无效。')
    const legacy = {
      ...generated.state,
      transactions: generated.state.transactions.map((transaction) =>
        transaction.id === withdrawnReference.transactionId
          ? { ...transaction, status: 'withdrawn' as const }
          : transaction),
    }

    const revised = executeMailSealingCommand(legacy, {
      type: 'revise-dispatch-bag-mails',
      bagId: bag.id,
      addMailReferences: [],
      removeMailReferences: [bag.mailReferences[1]!],
      changedAt: '2026-08-10T09:30:00.000Z',
      operator,
    })
    expect(revised.bags[0]).toMatchObject({ totalItems: 1 })
  })

  it('seals loose outbound mail one at a time, reuses the mail number and blocks bag tags', () => {
    const accepted = acceptMail(
      createServiceSeedState(),
      'ordinary-letter-100',
      '2026-08-10T09:00:00.000Z',
      operator,
      'nonlocal',
      '100000000001',
    )
    const settled = settleOne(
      accepted.state,
      accepted.transactionId,
      '2026-08-10T09:10:00.000Z',
    )
    const looseRows = queryLooseOutboundMail(settled, {
      productTerm: '平常信函',
      acceptedDateFrom: '2026-08-10',
      acceptedDateTo: '2026-08-10',
    })
    expect(looseRows).toHaveLength(1)

    const generated = executeMailSealingCommand(settled, {
      type: 'generate-dispatch-bags',
      sealingMode: 'loose-outbound',
      manifests: [{
        mailReferences: [looseRows[0]!.reference],
        manifestNumber: '501',
        receptacleType: '1.袋',
        usesBarcodeContainer: false,
        containerBarcode: '',
        rfidBagTagNumber: '',
      }],
      shift: '01',
      institutionCode: '99901001',
      generatedAt: '2026-08-10T09:20:00.000Z',
      operator,
    })
    expect(generated.bags[0]).toMatchObject({
      bagBarcode: '100000000001',
      sealingMode: 'loose-outbound',
      totalItems: 1,
      tagPrintDecision: 'skipped',
      tagPrintedAt: null,
    })
    expect(queryLooseOutboundMail(generated.state, {
      productTerm: '',
      acceptedDateFrom: '2026-08-10',
      acceptedDateTo: '2026-08-10',
    })).toEqual([])
    expect(() => executeMailSealingCommand(generated.state, {
      type: 'record-dispatch-bag-tag-decision',
      bagIds: [generated.bags[0]!.id],
      print: true,
      decidedAt: '2026-08-10T09:21:00.000Z',
      institutionCode: '99901001',
    })).toThrow('散件外走邮件不允许打印袋牌')
    expect(() => executeDispatchRoutingCommand(generated.state, {
      type: 'record-dispatch-print',
      documentType: 'bag-tag',
      targetIds: [generated.bags[0]!.id],
      printedAt: '2026-08-10T09:22:00.000Z',
      operator,
    })).toThrow('散件外走邮件不允许打印袋牌')
    expect(executeDispatchRoutingCommand(generated.state, {
      type: 'record-dispatch-print',
      documentType: 'manifest',
      targetIds: [generated.bags[0]!.id],
      printedAt: '2026-08-10T09:23:00.000Z',
      operator,
    }).printRecords).toHaveLength(1)
  })

  it('automatically keeps one sorting bag per dispatch relation', () => {
    const first = acceptMail(
      createServiceSeedState(),
      'ordinary-letter-100',
      '2026-08-10T09:00:00.000Z',
      operator,
      'local',
      '100000000011',
    )
    const second = acceptMail(
      first.state,
      'ordinary-letter-100',
      '2026-08-10T09:01:00.000Z',
      operator,
      'nonlocal',
      '100000000012',
    )
    const total = second.state.transactions.reduce(
      (sum, transaction) => sum + transaction.charge.settlementDueCents,
      0,
    )
    const settled = settleServiceTransactions(second.state, {
      transactionIds: [first.transactionId, second.transactionId],
      tender: 'cash',
      settledAt: '2026-08-10T09:10:00.000Z',
      amountReceivedCents: total,
    }).state
    const groups = queryUnsealedMail(settled, baseQuery).groups
    expect(groups).toHaveLength(2)
    const generated = executeMailSealingCommand(settled, {
      type: 'generate-dispatch-bags',
      sealingMode: 'sorting',
      manifests: groups.map((group, index) => ({
        mailReferences: group.items.map((item) => item.reference),
        manifestNumber: String(501 + index),
        receptacleType: '1.袋' as const,
        usesBarcodeContainer: false,
        containerBarcode: '',
        rfidBagTagNumber: '',
      })),
      shift: '02',
      institutionCode: '99901001',
      generatedAt: '2026-08-10T09:20:00.000Z',
      operator,
    })
    expect(generated.bags).toHaveLength(2)
    expect(generated.bags.every((bag) => bag.sealingMode === 'sorting')).toBe(true)

    const sameRelation = twoSettledOrdinaryLetters()
    const items = queryUnsealedMail(sameRelation, baseQuery).groups[0]!.items
    expect(() => executeMailSealingCommand(sameRelation, {
      type: 'generate-dispatch-bags',
      sealingMode: 'sorting',
      manifests: items.map((item, index) => ({
        mailReferences: [item.reference],
        manifestNumber: String(501 + index),
        receptacleType: '1.袋' as const,
        usesBarcodeContainer: false,
        containerBarcode: '',
        rfidBagTagNumber: '',
      })),
      shift: '01',
      institutionCode: '99901001',
      generatedAt: '2026-08-10T09:20:00.000Z',
      operator,
    })).toThrow('同一封发关系不能拆分')
  })

  it('requires a 3-digit unused manifest number', () => {
    const state = twoSettledOrdinaryLetters()
    expect(() => generate(state, manifestForState(state, { manifestNumber: '50' })))
      .toThrow('清单号码必须为 3 位数字')

    const generated = generate(state)
    const additional = acceptMail(
      generated.state,
      'ordinary-letter-100',
      '2026-08-10T09:30:00.000Z',
    )
    const settled = settleOne(
      additional.state,
      additional.transactionId,
      '2026-08-10T09:31:00.000Z',
    )
    expect(() => generate(settled, manifestForState(settled, { manifestNumber: '501' })))
      .toThrow('清单号码 501 已使用')
  })

  it('validates barcode-container inventory and prevents reuse', () => {
    const state = twoSettledOrdinaryLetters()
    expect(() => generate(state, manifestForState(state, {
      usesBarcodeContainer: true,
      containerBarcode: '1234',
    }))).toThrow('容器条码必须为 16 位数字')
    expect(() => generate(state, manifestForState(state, {
      usesBarcodeContainer: true,
      containerBarcode: '9901000000000099',
    }))).toThrow('容器条码未入库')

    const first = generate(state, manifestForState(state, {
      usesBarcodeContainer: true,
      containerBarcode: SIMULATED_CONTAINER_INVENTORY[0],
    }))
    const additional = acceptMail(
      first.state,
      'ordinary-letter-100',
      '2026-08-10T09:30:00.000Z',
    )
    const settled = settleOne(
      additional.state,
      additional.transactionId,
      '2026-08-10T09:31:00.000Z',
    )
    expect(() => generate(settled, manifestForState(settled, {
      manifestNumber: '502',
      usesBarcodeContainer: true,
      containerBarcode: SIMULATED_CONTAINER_INVENTORY[0],
    }), '2026-08-10T09:32:00.000Z')).toThrow('容器条码 9901000000000001 已被使用')
  })

  it('records exactly one print-or-skip decision for generated bag tags', () => {
    const generated = generate(twoSettledOrdinaryLetters())
    const printed = executeMailSealingCommand(generated.state, {
      type: 'record-dispatch-bag-tag-decision',
      bagIds: [generated.bags[0]!.id],
      print: true,
      decidedAt: '2026-08-10T09:25:00.000Z',
      institutionCode: '99901001',
    })
    expect(printed.bags[0]).toMatchObject({
      tagPrintDecision: 'printed',
      tagPrintedAt: '2026-08-10T09:25:00.000Z',
    })
    expect(() => executeMailSealingCommand(printed.state, {
      type: 'record-dispatch-bag-tag-decision',
      bagIds: [generated.bags[0]!.id],
      print: false,
      decidedAt: '2026-08-10T09:26:00.000Z',
      institutionCode: '99901001',
    })).toThrow('已记录袋牌打印决定')
  })

  it('audits manifest and mail membership changes and releases mail after cancellation', () => {
    const generated = generate(twoSettledOrdinaryLetters())
    const additional = acceptMail(
      generated.state,
      'ordinary-letter-100',
      '2026-08-10T09:30:00.000Z',
    )
    const settled = settleOne(
      additional.state,
      additional.transactionId,
      '2026-08-10T09:31:00.000Z',
    )
    const original = generated.bags[0]!
    const revisedManifest = executeMailSealingCommand(settled, {
      type: 'revise-dispatch-bag-manifest',
      bagId: original.id,
      manifestNumber: '502',
      changedAt: '2026-08-10T09:32:00.000Z',
      operator,
    })
    const available = queryUnsealedMail(revisedManifest.state, baseQuery).groups[0]!.items[0]!
    const revisedMails = executeMailSealingCommand(revisedManifest.state, {
      type: 'revise-dispatch-bag-mails',
      bagId: original.id,
      addMailReferences: [available.reference],
      removeMailReferences: [original.mailReferences[0]!],
      changedAt: '2026-08-10T09:33:00.000Z',
      operator,
    })

    expect(revisedMails.bags[0]).toMatchObject({
      manifestNumber: '502',
      totalItems: 2,
      mailWeightGrams: 40,
    })
    expect(revisedMails.state.dispatchBagChanges.map((change) => change.kind)).toEqual([
      'manifest-number-changed',
      'mail-membership-changed',
    ])

    const cancelled = executeMailSealingCommand(revisedMails.state, {
      type: 'cancel-dispatch-bags',
      bagIds: [original.id],
      cancelledAt: '2026-08-10T09:34:00.000Z',
      operator,
    })
    expect(cancelled.bags[0]).toMatchObject({ sealingStatus: 'cancelled' })
    expect(queryUnsealedMail(cancelled.state, baseQuery).groups[0]?.totalItems).toBe(3)
    expect(cancelled.state.dispatchBagChanges.at(-1)?.kind).toBe('sealing-cancelled')
  })

  it('completes handover, withdrawal, receipt, shift transfer and return while locking active bags', () => {
    const generated = generate(twoSettledOrdinaryLetters())
    const bag = generated.bags[0]!
    const query = {
      status: 'not-handed-over' as const,
      originOfficeTerm: '',
      manifestTypeTerm: '',
      shift: '' as const,
      sealedDateFrom: '2026-08-10',
      sealedDateTo: '2026-08-10',
    }
    expect(queryDispatchBagsForHandover(generated.state, query, '99901001')).toHaveLength(1)
    expect(() => executeDispatchBagHandoverCommand(generated.state, {
      type: 'hand-over-dispatch-bags',
      bagIds: [bag.id],
      originOfficeCode: '99901001',
      receivingOfficeCode: '99101001',
      receivingOfficeName: '栖沄邮件处理中心',
      performedAt: '2026-08-10T09:39:00.000Z',
      operator: { ...operator, institutionCode: '99902001' },
    })).toThrow('经办人员所在机构')

    const firstHandover = executeDispatchBagHandoverCommand(generated.state, {
      type: 'hand-over-dispatch-bags',
      bagIds: [bag.id],
      originOfficeCode: '99901001',
      receivingOfficeCode: '99101001',
      receivingOfficeName: '栖沄邮件处理中心',
      performedAt: '2026-08-10T09:40:00.000Z',
      operator,
    })
    expect(() => executeMailSealingCommand(firstHandover.state, {
      type: 'revise-dispatch-bag-manifest',
      bagId: bag.id,
      manifestNumber: '502',
      changedAt: '2026-08-10T09:41:00.000Z',
      operator,
    })).toThrow('已交出或已接收')

    const withdrawn = executeDispatchBagHandoverCommand(firstHandover.state, {
      type: 'withdraw-dispatch-bag-handovers',
      handoverIds: [firstHandover.handovers[0]!.id],
      performedAt: '2026-08-10T09:42:00.000Z',
      originOfficeCode: '99901001',
      operator,
    })
    const revised = executeMailSealingCommand(withdrawn.state, {
      type: 'revise-dispatch-bag-manifest',
      bagId: bag.id,
      manifestNumber: '502',
      changedAt: '2026-08-10T09:43:00.000Z',
      operator,
    })
    const secondHandover = executeDispatchBagHandoverCommand(revised.state, {
      type: 'hand-over-dispatch-bags',
      bagIds: [bag.id],
      originOfficeCode: '99901001',
      receivingOfficeCode: '99102001',
      receivingOfficeName: '澄野转运中心',
      performedAt: '2026-08-10T09:44:00.000Z',
      operator,
    })
    const receivingOperator: ServiceOperatorSnapshot = {
      ...operator,
      acceptanceOffice: '澄野转运中心',
      institutionCode: '99102001',
    }
    const received = executeDispatchBagHandoverCommand(secondHandover.state, {
      type: 'receive-dispatch-bag-handovers',
      handoverIds: [secondHandover.handovers[0]!.id],
      shift: '02',
      performedAt: '2026-08-10T09:45:00.000Z',
      receivingOfficeCode: '99102001',
      operator: receivingOperator,
    })
    expect(queryDispatchBagsForReceipt(received.state, {
      ...query,
      status: 'received',
    }, '99102001')[0]?.handover).toMatchObject({ status: 'received', receiptShift: '02' })
    const transferred = executeDispatchBagHandoverCommand(received.state, {
      type: 'transfer-received-bag-shift',
      handoverIds: [secondHandover.handovers[0]!.id],
      shift: '01',
      performedAt: '2026-08-10T09:46:00.000Z',
      receivingOfficeCode: '99102001',
      operator: receivingOperator,
    })
    const returned = executeDispatchBagHandoverCommand(transferred.state, {
      type: 'return-received-dispatch-bags',
      handoverIds: [secondHandover.handovers[0]!.id],
      performedAt: '2026-08-10T09:47:00.000Z',
      receivingOfficeCode: '99102001',
      operator: receivingOperator,
    })
    expect(returned.handovers[0]).toMatchObject({
      status: 'returned',
      receiptShift: '01',
    })
    expect(queryDispatchBagsForHandover(returned.state, query, '99901001')).toHaveLength(1)
    expect(returned.state.dispatchBagHandovers).toHaveLength(2)
  })
})
