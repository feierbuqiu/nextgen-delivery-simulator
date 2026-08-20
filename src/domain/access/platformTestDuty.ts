import { projectEmployeeDuty } from './attendance'
import { appendAccessAudit } from './audit'
import type { SimulatorState } from './types'

export const PLATFORM_TEST_DUTY_DURATION_MS = 4 * 60 * 60 * 1000

export type PlatformTestDutyEndReason =
  | 'manual'
  | 'logout'
  | 'expired'
  | 'business-hours-resumed'
  | 'session-ended'

export interface PlatformTestDutyProjection {
  active: boolean
  available: boolean
  expiresAt: string | null
  ordinaryDutyLabel: string
}

export interface EnablePlatformTestDutyInput {
  currentSecret: string
  acknowledgedSyntheticDataOnly: boolean
  occurredAt: string
}

function sessionAuditTarget(state: SimulatorState): string {
  const session = state.session
  return session
    ? `SESSION:${session.operatorId}:${session.signedInAt}`
    : `SESSION:${state.operator.id}:NONE`
}

/** 已停用能力的兼容投影；历史会话字段永远不能再绕过人工签到。 */
export function projectPlatformTestDuty(
  state: SimulatorState,
  occurredAt = new Date().toISOString(),
): PlatformTestDutyProjection {
  const ordinaryDuty = projectEmployeeDuty(state, occurredAt, state.operator.id)
  const mode = state.session?.platformTestDuty ?? null
  return {
    active: false,
    available: false,
    expiresAt: mode?.expiresAt ?? null,
    ordinaryDutyLabel: ordinaryDuty.statusLabel,
  }
}

/** 平台测试值守已经退出运行路径，只保留函数签名用于旧代码安全失败。 */
export async function enablePlatformTestDuty(
  state: SimulatorState,
  input: EnablePlatformTestDutyInput,
): Promise<SimulatorState> {
  void state
  void input
  throw new Error('平台测试值守已停用；请由管理人员人工完成机构签到，再由员工本人签到。')
}

/** 结束测试值守并保留原因；注销会话前也应调用本命令。 */
export function endPlatformTestDuty(
  state: SimulatorState,
  reason: PlatformTestDutyEndReason,
  occurredAt = new Date().toISOString(),
): SimulatorState {
  if (!state.session?.platformTestDuty) return state
  const reasonLabel: Record<PlatformTestDutyEndReason, string> = {
    manual: '员工手动关闭',
    logout: '员工退出系统',
    expired: '四小时有效期届满',
    'business-hours-resumed': '机构恢复正常营业时段',
    'session-ended': '登录会话结束',
  }
  const targetId = sessionAuditTarget(state)
  const next: SimulatorState = {
    ...state,
    session: {
      ...state.session,
      platformTestDuty: null,
    },
  }
  return appendAccessAudit(
    next,
    'platform-test-duty-ended',
    occurredAt,
    state.operator.id,
    targetId,
    `结束平台测试值守；原因：${reasonLabel[reason]}。`,
  )
}
