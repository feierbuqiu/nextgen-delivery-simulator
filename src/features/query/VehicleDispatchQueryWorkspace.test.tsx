import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { VehicleDispatchQueryWorkspace } from './VehicleDispatchQueryWorkspace'

const NOW = new Date('2026-08-12T10:00:00+10:00')

function renderWorkspace() {
  return render(
    <VehicleDispatchQueryWorkspace
      now={NOW}
      onBack={vi.fn()}
      repository={MemoryServiceRepository.create()}
    />,
  )
}

describe('VehicleDispatchQueryWorkspace', () => {
  it('queries active and deleted unseal control records', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    const filters = await screen.findByRole('region', { name: '解车封车控制信息查询条件' })
    await user.click(within(filters).getByRole('button', { name: '查询' }))

    const results = screen.getByRole('region', { name: '解车封车控制信息结果' })
    expect(within(results).getAllByRole('row')).toHaveLength(3)
    expect(within(results).getAllByRole('cell', { name: '必须' })).toHaveLength(2)
    expect(within(results).getAllByRole('cell', { name: '澜京' })).toHaveLength(2)
    expect(within(results).getByRole('cell', { name: '是' })).toBeInTheDocument()
  })

  it('queries vehicle orders and opens the station sequence detail', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(await screen.findByRole('button', { name: '车辆派车信息查询' }))
    const filters = screen.getByRole('region', { name: '车辆派车信息查询条件' })
    await user.click(within(filters).getByRole('button', { name: '查询' }))

    const results = screen.getByRole('region', { name: '车辆派车信息结果' })
    expect(within(results).getByText('PCD-20260812-A01')).toBeInTheDocument()
    expect(within(results).getByText('PCD-20260812-A02')).toBeInTheDocument()
    expect(within(results).getAllByRole('button', { name: '详情' })).toHaveLength(2)

    await user.click(within(results).getAllByRole('button', { name: '详情' })[0]!)
    const detail = screen.getByRole('dialog', { name: '派车站序详情' })
    expect(detail).toHaveTextContent('派车单有效')
    expect(within(detail).getByRole('cell', { name: '景麓营业部' })).toBeInTheDocument()
    expect(within(detail).getAllByRole('cell', { name: '去程(1)' })).toHaveLength(2)
    expect(within(detail).getAllByRole('cell', { name: '否' }).length).toBeGreaterThan(0)
    expect(within(detail).getByRole('cell', { name: '2026-08-12 09:07:23' })).toBeInTheDocument()
  })

  it('shows the exact 45-day prompt when no dispatch record matches', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(await screen.findByRole('button', { name: '车辆派车信息查询' }))
    const filters = screen.getByRole('region', { name: '车辆派车信息查询条件' })
    const routeCode = within(filters).getByLabelText('车辆派车邮路代码')
    await user.clear(routeCode)
    await user.type(routeCode, 'SIM-Z99')
    await user.click(within(filters).getByRole('button', { name: '查询' }))

    const prompt = screen.getByRole('dialog', { name: '提示' })
    expect(prompt).toHaveTextContent('未查询到45天内的派车信息，请重新输入！')
    await user.click(within(prompt).getByRole('button', { name: '确定' }))
    expect(screen.queryByRole('dialog', { name: '提示' })).not.toBeInTheDocument()
  })

  it('keeps a 35-day record visible but marks the row invalid', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(await screen.findByRole('button', { name: '车辆派车信息查询' }))
    const filters = screen.getByRole('region', { name: '车辆派车信息查询条件' })
    const routeCode = within(filters).getByLabelText('车辆派车邮路代码')
    await user.clear(routeCode)
    await user.type(routeCode, 'SIM-B02')
    await user.click(within(filters).getByRole('button', { name: '查询' }))

    const results = screen.getByRole('region', { name: '车辆派车信息结果' })
    const row = within(results).getByText('PCD-20260812-B01').closest('tr')
    expect(row).toHaveClass('vehicle-dispatch-query__row--invalid')
    expect(row).toHaveAttribute('title', '派车时间超过 30 天')
  })
})
