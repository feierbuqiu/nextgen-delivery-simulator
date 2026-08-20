import { useEffect, useMemo, useState } from 'react'

import type { RequestOnSiteAuthorization } from '../../domain/access/workAuthorization'
import { formatCents } from '../../domain/service/policy'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import type { ServiceRepository } from '../../domain/service/repository'
import { specialHandlingTenderLabel } from '../../domain/service/specialHandling'
import {
  paymentPlatformSerial,
  refundStatusLabel,
  thirdPartyPaymentRows,
  thirdPartyPaymentStatusLabel,
  type ThirdPartyPaymentRow,
} from '../../domain/service/refundPending'
import type {
  ServiceOperatorSnapshot,
  ServiceRefundRecord,
  ServiceTransaction,
  ServiceWorkspaceState,
  SettlementRecord,
  SpecialHandlingApplication,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface RefundPendingWorkspaceProps {
  onBack: () => void
  operator: ServiceOperatorSnapshot
  repository: ServiceRepository
  authorizeOnSite: RequestOnSiteAuthorization
}

type RefundTab = 'refund' | 'payment'
type RefundFilter = 'all' | 'pending' | 'refunded' | 'failed'
type PaymentFilter = 'all' | 'successful' | 'refund-pending' | 'refunded' | 'failed'

interface ServiceRefundRow {
  source: 'service'
  refund: ServiceRefundRecord
  transaction: ServiceTransaction
  settlement: SettlementRecord
}

interface SpecialHandlingRefundRow {
  source: 'special-handling'
  application: SpecialHandlingApplication
}

type RefundRow = ServiceRefundRow | SpecialHandlingRefundRow

function datePart(value: string | null): string {
  return value ? businessCalendarDay(value) : ''
}

function displayDateTime(value: string | null): string {
  if (!value) return '—'
  return value.slice(0, 19).replace('T', ' ')
}

function paymentFilterValue(row: ThirdPartyPaymentRow): Exclude<PaymentFilter, 'all'> {
  if (row.refund?.status === 'pending') return 'refund-pending'
  if (row.refund?.status === 'refunded') return 'refunded'
  if (row.refund?.status === 'failed') return 'failed'
  return 'successful'
}

function paymentMethodLabel(): string {
  return '第三方支付'
}

function includesQuery(values: Array<string | null>, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalized) return true
  return values.some((value) => (
    value ?? ''
  ).toLocaleLowerCase('zh-CN').includes(normalized))
}

function refundRowId(row: RefundRow): string {
  return row.source === 'service' ? row.refund.id : row.application.id
}

function refundRowStatus(row: RefundRow): Exclude<RefundFilter, 'all'> {
  return row.source === 'service' ? row.refund.status as Exclude<RefundFilter, 'all'> : row.application.refundStatus as 'pending' | 'refunded'
}

function refundRowRequestedAt(row: RefundRow): string {
  if (row.source === 'service') return row.refund.requestedAt ?? row.refund.createdAt
  return row.application.cancelledAt ?? row.application.createdAt
}

function refundRowAmountCents(row: RefundRow): number {
  return row.source === 'service' ? row.refund.amountCents : row.application.feeCents
}

function refundRowPaymentSerial(row: RefundRow): string {
  return row.source === 'service' ? row.settlement.id : row.application.id
}

function refundRowQuerySerial(row: RefundRow): string {
  return row.source === 'service'
    ? row.transaction.sourceBatchId ?? row.transaction.id
    : row.application.transactionId
}

function refundRowPlatformSerial(row: RefundRow): string {
  return row.source === 'service' ? paymentPlatformSerial(row.settlement.id) : '—'
}

function refundRowLabel(row: RefundRow): string {
  return row.source === 'service'
    ? `${row.transaction.product.label}退款`
    : '邮件撤单手续费退款'
}

function refundRowTenderLabel(row: RefundRow): string {
  return row.source === 'service'
    ? paymentMethodLabel()
    : specialHandlingTenderLabel(row.application.settlementTender)
}

export function RefundPendingWorkspace({
  onBack,
  operator,
  repository,
  authorizeOnSite,
}: RefundPendingWorkspaceProps) {
  const businessDate = businessCalendarDay(new Date())
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [tab, setTab] = useState<RefundTab>('refund')
  const [refundFilter, setRefundFilter] = useState<RefundFilter>('all')
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all')
  const [refundDateFrom, setRefundDateFrom] = useState(businessDate)
  const [refundDateTo, setRefundDateTo] = useState(businessDate)
  const [paymentDateFrom, setPaymentDateFrom] = useState(businessDate)
  const [paymentDateTo, setPaymentDateTo] = useState(businessDate)
  const [refundSerial, setRefundSerial] = useState('')
  const [paymentSerial, setPaymentSerial] = useState('')
  const [refundQueried, setRefundQueried] = useState(false)
  const [paymentQueried, setPaymentQueried] = useState(false)
  const [paymentDetail, setPaymentDetail] = useState<ThirdPartyPaymentRow | null>(null)
  const [refundAction, setRefundAction] = useState<RefundRow | null>(null)
  const [refundDetail, setRefundDetail] = useState<RefundRow | null>(null)
  const [supervisorId, setSupervisorId] = useState('')
  const [supervisorSecret, setSupervisorSecret] = useState('')
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

  const allPaymentRows = useMemo(
    () => workspace ? thirdPartyPaymentRows(workspace) : [],
    [workspace],
  )

  const allRefundRows = useMemo(() => {
    if (!workspace) return []
    const transactions = new Map(
      workspace.transactions.map((transaction) => [transaction.id, transaction]),
    )
    const settlements = new Map(
      workspace.settlements.map((settlement) => [settlement.id, settlement]),
    )
    const serviceRows = workspace.refunds
      .filter((refund) => (
        refund.route === 'original-payment' &&
        refund.status !== 'application-required'
      ))
      .map((refund): ServiceRefundRow | null => {
        const transaction = transactions.get(refund.transactionId)
        const settlement = settlements.get(refund.settlementId)
        return transaction && settlement
          ? { source: 'service', refund, transaction, settlement }
          : null
      })
      .filter((row): row is ServiceRefundRow => Boolean(row))
    const specialHandlingRows: SpecialHandlingRefundRow[] = workspace
      .specialHandlingApplications
      .filter((application) => (
        application.refundStatus === 'pending' ||
        application.refundStatus === 'refunded'
      ))
      .map((application) => ({ source: 'special-handling', application }))
    return [...serviceRows, ...specialHandlingRows]
  }, [workspace])

  const paymentRows = useMemo(() => {
    if (!paymentQueried) return []
    return allPaymentRows
      .filter((row) => (
        paymentFilter === 'all' || paymentFilterValue(row) === paymentFilter
      ))
      .filter((row) => {
        const settledDate = datePart(row.settlement.settledAt)
        return (!paymentDateFrom || settledDate >= paymentDateFrom) &&
          (!paymentDateTo || settledDate <= paymentDateTo)
      })
      .filter((row) => includesQuery([
        row.transaction.sourceBatchId,
        row.transaction.id,
        row.settlement.id,
        paymentPlatformSerial(row.settlement.id),
        row.transaction.service.itemCode,
      ], paymentSerial))
      .sort((left, right) => right.settlement.settledAt.localeCompare(left.settlement.settledAt))
  }, [
    allPaymentRows,
    paymentDateFrom,
    paymentDateTo,
    paymentFilter,
    paymentQueried,
    paymentSerial,
  ])

  const refundRows = useMemo(() => {
    if (!refundQueried) return []
    return allRefundRows
      .filter((row) => refundFilter === 'all' || refundRowStatus(row) === refundFilter)
      .filter((row) => {
        const requestedDate = datePart(refundRowRequestedAt(row))
        return (!refundDateFrom || requestedDate >= refundDateFrom) &&
          (!refundDateTo || requestedDate <= refundDateTo)
      })
      .filter((row) => includesQuery(row.source === 'service'
        ? [
            row.transaction.sourceBatchId,
            row.transaction.id,
            row.settlement.id,
            paymentPlatformSerial(row.settlement.id),
            row.refund.platformRefundId,
            row.transaction.service.itemCode,
          ]
        : [
            row.application.id,
            row.application.transactionId,
            row.application.mailItemCode,
          ], refundSerial))
      .sort((left, right) => (
        refundRowRequestedAt(right).localeCompare(refundRowRequestedAt(left))
      ))
  }, [
    allRefundRows,
    refundDateFrom,
    refundDateTo,
    refundFilter,
    refundQueried,
    refundSerial,
  ])

  function selectTab(next: RefundTab): void {
    setTab(next)
    setError('')
    setNotice('')
  }

  async function requestRefund(): Promise<void> {
    const refund = paymentDetail?.refund
    if (!refund || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await repository.requestThirdPartyRefund({
        refundId: refund.id,
        requestedAt: new Date().toISOString(),
        operator,
      })
      setWorkspace(result.state)
      setPaymentDetail(null)
      setNotice(`退款申请 ${result.refund.id} 已发起，请到“退款待办查询”办理退款。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '退款申请发起失败。')
    } finally {
      setSubmitting(false)
    }
  }

  async function completeRefund(): Promise<void> {
    if (!refundAction || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const processedAt = new Date().toISOString()
      if (refundAction.source === 'special-handling') {
        const authorization = await authorizeOnSite(
          'complete-special-handling-refund',
          supervisorId,
          supervisorSecret,
          processedAt,
        )
        const result = await repository.executeSpecialHandling({
          type: 'complete-special-handling-refund',
          applicationId: refundAction.application.id,
          refundedAt: processedAt,
          operator,
          authorization,
        })
        setWorkspace(result.state)
        setRefundAction(null)
        setSupervisorSecret('')
        setNotice(`退款 ${result.application?.id ?? ''} 已办理。`)
        return
      }
      const authorization = await authorizeOnSite(
        'complete-third-party-refund',
        supervisorId,
        supervisorSecret,
        processedAt,
      )
      const result = await repository.completeThirdPartyRefund({
        refundId: refundAction.refund.id,
        processedAt,
        operator,
        authorization,
      })
      setWorkspace(result.state)
      setRefundAction(null)
      setSupervisorSecret('')
      setNotice(`退款 ${result.refund.id} 已按原支付渠道退回。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '退款办理失败。')
    } finally {
      setSubmitting(false)
    }
  }

  function openRefund(row: RefundRow): void {
    setRefundAction(row)
    setSupervisorId('')
    setSupervisorSecret('')
    setError('')
    setNotice('')
  }

  if (!workspace) {
    return <section className="refund-pending-loading">正在读取退款记录…</section>
  }

  return (
    <>
      <section className="refund-pending-workspace">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业渠道</button>
          <span>/</span><span>业务办理</span><span>/</span>
          <strong>退款待办查询</strong>
        </div>

        <nav aria-label="退款待办查询页签" className="refund-pending-tabs">
          <button
            aria-selected={tab === 'refund'}
            className={tab === 'refund' ? 'is-active' : ''}
            onClick={() => selectTab('refund')}
            role="tab"
            type="button"
          >
            退款待办查询
          </button>
          <button
            aria-selected={tab === 'payment'}
            className={tab === 'payment' ? 'is-active' : ''}
            onClick={() => selectTab('payment')}
            role="tab"
            type="button"
          >
            支付状态查询
          </button>
        </nav>

        {tab === 'refund' ? (
          <section aria-label="退款待办查询条件" className="refund-pending-query">
            <label>
              <span>退款状态：</span>
              <select aria-label="退款状态" onChange={(event) => setRefundFilter(event.target.value as RefundFilter)} value={refundFilter}>
                <option value="all">请选择</option>
                <option value="pending">未退款</option>
                <option value="refunded">已退款</option>
                <option value="failed">退款失败</option>
              </select>
            </label>
            <label className="refund-pending-date-range">
              <span>申请退款时间：</span>
              <input aria-label="申请退款时间起" onChange={(event) => setRefundDateFrom(event.target.value)} type="date" value={refundDateFrom} />
              <b>至</b>
              <input aria-label="申请退款时间止" onChange={(event) => setRefundDateTo(event.target.value)} type="date" value={refundDateTo} />
            </label>
            <label>
              <span>查询流水号：</span>
              <input aria-label="退款查询流水号" onChange={(event) => setRefundSerial(event.target.value)} value={refundSerial} />
            </label>
            <button className="refund-query-button" onClick={() => { setRefundQueried(true); setError(''); setNotice('') }} type="button">查询</button>
          </section>
        ) : (
          <section aria-label="支付状态查询条件" className="refund-pending-query">
            <label>
              <span>结算状态：</span>
              <select aria-label="结算状态" onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)} value={paymentFilter}>
                <option value="all">请选择</option>
                <option value="successful">支付成功</option>
                <option value="refund-pending">退款申请中</option>
                <option value="refunded">已退款</option>
                <option value="failed">退款失败</option>
              </select>
            </label>
            <label className="refund-pending-date-range">
              <span>支付时间：</span>
              <input aria-label="支付时间起" onChange={(event) => setPaymentDateFrom(event.target.value)} type="date" value={paymentDateFrom} />
              <b>至</b>
              <input aria-label="支付时间止" onChange={(event) => setPaymentDateTo(event.target.value)} type="date" value={paymentDateTo} />
            </label>
            <label>
              <span>查询流水号：</span>
              <input aria-label="支付查询流水号" onChange={(event) => setPaymentSerial(event.target.value)} value={paymentSerial} />
            </label>
            <button className="refund-query-button" onClick={() => { setPaymentQueried(true); setError(''); setNotice('') }} type="button">查询</button>
          </section>
        )}

        {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
        {error && !paymentDetail && !refundAction ? <p className="customer-form-error" role="alert">{error}</p> : null}

        <div className="refund-pending-table-wrap">
          {tab === 'refund' ? (
            <table className="refund-pending-table">
              <thead><tr><th>序号</th><th>支付流水号</th><th>查询流水号</th><th>平台流水号</th><th>交易种类名称</th><th>退款金额</th><th>交易日期</th><th>付费方式</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {refundRows.map((row, index) => (
                  <tr key={refundRowId(row)}>
                    <td>{index + 1}</td>
                    <td>{refundRowPaymentSerial(row)}</td>
                    <td>{refundRowQuerySerial(row)}</td>
                    <td>{refundRowPlatformSerial(row)}</td>
                    <td>{refundRowLabel(row)}</td>
                    <td>¥ {formatCents(refundRowAmountCents(row))}</td>
                    <td>{datePart(refundRowRequestedAt(row))}</td>
                    <td>{refundRowTenderLabel(row)}</td>
                    <td><span className={`refund-state refund-state--${refundRowStatus(row)}`}>{refundStatusLabel(refundRowStatus(row))}</span></td>
                    <td>
                      {refundRowStatus(row) === 'pending' ? (
                        <button aria-label={`办理退款 ${refundRowId(row)}`} onClick={() => openRefund(row)} type="button">退款</button>
                      ) : (
                        <button aria-label={`查看退款状态 ${refundRowId(row)}`} onClick={() => setRefundDetail(row)} type="button">退款状态</button>
                      )}
                    </td>
                  </tr>
                ))}
                {refundQueried && refundRows.length === 0 ? <tr><td className="refund-pending-empty" colSpan={10}>无数据</td></tr> : null}
                {!refundQueried ? <tr><td className="refund-pending-empty" colSpan={10}>请选择条件后查询</td></tr> : null}
              </tbody>
            </table>
          ) : (
            <table className="refund-pending-table refund-payment-table">
              <thead><tr><th>序号</th><th>查询流水号</th><th>机构名称</th><th>员工姓名</th><th>台席代码</th><th>金额（元）</th><th>支付方式</th><th>支付状态</th><th>付款时间</th><th>平台流水号</th><th>操作</th></tr></thead>
              <tbody>
                {paymentRows.map((row, index) => (
                  <tr key={row.transaction.id}>
                    <td>{index + 1}</td>
                    <td>{row.transaction.sourceBatchId ?? row.transaction.id}</td>
                    <td>{row.transaction.operator.acceptanceOffice}</td>
                    <td>{row.transaction.operator.displayName}</td>
                    <td>{row.transaction.operator.workstationCode}</td>
                    <td>{formatCents(row.transaction.charge.settlementDueCents)}</td>
                    <td>{paymentMethodLabel()}</td>
                    <td><span className={`refund-state refund-state--${paymentFilterValue(row)}`}>{thirdPartyPaymentStatusLabel(row.refund)}</span></td>
                    <td>{displayDateTime(row.settlement.settledAt)}</td>
                    <td>{paymentPlatformSerial(row.settlement.id)}</td>
                    <td><button aria-label={`查看支付状态 ${row.transaction.id}`} onClick={() => { setPaymentDetail(row); setError(''); setNotice('') }} type="button">支付状态</button></td>
                  </tr>
                ))}
                {paymentQueried && paymentRows.length === 0 ? <tr><td className="refund-pending-empty" colSpan={11}>无数据</td></tr> : null}
                {!paymentQueried ? <tr><td className="refund-pending-empty" colSpan={11}>请选择条件后查询</td></tr> : null}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {paymentDetail ? (
        <Modal description={`查询流水号：${paymentDetail.transaction.sourceBatchId ?? paymentDetail.transaction.id}`} eyebrow="支付状态查询" title="支付状态">
          <div className="modal-form refund-status-dialog">
            <dl>
              <div><dt>支付流水号</dt><dd>{paymentDetail.settlement.id}</dd></div>
              <div><dt>平台流水号</dt><dd>{paymentPlatformSerial(paymentDetail.settlement.id)}</dd></div>
              <div><dt>机构名称</dt><dd>{paymentDetail.transaction.operator.acceptanceOffice}</dd></div>
              <div><dt>员工 / 台席</dt><dd>{paymentDetail.transaction.operator.displayName} / {paymentDetail.transaction.operator.workstationCode}</dd></div>
              <div><dt>支付金额</dt><dd>¥ {formatCents(paymentDetail.transaction.charge.settlementDueCents)}</dd></div>
              <div><dt>支付方式</dt><dd>{paymentMethodLabel()}</dd></div>
              <div><dt>支付状态</dt><dd>{thirdPartyPaymentStatusLabel(paymentDetail.refund)}</dd></div>
              <div><dt>付款时间</dt><dd>{displayDateTime(paymentDetail.settlement.settledAt)}</dd></div>
            </dl>
            {paymentDetail.refund?.status === 'application-required' ? <p className="refund-authorization-note">原交易已经撤销，可发起原路退款申请。</p> : null}
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => { setPaymentDetail(null); setError('') }} type="button">关闭</button>
              {paymentDetail.refund?.status === 'application-required' ? (
                <button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void requestRefund()} type="button">发起退款申请</button>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}

      {refundAction ? (
        <Modal description={`退款金额：¥ ${formatCents(refundRowAmountCents(refundAction))}，退款款项按原付费渠道退回。`} eyebrow="退款待办查询" title="退款">
          <div className="modal-form refund-authorization-dialog">
            <label><span>主管工号</span><input aria-label="退款主管工号" onChange={(event) => setSupervisorId(event.target.value)} value={supervisorId} /></label>
            <label><span>主管密码</span><input aria-label="退款主管密码" onChange={(event) => setSupervisorSecret(event.target.value)} type="password" value={supervisorSecret} /></label>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => { setRefundAction(null); setSupervisorSecret(''); setError('') }} type="button">取消</button>
              <button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void completeRefund()} type="button">确认退款</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {refundDetail ? (
        <Modal description={`退款记录：${refundRowId(refundDetail)}`} eyebrow="退款待办查询" title="退款状态">
          <div className="modal-form refund-status-dialog">
            <dl>
              <div><dt>当前状态</dt><dd>{refundStatusLabel(refundRowStatus(refundDetail))}</dd></div>
              <div><dt>支付流水号</dt><dd>{refundRowPaymentSerial(refundDetail)}</dd></div>
              <div><dt>查询流水号</dt><dd>{refundRowQuerySerial(refundDetail)}</dd></div>
              <div><dt>平台流水号</dt><dd>{refundRowPlatformSerial(refundDetail)}</dd></div>
              <div><dt>退款金额</dt><dd>¥ {formatCents(refundRowAmountCents(refundDetail))}</dd></div>
              <div><dt>申请时间</dt><dd>{displayDateTime(refundRowRequestedAt(refundDetail))}</dd></div>
              <div><dt>退款时间</dt><dd>{displayDateTime(refundDetail.source === 'service' ? refundDetail.refund.processedAt : refundDetail.application.refundedAt)}</dd></div>
              <div><dt>退款平台流水号</dt><dd>{refundDetail.source === 'service' ? refundDetail.refund.platformRefundId || '—' : '—'}</dd></div>
              <div><dt>办理员工</dt><dd>{refundDetail.source === 'service' ? refundDetail.refund.processedBy?.displayName ?? '—' : refundDetail.application.refundedBy?.displayName ?? '—'}</dd></div>
              <div><dt>失败原因</dt><dd>{refundDetail.source === 'service' ? refundDetail.refund.failureReason || '—' : '—'}</dd></div>
            </dl>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setRefundDetail(null)} type="button">关闭</button></div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
