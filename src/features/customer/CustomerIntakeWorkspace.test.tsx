import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { APPOINTMENT_ORDERS } from '../../domain/service/appointmentCollection'
import { MemoryCustomerRepository } from '../../infrastructure/memory/MemoryCustomerRepository'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { CustomerIntakeWorkspace } from './CustomerIntakeWorkspace'

describe('CustomerIntakeWorkspace', () => {
  it('opens the channel-product sales tab when entered from its independent menu', async () => {
    const repository = MemoryCustomerRepository.create()
    const user = userEvent.setup()

    render(
      <CustomerIntakeWorkspace
        initialServiceTab="channel-products"
        onBack={() => undefined}
        onOpenSettlement={() => undefined}
        repository={repository}
        serviceRepository={MemoryServiceRepository.create()}
      />,
    )

    const salesTab = await screen.findByRole('button', { name: '商品销售' })
    expect(salesTab).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('combobox', { name: '业务类别' }))
      .toHaveValue('channel-products')

    let senderDialog = await screen.findByRole('dialog', { name: '寄件资料采集' })
    await user.type(
      within(senderDialog).getByRole('textbox', { name: '寄件联系电话' }),
      '10000000016',
    )
    await user.click(within(senderDialog).getByRole('button', { name: '查询历史' }))
    const senderHistory = await screen.findByRole('dialog', { name: '寄件历史选择' })
    await user.click(within(senderHistory).getAllByRole('button', { name: '选择' })[0]!)
    senderDialog = await screen.findByRole('dialog', { name: '寄件资料采集' })
    await user.click(within(senderDialog).getByRole('button', { name: '确定' }))

    expect(salesTab).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('region', { name: '渠道转型商品销售' }))
      .toBeInTheDocument()
  })

  it('derives the service region from the PDF-style address hierarchy', async () => {
    const user = userEvent.setup()
    render(
      <CustomerIntakeWorkspace
        onBack={() => undefined}
        onOpenSettlement={() => undefined}
        repository={MemoryCustomerRepository.create()}
        serviceRepository={MemoryServiceRepository.create()}
      />,
    )

    let senderDialog = await screen.findByRole('dialog', { name: '寄件资料采集' })
    await user.type(
      within(senderDialog).getByRole('textbox', { name: '寄件联系电话' }),
      '10000000016',
    )
    await user.type(
      within(senderDialog).getByRole('textbox', { name: '寄件人姓名' }),
      '林澄',
    )
    const senderAddress = within(senderDialog).getByRole('textbox', { name: '寄件详细地址' })
    await user.click(senderAddress)

    let addressPicker = within(senderDialog).getByRole('group', { name: '寄件地址点选' })
    expect(addressPicker.closest('.address-field-control')).toContainElement(senderAddress)
    expect(within(addressPicker).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '海外',
      '省份',
      '地市',
      '区县',
    ])
    const provinceButtons = within(within(addressPicker).getByRole('tabpanel'))
      .getAllByRole('button')
    expect(provinceButtons).toHaveLength(34)
    expect(provinceButtons.slice(0, 2).map((button) => button.textContent)).toEqual([
      '澜京',
      '玄津',
    ])
    expect(provinceButtons.slice(-3).map((button) => button.textContent)).toEqual([
      '美丽岛',
      '自贸港',
      '镜海埠',
    ])
    await user.click(within(addressPicker).getByRole('button', { name: '澜京' }))
    expect(within(addressPicker).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '海外',
      '澜京',
      '地市',
      '区县',
    ])
    await user.click(within(addressPicker).getByRole('button', { name: '澜京' }))
    expect(within(addressPicker).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '海外',
      '澜京',
      '澜京',
      '区县',
    ])
    await user.click(within(addressPicker).getByRole('button', { name: '栖台' }))
    expect(senderAddress).toHaveValue('澜京市栖台区')

    await user.click(senderAddress)
    addressPicker = within(senderDialog).getByRole('group', { name: '寄件地址点选' })
    await user.click(within(addressPicker).getByRole('button', { name: '瀚原' }))
    expect(within(addressPicker).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '海外',
      '瀚原',
      '地市',
      '区县',
    ])
    await user.click(within(addressPicker).getByRole('button', { name: '栖沄' }))
    expect(within(addressPicker).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '海外',
      '瀚原',
      '栖沄',
      '区县',
    ])
    await user.click(within(addressPicker).getByRole('button', { name: '景麓' }))
    expect(senderAddress).toHaveValue('瀚原省栖沄市景麓区')
    await user.type(senderAddress, '星光路 18 号')
    expect(senderAddress).toHaveValue('瀚原省栖沄市景麓区星光路 18 号')
    expect(screen.queryByRole('dialog', { name: '详细地址选择' })).not.toBeInTheDocument()

    senderDialog = await screen.findByRole('dialog', { name: '寄件资料采集' })
    await user.click(within(senderDialog).getByRole('button', { name: '确定' }))

    const recipientAddress = await screen.findByRole('textbox', { name: '收件详细地址' })
    await user.click(recipientAddress)
    addressPicker = screen.getByRole('group', { name: '收件地址点选' })
    expect(addressPicker.closest('.address-field-control')).toContainElement(recipientAddress)
    expect(within(addressPicker).getByRole('button', { name: '自贸港' }))
      .toBeInTheDocument()
    expect(within(addressPicker).getByRole('button', { name: '镜海埠' }))
      .toBeInTheDocument()
    expect(within(addressPicker).getByRole('button', { name: '美丽岛' }))
      .toBeInTheDocument()
    await user.click(within(addressPicker).getByRole('button', { name: '澄岐' }))
    await user.click(within(addressPicker).getByRole('button', { name: '澄野' }))
    await user.click(within(addressPicker).getByRole('button', { name: '江洲' }))
    expect(recipientAddress).toHaveValue('澄岐省澄野市江洲区')
    await user.type(recipientAddress, '远景路 26 号')

    const region = screen.getByRole('combobox', { name: '服务区域' })
    expect(region).toBeDisabled()
    expect(region).toHaveValue('nonlocal')
    expect(recipientAddress).toHaveValue('澄岐省澄野市江洲区远景路 26 号')

    await user.click(recipientAddress)
    addressPicker = screen.getByRole('group', { name: '收件地址点选' })
    await user.click(
      within(addressPicker).getByRole('button', { name: '自贸港' }),
    )
    await user.click(
      within(addressPicker).getByRole('button', { name: '自贸港' }),
    )
    await user.click(within(addressPicker).getByRole('button', { name: '清台' }))
    expect(recipientAddress).toHaveValue('自贸港特别行政区清台区')
    expect(region).toHaveValue('special-free-trade-port')

    await user.click(recipientAddress)
    addressPicker = screen.getByRole('group', { name: '收件地址点选' })
    await user.click(within(addressPicker).getByRole('tab', { name: '海外' }))
    await user.type(
      within(addressPicker).getByRole('textbox', { name: '海外寄达地检索' }),
      'AU',
    )
    await user.click(within(addressPicker).getByRole('button', { name: /远洋演练区-021.*AU/ }))

    expect(region).toHaveValue('international')
    expect(screen.getByRole('combobox', { name: '国际寄达局' }))
      .toHaveValue('AU')
    expect(screen.getByRole('combobox', { name: '国际寄达局' })).toBeDisabled()
    expect(screen.queryByRole('textbox', { name: '收件邮编' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '收件详细地址' })).not.toBeInTheDocument()
  })

  it('moves from historical sender selection to a persisted customer-ready draft', async () => {
    const repository = MemoryCustomerRepository.create()
    const serviceRepository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(
      <CustomerIntakeWorkspace
        onBack={() => undefined}
        onOpenSettlement={() => undefined}
        repository={repository}
        serviceRepository={serviceRepository}
      />,
    )

    let senderDialog = await screen.findByRole('dialog', { name: '寄件资料采集' })
    await user.type(
      within(senderDialog).getByRole('textbox', { name: '寄件联系电话' }),
      '10000000016',
    )
    await user.click(within(senderDialog).getByRole('button', { name: '查询历史' }))

    const senderHistory = await screen.findByRole('dialog', { name: '寄件历史选择' })
    expect(within(senderHistory).getAllByRole('button', { name: '选择' })).toHaveLength(2)
    await user.click(within(senderHistory).getAllByRole('button', { name: '选择' })[0]!)

    senderDialog = await screen.findByRole('dialog', { name: '寄件资料采集' })
    await user.selectOptions(
      within(senderDialog).getByRole('combobox', { name: '身份证明类型' }),
      'primary',
    )
    await user.type(
      within(senderDialog).getByRole('textbox', { name: '身份证明号码' }),
      '990101194912310044',
    )
    await user.click(within(senderDialog).getByRole('button', { name: '确定' }))

    const recipientContact = await screen.findByRole('textbox', {
      name: '收件联系电话',
    })
    await user.type(recipientContact, '10000000019')
    await user.click(screen.getByRole('button', { name: '查询历史' }))

    const recipientHistory = await screen.findByRole('dialog', { name: '收件历史选择' })
    expect(within(recipientHistory).getAllByRole('button', { name: '选择' })).toHaveLength(2)
    await user.click(within(recipientHistory).getAllByRole('button', { name: '选择' })[0]!)
    await user.click(screen.getByRole('button', { name: '保存可选资料' }))

    expect(
      await screen.findByText('客户草稿已就绪，可进入下一阶段的业务受理。'),
    ).toBeInTheDocument()
    const customerSummary = screen.getByLabelText('当前客户业务汇总')
    expect(within(customerSummary).getByText('总件数')).toBeInTheDocument()
    expect(within(customerSummary).getByText('总金额')).toBeInTheDocument()
    expect(within(customerSummary).getByRole('button', { name: '结算中心' }))
      .toBeInTheDocument()
    expect(within(customerSummary).getByRole('button', { name: '中断' }))
      .toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      draft: {
        status: 'customer-ready',
        sender: { name: '林澄' },
        recipient: { name: '顾远' },
      },
      senderHistory: [{ id: 'sender-001' }, { id: 'sender-002' }, { id: 'sender-003' }],
    })

    const registeredTab = screen.getByRole('button', { name: '挂函' })
    await user.click(registeredTab)
    expect(registeredTab).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('combobox', { name: '业务类别' })).toHaveValue(
      'standard-delivery',
    )
    expect(await screen.findAllByText('给据函件收寄')).not.toHaveLength(0)

    const postalSuppliesTab = screen.getByRole('button', { name: '用邮物品' })
    await user.click(postalSuppliesTab)
    expect(postalSuppliesTab).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('region', { name: '用邮物品销售' }))
      .toBeInTheDocument()

    const channelProductsTab = screen.getByRole('button', { name: '商品销售' })
    await user.click(channelProductsTab)
    expect(channelProductsTab).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('region', { name: '渠道转型商品销售' }))
      .toBeInTheDocument()

    const supplementaryTab = screen.getByRole('button', { name: '补录/交管' })
    await user.click(supplementaryTab)
    expect(supplementaryTab).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('region', { name: '补录/交管' }))
      .toBeInTheDocument()

    const electronicCommerceTab = screen.getByRole('button', { name: '电子商务' })
    await user.click(electronicCommerceTab)
    expect(electronicCommerceTab).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('region', { name: '电子商务' }))
      .toBeInTheDocument()

    const parcelTab = screen.getByRole('button', { name: '包裹' })
    await user.click(parcelTab)
    expect(parcelTab).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('combobox', { name: '业务类别' })).toHaveValue('parcel')
    expect(await screen.findAllByText('包裹收寄')).not.toHaveLength(0)
  })

  it('uses the approved address hierarchy through ordinary parcel submission', async () => {
    const repository = MemoryCustomerRepository.create()
    const serviceRepository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(
      <CustomerIntakeWorkspace
        onBack={() => undefined}
        onOpenSettlement={() => undefined}
        repository={repository}
        serviceRepository={serviceRepository}
      />,
    )

    let senderDialog = await screen.findByRole('dialog', { name: '寄件资料采集' })
    await user.type(
      within(senderDialog).getByRole('textbox', { name: '寄件联系电话' }),
      '10000000016',
    )
    await user.click(within(senderDialog).getByRole('button', { name: '查询历史' }))
    const senderHistory = await screen.findByRole('dialog', { name: '寄件历史选择' })
    await user.click(within(senderHistory).getAllByRole('button', { name: '选择' })[0]!)

    senderDialog = await screen.findByRole('dialog', { name: '寄件资料采集' })
    await user.selectOptions(
      within(senderDialog).getByRole('combobox', { name: '身份证明类型' }),
      'primary',
    )
    await user.type(
      within(senderDialog).getByRole('textbox', { name: '身份证明号码' }),
      '990101194912310044',
    )
    await user.click(within(senderDialog).getByRole('button', { name: '确定' }))

    await user.click(screen.getByRole('button', { name: '包裹' }))
    await user.type(
      await screen.findByRole('textbox', { name: '收件联系电话' }),
      '10000000019',
    )
    await user.type(screen.getByRole('textbox', { name: '收件人姓名' }), '顾远')

    const recipientAddress = screen.getByRole('textbox', { name: '收件详细地址' })
    await user.click(recipientAddress)
    const addressPicker = screen.getByRole('group', { name: '收件地址点选' })
    await user.click(within(addressPicker).getByRole('button', { name: '澄岐' }))
    await user.click(within(addressPicker).getByRole('button', { name: '澄野' }))
    await user.click(within(addressPicker).getByRole('button', { name: '江洲' }))
    await user.type(recipientAddress, '远景路 26 号')
    await user.click(screen.getByRole('button', { name: '保存收件资料' }))

    const region = screen.getByRole('combobox', { name: '服务区域' })
    expect(region).toBeDisabled()
    expect(region).toHaveValue('nonlocal')

    const productSearch = screen.getByRole('combobox', { name: '业务产品检索' })
    await user.type(productSearch, '300')
    await user.click(screen.getByRole('treeitem', { name: '选择 普通包裹 300' }))
    await user.type(
      screen.getByRole('textbox', { name: '邮件号码' }),
      'PU13131313435',
    )
    await user.click(screen.getByRole('button', { name: '计重' }))
    const weight = screen.getByRole('spinbutton', { name: '邮件重量' })
    await user.clear(weight)
    await user.type(weight, '1500')
    await user.selectOptions(
      screen.getByRole('combobox', { name: '普通包裹资费区档' }),
      '3',
    )
    expect(screen.getByRole('combobox', { name: '付费方式' })).toHaveValue(
      'cash-settlement',
    )

    await user.click(screen.getByRole('button', { name: '计费' }))
    expect(within(screen.getByLabelText('费用摘要')).getAllByText('¥ 9.00'))
      .toHaveLength(2)
    await user.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByText(/提交成功，.*已进入结算中心/))
      .toBeInTheDocument()

    await expect(serviceRepository.load()).resolves.toMatchObject({
      transactions: [{
        product: { searchCode: '300', effectiveBusinessCode: '300100' },
        customer: {
          recipient: {
            detailedAddress: '澄岐省澄野市江洲区远景路 26 号',
            postalCode: '120023',
          },
        },
        service: {
          destinationZone: 'nonlocal',
          itemCode: 'PU13131313435',
          parcelTariffZone: '3',
          paymentMethod: 'cash-settlement',
          weightGrams: 1500,
        },
        charge: { postageCents: 900, settlementDueCents: 900 },
      }],
    })
  })

  it('loads, discounts, and accepts a delivery-platform appointment end to end', async () => {
    const order = APPOINTMENT_ORDERS.find(
      (candidate) => candidate.source === 'delivery-platform',
    )!
    const repository = MemoryCustomerRepository.create()
    const serviceRepository = MemoryServiceRepository.create()
    await repository.saveDraft(order.customer)
    const user = userEvent.setup()

    render(
      <CustomerIntakeWorkspace
        onBack={() => undefined}
        onOpenSettlement={() => undefined}
        repository={repository}
        serviceRepository={serviceRepository}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '预约收寄' }))
    const dialog = await screen.findByRole('dialog', { name: '预约收寄' })
    await user.click(within(dialog).getByRole('radio', { name: /快递平台/ }))
    await user.type(
      within(dialog).getByRole('textbox', { name: '预约单号或电话' }),
      order.orderNumber,
    )
    await user.click(within(dialog).getByRole('button', { name: '查询' }))

    expect(await screen.findByText(`预约单 ${order.orderNumber}`)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '业务产品检索' }))
      .toHaveValue('快递包裹')
    expect(screen.getByRole('textbox', { name: '邮件号码' }))
      .toHaveValue('PX26081000003')
    expect(screen.getByRole('textbox', { name: '收件人姓名' }))
      .toHaveValue('苏澄')
    expect(screen.getByRole('button', { name: '修改寄件资料' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '计费' }))
    const charge = screen.getByLabelText('费用摘要')
    expect(within(charge).getByText('- ¥ 2.00')).toBeInTheDocument()
    expect(within(charge).getAllByText('¥ 6.00')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByText(/提交成功，.*已进入结算中心/))
      .toBeInTheDocument()
    await expect(serviceRepository.load()).resolves.toMatchObject({
      transactions: [{
        source: 'appointment',
        sourceOrderNumber: order.orderNumber,
        service: {
          appointment: { source: 'delivery-platform', discountCents: 200 },
        },
        charge: {
          discountCents: 200,
          postageCents: 600,
          settlementDueCents: 600,
        },
      }],
    })
  })
})
