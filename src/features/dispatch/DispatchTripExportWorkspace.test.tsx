import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createServiceSeedState } from '../../domain/service/seed'
import type { DispatchBagRecord, ServiceOperatorSnapshot } from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { createTestOnSiteAuthorizer } from '../../test/workAuthorization'
import { DispatchTripExportWorkspace } from './DispatchTripExportWorkspace'

const operator: ServiceOperatorSnapshot = {
  operatorId: '990001',
  displayName: '林川',
  workstationCode: '01',
  acceptanceOffice: '长风支局',
  receivingOffice: '栖沄邮件处理中心',
}

const bag: DispatchBagRecord = {
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

describe('DispatchTripExportWorkspace', () => {
  it('keeps the current handover day separate from a prior sealing day used for catchup', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.restore({
      ...createServiceSeedState(),
      dispatchBags: [{ ...bag, generatedAt: '2026-08-09T02:00:00.000Z' }],
    })
    await repository.executeDispatchRouting({
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-09',
      generatedAt: '2026-08-09T03:00:00.000Z',
      operator,
    })
    const user = userEvent.setup()
    render(
      <DispatchTripExportWorkspace
        onBack={vi.fn()}
        now={new Date('2026-08-10T02:00:00.000Z')}
        operator={operator}
        repository={repository}
        authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)}
      />,
    )

    expect(await screen.findByLabelText('出口交接日期')).toHaveValue('2026-08-10')
    await user.click(screen.getByRole('button', { name: '勾挑路单' }))
    expect(screen.getByLabelText('勾挑封发日期')).toHaveValue('2026-08-09')
  })

  it('collects a dispatch order and exports a selected route', async () => {
    const repository = MemoryServiceRepository.create()
    await repository.restore({ ...createServiceSeedState(), dispatchBags: [bag] })
    await repository.executeDispatchRouting({
      type: 'generate-dispatch-routes',
      routeCode: 'SIM-A01',
      shift: '01',
      sealingDate: '2026-08-10',
      generatedAt: '2026-08-10T11:00:00.000+10:00',
      operator,
    })
    const user = userEvent.setup()
    render(
      <DispatchTripExportWorkspace
        onBack={vi.fn()}
        now={new Date('2026-08-10T02:00:00.000Z')}
        operator={operator}
        repository={repository}
        authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)}
      />,
    )

    const checkbox = await screen.findByRole('checkbox', { name: '选择出口路单 000001' })
    expect(screen.getByLabelText('邮车派押局')).toHaveValue('栖沄转运中心')
    await user.click(screen.getByRole('button', { name: '出口交接' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请选择需要出口的路单')
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: '出口交接' }))
    expect(screen.getByRole('dialog', { name: '派车单号采集' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确定' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入派车单号')
    await user.type(
      screen.getByRole('textbox', { name: '派车单号' }),
      'PCD-20260810-A01',
    )
    await user.click(screen.getByRole('button', { name: '确定' }))
    expect(screen.getByRole('dialog', { name: '授权' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('趟车出口授权工号'), '90000001')
    await user.type(screen.getByLabelText('趟车出口授权密码'), 'wrong')
    await user.click(screen.getByRole('button', { name: '确认授权' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('授权人员密码校验失败')
    expect((await repository.load()).dispatchRoutes.find((route) => route.kind === 'route'))
      .toMatchObject({ exportedAt: null, exportAuthorizedBy: null })
    await user.clear(screen.getByLabelText('趟车出口授权密码'))
    await user.type(screen.getByLabelText('趟车出口授权密码'), 'Supervisor!2026')
    await user.click(screen.getByRole('button', { name: '确认授权' }))

    expect(await screen.findByText('出口成功：已授权并交接 1 张路单。')).toBeInTheDocument()
    const state = await repository.load()
    expect(state.dispatchRoutes.find((route) => route.kind === 'route')).toMatchObject({
      dispatchOrderNumber: 'PCD-20260810-A01',
      exportAuthorizedBy: '90000001',
      exportAuthorizedAt: expect.any(String),
      exportedAt: expect.any(String),
    })
    expect(state.dispatchRoutes.find((route) => route.kind === 'master-route'))
      .toMatchObject({ exportedAt: expect.any(String) })
  })

  it('shows a recoverable read failure without switching to temporary memory', async () => {
    const repository = MemoryServiceRepository.create()
    const load = vi.spyOn(repository, 'load')
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(createServiceSeedState())
    const user = userEvent.setup()
    render(
      <DispatchTripExportWorkspace
        onBack={vi.fn()}
        operator={operator}
        repository={repository}
        authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('未进入临时内存模式')
    await user.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByRole('region', { name: '趟车出口条件' })).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
