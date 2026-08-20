import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { CAPABILITY_CATALOG, capabilityCounts } from './capabilityCatalog'
import { CapabilityMatrixWorkspace } from './CapabilityMatrixWorkspace'

describe('CapabilityMatrixWorkspace', () => {
  it('shows the complete catalog and filters planned capabilities without overstating them', async () => {
    const user = userEvent.setup()
    render(<CapabilityMatrixWorkspace onBack={() => undefined} />)

    const workspace = screen.getByRole('region', { name: '功能成熟度' })
    expect(within(workspace).getByText(`${CAPABILITY_CATALOG.length} 项公开能力`))
      .toBeInTheDocument()

    const plannedCount = capabilityCounts().planned
    await user.selectOptions(
      within(workspace).getByRole('combobox', { name: '成熟度筛选' }),
      'planned',
    )
    expect(within(workspace).getByText(`当前显示 ${plannedCount} 项`)).toBeInTheDocument()
    expect(within(workspace).getByText('保险业务受理')).toBeInTheDocument()
    const plannedRows = within(workspace).getAllByRole('row').slice(1)
    expect(plannedRows).toHaveLength(plannedCount)
    for (const row of plannedRows) {
      expect(within(row).getByText('规划中')).toBeInTheDocument()
    }

    await user.type(within(workspace).getByRole('textbox', { name: '检索能力' }), '保险')
    expect(within(workspace).getByText('当前显示 1 项')).toBeInTheDocument()
    expect(within(workspace).getByText('channel.business.insurance')).toBeInTheDocument()
    expect(within(workspace).getByText(/未模拟任何现实保险主体/)).toBeInTheDocument()
  })
})
