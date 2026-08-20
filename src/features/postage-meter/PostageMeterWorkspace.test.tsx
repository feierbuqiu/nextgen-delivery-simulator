import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import type { ServiceOperatorSnapshot } from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { createTestOnSiteAuthorizer } from '../../test/workAuthorization'
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
    itemCode: 'GNPM00001001',
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

describe('PostageMeterWorkspace', () => {
  it('runs batch creation, reading registration, batch balance and daily upload', async () => {
    const repository = await createRepositoryWithAgreementMail()
    const user = userEvent.setup()
    const view = render(
      <PostageMeterWorkspace
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
        section="batch"
        authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '新增' }))
    const picker = await screen.findByRole('dialog')
    await user.click(within(picker).getByRole('checkbox', { name: /选择待过戳记录/ }))
    await user.click(within(picker).getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('status')).toHaveTextContent('过戳批次')

    const created = await repository.load()
    const batch = created.postageMeterBatches[0]!
    const device = created.postageMeterDevices[0]!
    view.rerender(
      <PostageMeterWorkspace
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
        section="registration"
        authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)}
      />,
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: '待过戳批次选择' }),
      batch.id,
    )
    await user.click(screen.getByRole('button', { name: '读取' }))
    const endCount = screen.getByRole('textbox', { name: '邮资机终止数量' })
    await user.clear(endCount)
    await user.type(endCount, String(device.cumulativeImprintCount + 1))
    const endAmount = screen.getByRole('textbox', { name: '邮资机终止金额' })
    await user.clear(endAmount)
    await user.type(
      endAmount,
      ((device.cumulativePostageCents + batch.expectedPostageCents) / 100).toFixed(2),
    )
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('status')).toHaveTextContent('过戳登记已保存')

    view.rerender(
      <PostageMeterWorkspace
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
        section="balance"
        authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)}
      />,
    )
    await user.click(screen.getByRole('button', { name: '差错登记' }))
    const discrepancy = await screen.findByRole('dialog')
    expect(discrepancy).toHaveTextContent('总差异件数：0 件')
    await user.click(within(discrepancy).getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已完成平衡')

    view.rerender(
      <PostageMeterWorkspace
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
        section="daily"
        authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)}
      />,
    )
    await user.click(screen.getByRole('button', { name: '日终统计' }))
    expect(await screen.findByRole('status')).toHaveTextContent('日终平衡统计完成')
    expect(screen.getByLabelText('日终平衡汇总信息')).toHaveTextContent('已过戳件数1')
    await user.click(screen.getByRole('button', { name: '确认上传' }))
    expect(await screen.findByRole('status')).toHaveTextContent('上传成功')
    expect((await repository.load()).postageMeterDailyBalances[0]!.uploadedAt).not.toBeNull()
  })

  it('maintains only the editable counter, network and port fields', async () => {
    const repository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(
      <PostageMeterWorkspace
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
        section="maintenance"
        authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)}
      />,
    )

    const row = await screen.findByRole('row', { name: /练习联网邮资机 PM-01/ })
    const counterCode = within(row).getByRole('textbox', {
      name: '练习联网邮资机 PM-01台席代码',
    })
    await user.clear(counterCode)
    await user.type(counterCode, '99901009')
    await user.selectOptions(
      within(row).getByRole('combobox', { name: '练习联网邮资机 PM-01联网能力' }),
      'indirect',
    )
    await user.selectOptions(
      within(row).getByRole('combobox', { name: '练习联网邮资机 PM-01终端端口' }),
      '3',
    )
    await user.click(within(row).getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('status')).toHaveTextContent('信息保存成功')
    expect((await repository.load()).postageMeterDevices[0]).toMatchObject({
      counterCode: '99901009',
      networkMode: 'indirect',
      terminalPort: '3',
      name: '练习联网邮资机 PM-01',
      meterHeadNumber: 'PMH000101',
      baseNumber: 'PMB000101',
    })
  })
})
