import { useEffect, useMemo, useState } from 'react'

import type { InternalHandoverAuthorization } from '../../domain/access/workAuthorization'
import {
  looseMailDisplayNumber,
  queryLooseMailForHandover,
  queryLooseMailForReceipt,
  type LooseMailDispatchQuery,
  type LooseMailDispatchRow,
  type LooseMailHandoverQueryStatus,
  type LooseMailReceiptQueryStatus,
} from '../../domain/service/mailDispatch'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import type {
  LooseMailHandoverRecord,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import {
  businessCalendarDay,
  EAST_EIGHT_TIME_ZONE,
  isValidBusinessCalendarDay,
} from '../../domain/shared/businessTime'
import { Modal } from '../../ui/Modal'
import { DispatchBagHandoverPanel } from './DispatchBagHandoverPanel'

interface MailHandoverWorkspaceProps {
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  institutionCode: string
  onBack: () => void
  now?: Date
  canHandOverLoose: boolean
  canProcessReceivedMail: boolean
  receivingEmployees: Array<{ id: string; name: string }>
  authorizeInternalHandover: (
    receiverId: string,
    secret: string,
    occurredAt: string,
  ) => Promise<InternalHandoverAuthorization>
}

type ActiveHandoverTab = 'handover' | 'receipt'
type HandoverWorkspaceTab =
  | 'loose-handover'
  | 'loose-receipt'
  | 'bag-handover'
  | 'bag-receipt'
type ResultMode = 'detail' | 'summary'

interface ReceivingOfficeOption {
  code: string
  name: string
  internal: boolean
}

const CROSS_OFFICES: ReceivingOfficeOption[] = [
  { code: '99101001', name: '栖沄邮件处理中心', internal: false },
  { code: '99102001', name: '澄野转运中心', internal: false },
  { code: '99103001', name: '镜海埠互换中心', internal: false },
]

function defaultDateRange(now = new Date()): { from: string; to: string } {
  const day = businessCalendarDay(now)
  return { from: day, to: day }
}

function defaultQuery(tab: ActiveHandoverTab, now = new Date()): LooseMailDispatchQuery {
  const range = defaultDateRange(now)
  return {
    status: tab === 'handover' ? 'not-handed-over' : 'not-received',
    productTerm: '',
    note: '',
    acceptedDateFrom: range.from,
    acceptedDateTo: range.to,
  }
}

function displayDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').slice(0, 19)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: EAST_EIGHT_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)
  return `${businessCalendarDay(date)} ${time}`
}

function isValidDay(value: string): boolean {
  return isValidBusinessCalendarDay(value)
}

function statusLabel(record: LooseMailHandoverRecord | null): string {
  if (!record) return '未交出'
  if (record.status === 'handed-over') return '已交出待接收'
  if (record.status === 'received') return '已接收'
  return '已退回'
}

function rowSelectionId(row: LooseMailDispatchRow): string {
  return row.handover?.id ?? row.transaction.id
}

function groupRows(rows: LooseMailDispatchRow[]) {
  const grouped = new Map<string, {
    key: string
    productLabel: string
    productCode: string
    effectiveBusinessCode: string
    count: number
    postageCents: number
  }>()
  for (const row of rows) {
    const key = row.transaction.product.effectiveBusinessCode
    const current = grouped.get(key)
    if (current) {
      current.count += 1
      current.postageCents += row.transaction.charge.postageCents
    } else {
      grouped.set(key, {
        key,
        productLabel: row.transaction.product.label,
        productCode: row.transaction.product.searchCode,
        effectiveBusinessCode: row.transaction.product.effectiveBusinessCode,
        count: 1,
        postageCents: row.transaction.charge.postageCents,
      })
    }
  }
  return [...grouped.values()]
}

export function MailHandoverWorkspace({
  repository,
  operator,
  institutionCode,
  onBack,
  now,
  canHandOverLoose,
  canProcessReceivedMail,
  receivingEmployees,
  authorizeInternalHandover,
}: MailHandoverWorkspaceProps) {
  const initialTab: ActiveHandoverTab = canHandOverLoose ? 'handover' : 'receipt'
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveHandoverTab>(initialTab)
  const [workspaceTab, setWorkspaceTab] = useState<HandoverWorkspaceTab>(
    initialTab === 'handover' ? 'loose-handover' : 'loose-receipt',
  )
  const [query, setQuery] = useState<LooseMailDispatchQuery>(() => defaultQuery(initialTab, now))
  const [appliedQuery, setAppliedQuery] = useState<LooseMailDispatchQuery>(() => defaultQuery(initialTab, now))
  const [resultMode, setResultMode] = useState<ResultMode>('detail')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [electronicPickOpen, setElectronicPickOpen] = useState(false)
  const [electronicPickValue, setElectronicPickValue] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchFrom, setBatchFrom] = useState('1')
  const [batchTo, setBatchTo] = useState('1')
  const [handoverOpen, setHandoverOpen] = useState(false)
  const [receivingOfficeCode, setReceivingOfficeCode] = useState('')
  const [receivingEmployeeId, setReceivingEmployeeId] = useState('')
  const [authorizationSecret, setAuthorizationSecret] = useState('')
  const [handoverNote, setHandoverNote] = useState('')
  const [changeOfficeOpen, setChangeOfficeOpen] = useState(false)
  const [changedOfficeCode, setChangedOfficeCode] = useState('')
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnNote, setReturnNote] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      const nextQuery = defaultQuery(initialTab, now)
      setWorkspace(loaded)
      setQuery(nextQuery)
      setAppliedQuery(nextQuery)
    })
    return () => {
      active = false
    }
  }, [initialTab, now, repository])

  const officeOptions = useMemo<ReceivingOfficeOption[]>(() => [
    { code: institutionCode, name: operator.acceptanceOffice, internal: true },
    ...CROSS_OFFICES,
  ], [institutionCode, operator.acceptanceOffice])

  const results = useMemo(() => {
    if (!workspace) return []
    return activeTab === 'handover'
      ? queryLooseMailForHandover(workspace, appliedQuery, institutionCode)
      : queryLooseMailForReceipt(workspace, appliedQuery, institutionCode)
  }, [activeTab, appliedQuery, institutionCode, workspace])
  const summaries = useMemo(() => groupRows(results), [results])
  const selectedRows = results.filter((row) => selectedIds.includes(rowSelectionId(row)))
  const allSelected = results.length > 0 && results.every(
    (row) => selectedIds.includes(rowSelectionId(row)),
  )
  const currentOffice = officeOptions.find((office) => office.code === receivingOfficeCode)
  const selectedEmployee = receivingEmployees.find(
    (employee) => employee.id === receivingEmployeeId,
  )

  function updateQuery<K extends keyof LooseMailDispatchQuery>(
    field: K,
    value: LooseMailDispatchQuery[K],
  ): void {
    setQuery((current) => ({ ...current, [field]: value }))
    setNotice('')
    setError('')
  }

  function switchTab(tab: ActiveHandoverTab): void {
    if ((tab === 'handover' && !canHandOverLoose) ||
        (tab === 'receipt' && !canProcessReceivedMail)) return
    const next = {
      ...query,
      status: tab === 'handover' ? 'not-handed-over' as const : 'not-received' as const,
    }
    setActiveTab(tab)
    setWorkspaceTab(tab === 'handover' ? 'loose-handover' : 'loose-receipt')
    setQuery(next)
    setAppliedQuery(next)
    setResultMode('detail')
    setSelectedIds([])
    setNotice('')
    setError('')
  }

  function switchWorkspaceTab(tab: HandoverWorkspaceTab): void {
    if (tab === 'loose-handover' && !canHandOverLoose) return
    if (tab !== 'loose-handover' && !canProcessReceivedMail) return
    if (tab === 'loose-handover' || tab === 'loose-receipt') {
      switchTab(tab === 'loose-handover' ? 'handover' : 'receipt')
      return
    }
    setWorkspaceTab(tab)
    setSelectedIds([])
    setNotice('')
    setError('')
  }

  function runQuery(mode: ResultMode): void {
    if (!isValidDay(query.acceptedDateFrom) || !isValidDay(query.acceptedDateTo)) {
      setError('收寄日期须按 YYYY-MM-DD 格式填写。')
      return
    }
    if (query.acceptedDateFrom > query.acceptedDateTo) {
      setError('收寄开始日期不能晚于结束日期。')
      return
    }
    setAppliedQuery(structuredClone(query))
    setResultMode(mode)
    setSelectedIds([])
    setNotice(mode === 'detail' ? '明细查询完成。' : '汇总查询完成。')
    setError('')
  }

  function resetQuery(): void {
    const next = defaultQuery(activeTab, now)
    setQuery(next)
    setAppliedQuery(next)
    setResultMode('detail')
    setSelectedIds([])
    setNotice('')
    setError('')
  }

  function toggleSelected(id: string): void {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id])
    setError('')
  }

  function toggleAll(): void {
    setSelectedIds(allSelected ? [] : results.map(rowSelectionId))
    setError('')
  }

  function requireSelection(action: string): boolean {
    if (selectedIds.length > 0) return true
    setError(`请选择需要${action}的邮件。`)
    return false
  }

  function openHandover(): void {
    if (!requireSelection('交出')) return
    setReceivingOfficeCode('')
    setReceivingEmployeeId('')
    setAuthorizationSecret('')
    setHandoverNote('')
    setHandoverOpen(true)
    setError('')
  }

  async function confirmHandover(): Promise<void> {
    if (!currentOffice) {
      setError('请选择接收机构。')
      return
    }
    try {
      const performedAt = now?.toISOString() ?? new Date().toISOString()
      if (currentOffice.internal && !selectedEmployee) {
        throw new Error('本局交接必须选择当前已签到的接收员工。')
      }
      const authorization = currentOffice.internal
        ? await authorizeInternalHandover(
            selectedEmployee!.id,
            authorizationSecret,
            performedAt,
          )
        : undefined
      const result = await repository.executeMailDispatch({
        type: 'hand-over-loose-mail',
        transactionIds: selectedRows.map((row) => row.transaction.id),
        scope: currentOffice.internal ? 'internal' : 'cross-office',
        receivingOfficeCode: currentOffice.code,
        receivingOfficeName: currentOffice.name,
        receivingEmployeeId: selectedEmployee?.id ?? '',
        receivingEmployeeName: selectedEmployee?.name ?? '',
        originOfficeCode: institutionCode,
        authorization,
        note: handoverNote,
        performedAt,
        operator,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setHandoverOpen(false)
      setNotice(`交出成功，共 ${result.handovers.length} 件。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '邮件交出失败。')
    }
  }

  async function confirmChangeOffice(): Promise<void> {
    const office = CROSS_OFFICES.find((item) => item.code === changedOfficeCode)
    if (!office) {
      setError('请选择新的接收机构。')
      return
    }
    try {
      const result = await repository.executeMailDispatch({
        type: 'change-loose-mail-receiving-office',
        handoverIds: selectedRows.flatMap((row) => row.handover ? [row.handover.id] : []),
        receivingOfficeCode: office.code,
        receivingOfficeName: office.name,
        originOfficeCode: institutionCode,
        operator,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setChangeOfficeOpen(false)
      setNotice(`接收机构已更改，共 ${result.handovers.length} 件。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '接收机构更改失败。')
    }
  }

  async function toggleDirectSeal(): Promise<void> {
    if (!requireSelection('切换直封状态')) return
    const handovers = selectedRows.flatMap((row) => row.handover ? [row.handover] : [])
    const directSeal = !handovers.every((record) => record.directSeal)
    try {
      const result = await repository.executeMailDispatch({
        type: 'set-loose-mail-direct-seal',
        handoverIds: handovers.map((record) => record.id),
        directSeal,
        receivingOfficeCode: institutionCode,
        operator,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setNotice(`已将 ${result.handovers.length} 件切换为${directSeal ? '直封' : '非直封'}。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '直封状态切换失败。')
    }
  }

  async function receiveSelected(): Promise<void> {
    if (!requireSelection('接收')) return
    try {
      const result = await repository.executeMailDispatch({
        type: 'receive-loose-mail',
        handoverIds: selectedRows.flatMap((row) => row.handover ? [row.handover.id] : []),
        receivedAt: new Date().toISOString(),
        receivingOfficeCode: institutionCode,
        operator,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setNotice(`接收成功，共 ${result.handovers.length} 件。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '邮件接收失败。')
    }
  }

  async function confirmReturn(): Promise<void> {
    try {
      const result = await repository.executeMailDispatch({
        type: 'return-loose-mail',
        handoverIds: selectedRows.flatMap((row) => row.handover ? [row.handover.id] : []),
        returnedAt: new Date().toISOString(),
        receivingOfficeCode: institutionCode,
        returnNote,
        operator,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setReturnOpen(false)
      setReturnNote('')
      setNotice(`退回成功，共 ${result.handovers.length} 件。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '邮件退回失败。')
    }
  }

  function applyElectronicPick(): void {
    const values = [...new Set(electronicPickValue
      .split(/[\s,，;；]+/)
      .map((value) => value.trim())
      .filter(Boolean))]
    if (values.length === 0) {
      setError('请输入需要勾挑的邮件号码。')
      return
    }
    const matches = results.filter((row) => {
      const candidates = [
        looseMailDisplayNumber(row.transaction),
        row.transaction.id,
        row.handover?.id ?? '',
      ]
      return candidates.some((candidate) => values.includes(candidate))
    })
    const matchedValues = new Set(matches.flatMap((row) => [
      looseMailDisplayNumber(row.transaction),
      row.transaction.id,
      row.handover?.id ?? '',
    ]))
    const missing = values.filter((value) => !matchedValues.has(value))
    if (missing.length > 0) {
      setError(`未找到邮件：${missing.join('、')}`)
      return
    }
    setSelectedIds(matches.map(rowSelectionId))
    setElectronicPickOpen(false)
    setElectronicPickValue('')
    setNotice(`电子勾挑完成，共选择 ${matches.length} 件。`)
    setError('')
  }

  function applyBatchSelection(): void {
    const from = Number(batchFrom)
    const to = Number(batchTo)
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > results.length) {
      setError(`请输入 1 至 ${Math.max(results.length, 1)} 范围内的连续序号。`)
      return
    }
    const selected = results.slice(from - 1, to).map(rowSelectionId)
    setSelectedIds(selected)
    setBatchOpen(false)
    setNotice(`批量选择完成，共选择 ${selected.length} 件。`)
    setError('')
  }

  if (!workspace) {
    return <section className="mail-handover mail-handover--loading">正在读取邮件交接数据…</section>
  }

  if (!canHandOverLoose && !canProcessReceivedMail) {
    return <section aria-label="无权访问交接处理" className="management-workspace management-denied"><h1>无权访问</h1><p>当前岗位没有邮件交接职责。</p><button onClick={onBack} type="button">返回主页</button></section>
  }

  if (workspaceTab === 'bag-handover' || workspaceTab === 'bag-receipt') {
    return (
      <DispatchBagHandoverPanel
        activeTab={workspaceTab === 'bag-handover' ? 'handover' : 'receipt'}
        institutionCode={institutionCode}
        onBack={onBack}
        onSwitchTab={switchWorkspaceTab}
        operator={operator}
        repository={repository}
        canHandOverLoose={canHandOverLoose}
        canProcessReceivedMail={canProcessReceivedMail}
      />
    )
  }

  const selectedHandoverStatus = query.status as LooseMailHandoverQueryStatus
  const selectedReceiptStatus = query.status as LooseMailReceiptQueryStatus
  const appliedHandoverStatus = appliedQuery.status as LooseMailHandoverQueryStatus
  const appliedReceiptStatus = appliedQuery.status as LooseMailReceiptQueryStatus

  return (
    <>
      <div className="mail-handover">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业工作台</button><span>/</span><span>邮件封发</span><span>/</span><strong>交接处理</strong>
        </div>

        <nav aria-label="交接处理类别" className="mail-handover__tabs">
          {canHandOverLoose ? <button aria-current={activeTab === 'handover' ? 'page' : undefined} onClick={() => switchTab('handover')} type="button">散件交出</button> : null}
          {canProcessReceivedMail ? <button aria-current={activeTab === 'receipt' ? 'page' : undefined} onClick={() => switchTab('receipt')} type="button">散件接收</button> : null}
          {canProcessReceivedMail ? <button onClick={() => switchWorkspaceTab('bag-handover')} type="button">总包交出</button> : null}
          {canProcessReceivedMail ? <button onClick={() => switchWorkspaceTab('bag-receipt')} type="button">总包接收</button> : null}
        </nav>

        <section aria-label={activeTab === 'handover' ? '散件交出查询条件' : '散件接收查询条件'} className="mail-handover__query">
          <div className="mail-handover__filters">
            <fieldset>
              <legend>{activeTab === 'handover' ? '交出标志' : '接收标志'}</legend>
              {activeTab === 'handover' ? (
                <>
                  <label><input checked={selectedHandoverStatus === 'not-handed-over'} name="handover-status" onChange={() => updateQuery('status', 'not-handed-over')} type="radio" />未交出</label>
                  <label><input checked={selectedHandoverStatus === 'handed-over'} name="handover-status" onChange={() => updateQuery('status', 'handed-over')} type="radio" />已交出</label>
                </>
              ) : (
                <>
                  <label><input checked={selectedReceiptStatus === 'not-received'} name="receipt-status" onChange={() => updateQuery('status', 'not-received')} type="radio" />未接收</label>
                  <label><input checked={selectedReceiptStatus === 'received'} name="receipt-status" onChange={() => updateQuery('status', 'received')} type="radio" />已接收</label>
                </>
              )}
            </fieldset>
            <label><span>业务产品</span><input aria-label="交接业务产品" onChange={(event) => updateQuery('productTerm', event.target.value)} placeholder="产品名称或代码" value={query.productTerm} /></label>
            <label><span>备注</span><input aria-label="交接备注" onChange={(event) => updateQuery('note', event.target.value)} placeholder="请输入备注" value={query.note} /></label>
            <label className="mail-handover__date-range"><span>收寄日期</span><span><input aria-label="交接收寄开始日期" onChange={(event) => updateQuery('acceptedDateFrom', event.target.value)} type="date" value={query.acceptedDateFrom} /><b>至</b><input aria-label="交接收寄结束日期" onChange={(event) => updateQuery('acceptedDateTo', event.target.value)} type="date" value={query.acceptedDateTo} /></span></label>
          </div>
          <div className="mail-handover__actions">
            <button onClick={() => runQuery('summary')} type="button">汇总查询</button>
            <button onClick={() => runQuery('detail')} type="button">明细查询</button>
            {resultMode === 'detail' ? <button onClick={() => { setElectronicPickOpen(true); setError('') }} type="button">电子勾挑</button> : null}
            {activeTab === 'handover' && appliedHandoverStatus === 'not-handed-over' && resultMode === 'detail' ? <button className="mail-handover__action-primary" onClick={openHandover} type="button">交出</button> : null}
            {activeTab === 'handover' && appliedHandoverStatus === 'handed-over' && resultMode === 'detail' ? <button className="mail-handover__action-primary" onClick={() => { if (requireSelection('更改接收机构')) { setChangedOfficeCode(''); setChangeOfficeOpen(true) } }} type="button">更改接收机构</button> : null}
            {activeTab === 'receipt' && appliedReceiptStatus === 'not-received' && resultMode === 'detail' ? <><button onClick={() => void toggleDirectSeal()} type="button">直封/非直封</button><button className="mail-handover__action-primary" onClick={() => void receiveSelected()} type="button">接收</button></> : null}
            {activeTab === 'receipt' && appliedReceiptStatus === 'received' && resultMode === 'detail' ? <button className="mail-handover__action-danger" onClick={() => { if (requireSelection('退回')) { setReturnNote(''); setReturnOpen(true) } }} type="button">退回</button> : null}
            {resultMode === 'detail' ? <button onClick={() => { setBatchFrom('1'); setBatchTo(String(Math.max(1, results.length))); setBatchOpen(true); setError('') }} type="button">批量选择</button> : null}
            <button onClick={resetQuery} type="button">重置</button>
          </div>
        </section>

        <section aria-label="邮件交接查询结果" className="mail-handover__results">
          <header><span>{resultMode === 'detail' ? '明细' : '汇总'}结果</span><strong>{results.length} 件</strong></header>
          <div className="mail-handover__table-wrap">
            {resultMode === 'summary' ? (
              <table className="mail-handover__table mail-handover__table--summary">
                <thead><tr><th>序号</th><th>业务产品</th><th>产品代码</th><th>有效业务代码</th><th>件数</th><th>资费合计</th></tr></thead>
                <tbody>{summaries.map((summary, index) => <tr key={summary.key}><td>{index + 1}</td><td>{summary.productLabel}</td><td>{summary.productCode}</td><td>{summary.effectiveBusinessCode}</td><td>{summary.count}</td><td>{formatCents(summary.postageCents)} 元</td></tr>)}{summaries.length === 0 ? <tr><td colSpan={6}>无数据</td></tr> : null}</tbody>
              </table>
            ) : (
              <table className="mail-handover__table">
                <thead><tr><th><input aria-label="选择全部交接邮件" checked={allSelected} onChange={toggleAll} type="checkbox" /></th><th>序号</th><th>业务产品</th><th>邮件号码</th><th>件数</th><th>收寄员工工号</th><th>收寄员工姓名</th><th>接收机构</th><th>直封</th><th>备注</th><th>状态</th><th>交出时间</th></tr></thead>
                <tbody>
                  {results.map((row, index) => {
                    const id = rowSelectionId(row)
                    return <tr key={id}><td><input aria-label={`选择交接邮件 ${looseMailDisplayNumber(row.transaction)}`} checked={selectedIds.includes(id)} onChange={() => toggleSelected(id)} type="checkbox" /></td><td>{index + 1}</td><td>{row.transaction.product.label}<small>{row.transaction.product.effectiveBusinessCode}</small></td><td>{looseMailDisplayNumber(row.transaction)}</td><td>{row.transaction.service.quantity}</td><td>{row.transaction.operator.operatorId}</td><td>{row.transaction.operator.displayName}</td><td>{row.handover?.receivingOfficeName ?? row.transaction.operator.receivingOffice}</td><td>{row.handover ? row.handover.directSeal ? '直封' : '非直封' : '—'}</td><td>{row.handover?.note || '—'}</td><td><span className={`mail-handover__status mail-handover__status--${row.handover?.status ?? 'pending'}`}>{statusLabel(row.handover)}</span></td><td>{displayDateTime(row.handover?.handedOverAt ?? null)}</td></tr>
                  })}
                  {results.length === 0 ? <tr><td colSpan={12}>无数据</td></tr> : null}
                </tbody>
              </table>
            )}
          </div>
          {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
          {error && !handoverOpen && !changeOfficeOpen && !returnOpen && !electronicPickOpen && !batchOpen ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      {handoverOpen ? (
        <Modal description={`已选择 ${selectedIds.length} 件邮件。`} eyebrow="交接处理" title="选择接收机构及员工">
          <div className="modal-form mail-handover__modal-form">
            <label><span>接收机构</span><select aria-label="邮件交接接收机构" onChange={(event) => { setReceivingOfficeCode(event.target.value); setReceivingEmployeeId(''); setAuthorizationSecret(''); setError('') }} value={receivingOfficeCode}><option value="">请选择</option>{officeOptions.map((office) => <option key={office.code} value={office.code}>{office.name}（{office.code}）</option>)}</select></label>
            {currentOffice?.internal ? <><label><span>接收员工</span><select aria-label="邮件交接接收员工" onChange={(event) => { setReceivingEmployeeId(event.target.value); setAuthorizationSecret(''); setError('') }} value={receivingEmployeeId}><option value="">请选择</option>{receivingEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}（{employee.id}）</option>)}</select></label>{receivingEmployees.length === 0 ? <p className="service-field-hint">当前机构没有另一名已签到且具备接收权限的员工，本局交接暂不可办理；可改选跨机构交出。</p> : <><label><span>授权工号</span><input aria-label="邮件交接授权工号" readOnly value={receivingEmployeeId} /></label><label><span>授权密码</span><input aria-label="邮件交接授权密码" autoComplete="current-password" onChange={(event) => setAuthorizationSecret(event.target.value)} type="password" value={authorizationSecret} /></label><p className="service-field-hint">由所选接收员工本人现场输入当前账号密码确认；系统不显示或代填授权口令。</p></>}</> : null}
            <label><span>备注</span><input aria-label="邮件交接提交备注" onChange={(event) => setHandoverNote(event.target.value)} value={handoverNote} /></label>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setHandoverOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void confirmHandover()} type="button">确认交出</button></div>
          </div>
        </Modal>
      ) : null}

      {changeOfficeOpen ? (
        <Modal description={`已选择 ${selectedIds.length} 件尚未接收的邮件。`} eyebrow="交接处理" title="更改接收机构">
          <div className="modal-form mail-handover__modal-form"><label><span>接收机构</span><select aria-label="更改邮件接收机构" onChange={(event) => { setChangedOfficeCode(event.target.value); setError('') }} value={changedOfficeCode}><option value="">请选择</option>{CROSS_OFFICES.map((office) => <option key={office.code} value={office.code}>{office.name}（{office.code}）</option>)}</select></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setChangeOfficeOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void confirmChangeOffice()} type="button">确认更改</button></div></div>
        </Modal>
      ) : null}

      {electronicPickOpen ? (
        <Modal description="每行输入一个邮件号码、收寄流水号或交接号。" eyebrow="交接处理" title="电子勾挑">
          <div className="modal-form mail-handover__modal-form"><label><span>邮件号码</span><textarea aria-label="电子勾挑邮件号码" onChange={(event) => setElectronicPickValue(event.target.value)} rows={6} value={electronicPickValue} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setElectronicPickOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={applyElectronicPick} type="button">确认勾挑</button></div></div>
        </Modal>
      ) : null}

      {batchOpen ? (
        <Modal eyebrow="交接处理" title="请输入需要交出的序号">
          <div className="modal-form mail-handover__batch-form"><label><span>序号起号</span><input aria-label="交接序号起号" inputMode="numeric" onChange={(event) => setBatchFrom(event.target.value)} value={batchFrom} /></label><label><span>序号止号</span><input aria-label="交接序号止号" inputMode="numeric" onChange={(event) => setBatchTo(event.target.value)} value={batchTo} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setBatchOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={applyBatchSelection} type="button">确定</button></div></div>
        </Modal>
      ) : null}

      {returnOpen ? (
        <Modal description={`已选择 ${selectedIds.length} 件已接收邮件。`} eyebrow="交接处理" title="邮件退回">
          <div className="modal-form mail-handover__modal-form"><label><span>退回原因</span><textarea aria-label="邮件退回原因" onChange={(event) => setReturnNote(event.target.value)} rows={4} value={returnNote} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setReturnOpen(false); setError('') }} type="button">取消</button><button className="query-action query-action--danger" onClick={() => void confirmReturn()} type="button">确认退回</button></div></div>
        </Modal>
      ) : null}
    </>
  )
}
