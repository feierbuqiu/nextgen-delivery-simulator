import type {
  AccessAuditAction,
  SimulatorState,
} from './types'

/**
 * 追加一条不可变的访问审计事件。
 *
 * 考勤、人员管理与测试值守统一复用此序列生成器，避免各模块各自维护编号。
 */
export function appendAccessAudit(
  state: SimulatorState,
  action: AccessAuditAction,
  occurredAt: string,
  actorId: string,
  targetId: string,
  detail: string,
): SimulatorState {
  const sequence = state.nextAccessAuditSequence
  return {
    ...state,
    nextAccessAuditSequence: sequence + 1,
    accessAuditEvents: [
      ...state.accessAuditEvents,
      {
        id: `ACCESS-AUDIT-${String(sequence).padStart(6, '0')}`,
        action,
        occurredAt,
        actorId,
        targetId,
        detail,
      },
    ],
  }
}
