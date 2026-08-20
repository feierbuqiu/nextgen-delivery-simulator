import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { ElectronicCommerceWorkspace } from './ElectronicCommerceWorkspace'

describe('ElectronicCommerceWorkspace', () => {
  it('runs utility payment and phone top-up through non-reversible confirmation', async () => {
    const repository = MemoryServiceRepository.create()
    const onSummaryChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ElectronicCommerceWorkspace
        onOpenSettlement={() => undefined}
        onSummaryChange={onSummaryChange}
        repository={repository}
      />,
    )

    expect(await screen.findByRole('region', { name: '电子商务' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '缴费账户' }), '856461')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByText('周清禾')).toBeInTheDocument()
    expect(screen.getByText('60.00 元')).toBeInTheDocument()

    const utilityAmount = screen.getByRole('textbox', { name: '缴费金额' })
    await user.clear(utilityAmount)
    await user.type(utilityAmount, '10.00')
    await user.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('缴费金额必须与应缴总额一致。')
    await user.clear(utilityAmount)
    await user.type(utilityAmount, '60.00')
    await user.click(screen.getByRole('button', { name: '提交' }))
    const utilityConfirm = screen.getByRole('dialog', { name: '确认信息' })
    expect(within(utilityConfirm).getByText('业务不支持撤销，请核准缴费号码，是否提交？')).toBeInTheDocument()
    await user.click(within(utilityConfirm).getByRole('button', { name: '确定' }))
    expect(await screen.findByText(/业务录入成功：DS-20260810-000001/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '话费充值' }))
    await user.type(screen.getByRole('textbox', { name: '手机号码' }), '10000000038')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByText('37.64 元')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '充值金额' }), '10.00')
    await user.click(screen.getByRole('button', { name: '提交' }))
    const topupConfirm = screen.getByRole('dialog', { name: '确认信息' })
    await user.click(within(topupConfirm).getByRole('button', { name: '确定' }))
    expect(await screen.findByText(/业务录入成功：DS-20260810-000002/)).toBeInTheDocument()

    await expect(repository.load()).resolves.toMatchObject({
      schemaVersion: 38,
      nextElectronicCommerceSequence: 3,
      electronicCommerceRecords: [
        { kind: 'utility-payment', amountCents: 6000 },
        { kind: 'phone-topup', amountCents: 1000 },
      ],
    })
    expect(onSummaryChange).toHaveBeenLastCalledWith({ count: 2, totalCents: 7000 })
  })
})
