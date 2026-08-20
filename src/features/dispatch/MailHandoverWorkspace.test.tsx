import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { queryUnsealedMail } from '../../domain/service/mailSealing'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import type { ServiceOperatorSnapshot } from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { createTestInternalHandoverAuthorizer } from '../../test/workAuthorization'
import { MailHandoverWorkspace } from './MailHandoverWorkspace'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '林青禾',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '栖沄邮件处理中心',
  institutionCode: '99901001',
}

const receivingOperator: ServiceOperatorSnapshot = {
  operatorId: '81000001',
  displayName: '演示接收员',
  workstationCode: '02',
  acceptanceOffice: '栖沄邮件处理中心',
  receivingOffice: '栖沄邮件处理中心',
  institutionCode: '99101001',
}

const receivingEmployees = [{ id: '81000001', name: '演示柜员' }]
const authorizeInternalHandover = createTestInternalHandoverAuthorizer(operator.operatorId)

async function addSettledMail(
  repository: MemoryServiceRepository,
  itemCode: string,
  acceptedAt = new Date().toISOString(),
) {
  const product = SERVICE_PRODUCTS.find((item) => item.id === 'registered-letter-200')!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    destinationZone: 'nonlocal' as const,
    itemCode,
    weightGrams: 20,
  }
  const accepted = await repository.accept({
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: { ...createEmptySender(), name: '训练寄件人' },
      recipient: {
        ...createEmptyRecipient(),
        name: '训练收件人',
        detailedAddress: '瀚原省栖沄市景麓区演练路 8 号',
      },
    },
    draft,
    product,
    operator,
  })
  await repository.settle({
    transactionIds: [accepted.transaction.id],
    tender: 'cash',
    settledAt: acceptedAt,
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  return accepted.transaction
}

async function addGeneratedBag(repository: MemoryServiceRepository) {
  const product = SERVICE_PRODUCTS.find((item) => item.id === 'ordinary-letter-100')!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    destinationZone: 'nonlocal' as const,
    weightGrams: 20,
  }
  const accepted = await repository.accept({
    acceptedAt: new Date().toISOString(),
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: { ...createEmptySender(), name: '训练寄件人' },
      recipient: {
        ...createEmptyRecipient(),
        name: '训练收件人',
        detailedAddress: '瀚原省栖沄市景麓区演练路 8 号',
      },
    },
    draft,
    product,
    operator,
  })
  await repository.settle({
    transactionIds: [accepted.transaction.id],
    tender: 'cash',
    settledAt: new Date().toISOString(),
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  const state = await repository.load()
  const group = queryUnsealedMail(state, {
    operatorId: '',
    bulkFlag: 'all',
    acceptedDateFrom: '',
    acceptedDateTo: '',
  }).groups[0]!
  const result = await repository.executeMailSealing({
    type: 'generate-dispatch-bags',
    manifests: [{
      mailReferences: group.items.map((item) => item.reference),
      manifestNumber: '501',
      receptacleType: '1.袋',
      usesBarcodeContainer: false,
      containerBarcode: '',
      rfidBagTagNumber: '',
    }],
    shift: '01',
    institutionCode: '99901001',
    generatedAt: new Date().toISOString(),
    operator,
  })
  return result.bags[0]!
}

describe('MailHandoverWorkspace', () => {
  it('defaults to the real business day and still permits an explicit historical query', async () => {
    const repository = MemoryServiceRepository.create()
    await addSettledMail(repository, 'RA12345678900', '2026-01-15T01:00:00.000Z')
    const user = userEvent.setup()

    render(
      <MailHandoverWorkspace
        canHandOverLoose
        canProcessReceivedMail={false}
        institutionCode="99901001"
        now={new Date('2026-08-19T01:00:00.000Z')}
        onBack={() => undefined}
        operator={operator}
        repository={repository}
        receivingEmployees={receivingEmployees}
        authorizeInternalHandover={authorizeInternalHandover}
      />,
    )

    expect(await screen.findByLabelText('交接收寄开始日期')).toHaveValue('2026-08-19')
    expect(screen.getByLabelText('交接收寄结束日期')).toHaveValue('2026-08-19')
    expect(screen.queryByText('RA12345678900')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '散件接收' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '总包交出' })).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('交接收寄开始日期'))
    await user.type(screen.getByLabelText('交接收寄开始日期'), '2026-01-15')
    await user.clear(screen.getByLabelText('交接收寄结束日期'))
    await user.type(screen.getByLabelText('交接收寄结束日期'), '2026-01-15')
    await user.click(screen.getByRole('button', { name: '明细查询' }))
    expect(await screen.findByText('RA12345678900')).toBeInTheDocument()
  })

  it('shows only receipt and bag duties to the dispatch role', async () => {
    const repository = MemoryServiceRepository.create()
    render(
      <MailHandoverWorkspace
        canHandOverLoose={false}
        canProcessReceivedMail
        institutionCode="99901001"
        now={new Date('2026-08-19T01:00:00.000Z')}
        onBack={() => undefined}
        operator={operator}
        repository={repository}
        receivingEmployees={receivingEmployees}
        authorizeInternalHandover={authorizeInternalHandover}
      />,
    )

    expect(await screen.findByRole('button', { name: '散件接收' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '总包交出' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '总包接收' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '散件交出' })).not.toBeInTheDocument()
  })

  it('hands over cross-office loose mail and completes receipt with direct-seal state', async () => {
    const user = userEvent.setup()
    const repository = MemoryServiceRepository.create()
    await addSettledMail(repository, 'RA12345678901')

    const view = render(
      <MailHandoverWorkspace
        canHandOverLoose
        canProcessReceivedMail
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
        receivingEmployees={receivingEmployees}
        authorizeInternalHandover={authorizeInternalHandover}
      />,
    )

    await user.click(await screen.findByRole('checkbox', { name: '选择交接邮件 RA12345678901' }))
    await user.click(screen.getByRole('button', { name: '交出' }))
    const handoverDialog = screen.getByRole('dialog', { name: '选择接收机构及员工' })
    await user.selectOptions(
      within(handoverDialog).getByRole('combobox', { name: '邮件交接接收机构' }),
      '99101001',
    )
    await user.click(within(handoverDialog).getByRole('button', { name: '确认交出' }))
    expect(await screen.findByRole('status')).toHaveTextContent('交出成功，共 1 件')

    view.rerender(
      <MailHandoverWorkspace
        canHandOverLoose
        canProcessReceivedMail
        institutionCode="99101001"
        onBack={() => undefined}
        operator={receivingOperator}
        repository={repository}
        receivingEmployees={receivingEmployees}
        authorizeInternalHandover={authorizeInternalHandover}
      />,
    )
    await user.click(screen.getByRole('button', { name: '散件接收' }))
    const receiptSelection = await screen.findByRole('checkbox', { name: '选择交接邮件 RA12345678901' })
    await user.click(receiptSelection)
    await user.click(screen.getByRole('button', { name: '直封/非直封' }))
    expect(await screen.findByRole('status')).toHaveTextContent('切换为直封')
    expect(screen.getByRole('cell', { name: '直封' })).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: '选择交接邮件 RA12345678901' }))
    await user.click(screen.getByRole('button', { name: '接收' }))
    expect(await screen.findByRole('status')).toHaveTextContent('接收成功，共 1 件')

    await user.click(screen.getByRole('radio', { name: '已接收' }))
    await user.click(screen.getByRole('button', { name: '明细查询' }))
    expect(await screen.findByText('已接收', { selector: '.mail-handover__status' }))
      .toBeInTheDocument()
  })

  it('selects a consecutive visible sequence through the batch dialog', async () => {
    const user = userEvent.setup()
    const repository = MemoryServiceRepository.create()
    await addSettledMail(repository, 'RA12345678901')
    await addSettledMail(repository, 'RA12345678902')

    render(
      <MailHandoverWorkspace
        canHandOverLoose
        canProcessReceivedMail
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
        receivingEmployees={receivingEmployees}
        authorizeInternalHandover={authorizeInternalHandover}
      />,
    )

    await screen.findByText('RA12345678901')
    await user.click(screen.getByRole('button', { name: '批量选择' }))
    const dialog = screen.getByRole('dialog', { name: '请输入需要交出的序号' })
    await user.clear(within(dialog).getByRole('textbox', { name: '交接序号止号' }))
    await user.type(within(dialog).getByRole('textbox', { name: '交接序号止号' }), '2')
    await user.click(within(dialog).getByRole('button', { name: '确定' }))

    expect(await screen.findByRole('status')).toHaveTextContent('批量选择完成，共选择 2 件')
    expect(screen.getByRole('checkbox', { name: '选择交接邮件 RA12345678901' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '选择交接邮件 RA12345678902' })).toBeChecked()
  })

  it('hands over and receives a generated dispatch bag with a required receipt shift', async () => {
    const user = userEvent.setup()
    const repository = MemoryServiceRepository.create()
    const bag = await addGeneratedBag(repository)

    const view = render(
      <MailHandoverWorkspace
        canHandOverLoose
        canProcessReceivedMail
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
        receivingEmployees={receivingEmployees}
        authorizeInternalHandover={authorizeInternalHandover}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '总包交出' }))
    await user.click(await screen.findByRole('checkbox', { name: `选择总包 ${bag.bagBarcode}` }))
    await user.click(screen.getByRole('button', { name: '交出' }))
    const officeDialog = screen.getByRole('dialog', { name: '选择总包接收机构' })
    await user.selectOptions(
      within(officeDialog).getByRole('combobox', { name: '总包接收机构' }),
      '99101001',
    )
    await user.click(within(officeDialog).getByRole('button', { name: '确定' }))
    expect(await screen.findByRole('status')).toHaveTextContent('总包交出成功，共 1 袋')

    view.rerender(
      <MailHandoverWorkspace
        canHandOverLoose
        canProcessReceivedMail
        institutionCode="99101001"
        onBack={() => undefined}
        operator={receivingOperator}
        repository={repository}
        receivingEmployees={receivingEmployees}
        authorizeInternalHandover={authorizeInternalHandover}
      />,
    )
    await user.click(screen.getByRole('button', { name: '总包接收' }))
    await user.click(await screen.findByRole('checkbox', { name: `选择总包 ${bag.bagBarcode}` }))
    await user.click(screen.getByRole('button', { name: '接收' }))
    const shiftDialog = screen.getByRole('dialog', { name: '选择班次' })
    await user.selectOptions(
      within(shiftDialog).getByRole('combobox', { name: '总包目标班次' }),
      '02',
    )
    await user.click(within(shiftDialog).getByRole('button', { name: '确定' }))
    expect(await screen.findByRole('status')).toHaveTextContent('总包接收成功，共 1 袋')
    expect((await repository.load()).dispatchBagHandovers[0]).toMatchObject({
      status: 'received',
      receiptShift: '02',
    })
  })
})
