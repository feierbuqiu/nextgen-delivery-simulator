import type {
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
  SpotCheckCompletionStatus,
  SpotCheckExerciseRecord,
} from './types'
import { businessCalendarDay } from '../shared/businessTime'

export type SpotCheckBusinessType = 'all' | 'remittance' | 'counter'

export interface SpotCheckExerciseQuery {
  institutionCode: string
  employeeId: string
  completionStatus: 'all' | SpotCheckCompletionStatus
  businessType: SpotCheckBusinessType
  inspectedDateFrom: string
  inspectedDateTo: string
}

export interface SpotCheckQuestion {
  questionType: string
  questionNumber: string
  prompt: string
  options: readonly { value: string; label: string }[]
}

export const SPOT_CHECK_QUESTION_BANK: readonly SpotCheckQuestion[] = [
  {
    questionType: '汇兑-兑付',
    questionNumber: '2',
    prompt: '办理模拟兑付前，应首先核对哪项信息？',
    options: [
      { value: 'business-record', label: '当前业务记录' },
      { value: 'browser-color', label: '浏览器颜色' },
      { value: 'window-background', label: '窗口背景' },
    ],
  },
  {
    questionType: '汇兑-汇款',
    questionNumber: '1',
    prompt: '模拟业务保存后，哪项信息最适合用于复核办理结果？',
    options: [
      { value: 'business-serial', label: '业务流水' },
      { value: 'screen-width', label: '屏幕宽度' },
      { value: 'menu-color', label: '菜单颜色' },
    ],
  },
  {
    questionType: '营业-函件',
    questionNumber: '1002',
    prompt: '函件收寄中，三位基础产品代码与区域组合后形成的有效业务代码为几位？',
    options: [
      { value: '3', label: '3 位' },
      { value: '6', label: '6 位' },
      { value: '8', label: '8 位' },
    ],
  },
] as const

const SEED_OPERATOR: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '演示营业员',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '虚构寄达局',
}

export function createSpotCheckExerciseSeedRecords(): SpotCheckExerciseRecord[] {
  return [
    {
      id: 'CCYL-20260812-000001',
      institutionCode: '99901001',
      institutionName: '景麓营业部',
      employeeId: '80000001',
      employeeName: '演示营业员',
      inspectionType: '抽查演练',
      questionType: '营业-函件',
      questionNumber: '1002',
      receiptStatus: 'unsigned',
      completionStatus: 'incomplete',
      inspectedAt: '2026-08-12T10:00:00+10:00',
      signedAt: null,
      signedBy: null,
      completedAt: null,
      completedBy: null,
      answerValue: null,
    },
    {
      id: 'CCYL-20260811-000002',
      institutionCode: '99901001',
      institutionName: '景麓营业部',
      employeeId: '80000002',
      employeeName: '周清禾',
      inspectionType: '抽查演练',
      questionType: '汇兑-兑付',
      questionNumber: '2',
      receiptStatus: 'signed',
      completionStatus: 'completed',
      inspectedAt: '2026-08-11T15:00:00+10:00',
      signedAt: '2026-08-11T15:03:00+10:00',
      signedBy: SEED_OPERATOR,
      completedAt: '2026-08-11T15:08:00+10:00',
      completedBy: SEED_OPERATOR,
      answerValue: 'business-record',
    },
    {
      id: 'CCYL-20260810-000003',
      institutionCode: '99901001',
      institutionName: '景麓营业部',
      employeeId: '80000003',
      employeeName: '林远川',
      inspectionType: '抽查演练',
      questionType: '汇兑-汇款',
      questionNumber: '1',
      receiptStatus: 'unsigned',
      completionStatus: 'completed',
      inspectedAt: '2026-08-10T10:00:00+10:00',
      signedAt: null,
      signedBy: null,
      completedAt: '2026-08-10T10:05:00+10:00',
      completedBy: SEED_OPERATOR,
      answerValue: 'business-serial',
    },
  ]
}

function parseDay(value: string, field: string): string {
  const day = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`${field}必须使用 YYYY-MM-DD 格式。`)
  const [year, month, date] = day.split('-').map(Number)
  const parsed = new Date(Date.UTC(year!, month! - 1, date!))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== date
  ) throw new Error(`${field}不是有效日期。`)
  return day
}

function businessTypeMatches(
  record: SpotCheckExerciseRecord,
  businessType: SpotCheckBusinessType,
): boolean {
  if (businessType === 'all') return true
  if (businessType === 'remittance') return record.questionType.startsWith('汇兑-')
  return record.questionType.startsWith('营业-')
}

export function querySpotCheckExercises(
  state: ServiceWorkspaceState,
  query: SpotCheckExerciseQuery,
): SpotCheckExerciseRecord[] {
  const dateFrom = parseDay(query.inspectedDateFrom, '抽查开始日期')
  const dateTo = parseDay(query.inspectedDateTo, '抽查结束日期')
  if (dateFrom > dateTo) throw new Error('抽查开始日期不能晚于结束日期。')
  const institutionCode = query.institutionCode.trim()
  if (!institutionCode) throw new Error('缺少当前机构信息。')
  return state.spotCheckExercises
    .filter((record) => record.institutionCode === institutionCode)
    .filter((record) => !query.employeeId || record.employeeId === query.employeeId)
    .filter((record) => query.completionStatus === 'all' || record.completionStatus === query.completionStatus)
    .filter((record) => businessTypeMatches(record, query.businessType))
    .filter((record) => businessCalendarDay(record.inspectedAt) >= dateFrom && businessCalendarDay(record.inspectedAt) <= dateTo)
    .map((record) => structuredClone(record))
    .sort((left, right) => right.inspectedAt.localeCompare(left.inspectedAt))
}

export function questionForSpotCheckExercise(
  record: SpotCheckExerciseRecord,
): SpotCheckQuestion {
  const question = SPOT_CHECK_QUESTION_BANK.find((candidate) => (
    candidate.questionType === record.questionType &&
    candidate.questionNumber === record.questionNumber
  ))
  if (!question) throw new Error('未维护该抽查考题。')
  return structuredClone(question)
}

export interface SpotCheckEligibilityInput {
  previousDayBusinessCount: number
  normalBusinessDay: boolean
  institutionSignedOut: boolean
  role: 'counter' | 'business-manager' | 'branch-manager'
  hour: number
}

export function isSpotCheckPushEligible(input: SpotCheckEligibilityInput): boolean {
  return Number.isInteger(input.previousDayBusinessCount) &&
    input.previousDayBusinessCount >= 0 &&
    input.previousDayBusinessCount < 5 &&
    input.normalBusinessDay &&
    !input.institutionSignedOut &&
    input.role !== 'branch-manager' &&
    (input.hour === 10 || input.hour === 15)
}

export type SpotCheckExerciseCommand =
  | {
    type: 'sign-spot-check-exercise'
    exerciseId: string
    signedAt: string
    operator: ServiceOperatorSnapshot
  }
  | {
    type: 'complete-spot-check-exercise'
    exerciseId: string
    answerValue: string
    completedAt: string
    operator: ServiceOperatorSnapshot
  }

export interface SpotCheckExerciseResult {
  state: ServiceWorkspaceState
  exercise: SpotCheckExerciseRecord
}

export function executeSpotCheckExerciseCommand(
  state: ServiceWorkspaceState,
  command: SpotCheckExerciseCommand,
): SpotCheckExerciseResult {
  const index = state.spotCheckExercises.findIndex((record) => record.id === command.exerciseId)
  if (index < 0) throw new Error('未找到抽查演练记录。')
  const current = state.spotCheckExercises[index]!
  let exercise: SpotCheckExerciseRecord

  if (command.type === 'sign-spot-check-exercise') {
    if (current.receiptStatus === 'signed') throw new Error('考题已经签收。')
    exercise = {
      ...current,
      receiptStatus: 'signed',
      signedAt: command.signedAt,
      signedBy: structuredClone(command.operator),
    }
  } else {
    if (current.completionStatus === 'completed') throw new Error('考题已经完成。')
    const question = questionForSpotCheckExercise(current)
    if (!question.options.some((option) => option.value === command.answerValue)) {
      throw new Error('请选择有效答案。')
    }
    exercise = {
      ...current,
      completionStatus: 'completed',
      completedAt: command.completedAt,
      completedBy: structuredClone(command.operator),
      answerValue: command.answerValue,
    }
  }

  const records = structuredClone(state.spotCheckExercises)
  records[index] = exercise
  return {
    state: { ...state, spotCheckExercises: records },
    exercise: structuredClone(exercise),
  }
}
