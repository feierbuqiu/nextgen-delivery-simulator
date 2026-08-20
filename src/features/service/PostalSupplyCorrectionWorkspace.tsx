import { useEffect, useMemo, useState } from 'react'

import type { RequestOnSiteAuthorization } from '../../domain/access/workAuthorization'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import {
  postalSupplySaleStatusLabel,
  queryPostalSupplySales,
  type PostalSupplySaleQuery,
} from '../../domain/service/counterCorrections'
import type { FiscalInvoiceRegistrationDraft } from '../../domain/service/invoiceManagement'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import { DEFAULT_SERVICE_OPERATOR, pendingServiceSummary } from '../../domain/service/transactions'
import type {
  PostalSupplySale,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'
import { InvoiceRegistrationModal } from '../invoice/InvoiceRegistrationModal'
import {
  CorrectionWorkspaceTabs,
  type CorrectionWorkspaceKind,
} from './CorrectionWorkspaceTabs'
import type { ServiceSummary } from './ServiceIntakePanel'

interface PostalSupplyCorrectionWorkspaceProps {
  repository: ServiceRepository
  onBack: () => void
  onSummaryChange: (summary: ServiceSummary) => void
  onSelectWorkspace: (workspace: CorrectionWorkspaceKind) => void
  operator?: ServiceOperatorSnapshot
  now?: () => Date
  authorizeOnSite: RequestOnSiteAuthorization
}

function defaultQuery(now = new Date()): PostalSupplySaleQuery {
  const businessDate = businessCalendarDay(now)
  return {
    querySerial: '',
    itemTerm: '',
    customerTerm: '',
    contactTerm: '',
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

export function PostalSupplyCorrectionWorkspace({
  repository,
  onBack,
  onSummaryChange,
  onSelectWorkspace,
  operator = DEFAULT_SERVICE_OPERATOR,
  now = () => new Date(),
  authorizeOnSite,
}: PostalSupplyCorrectionWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState<PostalSupplySaleQuery>(() => defaultQuery(now()))
  const [appliedQuery, setAppliedQuery] = useState<PostalSupplySaleQuery | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editing, setEditing] = useState<PostalSupplySale | null>(null)
  const [editQuantities, setEditQuantities] = useState<Record<string, number>>({})
  const [editReason, setEditReason] = useState('')
  const [receipt, setReceipt] = useState<PostalSupplySale | null>(null)
  const [supervisorOpen, setSupervisorOpen] = useState(false)
  const [supervisorId, setSupervisorId] = useState('')
  const [supervisorSecret, setSupervisorSecret] = useState('')
  const [deletionReason, setDeletionReason] = useState('')
  const [invoiceSale, setInvoiceSale] = useState<PostalSupplySale | null>(null)
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
      ? queryPostalSupplySales(workspace.postalSupplySales, appliedQuery)
      : []
  ), [appliedQuery, workspace])
  const operators = useMemo(() => {
    const values = new Map<string, string>()
    for (const sale of workspace?.postalSupplySales ?? []) {
      values.set(sale.operator.operatorId, sale.operator.displayName)
    }
    return [...values.entries()]
  }, [workspace])
  const workstations = useMemo(() => [...new Set(
    (workspace?.postalSupplySales ?? []).map((sale) => sale.operator.workstationCode),
  )].sort(), [workspace])
  const resultTotalCents = results
    .filter((sale) => sale.status !== 'deleted')
    .reduce((total, sale) => total + sale.totalCents, 0)

  function updateQuery<K extends keyof PostalSupplySaleQuery>(
    key: K,
    value: PostalSupplySaleQuery[K],
  ): void {
    setQuery((current) => ({ ...current, [key]: value }))
    setError('')
    setNotice('')
  }

  function runQuery(): void {
    setAppliedQuery(structuredClone(query))
    setSelectedIds([])
    setNotice('查询完成。')
    setError('')
  }

  function resetQuery(): void {
    setQuery(defaultQuery(now()))
    setAppliedQuery(null)
    setSelectedIds([])
    setNotice('')
    setError('')
  }

  function refresh(next: ServiceWorkspaceState): void {
    setWorkspace(next)
    onSummaryChange(pendingServiceSummary(next))
  }

  function openEdit(sale: PostalSupplySale): void {
    setEditing(sale)
    setEditQuantities(Object.fromEntries(sale.lines.map((line) => [line.itemId, line.quantity])))
    setEditReason('')
    setError('')
  }

  async function saveRevision(): Promise<void> {
    if (!editing) return
    try {
      const operatedAt = now().toISOString()
      const result = await repository.executeCounterCorrection({
        type: 'revise-postal-supply-sale',
        saleId: editing.id,
        quantities: editing.lines.map((line) => ({
          itemId: line.itemId,
          quantity: editQuantities[line.itemId] ?? 0,
        })),
        reason: editReason,
        operatedAt,
        operator,
      })
      refresh(result.state)
      setEditing(null)
      setNotice(`保存成功，${editing.id} 的修改数量和金额已更新，原值已写入审计记录。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '用邮物品查改保存失败。')
    }
  }

  function prepareDelete(): void {
    if (selectedIds.length === 0) {
      setError('请选择需要删除的用邮物品销售记录。')
      return
    }
    setSupervisorSecret('')
    setDeletionReason('')
    setSupervisorOpen(true)
    setError('')
  }

  async function authorizeDelete(): Promise<void> {
    try {
      const operatedAt = now().toISOString()
      const authorization = await authorizeOnSite(
        'delete-postal-supply-sale',
        supervisorId,
        supervisorSecret,
        operatedAt,
      )
      const result = await repository.executeCounterCorrection({
        type: 'delete-postal-supply-sales',
        saleIds: selectedIds,
        reason: deletionReason,
        operatedAt,
        operator,
        authorization,
      })
      refresh(result.state)
      setSelectedIds([])
      setSupervisorOpen(false)
      setNotice(`删除成功，${result.affectedIds.length} 笔当天未结算记录已释放库存。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '用邮物品销售记录删除失败。')
    }
  }

  async function openReceipt(sale: PostalSupplySale): Promise<void> {
    try {
      const printedAt = now().toISOString()
      const result = await repository.executeCounterCorrection({
        type: 'record-postal-supply-receipt-print',
        saleId: sale.id,
        printedAt,
      })
      refresh(result.state)
      setReceipt(result.state.postalSupplySales.find((candidate) => candidate.id === sale.id) ?? sale)
      setNotice(`已生成用邮物品销售小票 ${sale.id}。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '小票生成失败。')
    }
  }

  function prepareInvoice(): void {
    if (!workspace || selectedIds.length === 0) {
      setError('请先选择需要开票的已结算用邮物品记录。')
      return
    }
    const selected = selectedIds.flatMap((id) => {
      const sale = workspace.postalSupplySales.find((candidate) => candidate.id === id)
      return sale ? [sale] : []
    })
    if (selected.some((sale) => sale.status !== 'settled' || !sale.settlementId)) {
      setError('只有已结算且未删除的用邮物品记录可以开票。')
      return
    }
    const settlementIds = [...new Set(selected.map((sale) => sale.settlementId!))]
    if (settlementIds.length !== 1) {
      setError('合并开票仅支持同一结算批次，请按结算批次分别办理。')
      return
    }
    const first = selected[0]
    if (!first) return
    setInvoiceSale(first)
    setError('')
  }

  async function issueInvoice(registration: FiscalInvoiceRegistrationDraft): Promise<void> {
    if (!invoiceSale?.settlementId) return
    const issuedAt = now().toISOString()
    const result = await repository.executeInvoiceManagement({
      type: 'issue-settlement-invoice',
      settlementId: invoiceSale.settlementId,
      issuedAt,
      operator,
      registration,
    })
    refresh(result.state)
    setInvoiceSale(null)
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
    return <section className="transaction-query transaction-query--loading">正在读取用邮物品查改数据…</section>
  }

  const invoiceSettlement = invoiceSale?.settlementId
    ? workspace.settlements.find((settlement) => settlement.id === invoiceSale.settlementId)
    : null

  return (
    <>
      <div className="transaction-query postal-supply-correction">
        <div className="customer-breadcrumb"><button onClick={onBack} type="button">营业工作台</button><span>/</span><span>查改处理</span><span>/</span><strong>用邮物品查改</strong></div>
        <CorrectionWorkspaceTabs active="postal-supplies" onSelect={onSelectWorkspace} />

        <section aria-label="用邮物品查改查询条件" className="correction-query-panel">
          <div className="correction-query-grid">
            <label><span>查询流水号</span><input aria-label="用邮物品查询流水号" onChange={(event) => updateQuery('querySerial', event.target.value)} value={query.querySerial} /></label>
            <label><span>客户名称 / 协议号</span><input aria-label="用邮物品查询客户" onChange={(event) => updateQuery('customerTerm', event.target.value)} value={query.customerTerm} /></label>
            <label><span>寄件客户电话</span><input aria-label="用邮物品查询客户电话" onChange={(event) => updateQuery('contactTerm', event.target.value)} value={query.contactTerm} /></label>
            <label><span>物品名称 / 助记码</span><input aria-label="用邮物品查询物品" onChange={(event) => updateQuery('itemTerm', event.target.value)} value={query.itemTerm} /></label>
            <label><span>收费员工</span><select aria-label="用邮物品查询收费员工" onChange={(event) => updateQuery('operatorId', event.target.value)} value={query.operatorId}><option value="">全部</option>{operators.map(([id, name]) => <option key={id} value={id}>{name}（{id}）</option>)}</select></label>
            <label><span>台席</span><select aria-label="用邮物品查询台席" onChange={(event) => updateQuery('workstationCode', event.target.value)} value={query.workstationCode}><option value="">全部</option>{workstations.map((code) => <option key={code}>{code}</option>)}</select></label>
            <label className="correction-date-range"><span>销售日期</span><span><input aria-label="用邮物品查询开始日期" onChange={(event) => updateQuery('acceptedDateFrom', event.target.value)} type="date" value={query.acceptedDateFrom} /><b>至</b><input aria-label="用邮物品查询结束日期" onChange={(event) => updateQuery('acceptedDateTo', event.target.value)} type="date" value={query.acceptedDateTo} /></span></label>
            <label><span>记录状态</span><select aria-label="用邮物品查询状态" onChange={(event) => updateQuery('status', event.target.value as PostalSupplySaleQuery['status'])} value={query.status}><option value="">全部</option><option value="pending-settlement">未结算</option><option value="settled">已结算</option><option value="deleted">已删除</option></select></label>
          </div>
          <div className="correction-query-actions"><button className="query-action query-action--primary" onClick={runQuery} type="button">查询</button><button className="query-action" onClick={prepareInvoice} type="button">合并开票</button><button className="query-action" onClick={prepareInvoice} type="button">按批次开票</button><button className="query-action query-action--danger" onClick={prepareDelete} type="button">删除</button><button className="query-action" onClick={resetQuery} type="button">重置</button></div>
        </section>

        <section aria-label="用邮物品查改结果" className="correction-results">
          <header className="correction-results__summary"><h1>用邮物品销售记录</h1><div><span>销售批次</span><strong>{results.length}</strong><span>有效金额</span><strong>{formatCents(resultTotalCents)}</strong></div></header>
          <div className="correction-table-wrap">
            <table className="correction-table postal-supply-correction__table">
              <thead><tr><th>选择</th><th>序号</th><th>批次查询流水号</th><th>物品名称</th><th>单位</th><th>单价</th><th>销售数量</th><th>销售金额</th><th>修改次数</th><th>销售日期</th><th>收费员工</th><th>台席</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {results.flatMap((sale, saleIndex) => sale.lines.map((line, lineIndex) => (
                  <tr key={`${sale.id}:${line.itemId}`}>
                    <td><input aria-label={`选择用邮物品记录 ${sale.id} ${lineIndex + 1}`} checked={selectedIds.includes(sale.id)} disabled={sale.status === 'deleted'} onChange={() => setSelectedIds((current) => current.includes(sale.id) ? current.filter((id) => id !== sale.id) : [...current, sale.id])} type="checkbox" /></td>
                    <td>{saleIndex + 1}.{lineIndex + 1}</td><td>{sale.id}</td><td><strong>{line.label}</strong><small>{line.mnemonic}</small></td><td>{line.unit}</td><td>{formatCents(line.unitPriceCents)}</td><td>{line.quantity}</td><td>{formatCents(line.amountCents)}</td><td>{sale.revisions?.length ?? 0}</td><td>{displayDateTime(sale.acceptedAt)}</td><td>{sale.operator.displayName}</td><td>{sale.operator.workstationCode}</td><td>{postalSupplySaleStatusLabel(sale.status)}</td><td><button disabled={sale.status !== 'pending-settlement'} onClick={() => openEdit(sale)} type="button">修改</button><button disabled={sale.status === 'deleted'} onClick={() => void openReceipt(sale)} type="button">打印</button></td>
                  </tr>
                )))}
                {appliedQuery && results.length === 0 ? <tr><td className="settlement-empty" colSpan={14}>无数据</td></tr> : null}
              </tbody>
            </table>
          </div>
          {notice ? <p className="customer-notice" role="status">{notice} {appliedQuery ? `共 ${results.length} 笔。` : ''}</p> : null}
          {error && !editing && !supervisorOpen ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      {editing ? (
        <Modal description="仅当天未结算销售允许修改数量；保存后原数量、原金额和修改原因会保留。" eyebrow="用邮物品查改" title={`修改 ${editing.id}`} wide>
          <div className="modal-form postal-supply-correction__edit">
            <table><thead><tr><th>物品名称</th><th>单位</th><th>单价</th><th>原数量</th><th>修改数量</th><th>修改金额</th></tr></thead><tbody>{editing.lines.map((line) => <tr key={line.itemId}><td>{line.label}</td><td>{line.unit}</td><td>{formatCents(line.unitPriceCents)}</td><td>{line.quantity}</td><td><input aria-label={`修改数量 ${line.label}`} min={1} onChange={(event) => setEditQuantities((current) => ({ ...current, [line.itemId]: Number(event.target.value) }))} type="number" value={editQuantities[line.itemId] ?? line.quantity} /></td><td>{formatCents(line.unitPriceCents * (editQuantities[line.itemId] ?? line.quantity))}</td></tr>)}</tbody></table>
            <label><span>修改原因</span><textarea aria-label="用邮物品修改原因" onChange={(event) => { setEditReason(event.target.value); setError('') }} value={editReason} /></label>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setEditing(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void saveRevision()} type="button">保存修改</button></div>
          </div>
        </Modal>
      ) : null}

      {supervisorOpen ? (
        <Modal description="仅当天未结算记录可以删除；删除会释放库存并保留原因和授权人。" eyebrow="用邮物品查改" title="主管授权删除">
          <div className="modal-form supervisor-form"><label><span>删除原因</span><textarea aria-label="用邮物品删除原因" onChange={(event) => { setDeletionReason(event.target.value); setError('') }} value={deletionReason} /></label><label><span>主管工号</span><input aria-label="用邮物品主管工号" onChange={(event) => setSupervisorId(event.target.value)} value={supervisorId} /></label><label><span>主管密码</span><input aria-label="用邮物品主管密码" onChange={(event) => setSupervisorSecret(event.target.value)} type="password" value={supervisorSecret} /></label><p className="service-field-hint">由主管本人现场输入工号和密码；系统不显示或代填。</p>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setSupervisorOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void authorizeDelete()} type="button">授权并删除</button></div></div>
        </Modal>
      ) : null}

      {receipt ? (
        <Modal description="模拟窗口小票；打印动作已写入本地审计。" eyebrow="用邮物品查改" title="用邮物品销售小票" wide>
          <div className="modal-form channel-product-receipt-modal"><article aria-label="用邮物品销售小票" className="channel-product-receipt"><header><strong>{receipt.operator.acceptanceOffice}</strong><span>用邮物品</span></header><dl><div><dt>流水号</dt><dd>{receipt.id}</dd></div><div><dt>客户</dt><dd>{receipt.sender.name || receipt.sender.unit || '零星客户'}</dd></div></dl><table><thead><tr><th>物品名称</th><th>数量</th><th>单价</th><th>金额</th></tr></thead><tbody>{receipt.lines.map((line) => <tr key={line.itemId}><td>{line.label}</td><td>{line.quantity}</td><td>{formatCents(line.unitPriceCents)}</td><td>{formatCents(line.amountCents)}</td></tr>)}</tbody></table><p>合计 <strong>{formatCents(receipt.totalCents)} 元</strong></p><footer><span>收费员：{receipt.operator.displayName}</span><span>台席：{receipt.operator.workstationCode}</span><span>{displayDateTime(receipt.acceptedAt)}</span></footer></article><div className="modal-actions"><button className="secondary-button" onClick={() => setReceipt(null)} type="button">关闭</button><button className="primary-button primary-button--compact" onClick={() => window.print()} type="button">打印</button></div></div>
        </Modal>
      ) : null}

      {invoiceSale?.settlementId && invoiceSettlement ? (
        <InvoiceRegistrationModal amountCents={invoiceSettlement.amountDueCents} defaults={{ buyerType: invoiceSale.sender.unit ? 'organization' : 'individual', buyerName: invoiceSale.sender.unit || invoiceSale.sender.name, taxpayerId: invoiceSale.sender.identityValue, deliveryPhone: invoiceSale.sender.contact, buyerPhone: invoiceSale.sender.contact, deliveryEmail: '', buyerAddress: invoiceSale.sender.detailedAddress, bankName: '', bankAccount: '', reviewer: operator.displayName, remark: `用邮物品结算 ${invoiceSale.settlementId}` }} onClose={() => setInvoiceSale(null)} onSubmit={issueInvoice} sourceLabel={`结算批次 ${invoiceSale.settlementId}`} />
      ) : null}

      {invoiceDeliveryId ? (
        <Modal description="电子发票登记完成。" eyebrow="用邮物品查改" title="是否进行发票交付？"><div className="modal-form invoice-choice"><p>请选择是否立即完成本次发票交付。</p><div className="modal-actions"><button className="secondary-button" onClick={() => void decideInvoiceDelivery(false)} type="button">暂不交付</button><button className="primary-button primary-button--compact" onClick={() => void decideInvoiceDelivery(true)} type="button">立即交付</button></div></div></Modal>
      ) : null}
    </>
  )
}
