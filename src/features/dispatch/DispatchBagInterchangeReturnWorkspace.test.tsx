import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import type { DispatchBagRecord, ServiceOperatorSnapshot } from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { DispatchBagInterchangeReturnWorkspace } from './DispatchBagInterchangeReturnWorkspace'

const operator: ServiceOperatorSnapshot = {
  operatorId: '990001',
  displayName: '林川',
  workstationCode: '01',
  acceptanceOffice: '长风支局',
  receivingOffice: '栖沄邮件处理中心',
}

async function addSettledMail(
  repository: MemoryServiceRepository,
  itemCode: string,
  weightGrams: number,
) {
  const product = SERVICE_PRODUCTS.find((candidate) => candidate.id === 'ordinary-letter-100')!
  const acceptedAt = '2026-08-10T09:00:00.000+10:00'
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    destinationZone: 'nonlocal' as const,
    destinationOffice: '栖沄邮件处理中心',
    itemCode,
    weightGrams,
  }
  const accepted = await repository.accept({
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: { ...createEmptySender(), name: '演练寄件人' },
      recipient: { ...createEmptyRecipient(), name: '演练收件人' },
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
  return accepted.transaction.id
}

function bagFor(firstId: string, secondId: string): DispatchBagRecord {
  return {
    id: 'ZB-20260810-000001',
    bagBarcode: '990101202608105010100000000001',
    manifestTypeCode: 'GNPCXH',
    manifestTypeName: '国内平函',
    bagBarcodeTypeCode: '411',
    bagBarcodeTypeName: '平信袋',
    receivingOfficeCode: '99101001',
    receivingOfficeName: '栖沄邮件处理中心',
    directSeal: false,
    consolidation: true,
    localTransfer: false,
    manifestNumber: '501',
    receptacleType: '1.袋',
    usesBarcodeContainer: false,
    containerBarcode: '',
    rfidBagTagNumber: '',
    shift: '01',
    mailReferences: [firstId, secondId].map((transactionId) => ({
      kind: 'transaction' as const,
      transactionId,
    })),
    totalItems: 2,
    mailWeightGrams: 50,
    emptyBagWeightGrams: 5,
    generatedAt: '2026-08-10T10:00:00.000+10:00',
    generatedBy: operator,
    tagPrintDecision: 'skipped',
    tagPrintedAt: null,
    sealingStatus: 'sealed',
    cancelledAt: null,
    cancelledBy: null,
  }
}

describe('DispatchBagInterchangeReturnWorkspace', () => {
  it('opens on the real business day even when retained fixtures use another date', async () => {
    const repository = MemoryServiceRepository.create()
    render(
      <DispatchBagInterchangeReturnWorkspace
        now={new Date('2026-08-19T02:00:00.000Z')}
        onBack={vi.fn()}
        operator={operator}
        repository={repository}
      />,
    )

    expect(await screen.findByLabelText('退回总包封发日期')).toHaveValue('2026-08-19')
    expect(screen.getByLabelText('退回总包封发日期')).toHaveAttribute('type', 'date')
  })

  it('queries, electronically checks and returns an exported bag after excluding a problem mail', async () => {
    const repository = MemoryServiceRepository.create()
    const keptId = await addSettledMail(repository, 'RA12345678901', 20)
    const removedId = await addSettledMail(repository, 'RA12345678902', 30)
    const state = await repository.load()
    await repository.restore({ ...state, dispatchBags: [bagFor(keptId, removedId)] })
    const routed = await repository.executeDispatchRouting({
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-10',
      generatedAt: '2026-08-10T11:00:00.000+10:00',
      operator,
    })
    const route = routed.routes.find((candidate) => candidate.kind === 'route')!
    await repository.executeDispatchRouting({
      type: 'export-dispatch-routes',
      routeIds: [route.id],
      exportDate: '2026-08-10',
      dispatchOrderNumber: 'PCD-20260810-A01',
      authorization: await createTestOnSiteAuthorization('export-dispatch-trip', operator.operatorId),
      exportedAt: '2026-08-10T12:00:00.000+10:00',
      operator,
    })

    const user = userEvent.setup()
    render(
      <DispatchBagInterchangeReturnWorkspace
        now={new Date('2026-08-10T02:00:00.000Z')}
        onBack={vi.fn()}
        operator={operator}
        repository={repository}
      />,
    )
    const barcode = await screen.findByRole('textbox', { name: '退回总包条码' })
    await user.type(barcode, '990101202608105010100000000001')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(screen.getByText('RA12345678901')).toBeInTheDocument()
    expect(screen.getByText('RA12345678902')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '电子勾核' }))
    expect(screen.getByRole('status')).toHaveTextContent('电子勾核通过：2 件，55 克')
    await user.click(screen.getByRole('checkbox', { name: '选择邮件 RA12345678902' }))
    await user.click(screen.getByRole('button', { name: '退回互换局' }))

    const dialog = screen.getByRole('dialog', { name: '获取总包退回信息' })
    expect(within(dialog).getByRole('textbox', { name: '邮件重量' })).toHaveValue('20')
    expect(within(dialog).getByRole('textbox', { name: '邮件件数' })).toHaveValue('1')
    expect(within(dialog).getByRole('textbox', { name: '总包重量' })).toHaveValue('25')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '退回封发班次' }), '02')
    await user.click(within(dialog).getByRole('button', { name: '确定' }))

    expect(await screen.findByRole('status')).toHaveTextContent('总包退回互换局成功')
    const persisted = await repository.load()
    expect(persisted.dispatchBagInterchangeReturns).toHaveLength(1)
    expect(persisted.dispatchBags[0]).toMatchObject({
      totalItems: 1,
      mailWeightGrams: 20,
      shift: '02',
      mailReferences: [{ transactionId: keptId }],
    })
    expect(persisted.dispatchRoutes.filter((candidate) => candidate.deletedAt === null))
      .toEqual([])
  })
})
