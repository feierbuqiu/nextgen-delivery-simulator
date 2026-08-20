import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createEmptySender } from '../../domain/customer/seed'
import {
  DEMO_MANAGEMENT_OPERATOR_ID as DEMO_SUPERVISOR_ID,
  DEMO_MANAGEMENT_SECRET as DEMO_SUPERVISOR_SECRET,
} from '../../domain/access/seed'
import { DEFAULT_SERVICE_OPERATOR } from '../../domain/service/transactions'
import { createTestOnSiteAuthorizer } from '../../test/workAuthorization'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { ChannelProductQueryWorkspace } from './ChannelProductQueryWorkspace'

describe('ChannelProductQueryWorkspace', () => {
  it('queries details, records a receipt preview, and supervisor-deletes a same-day unpaid order', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.acceptChannelProductOrder({
      submittedAt: '2026-08-04T11:00:00.000Z',
      buyer: {
        ...createEmptySender(),
        name: '林澄',
        contact: '10000000016',
      },
      lines: [{ productId: 'channel-cloud-grain-box', skuCode: 'YG-06', quantity: 2 }],
      allocations: [],
    })
    const onOpenAcceptanceQuery = vi.fn()
    const onSummaryChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ChannelProductQueryWorkspace
        authorizeOnSite={createTestOnSiteAuthorizer()}
        onBack={() => undefined}
        onOpenAcceptanceQuery={onOpenAcceptanceQuery}
        onSummaryChange={onSummaryChange}
        operator={DEFAULT_SERVICE_OPERATOR}
        repository={repository}
      />,
    )

    expect(await screen.findByRole('region', { name: '商品销售查改查询条件' }))
      .toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查找' }))
    expect(await screen.findByRole('cell', { name: 'XS-20260804-000001' }))
      .toBeInTheDocument()
    expect(screen.getByText('总件数').parentElement).toHaveTextContent('1')
    expect(screen.getByText('总金额').parentElement).toHaveTextContent('136.00')

    await user.click(screen.getByRole('button', { name: '详情' }))
    const detail = screen.getByRole('dialog', { name: '商品销售详情' })
    expect(within(detail).getByText('林澄')).toBeInTheDocument()
    expect(within(detail).getByText('六袋装（YG-06）')).toBeInTheDocument()
    await user.click(within(detail).getByRole('button', { name: '关闭' }))

    await user.click(screen.getByRole('button', { name: '打印' }))
    const confirmation = screen.getByRole('dialog', { name: '信息' })
    expect(within(confirmation).getByText('是否打印小票')).toBeInTheDocument()
    await user.click(within(confirmation).getByRole('button', { name: '确定' }))
    const receipt = await screen.findByRole('dialog', { name: '商品销售小票' })
    expect(within(receipt).getByText('寄递商品')).toBeInTheDocument()
    expect(within(receipt).getByText('云谷杂粮礼盒 六袋装')).toBeInTheDocument()
    await user.click(within(receipt).getByRole('button', { name: '关闭' }))
    await expect(repository.load()).resolves.toMatchObject({
      channelProductOrders: [{ receiptPrintedAt: ['2026-08-04T12:00:00.000Z'] }],
    })

    await user.click(screen.getByRole('checkbox', { name: '选择商品销售记录 XS-20260804-000001' }))
    await user.click(screen.getByRole('button', { name: '删除' }))
    const authorization = screen.getByRole('dialog', { name: '请输入主管工号和密码' })
    expect(within(authorization).getByLabelText('商品销售主管工号')).toHaveValue('')
    await user.type(within(authorization).getByLabelText('商品销售主管工号'), DEMO_SUPERVISOR_ID)
    await user.type(
      within(authorization).getByLabelText('商品销售主管密码'),
      DEMO_SUPERVISOR_SECRET,
    )
    await user.click(within(authorization).getByRole('button', { name: '授权并删除' }))
    expect(await screen.findByText('无数据')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('删除成功，1 笔当天未缴款记录已完成主管授权')
    await expect(repository.load()).resolves.toMatchObject({
      channelProductOrders: [{
        status: 'deleted',
        deletedBy: '90000001',
      }],
    })
    expect(onSummaryChange).toHaveBeenLastCalledWith({ count: 0, totalCents: 0 })
  })

  it('switches back to the acceptance-query tab', async () => {
    const onOpenAcceptanceQuery = vi.fn()
    const user = userEvent.setup()
    render(
      <ChannelProductQueryWorkspace
        authorizeOnSite={createTestOnSiteAuthorizer()}
        onBack={() => undefined}
        onOpenAcceptanceQuery={onOpenAcceptanceQuery}
        onSummaryChange={() => undefined}
        operator={DEFAULT_SERVICE_OPERATOR}
        repository={MemoryServiceRepository.create()}
      />,
    )
    await user.click(await screen.findByRole('button', { name: '收寄查改' }))
    expect(onOpenAcceptanceQuery).toHaveBeenCalledOnce()
  })
})
