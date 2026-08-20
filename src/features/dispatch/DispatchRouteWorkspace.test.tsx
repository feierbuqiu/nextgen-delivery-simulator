import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createServiceSeedState } from '../../domain/service/seed'
import type {
  DispatchBagRecord,
  DispatchBagHandoverRecord,
  ServiceOperatorSnapshot,
} from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { DispatchRouteWorkspace } from './DispatchRouteWorkspace'

const operator: ServiceOperatorSnapshot = {
  operatorId: '990001',
  displayName: '林川',
  workstationCode: '01',
  acceptanceOffice: '长风支局',
  receivingOffice: '虚构寄达局',
}

const ROUTE_NOW = new Date('2026-08-10T02:00:00.000Z')

function dispatchBag(): DispatchBagRecord {
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
    mailReferences: [],
    totalItems: 2,
    mailWeightGrams: 80,
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

describe('DispatchRouteWorkspace', () => {
  it('generates a route and master route from an eligible sealed bag', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.restore({
      ...createServiceSeedState(),
      dispatchBags: [dispatchBag()],
    })
    const onOpenPrint = vi.fn()
    const user = userEvent.setup()
    render(
      <DispatchRouteWorkspace
        now={ROUTE_NOW}
        onBack={vi.fn()}
        onOpenPrint={onOpenPrint}
        operator={operator}
        repository={repository}
      />,
    )

    await user.selectOptions(await screen.findByRole('combobox', { name: '路单邮路代码' }), 'SIM-A01')
    expect(screen.getByLabelText('路单封发日期')).toHaveValue('2026-08-10')
    await user.click(screen.getByRole('button', { name: '生成路单' }))

    expect(await screen.findByText('生成完成：路单 1 张，总路单 1 张。')).toBeInTheDocument()
    expect(screen.getAllByRole('cell', { name: /栖沄干线邮路/ })).toHaveLength(2)
    expect(screen.getByText('总路单')).toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      schemaVersion: 38,
      nextDispatchRouteSequence: 3,
      dispatchRoutes: [
        { kind: 'route', bagIds: ['ZB-20260810-000001'] },
        { kind: 'master-route', totalBags: 1 },
      ],
    })

    await user.click(screen.getByRole('button', { name: '路单/清单打印' }))
    expect(onOpenPrint).toHaveBeenCalledOnce()
  })

  it('adds a validated container-clearance route from the manual modal', async () => {
    const repository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(
      <DispatchRouteWorkspace
        now={ROUTE_NOW}
        onBack={vi.fn()}
        onOpenPrint={vi.fn()}
        operator={operator}
        repository={repository}
      />,
    )

    await user.selectOptions(await screen.findByRole('combobox', { name: '路单邮路代码' }), 'SIM-A01')
    await user.click(screen.getByRole('button', { name: '新增' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '手工路单种类' }), 'container-return')
    await user.type(screen.getByRole('textbox', { name: '手工总包重量' }), '500')
    const clearance = screen.getByRole('textbox', { name: '清退数量 标准条码邮袋' })
    await user.clear(clearance)
    await user.type(clearance, '2')
    await user.click(screen.getByRole('button', { name: '增加' }))

    expect(await screen.findByText(/容器清退 000001 已增加/)).toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      dispatchRoutes: [{
        kind: 'container-return',
        totalBags: 1,
        totalWeightGrams: 500,
        containerReturnLines: [{ clearanceQuantity: 2 }],
      }],
    })
  })

  it('shows the received effective shift instead of the original sealing shift', async () => {
    const repository = MemoryServiceRepository.create()
    const received: DispatchBagHandoverRecord = {
      id: 'ZBJ-000001',
      bagId: 'ZB-20260810-000001',
      status: 'received',
      originOfficeCode: '99901001',
      originOfficeName: '长风支局',
      receivingOfficeCode: '99101001',
      receivingOfficeName: '栖沄邮件处理中心',
      handedOverAt: '2026-08-10T10:10:00.000+10:00',
      handedOverBy: operator,
      receivedAt: '2026-08-10T10:20:00.000+10:00',
      receivedBy: operator,
      receiptShift: '03',
      shiftTransferredAt: null,
      shiftTransferredBy: null,
      withdrawnAt: null,
      withdrawnBy: null,
      returnedAt: null,
      returnedBy: null,
    }
    await repository.restore({
      ...createServiceSeedState(),
      dispatchBags: [dispatchBag()],
      dispatchBagHandovers: [received],
    })
    const user = userEvent.setup()
    render(
      <DispatchRouteWorkspace
        now={ROUTE_NOW}
        onBack={vi.fn()}
        onOpenPrint={vi.fn()}
        operator={operator}
        repository={repository}
      />,
    )

    await user.selectOptions(await screen.findByRole('combobox', { name: '路单邮路代码' }), 'SIM-A01')
    await user.selectOptions(screen.getByRole('combobox', { name: '路单班次' }), '03')
    await user.click(screen.getByRole('button', { name: '查询未生成路单的清单信息' }))

    const dialog = await screen.findByRole('dialog', { name: '未生成路单的清单信息' })
    expect(within(dialog).getByRole('cell', { name: '03' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('cell', { name: '01' })).not.toBeInTheDocument()
  })

  it('does not jump to the latest retained bag day when the native page opens', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.restore({
      ...createServiceSeedState(),
      dispatchBags: [dispatchBag()],
    })

    render(
      <DispatchRouteWorkspace
        now={new Date('2026-08-19T02:00:00.000Z')}
        onBack={vi.fn()}
        onOpenPrint={vi.fn()}
        operator={operator}
        repository={repository}
      />,
    )

    expect(await screen.findByLabelText('路单封发日期')).toHaveValue('2026-08-19')
  })
})
