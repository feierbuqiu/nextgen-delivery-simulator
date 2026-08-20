import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import type { CustomerDraft } from '../../domain/customer/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { ChannelProductSalesWorkspace } from './ChannelProductSalesWorkspace'

const customerDraft: CustomerDraft = {
  productFamily: 'basic-letter',
  destinationRegion: 'domestic',
  sender: {
    ...createEmptySender(),
    contact: '10000000016',
    name: '林澄',
    detailedAddress: '澜京市栖台区星光路 18 号',
    postalCode: '100011',
  },
  recipient: {
    ...createEmptyRecipient(),
    contact: '10000000019',
    name: '顾远',
    detailedAddress: '澄岐省澄野市江洲区远景路 26 号',
    postalCode: '120023',
  },
  status: 'customer-ready',
  updatedAt: '2026-08-04T10:50:00.000Z',
}

describe('ChannelProductSalesWorkspace', () => {
  it('supports catalog search, SKU cart, multiple fulfillment paths, and settlement submission', async () => {
    const repository = MemoryServiceRepository.create()
    const onSummaryChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ChannelProductSalesWorkspace
        customerDraft={customerDraft}
        onOpenSettlement={() => undefined}
        onSummaryChange={onSummaryChange}
        repository={repository}
      />,
    )

    expect(await screen.findByRole('region', { name: '渠道转型商品销售' }))
      .toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '商品名称或条码' }), 'XS10010001')
    await user.click(screen.getByRole('button', { name: '查看商品 云谷杂粮礼盒' }))

    const detail = await screen.findByRole('dialog', { name: '云谷杂粮礼盒' })
    expect(within(detail).getByRole('combobox', { name: '商品 SKU' })).toHaveValue('YG-06')
    const quantity = within(detail).getByRole('spinbutton', { name: '商品数量' })
    await user.clear(quantity)
    await user.type(quantity, '3')
    await user.click(within(detail).getByRole('button', { name: '加入购物车' }))

    const added = await screen.findByRole('dialog', { name: '该商品加入购物车成功' })
    await user.click(within(added).getByRole('button', { name: '查看购物车' }))
    expect(screen.getByRole('spinbutton', { name: '购物车数量 云谷杂粮礼盒 六袋装' }))
      .toHaveValue(3)

    await user.click(screen.getByRole('tab', { name: '寄递登记' }))
    await user.type(screen.getByRole('textbox', { name: '寄递手机号' }), '10000000019')
    await user.type(screen.getByRole('textbox', { name: '寄递姓名' }), '顾远')
    await user.type(screen.getByRole('textbox', { name: '寄递邮编' }), '120023')
    await user.type(
      screen.getByRole('textbox', { name: '寄递详细地址' }),
      '澄岐省澄野市江洲区远景路 26 号',
    )
    await user.click(screen.getByRole('checkbox', { name: '登记 云谷杂粮礼盒 六袋装' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('寄递登记已保存，可继续采集下一位收件人。'))
      .toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '到店自提登记' }))
    await user.type(screen.getByRole('textbox', { name: '自提手机号' }), '10000000020')
    await user.type(screen.getByRole('textbox', { name: '自提姓名' }), '叶舟')
    await user.click(screen.getByRole('button', { name: '选择' }))
    const officeDialog = await screen.findByRole('dialog', { name: '自提机构信息' })
    await user.click(within(officeDialog).getAllByRole('button', { name: '选择' })[0]!)
    await user.click(screen.getByRole('checkbox', { name: '登记 云谷杂粮礼盒 六袋装' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('到店自提登记已保存。')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '全部商品' }))
    expect(screen.getByText('现货数量').closest('table'))
      .toHaveTextContent('1')
    await user.click(screen.getByRole('button', { name: '提交' }))
    const confirmation = await screen.findByRole('dialog', { name: '是否确认提交商品？' })
    await user.click(within(confirmation).getByRole('button', { name: '确定' }))

    expect(await screen.findByText(/商品销售流水 XS-20260804-000001 已进入结算中心/))
      .toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      schemaVersion: 38,
      nextChannelProductSequence: 2,
      channelProductOrders: [{
        id: 'XS-20260804-000001',
        status: 'pending-settlement',
        totalQuantity: 3,
        totalCents: 20400,
        allocations: [
          { kind: 'delivery', lines: [{ quantity: 1 }] },
          { kind: 'pickup', lines: [{ quantity: 1 }] },
        ],
      }],
    })
    expect(onSummaryChange).toHaveBeenLastCalledWith({ count: 1, totalCents: 20400 })
  })
})
