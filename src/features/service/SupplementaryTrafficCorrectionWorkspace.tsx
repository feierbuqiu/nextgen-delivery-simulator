import { useEffect, useMemo, useState } from 'react'

import type { RequestOnSiteAuthorization } from '../../domain/access/workAuthorization'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import {
  querySupplementaryTrafficCorrections,
  supplementaryCorrectionStatusLabel,
  type SupplementaryTrafficCorrectionQuery,
} from '../../domain/service/counterCorrections'
import type { FiscalInvoiceRegistrationDraft } from '../../domain/service/invoiceManagement'
import { formatCents, paymentMethodLabel } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import {
  SUPPLEMENTARY_SUBJECTS,
  supplementaryTrafficKindLabel,
} from '../../domain/service/supplementaryTraffic'
import { DEFAULT_SERVICE_OPERATOR, pendingServiceSummary } from '../../domain/service/transactions'
import type {
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
  SupplementaryIncomeRecord,
  SupplementaryTrafficKind,
  SupplementaryTrafficRecord,
} from '../../domain/service/types'
import { CurrencyInput } from '../../ui/CurrencyInput'
import { Modal } from '../../ui/Modal'
import { InvoiceRegistrationModal } from '../invoice/InvoiceRegistrationModal'
import {
  CorrectionWorkspaceTabs,
  type CorrectionWorkspaceKind,
} from './CorrectionWorkspaceTabs'
import type { ServiceSummary } from './ServiceIntakePanel'

interface SupplementaryTrafficCorrectionWorkspaceProps {
  repository: ServiceRepository
  onBack: () => void
  onSummaryChange: (summary: ServiceSummary) => void
  onSelectWorkspace: (workspace: CorrectionWorkspaceKind) => void
  operator?: ServiceOperatorSnapshot
  now?: () => Date
  authorizeOnSite: RequestOnSiteAuthorization
}

function defaultQuery(now = new Date()): SupplementaryTrafficCorrectionQuery {
  const businessDate = businessCalendarDay(now)
  return {
    querySerial: '',
    businessKind: '',
    subjectTerm: '',
    operatorId: '',
    workstationCode: '',
    acceptedDateFrom: businessDate,
    acceptedDateTo: businessDate,
    status: '',
  }
}

function displayDateTime(value: string): string {
  return value.replace('T', ' ').slice(0, 19)
}

function recordSubject(record: SupplementaryTrafficRecord): string {
  return record.kind === 'supplementary-income'
    ? `${record.subjectLabel}（${record.subjectCode}）`
    : `${record.mail.productLabel} · ${record.mail.mailNumber}`
}

function recordCount(record: SupplementaryTrafficRecord): number {
  return record.kind === 'supplementary-income' ? record.count : 1
}

export function SupplementaryTrafficCorrectionWorkspace({
  repository,
  onBack,
  onSummaryChange,
  onSelectWorkspace,
  operator = DEFAULT_SERVICE_OPERATOR,
  now = () => new Date(),
  authorizeOnSite,
}: SupplementaryTrafficCorrectionWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState<SupplementaryTrafficCorrectionQuery>(() => defaultQuery(now()))
  const [appliedQuery, setAppliedQuery] = useState<SupplementaryTrafficCorrectionQuery | null>(null)
  const [detail, setDetail] = useState<SupplementaryTrafficRecord | null>(null)
  const [editing, setEditing] = useState<SupplementaryIncomeRecord | null>(null)
  const [subjectCode, setSubjectCode] = useState('')
  const [count, setCount] = useState(1)
  const [amountCents, setAmountCents] = useState<number | null>(0)
  const [paymentMethod, setPaymentMethod] = useState<'cash-settlement' | 'credit'>('cash-settlement')
  const [correctionReason, setCorrectionReason] = useState('')
  const [deleting, setDeleting] = useState<SupplementaryTrafficRecord | null>(null)
  const [deletionReason, setDeletionReason] = useState('')
  const [supervisorId, setSupervisorId] = useState('')
  const [supervisorSecret, setSupervisorSecret] = useState('')
  const [invoiceRecord, setInvoiceRecord] = useState<SupplementaryTrafficRecord | null>(null)
  const [invoiceDeliveryId, setInvoiceDeliveryId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      onSummaryChange(pendingServiceSummary(loaded))
    })
    return () => { active = false }
  }, [onSummaryChange, repository])

  const results = useMemo(() => (
    workspace && appliedQuery
      ? querySupplementaryTrafficCorrections(workspace.supplementaryTrafficRecords, appliedQuery)
      : []
  ), [appliedQuery, workspace])
  const operators = useMemo(() => {
    const values = new Map<string, string>()
    for (const record of workspace?.supplementaryTrafficRecords ?? []) {
      values.set(record.operator.operatorId, record.operator.displayName)
    }
    return [...values.entries()]
  }, [workspace])
  const workstations = useMemo(() => [...new Set(
    (workspace?.supplementaryTrafficRecords ?? []).map((record) => record.operator.workstationCode),
  )].sort(), [workspace])
  const resultTotalCents = results
    .filter((record) => record.status === 'pending-settlement' || record.status === 'settled')
    .reduce((total, record) => total + record.amountCents, 0)

  function updateQuery<K extends keyof SupplementaryTrafficCorrectionQuery>(
    key: K,
    value: SupplementaryTrafficCorrectionQuery[K],
  ): void {
    setQuery((current) => ({ ...current, [key]: value }))
    setNotice('')
    setError('')
  }

  function runQuery(): void {
    setAppliedQuery(structuredClone(query))
    setNotice('查询完成。')
    setError('')
  }

  function resetQuery(): void {
    setQuery(defaultQuery(now()))
    setAppliedQuery(null)
    setNotice('')
    setError('')
  }

  function refresh(next: ServiceWorkspaceState): void {
    setWorkspace(next)
    onSummaryChange(pendingServiceSummary(next))
  }

  function openCorrection(record: SupplementaryIncomeRecord): void {
    setEditing(record)
    setSubjectCode(record.subjectCode)
    setCount(record.count)
    setAmountCents(record.amountCents)
    setPaymentMethod(record.paymentMethod === 'credit' ? 'credit' : 'cash-settlement')
    setCorrectionReason('')
    setError('')
  }

  async function saveCorrection(): Promise<void> {
    if (!editing) return
    try {
      const operatedAt = now().toISOString()
      const crossDay = businessCalendarDay(editing.acceptedAt) !== businessCalendarDay(operatedAt)
      const result = await repository.executeCounterCorrection({
        type: 'replace-supplementary-income',
        recordId: editing.id,
        subjectCode,
        count,
        amountCents: amountCents ?? 0,
        paymentMethod,
        reason: correctionReason,
        operatedAt,
        operator,
      })
      refresh(result.state)
      const replacementId = result.affectedIds[1]
      setEditing(null)
      setNotice(crossDay
        ? `调账完成：原记录 ${result.affectedIds[0]} 已保留，新补录 ${replacementId} 已进入结算中心。`
        : `重录完成：原记录 ${result.affectedIds[0]} 已删除，新补录 ${replacementId} 已进入结算中心。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '补录调账重录失败。')
    }
  }

  function prepareDelete(record: SupplementaryTrafficRecord): void {
    setDeleting(record)
    setDeletionReason('')
    setSupervisorSecret('')
    setError('')
  }

  async function authorizeDelete(): Promise<void> {
    if (!deleting) return
    try {
      const operatedAt = now().toISOString()
      const authorization = await authorizeOnSite(
        'delete-supplementary-traffic',
        supervisorId,
        supervisorSecret,
        operatedAt,
      )
      const result = await repository.executeCounterCorrection({
        type: 'delete-supplementary-traffic-record',
        recordId: deleting.id,
        reason: deletionReason,
        operatedAt,
        operator,
        authorization,
      })
      refresh(result.state)
      setDeleting(null)
      setNotice(`${result.affectedIds[0]} 已删除；如需继续办理，请返回补录/交管重新录入。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '补录/交管记录删除失败。')
    }
  }

  function prepareInvoice(record: SupplementaryTrafficRecord): void {
    if (record.status !== 'settled' || !record.settlementId) {
      setError('只有已结算记录可以开票。')
      return
    }
    setInvoiceRecord(record)
    setError('')
  }

  async function issueInvoice(registration: FiscalInvoiceRegistrationDraft): Promise<void> {
    if (!invoiceRecord?.settlementId) return
    const issuedAt = now().toISOString()
    const result = await repository.executeInvoiceManagement({
      type: 'issue-settlement-invoice',
      settlementId: invoiceRecord.settlementId,
      issuedAt,
      operator,
      registration,
    })
    refresh(result.state)
    setInvoiceRecord(null)
    setInvoiceDeliveryId(result.invoice.id)
    setNotice(`电子发票 ${result.invoice.invoiceCode}-${result.invoice.invoiceNumber} 已登记。`)
  }

  async function decideInvoiceDelivery(requested: boolean): Promise<void> {
    if (!invoiceDeliveryId) return
    try {
      const decidedAt = now().toISOString()
      const result = await repository.executeInvoiceManagement({
        type: 'record-invoice-delivery',
        invoiceId: invoiceDeliveryId,
        requested,
        decidedAt,
      })
      refresh(result.state)
      setInvoiceDeliveryId(null)
      setNotice(requested ? '电子发票已完成模拟交付。' : '电子发票已登记，暂不交付。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发票交付选择保存失败。')
    }
  }

  if (!workspace) {
    return <section className="transaction-query transaction-query--loading">正在读取补录/交管查改数据…</section>
  }

  const invoiceSettlement = invoiceRecord?.settlementId
    ? workspace.settlements.find((settlement) => settlement.id === invoiceRecord.settlementId)
    : null

  return (
    <>
      <div className="transaction-query supplementary-correction">
        <div className="customer-breadcrumb"><button onClick={onBack} type="button">营业工作台</button><span>/</span><span>查改处理</span><span>/</span><strong>补录/交管查改</strong></div>
        <CorrectionWorkspaceTabs active="supplementary-traffic" onSelect={onSelectWorkspace} />

        <section aria-label="补录交管查改查询条件" className="correction-query-panel">
          <div className="correction-query-grid">
            <label><span>业务选择</span><select aria-label="补录交管查询业务" onChange={(event) => updateQuery('businessKind', event.target.value as '' | SupplementaryTrafficKind)} value={query.businessKind}><option value="">全部</option><option value="supplementary-income">补录操作</option><option value="traffic-bulk-mail">交管大宗邮件</option><option value="single-journey-payment">单程投递缴款</option><option value="round-trip-return">双程返程邮件</option></select></label>
            <label><span>查询流水号</span><input aria-label="补录交管查询流水号" onChange={(event) => updateQuery('querySerial', event.target.value)} value={query.querySerial} /></label>
            <label><span>补录科目 / 邮件号码</span><input aria-label="补录交管查询科目" onChange={(event) => updateQuery('subjectTerm', event.target.value)} value={query.subjectTerm} /></label>
            <label><span>员工信息</span><select aria-label="补录交管查询员工" onChange={(event) => updateQuery('operatorId', event.target.value)} value={query.operatorId}><option value="">全部</option>{operators.map(([id, name]) => <option key={id} value={id}>{name}（{id}）</option>)}</select></label>
            <label><span>台席</span><select aria-label="补录交管查询台席" onChange={(event) => updateQuery('workstationCode', event.target.value)} value={query.workstationCode}><option value="">全部</option>{workstations.map((code) => <option key={code}>{code}</option>)}</select></label>
            <label className="correction-date-range"><span>查询日期</span><span><input aria-label="补录交管查询开始日期" onChange={(event) => updateQuery('acceptedDateFrom', event.target.value)} type="date" value={query.acceptedDateFrom} /><b>至</b><input aria-label="补录交管查询结束日期" onChange={(event) => updateQuery('acceptedDateTo', event.target.value)} type="date" value={query.acceptedDateTo} /></span></label>
            <label><span>记录状态</span><select aria-label="补录交管查询状态" onChange={(event) => updateQuery('status', event.target.value as SupplementaryTrafficCorrectionQuery['status'])} value={query.status}><option value="">全部</option><option value="pending-settlement">未结算</option><option value="settled">已结算</option><option value="adjusted">已调账</option><option value="deleted">已删除</option></select></label>
          </div>
          <div className="correction-query-actions"><button className="query-action query-action--primary" onClick={runQuery} type="button">查询</button><button className="query-action" onClick={resetQuery} type="button">重置</button></div>
        </section>

        <section aria-label="补录交管查改结果" className="correction-results">
          <header className="correction-results__summary"><h1>补录/交管操作记录</h1><div><span>记录数</span><strong>{results.length}</strong><span>有效金额</span><strong>{formatCents(resultTotalCents)}</strong></div></header>
          <div className="correction-table-wrap"><table className="correction-table supplementary-correction__table"><thead><tr><th>序号</th><th>查询流水号</th><th>补录 ID</th><th>业务 / 补录科目</th><th>件/笔数</th><th>金额</th><th>录入日期</th><th>用户名称</th><th>付费方式</th><th>收寄方式</th><th>员工</th><th>台席</th><th>状态</th><th>操作</th></tr></thead><tbody>{results.map((record, index) => <tr key={record.id}><td>{index + 1}</td><td>{record.id}</td><td>{record.kind === 'supplementary-income' ? record.subjectCode : record.mail.mailNumber}</td><td><strong>{recordSubject(record)}</strong><small>{supplementaryTrafficKindLabel(record.kind)}</small></td><td>{recordCount(record)}</td><td>{formatCents(record.amountCents)}</td><td>{displayDateTime(record.acceptedAt)}</td><td>{record.customerName}</td><td>{paymentMethodLabel(record.paymentMethod)}</td><td>窗口</td><td>{record.operator.displayName}</td><td>{record.operator.workstationCode}</td><td>{supplementaryCorrectionStatusLabel(record.status)}</td><td><button onClick={() => setDetail(record)} type="button">详情</button>{record.kind === 'supplementary-income' && (record.status === 'pending-settlement' || record.status === 'settled') ? <button onClick={() => openCorrection(record)} type="button">调账重录</button> : null}<button disabled={record.status !== 'pending-settlement'} onClick={() => prepareDelete(record)} type="button">删除</button><button disabled={record.status !== 'settled'} onClick={() => prepareInvoice(record)} type="button">开票</button></td></tr>)}{appliedQuery && results.length === 0 ? <tr><td className="settlement-empty" colSpan={14}>无数据</td></tr> : null}</tbody></table></div>
          {notice ? <p className="customer-notice" role="status">{notice} {appliedQuery ? `共 ${results.length} 条。` : ''}</p> : null}
          {error && !editing && !deleting ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      {detail ? (
        <Modal description="记录状态、关联原记录和每次调账均为只读审计信息。" eyebrow="补录/交管查改" title={`业务详情 ${detail.id}`} wide><div className="modal-form supplementary-correction__detail"><dl><div><dt>业务类型</dt><dd>{supplementaryTrafficKindLabel(detail.kind)}</dd></div><div><dt>业务内容</dt><dd>{recordSubject(detail)}</dd></div><div><dt>客户名称</dt><dd>{detail.customerName}</dd></div><div><dt>金额</dt><dd>{formatCents(detail.amountCents)} 元</dd></div><div><dt>状态</dt><dd>{supplementaryCorrectionStatusLabel(detail.status)}</dd></div><div><dt>原记录</dt><dd>{detail.replacesRecordId || '—'}</dd></div><div><dt>替代记录</dt><dd>{detail.replacementRecordId || '—'}</dd></div></dl>{(detail.corrections?.length ?? 0) > 0 ? <table><thead><tr><th>调账时间</th><th>方式</th><th>原金额</th><th>新金额</th><th>原因</th><th>新记录</th></tr></thead><tbody>{detail.corrections?.map((correction) => <tr key={correction.id}><td>{displayDateTime(correction.correctedAt)}</td><td>{correction.mode === 'same-day-reentry' ? '当天删除重录' : '跨日调账重录'}</td><td>{formatCents(correction.previousAmountCents)}</td><td>{formatCents(correction.nextAmountCents)}</td><td>{correction.reason}</td><td>{correction.replacementRecordId}</td></tr>)}</tbody></table> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => setDetail(null)} type="button">关闭</button></div></div></Modal>
      ) : null}

      {editing ? (
        <Modal description="当天未缴款记录按删除后重录处理；跨日记录按调账后重录处理，原记录始终保留。" eyebrow="补录/交管查改" title={`调账重录 ${editing.id}`} wide><div className="modal-form supplementary-correction__edit"><div className="bulk-invoice-grid"><label><span>补录科目</span><select aria-label="查改补录科目" onChange={(event) => setSubjectCode(event.target.value)} value={subjectCode}>{SUPPLEMENTARY_SUBJECTS.map((subject) => <option key={subject.code} value={subject.code}>{subject.label}（{subject.code}）</option>)}</select></label><label><span>件/笔数</span><input aria-label="查改补录件笔数" min={1} onChange={(event) => setCount(Number(event.target.value))} type="number" value={count} /></label><label><span>金额</span><CurrencyInput aria-label="查改补录金额" onValueChange={setAmountCents} valueCents={amountCents} /></label><label><span>付费方式</span><select aria-label="查改补录付费方式" onChange={(event) => setPaymentMethod(event.target.value as 'cash-settlement' | 'credit')} value={paymentMethod}><option value="cash-settlement">现结</option><option value="credit">记欠</option></select></label><label className="bulk-invoice-wide"><span>调账原因</span><textarea aria-label="补录调账原因" onChange={(event) => { setCorrectionReason(event.target.value); setError('') }} value={correctionReason} /></label></div>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setEditing(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void saveCorrection()} type="button">调账并重录</button></div></div></Modal>
      ) : null}

      {deleting ? (
        <Modal description="仅当天未缴款记录允许删除；跨日记录请使用“调账重录”。" eyebrow="补录/交管查改" title={`主管授权删除 ${deleting.id}`}><div className="modal-form supervisor-form"><label><span>删除原因</span><textarea aria-label="补录交管删除原因" onChange={(event) => { setDeletionReason(event.target.value); setError('') }} value={deletionReason} /></label><label><span>主管工号</span><input aria-label="补录交管主管工号" onChange={(event) => setSupervisorId(event.target.value)} value={supervisorId} /></label><label><span>主管密码</span><input aria-label="补录交管主管密码" onChange={(event) => setSupervisorSecret(event.target.value)} type="password" value={supervisorSecret} /></label><p className="service-field-hint">由主管本人现场输入工号和密码；系统不显示或代填。</p>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setDeleting(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void authorizeDelete()} type="button">授权并删除</button></div></div></Modal>
      ) : null}

      {invoiceRecord?.settlementId && invoiceSettlement ? (
        <InvoiceRegistrationModal amountCents={invoiceSettlement.amountDueCents} defaults={{ buyerType: invoiceRecord.agreementAccountId ? 'organization' : 'individual', buyerName: invoiceRecord.customerName, taxpayerId: invoiceRecord.agreementAccountId, deliveryPhone: '', buyerPhone: '', deliveryEmail: '', buyerAddress: '', bankName: '', bankAccount: '', reviewer: operator.displayName, remark: `补录/交管结算 ${invoiceRecord.settlementId}` }} onClose={() => setInvoiceRecord(null)} onSubmit={issueInvoice} sourceLabel={`结算批次 ${invoiceRecord.settlementId}`} />
      ) : null}

      {invoiceDeliveryId ? <Modal description="电子发票登记完成。" eyebrow="补录/交管查改" title="是否进行发票交付？"><div className="modal-form invoice-choice"><p>请选择是否立即完成本次发票交付。</p><div className="modal-actions"><button className="secondary-button" onClick={() => void decideInvoiceDelivery(false)} type="button">暂不交付</button><button className="primary-button primary-button--compact" onClick={() => void decideInvoiceDelivery(true)} type="button">立即交付</button></div></div></Modal> : null}
    </>
  )
}
