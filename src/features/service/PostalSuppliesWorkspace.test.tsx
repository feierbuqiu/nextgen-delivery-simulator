import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import type { CustomerDraft } from '../../domain/customer/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { PostalSuppliesWorkspace } from './PostalSuppliesWorkspace'

const customerDraft: CustomerDraft = {
  productFamily: 'basic-letter',
  destinationRegion: 'domestic',
  sender: { ...createEmptySender(), name: '演示顾客' },
  recipient: createEmptyRecipient(),
  status: 'sender-ready',
  updatedAt: '2026-01-15T09:00:00.000Z',
}

describe('PostalSuppliesWorkspace', () => {
  it('selects an item through the category dialog and saves a sale', async () => {
    const repository = MemoryServiceRepository.create()
    const onSummaryChange = vi.fn()
    const user = userEvent.setup()
    render(
      <PostalSuppliesWorkspace
        customerDraft={customerDraft}
        onOpenSettlement={vi.fn()}
        onSummaryChange={onSummaryChange}
        repository={repository}
      />,
    )

    await screen.findByRole('region', { name: '用邮物品销售' })
    await user.click(screen.getByRole('button', { name: '增加' }))
    const picker = await screen.findByRole('dialog', { name: '物品名称检索' })
    await user.selectOptions(
      within(picker).getByRole('combobox', { name: '用邮物品一级类别' }),
      '邮务用品',
    )
    await user.click(within(picker).getByRole('checkbox', {
      name: '选择物品 演示标准信封',
    }))
    await user.click(within(picker).getByRole('button', { name: '添加' }))

    const quantity = screen.getByRole('spinbutton', {
      name: '销售数量 演示标准信封',
    })
    await user.click(quantity)
    await user.keyboard('{Control>}a{/Control}2')
    expect(screen.getAllByText('¥ 4.00')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText(/^YP-\d{8}-000001$/)).toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      nextPostalSupplySequence: 2,
      postalSupplySales: [{
        id: expect.stringMatching(/^YP-\d{8}-000001$/),
        status: 'pending-settlement',
        totalCents: 400,
        lines: [{ itemId: 'supply-standard-envelope', quantity: 2 }],
      }],
    })
    expect(onSummaryChange).toHaveBeenLastCalledWith({ count: 1, totalCents: 400 })
  })
})
