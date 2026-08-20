import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_OPERATOR_PROFILE } from '../../domain/access/catalog'
import { replaceOperator } from '../../domain/access/authorization'
import { createSeedState } from '../../domain/access/seed'
import type { SimulatorState } from '../../domain/access/types'
import { MemoryCustomerRepository } from '../../infrastructure/memory/MemoryCustomerRepository'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { SimulatorShell } from './SimulatorShell'

function StatefulShell({
  initialState,
  clock,
  onStateChange,
}: {
  initialState: SimulatorState
  clock: () => Date
  onStateChange: (state: SimulatorState) => void
}) {
  const [state, setState] = useState(initialState)
  const [customerRepository] = useState(() => MemoryCustomerRepository.create())
  const [serviceRepository] = useState(() => MemoryServiceRepository.create())
  return <SimulatorShell
    clock={clock}
    customerRepository={customerRepository}
    onAccessStateChange={async (next) => {
      onStateChange(next)
      setState(next)
    }}
    onChangeSecret={vi.fn()}
    onExportArchive={vi.fn(async () => undefined)}
    onImportArchive={vi.fn(async () => undefined)}
    onLogout={vi.fn(async () => undefined)}
    onReset={vi.fn(async () => undefined)}
    serviceRepository={serviceRepository}
    state={state}
  />
}

async function createLoggedInOrdinaryState() {
  const seed = await createSeedState()
  const completed = replaceOperator(seed, {
    ...seed.operator,
    profileCompleted: true,
    requiresSecretChange: false,
    profile: structuredClone(DEFAULT_OPERATOR_PROFILE),
  })
  return {
    ...completed,
    session: {
      operatorId: completed.operator.id,
      workstationCode: '01',
      signedInAt: new Date().toISOString(),
      platformTestDuty: null,
    },
  }
}

describe('simulator shell duty guard', () => {
  it('keeps production workspaces closed until attendance is valid and exposes a direct attendance route', async () => {
    const state = await createLoggedInOrdinaryState()
    const user = userEvent.setup()
    render(<SimulatorShell
      customerRepository={MemoryCustomerRepository.create()}
      onAccessStateChange={vi.fn(async () => undefined)}
      onChangeSecret={vi.fn()}
      onExportArchive={vi.fn(async () => undefined)}
      onImportArchive={vi.fn(async () => undefined)}
      onLogout={vi.fn(async () => undefined)}
      onReset={vi.fn(async () => undefined)}
      serviceRepository={MemoryServiceRepository.create()}
      state={state}
    />)

    expect(screen.getByRole('status')).toHaveTextContent('业务办理与生产处理已暂停')
    expect(screen.getByRole('button', { name: '邮件封发' })).not.toHaveClass('shell-parent-item--locked')

    await user.click(screen.getByRole('button', { name: '综合受理' }))
    const gate = screen.getByRole('dialog', { name: '当前员工未处于有效签到状态' })
    expect(gate).toHaveTextContent('综合受理')
    await user.click(within(gate).getByRole('button', { name: '前往签到签退' }))

    expect(await screen.findByRole('heading', { name: '业务管理' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '当前员工签到' })).toBeInTheDocument()
  })

  it('warns before logging out when today has no attendance record', async () => {
    const state = await createLoggedInOrdinaryState()
    const user = userEvent.setup()
    const onLogout = vi.fn(async () => undefined)
    render(<SimulatorShell
      customerRepository={MemoryCustomerRepository.create()}
      onAccessStateChange={vi.fn(async () => undefined)}
      onChangeSecret={vi.fn()}
      onExportArchive={vi.fn(async () => undefined)}
      onImportArchive={vi.fn(async () => undefined)}
      onLogout={onLogout}
      onReset={vi.fn(async () => undefined)}
      serviceRepository={MemoryServiceRepository.create()}
      state={state}
    />)

    await user.click(screen.getByRole('button', { name: /人员信息/ }))
    await user.click(screen.getByRole('menuitem', { name: '退出系统' }))
    expect(screen.getByRole('dialog', { name: '今日尚未签到' })).toBeInTheDocument()
    expect(onLogout).not.toHaveBeenCalled()
  })

  it('does not allow a legacy test-duty session to bypass manual attendance', async () => {
    const base = await createLoggedInOrdinaryState()
    const state: SimulatorState = {
      ...base,
      session: {
        ...base.session!,
        platformTestDuty: {
          enabledAt: '2026-08-12T11:20:00.000Z',
          expiresAt: '2026-08-12T15:20:00.000Z',
          enabledBy: base.operator.id,
        },
      },
    }
    const onStateChange = vi.fn()
    const user = userEvent.setup()
    render(<StatefulShell
      clock={() => new Date('2026-08-12T11:30:00.000Z')}
      initialState={state}
      onStateChange={onStateChange}
    />)

    expect(screen.getByRole('status')).toHaveTextContent('业务办理与生产处理已暂停')
    expect(screen.queryByRole('button', { name: '开启平台测试值守' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '综合受理' }))
    const gate = screen.getByRole('dialog', { name: '当前员工未处于有效签到状态' })
    expect(gate).toHaveTextContent('不会触发模拟值守或自动考勤')
    expect(onStateChange).not.toHaveBeenCalled()
  })

  it('does not offer test duty at any clock time', async () => {
    const state = await createLoggedInOrdinaryState()
    const user = userEvent.setup()
    render(<StatefulShell
      clock={() => new Date('2026-08-12T01:30:00.000Z')}
      initialState={state}
      onStateChange={vi.fn()}
    />)

    expect(screen.queryByRole('button', { name: '开启平台测试值守' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '综合受理' }))
    const gate = screen.getByRole('dialog', { name: '当前员工未处于有效签到状态' })
    expect(within(gate).queryByRole('button', { name: '开启平台测试值守' })).not.toBeInTheDocument()
    expect(within(gate).getByRole('button', { name: '前往签到签退' })).toBeInTheDocument()
  })
})
