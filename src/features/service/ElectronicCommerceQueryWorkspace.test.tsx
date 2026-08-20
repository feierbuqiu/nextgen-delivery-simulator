import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { ElectronicCommerceQueryWorkspace } from './ElectronicCommerceQueryWorkspace'

describe('ElectronicCommerceQueryWorkspace', () => {
  it('filters electronic-commerce records and opens read-only customer details', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.acceptElectronicCommerce({
      acceptedAt: '2026-08-10T10:20:00.000Z',
      projectId: 'mobile',
      providerId: 'lanjing-mobile',
      accountNumber: '10000000038',
      amountCents: 1000,
    })
    const onOpenAcceptanceQuery = vi.fn()
    const onOpenChannelProductQuery = vi.fn()
    const user = userEvent.setup()
    render(
      <ElectronicCommerceQueryWorkspace
        onBack={() => undefined}
        onOpenAcceptanceQuery={onOpenAcceptanceQuery}
        onOpenChannelProductQuery={onOpenChannelProductQuery}
        onSummaryChange={() => undefined}
        repository={repository}
      />,
    )

    expect(await screen.findByRole('button', { name: '电子商务查改' })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '电子商务查改项目' }), 'mobile')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByRole('cell', { name: 'DS-20260810-000001' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '100****0038' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '客户详情' }))
    const detail = screen.getByRole('dialog', { name: '客户详情' })
    expect(within(detail).getByText('10000000038')).toBeInTheDocument()
    expect(within(detail).getByText('林屿')).toBeInTheDocument()
    await user.click(within(detail).getByRole('button', { name: '关闭' }))
    await user.click(screen.getByRole('button', { name: '收寄查改' }))
    expect(onOpenAcceptanceQuery).toHaveBeenCalledOnce()
  })
})
