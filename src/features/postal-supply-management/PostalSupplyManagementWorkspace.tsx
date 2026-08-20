import { useEffect, useMemo, useState, type ReactNode } from 'react'

import type { RequestOnSiteAuthorization } from '../../domain/access/workAuthorization'
import {
  calculatePostalSupplyBalance,
  postalSupplyDocumentKindLabel,
  postalSupplyDocumentStatusLabel,
  postalSupplyEmployeeInventory,
  postalSupplyInstitutionInventory,
  postalSupplyInventoryRows,
  postalSupplySuperiorInventory,
  queryPostalSupplyDocuments,
  queryPostalSupplySalesStats,
  type PostalSupplyManagementCommand,
  type PostalSupplyManagementContext,
  type PostalSupplyQuantityLine,
} from '../../domain/service/postalSupplyManagement'
import { formatCents } from '../../domain/service/policy'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import type { ServiceRepository } from '../../domain/service/repository'
import { POSTAL_SUPPLY_ITEMS } from '../../domain/service/seed'
import type {
  PostalSupplyDocument,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

export type PostalSupplyManagementSection =
  | 'inbound'
  | 'requisition'
  | 'approval'
  | 'receipt'
  | 'issue'
  | 'return'
  | 'inventory'
  | 'balance'
  | 'sales'

interface PostalSupplyManagementWorkspaceProps {
  institutionCode: string
  onBack: () => void
  operator: ServiceOperatorSnapshot
  repository: ServiceRepository
  section: PostalSupplyManagementSection
  authorizeOnSite: RequestOnSiteAuthorization
}

type PostalSupplyManagementUiCommand =
  | Exclude<PostalSupplyManagementCommand, { type: 'count-postal-supply-inventory' }>
  | (Extract<PostalSupplyManagementCommand, { type: 'count-postal-supply-inventory' }> & {
      supervisorId: string
      supervisorSecret: string
    })

type StockSource = 'superior' | 'institution' | 'employee' | 'catalog'

const SECTION_TITLES: Record<PostalSupplyManagementSection, string> = {
  inbound: '用邮物品入库',
  requisition: '用邮物品请领',
  approval: '用邮物品审批',
  receipt: '用邮物品接收',
  issue: '用邮物品下发',
  return: '用邮物品退回',
  inventory: '用邮物品库存盘点',
  balance: '用邮物品平衡统计',
  sales: '用邮物品销售统计',
}

const EMPLOYEES = [
  { id: '80000001', name: '演示营业员' },
  { id: '80000002', name: '周沐' },
  { id: '80000003', name: '苏清' },
] as const

function localDate(): string {
  return businessCalendarDay(new Date())
}

function localTimestamp(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 19) + '.000Z'
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

function documentQuantity(document: PostalSupplyDocument, actual = false): number {
  return document.lines.reduce((total, line) => total + (actual ? line.actualQuantity : line.requestedQuantity), 0)
}

function documentAmount(document: PostalSupplyDocument): number {
  return document.lines.reduce((total, line) => total + line.amountCents, 0)
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>): void {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function TabBar({ active, onChange, tabs }: { active: string; onChange: (value: string) => void; tabs: Array<{ label: string; value: string }> }) {
  return (
    <nav aria-label="用邮物品页面选项" className="supply-management__tabs">
      {tabs.map((tab) => (
        <button
          aria-current={active === tab.value ? 'page' : undefined}
          className={active === tab.value ? 'supply-management__tab supply-management__tab--active' : 'supply-management__tab'}
          key={tab.value}
          onClick={() => onChange(tab.value)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

function DocumentTable({ actions, documents }: { actions?: (document: PostalSupplyDocument) => ReactNode; documents: PostalSupplyDocument[] }) {
  return (
    <div className="supply-management__table-wrap">
      <table className="supply-management__table">
        <thead>
          <tr>
            <th>业务流水</th><th>申请类型</th><th>物品名称</th><th>申请数量</th><th>实发数量</th><th>实发金额</th><th>申请日期</th><th>核发状态</th><th>接收状态</th>{actions ? <th>操作</th> : null}
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.id}>
              <td><strong>{document.id}</strong></td>
              <td>{postalSupplyDocumentKindLabel(document.kind)}</td>
              <td>{document.lines.map((line) => line.label).join('、')}</td>
              <td>{documentQuantity(document)}</td>
              <td>{documentQuantity(document, true)}</td>
              <td>{formatCents(documentAmount(document))}</td>
              <td>{businessCalendarDay(document.createdAt)}</td>
              <td>{postalSupplyDocumentStatusLabel(document.status)}</td>
              <td>{document.receivedAt ? '已接收' : '未接收'}</td>
              {actions ? <td className="supply-management__row-actions">{actions(document)}</td> : null}
            </tr>
          ))}
          {documents.length === 0 ? <tr><td className="supply-management__empty" colSpan={actions ? 10 : 9}>无数据</td></tr> : null}
        </tbody>
      </table>
    </div>
  )
}

function DraftTable({
  available,
  lines,
  onDelete,
  onQuantityChange,
  selected,
  setSelected,
}: {
  available: (itemId: string) => number
  lines: PostalSupplyQuantityLine[]
  onDelete: () => void
  onQuantityChange: (itemId: string, quantity: number) => void
  selected: Set<string>
  setSelected: (itemId: string, checked: boolean) => void
}) {
  const rows = lines.flatMap((line) => {
    const item = POSTAL_SUPPLY_ITEMS.find((candidate) => candidate.id === line.itemId)
    return item ? [{ item, line }] : []
  })
  return (
    <>
      <div className="supply-management__table-wrap">
        <table className="supply-management__table supply-management__table--draft">
          <thead><tr><th>选择</th><th>物品名称</th><th>物品编码</th><th>单位</th><th>单价</th><th>库存</th><th>数量</th><th>金额</th></tr></thead>
          <tbody>
            {rows.map(({ item, line }) => (
              <tr key={item.id}>
                <td><input aria-label={`选择明细 ${item.label}`} checked={selected.has(item.id)} onChange={(event) => setSelected(item.id, event.target.checked)} type="checkbox" /></td>
                <td>{item.label}</td><td>{item.mnemonic}</td><td>{item.unit}</td><td>{formatCents(item.unitPriceCents)}</td><td>{available(item.id)}</td>
                <td><input aria-label={`业务数量 ${item.label}`} min={1} onChange={(event) => onQuantityChange(item.id, Number(event.target.value))} type="number" value={line.quantity} /></td>
                <td>{formatCents(item.unitPriceCents * line.quantity)}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td className="supply-management__empty" colSpan={8}>点击“添加”选择用邮物品。</td></tr> : null}
          </tbody>
          <tfoot><tr><td colSpan={6}>合计</td><td>{rows.reduce((total, row) => total + row.line.quantity, 0)}</td><td>{formatCents(rows.reduce((total, row) => total + row.line.quantity * row.item.unitPriceCents, 0))}</td></tr></tfoot>
        </table>
      </div>
      <button className="danger-button" disabled={selected.size === 0} onClick={onDelete} type="button">删除</button>
    </>
  )
}

function ItemPicker({
  available,
  onAdd,
  onClose,
}: {
  available: (itemId: string) => number
  onAdd: (ids: string[]) => void
  onClose: () => void
}) {
  const [primary, setPrimary] = useState('')
  const [secondary, setSecondary] = useState('')
  const [term, setTerm] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const primaries = [...new Set(POSTAL_SUPPLY_ITEMS.map((item) => item.primaryCategory))]
  const secondaries = [...new Set(POSTAL_SUPPLY_ITEMS.filter((item) => !primary || item.primaryCategory === primary).map((item) => item.secondaryCategory))]
  const normalized = term.trim().toUpperCase()
  const items = POSTAL_SUPPLY_ITEMS.filter((item) =>
    (!primary || item.primaryCategory === primary) &&
    (!secondary || item.secondaryCategory === secondary) &&
    (!normalized || item.label.includes(term.trim()) || item.mnemonic.includes(normalized)),
  )
  return (
    <Modal eyebrow="用邮物品管理" title="物品名称检索" wide>
      <div className="supply-management__picker-filters">
        <label><span>物品一级分类</span><select aria-label="管理物品一级分类" onChange={(event) => { setPrimary(event.target.value); setSecondary('') }} value={primary}><option value="">全部</option>{primaries.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>物品二级分类</span><select aria-label="管理物品二级分类" onChange={(event) => setSecondary(event.target.value)} value={secondary}><option value="">全部</option>{secondaries.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>物品搜索</span><input aria-label="管理物品搜索" onChange={(event) => setTerm(event.target.value)} value={term} /></label>
      </div>
      <div className="supply-management__table-wrap">
        <table className="supply-management__table">
          <thead><tr><th>选择</th><th>序号</th><th>物品名称</th><th>单位</th><th>单价</th><th>物品库存</th><th>库存管理方式</th><th>物品编码</th></tr></thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id}><td><input aria-label={`管理选择物品 ${item.label}`} checked={selected.has(item.id)} disabled={available(item.id) <= 0} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next })} type="checkbox" /></td><td>{index + 1}</td><td>{item.label}</td><td>{item.unit}</td><td>{formatCents(item.unitPriceCents)}</td><td>{available(item.id)}</td><td>无需管理库存</td><td>{item.mnemonic}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="modal-actions"><button className="secondary-button" onClick={onClose} type="button">取消</button><button className="primary-button primary-button--compact" disabled={selected.size === 0} onClick={() => onAdd([...selected])} type="button">添加</button></div>
    </Modal>
  )
}

export function PostalSupplyManagementWorkspace({ authorizeOnSite, institutionCode, onBack, operator, repository, section }: PostalSupplyManagementWorkspaceProps) {
  const today = localDate()
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [pageMode, setPageMode] = useState('work')
  const [draftLines, setDraftLines] = useState<PostalSupplyQuantityLine[]>([])
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [employeeId, setEmployeeId] = useState(operator.operatorId)
  const [returnType, setReturnType] = useState<'employee' | 'institution'>('employee')
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null)
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [actualQuantities, setActualQuantities] = useState<Record<string, number>>({})
  const [dateFrom, setDateFrom] = useState(monthStart(today))
  const [dateTo, setDateTo] = useState(today)
  const [itemTerm, setItemTerm] = useState('')
  const [requestKind, setRequestKind] = useState<'requisition' | 'institution-return'>('requisition')
  const [inventoryTarget, setInventoryTarget] = useState<'institution' | 'employee'>('institution')
  const [countedQuantities, setCountedQuantities] = useState<Record<string, number>>({})
  const [supervisorId, setSupervisorId] = useState('')
  const [supervisorSecret, setSupervisorSecret] = useState('')
  const [salesSource, setSalesSource] = useState<'all' | 'postal-supply-sale' | 'counter-mail'>('all')
  const [salesMethod, setSalesMethod] = useState<'employee' | 'institution'>('employee')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const employee = EMPLOYEES.find((candidate) => candidate.id === employeeId) ?? { id: employeeId, name: operator.displayName }
  const context = (): PostalSupplyManagementContext => ({
    operatedAt: localTimestamp(),
    operator,
    institutionCode,
    institutionName: operator.acceptanceOffice,
    superiorInstitutionCode: '99800000',
    superiorInstitutionName: '云浦运营中心',
  })

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => { if (active) setWorkspace(loaded) })
    return () => { active = false }
  }, [repository])

  const documents = useMemo(() => workspace ? queryPostalSupplyDocuments(workspace, { dateFrom, dateTo, itemTerm }) : [], [dateFrom, dateTo, itemTerm, workspace])
  const selectedDocument = workspace?.postalSupplyDocuments.find((candidate) => candidate.id === selectedDocumentId) ?? null

  function available(itemId: string, source: StockSource = pickerSource()): number {
    if (!workspace) return 0
    if (source === 'catalog') return 999_999
    if (source === 'superior') return postalSupplySuperiorInventory(workspace, itemId)
    if (source === 'institution') return postalSupplyInstitutionInventory(workspace, itemId)
    return postalSupplyEmployeeInventory(workspace, itemId, employeeId)
  }

  function pickerSource(): StockSource {
    if (section === 'inbound') return 'catalog'
    if (section === 'requisition') return 'superior'
    if (section === 'issue' || (section === 'return' && returnType === 'institution')) return 'institution'
    return 'employee'
  }

  function addPickerItems(ids: string[]): void {
    setDraftLines((current) => {
      const existing = new Set(current.map((line) => line.itemId))
      return [...current, ...ids.filter((id) => !existing.has(id)).map((itemId) => ({ itemId, quantity: 1 }))]
    })
    setPickerOpen(false)
    setNotice('已添加所选物品。')
    setError('')
  }

  function updateDraftQuantity(itemId: string, quantity: number): void {
    const maximum = available(itemId)
    const normalized = Math.max(0, Math.floor(Number.isFinite(quantity) ? quantity : 0))
    setDraftLines((current) => current.map((line) => line.itemId === itemId ? { ...line, quantity: Math.min(normalized, Math.max(0, maximum)) } : line))
  }

  function deleteDraftLines(): void {
    setDraftLines((current) => current.filter((line) => !selectedDraftIds.has(line.itemId)))
    setSelectedDraftIds(new Set())
  }

  async function run(command: PostalSupplyManagementUiCommand, success: string): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    setError('')
    setNotice('')
    try {
      let executable: PostalSupplyManagementCommand = command
      if (command.type === 'count-postal-supply-inventory') {
        if (!workspace) throw new Error('库存数据尚未读取完成。')
        const { supervisorId, supervisorSecret, ...countCommand } = command
        const expectedByItemId = new Map(
          postalSupplyInventoryRows(
            workspace,
            command.target,
            command.employeeId ?? '',
          ).map((row) => [row.item.id, row.expectedQuantity]),
        )
        const hasDifference = command.lines.some(
          (line) => expectedByItemId.get(line.itemId) !== line.quantity,
        )
        const authorization = hasDifference
          ? await authorizeOnSite(
              'count-postal-supply-inventory',
              supervisorId,
              supervisorSecret,
              command.context.operatedAt,
            )
          : undefined
        executable = { ...countCommand, authorization }
        setSupervisorSecret('')
      }
      const result = await repository.executePostalSupplyManagement(executable)
      setWorkspace(result.state)
      setNotice(success)
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '用邮物品业务处理失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveDraftOperation(): Promise<void> {
    let command: PostalSupplyManagementCommand
    if (editingDocumentId) {
      command = { type: 'revise-postal-supply-request', context: context(), documentId: editingDocumentId, lines: draftLines }
    } else if (section === 'inbound') {
      command = { type: 'record-postal-supply-inbound', context: context(), lines: draftLines }
    } else if (section === 'requisition') {
      command = { type: 'submit-postal-supply-requisition', context: context(), lines: draftLines }
    } else if (section === 'issue') {
      command = { type: 'issue-postal-supplies-to-employee', context: context(), employeeId, employeeName: employee.name, lines: draftLines }
    } else if (returnType === 'institution') {
      command = { type: 'submit-postal-supply-institution-return', context: context(), lines: draftLines }
    } else {
      command = { type: 'return-postal-supplies-from-employee', context: context(), employeeId, employeeName: employee.name, lines: draftLines }
    }
    const success = editingDocumentId
      ? '申请记录修改成功。'
      : section === 'requisition' || (section === 'return' && returnType === 'institution')
        ? '申请提交成功。'
        : '保存成功。'
    const saved = await run(command, success)
    if (saved) {
      setDraftLines([])
      setSelectedDraftIds(new Set())
      setEditingDocumentId(null)
    }
  }

  function editRequest(document: PostalSupplyDocument): void {
    setEditingDocumentId(document.id)
    setDraftLines(document.lines.map((line) => ({ itemId: line.itemId, quantity: line.requestedQuantity })))
    setPageMode('work')
    setNotice(`正在修改 ${document.id}。`)
  }

  function selectDocument(document: PostalSupplyDocument): void {
    setSelectedDocumentId(document.id)
    setActualQuantities(Object.fromEntries(document.lines.map((line) => [line.itemId, line.actualQuantity])))
    setError('')
  }

  const tabs = section === 'inbound'
    ? [{ label: '机构用邮物品入库', value: 'work' }, { label: '机构用邮物品入库查询', value: 'query' }]
    : section === 'requisition'
      ? [{ label: '机构用邮物品请领', value: 'work' }, { label: '机构用邮物品请领查询', value: 'query' }]
      : section === 'approval'
        ? [{ label: '机构用邮物品核发', value: 'work' }, { label: '机构用邮物品核发查询', value: 'query' }]
        : section === 'receipt'
          ? [{ label: '机构用邮物品接收', value: 'work' }, { label: '机构用邮物品接收查询', value: 'query' }]
          : section === 'issue'
            ? [{ label: '员工用邮物品下发', value: 'work' }, { label: '员工用邮物品下发查询', value: 'query' }]
            : section === 'return'
              ? [{ label: '员工/机构用邮物品退回', value: 'work' }, { label: '员工用邮物品退回查询', value: 'employee-query' }, { label: '机构用邮物品退回查询', value: 'institution-query' }]
              : section === 'balance'
                ? [{ label: '个人用邮物品平衡统计', value: 'employee' }, { label: '支局用邮物品平衡统计', value: 'institution' }]
                : []

  function operationPanel(): ReactNode {
    return (
      <>
        {section === 'issue' || (section === 'return' && returnType === 'employee') ? (
          <section className="supply-management__filters"><label><span>{section === 'issue' ? '下发员工' : '退回员工'}</span><select aria-label="用邮物品员工" onChange={(event) => setEmployeeId(event.target.value)} value={employeeId}>{EMPLOYEES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.id} {candidate.name}</option>)}</select></label></section>
        ) : null}
        {section === 'requisition' ? <section className="supply-management__filters"><label><span>核发机构</span><input aria-label="用邮物品核发机构" readOnly value="云浦运营中心" /></label></section> : null}
        {section === 'return' ? <section className="supply-management__filters"><fieldset><legend>退回类型</legend><label><input checked={returnType === 'employee'} name="return-type" onChange={() => { setReturnType('employee'); setDraftLines([]) }} type="radio" />个人退回</label><label><input checked={returnType === 'institution'} name="return-type" onChange={() => { setReturnType('institution'); setDraftLines([]) }} type="radio" />支局退回</label></fieldset><label><span>接收机构名称</span><input readOnly value={returnType === 'employee' ? operator.acceptanceOffice : '云浦运营中心'} /></label></section> : null}
        <section className="supply-management__toolbar"><button className="secondary-button" onClick={() => setPickerOpen(true)} type="button">添加</button><button className="primary-button primary-button--compact" disabled={busy || draftLines.length === 0} onClick={() => void saveDraftOperation()} type="button">{section === 'requisition' && !editingDocumentId ? '提交确认' : '保存'}</button>{editingDocumentId ? <button className="secondary-button" onClick={() => { setEditingDocumentId(null); setDraftLines([]) }} type="button">取消修改</button> : null}</section>
        <DraftTable available={available} lines={draftLines} onDelete={deleteDraftLines} onQuantityChange={updateDraftQuantity} selected={selectedDraftIds} setSelected={(itemId, checked) => setSelectedDraftIds((current) => { const next = new Set(current); if (checked) next.add(itemId); else next.delete(itemId); return next })} />
      </>
    )
  }

  function queryFilters(): ReactNode {
    return <section className="supply-management__filters"><label><span>查询日期</span><input aria-label="用邮物品查询开始日期" onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} /></label><span>至</span><label><span className="sr-only">结束日期</span><input aria-label="用邮物品查询结束日期" onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} /></label><label><span>物品名称</span><input aria-label="用邮物品查询名称" onChange={(event) => setItemTerm(event.target.value)} value={itemTerm} /></label><button className="primary-button primary-button--compact" onClick={() => setNotice(`查到 ${documents.length} 条记录。`)} type="button">查询</button></section>
  }

  function approvalPanel(): ReactNode {
    const list = documents.filter((document) => ['requisition', 'institution-return'].includes(document.kind) && (pageMode === 'work' ? document.status === 'pending-approval' && document.kind === requestKind : document.status !== 'pending-approval'))
    return (
      <>
        <section className="supply-management__filters"><fieldset><legend>申请类型</legend><label><input checked={requestKind === 'requisition'} onChange={() => setRequestKind('requisition')} type="radio" />请领申请</label><label><input checked={requestKind === 'institution-return'} onChange={() => setRequestKind('institution-return')} type="radio" />退回申请</label></fieldset>{queryFilters()}</section>
        <DocumentTable actions={(document) => <button className="secondary-button secondary-button--small" onClick={() => selectDocument(document)} type="button">选择</button>} documents={list} />
        {selectedDocument ? <section className="supply-management__decision"><h2>{selectedDocument.id} 物品明细</h2><table className="supply-management__table"><thead><tr><th>物品名称</th><th>库存</th><th>申请数量</th><th>申请金额</th><th>实发数量</th><th>实发金额</th></tr></thead><tbody>{selectedDocument.lines.map((line) => <tr key={line.itemId}><td>{line.label}</td><td>{selectedDocument.kind === 'requisition' && workspace ? postalSupplySuperiorInventory(workspace, line.itemId) : workspace ? postalSupplyInstitutionInventory(workspace, line.itemId) : 0}</td><td>{line.requestedQuantity}</td><td>{formatCents(line.requestedQuantity * line.unitPriceCents)}</td><td><input aria-label={`实发数量 ${line.label}`} min={0} max={line.requestedQuantity} onChange={(event) => setActualQuantities((current) => ({ ...current, [line.itemId]: Number(event.target.value) }))} type="number" value={actualQuantities[line.itemId] ?? line.actualQuantity} /></td><td>{formatCents((actualQuantities[line.itemId] ?? line.actualQuantity) * line.unitPriceCents)}</td></tr>)}</tbody></table><div className="supply-management__toolbar">{selectedDocument.status === 'pending-approval' ? <><button className="primary-button primary-button--compact" onClick={() => void run({ type: 'approve-postal-supply-request', context: context(), documentId: selectedDocument.id, lines: selectedDocument.lines.map((line) => ({ itemId: line.itemId, actualQuantity: actualQuantities[line.itemId] ?? line.actualQuantity })) }, '确认核发成功。')} type="button">确认核发</button><button className="danger-button" onClick={() => void run({ type: 'reject-postal-supply-request', context: context(), documentId: selectedDocument.id }, '拒绝核发成功。')} type="button">拒绝核发</button></> : selectedDocument.kind === 'requisition' && selectedDocument.status === 'approved' ? <button className="primary-button primary-button--compact" onClick={() => void run({ type: 'revise-approved-postal-supply-quantities', context: context(), documentId: selectedDocument.id, lines: selectedDocument.lines.map((line) => ({ itemId: line.itemId, actualQuantity: actualQuantities[line.itemId] ?? line.actualQuantity })) }, '实发数量保存成功。')} type="button">保存</button> : null}</div></section> : null}
      </>
    )
  }

  function receiptPanel(): ReactNode {
    const list = documents.filter((document) => document.kind === 'requisition' && (pageMode === 'work' ? document.status === 'approved' : ['approved', 'received'].includes(document.status)))
    return <>{queryFilters()}<DocumentTable actions={pageMode === 'work' ? (document) => <button className="primary-button primary-button--compact" onClick={() => void run({ type: 'receive-postal-supply-requisition', context: context(), documentId: document.id }, '确认接收成功。')} type="button">确认接收</button> : undefined} documents={list} /></>
  }

  function inventoryPanel(): ReactNode {
    if (!workspace) return null
    const rows = postalSupplyInventoryRows(workspace, inventoryTarget, employeeId).filter((row) => !itemTerm || row.item.label.includes(itemTerm) || row.item.mnemonic.includes(itemTerm.toUpperCase()))
    return <><section className="supply-management__filters"><label><span>查询机构</span><input readOnly value={operator.acceptanceOffice} /></label><label><span>查询员工</span><select aria-label="库存盘点员工" disabled={inventoryTarget === 'institution'} onChange={(event) => { setEmployeeId(event.target.value); setCountedQuantities({}) }} value={employeeId}>{EMPLOYEES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.id} {candidate.name}</option>)}</select></label><label><span>物品搜索</span><input aria-label="库存盘点物品搜索" onChange={(event) => setItemTerm(event.target.value)} value={itemTerm} /></label><fieldset><legend>盘点范围</legend><label><input checked={inventoryTarget === 'institution'} onChange={() => { setInventoryTarget('institution'); setCountedQuantities({}) }} type="radio" />支局库存</label><label><input checked={inventoryTarget === 'employee'} onChange={() => { setInventoryTarget('employee'); setCountedQuantities({}) }} type="radio" />员工库存</label></fieldset></section><div className="supply-management__table-wrap"><table className="supply-management__table"><thead><tr><th>序号</th><th>物品名称</th><th>单位</th><th>单价</th><th>应点库存</th><th>应点金额</th><th>盘点库存</th><th>盘点金额</th><th>差异数量</th><th>差异金额</th></tr></thead><tbody>{rows.map((row, index) => { const counted = countedQuantities[row.item.id] ?? row.expectedQuantity; const difference = counted - row.expectedQuantity; return <tr key={row.item.id}><td>{index + 1}</td><td>{row.item.label}</td><td>{row.item.unit}</td><td>{formatCents(row.item.unitPriceCents)}</td><td>{row.expectedQuantity}</td><td>{formatCents(row.amountCents)}</td><td><input aria-label={`盘点库存 ${row.item.label}`} min={0} onChange={(event) => setCountedQuantities((current) => ({ ...current, [row.item.id]: Math.max(0, Number(event.target.value)) }))} type="number" value={counted} /></td><td>{formatCents(counted * row.item.unitPriceCents)}</td><td>{difference}</td><td>{formatCents(difference * row.item.unitPriceCents)}</td></tr> })}</tbody></table></div><section className="supply-management__authorization"><label><span>主管工号</span><input aria-label="库存盘点主管工号" onChange={(event) => setSupervisorId(event.target.value)} value={supervisorId} /></label><label><span>主管密码</span><input aria-label="库存盘点主管密码" onChange={(event) => setSupervisorSecret(event.target.value)} type="password" value={supervisorSecret} /></label><button className="primary-button primary-button--compact" onClick={() => void run({ type: 'count-postal-supply-inventory', context: context(), target: inventoryTarget, employeeId: inventoryTarget === 'employee' ? employeeId : null, employeeName: inventoryTarget === 'employee' ? employee.name : null, lines: rows.map((row) => ({ itemId: row.item.id, quantity: countedQuantities[row.item.id] ?? row.expectedQuantity })), supervisorId, supervisorSecret }, '库存盘点保存成功。')} type="button">保存</button></section></>
  }

  function balancePanel(): ReactNode {
    if (!workspace) return null
    const target = pageMode === 'institution' ? 'institution' : 'employee'
    const rows = calculatePostalSupplyBalance(workspace, target, dateFrom, dateTo, employeeId).filter((row) => !itemTerm || row.item.label.includes(itemTerm) || row.item.mnemonic.includes(itemTerm.toUpperCase()))
    const exportRows = [['物品名称', '物品编码', '单位', '单价', '上存', '入库/下发', '下发个人', '销售', '个人回收', '机构退回', '盘点差异', '结存'], ...rows.map((row) => [row.item.label, row.item.mnemonic, row.item.unit, formatCents(row.item.unitPriceCents), row.openingQuantity, row.inboundQuantity + row.receivedQuantity, row.issuedQuantity, row.salesQuantity, row.returnedByEmployeeQuantity, row.returnedToSuperiorQuantity, row.adjustmentQuantity, row.closingQuantity])]
    return <>{target === 'employee' ? <section className="supply-management__filters"><label><span>查询员工</span><select aria-label="平衡统计员工" onChange={(event) => setEmployeeId(event.target.value)} value={employeeId}>{EMPLOYEES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.id} {candidate.name}</option>)}</select></label></section> : null}<section className="supply-management__filters"><label><span>统计日期</span><input aria-label="平衡统计开始日期" onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} /></label><span>至</span><label><span className="sr-only">结束日期</span><input aria-label="平衡统计结束日期" onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} /></label><label><span>物品名称</span><input aria-label="平衡统计物品名称" onChange={(event) => setItemTerm(event.target.value)} value={itemTerm} /></label><button className="primary-button primary-button--compact" type="button">查询</button><button className="warning-button" onClick={() => downloadCsv(`${target === 'employee' ? '个人' : '支局'}用邮物品平衡统计.csv`, exportRows)} type="button">导出</button></section><div className="supply-management__table-wrap"><table className="supply-management__table supply-management__table--balance"><thead><tr><th rowSpan={2}>物品名称</th><th rowSpan={2}>物品编码</th><th rowSpan={2}>单位</th><th rowSpan={2}>单价</th><th colSpan={2}>上存</th><th colSpan={2}>{target === 'employee' ? '下发个人' : '入库'}</th><th colSpan={2}>销售</th><th colSpan={2}>{target === 'employee' ? '个人回收' : '下发个人'}</th><th colSpan={2}>结存</th></tr><tr><th>数量</th><th>金额</th><th>数量</th><th>金额</th><th>数量</th><th>金额</th><th>数量</th><th>金额</th><th>数量</th><th>金额</th></tr></thead><tbody>{rows.map((row) => { const flow = row.inboundQuantity + row.receivedQuantity; const returnOrIssue = target === 'employee' ? row.returnedByEmployeeQuantity : row.issuedQuantity; return <tr key={row.item.id}><td>{row.item.label}</td><td>{row.item.mnemonic}</td><td>{row.item.unit}</td><td>{formatCents(row.item.unitPriceCents)}</td><td>{row.openingQuantity}</td><td>{formatCents(row.openingQuantity * row.item.unitPriceCents)}</td><td>{flow}</td><td>{formatCents(flow * row.item.unitPriceCents)}</td><td>{row.salesQuantity}</td><td>{formatCents(row.salesQuantity * row.item.unitPriceCents)}</td><td>{returnOrIssue}</td><td>{formatCents(returnOrIssue * row.item.unitPriceCents)}</td><td>{row.closingQuantity}</td><td>{formatCents(row.closingQuantity * row.item.unitPriceCents)}</td></tr> })}</tbody></table></div></>
  }

  function salesPanel(): ReactNode {
    if (!workspace) return null
    const rows = queryPostalSupplySalesStats(workspace, dateFrom, dateTo, salesSource).filter((row) => salesMethod === 'institution' || row.operator.operatorId === employeeId)
    const exportRows = [['数据来源', '查询流水号', '物品编码', '物品名称', '单价', '单位', '员工工号', '员工姓名', '台席', '总数量', '总金额', '销售日期'], ...rows.map((row) => [row.source === 'postal-supply-sale' ? '用邮物品销售' : '前台寄递', row.id, row.mnemonic, row.label, formatCents(row.unitPriceCents), row.unit, row.operator.operatorId, row.operator.displayName, row.operator.workstationCode, row.quantity, formatCents(row.amountCents), businessCalendarDay(row.acceptedAt)])]
    return <><section className="supply-management__filters supply-management__filters--sales"><label><span>网点</span><input readOnly value={operator.acceptanceOffice} /></label><label><span>台席</span><input readOnly value={operator.workstationCode} /></label><label><span>付费方式</span><select disabled><option>全部</option></select></label><label><span>数据来源</span><select aria-label="销售统计数据来源" onChange={(event) => setSalesSource(event.target.value as typeof salesSource)} value={salesSource}><option value="all">全部</option><option value="postal-supply-sale">用邮物品销售</option><option value="counter-mail">前台寄递</option></select></label><label><span>销售人员</span><select aria-label="销售统计员工" disabled={salesMethod === 'institution'} onChange={(event) => setEmployeeId(event.target.value)} value={employeeId}>{EMPLOYEES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.id} {candidate.name}</option>)}</select></label><label><span>统计日期范围</span><input aria-label="销售统计开始日期" onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} /></label><span>至</span><label><span className="sr-only">结束日期</span><input aria-label="销售统计结束日期" onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} /></label><fieldset><legend>统计方式</legend><label><input checked={salesMethod === 'employee'} onChange={() => setSalesMethod('employee')} type="radio" />按人员</label><label><input checked={salesMethod === 'institution'} onChange={() => setSalesMethod('institution')} type="radio" />按支局</label></fieldset><button className="primary-button primary-button--compact" type="button">查询</button><button className="secondary-button" onClick={() => downloadCsv('用邮物品销售统计.csv', exportRows)} type="button">导出</button><button className="warning-button" onClick={() => window.print()} type="button">打印</button></section><div className="supply-management__table-wrap"><table className="supply-management__table"><thead><tr><th>序号</th><th>数据来源</th><th>查询流水号</th><th>物品种类</th><th>物品名称</th><th>单价</th><th>单位</th><th>员工工号</th><th>员工姓名</th><th>台席</th><th>总数量</th><th>总金额</th><th>销售日期</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.id}-${row.itemId}`}><td>{index + 1}</td><td>{row.source === 'postal-supply-sale' ? '用邮物品销售' : '前台寄递'}</td><td>{row.id}</td><td>{row.mnemonic}</td><td>{row.label}</td><td>{formatCents(row.unitPriceCents)}</td><td>{row.unit}</td><td>{row.operator.operatorId}</td><td>{row.operator.displayName}</td><td>{row.operator.workstationCode}</td><td>{row.quantity}</td><td>{formatCents(row.amountCents)}</td><td>{businessCalendarDay(row.acceptedAt)}</td></tr>)}{rows.length === 0 ? <tr><td className="supply-management__empty" colSpan={13}>无数据</td></tr> : null}</tbody><tfoot><tr><td colSpan={10}>合计</td><td>{rows.reduce((total, row) => total + row.quantity, 0)}</td><td>{formatCents(rows.reduce((total, row) => total + row.amountCents, 0))}</td><td /></tr></tfoot></table></div></>
  }

  if (!workspace) return <section className="supply-management"><p>正在读取用邮物品台账…</p></section>

  let content: ReactNode
  if (section === 'approval') content = approvalPanel()
  else if (section === 'receipt') content = receiptPanel()
  else if (section === 'inventory') content = inventoryPanel()
  else if (section === 'balance') content = balancePanel()
  else if (section === 'sales') content = salesPanel()
  else if (pageMode === 'work') content = operationPanel()
  else {
    const filtered = documents.filter((document) => section === 'inbound'
      ? document.kind === 'inbound'
      : section === 'requisition'
        ? document.kind === 'requisition'
        : section === 'issue'
          ? document.kind === 'employee-issue'
          : pageMode === 'employee-query'
            ? document.kind === 'employee-return'
            : document.kind === 'institution-return')
    content = <>{queryFilters()}<DocumentTable actions={(section === 'requisition' || section === 'return') ? (document) => document.status === 'pending-approval' ? <><button className="secondary-button secondary-button--small" onClick={() => editRequest(document)} type="button">修改</button><button className="danger-button" onClick={() => void run({ type: 'delete-postal-supply-request', context: context(), documentId: document.id }, '申请记录删除成功。')} type="button">删除</button></> : null : undefined} documents={filtered} /></>
  }

  return (
    <section aria-label={SECTION_TITLES[section]} className="supply-management">
      <header className="supply-management__heading"><div><p className="shell-breadcrumb">营业渠道 / 用邮物品管理 / {SECTION_TITLES[section]}</p><h1>{SECTION_TITLES[section]}</h1></div><button className="secondary-button" onClick={onBack} type="button">返回工作台</button></header>
      {tabs.length > 0 ? <TabBar active={section === 'balance' && pageMode === 'work' ? 'employee' : pageMode} onChange={(value) => setPageMode(value)} tabs={tabs} /> : null}
      {content}
      {notice ? <p className="customer-form-success" role="status">{notice}</p> : null}
      {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
      {pickerOpen ? <ItemPicker available={available} onAdd={addPickerItems} onClose={() => setPickerOpen(false)} /> : null}
    </section>
  )
}
