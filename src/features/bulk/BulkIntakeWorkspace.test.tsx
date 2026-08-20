import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { localAgreementTimestamp } from '../../domain/customer/agreement'
import { createBulkTemplateWorkbook } from '../../domain/service/bulk'
import { DEFAULT_SERVICE_OPERATOR } from '../../domain/service/transactions'
import { MemoryCustomerRepository } from '../../infrastructure/memory/MemoryCustomerRepository'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { BulkIntakeWorkspace } from './BulkIntakeWorkspace'

async function readyCustomerRepository() {
  const repository = MemoryCustomerRepository.create()
  await repository.saveDraft({
    productFamily: 'parcel',
    destinationRegion: 'domestic',
    sender: {
      ...createEmptySender(),
      agreementAccountId: '91000000000001',
      agreementAccountName: '星河合作社',
      contact: '10000000016',
      name: '林澄',
      identityType: 'travel',
      identityValue: 'SIM-BULK-001',
      gender: 'unspecified',
      detailedAddress: '澜京市栖台区新程路1号',
      unit: '星河合作社',
      postalCode: '110001',
    },
    recipient: createEmptyRecipient(),
    status: 'sender-ready',
    updatedAt: '2026-08-04T09:00:00.000Z',
  })
  return repository
}

describe('BulkIntakeWorkspace', () => {
  beforeEach(() => {
    if (!File.prototype.text) {
      File.prototype.text = function text() {
        return new Response(this).text()
      }
    }
    vi.spyOn(window, 'print').mockImplementation(() => undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it('uses the workstation local date in agreement application timestamps', () => {
    expect(localAgreementTimestamp(new Date(2026, 7, 4, 2, 15, 3)))
      .toBe('2026-08-04T02:15:03')
  })

  it('imports, reviews, and settles a PDF-shaped ordinary parcel batch', async () => {
    const user = userEvent.setup()
    const customerRepository = await readyCustomerRepository()
    const serviceRepository = MemoryServiceRepository.create()
    render(
      <BulkIntakeWorkspace
        customerRepository={customerRepository}
        institutionCode="99901001"
        onBack={() => undefined}
        operator={DEFAULT_SERVICE_OPERATOR}
        serviceRepository={serviceRepository}
      />,
    )

    const customerDialog = await screen.findByRole('dialog', {
      name: '寄件客户实名信息采集',
    })
    await user.click(within(customerDialog).getByRole('button', { name: '取消' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: '大宗业务产品' }),
      'catalog-300',
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: '大宗普包计费区' }),
      '1',
    )
    await user.type(
      screen.getByRole('textbox', { name: '大宗邮件号码起号' }),
      'CP00000000001',
    )
    const workbook = createBulkTemplateWorkbook('91000000000001')
    const file = new File([workbook], '大宗导入模板.xls', {
      type: 'application/vnd.ms-excel',
    })
    await user.upload(screen.getByLabelText('大宗导入文件'), file)
    await user.click(screen.getByRole('button', { name: '导入处理' }))

    const detail = await screen.findByRole('dialog', { name: '邮件详情列表' })
    expect(within(detail).getByText('CP00000000001')).toBeInTheDocument()
    expect(within(detail).getByText('CP00000000006')).toBeInTheDocument()
    await user.click(within(detail).getByRole('button', { name: '结算' }))

    const documents = await screen.findByRole('dialog', {
      name: '请选择需要打印的大宗单据',
    })
    expect(within(documents).getByRole('article', {
      name: '大宗邮件交寄清单',
    })).toHaveTextContent('权益数量：0')
    expect(within(documents).getByRole('article', {
      name: '整付零寄交寄汇总清单',
    })).toHaveTextContent('优惠金额0.00')
    await user.click(within(documents).getByRole('button', {
      name: '打印选中单据',
    }))

    const invoiceChoice = await screen.findByRole('dialog', {
      name: '是否需要开具电子发票？',
    })
    await user.click(within(invoiceChoice).getByRole('button', { name: '需要' }))
    const invoice = await screen.findByRole('dialog', { name: '电子发票登记' })
    expect(within(invoice).getByLabelText('购方名称')).toHaveValue('星河合作社')
    await user.click(within(invoice).getByRole('button', { name: '确认开票' }))
    const delivery = await screen.findByRole('dialog', { name: '是否进行发票交付？' })
    await user.click(within(delivery).getByRole('button', { name: '确定' }))

    expect(await screen.findByText(/电子发票已登记并完成模拟交付/)).toBeInTheDocument()
    expect(screen.getAllByText('已结算').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /^打印$/u }))
    const labels = await screen.findByRole('dialog', { name: '打印导入邮件面单' })
    await user.clear(within(labels).getByLabelText('面单打印起始序号'))
    await user.type(within(labels).getByLabelText('面单打印起始序号'), '2')
    await user.clear(within(labels).getByLabelText('面单打印终止序号'))
    await user.type(within(labels).getByLabelText('面单打印终止序号'), '4')
    await user.click(within(labels).getByRole('button', { name: '确定打印' }))
    expect(await screen.findByText(/面单打印范围 2～4/)).toBeInTheDocument()
    expect(window.print).toHaveBeenCalledTimes(2)
    await expect(serviceRepository.load()).resolves.toMatchObject({
      bulkBatches: [{
        totalCount: 6,
        successCount: 6,
        settlementStatus: 'settled',
        couponCount: 0,
        couponDiscountCents: 0,
        documentPrintRecords: [
          { kind: 'bulk-mailing-list' },
          { kind: 'consolidated-posting-summary' },
        ],
        mailLabelPrintRecords: [{
          fromSequence: 2,
          toSequence: 4,
          detailSheet: false,
        }],
        invoiceRequested: true,
        invoiceRegistration: {
          buyerName: '星河合作社',
          deliveryRequested: true,
        },
      }],
    })
  })

  it('rejects a renamed unsupported workbook before persistence', async () => {
    const user = userEvent.setup()
    const customerRepository = await readyCustomerRepository()
    const serviceRepository = MemoryServiceRepository.create()
    render(
      <BulkIntakeWorkspace
        customerRepository={customerRepository}
        institutionCode="99901001"
        onBack={() => undefined}
        operator={DEFAULT_SERVICE_OPERATOR}
        serviceRepository={serviceRepository}
      />,
    )
    const customerDialog = await screen.findByRole('dialog', {
      name: '寄件客户实名信息采集',
    })
    await user.click(within(customerDialog).getByRole('button', { name: '取消' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: '大宗业务产品' }),
      'catalog-300',
    )
    fireEvent.change(screen.getByLabelText('大宗导入文件'), {
      target: { files: [new File(['not a workbook'], '错误模板.xlsx')] },
    })
    await user.click(screen.getByRole('button', { name: '导入处理' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('必须为 .xls 格式')
    await expect(serviceRepository.load()).resolves.toMatchObject({ bulkBatches: [] })
  })

  it('keeps the bag-tag decision prompt closable after a repository rejection', async () => {
    const user = userEvent.setup()
    const customerRepository = await readyCustomerRepository()
    const serviceRepository = MemoryServiceRepository.create()
    render(
      <BulkIntakeWorkspace
        customerRepository={customerRepository}
        institutionCode="99901001"
        onBack={() => undefined}
        operator={DEFAULT_SERVICE_OPERATOR}
        serviceRepository={serviceRepository}
      />,
    )

    const customerDialog = await screen.findByRole('dialog', {
      name: '寄件客户实名信息采集',
    })
    await user.click(within(customerDialog).getByRole('button', { name: '确定' }))
    await user.selectOptions(screen.getByLabelText('大宗业务产品'), 'catalog-303')
    await user.type(screen.getByLabelText('大宗邮件号码起号'), 'CP10000000001')
    await user.type(screen.getByLabelText('大宗寄递平台每件报价'), '5.00')
    await user.upload(
      screen.getByLabelText('大宗导入文件'),
      new File(
        [createBulkTemplateWorkbook('91000000000001')],
        '爱心包裹大宗导入.xls',
        { type: 'application/vnd.ms-excel' },
      ),
    )
    await user.click(screen.getByRole('button', { name: '导入处理' }))
    const detail = await screen.findByRole('dialog', { name: '邮件详情列表' })
    await user.click(within(detail).getByRole('button', { name: '结算' }))
    const documents = await screen.findByRole('dialog', {
      name: '请选择需要打印的大宗单据',
    })
    await user.click(within(documents).getByRole('button', { name: '暂不打印' }))
    const invoiceChoice = await screen.findByRole('dialog', {
      name: '是否需要开具电子发票？',
    })
    await user.click(within(invoiceChoice).getByRole('button', { name: '不需要' }))

    await user.click(screen.getByRole('button', { name: '直封' }))
    const sealDialog = await screen.findByRole('dialog', { name: '直封邮件' })
    await user.clear(within(sealDialog).getByLabelText('直封每包数量'))
    await user.type(within(sealDialog).getByLabelText('直封每包数量'), '3')
    await user.click(within(sealDialog).getByRole('button', { name: '确定' }))

    vi.spyOn(serviceRepository, 'recordBulkSealTagDecision').mockRejectedValueOnce(
      new Error('该批次已经记录袋牌打印决定。'),
    )
    const tagPrompt = await screen.findByRole('dialog', {
      name: '总包生成成功！是否打印袋牌？',
    })
    await user.click(within(tagPrompt).getByRole('button', { name: '不打印' }))
    expect(await within(tagPrompt).findByRole('alert')).toHaveTextContent('已经记录袋牌打印决定')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', {
      name: '总包生成成功！是否打印袋牌？',
    })).not.toBeInTheDocument()
  })

  it('registers a new individual agreement customer and imports six registered letters', async () => {
    const user = userEvent.setup()
    const customerRepository = MemoryCustomerRepository.create()
    const serviceRepository = MemoryServiceRepository.create()
    render(
      <BulkIntakeWorkspace
        customerRepository={customerRepository}
        institutionCode="99901001"
        onBack={() => undefined}
        operator={DEFAULT_SERVICE_OPERATOR}
        serviceRepository={serviceRepository}
      />,
    )

    const customerDialog = await screen.findByRole('dialog', {
      name: '寄件客户实名信息采集',
    })
    await user.click(within(customerDialog).getByRole('button', {
      name: '协议客户注册申请',
    }))

    const registrationDialog = await screen.findByRole('dialog', {
      name: '协议客户注册申请',
    })
    await user.type(within(registrationDialog).getByLabelText('法定客户名称'), '陆川')
    await user.type(within(registrationDialog).getByLabelText('客户简称'), '陆川大宗客户')
    await user.selectOptions(
      within(registrationDialog).getByLabelText('协议客户证件类型'),
      'primary',
    )
    await user.type(
      within(registrationDialog).getByLabelText('协议客户证件号码'),
      '990101194912310044',
    )
    await user.type(
      within(registrationDialog).getByLabelText('协议客户联系电话'),
      '10000000027',
    )
    await user.type(
      within(registrationDialog).getByLabelText('协议客户寄件人姓名'),
      '陆川',
    )
    await user.type(
      within(registrationDialog).getByLabelText('协议客户详细地址'),
      '瀚原省栖沄市景麓区新程路36号',
    )
    await user.type(
      within(registrationDialog).getByLabelText('协议客户输入简码'),
      'LC',
    )
    await user.click(within(registrationDialog).getByRole('button', {
      name: '提交申请',
    }))

    expect(await screen.findByText(/申请 .* 已提交/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /审核通过/ }))

    expect(await within(customerDialog).findByLabelText('大宗协议客户')).toHaveValue(
      '91000000000004',
    )
    expect(within(customerDialog).getByLabelText('大宗身份证明号码')).toHaveValue(
      '990101194912310044',
    )
    await user.click(within(customerDialog).getByRole('button', { name: '确定' }))

    await user.selectOptions(
      screen.getByRole('combobox', { name: '大宗业务产品' }),
      'registered-letter-200',
    )
    await user.type(
      screen.getByRole('textbox', { name: '大宗邮件号码起号' }),
      'XK00000000001',
    )
    const workbook = createBulkTemplateWorkbook('91000000000004')
    await user.upload(
      screen.getByLabelText('大宗导入文件'),
      new File([workbook], '六封给据信函.xls', {
        type: 'application/vnd.ms-excel',
      }),
    )
    await user.click(screen.getByRole('button', { name: '导入处理' }))

    const detail = await screen.findByRole('dialog', { name: '邮件详情列表' })
    expect(within(detail).getByText('XK00000000001')).toBeInTheDocument()
    expect(within(detail).getByText('XK00000000006')).toBeInTheDocument()
    await expect(customerRepository.load()).resolves.toMatchObject({
      agreementApplications: [{
        legalName: '陆川',
        customerType: 'individual',
        expectedItemCount: 6,
        status: 'approved',
        accountId: '91000000000004',
      }],
      agreementAccounts: expect.arrayContaining([expect.objectContaining({
        id: '91000000000004',
        name: '陆川大宗客户',
      })]),
    })
    await expect(serviceRepository.load()).resolves.toMatchObject({
      bulkBatches: [{
        agreementAccountId: '91000000000004',
        totalCount: 6,
        successCount: 6,
        failedCount: 0,
        product: { searchCode: '200' },
      }],
    })
  })
})
