import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FICTIONAL_ADDRESSES } from '../../domain/customer/seed'
import { MemoryCustomerRepository } from '../../infrastructure/memory/MemoryCustomerRepository'
import { RecommendationWorkspace } from './RecommendationWorkspace'

describe('RecommendationWorkspace', () => {
  it('searches by the Chapter 3 fields and transfers the selected product', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const nonlocalAddress = FICTIONAL_ADDRESSES.find(
      (address) => address.mode === 'domestic' && address.zone === 'nonlocal',
    )!
    render(
      <RecommendationWorkspace
        onBack={() => undefined}
        onSelect={onSelect}
        repository={MemoryCustomerRepository.create()}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: '客户信息采集' })
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    await user.type(screen.getByRole('spinbutton', { name: '推荐邮件重量' }), '300')
    await user.selectOptions(
      screen.getByRole('combobox', { name: '推荐寄达局' }),
      `address:${nonlocalAddress.id}`,
    )
    await user.click(screen.getByRole('button', { name: /查询/ }))

    expect(screen.getByText('100100')).toBeInTheDocument()
    expect(screen.getByText('110100')).toBeInTheDocument()
    expect(screen.getByText('200100')).toBeInTheDocument()
    const ordinaryLetterRow = screen.getByText('100100').closest('tr')!
    expect(within(ordinaryLetterRow).getAllByText('10.00')).toHaveLength(2)
    await user.click(within(ordinaryLetterRow).getByRole('button', { name: /选择/ }))

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'ordinary-letter-100',
      productFamily: 'basic-letter',
      destinationZone: 'nonlocal',
      weightGrams: 300,
    }))
  })

  it('captures customer information before recommendation search', async () => {
    const user = userEvent.setup()
    const repository = MemoryCustomerRepository.create()
    const address = FICTIONAL_ADDRESSES.find((candidate) => candidate.mode === 'domestic')!
    render(
      <RecommendationWorkspace
        onBack={() => undefined}
        onSelect={() => undefined}
        repository={repository}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: '客户信息采集' })
    await user.type(within(dialog).getByRole('textbox', { name: '推荐客户联系电话' }), '10000000023')
    await user.type(within(dialog).getByRole('textbox', { name: '推荐客户姓名' }), '苏禾')
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: '推荐客户地址点选' }),
      address.id,
    )
    await user.click(within(dialog).getByRole('button', { name: '确定' }))

    expect(await screen.findByText('苏禾')).toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      draft: {
        status: 'sender-ready',
        sender: { name: '苏禾', contact: '10000000023' },
      },
    })
  })

  it('loads the reference customer fields from a selected agreement account', async () => {
    const user = userEvent.setup()
    const repository = MemoryCustomerRepository.create()
    const account = (await repository.load()).agreementAccounts[0]!
    render(
      <RecommendationWorkspace
        onBack={() => undefined}
        onSelect={() => undefined}
        repository={repository}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: '客户信息采集' })
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: '推荐协议客户编号' }),
      account.id,
    )

    expect(within(dialog).getByRole('textbox', { name: '推荐协议客户名称' }))
      .toHaveValue(account.name)
    expect(within(dialog).getByRole('textbox', { name: '推荐客户联系电话' }))
      .toHaveValue(account.contact)
    expect(within(dialog).getByRole('combobox', { name: '推荐客户证件类型' }))
      .toHaveValue(account.identityType)
    expect(within(dialog).getByRole('textbox', { name: '推荐客户证件号码' }))
      .toHaveValue(account.identityValue)
    expect(within(dialog).getByRole('button', { name: '刷联名卡' })).toBeDisabled()
    expect(within(dialog).getByText(/实体联名卡设备未接入/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '确定' }))
    await expect(repository.load()).resolves.toMatchObject({
      draft: {
        sender: {
          agreementAccountId: account.id,
          agreementAccountName: account.name,
          identityValue: account.identityValue,
        },
      },
    })
  })

  it('keeps customer collection open when saving fails', async () => {
    const user = userEvent.setup()
    const repository = MemoryCustomerRepository.create()
    const account = (await repository.load()).agreementAccounts[0]!
    repository.saveDraft = vi.fn().mockRejectedValue(new Error('IndexedDB write failed'))

    render(
      <RecommendationWorkspace
        onBack={() => undefined}
        onSelect={() => undefined}
        repository={repository}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: '客户信息采集' })
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: '推荐协议客户编号' }),
      account.id,
    )
    await user.click(within(dialog).getByRole('button', { name: '确定' }))

    expect(await within(dialog).findByRole('alert'))
      .toHaveTextContent('客户资料保存失败：IndexedDB write failed')
    expect(dialog).toBeInTheDocument()
  })

  it('fail-stops when customer storage cannot be read and retries explicitly', async () => {
    const user = userEvent.setup()
    const repository = MemoryCustomerRepository.create()
    const originalLoad = repository.load.bind(repository)
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('IndexedDB unavailable'))
      .mockImplementation(originalLoad)
    repository.load = load

    render(
      <RecommendationWorkspace
        onBack={() => undefined}
        onSelect={() => undefined}
        repository={repository}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('IndexedDB unavailable')
    expect(screen.queryByRole('dialog', { name: '客户信息采集' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByRole('dialog', { name: '客户信息采集' })).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
