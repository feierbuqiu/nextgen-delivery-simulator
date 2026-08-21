import { useEffect, useState } from 'react'

import {
  queryDispatchBagExportTimes,
  queryDispatchMailStatus,
  queryUnhandedDispatchMail,
  type DispatchBagExportTimeQuery,
  type DispatchBagExportTimeRow,
  type DispatchMailStatusQuery,
  type DispatchMailStatusRow,
  type DispatchUnhandedMailQuery,
  type DispatchUnhandedMailRow,
} from '../../domain/service/dispatchInquiry'
import {
  queryDispatchBalanceLedger,
  type DispatchBalanceQuery,
  type DispatchBalanceRow,
} from '../../domain/service/dispatchBalanceReturn'
import { SIMULATED_POST_ROUTES } from '../../domain/service/dispatchRouting'
import {
  businessCalendarDay,
  formatBusinessDateTime,
} from '../../domain/shared/businessTime'
import type { ServiceRepository } from '../../domain/service/repository'
import type { ServiceWorkspaceState } from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface DispatchQueryWorkspaceProps {
  repository: ServiceRepository
  institutionCode: string
  institutionName: string
  onBack: () => void
  now?: Date
}

type QueryTab = 'status' | 'export-time' | 'unhanded' | 'balance'

function localDateValue(date: Date): string {
  return businessCalendarDay(date)
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return formatBusinessDateTime(value)
}

function formatCents(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

function FictionalOrganizationFilters({
  institutionCode,
  institutionName,
}: Pick<DispatchQueryWorkspaceProps, 'institutionCode' | 'institutionName'>) {
  return (
    <>
      <label><span>省公司</span><select aria-label="查询省公司" defaultValue="瀚原分区"><option>瀚原分区</option></select></label>
      <label><span>地市局</span><select aria-label="查询地市局" defaultValue="澜京市"><option>澜京市</option></select></label>
      <label><span>县市局</span><select aria-label="查询县市局" defaultValue="长风区"><option>长风区</option></select></label>
      <label><span>支局</span><select aria-label="查询支局" defaultValue={institutionCode}><option value={institutionCode}>{institutionName}</option></select></label>
    </>
  )
}

export function DispatchQueryWorkspace({
  repository,
  institutionCode,
  institutionName,
  onBack,
  now,
}: DispatchQueryWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [activeTab, setActiveTab] = useState<QueryTab>('status')
  const [statusQuery, setStatusQuery] = useState<DispatchMailStatusQuery>({
    acceptedDate: localDateValue(now ?? new Date()),
    itemNumber: '',
  })
  const [exportQuery, setExportQuery] = useState<DispatchBagExportTimeQuery>({
    manifestTypeTerm: '',
    routeCode: '',
    exportDateFrom: localDateValue(now ?? new Date()),
    exportDateTo: localDateValue(now ?? new Date()),
  })
  const [unhandedQuery, setUnhandedQuery] = useState<DispatchUnhandedMailQuery>({
    acceptedDateFrom: localDateValue(now ?? new Date()),
    acceptedDateTo: localDateValue(now ?? new Date()),
  })
  const [balanceQuery, setBalanceQuery] = useState<DispatchBalanceQuery>({
    institutionCode,
    institutionName,
    acceptedDateFrom: localDateValue(now ?? new Date()),
    acceptedDateTo: localDateValue(now ?? new Date()),
  })
  const [statusRows, setStatusRows] = useState<DispatchMailStatusRow[]>([])
  const [exportRows, setExportRows] = useState<DispatchBagExportTimeRow[]>([])
  const [unhandedRows, setUnhandedRows] = useState<DispatchUnhandedMailRow[]>([])
  const [balanceRows, setBalanceRows] = useState<DispatchBalanceRow[]>([])
  const [detailRow, setDetailRow] = useState<DispatchMailStatusRow | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      const day = localDateValue(now ?? new Date())
      const initialStatus = { acceptedDate: day, itemNumber: '' }
      const initialExport = {
        manifestTypeTerm: '',
        routeCode: '',
        exportDateFrom: day,
        exportDateTo: day,
      }
      const initialUnhanded = { acceptedDateFrom: day, acceptedDateTo: day }
      const initialBalance = {
        institutionCode,
        institutionName,
        acceptedDateFrom: day,
        acceptedDateTo: day,
      }
      setWorkspace(loaded)
      setStatusQuery(initialStatus)
      setExportQuery(initialExport)
      setUnhandedQuery(initialUnhanded)
      setBalanceQuery(initialBalance)
      setStatusRows(queryDispatchMailStatus(loaded, initialStatus, institutionCode))
      setExportRows(queryDispatchBagExportTimes(loaded, initialExport, institutionCode))
      setUnhandedRows(queryUnhandedDispatchMail(loaded, initialUnhanded, institutionCode))
      setBalanceRows(queryDispatchBalanceLedger(loaded, initialBalance))
    })
    return () => {
      active = false
    }
  }, [institutionCode, institutionName, now, repository])

  function runStatusQuery(): void {
    if (!workspace) return
    try {
      const rows = queryDispatchMailStatus(workspace, statusQuery, institutionCode)
      setStatusRows(rows)
      setNotice(`查询完成，共 ${rows.length} 条。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '封发/交接状态查询失败。')
    }
  }

  function runExportQuery(): void {
    if (!workspace) return
    try {
      const rows = queryDispatchBagExportTimes(workspace, exportQuery, institutionCode)
      setExportRows(rows)
      setNotice(`查询完成，共 ${rows.length} 条。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '总包出口时间查询失败。')
    }
  }

  function runUnhandedQuery(): void {
    if (!workspace) return
    try {
      const rows = queryUnhandedDispatchMail(workspace, unhandedQuery, institutionCode)
      setUnhandedRows(rows)
      setNotice(`查询完成，共 ${rows.length} 条。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '未交接邮件查询失败。')
    }
  }

  function runBalanceQuery(): void {
    if (!workspace) return
    try {
      const rows = queryDispatchBalanceLedger(workspace, balanceQuery)
      setBalanceRows(rows)
      setNotice(`查询完成，共 ${rows.length} 条。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '封发平衡台账查询失败。')
    }
  }

  function resetActiveQuery(): void {
    if (!workspace) return
    const day = localDateValue(now ?? new Date())
    setNotice('')
    setError('')
    if (activeTab === 'status') {
      const next = { acceptedDate: day, itemNumber: '' }
      setStatusQuery(next)
      setStatusRows(queryDispatchMailStatus(workspace, next, institutionCode))
    } else if (activeTab === 'export-time') {
      const next = { manifestTypeTerm: '', routeCode: '', exportDateFrom: day, exportDateTo: day }
      setExportQuery(next)
      setExportRows(queryDispatchBagExportTimes(workspace, next, institutionCode))
    } else if (activeTab === 'unhanded') {
      const next = { acceptedDateFrom: day, acceptedDateTo: day }
      setUnhandedQuery(next)
      setUnhandedRows(queryUnhandedDispatchMail(workspace, next, institutionCode))
    } else {
      const next = { institutionCode, institutionName, acceptedDateFrom: day, acceptedDateTo: day }
      setBalanceQuery(next)
      setBalanceRows(queryDispatchBalanceLedger(workspace, next))
    }
  }

  if (!workspace) {
    return <section className="mail-handover mail-handover--loading">正在读取封发查询数据…</section>
  }

  return (
    <>
      <div className="mail-handover dispatch-inquiry">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业工作台</button><span>/</span><span>邮件封发</span><span>/</span><strong>封发查询</strong>
        </div>

        <nav aria-label="封发查询分类" className="dispatch-inquiry__tabs">
          <button aria-current={activeTab === 'status' ? 'page' : undefined} onClick={() => { setActiveTab('status'); setNotice(''); setError('') }} type="button">封发/交接状态查询</button>
          <button aria-current={activeTab === 'export-time' ? 'page' : undefined} onClick={() => { setActiveTab('export-time'); setNotice(''); setError('') }} type="button">总包出口时间查询</button>
          <button aria-current={activeTab === 'unhanded' ? 'page' : undefined} onClick={() => { setActiveTab('unhanded'); setNotice(''); setError('') }} type="button">未交接邮件查询</button>
          <button aria-current={activeTab === 'balance' ? 'page' : undefined} onClick={() => { setActiveTab('balance'); setNotice(''); setError('') }} type="button">封发平衡台账</button>
        </nav>

        {activeTab === 'status' ? (
          <>
            <section aria-label="封发交接状态查询条件" className="mail-handover__query">
              <div className="mail-handover__filters dispatch-inquiry__status-filters">
                <FictionalOrganizationFilters institutionCode={institutionCode} institutionName={institutionName} />
                <label><span>收寄日期</span><input aria-label="状态查询收寄日期" onChange={(event) => setStatusQuery((current) => ({ ...current, acceptedDate: event.target.value }))} type="date" value={statusQuery.acceptedDate} /></label>
                <label><span>邮件号码</span><input aria-label="状态查询邮件号码" onChange={(event) => setStatusQuery((current) => ({ ...current, itemNumber: event.target.value }))} value={statusQuery.itemNumber} /></label>
              </div>
              <div className="mail-handover__actions"><button onClick={runStatusQuery} type="button">查询</button><button onClick={resetActiveQuery} type="button">重置</button></div>
            </section>
            <section aria-label="封发交接状态查询结果" className="mail-handover__results"><header><span>邮件状态</span><strong>{statusRows.length} 条</strong></header><div className="mail-handover__table-wrap"><table className="mail-handover__table dispatch-inquiry__status-table"><thead><tr><th>序号</th><th>业务产品</th><th>邮件号码</th><th>台席</th><th>员工工号</th><th>员工姓名</th><th>寄达局</th><th>件数</th><th>总资费</th><th>班次</th><th>清单种类</th><th>当前状态</th><th>操作</th></tr></thead><tbody>{statusRows.map((row, index) => <tr key={row.key}><td>{index + 1}</td><td>{row.productName}<small>{row.productCode}</small></td><td>{row.itemNumber}</td><td>{row.workstationCode}</td><td>{row.operatorId}</td><td>{row.operatorName}</td><td>{row.destinationOffice || '—'}</td><td>{row.quantity}</td><td>{formatCents(row.postageCents)}</td><td>{row.shift || '—'}</td><td>{row.manifestTypeName || '—'}<small>{row.manifestTypeCode || '—'}</small></td><td><span className={row.currentStatus === '已出口' ? 'mail-handover__status mail-handover__status--received' : row.currentStatus === '未交接' ? 'mail-handover__status mail-handover__status--returned' : 'mail-handover__status mail-handover__status--handed-over'}>{row.currentStatus}</span></td><td><button className="mail-sealing__link-button" onClick={() => setDetailRow(row)} type="button">展开</button></td></tr>)}{statusRows.length === 0 ? <tr><td colSpan={13}>无数据</td></tr> : null}</tbody></table></div></section>
          </>
        ) : activeTab === 'export-time' ? (
          <>
            <section aria-label="总包出口时间查询条件" className="mail-handover__query">
              <div className="mail-handover__filters dispatch-inquiry__export-filters">
                <FictionalOrganizationFilters institutionCode={institutionCode} institutionName={institutionName} />
                <label><span>清单种类</span><input aria-label="出口查询清单种类" onChange={(event) => setExportQuery((current) => ({ ...current, manifestTypeTerm: event.target.value }))} value={exportQuery.manifestTypeTerm} /></label>
                <label><span>邮路代码</span><select aria-label="出口查询邮路代码" onChange={(event) => setExportQuery((current) => ({ ...current, routeCode: event.target.value }))} value={exportQuery.routeCode}><option value="">全部</option>{SIMULATED_POST_ROUTES.map((route) => <option key={route.code} value={route.code}>{route.code} - {route.name}</option>)}</select></label>
                <label className="dispatch-inquiry__date-range"><span>出口日期</span><span><input aria-label="出口查询开始日期" onChange={(event) => setExportQuery((current) => ({ ...current, exportDateFrom: event.target.value }))} type="date" value={exportQuery.exportDateFrom} /><i>至</i><input aria-label="出口查询结束日期" onChange={(event) => setExportQuery((current) => ({ ...current, exportDateTo: event.target.value }))} type="date" value={exportQuery.exportDateTo} /></span></label>
              </div>
              <div className="mail-handover__actions"><button onClick={runExportQuery} type="button">查询</button><button onClick={resetActiveQuery} type="button">重置</button></div>
            </section>
            <section aria-label="总包出口时间查询结果" className="mail-handover__results"><header><span>总包出口信息</span><strong>{exportRows.length} 条</strong></header><div className="mail-handover__table-wrap"><table className="mail-handover__table dispatch-inquiry__export-table"><thead><tr><th>序号</th><th>总包条码</th><th>路单种类</th><th>路单号</th><th>清单种类</th><th>清单号</th><th>确认出口日期</th><th>出口标志</th></tr></thead><tbody>{exportRows.map((row, index) => <tr key={row.key}><td>{index + 1}</td><td>{row.bagBarcode}</td><td>{row.routeKindName}</td><td>{row.routeNumber}<small>{row.routeCode}</small></td><td>{row.manifestTypeName}<small>{row.manifestTypeCode}</small></td><td>{row.manifestNumber}</td><td>{formatDateTime(row.confirmedExportAt)}</td><td><span className={row.exported ? 'mail-handover__status mail-handover__status--received' : 'mail-handover__status mail-handover__status--handed-over'}>{row.exported ? '已出口' : '未出口'}</span></td></tr>)}{exportRows.length === 0 ? <tr><td colSpan={8}>无数据</td></tr> : null}</tbody></table></div></section>
          </>
        ) : activeTab === 'unhanded' ? (
          <>
            <section aria-label="未交接邮件查询条件" className="mail-handover__query">
              <div className="mail-handover__filters dispatch-inquiry__unhanded-filters"><label className="dispatch-inquiry__date-range"><span>收寄日期</span><span><input aria-label="未交接查询开始日期" onChange={(event) => setUnhandedQuery((current) => ({ ...current, acceptedDateFrom: event.target.value }))} type="date" value={unhandedQuery.acceptedDateFrom} /><i>至</i><input aria-label="未交接查询结束日期" onChange={(event) => setUnhandedQuery((current) => ({ ...current, acceptedDateTo: event.target.value }))} type="date" value={unhandedQuery.acceptedDateTo} /></span></label></div>
              <div className="mail-handover__actions"><button onClick={runUnhandedQuery} type="button">查询</button><button onClick={resetActiveQuery} type="button">重置</button></div>
            </section>
            <section aria-label="未交接邮件查询结果" className="mail-handover__results"><header><span>未交接邮件</span><strong>{unhandedRows.length} 条</strong></header><div className="mail-handover__table-wrap"><table className="mail-handover__table dispatch-inquiry__unhanded-table"><thead><tr><th>序号</th><th>邮件号码</th><th>产品代码</th><th>业务产品名称</th><th>封发种类代码</th><th>备注</th><th>寄达局</th><th>收寄员工</th><th>收寄台席</th><th>收寄日期</th><th>保管人</th><th>邮件 ID</th></tr></thead><tbody>{unhandedRows.map((row, index) => <tr key={row.key}><td>{index + 1}</td><td>{row.itemNumber}</td><td>{row.productCode}</td><td>{row.productName}</td><td>{row.manifestTypeCode || '—'}<small>{row.manifestTypeName || '—'}</small></td><td>{row.note || '—'}</td><td>{row.destinationOffice || '—'}</td><td>{row.operatorName}<small>{row.operatorId}</small></td><td>{row.workstationCode}</td><td>{formatDateTime(row.acceptedAt)}</td><td>{row.custodianName}</td><td>{row.mailId}</td></tr>)}{unhandedRows.length === 0 ? <tr><td colSpan={12}>无数据</td></tr> : null}</tbody></table></div></section>
          </>
        ) : (
          <>
            <section aria-label="封发平衡台账查询条件" className="mail-handover__query">
              <div className="mail-handover__filters dispatch-inquiry__balance-filters">
                <label><span>机构名称</span><input aria-label="平衡台账机构名称" readOnly value={balanceQuery.institutionName} /></label>
                <label className="dispatch-inquiry__date-range"><span>收寄日期</span><span><input aria-label="平衡台账开始日期" onChange={(event) => setBalanceQuery((current) => ({ ...current, acceptedDateFrom: event.target.value }))} type="date" value={balanceQuery.acceptedDateFrom} /><i>至</i><input aria-label="平衡台账结束日期" onChange={(event) => setBalanceQuery((current) => ({ ...current, acceptedDateTo: event.target.value }))} type="date" value={balanceQuery.acceptedDateTo} /></span></label>
              </div>
              <div className="mail-handover__actions"><button onClick={runBalanceQuery} type="button">查询</button><button onClick={resetActiveQuery} type="button">重置</button></div>
            </section>
            <section aria-label="封发平衡台账查询结果" className="mail-handover__results"><header><span>封发平衡台账</span><strong>{balanceRows.length} 条</strong></header><div className="mail-handover__table-wrap"><table className="mail-handover__table mail-handover__table--summary dispatch-inquiry__balance-table"><thead><tr><th>序号</th><th>统计日期</th><th>本局收寄件数</th><th>封发总件数</th><th>本局代他局封发件数</th><th>本局出口本局邮件件数</th><th>本局代他局出口件数</th></tr></thead><tbody>{balanceRows.map((row, index) => <tr key={row.statisticsDate}><td>{index + 1}</td><td>{row.statisticsDate}</td><td>{row.localAcceptedItems}</td><td>{row.totalSealedItems}</td><td>{row.sealedForOtherOfficeItems}</td><td>{row.exportedLocalItems}</td><td>{row.exportedForOtherOfficeItems}</td></tr>)}{balanceRows.length === 0 ? <tr><td colSpan={7}>无数据</td></tr> : null}</tbody></table></div></section>
          </>
        )}

        {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
      </div>

      {detailRow ? (
        <Modal description={detailRow.itemNumber} eyebrow="封发/交接状态查询" title="邮件当前保管状态" wide>
          <div className="dispatch-route__detail-grid"><span>收件人姓名</span><strong>{detailRow.recipientName || '—'}</strong><span>当前保管人工号</span><strong>{detailRow.currentCustodianId || '—'}</strong><span>当前保管人姓名</span><strong>{detailRow.currentCustodianName || '—'}</strong><span>当前保管机构</span><strong>{detailRow.currentCustodyOffice || '—'}</strong><span>总包条码</span><strong>{detailRow.bagBarcode || '—'}</strong><span>清单号</span><strong>{detailRow.manifestNumber || '—'}</strong><span>当前状态</span><strong>{detailRow.currentStatus}</strong></div>
          <div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setDetailRow(null)} type="button">关闭</button></div>
        </Modal>
      ) : null}
    </>
  )
}
