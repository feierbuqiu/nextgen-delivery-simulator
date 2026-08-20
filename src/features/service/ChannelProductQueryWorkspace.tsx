import { useEffect, useMemo, useState } from 'react'

import type { RequestOnSiteAuthorization } from '../../domain/access/workAuthorization'
import {
  queryChannelProductOrders,
  type ChannelProductOrderQuery,
} from '../../domain/service/channelProductSales'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import { pendingServiceSummary } from '../../domain/service/transactions'
import type {
  ChannelProductOrder,
  ChannelProductOrderLine,
  ServiceWorkspaceState,
  SettlementRecord,
  SettlementTender,
  ServiceOperatorSnapshot,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'
import type { ServiceSummary } from './ServiceIntakePanel'
import {
  CorrectionWorkspaceTabs,
  type CorrectionWorkspaceKind,
} from './CorrectionWorkspaceTabs'

interface ChannelProductQueryWorkspaceProps {
  repository: ServiceRepository
  onBack: () => void
  onSummaryChange: (summary: ServiceSummary) => void
  onOpenAcceptanceQuery?: () => void
  onOpenElectronicCommerceQuery?: () => void
  onSelectWorkspace?: (workspace: CorrectionWorkspaceKind) => void
  operator: ServiceOperatorSnapshot
  authorizeOnSite: RequestOnSiteAuthorization
}

interface OrderLineRow {
  order: ChannelProductOrder
  line: ChannelProductOrderLine
  lineIndex: number
}

const DEMO_BUSINESS_DATE = '2026-08-04'
const DEMO_ACTION_AT = '2026-08-04T12:00:00.000Z'

function createDefaultQuery(): ChannelProductOrderQuery {
  return {
    querySerial: '',
    productTerm: '',
    salesDateFrom: DEMO_BUSINESS_DATE,
    salesDateTo: DEMO_BUSINESS_DATE,
    operatorId: '',
    workstationCode: '',
    salesType: 'offline',
  }
}

function displayDateTime(value: string): string {
  return value.replace('T', ' ').slice(0, 19)
}

function tenderLabel(tender: SettlementTender | null): string {
  if (!tender) return '未结算'
  return {
    cash: '现金',
    'third-party': '第三方支付',
    pos: 'POS 支付',
    credit: '记欠',
  }[tender]
}

function settlementFor(
  state: ServiceWorkspaceState,
  order: ChannelProductOrder,
): SettlementRecord | null {
  if (!order.settlementId) return null
  return state.settlements.find((settlement) => settlement.id === order.settlementId) ?? null
}

function statusLabel(order: ChannelProductOrder): string {
  return order.status === 'settled' ? '已结算' : '未结算'
}

function printReceipt(): void {
  document.body.classList.add('channel-product-receipt-printing')
  try {
    window.print()
  } finally {
    document.body.classList.remove('channel-product-receipt-printing')
  }
}

export function ChannelProductQueryWorkspace({
  repository,
  onBack,
  onSummaryChange,
  onOpenAcceptanceQuery,
  onOpenElectronicCommerceQuery,
  onSelectWorkspace,
  operator,
  authorizeOnSite,
}: ChannelProductQueryWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState<ChannelProductOrderQuery>(createDefaultQuery)
  const [appliedQuery, setAppliedQuery] = useState<ChannelProductOrderQuery | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [detail, setDetail] = useState<ChannelProductOrder | null>(null)
  const [printConfirmation, setPrintConfirmation] = useState<ChannelProductOrder | null>(null)
  const [receipt, setReceipt] = useState<ChannelProductOrder | null>(null)
  const [supervisorOpen, setSupervisorOpen] = useState(false)
  const [supervisorId, setSupervisorId] = useState('')
  const [supervisorSecret, setSupervisorSecret] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      onSummaryChange(pendingServiceSummary(loaded))
    })
    return () => {
      active = false
    }
  }, [onSummaryChange, repository])

  const results = useMemo(
    () => appliedQuery && workspace
      ? queryChannelProductOrders(workspace.channelProductOrders, appliedQuery)
      : [],
    [appliedQuery, workspace],
  )
  const rows = useMemo<OrderLineRow[]>(
    () => results.flatMap((order) => order.lines.map((line, lineIndex) => ({
      order,
      line,
      lineIndex,
    }))),
    [results],
  )
  const operators = useMemo(() => {
    const unique = new Map<string, string>()
    for (const order of workspace?.channelProductOrders ?? []) {
      unique.set(order.operator.operatorId, order.operator.displayName)
    }
    return [...unique.entries()]
  }, [workspace])
  const workstations = useMemo(() => [...new Set(
    (workspace?.channelProductOrders ?? []).map((order) => order.operator.workstationCode),
  )].sort(), [workspace])
  const resultTotalCents = results.reduce((total, order) => total + order.totalCents, 0)
  const displaySalesType = appliedQuery?.salesType ?? query.salesType

  function updateQuery<K extends keyof ChannelProductOrderQuery>(
    field: K,
    value: ChannelProductOrderQuery[K],
  ): void {
    setQuery((current) => ({ ...current, [field]: value }))
    setNotice('')
    setError('')
  }

  function runQuery(): void {
    setAppliedQuery(structuredClone(query))
    setSelectedIds([])
    setNotice('查询完成。')
    setError('')
  }

  function resetQuery(): void {
    setQuery(createDefaultQuery())
    setAppliedQuery(null)
    setSelectedIds([])
    setNotice('')
    setError('')
  }

  function selectWorkspace(target: CorrectionWorkspaceKind): void {
    if (onSelectWorkspace) {
      onSelectWorkspace(target)
      return
    }
    if (target === 'acceptance') onOpenAcceptanceQuery?.()
    if (target === 'electronic-commerce') onOpenElectronicCommerceQuery?.()
  }

  function toggleSelected(orderId: string): void {
    setSelectedIds((current) => current.includes(orderId)
      ? current.filter((id) => id !== orderId)
      : [...current, orderId])
  }

  function prepareDelete(): void {
    if (selectedIds.length === 0) {
      setError('请选择需要删除的渠道商品销售记录。')
      return
    }
    setSupervisorOpen(true)
    setSupervisorSecret('')
    setError('')
  }

  async function authorizeDelete(): Promise<void> {
    try {
      const authorization = await authorizeOnSite(
        'delete-channel-product-order',
        supervisorId,
        supervisorSecret,
        DEMO_ACTION_AT,
      )
      const deleted = await repository.deleteChannelProductOrders({
        orderIds: selectedIds,
        deletedAt: DEMO_ACTION_AT,
        operator,
        authorization,
      })
      setWorkspace(deleted.state)
      setSelectedIds([])
      setSupervisorOpen(false)
      setSupervisorSecret('')
      setNotice(`删除成功，${deleted.orders.length} 笔当天未缴款记录已完成主管授权。`)
      setError('')
      onSummaryChange(pendingServiceSummary(deleted.state))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '渠道商品销售记录删除失败。')
    }
  }

  async function confirmReceiptPrint(): Promise<void> {
    if (!printConfirmation) return
    try {
      const recorded = await repository.recordChannelProductReceiptPrint({
        orderId: printConfirmation.id,
        printedAt: DEMO_ACTION_AT,
      })
      setWorkspace(recorded.state)
      setReceipt(recorded.order)
      setPrintConfirmation(null)
      setNotice(`已生成商品销售小票 ${recorded.order.id}。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '商品销售小票生成失败。')
      setPrintConfirmation(null)
    }
  }

  if (!workspace) {
    return <section className="transaction-query transaction-query--loading">正在读取商品销售查改数据…</section>
  }

  return (
    <>
      <div className="transaction-query channel-product-query">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业工作台</button><span>/</span><span>查改处理</span><span>/</span><strong>商品销售查改</strong>
        </div>

        <CorrectionWorkspaceTabs active="channel-products" onSelect={selectWorkspace} />

        <nav aria-label="商品销售查改类别" className="channel-product-query__subtabs">
          <button aria-current="page" type="button">商品销售查改</button>
          {['封片卡销售查改', '文创销售查改', '文创预售查改', '文创要数查询'].map((label) => <button aria-disabled="true" key={label} type="button">{label}</button>)}
        </nav>

        <section aria-label="商品销售查改查询条件" className="correction-query-panel channel-product-query__filters">
          <div className="correction-query-grid">
            <label><span>查询流水号</span><input aria-label="商品销售查询流水号" onChange={(event) => updateQuery('querySerial', event.target.value)} placeholder="请输入查询流水号" value={query.querySerial} /></label>
            <label><span>商品</span><input aria-label="商品销售查询商品" onChange={(event) => updateQuery('productTerm', event.target.value)} placeholder="商品名称、条码或 SKU" value={query.productTerm} /></label>
            <label className="correction-date-range"><span>销售日期</span><span><input aria-label="商品销售开始日期" onChange={(event) => updateQuery('salesDateFrom', event.target.value)} type="date" value={query.salesDateFrom} /><b>至</b><input aria-label="商品销售结束日期" onChange={(event) => updateQuery('salesDateTo', event.target.value)} type="date" value={query.salesDateTo} /></span></label>
            <label><span>收费员工</span><select aria-label="商品销售收费员工" onChange={(event) => updateQuery('operatorId', event.target.value)} value={query.operatorId}><option value="">全部</option>{operators.map(([id, name]) => <option key={id} value={id}>{name}（{id}）</option>)}</select></label>
            <label><span>台席</span><select aria-label="商品销售台席" onChange={(event) => updateQuery('workstationCode', event.target.value)} value={query.workstationCode}><option value="">全部</option>{workstations.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
          </div>
          <fieldset className="channel-product-query__sales-type">
            <legend>销售类型</legend>
            <label><input checked={query.salesType === 'offline'} name="channel-product-sales-type" onChange={() => updateQuery('salesType', 'offline')} type="radio" />线下销售</label>
            <label><input checked={query.salesType === 'online'} name="channel-product-sales-type" onChange={() => updateQuery('salesType', 'online')} type="radio" />线上销售</label>
          </fieldset>
          <div className="correction-query-actions">
            <button className="query-action query-action--primary" onClick={runQuery} type="button">查找</button>
            <button className="query-action query-action--danger" onClick={prepareDelete} type="button">删除</button>
            <button className="query-action" onClick={resetQuery} type="button">重置</button>
          </div>
        </section>

        <section aria-label="商品销售查改结果" className="correction-results">
          <header className="correction-results__summary">
            <h1>商品销售记录</h1>
            <div><span>总件数</span><strong>{results.length}</strong><span>总金额</span><strong>{formatCents(resultTotalCents)}</strong></div>
          </header>
          <div className="correction-table-wrap">
            <table className="correction-table channel-product-query__table">
              <thead>
                {displaySalesType === 'offline' ? (
                  <tr><th>选择</th><th>序号</th><th>批次查询流水号</th><th>商品名称</th><th>商品 SKU</th><th>销售数量</th><th>销售金额</th><th>销售日期</th><th>付费方式</th><th>结算方式</th><th>收费员工</th><th>台席</th><th>操作</th></tr>
                ) : (
                  <tr><th>选择</th><th>序号</th><th>批次查询流水号</th><th>商品名称</th><th>商品 SKU</th><th>销售数量</th><th>销售金额</th><th>结算方式</th><th>销售日期</th><th>是否撤销</th><th>收费员工</th><th>台席</th><th>操作</th></tr>
                )}
              </thead>
              <tbody>
                {rows.map(({ order, line, lineIndex }, index) => {
                  const settlement = settlementFor(workspace, order)
                  const common = <>
                    <td>{lineIndex === 0 ? <input aria-label={`选择商品销售记录 ${order.id}`} checked={selectedIds.includes(order.id)} onChange={() => toggleSelected(order.id)} type="checkbox" /> : null}</td>
                    <td>{index + 1}</td><td>{order.id}</td><td>{line.productLabel}<small>{line.barcode}</small></td><td>{line.skuLabel}<small>{line.skuCode}</small></td><td>{line.quantity}</td><td>{formatCents(line.amountCents)}</td>
                  </>
                  return displaySalesType === 'offline' ? (
                    <tr key={`${order.id}:${line.skuCode}`}>
                      {common}<td>{displayDateTime(order.submittedAt)}</td><td>现结</td><td>{tenderLabel(settlement?.tender ?? null)}</td><td>{order.operator.displayName}<small>{order.operator.operatorId}</small></td><td>{order.operator.workstationCode}</td><td><div className="correction-row-actions"><button onClick={() => setDetail(order)} type="button">详情</button><button onClick={() => setPrintConfirmation(order)} type="button">打印</button></div></td>
                    </tr>
                  ) : (
                    <tr key={`${order.id}:${line.skuCode}`}>
                      {common}<td>{tenderLabel(settlement?.tender ?? null)}</td><td>{displayDateTime(order.submittedAt)}</td><td>未撤销</td><td>{order.operator.displayName}<small>{order.operator.operatorId}</small></td><td>{order.operator.workstationCode}</td><td><div className="correction-row-actions"><button onClick={() => setDetail(order)} type="button">详情</button></div></td>
                    </tr>
                  )
                })}
                {appliedQuery && rows.length === 0 ? <tr><td className="settlement-empty" colSpan={13}>无数据</td></tr> : null}
              </tbody>
            </table>
          </div>
          {notice ? <p className="customer-notice" role="status">{notice} 共 {results.length} 笔记录。</p> : null}
          {error && !supervisorOpen ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      {detail ? (
        <Modal description={`销售流水：${detail.id}`} eyebrow="商品销售查改" title="商品销售详情" wide>
          <div className="modal-form channel-product-query__detail">
            <dl>
              <div><dt>销售状态</dt><dd>{statusLabel(detail)}</dd></div><div><dt>销售类型</dt><dd>{detail.salesType === 'online' ? '线上销售' : '线下销售'}</dd></div>
              <div><dt>客户名称</dt><dd>{detail.buyer.name || '散户'}</dd></div><div><dt>联系电话</dt><dd>{detail.buyer.contact || '—'}</dd></div>
              <div><dt>销售日期</dt><dd>{displayDateTime(detail.submittedAt)}</dd></div><div><dt>收费员工</dt><dd>{detail.operator.displayName}（{detail.operator.operatorId}）</dd></div>
              <div><dt>台席</dt><dd>{detail.operator.workstationCode}</dd></div><div><dt>销售合计</dt><dd>{detail.totalQuantity} 件 / {formatCents(detail.totalCents)} 元</dd></div>
            </dl>
            <table className="settlement-table"><thead><tr><th>商品名称</th><th>SKU</th><th>数量</th><th>单价</th><th>金额</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={`${line.productId}:${line.skuCode}`}><td>{line.productLabel}</td><td>{line.skuLabel}（{line.skuCode}）</td><td>{line.quantity}</td><td>{formatCents(line.unitPriceCents)}</td><td>{formatCents(line.amountCents)}</td></tr>)}</tbody></table>
            <p className="service-field-hint">履约登记 {detail.allocations.length} 笔；窗口现货 {detail.totalQuantity - detail.allocations.reduce((total, allocation) => total + allocation.lines.reduce((lineTotal, line) => lineTotal + line.quantity, 0), 0)} 件。</p>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setDetail(null)} type="button">关闭</button></div>
          </div>
        </Modal>
      ) : null}

      {printConfirmation ? (
        <Modal description={`销售流水：${printConfirmation.id}`} eyebrow="商品销售查改" title="信息">
          <div className="modal-form channel-product-query__print-confirm"><p>是否打印小票</p><div className="modal-actions"><button className="secondary-button" onClick={() => setPrintConfirmation(null)} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void confirmReceiptPrint()} type="button">确定</button></div></div>
        </Modal>
      ) : null}

      {receipt ? (
        <Modal eyebrow="商品销售查改" title="商品销售小票" wide>
          <div className="modal-form channel-product-receipt-modal">
            <article aria-label="商品销售小票" className="channel-product-receipt">
              <header><strong>{receipt.operator.acceptanceOffice}</strong><span>寄递商品</span></header>
              <dl><div><dt>单号</dt><dd>{receipt.id}</dd></div><div><dt>客户名称</dt><dd>{receipt.buyer.name || '散户'}</dd></div></dl>
              <table><thead><tr><th>商品名称</th><th>数量</th><th>单价</th><th>金额</th></tr></thead><tbody>{receipt.lines.map((line) => <tr key={`${line.productId}:${line.skuCode}`}><td>{line.productLabel} {line.skuLabel}</td><td>{line.quantity}</td><td>{formatCents(line.unitPriceCents)}</td><td>{formatCents(line.amountCents)}</td></tr>)}</tbody></table>
              <p>小计：{receipt.totalQuantity} 件 <strong>{formatCents(receipt.totalCents)} 元</strong></p>
              <p>实收：{receipt.status === 'settled' ? formatCents(receipt.totalCents) : '未结算'} / 支付方式：现结 / {tenderLabel(settlementFor(workspace, receipt)?.tender ?? null)}</p>
              <footer><span>收费员：{receipt.operator.displayName}</span><span>台席：{receipt.operator.workstationCode}</span><span>时间：{displayDateTime(receipt.submittedAt)}</span></footer>
            </article>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setReceipt(null)} type="button">关闭</button><button className="primary-button primary-button--compact" onClick={printReceipt} type="button">打印小票</button></div>
          </div>
        </Modal>
      ) : null}

      {supervisorOpen ? (
        <Modal description={`删除 ${selectedIds.length} 笔当天未缴款商品销售记录必须经过本地虚构主管授权。`} eyebrow="主管授权" title="请输入主管工号和密码">
          <div className="modal-form supervisor-form">
            <label><span>主管工号</span><input aria-label="商品销售主管工号" onChange={(event) => setSupervisorId(event.target.value)} value={supervisorId} /></label>
            <label><span>主管密码</span><input aria-label="商品销售主管密码" onChange={(event) => setSupervisorSecret(event.target.value)} type="password" value={supervisorSecret} /></label>
            <p className="service-field-hint">由主管本人现场输入工号和密码；系统不显示或代填。</p>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setSupervisorOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void authorizeDelete()} type="button">授权并删除</button></div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
