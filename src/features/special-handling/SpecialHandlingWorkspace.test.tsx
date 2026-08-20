import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import type { ServiceOperatorSnapshot } from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { SpecialHandlingWorkspace } from './SpecialHandlingWorkspace'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '栖沄邮件处理中心',
}

async function createRepositoryWithEligibleMail() {
  const repository = MemoryServiceRepository.create()
  const product = SERVICE_PRODUCTS.find((candidate) => candidate.searchCode === '310')!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    destinationZone: 'nonlocal' as const,
    destinationOffice: '栖沄邮件处理中心',
    itemCode: 'PA13131313435',
    weightGrams: 1000,
    platformQuoteCents: 1_200,
  }
  const accepted = await repository.accept({
    acceptedAt: '2026-08-11T09:00:00.000+10:00',
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'parcel',
      destinationRegion: 'domestic',
      sender: {
        ...createEmptySender(),
        contact: '10000000001',
        name: '演练申请人',
      },
      recipient: {
        ...createEmptyRecipient(),
        contact: '10000000008',
        detailedAddress: '瀚原省栖沄市景麓区新程路 6 号',
        name: '演练收件人',
      },
    },
    draft,
    product,
    operator,
  })
  await repository.settle({
    transactionIds: [accepted.transaction.id],
    tender: 'cash',
    settledAt: '2026-08-11T09:05:00.000+10:00',
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  return repository
}

describe('SpecialHandlingWorkspace', () => {
  it('uses the east-eight business day for the default status query', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-18T16:05:00.000Z'))

    try {
      render(
        <SpecialHandlingWorkspace
          onBack={vi.fn()}
          operator={operator}
          repository={MemoryServiceRepository.create()}
          section="status"
        />,
      )
      await act(async () => {
        await Promise.resolve()
      })

      expect(screen.getByLabelText('状态查询开始日期'))
        .toHaveValue('2026-08-19')
      expect(screen.getByLabelText('状态查询结束日期'))
        .toHaveValue('2026-08-19')
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs withdrawal quote, submission, settlement, query and cancellation', async () => {
    const repository = await createRepositoryWithEligibleMail()
    const user = userEvent.setup()
    const view = render(
      <SpecialHandlingWorkspace
        onBack={vi.fn()}
        operator={operator}
        repository={repository}
        section="application"
      />,
    )

    await screen.findByRole('navigation', { name: '邮件撤改处理页签' })
    await user.type(screen.getByRole('textbox', { name: '邮件号码' }), 'PA13131313435')
    await user.type(screen.getByRole('textbox', { name: '申请人姓名' }), '演练申请人')
    await user.type(screen.getByRole('textbox', { name: '申请人电话' }), '10000000001')
    await user.selectOptions(
      screen.getByRole('combobox', { name: '申请人证件名称' }),
      'travel',
    )
    await user.type(
      screen.getByRole('textbox', { name: '申请人证件号码' }),
      'SIMULATOR-001',
    )
    await user.type(screen.getByRole('textbox', { name: '申请原因' }), '寄件人申请撤单')
    await user.click(screen.getByRole('button', { name: '计费' }))

    expect(await screen.findByText('计费成功，手续费 ¥ 5.00。')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '收件人姓名' })).toHaveValue('演练收件人')
    expect(screen.getByRole('textbox', { name: '收件人电话' })).toHaveValue('10000000008')
    expect(screen.getByRole('textbox', { name: '原收件人详细地址' })).toHaveValue('瀚原省栖沄市景麓区新程路 6 号')
    await user.click(screen.getByRole('button', { name: '提交' }))
    const confirmation = screen.getByRole('dialog', { name: '确认提交' })
    await user.click(within(confirmation).getByRole('button', { name: '确定' }))
    const settlement = await screen.findByRole('dialog', { name: '统一结算' })
    await user.click(within(settlement).getByRole('button', { name: '现金支付' }))
    expect(await screen.findByText(/已结算并上传成功/)).toBeInTheDocument()

    view.rerender(
      <SpecialHandlingWorkspace
        onBack={vi.fn()}
        operator={operator}
        repository={repository}
        section="status"
      />,
    )
    await user.click(screen.getByRole('button', { name: '查询' }))
    const row = await screen.findByRole('row', { name: /PA13131313435/ })
    expect(within(row).getByRole('button', { name: /办理结算/ })).toBeDisabled()
    expect(within(row).getByRole('button', { name: /删除申请/ })).toBeDisabled()
    await user.click(within(row).getByRole('button', { name: /取消撤单/ }))
    const cancellation = screen.getByRole('dialog', { name: '取消撤单' })
    await user.click(within(cancellation).getByRole('button', { name: '确认取消撤单' }))
    expect(await screen.findByText(/已进入退款待办/)).toBeInTheDocument()
    expect((await repository.load()).specialHandlingApplications[0]).toMatchObject({
      settlementTender: 'cash',
      uploadStatus: 'succeeded',
      refundStatus: 'pending',
    })
  })

  it('shows redirect fields and applies the interface quote', async () => {
    const repository = await createRepositoryWithEligibleMail()
    const user = userEvent.setup()
    render(
      <SpecialHandlingWorkspace
        onBack={vi.fn()}
        operator={operator}
        repository={repository}
        section="application"
      />,
    )

    await user.click(await screen.findByRole('tab', { name: '邮件改址处理' }))
    await user.type(screen.getByRole('textbox', { name: '邮件号码' }), 'PA13131313435')
    await user.type(screen.getByRole('textbox', { name: '申请人姓名' }), '演练申请人')
    await user.type(screen.getByRole('textbox', { name: '申请人电话' }), '10000000001')
    await user.selectOptions(screen.getByRole('combobox', { name: '申请人证件名称' }), 'travel')
    await user.type(screen.getByRole('textbox', { name: '申请人证件号码' }), 'SIMULATOR-001')
    await user.type(screen.getByRole('textbox', { name: '改址详细地址' }), '瀚原省栖沄市景麓区新程路 8 号')
    await user.type(screen.getByRole('textbox', { name: '改址收件人邮编' }), '319901')
    await user.type(screen.getByRole('textbox', { name: '申请原因' }), '收件地址填写有误')
    await user.click(screen.getByRole('button', { name: '计费' }))

    expect(await screen.findByText('计费成功，手续费 ¥ 8.00。')).toBeInTheDocument()
    expect(screen.getByLabelText('手续费')).toHaveTextContent('¥ 8.00')
  })
})
