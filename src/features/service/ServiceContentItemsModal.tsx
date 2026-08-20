import { useMemo, useState } from 'react'

import { formatCents, serviceContentItemsTotalCents } from '../../domain/service/policy'
import { POSTAL_SUPPLY_ITEMS } from '../../domain/service/seed'
import type { PostalSupplyItem, PostalSupplySaleLine } from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface ServiceContentItemsModalProps {
  initialLines: PostalSupplySaleLine[]
  onCancel: () => void
  onSave: (lines: PostalSupplySaleLine[]) => void
  stockFor: (item: PostalSupplyItem) => number
}

function lineFromItem(
  item: PostalSupplyItem,
  quantity = 1,
): PostalSupplySaleLine {
  return {
    itemId: item.id,
    label: item.label,
    mnemonic: item.mnemonic,
    unit: item.unit,
    unitPriceCents: item.unitPriceCents,
    quantity,
    amountCents: item.unitPriceCents * quantity,
  }
}

export function ServiceContentItemsModal({
  initialLines,
  onCancel,
  onSave,
  stockFor,
}: ServiceContentItemsModalProps) {
  const [mode, setMode] = useState<'lines' | 'catalog'>('lines')
  const [lines, setLines] = useState<PostalSupplySaleLine[]>(() =>
    structuredClone(initialLines),
  )
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([])
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<string[]>([])
  const [primaryCategory, setPrimaryCategory] = useState('')
  const [secondaryCategory, setSecondaryCategory] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

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
  const catalogItems = useMemo(() => {
    const text = query.trim()
    const mnemonic = text.toUpperCase()
    return POSTAL_SUPPLY_ITEMS.filter((item) =>
      (!primaryCategory || item.primaryCategory === primaryCategory) &&
      (!secondaryCategory || item.secondaryCategory === secondaryCategory) &&
      (!text || item.label.includes(text) || item.mnemonic.includes(mnemonic)),
    )
  }, [primaryCategory, query, secondaryCategory])
  const totalQuantity = lines.reduce((total, line) => total + line.quantity, 0)
  const totalCents = serviceContentItemsTotalCents(lines)

  function openCatalog(): void {
    setSelectedCatalogIds([])
    setPrimaryCategory('')
    setSecondaryCategory('')
    setQuery('')
    setError('')
    setMode('catalog')
  }

  function addCatalogSelection(): void {
    if (selectedCatalogIds.length === 0) {
      setError('请至少选择一种物品。')
      return
    }
    setLines((current) => {
      const currentIds = new Set(current.map((line) => line.itemId))
      const additions = POSTAL_SUPPLY_ITEMS
        .filter((item) => selectedCatalogIds.includes(item.id))
        .filter((item) => !currentIds.has(item.id) && stockFor(item) > 0)
        .map((item) => lineFromItem(item))
      return [...current, ...additions]
    })
    setSelectedCatalogIds([])
    setError('')
    setMode('lines')
  }

  function updateQuantity(itemId: string, value: string): void {
    const item = POSTAL_SUPPLY_ITEMS.find((candidate) => candidate.id === itemId)
    if (!item) return
    if (value === '') {
      setLines((current) => current.map((line) =>
        line.itemId === itemId ? { ...line, quantity: 0, amountCents: 0 } : line,
      ))
      return
    }
    const maximum = stockFor(item)
    const quantity = Number(value)
    const nextQuantity = Number.isFinite(quantity)
      ? Math.min(Math.max(Math.trunc(quantity), 1), maximum)
      : 1
    setLines((current) => current.map((line) =>
      line.itemId === itemId ? lineFromItem(item, nextQuantity) : line,
    ))
    setError('')
  }

  function removeLines(itemIds: string[]): void {
    const selected = new Set(itemIds)
    setLines((current) => current.filter((line) => !selected.has(line.itemId)))
    setSelectedLineIds([])
    setError('')
  }

  function deleteSelected(): void {
    if (selectedLineIds.length === 0) {
      setError('请勾选要删除的物品明细。')
      return
    }
    removeLines(selectedLineIds)
  }

  function save(): void {
    if (lines.length === 0) {
      setError('请先增加至少一种物品。')
      return
    }
    for (const line of lines) {
      const item = POSTAL_SUPPLY_ITEMS.find((candidate) => candidate.id === line.itemId)
      if (!item) {
        setError(`未找到物品 ${line.itemId}，请删除后重新选择。`)
        return
      }
      const remaining = stockFor(item)
      if (line.quantity < 1 || line.quantity > remaining) {
        setError(`${item.label}数量须为 1 至 ${remaining} 的整数。`)
        return
      }
    }
    onSave(lines.map((line) => {
      const item = POSTAL_SUPPLY_ITEMS.find((candidate) => candidate.id === line.itemId)!
      return lineFromItem(item, line.quantity)
    }))
  }

  if (mode === 'catalog') {
    return (
      <Modal
        description="按类别、物品名称或助记码检索；所有名称、价格和库存均为脱敏演示数据。"
        eyebrow="用邮物品信息"
        title="物品名称检索"
        wide
      >
        <div className="modal-form postal-supply-picker">
          <div className="postal-supply-picker__filters">
            <label>
              <span>一级类别</span>
              <select
                aria-label="301物品一级类别"
                onChange={(event) => {
                  setPrimaryCategory(event.target.value)
                  setSecondaryCategory('')
                }}
                value={primaryCategory}
              >
                <option value="">全部</option>
                {primaryCategories.map((category) => <option key={category}>{category}</option>)}
              </select>
            </label>
            <label>
              <span>二级类别</span>
              <select
                aria-label="301物品二级类别"
                onChange={(event) => setSecondaryCategory(event.target.value)}
                value={secondaryCategory}
              >
                <option value="">全部</option>
                {secondaryCategories.map((category) => <option key={category}>{category}</option>)}
              </select>
            </label>
            <label>
              <span>物品名称 / 助记码</span>
              <input
                aria-label="301物品检索"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="输入名称或助记码"
                value={query}
              />
            </label>
          </div>
          <div className="customer-table-wrap">
            <table className="customer-table">
              <thead>
                <tr>
                  <th>选择</th><th>一级类别</th><th>二级类别</th><th>物品名称</th>
                  <th>物品简称</th><th>单位</th><th>销售单价</th><th>库存</th>
                </tr>
              </thead>
              <tbody>
                {catalogItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <input
                        aria-label={`选择301物品 ${item.label}`}
                        checked={selectedCatalogIds.includes(item.id)}
                        disabled={stockFor(item) === 0}
                        onChange={() => setSelectedCatalogIds((current) =>
                          current.includes(item.id)
                            ? current.filter((id) => id !== item.id)
                            : [...current, item.id],
                        )}
                        type="checkbox"
                      />
                    </td>
                    <td>{item.primaryCategory}</td><td>{item.secondaryCategory}</td>
                    <td>{item.label}</td><td>{item.mnemonic}</td><td>{item.unit}</td>
                    <td>¥ {formatCents(item.unitPriceCents)}</td><td>{stockFor(item)}</td>
                  </tr>
                ))}
                {catalogItems.length === 0 ? (
                  <tr><td className="settlement-empty" colSpan={8}>没有匹配的物品。</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => { setError(''); setMode('lines') }} type="button">返回</button>
            <button className="primary-button primary-button--compact" onClick={addCatalogSelection} type="button">确定</button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      description="选择具体物品并核对数量；保存后内件信息自动带回邮件受理页。"
      eyebrow="家乡包裹（301）"
      title="用邮物品信息"
      wide
    >
      <div className="modal-form service-content-items">
        <div className="postal-supplies-actions">
          <button className="primary-button primary-button--compact" onClick={save} type="button">保存</button>
          <button className="secondary-button secondary-button--small" onClick={openCatalog} type="button">增加</button>
          <button className="danger-button" onClick={deleteSelected} type="button">删除</button>
        </div>
        <div className="settlement-table-wrap">
          <table className="settlement-table service-content-items__table">
            <thead>
              <tr>
                <th>选择</th><th>序号</th><th>物品名称</th><th>单位</th><th>销售单价</th>
                <th>库存</th><th>数量</th><th>销售金额</th><th>物品简称</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const item = POSTAL_SUPPLY_ITEMS.find((candidate) => candidate.id === line.itemId)
                if (!item) return null
                return (
                  <tr key={line.itemId}>
                    <td>
                      <input
                        aria-label={`选择301明细 ${line.label}`}
                        checked={selectedLineIds.includes(line.itemId)}
                        onChange={() => setSelectedLineIds((current) =>
                          current.includes(line.itemId)
                            ? current.filter((id) => id !== line.itemId)
                            : [...current, line.itemId],
                        )}
                        type="checkbox"
                      />
                    </td>
                    <td>{index + 1}</td><td><strong>{line.label}</strong></td><td>{line.unit}</td>
                    <td>¥ {formatCents(line.unitPriceCents)}</td><td>{stockFor(item)}</td>
                    <td>
                      <input
                        aria-label={`301物品数量 ${line.label}`}
                        max={stockFor(item)}
                        min={1}
                        onChange={(event) => updateQuantity(line.itemId, event.target.value)}
                        type="number"
                        value={line.quantity || ''}
                      />
                    </td>
                    <td>¥ {formatCents(line.amountCents)}</td><td>{line.mnemonic}</td>
                    <td><button className="table-action" onClick={() => removeLines([line.itemId])} type="button">删除</button></td>
                  </tr>
                )
              })}
              {lines.length === 0 ? (
                <tr><td className="settlement-empty" colSpan={10}>点击“增加”选择具体物品。</td></tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr><td colSpan={6}>合计</td><td>{totalQuantity}</td><td>¥ {formatCents(totalCents)}</td><td colSpan={2}>—</td></tr>
            </tfoot>
          </table>
        </div>
        <p className="service-field-hint">物品目录金额随 301 订单明细保存；寄递资费仍由当前业务产品的计费字段决定。</p>
        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel} type="button">取消</button>
        </div>
      </div>
    </Modal>
  )
}
