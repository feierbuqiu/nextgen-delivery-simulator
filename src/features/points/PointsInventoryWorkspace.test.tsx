import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ServiceOperatorSnapshot } from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { PointsInventoryWorkspace } from './PointsInventoryWorkspace'

const OPERATOR: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '虚构寄达局',
}

function renderWorkspace(repository: MemoryServiceRepository) {
  return render(<PointsInventoryWorkspace
    clock={() => new Date('2026-08-19T09:30:00.000Z')}
    onBack={vi.fn()}
    operator={OPERATOR}
    repository={repository}
  />)
}

describe('PointsInventoryWorkspace', () => {
  it('supports exact barcode and fuzzy product-name queries', async () => {
    const user = userEvent.setup()
    renderWorkspace(MemoryServiceRepository.create())

    const result = await screen.findByRole('region', { name: '积分商品库存查询结果' })
    expect(within(result).getAllByRole('row')).toHaveLength(5)
    await user.type(screen.getByRole('textbox', { name: '积分商品条码' }), 'SIM-JF-000803')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(within(result).getByText('练习清香洗护液')).toBeInTheDocument()
    expect(within(result).queryByText('练习织物清洁液')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重置' }))
    await user.type(screen.getByRole('textbox', { name: '积分商品名称' }), '清洁')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(within(result).getByText('练习织物清洁液')).toBeInTheDocument()
    expect(within(result).getByText('练习日用清洁套装')).toBeInTheDocument()
  })

  it('persists inbound and outbound movements while blocking an excess return', async () => {
    const repository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    renderWorkspace(repository)

    const result = await screen.findByRole('region', { name: '积分商品库存查询结果' })
    const product = within(result).getByText('练习清香洗护液')
    await user.click(within(product.closest('tr') as HTMLTableRowElement).getByRole('button', { name: '入库' }))
    const inbound = screen.getByRole('spinbutton', { name: '入库数量' })
    await user.clear(inbound)
    await user.type(inbound, '4')
    await user.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByRole('status')).toHaveTextContent('库存更新为 5')

    const updatedProduct = within(result).getByText('练习清香洗护液')
    await user.click(within(updatedProduct.closest('tr') as HTMLTableRowElement).getByRole('button', { name: '退库' }))
    const outbound = screen.getByRole('spinbutton', { name: '退库数量' })
    await user.clear(outbound)
    await user.type(outbound, '6')
    await user.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('不能超过当前库存 5')

    await user.clear(outbound)
    await user.type(outbound, '2')
    await user.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByRole('status')).toHaveTextContent('库存更新为 3')

    const state = await repository.load()
    expect(state.pointsProductInventory.find((item) => item.id === 'points-product-803')).toMatchObject({ quantity: 3 })
    expect(state.pointsInventoryMovements).toHaveLength(2)
  })
})
