import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createEmptySender } from '../../domain/customer/seed'
import {
  DEMO_MANAGEMENT_OPERATOR_ID as DEMO_SUPERVISOR_ID,
  DEMO_MANAGEMENT_SECRET as DEMO_SUPERVISOR_SECRET,
} from '../../domain/access/seed'
import { createTestOnSiteAuthorizer } from '../../test/workAuthorization'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { PostalSupplyCorrectionWorkspace } from './PostalSupplyCorrectionWorkspace'
import { SupplementaryTrafficCorrectionWorkspace } from './SupplementaryTrafficCorrectionWorkspace'

const sender = {
  ...createEmptySender(),
  name: '林澜',
  contact: '10000000016',
  agreementAccountId: '99001000000001',
  agreementAccountName: '澜京长风文书服务中心',
}

describe('counter correction workspaces', () => {
  it('queries, revises, prints and deletes a postal-supply sale', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.acceptPostalSupplySale({
      acceptedAt: '2026-01-15T09:25:00.000Z',
      sender,
      lines: [{ itemId: 'supply-standard-envelope', quantity: 2 }],
    })
    const user = userEvent.setup()
    render(
      <PostalSupplyCorrectionWorkspace
        authorizeOnSite={createTestOnSiteAuthorizer()}
        now={() => new Date('2026-01-15T12:10:00.000Z')}
        onBack={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    expect(await screen.findByRole('button', { name: '用邮物品查改' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(screen.getByRole('cell', { name: 'YP-20260115-000001' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '修改' }))
    const editDialog = screen.getByRole('dialog', { name: '修改 YP-20260115-000001' })
    const quantity = within(editDialog).getByRole('spinbutton', { name: '修改数量 演示标准信封' })
    await user.clear(quantity)
    await user.type(quantity, '3')
    await user.type(within(editDialog).getByRole('textbox', { name: '用邮物品修改原因' }), '更正窗口录入数量')
    await user.click(within(editDialog).getByRole('button', { name: '保存修改' }))
    expect(await screen.findByText(/原值已写入审计记录/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打印' }))
    const receipt = await screen.findByRole('dialog', { name: '用邮物品销售小票' })
    expect(within(receipt).getByText('6.00 元')).toBeInTheDocument()
    await user.click(within(receipt).getByRole('button', { name: '关闭' }))

    await user.click(screen.getByRole('checkbox', { name: /选择用邮物品记录 YP-20260115-000001/ }))
    await user.click(screen.getByRole('button', { name: '删除' }))
    const supervisor = screen.getByRole('dialog', { name: '主管授权删除' })
    await user.type(within(supervisor).getByRole('textbox', { name: '用邮物品删除原因' }), '客户取消购买')
    expect(within(supervisor).getByLabelText('用邮物品主管工号')).toHaveValue('')
    await user.type(within(supervisor).getByLabelText('用邮物品主管工号'), DEMO_SUPERVISOR_ID)
    await user.type(within(supervisor).getByLabelText('用邮物品主管密码'), DEMO_SUPERVISOR_SECRET)
    await user.click(within(supervisor).getByRole('button', { name: '授权并删除' }))
    expect(await screen.findByText(/已释放库存/)).toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      postalSupplySales: [{
        status: 'deleted',
        totalCents: 600,
        revisions: [{ previousTotalCents: 400, nextTotalCents: 600 }],
      }],
    })
  })

  it('deletes and re-enters a same-day supplement while retaining the original', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.acceptSupplementaryTraffic({
      kind: 'supplementary-income',
      acceptedAt: '2026-08-10T10:00:00.000Z',
      sender,
      subjectCode: '1YWBL01047',
      count: 1,
      amountCents: 1250,
      paymentMethod: 'credit',
    })
    const user = userEvent.setup()
    render(
      <SupplementaryTrafficCorrectionWorkspace
        authorizeOnSite={createTestOnSiteAuthorizer()}
        now={() => new Date('2026-08-10T12:30:00.000Z')}
        onBack={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={repository}
      />,
    )

    expect(await screen.findByRole('button', { name: '补录/交管查改' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(screen.getByRole('cell', { name: 'BL-20260810-000001' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '调账重录' }))
    const dialog = screen.getByRole('dialog', { name: '调账重录 BL-20260810-000001' })
    const amount = within(dialog).getByRole('textbox', { name: '查改补录金额' })
    await user.clear(amount)
    await user.type(amount, '18.00')
    await user.type(within(dialog).getByRole('textbox', { name: '补录调账原因' }), '核对后更正金额')
    await user.click(within(dialog).getByRole('button', { name: '调账并重录' }))

    expect(await screen.findByText(/原记录 BL-20260810-000001 已删除/)).toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      supplementaryTrafficRecords: [
        {
          id: 'BL-20260810-000001',
          status: 'deleted',
          replacementRecordId: 'BL-20260810-000002',
        },
        {
          id: 'BL-20260810-000002',
          status: 'pending-settlement',
          amountCents: 1800,
          replacesRecordId: 'BL-20260810-000001',
        },
      ],
    })
  })
})
