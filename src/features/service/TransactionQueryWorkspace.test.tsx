import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import {
  DEMO_MANAGEMENT_OPERATOR_ID as DEMO_SUPERVISOR_ID,
  DEMO_MANAGEMENT_SECRET as DEMO_SUPERVISOR_SECRET,
} from '../../domain/access/seed'
import { createTestOnSiteAuthorizer } from '../../test/workAuthorization'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { TransactionQueryWorkspace } from './TransactionQueryWorkspace'

async function acceptLocalLetter(
  repository: MemoryServiceRepository,
  acceptedAt = '2026-01-15T09:20:00.000Z',
) {
  const product = SERVICE_PRODUCTS[0]!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    itemCode: '7000818316568',
    weightGrams: 20,
  }
  const sender = {
    ...createEmptySender(),
    contact: '10000000001',
    name: '演示寄件人',
    detailedAddress: '瀚原省栖沄市景麓区新程路 1 号',
    postalCode: '110022',
  }
  const recipient = {
    ...createEmptyRecipient(),
    contact: '10000000002',
    name: '演示收件人',
    detailedAddress: '澄岐省澄野市江洲区远帆路 2 号',
    postalCode: '120023',
  }
  return repository.accept({
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender,
      recipient,
    },
    draft,
    product,
  })
}

describe('TransactionQueryWorkspace', () => {
  it('defaults acceptance queries to the current real business day', async () => {
    const repository = MemoryServiceRepository.create()
    const accepted = await acceptLocalLetter(repository, new Date().toISOString())
    const user = userEvent.setup()
    render(
      <TransactionQueryWorkspace
        authorizeOnSite={createTestOnSiteAuthorizer()}
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '查询' }))
    expect(await screen.findByText(accepted.transaction.id)).toBeInTheDocument()
  })

  it('expands evidence-based filters, records a reprint, and corrects with a required reason', async () => {
    const repository = MemoryServiceRepository.create()
    await acceptLocalLetter(repository)
    const user = userEvent.setup()
    render(
      <TransactionQueryWorkspace
        authorizeOnSite={createTestOnSiteAuthorizer()}
        initialBusinessDate="2026-01-15"
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    expect(await screen.findByRole('button', { name: '查询' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '数据类型' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '展开条件' }))
    expect(screen.getByRole('combobox', { name: '数据类型' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查询' }))

    const row = (await screen.findByText('SIM-20260115-000001')).closest('tr')
    expect(row).not.toBeNull()
    await user.click(within(row!).getByRole('button', { name: '重打' }))
    const reprint = await screen.findByRole('dialog', { name: '邮件收寄单据重打' })
    const receipt = within(reprint).getByRole('article', { name: '邮件收寄凭据' })
    expect(within(receipt).getByText('SIM-20260115-000001')).toBeInTheDocument()
    expect(within(receipt).getByText('7000818316568')).toBeInTheDocument()
    expect(within(receipt).getAllByText('¥ 0.80')).toHaveLength(2)
    await user.click(within(reprint).getByRole('button', { name: '关闭' }))

    await user.click(within(row!).getByRole('button', { name: '查改' }))
    const correction = await screen.findByRole('dialog', { name: '查改 SIM-20260115-000001' })
    const recipientName = within(correction).getByRole('textbox', { name: '查改收件人姓名' })
    await user.clear(recipientName)
    await user.type(recipientName, '查改后收件人')
    await user.click(within(correction).getByRole('button', { name: '计费并提交修改' }))

    const reason = await screen.findByRole('dialog', { name: '请输入修改邮件原因' })
    await user.type(within(reason).getByRole('textbox', { name: '修改邮件原因' }), '客户核对后更正')
    await user.click(within(reason).getByRole('button', { name: '确定' }))

    expect(await screen.findByText(/查改成功：SIM-20260115-000001/)).toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      transactions: [{ customer: { recipient: { name: '查改后收件人' } } }],
      corrections: [{ reason: '客户核对后更正' }],
      documentActions: [{ kind: 'receipt-reprint' }],
    })
  })

  it('supplements an invoice for a settled record that declined at checkout', async () => {
    const repository = MemoryServiceRepository.create()
    const accepted = await acceptLocalLetter(repository)
    const settled = await repository.settle({
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: '2026-01-15T09:30:00.000Z',
      amountReceivedCents: 80,
    })
    await repository.recordInvoiceDecision(settled.settlement.id, false)
    const user = userEvent.setup()
    render(
      <TransactionQueryWorkspace
        authorizeOnSite={createTestOnSiteAuthorizer()}
        initialBusinessDate="2026-01-15"
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '查询' }))
    const row = (await screen.findByText('SIM-20260115-000001')).closest('tr')
    expect(row).not.toBeNull()
    await user.click(within(row!).getByRole('button', { name: '开票' }))
    const choice = await screen.findByRole('dialog', { name: '是否需要开具发票？' })
    await user.click(within(choice).getByRole('button', { name: '需要' }))
    const registration = await screen.findByRole('dialog', { name: '电子发票登记' })
    await user.type(
      within(registration).getByLabelText('购方纳税人识别号'),
      'SIM-TAX-0002',
    )
    await user.click(within(registration).getByRole('button', { name: '确认开票' }))
    const delivery = await screen.findByRole('dialog', { name: '是否进行发票交付？' })
    await user.click(within(delivery).getByRole('button', { name: '取消' }))

    expect(await screen.findByRole('status')).toHaveTextContent('开票成功，暂不进行发票交付')
    await expect(repository.load()).resolves.toMatchObject({
      settlements: [{ invoiceRequested: true }],
      fiscalInvoices: [{
        sourceId: 'JS-20260115-000001',
        taxpayerId: 'SIM-TAX-0002',
        deliveryRequested: false,
      }],
    })
  })

  it('withdraws a settled transaction only after supervisor authorization and previews original-route refund', async () => {
    const repository = MemoryServiceRepository.create()
    const accepted = await acceptLocalLetter(repository)
    await repository.settle({
      transactionIds: [accepted.transaction.id],
      tender: 'third-party',
      settledAt: '2026-01-15T09:30:00.000Z',
      amountReceivedCents: 80,
    })
    const user = userEvent.setup()
    render(
      <TransactionQueryWorkspace
        authorizeOnSite={createTestOnSiteAuthorizer()}
        initialBusinessDate="2026-01-15"
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '查询' }))
    const row = (await screen.findByText('SIM-20260115-000001')).closest('tr')
    expect(row).not.toBeNull()
    await user.click(within(row!).getByRole('button', { name: '删除' }))

    const reason = await screen.findByRole('dialog', { name: '请输入修改邮件原因' })
    await user.type(within(reason).getByRole('textbox', { name: '修改邮件原因' }), '客户申请撤销')
    await user.click(within(reason).getByRole('button', { name: '确定' }))

    const authorization = await screen.findByRole('dialog', { name: '请输入主管工号和密码' })
    expect(within(authorization).getByLabelText('主管工号')).toHaveValue('')
    await user.type(within(authorization).getByLabelText('主管工号'), DEMO_SUPERVISOR_ID)
    await user.type(within(authorization).getByLabelText('主管密码'), DEMO_SUPERVISOR_SECRET)
    await user.click(within(authorization).getByRole('button', { name: '授权并删除' }))

    const refund = await screen.findByRole('dialog', { name: '退款记录' })
    expect(within(refund).getByText('第三方支付原路退款')).toBeInTheDocument()
    expect(within(refund).getByText('待申请')).toBeInTheDocument()
    expect(within(refund).getByText('¥ 0.80')).toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      transactions: [{ status: 'withdrawn' }],
      withdrawals: [{ reason: '客户申请撤销' }],
      refunds: [{ route: 'original-payment', amountCents: 80 }],
    })
  })

  it('selects every matching active record for deletion by a queried serial prefix', async () => {
    const repository = MemoryServiceRepository.create()
    await acceptLocalLetter(repository)
    await acceptLocalLetter(repository)
    const user = userEvent.setup()
    render(
      <TransactionQueryWorkspace
        authorizeOnSite={createTestOnSiteAuthorizer()}
        initialBusinessDate="2026-01-15"
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    const querySerial = await screen.findByRole('textbox', { name: '查询流水号' })
    await user.type(querySerial, 'SIM-20260115')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByText('查询完成，共 2 笔收寄记录。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '按查询流水号删除' }))

    const reason = await screen.findByRole('dialog', { name: '请输入修改邮件原因' })
    expect(within(reason).getByText('将删除 2 笔收寄记录。')).toBeInTheDocument()
    await user.click(within(reason).getByRole('button', { name: '取消' }))
    await expect(repository.load()).resolves.toMatchObject({
      transactions: [{ status: 'pending-settlement' }, { status: 'pending-settlement' }],
      withdrawals: [],
    })
  })
})
