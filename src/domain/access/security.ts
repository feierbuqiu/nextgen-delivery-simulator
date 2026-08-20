import { hashSecret, validateSecret } from './policy'
import {
  DEMO_MANAGEMENT_OPERATOR_ID,
  DEMO_MANAGEMENT_SECRET,
} from './seed'
import type {
  AccessSecurityEvent,
  AccessSecurityState,
  AccessUnlockMethod,
  SimulatorState,
} from './types'

export const ACCESS_MAX_SECRET_ATTEMPTS = 10
export const ACCESS_WARNING_FROM_ATTEMPT = 6
export const DEMO_RECOVERY_GRAPHICAL_CODE = '4826'
export const DEMO_RECOVERY_SMS_CODE = '135790'
export const DEMO_ACCESS_SUPERVISOR_ID = DEMO_MANAGEMENT_OPERATOR_ID
export const DEMO_ACCESS_SUPERVISOR_SECRET = DEMO_MANAGEMENT_SECRET

export interface SecretFailureResult {
  state: SimulatorState
  failedAttempts: number
  remainingAttempts: number
  locked: boolean
}

export interface RecoveryChallenge {
  mobile: string
  graphicalCode: string
  smsCode: string
  smsCodeIssued: boolean
}

export interface RecoverAccessSecretRequest extends RecoveryChallenge {
  newSecret: string
  recoveredAt: string
}

function eventId(sequence: number): string {
  return `AUTH-${String(sequence).padStart(6, '0')}`
}

function appendEvent(
  security: AccessSecurityState,
  event: Omit<AccessSecurityEvent, 'id'>,
): AccessSecurityState {
  return {
    ...security,
    nextEventSequence: security.nextEventSequence + 1,
    events: [
      ...security.events,
      { ...event, id: eventId(security.nextEventSequence) },
    ],
  }
}

export function registerSecretFailure(
  state: SimulatorState,
  occurredAt: string,
): SecretFailureResult {
  if (state.security.lockedAt) {
    return {
      state,
      failedAttempts: state.security.failedSecretAttempts,
      remainingAttempts: 0,
      locked: true,
    }
  }

  const failedAttempts = Math.min(
    ACCESS_MAX_SECRET_ATTEMPTS,
    state.security.failedSecretAttempts + 1,
  )
  const locked = failedAttempts >= ACCESS_MAX_SECRET_ATTEMPTS
  let security = appendEvent(state.security, {
    type: 'credential-failed',
    occurredAt,
    actorId: state.operator.id,
    method: null,
    failedAttempts,
  })
  security = {
    ...security,
    failedSecretAttempts: failedAttempts,
    lockedAt: locked ? occurredAt : null,
  }
  if (locked) {
    security = appendEvent(security, {
      type: 'account-locked',
      occurredAt,
      actorId: state.operator.id,
      method: null,
      failedAttempts,
    })
  }

  return {
    state: { ...state, security, session: null },
    failedAttempts,
    remainingAttempts: ACCESS_MAX_SECRET_ATTEMPTS - failedAttempts,
    locked,
  }
}

export function clearSecretFailures(state: SimulatorState): SimulatorState {
  if (state.security.failedSecretAttempts === 0 && !state.security.lockedAt) return state
  return {
    ...state,
    security: {
      ...state.security,
      failedSecretAttempts: 0,
      lockedAt: null,
    },
  }
}

export function validateRecoveryChallenge(
  state: SimulatorState,
  challenge: RecoveryChallenge,
): void {
  if (challenge.mobile.trim() !== state.operator.boundMobile) {
    throw new Error('输入的手机号未绑定当前登录人员。')
  }
  if (challenge.graphicalCode.trim().toUpperCase() !== DEMO_RECOVERY_GRAPHICAL_CODE) {
    throw new Error('图形验证码不正确。')
  }
  if (!challenge.smsCodeIssued) {
    throw new Error('请先获取短信验证码。')
  }
  if (challenge.smsCode.trim() !== DEMO_RECOVERY_SMS_CODE) {
    throw new Error('短信验证码不正确。')
  }
}

export async function recoverAccessSecret(
  state: SimulatorState,
  request: RecoverAccessSecretRequest,
): Promise<SimulatorState> {
  validateRecoveryChallenge(state, request)
  const policy = validateSecret(request.newSecret)
  if (!policy.valid) {
    throw new Error(`新密码校验未通过：${policy.violations.join('；')}。`)
  }
  const nextSecretHash = await hashSecret(request.newSecret)
  const history = Array.from(new Set([
    ...(state.operator.secretHistoryHashes ?? []),
    state.operator.secretHash,
  ]))
  if (history.includes(nextSecretHash)) {
    throw new Error('新密码不能与任何旧密码重复。')
  }

  const remainsLocked = Boolean(state.security.lockedAt)
  const security = appendEvent({
    ...state.security,
    failedSecretAttempts: remainsLocked ? state.security.failedSecretAttempts : 0,
    lockedAt: state.security.lockedAt,
  }, {
    type: 'secret-recovered',
    occurredAt: request.recoveredAt,
    actorId: state.operator.id,
    method: 'bound-mobile',
    failedAttempts: null,
  })
  return {
    ...state,
    operator: {
      ...state.operator,
      secretHash: nextSecretHash,
      secretHistoryHashes: [...history, nextSecretHash],
      requiresSecretChange: false,
    },
    security,
    session: null,
  }
}

function unlockAccess(
  state: SimulatorState,
  method: AccessUnlockMethod,
  actorId: string,
  occurredAt: string,
): SimulatorState {
  if (!state.security.lockedAt) {
    throw new Error('当前账户未锁定，无需解锁。')
  }
  const security = appendEvent({
    ...state.security,
    failedSecretAttempts: 0,
    lockedAt: null,
  }, {
    type: 'account-unlocked',
    occurredAt,
    actorId,
    method,
    failedAttempts: null,
  })
  return { ...state, security, session: null }
}

export function unlockWithSupervisorCredentials(
  state: SimulatorState,
  supervisorId: string,
  supervisorSecret: string,
  occurredAt: string,
): SimulatorState {
  if (supervisorId.trim() !== DEMO_ACCESS_SUPERVISOR_ID ||
      supervisorSecret !== DEMO_ACCESS_SUPERVISOR_SECRET) {
    throw new Error('主管授权失败，请核对主管工号和密码。')
  }
  return unlockAccess(
    state,
    'supervisor-credentials',
    DEMO_ACCESS_SUPERVISOR_ID,
    occurredAt,
  )
}
