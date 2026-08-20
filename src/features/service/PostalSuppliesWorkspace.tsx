import { useEffect, useMemo, useState } from 'react'

import type { CustomerDraft } from '../../domain/customer/types'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import { POSTAL_SUPPLY_ITEMS } from '../../domain/service/seed'
import {
  pendingServiceSummary,
  remainingPostalSupplyStock,
} from '../../domain/service/transactions'
import type {
  PostalSupplyDraftLine,
  PostalSupplyItem,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'
import type { ServiceSummary } from './ServiceIntakePanel'

interface PostalSuppliesWorkspaceProps {
  customerDraft: CustomerDraft
  repository: ServiceRepository
  onOpenSettlement: () => void
  onSummaryChange: (summary: ServiceSummary) => void
}

export function PostalSuppliesWorkspace({
  customerDraft,
  repository,
  onOpenSettlement,
  onSummaryChange,
}: PostalSuppliesWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [lines, setLines] = useState<PostalSupplyDraftLine[]>([])
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSelectedIds, setPickerSelectedIds] = useState<string[]>([])
  const [primaryCategory, setPrimaryCategory] = useState('')
  const [secondaryCategory, setSecondaryCategory] = useState('')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

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

  const primaryCategories = useMemo(
    () => [...new Set(POSTAL_SUPPLY_ITEMS.map((item) => item.primaryCategory))],
    [],
  )
  const secondaryCategories = useMemo(
    () => [...new Set(
      POSTAL_SUPPLY_ITEMS
        .filter((item) => !primaryCategory || item.primaryCategory === primaryCategory)
        .map((item) => item.secondaryCategory),
    )],
    [primaryCategory],
  )
  const pickerItems = useMemo(() => {
    const term = query.trim().toUpperCase()
    return POSTAL_SUPPLY_ITEMS.filter((item) =>
      (!primaryCategory || item.primaryCategory === primaryCategory) &&
      (!secondaryCategory || item.secondaryCategory === secondaryCategory) &&
      (!term ||
        item.label.includes(query.trim()) ||
        item.mnemonic.includes(term)),
    )
  }, [primaryCategory, query, secondaryCategory])

  const lineItems = lines.flatMap((line) => {
    const item = POSTAL_SUPPLY_ITEMS.find((candidate) => candidate.id === line.itemId)
    return item ? [{ line, item }] : []
  })
  const totalCents = lineItems.reduce(
    (total, { line, item }) => total + line.quantity * item.unitPriceCents,
    0,
  )
  const latestSale = workspace?.postalSupplySales.at(-1) ?? null

  function stockFor(item: PostalSupplyItem): number {
    return workspace ? remainingPostalSupplyStock(workspace, item.id) : item.stock
  }

  function openPicker(): void {
    setPickerSelectedIds([])
    setPrimaryCategory('')
    setSecondaryCategory('')
    setQuery('')
    setError('')
    setPickerOpen(true)
  }

  function addPickerSelection(): void {
    if (pickerSelectedIds.length === 0) {
      setError('请至少选择一种用邮物品。')
      return
    }
    setLines((current) => {
      const currentIds = new Set(current.map((line) => line.itemId))
      return [
        ...current,
        ...pickerSelectedIds
          .filter((itemId) => !currentIds.has(itemId))
          .map((itemId) => ({ itemId, quantity: 1 })),
      ]
    })
    setPickerOpen(false)
    setPickerSelectedIds([])
    setNotice('已将选中物品加入销售明细，请核对数量后保存。')
    setError('')
  }

  function updateQuantity(item: PostalSupplyItem, quantity: number): void {
    const remaining = stockFor(item)
    setLines((current) => current.map((line) =>
      line.itemId === item.id
        ? { ...line, quantity: Math.min(Math.max(quantity, 1), remaining) }
        : line,
    ))
    setError('')
    setNotice('')
  }

  function deleteSelected(): void {
    if (selectedLineIds.length === 0) {
      setError('请勾选要删除的销售明细。')
      return
    }
    const selected = new Set(selectedLineIds)
    setLines((current) => current.filter((line) => !selected.has(line.itemId)))
    setSelectedLineIds([])
    setNotice('已删除选中的销售明细。')
    setError('')
  }

  async function saveSale(): Promise<void> {
    if (saving) return
    if (lines.length === 0) {
      setError('请先增加用邮物品。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const accepted = await repository.acceptPostalSupplySale({
        acceptedAt: new Date().toISOString(),
        sender: customerDraft.sender,
        lines,
      })
      setWorkspace(accepted.state)
      setLines([])
      setSelectedLineIds([])
      onSummaryChange(pendingServiceSummary(accepted.state))
      setNotice(`保存成功，销售流水 ${accepted.sale.id} 已进入结算中心。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '用邮物品销售保存失败。')
    } finally {
      setSaving(false)
    }
  }

  if (!workspace) {
    return <section className="postal-supplies postal-supplies--loading">正在读取用邮物品目录…</section>
  }

  return (
    <>
      <section className="postal-supplies" aria-labelledby="postal-supplies-title">
        <div className="section-title-row service-section-title">
          <div>
            <span className="section-caret">⌄</span>
            <strong id="postal-supplies-title">用邮物品销售</strong>
          </div>
          <div className="service-title-actions">
            <span>独立选品 · 保存后统一结算</span>
            <button className="settlement-center-button" onClick={onOpenSettlement} type="button">
              结算中心（{pendingServiceSummary(workspace).count}）
            </button>
          </div>
        </div>

        {latestSale ? (
          <article className="accepted-transaction" aria-label="最近用邮物品销售">
            <div>
              <span className="accepted-transaction__eyebrow">最近销售</span>
              <strong>{latestSale.id}</strong>
              <small>{latestSale.lines.map((line) => `${line.label} × ${line.quantity}`).join('、')}</small>
            </div>
            <div><span>品种数</span><strong>{latestSale.lines.length}</strong></div>
            <div><span>销售金额</span><strong>¥ {formatCents(latestSale.totalCents)}</strong></div>
            <span className={latestSale.status === 'settled' ? 'queue-status queue-status--settled' : 'queue-status'}>
              {latestSale.status === 'settled' ? '已结算' : '待结算'}
            </span>
          </article>
        ) : null}

        <div className="service-family-context" role="note">
          <strong>指南流程</strong>
          <span>点击“增加”打开物品检索，选择品名后回填单位、单价和库存；录入数量并保存，销售流水进入结算中心。</span>
        </div>

        <div className="postal-supplies-actions">
          <button className="secondary-button secondary-button--small" onClick={openPicker} type="button">增加</button>
          <button className="primary-button primary-button--compact" disabled={saving} onClick={() => void saveSale()} type="button">
            {saving ? '正在保存…' : '保存'}
          </button>
          <button className="danger-button" onClick={deleteSelected} type="button">删除</button>
          <span>付费方式：<strong>现结</strong></span>
        </div>

        <div className="settlement-table-wrap">
          <table className="settlement-table postal-supplies-table">
            <thead>
              <tr>
                <th>选择</th><th>物品名称</th><th>助记码</th><th>单位</th>
                <th>单价</th><th>可售库存</th><th>数量</th><th>金额</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map(({ line, item }) => (
                <tr key={item.id}>
                  <td><input aria-label={`选择销售明细 ${item.label}`} checked={selectedLineIds.includes(item.id)} onChange={() => setSelectedLineIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} type="checkbox" /></td>
                  <td><strong>{item.label}</strong><small>{item.primaryCategory} / {item.secondaryCategory}</small></td>
                  <td>{item.mnemonic}</td><td>{item.unit}</td>
                  <td>¥ {formatCents(item.unitPriceCents)}</td><td>{stockFor(item)}</td>
                  <td><input aria-label={`销售数量 ${item.label}`} max={stockFor(item)} min={1} onChange={(event) => updateQuantity(item, Number(event.target.value))} type="number" value={line.quantity} /></td>
                  <td>¥ {formatCents(item.unitPriceCents * line.quantity)}</td>
                </tr>
              ))}
              {lineItems.length === 0 ? <tr><td className="settlement-empty" colSpan={8}>点击“增加”选择用邮物品。</td></tr> : null}
            </tbody>
            <tfoot><tr><td colSpan={7}>销售合计</td><td>¥ {formatCents(totalCents)}</td></tr></tfoot>
          </table>
        </div>
        {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
      </section>

      {pickerOpen ? (
        <Modal
          description="按一级类别、二级类别、物品名称或助记码筛选；目录内容均为脱敏演示品。"
          eyebrow="用邮物品"
          title="物品名称检索"
          wide
        >
          <div className="modal-form postal-supply-picker">
            <div className="postal-supply-picker__filters">
              <label><span>一级类别</span><select aria-label="用邮物品一级类别" onChange={(event) => { setPrimaryCategory(event.target.value); setSecondaryCategory('') }} value={primaryCategory}><option value="">全部</option>{primaryCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label><span>二级类别</span><select aria-label="用邮物品二级类别" onChange={(event) => setSecondaryCategory(event.target.value)} value={secondaryCategory}><option value="">全部</option>{secondaryCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label><span>物品名称 / 助记码</span><input aria-label="用邮物品检索" onChange={(event) => setQuery(event.target.value)} placeholder="输入名称或助记码" value={query} /></label>
            </div>
            <div className="customer-table-wrap">
              <table className="customer-table">
                <thead><tr><th>选择</th><th>一级类别</th><th>二级类别</th><th>物品名称</th><th>助记码</th><th>单位</th><th>单价</th><th>可售库存</th></tr></thead>
                <tbody>
                  {pickerItems.map((item) => (
                    <tr key={item.id}>
                      <td><input aria-label={`选择物品 ${item.label}`} checked={pickerSelectedIds.includes(item.id)} disabled={stockFor(item) === 0} onChange={() => setPickerSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} type="checkbox" /></td>
                      <td>{item.primaryCategory}</td><td>{item.secondaryCategory}</td><td>{item.label}</td><td>{item.mnemonic}</td><td>{item.unit}</td><td>¥ {formatCents(item.unitPriceCents)}</td><td>{stockFor(item)}</td>
                    </tr>
                  ))}
                  {pickerItems.length === 0 ? <tr><td className="settlement-empty" colSpan={8}>没有匹配的物品。</td></tr> : null}
                </tbody>
              </table>
            </div>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => { setPickerOpen(false); setError('') }} type="button">取消</button>
              <button className="primary-button primary-button--compact" onClick={addPickerSelection} type="button">添加</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
