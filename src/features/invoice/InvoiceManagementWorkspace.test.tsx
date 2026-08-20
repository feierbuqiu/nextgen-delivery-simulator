import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import {
  DEMO_MANAGEMENT_OPERATOR_ID as DEMO_SUPERVISOR_ID,
  DEMO_MANAGEMENT_SECRET as DEMO_SUPERVISOR_SECRET,
} from '../../domain/access/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import { DEFAULT_SERVICE_OPERATOR } from '../../domain/service/transactions'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { createTestOnSiteAuthorizer } from '../../test/workAuthorization'
import { InvoiceManagementWorkspace } from './InvoiceManagementWorkspace'

async function repositoryWithInvoice(): Promise<MemoryServiceRepository> {
  const repository = MemoryServiceRepository.create()
  const product = SERVICE_PRODUCTS[0]!
  const draft = {
    ...createEmptyServiceDraft(false),
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
      sender: { ...createEmptySender(), name: '周清禾', unit: '星河合作社' },
      recipient: createEmptyRecipient(),
    },
    draft,
    product,
  })
  const settled = await repository.settle({
    transactionIds: [accepted.transaction.id],
    tender: 'cash',
    settledAt: '2026-01-15T09:30:00.000Z',
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  await repository.executeInvoiceManagement({
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
      buyerAddress: '瀚原省栖沄市景麓区示范路 1 号',
      bankName: '',
      bankAccount: '',
      reviewer: '演示营业员',
      remark: '',
    },
  })
  return repository
}

describe('InvoiceManagementWorkspace', () => {
  it('queries details and requires supervisor authorization before red flush', async () => {
    const repository = await repositoryWithInvoice()
    const user = userEvent.setup()
    render(
      <InvoiceManagementWorkspace
        authorizeOnSite={createTestOnSiteAuthorizer()}
        onBack={vi.fn()}
        operator={DEFAULT_SERVICE_OPERATOR}
        repository={repository}
        section="financial"
      />,
    )

    await user.clear(await screen.findByLabelText('开票日期起'))
    await user.type(screen.getByLabelText('开票日期起'), '2026-01-15')
    await user.clear(screen.getByLabelText('开票日期止'))
    await user.type(screen.getByLabelText('开票日期止'), '2026-01-15')
    await user.click(await screen.findByRole('button', { name: '查询' }))
    expect(screen.getByRole('cell', { name: 'SIM2601' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '00000001' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '详情' }))
    const detail = screen.getByRole('dialog', { name: 'SIM2601 / 00000001' })
    expect(within(detail).getByText('SIM-20260115-000001')).toBeInTheDocument()
    expect(within(detail).getByText('7000818316568')).toBeInTheDocument()
    await user.click(within(detail).getByRole('button', { name: '关闭' }))

    await user.click(screen.getByRole('button', { name: '冲红' }))
    const authorization = screen.getByRole('dialog', { name: '授权' })
    expect(within(authorization).getByLabelText('发票冲红主管工号')).toHaveValue('')
    await user.type(within(authorization).getByLabelText('发票冲红主管工号'), DEMO_SUPERVISOR_ID)
    await user.type(within(authorization).getByLabelText('发票冲红主管密码'), 'wrong')
    await user.click(within(authorization).getByRole('button', { name: '确认授权' }))
    expect(within(authorization).getByRole('alert')).toHaveTextContent('授权人员密码校验失败')
    await user.clear(within(authorization).getByLabelText('发票冲红主管密码'))
    await user.type(
      within(authorization).getByLabelText('发票冲红主管密码'),
      DEMO_SUPERVISOR_SECRET,
    )
    await user.click(within(authorization).getByRole('button', { name: '确认授权' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已冲红')

    await user.click(screen.getByRole('radio', { name: '已冲红' }))
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(screen.getByRole('cell', { name: 'SIM2601' })).toBeInTheDocument()
    expect((await repository.load()).fiscalInvoices[0]?.status).toBe('red-flushed')
  })

  it('keeps the pre-financial-system entry as a bounded historical route', () => {
    render(
      <InvoiceManagementWorkspace
        authorizeOnSite={createTestOnSiteAuthorizer()}
        onBack={vi.fn()}
        operator={DEFAULT_SERVICE_OPERATOR}
        repository={MemoryServiceRepository.create()}
        section="legacy"
      />,
    )
    expect(screen.getByText(/业财一期上线前开具的历史发票/)).toBeInTheDocument()
  })
})
