import { describe, expect, it } from 'vitest'

import {
  businessCalendarDay,
  isValidBusinessCalendarDay,
} from './businessTime'

describe('business time', () => {
  it('projects timestamps into the same east-eight business day on every host', () => {
    expect(businessCalendarDay('2026-08-11T08:00:00.000+10:00')).toBe('2026-08-11')
    expect(businessCalendarDay('2026-08-10T16:30:00.000Z')).toBe('2026-08-11')
    expect(businessCalendarDay(new Date('2026-08-10T15:30:00.000Z'))).toBe('2026-08-10')
  })

  it('validates real calendar dates without using the host time zone', () => {
    expect(isValidBusinessCalendarDay('2028-02-29')).toBe(true)
    expect(isValidBusinessCalendarDay('2026-02-29')).toBe(false)
    expect(isValidBusinessCalendarDay('2026/08/11')).toBe(false)
  })

  it('rejects malformed persisted values without inventing a calendar day', () => {
    expect(businessCalendarDay('invalid-timestamp')).toBe('')
    expect(businessCalendarDay(new Date('invalid-timestamp'))).toBe('')
  })
})
