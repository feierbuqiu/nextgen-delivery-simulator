import { useEffect, useMemo, useState } from 'react'

import {
  TRAINING_MANIFEST_TYPE_OPTIONS,
  queryDispatchRoutes,
  queryUngeneratedDispatchBags,
  SIMULATED_CONTAINER_RETURN_STOCK,
  SIMULATED_POST_ROUTES,
  type DispatchRouteQuery,
  type ManualDispatchRouteInput,
} from '../../domain/service/dispatchRouting'
import type { ServiceRepository } from '../../domain/service/repository'
import { serviceOperatorInstitutionCode } from '../../domain/service/institutionScope'
import type {
  DispatchBagRecord,
  DispatchRouteRecord,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import { Modal } from '../../ui/Modal'

interface DispatchRouteWorkspaceProps {
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  onBack: () => void
  onOpenPrint: () => void
  now?: Date
}

interface ManualDraft {
  kind: ManualDispatchRouteInput['kind']
  routeNumber: string
  manifestTypeCode: string
  manifestNumber: string
  directSeal: boolean
  localTransfer: boolean
  receivingOfficeCode: string
  receptacleType: string
  usesBarcodeContainer: boolean
  containerBarcode: string
  totalBags: string
  totalWeightGrams: string
  clearanceQuantities: Record<string, string>
}

function defaultQuery(now = new Date()): DispatchRouteQuery {
  return { routeCode: '', shift: '01', sealingDate: businessCalendarDay(now) }
}

function defaultManualDraft(): ManualDraft {
  return {
    kind: 'manual-route',
    routeNumber: '',
    manifestTypeCode: '',
    manifestNumber: '',
    directSeal: false,
    localTransfer: false,
    receivingOfficeCode: '',
    receptacleType: '1.袋',
    usesBarcodeContainer: false,
    containerBarcode: '',
    totalBags: '1',
    totalWeightGrams: '',
    clearanceQuantities: Object.fromEntries(
      SIMULATED_CONTAINER_RETURN_STOCK.map((stock) => [
        `${stock.containerTypeCode}:${stock.containerModelCode}`,
        '0',
      ]),
    ),
  }
}

function routeKindLabel(route: DispatchRouteRecord): string {
  if (route.kind === 'master-route') return '总路单'
  if (route.kind === 'manual-route') return '手工路单'
  if (route.kind === 'container-return') return '容器清退'
  return '路单'
}

function flagLabel(value: boolean): string {
  return value ? '是' : '否'
}

export function DispatchRouteWorkspace({
  repository,
  operator,
  onBack,
  onOpenPrint,
  now,
}: DispatchRouteWorkspaceProps) {
  const institutionCode = serviceOperatorInstitutionCode(operator)
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState<DispatchRouteQuery>(() => defaultQuery(now))
  const [appliedQuery, setAppliedQuery] = useState<DispatchRouteQuery | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [manualOpen, setManualOpen] = useState(false)
  const [manualDraft, setManualDraft] = useState<ManualDraft>(() => defaultManualDraft())
  const [ungeneratedOpen, setUngeneratedOpen] = useState(false)
  const [ungeneratedEligible, setUngeneratedEligible] = useState<DispatchBagRecord[]>([])
  const [ungeneratedBlocked, setUngeneratedBlocked] = useState<DispatchBagRecord[]>([])
  const [detailRoute, setDetailRoute] = useState<DispatchRouteRecord | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      setQuery(defaultQuery(now))
    })
    return () => {
      active = false
    }
  }, [now, repository])

  const routes = useMemo(() => {
    if (!workspace || !appliedQuery) return []
    try {
      return queryDispatchRoutes(workspace, appliedQuery, institutionCode)
    } catch {
      return []
    }
  }, [appliedQuery, institutionCode, workspace])

  const allSelected = routes.length > 0 && routes.every((route) => selectedIds.includes(route.id))
  const receivingOffices = useMemo(() => {
    const offices = new Map<string, string>()
    for (const bag of workspace?.dispatchBags ?? []) {
      offices.set(bag.receivingOfficeCode, bag.receivingOfficeName)
    }
    return [...offices.entries()].map(([code, name]) => ({ code, name }))
  }, [workspace])

  function updateQuery<Key extends keyof DispatchRouteQuery>(
    key: Key,
    value: DispatchRouteQuery[Key],
  ): void {
    setQuery((current) => ({ ...current, [key]: value }))
    setNotice('')
    setError('')
  }

  function runQuery(): void {
    if (!workspace) return
    try {
      queryDispatchRoutes(workspace, query, institutionCode)
      setAppliedQuery(structuredClone(query))
      setSelectedIds([])
      setNotice('查询完成。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '路单查询失败。')
    }
  }

  async function generateRoutes(): Promise<void> {
    try {
      const result = await repository.executeDispatchRouting({
        type: 'generate-dispatch-routes',
        routeCode: query.routeCode,
        shift: query.shift || '01',
        sealingDate: query.sealingDate,
        generatedAt: new Date().toISOString(),
        operator,
      })
      setWorkspace(result.state)
      setAppliedQuery(structuredClone(query))
      setSelectedIds([])
      if (result.routes.length === 0) {
        const pending = queryUngeneratedDispatchBags(result.state, query, institutionCode)
        setNotice(pending.blockedBags.length > 0
          ? `当前无可生成总包，另有 ${pending.blockedBags.length} 袋仍在交接途中。`
          : '当前条件没有待生成路单的清单。')
      } else {
        const ordinaryCount = result.routes.filter((route) => route.kind !== 'master-route').length
        setNotice(`生成完成：路单 ${ordinaryCount} 张，总路单 1 张。`)
      }
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '路单生成失败。')
    }
  }

  function openUngenerated(): void {
    if (!workspace) return
    try {
      const result = queryUngeneratedDispatchBags(workspace, query, institutionCode)
      setUngeneratedEligible(result.eligibleBags)
      setUngeneratedBlocked(result.blockedBags)
      setUngeneratedOpen(true)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '未生成清单查询失败。')
    }
  }

  function openManual(): void {
    if (!query.routeCode) {
      setError('请先选择邮路代码。')
      return
    }
    setManualDraft(defaultManualDraft())
    setManualOpen(true)
    setError('')
  }

  function updateManual<Key extends keyof ManualDraft>(key: Key, value: ManualDraft[Key]): void {
    setManualDraft((current) => ({ ...current, [key]: value }))
    setError('')
  }

  async function saveManual(): Promise<void> {
    const manifest = manualDraft.kind === 'container-return'
      ? { code: 'container-return', name: '容器清退' }
      : TRAINING_MANIFEST_TYPE_OPTIONS.find(
        (option) => option.code === manualDraft.manifestTypeCode,
      )
    if (!manifest) {
      setError('请选择清单种类。')
      return
    }
    const office = receivingOffices.find((candidate) =>
      candidate.code === manualDraft.receivingOfficeCode)
    const clearanceLines = SIMULATED_CONTAINER_RETURN_STOCK.map((stock) => ({
      ...stock,
      clearanceQuantity: Number(
        manualDraft.clearanceQuantities[
          `${stock.containerTypeCode}:${stock.containerModelCode}`
        ] ?? 0,
      ),
    }))
    try {
      const result = await repository.executeDispatchRouting({
        type: 'add-manual-dispatch-route',
        generatedAt: new Date().toISOString(),
        operator,
        input: {
          kind: manualDraft.kind,
          routeCode: query.routeCode,
          routeNumber: manualDraft.routeNumber,
          manifestTypeCode: manifest.code,
          manifestTypeName: manifest.name,
          manifestNumber: manualDraft.manifestNumber,
          shift: query.shift || '01',
          sealingDate: query.sealingDate,
          directSeal: manualDraft.directSeal,
          localTransfer: manualDraft.localTransfer,
          receivingOfficeCode: office?.code ?? '',
          receivingOfficeName: office?.name ?? '',
          receptacleType: manualDraft.receptacleType,
          usesBarcodeContainer: manualDraft.usesBarcodeContainer,
          containerTypeCode: 'bag',
          containerTypeName: '邮袋',
          containerModelCode: manualDraft.usesBarcodeContainer ? 'standard' : '',
          containerModelName: manualDraft.usesBarcodeContainer ? '标准条码邮袋' : '',
          containerBarcodes: manualDraft.usesBarcodeContainer
            ? [manualDraft.containerBarcode]
            : [],
          containerReturnLines: clearanceLines,
          totalBags: Number(manualDraft.totalBags),
          totalWeightGrams: Number(manualDraft.totalWeightGrams),
        },
      })
      setWorkspace(result.state)
      setAppliedQuery(structuredClone(query))
      setManualOpen(false)
      setNotice(`${routeKindLabel(result.routes[0]!)} ${result.routes[0]!.routeNumber} 已增加。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '手工路单保存失败。')
    }
  }

  async function deleteSelected(): Promise<void> {
    if (selectedIds.length === 0) {
      setError('请选择需要删除的路单。')
      return
    }
    try {
      const result = await repository.executeDispatchRouting({
        type: 'delete-dispatch-routes',
        routeIds: selectedIds,
        deletedAt: new Date().toISOString(),
        operator,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setNotice(`已删除 ${result.routes.length} 条路单记录。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '路单删除失败。')
    }
  }

  if (!workspace) {
    return <section className="mail-handover mail-handover--loading">正在读取路单数据…</section>
  }

  return (
    <>
      <div className="mail-handover dispatch-route">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业工作台</button><span>/</span><span>邮件封发</span><span>/</span><strong>路单生成</strong>
        </div>

        <section aria-label="路单生成条件" className="mail-handover__query">
          <div className="mail-handover__filters dispatch-route__filters">
            <label><span>邮路代码</span><select aria-label="路单邮路代码" onChange={(event) => updateQuery('routeCode', event.target.value)} value={query.routeCode}><option value="">请选择</option>{SIMULATED_POST_ROUTES.map((route) => <option key={route.code} value={route.code}>{route.code} - {route.name}</option>)}</select></label>
            <label><span>班次 <b>*</b></span><select aria-label="路单班次" onChange={(event) => updateQuery('shift', event.target.value as DispatchRouteQuery['shift'])} value={query.shift}><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></label>
            <label><span>封发日期</span><input aria-label="路单封发日期" onChange={(event) => updateQuery('sealingDate', event.target.value)} type="date" value={query.sealingDate} /></label>
          </div>
          <div className="mail-handover__actions dispatch-route__actions">
            <button className="mail-handover__action-primary" onClick={() => void generateRoutes()} type="button">生成路单</button>
            <button onClick={runQuery} type="button">查询</button>
            <button onClick={openManual} type="button">新增</button>
            <button className="mail-handover__action-danger" onClick={() => void deleteSelected()} type="button">删除</button>
            <button onClick={openUngenerated} type="button">查询未生成路单的清单信息</button>
            <button onClick={onOpenPrint} type="button">路单/清单打印</button>
          </div>
        </section>

        <section aria-label="路单生成结果" className="mail-handover__results">
          <header><span>路单信息</span><strong>{routes.length} 条</strong></header>
          <div className="mail-handover__table-wrap">
            <table className="mail-handover__table dispatch-route__table">
              <thead><tr><th><input aria-label="选择全部路单" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : routes.map((route) => route.id))} type="checkbox" /></th><th>序号</th><th>路单种类</th><th>路单号码</th><th>邮路代码</th><th>清单种类</th><th>直封标志</th><th>总包接收局</th><th>总包数</th><th>总重量（克）</th><th>是否出口</th><th>操作</th></tr></thead>
              <tbody>
                {routes.map((route, index) => <tr key={route.id}><td><input aria-label={`选择路单 ${route.routeNumber}`} checked={selectedIds.includes(route.id)} onChange={() => setSelectedIds((current) => current.includes(route.id) ? current.filter((id) => id !== route.id) : [...current, route.id])} type="checkbox" /></td><td>{index + 1}</td><td>{routeKindLabel(route)}<small>{route.source === 'automatic' ? '自动生成' : '手工补录'}</small></td><td>{route.routeNumber}</td><td>{route.routeCode}<small>{route.routeName}</small></td><td>{route.manifestTypeName || '多种清单'}<small>{route.manifestTypeCode || '—'}</small></td><td>{flagLabel(route.directSeal)}</td><td>{route.receivingOfficeName || '—'}<small>{route.receivingOfficeCode || '—'}</small></td><td>{route.totalBags}</td><td>{route.totalWeightGrams}</td><td>{route.exportedAt ? '是' : '否'}</td><td><button className="mail-sealing__link-button" onClick={() => setDetailRoute(route)} type="button">查看</button></td></tr>)}
                {routes.length === 0 ? <tr><td colSpan={12}>无数据</td></tr> : null}
              </tbody>
            </table>
          </div>
          {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
          {error && !manualOpen ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      {ungeneratedOpen ? (
        <Modal description={`可生成 ${ungeneratedEligible.length} 袋，交接途中 ${ungeneratedBlocked.length} 袋。`} eyebrow="路单生成" title="未生成路单的清单信息" wide>
          <div className="dispatch-route__modal-table"><table><thead><tr><th>状态</th><th>总包号</th><th>清单号</th><th>清单种类</th><th>接收局</th><th>当前有效班次</th><th>重量（克）</th></tr></thead><tbody>{ungeneratedEligible.map((bag) => <tr key={bag.id}><td>可生成</td><td>{bag.bagBarcode}</td><td>{bag.manifestNumber}</td><td>{bag.manifestTypeName}</td><td>{bag.receivingOfficeName}</td><td>{query.shift}</td><td>{bag.mailWeightGrams + bag.emptyBagWeightGrams}</td></tr>)}{ungeneratedBlocked.map((bag) => <tr key={bag.id}><td>交接途中</td><td>{bag.bagBarcode}</td><td>{bag.manifestNumber}</td><td>{bag.manifestTypeName}</td><td>{bag.receivingOfficeName}</td><td>{query.shift}</td><td>{bag.mailWeightGrams + bag.emptyBagWeightGrams}</td></tr>)}{ungeneratedEligible.length + ungeneratedBlocked.length === 0 ? <tr><td colSpan={7}>无数据</td></tr> : null}</tbody></table></div>
          <div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setUngeneratedOpen(false)} type="button">关闭</button></div>
        </Modal>
      ) : null}

      {manualOpen ? (
        <Modal description="手工补录不伪造上游总包，仅记录所填数量和重量。" eyebrow="路单生成" title="手工增加路单" wide>
          <div className="modal-form mail-handover__modal-form dispatch-route__manual-form">
            <label><span>路单种类 *</span><select aria-label="手工路单种类" onChange={(event) => updateManual('kind', event.target.value as ManualDraft['kind'])} value={manualDraft.kind}><option value="manual-route">普通路单</option><option value="container-return">容器清退</option></select></label>
            <label><span>路单号</span><input aria-label="手工路单号" onChange={(event) => updateManual('routeNumber', event.target.value)} value={manualDraft.routeNumber} /></label>
            <label><span>清单种类 *</span><select aria-label="手工清单种类" disabled={manualDraft.kind === 'container-return'} onChange={(event) => updateManual('manifestTypeCode', event.target.value)} value={manualDraft.kind === 'container-return' ? 'container-return' : manualDraft.manifestTypeCode}><option value="">请选择</option>{manualDraft.kind === 'container-return' ? <option value="container-return">容器清退</option> : TRAINING_MANIFEST_TYPE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name}（{option.code}）</option>)}</select></label>
            <label><span>清单号</span><input aria-label="手工清单号" inputMode="numeric" maxLength={3} onChange={(event) => updateManual('manifestNumber', event.target.value)} value={manualDraft.manifestNumber} /></label>
            <label><span>直封标志 *</span><select aria-label="手工直封标志" onChange={(event) => updateManual('directSeal', event.target.value === 'yes')} value={manualDraft.directSeal ? 'yes' : 'no'}><option value="no">否</option><option value="yes">是</option></select></label>
            <label><span>接收局</span><select aria-label="手工接收局" onChange={(event) => updateManual('receivingOfficeCode', event.target.value)} value={manualDraft.receivingOfficeCode}><option value="">请选择</option>{receivingOffices.map((office) => <option key={office.code} value={office.code}>{office.name}（{office.code}）</option>)}</select></label>
            <label><span>本转标志 *</span><select aria-label="手工本转标志" onChange={(event) => updateManual('localTransfer', event.target.value === 'yes')} value={manualDraft.localTransfer ? 'yes' : 'no'}><option value="no">否</option><option value="yes">是</option></select></label>
            <label><span>是否条码容器 *</span><select aria-label="手工是否条码容器" onChange={(event) => updateManual('usesBarcodeContainer', event.target.value === 'yes')} value={manualDraft.usesBarcodeContainer ? 'yes' : 'no'}><option value="no">否</option><option value="yes">是</option></select></label>
            <label><span>容器种类 *</span><select aria-label="手工容器种类" onChange={(event) => updateManual('receptacleType', event.target.value)} value={manualDraft.receptacleType}><option value="1.袋">1.袋</option></select></label>
            {manualDraft.usesBarcodeContainer ? <><label><span>容器条码型号 *</span><select aria-label="手工容器条码型号" value="standard"><option value="standard">标准条码邮袋</option></select></label><label><span>容器条码 *</span><select aria-label="手工容器条码" onChange={(event) => updateManual('containerBarcode', event.target.value)} value={manualDraft.containerBarcode}><option value="">请选择</option><option value="9901000000000001">9901000000000001</option><option value="9901000000000002">9901000000000002</option><option value="9901000000000003">9901000000000003</option></select></label></> : null}
            <label><span>总包数量（袋）*</span><input aria-label="手工总包数量" inputMode="numeric" onChange={(event) => updateManual('totalBags', event.target.value)} value={manualDraft.totalBags} /></label>
            <label><span>总包重量（克）*</span><input aria-label="手工总包重量" inputMode="numeric" onChange={(event) => updateManual('totalWeightGrams', event.target.value)} value={manualDraft.totalWeightGrams} /></label>
            {manualDraft.kind === 'container-return' ? <section className="dispatch-route__clearance"><h3>清退容器列表</h3><table><thead><tr><th>容器种类</th><th>容器型号</th><th>库存数量</th><th>清退数量</th></tr></thead><tbody>{SIMULATED_CONTAINER_RETURN_STOCK.map((stock) => { const key = `${stock.containerTypeCode}:${stock.containerModelCode}`; return <tr key={key}><td>{stock.containerTypeName}</td><td>{stock.containerModelName}</td><td>{stock.inventoryQuantity}</td><td><input aria-label={`清退数量 ${stock.containerModelName}`} inputMode="numeric" onChange={(event) => updateManual('clearanceQuantities', { ...manualDraft.clearanceQuantities, [key]: event.target.value })} value={manualDraft.clearanceQuantities[key]} /></td></tr> })}</tbody></table></section> : null}
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setManualOpen(false); setError('') }} type="button">关闭</button><button className="primary-button primary-button--compact" onClick={() => void saveManual()} type="button">增加</button></div>
          </div>
        </Modal>
      ) : null}

      {detailRoute ? (
        <Modal description={`${routeKindLabel(detailRoute)} ${detailRoute.routeNumber}`} eyebrow="路单生成" title="路单明细" wide>
          <div className="dispatch-route__detail-grid"><span>邮路</span><strong>{detailRoute.routeCode} - {detailRoute.routeName}</strong><span>清单号</span><strong>{detailRoute.manifestNumbers.join('、') || '—'}</strong><span>班次 / 日期</span><strong>{detailRoute.shift} / {detailRoute.sealingDate}</strong><span>总包引用</span><strong>{detailRoute.bagIds.join('、') || '手工补录'}</strong><span>容器条码</span><strong>{detailRoute.containerBarcodes.join('、') || '—'}</strong><span>生成员工</span><strong>{detailRoute.generatedBy.displayName}（{detailRoute.generatedBy.operatorId}）</strong></div>
          {detailRoute.containerReturnLines.length > 0 ? <div className="dispatch-route__modal-table"><table><thead><tr><th>容器种类</th><th>型号</th><th>库存</th><th>清退数量</th></tr></thead><tbody>{detailRoute.containerReturnLines.map((line) => <tr key={`${line.containerTypeCode}:${line.containerModelCode}`}><td>{line.containerTypeName}</td><td>{line.containerModelName}</td><td>{line.inventoryQuantity}</td><td>{line.clearanceQuantity}</td></tr>)}</tbody></table></div> : null}
          <div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setDetailRoute(null)} type="button">关闭</button></div>
        </Modal>
      ) : null}
    </>
  )
}
