import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { IndexedDbAvailabilityMonitor } from '../infrastructure/indexeddb/IndexedDbAvailability'
import { StorageAvailabilityBanner } from './StorageAvailabilityBanner'

describe('StorageAvailabilityBanner', () => {
  it('states that persistence failed and no memory fallback was used', () => {
    const monitor = new IndexedDbAvailabilityMonitor()
    render(<StorageAvailabilityBanner monitor={monitor} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    act(() => monitor.report({
      kind: 'unavailable',
      source: '业务与交割数据',
      occurredAt: '2026-08-19T00:00:00.000Z',
      detail: 'VersionError',
    }))

    expect(screen.getByRole('alert')).toHaveTextContent('没有切换到临时内存')
    expect(screen.getByRole('alert')).toHaveTextContent('不要清除站点数据')
  })
})
