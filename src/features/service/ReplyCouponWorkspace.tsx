import { useEffect, useMemo, useState } from 'react'

import { formatCents } from '../../domain/service/policy'
import {
  REPLY_COUPON_UNIT_VALUE_CENTS,
  replyCouponEligibleItems,
  replyCouponPlatformLabel,
} from '../../domain/service/replyCoupon'
import type { ServiceRepository } from '../../domain/service/repository'
import { remainingPostalSupplyStock } from '../../domain/service/transactions'
import type {
  PostalSupplyDraftLine,
  PostalSupplyItem,
  ReplyCouponCatalogKind,
  ReplyCouponRedemption,
  ReplyCouponRedemptionStatus,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { CurrencyInput } from '../../ui/CurrencyInput'
import { Modal } from '../../ui/Modal'

interface ReplyCouponWorkspaceProps {
  onBack: () => void
  operator: ServiceOperatorSnapshot
  repository: ServiceRepository
}

type WorkspaceTab = 'redemption' | 'query'
type QueryStatus = 'all' | ReplyCouponRedemptionStatus
type Tender = 'cash' | 'pos' | 'third-party'

function displayDateTime(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 19).replace('T', ' ')
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`
}

function statusLabel(status: ReplyCouponRedemptionStatus): string {
  if (status === 'pending-settlement') return '待结算'
  if (status === 'settled') return '已结算'
  return '已删除'
}

function tenderLabel(tender: ReplyCouponRedemption['tender']): string {
  if (tender === 'cash') return '现金'
  if (tender === 'pos') return 'POS'
  if (tender === 'third-party') return '第三方支付'
  return '—'
}

function currentTimestamp(): string {
  const current = new Date()
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}T${pad(current.getHours())}:${pad(current.getMinutes())}:${pad(current.getSeconds())}.000`
}

export function ReplyCouponWorkspace({
  onBack,
  operator,
  repository,
}: ReplyCouponWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [tab, setTab] = useState<WorkspaceTab>('redemption')
  const [couponCount, setCouponCount] = useState(1)
  const [lines, setLines] = useState<PostalSupplyDraftLine[]>([])
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([])
  const [currentRedemptionId, setCurrentRedemptionId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerCatalog, setPickerCatalog] = useState<ReplyCouponCatalogKind>('communication-ticket')
  const [pickerSelectedIds, setPickerSelectedIds] = useState<string[]>([])
  const [pickerCategory, setPickerCategory] = useState('')
  const [pickerQuery, setPickerQuery] = useState('')
  const [settlementTarget, setSettlementTarget] = useState<ReplyCouponRedemption | null>(null)
  const [receipt, setReceipt] = useState<ReplyCouponRedemption | null>(null)
  const [detail, setDetail] = useState<ReplyCouponRedemption | null>(null)
  const [tender, setTender] = useState<Tender>('cash')
  const [receivedCents, setReceivedCents] = useState<number | null>(null)
  const [paymentCode, setPaymentCode] = useState('')
  const [querySerial, setQuerySerial] = useState('')
  const [queryStatus, setQueryStatus] = useState<QueryStatus>('all')
  const [queried, setQueried] = useState(false)
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

  const eligibleItems = useMemo(() => replyCouponEligibleItems(), [])
  const currentRedemption = workspace?.replyCouponRedemptions.find(
    (redemption) => redemption.id === currentRedemptionId,
  ) ?? null
  const lineItems = lines.flatMap((line) => {
    const item = eligibleItems.find((candidate) => candidate.id === line.itemId)
    return item ? [{ line, item }] : []
  })
  const itemCount = lineItems.reduce((total, { line }) => total + line.quantity, 0)
  const merchandiseTotalCents = lineItems.reduce(
    (total, { line, item }) => total + line.quantity * item.unitPriceCents,
    0,
  )
  const couponMaximumCents = couponCount * REPLY_COUPON_UNIT_VALUE_CENTS
  const discountCents = Math.min(merchandiseTotalCents, couponMaximumCents)
  const amountDueCents = merchandiseTotalCents - discountCents
  const categories = useMemo(
    () => [...new Set(eligibleItems
      .filter((item) => item.replyCouponCatalog === pickerCatalog)
      .map((item) => item.secondaryCategory))],
    [eligibleItems, pickerCatalog],
  )
  const pickerItems = eligibleItems.filter((item) => {
    const term = pickerQuery.trim().toLocaleUpperCase('zh-CN')
    return item.replyCouponCatalog === pickerCatalog &&
      (!pickerCategory || item.secondaryCategory === pickerCategory) &&
      (!term || item.label.toLocaleUpperCase('zh-CN').includes(term) || item.mnemonic.includes(term))
  })
  const queryRows = useMemo(() => {
    if (!queried || !workspace) return []
    const term = querySerial.trim().toLocaleUpperCase('zh-CN')
    return [...workspace.replyCouponRedemptions]
      .filter((redemption) => queryStatus === 'all' || redemption.status === queryStatus)
      .filter((redemption) => !term || [redemption.id, redemption.settlementId ?? '']
        .some((value) => value.toLocaleUpperCase('zh-CN').includes(term)))
      .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))
  }, [queried, querySerial, queryStatus, workspace])

  function stockFor(item: PostalSupplyItem): number {
    if (!workspace) return item.stock
    const reserved = currentRedemption?.status === 'pending-settlement'
      ? currentRedemption.lines.find((line) => line.itemId === item.id)?.quantity ?? 0
      : 0
    return remainingPostalSupplyStock(workspace, item.id) + reserved
  }

  function resetMessages(): void {
    setError('')
    setNotice('')
  }

  function openPicker(): void {
    if (currentRedemption?.status === 'settled' || currentRedemption?.status === 'withdrawn') {
      setLines([])
      setSelectedLineIds([])
      setCouponCount(1)
      setCurrentRedemptionId(null)
    }
    setPickerCatalog('communication-ticket')
    setPickerCategory('')
    setPickerQuery('')
    setPickerSelectedIds([])
    resetMessages()
    setPickerOpen(true)
  }

  function addPickerSelection(): void {
    if (pickerSelectedIds.length === 0) {
      setError('请至少选择一种商品。')
      return
    }
    setLines((current) => {
      const existingIds = new Set(current.map((line) => line.itemId))
      return [...current, ...pickerSelectedIds
        .filter((itemId) => !existingIds.has(itemId))
        .map((itemId) => ({ itemId, quantity: 1 }))]
    })
    setPickerOpen(false)
    setPickerSelectedIds([])
    setError('')
  }

  function updateQuantity(item: PostalSupplyItem, quantity: number): void {
    const normalized = Number.isInteger(quantity) ? quantity : 1
    setLines((current) => current.map((line) => line.itemId === item.id
      ? { ...line, quantity: Math.min(Math.max(normalized, 1), stockFor(item)) }
      : line))
    resetMessages()
  }

  function deleteSelectedLines(): void {
    if (selectedLineIds.length === 0) {
      setError('请勾选需要删除的商品明细。')
      return
    }
    const selected = new Set(selectedLineIds)
    setLines((current) => current.filter((line) => !selected.has(line.itemId)))
    setSelectedLineIds([])
    resetMessages()
  }

  async function saveRedemption(): Promise<void> {
    if (submitting) return
    setSubmitting(true)
    resetMessages()
    try {
      const timestamp = currentTimestamp()
      const result = currentRedemption?.status === 'pending-settlement'
        ? await repository.reviseReplyCouponRedemption({
            redemptionId: currentRedemption.id,
            updatedAt: timestamp,
            couponCount,
            lines,
          })
        : await repository.acceptReplyCouponRedemption({
            acceptedAt: timestamp,
            couponCount,
            lines,
            operator,
          })
      setWorkspace(result.state)
      setCurrentRedemptionId(result.redemption.id)
      setNotice(`保存成功，查询流水号：${result.redemption.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '回信券兑付保存失败。')
    } finally {
      setSubmitting(false)
    }
  }

  function openSettlement(): void {
    if (!currentRedemption || currentRedemption.status !== 'pending-settlement') {
      setError('请先保存待结算的回信券兑付流水。')
      return
    }
    setTender('cash')
    setReceivedCents(currentRedemption.amountDueCents)
    setPaymentCode('')
    resetMessages()
    setSettlementTarget(currentRedemption)
  }

  async function settle(): Promise<void> {
    if (!settlementTarget || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await repository.settleReplyCouponRedemption({
        redemptionId: settlementTarget.id,
        settledAt: currentTimestamp(),
        tender,
        amountReceivedCents: settlementTarget.amountDueCents === 0
          ? 0
          : receivedCents ?? 0,
        paymentCode,
      })
      setWorkspace(result.state)
      setCurrentRedemptionId(result.redemption.id)
      setSettlementTarget(null)
      setReceipt(result.redemption)
      setNotice(`结算成功，结算流水号：${result.settlement.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '回信券兑付结算失败。')
    } finally {
      setSubmitting(false)
    }
  }

  function editRedemption(redemption: ReplyCouponRedemption): void {
    setTab('redemption')
    setCurrentRedemptionId(redemption.id)
    setCouponCount(redemption.couponCount)
    setLines(redemption.lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity })))
    setSelectedLineIds([])
    resetMessages()
  }

  async function withdrawRedemption(redemption: ReplyCouponRedemption): Promise<void> {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await repository.withdrawReplyCouponRedemption({
        redemptionId: redemption.id,
        withdrawnAt: currentTimestamp(),
      })
      setWorkspace(result.state)
      setNotice(`兑付流水 ${redemption.id} 已删除。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '兑付流水删除失败。')
    } finally {
      setSubmitting(false)
    }
  }

  if (!workspace) {
    return <section className="reply-coupon-loading">正在读取回信券兑付数据…</section>
  }

  return (
    <>
      <section className="reply-coupon-workspace">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业渠道</button>
          <span>/</span><span>业务办理</span><span>/</span>
          <strong>国际回信券兑付</strong>
        </div>

        <nav aria-label="国际回信券兑付页签" className="reply-coupon-tabs" role="tablist">
          <button aria-selected={tab === 'redemption'} className={tab === 'redemption' ? 'is-active' : ''} onClick={() => { setTab('redemption'); resetMessages() }} role="tab" type="button">兑付</button>
          <button aria-selected={tab === 'query'} className={tab === 'query' ? 'is-active' : ''} onClick={() => { setTab('query'); resetMessages() }} role="tab" type="button">兑付查改</button>
        </nav>

        {tab === 'redemption' ? (
          <>
            <div className="reply-coupon-summary">
              <div><span>总件数：</span><strong>{itemCount}</strong></div>
              <div><span>总金额：</span><strong>{formatCents(merchandiseTotalCents)}</strong></div>
              <div><span>查询流水号：</span><strong>{currentRedemption?.id ?? ''}</strong></div>
              <button className="reply-coupon-settlement-link" onClick={openSettlement} type="button">&gt;&gt;&gt;&gt;结算中心</button>
            </div>

            <div className="reply-coupon-toolbar">
              <div>
                <button onClick={openPicker} type="button">增加</button>
                <button disabled={submitting} onClick={() => void saveRedemption()} type="button">保存</button>
                <button onClick={deleteSelectedLines} type="button">删除</button>
              </div>
              <div className="reply-coupon-counter">
                <span>国际回信券张数</span>
                <button aria-label="减少回信券张数" disabled={couponCount <= 1} onClick={() => { setCouponCount((count) => Math.max(1, count - 1)); resetMessages() }} type="button">−</button>
                <output aria-label="国际回信券张数">{couponCount}</output>
                <button aria-label="增加回信券张数" onClick={() => { setCouponCount((count) => count + 1); resetMessages() }} type="button">＋</button>
                <strong>¥ {formatCents(couponMaximumCents)}</strong>
              </div>
            </div>

            <div className="reply-coupon-table-wrap">
              <table className="reply-coupon-table">
                <thead><tr><th>选择</th><th>序号</th><th>商品名称</th><th>商品编码</th><th>单价</th><th>库存</th><th>数量</th><th>金额</th></tr></thead>
                <tbody>
                  {lineItems.map(({ line, item }, index) => (
                    <tr key={item.id}>
                      <td><input aria-label={`选择兑付明细 ${item.label}`} checked={selectedLineIds.includes(item.id)} onChange={() => setSelectedLineIds((selected) => selected.includes(item.id) ? selected.filter((id) => id !== item.id) : [...selected, item.id])} type="checkbox" /></td>
                      <td>{index + 1}</td>
                      <td><button className="reply-coupon-product-link" onClick={openPicker} type="button">{item.label}</button></td>
                      <td>{item.mnemonic}</td>
                      <td>{formatCents(item.unitPriceCents)}</td>
                      <td>{stockFor(item)}</td>
                      <td className="reply-coupon-quantity">
                        <button aria-label={`减少${item.label}数量`} disabled={line.quantity <= 1} onClick={() => updateQuantity(item, line.quantity - 1)} type="button">−</button>
                        <input aria-label={`${item.label}数量`} max={stockFor(item)} min="1" onChange={(event) => updateQuantity(item, Number(event.target.value))} type="number" value={line.quantity} />
                        <button aria-label={`增加${item.label}数量`} disabled={line.quantity >= stockFor(item)} onClick={() => updateQuantity(item, line.quantity + 1)} type="button">＋</button>
                      </td>
                      <td>{formatCents(item.unitPriceCents * line.quantity)}</td>
                    </tr>
                  ))}
                  {lineItems.length === 0 ? <tr><td className="reply-coupon-empty" colSpan={8}>请点击“增加”选择商品</td></tr> : null}
                </tbody>
                <tfoot>
                  <tr><td colSpan={6}>合计</td><td>{itemCount}</td><td>{formatCents(merchandiseTotalCents)}</td></tr>
                </tfoot>
              </table>
            </div>
            <div className="reply-coupon-calculation">
              <span>商品合计：¥ {formatCents(merchandiseTotalCents)}</span>
              <span>兑付抵扣：-¥ {formatCents(discountCents)}</span>
              <strong>应收：¥ {formatCents(amountDueCents)}</strong>
            </div>
          </>
        ) : (
          <>
            <section aria-label="兑付查改条件" className="reply-coupon-query">
              <label><span>查询流水号：</span><input aria-label="兑付查询流水号" onChange={(event) => setQuerySerial(event.target.value)} value={querySerial} /></label>
              <label><span>数据状态：</span><select aria-label="兑付数据状态" onChange={(event) => setQueryStatus(event.target.value as QueryStatus)} value={queryStatus}><option value="all">全部</option><option value="pending-settlement">待结算</option><option value="settled">已结算</option><option value="withdrawn">已删除</option></select></label>
              <button onClick={() => { setQueried(true); resetMessages() }} type="button">查询</button>
            </section>
            <div className="reply-coupon-table-wrap reply-coupon-query-table-wrap">
              <table className="reply-coupon-table reply-coupon-query-table">
                <thead><tr><th>序号</th><th>查询流水号</th><th>兑付张数</th><th>商品件数</th><th>商品金额</th><th>抵扣金额</th><th>实收金额</th><th>办理时间</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                  {queryRows.map((redemption, index) => (
                    <tr key={redemption.id}>
                      <td>{index + 1}</td><td>{redemption.id}</td><td>{redemption.couponCount}</td><td>{redemption.itemCount}</td><td>{formatCents(redemption.merchandiseTotalCents)}</td><td>{formatCents(redemption.discountCents)}</td><td>{formatCents(redemption.amountReceivedCents)}</td><td>{displayDateTime(redemption.acceptedAt)}</td><td><span className={`reply-coupon-status reply-coupon-status--${redemption.status}`}>{statusLabel(redemption.status)}</span></td>
                      <td className="reply-coupon-row-actions">
                        <button onClick={() => setDetail(redemption)} type="button">查看</button>
                        {redemption.status === 'pending-settlement' ? <button onClick={() => editRedemption(redemption)} type="button">修改</button> : null}
                        {redemption.status === 'pending-settlement' ? <button disabled={submitting} onClick={() => void withdrawRedemption(redemption)} type="button">删除</button> : null}
                        {redemption.status === 'settled' ? <button onClick={() => setReceipt(redemption)} type="button">凭据打印</button> : null}
                      </td>
                    </tr>
                  ))}
                  {!queried ? <tr><td className="reply-coupon-empty" colSpan={10}>请输入条件后查询</td></tr> : null}
                  {queried && queryRows.length === 0 ? <tr><td className="reply-coupon-empty" colSpan={10}>无数据</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        )}
        {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
        {error && !pickerOpen && !settlementTarget ? <p className="customer-form-error" role="alert">{error}</p> : null}
      </section>

      {pickerOpen ? (
        <Modal eyebrow="商品名称" title="商品选择" wide>
          <div className="modal-form reply-coupon-picker">
            <nav aria-label="回信券可兑商品目录" className="reply-coupon-picker-tabs">
              <button aria-selected={pickerCatalog === 'communication-ticket'} className={pickerCatalog === 'communication-ticket' ? 'is-active' : ''} onClick={() => { setPickerCatalog('communication-ticket'); setPickerCategory(''); setPickerSelectedIds([]) }} role="tab" type="button">商品销售</button>
              <button aria-selected={pickerCatalog === 'postal-card'} className={pickerCatalog === 'postal-card' ? 'is-active' : ''} onClick={() => { setPickerCatalog('postal-card'); setPickerCategory(''); setPickerSelectedIds([]) }} role="tab" type="button">封片卡目录</button>
            </nav>
            <div className="reply-coupon-picker-filters">
              <label><span>商品类别：</span><select aria-label="兑付商品类别" onChange={(event) => setPickerCategory(event.target.value)} value={pickerCategory}><option value="">全部</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label><span>商品名称：</span><input aria-label="兑付商品检索" onChange={(event) => setPickerQuery(event.target.value)} placeholder="名称或助记码" value={pickerQuery} /></label>
            </div>
            <div className="reply-coupon-picker-table-wrap">
              <table className="reply-coupon-table">
                <thead><tr><th>选择</th><th>商品类别</th><th>商品名称</th><th>商品编码</th><th>单位</th><th>单价</th><th>库存</th></tr></thead>
                <tbody>{pickerItems.map((item) => <tr key={item.id}><td><input aria-label={`选择商品 ${item.label}`} checked={pickerSelectedIds.includes(item.id)} disabled={stockFor(item) === 0} onChange={() => setPickerSelectedIds((selected) => selected.includes(item.id) ? selected.filter((id) => id !== item.id) : [...selected, item.id])} type="checkbox" /></td><td>{item.secondaryCategory}</td><td>{item.label}</td><td>{item.mnemonic}</td><td>{item.unit}</td><td>{formatCents(item.unitPriceCents)}</td><td>{stockFor(item)}</td></tr>)}</tbody>
              </table>
            </div>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setPickerOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={addPickerSelection} type="button">添加</button></div>
          </div>
        </Modal>
      ) : null}

      {settlementTarget ? (
        <Modal description={`查询流水号：${settlementTarget.id}`} eyebrow="结算中心" title="国际回信券兑付结算" wide>
          <div className="modal-form reply-coupon-settlement">
            <table className="reply-coupon-table reply-coupon-settlement-table"><thead><tr><th>交易种类</th><th>业务名称</th><th>件数</th><th>金额</th></tr></thead><tbody><tr><td>商品销售</td><td>回信券兑付商品</td><td>{settlementTarget.itemCount}</td><td>¥ {formatCents(settlementTarget.merchandiseTotalCents)}</td></tr><tr><td>其他</td><td>国际回信券兑付抵扣</td><td>{settlementTarget.couponCount}</td><td className="reply-coupon-negative">-¥ {formatCents(settlementTarget.discountCents)}</td></tr></tbody><tfoot><tr><td colSpan={3}>应收金额</td><td>¥ {formatCents(settlementTarget.amountDueCents)}</td></tr></tfoot></table>
            {settlementTarget.amountDueCents === 0 ? <p className="reply-coupon-direct-settlement">无现金金额是否直接结算？</p> : <><div className="reply-coupon-tenders" role="group" aria-label="兑付付款方式"><button aria-pressed={tender === 'cash'} className={tender === 'cash' ? 'is-active' : ''} onClick={() => { setTender('cash'); setReceivedCents(settlementTarget.amountDueCents); setPaymentCode('') }} type="button">现金</button><button aria-pressed={tender === 'pos'} className={tender === 'pos' ? 'is-active' : ''} onClick={() => { setTender('pos'); setReceivedCents(settlementTarget.amountDueCents); setPaymentCode('') }} type="button">POS</button><button aria-pressed={tender === 'third-party'} className={tender === 'third-party' ? 'is-active' : ''} onClick={() => { setTender('third-party'); setReceivedCents(settlementTarget.amountDueCents) }} type="button">第三方支付</button></div><label className="reply-coupon-payment-field"><span>实收金额：</span><CurrencyInput aria-label="兑付实收金额" disabled={tender !== 'cash'} onValueChange={setReceivedCents} valueCents={receivedCents} /></label>{tender === 'third-party' ? <label className="reply-coupon-payment-field"><span>付款码：</span><input aria-label="兑付付款码" autoComplete="off" onChange={(event) => setPaymentCode(event.target.value)} value={paymentCode} /></label> : null}</>}
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setSettlementTarget(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void settle()} type="button">确认结算</button></div>
          </div>
        </Modal>
      ) : null}

      {detail ? <ReplyCouponDetailModal redemption={detail} onClose={() => setDetail(null)} /> : null}
      {receipt ? <ReplyCouponReceiptModal redemption={receipt} onClose={() => setReceipt(null)} /> : null}
    </>
  )
}

function ReplyCouponDetailModal({ redemption, onClose }: { redemption: ReplyCouponRedemption; onClose: () => void }) {
  return (
    <Modal description={`查询流水号：${redemption.id}`} eyebrow="兑付查改" title="兑付明细" wide>
      <div className="modal-form reply-coupon-detail">
        <dl><div><dt>数据状态</dt><dd>{statusLabel(redemption.status)}</dd></div><div><dt>办理时间</dt><dd>{displayDateTime(redemption.acceptedAt)}</dd></div><div><dt>回信券张数</dt><dd>{redemption.couponCount}</dd></div><div><dt>可兑付金额</dt><dd>¥ {formatCents(redemption.couponMaximumCents)}</dd></div><div><dt>商品总金额</dt><dd>¥ {formatCents(redemption.merchandiseTotalCents)}</dd></div><div><dt>抵扣金额</dt><dd>¥ {formatCents(redemption.discountCents)}</dd></div><div><dt>应收金额</dt><dd>¥ {formatCents(redemption.amountDueCents)}</dd></div><div><dt>结算流水号</dt><dd>{redemption.settlementId ?? '—'}</dd></div></dl>
        <table className="reply-coupon-table"><thead><tr><th>商品名称</th><th>商品编码</th><th>单价</th><th>数量</th><th>金额</th></tr></thead><tbody>{redemption.lines.map((line) => <tr key={line.itemId}><td>{line.label}</td><td>{line.productCode}</td><td>{formatCents(line.unitPriceCents)}</td><td>{line.quantity}</td><td>{formatCents(line.amountCents)}</td></tr>)}</tbody></table>
        <div className="modal-actions"><button className="secondary-button" onClick={onClose} type="button">关闭</button></div>
      </div>
    </Modal>
  )
}

function ReplyCouponReceiptModal({ redemption, onClose }: { redemption: ReplyCouponRedemption; onClose: () => void }) {
  return (
    <Modal description={`结算流水号：${redemption.settlementId ?? '—'}`} eyebrow="凭据打印" title="国际回信券兑付凭据">
      <div className="modal-form reply-coupon-receipt">
        <header><strong>本地寄递演练样张 · 无效</strong><span>国际回信券兑付凭据</span></header>
        <dl><div><dt>查询流水号</dt><dd>{redemption.id}</dd></div><div><dt>办理机构</dt><dd>{redemption.operator.acceptanceOffice}</dd></div><div><dt>营业员 / 台席</dt><dd>{redemption.operator.displayName} / {redemption.operator.workstationCode}</dd></div><div><dt>回信券张数</dt><dd>{redemption.couponCount}</dd></div><div><dt>商品件数</dt><dd>{redemption.itemCount}</dd></div><div><dt>商品金额</dt><dd>¥ {formatCents(redemption.merchandiseTotalCents)}</dd></div><div><dt>兑付抵扣</dt><dd>-¥ {formatCents(redemption.discountCents)}</dd></div><div><dt>应收金额</dt><dd>¥ {formatCents(redemption.amountDueCents)}</dd></div><div><dt>实收金额</dt><dd>¥ {formatCents(redemption.amountReceivedCents)}</dd></div><div><dt>找零</dt><dd>¥ {formatCents(redemption.changeCents)}</dd></div><div><dt>付费方式</dt><dd>{tenderLabel(redemption.tender)}{redemption.paymentPlatform ? ` / ${replyCouponPlatformLabel(redemption.paymentPlatform)}` : ''}</dd></div><div><dt>付款码</dt><dd>{redemption.paymentCodeMasked || '—'}</dd></div><div><dt>结算时间</dt><dd>{displayDateTime(redemption.settledAt)}</dd></div><div><dt>结算流水号</dt><dd>{redemption.settlementId ?? '—'}</dd></div></dl>
        <p>本凭据仅用于模拟练习。</p>
        <div className="modal-actions"><button className="secondary-button" onClick={onClose} type="button">关闭</button><button className="primary-button primary-button--compact" onClick={() => window.print()} type="button">打印</button></div>
      </div>
    </Modal>
  )
}
