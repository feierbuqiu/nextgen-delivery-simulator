import { useState, type ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_OPERATOR_PROFILE } from '../../domain/access/catalog'
import {
  hasPermission,
  replaceOperator,
  selectActiveOperator,
} from '../../domain/access/authorization'
import { localWorkDate } from '../../domain/access/attendance'
import { submitRoleRequest } from '../../domain/access/management'
import { createSeedState } from '../../domain/access/seed'
import type { SimulatorState } from '../../domain/access/types'
import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import { calculateServiceCharge } from '../../domain/service/policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from '../../domain/service/seed'
import { DEFAULT_SERVICE_OPERATOR } from '../../domain/service/transactions'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { BasicManagementWorkspace } from './BasicManagementWorkspace'
import { BusinessManagementWorkspace } from './BusinessManagementWorkspace'
import { PersonalAccessDialog } from './PersonalAccessDialog'

function completedOrdinary(state: SimulatorState): SimulatorState {
  return replaceOperator(state, {
    ...state.operator,
    profileCompleted: true,
    requiresSecretChange: false,
    profile: structuredClone(DEFAULT_OPERATOR_PROFILE),
  })
}

function StateHarness({
  initialState,
  children,
}: {
  initialState: SimulatorState
  children: (
    state: SimulatorState,
    save: (next: SimulatorState) => Promise<void>,
  ) => ReactNode
}) {
  const [state, setState] = useState(initialState)
  return <>
    <pre data-testid="access-state" hidden>{JSON.stringify(state)}</pre>
    {children(state, async (next) => setState(next))}
  </>
}

describe('personnel and attendance workspaces', () => {
  it('persists self-service fields and submits a specialist-role request', async () => {
    const seed = completedOrdinary(await createSeedState())
    const user = userEvent.setup()
    render(<StateHarness initialState={seed}>{(state, save) => <PersonalAccessDialog initialTab="profile" onClose={() => undefined} onStateChange={save} state={state} />}</StateHarness>)

    const phone = screen.getByRole('textbox', { name: '个人手机号码' })
    await user.clear(phone)
    await user.type(phone, '10000000015')
    await user.click(screen.getByRole('button', { name: '保存个人设置' }))
    expect(await screen.findByRole('status')).toHaveTextContent('个人联系与通知信息已保存')
    expect(screen.getByTestId('access-state')).toHaveTextContent('10000000015')

    await user.click(screen.getByRole('button', { name: '我的岗位与权限' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '申请专项权限' }), 'postage-meter-manager')
    await user.type(screen.getByRole('textbox', { name: '权限申请原因' }), '承担邮资机日常登记工作')
    await user.click(screen.getByRole('button', { name: '提交申请' }))

    expect(await screen.findByRole('status')).toHaveTextContent('等待具备权限的管理人员登录后手工审批')
    expect(screen.getByRole('region', { name: '我的人员与权限申请' })).toHaveTextContent('邮资机业务权限')
    expect(screen.getByRole('region', { name: '我的人员与权限申请' })).toHaveTextContent('待审批')
    expect(screen.getByRole('region', { name: '我的人员与权限申请' })).toHaveTextContent('—')
    expect(screen.getByTestId('access-state')).toHaveTextContent('PERSON-000001')
  })

  it('lets a personnel clerk submit a new employee request without directly creating the account', async () => {
    const manager = selectActiveOperator(await createSeedState(), '84000001')
    const user = userEvent.setup()
    render(<StateHarness initialState={manager}>{(state, save) => <BasicManagementWorkspace onBack={() => undefined} onStateChange={save} repository={MemoryServiceRepository.create()} state={state} />}</StateHarness>)

    expect(screen.getByRole('heading', { name: '系统管理' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '新增人员' }))
    const dialog = screen.getByRole('dialog', { name: '新增人员申请' })
    await user.type(within(dialog).getByRole('textbox', { name: '人员申请原因' }), '新增营业岗位人员')
    await user.click(within(dialog).getByRole('button', { name: '提交申请' }))

    expect(await screen.findByRole('status')).toHaveTextContent('人员申请已提交')
    const saved = JSON.parse(screen.getByTestId('access-state').textContent ?? '{}') as SimulatorState
    expect(saved.personnelRequests).toHaveLength(1)
    expect(saved.operators.some((operator) => operator.id === '80000002')).toBe(false)
  })

  it('lets the county basic-management account maintain a missing dispatch relation with audit', async () => {
    const repository = MemoryServiceRepository.create()
    const product = SERVICE_PRODUCTS.find((item) => item.id === 'registered-letter-200')!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      destinationZone: 'nonlocal' as const,
      itemCode: 'XA10000000009',
      weightGrams: 20,
    }
    const accepted = await repository.accept({
      acceptedAt: '2026-08-20T01:00:00.000Z',
      charge: calculateServiceCharge(draft, product),
      customer: {
        productFamily: 'basic-letter',
        destinationRegion: 'domestic',
        sender: { ...createEmptySender(), name: '演练寄件人' },
        recipient: { ...createEmptyRecipient(), name: '演练收件人' },
      },
      draft,
      product,
      operator: DEFAULT_SERVICE_OPERATOR,
    })
    await repository.settle({
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: '2026-08-20T01:05:00.000Z',
      amountReceivedCents: accepted.transaction.charge.settlementDueCents,
    })
    const selected = selectActiveOperator(await createSeedState(), '84000001')
    const manager: SimulatorState = {
      ...selected,
      session: {
        operatorId: '84000001',
        workstationCode: '管理端',
        signedInAt: '2026-08-20T01:10:00.000Z',
        platformTestDuty: null,
      },
    }
    const user = userEvent.setup()
    render(<StateHarness initialState={manager}>{(state, save) => <BasicManagementWorkspace onBack={() => undefined} onStateChange={save} repository={repository} state={state} />}</StateHarness>)

    await user.click(screen.getByRole('button', { name: '封发关系管理' }))
    const row = (await screen.findByText('XA10000000009')).closest('tr') as HTMLTableRowElement
    await user.click(within(row).getByRole('button', { name: '维护' }))
    const dialog = screen.getByRole('dialog', { name: '维护封发关系' })
    await user.selectOptions(within(dialog).getByLabelText('关系维护清单种类'), 'GNPCXH')
    await user.click(within(dialog).getByRole('button', { name: '保存封发关系' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('人工核对关系内容')
    await user.click(within(dialog).getByRole('checkbox', { name: /当前登录的上级经办人员已人工核对/u }))
    await user.click(within(dialog).getByRole('button', { name: '保存封发关系' }))

    expect(await screen.findByRole('status')).toHaveTextContent('网点刷新后即可使用')
    expect((await repository.load()).dispatchRelationOverrides[0]).toMatchObject({
      key: '99901001:registered-letter-200:nonlocal:single',
      institutionCode: '99901001',
      manifestTypeCode: 'GNPCXH',
      updatedBy: { operatorId: '84000001' },
    })
    const saved = JSON.parse(screen.getByTestId('access-state').textContent ?? '{}') as SimulatorState
    expect(saved.accessAuditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'dispatch-relation-management-authorized',
        actorId: '84000001',
      }),
    ]))
  })

  it('signs the current employee out without conflating it with session logout', async () => {
    const completed = completedOrdinary(await createSeedState())
    const signedInAt = new Date(Date.now() - 60_000).toISOString()
    const workDate = localWorkDate(new Date())
    const attended: SimulatorState = {
      ...completed,
      nextAttendanceSequence: 2,
      attendanceRecords: [{
        id: 'ATT-000001',
        workDate,
        institutionCode: '99901001',
        institutionName: '景麓营业部',
        operatorId: completed.operator.id,
        operatorName: completed.operator.profile?.displayName ?? '演示营业员',
        workstationCode: '01',
        institutionSignedInAt: signedInAt,
        institutionSignedOutAt: null,
        employeeSignedInAt: signedInAt,
        employeeSignedOutAt: null,
        institutionSignOutCancelledAt: null,
        employeeSignOutCancelledAt: null,
      }],
    }
    const attendedWithSession: SimulatorState = {
      ...attended,
      session: {
        operatorId: attended.operator.id,
        workstationCode: '01',
        signedInAt,
        platformTestDuty: null,
      },
    }
    const user = userEvent.setup()
    render(<StateHarness initialState={attendedWithSession}>{(state, save) => <BusinessManagementWorkspace onBack={() => undefined} onStateChange={save} state={state} />}</StateHarness>)

    await user.click(screen.getByRole('button', { name: '员工签退' }))
    const dialog = screen.getByRole('dialog', { name: '员工签退' })
    await user.type(within(dialog).getByLabelText('签到签退当前登录密码'), '6yhn&UJM8ik,')
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: '确认办理' }))
    expect(await screen.findByRole('status')).toHaveTextContent('员工签退完成')
    expect(screen.getByRole('button', { name: '撤销员工签退' })).toBeInTheDocument()
    const saved = JSON.parse(screen.getByTestId('access-state').textContent ?? '{}') as SimulatorState
    expect(saved.attendanceRecords[0]?.employeeSignedOutAt).not.toBeNull()
    expect(saved.session).toMatchObject({ operatorId: '80000001', workstationCode: '01' })
  })

  it('blocks employee sign-out while customer business is still pending settlement', async () => {
    const completed = completedOrdinary(await createSeedState())
    const signedInAt = new Date(Date.now() - 60_000).toISOString()
    const workDate = localWorkDate(new Date())
    const attended: SimulatorState = {
      ...completed,
      nextAttendanceSequence: 2,
      attendanceRecords: [{
        id: 'ATT-000001',
        workDate,
        institutionCode: '99901001',
        institutionName: '景麓营业部',
        operatorId: completed.operator.id,
        operatorName: completed.operator.profile?.displayName ?? '演示营业员',
        workstationCode: '01',
        institutionSignedInAt: signedInAt,
        institutionSignedOutAt: null,
        employeeSignedInAt: signedInAt,
        employeeSignedOutAt: null,
        institutionSignOutCancelledAt: null,
        employeeSignOutCancelledAt: null,
      }],
      session: {
        operatorId: completed.operator.id,
        workstationCode: '01',
        signedInAt,
        platformTestDuty: null,
      },
    }
    const user = userEvent.setup()
    render(<StateHarness initialState={attended}>{(state, save) => <BusinessManagementWorkspace onBack={() => undefined} onStateChange={save} pendingBusinessCount={1} pendingBusinessTotalCents={120} state={state} />}</StateHarness>)

    await user.click(screen.getByRole('button', { name: '员工签退' }))
    const dialog = screen.getByRole('dialog', { name: '员工签退' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('先完成结算或中断')
    expect(within(dialog).getByRole('button', { name: '确认办理' })).toBeDisabled()
  })

  it('requires confirmed personal remittance before signing out after settled business', async () => {
    const completed = completedOrdinary(await createSeedState())
    const signedInAt = new Date(Date.now() - 60_000).toISOString()
    const workDate = localWorkDate(new Date())
    const attended: SimulatorState = {
      ...completed,
      nextAttendanceSequence: 2,
      attendanceRecords: [{
        id: 'ATT-000001',
        workDate,
        institutionCode: '99901001',
        institutionName: '景麓营业部',
        operatorId: completed.operator.id,
        operatorName: completed.operator.profile?.displayName ?? '演示营业员',
        workstationCode: '01',
        institutionSignedInAt: signedInAt,
        institutionSignedOutAt: null,
        employeeSignedInAt: signedInAt,
        employeeSignedOutAt: null,
        institutionSignOutCancelledAt: null,
        employeeSignOutCancelledAt: null,
      }],
      session: {
        operatorId: completed.operator.id,
        workstationCode: '01',
        signedInAt,
        platformTestDuty: null,
      },
    }
    const repository = MemoryServiceRepository.create()
    const product = SERVICE_PRODUCTS[0]!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      itemCode: '7000818316568',
      weightGrams: 20,
    }
    const accepted = await repository.accept({
      acceptedAt: `${workDate}T01:00:00.000Z`,
      charge: calculateServiceCharge(draft, product),
      customer: {
        productFamily: 'basic-letter',
        destinationRegion: 'domestic',
        sender: { ...createEmptySender(), name: '林澄', detailedAddress: '澜京市栖台区新程路 1 号' },
        recipient: { ...createEmptyRecipient(), name: '顾远', detailedAddress: '澄岐省澄野市江洲区远帆路 2 号' },
      },
      draft,
      product,
      operator: DEFAULT_SERVICE_OPERATOR,
    })
    await repository.settle({
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: `${workDate}T01:05:00.000Z`,
      amountReceivedCents: accepted.transaction.charge.settlementDueCents,
    })
    const onOpenPersonalRemittance = vi.fn()
    const user = userEvent.setup()
    render(<StateHarness initialState={attended}>{(state, save) => <BusinessManagementWorkspace onBack={() => undefined} onOpenPersonalRemittance={onOpenPersonalRemittance} onStateChange={save} serviceRepository={repository} state={state} />}</StateHarness>)

    await user.click(screen.getByRole('button', { name: '员工签退' }))
    const dialog = screen.getByRole('dialog', { name: '员工签退' })
    expect(await within(dialog).findByText('尚未确认')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '确认办理' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: '前往个人缴款' }))
    expect(onOpenPersonalRemittance).toHaveBeenCalledOnce()
  })

  it('lets another authorized employee approve a pending role request', async () => {
    const ordinary = completedOrdinary(await createSeedState())
    const requested = submitRoleRequest(
      ordinary,
      'postage-meter-manager',
      '承担邮资机登记',
      '2026-08-12T08:00:00.000Z',
    )
    const manager = selectActiveOperator(requested, '92000001')
    const user = userEvent.setup()
    render(<StateHarness initialState={manager}>{(state, save) => <BusinessManagementWorkspace onBack={() => undefined} onStateChange={save} state={state} />}</StateHarness>)

    await user.click(screen.getByRole('button', { name: '人员与岗位审批' }))
    await user.click(screen.getByRole('button', { name: '审批' }))
    const dialog = screen.getByRole('dialog', { name: /岗位权限变更 PERSON-000001/ })
    await user.type(within(dialog).getByRole('textbox', { name: '人员审批意见' }), '培训合格，同意开通。')
    await user.click(within(dialog).getByRole('button', { name: '审批通过' }))

    expect(await screen.findByRole('status')).toHaveTextContent('人员申请审批通过')
    const saved = JSON.parse(screen.getByTestId('access-state').textContent ?? '{}') as SimulatorState
    expect(hasPermission(saved, 'workspace.channel.postage-meter', '80000001')).toBe(true)
    expect(hasPermission(saved, 'workspace.channel.core', '80000001')).toBe(true)
  })
})
