import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createServiceSeedState } from '../../domain/service/seed'
import type {
  DispatchBagRecord,
  ServiceOperatorSnapshot,
} from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { DispatchPrintWorkspace } from './DispatchPrintWorkspace'

const operator: ServiceOperatorSnapshot = {
  operatorId: '990001',
  displayName: '林川',
  workstationCode: '01',
  acceptanceOffice: '长风支局',
  receivingOffice: '虚构寄达局',
}

const PRINT_NOW = new Date('2026-08-10T02:00:00.000Z')

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

describe('DispatchPrintWorkspace', () => {
  it('prints a selected manifest, records the audit, and removes it from unprinted results', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.restore({
      ...createServiceSeedState(),
      dispatchBags: [dispatchBag()],
    })
    const user = userEvent.setup()
    render(
      <DispatchPrintWorkspace
        now={PRINT_NOW}
        onBack={vi.fn()}
        operator={operator}
        repository={repository}
      />,
    )

    await user.click(await screen.findByRole('checkbox', { name: '选择打印记录 501' }))
    expect(screen.getByLabelText('打印封发日期')).toHaveValue('2026-08-10')
    await user.click(screen.getByRole('button', { name: '打印' }))

    expect(await screen.findByRole('dialog', { name: '清单打印预览' })).toBeInTheDocument()
    await expect(repository.load()).resolves.toMatchObject({
      nextDispatchPrintSequence: 2,
      dispatchPrintRecords: [{
        documentType: 'manifest',
        targetId: 'ZB-20260810-000001',
      }],
    })
    await user.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.getByText('无数据')).toBeInTheDocument()
  })

  it('records a pre-made bag tag without mutating the original bag weight', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.restore({
      ...createServiceSeedState(),
      dispatchBags: [dispatchBag()],
    })
    const user = userEvent.setup()
    render(
      <DispatchPrintWorkspace
        now={PRINT_NOW}
        onBack={vi.fn()}
        operator={operator}
        repository={repository}
      />,
    )

    await user.click(await screen.findByRole('checkbox', { name: '选择打印记录 501' }))
    await user.click(screen.getByRole('button', { name: '预制袋牌' }))
    const weight = screen.getByRole('textbox', { name: '预制袋牌重量' })
    await user.clear(weight)
    await user.type(weight, '95')
    await user.type(screen.getByRole('textbox', { name: '预制袋牌备注' }), '改重')
    await user.click(screen.getByRole('button', { name: '打印预览' }))

    expect(await screen.findByRole('dialog', { name: '预制袋牌打印预览' })).toBeInTheDocument()
    const state = await repository.load()
    expect(state.dispatchBags[0]!.mailWeightGrams).toBe(80)
    expect(state.dispatchPrintRecords[0]).toMatchObject({
      documentType: 'premade-bag-tag',
      weightGrams: 95,
      remark: '改重',
    })
  })

  it('does not jump to the latest retained dispatch day when the native page opens', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.restore({
      ...createServiceSeedState(),
      dispatchBags: [dispatchBag()],
    })

    render(
      <DispatchPrintWorkspace
        now={new Date('2026-08-19T02:00:00.000Z')}
        onBack={vi.fn()}
        operator={operator}
        repository={repository}
      />,
    )

    expect(await screen.findByLabelText('打印封发日期')).toHaveValue('2026-08-19')
    expect(screen.getByRole('cell', { name: '无数据' })).toBeInTheDocument()
  })
})
