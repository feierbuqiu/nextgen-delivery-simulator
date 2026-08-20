import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import {
  DEMO_MANAGEMENT_OPERATOR_ID,
  DEMO_MANAGEMENT_SECRET,
} from '../../domain/access/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import { DEFAULT_SERVICE_OPERATOR } from '../../domain/service/transactions'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import {
  createTestOnSiteAuthorization,
  createTestOnSiteAuthorizer,
} from '../../test/workAuthorization'
import { RefundPendingWorkspace } from './RefundPendingWorkspace'

describe('RefundPendingWorkspace', () => {
  it('requests and completes a third-party refund across both documented tabs', async () => {
    const repository = MemoryServiceRepository.create()
    const product = SERVICE_PRODUCTS.find((item) => item.searchCode === '107')!
    const draft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: product.id,
      itemCode: '7000818316568',
      weightGrams: 20,
    }
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
    await repository.withdraw({
      transactionIds: [accepted.transaction.id],
      withdrawnAt: '2026-01-15T10:00:00.000Z',
      reason: '客户申请撤销',
      authorization: await createTestOnSiteAuthorization('withdraw-service-transaction'),
    })
    const user = userEvent.setup()

    render(
      <RefundPendingWorkspace
        onBack={vi.fn()}
        operator={DEFAULT_SERVICE_OPERATOR}
        repository={repository}
        authorizeOnSite={createTestOnSiteAuthorizer()}
      />,
    )

    await screen.findByRole('navigation', { name: '退款待办查询页签' })
    await user.click(screen.getByRole('tab', { name: '支付状态查询' }))
    await user.clear(screen.getByLabelText('支付时间起'))
    await user.type(screen.getByLabelText('支付时间起'), '2026-01-15')
    await user.clear(screen.getByLabelText('支付时间止'))
    await user.type(screen.getByLabelText('支付时间止'), '2026-01-15')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByText(accepted.transaction.id)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `查看支付状态 ${accepted.transaction.id}` }))
    const paymentDialog = screen.getByRole('dialog', { name: '支付状态' })
    expect(within(paymentDialog).getByText('支付成功')).toBeInTheDocument()
    await user.click(within(paymentDialog).getByRole('button', { name: '发起退款申请' }))

    expect(await screen.findByText(/已发起/)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '退款待办查询' }))
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByRole('cell', { name: '未退款' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /办理退款/ }))
    const refundDialog = screen.getByRole('dialog', { name: '退款' })
    const supervisorId = within(refundDialog).getByRole('textbox', { name: '退款主管工号' })
    expect(supervisorId).toHaveValue('')
    await user.type(supervisorId, DEMO_MANAGEMENT_OPERATOR_ID)
    await user.type(
      within(refundDialog).getByLabelText('退款主管密码'),
      DEMO_MANAGEMENT_SECRET,
    )
    await user.click(within(refundDialog).getByRole('button', { name: '确认退款' }))

    expect(await screen.findByText(/已按原支付渠道退回/)).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '已退款' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /查看退款状态/ }))
    const statusDialog = screen.getByRole('dialog', { name: '退款状态' })
    expect(within(statusDialog).getByText(/^MN-TK-\d{8}-000001$/)).toBeInTheDocument()
    expect(within(statusDialog).getByText(DEFAULT_SERVICE_OPERATOR.displayName)).toBeInTheDocument()
    await user.click(within(statusDialog).getByRole('button', { name: '关闭' }))

    await expect(repository.load()).resolves.toMatchObject({
      refunds: [{
        status: 'refunded',
        platformRefundId: expect.stringMatching(/^MN-TK-\d{8}-000001$/),
        processedBy: DEFAULT_SERVICE_OPERATOR,
      }],
    })
  })

  it('completes a cancelled withdrawal fee refund from special handling', async () => {
    const repository = MemoryServiceRepository.create()
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
    const accepted = await repository.accept({
      acceptedAt: '2026-01-15T09:00:00.000Z',
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
      settledAt: '2026-01-15T09:05:00.000Z',
      amountReceivedCents: accepted.transaction.charge.settlementDueCents,
    })
    const created = await repository.executeSpecialHandling({
      type: 'create-special-handling-application',
      draft: {
        kind: 'withdrawal',
        mailItemCode: 'PA13131313435',
        applicantName: '演练申请人',
        applicantPhone: '10000000001',
        applicantIdentityType: 'travel',
        applicantIdentityNumber: 'SIMULATOR-001',
        redirectedAddress: '',
        redirectedPostalCode: '',
        redirectedDestinationOffice: '',
        reason: '寄件人申请撤单',
      },
      quotedAt: '2026-01-15T10:00:00.000Z',
      createdAt: '2026-01-15T10:01:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
    })
    await repository.executeSpecialHandling({
      type: 'settle-special-handling-application',
      applicationId: created.application!.id,
      tender: 'cash',
      settledAt: '2026-01-15T10:02:00.000Z',
      uploadOutcome: 'succeeded',
    })
    await repository.executeSpecialHandling({
      type: 'cancel-special-handling-withdrawal',
      applicationId: created.application!.id,
      deliveryStageDecision: 'entered-delivery',
      cancelledAt: '2026-01-15T10:03:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
    })
    const user = userEvent.setup()

    render(
      <RefundPendingWorkspace
        onBack={vi.fn()}
        operator={DEFAULT_SERVICE_OPERATOR}
        repository={repository}
        authorizeOnSite={createTestOnSiteAuthorizer()}
      />,
    )

    await screen.findByRole('navigation', { name: '退款待办查询页签' })
    await user.clear(screen.getByLabelText('申请退款时间起'))
    await user.type(screen.getByLabelText('申请退款时间起'), '2026-01-15')
    await user.clear(screen.getByLabelText('申请退款时间止'))
    await user.type(screen.getByLabelText('申请退款时间止'), '2026-01-15')
    await user.click(screen.getByRole('button', { name: '查询' }))
    const row = await screen.findByRole('row', { name: /邮件撤单手续费退款/ })
    expect(row).toHaveTextContent('现金支付')
    expect(row).toHaveTextContent('¥ 5.00')
    await user.click(within(row).getByRole('button', { name: /办理退款/ }))
    const dialog = screen.getByRole('dialog', { name: '退款' })
    expect(within(dialog).getByLabelText('退款主管工号')).toHaveValue('')
    await user.type(within(dialog).getByLabelText('退款主管工号'), DEMO_MANAGEMENT_OPERATOR_ID)
    await user.type(
      within(dialog).getByLabelText('退款主管密码'),
      DEMO_MANAGEMENT_SECRET,
    )
    await user.click(within(dialog).getByRole('button', { name: '确认退款' }))

    expect(await screen.findByText(/已办理/)).toBeInTheDocument()
    expect((await repository.load()).specialHandlingApplications[0]).toMatchObject({
      refundStatus: 'refunded',
      refundedBy: DEFAULT_SERVICE_OPERATOR,
    })
  })
})
