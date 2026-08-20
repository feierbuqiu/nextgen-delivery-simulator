import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import { DEFAULT_SERVICE_OPERATOR } from '../../domain/service/transactions'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { ReturnReceiptWorkspace } from './ReturnReceiptWorkspace'

describe('ReturnReceiptWorkspace', () => {
  it('registers a received receipt and its registered return item', async () => {
    const repository = MemoryServiceRepository.create()
    const product = SERVICE_PRODUCTS.find((item) => item.id === 'registered-letter-200')!
    const draft = {
      ...createEmptyServiceDraft(false, 'local'),
      productId: product.id,
      itemCode: 'XK00000000001',
      weightGrams: 20,
      returnReceiptRequested: true,
    }
    const accepted = await repository.accept({
      acceptedAt: '2026-08-03T01:00:00.000Z',
      charge: calculateServiceCharge(draft, product),
      customer: {
        productFamily: 'standard-delivery',
        destinationRegion: 'domestic',
        sender: { ...createEmptySender(), name: '练习寄件人' },
        recipient: { ...createEmptyRecipient(), name: '练习收件人' },
      },
      draft,
      product,
      operator: DEFAULT_SERVICE_OPERATOR,
    })
    await repository.settle({
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: '2026-08-03T01:05:00.000Z',
      amountReceivedCents: 700,
    })
    const user = userEvent.setup()

    render(
      <ReturnReceiptWorkspace
        onBack={vi.fn()}
        operator={DEFAULT_SERVICE_OPERATOR}
        repository={repository}
      />,
    )

    expect(await screen.findByText('XK00000000001')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '回执收到' }))
    const arrival = screen.getByRole('dialog', { name: '回执收到登记' })
    fireEvent.change(within(arrival).getByLabelText('邮件妥投日期'), {
      target: { value: '2026-08-03T12:10' },
    })
    fireEvent.change(within(arrival).getByLabelText('回执收到日期'), {
      target: { value: '2026-08-03T12:20' },
    })
    await user.type(within(arrival).getByRole('textbox', { name: '回执签收人' }), '签收人甲')
    await user.click(within(arrival).getByRole('button', { name: '确认收到' }))

    expect(await screen.findByText(/已登记收到/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '办理寄回' }))
    const dispatch = screen.getByRole('dialog', { name: '回执挂号寄回' })
    fireEvent.change(within(dispatch).getByLabelText('回执寄回日期'), {
      target: { value: '2026-08-03T12:30' },
    })
    await user.type(
      within(dispatch).getByRole('textbox', { name: '回执寄回邮件号码' }),
      'XK00000000002',
    )
    await user.click(within(dispatch).getByRole('button', { name: '确认寄回' }))

    expect(await screen.findByText(/已按 XK00000000002 寄回/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /查看回执 .* 详情/ }))
    const detail = screen.getByRole('dialog', { name: '回执流程详情' })
    expect(within(detail).getByText('签收人甲')).toBeInTheDocument()
    expect(within(detail).getByText('XK00000000002')).toBeInTheDocument()
    expect(within(detail).getByText('2026-08-03 12:10')).toBeInTheDocument()
    expect(within(detail).getByText('2026-08-03 12:20')).toBeInTheDocument()
    expect(within(detail).getByText('2026-08-03 12:30')).toBeInTheDocument()
    expect(within(detail).getAllByText(
      new RegExp(DEFAULT_SERVICE_OPERATOR.displayName),
    )).toHaveLength(2)
    await user.click(within(detail).getByRole('button', { name: '关闭' }))
    await expect(repository.load()).resolves.toMatchObject({
      returnReceipts: [{
        status: 'returned',
        recipientSigner: '签收人甲',
        returnItemCode: 'XK00000000002',
        deliveredAt: expect.stringMatching(/Z$/u),
        receivedAt: expect.stringMatching(/Z$/u),
        returnedAt: expect.stringMatching(/Z$/u),
      }],
    })
  })
})
