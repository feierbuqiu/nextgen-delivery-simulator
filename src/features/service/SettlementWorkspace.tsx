import { useEffect, useMemo, useState } from 'react'

import {
  destinationZoneLabel,
  formatCents,
  paymentMethodLabel,
} from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import { DEFAULT_SERVICE_OPERATOR, pendingServiceSummary } from '../../domain/service/transactions'
import type { FiscalInvoiceRegistrationDraft } from '../../domain/service/invoiceManagement'
import { channelProductFulfillmentSummary } from '../../domain/service/channelProductSales'
import {
  supplementaryTrafficKindLabel,
  trafficRemarkLabel,
} from '../../domain/service/supplementaryTraffic'
import {
  electronicCommerceStatusLabel,
  maskElectronicCommerceAccount,
} from '../../domain/service/electronicCommerce'
import type {
  ChannelProductOrder,
  ElectronicCommerceRecord,
  PostalSupplySale,
  ServiceTransaction,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
  SettlementTender,
  SupplementaryTrafficRecord,
} from '../../domain/service/types'
import { CurrencyInput } from '../../ui/CurrencyInput'
import { Modal } from '../../ui/Modal'
import { InvoiceRegistrationModal } from '../invoice/InvoiceRegistrationModal'
import type { ServiceSummary } from './ServiceIntakePanel'

interface SettlementWorkspaceProps {
  repository: ServiceRepository
  onBack: () => void
  onSummaryChange: (summary: ServiceSummary) => void
  operator?: ServiceOperatorSnapshot
}

type SettlementQueueItem =
  | { kind: 'mail'; transaction: ServiceTransaction }
  | { kind: 'postal-supplies'; sale: PostalSupplySale }
  | { kind: 'channel-products'; order: ChannelProductOrder }
  | { kind: 'supplementary-traffic'; record: SupplementaryTrafficRecord }
  | { kind: 'electronic-commerce'; record: ElectronicCommerceRecord }

function queueItemId(item: SettlementQueueItem): string {
  if (item.kind === 'mail') return item.transaction.id
  if (item.kind === 'postal-supplies') return item.sale.id
  if (item.kind === 'channel-products') return item.order.id
  if (item.kind === 'electronic-commerce') return item.record.id
  return item.record.id
}

function queueItemDue(item: SettlementQueueItem): number {
  if (item.kind === 'mail') return item.transaction.charge.settlementDueCents
  if (item.kind === 'postal-supplies') return item.sale.totalCents
  if (item.kind === 'channel-products') return item.order.totalCents
  if (item.kind === 'electronic-commerce') return item.record.amountCents
  return item.record.amountCents
}

function queueItemTotal(item: SettlementQueueItem): number {
  if (item.kind === 'mail') return item.transaction.charge.postageCents
  if (item.kind === 'postal-supplies') return item.sale.totalCents
  if (item.kind === 'channel-products') return item.order.totalCents
  if (item.kind === 'electronic-commerce') return item.record.amountCents
  return item.record.amountCents
}

function queueItemAcceptedAt(item: SettlementQueueItem): string {
  if (item.kind === 'mail') return item.transaction.acceptedAt
  if (item.kind === 'postal-supplies') return item.sale.acceptedAt
  if (item.kind === 'channel-products') return item.order.submittedAt
  if (item.kind === 'electronic-commerce') return item.record.acceptedAt
  return item.record.acceptedAt
}

function queueItems(
  state: ServiceWorkspaceState,
  status: 'pending-settlement' | 'settled',
): SettlementQueueItem[] {
  return [
    ...state.transactions
      .filter((transaction) =>
        transaction.status === status &&
        transaction.source !== 'self-service-import',
      )
      .map((transaction): SettlementQueueItem => ({ kind: 'mail', transaction })),
    ...state.postalSupplySales
      .filter((sale) => sale.status === status)
      .map((sale): SettlementQueueItem => ({ kind: 'postal-supplies', sale })),
    ...state.channelProductOrders
      .filter((order) => order.status === status)
      .map((order): SettlementQueueItem => ({ kind: 'channel-products', order })),
    ...state.supplementaryTrafficRecords
      .filter((record) => record.status === status)
      .map((record): SettlementQueueItem => ({ kind: 'supplementary-traffic', record })),
    ...state.electronicCommerceRecords
      .filter((record) => record.status === status)
      .map((record): SettlementQueueItem => ({ kind: 'electronic-commerce', record })),
  ].sort((left, right) => {
    return queueItemAcceptedAt(left).localeCompare(queueItemAcceptedAt(right))
  })
}

function tenderLabel(tender: SettlementTender): string {
  return {
    cash: '现金',
    'third-party': '第三方支付',
    pos: 'POS 支付',
    credit: '记欠',
  }[tender]
}

function queueItemPaymentMethod(item: SettlementQueueItem): string {
  if (item.kind === 'mail') return paymentMethodLabel(item.transaction.service.paymentMethod)
  if (item.kind === 'supplementary-traffic') return paymentMethodLabel(item.record.paymentMethod)
  if (item.kind === 'electronic-commerce') return '现结'
  return '现结'
}

function queueItemRequiresCredit(item: SettlementQueueItem): boolean {
  if (item.kind === 'mail') return item.transaction.service.paymentMethod === 'credit'
  if (item.kind === 'supplementary-traffic') return item.record.paymentMethod === 'credit'
  return false
}

function eligibleSettlementItems(
  items: SettlementQueueItem[],
  tender: SettlementTender,
): SettlementQueueItem[] {
  return items.filter((item) => (
    tender === 'credit' ? queueItemRequiresCredit(item) : !queueItemRequiresCredit(item)
  ))
}

function queueItemDestination(item: SettlementQueueItem): string {
  if (item.kind === 'mail') return destinationZoneLabel(item.transaction.service.destinationZone)
  if (item.kind === 'supplementary-traffic' && item.record.kind !== 'supplementary-income') {
    return destinationZoneLabel(item.record.mail.destinationZone)
  }
  return '—'
}

function SupplementaryTrafficDetail({ record }: { record: SupplementaryTrafficRecord }) {
  return (
    <div className="supplementary-settlement-detail">
      <dl>
        <div><dt>业务</dt><dd>{supplementaryTrafficKindLabel(record.kind)}</dd></div>
        <div><dt>客户标志</dt><dd>{record.customerKind === 'agreement' ? '大宗' : '零星'}</dd></div>
        <div><dt>用户名称</dt><dd>{record.customerName}</dd></div>
        <div><dt>付费方式</dt><dd>{paymentMethodLabel(record.paymentMethod)}</dd></div>
        {record.kind === 'supplementary-income' ? (
          <>
            <div><dt>补录科目</dt><dd>{record.subjectLabel}</dd></div>
            <div><dt>统计单元 ID</dt><dd>{record.subjectCode}</dd></div>
            <div><dt>件／笔数</dt><dd>{record.count}</dd></div>
            <div><dt>收寄方式</dt><dd>窗口</dd></div>
          </>
        ) : (
          <>
            <div><dt>业务产品</dt><dd>{record.mail.productLabel}（{record.mail.productSearchCode}）</dd></div>
            <div><dt>最终业务码</dt><dd>{record.mail.effectiveBusinessCode}</dd></div>
            <div><dt>邮件号码</dt><dd>{record.mail.mailNumber}</dd></div>
            <div><dt>区域</dt><dd>{destinationZoneLabel(record.mail.destinationZone)}</dd></div>
            <div><dt>邮件备注</dt><dd>{trafficRemarkLabel(record.mail.remark)}</dd></div>
            <div><dt>收件人</dt><dd>{record.mail.recipientName}</dd></div>
            <div><dt>收件地址</dt><dd>{record.mail.recipientAddress}</dd></div>
            <div><dt>重量</dt><dd>{record.mail.weightGrams} 克</dd></div>
            <div><dt>工本费</dt><dd>¥ {formatCents(record.productionFeeCents)}</dd></div>
            {record.kind === 'single-journey-payment' ? (
              <div><dt>到付邮费</dt><dd>¥ {formatCents(record.collectOnDeliveryCents)}</dd></div>
            ) : null}
          </>
        )}
        <div className="review-total"><dt>结算应收</dt><dd>¥ {formatCents(record.amountCents)}</dd></div>
      </dl>
    </div>
  )
}

function ElectronicCommerceDetail({ record }: { record: ElectronicCommerceRecord }) {
  return (
    <div className="supplementary-settlement-detail">
      <dl>
        <div><dt>业务</dt><dd>{record.kind === 'utility-payment' ? '生活缴费' : '话费充值'}</dd></div>
        <div><dt>缴费充值项目</dt><dd>{record.projectLabel}</dd></div>
        <div><dt>缴费单位</dt><dd>{record.providerLabel}</dd></div>
        <div><dt>缴费账号</dt><dd>{maskElectronicCommerceAccount(record.accountNumber)}</dd></div>
        <div><dt>用户户名</dt><dd>{record.customerName}</dd></div>
        <div><dt>用户地址</dt><dd>{record.customerAddress}</dd></div>
        {record.kind === 'utility-payment' ? (
          <div><dt>应缴总额</dt><dd>¥ {formatCents(record.dueAmountCents)}</dd></div>
        ) : (
          <div><dt>充值前余额</dt><dd>¥ {formatCents(record.accountBalanceBeforeCents)}</dd></div>
        )}
        <div><dt>缴费状态</dt><dd>{electronicCommerceStatusLabel(record.status)}</dd></div>
        <div className="review-total"><dt>结算应收</dt><dd>¥ {formatCents(record.amountCents)}</dd></div>
      </dl>
    </div>
  )
}

export function SettlementWorkspace({
  repository,
  onBack,
  onSummaryChange,
  operator = DEFAULT_SERVICE_OPERATOR,
}: SettlementWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [tender, setTender] = useState<SettlementTender>('cash')
  const [receivedCents, setReceivedCents] = useState<number | null>(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [detail, setDetail] = useState<SettlementQueueItem | null>(null)
  const [invoiceSettlementId, setInvoiceSettlementId] = useState<string | null>(null)
  const [invoiceRegistrationSettlementId, setInvoiceRegistrationSettlementId] = useState<string | null>(null)
  const [invoiceDeliveryId, setInvoiceDeliveryId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      const loadedPending = queueItems(loaded, 'pending-settlement')
      const defaultTender: SettlementTender = loadedPending.some(
        (item) => !queueItemRequiresCredit(item),
      ) ? 'cash' : 'credit'
      const defaultItems = eligibleSettlementItems(loadedPending, defaultTender)
      setTender(defaultTender)
      setSelectedIds(defaultItems.map(queueItemId))
      setReceivedCents(defaultTender === 'credit' ? 0 : defaultItems.reduce(
        (total, item) => total + queueItemDue(item),
        0,
      ))
      const registrationPending = [...loaded.settlements].reverse().find(
        (settlement) => settlement.invoiceRequested === true &&
          !loaded.fiscalInvoices.some((invoice) =>
            invoice.sourceKind === 'settlement' && invoice.sourceId === settlement.id,
          ),
      )
      setInvoiceRegistrationSettlementId(registrationPending?.id ?? null)
      setInvoiceSettlementId(registrationPending ? null : (
        [...loaded.settlements].reverse().find(
          (settlement) => settlement.invoiceRequested === null,
        )?.id ?? null
      ))
      onSummaryChange(pendingServiceSummary(loaded))
    })
    return () => {
      active = false
    }
  }, [onSummaryChange, repository])

  const pending = useMemo(
    () => workspace ? queueItems(workspace, 'pending-settlement') : [],
    [workspace],
  )
  const settled = useMemo(
    () => workspace ? queueItems(workspace, 'settled') : [],
    [workspace],
  )
  const eligiblePending = useMemo(
    () => eligibleSettlementItems(pending, tender),
    [pending, tender],
  )
  const selectedItems = pending.filter((item) => selectedIds.includes(queueItemId(item)))
  const amountDueCents = selectedItems.reduce(
    (total, item) => total + queueItemDue(item),
    0,
  )
  const changeCents = Math.max(0, (receivedCents ?? 0) - amountDueCents)

  function updateSelection(ids: string[]): void {
    const eligibleIds = new Set(eligiblePending.map(queueItemId))
    const nextIds = ids.filter((id) => eligibleIds.has(id))
    setSelectedIds(nextIds)
    setReceivedCents(tender === 'credit' ? 0 : pending
      .filter((item) => nextIds.includes(queueItemId(item)))
      .reduce((total, item) => total + queueItemDue(item), 0))
    setError('')
    setNotice('')
  }

  function toggleTransaction(id: string): void {
    updateSelection(
      selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id],
    )
  }

  function chooseTender(nextTender: SettlementTender): void {
    const nextItems = eligibleSettlementItems(pending, nextTender)
    setTender(nextTender)
    setSelectedIds(nextItems.map(queueItemId))
    setReceivedCents(nextTender === 'credit' ? 0 : nextItems.reduce(
      (total, item) => total + queueItemDue(item),
      0,
    ))
    setError('')
  }

  async function settleSelected(): Promise<void> {
    if (submitting) return
    if (selectedIds.length === 0) {
      setError('请选择至少一笔待结算业务。')
      return
    }
    if (tender !== 'credit' && (receivedCents === null || receivedCents < amountDueCents)) {
      setError(`实收金额不得少于应收金额 ¥ ${formatCents(amountDueCents)}。`)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await repository.settle({
        transactionIds: selectedIds,
        tender,
        settledAt: new Date().toISOString(),
        amountReceivedCents: tender === 'credit' ? 0 : receivedCents ?? 0,
      })
      setWorkspace(result.state)
      const remaining = queueItems(result.state, 'pending-settlement')
      const nextTender: SettlementTender = remaining.some(
        (item) => !queueItemRequiresCredit(item),
      ) ? 'cash' : 'credit'
      const nextItems = eligibleSettlementItems(remaining, nextTender)
      setTender(nextTender)
      setSelectedIds(nextItems.map(queueItemId))
      setReceivedCents(nextTender === 'credit' ? 0 : nextItems.reduce(
        (total, item) => total + queueItemDue(item),
        0,
      ))
      setInvoiceSettlementId(result.settlement.id)
      setNotice(
        `结算成功：${result.settlement.id}，${tenderLabel(tender)}实收 ¥ ${formatCents(tender === 'credit' ? 0 : receivedCents ?? 0)}。`,
      )
      onSummaryChange(pendingServiceSummary(result.state))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '结算失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

  async function decideInvoice(requested: boolean): Promise<void> {
    if (!invoiceSettlementId) return
    try {
      const next = await repository.recordInvoiceDecision(invoiceSettlementId, requested)
      setWorkspace(next)
      const settlementId = invoiceSettlementId
      setInvoiceSettlementId(null)
      if (requested) {
        setInvoiceRegistrationSettlementId(settlementId)
        setNotice('')
      } else {
        setNotice('已登记“不需要发票”。')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发票选择记录失败。')
    }
  }

  async function issueInvoice(draft: FiscalInvoiceRegistrationDraft): Promise<void> {
    if (!invoiceRegistrationSettlementId) return
    const result = await repository.executeInvoiceManagement({
      type: 'issue-settlement-invoice',
      settlementId: invoiceRegistrationSettlementId,
      issuedAt: new Date().toISOString(),
      operator,
      registration: draft,
    })
    setWorkspace(result.state)
    setInvoiceRegistrationSettlementId(null)
    setInvoiceDeliveryId(result.invoice.id)
    setNotice('')
  }

  async function decideInvoiceDelivery(requested: boolean): Promise<void> {
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发票交付选择记录失败。')
    }
  }

  const registrationSettlement = invoiceRegistrationSettlementId
    ? workspace?.settlements.find((settlement) => settlement.id === invoiceRegistrationSettlementId) ?? null
    : null
  const invoiceDefaults: FiscalInvoiceRegistrationDraft = {
    buyerType: 'organization',
    buyerName: '',
    taxpayerId: '',
    deliveryPhone: '',
    buyerPhone: '',
    deliveryEmail: '',
    buyerAddress: '',
    bankName: '',
    bankAccount: '',
    reviewer: operator.displayName,
    remark: '',
  }
  if (registrationSettlement && workspace) {
    const transaction = registrationSettlement.transactionIds
      .map((id) => workspace.transactions.find((candidate) => candidate.id === id))
      .find(Boolean)
    if (transaction) {
      invoiceDefaults.buyerName = transaction.customer.sender.unit || transaction.customer.sender.name
      invoiceDefaults.taxpayerId = transaction.customer.sender.identityValue
      invoiceDefaults.deliveryPhone = transaction.customer.sender.contact
      invoiceDefaults.buyerPhone = transaction.customer.sender.contact
      invoiceDefaults.buyerAddress = transaction.customer.sender.detailedAddress
      invoiceDefaults.buyerType = transaction.customer.sender.unit ? 'organization' : 'individual'
    }
  }

  if (!workspace) {
    return <section className="settlement-workspace settlement-workspace--loading">正在读取结算中心…</section>
  }

  return (
    <>
      <div className="settlement-workspace">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">综合受理</button><span>/</span><strong>结算中心</strong>
        </div>

        <section className="settlement-heading">
          <div>
            <p className="eyebrow">当前客户业务批次</p>
            <h1>结算中心</h1>
            <p>函件收寄、用邮物品、渠道商品、补录/交管与电子商务业务在此统一结算。确认成功后不能回退。</p>
          </div>
          <div className="settlement-heading__totals">
            <span>待结算笔数</span><strong>{pending.length}</strong>
            <span>当前应收</span><strong>¥ {formatCents(amountDueCents)}</strong>
          </div>
        </section>

        <section className="settlement-panel" aria-labelledby="pending-settlement-title">
          <div className="settlement-panel__title">
            <div>
              <h2 id="pending-settlement-title">待结算业务</h2>
              <p>各项业务按受理时登记的付费方式进入同一结算中心。</p>
            </div>
            {eligiblePending.length > 0 ? (
              <button className="text-button" onClick={() => updateSelection(selectedIds.length === eligiblePending.length ? [] : eligiblePending.map(queueItemId))} type="button">
                {selectedIds.length === eligiblePending.length ? '取消全选' : '全选'}
              </button>
            ) : null}
          </div>

          <div className="settlement-table-wrap">
            <table className="settlement-table">
              <thead><tr><th>选择</th><th>业务流水</th><th>产品</th><th>区域</th><th>付费方式</th><th>总金额</th><th>结算应收</th><th>操作</th></tr></thead>
              <tbody>
                {pending.map((item) => {
                  const id = queueItemId(item)
                  return (
                    <tr key={id}>
                      <td><input aria-label={`选择 ${id}`} checked={selectedIds.includes(id)} disabled={tender === 'credit' ? !queueItemRequiresCredit(item) : queueItemRequiresCredit(item)} onChange={() => toggleTransaction(id)} type="checkbox" /></td>
                      <td>{id}</td>
                      <td>
                        {item.kind === 'mail' ? (
                          <>{item.transaction.product.label}（{item.transaction.product.searchCode}）<small>业务 {item.transaction.product.effectiveBusinessCode}</small></>
                        ) : item.kind === 'postal-supplies' ? (
                          <>用邮物品（{item.sale.lines.length} 种）<small>{item.sale.lines.map((line) => line.label).join('、')}</small></>
                        ) : item.kind === 'channel-products' ? (
                          <>渠道商品（{item.order.totalQuantity} 件）<small>{item.order.lines.map((line) => `${line.productLabel}·${line.skuLabel}`).join('、')}</small></>
                        ) : item.kind === 'electronic-commerce' ? (
                          <>{item.record.kind === 'utility-payment' ? '生活缴费' : '话费充值'}<small>{item.record.providerLabel} · {item.record.projectLabel} · {maskElectronicCommerceAccount(item.record.accountNumber)}</small></>
                        ) : (
                          <>{supplementaryTrafficKindLabel(item.record.kind)}<small>{item.record.kind === 'supplementary-income' ? `${item.record.subjectLabel} · ${item.record.subjectCode}` : `${item.record.mail.productLabel} · ${item.record.mail.effectiveBusinessCode}`}</small></>
                        )}
                      </td>
                      <td>{queueItemDestination(item)}</td>
                      <td>{queueItemPaymentMethod(item)}</td>
                      <td>¥ {formatCents(queueItemTotal(item))}</td>
                      <td>¥ {formatCents(queueItemDue(item))}</td>
                      <td><button className="table-action" onClick={() => setDetail(item)} type="button">详情</button></td>
                    </tr>
                  )
                })}
                {pending.length === 0 ? <tr><td className="settlement-empty" colSpan={8}>当前没有待结算业务。</td></tr> : null}
              </tbody>
            </table>
          </div>

          {pending.length > 0 ? (
            <div className="settlement-payment">
              <div className="settlement-tenders" aria-label="结算方式">
                {([['cash', '现金'], ['third-party', '第三方支付'], ['pos', 'POS 支付'], ['credit', '记欠']] as const).map(([value, label]) => (
                  <button aria-pressed={tender === value} className={tender === value ? 'settlement-tender settlement-tender--active' : 'settlement-tender'} key={value} onClick={() => chooseTender(value)} type="button">{label}</button>
                ))}
              </div>
              <div className="settlement-cash-fields">
                <label><span>应收金额</span><strong>¥ {formatCents(amountDueCents)}</strong></label>
                <label><span>实收金额（元）</span><CurrencyInput aria-label="实收金额" disabled={tender !== 'cash'} onValueChange={(valueCents) => { setReceivedCents(valueCents); setError('') }} valueCents={receivedCents} /></label>
                <label><span>找零</span><strong>¥ {formatCents(changeCents)}</strong></label>
                <button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void settleSelected()} type="button">{submitting ? '正在结算…' : '确认结算'}</button>
              </div>
              <p className="settlement-lock-note">确认结算后不可回退。</p>
            </div>
          ) : null}

          {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
          {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>

        {settled.length > 0 ? (
          <section className="settlement-panel settlement-panel--history" aria-labelledby="settled-title">
            <div className="settlement-panel__title"><div><h2 id="settled-title">已结算记录</h2><p>这里只显示结果，不提供回退按钮。</p></div></div>
            <div className="settlement-history-list">
              {settled.map((item) => {
                const id = queueItemId(item)
                const settlementId = item.kind === 'mail'
                  ? item.transaction.settlementId
                  : item.kind === 'postal-supplies'
                  ? item.sale.settlementId
                  : item.kind === 'channel-products'
                  ? item.order.settlementId
                  : item.kind === 'electronic-commerce'
                  ? item.record.settlementId
                  : item.record.settlementId
                return (
                  <article key={id}>
                    <div><strong>{id}</strong><span>{item.kind === 'mail' ? `${item.transaction.product.label}（${item.transaction.product.searchCode}） · 业务 ${item.transaction.product.effectiveBusinessCode}` : item.kind === 'postal-supplies' ? `用邮物品 · ${item.sale.lines.length} 种` : item.kind === 'channel-products' ? `渠道商品 · ${item.order.totalQuantity} 件` : item.kind === 'electronic-commerce' ? `${item.record.kind === 'utility-payment' ? '生活缴费' : '话费充值'} · ${item.record.projectLabel}` : supplementaryTrafficKindLabel(item.record.kind)}</span></div>
                    <div><span>结算单</span><strong>{settlementId}</strong></div>
                    <div><span>结算应收</span><strong>¥ {formatCents(queueItemDue(item))}</strong></div>
                    <span className="queue-status queue-status--settled">已结算</span>
                  </article>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>

      {detail ? (
        <Modal description="业务受理详情只读展示；结算完成后不可在此修改。" eyebrow="结算中心" title={`业务详情 ${queueItemId(detail)}`} wide>
          <div className="modal-form service-review">
            {detail.kind === 'mail' ? (
              <>
                <dl>
                  <div><dt>产品</dt><dd>{detail.transaction.product.label}（{detail.transaction.product.searchCode}）</dd></div>
                  <div><dt>最终业务码</dt><dd>{detail.transaction.product.effectiveBusinessCode}</dd></div>
                  <div><dt>邮件条码</dt><dd>{detail.transaction.service.itemCode || '—'}</dd></div>
                  <div><dt>区域</dt><dd>{destinationZoneLabel(detail.transaction.service.destinationZone)}</dd></div>
                  <div><dt>重量 / 件数</dt><dd>{detail.transaction.service.weightGrams} 克 / {detail.transaction.service.quantity} 件</dd></div>
                  <div><dt>内件信息</dt><dd>{detail.transaction.service.contents || '—'}</dd></div>
                  <div><dt>付费方式</dt><dd>{paymentMethodLabel(detail.transaction.service.paymentMethod)}</dd></div>
                  <div><dt>回执业务</dt><dd>{detail.transaction.service.returnReceiptRequested ? '已办理' : '未办理'}</dd></div>
                  <div><dt>回执费</dt><dd>¥ {formatCents(detail.transaction.charge.returnReceiptCents)}</dd></div>
                  <div><dt>总资费</dt><dd>¥ {formatCents(detail.transaction.charge.postageCents)}</dd></div>
                  <div><dt>贴票销售</dt><dd>¥ {formatCents(detail.transaction.charge.stampSaleCents)}</dd></div>
                  <div className="review-total"><dt>结算应收</dt><dd>¥ {formatCents(detail.transaction.charge.settlementDueCents)}</dd></div>
                </dl>
                {detail.transaction.service.contentItems.length > 0 ? (
                  <div className="settlement-table-wrap">
                    <table className="settlement-table">
                      <thead><tr><th>物品</th><th>简称</th><th>单位</th><th>单价</th><th>数量</th><th>目录金额</th></tr></thead>
                      <tbody>{detail.transaction.service.contentItems.map((line) => <tr key={line.itemId}><td>{line.label}</td><td>{line.mnemonic}</td><td>{line.unit}</td><td>¥ {formatCents(line.unitPriceCents)}</td><td>{line.quantity}</td><td>¥ {formatCents(line.amountCents)}</td></tr>)}</tbody>
                      <tfoot><tr><td colSpan={5}>物品目录金额合计</td><td>¥ {formatCents(detail.transaction.service.contentItems.reduce((total, line) => total + line.amountCents, 0))}</td></tr></tfoot>
                    </table>
                  </div>
                ) : null}
              </>
            ) : detail.kind === 'postal-supplies' ? (
              <div className="settlement-table-wrap">
                <table className="settlement-table">
                  <thead><tr><th>物品</th><th>单位</th><th>单价</th><th>数量</th><th>金额</th></tr></thead>
                  <tbody>{detail.sale.lines.map((line) => <tr key={line.itemId}><td>{line.label}</td><td>{line.unit}</td><td>¥ {formatCents(line.unitPriceCents)}</td><td>{line.quantity}</td><td>¥ {formatCents(line.amountCents)}</td></tr>)}</tbody>
                  <tfoot><tr><td colSpan={4}>合计</td><td>¥ {formatCents(detail.sale.totalCents)}</td></tr></tfoot>
                </table>
              </div>
            ) : detail.kind === 'channel-products' ? (
              <div className="channel-order-review">
                <dl>
                  <div><dt>商品件数</dt><dd>{detail.order.totalQuantity}</dd></div>
                  <div><dt>商品金额</dt><dd>¥ {formatCents(detail.order.totalCents)}</dd></div>
                  <div><dt>寄递 / 自提 / 现货</dt><dd>{(() => { const summary = channelProductFulfillmentSummary(detail.order); return `${summary.deliveryQuantity} / ${summary.pickupQuantity} / ${summary.spotQuantity}` })()}</dd></div>
                  <div><dt>付费方式</dt><dd>现结</dd></div>
                </dl>
                <div className="settlement-table-wrap">
                  <table className="settlement-table">
                    <thead><tr><th>商品</th><th>SKU</th><th>单位</th><th>单价</th><th>数量</th><th>金额</th></tr></thead>
                    <tbody>{detail.order.lines.map((line) => <tr key={`${line.productId}-${line.skuCode}`}><td>{line.productLabel}</td><td>{line.skuLabel}<small>{line.skuCode}</small></td><td>{line.unit}</td><td>¥ {formatCents(line.unitPriceCents)}</td><td>{line.quantity}</td><td>¥ {formatCents(line.amountCents)}</td></tr>)}</tbody>
                    <tfoot><tr><td colSpan={5}>合计</td><td>¥ {formatCents(detail.order.totalCents)}</td></tr></tfoot>
                  </table>
                </div>
                {detail.order.allocations.length > 0 ? (
                  <div className="channel-order-allocation-list">
                    {detail.order.allocations.map((allocation, index) => (
                      <article key={allocation.id}>
                        <strong>{allocation.kind === 'delivery' ? `收件人 ${index + 1}：${allocation.recipient?.name}` : `到店自提 ${index + 1}：${allocation.pickup?.name}`}</strong>
                        <span>{allocation.kind === 'delivery' ? `${allocation.recipient?.contact} · ${allocation.recipient?.postalCode} · ${allocation.recipient?.detailedAddress}` : `${allocation.pickup?.contact} · ${allocation.pickup?.pickupOfficeName}`}</span>
                        <small>{allocation.lines.map((line) => `${line.skuCode} × ${line.quantity}`).join('、')}</small>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : detail.kind === 'electronic-commerce' ? (
              <ElectronicCommerceDetail record={detail.record} />
            ) : (
              <SupplementaryTrafficDetail record={detail.record} />
            )}
            <div className="modal-actions"><button className="secondary-button" onClick={() => setDetail(null)} type="button">关闭</button></div>
          </div>
        </Modal>
      ) : null}

      {invoiceSettlementId ? (
        <Modal description={`结算单 ${invoiceSettlementId} 已支付完成。`} eyebrow="结算完成" title="是否需要开具发票？">
          <div className="modal-form invoice-choice">
            <p>请登记客户的发票选择。该选择在支付成功后记录。</p>
            <div className="modal-actions"><button className="secondary-button" onClick={() => void decideInvoice(false)} type="button">不需要发票</button><button className="primary-button primary-button--compact" onClick={() => void decideInvoice(true)} type="button">需要发票</button></div>
          </div>
        </Modal>
      ) : null}

      {registrationSettlement ? (
        <InvoiceRegistrationModal
          amountCents={registrationSettlement.amountDueCents}
          defaults={invoiceDefaults}
          onClose={() => setInvoiceRegistrationSettlementId(null)}
          onSubmit={issueInvoice}
          sourceLabel={`结算单 ${registrationSettlement.id}`}
        />
      ) : null}

      {invoiceDeliveryId ? (
        <Modal description="电子发票登记完成。" eyebrow="信息" title="是否进行发票交付？">
          <div className="modal-form invoice-choice"><p>请选择是否立即完成本次发票交付。</p><div className="modal-actions"><button className="secondary-button" onClick={() => void decideInvoiceDelivery(false)} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void decideInvoiceDelivery(true)} type="button">确定</button></div></div>
        </Modal>
      ) : null}
    </>
  )
}
