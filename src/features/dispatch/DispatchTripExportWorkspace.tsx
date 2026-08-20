import { useEffect, useMemo, useState } from 'react'

import type { RequestOnSiteAuthorization } from '../../domain/access/workAuthorization'
import {
  queryCatchupDispatchRoutes,
  queryDispatchVehicleRoutes,
  SIMULATED_POST_ROUTES,
  type DispatchCatchupQuery,
  type DispatchVehicleQuery,
} from '../../domain/service/dispatchRouting'
import {
  businessCalendarDay,
  shiftBusinessCalendarDay,
} from '../../domain/shared/businessTime'
import type { ServiceRepository } from '../../domain/service/repository'
import { serviceOperatorInstitutionCode } from '../../domain/service/institutionScope'
import type {
  DispatchRouteRecord,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface DispatchTripExportWorkspaceProps {
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  onBack: () => void
  authorizeOnSite: RequestOnSiteAuthorization
  now?: Date
}

function previousDay(value: string): string {
  return shiftBusinessCalendarDay(value, -1) || value
}

function defaultVehicleQuery(
  workspace?: ServiceWorkspaceState,
  now = new Date(),
  institutionCode = '',
): DispatchVehicleQuery {
  const routes = (workspace?.dispatchRoutes ?? [])
    .filter((route) => route.deletedAt === null && route.kind !== 'master-route')
    .filter((route) => !institutionCode ||
      serviceOperatorInstitutionCode(route.generatedBy) === institutionCode)
    .sort((left, right) => right.sealingDate.localeCompare(left.sealingDate))
  const latest = routes[0]
  return {
    routeCode: latest?.routeCode ?? '',
    shift: latest?.shift ?? '01',
    handoverDate: businessCalendarDay(now),
    exportStatus: 'not-exported',
  }
}

function routeKindLabel(route: DispatchRouteRecord): string {
  if (route.kind === 'manual-route') return '手工路单'
  if (route.kind === 'container-return') return '容器清退'
  return '路单'
}

export function DispatchTripExportWorkspace({
  repository,
  operator,
  onBack,
  authorizeOnSite,
  now,
}: DispatchTripExportWorkspaceProps) {
  const institutionCode = serviceOperatorInstitutionCode(operator)
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState<DispatchVehicleQuery>(() => defaultVehicleQuery(undefined, now))
  const [appliedQuery, setAppliedQuery] = useState<DispatchVehicleQuery | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [exportStage, setExportStage] = useState<'dispatch-order' | 'authorization' | null>(null)
  const [dispatchOrderNumber, setDispatchOrderNumber] = useState('')
  const [authorizationEmployeeId, setAuthorizationEmployeeId] = useState('')
  const [authorizationSecret, setAuthorizationSecret] = useState('')
  const [catchupOpen, setCatchupOpen] = useState(false)
  const [catchupQuery, setCatchupQuery] = useState<DispatchCatchupQuery>({
    routeCode: '',
    shift: '01',
    sealingDate: previousDay(businessCalendarDay(now ?? new Date())),
  })
  const [catchupRoutes, setCatchupRoutes] = useState<DispatchRouteRecord[]>([])
  const [catchupSelectedIds, setCatchupSelectedIds] = useState<string[]>([])
  const [detailRoute, setDetailRoute] = useState<DispatchRouteRecord | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      const initial = defaultVehicleQuery(loaded, now, institutionCode)
      setWorkspace(loaded)
      setQuery(initial)
      setAppliedQuery(initial.routeCode ? structuredClone(initial) : null)
      setCatchupQuery({
        routeCode: initial.routeCode,
        shift: initial.shift,
        sealingDate: previousDay(initial.handoverDate),
      })
      setLoadError('')
    }).catch(() => {
      if (active) setLoadError('趟车出口数据读取失败，当前页面未进入临时内存模式。')
    })
    return () => {
      active = false
    }
  }, [institutionCode, loadAttempt, now, repository])

  const routes = useMemo(() => {
    if (!workspace || !appliedQuery) return []
    try {
      return queryDispatchVehicleRoutes(workspace, appliedQuery, institutionCode)
    } catch {
      return []
    }
  }, [appliedQuery, institutionCode, workspace])
  const selectedPostRoute = SIMULATED_POST_ROUTES.find((route) => route.code === query.routeCode)
  const allSelected = routes.length > 0 && routes.every((route) => selectedIds.includes(route.id))

  function updateQuery<Key extends keyof DispatchVehicleQuery>(
    key: Key,
    value: DispatchVehicleQuery[Key],
  ): void {
    setQuery((current) => ({ ...current, [key]: value }))
    setNotice('')
    setError('')
  }

  function runQuery(): void {
    if (!workspace) return
    try {
      queryDispatchVehicleRoutes(workspace, query, institutionCode)
      setAppliedQuery(structuredClone(query))
      setSelectedIds([])
      setNotice('查询完成。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '趟车出口查询失败。')
    }
  }

  function resetQuery(): void {
    const next = defaultVehicleQuery(workspace ?? undefined, now, institutionCode)
    setQuery(next)
    setAppliedQuery(next.routeCode ? structuredClone(next) : null)
    setSelectedIds([])
    setNotice('')
    setError('')
  }

  async function performExport(): Promise<void> {
    try {
      const exportedAt = (now ?? new Date()).toISOString()
      const authorization = await authorizeOnSite(
        'export-dispatch-trip',
        authorizationEmployeeId,
        authorizationSecret,
        exportedAt,
      )
      const result = await repository.executeDispatchRouting({
        type: 'export-dispatch-routes',
        routeIds: selectedIds,
        exportDate: query.handoverDate,
        dispatchOrderNumber,
        authorization,
        exportedAt,
        operator,
      })
      setWorkspace(result.state)
      setAppliedQuery(structuredClone(query))
      setSelectedIds([])
      setExportStage(null)
      setDispatchOrderNumber('')
      setAuthorizationSecret('')
      setNotice(`出口成功：已授权并交接 ${result.routes.length} 张路单。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '趟车出口失败。')
    }
  }

  function beginExport(): void {
    if (selectedIds.length === 0) {
      setError('请选择需要出口的路单。')
      return
    }
    setDispatchOrderNumber('')
    setAuthorizationEmployeeId('')
    setAuthorizationSecret('')
    setExportStage(selectedPostRoute?.requiresDispatchOrderNumber
      ? 'dispatch-order'
      : 'authorization')
    setError('')
  }

  function continueToAuthorization(): void {
    if (!dispatchOrderNumber.trim()) {
      setError('请输入派车单号。')
      return
    }
    setExportStage('authorization')
    setError('')
  }

  function openCatchup(): void {
    setCatchupQuery({
      routeCode: query.routeCode,
      shift: query.shift,
      sealingDate: previousDay(query.handoverDate),
    })
    setCatchupRoutes([])
    setCatchupSelectedIds([])
    setCatchupOpen(true)
    setError('')
  }

  function runCatchupQuery(): void {
    if (!workspace) return
    try {
      const rows = queryCatchupDispatchRoutes(workspace, catchupQuery, institutionCode)
      setCatchupRoutes(rows)
      setCatchupSelectedIds([])
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '勾挑路单查询失败。')
    }
  }

  async function receiveCatchup(): Promise<void> {
    try {
      const result = await repository.executeDispatchRouting({
        type: 'receive-catchup-dispatch-routes',
        routeIds: catchupSelectedIds,
        receiptDate: query.handoverDate,
        receivedAt: (now ?? new Date()).toISOString(),
        operator,
      })
      setWorkspace(result.state)
      setAppliedQuery({ ...query, exportStatus: 'not-exported' })
      setQuery((current) => ({ ...current, exportStatus: 'not-exported' }))
      setCatchupOpen(false)
      setSelectedIds([])
      setNotice(`勾挑接收完成：${result.routes.length} 张路单已进入本次出口。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '勾挑路单接收失败。')
    }
  }

  if (!workspace && loadError) {
    return <section aria-label="趟车出口读取异常" className="mail-handover mail-handover--loading">
      <p className="customer-form-error" role="alert">{loadError}</p>
      <button className="secondary-button" onClick={() => { setLoadError(''); setLoadAttempt((attempt) => attempt + 1) }} type="button">重新读取</button>
    </section>
  }

  if (!workspace) {
    return <section className="mail-handover mail-handover--loading">正在读取趟车出口数据…</section>
  }

  return (
    <>
      <div className="mail-handover dispatch-trip-export">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业工作台</button><span>/</span><span>邮件封发</span><span>/</span><strong>趟车出口</strong>
        </div>

        <section aria-label="趟车出口条件" className="mail-handover__query">
          <div className="mail-handover__filters dispatch-trip-export__filters">
            <label><span>邮路代码 <b>*</b></span><select aria-label="出口邮路代码" onChange={(event) => updateQuery('routeCode', event.target.value)} value={query.routeCode}><option value="">请选择</option>{SIMULATED_POST_ROUTES.map((route) => <option key={route.code} value={route.code}>{route.code} - {route.name}</option>)}</select></label>
            <label><span>邮车派押局</span><input aria-label="邮车派押局" readOnly value={selectedPostRoute?.dispatchingOfficeName ?? ''} /></label>
            <label><span>出口标志</span><select aria-label="出口标志" onChange={(event) => updateQuery('exportStatus', event.target.value as DispatchVehicleQuery['exportStatus'])} value={query.exportStatus}><option value="not-exported">未出口</option><option value="exported">已出口</option><option value="all">全部</option></select></label>
            <label><span>交接日期 <b>*</b></span><input aria-label="出口交接日期" onChange={(event) => updateQuery('handoverDate', event.target.value)} type="date" value={query.handoverDate} /></label>
            <label><span>班次 <b>*</b></span><select aria-label="出口班次" onChange={(event) => updateQuery('shift', event.target.value as DispatchVehicleQuery['shift'])} value={query.shift}><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></label>
          </div>
          <div className="mail-handover__actions dispatch-route__actions">
            <button onClick={runQuery} type="button">查询</button>
            <button className="mail-handover__action-primary" onClick={beginExport} type="button">出口交接</button>
            <button onClick={openCatchup} type="button">勾挑路单</button>
            <button onClick={resetQuery} type="button">重置</button>
          </div>
        </section>

        <section aria-label="趟车出口结果" className="mail-handover__results">
          <header><span>路单信息</span><strong>{routes.length} 条</strong></header>
          <div className="mail-handover__table-wrap">
            <table className="mail-handover__table dispatch-trip-export__table">
              <thead><tr><th><input aria-label="选择全部出口路单" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : routes.filter((route) => !route.exportedAt).map((route) => route.id))} type="checkbox" /></th><th>序号</th><th>原寄局</th><th>路单种类</th><th>路单号</th><th>清单种类</th><th>清单号</th><th>封发日期</th><th>班次</th><th>总包接收局</th><th>卸交站</th><th>出口标志</th><th>件数</th><th>操作</th></tr></thead>
              <tbody>{routes.map((route, index) => {
                const postRoute = SIMULATED_POST_ROUTES.find((candidate) => candidate.code === route.routeCode)
                return <tr key={route.id}><td><input aria-label={`选择出口路单 ${route.routeNumber}`} checked={selectedIds.includes(route.id)} disabled={Boolean(route.exportedAt)} onChange={() => setSelectedIds((current) => current.includes(route.id) ? current.filter((id) => id !== route.id) : [...current, route.id])} type="checkbox" /></td><td>{index + 1}</td><td>{route.generatedBy.acceptanceOffice}</td><td>{routeKindLabel(route)}</td><td>{route.routeNumber}</td><td>{route.manifestTypeName}<small>{route.manifestTypeCode}</small></td><td>{route.manifestNumbers.join('、') || '—'}</td><td>{route.sealingDate}</td><td>{route.shift}</td><td>{route.receivingOfficeName || '—'}<small>{route.receivingOfficeCode || '—'}</small></td><td>{postRoute?.unloadingStation ?? '—'}</td><td><span className={route.exportedAt ? 'mail-handover__status mail-handover__status--received' : 'mail-handover__status mail-handover__status--handed-over'}>{route.exportedAt ? '已出口' : '未出口'}</span></td><td>{route.totalItems}<small>{route.totalBags} 袋</small></td><td><button className="mail-sealing__link-button" onClick={() => setDetailRoute(route)} type="button">详情</button></td></tr>
              })}{routes.length === 0 ? <tr><td colSpan={14}>无数据</td></tr> : null}</tbody>
            </table>
          </div>
          {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
          {error && exportStage === null && !catchupOpen ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      {exportStage === 'dispatch-order' ? (
        <Modal description="当前邮路要求采集派车人员提供的派车单号。" eyebrow="趟车出口" title="派车单号采集" compact>
          <div className="modal-form mail-handover__modal-form">
            <label><span>派车单号 *</span><input aria-label="派车单号" autoFocus maxLength={32} onChange={(event) => { setDispatchOrderNumber(event.target.value); setError('') }} value={dispatchOrderNumber} /></label>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setExportStage(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={continueToAuthorization} type="button">确定</button></div>
          </div>
        </Modal>
      ) : null}

      {exportStage === 'authorization' ? (
        <Modal description="出口交接必须由主管现场输入工号和密码授权，系统不自动批准。" eyebrow="趟车出口" title="授权" compact>
          <div className="modal-form mail-handover__modal-form">
            {dispatchOrderNumber ? <p>派车单号：{dispatchOrderNumber}</p> : null}
            <label><span>授权工号 *</span><input aria-label="趟车出口授权工号" autoFocus onChange={(event) => { setAuthorizationEmployeeId(event.target.value); setError('') }} value={authorizationEmployeeId} /></label>
            <label><span>授权密码 *</span><input aria-label="趟车出口授权密码" onChange={(event) => { setAuthorizationSecret(event.target.value); setError('') }} type="password" value={authorizationSecret} /></label>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setExportStage(null); setAuthorizationSecret(''); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void performExport()} type="button">确认授权</button></div>
          </div>
        </Modal>
      ) : null}

      {catchupOpen ? (
        <Modal description="仅接收隔天仍未出口的路单，确认后加入当前交接日期；已勾挑但未在当天出口的路单，需在路单生成页删除后按原封发日重新生成。" eyebrow="趟车出口" title="接收勾挑路单信息" wide>
          <div className="mail-handover__filters dispatch-trip-export__catchup-filters">
            <label><span>封发日期</span><input aria-label="勾挑封发日期" onChange={(event) => setCatchupQuery((current) => ({ ...current, sealingDate: event.target.value }))} type="date" value={catchupQuery.sealingDate} /></label>
            <label><span>班次</span><select aria-label="勾挑班次" onChange={(event) => setCatchupQuery((current) => ({ ...current, shift: event.target.value as DispatchCatchupQuery['shift'] }))} value={catchupQuery.shift}><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></label>
          </div>
          <div className="mail-handover__actions"><button onClick={runCatchupQuery} type="button">查询</button><button className="mail-handover__action-primary" onClick={() => void receiveCatchup()} type="button">确认接收</button></div>
          <div className="dispatch-route__modal-table"><table><thead><tr><th>选择</th><th>路单号</th><th>路单种类</th><th>班次</th><th>卸交站</th><th>接收局</th><th>袋数</th><th>路单 ID</th></tr></thead><tbody>{catchupRoutes.map((route) => { const postRoute = SIMULATED_POST_ROUTES.find((candidate) => candidate.code === route.routeCode); return <tr key={route.id}><td><input aria-label={`选择勾挑路单 ${route.routeNumber}`} checked={catchupSelectedIds.includes(route.id)} onChange={() => setCatchupSelectedIds((current) => current.includes(route.id) ? current.filter((id) => id !== route.id) : [...current, route.id])} type="checkbox" /></td><td>{route.routeNumber}</td><td>{routeKindLabel(route)}</td><td>{route.shift}</td><td>{postRoute?.unloadingStation ?? '—'}</td><td>{route.receivingOfficeName || '—'}</td><td>{route.totalBags}</td><td>{route.id}</td></tr>})}{catchupRoutes.length === 0 ? <tr><td colSpan={8}>无数据</td></tr> : null}</tbody></table></div>
          {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
          <div className="modal-actions"><button className="secondary-button" onClick={() => { setCatchupOpen(false); setError('') }} type="button">关闭</button></div>
        </Modal>
      ) : null}

      {detailRoute ? (
        <Modal description={`路单 ${detailRoute.routeNumber}`} eyebrow="趟车出口" title="路单详情" wide>
          <div className="dispatch-route__detail-grid"><span>邮路</span><strong>{detailRoute.routeCode} - {detailRoute.routeName}</strong><span>清单号</span><strong>{detailRoute.manifestNumbers.join('、') || '—'}</strong><span>封发日期 / 班次</span><strong>{detailRoute.sealingDate} / {detailRoute.shift}</strong><span>勾挑接收</span><strong>{detailRoute.catchupReceivedAt ? `${detailRoute.catchupReceiptDate} ${detailRoute.catchupReceivedBy?.displayName ?? ''}` : '—'}</strong><span>派车单号</span><strong>{detailRoute.dispatchOrderNumber || '—'}</strong><span>授权工号 / 时间</span><strong>{detailRoute.exportAuthorizedBy ? `${detailRoute.exportAuthorizedBy} / ${detailRoute.exportAuthorizedAt ? new Date(detailRoute.exportAuthorizedAt).toLocaleString('zh-CN') : '—'}` : '—'}</strong><span>确认出口时间</span><strong>{detailRoute.exportedAt ? new Date(detailRoute.exportedAt).toLocaleString('zh-CN') : '—'}</strong></div>
          <div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setDetailRoute(null)} type="button">关闭</button></div>
        </Modal>
      ) : null}
    </>
  )
}
