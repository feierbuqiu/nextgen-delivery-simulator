import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ServiceOperatorSnapshot } from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { createTestOnSiteAuthorizer } from '../../test/workAuthorization'
import { WindowDeliveryWorkspace } from './WindowDeliveryWorkspace'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '云浦寄达局',
}

describe('WindowDeliveryWorkspace', () => {
  it('receives an import bag before receiving the selected mail', async () => {
    const repository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(<WindowDeliveryWorkspace authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)} onBack={vi.fn()} operator={operator} repository={repository} section="import" />)

    await user.click(await screen.findByRole('checkbox', { name: '选择总包 CTB202608080001' }))
    await user.click(screen.getByRole('button', { name: '确认接收' }))
    expect(await screen.findByRole('status')).toHaveTextContent('总包接收成功')

    await user.click(screen.getByRole('checkbox', { name: '选择邮件 RA20260808001GN' }))
    await user.click(screen.getByRole('button', { name: '确认邮件' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已进入窗投库存')

    await expect(repository.load()).resolves.toMatchObject({
      windowDeliveryItems: expect.arrayContaining([
        expect.objectContaining({ itemCode: 'RA20260808001GN', status: 'stored' }),
      ]),
      windowDeliveryAudits: [
        expect.objectContaining({ kind: 'bag-received' }),
        expect.objectContaining({ kind: 'mail-received' }),
      ],
    })
  })

  it('saves a supplement into the shared maintenance ledger', async () => {
    const repository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(<WindowDeliveryWorkspace authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)} onBack={vi.fn()} operator={operator} repository={repository} section="supplement" />)

    await user.type(await screen.findByRole('textbox', { name: '补录邮件号码' }), 'RA20260811008GN')
    await user.type(screen.getByRole('textbox', { name: '补录收件人' }), '陈安')
    await user.type(screen.getByRole('textbox', { name: '补录收件人手机' }), '10000000006')
    await user.type(screen.getByRole('textbox', { name: '补录收件人地址' }), '澜京市栖台区青云路 8 号')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('status')).toHaveTextContent('窗投补录成功')
    const state = await repository.load()
    expect(state.windowDeliveryItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'supplement',
        itemCode: 'RA20260811008GN',
        recipientName: '陈安',
        status: 'stored',
      }),
    ]))
  })

  it('leaves supervisor credentials blank when a supplement requires authorization', async () => {
    const repository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(<WindowDeliveryWorkspace authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)} onBack={vi.fn()} operator={operator} repository={repository} section="supplement" />)

    await user.type(await screen.findByLabelText('补录退回用户资费'), '1.00')

    expect(screen.getByLabelText('窗投补录主管工号')).toHaveValue('')
    expect(screen.getByLabelText('窗投补录主管口令')).toHaveValue('')
  })

  it('recalls a stored item and completes counter cancellation', async () => {
    const repository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(<WindowDeliveryWorkspace authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)} onBack={vi.fn()} operator={operator} repository={repository} section="cancellation" />)

    await user.type(await screen.findByRole('textbox', { name: '销号邮件号码' }), 'RR20260807006GN')
    await user.click(screen.getByRole('button', { name: '调取' }))
    await user.type(screen.getByRole('textbox', { name: '销号领件人证件号码' }), '990101194912310044')
    await user.click(screen.getByRole('button', { name: '确认销号' }))

    expect(await screen.findByRole('status')).toHaveTextContent('销号成功')
    expect((await repository.load()).windowDeliveryItems.find((item) => item.id === 'window-item-stored-001'))
      .toMatchObject({ status: 'cancelled', cancellation: { tender: 'cash' } })
  })
})
