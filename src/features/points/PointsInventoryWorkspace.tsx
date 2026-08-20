import { useEffect, useMemo, useState } from 'react'

import {
  pointsInventoryMovementKindLabel,
  queryPointsProductInventory,
  type PointsInventoryQuery,
} from '../../domain/service/pointsInventory'
import type { ServiceRepository } from '../../domain/service/repository'
import type {
  PointsInventoryMovementKind,
  PointsProductInventoryItem,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface PointsInventoryWorkspaceProps {
  onBack: () => void
  operator: ServiceOperatorSnapshot
  repository: ServiceRepository
  clock?: () => Date
}

interface AdjustmentTarget {
  product: PointsProductInventoryItem
  kind: PointsInventoryMovementKind
}

const EMPTY_QUERY: PointsInventoryQuery = { barcode: '', productName: '' }

function displayDateTime(value: string): string {
  return value.slice(0, 19).replace('T', ' ')
}

export function PointsInventoryWorkspace({
  onBack,
  operator,
  repository,
  clock = () => new Date(),
}: PointsInventoryWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState<PointsInventoryQuery>(EMPTY_QUERY)
  const [rows, setRows] = useState<PointsProductInventoryItem[]>([])
  const [adjustment, setAdjustment] = useState<AdjustmentTarget | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load()
      .then((loaded) => {
        if (!active) return
        setWorkspace(loaded)
        setRows(queryPointsProductInventory(loaded, EMPTY_QUERY))
      })
      .catch(() => {
        if (active) setError('积分商品库存读取失败。')
      })
    return () => {
      active = false
    }
  }, [repository])

  const recentMovements = useMemo(
    () => [...(workspace?.pointsInventoryMovements ?? [])].reverse().slice(0, 8),
    [workspace],
  )

  function runQuery(nextQuery = query): void {
    if (!workspace) return
    setRows(queryPointsProductInventory(workspace, nextQuery))
    setNotice(`查询完成，共 ${queryPointsProductInventory(workspace, nextQuery).length} 条。`)
    setError('')
  }

  function resetQuery(): void {
    setQuery(EMPTY_QUERY)
    if (workspace) setRows(queryPointsProductInventory(workspace, EMPTY_QUERY))
    setNotice('查询条件已重置。')
    setError('')
  }

  function openAdjustment(
    product: PointsProductInventoryItem,
    kind: PointsInventoryMovementKind,
  ): void {
    setAdjustment({ product, kind })
    setQuantity('1')
    setNotice('')
    setError('')
  }

  async function submitAdjustment(): Promise<void> {
    if (!adjustment) return
    setBusy(true)
    try {
      const result = await repository.executePointsInventory({
        type: 'adjust-points-inventory',
        productId: adjustment.product.id,
        kind: adjustment.kind,
        quantity: Number(quantity),
        operatedAt: clock().toISOString(),
        operator,
      })
      setWorkspace(result.state)
      setRows(queryPointsProductInventory(result.state, query))
      setAdjustment(null)
      setQuantity('1')
      setNotice(`${pointsInventoryMovementKindLabel(result.movement.kind)}成功，库存更新为 ${result.movement.balanceAfter}；模拟同步回执已记录。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '库存处理失败。')
    } finally {
      setBusy(false)
    }
  }

  if (!workspace) {
    return <p className="channel-query-loading">正在读取积分商品库存……</p>
  }

  return <>
    <section className="channel-query-workspace points-inventory-workspace">
      <div className="customer-breadcrumb">
        <button onClick={onBack} type="button">主页</button>
        <span>/</span><span>积分业务</span><span>/</span><strong>商品库存管理</strong>
      </div>

      <section aria-label="积分商品库存说明" className="points-inventory__boundary">
        <strong>网点兑换商品库存</strong>
        <span>本地演练环境不连接任何真实积分商城；每次出入库均保存本地流水和模拟同步回执。</span>
      </section>

      <section aria-label="积分商品库存查询条件" className="channel-query__filters points-inventory__filters">
        <label><span>商品条码</span><input aria-label="积分商品条码" onChange={(event) => setQuery((current) => ({ ...current, barcode: event.target.value }))} placeholder="精确匹配" value={query.barcode} /></label>
        <label><span>商品名称</span><input aria-label="积分商品名称" onChange={(event) => setQuery((current) => ({ ...current, productName: event.target.value }))} placeholder="支持模糊匹配" value={query.productName} /></label>
        <div className="channel-query__actions"><button className="channel-query__primary" onClick={() => runQuery()} type="button">查询</button><button onClick={resetQuery} type="button">重置</button></div>
      </section>

      {notice ? <p className="points-inventory__notice" role="status">{notice}</p> : null}
      {error && !adjustment ? <p className="customer-form-error" role="alert">{error}</p> : null}

      <section aria-label="积分商品库存查询结果" className="channel-query__results points-inventory__results">
        <div className="channel-query__result-tools"><span>商品库存</span><strong>共 {rows.length} 条</strong></div>
        <div className="channel-query__table-wrap"><table><thead><tr><th>序号</th><th>商品编号</th><th>商品条码</th><th>商品名称</th><th>兑换网点</th><th>剩余库存</th><th>操作</th></tr></thead><tbody>
          {rows.map((product, index) => <tr key={product.id}><td>{index + 1}</td><td>{product.productNumber}</td><td>{product.barcode}</td><td>{product.name}</td><td>{product.exchangeOffice}</td><td>{product.quantity}</td><td className="points-inventory__row-actions"><button onClick={() => openAdjustment(product, 'inbound')} type="button">入库</button><button onClick={() => openAdjustment(product, 'outbound')} type="button">退库</button></td></tr>)}
          {rows.length === 0 ? <tr><td className="channel-query__empty" colSpan={7}>无匹配商品</td></tr> : null}
        </tbody></table></div>
      </section>

      <section aria-label="积分商品库存流水" className="channel-query__results points-inventory__ledger">
        <div className="channel-query__result-tools"><span>最近库存流水</span><strong>共 {workspace.pointsInventoryMovements.length} 条</strong></div>
        <div className="channel-query__table-wrap"><table><thead><tr><th>流水号</th><th>商品</th><th>动作</th><th>数量</th><th>处理前</th><th>处理后</th><th>操作时间</th><th>同步状态</th></tr></thead><tbody>
          {recentMovements.map((movement) => <tr key={movement.id}><td>{movement.id}</td><td>{movement.productName}<small>{movement.barcode}</small></td><td>{pointsInventoryMovementKindLabel(movement.kind)}</td><td>{movement.quantity}</td><td>{movement.balanceBefore}</td><td>{movement.balanceAfter}</td><td>{displayDateTime(movement.operatedAt)}</td><td>模拟回执已确认</td></tr>)}
          {recentMovements.length === 0 ? <tr><td className="channel-query__empty" colSpan={8}>暂无出入库流水</td></tr> : null}
        </tbody></table></div>
      </section>
    </section>

    {adjustment ? <Modal compact eyebrow="积分业务 / 商品库存管理" title={`${pointsInventoryMovementKindLabel(adjustment.kind)}申请`}>
      <form className="modal-form points-inventory__modal" onSubmit={(event) => { event.preventDefault(); void submitAdjustment() }}>
        <label><span>商品编号</span><input readOnly value={adjustment.product.productNumber} /></label>
        <label><span>商品条码</span><input readOnly value={adjustment.product.barcode} /></label>
        <label><span>商品名称</span><input readOnly value={adjustment.product.name} /></label>
        <label><span>当前库存</span><input readOnly value={adjustment.product.quantity} /></label>
        <label><span>{pointsInventoryMovementKindLabel(adjustment.kind)}数量</span><input aria-label={`${pointsInventoryMovementKindLabel(adjustment.kind)}数量`} min="1" onChange={(event) => setQuantity(event.target.value)} step="1" type="number" value={quantity} /></label>
        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
        <div className="modal-actions"><button disabled={busy} onClick={() => { setAdjustment(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" disabled={busy} type="submit">提交</button></div>
      </form>
    </Modal> : null}
  </>
}
