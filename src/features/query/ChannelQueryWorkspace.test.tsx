import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import {
  DEMO_MANAGEMENT_OPERATOR_ID as DEMO_SUPERVISOR_ID,
  DEMO_MANAGEMENT_SECRET as DEMO_SUPERVISOR_SECRET,
} from '../../domain/access/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import { DEFAULT_SERVICE_OPERATOR } from '../../domain/service/transactions'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { createTestOnSiteAuthorizer } from '../../test/workAuthorization'
import { ChannelQueryWorkspace, type ChannelQuerySection } from './ChannelQueryWorkspace'

async function repositoryWithRegisteredMail(options: {
  settleThirdParty?: boolean
  revise?: boolean
} = {}) {
  const repository = MemoryServiceRepository.create()
  const product = SERVICE_PRODUCTS.find((item) => item.searchCode === '200')!
  const draft = {
    ...createEmptyServiceDraft(false, 'local'),
    productId: product.id,
    itemCode: 'RR47312482901',
    weightGrams: 20,
    destinationOffice: '云州中心局',
  }
  const accepted = await repository.accept({
    acceptedAt: '2026-01-15T09:20:00.000Z',
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'standard-delivery',
      destinationRegion: 'domestic',
      sender: {
        ...createEmptySender(),
        contact: '10000000001',
        name: '周清禾',
        detailedAddress: '瀚原省栖沄市景麓区示范路 1 号',
        identityType: 'primary',
        identityValue: '990101199001010035',
      },
      recipient: {
        ...createEmptyRecipient(),
        contact: '10000000002',
        name: '林远川',
        detailedAddress: '澄岐省澄野市江洲区模拟路 2 号',
      },
    },
    draft,
    operator: DEFAULT_SERVICE_OPERATOR,
    product,
  })
  if (options.settleThirdParty) {
    await repository.settle({
      transactionIds: [accepted.transaction.id],
      tender: 'third-party',
      settledAt: '2026-01-15T09:30:00.000Z',
      amountReceivedCents: accepted.transaction.charge.settlementDueCents,
    })
  }
  if (options.revise) {
    await repository.revise({
      transactionId: accepted.transaction.id,
      correctedAt: '2026-01-15T10:00:00.000Z',
      operator: DEFAULT_SERVICE_OPERATOR,
      reason: '收件人核对后更正',
      customer: accepted.transaction.customer,
      draft: accepted.transaction.service,
      charge: accepted.transaction.charge,
      product,
    })
  }
  return { accepted, repository }
}

function renderQuery(repository: MemoryServiceRepository, section: ChannelQuerySection) {
  return render(
    <ChannelQueryWorkspace
      authorizeOnSite={createTestOnSiteAuthorizer()}
      onBack={vi.fn()}
      operator={DEFAULT_SERVICE_OPERATOR}
      repository={repository}
      section={section}
    />,
  )
}

describe('ChannelQueryWorkspace', () => {
  it('queries a third-party payment and opens status and business details', async () => {
    const { accepted, repository } = await repositoryWithRegisteredMail({ settleThirdParty: true })
    const user = userEvent.setup()
    renderQuery(repository, 'third-party-payment')

    await user.clear(await screen.findByLabelText('第三方支付时间起'))
    await user.type(screen.getByLabelText('第三方支付时间起'), '2026-01-15')
    await user.clear(screen.getByLabelText('第三方支付时间止'))
    await user.type(screen.getByLabelText('第三方支付时间止'), '2026-01-15')
    await user.click(await screen.findByRole('button', { name: '查询' }))
    const result = screen.getByRole('region', { name: '第三方支付查询结果' })
    const row = within(result).getByText(accepted.transaction.id).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('支付成功')).toBeInTheDocument()

    await user.click(within(row!).getByRole('button', { name: '支付状态' }))
    const status = screen.getByRole('dialog', { name: '支付状态' })
    expect(within(status).getByText('支付成功')).toBeInTheDocument()
    await user.click(within(status).getByRole('button', { name: '确定' }))

    await user.click(within(row!).getByRole('button', { name: '详情' }))
    const detail = screen.getByRole('dialog', { name: '邮件详情' })
    expect(within(detail).getByText('给据信函（200000）')).toBeInTheDocument()
    expect(within(detail).getByText('RR47312482901')).toBeInTheDocument()
  })

  it('shows the acting employee and reason in the front-desk correction log', async () => {
    const { repository } = await repositoryWithRegisteredMail({ revise: true })
    const user = userEvent.setup()
    renderQuery(repository, 'front-desk-log')

    await user.clear(await screen.findByLabelText('前台日志日期起'))
    await user.type(screen.getByLabelText('前台日志日期起'), '2026-01-15')
    await user.clear(screen.getByLabelText('前台日志日期止'))
    await user.type(screen.getByLabelText('前台日志日期止'), '2026-01-15')
    await user.click(await screen.findByRole('button', { name: '查询' }))
    const result = screen.getByRole('region', { name: '前台日志查询结果' })
    expect(within(result).getByRole('cell', { name: '修改' })).toBeInTheDocument()
    expect(within(result).getByText('收件人核对后更正')).toBeInTheDocument()
    expect(within(result).getByText('演示营业员')).toBeInTheDocument()
  })

  it('accepts multiple tracking numbers and displays the local event timeline', async () => {
    const { repository } = await repositoryWithRegisteredMail({ revise: true })
    const user = userEvent.setup()
    renderQuery(repository, 'mail-tracking')

    const input = await screen.findByRole('textbox', { name: '跟踪邮件号码' })
    await user.type(input, 'RR00000000000, RR47312482901')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(screen.getByRole('status')).toHaveTextContent('已查询 2 个邮件号码，匹配 1 条模拟收寄记录')

    const result = screen.getByRole('region', { name: '给据邮件跟踪查询结果' })
    const row = within(result).getByText('RR47312482901').closest('tr')
    expect(row).not.toBeNull()
    await user.click(within(row!).getByRole('button', { name: '轨迹详情' }))
    const detail = screen.getByRole('dialog', { name: '轨迹详情' })
    expect(within(detail).getByText('邮件信息已修改：收件人核对后更正')).toBeInTheDocument()
    expect(within(detail).getByText(/邮件已收寄，业务产品 给据信函/)).toBeInTheDocument()
  })

  it('keeps accepted-mail privacy masked until supervisor authorization succeeds', async () => {
    const { accepted, repository } = await repositoryWithRegisteredMail()
    const user = userEvent.setup()
    renderQuery(repository, 'accepted-mail')

    await user.clear(await screen.findByLabelText('收寄查询日期起'))
    await user.type(screen.getByLabelText('收寄查询日期起'), '2026-01-15')
    await user.clear(screen.getByLabelText('收寄查询日期止'))
    await user.type(screen.getByLabelText('收寄查询日期止'), '2026-01-15')
    await user.click(await screen.findByRole('button', { name: '查询' }))
    const result = screen.getByRole('region', { name: '收寄邮件查询结果' })
    const row = within(result).getByText(accepted.transaction.id).closest('tr')
    expect(row).not.toBeNull()
    await user.click(within(row!).getByRole('button', { name: '收寄详情' }))

    const detail = screen.getByRole('dialog', { name: `收寄详情 ${accepted.transaction.id}` })
    expect(within(detail).getByText('100******01')).toBeInTheDocument()
    expect(within(detail).queryByText('瀚原省栖沄市景麓区示范路 1 号')).not.toBeInTheDocument()
    await user.click(within(detail).getByRole('button', { name: '查看隐私信息' }))

    const authorization = screen.getByRole('dialog', { name: '授权' })
    const supervisorId = within(authorization).getByLabelText('收寄隐私主管工号')
    expect(supervisorId).toHaveValue('')
    await user.type(supervisorId, DEMO_SUPERVISOR_ID)
    const password = within(authorization).getByLabelText('收寄隐私主管密码')
    await user.type(password, 'wrong')
    await user.click(within(authorization).getByRole('button', { name: '确认授权' }))
    expect(within(authorization).getByRole('alert')).toHaveTextContent('授权人员密码校验失败')
    await user.clear(password)
    await user.type(password, DEMO_SUPERVISOR_SECRET)
    await user.click(within(authorization).getByRole('button', { name: '确认授权' }))

    expect(screen.queryByRole('dialog', { name: '授权' })).not.toBeInTheDocument()
    expect(within(detail).getByText('10000000001')).toBeInTheDocument()
    expect(within(detail).getByText('990101199001010035')).toBeInTheDocument()
    expect(within(detail).getByText('瀚原省栖沄市景麓区示范路 1 号')).toBeInTheDocument()
  })
})
