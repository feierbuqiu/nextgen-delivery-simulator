import { useEffect, useMemo, useState } from 'react'

import type { RequestOnSiteAuthorization } from '../../domain/access/workAuthorization'
import { formatCents } from '../../domain/service/policy'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import type { ServiceRepository } from '../../domain/service/repository'
import type {
  FiscalInvoiceRecord,
  FiscalInvoiceStatus,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

export type InvoiceManagementSection = 'legacy' | 'financial'

interface InvoiceManagementWorkspaceProps {
  onBack: () => void
  operator: ServiceOperatorSnapshot
  repository: ServiceRepository
  section: InvoiceManagementSection
  authorizeOnSite: RequestOnSiteAuthorization
}

function dateRangeWithinThreeMonths(from: string, to: string): boolean {
  if (!from || !to || from > to) return false
  const limit = new Date(`${from}T00:00:00Z`)
  limit.setUTCMonth(limit.getUTCMonth() + 3)
  return new Date(`${to}T23:59:59Z`).getTime() <= limit.getTime()
}

function invoiceStatusLabel(status: FiscalInvoiceStatus): string {
  return status === 'issued' ? '已开票' : '已冲红'
}

function buyerTypeLabel(invoice: FiscalInvoiceRecord): string {
  return invoice.buyerType === 'organization' ? '1-单位' : '2-个人'
}

export function InvoiceManagementWorkspace({
  onBack,
  operator,
  repository,
  section,
  authorizeOnSite,
}: InvoiceManagementWorkspaceProps) {
  const businessDate = businessCalendarDay(new Date())
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [status, setStatus] = useState<FiscalInvoiceStatus>('issued')
  const [invoiceCode, setInvoiceCode] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [workstationCode, setWorkstationCode] = useState(operator.workstationCode)
  const [issuerId, setIssuerId] = useState(operator.operatorId)
  const [dateFrom, setDateFrom] = useState(businessDate)
  const [dateTo, setDateTo] = useState(businessDate)
  const [hasQueried, setHasQueried] = useState(false)
  const [results, setResults] = useState<FiscalInvoiceRecord[]>([])
  const [detail, setDetail] = useState<FiscalInvoiceRecord | null>(null)
  const [redFlushTarget, setRedFlushTarget] = useState<FiscalInvoiceRecord | null>(null)
  const [supervisorId, setSupervisorId] = useState('')
  const [supervisorSecret, setSupervisorSecret] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (active) setWorkspace(loaded)
    })
    return () => {
      active = false
    }
  }, [repository])

  const availableWorkstations = useMemo(() => {
    const values = new Set([operator.workstationCode])
    workspace?.fiscalInvoices.forEach((invoice) => values.add(invoice.issuedBy.workstationCode))
    return [...values]
  }, [operator.workstationCode, workspace])

  const availableIssuers = useMemo(() => {
    const values = new Map([[operator.operatorId, operator.displayName]])
    workspace?.fiscalInvoices.forEach((invoice) => {
      values.set(invoice.issuedBy.operatorId, invoice.issuedBy.displayName)
    })
    return [...values.entries()]
  }, [operator.displayName, operator.operatorId, workspace])

  function matchingInvoices(state: ServiceWorkspaceState): FiscalInvoiceRecord[] {
    const codeTerm = invoiceCode.trim().toLocaleLowerCase('zh-CN')
    const numberTerm = invoiceNumber.trim().toLocaleLowerCase('zh-CN')
    return state.fiscalInvoices.filter((invoice) => {
      if (invoice.status !== status) return false
      if (codeTerm && !invoice.invoiceCode.toLocaleLowerCase('zh-CN').includes(codeTerm)) return false
      if (numberTerm && !invoice.invoiceNumber.toLocaleLowerCase('zh-CN').includes(numberTerm)) return false
      if (workstationCode && invoice.issuedBy.workstationCode !== workstationCode) return false
      if (issuerId && invoice.issuedBy.operatorId !== issuerId) return false
      const issuedDate = businessCalendarDay(invoice.issuedAt)
      return issuedDate >= dateFrom && issuedDate <= dateTo
    }).sort((left, right) => right.issuedAt.localeCompare(left.issuedAt))
  }

  function runQuery(state = workspace): void {
    if (!state) return
    if (!dateRangeWithinThreeMonths(dateFrom, dateTo)) {
      setError('开票日期起止范围必须有效，且不能超过三个月。')
      return
    }
    setResults(matchingInvoices(state))
    setHasQueried(true)
    setNotice('')
    setError('')
  }

  function openRedFlush(invoice: FiscalInvoiceRecord): void {
    setRedFlushTarget(invoice)
    setSupervisorId('')
    setSupervisorSecret('')
    setError('')
  }

  async function confirmRedFlush(): Promise<void> {
    if (!redFlushTarget) return
    try {
      const redFlushedAt = new Date().toISOString()
      const authorization = await authorizeOnSite(
        'red-flush-invoice',
        supervisorId,
        supervisorSecret,
        redFlushedAt,
      )
      const result = await repository.executeInvoiceManagement({
        type: 'red-flush-invoice',
        invoiceId: redFlushTarget.id,
        redFlushedAt,
        operator,
        authorization,
      })
      setWorkspace(result.state)
      setRedFlushTarget(null)
      setSupervisorSecret('')
      setNotice(`发票 ${result.invoice.invoiceCode} / ${result.invoice.invoiceNumber} 已冲红。`)
      setError('')
      setResults(status === 'issued'
        ? results.filter((invoice) => invoice.id !== result.invoice.id)
        : matchingInvoices(result.state))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发票冲红失败。')
    }
  }

  if (section === 'legacy') {
    return (
      <div className="invoice-management">
        <div className="customer-breadcrumb"><button onClick={onBack} type="button">主页</button><span>/</span><strong>票据冲红处理</strong></div>
        <section className="invoice-management__legacy" aria-label="票据冲红处理">
          <div className="invoice-management__section-title">票据冲红处理</div>
          <p>该入口对应业财一期上线前开具的历史发票。当前渠道开具的电子发票请进入“业财发票冲红”办理。</p>
        </section>
      </div>
    )
  }

  return (
    <>
      <div className="invoice-management">
        <div className="customer-breadcrumb"><button onClick={onBack} type="button">主页</button><span>/</span><strong>业财发票冲红</strong></div>
        <section className="invoice-management__query" aria-labelledby="invoice-query-title">
          <div className="invoice-management__section-title" id="invoice-query-title">⌄ 查询条件</div>
          <div className="invoice-management__filter-grid">
            <fieldset><legend>开票类型</legend><label><input checked={status === 'issued'} onChange={() => { setStatus('issued'); setHasQueried(false); setResults([]) }} type="radio" /> 已开票</label><label><input checked={status === 'red-flushed'} onChange={() => { setStatus('red-flushed'); setHasQueried(false); setResults([]) }} type="radio" /> 已冲红</label></fieldset>
            <label><span>发票代码</span><input aria-label="发票代码" onChange={(event) => setInvoiceCode(event.target.value)} placeholder="请输入发票代码" value={invoiceCode} /></label>
            <label><span>发票号码</span><input aria-label="发票号码" onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="请输入发票号码" value={invoiceNumber} /></label>
            <label><span>台席</span><select aria-label="开票台席" onChange={(event) => setWorkstationCode(event.target.value)} value={workstationCode}><option value="">全部</option>{availableWorkstations.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
            <label><span>开票员工</span><select aria-label="开票员工" onChange={(event) => setIssuerId(event.target.value)} value={issuerId}><option value="">全部</option>{availableIssuers.map(([id, name]) => <option key={id} value={id}>{id} {name}</option>)}</select></label>
            <label className="invoice-management__date-range"><span>开票日期</span><span><input aria-label="开票日期起" onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} /><i>－</i><input aria-label="开票日期止" onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} /></span><small>日期选择三个月范围</small></label>
          </div>
          <button className="invoice-management__query-button" onClick={() => runQuery()} type="button">查询</button>
        </section>

        {notice ? <p className="customer-form-success" role="status">{notice}</p> : null}
        {error && !redFlushTarget ? <p className="customer-form-error" role="alert">{error}</p> : null}

        <section className="invoice-management__results" aria-label="发票查询结果">
          <div className="invoice-management__print-strip"><button onClick={() => window.print()} type="button" aria-label="打印发票查询结果">▣</button></div>
          <div className="invoice-management__table-wrap">
            <table>
              <thead><tr><th><input aria-label="选择全部发票" disabled type="checkbox" /></th><th>序号</th><th>发票代码</th><th>发票号码</th><th>开票日期</th><th>操作</th></tr></thead>
              <tbody>
                {results.map((invoice, index) => (
                  <tr key={invoice.id}><td><input aria-label={`选择发票 ${invoice.invoiceNumber}`} type="checkbox" /></td><td>{index + 1}</td><td>{invoice.invoiceCode}</td><td>{invoice.invoiceNumber}</td><td>{new Date(invoice.issuedAt).toLocaleString('zh-CN', { hour12: false })}</td><td><div className="invoice-management__actions">{invoice.status === 'issued' ? <button className="invoice-management__red-button" onClick={() => openRedFlush(invoice)} type="button">冲红</button> : null}<button onClick={() => setDetail(invoice)} type="button">详情</button></div></td></tr>
                ))}
                {hasQueried && results.length === 0 ? <tr><td className="settlement-empty" colSpan={6}>无数据</td></tr> : null}
                {!hasQueried ? <tr><td className="settlement-empty" colSpan={6}>设置条件后点击“查询”。</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {detail ? (
        <Modal description={`${invoiceStatusLabel(detail.status)} · ${buyerTypeLabel(detail)} · 价税合计 ${formatCents(detail.totalCents)} 元`} eyebrow="业务详情" title={`${detail.invoiceCode} / ${detail.invoiceNumber}`} wide>
          <div className="modal-form invoice-management__detail">
            <dl><div><dt>购方名称</dt><dd>{detail.buyerName}</dd></div><div><dt>纳税人识别号</dt><dd>{detail.taxpayerId}</dd></div><div><dt>开票员工</dt><dd>{detail.issuedBy.operatorId} {detail.issuedBy.displayName}</dd></div><div><dt>台席</dt><dd>{detail.issuedBy.workstationCode}</dd></div><div><dt>交付状态</dt><dd>{detail.deliveryRequested === null ? '未选择' : detail.deliveryRequested ? '已交付' : '暂不交付'}</dd></div><div><dt>冲红授权</dt><dd>{detail.redFlushAuthorizedBy ?? '—'}</dd></div></dl>
            <div className="invoice-management__table-wrap"><table><thead><tr><th>查询流水号</th><th>业务产品名称</th><th>邮件号码</th><th>付费方式</th><th>商品名称</th><th>数量</th><th>金额</th><th>自贴票金额</th></tr></thead><tbody>{detail.businessLines.map((line, index) => <tr key={`${line.sourceTransactionId}-${index}`}><td>{line.sourceTransactionId}</td><td>{line.productName}</td><td>{line.itemCode || '—'}</td><td>{line.paymentMethod}</td><td>{line.itemName}</td><td>{line.quantity}</td><td>{formatCents(line.amountCents)}</td><td>{formatCents(line.stampAmountCents)}</td></tr>)}</tbody></table></div>
            <div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setDetail(null)} type="button">关闭</button></div>
          </div>
        </Modal>
      ) : null}

      {redFlushTarget ? (
        <Modal description={`发票 ${redFlushTarget.invoiceCode} / ${redFlushTarget.invoiceNumber}`} eyebrow="主管授权" title="授权">
          <div className="modal-form supervisor-form">
            <label><span>主管工号</span><input aria-label="发票冲红主管工号" onChange={(event) => setSupervisorId(event.target.value)} value={supervisorId} /></label>
            <label><span>主管密码</span><input aria-label="发票冲红主管密码" onChange={(event) => setSupervisorSecret(event.target.value)} type="password" value={supervisorSecret} /></label>
            <p className="service-field-hint">由主管本人现场输入工号和密码；系统不显示或代填。</p>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => { setSupervisorId(''); setSupervisorSecret(''); setError('') }} type="button">重置</button>
              <button className="secondary-button" onClick={() => { setRedFlushTarget(null); setError('') }} type="button">取消</button>
              <button className="primary-button primary-button--compact" onClick={() => void confirmRedFlush()} type="button">确认授权</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
