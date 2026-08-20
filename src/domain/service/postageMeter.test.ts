import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createEmptyRecipient, createEmptySender } from '../customer/seed'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { calculateServiceCharge } from './policy'
import {
  postageMeterBatchDifference,
  queryPostageMeterBatches,
  queryPostageMeterDelegableTransactions,
  queryPostageMeterMailHandovers,
  queryPostageMeterPendingTransactions,
  queryPostageMeterUsageLedger,
} from './postageMeter'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from './seed'
import type { DispatchBagRecord, ServiceOperatorSnapshot } from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '栖沄邮件处理中心',
}

async function addSettledAgreementMail(
  repository: MemoryServiceRepository,
  itemCode: string,
  acceptedAt: string,
) {
  const product = SERVICE_PRODUCTS.find((candidate) => candidate.id === 'ordinary-letter-100')!
  const draft = {
    ...createEmptyServiceDraft(true),
    productId: product.id,
    destinationZone: 'local' as const,
    destinationOffice: '栖沄邮件处理中心',
    itemCode,
    weightGrams: 20,
  }
  const accepted = await repository.accept({
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: {
        ...createEmptySender(),
        name: '演练协议客户',
        agreementAccountId: '99000000000001',
        agreementAccountName: '景麓通信演示中心',
      },
      recipient: { ...createEmptyRecipient(), name: '演练收件人' },
    },
    draft,
    product,
    operator,
  })
  await repository.settle({
    transactionIds: [accepted.transaction.id],
    tender: 'cash',
    settledAt: acceptedAt,
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  return accepted.transaction.id
}

describe('postage meter core flow', () => {
  it('excludes mail already sealed into a dispatch bag from batching and delegation', async () => {
    const repository = MemoryServiceRepository.create()
    const transactionId = await addSettledAgreementMail(
      repository,
      'GNPM00000000',
      '2026-08-10T09:00:00.000+10:00',
    )
    const state = await repository.load()
    const sealedBag: DispatchBagRecord = {
      id: 'ZB-YZJ-001',
      bagBarcode: '990100000000000000000000000001',
      manifestTypeCode: 'GNPCXH',
      manifestTypeName: '国内平函',
      bagBarcodeTypeCode: '411',
      bagBarcodeTypeName: '平信袋',
      receivingOfficeCode: '99101001',
      receivingOfficeName: '栖沄邮件处理中心',
      directSeal: false,
      consolidation: true,
      localTransfer: false,
      manifestNumber: '001',
      receptacleType: '1.袋',
      usesBarcodeContainer: false,
      containerBarcode: '',
      rfidBagTagNumber: '',
      shift: '01',
      mailReferences: [{ kind: 'transaction', transactionId }],
      totalItems: 1,
      mailWeightGrams: 20,
      emptyBagWeightGrams: 5,
      generatedAt: '2026-08-10T09:30:00.000+10:00',
      generatedBy: operator,
      tagPrintDecision: 'skipped',
      tagPrintedAt: null,
      sealingStatus: 'sealed',
      cancelledAt: null,
      cancelledBy: null,
    }
    await repository.restore({ ...state, dispatchBags: [sealedBag] })

    const guarded = await repository.load()
    expect(queryPostageMeterPendingTransactions(guarded)).toHaveLength(0)
    expect(queryPostageMeterDelegableTransactions(guarded)).toHaveLength(0)
    await expect(repository.executePostageMeter({
      type: 'create-postage-meter-batch',
      transactionIds: [transactionId],
      createdAt: '2026-08-10T10:00:00.000+10:00',
      operator,
    })).rejects.toThrow('不符合待过戳条件')
    await expect(repository.executePostageMeter({
      type: 'create-postage-meter-mail-handover',
      transactionIds: [transactionId],
      sourceInstitutionCode: '99901001',
      sourceInstitutionName: '景麓营业部',
      targetInstitutionCode: '99902001',
      targetInstitutionName: '松岚支局',
      sourceCounterCode: '01',
      handedOverAt: '2026-08-10T10:00:00.000+10:00',
      operator,
    })).rejects.toThrow('已进入其他批次或委托记录')
  })

  it('creates a numeric batch, records the cumulative meter reading and uploads daily balance', async () => {
    const repository = MemoryServiceRepository.create()
    const transactionId = await addSettledAgreementMail(
      repository,
      'GNPM00000001',
      '2026-08-10T09:00:00.000+10:00',
    )
    expect(queryPostageMeterPendingTransactions(await repository.load())).toHaveLength(1)

    const created = await repository.executePostageMeter({
      type: 'create-postage-meter-batch',
      transactionIds: [transactionId],
      createdAt: '2026-08-10T10:00:00.000+10:00',
      operator,
    })
    expect(created.batch?.batchNumber).toMatch(/^\d{20}$/)
    expect(created.batch).toMatchObject({
      expectedItemCount: 1,
      status: 'pending',
    })
    expect(queryPostageMeterPendingTransactions(created.state)).toHaveLength(0)

    const device = created.state.postageMeterDevices[0]!
    const expectedPostageCents = created.batch!.expectedPostageCents
    const registered = await repository.executePostageMeter({
      type: 'register-postage-meter-reading',
      batchId: created.batch!.id,
      deviceId: device.id,
      startCount: device.cumulativeImprintCount,
      endCount: device.cumulativeImprintCount + 1,
      cancelledCount: 0,
      startAmountCents: device.cumulativePostageCents,
      endAmountCents: device.cumulativePostageCents + expectedPostageCents,
      cancelledAmountCents: 0,
      registeredAt: '2026-08-10T11:00:00.000+10:00',
      operator,
    })
    expect(registered.registration).toMatchObject({
      actualItemCount: 1,
      actualPostageCents: expectedPostageCents,
    })
    expect(registered.batch?.status).toBe('registered')
    expect(queryPostageMeterUsageLedger(
      registered.state,
      '2026-08-10',
      '2026-08-10',
      device.id,
    )).toMatchObject([{
      agreementAccountIds: ['99000000000001'],
      differenceItemCount: 0,
      differencePostageCents: 0,
    }])
    expect(postageMeterBatchDifference(registered.batch!)).toEqual({
      itemCount: 0,
      postageCents: 0,
    })

    const balanced = await repository.executePostageMeter({
      type: 'record-postage-meter-discrepancy',
      batchId: registered.batch!.id,
      reason: '',
    })
    expect(balanced.batch?.status).toBe('balanced')

    const generated = await repository.executePostageMeter({
      type: 'generate-postage-meter-daily-balance',
      institutionCode: '99901001',
      institutionName: '景麓营业部',
      statisticDate: '2026-08-10',
      deviceId: device.id,
      generatedAt: '2026-08-10T18:00:00.000+10:00',
    })
    expect(generated.balance).toMatchObject({
      expectedItemCount: 1,
      actualItemCount: 1,
      differenceItemCount: 0,
      uploadedAt: null,
    })

    const uploaded = await repository.executePostageMeter({
      type: 'upload-postage-meter-daily-balance',
      balanceId: generated.balance!.id,
      uploadedAt: '2026-08-10T18:05:00.000+10:00',
      operator,
    })
    expect(uploaded.balance?.uploadedBy?.displayName).toBe('演示营业员')
    expect(uploaded.balance?.uploadedAt).toBe('2026-08-10T18:05:00.000+10:00')
  })

  it('requires a discrepancy reason and supervisor authorization for a changed starting reading', async () => {
    const repository = MemoryServiceRepository.create()
    const transactionId = await addSettledAgreementMail(
      repository,
      'GNPM00000002',
      '2026-08-10T09:10:00.000+10:00',
    )
    const created = await repository.executePostageMeter({
      type: 'create-postage-meter-batch',
      transactionIds: [transactionId],
      createdAt: '2026-08-10T10:10:00.000+10:00',
      operator,
    })
    const device = created.state.postageMeterDevices[0]!
    await expect(repository.executePostageMeter({
      type: 'register-postage-meter-reading',
      batchId: created.batch!.id,
      deviceId: device.id,
      startCount: device.cumulativeImprintCount + 1,
      endCount: device.cumulativeImprintCount + 1,
      cancelledCount: 0,
      startAmountCents: device.cumulativePostageCents,
      endAmountCents: device.cumulativePostageCents,
      cancelledAmountCents: 0,
      registeredAt: '2026-08-10T11:10:00.000+10:00',
      operator,
    })).rejects.toThrow('本次操作需要有权人员使用真实账号现场授权')

    await expect(repository.executePostageMeter({
      type: 'register-postage-meter-reading',
      batchId: created.batch!.id,
      deviceId: device.id,
      startCount: device.cumulativeImprintCount + 1,
      endCount: device.cumulativeImprintCount + 1,
      cancelledCount: 0,
      startAmountCents: device.cumulativePostageCents,
      endAmountCents: device.cumulativePostageCents,
      cancelledAmountCents: 0,
      authorization: await createTestOnSiteAuthorization('red-flush-invoice'),
      registeredAt: '2026-08-10T11:10:00.000+10:00',
      operator,
    })).rejects.toThrow('本次操作需要有权人员使用真实账号现场授权')

    const correctedStart = await repository.executePostageMeter({
      type: 'register-postage-meter-reading',
      batchId: created.batch!.id,
      deviceId: device.id,
      startCount: device.cumulativeImprintCount + 1,
      endCount: device.cumulativeImprintCount + 1,
      cancelledCount: 0,
      startAmountCents: device.cumulativePostageCents,
      endAmountCents: device.cumulativePostageCents,
      cancelledAmountCents: 0,
      authorization: await createTestOnSiteAuthorization('adjust-postage-meter-reading'),
      registeredAt: '2026-08-10T11:10:00.000+10:00',
      operator,
    })
    expect(correctedStart.registration).toMatchObject({
      startCount: device.cumulativeImprintCount + 1,
    })

    await expect(repository.executePostageMeter({
      type: 'record-postage-meter-discrepancy',
      batchId: correctedStart.batch!.id,
      reason: '',
    })).rejects.toThrow('必须填写差错原因')
  })

  it('supports batch queries and validates editable device fields', async () => {
    const repository = MemoryServiceRepository.create()
    const transactionId = await addSettledAgreementMail(
      repository,
      'GNPM00000003',
      '2026-08-10T09:20:00.000+10:00',
    )
    const created = await repository.executePostageMeter({
      type: 'create-postage-meter-batch',
      transactionIds: [transactionId],
      createdAt: '2026-08-10T10:20:00.000+10:00',
      operator,
    })
    expect(queryPostageMeterBatches(created.state, {
      createdDateFrom: '2026-08-10',
      createdDateTo: '2026-08-10',
      status: 'pending',
    })).toHaveLength(1)

    const device = created.state.postageMeterDevices[0]!
    await expect(repository.executePostageMeter({
      type: 'update-postage-meter-device',
      deviceId: device.id,
      counterCode: '123',
      networkMode: 'indirect',
      terminalPort: '3',
      updatedAt: '2026-08-10T12:00:00.000+10:00',
    })).rejects.toThrow('8 位数字')

    const updated = await repository.executePostageMeter({
      type: 'update-postage-meter-device',
      deviceId: device.id,
      counterCode: '99901002',
      networkMode: 'indirect',
      terminalPort: '3',
      updatedAt: '2026-08-10T12:00:00.000+10:00',
    })
    expect(updated.device).toMatchObject({
      counterCode: '99901002',
      networkMode: 'indirect',
      terminalPort: '3',
    })
  })

  it('hands agreement mail over, receives it and completes an approved return', async () => {
    const repository = MemoryServiceRepository.create()
    const transactionId = await addSettledAgreementMail(
      repository,
      'GNPM00000004',
      '2026-08-10T09:30:00.000+10:00',
    )
    expect(queryPostageMeterDelegableTransactions(await repository.load())).toHaveLength(1)

    const handedOver = await repository.executePostageMeter({
      type: 'create-postage-meter-mail-handover',
      transactionIds: [transactionId],
      sourceInstitutionCode: '99901001',
      sourceInstitutionName: '景麓营业部',
      targetInstitutionCode: '99902001',
      targetInstitutionName: '松岚支局',
      sourceCounterCode: '01',
      handedOverAt: '2026-08-10T10:00:00.000+10:00',
      operator,
    })
    expect(handedOver.handover).toMatchObject({
      status: 'pending-receipt',
      expectedItemCount: 1,
      targetInstitutionName: '松岚支局',
    })
    expect(handedOver.handover?.handoverNumber).toMatch(/^\d{20}$/)
    expect(queryPostageMeterPendingTransactions(handedOver.state)).toHaveLength(0)

    const received = await repository.executePostageMeter({
      type: 'receive-postage-meter-mail-handovers',
      handoverIds: [handedOver.handover!.id],
      receivedAt: '2026-08-10T10:30:00.000+10:00',
      operator,
    })
    expect(received.handover?.status).toBe('received')
    expect(queryPostageMeterPendingTransactions(received.state)).toHaveLength(1)

    const requested = await repository.executePostageMeter({
      type: 'request-postage-meter-mail-handover-return',
      handoverId: received.handover!.id,
      requestedAt: '2026-08-10T10:40:00.000+10:00',
      operator,
    })
    expect(requested.handover?.status).toBe('return-requested')
    expect(queryPostageMeterPendingTransactions(requested.state)).toHaveLength(0)

    const approved = await repository.executePostageMeter({
      type: 'approve-postage-meter-mail-handover-return',
      handoverId: requested.handover!.id,
      approvedAt: '2026-08-10T10:50:00.000+10:00',
      operator,
    })
    expect(approved.handover?.status).toBe('returned')
    expect(queryPostageMeterPendingTransactions(approved.state)).toHaveLength(1)
    expect(queryPostageMeterMailHandovers(approved.state, {
      handedOverDateFrom: '2026-08-10',
      handedOverDateTo: '2026-08-10',
      status: 'returned',
      sourceInstitution: '景麓',
      targetInstitution: '松岚',
      agreementAccount: '99000000000001',
      handoverNumber: approved.handover!.handoverNumber,
    })).toHaveLength(1)
  })

  it('submits funding and repair requests and activates an enable request on daily upload', async () => {
    const repository = MemoryServiceRepository.create()
    const device = (await repository.load()).postageMeterDevices[0]!
    const funded = await repository.executePostageMeter({
      type: 'submit-postage-meter-funding-request',
      deviceId: device.id,
      amountCents: 123_45,
      requestedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    })
    expect(funded.fundingRequest).toMatchObject({
      amountCents: 123_45,
      status: 'pending-external-approval',
    })
    expect(funded.device?.totalPostageCents).toBe(device.totalPostageCents)

    const repaired = await repository.executePostageMeter({
      type: 'submit-postage-meter-repair-request',
      deviceId: device.id,
      matter: 'repair',
      requestedAt: '2026-08-10T12:10:00.000+10:00',
      operator,
    })
    expect(repaired.device?.reportStatus).toBe('disabled')
    const enableRequested = await repository.executePostageMeter({
      type: 'submit-postage-meter-repair-request',
      deviceId: device.id,
      matter: 'enable',
      requestedAt: '2026-08-10T12:20:00.000+10:00',
      operator,
    })
    expect(enableRequested.repairRequest).toMatchObject({
      matter: 'enable',
      status: 'submitted',
    })

    const generated = await repository.executePostageMeter({
      type: 'generate-postage-meter-daily-balance',
      institutionCode: '99901001',
      institutionName: '景麓营业部',
      statisticDate: '2026-08-11',
      deviceId: device.id,
      generatedAt: '2026-08-11T18:00:00.000+10:00',
    })
    const uploaded = await repository.executePostageMeter({
      type: 'upload-postage-meter-daily-balance',
      balanceId: generated.balance!.id,
      uploadedAt: '2026-08-11T18:05:00.000+10:00',
      operator,
    })
    expect(uploaded.device?.reportStatus).toBe('enabled')
    expect(uploaded.state.postageMeterRepairRequests.find((request) =>
      request.id === enableRequested.repairRequest!.id)).toMatchObject({
      status: 'activated',
      activatedAt: '2026-08-11T18:05:00.000+10:00',
    })
  })

  it('allows the receiving office to return unprocessed mail and blocks return after batching', async () => {
    const repository = MemoryServiceRepository.create()
    const transactionId = await addSettledAgreementMail(
      repository,
      'GNPM00000005',
      '2026-08-10T13:00:00.000+10:00',
    )
    const createAndReceive = async (minute: string) => {
      const handedOver = await repository.executePostageMeter({
        type: 'create-postage-meter-mail-handover',
        transactionIds: [transactionId],
        sourceInstitutionCode: '99901001',
        sourceInstitutionName: '景麓营业部',
        targetInstitutionCode: '99902001',
        targetInstitutionName: '松岚支局',
        sourceCounterCode: '01',
        handedOverAt: `2026-08-10T13:${minute}:00.000+10:00`,
        operator,
      })
      return repository.executePostageMeter({
        type: 'receive-postage-meter-mail-handovers',
        handoverIds: [handedOver.handover!.id],
        receivedAt: `2026-08-10T13:${String(Number(minute) + 1).padStart(2, '0')}:00.000+10:00`,
        operator,
      })
    }

    const firstReceived = await createAndReceive('10')
    const returned = await repository.executePostageMeter({
      type: 'return-postage-meter-mail-handover',
      handoverId: firstReceived.handover!.id,
      returnedAt: '2026-08-10T13:12:00.000+10:00',
      operator,
    })
    expect(returned.handover?.status).toBe('returned')

    const secondReceived = await createAndReceive('20')
    await repository.executePostageMeter({
      type: 'create-postage-meter-batch',
      transactionIds: [transactionId],
      createdAt: '2026-08-10T13:22:00.000+10:00',
      operator,
    })
    await expect(repository.executePostageMeter({
      type: 'return-postage-meter-mail-handover',
      handoverId: secondReceived.handover!.id,
      returnedAt: '2026-08-10T13:23:00.000+10:00',
      operator,
    })).rejects.toThrow('已经进入过戳批次')
  })
})
