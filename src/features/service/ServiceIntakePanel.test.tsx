import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import type { CustomerDraft, ProductFamily } from '../../domain/customer/types'
import type { ServiceRepository } from '../../domain/service/repository'
import { remainingPostalSupplyStock } from '../../domain/service/transactions'
import { MemoryCustomerRepository } from '../../infrastructure/memory/MemoryCustomerRepository'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { ServiceIntakePanel } from './ServiceIntakePanel'

function createReadyCustomerDraft(
  productFamily: ProductFamily = 'basic-letter',
): CustomerDraft {
  return {
    productFamily,
    destinationRegion: 'domestic',
    sender: {
      ...createEmptySender(),
      contact: '10000000025',
      name: '演示寄件人',
      detailedAddress: '瀚原省栖沄市景麓区演示路 1 号',
      identityType: 'primary',
      identityValue: '990101194912310044',
    },
    recipient: {
      ...createEmptyRecipient(),
      contact: '10000000026',
      name: '演示收件人',
      detailedAddress: '澄岐省澄野市江洲区演示路 2 号',
    },
    status: 'customer-ready',
    updatedAt: '2026-01-15T09:00:00.000Z',
  }
}

function createAgreementCustomerDraft(
  productFamily: ProductFamily = 'standard-delivery',
): CustomerDraft {
  const draft = createReadyCustomerDraft(productFamily)
  return {
    ...draft,
    sender: {
      ...draft.sender,
      agreementAccountId: 'AGREEMENT-DEMO-001',
      agreementAccountName: '虚构寄递机构演示协议客户',
    },
  }
}

async function fillValidBarcodeLetter(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    await screen.findByRole('combobox', { name: '服务区域' }),
    'local',
  )
  const productSearch = await screen.findByRole('combobox', {
    name: '业务产品检索',
  })
  await user.type(productSearch, '107')
  await user.click(
    screen.getByRole('treeitem', { name: '选择 条码平信 107' }),
  )
  expect(productSearch).toHaveValue('条码平信')
  await user.type(screen.getByRole('textbox', { name: '邮件条码' }), '7000818316568')
  await user.click(screen.getByRole('button', { name: '计重' }))
}

describe('ServiceIntakePanel', () => {
  it('loads product, region, destination and weight from business recommendation', async () => {
    render(
      <ServiceIntakePanel
        customerDraft={createReadyCustomerDraft()}
        customerRepository={MemoryCustomerRepository.create()}
        initialRecommendation={{
          id: 'recommendation-001',
          productId: 'ordinary-letter-100',
          productFamily: 'basic-letter',
          destinationZone: 'nonlocal',
          destinationOffice: '云港区',
          destinationLabel: '瀚原 / 栖沄 / 云港',
          weightGrams: 300,
          remark: 'ordinary-letter',
        }}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={MemoryServiceRepository.create()}
      />,
    )

    expect(await screen.findByRole('combobox', { name: '业务产品检索' }))
      .toHaveValue('平常信函')
    expect(screen.getByRole('combobox', { name: '服务区域' })).toHaveValue('nonlocal')
    expect(screen.getByRole('spinbutton', { name: '邮件重量' })).toHaveValue(300)
  })

  it('renders two-digit parents, three-digit children, and a name-only selected value', async () => {
    const user = userEvent.setup()
    render(
      <ServiceIntakePanel
        customerDraft={createReadyCustomerDraft()}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={MemoryServiceRepository.create()}
      />,
    )

    const productSearch = await screen.findByRole('combobox', {
      name: '业务产品检索',
    })
    await user.click(productSearch)
    await user.click(screen.getByRole('treeitem', { name: '展开 平常印刷品 11' }))
    expect(
      within(screen.getByRole('tree')).getAllByRole('treeitem')
        .map((item) => item.getAttribute('aria-label'))
        .filter((label) => label?.startsWith('选择 ')),
    ).toEqual([
      '选择 平常印刷品 110',
      '选择 盲人邮件 111',
      '选择 平常印刷品专袋 112',
      '选择 跨境平常印刷品 113',
      '选择 协议平常印刷品 114',
      '选择 协议客户平常印刷品 115',
      '选择 条码平刷 117',
      '选择 巡视平刷 118',
    ])
    await user.click(screen.getByRole('treeitem', { name: '选择 条码平刷 117' }))
    expect(productSearch).toHaveValue('条码平刷')

    await user.clear(productSearch)
    await user.click(productSearch)
    const ordinaryPrintedMatter = screen.getByRole('treeitem', {
      name: '选择 平常印刷品 110',
    })
    expect(ordinaryPrintedMatter).toBeEnabled()
    await user.click(ordinaryPrintedMatter)
    expect(productSearch).toHaveValue('平常印刷品')
    await user.selectOptions(
      screen.getByRole('combobox', { name: '服务区域' }),
      'local',
    )
    await user.click(screen.getByRole('button', { name: '计重' }))
    await user.click(screen.getByRole('button', { name: '计费' }))
    expect(within(screen.getByLabelText('费用摘要')).getAllByText('¥ 0.80'))
      .toHaveLength(3)

    await user.clear(productSearch)
    await user.type(productSearch, '106')
    expect(screen.getByText('没有匹配的业务产品')).toBeInTheDocument()

    await user.clear(productSearch)
    await user.type(productSearch, '107')
    await user.click(screen.getByRole('treeitem', { name: '选择 条码平信 107' }))
    expect(productSearch).toHaveValue('条码平信')
  })

  it('prices and submits current agreement printed matter 114', async () => {
    const serviceRepository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(
      <ServiceIntakePanel
        customerDraft={createAgreementCustomerDraft('basic-letter')}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={serviceRepository}
      />,
    )

    expect(await screen.findByRole('combobox', { name: '付费方式' }))
      .toHaveValue('cash-settlement')
    await user.selectOptions(
      await screen.findByRole('combobox', { name: '服务区域' }),
      'local',
    )
    const productSearch = screen.getByRole('combobox', {
      name: '业务产品检索',
    })
    await user.type(productSearch, '114')
    await user.click(screen.getByRole('treeitem', {
      name: '选择 协议平常印刷品 114',
    }))
    expect(productSearch).toHaveValue('协议平常印刷品')
    await user.click(screen.getByRole('button', { name: '计重' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: '付费方式' }),
      'cash-settlement',
    )
    await user.click(screen.getByRole('button', { name: '计费' }))
    expect(within(screen.getByLabelText('费用摘要')).getAllByText('¥ 0.80'))
      .toHaveLength(3)

    await user.click(screen.getByRole('button', { name: '提交' }))
    await expect(serviceRepository.load()).resolves.toMatchObject({
      transactions: [{
        product: {
          id: 'catalog-114',
          searchCode: '114',
          effectiveBusinessCode: '114000',
        },
        charge: { postageCents: 80, settlementDueCents: 80 },
      }],
    })
  })

  it('disables unsupported regions and clears an incompatible earlier selection', async () => {
    const user = userEvent.setup()
    render(
      <ServiceIntakePanel
        customerDraft={createReadyCustomerDraft('standard-delivery')}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onDestinationZoneChange={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={MemoryServiceRepository.create()}
      />,
    )

    const region = await screen.findByRole('combobox', { name: '服务区域' })
    await user.selectOptions(region, 'local')
    const productSearch = screen.getByRole('combobox', {
      name: '业务产品检索',
    })
    await user.type(productSearch, '253')
    await user.click(screen.getByRole('treeitem', {
      name: '选择 增强产品 253',
    }))

    expect(region).toHaveValue('')
    expect(within(region).getByRole('option', { name: '本埠' })).toBeDisabled()
    expect(within(region).getByRole('option', { name: '外埠' })).toBeDisabled()
    expect(within(region).getByRole('option', { name: '国际' })).toBeEnabled()
    expect(within(region).getByRole('option', { name: '特区（美丽岛）' }))
      .toBeEnabled()
  })

  it('prices first, submits second, persists, and only then promotes customer history', async () => {
    const customerRepository = MemoryCustomerRepository.create()
    const serviceRepository = MemoryServiceRepository.create()
    const customerDraft = createReadyCustomerDraft()
    const user = userEvent.setup()

    render(
      <ServiceIntakePanel
        customerDraft={customerDraft}
        customerRepository={customerRepository}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={serviceRepository}
      />,
    )

    await fillValidBarcodeLetter(user)
    await user.click(screen.getByRole('button', { name: '计费' }))

    const summary = screen.getByLabelText('费用摘要')
    expect(within(summary).getAllByText('¥ 0.80')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '提交' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '邮件条码' })).toHaveValue('7000818316568')

    await user.click(screen.getByRole('button', { name: '提交' }))

    expect(await screen.findByText(/^SIM-\d{8}-000001$/u)).toBeInTheDocument()
    await expect(serviceRepository.load()).resolves.toMatchObject({
      transactions: [{
        id: expect.stringMatching(/^SIM-\d{8}-000001$/u),
        status: 'pending-settlement',
        product: {
          searchCode: '107',
          effectiveBusinessCode: '107000',
        },
        charge: { postageCents: 80, settlementDueCents: 80 },
      }],
    })
    await expect(customerRepository.load()).resolves.toMatchObject({
      senderHistory: [
        { id: 'sender-001' },
        { id: 'sender-002' },
        { id: 'sender-003' },
        { id: 'sender-004', name: '演示寄件人' },
      ],
      recipientHistory: [
        { id: 'recipient-001' },
        { id: 'recipient-002' },
        { id: 'recipient-003' },
        { id: 'recipient-004', name: '演示收件人' },
      ],
    })
  })

  it('invalidates a quote when a business field changes', async () => {
    const user = userEvent.setup()
    render(
      <ServiceIntakePanel
        customerDraft={createReadyCustomerDraft()}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={MemoryServiceRepository.create()}
      />,
    )
    await fillValidBarcodeLetter(user)
    await user.click(screen.getByRole('button', { name: '计费' }))
    expect(screen.getByRole('button', { name: '提交' })).toBeInTheDocument()
    await user.clear(screen.getByRole('spinbutton', { name: '邮件重量' }))
    await user.type(screen.getByRole('spinbutton', { name: '邮件重量' }), '21')
    expect(screen.getByRole('button', { name: '计费' })).toBeInTheDocument()
  })

  it('prices a domestic postcard through the barcode-letter product remark', async () => {
    const user = userEvent.setup()
    render(
      <ServiceIntakePanel
        customerDraft={createReadyCustomerDraft()}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={MemoryServiceRepository.create()}
      />,
    )

    await fillValidBarcodeLetter(user)
    await user.selectOptions(
      screen.getByRole('combobox', { name: '邮件备注' }),
      'postcard',
    )
    expect(screen.getByRole('combobox', { name: '邮件备注' }))
      .toHaveValue('postcard')
    await user.click(screen.getByRole('button', { name: '计费' }))

    const summary = screen.getByLabelText('费用摘要')
    expect(within(summary).getByText('明信片基本资费')).toBeInTheDocument()
    expect(within(summary).getAllByText('¥ 0.80')).toHaveLength(3)
  })

  it('accepts a nonlocal registered letter with a return receipt request', async () => {
    const serviceRepository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    render(
      <ServiceIntakePanel
        customerDraft={createReadyCustomerDraft('standard-delivery')}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={serviceRepository}
      />,
    )

    expect(await screen.findAllByText('给据函件收寄')).not.toHaveLength(0)
    expect(screen.queryByText(/20 至 26 父类下的全部三位产品均已开放/))
      .not.toBeInTheDocument()
    await user.selectOptions(
      screen.getByRole('combobox', { name: '服务区域' }),
      'nonlocal',
    )
    const productSearch = screen.getByRole('combobox', {
      name: '业务产品检索',
    })
    await user.type(productSearch, '200')
    await user.click(
      screen.getByRole('treeitem', { name: '选择 给据信函 200' }),
    )
    await user.type(
      screen.getByRole('textbox', { name: '邮件号码' }),
      'XK00000000001',
    )
    await user.click(screen.getByRole('button', { name: '计重' }))
    expect(screen.getByRole('spinbutton', { name: '邮件件数' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: '办理回执' }))

    await user.click(screen.getByRole('button', { name: '计费' }))
    const summary = screen.getByLabelText('费用摘要')
    expect(within(summary).getAllByText('¥ 3.00')).toHaveLength(2)
    expect(within(summary).getByText('¥ 1.20')).toBeInTheDocument()
    expect(within(summary).getAllByText('¥ 7.20')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: '提交' }))

    const receiptDialog = await screen.findByRole('dialog', {
      name: '是否打印国内挂号函件收据？',
    })
    const receipt = within(receiptDialog).getByRole('article', {
      name: '国内挂号函件收据',
    })
    expect(within(receipt).getByText('XK00000000001')).toBeInTheDocument()
    expect(within(receipt).getByText('200100')).toBeInTheDocument()
    expect(within(receipt).getByText('已办理')).toBeInTheDocument()
    expect(within(receipt).getAllByText('¥ 7.20')).toHaveLength(2)
    await user.click(within(receiptDialog).getByRole('button', { name: '打印' }))
    expect(print).toHaveBeenCalledOnce()
    expect(document.body).not.toHaveClass('service-receipt-printing')
    expect(receiptDialog).not.toBeInTheDocument()

    await expect(serviceRepository.load()).resolves.toMatchObject({
      transactions: [{
        product: {
          id: 'registered-letter-200',
          searchCode: '200',
          effectiveBusinessCode: '200100',
        },
        service: { itemCode: 'XK00000000001', returnReceiptRequested: true },
        charge: {
          returnReceiptCents: 300,
          postageCents: 720,
          settlementDueCents: 720,
        },
      }],
      returnReceipts: [{
        originalItemCode: 'XK00000000001',
        feeCents: 300,
        status: 'awaiting-return',
      }],
    })
  })

  it('prices and submits an agreement-only appointment product', async () => {
    const serviceRepository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(
      <ServiceIntakePanel
        customerDraft={createAgreementCustomerDraft()}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={serviceRepository}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: '服务区域' }),
      'local',
    )
    const productSearch = screen.getByRole('combobox', {
      name: '业务产品检索',
    })
    await user.type(productSearch, '240')
    await user.click(screen.getByRole('treeitem', {
      name: '选择 约投挂号账单标资 240',
    }))
    await user.type(
      screen.getByRole('textbox', { name: '邮件号码' }),
      'XK00000000001',
    )
    await user.click(screen.getByRole('button', { name: '计重' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: '付费方式' }),
      'cash-settlement',
    )
    await user.click(screen.getByRole('button', { name: '计费' }))

    const summary = screen.getByLabelText('费用摘要')
    expect(within(summary).getByText('给据/约投费')).toBeInTheDocument()
    expect(within(summary).getByText('¥ 5.00')).toBeInTheDocument()
    expect(within(summary).getAllByText('¥ 5.80')).toHaveLength(2)
    expect(screen.queryByText(/真实协议折扣不写入公开模拟器/))
      .not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '提交' }))
    await expect(serviceRepository.load()).resolves.toMatchObject({
      transactions: [{
        product: {
          id: 'catalog-240',
          searchCode: '240',
          effectiveBusinessCode: '240000',
        },
        charge: { postageCents: 580, settlementDueCents: 580 },
      }],
    })
  })

  it('keeps the selected route when the parent synchronizes its broad region', async () => {
    const user = userEvent.setup()
    const customerRepository = MemoryCustomerRepository.create()
    const serviceRepository = MemoryServiceRepository.create()
    const localDraft = createReadyCustomerDraft('standard-delivery')
    const sharedProps = {
      customerRepository,
      onCustomerCommitted: vi.fn(),
      onDestinationZoneChange: vi.fn(),
      onOpenSettlement: vi.fn(),
      onSummaryChange: vi.fn(),
      repository: serviceRepository,
    }
    const { rerender } = render(
      <ServiceIntakePanel customerDraft={localDraft} {...sharedProps} />,
    )

    const region = await screen.findByRole('combobox', { name: '服务区域' })
    await user.selectOptions(region, 'international')
    expect(region).toHaveValue('international')

    rerender(
      <ServiceIntakePanel
        customerDraft={{ ...localDraft, destinationRegion: 'overseas' }}
        {...sharedProps}
      />,
    )

    expect(screen.getByRole('combobox', { name: '服务区域' }))
      .toHaveValue('international')
    expect(screen.getByRole('combobox', { name: '国际寄达局' }))
      .toBeInTheDocument()
  })

  it('uses the international detailed product, country-only ordinary flow, and no mail number', async () => {
    const serviceRepository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    const customerDraft = {
      ...createReadyCustomerDraft('basic-letter'),
      destinationRegion: 'overseas' as const,
    }
    render(
      <ServiceIntakePanel
        customerDraft={customerDraft}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={serviceRepository}
      />,
    )

    const productSearch = await screen.findByRole('combobox', {
      name: '业务产品检索',
    })
    await user.selectOptions(
      screen.getByRole('combobox', { name: '服务区域' }),
      'international',
    )
    await user.type(productSearch, '100')
    await user.click(
      screen.getByRole('treeitem', { name: '选择 平常信函 100' }),
    )
    await user.selectOptions(screen.getByRole('combobox', { name: '国际寄达局' }), 'AU')
    expect(screen.queryByRole('textbox', { name: '邮件号码' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '邮件条码' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '计重' }))
    await user.click(screen.getByRole('button', { name: '计费' }))

    expect(within(screen.getByLabelText('费用摘要')).getAllByText('¥ 6.00'))
      .toHaveLength(3)
    await user.click(screen.getByRole('button', { name: '提交' }))
    await expect(serviceRepository.load()).resolves.toMatchObject({
      transactions: [{
        product: {
          id: 'ordinary-letter-100',
          searchCode: '100',
          effectiveBusinessCode: '100200',
        },
        service: { destinationOffice: 'AU', itemCode: '' },
        charge: { postageCents: 600 },
      }],
    })
  })

  it('requires a valid S10 number for an international registered letter', async () => {
    const serviceRepository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(
      <ServiceIntakePanel
        customerDraft={{
          ...createReadyCustomerDraft('standard-delivery'),
          destinationRegion: 'overseas',
        }}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={serviceRepository}
      />,
    )

    const productSearch = await screen.findByRole('combobox', {
      name: '业务产品检索',
    })
    await user.selectOptions(
      screen.getByRole('combobox', { name: '服务区域' }),
      'international',
    )
    await user.type(productSearch, '200')
    await user.click(
      screen.getByRole('treeitem', { name: '选择 给据信函 200' }),
    )
    await user.selectOptions(screen.getByRole('combobox', { name: '国际寄达局' }), 'AU')
    await user.type(screen.getByRole('textbox', { name: '邮件号码' }), 'XK00000000001')
    await user.click(screen.getByRole('button', { name: '计重' }))
    await user.click(screen.getByRole('button', { name: '计费' }))
    expect(screen.getByText(/须使用有效的 13 位 S10 号码/)).toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: '邮件号码' }))
    await user.type(screen.getByRole('textbox', { name: '邮件号码' }), 'RR473124829CN')
    await user.click(screen.getByRole('button', { name: '计费' }))
    const summary = screen.getByLabelText('费用摘要')
    expect(within(summary).getByText('¥ 16.00')).toBeInTheDocument()
    expect(within(summary).getAllByText('¥ 22.00')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: '提交' }))
    const receiptDialog = await screen.findByRole('dialog', {
      name: '是否打印国际给据函件收寄凭据？',
    })
    const receipt = within(receiptDialog).getByRole('article', {
      name: '国际给据函件收寄凭据',
    })
    expect(within(receipt).getByText('RR473124829CN')).toBeInTheDocument()
    expect(within(receipt).getByText('远洋演练区-021（AU）')).toBeInTheDocument()
    expect(within(receipt).queryByText('澄岐省澄野市江洲区演示路 2 号'))
      .not.toBeInTheDocument()
    await expect(serviceRepository.load()).resolves.toMatchObject({
      transactions: [{
        product: { effectiveBusinessCode: '200200' },
        service: { destinationOffice: 'AU', itemCode: 'RR473124829CN' },
      }],
    })
  })

  it('applies the zero-postage people-letter rule and locks self-affixed payment', async () => {
    const user = userEvent.setup()
    render(
      <ServiceIntakePanel
        customerDraft={createReadyCustomerDraft()}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={MemoryServiceRepository.create()}
      />,
    )
    await fillValidBarcodeLetter(user)
    await user.selectOptions(
      screen.getByRole('combobox', { name: '邮件备注' }),
      'people-letter',
    )
    expect(screen.getByRole('combobox', { name: '付费方式' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '付费方式' })).toHaveValue('self-affixed')
    expect(screen.queryByText(/若同时销售包装物/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '计费' }))
    const summary = screen.getByLabelText('费用摘要')
    expect(within(summary).getAllByText('¥ 0.00')).toHaveLength(5)
  })

  it('takes a 307 parcel sticker through volumetric validation and settlement queue', async () => {
    const serviceRepository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(
      <ServiceIntakePanel
        customerDraft={createReadyCustomerDraft('parcel')}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={serviceRepository}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: '服务区域' }),
      'local',
    )
    const productSearch = screen.getByRole('combobox', { name: '业务产品检索' })
    await user.type(productSearch, '307')
    await user.click(screen.getByRole('treeitem', { name: '选择 家乡包裹贴 307' }))
    await user.type(screen.getByRole('textbox', { name: '邮件号码' }), 'PU13131313435')
    await user.type(screen.getByRole('textbox', { name: '明信片条码' }), '12345678901234')
    await user.click(screen.getByRole('button', { name: '计重' }))
    await user.type(screen.getByRole('spinbutton', { name: '邮件长' }), '20')
    await user.type(screen.getByRole('spinbutton', { name: '邮件宽' }), '20')
    await user.type(screen.getByRole('spinbutton', { name: '邮件高' }), '51')
    await user.click(screen.getByRole('button', { name: '计费' }))
    expect(screen.getByText(/计费重量（实际重量与体积重量取大值）/)).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: '邮件备注' }), 'parcel-11')
    await user.click(screen.getByRole('button', { name: '计费' }))
    expect(within(screen.getByLabelText('费用摘要')).getAllByText('¥ 11.00'))
      .toHaveLength(3)
    await user.click(screen.getByRole('button', { name: '提交' }))

    await expect(serviceRepository.load()).resolves.toMatchObject({
      transactions: [{
        product: { searchCode: '307', effectiveBusinessCode: '307000' },
        service: {
          postcardBarcode: '12345678901234',
          remark: 'parcel-11',
          lengthCm: 20,
          widthCm: 20,
          heightCm: 51,
        },
        charge: { postageCents: 1100 },
      }],
    })
  })

  it('opens the 301 item picker, auto-fills contents, and persists stock-backed lines', async () => {
    const serviceRepository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(
      <ServiceIntakePanel
        customerDraft={createReadyCustomerDraft('parcel')}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={serviceRepository}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: '服务区域' }),
      'local',
    )
    const productSearch = screen.getByRole('combobox', { name: '业务产品检索' })
    await user.type(productSearch, '301')
    await user.click(screen.getByRole('treeitem', { name: '选择 家乡包裹 301' }))

    expect(screen.getByRole('dialog', { name: '用邮物品信息' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByRole('alert')).toHaveTextContent('至少一种物品')
    await user.click(screen.getByRole('button', { name: '增加' }))
    expect(screen.getByRole('dialog', { name: '物品名称检索' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '301物品检索' }), 'GWLH')
    await user.click(screen.getByRole('checkbox', { name: '选择301物品 演示谷物礼盒' }))
    await user.click(screen.getByRole('button', { name: '确定' }))

    const quantity = screen.getByRole('spinbutton', {
      name: '301物品数量 演示谷物礼盒',
    })
    await user.clear(quantity)
    await user.type(quantity, '2')
    expect(screen.getAllByText('¥ 136.00')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '内件信息' }))
      .toHaveValue('演示谷物礼盒×2')
    expect(screen.queryByText(/目录金额 ¥ 136.00/)).not.toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: '邮件号码' }), 'PA13131313435')
    await user.click(screen.getByRole('button', { name: '计重' }))
    await user.type(screen.getByRole('textbox', { name: '寄递平台报价' }), '20')
    await user.click(screen.getByRole('button', { name: '计费' }))
    await user.click(screen.getByRole('button', { name: '提交' }))

    const state = await serviceRepository.load()
    expect(state.transactions).toMatchObject([{
      product: { searchCode: '301', effectiveBusinessCode: '301000' },
      service: {
        contents: '演示谷物礼盒×2',
        contentItems: [{
          itemId: 'supply-demo-grain-gift-box',
          quantity: 2,
          amountCents: 13600,
        }],
        platformQuoteCents: 2000,
      },
      charge: { postageCents: 2000 },
    }])
    expect(remainingPostalSupplyStock(state, 'supply-demo-grain-gift-box')).toBe(38)
  })

  it('takes 404 standard express through goods, platform quote, and dedicated number rules', async () => {
    const serviceRepository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(
      <ServiceIntakePanel
        customerDraft={createReadyCustomerDraft('express')}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={serviceRepository}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: '服务区域' }),
      'nonlocal',
    )
    const productSearch = screen.getByRole('combobox', { name: '业务产品检索' })
    await user.type(productSearch, '404')
    await user.click(screen.getByRole('treeitem', { name: '选择 标准快递 404' }))
    await user.type(screen.getByRole('textbox', { name: '邮件条码' }), '8970000000X99')
    await user.selectOptions(screen.getByRole('combobox', { name: '邮件备注' }), 'goods')
    await user.click(screen.getByRole('button', { name: '计重' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '寄递平台分区' }), '6')
    await user.type(screen.getByRole('spinbutton', { name: '邮件长' }), '50')
    await user.type(screen.getByRole('spinbutton', { name: '邮件宽' }), '30')
    await user.type(screen.getByRole('spinbutton', { name: '邮件高' }), '20')
    await user.type(screen.getByRole('textbox', { name: '内件信息' }), '演示文件袋')
    const platformQuote = screen.getByRole('textbox', { name: '寄递平台报价' })
    await user.type(platformQuote, '125.68')
    expect(platformQuote).toHaveValue('125.68')
    expect(within(screen.getByRole('combobox', { name: '付费方式' }))
      .queryByRole('option', { name: '贴票' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '计费' }))
    expect(screen.getByRole('note')).toHaveTextContent('体积重量 6000 克')
    expect(within(screen.getByLabelText('费用摘要')).getAllByText('¥ 125.68'))
      .toHaveLength(3)
    await user.click(screen.getByRole('button', { name: '提交' }))

    await expect(serviceRepository.load()).resolves.toMatchObject({
      transactions: [{
        product: { searchCode: '404', effectiveBusinessCode: '404100' },
        service: {
          itemCode: '8970000000X99',
          remark: 'goods',
          contents: '演示文件袋',
          parcelTariffZone: '6',
          platformQuoteCents: 12568,
        },
        charge: { postageCents: 12568 },
      }],
    })
  })

  it('accepts natural multi-digit decimals in every editable service amount', async () => {
    const user = userEvent.setup()
    render(
      <ServiceIntakePanel
        customerDraft={createReadyCustomerDraft('parcel')}
        customerRepository={MemoryCustomerRepository.create()}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={MemoryServiceRepository.create()}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: '服务区域' }),
      'local',
    )
    const productSearch = screen.getByRole('combobox', { name: '业务产品检索' })
    await user.type(productSearch, '300')
    await user.click(screen.getByRole('treeitem', { name: '选择 普通包裹 300' }))

    const declaredValue = screen.getByRole('textbox', { name: '保价金额' })
    await user.type(declaredValue, '1234.56')
    expect(declaredValue).toHaveValue('1234.56')
    await user.clear(declaredValue)

    const insuranceValue = screen.getByRole('textbox', { name: '保险金额' })
    await user.type(insuranceValue, '8765.43')
    expect(insuranceValue).toHaveValue('8765.43')

    await user.selectOptions(
      screen.getByRole('combobox', { name: '付费方式' }),
      'stamp',
    )
    const stampAmount = screen.getByRole('textbox', { name: '贴票总金额' })
    await user.type(stampAmount, '128.80')
    expect(stampAmount).toHaveValue('128.80')
  })

  it('leaves customer history untouched when transaction persistence fails', async () => {
    const customerRepository = MemoryCustomerRepository.create()
    const backingRepository = MemoryServiceRepository.create()
    const failingRepository: ServiceRepository = {
      load: () => backingRepository.load(),
      saveDraft: (draft) => backingRepository.saveDraft(draft),
      accept: async () => {
        throw new Error('simulated local write failure')
      },
      acceptPostalSupplySale: (request) =>
        backingRepository.acceptPostalSupplySale(request),
      acceptChannelProductOrder: (request) =>
        backingRepository.acceptChannelProductOrder(request),
      recordChannelProductReceiptPrint: (request) =>
        backingRepository.recordChannelProductReceiptPrint(request),
      deleteChannelProductOrders: (request) =>
        backingRepository.deleteChannelProductOrders(request),
      acceptSupplementaryTraffic: (request) =>
        backingRepository.acceptSupplementaryTraffic(request),
      acceptElectronicCommerce: (request) =>
        backingRepository.acceptElectronicCommerce(request),
      executePersonalRemittance: (request) =>
        backingRepository.executePersonalRemittance(request),
      executeInstitutionAccounting: (request) =>
        backingRepository.executeInstitutionAccounting(request),
      settle: (request) => backingRepository.settle(request),
      revise: (request) => backingRepository.revise(request),
      withdraw: (request) => backingRepository.withdraw(request),
      recordDocumentAction: (request) =>
        backingRepository.recordDocumentAction(request),
      recordInvoiceDecision: (id, requested) =>
        backingRepository.recordInvoiceDecision(id, requested),
      recordReturnReceiptArrival: (request) =>
        backingRepository.recordReturnReceiptArrival(request),
      dispatchReturnReceipt: (request) =>
        backingRepository.dispatchReturnReceipt(request),
      requestThirdPartyRefund: (request) =>
        backingRepository.requestThirdPartyRefund(request),
      completeThirdPartyRefund: (request) =>
        backingRepository.completeThirdPartyRefund(request),
      acceptReplyCouponRedemption: (request) =>
        backingRepository.acceptReplyCouponRedemption(request),
      reviseReplyCouponRedemption: (request) =>
        backingRepository.reviseReplyCouponRedemption(request),
      settleReplyCouponRedemption: (request) =>
        backingRepository.settleReplyCouponRedemption(request),
      withdrawReplyCouponRedemption: (request) =>
        backingRepository.withdrawReplyCouponRedemption(request),
      importBulkBatch: (request) => backingRepository.importBulkBatch(request),
      settleBulkBatch: (id, settledAt) =>
        backingRepository.settleBulkBatch(id, settledAt),
      recordBulkDocumentPrompt: (request) =>
        backingRepository.recordBulkDocumentPrompt(request),
      recordBulkMailLabelPrint: (request) =>
        backingRepository.recordBulkMailLabelPrint(request),
      recordBulkInvoiceChoice: (id, requested) =>
        backingRepository.recordBulkInvoiceChoice(id, requested),
      registerBulkInvoice: (request) =>
        backingRepository.registerBulkInvoice(request),
      recordBulkInvoiceDelivery: (request) =>
        backingRepository.recordBulkInvoiceDelivery(request),
      deleteBulkBatch: (id) => backingRepository.deleteBulkBatch(id),
      sealBulkBatch: (request) => backingRepository.sealBulkBatch(request),
      recordBulkSealTagDecision: (request) =>
        backingRepository.recordBulkSealTagDecision(request),
      querySelfServiceReservation: (reservationNumber) =>
        backingRepository.querySelfServiceReservation(reservationNumber),
      importSelfServiceReservation: (request) =>
        backingRepository.importSelfServiceReservation(request),
      settleSelfServiceImport: (id, settledAt) =>
        backingRepository.settleSelfServiceImport(id, settledAt),
      deleteSelfServiceImport: (id) =>
        backingRepository.deleteSelfServiceImport(id),
      executeMailDispatch: (command) =>
        backingRepository.executeMailDispatch(command),
      executeMailSealing: (command) =>
        backingRepository.executeMailSealing(command),
      executeDispatchBagHandover: (command) =>
        backingRepository.executeDispatchBagHandover(command),
      executeDispatchRouting: (command) =>
        backingRepository.executeDispatchRouting(command),
      executeDispatchBalanceReturn: (command) =>
        backingRepository.executeDispatchBalanceReturn(command),
      executePostageMeter: (command) =>
        backingRepository.executePostageMeter(command),
      executeSpecialHandling: (command) =>
        backingRepository.executeSpecialHandling(command),
      executeWindowDelivery: (command) =>
        backingRepository.executeWindowDelivery(command),
      executePostalSupplyManagement: (command) =>
        backingRepository.executePostalSupplyManagement(command),
      executePointsInventory: (command) =>
        backingRepository.executePointsInventory(command),
      executeCounterCorrection: (command) =>
        backingRepository.executeCounterCorrection(command),
      executeInvoiceManagement: (command) =>
        backingRepository.executeInvoiceManagement(command),
      executeSpotCheckExercise: (command) =>
        backingRepository.executeSpotCheckExercise(command),
      restore: (state) => backingRepository.restore(state),
      reset: () => backingRepository.reset(),
    }
    const promoteSpy = vi.spyOn(customerRepository, 'promoteDraft')
    const user = userEvent.setup()

    render(
      <ServiceIntakePanel
        customerDraft={createReadyCustomerDraft()}
        customerRepository={customerRepository}
        onCustomerCommitted={vi.fn()}
        onOpenSettlement={vi.fn()}
        onSummaryChange={vi.fn()}
        repository={failingRepository}
      />,
    )

    await fillValidBarcodeLetter(user)
    await user.click(screen.getByRole('button', { name: '计费' }))
    await user.click(screen.getByRole('button', { name: '提交' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('客户历史未更新')
    expect(promoteSpy).not.toHaveBeenCalled()
  })
})
