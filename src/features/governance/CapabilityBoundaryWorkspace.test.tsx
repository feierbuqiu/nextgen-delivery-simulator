import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CapabilityBoundaryWorkspace } from './CapabilityBoundaryWorkspace'

describe('CapabilityBoundaryWorkspace', () => {
  it('shows the governed boundary without presenting a fake insurance workflow', () => {
    render(
      <CapabilityBoundaryWorkspace
        capabilityId="channel.business.insurance"
        fallbackLabel="保险业务受理"
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: '保险业务受理' })).toBeInTheDocument()
    expect(screen.getByText('规划中')).toBeInTheDocument()
    expect(screen.getByText('channel.business.insurance')).toBeInTheDocument()
    expect(screen.getByText(/不会生成、保存或展示伪造的业务办理结果/u)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /提交|保存|受理/u })).not.toBeInTheDocument()
  })
})
