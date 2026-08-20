import { describe, expect, it } from 'vitest'

import { createSeedState, DEMO_TEMPORARY_SECRET } from './seed'
import {
  enablePlatformTestDuty,
  endPlatformTestDuty,
  projectPlatformTestDuty,
} from './platformTestDuty'

const OFF_HOURS = '2026-08-12T11:30:00.000Z'

async function loggedInState() {
  const state = await createSeedState()
  return {
    ...state,
    session: {
      operatorId: state.operator.id,
      workstationCode: '01',
      signedInAt: '2026-08-12T11:20:00.000Z',
      platformTestDuty: null,
    },
  }
}

describe('platform test duty', () => {
  it('is retired and cannot be enabled through the legacy domain command', async () => {
    const state = await loggedInState()

    await expect(enablePlatformTestDuty(state, {
      currentSecret: DEMO_TEMPORARY_SECRET,
      acknowledgedSyntheticDataOnly: true,
      occurredAt: OFF_HOURS,
    })).rejects.toThrow('平台测试值守已停用')
    expect(projectPlatformTestDuty(state, OFF_HOURS)).toMatchObject({
      active: false,
      available: false,
    })
  })

  it('clears a legacy stored session without ever making it active', async () => {
    const state = await loggedInState()
    const legacy = {
      ...state,
      session: {
        ...state.session!,
        platformTestDuty: {
      enabledAt: OFF_HOURS,
          expiresAt: '2026-08-12T15:30:00.000Z',
      enabledBy: state.operator.id,
        },
      },
    }
    expect(projectPlatformTestDuty(legacy, OFF_HOURS).active).toBe(false)

    const ended = endPlatformTestDuty(legacy, 'session-ended', '2026-08-12T11:45:00.000Z')
    expect(ended.session?.platformTestDuty).toBeNull()
    expect(ended.accessAuditEvents.at(-1)).toMatchObject({
      action: 'platform-test-duty-ended',
      detail: expect.stringContaining('登录会话结束'),
    })
  })
})
