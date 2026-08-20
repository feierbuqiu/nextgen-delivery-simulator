import { describe, expect, it } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createEmptyRecipient, createEmptySender } from '../customer/seed'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { calculateServiceCharge } from './policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from './seed'
import {
  querySpecialHandlingApplications,
  quoteSpecialHandlingApplication,
  type SpecialHandlingApplicationDraft,
} from './specialHandling'
import type {
  ServiceDestinationZone,
  ServiceOperatorSnapshot,
} from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '栖沄邮件处理中心',
}

async function addSettledMail(
  repository: MemoryServiceRepository,
  searchCode: string,
  itemCode: string,
  destinationZone: ServiceDestinationZone = 'nonlocal',
) {
  const product = SERVICE_PRODUCTS.find((candidate) => candidate.searchCode === searchCode)!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    destinationZone,
    destinationOffice: '栖沄邮件处理中心',
    itemCode,
    weightGrams: 1000,
    platformQuoteCents: 1_200,
  }
  const accepted = await repository.accept({
    acceptedAt: '2026-08-11T09:00:00.000+10:00',
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: product.productFamily,
      destinationRegion: destinationZone === 'international' ? 'overseas' : 'domestic',
      sender: {
        ...createEmptySender(),
        contact: '10000000001',
        name: '演练申请人',
      },
      recipient: {
        ...createEmptyRecipient(),
        contact: '10000000008',
        detailedAddress: '瀚原省栖沄市景麓区新程路 6 号',
        name: '演练收件人',
      },
    },
    draft,
    product,
    operator,
  })
  await repository.settle({
    transactionIds: [accepted.transaction.id],
    tender: 'cash',
    settledAt: '2026-08-11T09:05:00.000+10:00',
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  return accepted.transaction
}

function applicationDraft(
  itemCode: string,
  kind: SpecialHandlingApplicationDraft['kind'] = 'withdrawal',
): SpecialHandlingApplicationDraft {
  return {
    kind,
    mailItemCode: itemCode,
    applicantName: '演练申请人',
    applicantPhone: '10000000001',
    applicantIdentityType: 'travel',
    applicantIdentityNumber: 'SIMULATOR-001',
    redirectedAddress: kind === 'redirect' ? '瀚原省栖沄市景麓区新程路 8 号' : '',
    redirectedPostalCode: kind === 'redirect' ? '319901' : '',
    redirectedDestinationOffice: kind === 'redirect' ? '景麓营业部' : '',
    reason: kind === 'withdrawal' ? '寄件人申请撤单' : '收件地址填写有误',
  }
}

async function createApplication(
  repository: MemoryServiceRepository,
  draft: SpecialHandlingApplicationDraft,
) {
  const quotedAt = '2026-08-11T10:00:00.000+10:00'
  return repository.executeSpecialHandling({
    type: 'create-special-handling-application',
    draft,
    quotedAt,
    createdAt: '2026-08-11T10:01:00.000+10:00',
    operator,
  })
}

describe('special handling', () => {
  it('quotes, creates, settles and queries a domestic withdrawal', async () => {
    const repository = MemoryServiceRepository.create()
    await addSettledMail(repository, '310', 'PA13131313435')
    const draft = applicationDraft('PA13131313435')

    const quote = quoteSpecialHandlingApplication(
      await repository.load(),
      draft,
      '2026-08-11T10:00:00.000+10:00',
    )
    expect(quote).toMatchObject({
      recipientName: '演练收件人',
      recipientPhone: '10000000008',
      recipientAddress: '瀚原省栖沄市景麓区新程路 6 号',
      feeCents: 500,
      quoteSource: 'simulated-delivery-interface',
    })

    const created = await createApplication(repository, draft)
    expect(created.application).toMatchObject({
      kind: 'withdrawal',
      settlementTender: null,
      uploadStatus: 'not-uploaded',
    })

    const settled = await repository.executeSpecialHandling({
      type: 'settle-special-handling-application',
      applicationId: created.application!.id,
      tender: 'cash',
      settledAt: '2026-08-11T10:02:00.000+10:00',
      uploadOutcome: 'succeeded',
    })
    expect(settled.application).toMatchObject({
      settlementTender: 'cash',
      uploadStatus: 'succeeded',
      uploadAttempts: 1,
    })
    expect(querySpecialHandlingApplications(settled.state, {
      mailItemCode: 'pa1313',
      operatorId: '演示',
      kind: 'withdrawal',
      operatedDateFrom: '2026-08-11',
      operatedDateTo: '2026-08-11',
    })).toHaveLength(1)
  })

  it('requires redirect fields and permits retry after an upload failure', async () => {
    const repository = MemoryServiceRepository.create()
    await addSettledMail(repository, '404', 'KM13131313435')
    const draft = applicationDraft('KM13131313435', 'redirect')
    const quote = quoteSpecialHandlingApplication(
      await repository.load(),
      draft,
      '2026-08-11T10:00:00.000+10:00',
    )
    expect(quote.feeCents).toBe(800)

    const created = await createApplication(repository, draft)
    const failed = await repository.executeSpecialHandling({
      type: 'settle-special-handling-application',
      applicationId: created.application!.id,
      tender: 'pos',
      settledAt: '2026-08-11T10:02:00.000+10:00',
      uploadOutcome: 'failed',
      uploadFailureReason: '接口暂未确认',
    })
    expect(failed.application).toMatchObject({
      uploadStatus: 'failed',
      uploadAttempts: 1,
    })

    const retried = await repository.executeSpecialHandling({
      type: 'retry-special-handling-upload',
      applicationId: created.application!.id,
      uploadedAt: '2026-08-11T10:03:00.000+10:00',
      uploadOutcome: 'succeeded',
    })
    expect(retried.application).toMatchObject({
      uploadStatus: 'succeeded',
      uploadAttempts: 2,
      uploadFailureReason: '',
    })
    await expect(repository.executeSpecialHandling({
      type: 'delete-special-handling-application',
      applicationId: created.application!.id,
    })).rejects.toThrow('上传成功后的撤改申请不允许删除')
  })

  it('rejects a mismatched applicant phone and ineligible product', async () => {
    const repository = MemoryServiceRepository.create()
    await addSettledMail(repository, '310', 'PA13131313435')
    const wrongPhone = {
      ...applicationDraft('PA13131313435'),
      applicantPhone: '10000000003',
    }
    const state = await repository.load()
    expect(() => quoteSpecialHandlingApplication(
      state,
      wrongPhone,
      '2026-08-11T10:00:00.000+10:00',
    )).toThrow('申请人电话必须与原邮件寄件客户电话保持一致')

    const ineligibleRepository = MemoryServiceRepository.create()
    await addSettledMail(ineligibleRepository, '300', 'PB13131313435')
    const ineligibleState = await ineligibleRepository.load()
    expect(() => quoteSpecialHandlingApplication(
      ineligibleState,
      applicationDraft('PB13131313435'),
      '2026-08-11T10:00:00.000+10:00',
    )).toThrow('当前业务产品不允许办理撤单或改址')
  })

  it('cancels an uploaded withdrawal and completes its supervised refund', async () => {
    const repository = MemoryServiceRepository.create()
    await addSettledMail(repository, '310', 'PA13131313435')
    const created = await createApplication(
      repository,
      applicationDraft('PA13131313435'),
    )
    await repository.executeSpecialHandling({
      type: 'settle-special-handling-application',
      applicationId: created.application!.id,
      tender: 'third-party',
      settledAt: '2026-08-11T10:02:00.000+10:00',
      uploadOutcome: 'succeeded',
    })

    await expect(repository.executeSpecialHandling({
      type: 'cancel-special-handling-withdrawal',
      applicationId: created.application!.id,
      deliveryStageDecision: 'not-entered-delivery',
      cancelledAt: '2026-08-11T10:03:00.000+10:00',
      operator,
    })).rejects.toThrow('邮件尚未进入投递阶段')

    const cancelled = await repository.executeSpecialHandling({
      type: 'cancel-special-handling-withdrawal',
      applicationId: created.application!.id,
      deliveryStageDecision: 'entered-delivery',
      cancelledAt: '2026-08-11T10:03:00.000+10:00',
      operator,
    })
    expect(cancelled.application?.refundStatus).toBe('pending')

    await expect(repository.executeSpecialHandling({
      type: 'complete-special-handling-refund',
      applicationId: created.application!.id,
      refundedAt: '2026-08-11T10:04:00.000+10:00',
      operator,
      authorization: undefined!,
    })).rejects.toThrow('真实账号现场授权')

    const refunded = await repository.executeSpecialHandling({
      type: 'complete-special-handling-refund',
      applicationId: created.application!.id,
      refundedAt: '2026-08-11T10:04:00.000+10:00',
      operator,
      authorization: await createTestOnSiteAuthorization('complete-special-handling-refund'),
    })
    expect(refunded.application).toMatchObject({
      refundStatus: 'refunded',
      refundedBy: operator,
    })
  })
})
