import { useEffect, useMemo, useState } from 'react'

import {
  querySpotCheckExercises,
  questionForSpotCheckExercise,
  type SpotCheckBusinessType,
  type SpotCheckExerciseQuery,
} from '../../domain/service/spotCheckExercise'
import type { ServiceRepository } from '../../domain/service/repository'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import type {
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
  SpotCheckCompletionStatus,
  SpotCheckExerciseRecord,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface SpotCheckExerciseWorkspaceProps {
  institutionCode: string
  institutionName: string
  now?: Date
  onBack: () => void
  operator: ServiceOperatorSnapshot
  repository: ServiceRepository
}

function oneYearEarlier(date: Date): string {
  const currentDay = businessCalendarDay(date)
  const previous = new Date(`${currentDay}T12:00:00+08:00`)
  previous.setUTCFullYear(previous.getUTCFullYear() - 1)
  return businessCalendarDay(previous)
}

function displayDateTime(value: string): string {
  return value.slice(0, 19).replace('T', ' ')
}

function completionLabel(status: SpotCheckCompletionStatus): string {
  return status === 'completed' ? '已完成' : '未完成'
}

function Breadcrumb({ answering, onBack }: { answering: boolean; onBack: () => void }) {
  return <div className="customer-breadcrumb">
    <button onClick={onBack} type="button">主页</button>
    <span>/</span><span>查询</span><span>/</span>
    <strong>{answering ? '抽查演练答题' : '抽查演练信息查询'}</strong>
  </div>
}

export function SpotCheckExerciseWorkspace({
  institutionCode,
  institutionName,
  now,
  onBack,
  operator,
  repository,
}: SpotCheckExerciseWorkspaceProps) {
  const referenceNow = useMemo(() => now ?? new Date(), [now])
  const initialQuery = useMemo<SpotCheckExerciseQuery>(() => ({
    institutionCode,
    employeeId: '',
    completionStatus: 'all',
    businessType: 'all',
    inspectedDateFrom: oneYearEarlier(referenceNow),
    inspectedDateTo: businessCalendarDay(referenceNow),
  }), [institutionCode, referenceNow])
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState(initialQuery)
  const [rows, setRows] = useState<SpotCheckExerciseRecord[]>([])
  const [queried, setQueried] = useState(false)
  const [reminder, setReminder] = useState<SpotCheckExerciseRecord | null>(null)
  const [questionDetail, setQuestionDetail] = useState<SpotCheckExerciseRecord | null>(null)
  const [answering, setAnswering] = useState<SpotCheckExerciseRecord | null>(null)
  const [answerValue, setAnswerValue] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load()
      .then((loaded) => {
        if (active) setWorkspace(loaded)
      })
      .catch(() => {
        if (active) setError('抽查演练信息读取失败。')
      })
    return () => {
      active = false
    }
  }, [repository])

  const employeeOptions = useMemo(() => {
    if (!workspace) return []
    const employees = new Map<string, string>()
    workspace.spotCheckExercises
      .filter((record) => record.institutionCode === institutionCode)
      .forEach((record) => employees.set(record.employeeId, record.employeeName))
    return [...employees.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [institutionCode, workspace])

  function updateQuery<K extends keyof SpotCheckExerciseQuery>(
    key: K,
    value: SpotCheckExerciseQuery[K],
  ): void {
    setQuery((current) => ({ ...current, [key]: value }))
  }

  function refreshRows(nextWorkspace: ServiceWorkspaceState): SpotCheckExerciseRecord[] {
    const refreshed = querySpotCheckExercises(nextWorkspace, query)
    setRows(refreshed)
    return refreshed
  }

  function runQuery(): void {
    if (!workspace) return
    try {
      const result = refreshRows(workspace)
      setQueried(true)
      setReminder(result.find((record) => record.receiptStatus === 'unsigned') ?? null)
      setNotice('')
      setError('')
    } catch (caught) {
      setRows([])
      setQueried(false)
      setReminder(null)
      setError(caught instanceof Error ? caught.message : '抽查演练信息查询失败。')
    }
  }

  async function signExercise(record: SpotCheckExerciseRecord): Promise<void> {
    try {
      const result = await repository.executeSpotCheckExercise({
        type: 'sign-spot-check-exercise',
        exerciseId: record.id,
        signedAt: referenceNow.toISOString(),
        operator,
      })
      setWorkspace(result.state)
      refreshRows(result.state)
      setReminder(null)
      setNotice(`考题 ${record.questionNumber} 已签收。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '考题签收失败。')
    }
  }

  function startAnswer(record: SpotCheckExerciseRecord): void {
    setAnswerValue(record.answerValue ?? '')
    setAnswering(record)
    setNotice('')
    setError('')
  }

  async function submitAnswer(): Promise<void> {
    if (!answering) return
    if (!answerValue) {
      setError('请选择答案。')
      return
    }
    try {
      const result = await repository.executeSpotCheckExercise({
        type: 'complete-spot-check-exercise',
        exerciseId: answering.id,
        answerValue,
        completedAt: referenceNow.toISOString(),
        operator,
      })
      setWorkspace(result.state)
      refreshRows(result.state)
      setAnswering(null)
      setAnswerValue('')
      setNotice(`考题 ${answering.questionNumber} 已完成。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '考题提交失败。')
    }
  }

  if (!workspace) return <p className="channel-query-loading">正在读取抽查演练信息……</p>

  if (answering) {
    const question = questionForSpotCheckExercise(answering)
    return <section className="channel-query-workspace spot-check-answer-workspace">
      <Breadcrumb answering onBack={onBack} />
      <header className="spot-check-answer__heading">
        <strong>抽查演练答题</strong>
        <span>{answering.questionType} · 题目编号：{answering.questionNumber}</span>
      </header>
      <section aria-label="抽查演练考题" className="spot-check-answer__question">
        <h2>{question.prompt}</h2>
        <fieldset>
          <legend>请选择一项</legend>
          {question.options.map((option) => <label key={option.value}>
            <input
              checked={answerValue === option.value}
              name="spot-check-answer"
              onChange={() => setAnswerValue(option.value)}
              type="radio"
              value={option.value}
            />
            <span>{option.label}</span>
          </label>)}
        </fieldset>
        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
        <div className="spot-check-answer__actions">
          <button className="channel-query__primary" onClick={() => void submitAnswer()} type="button">提交答题</button>
          <button onClick={() => { setAnswering(null); setAnswerValue(''); setError('') }} type="button">返回查询</button>
        </div>
      </section>
    </section>
  }

  const detailQuestion = questionDetail ? questionForSpotCheckExercise(questionDetail) : null

  return <>
    <section className="channel-query-workspace relationship-query-workspace spot-check-query-workspace">
      <Breadcrumb answering={false} onBack={onBack} />
      <section aria-label="抽查演练信息查询条件" className="channel-query__filters relationship-query__filters spot-check-query__filters">
        <label><span>机构信息</span><input aria-label="抽查机构信息" readOnly value={`${institutionName}（${institutionCode}）`} /></label>
        <label><span>员工工号</span><select aria-label="抽查员工工号" onChange={(event) => updateQuery('employeeId', event.target.value)} value={query.employeeId}><option value="">请选择收寄员工</option>{employeeOptions.map(([id, name]) => <option key={id} value={id}>{id} · {name}</option>)}</select></label>
        <label><span>完成状态</span><select aria-label="抽查完成状态" onChange={(event) => updateQuery('completionStatus', event.target.value as SpotCheckExerciseQuery['completionStatus'])} value={query.completionStatus}><option value="all">全部</option><option value="incomplete">未完成</option><option value="completed">已完成</option></select></label>
        <label className="channel-query__date-range"><span>抽查日期</span><input aria-label="抽查日期起" onChange={(event) => updateQuery('inspectedDateFrom', event.target.value)} type="date" value={query.inspectedDateFrom} /><b>－</b><input aria-label="抽查日期止" onChange={(event) => updateQuery('inspectedDateTo', event.target.value)} type="date" value={query.inspectedDateTo} /></label>
        <label><span>业务类型</span><select aria-label="抽查业务类型" onChange={(event) => updateQuery('businessType', event.target.value as SpotCheckBusinessType)} value={query.businessType}><option value="all">全部</option><option value="remittance">汇兑</option><option value="counter">营业</option></select></label>
        <div className="channel-query__actions"><button className="channel-query__primary" onClick={runQuery} type="button">查询</button></div>
      </section>
      <p className="spot-check-query__notice">*注意：请在当前页面完成抽查演练</p>
      {notice ? <p className="spot-check-query__success" role="status">{notice}</p> : null}
      {error ? <p className="customer-form-error relationship-query__error" role="alert">{error}</p> : null}
      <section aria-label="抽查演练信息查询结果" className="channel-query__results relationship-query__results spot-check-query__results">
        <div className="channel-query__result-tools"><span>抽查演练信息</span><strong>共 {rows.length} 条</strong></div>
        <div className="channel-query__table-wrap"><table><thead><tr><th>序号</th><th>机构名称</th><th>员工工号</th><th>员工姓名</th><th>抽查类型</th><th>考题类型</th><th>题目编号</th><th>签收标志</th><th>完成标志</th><th>抽查日期</th><th>操作</th></tr></thead><tbody>
          {rows.map((record, index) => <tr key={record.id}><td>{index + 1}</td><td>{record.institutionName}</td><td>{record.employeeId}</td><td>{record.employeeName}</td><td>{record.inspectionType}</td><td>{record.questionType}</td><td>{record.questionNumber}</td><td>{record.receiptStatus === 'signed' ? '已签收' : '未签收'}</td><td>{completionLabel(record.completionStatus)}</td><td>{displayDateTime(record.inspectedAt)}</td><td className="spot-check-query__actions-cell"><button disabled={record.completionStatus === 'completed'} onClick={() => startAnswer(record)} type="button">开始答题</button><button onClick={() => setQuestionDetail(record)} type="button">查看考题</button><button disabled={record.receiptStatus === 'signed'} onClick={() => void signExercise(record)} type="button">签收考题</button></td></tr>)}
          {!queried ? <tr><td className="channel-query__empty" colSpan={11}>请输入条件后查询</td></tr> : rows.length === 0 ? <tr><td className="channel-query__empty" colSpan={11}>无数据</td></tr> : null}
        </tbody></table></div>
        <footer className="relationship-query__pager"><button disabled type="button">‹</button><b>1</b><button disabled type="button">›</button><span>跳转至</span><input aria-label="抽查演练跳转页码" disabled readOnly value="1" /><span>页 共 {rows.length} 条 10 条/页</span></footer>
      </section>
    </section>

    {reminder ? <Modal compact eyebrow="抽查演练信息查询" title="抽查演练提醒">
      <div className="modal-form spot-check-query__reminder">
        <p>您有未签收的抽查考题，请及时签收。</p>
        <div className="modal-actions"><button onClick={() => setReminder(null)} type="button">稍后处理</button><button className="primary-button primary-button--compact" onClick={() => void signExercise(reminder)} type="button">签收考题</button></div>
      </div>
    </Modal> : null}

    {questionDetail && detailQuestion ? <Modal description={`${questionDetail.questionType} · 题目编号：${questionDetail.questionNumber}`} eyebrow="抽查演练信息查询" title="查看考题" wide>
      <div className="modal-form spot-check-query__question-detail">
        <h3>{detailQuestion.prompt}</h3>
        <ol>{detailQuestion.options.map((option) => <li key={option.value}>{option.label}{questionDetail.answerValue === option.value ? <strong>已选</strong> : null}</li>)}</ol>
        <div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setQuestionDetail(null)} type="button">关闭</button></div>
      </div>
    </Modal> : null}
  </>
}
