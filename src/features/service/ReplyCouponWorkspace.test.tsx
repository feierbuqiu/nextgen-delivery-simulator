import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { ReplyCouponWorkspace } from './ReplyCouponWorkspace'

const operator = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '长风支局',
  receivingOffice: '虚构寄达局',
}

describe('ReplyCouponWorkspace', () => {
  it('completes an over-limit redemption and reprints its masked receipt from query', async () => {
    const user = userEvent.setup()
    render(
      <ReplyCouponWorkspace
        onBack={() => undefined}
        operator={operator}
        repository={MemoryServiceRepository.create()}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '增加' }))
    const picker = screen.getByRole('dialog', { name: '商品选择' })
    expect(within(picker).queryByText('演示国际回信券')).not.toBeInTheDocument()
    await user.click(within(picker).getByRole('checkbox', {
      name: '选择商品 练习邮票6.00元',
    }))
    await user.click(within(picker).getByRole('button', { name: '添加' }))

    await user.click(screen.getByRole('button', {
      name: '增加练习邮票6.00元数量',
    }))
    expect(screen.getByText('应收：¥ 5.00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText(/保存成功，查询流水号：HXQ-/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '>>>>结算中心' }))
    const settlement = screen.getByRole('dialog', { name: '国际回信券兑付结算' })
    expect(within(settlement).getByText('-¥ 7.00')).toBeInTheDocument()
    await user.click(within(settlement).getByRole('button', { name: '第三方支付' }))
    await user.type(within(settlement).getByRole('textbox', { name: '兑付付款码' }), 'A123456789')
    await user.click(within(settlement).getByRole('button', { name: '确认结算' }))

    const receipt = await screen.findByRole('dialog', { name: '国际回信券兑付凭据' })
    expect(within(receipt).getByText('第三方支付 / 第三方平台甲')).toBeInTheDocument()
    expect(within(receipt).getByText('******6789')).toBeInTheDocument()
    await user.click(within(receipt).getByRole('button', { name: '关闭' }))

    await user.click(screen.getByRole('tab', { name: '兑付查改' }))
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(screen.getByRole('cell', { name: '已结算' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '凭据打印' }))
    expect(await screen.findByRole('dialog', {
      name: '国际回信券兑付凭据',
    })).toBeInTheDocument()
  })

  it('offers direct settlement when goods do not exceed the coupon value', async () => {
    const user = userEvent.setup()
    render(
      <ReplyCouponWorkspace
        onBack={() => undefined}
        operator={operator}
        repository={MemoryServiceRepository.create()}
      />,
    )
    await user.click(await screen.findByRole('button', { name: '增加' }))
    const picker = screen.getByRole('dialog', { name: '商品选择' })
    await user.click(within(picker).getByRole('checkbox', {
      name: '选择商品 练习邮票6.00元',
    }))
    await user.click(within(picker).getByRole('button', { name: '添加' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await user.click(await screen.findByRole('button', { name: '>>>>结算中心' }))
    const settlement = screen.getByRole('dialog', { name: '国际回信券兑付结算' })
    expect(within(settlement).getByText('无现金金额是否直接结算？')).toBeInTheDocument()
    expect(within(settlement).queryByRole('button', { name: '记欠' })).not.toBeInTheDocument()
    await user.click(within(settlement).getByRole('button', { name: '确认结算' }))
    expect(await screen.findByRole('dialog', {
      name: '国际回信券兑付凭据',
    })).toBeInTheDocument()
  })
})
