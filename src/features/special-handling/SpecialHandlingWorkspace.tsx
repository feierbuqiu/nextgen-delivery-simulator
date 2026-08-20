import { useEffect, useMemo, useState } from 'react'

import { businessCalendarDay } from '../../domain/shared/businessTime'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import {
  querySpecialHandlingApplications,
  quoteSpecialHandlingApplication,
  specialHandlingKindLabel,
  specialHandlingTenderLabel,
  type SpecialHandlingApplicationDraft,
  type SpecialHandlingQuery,
  type SpecialHandlingQuote,
} from '../../domain/service/specialHandling'
import type {
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
  SpecialHandlingApplication,
  SpecialHandlingKind,
  SpecialHandlingTender,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

export type SpecialHandlingSection = 'application' | 'status'

interface SpecialHandlingWorkspaceProps {
  section: SpecialHandlingSection
  operator: ServiceOperatorSnapshot
  repository: ServiceRepository
  onBack: () => void
}

function createEmptyDraft(kind: SpecialHandlingKind): SpecialHandlingApplicationDraft {
  return {
    kind,
    mailItemCode: '',
    applicantName: '',
    applicantPhone: '',
    applicantIdentityType: '',
    applicantIdentityNumber: '',
    redirectedAddress: '',
    redirectedPostalCode: '',
    redirectedDestinationOffice: '',
    reason: '',
  }
}

function localDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localTimestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')
  const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, '0')
  return `${localDateValue(date)}T${hours}:${minutes}:${seconds}.${milliseconds}${sign}${offsetHours}:${offsetRemainder}`
}

function createEmptyQuery(): SpecialHandlingQuery {
  const today = businessCalendarDay(new Date())
  return {
    mailItemCode: '',
    operatorId: '',
    kind: '',
    operatedDateFrom: today,
    operatedDateTo: today,
  }
}

function displayDateTime(value: string | null): string {
  if (!value) return '—'
  return value.slice(0, 19).replace('T', ' ')
}

function uploadStatusLabel(application: SpecialHandlingApplication): string {
  if (!application.settledAt) return '未结算'
  if (application.uploadStatus === 'succeeded') return '上传成功'
  if (application.uploadStatus === 'failed') return '上传失败'
  return '未上传'
}

function nextTimestamp(value: string, offsetMilliseconds = 1_000): string {
  const parsed = Date.parse(value)
  return localTimestamp(new Date(
    (Number.isNaN(parsed) ? Date.now() : parsed) + offsetMilliseconds,
  ))
}

export function SpecialHandlingWorkspace({
  section,
  operator,
  repository,
  onBack,
}: SpecialHandlingWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [draft, setDraft] = useState<SpecialHandlingApplicationDraft>(() => (
    createEmptyDraft('withdrawal')
  ))
  const [quote, setQuote] = useState<SpecialHandlingQuote | null>(null)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [settlementApplication, setSettlementApplication] = useState<SpecialHandlingApplication | null>(null)
  const [query, setQuery] = useState<SpecialHandlingQuery>(() => createEmptyQuery())
  const [submittedQuery, setSubmittedQuery] = useState<SpecialHandlingQuery | null>(null)
  const [detailApplication, setDetailApplication] = useState<SpecialHandlingApplication | null>(null)
  const [deleteApplication, setDeleteApplication] = useState<SpecialHandlingApplication | null>(null)
  const [cancelApplication, setCancelApplication] = useState<SpecialHandlingApplication | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (active) setWorkspace(loaded)
    })
    return () => {
      active = false
    }
  }, [repository])

  const queryRows = useMemo(() => (
    workspace && submittedQuery
      ? querySpecialHandlingApplications(workspace, submittedQuery)
      : []
  ), [submittedQuery, workspace])

  const operatorOptions = useMemo(() => {
    const options = new Map<string, string>([[operator.operatorId, operator.displayName]])
    for (const application of workspace?.specialHandlingApplications ?? []) {
      options.set(application.createdBy.operatorId, application.createdBy.displayName)
    }
    return [...options.entries()]
  }, [operator.displayName, operator.operatorId, workspace])

  function updateDraft<Key extends keyof SpecialHandlingApplicationDraft>(
    key: Key,
    value: SpecialHandlingApplicationDraft[Key],
  ): void {
    setDraft((current) => ({ ...current, [key]: value }))
    setQuote(null)
    setError('')
    setNotice('')
  }

  function selectKind(kind: SpecialHandlingKind): void {
    setDraft(createEmptyDraft(kind))
    setQuote(null)
    setConfirmationOpen(false)
    setError('')
    setNotice('')
  }

  function calculateFee(): void {
    if (!workspace) return
    setError('')
    setNotice('')
    try {
      const calculated = quoteSpecialHandlingApplication(
        workspace,
        draft,
        localTimestamp(new Date()),
      )
      setQuote(calculated)
      setNotice(`计费成功，手续费 ¥ ${formatCents(calculated.feeCents)}。`)
    } catch (caught) {
      setQuote(null)
      setError(caught instanceof Error ? caught.message : '计费失败。')
    }
  }

  async function createApplication(): Promise<void> {
    if (!quote || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const createdAt = nextTimestamp(quote.quotedAt)
      const result = await repository.executeSpecialHandling({
        type: 'create-special-handling-application',
        draft,
        quotedAt: quote.quotedAt,
        createdAt,
        operator,
      })
      setWorkspace(result.state)
      setConfirmationOpen(false)
      setSettlementApplication(result.application)
      setDraft(createEmptyDraft(draft.kind))
      setQuote(null)
      setNotice('申请已提交，请完成手续费结算。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '申请提交失败。')
    } finally {
      setSubmitting(false)
    }
  }

  async function settleApplication(tender: SpecialHandlingTender): Promise<void> {
    if (!settlementApplication || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await repository.executeSpecialHandling({
        type: 'settle-special-handling-application',
        applicationId: settlementApplication.id,
        tender,
        settledAt: nextTimestamp(settlementApplication.createdAt),
        uploadOutcome: 'succeeded',
      })
      setWorkspace(result.state)
      setSettlementApplication(null)
      setNotice(`${result.application?.id ?? ''} 已结算并上传成功。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '手续费结算失败。')
    } finally {
      setSubmitting(false)
    }
  }

  async function retryUpload(application: SpecialHandlingApplication): Promise<void> {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await repository.executeSpecialHandling({
        type: 'retry-special-handling-upload',
        applicationId: application.id,
        uploadedAt: nextTimestamp(application.settledAt ?? application.createdAt),
        uploadOutcome: 'succeeded',
      })
      setWorkspace(result.state)
      setNotice(`${application.id} 已重新上传成功。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '重新上传失败。')
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteApplication || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await repository.executeSpecialHandling({
        type: 'delete-special-handling-application',
        applicationId: deleteApplication.id,
      })
      setWorkspace(result.state)
      setDeleteApplication(null)
      setNotice(`${result.deletedApplicationId ?? ''} 已删除。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败。')
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmCancellation(): Promise<void> {
    if (!cancelApplication || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await repository.executeSpecialHandling({
        type: 'cancel-special-handling-withdrawal',
        applicationId: cancelApplication.id,
        deliveryStageDecision: 'entered-delivery',
        cancelledAt: nextTimestamp(cancelApplication.uploadedAt ?? cancelApplication.createdAt),
        operator,
      })
      setWorkspace(result.state)
      setCancelApplication(null)
      setNotice(`${result.application?.id ?? ''} 已取消，手续费退款已进入退款待办。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '取消撤单失败。')
    } finally {
      setSubmitting(false)
    }
  }

  function runQuery(): void {
    setSubmittedQuery(structuredClone(query))
    setError('')
    setNotice('')
  }

  if (!workspace) {
    return <section className="special-handling-loading">正在读取邮件撤改记录…</section>
  }

  return (
    <>
      <section className="special-handling-workspace">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业渠道</button>
          <span>/</span><span>特殊处理</span><span>/</span>
          <strong>{section === 'application' ? '邮件撤改处理' : '邮件改址撤回状态查询'}</strong>
        </div>

        {section === 'application' ? (
          <>
            <nav aria-label="邮件撤改处理页签" className="special-handling-tabs">
              <button
                aria-selected={draft.kind === 'withdrawal'}
                className={draft.kind === 'withdrawal' ? 'is-active' : ''}
                onClick={() => selectKind('withdrawal')}
                role="tab"
                type="button"
              >
                邮件撤单处理
              </button>
              <button
                aria-selected={draft.kind === 'redirect'}
                className={draft.kind === 'redirect' ? 'is-active' : ''}
                onClick={() => selectKind('redirect')}
                role="tab"
                type="button"
              >
                邮件改址处理
              </button>
            </nav>

            <form className="special-handling-form" onSubmit={(event) => event.preventDefault()}>
              <fieldset>
                <legend className="sr-only">{draft.kind === 'withdrawal' ? '邮件撤单申请' : '邮件改址申请'}</legend>
                <div className="special-handling-form-grid">
                  <label>
                    <span><b>*</b> 邮件号码：</span>
                    <input
                      aria-label="邮件号码"
                      autoComplete="off"
                      onChange={(event) => updateDraft('mailItemCode', event.target.value.toUpperCase())}
                      value={draft.mailItemCode}
                    />
                  </label>
                  <label>
                    <span><b>*</b> 申请人姓名：</span>
                    <input aria-label="申请人姓名" onChange={(event) => updateDraft('applicantName', event.target.value)} value={draft.applicantName} />
                  </label>
                  <label>
                    <span><b>*</b> 申请人电话：</span>
                    <input aria-label="申请人电话" inputMode="tel" onChange={(event) => updateDraft('applicantPhone', event.target.value)} value={draft.applicantPhone} />
                  </label>
                  <label>
                    <span><b>*</b> 申请人证件名称：</span>
                    <select aria-label="申请人证件名称" onChange={(event) => updateDraft('applicantIdentityType', event.target.value as SpecialHandlingApplicationDraft['applicantIdentityType'])} value={draft.applicantIdentityType}>
                      <option value="">请选择</option>
                      <option value="primary">居民身份证</option>
                      <option value="temporary">临时身份证</option>
                      <option value="residence">居住证</option>
                      <option value="travel">其他旅行证件</option>
                    </select>
                  </label>
                  <label>
                    <span><b>*</b> 申请人证件号码：</span>
                    <input aria-label="申请人证件号码" maxLength={20} onChange={(event) => updateDraft('applicantIdentityNumber', event.target.value.toUpperCase())} value={draft.applicantIdentityNumber} />
                  </label>
                  <label>
                    <span>收件人姓名：</span>
                    <input aria-label="收件人姓名" readOnly value={quote?.recipientName ?? ''} />
                  </label>
                  <label>
                    <span>收件人电话：</span>
                    <input aria-label="收件人电话" readOnly value={quote?.recipientPhone ?? ''} />
                  </label>
                  <label className="special-handling-form-grid__wide">
                    <span>{draft.kind === 'redirect' ? <b>*</b> : null} 详细地址：</span>
                    {draft.kind === 'redirect' ? (
                      <input aria-label="改址详细地址" onChange={(event) => updateDraft('redirectedAddress', event.target.value)} value={draft.redirectedAddress} />
                    ) : (
                      <input aria-label="原收件人详细地址" readOnly value={quote?.recipientAddress ?? ''} />
                    )}
                  </label>
                  {draft.kind === 'redirect' ? (
                    <>
                      <label>
                        <span><b>*</b> 收件人邮编：</span>
                        <input aria-label="改址收件人邮编" inputMode="numeric" maxLength={6} onChange={(event) => updateDraft('redirectedPostalCode', event.target.value.replace(/\D/g, '').slice(0, 6))} value={draft.redirectedPostalCode} />
                      </label>
                    </>
                  ) : null}
                  <label className="special-handling-form-grid__wide">
                    <span><b>*</b> 申请原因：</span>
                    <textarea aria-label="申请原因" maxLength={200} onChange={(event) => updateDraft('reason', event.target.value)} rows={3} value={draft.reason} />
                  </label>
                  <label>
                    <span>手续费：</span>
                    <output aria-label="手续费">¥ {formatCents(quote?.feeCents ?? 0)}</output>
                  </label>
                </div>
              </fieldset>

              {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
              {error ? <p className="customer-form-error" role="alert">{error}</p> : null}

              <div className="special-handling-actions">
                <button className="special-handling-charge-button" onClick={calculateFee} type="button">计费</button>
                <button className="special-handling-submit-button" disabled={!quote} onClick={() => setConfirmationOpen(true)} type="button">提交</button>
              </div>
            </form>
          </>
        ) : (
          <>
            <section aria-label="邮件改址撤回状态查询条件" className="special-handling-query">
              <label><span>邮件号码：</span><input aria-label="状态查询邮件号码" onChange={(event) => setQuery((current) => ({ ...current, mailItemCode: event.target.value.toUpperCase() }))} value={query.mailItemCode} /></label>
              <label><span>操作员工：</span><select aria-label="状态查询操作员工" onChange={(event) => setQuery((current) => ({ ...current, operatorId: event.target.value }))} value={query.operatorId}><option value="">全部</option>{operatorOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              <label><span>处理类型：</span><select aria-label="状态查询处理类型" onChange={(event) => setQuery((current) => ({ ...current, kind: event.target.value as SpecialHandlingQuery['kind'] }))} value={query.kind}><option value="">全部</option><option value="withdrawal">撤单</option><option value="redirect">改址</option></select></label>
              <label className="special-handling-query__dates"><span>处理日期：</span><input aria-label="状态查询开始日期" onChange={(event) => setQuery((current) => ({ ...current, operatedDateFrom: event.target.value }))} type="date" value={query.operatedDateFrom} /><b>至</b><input aria-label="状态查询结束日期" onChange={(event) => setQuery((current) => ({ ...current, operatedDateTo: event.target.value }))} type="date" value={query.operatedDateTo} /></label>
              <div className="special-handling-query__actions"><button className="special-handling-query-button" onClick={runQuery} type="button">查询</button></div>
            </section>

            {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
            {error && !deleteApplication && !cancelApplication && !settlementApplication ? <p className="customer-form-error" role="alert">{error}</p> : null}

            <div className="special-handling-table-wrap">
              <table className="special-handling-table">
                <thead>
                  <tr><th>序号</th><th>邮件号码</th><th>申请人姓名</th><th>申请人电话</th><th>员工工号</th><th>员工姓名</th><th>处理类型</th><th>处理日期</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {queryRows.map((application, index) => (
                    <tr key={application.id}>
                      <td>{index + 1}</td>
                      <td>{application.mailItemCode}</td>
                      <td>{application.applicantName}</td>
                      <td>{application.applicantPhone}</td>
                      <td>{application.createdBy.operatorId}</td>
                      <td>{application.createdBy.displayName}</td>
                      <td>{specialHandlingKindLabel(application.kind)}</td>
                      <td>{businessCalendarDay(application.createdAt)}</td>
                      <td>
                        <div className="special-handling-row-actions">
                          <button aria-label={`查看详情 ${application.id}`} onClick={() => setDetailApplication(application)} type="button">详情</button>
                          <button aria-label={`办理结算 ${application.id}`} disabled={Boolean(application.settledAt)} onClick={() => setSettlementApplication(application)} type="button">结算</button>
                          <button aria-label={`重新上传 ${application.id}`} disabled={application.uploadStatus !== 'failed' || submitting} onClick={() => void retryUpload(application)} type="button">上传</button>
                          <button aria-label={`删除申请 ${application.id}`} disabled={application.uploadStatus === 'succeeded'} onClick={() => setDeleteApplication(application)} type="button">删除</button>
                          <button aria-label={`取消撤单 ${application.id}`} disabled={application.kind !== 'withdrawal' || application.uploadStatus !== 'succeeded' || Boolean(application.cancelledAt)} onClick={() => setCancelApplication(application)} type="button">取消</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {submittedQuery && queryRows.length === 0 ? <tr><td className="special-handling-empty" colSpan={9}>无数据</td></tr> : null}
                  {!submittedQuery ? <tr><td className="special-handling-empty" colSpan={9}>请输入条件后查询</td></tr> : null}
                </tbody>
              </table>
            </div>
            <div className="special-handling-pagination">共 {queryRows.length} 条 · 10 条/页 · 1 / 1</div>
          </>
        )}
      </section>

      {confirmationOpen && quote ? (
        <Modal description={`邮件号码：${quote.mailItemCode}`} eyebrow="邮件撤改处理" title="确认提交">
          <div className="modal-form special-handling-dialog">
            <dl>
              <div><dt>处理类型</dt><dd>{specialHandlingKindLabel(draft.kind)}</dd></div>
              <div><dt>申请人</dt><dd>{draft.applicantName} / {draft.applicantPhone}</dd></div>
              <div><dt>收件人</dt><dd>{quote.recipientName} / {quote.recipientPhone || '—'}</dd></div>
              <div><dt>原详细地址</dt><dd>{quote.recipientAddress || '—'}</dd></div>
              {draft.kind === 'redirect' ? <div><dt>改址信息</dt><dd>{draft.redirectedAddress}，{draft.redirectedPostalCode}</dd></div> : null}
              <div><dt>手续费</dt><dd>¥ {formatCents(quote.feeCents)}</dd></div>
            </dl>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => setConfirmationOpen(false)} type="button">取消</button><button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void createApplication()} type="button">确定</button></div>
          </div>
        </Modal>
      ) : null}

      {settlementApplication ? (
        <Modal description={`应收手续费：¥ ${formatCents(settlementApplication.feeCents)}`} eyebrow="" title="统一结算">
          <div className="modal-form special-handling-settlement">
            <dl><div><dt>申请流水号</dt><dd>{settlementApplication.id}</dd></div><div><dt>邮件号码</dt><dd>{settlementApplication.mailItemCode}</dd></div><div><dt>处理类型</dt><dd>{specialHandlingKindLabel(settlementApplication.kind)}</dd></div></dl>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="special-handling-tender-actions">
              <button disabled={submitting} onClick={() => void settleApplication('cash')} type="button">现金支付</button>
              <button disabled={submitting} onClick={() => void settleApplication('pos')} type="button">POS支付</button>
              <button disabled={submitting} onClick={() => void settleApplication('third-party')} type="button">第三方支付</button>
            </div>
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setSettlementApplication(null); setError('') }} type="button">关闭</button></div>
          </div>
        </Modal>
      ) : null}

      {detailApplication ? (
        <Modal description={`申请流水号：${detailApplication.id}`} eyebrow="邮件改址撤回状态查询" title="申请详情" wide>
          <div className="modal-form special-handling-dialog">
            <dl>
              <div><dt>邮件号码</dt><dd>{detailApplication.mailItemCode}</dd></div>
              <div><dt>处理类型</dt><dd>{specialHandlingKindLabel(detailApplication.kind)}</dd></div>
              <div><dt>申请人</dt><dd>{detailApplication.applicantName} / {detailApplication.applicantPhone}</dd></div>
              <div><dt>申请人证件</dt><dd>{detailApplication.applicantIdentityNumber}</dd></div>
              <div><dt>收件人</dt><dd>{detailApplication.recipientName} / {detailApplication.recipientPhone || '—'}</dd></div>
              <div><dt>原详细地址</dt><dd>{detailApplication.recipientAddress || '—'}</dd></div>
              {detailApplication.kind === 'redirect' ? <div><dt>改址信息</dt><dd>{detailApplication.redirectedAddress}，{detailApplication.redirectedPostalCode}</dd></div> : null}
              <div><dt>申请原因</dt><dd>{detailApplication.reason}</dd></div>
              <div><dt>手续费</dt><dd>¥ {formatCents(detailApplication.feeCents)}</dd></div>
              <div><dt>付费方式</dt><dd>{specialHandlingTenderLabel(detailApplication.settlementTender)}</dd></div>
              <div><dt>上传状态</dt><dd>{uploadStatusLabel(detailApplication)}</dd></div>
              <div><dt>提交时间</dt><dd>{displayDateTime(detailApplication.createdAt)}</dd></div>
              <div><dt>上传时间</dt><dd>{displayDateTime(detailApplication.uploadedAt)}</dd></div>
              <div><dt>取消时间</dt><dd>{displayDateTime(detailApplication.cancelledAt)}</dd></div>
              <div><dt>退款状态</dt><dd>{detailApplication.refundStatus === 'pending' ? '待退款' : detailApplication.refundStatus === 'refunded' ? '已退款' : '无'}</dd></div>
              {detailApplication.uploadFailureReason ? <div><dt>上传失败原因</dt><dd>{detailApplication.uploadFailureReason}</dd></div> : null}
            </dl>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setDetailApplication(null)} type="button">关闭</button></div>
          </div>
        </Modal>
      ) : null}

      {deleteApplication ? (
        <Modal description={`申请流水号：${deleteApplication.id}`} eyebrow="邮件改址撤回状态查询" title="确认删除">
          <div className="modal-form special-handling-dialog">
            <p>确认删除该条尚未上传成功的撤改申请吗？</p>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setDeleteApplication(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void confirmDelete()} type="button">确定删除</button></div>
          </div>
        </Modal>
      ) : null}

      {cancelApplication ? (
        <Modal description={`邮件号码：${cancelApplication.mailItemCode}`} eyebrow="邮件改址撤回状态查询" title="取消撤单">
          <div className="modal-form special-handling-dialog">
            <p>寄递接口已确认邮件进入投递阶段。取消撤单后，手续费退款将进入退款待办。</p>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setCancelApplication(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void confirmCancellation()} type="button">确认取消撤单</button></div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
