import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import type { ServiceOperatorSnapshot } from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { createTestOnSiteAuthorizer } from '../../test/workAuthorization'
import { PostageMeterOperationsWorkspace } from './PostageMeterOperationsWorkspace'
import { PostageMeterWorkspace } from './PostageMeterWorkspace'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '栖沄邮件处理中心',
}

async function createRepositoryWithAgreementMail() {
  const repository = MemoryServiceRepository.create()
  const product = SERVICE_PRODUCTS.find((candidate) => candidate.id === 'ordinary-letter-100')!
  const draft = {
    ...createEmptyServiceDraft(true),
    productId: product.id,
    destinationZone: 'local' as const,
    destinationOffice: '栖沄邮件处理中心',
    itemCode: 'GNPM00002001',
    weightGrams: 20,
  }
  const accepted = await repository.accept({
    acceptedAt: '2026-08-10T09:00:00.000+10:00',
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: {
        ...createEmptySender(),
        agreementAccountId: '99000000000001',
        agreementAccountName: '景麓通信演示中心',
      },
      recipient: createEmptyRecipient(),
    },
    draft,
    product,
    operator,
  })
  await repository.settle({
    transactionIds: [accepted.transaction.id],
    tender: 'cash',
    settledAt: '2026-08-10T09:05:00.000+10:00',
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  return repository
}

function operation(
  repository: MemoryServiceRepository,
  section: Parameters<typeof PostageMeterOperationsWorkspace>[0]['section'],
) {
  return <PostageMeterOperationsWorkspace
    institutionCode="99901001"
    onBack={() => undefined}
    operator={operator}
    repository={repository}
    section={section}
  />
}

describe('PostageMeterOperationsWorkspace', () => {
  it('completes delegated handover, receipt, return request and batch approval', async () => {
    const repository = await createRepositoryWithAgreementMail()
    const user = userEvent.setup()
    const view = render(operation(repository, 'handover-out'))

    await user.click(await screen.findByRole('button', { name: '委托' }))
    let dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('勾选件数：1 件')
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: '委托过戳机构' }),
      '99903001',
    )
    await user.click(within(dialog).getByRole('button', { name: '确定' }))
    expect(await screen.findByRole('status')).toHaveTextContent('委托交出成功')
    expect((await repository.load()).postageMeterMailHandovers[0]).toMatchObject({
      targetInstitutionName: '云浦支局',
      status: 'pending-receipt',
    })

    view.rerender(operation(repository, 'handover-in'))
    await user.click(await screen.findByRole('button', { name: '接收' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('textbox', { name: '接收过戳机构' }))
      .toHaveValue('云浦支局')
    await user.click(within(dialog).getByRole('button', { name: '确定' }))
    expect(await screen.findByRole('status')).toHaveTextContent('接收成功')

    view.rerender(operation(repository, 'handover-out'))
    await user.click(await screen.findByRole('button', { name: '退回' }))
    dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('批次查改审批')
    await user.click(within(dialog).getByRole('button', { name: '确定' }))
    expect(await screen.findByRole('status')).toHaveTextContent('退回申请已提交')

    view.rerender(
      <PostageMeterWorkspace
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
        section="batch"
        authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)}
      />,
    )
    await user.click(await screen.findByRole('button', { name: '批次查改审批' }))
    await user.click(screen.getByRole('button', { name: '批准退回' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已批准')
    expect((await repository.load()).postageMeterMailHandovers[0]?.status).toBe('returned')
  })

  it('submits funding and repair forms without inventing external approval', async () => {
    const repository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    const view = render(operation(repository, 'funding'))

    const amount = await screen.findByRole('textbox', { name: '申请注资金额' })
    await user.type(amount, '1234.56')
    await user.click(screen.getByRole('button', { name: '注资申请' }))
    expect(await screen.findByRole('status')).toHaveTextContent('等待邮资机管理系统审批')
    expect((await repository.load()).postageMeterFundingRequests[0]?.amountCents)
      .toBe(123_456)

    view.rerender(operation(repository, 'repair'))
    await user.selectOptions(
      await screen.findByRole('combobox', { name: '报修启用申请事项' }),
      'repair',
    )
    await user.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByRole('status')).toHaveTextContent('邮资机已停用')
    expect((await repository.load()).postageMeterDevices[0]?.reportStatus).toBe('disabled')
  })

  it('queries the seeded desensitized device handover history', async () => {
    const repository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(operation(repository, 'handover-history'))

    const from = await screen.findByRole('textbox', {
      name: '邮资机历史交接开始日期',
    })
    const to = screen.getByRole('textbox', { name: '邮资机历史交接结束日期' })
    await user.clear(from)
    await user.type(from, '2026-01-15')
    await user.clear(to)
    await user.type(to, '2026-01-15')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByRole('status')).toHaveTextContent('共 1 条')
    expect(screen.getByRole('row', { name: /云浦设备管理点/ })).toHaveTextContent('景麓营业部')
  })
})
