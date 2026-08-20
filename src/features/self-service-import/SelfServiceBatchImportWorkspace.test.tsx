import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_SERVICE_OPERATOR } from '../../domain/service/transactions'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { SelfServiceBatchImportWorkspace } from './SelfServiceBatchImportWorkspace'

describe('SelfServiceBatchImportWorkspace', () => {
  it('queries, imports, reviews, and directly settles an upstream reservation', async () => {
    const user = userEvent.setup()
    const repository = MemoryServiceRepository.create()
    render(
      <SelfServiceBatchImportWorkspace
        onBack={vi.fn()}
        onSummaryChange={vi.fn()}
        operator={DEFAULT_SERVICE_OPERATOR}
        serviceRepository={repository}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '导入' }))
    const importDialog = await screen.findByRole('dialog', { name: '批量导入' })
    const importButton = within(importDialog).getByRole('button', { name: '导入' })
    expect(importButton).toBeDisabled()
    await user.type(
      within(importDialog).getByRole('textbox', { name: '导入预约单号' }),
      '88202608040000001',
    )
    await user.click(within(importDialog).getByRole('button', { name: '查询' }))
    expect(await within(importDialog).findByText('CP00000010001')).toBeInTheDocument()
    expect(within(importDialog).getAllByText('普通包裹（300）')).toHaveLength(5)
    expect(importButton).toBeEnabled()
    await user.click(importButton)

    const successDialog = await screen.findByRole('dialog', { name: '邮件详情列表' })
    expect(within(successDialog).getByText('100%')).toBeInTheDocument()
    expect(within(successDialog).getByText('CP00000010005')).toBeInTheDocument()
    await user.click(within(successDialog).getByRole('button', { name: '取消' }))

    expect(await screen.findByText(/导入完成/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '处理详情' }))
    const processingDialog = await screen.findByRole('dialog', { name: '导入处理提示' })
    expect(within(processingDialog).getByText('34.00')).toBeInTheDocument()
    await user.click(within(processingDialog).getByRole('button', { name: '结算中心' }))

    const settlementDialog = await screen.findByRole('dialog', { name: '结算中心' })
    expect(within(settlementDialog).getByText('记欠')).toBeInTheDocument()
    expect(within(settlementDialog).getByText('¥ 0.00')).toBeInTheDocument()
    await user.click(within(settlementDialog).getByRole('button', { name: '结算' }))
    expect(within(settlementDialog).getByText('无现结金额，是否直接结算？')).toBeInTheDocument()
    await user.click(within(settlementDialog).getByRole('button', { name: '确定' }))

    expect(await screen.findByText(/已完成记欠结算/)).toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      selfServiceImports: [{
        totalCount: 5,
        totalSuccessfulAmountCents: 3400,
        settlementId: expect.any(String),
      }],
      transactions: Array.from({ length: 5 }, () => ({ status: 'settled' })),
      settlements: [{
        tender: 'credit',
        amountDueCents: 3400,
        amountReceivedCents: 0,
      }],
    })
  })
})
