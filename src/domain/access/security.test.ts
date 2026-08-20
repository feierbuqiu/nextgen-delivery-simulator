import { describe, expect, it } from 'vitest'

import { secretMatches } from './policy'
import { createSeedState, DEMO_BOUND_MOBILE } from './seed'
import {
  ACCESS_MAX_SECRET_ATTEMPTS,
  ACCESS_WARNING_FROM_ATTEMPT,
  clearSecretFailures,
  DEMO_ACCESS_SUPERVISOR_ID,
  DEMO_ACCESS_SUPERVISOR_SECRET,
  DEMO_RECOVERY_GRAPHICAL_CODE,
  DEMO_RECOVERY_SMS_CODE,
  recoverAccessSecret,
  registerSecretFailure,
  unlockWithSupervisorCredentials,
} from './security'

describe('access security', () => {
  it('starts the remaining-attempt warning on failure six and locks on failure ten', async () => {
    let state = await createSeedState()
    let latest = registerSecretFailure(state, '2026-08-10T06:00:01.000Z')
    state = latest.state
    for (let attempt = 2; attempt <= ACCESS_MAX_SECRET_ATTEMPTS; attempt += 1) {
      latest = registerSecretFailure(state, `2026-08-10T06:00:${String(attempt).padStart(2, '0')}.000Z`)
      state = latest.state
      if (attempt === ACCESS_WARNING_FROM_ATTEMPT) {
        expect(latest.remainingAttempts).toBe(4)
        expect(latest.locked).toBe(false)
      }
    }

    expect(latest).toMatchObject({
      failedAttempts: 10,
      remainingAttempts: 0,
      locked: true,
    })
    expect(state.security.lockedAt).toBe('2026-08-10T06:00:10.000Z')
    expect(state.security.events.filter((event) => event.type === 'credential-failed')).toHaveLength(10)
    expect(state.security.events.at(-1)).toMatchObject({
      id: 'AUTH-000011',
      type: 'account-locked',
      failedAttempts: 10,
    })
  })

  it('clears a recoverable failure count after successful credentials', async () => {
    const seed = await createSeedState()
    const failed = registerSecretFailure(seed, '2026-08-10T06:01:00.000Z').state
    const cleared = clearSecretFailures(failed)

    expect(cleared.security.failedSecretAttempts).toBe(0)
    expect(cleared.security.lockedAt).toBeNull()
    expect(cleared.security.events).toHaveLength(1)
  })

  it('requires valid supervisor credentials and records the manual unlock', async () => {
    let locked = await createSeedState()
    for (let attempt = 1; attempt <= ACCESS_MAX_SECRET_ATTEMPTS; attempt += 1) {
      locked = registerSecretFailure(locked, `2026-08-10T06:02:${String(attempt).padStart(2, '0')}.000Z`).state
    }

    expect(() => unlockWithSupervisorCredentials(
      locked,
      DEMO_ACCESS_SUPERVISOR_ID,
      'Wrong!Supervisor26',
      '2026-08-10T06:03:00.000Z',
    )).toThrow('主管授权失败')

    const directlyUnlocked = unlockWithSupervisorCredentials(
      locked,
      DEMO_ACCESS_SUPERVISOR_ID,
      DEMO_ACCESS_SUPERVISOR_SECRET,
      '2026-08-10T06:03:00.000Z',
    )
    expect(directlyUnlocked.security).toMatchObject({
      failedSecretAttempts: 0,
      lockedAt: null,
    })
    expect(directlyUnlocked.security.events.at(-1)).toMatchObject({
      type: 'account-unlocked',
      actorId: DEMO_ACCESS_SUPERVISOR_ID,
      method: 'supervisor-credentials',
    })
  })

  it('recovers a non-reused compliant secret while preserving a pre-existing lock', async () => {
    let locked = await createSeedState()
    for (let attempt = 1; attempt <= ACCESS_MAX_SECRET_ATTEMPTS; attempt += 1) {
      locked = registerSecretFailure(locked, `2026-08-10T06:06:${String(attempt).padStart(2, '0')}.000Z`).state
    }
    const challenge = {
      mobile: DEMO_BOUND_MOBILE,
      graphicalCode: DEMO_RECOVERY_GRAPHICAL_CODE,
      smsCode: DEMO_RECOVERY_SMS_CODE,
      smsCodeIssued: true,
    }

    await expect(recoverAccessSecret(locked, {
      ...challenge,
      newSecret: 'short',
      recoveredAt: '2026-08-10T06:07:00.000Z',
    })).rejects.toThrow('新密码校验未通过')
    await expect(recoverAccessSecret(locked, {
      ...challenge,
      newSecret: '6yhn&UJM8ik,',
      recoveredAt: '2026-08-10T06:07:00.000Z',
    })).rejects.toThrow('新密码不能与任何旧密码重复')

    const recovered = await recoverAccessSecret(locked, {
      ...challenge,
      newSecret: 'Recovered!2608',
      recoveredAt: '2026-08-10T06:07:00.000Z',
    })
    await expect(secretMatches('Recovered!2608', recovered.operator.secretHash)).resolves.toBe(true)
    expect(recovered.operator.requiresSecretChange).toBe(false)
    expect(recovered.security.failedSecretAttempts).toBe(10)
    expect(recovered.security.lockedAt).toBe(locked.security.lockedAt)
    expect(recovered.security.events.at(-1)).toMatchObject({
      type: 'secret-recovered',
      method: 'bound-mobile',
    })
  })
})
