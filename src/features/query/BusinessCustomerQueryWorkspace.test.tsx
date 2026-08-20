import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MemoryCustomerRepository } from '../../infrastructure/memory/MemoryCustomerRepository'
import { BusinessCustomerQueryWorkspace } from './BusinessCustomerQueryWorkspace'

describe('BusinessCustomerQueryWorkspace', () => {
  it('按本地演练规则只用手机号或证件号查询并展示脱敏客户画像', async () => {
    const user = userEvent.setup()
    render(<BusinessCustomerQueryWorkspace
      clock={() => new Date('2026-08-19T04:00:00Z')}
      onBack={vi.fn()}
      repository={MemoryCustomerRepository.create()}
    />)

    const conditions = await screen.findByRole('region', { name: '营业客户查询条件' })
    await user.type(within(conditions).getByRole('textbox', { name: '手机号' }), '10000000016')
    await user.click(within(conditions).getByRole('button', { name: '查询' }))

    const result = screen.getByRole('region', { name: '营业客户查询结果' })
    expect(within(result).getByLabelText('营业客户姓名')).toHaveValue('林澄')
    expect(within(result).getByLabelText('营业客户性别')).toHaveValue('男')
    expect(within(result).getByLabelText('营业客户年龄')).toHaveValue('31')
    expect(within(result).getByLabelText('营业客户生日')).toHaveValue('1995-07-23')
    expect(within(result).getByLabelText('营业客户手机号')).toHaveValue('100****0016')
    expect(within(result).queryByLabelText('营业客户证件号')).not.toBeInTheDocument()
    expect(within(result).getByLabelText('营业客户保险客户标志')).toHaveValue('—')
    expect(result).toHaveTextContent('上级 CRM、保险、证券和消费画像未接入')
  })

  it('支持按完整证件号查询同一客户', async () => {
    const user = userEvent.setup()
    render(<BusinessCustomerQueryWorkspace
      onBack={vi.fn()}
      repository={MemoryCustomerRepository.create()}
    />)

    const conditions = await screen.findByRole('region', { name: '营业客户查询条件' })
    await user.type(
      within(conditions).getByRole('textbox', { name: '证件号' }),
      '990101198805120024',
    )
    await user.click(within(conditions).getByRole('button', { name: '查询' }))

    expect(screen.getByRole('region', { name: '营业客户查询结果' }))
      .toHaveTextContent('周安')
  })

  it('拒绝空查询并明确展示无匹配结果', async () => {
    const user = userEvent.setup()
    render(<BusinessCustomerQueryWorkspace
      onBack={vi.fn()}
      repository={MemoryCustomerRepository.create()}
    />)

    const conditions = await screen.findByRole('region', { name: '营业客户查询条件' })
    await user.click(within(conditions).getByRole('button', { name: '查询' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入手机号或证件号')

    await user.type(within(conditions).getByRole('textbox', { name: '手机号' }), '10000000028')
    await user.click(within(conditions).getByRole('button', { name: '查询' }))
    expect(screen.getByRole('status')).toHaveTextContent('未查询到符合条件的营业客户记录')
  })

  it('客户存储读取失败时闭锁结果并允许显式重试', async () => {
    const user = userEvent.setup()
    const repository = MemoryCustomerRepository.create()
    const originalLoad = repository.load.bind(repository)
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('IndexedDB unavailable'))
      .mockImplementation(originalLoad)
    repository.load = load

    render(<BusinessCustomerQueryWorkspace onBack={vi.fn()} repository={repository} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('IndexedDB unavailable')
    expect(screen.queryByRole('region', { name: '营业客户查询条件' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByRole('region', { name: '营业客户查询条件' })).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
