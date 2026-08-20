import { useEffect, useState } from 'react'

import type { RequestOnSiteAuthorization } from '../../domain/access/workAuthorization'
import {
  parseMailTrackingNumbers,
  queryAcceptedMail,
  queryFrontDeskLogs,
  queryMailTracking,
  queryThirdPartyPayments,
  thirdPartyQueryStatus,
  type AcceptedMailQuery,
  type FrontDeskLogQuery,
  type FrontDeskLogRow,
  type MailTrackingResult,
  type ThirdPartyPaymentQuery,
} from '../../domain/service/channelQuery'
import {
  destinationZoneLabel,
  formatCents,
  paymentMethodLabel,
} from '../../domain/service/policy'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import {
  paymentPlatformSerial,
  thirdPartyPaymentStatusLabel,
  type ThirdPartyPaymentRow,
} from '../../domain/service/refundPending'
import type { ServiceRepository } from '../../domain/service/repository'
import type {
  ServiceOperatorSnapshot,
  ServiceTransaction,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

export type ChannelQuerySection =
  | 'third-party-payment'
  | 'front-desk-log'
  | 'mail-tracking'
  | 'accepted-mail'

interface ChannelQueryWorkspaceProps {
  onBack: () => void
  operator: ServiceOperatorSnapshot
  repository: ServiceRepository
  section: ChannelQuerySection
  authorizeOnSite: RequestOnSiteAuthorization
}

function currentBusinessDate(): string {
  return businessCalendarDay(new Date())
}

function displayDateTime(value: string | null): string {
  return value ? value.slice(0, 19).replace('T', ' ') : '—'
}

function acceptedStatusLabel(transaction: ServiceTransaction): string {
  return {
    'pending-settlement': '待结算',
    settled: '已结算',
    withdrawn: '已删除',
  }[transaction.status]
}

function maskContact(value: string): string {
  if (!value) return '—'
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(4, value.length - 5))}${value.slice(-2)}`
}

function maskIdentity(value: string): string {
  if (!value) return '—'
  if (value.length <= 7) return `${value.slice(0, 1)}***${value.slice(-1)}`
  return `${value.slice(0, 3)}${'*'.repeat(value.length - 7)}${value.slice(-4)}`
}

function maskAddress(value: string): string {
  if (!value) return '—'
  if (value.length <= 6) return `${value.slice(0, 1)}***${value.slice(-1)}`
  return `${value.slice(0, 3)}********${value.slice(-3)}`
}

function downloadCsv(fileName: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function QueryBreadcrumb({ label, onBack }: { label: string; onBack: () => void }) {
  return <div className="customer-breadcrumb"><button onClick={onBack} type="button">主页</button><span>/</span><span>查询</span><span>/</span><strong>{label}</strong></div>
}

function ThirdPartyPaymentQueryView({
  onBack,
  state,
}: {
  onBack: () => void
  state: ServiceWorkspaceState
}) {
  const [query, setQuery] = useState<ThirdPartyPaymentQuery>({
    status: 'all',
    paidDateFrom: currentBusinessDate(),
    paidDateTo: currentBusinessDate(),
    operatorId: '',
    workstationCode: '01',
  })
  const [rows, setRows] = useState<ThirdPartyPaymentRow[]>([])
  const [queried, setQueried] = useState(false)
  const [statusDetail, setStatusDetail] = useState<ThirdPartyPaymentRow | null>(null)
  const [businessDetail, setBusinessDetail] = useState<ThirdPartyPaymentRow | null>(null)
  const [error, setError] = useState('')

  function runQuery(): void {
    try {
      setRows(queryThirdPartyPayments(state, query))
      setQueried(true)
      setError('')
    } catch (caught) {
      setRows([])
      setQueried(false)
      setError(caught instanceof Error ? caught.message : '第三方支付查询失败。')
    }
  }

  return <>
    <section className="channel-query-workspace">
      <QueryBreadcrumb label="第三方支付查询" onBack={onBack} />
      <section aria-label="第三方支付查询条件" className="channel-query__filters">
        <label><span>结算状态</span><select aria-label="第三方支付结算状态" onChange={(event) => setQuery({ ...query, status: event.target.value as ThirdPartyPaymentQuery['status'] })} value={query.status}><option value="all">请选择</option><option value="successful">支付成功</option><option value="refund-pending">退款申请中</option><option value="refunded">已退款</option><option value="failed">支付失败</option></select></label>
        <label className="channel-query__date-range"><span>支付时间</span><input aria-label="第三方支付时间起" onChange={(event) => setQuery({ ...query, paidDateFrom: event.target.value })} type="date" value={query.paidDateFrom} /><b>－</b><input aria-label="第三方支付时间止" onChange={(event) => setQuery({ ...query, paidDateTo: event.target.value })} type="date" value={query.paidDateTo} /></label>
        <label><span>收寄员工</span><input aria-label="第三方支付收寄员工" onChange={(event) => setQuery({ ...query, operatorId: event.target.value })} value={query.operatorId} /></label>
        <label><span>台席</span><input aria-label="第三方支付台席" onChange={(event) => setQuery({ ...query, workstationCode: event.target.value })} value={query.workstationCode} /></label>
        <button className="channel-query__primary" onClick={runQuery} type="button">查询</button>
      </section>
      {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
      <section aria-label="第三方支付查询结果" className="channel-query__results">
        <div className="channel-query__result-tools"><span>查询结果</span><strong>{rows.length} 条 / {formatCents(rows.reduce((total, row) => total + row.transaction.charge.settlementDueCents, 0))} 元</strong></div>
        <div className="channel-query__table-wrap"><table><thead><tr><th>序号</th><th>查询流水号</th><th>机构名称</th><th>员工号</th><th>台席</th><th>金额</th><th>支付方式</th><th>支付状态</th><th>支付时间</th><th>平台流水号</th><th>操作</th></tr></thead><tbody>
          {rows.map((row, index) => <tr key={`${row.transaction.id}:${row.settlement.id}`}><td>{index + 1}</td><td>{row.transaction.sourceBatchId ?? row.transaction.id}</td><td>{row.transaction.operator.acceptanceOffice}</td><td>{row.transaction.operator.operatorId}</td><td>{row.transaction.operator.workstationCode}</td><td>{formatCents(row.transaction.charge.settlementDueCents)}</td><td>第三方支付</td><td><span className={`channel-query__status channel-query__status--${thirdPartyQueryStatus(row)}`}>{thirdPartyPaymentStatusLabel(row.refund)}</span></td><td>{displayDateTime(row.settlement.settledAt)}</td><td>{paymentPlatformSerial(row.settlement.id)}</td><td><button onClick={() => setStatusDetail(row)} type="button">支付状态</button><button onClick={() => setBusinessDetail(row)} type="button">详情</button></td></tr>)}
          {!queried ? <tr><td className="channel-query__empty" colSpan={11}>设置条件后点击“查询”。</td></tr> : rows.length === 0 ? <tr><td className="channel-query__empty" colSpan={11}>无数据</td></tr> : null}
        </tbody></table></div>
      </section>
    </section>
    {statusDetail ? <Modal description={`平台流水号：${paymentPlatformSerial(statusDetail.settlement.id)}`} eyebrow="信息" title="支付状态"><div className="modal-form channel-query__message"><p>该订单状态为：<strong>{thirdPartyPaymentStatusLabel(statusDetail.refund)}</strong></p><div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setStatusDetail(null)} type="button">确定</button></div></div></Modal> : null}
    {businessDetail ? <Modal description={`查询流水号：${businessDetail.transaction.sourceBatchId ?? businessDetail.transaction.id}`} eyebrow="第三方支付查询" title="邮件详情" wide><div className="modal-form channel-query__detail"><dl><div><dt>业务产品</dt><dd>{businessDetail.transaction.product.label}（{businessDetail.transaction.product.effectiveBusinessCode}）</dd></div><div><dt>邮件号码</dt><dd>{businessDetail.transaction.service.itemCode || '—'}</dd></div><div><dt>结算单</dt><dd>{businessDetail.settlement.id}</dd></div><div><dt>支付金额</dt><dd>{formatCents(businessDetail.transaction.charge.settlementDueCents)} 元</dd></div><div><dt>支付状态</dt><dd>{thirdPartyPaymentStatusLabel(businessDetail.refund)}</dd></div><div><dt>支付时间</dt><dd>{displayDateTime(businessDetail.settlement.settledAt)}</dd></div></dl><div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setBusinessDetail(null)} type="button">关闭</button></div></div></Modal> : null}
  </>
}

function FrontDeskLogQueryView({ onBack, state }: { onBack: () => void; state: ServiceWorkspaceState }) {
  const [query, setQuery] = useState<FrontDeskLogQuery>({ operation: 'all', product: '', operatorId: '', workstationCode: '', operatedDateFrom: currentBusinessDate(), operatedDateTo: currentBusinessDate() })
  const [rows, setRows] = useState<FrontDeskLogRow[]>([])
  const [queried, setQueried] = useState(false)
  const [error, setError] = useState('')

  function runQuery(): void {
    try { setRows(queryFrontDeskLogs(state, query)); setQueried(true); setError('') }
    catch (caught) { setRows([]); setQueried(false); setError(caught instanceof Error ? caught.message : '前台日志查询失败。') }
  }

  function exportRows(): void {
    downloadCsv('front-desk-log.csv', [['发生时间', '操作', '操作员工', '产品名称', '邮件号码', '金额', '操作原因'], ...rows.map((row) => [displayDateTime(row.operatedAt), row.operationLabel, `${row.operator.operatorId} ${row.operator.displayName}`, row.productName, row.itemCode, formatCents(row.amountCents), row.reason])])
  }

  return <section className="channel-query-workspace"><QueryBreadcrumb label="前台日志查询" onBack={onBack} />
    <section aria-label="前台日志查询条件" className="channel-query__filters">
      <label><span>类型</span><select aria-label="前台日志操作类型" onChange={(event) => setQuery({ ...query, operation: event.target.value as FrontDeskLogQuery['operation'] })} value={query.operation}><option value="all">请选择</option><option value="correction">修改</option><option value="withdrawal">删除</option></select></label>
      <label><span>业务产品</span><input aria-label="前台日志业务产品" onChange={(event) => setQuery({ ...query, product: event.target.value })} value={query.product} /></label>
      <label><span>操作员工</span><input aria-label="前台日志操作员工" onChange={(event) => setQuery({ ...query, operatorId: event.target.value })} value={query.operatorId} /></label>
      <label><span>操作台席</span><input aria-label="前台日志操作台席" onChange={(event) => setQuery({ ...query, workstationCode: event.target.value })} value={query.workstationCode} /></label>
      <label className="channel-query__date-range"><span>收寄日期</span><input aria-label="前台日志日期起" onChange={(event) => setQuery({ ...query, operatedDateFrom: event.target.value })} type="date" value={query.operatedDateFrom} /><b>－</b><input aria-label="前台日志日期止" onChange={(event) => setQuery({ ...query, operatedDateTo: event.target.value })} type="date" value={query.operatedDateTo} /></label>
      <div className="channel-query__actions"><button className="channel-query__primary" onClick={runQuery} type="button">查询</button><button disabled={rows.length === 0} onClick={exportRows} type="button">导出</button><button disabled={rows.length === 0} onClick={() => window.print()} type="button">打印</button></div>
    </section>
    {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
    <section aria-label="前台日志查询结果" className="channel-query__results"><div className="channel-query__table-wrap"><table><thead><tr><th>序号</th><th>发生时间</th><th>操作</th><th>操作员工</th><th>产品名称</th><th>邮件号码</th><th>寄达局</th><th>台席</th><th>资费</th><th>操作原因</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{displayDateTime(row.operatedAt)}</td><td>{row.operationLabel}</td><td>{row.operator.operatorId}<small>{row.operator.displayName}</small></td><td>{row.productName}<small>{row.productCode}</small></td><td>{row.itemCode || '—'}</td><td>{row.destinationOffice || '—'}</td><td>{row.operator.workstationCode}</td><td>{formatCents(row.amountCents)}</td><td>{row.reason}</td></tr>)}{!queried ? <tr><td className="channel-query__empty" colSpan={10}>设置条件后点击“查询”。</td></tr> : rows.length === 0 ? <tr><td className="channel-query__empty" colSpan={10}>无数据</td></tr> : null}</tbody></table></div></section>
  </section>
}

function MailTrackingQueryView({ onBack, state }: { onBack: () => void; state: ServiceWorkspaceState }) {
  const [mailNumbers, setMailNumbers] = useState('')
  const [rows, setRows] = useState<MailTrackingResult[]>([])
  const [queried, setQueried] = useState(false)
  const [detail, setDetail] = useState<MailTrackingResult | null>(null)
  const [error, setError] = useState('')

  function runQuery(): void {
    try { setRows(queryMailTracking(state, mailNumbers)); setQueried(true); setError('') }
    catch (caught) { setRows([]); setQueried(false); setError(caught instanceof Error ? caught.message : '邮件轨迹查询失败。') }
  }

  return <><section className="channel-query-workspace"><QueryBreadcrumb label="给据邮件跟踪查询" onBack={onBack} />
    <section aria-label="给据邮件跟踪查询条件" className="channel-query__tracking-filter"><label><span>邮件号码</span><textarea aria-label="跟踪邮件号码" onChange={(event) => setMailNumbers(event.target.value)} placeholder="输入一个或多个邮件号码，使用英文逗号或空格分隔" value={mailNumbers} /></label><div><button className="channel-query__primary" onClick={runQuery} type="button">查询</button><button disabled={rows.length === 0} onClick={() => window.print()} type="button">打印</button></div></section>
    {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
    {queried ? <p className="channel-query__summary" role="status">已查询 {parseMailTrackingNumbers(mailNumbers).length} 个邮件号码，匹配 {rows.length} 条模拟收寄记录。</p> : null}
    <section aria-label="给据邮件跟踪查询结果" className="channel-query__results"><div className="channel-query__table-wrap"><table><thead><tr><th>序号</th><th>邮件号码</th><th>收寄时间</th><th>最新时间</th><th>最新轨迹</th><th>操作</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.transaction.id}><td>{index + 1}</td><td>{row.transaction.service.itemCode}</td><td>{displayDateTime(row.transaction.acceptedAt)}</td><td>{displayDateTime(row.events[0]?.occurredAt ?? null)}</td><td>{row.events[0]?.description ?? '—'}</td><td><button onClick={() => setDetail(row)} type="button">轨迹详情</button></td></tr>)}{!queried ? <tr><td className="channel-query__empty" colSpan={6}>输入邮件号码后点击“查询”。</td></tr> : rows.length === 0 ? <tr><td className="channel-query__empty" colSpan={6}>无数据</td></tr> : null}</tbody></table></div></section>
  </section>{detail ? <Modal description={`邮件号码：${detail.transaction.service.itemCode}`} eyebrow="给据邮件跟踪查询" title="轨迹详情" wide><div className="modal-form channel-query__timeline">{detail.events.map((item) => <article key={item.id}><time>{displayDateTime(item.occurredAt)}</time><div><strong>{item.description}</strong><span>{item.location} · {item.operatorName}</span></div></article>)}<div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setDetail(null)} type="button">关闭</button></div></div></Modal> : null}</>
}

function AcceptedMailQueryView({
  onBack,
  operator,
  state,
  authorizeOnSite,
}: {
  onBack: () => void
  operator: ServiceOperatorSnapshot
  state: ServiceWorkspaceState
  authorizeOnSite: RequestOnSiteAuthorization
}) {
  const emptyQuery: AcceptedMailQuery = { querySerial: '', product: '', itemCode: '', operatorId: '', senderName: '', recipientName: '', workstationCode: operator.workstationCode, destinationOffice: '', agreementAccountId: '', acceptedDateFrom: currentBusinessDate(), acceptedDateTo: currentBusinessDate() }
  const [query, setQuery] = useState<AcceptedMailQuery>(emptyQuery)
  const [rows, setRows] = useState<ServiceTransaction[]>([])
  const [queried, setQueried] = useState(false)
  const [detail, setDetail] = useState<ServiceTransaction | null>(null)
  const [privacyUnlocked, setPrivacyUnlocked] = useState(false)
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [supervisorId, setSupervisorId] = useState('')
  const [supervisorSecret, setSupervisorSecret] = useState('')
  const [error, setError] = useState('')

  function update<K extends keyof AcceptedMailQuery>(key: K, value: AcceptedMailQuery[K]): void { setQuery((current) => ({ ...current, [key]: value })) }
  function runQuery(): void {
    try { setRows(queryAcceptedMail(state, query)); setQueried(true); setError('') }
    catch (caught) { setRows([]); setQueried(false); setError(caught instanceof Error ? caught.message : '收寄邮件查询失败。') }
  }
  function openDetail(transaction: ServiceTransaction): void { setDetail(transaction); setPrivacyUnlocked(false); setAuthorizationOpen(false); setSupervisorSecret(''); setError('') }
  async function authorizePrivacy(): Promise<void> {
    try {
      await authorizeOnSite(
        'view-accepted-mail-private-data',
        supervisorId,
        supervisorSecret,
        new Date().toISOString(),
      )
      setPrivacyUnlocked(true); setAuthorizationOpen(false); setSupervisorSecret(''); setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '现场授权失败。')
    }
  }

  return <><section className="channel-query-workspace"><QueryBreadcrumb label="收寄邮件查询" onBack={onBack} />
    <section aria-label="收寄邮件查询条件" className="channel-query__filters channel-query__filters--accepted">
      <label><span>查询流水号</span><input aria-label="收寄查询流水号" onChange={(event) => update('querySerial', event.target.value)} value={query.querySerial} /></label><label><span>业务产品</span><input aria-label="收寄查询业务产品" onChange={(event) => update('product', event.target.value)} value={query.product} /></label><label><span>邮件号码</span><input aria-label="收寄查询邮件号码" onChange={(event) => update('itemCode', event.target.value)} value={query.itemCode} /></label>
      <label><span>收寄员工</span><input aria-label="收寄查询员工" onChange={(event) => update('operatorId', event.target.value)} value={query.operatorId} /></label><label><span>寄件人姓名</span><input aria-label="收寄查询寄件人" onChange={(event) => update('senderName', event.target.value)} value={query.senderName} /></label><label><span>收件人姓名</span><input aria-label="收寄查询收件人" onChange={(event) => update('recipientName', event.target.value)} value={query.recipientName} /></label>
      <label><span>台席</span><input aria-label="收寄查询台席" onChange={(event) => update('workstationCode', event.target.value)} value={query.workstationCode} /></label><label><span>寄达局</span><input aria-label="收寄查询寄达局" onChange={(event) => update('destinationOffice', event.target.value)} value={query.destinationOffice} /></label><label><span>协议客户</span><input aria-label="收寄查询协议客户" onChange={(event) => update('agreementAccountId', event.target.value)} value={query.agreementAccountId} /></label>
      <label className="channel-query__date-range"><span>收寄日期</span><input aria-label="收寄查询日期起" onChange={(event) => update('acceptedDateFrom', event.target.value)} type="date" value={query.acceptedDateFrom} /><b>－</b><input aria-label="收寄查询日期止" onChange={(event) => update('acceptedDateTo', event.target.value)} type="date" value={query.acceptedDateTo} /></label><div className="channel-query__actions"><button className="channel-query__primary" onClick={runQuery} type="button">查询</button><button onClick={() => { setQuery(emptyQuery); setRows([]); setQueried(false); setError('') }} type="button">重置</button></div>
    </section>
    {error && !authorizationOpen ? <p className="customer-form-error" role="alert">{error}</p> : null}
    <section aria-label="收寄邮件查询结果" className="channel-query__results"><div className="channel-query__result-tools"><span>查询结果</span><strong>{rows.length} 件 / {formatCents(rows.reduce((total, row) => total + row.charge.totalCents, 0))} 元</strong></div><div className="channel-query__table-wrap"><table><thead><tr><th>序号</th><th>收寄邮件流水号</th><th>业务产品</th><th>邮件号码</th><th>寄达局</th><th>区域</th><th>重量(g)</th><th>总资费(元)</th><th>邮件付费方式</th><th>收寄日期</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.id}</td><td>{row.product.label}<small>{row.product.effectiveBusinessCode}</small></td><td>{row.service.itemCode || '—'}</td><td>{row.service.destinationOffice || '—'}</td><td>{destinationZoneLabel(row.service.destinationZone)}</td><td>{row.service.weightGrams ?? 0}</td><td>{formatCents(row.charge.totalCents)}</td><td>{paymentMethodLabel(row.service.paymentMethod)}</td><td>{displayDateTime(row.acceptedAt)}</td><td>{acceptedStatusLabel(row)}</td><td><button onClick={() => openDetail(row)} type="button">收寄详情</button></td></tr>)}{!queried ? <tr><td className="channel-query__empty" colSpan={12}>设置条件后点击“查询”。</td></tr> : rows.length === 0 ? <tr><td className="channel-query__empty" colSpan={12}>无数据</td></tr> : null}</tbody></table></div></section>
  </section>
  {detail ? <Modal description={`${detail.product.label}（${detail.product.effectiveBusinessCode}） · ${acceptedStatusLabel(detail)}`} eyebrow="收寄邮件查询" title={`收寄详情 ${detail.id}`} wide><div className="modal-form channel-query__acceptance-detail"><section><h3>寄件人信息</h3><dl><div><dt>联系电话</dt><dd>{privacyUnlocked ? detail.customer.sender.contact || '—' : maskContact(detail.customer.sender.contact)}</dd></div><div><dt>姓名</dt><dd>{detail.customer.sender.name || '—'}</dd></div><div><dt>证件类型</dt><dd>{detail.customer.sender.identityType || '—'}</dd></div><div><dt>证件号码</dt><dd>{privacyUnlocked ? detail.customer.sender.identityValue || '—' : maskIdentity(detail.customer.sender.identityValue)}</dd></div><div><dt>详细地址</dt><dd>{privacyUnlocked ? detail.customer.sender.detailedAddress || '—' : maskAddress(detail.customer.sender.detailedAddress)}</dd></div><div><dt>邮编</dt><dd>{detail.customer.sender.postalCode || '—'}</dd></div></dl></section><section><h3>收件人信息</h3><dl><div><dt>联系电话</dt><dd>{privacyUnlocked ? detail.customer.recipient.contact || '—' : maskContact(detail.customer.recipient.contact)}</dd></div><div><dt>姓名</dt><dd>{detail.customer.recipient.name || '—'}</dd></div><div><dt>详细地址</dt><dd>{privacyUnlocked ? detail.customer.recipient.detailedAddress || '—' : maskAddress(detail.customer.recipient.detailedAddress)}</dd></div><div><dt>邮编</dt><dd>{detail.customer.recipient.postalCode || '—'}</dd></div></dl></section><section><h3>邮件信息</h3><dl><div><dt>邮件号码</dt><dd>{detail.service.itemCode || '—'}</dd></div><div><dt>重量</dt><dd>{detail.service.weightGrams ?? 0} g</dd></div><div><dt>件数</dt><dd>{detail.service.quantity}</dd></div><div><dt>总资费</dt><dd>{formatCents(detail.charge.totalCents)} 元</dd></div><div><dt>收寄员工 / 台席</dt><dd>{detail.operator.displayName}（{detail.operator.operatorId}）/ {detail.operator.workstationCode}</dd></div><div><dt>收寄时间</dt><dd>{displayDateTime(detail.acceptedAt)}</dd></div></dl></section><div className="modal-actions">{!privacyUnlocked ? <button className="secondary-button" onClick={() => { setAuthorizationOpen(true); setError('') }} type="button">查看隐私信息</button> : <span className="channel-query__authorized">隐私信息已授权</span>}<button className="primary-button primary-button--compact" onClick={() => { setDetail(null); setPrivacyUnlocked(false); setError('') }} type="button">关闭</button></div></div></Modal> : null}
  {authorizationOpen ? <Modal description="查看完整联系电话、证件号码和详细地址需要主管授权。" eyebrow="主管授权" title="授权"><div className="modal-form supervisor-form"><label><span>主管工号</span><input aria-label="收寄隐私主管工号" onChange={(event) => setSupervisorId(event.target.value)} value={supervisorId} /></label><label><span>主管密码</span><input aria-label="收寄隐私主管密码" onChange={(event) => setSupervisorSecret(event.target.value)} type="password" value={supervisorSecret} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setAuthorizationOpen(false); setSupervisorSecret(''); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={authorizePrivacy} type="button">确认授权</button></div></div></Modal> : null}</>
}

export function ChannelQueryWorkspace({
  onBack,
  operator,
  repository,
  section,
  authorizeOnSite,
}: ChannelQueryWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  useEffect(() => {
    let active = true
    void repository.load().then((state) => { if (active) setWorkspace(state) })
    return () => { active = false }
  }, [repository])
  if (!workspace) return <section className="channel-query-loading">正在读取查询台账…</section>
  if (section === 'third-party-payment') return <ThirdPartyPaymentQueryView onBack={onBack} state={workspace} />
  if (section === 'front-desk-log') return <FrontDeskLogQueryView onBack={onBack} state={workspace} />
  if (section === 'mail-tracking') return <MailTrackingQueryView onBack={onBack} state={workspace} />
  return <AcceptedMailQueryView authorizeOnSite={authorizeOnSite} onBack={onBack} operator={operator} state={workspace} />
}
