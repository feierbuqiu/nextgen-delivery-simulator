import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { SIMULATED_POST_ROUTES } from '../../domain/service/dispatchRouting'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import type { ServiceRepository } from '../../domain/service/repository'
import type { ServiceWorkspaceState } from '../../domain/service/types'
import {
  CURRENT_DISPATCH_STATION,
  queryVehicleDispatchControls,
  queryVehicleDispatchOrders,
  queryVehicleDispatchStations,
  type DispatchControlQueryRow,
  type VehicleDispatchOrderQueryRow,
} from '../../domain/service/vehicleDispatchQuery'
import { Modal } from '../../ui/Modal'

interface VehicleDispatchQueryWorkspaceProps {
  repository: ServiceRepository
  onBack: () => void
  now?: Date
}

type VehicleDispatchQueryTab = 'control' | 'dispatch-order'

function displayDateTime(value: string): string {
  return value.slice(0, 19).replace('T', ' ')
}

function Breadcrumb({ onBack }: { onBack: () => void }) {
  return <div className="customer-breadcrumb"><button onClick={onBack} type="button">主页</button><span>/</span><span>查询</span><span>/</span><strong>车辆派车信息查询</strong></div>
}

function ResultFrame({
  children,
  count,
  label,
}: {
  children: ReactNode
  count: number
  label: string
}) {
  return <section aria-label={`${label}结果`} className="channel-query__results relationship-query__results vehicle-dispatch-query__results">
    <div className="channel-query__result-tools"><span>{label}</span><strong>共 {count} 条</strong></div>
    <div className="channel-query__table-wrap">{children}</div>
    <footer className="relationship-query__pager"><button disabled type="button">‹</button><b>1</b><button disabled type="button">›</button><span>跳转至</span><input aria-label={`${label}跳转页码`} disabled value="1" readOnly /><span>页 共 {count} 条 10 条/页</span></footer>
  </section>
}

function EmptyRow({ colSpan, queried }: { colSpan: number; queried: boolean }) {
  return <tr><td className="channel-query__empty" colSpan={colSpan}>{queried ? '无数据' : '请输入条件后查询'}</td></tr>
}

export function VehicleDispatchQueryWorkspace({
  repository,
  onBack,
  now,
}: VehicleDispatchQueryWorkspaceProps) {
  const businessDay = businessCalendarDay(now ?? new Date())
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [activeTab, setActiveTab] = useState<VehicleDispatchQueryTab>('control')
  const [controlRouteCode, setControlRouteCode] = useState('SIM-A01')
  const [controlRows, setControlRows] = useState<DispatchControlQueryRow[]>([])
  const [controlQueried, setControlQueried] = useState(false)
  const [dispatchRouteCode, setDispatchRouteCode] = useState('SIM-A01')
  const [dispatchOrderNumber, setDispatchOrderNumber] = useState('')
  const [dispatchRows, setDispatchRows] = useState<VehicleDispatchOrderQueryRow[]>([])
  const [dispatchQueried, setDispatchQueried] = useState(false)
  const [detailOrder, setDetailOrder] = useState<VehicleDispatchOrderQueryRow | null>(null)
  const [detailRouteDraft, setDetailRouteDraft] = useState('')
  const [detailRouteFilter, setDetailRouteFilter] = useState('')
  const [noDataOpen, setNoDataOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load()
      .then((loaded) => {
        if (active) setWorkspace(loaded)
      })
      .catch(() => {
        if (active) setError('车辆派车信息读取失败。')
      })
    return () => {
      active = false
    }
  }, [repository])

  const detailStations = useMemo(() => (
    detailOrder ? queryVehicleDispatchStations(detailOrder, detailRouteFilter) : []
  ), [detailOrder, detailRouteFilter])

  function switchTab(tab: VehicleDispatchQueryTab): void {
    setActiveTab(tab)
    setError('')
  }

  function runControlQuery(): void {
    try {
      setControlRows(queryVehicleDispatchControls({
        routeCode: controlRouteCode,
        asOf: businessDay,
      }))
      setControlQueried(true)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '解车封车控制信息查询失败。')
    }
  }

  function resetControlQuery(): void {
    setControlRouteCode('')
    setControlRows([])
    setControlQueried(false)
    setError('')
  }

  function runDispatchQuery(): void {
    if (!workspace) return
    try {
      const rows = queryVehicleDispatchOrders(workspace, {
        routeCode: dispatchRouteCode,
        dispatchOrderNumber,
        stationCode: CURRENT_DISPATCH_STATION.code,
        asOf: businessDay,
      })
      setDispatchRows(rows)
      setDispatchQueried(true)
      setNoDataOpen(rows.length === 0)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '车辆派车信息查询失败。')
    }
  }

  function resetDispatchQuery(): void {
    setDispatchRouteCode('')
    setDispatchOrderNumber('')
    setDispatchRows([])
    setDispatchQueried(false)
    setNoDataOpen(false)
    setError('')
  }

  function openDetail(row: VehicleDispatchOrderQueryRow): void {
    setDetailOrder(row)
    setDetailRouteDraft(row.outboundRouteCode)
    setDetailRouteFilter(row.outboundRouteCode)
  }

  if (!workspace) return <p className="channel-query-loading">正在读取车辆派车信息……</p>

  return <>
    <section className="channel-query-workspace relationship-query-workspace vehicle-dispatch-query-workspace">
      <Breadcrumb onBack={onBack} />
      <nav aria-label="车辆派车信息查询页签" className="relationship-query__tabs">
        <button aria-current={activeTab === 'control' ? 'page' : undefined} onClick={() => switchTab('control')} type="button">解车封车控制信息查询</button>
        <button aria-current={activeTab === 'dispatch-order' ? 'page' : undefined} onClick={() => switchTab('dispatch-order')} type="button">车辆派车信息查询</button>
      </nav>

      <datalist id="vehicle-dispatch-route-options">
        {SIMULATED_POST_ROUTES.map((route) => <option key={route.code} value={route.code}>{route.name}</option>)}
      </datalist>

      {activeTab === 'control' ? <>
        <section aria-label="解车封车控制信息查询条件" className="channel-query__filters relationship-query__filters vehicle-dispatch-query__filters--control">
          <label><span>邮路代码</span><input aria-label="解车封车邮路代码" list="vehicle-dispatch-route-options" onChange={(event) => setControlRouteCode(event.target.value)} value={controlRouteCode} /></label>
          <div className="channel-query__actions"><button className="channel-query__primary" onClick={runControlQuery} type="button">查询</button><button onClick={resetControlQuery} type="button">重置</button></div>
        </section>
        <ResultFrame count={controlRows.length} label="解车封车控制信息">
          <table><thead><tr><th>序号</th><th>组开局省份代码</th><th>组开局省份名称</th><th>邮路代码</th><th>邮路名称</th><th>封车入局解车</th><th>删除标志</th><th>生效时间</th><th>失效时间</th><th>更新日期</th></tr></thead><tbody>
            {controlRows.map((row, index) => <tr className={row.valid ? '' : 'vehicle-dispatch-query__row--invalid'} key={row.id}><td>{index + 1}</td><td>{row.openingProvinceCode}</td><td>{row.openingProvinceName}</td><td>{row.routeCode}</td><td>{row.routeName}</td><td>{row.unsealControlRequirement}</td><td>{row.deleted ? '是' : '否'}</td><td>{displayDateTime(row.effectiveAt)}</td><td>{displayDateTime(row.expiresAt)}</td><td>{displayDateTime(row.updatedAt)}</td></tr>)}
            {controlRows.length === 0 ? <EmptyRow colSpan={10} queried={controlQueried} /> : null}
          </tbody></table>
        </ResultFrame>
      </> : <>
        <section aria-label="车辆派车信息查询条件" className="channel-query__filters relationship-query__filters vehicle-dispatch-query__filters--order">
          <label><span>邮路代码</span><input aria-label="车辆派车邮路代码" list="vehicle-dispatch-route-options" onChange={(event) => setDispatchRouteCode(event.target.value)} value={dispatchRouteCode} /></label>
          <label><span>派车单号</span><input aria-label="车辆派车单号" onChange={(event) => setDispatchOrderNumber(event.target.value)} value={dispatchOrderNumber} /></label>
          <label><span>站序代码</span><input aria-label="车辆派车站序代码" readOnly value={CURRENT_DISPATCH_STATION.code} /></label>
          <div className="channel-query__actions"><button className="channel-query__primary" onClick={runDispatchQuery} type="button">查询</button><button onClick={resetDispatchQuery} type="button">重置</button></div>
        </section>
        <p className="vehicle-dispatch-query__notice">注意：派车单号的派车时间在30天以内才生效</p>
        <ResultFrame count={dispatchRows.length} label="车辆派车信息">
          <table><thead><tr><th>序号</th><th>派车单位代码</th><th>派车单号</th><th>路单流水号</th><th>去程邮路代码</th><th>去程邮路名称</th><th>返程邮路代码</th><th>车牌号</th><th>驾驶员</th><th>派车时间</th><th>操作</th></tr></thead><tbody>
            {dispatchRows.map((row, index) => <tr className={row.usable ? '' : 'vehicle-dispatch-query__row--invalid'} key={row.id} title={row.usable ? '派车单有效' : row.unusableReasons.join('；')}><td>{index + 1}</td><td>{row.dispatchingUnitCode}</td><td>{row.dispatchOrderNumber}</td><td>{row.waybillSerialNumber}</td><td>{row.outboundRouteCode}</td><td>{row.outboundRouteName}</td><td>{row.returnRouteCode}</td><td>{row.licensePlate}</td><td>{row.driverName}</td><td>{displayDateTime(row.dispatchedAt)}</td><td><button onClick={() => openDetail(row)} type="button">详情</button></td></tr>)}
            {dispatchRows.length === 0 ? <EmptyRow colSpan={11} queried={dispatchQueried} /> : null}
          </tbody></table>
        </ResultFrame>
      </>}
      {error ? <p className="customer-form-error relationship-query__error" role="alert">{error}</p> : null}
    </section>

    {detailOrder ? <Modal description={`${detailOrder.dispatchOrderNumber} · ${detailOrder.usable ? '派车单有效' : `不可用：${detailOrder.unusableReasons.join('；')}`}`} eyebrow="车辆派车信息查询" title="派车站序详情" wide>
      <div className="modal-form relationship-query__detail vehicle-dispatch-query__detail">
        <section aria-label="派车站序详情查询条件" className="channel-query__filters relationship-query__filters relationship-query__filters--code">
          <label><span>邮路代码</span><input aria-label="派车站序邮路代码" onChange={(event) => setDetailRouteDraft(event.target.value)} value={detailRouteDraft} /></label>
          <div className="channel-query__actions"><button className="channel-query__primary" onClick={() => setDetailRouteFilter(detailRouteDraft)} type="button">查询</button></div>
        </section>
        <div className="channel-query__table-wrap"><table><thead><tr><th>序号</th><th>主返标识</th><th>卸交站名称</th><th>站序序号</th><th>计划到达时间</th><th>计划离开时间</th><th>是否删除</th></tr></thead><tbody>
          {detailStations.map((station, index) => <tr key={station.id}><td>{index + 1}</td><td>{station.direction}</td><td>{station.unloadingStationName}</td><td>{station.stationSequence}</td><td>{displayDateTime(station.plannedArrivalAt)}</td><td>{displayDateTime(station.plannedDepartureAt)}</td><td>{station.deleted ? '是' : '否'}</td></tr>)}
          {detailStations.length === 0 ? <EmptyRow colSpan={7} queried /> : null}
        </tbody></table></div>
        <div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setDetailOrder(null)} type="button">关闭</button></div>
      </div>
    </Modal> : null}

    {noDataOpen ? <Modal compact eyebrow="车辆派车信息查询" title="提示">
      <div className="modal-form vehicle-dispatch-query__message"><p>未查询到45天内的派车信息，请重新输入！</p><div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setNoDataOpen(false)} type="button">确定</button></div></div>
    </Modal> : null}
  </>
}
