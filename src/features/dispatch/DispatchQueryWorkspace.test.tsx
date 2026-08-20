import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createTestOnSiteAuthorization } from '../../test/workAuthorization'
import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import type { DispatchBagRecord, ServiceOperatorSnapshot } from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { DispatchQueryWorkspace } from './DispatchQueryWorkspace'

const operator: ServiceOperatorSnapshot = {
  operatorId: '990001',
  displayName: '林川',
  workstationCode: '01',
  acceptanceOffice: '长风支局',
  receivingOffice: '栖沄邮件处理中心',
}

async function addSettledMail(
  repository: MemoryServiceRepository,
  acceptedAt: string,
  recipientName: string,
) {
  const product = SERVICE_PRODUCTS.find((candidate) => candidate.id === 'ordinary-letter-100')!
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    destinationZone: 'nonlocal' as const,
    destinationOffice: '栖沄邮件处理中心',
    weightGrams: 20,
  }
  const accepted = await repository.accept({
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: { ...createEmptySender(), name: '演练寄件人' },
      recipient: { ...createEmptyRecipient(), name: recipientName },
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

function bagFor(transactionId: string): DispatchBagRecord {
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
    mailReferences: [{ kind: 'transaction', transactionId }],
    totalItems: 1,
    mailWeightGrams: 20,
    emptyBagWeightGrams: 0,
    generatedAt: '2026-08-10T10:00:00.000+10:00',
    generatedBy: operator,
    tagPrintDecision: 'skipped',
    tagPrintedAt: null,
    sealingStatus: 'sealed',
    cancelledAt: null,
    cancelledBy: null,
  }
}

describe('DispatchQueryWorkspace', () => {
  it('does not replace today with the latest retained operational date', async () => {
    const repository = MemoryServiceRepository.create()
    const mailId = await addSettledMail(
      repository,
      '2026-01-15T09:00:00.000+10:00',
      '历史收件人',
    )
    const user = userEvent.setup()
    render(
      <DispatchQueryWorkspace
        institutionCode="99901001"
        institutionName="长风支局"
        now={new Date('2026-08-19T02:00:00.000Z')}
        onBack={vi.fn()}
        repository={repository}
      />,
    )

    expect(await screen.findByLabelText('状态查询收寄日期')).toHaveValue('2026-08-19')
    expect(screen.queryByText(mailId)).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('状态查询收寄日期'))
    await user.type(screen.getByLabelText('状态查询收寄日期'), '2026-01-15')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByText(mailId)).toBeInTheDocument()
  })

  it('shows linked mail status, bag export time and unhanded mail tabs', async () => {
    const repository = MemoryServiceRepository.create()
    const routedMailId = await addSettledMail(
      repository,
      '2026-08-10T09:00:00.000+10:00',
      '已出口收件人',
    )
    const unhandedMailId = await addSettledMail(
      repository,
      '2026-08-10T09:10:00.000+10:00',
      '未交接收件人',
    )
    const state = await repository.load()
    await repository.restore({ ...state, dispatchBags: [bagFor(routedMailId)] })
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
      <DispatchQueryWorkspace
        institutionCode="99901001"
        institutionName="长风支局"
        now={new Date('2026-08-10T02:00:00.000Z')}
        onBack={vi.fn()}
        repository={repository}
      />,
    )

    expect(await screen.findByText('已出口')).toBeInTheDocument()
    const routedRow = screen.getByText(routedMailId).closest('tr')!
    await user.click(within(routedRow).getByRole('button', { name: '展开' }))
    expect(screen.getByRole('dialog', { name: '邮件当前保管状态' })).toBeInTheDocument()
    expect(screen.getByText('990101202608105010100000000001')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭' }))

    await user.click(screen.getByRole('button', { name: '总包出口时间查询' }))
    expect(screen.getByText('990101202608105010100000000001')).toBeInTheDocument()
    expect(screen.getByText(/2026\/8\/10/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '未交接邮件查询' }))
    expect(screen.getAllByText(unhandedMailId)).toHaveLength(2)
    expect(screen.queryByText(routedMailId)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '封发平衡台账' }))
    expect(within(screen.getByRole('region', { name: '封发平衡台账查询结果' }))
      .getByRole('row', { name: '1 2026-08-10 2 1 0 1 0' })).toBeInTheDocument()
  })
})
