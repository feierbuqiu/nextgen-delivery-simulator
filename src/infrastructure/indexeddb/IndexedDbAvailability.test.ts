import { describe, expect, it, vi } from 'vitest'

import {
  IndexedDbAvailabilityMonitor,
  reportIndexedDbIssue,
} from './IndexedDbAvailability'

describe('IndexedDbAvailabilityMonitor', () => {
  it('publishes and clears the latest storage issue', () => {
    const monitor = new IndexedDbAvailabilityMonitor()
    const listener = vi.fn()
    const unsubscribe = monitor.subscribe(listener)

    reportIndexedDbIssue(monitor.report, '业务与交割数据', 'terminated')
    expect(monitor.getSnapshot()).toMatchObject({
      source: '业务与交割数据',
      kind: 'terminated',
    })
    expect(listener).toHaveBeenCalledOnce()

    monitor.clear()
    expect(monitor.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})
