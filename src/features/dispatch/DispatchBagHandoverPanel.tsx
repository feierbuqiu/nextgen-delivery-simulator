import { useEffect, useMemo, useState } from 'react'

import {
  queryDispatchBagsForHandover,
  queryDispatchBagsForReceipt,
  type DispatchBagHandoverQueryStatus,
  type DispatchBagHandoverRow,
  type DispatchBagQuery,
  type DispatchBagReceiptQueryStatus,
} from '../../domain/service/dispatchBagHandover'
import type { ServiceRepository } from '../../domain/service/repository'
import type {
  DispatchBagShift,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import { Modal } from '../../ui/Modal'

interface DispatchBagHandoverPanelProps {
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  institutionCode: string
  activeTab: 'handover' | 'receipt'
  onSwitchTab: (tab: 'loose-handover' | 'loose-receipt' | 'bag-handover' | 'bag-receipt') => void
  onBack: () => void
  canHandOverLoose: boolean
  canProcessReceivedMail: boolean
}

const RECEIVING_OFFICES = [
  { code: '99101001', name: '栖沄邮件处理中心' },
  { code: '99102001', name: '澄野转运中心' },
  { code: '99103001', name: '镜海埠互换中心' },
] as const

function defaultQuery(
  tab: DispatchBagHandoverPanelProps['activeTab'],
  day: string,
): DispatchBagQuery {
  return {
    status: tab === 'handover' ? 'not-handed-over' : 'not-received',
    originOfficeTerm: '',
    manifestTypeTerm: '',
    shift: '',
    sealedDateFrom: day,
    sealedDateTo: day,
  }
}

function displayDateTime(value: string | null): string {
  return value ? value.replace('T', ' ').slice(0, 19) : '—'
}

function isValidDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function DispatchBagHandoverPanel({
  repository,
  operator,
  institutionCode,
  activeTab,
  onSwitchTab,
  onBack,
  canHandOverLoose,
  canProcessReceivedMail,
}: DispatchBagHandoverPanelProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState<DispatchBagQuery>(() =>
    defaultQuery(activeTab, businessCalendarDay(new Date())))
  const [appliedQuery, setAppliedQuery] = useState(query)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [officeOpen, setOfficeOpen] = useState(false)
  const [receivingOfficeCode, setReceivingOfficeCode] = useState('')
  const [shiftAction, setShiftAction] = useState<'receive' | 'transfer' | null>(null)
  const [targetShift, setTargetShift] = useState<DispatchBagShift>('01')
  const [returnOpen, setReturnOpen] = useState(false)
  const [printRows, setPrintRows] = useState<DispatchBagHandoverRow[]>([])

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      const next = defaultQuery(activeTab, businessCalendarDay(new Date()))
      setWorkspace(loaded)
      setQuery(next)
      setAppliedQuery(next)
    })
    return () => { active = false }
  }, [activeTab, repository])

  const rows = useMemo(() => {
    if (!workspace) return []
    return activeTab === 'handover'
      ? queryDispatchBagsForHandover(workspace, appliedQuery, institutionCode)
      : queryDispatchBagsForReceipt(workspace, appliedQuery, institutionCode)
  }, [activeTab, appliedQuery, institutionCode, workspace])
  const selectedRows = rows.filter((row) => selectedIds.includes(row.bag.id))
  const allSelected = rows.length > 0 && selectedRows.length === rows.length
  const handoverStatus = appliedQuery.status as DispatchBagHandoverQueryStatus
  const receiptStatus = appliedQuery.status as DispatchBagReceiptQueryStatus

  function updateQuery<Key extends keyof DispatchBagQuery>(
    key: Key,
    value: DispatchBagQuery[Key],
  ): void {
    setQuery((current) => ({ ...current, [key]: value }))
    setNotice('')
    setError('')
  }

  function switchBagTab(tab: 'handover' | 'receipt'): void {
    onSwitchTab(tab === 'handover' ? 'bag-handover' : 'bag-receipt')
  }

  function runQuery(): void {
    if (!isValidDay(query.sealedDateFrom) || !isValidDay(query.sealedDateTo)) {
      setError('封发日期须按 YYYY-MM-DD 格式填写。')
      return
    }
    if (query.sealedDateFrom > query.sealedDateTo) {
      setError('封发开始日期不能晚于结束日期。')
      return
    }
    setAppliedQuery(structuredClone(query))
    setSelectedIds([])
    setNotice('查询完成。')
    setError('')
  }

  function resetQuery(): void {
    const next = defaultQuery(activeTab, businessCalendarDay(new Date()))
    setQuery(next)
    setAppliedQuery(next)
    setSelectedIds([])
    setNotice('')
    setError('')
  }

  function requireSelection(action: string): boolean {
    if (selectedRows.length > 0) return true
    setError(`请选择需要${action}的总包。`)
    return false
  }

  function toggle(id: string): void {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id])
  }

  function toggleAll(): void {
    setSelectedIds(allSelected ? [] : rows.map((row) => row.bag.id))
  }

  async function handOver(): Promise<void> {
    const office = RECEIVING_OFFICES.find((candidate) => candidate.code === receivingOfficeCode)
    if (!office) {
      setError('请选择总包接收机构。')
      return
    }
    try {
      const result = await repository.executeDispatchBagHandover({
        type: 'hand-over-dispatch-bags',
        bagIds: selectedRows.map((row) => row.bag.id),
        originOfficeCode: institutionCode,
        receivingOfficeCode: office.code,
        receivingOfficeName: office.name,
        performedAt: new Date().toISOString(),
        operator,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setReturnOpen(false)
      setOfficeOpen(false)
      setNotice(`总包交出成功，共 ${result.handovers.length} 袋。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '总包交出失败。')
    }
  }

  async function withdraw(): Promise<void> {
    if (!requireSelection('撤回')) return
    try {
      const result = await repository.executeDispatchBagHandover({
        type: 'withdraw-dispatch-bag-handovers',
        handoverIds: selectedRows.flatMap((row) => row.handover ? [row.handover.id] : []),
        performedAt: new Date().toISOString(),
        operator,
        originOfficeCode: institutionCode,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setNotice(`交出撤回成功，共 ${result.handovers.length} 袋。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '总包撤回失败。')
    }
  }

  async function confirmShift(): Promise<void> {
    if (!shiftAction) return
    try {
      const result = await repository.executeDispatchBagHandover({
        type: shiftAction === 'receive'
          ? 'receive-dispatch-bag-handovers'
          : 'transfer-received-bag-shift',
        handoverIds: selectedRows.flatMap((row) => row.handover ? [row.handover.id] : []),
        shift: targetShift,
        performedAt: new Date().toISOString(),
        operator,
        receivingOfficeCode: institutionCode,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setShiftAction(null)
      setNotice(shiftAction === 'receive'
        ? `总包接收成功，共 ${result.handovers.length} 袋。`
        : `班次转移成功，共 ${result.handovers.length} 袋。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '班次处理失败。')
    }
  }

  async function returnReceived(): Promise<void> {
    if (!requireSelection('退回')) return
    try {
      const result = await repository.executeDispatchBagHandover({
        type: 'return-received-dispatch-bags',
        handoverIds: selectedRows.flatMap((row) => row.handover ? [row.handover.id] : []),
        performedAt: new Date().toISOString(),
        operator,
        receivingOfficeCode: institutionCode,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setNotice(`总包退回成功，共 ${result.handovers.length} 袋。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '总包退回失败。')
    }
  }

  if (!workspace) return <section className="mail-handover mail-handover--loading">正在读取总包交接数据…</section>

  return (
    <>
      <div className="mail-handover dispatch-bag-handover">
        <div className="customer-breadcrumb"><button onClick={onBack} type="button">营业工作台</button><span>/</span><span>邮件封发</span><span>/</span><strong>交接处理</strong></div>
        <nav aria-label="交接处理类别" className="mail-handover__tabs">
          {canHandOverLoose ? <button onClick={() => onSwitchTab('loose-handover')} type="button">散件交出</button> : null}
          {canProcessReceivedMail ? <button onClick={() => onSwitchTab('loose-receipt')} type="button">散件接收</button> : null}
          {canProcessReceivedMail ? <button aria-current={activeTab === 'handover' ? 'page' : undefined} onClick={() => switchBagTab('handover')} type="button">总包交出</button> : null}
          {canProcessReceivedMail ? <button aria-current={activeTab === 'receipt' ? 'page' : undefined} onClick={() => switchBagTab('receipt')} type="button">总包接收</button> : null}
        </nav>

        <section aria-label={activeTab === 'handover' ? '总包交出查询条件' : '总包接收查询条件'} className="mail-handover__query">
          <div className="mail-handover__filters dispatch-bag-handover__filters">
            <fieldset><legend>{activeTab === 'handover' ? '交出标志' : '接收标志'}</legend>{activeTab === 'handover' ? <><label><input checked={query.status === 'not-handed-over'} name="bag-status" onChange={() => updateQuery('status', 'not-handed-over')} type="radio" />未交出</label><label><input checked={query.status === 'handed-over'} name="bag-status" onChange={() => updateQuery('status', 'handed-over')} type="radio" />已交出</label></> : <><label><input checked={query.status === 'not-received'} name="bag-status" onChange={() => updateQuery('status', 'not-received')} type="radio" />未接收</label><label><input checked={query.status === 'received'} name="bag-status" onChange={() => updateQuery('status', 'received')} type="radio" />已接收</label></>}</fieldset>
            <label><span>{activeTab === 'handover' ? '原封发机构' : '原收寄机构'}</span><input aria-label="总包原机构" onChange={(event) => updateQuery('originOfficeTerm', event.target.value)} value={query.originOfficeTerm} /></label>
            <label><span>清单种类</span><input aria-label="总包清单种类" onChange={(event) => updateQuery('manifestTypeTerm', event.target.value)} value={query.manifestTypeTerm} /></label>
            {activeTab === 'handover' ? <label><span>封发班次</span><select aria-label="总包封发班次" onChange={(event) => updateQuery('shift', event.target.value as DispatchBagShift | '')} value={query.shift}><option value="">全部</option><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></label> : null}
            <label className="mail-handover__date-range"><span>{activeTab === 'handover' ? '封发日期' : '原封发日期'}</span><span><input aria-label="总包封发开始日期" onChange={(event) => updateQuery('sealedDateFrom', event.target.value)} type="date" value={query.sealedDateFrom} /><b>至</b><input aria-label="总包封发结束日期" onChange={(event) => updateQuery('sealedDateTo', event.target.value)} type="date" value={query.sealedDateTo} /></span></label>
          </div>
          <div className="mail-handover__actions">
            <button onClick={runQuery} type="button">查询</button>
            {activeTab === 'handover' && handoverStatus === 'not-handed-over' ? <button className="mail-handover__action-primary" onClick={() => { if (requireSelection('交出')) { setReceivingOfficeCode(''); setOfficeOpen(true) } }} type="button">交出</button> : null}
            {activeTab === 'handover' && handoverStatus === 'handed-over' ? <><button className="mail-handover__action-primary" onClick={() => void withdraw()} type="button">撤回</button><button onClick={() => { if (requireSelection('打印')) setPrintRows(selectedRows) }} type="button">打印</button></> : null}
            {activeTab === 'receipt' && receiptStatus === 'not-received' ? <button className="mail-handover__action-primary" onClick={() => { if (requireSelection('接收')) { setTargetShift('01'); setShiftAction('receive') } }} type="button">接收</button> : null}
            {activeTab === 'receipt' && receiptStatus === 'received' ? <><button className="mail-handover__action-primary" onClick={() => { if (requireSelection('转移班次')) { setTargetShift('01'); setShiftAction('transfer') } }} type="button">转移班次</button><button onClick={() => { if (requireSelection('退回')) setReturnOpen(true) }} type="button">退回处理</button></> : null}
            <button onClick={resetQuery} type="button">重置</button>
          </div>
        </section>

        <section aria-label="总包交接查询结果" className="mail-handover__results">
          <header><span>{activeTab === 'handover' ? '总包交出' : '总包接收'}明细</span><strong>{rows.length} 袋</strong></header>
          <div className="mail-handover__table-wrap"><table className="mail-handover__table"><thead><tr><th><input aria-label="选择全部总包" checked={allSelected} onChange={toggleAll} type="checkbox" /></th><th>序号</th><th>清单种类</th><th>清单号码</th><th>封发班次</th><th>总包条码</th><th>件数</th><th>直封</th><th>原封发机构</th><th>接收机构</th><th>状态 / 时间</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.bag.id}><td><input aria-label={`选择总包 ${row.bag.bagBarcode}`} checked={selectedIds.includes(row.bag.id)} onChange={() => toggle(row.bag.id)} type="checkbox" /></td><td>{index + 1}</td><td>{row.bag.manifestTypeName}<small>{row.bag.manifestTypeCode}</small></td><td>{row.bag.manifestNumber}</td><td>{row.handover?.receiptShift ?? row.bag.shift}</td><td>{row.bag.bagBarcode}</td><td>{row.bag.totalItems}</td><td>{row.bag.directSeal ? '是' : '否'}</td><td>{row.handover?.originOfficeName ?? row.bag.generatedBy.acceptanceOffice}</td><td>{row.handover?.receivingOfficeName ?? '—'}</td><td>{row.handover ? `${row.handover.status === 'handed-over' ? '已交出' : '已接收'} ${displayDateTime(row.handover.receivedAt ?? row.handover.handedOverAt)}` : '未交出'}</td></tr>)}{rows.length === 0 ? <tr><td colSpan={11}>无数据</td></tr> : null}</tbody></table></div>
          {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
          {error && !officeOpen && !shiftAction ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      {officeOpen ? <Modal eyebrow="总包交出" title="选择总包接收机构"><div className="modal-form"><label><span>总包接收机构</span><select aria-label="总包接收机构" onChange={(event) => setReceivingOfficeCode(event.target.value)} value={receivingOfficeCode}><option value="">请选择</option>{RECEIVING_OFFICES.map((office) => <option key={office.code} value={office.code}>{office.name}（{office.code}）</option>)}</select></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setOfficeOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void handOver()} type="button">确定</button></div></div></Modal> : null}
      {shiftAction ? <Modal eyebrow={shiftAction === 'receive' ? '总包接收' : '转移班次'} title="选择班次"><div className="modal-form"><label><span>班次</span><select aria-label="总包目标班次" onChange={(event) => setTargetShift(event.target.value as DispatchBagShift)} value={targetShift}><option value="01">01</option><option value="02">02</option></select></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setShiftAction(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void confirmShift()} type="button">确定</button></div></div></Modal> : null}
      {returnOpen ? <Modal eyebrow="总包接收" title="退回处理"><div className="modal-form"><p>确定将所选总包退回原封发机构吗？</p>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setReturnOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void returnReceived()} type="button">确定退回</button></div></div></Modal> : null}
      {printRows.length > 0 ? <Modal eyebrow="总包交出" title="总包交接打印预览"><div className="dispatch-bag-print"><table><thead><tr><th>总包条码</th><th>清单</th><th>接收机构</th><th>件数</th></tr></thead><tbody>{printRows.map((row) => <tr key={row.bag.id}><td>{row.bag.bagBarcode}</td><td>{row.bag.manifestTypeName} / {row.bag.manifestNumber}</td><td>{row.handover?.receivingOfficeName}</td><td>{row.bag.totalItems}</td></tr>)}</tbody></table><div className="modal-actions"><button className="secondary-button" onClick={() => setPrintRows([])} type="button">关闭</button><button className="primary-button primary-button--compact" onClick={() => window.print()} type="button">打印</button></div></div></Modal> : null}
    </>
  )
}
