import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { executePersonalRemittanceCommand } from '../../domain/service/personalRemittance'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from '../../domain/service/seed'
import { acceptServiceTransaction, settleServiceTransactions } from '../../domain/service/transactions'
import type { ServiceOperatorSnapshot, ServiceWorkspaceState } from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { AccountingWorkspace } from './AccountingWorkspace'

const operator: ServiceOperatorSnapshot = {
  operatorId: '90000001',
  displayName: '演示主管',
  workstationCode: '02',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '虚构寄达局',
}

const counter: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '虚构寄达局',
}

function confirmedCounterState(): ServiceWorkspaceState {
  const product = SERVICE_PRODUCTS[0]!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    itemCode: '7000818316001',
    weightGrams: 20,
    paymentMethod: 'cash-settlement' as const,
  }
  const accepted = acceptServiceTransaction(createServiceSeedState(), {
    acceptedAt: '2026-08-12T01:00:00.000Z',
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: { ...createEmptySender(), name: '林澄', detailedAddress: '澜京市栖台区新程路 1 号' },
      recipient: { ...createEmptyRecipient(), name: '顾远', detailedAddress: '澄岐省澄野市江洲区远帆路 2 号' },
    },
    draft,
    product,
    operator: counter,
  })
  const settled = settleServiceTransactions(accepted.state, {
    transactionIds: [accepted.transaction.id],
    tender: 'cash',
    settledAt: '2026-08-12T01:05:00.000Z',
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  const generated = executePersonalRemittanceCommand(settled.state, {
    type: 'generate-personal-remittance',
    workDate: '2026-08-12',
    operator: counter,
    institutionCode: '99901001',
    institutionName: '景麓营业部',
    workstationCode: '01',
    generatedAt: '2026-08-12T02:00:00.000Z',
    ignoreCurrentDayPending: false,
  })
  return executePersonalRemittanceCommand(generated.state, {
    type: 'confirm-personal-remittance',
    remittanceId: generated.remittance.id,
    operator: counter,
    confirmedAt: '2026-08-12T02:05:00.000Z',
  }).state
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('AccountingWorkspace', () => {
  it('keeps institution accounting visible while disabling manager-only actions', async () => {
    const user = userEvent.setup()
    render(<AccountingWorkspace canManageInstitution={false} institutionCode="99901001" institutionName="景麓营业部" onBack={vi.fn()} onOpenSettlement={vi.fn()} operator={counter} repository={MemoryServiceRepository.create()} />)

    await user.click(await screen.findByRole('button', { name: /^支局缴款$/ }))
    expect(screen.getByText('支局级账务内容保持可见；生成、确认和注销仅允许营业主管办理。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认缴款' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '存行单处理' }))
    expect(screen.getByRole('button', { name: '生成' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '营业日报' }))
    expect(screen.getByRole('radio', { name: '支局日报' })).toBeDisabled()
  })

  it('does not offer branch confirmation when there is no remittance data', async () => {
    const user = userEvent.setup()
    render(<AccountingWorkspace canManageInstitution institutionCode="99901001" institutionName="景麓营业部" onBack={vi.fn()} onOpenSettlement={vi.fn()} operator={operator} repository={MemoryServiceRepository.create()} />)

    await user.click(await screen.findByRole('button', { name: /^支局缴款$/ }))
    expect(screen.getByText('当前尚无可汇总的支局缴款数据。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认缴款' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '存行单处理' }))
    expect(screen.getByText('暂无存行单记录。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成' })).toBeDisabled()
  })

  it('confirms branch remittance and exposes its automatically generated deposit slip', async () => {
    const user = userEvent.setup()
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const repository = MemoryServiceRepository.create()
    await repository.restore(confirmedCounterState())
    render(<AccountingWorkspace canManageInstitution institutionCode="99901001" institutionName="景麓营业部" onBack={vi.fn()} onOpenSettlement={vi.fn()} operator={operator} repository={repository} />)

    await user.click(await screen.findByRole('button', { name: /^支局缴款$/ }))
    const workDate = screen.getByLabelText('支局缴款统计日期')
    fireEvent.change(workDate, { target: { value: '2026-08-12' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '确认缴款' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '确认缴款' }))
    const confirmation = await screen.findByRole('dialog', { name: '确认缴款' })
    await user.click(within(confirmation).getByRole('button', { name: '确定' }))

    const depositPrompt = await screen.findByRole('dialog', { name: '存行单生成成功，是否打印存行单？' })
    expect(within(depositPrompt).getByText('营业现金存行单')).toBeInTheDocument()
    expect(within(depositPrompt).getAllByText('¥ 0.80')).toHaveLength(2)
    await user.click(within(depositPrompt).getByRole('button', { name: '打印' }))
    await waitFor(async () => {
      expect((await repository.load()).bankDepositSlips[0]?.printHistory).toHaveLength(1)
    })
    expect(print).toHaveBeenCalledOnce()
    await user.click(within(depositPrompt).getByRole('button', { name: '不打印' }))

    await user.click(screen.getByRole('button', { name: '存行单处理' }))
    const query = await screen.findByRole('region', { name: '存行单查询' })
    expect(within(query).getByText('支局缴款联动')).toBeInTheDocument()
    expect(within(query).getByText('¥ 0.80')).toBeInTheDocument()
  })
})
