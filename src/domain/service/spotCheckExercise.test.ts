import { describe, expect, it } from 'vitest'

import { createServiceSeedState } from './seed'
import {
  executeSpotCheckExerciseCommand,
  isSpotCheckPushEligible,
  querySpotCheckExercises,
  questionForSpotCheckExercise,
} from './spotCheckExercise'
import type { ServiceOperatorSnapshot } from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '虚构寄达局',
}

const baseQuery = {
  institutionCode: '99901001',
  employeeId: '',
  completionStatus: 'all' as const,
  businessType: 'all' as const,
  inspectedDateFrom: '2025-08-12',
  inspectedDateTo: '2026-08-12',
}

describe('spot-check exercise', () => {
  it('queries the current institution and applies employee, completion and business filters', () => {
    const state = createServiceSeedState()

    expect(querySpotCheckExercises(state, baseQuery)).toHaveLength(3)
    expect(querySpotCheckExercises(state, {
      ...baseQuery,
      employeeId: '80000001',
    })).toMatchObject([{ questionType: '营业-函件', completionStatus: 'incomplete' }])
    expect(querySpotCheckExercises(state, {
      ...baseQuery,
      completionStatus: 'completed',
      businessType: 'remittance',
    })).toHaveLength(2)
    expect(() => querySpotCheckExercises(state, {
      ...baseQuery,
      inspectedDateFrom: '2026-08-13',
    })).toThrow('抽查开始日期不能晚于结束日期')
  })

  it('applies all four documented push conditions', () => {
    const eligible = {
      previousDayBusinessCount: 4,
      normalBusinessDay: true,
      institutionSignedOut: false,
      role: 'counter' as const,
      hour: 10,
    }

    expect(isSpotCheckPushEligible(eligible)).toBe(true)
    expect(isSpotCheckPushEligible({ ...eligible, previousDayBusinessCount: 5 })).toBe(false)
    expect(isSpotCheckPushEligible({ ...eligible, normalBusinessDay: false })).toBe(false)
    expect(isSpotCheckPushEligible({ ...eligible, institutionSignedOut: true })).toBe(false)
    expect(isSpotCheckPushEligible({ ...eligible, role: 'branch-manager' })).toBe(false)
    expect(isSpotCheckPushEligible({ ...eligible, hour: 11 })).toBe(false)
    expect(isSpotCheckPushEligible({ ...eligible, hour: 15 })).toBe(true)
  })

  it('signs and completes an exercise as independent persisted facts', () => {
    const state = createServiceSeedState()
    const exercise = state.spotCheckExercises[0]!
    const signed = executeSpotCheckExerciseCommand(state, {
      type: 'sign-spot-check-exercise',
      exerciseId: exercise.id,
      signedAt: '2026-08-12T10:02:00+10:00',
      operator,
    })

    expect(signed.exercise).toMatchObject({
      receiptStatus: 'signed',
      completionStatus: 'incomplete',
      signedBy: { operatorId: '80000001' },
    })
    const question = questionForSpotCheckExercise(signed.exercise)
    const completed = executeSpotCheckExerciseCommand(signed.state, {
      type: 'complete-spot-check-exercise',
      exerciseId: exercise.id,
      answerValue: question.options[1]!.value,
      completedAt: '2026-08-12T10:05:00+10:00',
      operator,
    })
    expect(completed.exercise).toMatchObject({
      receiptStatus: 'signed',
      completionStatus: 'completed',
      answerValue: '6',
      completedBy: { operatorId: '80000001' },
    })
    expect(() => executeSpotCheckExerciseCommand(completed.state, {
      type: 'complete-spot-check-exercise',
      exerciseId: exercise.id,
      answerValue: '6',
      completedAt: '2026-08-12T10:06:00+10:00',
      operator,
    })).toThrow('考题已经完成')
  })
})
