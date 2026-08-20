import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import { SIMULATED_CONTAINER_INVENTORY } from '../../domain/service/mailSealing'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import type { ServiceOperatorSnapshot } from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { createTestDispatchRelationAuthorization } from '../../test/workAuthorization'
import { MailSealingWorkspace } from './MailSealingWorkspace'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '林青禾',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '栖沄邮件处理中心',
}

function todayValue(): string {
  return businessCalendarDay(new Date())
}

async function addSettledOrdinaryLetter(
  repository: MemoryServiceRepository,
  acceptedAt?: string,
) {
  const acceptedTimestamp = acceptedAt ?? `${todayValue()}T09:00:00.000+08:00`
  const product = SERVICE_PRODUCTS.find((item) => item.id === 'ordinary-letter-100')!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    destinationZone: 'nonlocal' as const,
    weightGrams: 20,
  }
  const accepted = await repository.accept({
    acceptedAt: acceptedTimestamp,
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
    settledAt: new Date(new Date(acceptedTimestamp).getTime() + 600_000).toISOString(),
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  return accepted.transaction
}

async function addSettledRegisteredLetter(repository: MemoryServiceRepository) {
  const acceptedTimestamp = `${todayValue()}T09:00:00.000+08:00`
  const product = SERVICE_PRODUCTS.find((item) => item.id === 'registered-letter-200')!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    destinationZone: 'nonlocal' as const,
    itemCode: 'XA10000000001',
    weightGrams: 20,
  }
  const accepted = await repository.accept({
    acceptedAt: acceptedTimestamp,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: product.productFamily,
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
    settledAt: new Date(new Date(acceptedTimestamp).getTime() + 600_000).toISOString(),
    amountReceivedCents: accepted.transaction.charge.settlementDueCents,
  })
  return accepted.transaction
}

describe('MailSealingWorkspace', () => {
  it('uses the East-8 business day for mail accepted after UTC 16:00', async () => {
    const repository = MemoryServiceRepository.create()
    await addSettledOrdinaryLetter(repository, '2026-08-18T16:30:00.000Z')

    render(
      <MailSealingWorkspace
        institutionCode="99901001"
        now={new Date('2026-08-18T16:30:00.000Z')}
        onBack={() => undefined}
        operator={operator}
        repository={repository}
      />,
    )

    expect(await screen.findByLabelText('未封发收寄开始日期')).toHaveValue('2026-08-19')
    expect(screen.getByRole('checkbox', { name: '采集清单 国内平函' }))
      .toBeInTheDocument()
  })

  it('keeps the native query on the real business day instead of retained fixture time', async () => {
    const repository = MemoryServiceRepository.create()
    await addSettledOrdinaryLetter(repository, '2026-08-10T01:00:00.000Z')

    render(
      <MailSealingWorkspace
        institutionCode="99901001"
        now={new Date('2026-08-19T01:00:00.000Z')}
        onBack={() => undefined}
        operator={operator}
        repository={repository}
      />,
    )

    expect(await screen.findByLabelText('未封发收寄开始日期')).toHaveValue('2026-08-19')
    expect(screen.getByLabelText('未封发收寄结束日期')).toHaveValue('2026-08-19')
    expect(screen.getByRole('cell', { name: '无数据' })).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: '散件外走' }))
    expect(await screen.findByLabelText('散件外走收寄开始日期')).toHaveValue('2026-08-19')
    expect(screen.getByLabelText('散件外走收寄结束日期')).toHaveValue('2026-08-19')
  })

  it('reloads newly settled mail when another workspace changed IndexedDB', async () => {
    const user = userEvent.setup()
    const repository = MemoryServiceRepository.create()

    render(
      <MailSealingWorkspace
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
      />,
    )

    expect(await screen.findByRole('cell', { name: '无数据' })).toBeInTheDocument()
    await addSettledOrdinaryLetter(repository)
    const queryRegion = screen.getByRole('region', { name: '未封发处理查询条件' })
    await user.click(within(queryRegion).getByRole('button', { name: '查询' }))

    expect(await screen.findByRole('checkbox', { name: '采集清单 国内平函' }))
      .toBeInTheDocument()
  })

  it('keeps relation maintenance out of the outlet page and refreshes an upper-level change', async () => {
    const user = userEvent.setup()
    const repository = MemoryServiceRepository.create()
    const transaction = await addSettledRegisteredLetter(repository)

    render(
      <MailSealingWorkspace
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
      />,
    )

    const gaps = await screen.findByRole('note', { name: '未维护封发关系' })
    expect(gaps).toHaveTextContent('1 件邮件尚未维护封发关系')
    expect(gaps).toHaveTextContent('基础管理 → 封发关系管理')
    expect(within(gaps).queryByRole('button')).not.toBeInTheDocument()
    expect((await repository.load()).dispatchRelationOverrides).toHaveLength(0)

    const updatedAt = new Date().toISOString()
    await repository.executeMailSealing({
      type: 'upsert-dispatch-relation',
      product: transaction.product,
      destinationZone: 'nonlocal',
      bulk: false,
      manifestTypeCode: 'BBGS',
      routeCode: 'SIM-A01',
      receivingOfficeCode: '99101001',
      directSeal: false,
      consolidation: true,
      localTransfer: false,
      institutionCode: '99901001',
      updatedAt,
      operator: { ...operator, operatorId: '84000001' },
      authorization: await createTestDispatchRelationAuthorization(updatedAt),
    })
    await user.click(screen.getByRole('button', { name: '刷新封发关系' }))

    expect(screen.queryByRole('note', { name: '未维护封发关系' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '采集清单 本埠挂刷' })).toBeInTheDocument()
    expect((await repository.load()).dispatchRelationOverrides[0]).toMatchObject({
      manifestTypeCode: 'BBGS',
      routeCode: 'SIM-A01',
      updatedBy: { operatorId: '84000001' },
    })
  })

  it('captures a manifest, generates a bag and records the skipped tag decision', async () => {
    const user = userEvent.setup()
    const repository = MemoryServiceRepository.create()
    await addSettledOrdinaryLetter(repository)

    render(
      <MailSealingWorkspace
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
      />,
    )

    await user.click(await screen.findByRole('checkbox', { name: '采集清单 国内平函' }))
    const captureDialog = screen.getByRole('dialog', { name: '获取清单号信息' })
    expect(within(captureDialog).getByRole('textbox', { name: '封发清单号码' }))
      .toHaveValue('501')
    await user.click(within(captureDialog).getByRole('button', { name: '确定' }))
    expect(await screen.findByRole('status')).toHaveTextContent('清单信息采集完成')

    await user.click(screen.getByRole('button', { name: '总包生成' }))
    const shiftDialog = screen.getByRole('dialog', { name: '选择班次' })
    await user.selectOptions(
      within(shiftDialog).getByRole('combobox', { name: '总包生成班次' }),
      '02',
    )
    await user.click(within(shiftDialog).getByRole('button', { name: '确定' }))

    const printPrompt = await screen.findByRole('dialog', {
      name: '总包生成成功！是否打印袋牌？',
    })
    await user.click(within(printPrompt).getByRole('button', { name: '不打印' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已选择不打印袋牌')

    const state = await repository.load()
    expect(state.dispatchBags).toHaveLength(1)
    expect(state.dispatchBags[0]).toMatchObject({
      manifestTypeCode: 'GNPCXH',
      manifestNumber: '501',
      shift: '02',
      totalItems: 1,
      tagPrintDecision: 'skipped',
    })
    expect(screen.getByRole('cell', { name: '无数据' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '已封发查改' }))
    expect(await screen.findByRole('region', { name: '已封发查改查询结果' }))
      .toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '修改清单号' }))
    const manifestDialog = screen.getByRole('dialog', { name: '修改清单号' })
    const nextManifest = within(manifestDialog).getByRole('textbox', { name: '新清单号' })
    await user.clear(nextManifest)
    await user.type(nextManifest, '502')
    await user.click(within(manifestDialog).getByRole('button', { name: '确定' }))
    expect(await screen.findByRole('status')).toHaveTextContent('清单号修改成功')
    expect((await repository.load()).dispatchBagChanges[0]).toMatchObject({
      kind: 'manifest-number-changed',
      previousManifestNumber: '501',
      newManifestNumber: '502',
    })
  })

  it('supports mail picking detail and validates an in-stock barcode container', async () => {
    const user = userEvent.setup()
    const repository = MemoryServiceRepository.create()
    const transaction = await addSettledOrdinaryLetter(repository)

    render(
      <MailSealingWorkspace
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '邮件勾挑' }))
    const detailDialog = screen.getByRole('dialog', { name: '邮件勾挑' })
    expect(within(detailDialog).getByText(transaction.id)).toBeInTheDocument()
    await user.click(within(detailDialog).getByRole('button', { name: '关闭' }))

    await user.click(screen.getByRole('checkbox', { name: '采集清单 国内平函' }))
    const captureDialog = screen.getByRole('dialog', { name: '获取清单号信息' })
    await user.selectOptions(
      within(captureDialog).getByRole('combobox', { name: '是否使用条码容器' }),
      'yes',
    )
    const barcode = within(captureDialog).getByLabelText('封发容器条码')
    await user.type(barcode, '9901000000000099')
    await user.click(within(captureDialog).getByRole('button', { name: '确定' }))
    expect(within(captureDialog).getByRole('alert')).toHaveTextContent('容器条码未入库')
    await user.clear(barcode)
    await user.type(barcode, SIMULATED_CONTAINER_INVENTORY[0])
    await user.click(within(captureDialog).getByRole('button', { name: '确定' }))

    expect(await screen.findByRole('status')).toHaveTextContent('清单信息采集完成')
    expect(screen.getByRole('cell', { name: '条码容器' })).toBeInTheDocument()
  })

  it('electronically picks one loose outbound mail and never offers a bag tag', async () => {
    const user = userEvent.setup()
    const repository = MemoryServiceRepository.create()
    const transaction = await addSettledOrdinaryLetter(repository)

    render(
      <MailSealingWorkspace
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '散件外走' }))
    expect(await screen.findByRole('region', { name: '散件外走查询结果' }))
      .toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '电子勾挑' }))
    const pickingDialog = screen.getByRole('dialog', { name: '电子勾挑' })
    await user.type(
      within(pickingDialog).getByRole('textbox', { name: '电子勾挑邮件号码' }),
      transaction.id,
    )
    await user.click(within(pickingDialog).getByRole('button', { name: '查询邮件' }))
    expect(await within(pickingDialog).findByText(transaction.id)).toBeInTheDocument()
    await user.click(within(pickingDialog).getByRole('button', { name: '确定' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已电子勾挑邮件')

    await user.click(screen.getByRole('button', { name: '总包生成' }))
    const shiftDialog = screen.getByRole('dialog', { name: '选择班次' })
    await user.selectOptions(
      within(shiftDialog).getByRole('combobox', { name: '散件外走班次' }),
      '03',
    )
    await user.click(within(shiftDialog).getByRole('button', { name: '确定' }))

    expect(await screen.findByRole('status')).toHaveTextContent('不打印袋牌')
    expect(screen.queryByRole('dialog', {
      name: '总包生成成功！是否打印袋牌？',
    })).not.toBeInTheDocument()
    const state = await repository.load()
    expect(state.dispatchBags[0]).toMatchObject({
      bagBarcode: transaction.id,
      sealingMode: 'loose-outbound',
      shift: '03',
      totalItems: 1,
      tagPrintDecision: 'skipped',
    })

    await user.click(screen.getByRole('button', { name: '已封发查改' }))
    expect(await screen.findByRole('cell', { name: '散件外走' })).toBeInTheDocument()
  })

  it('groups consecutively scanned sorting mail into one bag per dispatch relation', async () => {
    const user = userEvent.setup()
    const repository = MemoryServiceRepository.create()
    const first = await addSettledOrdinaryLetter(repository)
    const second = await addSettledOrdinaryLetter(repository)

    render(
      <MailSealingWorkspace
        institutionCode="99901001"
        onBack={() => undefined}
        operator={operator}
        repository={repository}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '分拣封发' }))
    expect(await screen.findByRole('region', { name: '分拣封发扫描结果' }))
      .toBeInTheDocument()
    const scanInput = screen.getByRole('textbox', { name: '分拣封发邮件号码' })
    await user.type(scanInput, first.id)
    await user.click(screen.getByRole('button', { name: '确认扫描' }))
    let captureDialog = screen.getByRole('dialog', { name: '获取清单号信息' })
    expect(within(captureDialog).getByRole('textbox', { name: '分拣封发清单号码' }))
      .toHaveValue('501')
    await user.click(within(captureDialog).getByRole('button', { name: '确定' }))

    await user.type(scanInput, second.id)
    await user.click(screen.getByRole('button', { name: '确认扫描' }))
    captureDialog = screen.getByRole('dialog', { name: '获取清单号信息' })
    expect(within(captureDialog).getByRole('textbox', { name: '分拣封发清单号码' }))
      .toHaveValue('501')
    await user.click(within(captureDialog).getByRole('button', { name: '确定' }))
    expect(screen.getByText('2 件 / 1 组')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '总包生成' }))
    const shiftDialog = screen.getByRole('dialog', { name: '选择班次' })
    await user.selectOptions(
      within(shiftDialog).getByRole('combobox', { name: '分拣封发班次' }),
      '02',
    )
    await user.click(within(shiftDialog).getByRole('button', { name: '确定' }))
    const printPrompt = await screen.findByRole('dialog', {
      name: '总包生成成功！是否打印袋牌？',
    })
    await user.click(within(printPrompt).getByRole('button', { name: '不打印' }))
    expect(await screen.findByRole('status')).toHaveTextContent('共生成 1 个总包')

    const state = await repository.load()
    expect(state.dispatchBags).toHaveLength(1)
    expect(state.dispatchBags[0]).toMatchObject({
      sealingMode: 'sorting',
      manifestNumber: '501',
      shift: '02',
      totalItems: 2,
      tagPrintDecision: 'skipped',
    })
  })
})
