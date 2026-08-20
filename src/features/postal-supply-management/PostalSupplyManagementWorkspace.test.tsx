import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { postalSupplyInstitutionInventory } from '../../domain/service/postalSupplyManagement'
import type { ServiceOperatorSnapshot } from '../../domain/service/types'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { createTestOnSiteAuthorizer } from '../../test/workAuthorization'
import { PostalSupplyManagementWorkspace } from './PostalSupplyManagementWorkspace'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '虚构寄达局',
}

function workspace(repository: MemoryServiceRepository, section: 'inbound' | 'approval' | 'receipt') {
  return (
    <PostalSupplyManagementWorkspace
      institutionCode="99901001"
      onBack={vi.fn()}
      operator={operator}
      repository={repository}
      section={section}
      authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)}
    />
  )
}

describe('PostalSupplyManagementWorkspace', () => {
  it('adds an item and saves an institution inbound document', async () => {
    const repository = MemoryServiceRepository.create()
    const before = postalSupplyInstitutionInventory(await repository.load(), 'supply-standard-envelope')
    const user = userEvent.setup()
    render(workspace(repository, 'inbound'))

    await user.click(await screen.findByRole('button', { name: '添加' }))
    const dialog = screen.getByRole('dialog', { name: '物品名称检索' })
    await user.click(within(dialog).getByRole('checkbox', { name: '管理选择物品 演示标准信封' }))
    await user.click(within(dialog).getByRole('button', { name: '添加' }))
    const quantity = screen.getByRole('spinbutton', { name: '业务数量 演示标准信封' })
    await user.clear(quantity)
    await user.type(quantity, '4')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('status')).toHaveTextContent('保存成功')
    const state = await repository.load()
    expect(postalSupplyInstitutionInventory(state, 'supply-standard-envelope')).toBe(before + 4)
    expect(state.postalSupplyDocuments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'inbound', status: 'saved' }),
    ]))
  })

  it('approves a pending requisition with its actual issued quantity', async () => {
    const repository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(workspace(repository, 'approval'))

    const row = await screen.findByText('YPGL-QL-20260808-000002')
    await user.click(within(row.closest('tr') as HTMLTableRowElement).getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('button', { name: '确认核发' }))

    expect(await screen.findByRole('status')).toHaveTextContent('确认核发成功')
    expect((await repository.load()).postalSupplyDocuments.find((document) => document.id === 'YPGL-QL-20260808-000002'))
      .toMatchObject({ status: 'approved' })
  })

  it('confirms receipt of an approved requisition and removes it from the pending list', async () => {
    const repository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(workspace(repository, 'receipt'))

    const row = await screen.findByText('YPGL-QL-20260809-000003')
    await user.click(within(row.closest('tr') as HTMLTableRowElement).getByRole('button', { name: '确认接收' }))

    expect(await screen.findByRole('status')).toHaveTextContent('确认接收成功')
    expect(screen.queryByText('YPGL-QL-20260809-000003')).not.toBeInTheDocument()
    expect((await repository.load()).postalSupplyDocuments.find((document) => document.id === 'YPGL-QL-20260809-000003'))
      .toMatchObject({ status: 'received' })
  })

  it('does not prefill supervisor credentials for inventory confirmation', async () => {
    const repository = MemoryServiceRepository.create()
    render(
      <PostalSupplyManagementWorkspace
        institutionCode="99901001"
        onBack={vi.fn()}
        operator={operator}
        repository={repository}
        section="inventory"
        authorizeOnSite={createTestOnSiteAuthorizer(operator.operatorId)}
      />,
    )

    expect(await screen.findByLabelText('库存盘点主管工号')).toHaveValue('')
    expect(screen.getByLabelText('库存盘点主管密码')).toHaveValue('')
  })
})
