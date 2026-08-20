import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_SERVICE_OPERATOR } from '../../domain/service/transactions'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { SpotCheckExerciseWorkspace } from './SpotCheckExerciseWorkspace'

const NOW = new Date('2026-08-12T10:10:00+10:00')

function renderWorkspace() {
  const repository = MemoryServiceRepository.create()
  render(
    <SpotCheckExerciseWorkspace
      institutionCode="99901001"
      institutionName="景麓营业部"
      now={NOW}
      onBack={vi.fn()}
      operator={DEFAULT_SERVICE_OPERATOR}
      repository={repository}
    />,
  )
  return repository
}

async function runDefaultQuery(user: ReturnType<typeof userEvent.setup>) {
  const filters = await screen.findByRole('region', { name: '抽查演练信息查询条件' })
  await user.click(within(filters).getByRole('button', { name: '查询' }))
  return screen.getByRole('region', { name: '抽查演练信息查询结果' })
}

describe('SpotCheckExerciseWorkspace', () => {
  it('queries the documented columns and shows the unsigned reminder', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    const results = await runDefaultQuery(user)
    const reminder = screen.getByRole('dialog', { name: '抽查演练提醒' })
    expect(reminder).toHaveTextContent('您有未签收的抽查考题，请及时签收。')
    expect(within(results).getAllByRole('row')).toHaveLength(4)
    expect(within(results).getByRole('columnheader', { name: '签收标志' })).toBeInTheDocument()
    expect(within(results).getByRole('columnheader', { name: '完成标志' })).toBeInTheDocument()
    expect(within(results).getAllByRole('button', { name: '查看考题' })).toHaveLength(3)

    await user.click(within(reminder).getByRole('button', { name: '稍后处理' }))
    const currentRow = within(results).getByText('1002').closest('tr')!
    await user.click(within(currentRow).getByRole('button', { name: '查看考题' }))
    const detail = screen.getByRole('dialog', { name: '查看考题' })
    expect(detail).toHaveTextContent('三位基础产品代码与区域组合')
    expect(detail).toHaveTextContent('6 位')
  })

  it('signs an unsigned exercise and persists the receipt state', async () => {
    const user = userEvent.setup()
    const repository = renderWorkspace()
    const results = await runDefaultQuery(user)
    await user.click(within(screen.getByRole('dialog', { name: '抽查演练提醒' })).getByRole('button', { name: '稍后处理' }))

    const currentRow = within(results).getByText('1002').closest('tr')!
    await user.click(within(currentRow).getByRole('button', { name: '签收考题' }))

    await waitFor(() => expect(within(currentRow).getByText('已签收')).toBeInTheDocument())
    expect(within(currentRow).getByRole('button', { name: '签收考题' })).toBeDisabled()
    await expect(repository.load()).resolves.toMatchObject({
      spotCheckExercises: expect.arrayContaining([
        expect.objectContaining({ id: 'CCYL-20260812-000001', receiptStatus: 'signed' }),
      ]),
    })
  })

  it('jumps to the answer page, submits one choice, and persists completion', async () => {
    const user = userEvent.setup()
    const repository = renderWorkspace()
    const results = await runDefaultQuery(user)
    await user.click(within(screen.getByRole('dialog', { name: '抽查演练提醒' })).getByRole('button', { name: '稍后处理' }))

    const currentRow = within(results).getByText('1002').closest('tr')!
    await user.click(within(currentRow).getByRole('button', { name: '开始答题' }))
    const question = screen.getByRole('region', { name: '抽查演练考题' })
    await user.click(within(question).getByRole('radio', { name: '6 位' }))
    await user.click(within(question).getByRole('button', { name: '提交答题' }))

    const refreshedResults = await screen.findByRole('region', { name: '抽查演练信息查询结果' })
    const refreshedRow = within(refreshedResults).getByText('1002').closest('tr')!
    await waitFor(() => expect(within(refreshedRow).getByText('已完成')).toBeInTheDocument())
    expect(within(refreshedRow).getByRole('button', { name: '开始答题' })).toBeDisabled()
    const stored = await repository.load()
    expect(stored.spotCheckExercises.find((record) => record.id === 'CCYL-20260812-000001'))
      .toMatchObject({ completionStatus: 'completed', answerValue: '6' })
  })

  it('filters completed remittance exercises', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    const filters = await screen.findByRole('region', { name: '抽查演练信息查询条件' })
    await user.selectOptions(within(filters).getByLabelText('抽查完成状态'), 'completed')
    await user.selectOptions(within(filters).getByLabelText('抽查业务类型'), 'remittance')
    await user.click(within(filters).getByRole('button', { name: '查询' }))

    const results = screen.getByRole('region', { name: '抽查演练信息查询结果' })
    expect(within(results).getAllByRole('row')).toHaveLength(3)
    expect(within(results).getByText('汇兑-兑付')).toBeInTheDocument()
    expect(within(results).getByText('汇兑-汇款')).toBeInTheDocument()
    expect(within(results).queryByText('营业-函件')).not.toBeInTheDocument()
  })
})
