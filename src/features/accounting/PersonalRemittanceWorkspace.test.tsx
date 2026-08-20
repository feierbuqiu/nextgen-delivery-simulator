import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { localWorkDate } from '../../domain/access/attendance'
import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import { DEFAULT_SERVICE_OPERATOR } from '../../domain/service/transactions'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { PersonalRemittanceWorkspace } from './PersonalRemittanceWorkspace'

function request(workDate: string) {
  const product = SERVICE_PRODUCTS[0]!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    itemCode: '7000818316568',
    weightGrams: 20,
  }
  return {
    acceptedAt: `${workDate}T01:00:00.000Z`,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter' as const,
      destinationRegion: 'domestic' as const,
      sender: { ...createEmptySender(), name: '林澄', detailedAddress: '澜京市栖台区新程路 1 号' },
      recipient: { ...createEmptyRecipient(), name: '顾远', detailedAddress: '澄岐省澄野市江洲区远帆路 2 号' },
    },
    draft,
    product,
    operator: DEFAULT_SERVICE_OPERATOR,
  }
}

function renderWorkspace(repository: MemoryServiceRepository) {
  return render(
    <PersonalRemittanceWorkspace
      institutionCode="99901001"
      institutionName="景麓营业部"
      onBack={() => undefined}
      onOpenSettlement={() => undefined}
      operator={DEFAULT_SERVICE_OPERATOR}
      repository={repository}
    />,
  )
}

describe('PersonalRemittanceWorkspace', () => {
  it('generates, confirms, prints and retains personal-remittance history', async () => {
    const workDate = localWorkDate(new Date())
    const repository = MemoryServiceRepository.create()
    const accepted = await repository.accept(request(workDate))
    await repository.settle({
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: `${workDate}T01:05:00.000Z`,
      amountReceivedCents: accepted.transaction.charge.settlementDueCents,
    })
    const user = userEvent.setup()
    renderWorkspace(repository)

    await user.click(await screen.findByRole('button', { name: '查询' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已生成')
    expect(screen.getByText('待确认')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '确认缴款' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已确认')
    expect(screen.getByText('已确认')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打印' }))
    const dialog = await screen.findByRole('dialog', { name: '个人缴款单' })
    expect(within(dialog).getByText(/JK-/)).toBeInTheDocument()
    expect(within(dialog).getByText('函件、包裹及寄递业务收入')).toBeInTheDocument()
    expect((await repository.load()).personalRemittances[0]?.printHistory).toHaveLength(1)
  })

  it('asks before ignoring current-day unsettled business', async () => {
    const workDate = localWorkDate(new Date())
    const repository = MemoryServiceRepository.create()
    await repository.accept(request(workDate))
    const user = userEvent.setup()
    renderWorkspace(repository)

    await user.click(await screen.findByRole('button', { name: '查询' }))
    const dialog = await screen.findByRole('dialog', { name: '当天存在未结算信息' })
    expect(within(dialog).getByText(/当天还有 1 笔未结算业务/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '确定' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已生成')
    expect(screen.getByText(/忽略了当天 1 笔未结算业务/)).toBeInTheDocument()
  })
})
