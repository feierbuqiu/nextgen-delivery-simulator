import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { SettlementWorkspace } from './SettlementWorkspace'

describe('SettlementWorkspace', () => {
  it('cash-settles a submitted service and asks for invoice after payment', async () => {
    const repository = MemoryServiceRepository.create()
    const product = SERVICE_PRODUCTS[0]!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      itemCode: '7000818316568',
      weightGrams: 20,
    }
    await repository.accept({
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
    await repository.acceptPostalSupplySale({
      acceptedAt: '2026-01-15T09:25:00.000Z',
      sender: createEmptySender(),
      lines: [{ itemId: 'supply-standard-envelope', quantity: 1 }],
    })
    const user = userEvent.setup()

    const view = render(
      <SettlementWorkspace
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    expect(await screen.findByText('SIM-20260115-000001')).toBeInTheDocument()
    expect(screen.getByText('YP-20260115-000001')).toBeInTheDocument()
    const received = screen.getByRole('textbox', { name: '实收金额' })
    expect(received).toHaveValue('2.80')
    await user.clear(received)
    await user.type(received, '125.68')
    expect(received).toHaveValue('125.68')
    await user.click(screen.getByRole('button', { name: '确认结算' }))

    await screen.findByRole('dialog', { name: '是否需要开具发票？' })
    view.unmount()
    render(
      <SettlementWorkspace
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )
    const invoice = await screen.findByRole('dialog', { name: '是否需要开具发票？' })
    expect(within(invoice).getByText(/JS-\d{8}-000001/u)).toBeInTheDocument()
    await user.click(within(invoice).getByRole('button', { name: '不需要发票' }))

    expect(await screen.findByText('已登记“不需要发票”。')).toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      transactions: [{
        status: 'settled',
        settlementId: expect.stringMatching(/^JS-\d{8}-000001$/u),
      }],
      postalSupplySales: [{
        status: 'settled',
        settlementId: expect.stringMatching(/^JS-\d{8}-000001$/u),
      }],
      settlements: [{
        id: expect.stringMatching(/^JS-\d{8}-000001$/u),
        tender: 'cash',
        amountReceivedCents: 12568,
        invoiceRequested: false,
      }],
    })
  })

  it('opens, registers and delivers an invoice directly after settlement', async () => {
    const repository = MemoryServiceRepository.create()
    const product = SERVICE_PRODUCTS[0]!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      itemCode: '7000818316568',
      weightGrams: 20,
    }
    const sender = {
      ...createEmptySender(),
      name: '周清禾',
      unit: '星河合作社',
      contact: '10000000001',
      identityValue: 'SIM-TAX-0001',
      detailedAddress: '瀚原省栖沄市景麓区示范路 1 号',
    }
    await repository.accept({
      acceptedAt: '2026-01-15T09:20:00.000Z',
      charge: calculateServiceCharge(draft, product),
      customer: {
        productFamily: 'basic-letter',
        destinationRegion: 'domestic',
        sender,
        recipient: createEmptyRecipient(),
      },
      draft,
      product,
    })
    const user = userEvent.setup()
    render(
      <SettlementWorkspace
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '确认结算' }))
    const choice = await screen.findByRole('dialog', { name: '是否需要开具发票？' })
    await user.click(within(choice).getByRole('button', { name: '需要发票' }))
    const registration = await screen.findByRole('dialog', { name: '电子发票登记' })
    expect(within(registration).getByLabelText('购方名称')).toHaveValue('星河合作社')
    expect(within(registration).getByLabelText('购方纳税人识别号')).toHaveValue('SIM-TAX-0001')
    await user.click(within(registration).getByRole('button', { name: '确认开票' }))
    const delivery = await screen.findByRole('dialog', { name: '是否进行发票交付？' })
    await user.click(within(delivery).getByRole('button', { name: '确定' }))

    expect(await screen.findByRole('status')).toHaveTextContent('开票成功，发票已完成交付')
    await expect(repository.load()).resolves.toMatchObject({
      settlements: [{ invoiceRequested: true }],
      fiscalInvoices: [{
        sourceId: expect.stringMatching(/^JS-\d{8}-000001$/u),
        buyerName: '星河合作社',
        deliveryRequested: true,
        status: 'issued',
      }],
    })
  })

  it('shows channel product fulfillment details and settles the order by POS', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.acceptChannelProductOrder({
      submittedAt: '2026-08-04T11:00:00.000Z',
      buyer: createEmptySender(),
      lines: [{ productId: 'channel-cloud-grain-box', skuCode: 'YG-06', quantity: 1 }],
      allocations: [],
    })
    const user = userEvent.setup()
    render(
      <SettlementWorkspace
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    expect(await screen.findByText('XS-20260804-000001')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '详情' }))
    const detail = await screen.findByRole('dialog', {
      name: '业务详情 XS-20260804-000001',
    })
    expect(within(detail).getByText('寄递 / 自提 / 现货')).toBeInTheDocument()
    expect(within(detail).getByText('0 / 0 / 1')).toBeInTheDocument()
    await user.click(within(detail).getByRole('button', { name: '关闭' }))

    await user.click(screen.getByRole('button', { name: 'POS 支付' }))
    await user.click(screen.getByRole('button', { name: '确认结算' }))
    expect(await screen.findByRole('dialog', { name: '是否需要开具发票？' }))
      .toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      channelProductOrders: [{
        status: 'settled',
        settlementId: expect.stringMatching(/^JS-\d{8}-000001$/u),
      }],
      settlements: [{ tender: 'pos', amountDueCents: 6800 }],
    })
  })

  it('shows traffic details and settles an agreement record by credit', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.acceptSupplementaryTraffic({
      kind: 'traffic-bulk-mail',
      acceptedAt: '2026-08-10T10:00:00.000Z',
      sender: {
        ...createEmptySender(),
        agreementAccountId: '99001000000001',
        agreementAccountName: '澜京长风文书服务中心',
      },
      mailNumber: '1115206600001',
    })
    const user = userEvent.setup()
    render(
      <SettlementWorkspace
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    expect(await screen.findByText('JG-20260810-000001')).toBeInTheDocument()
    expect(screen.getByText('交管大宗邮件收寄')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '记欠' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '详情' }))
    const detail = await screen.findByRole('dialog', {
      name: '业务详情 JG-20260810-000001',
    })
    expect(within(detail).getByText('405100')).toBeInTheDocument()
    expect(within(detail).getByText('1115206600001')).toBeInTheDocument()
    await user.click(within(detail).getByRole('button', { name: '关闭' }))

    await user.click(screen.getByRole('button', { name: '记欠' }))
    expect(screen.getByRole('textbox', { name: '实收金额' })).toHaveValue('0.00')
    await user.click(screen.getByRole('button', { name: '确认结算' }))
    expect(await screen.findByRole('dialog', { name: '是否需要开具发票？' }))
      .toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      supplementaryTrafficRecords: [{
        status: 'settled',
        settlementId: expect.stringMatching(/^JS-\d{8}-000001$/u),
      }],
      settlements: [{
        tender: 'credit',
        amountDueCents: 1500,
        amountReceivedCents: 0,
      }],
    })
  })

  it('shows an electronic-commerce account and settles it through the common cashier', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.acceptElectronicCommerce({
      acceptedAt: '2026-08-10T10:20:00.000Z',
      projectId: 'water',
      providerId: 'lanjing-water',
      accountNumber: '856461',
      amountCents: 6000,
    })
    const user = userEvent.setup()
    render(
      <SettlementWorkspace
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    expect(await screen.findByText('DS-20260810-000001')).toBeInTheDocument()
    expect(screen.getByText('生活缴费')).toBeInTheDocument()
    expect(screen.getByText(/澜京清流服务站 · 水费/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '详情' }))
    const detail = screen.getByRole('dialog', {
      name: '业务详情 DS-20260810-000001',
    })
    expect(within(detail).getByText('周清禾')).toBeInTheDocument()
    expect(within(detail).getAllByText('¥ 60.00')).toHaveLength(2)
    await user.click(within(detail).getByRole('button', { name: '关闭' }))
    await user.click(screen.getByRole('button', { name: '确认结算' }))
    expect(await screen.findByRole('dialog', { name: '是否需要开具发票？' }))
      .toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      electronicCommerceRecords: [{
        status: 'settled',
        settlementId: expect.stringMatching(/^JS-\d{8}-000001$/u),
      }],
      settlements: [{ tender: 'cash', amountDueCents: 6000 }],
    })
  })

  it('separates cash and credit records when the pending batch is mixed', async () => {
    const repository = MemoryServiceRepository.create()
    const sender = {
      ...createEmptySender(),
      agreementAccountId: '99001000000001',
      agreementAccountName: '澜京长风文书服务中心',
    }
    await repository.acceptSupplementaryTraffic({
      kind: 'supplementary-income',
      acceptedAt: '2026-08-10T10:00:00.000Z',
      sender,
      subjectCode: '1YWBL01047',
      count: 1,
      amountCents: 125,
      paymentMethod: 'cash-settlement',
    })
    await repository.acceptSupplementaryTraffic({
      kind: 'traffic-bulk-mail',
      acceptedAt: '2026-08-10T10:01:00.000Z',
      sender,
      mailNumber: '1115206600001',
    })
    const user = userEvent.setup()
    render(
      <SettlementWorkspace
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    const cashRecord = await screen.findByRole('checkbox', {
      name: '选择 BL-20260810-000001',
    })
    const creditRecord = screen.getByRole('checkbox', {
      name: '选择 JG-20260810-000002',
    })
    expect(cashRecord).toBeChecked()
    expect(cashRecord).toBeEnabled()
    expect(creditRecord).not.toBeChecked()
    expect(creditRecord).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '记欠' }))
    expect(cashRecord).not.toBeChecked()
    expect(cashRecord).toBeDisabled()
    expect(creditRecord).toBeChecked()
    expect(creditRecord).toBeEnabled()
    expect(screen.getByRole('textbox', { name: '实收金额' })).toHaveValue('0.00')
  })
})
