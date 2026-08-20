import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import type { CustomerDraft } from '../../domain/customer/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { SupplementaryTrafficWorkspace } from './SupplementaryTrafficWorkspace'

const agreementCustomer: CustomerDraft = {
  productFamily: 'basic-letter',
  destinationRegion: 'domestic',
  sender: {
    ...createEmptySender(),
    agreementAccountId: '99001000000001',
    agreementAccountName: '澜京长风文书服务中心',
    contact: '10000000016',
    name: '林澜',
    detailedAddress: '瀚原省栖沄市景麓区新程路18号',
    postalCode: '110022',
  },
  recipient: createEmptyRecipient(),
  status: 'customer-ready',
  updatedAt: '2026-08-10T09:50:00.000Z',
}

describe('SupplementaryTrafficWorkspace', () => {
  it('runs supplement, bulk, single-journey, round-trip and statistics as one workflow', async () => {
    const repository = MemoryServiceRepository.create()
    const onSummaryChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SupplementaryTrafficWorkspace
        customerDraft={agreementCustomer}
        onOpenSettlement={() => undefined}
        onSummaryChange={onSummaryChange}
        repository={repository}
      />,
    )

    expect(await screen.findByRole('region', { name: '补录/交管' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '请选择补录科目' }))
    const subjectDialog = screen.getByRole('dialog', { name: '补录科目' })
    await user.click(within(subjectDialog).getByRole('radio', {
      name: '选择科目 第三方平台产品推广',
    }))
    await user.click(within(subjectDialog).getByRole('button', { name: '选择' }))
    await user.type(screen.getByRole('textbox', { name: '补录金额 1' }), '12.50')
    await user.selectOptions(screen.getByRole('combobox', { name: '补录付费方式 1' }), 'credit')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('补录保存成功，共 1 条，已提交至结算中心。')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '交管大宗邮件收寄' }))
    const bulkCapture = screen.getByRole('dialog', { name: '邮件号码采集' })
    await user.type(within(bulkCapture).getByRole('textbox', { name: '采集邮件号码' }), '1115206600001')
    await user.click(within(bulkCapture).getByRole('button', { name: '确定' }))
    expect(screen.getByRole('textbox', { name: '交管大宗邮件号码' })).toHaveValue('1115206600001')
    await user.click(screen.getByRole('button', { name: '录入' }))
    expect(await screen.findByText(/录入成功：JG-\d{8}-000002/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '单程邮件投递缴款' }))
    await user.click(screen.getByRole('button', { name: '缴款' }))
    const singleDialog = screen.getByRole('dialog', { name: '单程邮件投递缴款' })
    await user.type(within(singleDialog).getByRole('textbox', { name: '单程缴款邮件号码' }), '1115206600002')
    await user.type(within(singleDialog).getByRole('textbox', { name: '单程到付邮费' }), '18.00')
    expect(within(singleDialog).getByRole('textbox', { name: '单程工本费' })).toHaveValue('15.00')
    await user.click(within(singleDialog).getByRole('button', { name: '确定' }))
    expect(await screen.findByText(/缴款保存成功：DC-\d{8}-000003/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '双程邮件返程收寄' }))
    const roundCapture = screen.getByRole('dialog', { name: '邮件号码采集' })
    await user.type(within(roundCapture).getByRole('textbox', { name: '采集邮件号码' }), '1115202400001')
    await user.click(within(roundCapture).getByRole('button', { name: '确定' }))
    await user.click(screen.getByRole('button', { name: '计费' }))
    expect(screen.getByRole('textbox', { name: '双程总邮资' })).toHaveValue('12.50')
    await user.click(screen.getByRole('button', { name: '录入' }))
    expect(await screen.findByText(/录入成功：SC-\d{8}-000004/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '交管邮件接收统计' }))
    expect(screen.getByRole('cell', { name: '1115206600001' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '1115206600002' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '1115202400001' })).toBeInTheDocument()

    await expect(repository.load()).resolves.toMatchObject({
      schemaVersion: 38,
      nextSupplementaryTrafficSequence: 5,
      supplementaryTrafficRecords: [
        { kind: 'supplementary-income', subjectCode: '1YWBL01047', amountCents: 1250 },
        { kind: 'traffic-bulk-mail', amountCents: 1500 },
        { kind: 'single-journey-payment', amountCents: 1800 },
        { kind: 'round-trip-return', amountCents: 1250 },
      ],
    })
    expect(onSummaryChange).toHaveBeenLastCalledWith({ count: 4, totalCents: 5800 })
  })
})
