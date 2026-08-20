import { useEffect, useMemo, useState } from 'react'

import {
  calculateServiceCharge,
  destinationZoneLabel,
  formatCents,
  paymentMethodLabel,
  serviceItemCodeRule,
  validateServiceDraft,
} from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import type { FiscalInvoiceRegistrationDraft } from '../../domain/service/invoiceManagement'
import { refundStatusLabel } from '../../domain/service/refundPending'
import { SERVICE_PRODUCTS } from '../../domain/service/seed'
import { DEFAULT_SERVICE_OPERATOR, pendingServiceSummary } from '../../domain/service/transactions'
import { queryServiceTransactions } from '../../domain/service/transactionCorrection'
import type {
  ChargeSummary,
  ServiceCustomerSnapshot,
  ServiceDocumentActionKind,
  ServiceDraft,
  ServicePaymentMethod,
  ServiceOperatorSnapshot,
  ServiceProduct,
  ServiceQueryDataType,
  ServiceQuerySort,
  ServiceRefundRecord,
  ServiceRemark,
  ServiceTransaction,
  ServiceTransactionQuery,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import {
  INTERNATIONAL_DESTINATIONS,
  internationalDestinationLabel,
} from '../../domain/service/international'
import { Modal } from '../../ui/Modal'
import type { ServiceSummary } from './ServiceIntakePanel'
import { ServiceReceiptModal } from './ServiceReceiptModal'
import { ElectronicCommerceQueryWorkspace } from './ElectronicCommerceQueryWorkspace'
import { ChannelProductQueryWorkspace } from './ChannelProductQueryWorkspace'
import { InvoiceRegistrationModal } from '../invoice/InvoiceRegistrationModal'
import { PostalSupplyCorrectionWorkspace } from './PostalSupplyCorrectionWorkspace'
import { SupplementaryTrafficCorrectionWorkspace } from './SupplementaryTrafficCorrectionWorkspace'
import {
  CorrectionWorkspaceTabs,
  type CorrectionWorkspaceKind,
} from './CorrectionWorkspaceTabs'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import type { RequestOnSiteAuthorization } from '../../domain/access/workAuthorization'

interface TransactionQueryWorkspaceProps {
  repository: ServiceRepository
  onBack: () => void
  onSummaryChange: (summary: ServiceSummary) => void
  operator?: ServiceOperatorSnapshot
  initialBusinessDate?: string
  authorizeOnSite: RequestOnSiteAuthorization
}

interface PendingCorrection {
  transactionId: string
  customer: ServiceCustomerSnapshot
  draft: ServiceDraft
  charge: ChargeSummary
  product: ServiceProduct
}

interface DocumentPreview {
  transaction: ServiceTransaction
  kind: ServiceDocumentActionKind
}

function currentBusinessDate(): string {
  return businessCalendarDay(new Date())
}

function createDefaultQuery(businessDate = currentBusinessDate()): ServiceTransactionQuery {
  return {
    querySerial: '',
    productCode: '',
    itemCode: '',
    paymentMethod: '',
    operatorId: '',
    workstationCode: '',
    dataType: 'all',
    acceptedDateFrom: businessDate,
    acceptedDateTo: businessDate,
    settledDateFrom: '',
    settledDateTo: '',
    sort: 'accepted-desc',
  }
}

function summaryFromState(state: ServiceWorkspaceState): ServiceSummary {
  return pendingServiceSummary(state)
}

function statusLabel(transaction: ServiceTransaction): string {
  if (transaction.status === 'settled') return '结算邮件'
  if (transaction.status === 'withdrawn') return '已撤销'
  return '未结算邮件'
}

function remarkLabel(remark: ServiceRemark): string {
  return {
    'ordinary-letter': '平信',
    postcard: '明信片',
    'people-letter': '人民来信',
    'parcel-4': '4元',
    'parcel-6': '6元',
    'parcel-11': '11元',
    document: '文',
    goods: '物',
  }[remark]
}

function documentKindLabel(kind: ServiceDocumentActionKind): string {
  return kind === 'receipt-reprint' ? '邮件收寄单据重打' : '重新开票'
}

function refundRouteLabel(record: ServiceRefundRecord): string {
  return {
    'cash-desk': '现金退款记录',
    'original-payment': '第三方支付原路退款',
    'pos-terminal': 'POS 原终端退回',
    'credit-account': '记欠账户冲销',
  }[record.route]
}

function includesPriceChange(
  previous: ChargeSummary,
  corrected: ChargeSummary,
): boolean {
  return previous.postageCents !== corrected.postageCents ||
    previous.returnReceiptCents !== corrected.returnReceiptCents ||
    previous.settlementDueCents !== corrected.settlementDueCents ||
    previous.stampSaleCents !== corrected.stampSaleCents
}

export function TransactionQueryWorkspace({
  repository,
  onBack,
  onSummaryChange,
  operator = DEFAULT_SERVICE_OPERATOR,
  initialBusinessDate = currentBusinessDate(),
  authorizeOnSite,
}: TransactionQueryWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [activeQueryWorkspace, setActiveQueryWorkspace] = useState<CorrectionWorkspaceKind>('acceptance')
  const [query, setQuery] = useState<ServiceTransactionQuery>(
    () => createDefaultQuery(initialBusinessDate),
  )
  const [expanded, setExpanded] = useState(false)
  const [hasQueried, setHasQueried] = useState(false)
  const [results, setResults] = useState<ServiceTransaction[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<ServiceTransaction | null>(null)
  const [editDraft, setEditDraft] = useState<ServiceDraft | null>(null)
  const [editCustomer, setEditCustomer] = useState<ServiceCustomerSnapshot | null>(null)
  const [editError, setEditError] = useState('')
  const [pendingCorrection, setPendingCorrection] = useState<PendingCorrection | null>(null)
  const [reasonMode, setReasonMode] = useState<'correction' | 'withdrawal' | null>(null)
  const [reason, setReason] = useState('')
  const [withdrawIds, setWithdrawIds] = useState<string[]>([])
  const [supervisorOpen, setSupervisorOpen] = useState(false)
  const [supervisorId, setSupervisorId] = useState('')
  const [supervisorSecret, setSupervisorSecret] = useState('')
  const [refundPreview, setRefundPreview] = useState<ServiceRefundRecord[]>([])
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null)
  const [invoiceChoiceTransaction, setInvoiceChoiceTransaction] = useState<ServiceTransaction | null>(null)
  const [invoiceRegistrationTransaction, setInvoiceRegistrationTransaction] = useState<ServiceTransaction | null>(null)
  const [invoiceDeliveryId, setInvoiceDeliveryId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      onSummaryChange(summaryFromState(loaded))
    })
    return () => {
      active = false
    }
  }, [onSummaryChange, repository])

  const selectedProduct = useMemo(
    () => SERVICE_PRODUCTS.find((product) => product.id === editDraft?.productId) ?? null,
    [editDraft?.productId],
  )
  const editQuote = useMemo(
    () => editDraft && selectedProduct
      ? calculateServiceCharge(editDraft, selectedProduct)
      : null,
    [editDraft, selectedProduct],
  )
  const totalPostageCents = results.reduce(
    (total, transaction) => total + transaction.charge.postageCents,
    0,
  )

  function runQuery(nextWorkspace = workspace): void {
    if (!nextWorkspace) return
    const nextResults = queryServiceTransactions(nextWorkspace, query)
    setResults(nextResults)
    setSelectedIds((current) => current.filter((id) =>
      nextResults.some((transaction) => transaction.id === id),
    ))
    setHasQueried(true)
    setNotice(`查询完成，共 ${nextResults.length} 笔收寄记录。`)
    setError('')
  }

  function updateQuery<K extends keyof ServiceTransactionQuery>(
    field: K,
    value: ServiceTransactionQuery[K],
  ): void {
    setQuery((current) => ({ ...current, [field]: value }))
    setNotice('')
    setError('')
  }

  function resetQuery(): void {
    setQuery(createDefaultQuery(initialBusinessDate))
    setExpanded(false)
    setHasQueried(false)
    setResults([])
    setSelectedIds([])
    setNotice('已恢复当前营业日的默认查询条件。')
    setError('')
  }

  function toggleSelected(transactionId: string): void {
    setSelectedIds((current) => current.includes(transactionId)
      ? current.filter((id) => id !== transactionId)
      : [...current, transactionId])
  }

  function openCorrection(transaction: ServiceTransaction): void {
    if (!SERVICE_PRODUCTS.some((product) => product.id === transaction.service.productId)) {
      setError(`历史产品 ${transaction.product.searchCode} 尚无可验证的查改表单，已保留为只读记录。`)
      return
    }
    setEditing(transaction)
    setEditDraft(structuredClone(transaction.service))
    setEditCustomer(structuredClone(transaction.customer))
    setEditError('')
    setError('')
  }

  function updateEditDraft(patch: Partial<ServiceDraft>): void {
    setEditDraft((current) => current ? { ...current, ...patch } : current)
    setEditError('')
  }

  function updateRecipient(
    field: 'contact' | 'name' | 'detailedAddress' | 'postalCode' | 'unit',
    value: string,
  ): void {
    setEditCustomer((current) => current ? {
      ...current,
      recipient: { ...current.recipient, [field]: value },
    } : current)
    setEditError('')
  }

  function prepareCorrection(): void {
    if (!editing || !editDraft || !editCustomer || !selectedProduct || !editQuote) return
    const validation = validateServiceDraft(
      editDraft,
      SERVICE_PRODUCTS,
      Boolean(editCustomer.sender.agreementAccountId),
    )
    if (!validation.valid) {
      setEditError(Object.values(validation.errors)[0] ?? '请检查查改字段。')
      return
    }
    if (
      selectedProduct.requiresRecipient &&
      (!editCustomer.recipient.contact.trim() ||
        !editCustomer.recipient.name.trim() ||
        !editCustomer.recipient.detailedAddress.trim())
    ) {
      setEditError('当前业务必须保留完整的收件联系电话、姓名和详细地址。')
      return
    }
    if (editing.status === 'settled' && includesPriceChange(editing.charge, editQuote)) {
      setEditError('已结算邮件暂不允许修改影响资费或结算金额的字段。')
      return
    }
    setPendingCorrection({
      transactionId: editing.id,
      customer: structuredClone(editCustomer),
      draft: structuredClone(editDraft),
      charge: structuredClone(editQuote),
      product: selectedProduct,
    })
    setEditing(null)
    setReason('')
    setReasonMode('correction')
  }

  async function commitCorrection(): Promise<void> {
    if (!pendingCorrection || !reason.trim()) {
      setError('请输入修改邮件原因。')
      return
    }
    try {
      const revised = await repository.revise({
        ...pendingCorrection,
        correctedAt: new Date().toISOString(),
        operator,
        reason,
      })
      setWorkspace(revised.state)
      setPendingCorrection(null)
      setReasonMode(null)
      setReason('')
      runQuery(revised.state)
      setNotice(`查改成功：${revised.transaction.id}，修改记录 ${revised.correction.id} 已保存。`)
      onSummaryChange(summaryFromState(revised.state))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '查改保存失败。')
    }
  }

  function prepareWithdrawal(ids: string[]): void {
    if (ids.length === 0) {
      setError('请选择需要删除的收寄记录。')
      return
    }
    setWithdrawIds(ids)
    setReason('')
    setReasonMode('withdrawal')
    setError('')
  }

  function prepareQuerySerialWithdrawal(): void {
    if (!hasQueried || !query.querySerial.trim()) {
      setError('请先输入批次查询流水号并完成查询。')
      return
    }
    prepareWithdrawal(
      results
        .filter((transaction) => transaction.status !== 'withdrawn')
        .map((transaction) => transaction.id),
    )
  }

  function continueWithdrawal(): void {
    if (!reason.trim()) {
      setError('请输入修改邮件原因。')
      return
    }
    setReasonMode(null)
    setSupervisorId('')
    setSupervisorSecret('')
    setSupervisorOpen(true)
    setError('')
  }

  async function authorizeWithdrawal(): Promise<void> {
    try {
      const withdrawnAt = new Date().toISOString()
      const authorization = await authorizeOnSite(
        'withdraw-service-transaction',
        supervisorId,
        supervisorSecret,
        withdrawnAt,
      )
      const withdrawn = await repository.withdraw({
        transactionIds: withdrawIds,
        withdrawnAt,
        operator,
        reason,
        authorization,
      })
      setWorkspace(withdrawn.state)
      setSupervisorOpen(false)
      setWithdrawIds([])
      setSelectedIds([])
      setReason('')
      runQuery(withdrawn.state)
      setNotice(`删除成功，${withdrawn.withdrawals.length} 笔收寄记录已完成主管授权。`)
      setRefundPreview(withdrawn.refunds)
      onSummaryChange(summaryFromState(withdrawn.state))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '主管授权失败。')
    }
  }

  async function recordDocument(
    transaction: ServiceTransaction,
    kind: ServiceDocumentActionKind,
  ): Promise<void> {
    try {
      const recorded = await repository.recordDocumentAction({
        transactionId: transaction.id,
        kind,
        requestedAt: new Date().toISOString(),
      })
      setWorkspace(recorded.state)
      setDocumentPreview({ transaction, kind })
      setNotice(`${documentKindLabel(kind)}动作 ${recorded.action.id} 已登记。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '单据动作登记失败。')
    }
  }

  function openInvoice(transaction: ServiceTransaction): void {
    if (!workspace || transaction.status !== 'settled' || !transaction.settlementId) {
      setError('只有已结算业务可以补开发票。')
      return
    }
    const existing = workspace.fiscalInvoices.find((invoice) =>
      invoice.sourceKind === 'settlement' && invoice.sourceId === transaction.settlementId,
    )
    if (existing) {
      setNotice(`结算单 ${transaction.settlementId} 已开具发票 ${existing.invoiceCode} / ${existing.invoiceNumber}。`)
      setError('')
      return
    }
    setInvoiceChoiceTransaction(transaction)
    setError('')
  }

  async function declineSupplementalInvoice(): Promise<void> {
    if (!invoiceChoiceTransaction?.settlementId || !workspace) return
    const settlement = workspace.settlements.find(
      (candidate) => candidate.id === invoiceChoiceTransaction.settlementId,
    )
    if (settlement?.invoiceRequested === null) {
      const next = await repository.recordInvoiceDecision(settlement.id, false)
      setWorkspace(next)
    }
    setInvoiceChoiceTransaction(null)
    setNotice('已登记“不需要发票”。')
  }

  async function issueSupplementalInvoice(
    draft: FiscalInvoiceRegistrationDraft,
  ): Promise<void> {
    if (!invoiceRegistrationTransaction?.settlementId) return
    const result = await repository.executeInvoiceManagement({
      type: 'issue-settlement-invoice',
      settlementId: invoiceRegistrationTransaction.settlementId,
      issuedAt: new Date().toISOString(),
      operator,
      registration: draft,
    })
    setWorkspace(result.state)
    setInvoiceRegistrationTransaction(null)
    setInvoiceDeliveryId(result.invoice.id)
    runQuery(result.state)
  }

  async function decideSupplementalDelivery(requested: boolean): Promise<void> {
    if (!invoiceDeliveryId) return
    try {
      const result = await repository.executeInvoiceManagement({
        type: 'record-invoice-delivery',
        invoiceId: invoiceDeliveryId,
        requested,
        decidedAt: new Date().toISOString(),
      })
      setWorkspace(result.state)
      setInvoiceDeliveryId(null)
      setNotice(requested ? '开票成功，发票已完成交付。' : '开票成功，暂不进行发票交付。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发票交付选择记录失败。')
    }
  }

  function exportResults(): void {
    if (results.length === 0) {
      setError('当前没有可导出的查询结果。')
      return
    }
    const rows = [
      ['查询流水号', '业务产品', '最终业务码', '邮件号码', '数据类型', '重量(g)', '总资费(元)', '付费方式', '收寄时间'],
      ...results.map((transaction) => [
        transaction.sourceBatchId ?? transaction.id,
        `${transaction.product.label}(${transaction.product.searchCode})`,
        transaction.product.effectiveBusinessCode,
        transaction.service.itemCode,
        statusLabel(transaction),
        String(transaction.service.weightGrams ?? ''),
        formatCents(transaction.charge.postageCents),
        paymentMethodLabel(transaction.service.paymentMethod),
        transaction.acceptedAt,
      ]),
    ]
    const csv = `\uFEFF${rows.map((row) => row.map((cell) =>
      `"${String(cell).replaceAll('"', '""')}"`,
    ).join(',')).join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `acceptance-query-${currentBusinessDate()}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice(`已导出 ${results.length} 笔脱敏演示查询结果。`)
  }

  if (activeQueryWorkspace === 'electronic-commerce') {
    return (
      <ElectronicCommerceQueryWorkspace
        onBack={onBack}
        onOpenAcceptanceQuery={() => setActiveQueryWorkspace('acceptance')}
        onOpenChannelProductQuery={() => setActiveQueryWorkspace('channel-products')}
        onSelectWorkspace={setActiveQueryWorkspace}
        onSummaryChange={onSummaryChange}
        repository={repository}
      />
    )
  }

  if (activeQueryWorkspace === 'channel-products') {
    return (
      <ChannelProductQueryWorkspace
        authorizeOnSite={authorizeOnSite}
        onBack={onBack}
        onOpenAcceptanceQuery={() => setActiveQueryWorkspace('acceptance')}
        onOpenElectronicCommerceQuery={() => setActiveQueryWorkspace('electronic-commerce')}
        onSelectWorkspace={setActiveQueryWorkspace}
        onSummaryChange={onSummaryChange}
        operator={operator}
        repository={repository}
      />
    )
  }

  if (activeQueryWorkspace === 'postal-supplies') {
    return (
      <PostalSupplyCorrectionWorkspace
        authorizeOnSite={authorizeOnSite}
        onBack={onBack}
        onSelectWorkspace={setActiveQueryWorkspace}
        onSummaryChange={onSummaryChange}
        operator={operator}
        repository={repository}
      />
    )
  }

  if (activeQueryWorkspace === 'supplementary-traffic') {
    return (
      <SupplementaryTrafficCorrectionWorkspace
        authorizeOnSite={authorizeOnSite}
        onBack={onBack}
        onSelectWorkspace={setActiveQueryWorkspace}
        onSummaryChange={onSummaryChange}
        operator={operator}
        repository={repository}
      />
    )
  }

  if (!workspace) {
    return <section className="transaction-query transaction-query--loading">正在读取收寄查改数据…</section>
  }

  return (
    <>
      <div className="transaction-query">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业工作台</button>
          <span>/</span>
          <span>查改处理</span>
          <span>/</span>
          <strong>收寄查改</strong>
        </div>

        <CorrectionWorkspaceTabs active="acceptance" onSelect={setActiveQueryWorkspace} />

        <section aria-label="收寄查改查询条件" className="correction-query-panel">
          <div className="correction-query-grid">
            <label>
              <span>查询流水号</span>
              <input
                aria-label="查询流水号"
                onChange={(event) => updateQuery('querySerial', event.target.value)}
                placeholder="请输入流水号"
                value={query.querySerial}
              />
            </label>
            <label>
              <span>业务产品</span>
              <select
                aria-label="查询业务产品"
                onChange={(event) => updateQuery('productCode', event.target.value)}
                value={query.productCode}
              >
                <option value="">全部业务产品</option>
                {SERVICE_PRODUCTS.map((product) => (
                  <option key={product.id} value={product.searchCode}>
                    {product.label}（{product.searchCode}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>邮件号码</span>
              <input
                aria-label="查询邮件号码"
                onChange={(event) => updateQuery('itemCode', event.target.value)}
                placeholder="请输入邮件号码"
                value={query.itemCode}
              />
            </label>
            <label>
              <span>付费方式</span>
              <select
                aria-label="查询付费方式"
                onChange={(event) => updateQuery(
                  'paymentMethod',
                  event.target.value as ServicePaymentMethod | '',
                )}
                value={query.paymentMethod}
              >
                <option value="">全部付费方式</option>
                <option value="cash-settlement">现结</option>
                <option value="stamp">贴票</option>
                <option value="self-affixed">自贴票</option>
                <option value="credit">记欠</option>
              </select>
            </label>
            <label>
              <span>收寄员工</span>
              <input
                aria-label="收寄员工"
                onChange={(event) => updateQuery('operatorId', event.target.value)}
                placeholder="请输入演示工号"
                value={query.operatorId}
              />
            </label>
            <label>
              <span>台席</span>
              <input
                aria-label="查询台席"
                onChange={(event) => updateQuery('workstationCode', event.target.value)}
                placeholder="请输入台席"
                value={query.workstationCode}
              />
            </label>
            <label className="correction-date-range">
              <span>查询日期</span>
              <span>
                <input
                  aria-label="查询日期起"
                  onChange={(event) => updateQuery('acceptedDateFrom', event.target.value)}
                  type="date"
                  value={query.acceptedDateFrom}
                />
                <b>至</b>
                <input
                  aria-label="查询日期止"
                  onChange={(event) => updateQuery('acceptedDateTo', event.target.value)}
                  type="date"
                  value={query.acceptedDateTo}
                />
              </span>
            </label>
          </div>

          {expanded ? (
            <div className="correction-query-grid correction-query-grid--expanded">
              <label>
                <span>排序类型</span>
                <select
                  aria-label="排序类型"
                  onChange={(event) => updateQuery('sort', event.target.value as ServiceQuerySort)}
                  value={query.sort}
                >
                  <option value="accepted-desc">收寄时间倒序</option>
                  <option value="accepted-asc">收寄时间正序</option>
                </select>
              </label>
              <label>
                <span>数据类型</span>
                <select
                  aria-label="数据类型"
                  onChange={(event) => updateQuery('dataType', event.target.value as ServiceQueryDataType)}
                  value={query.dataType}
                >
                  <option value="all">所有邮件</option>
                  <option value="pending-settlement">未结算邮件</option>
                  <option value="settled">结算邮件</option>
                  <option value="withdrawn">已撤销（演示审计）</option>
                </select>
              </label>
              <label className="correction-date-range">
                <span>入账日期</span>
                <span>
                  <input
                    aria-label="入账日期起"
                    onChange={(event) => updateQuery('settledDateFrom', event.target.value)}
                    type="date"
                    value={query.settledDateFrom}
                  />
                  <b>至</b>
                  <input
                    aria-label="入账日期止"
                    onChange={(event) => updateQuery('settledDateTo', event.target.value)}
                    type="date"
                    value={query.settledDateTo}
                  />
                </span>
              </label>
            </div>
          ) : null}

          <div className="correction-query-actions">
            <button className="query-action query-action--primary" onClick={() => runQuery()} type="button">查询</button>
            <button className="query-action query-action--danger" onClick={() => prepareWithdrawal(selectedIds)} type="button">删除</button>
            <button className="query-action query-action--danger" onClick={prepareQuerySerialWithdrawal} type="button">按查询流水号删除</button>
            <button className="query-action" onClick={exportResults} type="button">导出</button>
            <button className="query-action query-action--outline" onClick={resetQuery} type="button">重置</button>
            <button
              aria-expanded={expanded}
              className="correction-expand"
              onClick={() => setExpanded((current) => !current)}
              type="button"
            >
              {expanded ? '隐藏条件' : '展开条件'}
            </button>
          </div>
        </section>

        {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}

        <section aria-labelledby="correction-results-title" className="correction-results">
          <div className="correction-results__summary">
            <h1 id="correction-results-title">收寄查改结果</h1>
            <div><span>总件数</span><strong>{results.length}</strong><span>总金额</span><strong>¥ {formatCents(totalPostageCents)}</strong></div>
          </div>
          <div className="correction-table-wrap">
            <table className="correction-table">
              <thead>
                <tr>
                  <th>选择</th>
                  <th>序号</th>
                  <th>查询流水号</th>
                  <th>业务产品</th>
                  <th>邮件号码</th>
                  <th>寄达局</th>
                  <th>接收局名</th>
                  <th>重量(g)</th>
                  <th>总资费</th>
                  <th>付费方式</th>
                  <th>数据类型</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {results.map((transaction, index) => (
                  <tr key={transaction.id}>
                    <td>
                      <input
                        aria-label={`选择查改记录 ${transaction.id}`}
                        checked={selectedIds.includes(transaction.id)}
                        disabled={transaction.status === 'withdrawn'}
                        onChange={() => toggleSelected(transaction.id)}
                        type="checkbox"
                      />
                    </td>
                    <td>{index + 1}</td>
                    <td>{transaction.sourceBatchId ?? transaction.id}</td>
                    <td>
                      {transaction.product.label}（{transaction.product.searchCode}）
                      <small>业务 {transaction.product.effectiveBusinessCode}</small>
                    </td>
                    <td>{transaction.service.itemCode || '—'}</td>
                    <td>{transaction.service.destinationOffice
                      ? internationalDestinationLabel(transaction.service.destinationOffice)
                      : destinationZoneLabel(transaction.service.destinationZone)}</td>
                    <td>{transaction.operator.receivingOffice}</td>
                    <td>{transaction.service.weightGrams}</td>
                    <td>¥ {formatCents(transaction.charge.postageCents)}</td>
                    <td>{paymentMethodLabel(transaction.service.paymentMethod)}</td>
                    <td><span className={`query-status query-status--${transaction.status}`}>{statusLabel(transaction)}</span></td>
                    <td>
                      <div className="correction-row-actions">
                        <button disabled={transaction.status === 'withdrawn'} onClick={() => openCorrection(transaction)} type="button">查改</button>
                        <button disabled={transaction.status === 'withdrawn'} onClick={() => prepareWithdrawal([transaction.id])} type="button">删除</button>
                        <button disabled={transaction.status === 'withdrawn'} onClick={() => void recordDocument(transaction, 'receipt-reprint')} type="button">重打</button>
                        <button disabled={transaction.status !== 'settled'} onClick={() => openInvoice(transaction)} type="button">{workspace?.fiscalInvoices.some((invoice) => invoice.sourceKind === 'settlement' && invoice.sourceId === transaction.settlementId) ? '已开票' : '开票'}</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {hasQueried && results.length === 0 ? (
                  <tr><td className="settlement-empty" colSpan={12}>没有符合查询条件的收寄记录。</td></tr>
                ) : null}
                {!hasQueried ? (
                  <tr><td className="settlement-empty" colSpan={12}>设置条件后点击“查询”。</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {editing && editDraft && editCustomer && selectedProduct && editQuote ? (
        <Modal
          description="重新打开原收寄信息。修改后先重新计费，再提交修改原因。"
          eyebrow="收寄查改"
          title={`查改 ${editing.id}`}
          wide
        >
          <div className="modal-form correction-edit-form">
            <div className="correction-edit-summary">
              <span>业务产品</span>
              <strong>{selectedProduct.label}</strong>
              <span>数据类型</span>
              <strong>{statusLabel(editing)}</strong>
            </div>
            <fieldset>
              <legend>收件人信息</legend>
              <label><span>联系电话</span><input aria-label="查改收件联系电话" onChange={(event) => updateRecipient('contact', event.target.value)} value={editCustomer.recipient.contact} /></label>
              <label><span>姓名</span><input aria-label="查改收件人姓名" onChange={(event) => updateRecipient('name', event.target.value)} value={editCustomer.recipient.name} /></label>
              <label className="correction-edit-wide"><span>详细地址</span><input aria-label="查改收件详细地址" onChange={(event) => updateRecipient('detailedAddress', event.target.value)} value={editCustomer.recipient.detailedAddress} /></label>
              <label><span>邮编</span><input aria-label="查改收件邮编" onChange={(event) => updateRecipient('postalCode', event.target.value)} value={editCustomer.recipient.postalCode} /></label>
              <label><span>单位</span><input aria-label="查改收件单位" onChange={(event) => updateRecipient('unit', event.target.value)} value={editCustomer.recipient.unit} /></label>
            </fieldset>
            <fieldset>
              <legend>邮件信息</legend>
              {serviceItemCodeRule(selectedProduct, editDraft.destinationZone) !== 'none' ? (
                <label><span>邮件号码</span><input aria-label="查改邮件号码" onChange={(event) => updateEditDraft({ itemCode: event.target.value.toUpperCase() })} value={editDraft.itemCode} /></label>
              ) : null}
              {editDraft.destinationZone === 'international' ? (
                <label>
                  <span>国际寄达局</span>
                  <select aria-label="查改国际寄达局" onChange={(event) => updateEditDraft({ destinationOffice: event.target.value })} value={editDraft.destinationOffice}>
                    <option value="">请选择目标国家或地区</option>
                    {INTERNATIONAL_DESTINATIONS.map((destination) => (
                      <option key={destination.code} value={destination.code}>{destination.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {selectedProduct.remarkOptions.length > 0 ? (
                <label>
                  <span>邮件备注</span>
                  <select aria-label="查改邮件备注" onChange={(event) => updateEditDraft({ remark: event.target.value as ServiceRemark })} value={editDraft.remark}>
                    {selectedProduct.remarkOptions.map((remark) => <option key={remark} value={remark}>{remarkLabel(remark)}</option>)}
                  </select>
                </label>
              ) : null}
              <label><span>重量（克）</span><input aria-label="查改邮件重量" min={1} onChange={(event) => updateEditDraft({ weightGrams: Number(event.target.value) || null })} type="number" value={editDraft.weightGrams ?? ''} /></label>
              <label>
                <span>付费方式</span>
                <select aria-label="查改付费方式" onChange={(event) => updateEditDraft({ paymentMethod: event.target.value as ServicePaymentMethod, stampAmountCents: null })} value={editDraft.paymentMethod}>
                  <option value="cash-settlement">现结</option>
                  <option value="stamp">贴票</option>
                  <option value="self-affixed">自贴票</option>
                  {editCustomer.sender.agreementAccountId ? <option value="credit">记欠</option> : null}
                </select>
              </label>
              <label className="correction-edit-wide"><span>办理备注</span><input aria-label="查改办理备注" onChange={(event) => updateEditDraft({ operatorNote: event.target.value })} value={editDraft.operatorNote} /></label>
            </fieldset>
            <div className="correction-edit-charge">
              <span>重新计费</span>
              <strong>总资费 ¥ {formatCents(editQuote.postageCents)}</strong>
              <strong>结算应收 ¥ {formatCents(editQuote.settlementDueCents)}</strong>
            </div>
            {editError ? <p className="customer-form-error" role="alert">{editError}</p> : null}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setEditing(null)} type="button">取消</button>
              <button className="primary-button primary-button--compact" onClick={prepareCorrection} type="button">计费并提交修改</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {reasonMode ? (
        <Modal
          description={reasonMode === 'correction' ? '修改记录必须说明原因。' : `将删除 ${withdrawIds.length} 笔收寄记录。`}
          eyebrow="查改说明"
          title="请输入修改邮件原因"
        >
          <div className="modal-form correction-reason-form">
            <textarea aria-label="修改邮件原因" autoFocus onChange={(event) => { setReason(event.target.value); setError('') }} value={reason} />
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => { setReasonMode(null); setPendingCorrection(null); setWithdrawIds([]); setReason(''); setError('') }} type="button">取消</button>
              <button className="primary-button primary-button--compact" onClick={reasonMode === 'correction' ? () => void commitCorrection() : continueWithdrawal} type="button">确定</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {supervisorOpen ? (
        <Modal
          description="删除收寄记录必须经过本地虚构主管授权。"
          eyebrow="主管授权"
          title="请输入主管工号和密码"
        >
          <div className="modal-form supervisor-form">
            <label><span>主管工号</span><input aria-label="主管工号" onChange={(event) => setSupervisorId(event.target.value)} value={supervisorId} /></label>
            <label><span>主管密码</span><input aria-label="主管密码" onChange={(event) => setSupervisorSecret(event.target.value)} type="password" value={supervisorSecret} /></label>
            <p className="service-field-hint">由主管本人现场输入工号和密码；系统不显示或代填。</p>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => { setSupervisorOpen(false); setWithdrawIds([]); setReason(''); setError('') }} type="button">取消</button>
              <button className="primary-button primary-button--compact" onClick={() => void authorizeWithdrawal()} type="button">授权并删除</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {refundPreview.length > 0 ? (
        <Modal
          description="主管授权成功后生成本地退款待办；第三方支付仍需到“退款待办查询”发起申请并执行退款。"
          eyebrow="退款记录"
          title="退款记录"
          wide
        >
          <div className="modal-form refund-preview">
            <table>
              <thead><tr><th>序号</th><th>流水号</th><th>件数</th><th>退款金额</th><th>退款方式</th><th>状态</th></tr></thead>
              <tbody>{refundPreview.map((refund, index) => <tr key={refund.id}><td>{index + 1}</td><td>{refund.transactionId}</td><td>1</td><td>¥ {formatCents(refund.amountCents)}</td><td>{refundRouteLabel(refund)}</td><td>{refundStatusLabel(refund.status)}</td></tr>)}</tbody>
            </table>
            <div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setRefundPreview([])} type="button">确认</button></div>
          </div>
        </Modal>
      ) : null}

      {documentPreview?.kind === 'receipt-reprint' ? (
        <ServiceReceiptModal
          mode="reprint"
          onClose={() => setDocumentPreview(null)}
          transaction={documentPreview.transaction}
        />
      ) : null}

      {invoiceChoiceTransaction ? (
        <Modal description={`结算单 ${invoiceChoiceTransaction.settlementId}`} eyebrow="信息" title="是否需要开具发票？">
          <div className="modal-form invoice-choice"><p>请选择是否为该已结算业务补开发票。</p><div className="modal-actions"><button className="secondary-button" onClick={() => void declineSupplementalInvoice()} type="button">不需要</button><button className="primary-button primary-button--compact" onClick={() => { setInvoiceRegistrationTransaction(invoiceChoiceTransaction); setInvoiceChoiceTransaction(null) }} type="button">需要</button></div></div>
        </Modal>
      ) : null}

      {invoiceRegistrationTransaction?.settlementId && workspace ? (
        <InvoiceRegistrationModal
          amountCents={workspace.settlements.find((settlement) => settlement.id === invoiceRegistrationTransaction.settlementId)?.amountDueCents ?? invoiceRegistrationTransaction.charge.settlementDueCents}
          defaults={{ buyerType: invoiceRegistrationTransaction.customer.sender.unit ? 'organization' : 'individual', buyerName: invoiceRegistrationTransaction.customer.sender.unit || invoiceRegistrationTransaction.customer.sender.name, taxpayerId: invoiceRegistrationTransaction.customer.sender.identityValue, deliveryPhone: invoiceRegistrationTransaction.customer.sender.contact, buyerPhone: invoiceRegistrationTransaction.customer.sender.contact, deliveryEmail: '', buyerAddress: invoiceRegistrationTransaction.customer.sender.detailedAddress, bankName: '', bankAccount: '', reviewer: operator.displayName, remark: '' }}
          onClose={() => setInvoiceRegistrationTransaction(null)}
          onSubmit={issueSupplementalInvoice}
          sourceLabel={`结算单 ${invoiceRegistrationTransaction.settlementId}`}
        />
      ) : null}

      {invoiceDeliveryId ? (
        <Modal description="电子发票登记完成。" eyebrow="信息" title="是否进行发票交付？">
          <div className="modal-form invoice-choice"><p>请选择是否立即完成本次发票交付。</p><div className="modal-actions"><button className="secondary-button" onClick={() => void decideSupplementalDelivery(false)} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void decideSupplementalDelivery(true)} type="button">确定</button></div></div>
        </Modal>
      ) : null}
    </>
  )
}
