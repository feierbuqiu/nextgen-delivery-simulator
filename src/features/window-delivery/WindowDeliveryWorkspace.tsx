import { useEffect, useMemo, useState } from 'react'

import type { RequestOnSiteAuthorization } from '../../domain/access/workAuthorization'
import type { IdentityType } from '../../domain/customer/types'
import { formatCents } from '../../domain/service/policy'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import type { ServiceRepository } from '../../domain/service/repository'
import type {
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
  WindowDeliveryCancellationInfo,
  WindowDeliveryItem,
  WindowDeliveryMoney,
  WindowDeliveryPrintKind,
  WindowDeliverySource,
  WindowDeliveryStatus,
  WindowDeliveryTender,
  WindowDeliveryTransferInfo,
} from '../../domain/service/types'
import {
  calculateWindowDeliveryBalance,
  EMPTY_WINDOW_DELIVERY_MONEY,
  queryWindowDeliveryBags,
  queryWindowDeliveryItems,
  windowDeliveryMoneyTotal,
  windowDeliverySourceLabel,
  windowDeliveryStatusLabel,
  type WindowDeliveryBagQuery,
  type WindowDeliveryCommand,
  type WindowDeliveryItemQuery,
  type WindowDeliveryItemRevision,
  type WindowDeliverySupplementDraft,
} from '../../domain/service/windowDelivery'
import { CurrencyInput } from '../../ui/CurrencyInput'
import { Modal } from '../../ui/Modal'

export type WindowDeliverySection =
  | 'import'
  | 'supplement'
  | 'delivery-return'
  | 'delivery-to-window'
  | 'maintenance'
  | 'transfer'
  | 'reminder'
  | 'cancellation'
  | 'balance'
  | 'query'

interface WindowDeliveryWorkspaceProps {
  section: WindowDeliverySection
  operator: ServiceOperatorSnapshot
  repository: ServiceRepository
  onBack: () => void
  authorizeOnSite: RequestOnSiteAuthorization
}

type WindowDeliveryUiCommand =
  | Exclude<WindowDeliveryCommand, { type: 'create-window-delivery-supplement' }>
  | (Extract<WindowDeliveryCommand, { type: 'create-window-delivery-supplement' }> & {
      supervisorId: string
      supervisorSecret: string
    })

const SECTION_TITLES: Record<WindowDeliverySection, string> = {
  import: '窗投进口处理',
  supplement: '窗投补录',
  'delivery-return': '投递转退邮件接收',
  'delivery-to-window': '投递转窗投邮件接收',
  maintenance: '窗投查改',
  transfer: '窗投转退',
  reminder: '窗投催领逾退',
  cancellation: '窗投销号',
  balance: '窗投平衡统计',
  query: '窗投查询统计',
}

const MONEY_FIELDS: Array<{ key: keyof WindowDeliveryMoney; label: string }> = [
  { key: 'taxCents', label: '税款' },
  { key: 'inspectionCents', label: '验关费' },
  { key: 'returnPostageCents', label: '退回用户资费' },
  { key: 'redirectedReturnPostageCents', label: '转退资费' },
  { key: 'underpaidPostageCents', label: '欠资邮费' },
  { key: 'underpaidHandlingCents', label: '欠资手续费' },
  { key: 'storageWaitCents', label: '存局候领费' },
  { key: 'extensionServiceCents', label: '延伸服务费' },
  { key: 'codPaymentCents', label: '代收款' },
  { key: 'insuranceValueCents', label: '保价金额' },
  { key: 'insuranceFeeCents', label: '保价费' },
  { key: 'insuredAmountCents', label: '保险金额' },
]

const IDENTITY_OPTIONS: Array<{ value: Exclude<IdentityType, ''>; label: string }> = [
  { value: 'primary', label: '居民身份证' },
  { value: 'temporary', label: '临时身份证' },
  { value: 'residence', label: '居住证' },
  { value: 'travel', label: '旅行证件' },
]

function localDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localTimestamp(date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')
  const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, '0')
  return `${localDateValue(date)}T${hours}:${minutes}:${seconds}.${milliseconds}${sign}${offsetHours}:${offsetRemainder}`
}

function emptyBagQuery(): WindowDeliveryBagQuery {
  return { bagCode: '', routeCode: '', itemCode: '' }
}

function emptyItemQuery(): WindowDeliveryItemQuery {
  return {
    source: '',
    status: '',
    productCode: '',
    itemCode: '',
    recipientName: '',
    recipientMobile: '',
    receivedDateFrom: '',
    receivedDateTo: '',
    postingDateFrom: '',
    postingDateTo: '',
  }
}

function emptySupplement(today: string): WindowDeliverySupplementDraft {
  return {
    productCode: '200000',
    productName: '本埠给据信函',
    itemCode: '',
    dispatchListNumber: '',
    receivingOffice: '景麓营业部',
    destinationOffice: '云浦寄达局',
    sendingOffice: '松岚寄递点',
    senderName: '',
    senderPhone: '',
    senderAddress: '',
    recipientName: '',
    recipientMobile: '',
    recipientPhone: '',
    recipientAddress: '',
    mailNote: '',
    nonStandard: false,
    pieces: 1,
    innerPieces: 1,
    weightGrams: 20,
    postingDate: today,
    receivedDate: today,
    specialSequence: 12001,
    money: { ...EMPTY_WINDOW_DELIVERY_MONEY },
  }
}

function defaultTransfer(item: WindowDeliveryItem | null): WindowDeliveryTransferInfo {
  return {
    transferFlag: 'return',
    destinationProvince: '云浦',
    destinationCity: '云浦',
    destinationCounty: '湖岸',
    destinationPostcode: '999001',
    destinationOffice: item?.sendingOffice ?? '松岚寄递点',
    recipientName: item?.senderName ?? '',
    recipientPhone: item?.senderPhone ?? '',
    recipientAddress: item?.senderAddress ?? '',
    reason: '收件人申请退回',
  }
}

function defaultCancellation(): WindowDeliveryCancellationInfo {
  return {
    claimantName: '',
    claimantIdentityType: 'primary',
    claimantIdentityNumber: '',
    agentName: '',
    agentIdentityType: null,
    agentIdentityNumber: '',
    tender: 'cash',
  }
}

function displayDateTime(value: string | null): string {
  return value ? value.slice(0, 19).replace('T', ' ') : '—'
}

function setContains(set: Set<string>, id: string, checked: boolean): Set<string> {
  const next = new Set(set)
  if (checked) next.add(id)
  else next.delete(id)
  return next
}

function ItemTable({
  items,
  selected,
  onSelect,
  onInspect,
}: {
  items: WindowDeliveryItem[]
  selected: Set<string>
  onSelect: (id: string, checked: boolean) => void
  onInspect?: (item: WindowDeliveryItem) => void
}) {
  return (
    <div className="window-delivery__table-scroll">
      <table className="window-delivery__table">
        <thead><tr><th>选择</th><th>序号</th><th>业务产品</th><th>邮件号码</th><th>来源</th><th>收件人</th><th>手机</th><th>投单日期</th><th>状态</th><th>金额</th><th>详情</th></tr></thead>
        <tbody>
          {items.length === 0 ? <tr><td className="window-delivery__empty" colSpan={11}>暂无符合条件的邮件</td></tr> : items.map((item, index) => (
            <tr key={item.id}>
              <td><input aria-label={`选择邮件 ${item.itemCode}`} checked={selected.has(item.id)} onChange={(event) => onSelect(item.id, event.target.checked)} type="checkbox" /></td>
              <td>{index + 1}</td><td>{item.productName}<small>{item.productCode}</small></td><td>{item.itemCode}</td><td>{windowDeliverySourceLabel(item.source)}</td><td>{item.recipientName}</td><td>{item.recipientMobile || '—'}</td><td>{item.postingDate}</td><td>{windowDeliveryStatusLabel(item.status)}</td><td>{formatCents(windowDeliveryMoneyTotal(item.money))}</td>
              <td>{onInspect ? <button className="window-delivery__link" onClick={() => onInspect(item)} type="button">详情</button> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ItemDetail({ item }: { item: WindowDeliveryItem }) {
  return <div className="window-delivery__detail"><dl><div><dt>邮件号码</dt><dd>{item.itemCode}</dd></div><div><dt>业务产品</dt><dd>{item.productName}（{item.productCode}）</dd></div><div><dt>来源</dt><dd>{windowDeliverySourceLabel(item.source)}</dd></div><div><dt>状态</dt><dd>{windowDeliveryStatusLabel(item.status)}</dd></div><div><dt>寄件人</dt><dd>{item.senderName || '—'} {item.senderPhone}</dd></div><div><dt>收件人</dt><dd>{item.recipientName} {item.recipientMobile}</dd></div><div><dt>收件地址</dt><dd>{item.recipientAddress}</dd></div><div><dt>寄达局</dt><dd>{item.destinationOffice}</dd></div><div><dt>投单日期</dt><dd>{item.postingDate}</dd></div><div><dt>接收时间</dt><dd>{displayDateTime(item.receivedAt)}</dd></div><div><dt>接收专号</dt><dd>{item.specialSequence || '—'}</dd></div><div><dt>费用合计</dt><dd>{formatCents(windowDeliveryMoneyTotal(item.money))} 元</dd></div></dl></div>
}

export function WindowDeliveryWorkspace({
  section,
  operator,
  repository,
  onBack,
  authorizeOnSite,
}: WindowDeliveryWorkspaceProps) {
  const today = businessCalendarDay(new Date())
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [bagQuery, setBagQuery] = useState<WindowDeliveryBagQuery>(emptyBagQuery)
  const [itemQuery, setItemQuery] = useState<WindowDeliveryItemQuery>(emptyItemQuery)
  const [selectedBags, setSelectedBags] = useState<Set<string>>(new Set())
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [dispatchNumber, setDispatchNumber] = useState('')
  const [scanCode, setScanCode] = useState('')
  const [sequenceProductCode, setSequenceProductCode] = useState('200000')
  const [sequenceProductName, setSequenceProductName] = useState('本埠给据信函')
  const [sequenceStart, setSequenceStart] = useState('12001')
  const [supplement, setSupplement] = useState<WindowDeliverySupplementDraft>(() => emptySupplement(today))
  const [supervisorId, setSupervisorId] = useState('')
  const [supervisorSecret, setSupervisorSecret] = useState('')
  const [detailItem, setDetailItem] = useState<WindowDeliveryItem | null>(null)
  const [editingItem, setEditingItem] = useState<WindowDeliveryItem | null>(null)
  const [revision, setRevision] = useState<WindowDeliveryItemRevision | null>(null)
  const [transferItem, setTransferItem] = useState<WindowDeliveryItem | null>(null)
  const [transfer, setTransfer] = useState<WindowDeliveryTransferInfo>(() => defaultTransfer(null))
  const [cancellationItem, setCancellationItem] = useState<WindowDeliveryItem | null>(null)
  const [cancellation, setCancellation] = useState<WindowDeliveryCancellationInfo>(defaultCancellation)
  const [balanceFrom, setBalanceFrom] = useState(`${today.slice(0, 7)}-01`)
  const [balanceTo, setBalanceTo] = useState(today)
  const [printPreview, setPrintPreview] = useState<{ kind: WindowDeliveryPrintKind; items: WindowDeliveryItem[] } | null>(null)

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (active) setWorkspace(loaded)
    })
    return () => { active = false }
  }, [repository])

  const bags = useMemo(() => workspace ? queryWindowDeliveryBags(workspace, bagQuery) : [], [bagQuery, workspace])
  const filteredItems = useMemo(() => workspace ? queryWindowDeliveryItems(workspace, itemQuery) : [], [itemQuery, workspace])
  const sourceItems = useMemo(() => {
    if (!workspace) return []
    const source: WindowDeliverySource | null = section === 'delivery-return'
      ? 'delivery-return'
      : section === 'delivery-to-window'
        ? 'delivery-to-window'
        : null
    return workspace.windowDeliveryItems.filter((item) => item.status !== 'deleted' && (!source || item.source === source))
  }, [section, workspace])
  const balance = useMemo(() => {
    if (!workspace) return null
    try { return calculateWindowDeliveryBalance(workspace, balanceFrom, balanceTo) } catch { return null }
  }, [balanceFrom, balanceTo, workspace])

  async function run(command: WindowDeliveryUiCommand, success: string): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    setError('')
    setNotice('')
    try {
      let executable: WindowDeliveryCommand = command
      if (command.type === 'create-window-delivery-supplement') {
        const { supervisorId, supervisorSecret, ...supplementCommand } = command
        const needsAuthorization = command.draft.money.returnPostageCents > 0 ||
          command.draft.productCode === '250200'
        const authorization = needsAuthorization
          ? await authorizeOnSite(
              'create-window-delivery-supplement',
              supervisorId,
              supervisorSecret,
              command.createdAt,
            )
          : undefined
        executable = { ...supplementCommand, authorization }
        setSupervisorSecret('')
      }
      const result = await repository.executeWindowDelivery(executable)
      setWorkspace(result.state)
      setSelectedBags(new Set())
      setSelectedItems(new Set())
      setNotice(success)
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '窗投业务处理失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  function updateSupplement<Key extends keyof WindowDeliverySupplementDraft>(key: Key, value: WindowDeliverySupplementDraft[Key]): void {
    setSupplement((current) => ({ ...current, [key]: value }))
    setError('')
  }

  function updateSupplementMoney(key: keyof WindowDeliveryMoney, value: number | null): void {
    setSupplement((current) => ({ ...current, money: { ...current.money, [key]: value ?? 0 } }))
  }

  function scanSelect(items: WindowDeliveryItem[]): void {
    const normalized = scanCode.trim().toUpperCase()
    const match = items.find((item) => item.itemCode.toUpperCase() === normalized)
    if (!match) {
      setError('未在当前列表找到该邮件号码。')
      return
    }
    setSelectedItems((current) => setContains(current, match.id, true))
    setScanCode('')
    setError('')
    setNotice(`已扫描选中 ${match.itemCode}。`)
  }

  function openRevision(item: WindowDeliveryItem): void {
    setEditingItem(item)
    setRevision({
      recipientName: item.recipientName,
      recipientMobile: item.recipientMobile,
      recipientPhone: item.recipientPhone,
      recipientAddress: item.recipientAddress,
      mailNote: item.mailNote,
      pieces: item.pieces,
      innerPieces: item.innerPieces,
      weightGrams: item.weightGrams,
      money: { ...item.money },
    })
  }

  async function preparePrint(kind: WindowDeliveryPrintKind, items: WindowDeliveryItem[]): Promise<void> {
    if (items.length === 0) {
      setError('请先选择需要打印的邮件。')
      return
    }
    const printed = await run({ type: 'record-window-delivery-print', itemIds: items.map((item) => item.id), kind, printedAt: localTimestamp(), operator }, '已生成打印记录。')
    if (printed) setPrintPreview({ kind, items })
  }

  const title = SECTION_TITLES[section]
  if (!workspace) return <section className="window-delivery"><p>正在读取窗投台账……</p></section>

  const statusMessage = <>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}{notice ? <p className="customer-form-success" role="status">{notice}</p> : null}</>

  function receivePanel(source: 'delivery-return' | 'delivery-to-window') {
    const items = sourceItems.filter((item) => item.source === source)
    const pending = items.filter((item) => item.status === 'pending-receipt')
    return <><section className="window-delivery__filter"><label><span>接收日期</span><input aria-label="窗投接收日期" onChange={(event) => setItemQuery((current) => ({ ...current, postingDateFrom: event.target.value, postingDateTo: event.target.value }))} type="date" value={itemQuery.postingDateFrom} /></label><label><span>邮件号码</span><input aria-label="窗投接收邮件号码" onChange={(event) => setItemQuery((current) => ({ ...current, itemCode: event.target.value }))} value={itemQuery.itemCode} /></label><button className="secondary-button" onClick={() => setNotice(`查到 ${items.length} 条记录。`)} type="button">查询</button></section><section className="window-delivery__toolbar"><label className="window-delivery__scan"><span>扫描录入</span><input aria-label="窗投扫描录入" onChange={(event) => setScanCode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') scanSelect(pending) }} value={scanCode} /></label><button className="secondary-button" onClick={() => scanSelect(pending)} type="button">扫描</button><button className="primary-button primary-button--compact" disabled={busy} onClick={() => void run({ type: 'receive-window-delivery-items', itemIds: [...selectedItems], receivedAt: localTimestamp(), operator }, '接收成功，记录已进入窗投库存。')} type="button">确认接收</button>{source === 'delivery-to-window' ? <button className="secondary-button" onClick={() => void run({ type: 'set-window-delivery-sequence-start', productCode: sequenceProductCode, productName: sequenceProductName, startNumber: Number(sequenceStart), operatedAt: localTimestamp(), operator }, '接收专号起号已保存。')} type="button">专号起号维护</button> : null}</section><ItemTable items={items.filter((item) => !itemQuery.itemCode || item.itemCode.toUpperCase().includes(itemQuery.itemCode.toUpperCase()))} onInspect={setDetailItem} onSelect={(id, checked) => setSelectedItems((current) => setContains(current, id, checked))} selected={selectedItems} /><section className="window-delivery__toolbar window-delivery__toolbar--footer"><button className="secondary-button" onClick={() => { const selected = items.filter((item) => selectedItems.has(item.id)); void preparePrint('pickup-notice', selected) }} type="button">打印取件通知单</button></section></>
  }

  return (
    <section aria-label={title} className="window-delivery">
      <header className="window-delivery__heading"><div><p className="shell-breadcrumb">营业渠道 / 窗投业务 / {title}</p><h1>{title}</h1></div><button className="secondary-button" onClick={onBack} type="button">返回工作台</button></header>

      {section === 'import' ? <>
        <section className="window-delivery__filter window-delivery__filter--four"><label><span>总包条码</span><input aria-label="进口总包条码" onChange={(event) => setBagQuery((current) => ({ ...current, bagCode: event.target.value }))} value={bagQuery.bagCode} /></label><label><span>路单编码</span><input aria-label="进口路单编码" onChange={(event) => setBagQuery((current) => ({ ...current, routeCode: event.target.value }))} value={bagQuery.routeCode} /></label><label><span>邮件号码</span><input aria-label="进口邮件号码" onChange={(event) => setBagQuery((current) => ({ ...current, itemCode: event.target.value }))} value={bagQuery.itemCode} /></label><button className="secondary-button" onClick={() => setNotice(`查到 ${bags.length} 个总包。`)} type="button">查询</button></section>
        <section className="window-delivery__toolbar"><button className="primary-button primary-button--compact" disabled={busy} onClick={() => void run({ type: 'receive-window-delivery-bags', bagIds: [...selectedBags], receivedAt: localTimestamp(), operator }, '总包接收成功。')} type="button">确认接收</button><label className="window-delivery__inline"><span>派车单号</span><input aria-label="窗投派车单号" onChange={(event) => setDispatchNumber(event.target.value)} value={dispatchNumber} /></label><button className="secondary-button" onClick={() => void run({ type: 'unbind-window-delivery-dispatch', dispatchListNumber: dispatchNumber, bagIds: [...selectedBags], receivedAt: localTimestamp(), operator }, '解车并接收总包成功。')} type="button">解车</button></section>
        <div className="window-delivery__table-scroll"><table className="window-delivery__table"><thead><tr><th>选择</th><th>序号</th><th>总包条码</th><th>派车单号</th><th>路单编码</th><th>未接收件数</th><th>接收状态</th></tr></thead><tbody>{bags.map((bag, index) => { const pendingCount = workspace.windowDeliveryItems.filter((item) => bag.itemIds.includes(item.id) && item.status === 'pending-receipt').length; return <tr key={bag.id}><td><input aria-label={`选择总包 ${bag.bagCode}`} checked={selectedBags.has(bag.id)} onChange={(event) => setSelectedBags((current) => setContains(current, bag.id, event.target.checked))} type="checkbox" /></td><td>{index + 1}</td><td>{bag.bagCode}</td><td>{bag.dispatchListNumber}</td><td>{bag.routeCode}</td><td>{pendingCount}</td><td>{bag.receivedAt ? '已接收' : '待接收'}</td></tr> })}</tbody></table></div>
        <h2 className="window-delivery__subheading">总包内邮件明细</h2><section className="window-delivery__toolbar"><label className="window-delivery__scan"><span>电子勾核</span><input aria-label="进口邮件扫描" onChange={(event) => setScanCode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') scanSelect(workspace.windowDeliveryItems.filter((item) => item.source === 'import-bag')) }} value={scanCode} /></label><button className="secondary-button" onClick={() => scanSelect(workspace.windowDeliveryItems.filter((item) => item.source === 'import-bag'))} type="button">扫描</button><button className="primary-button primary-button--compact" onClick={() => void run({ type: 'receive-window-delivery-items', itemIds: [...selectedItems], receivedAt: localTimestamp(), operator }, '邮件接收成功，已进入窗投库存。')} type="button">确认邮件</button><button className="secondary-button" onClick={() => void run({ type: 'delete-window-delivery-pending-items', itemIds: [...selectedItems], deletedAt: localTimestamp(), operator }, '已删除所选待接收邮件。')} type="button">批量删除</button></section><ItemTable items={workspace.windowDeliveryItems.filter((item) => item.source === 'import-bag' && item.status !== 'deleted' && (!bagQuery.itemCode || item.itemCode.toUpperCase().includes(bagQuery.itemCode.toUpperCase())))} onInspect={setDetailItem} onSelect={(id, checked) => setSelectedItems((current) => setContains(current, id, checked))} selected={selectedItems} />
        <details className="window-delivery__sequence"><summary>查询接收专号起号</summary><div><label><span>业务产品代码</span><input aria-label="进口专号业务产品代码" maxLength={6} onChange={(event) => setSequenceProductCode(event.target.value.toUpperCase())} value={sequenceProductCode} /></label><label><span>业务产品名称</span><input aria-label="进口专号业务产品名称" onChange={(event) => setSequenceProductName(event.target.value)} value={sequenceProductName} /></label><label><span>起始专号</span><input aria-label="进口接收专号" inputMode="numeric" onChange={(event) => setSequenceStart(event.target.value.replace(/\D/g, ''))} value={sequenceStart} /></label><button className="secondary-button" onClick={() => void run({ type: 'set-window-delivery-sequence-start', productCode: sequenceProductCode, productName: sequenceProductName, startNumber: Number(sequenceStart), operatedAt: localTimestamp(), operator }, '接收专号起号已保存。')} type="button">保存</button></div></details>
      </> : null}

      {section === 'supplement' ? <form className="window-delivery__supplement" onSubmit={(event) => { event.preventDefault(); void run({ type: 'create-window-delivery-supplement', draft: supplement, createdAt: localTimestamp(), operator, supervisorId, supervisorSecret }, '窗投补录成功，记录已进入窗投台账。').then(() => setSupplement(emptySupplement(today))) }}><fieldset><legend>邮件基本信息</legend><div className="window-delivery__form-grid"><label><span>* 业务产品代码</span><input aria-label="补录业务产品代码" maxLength={6} onChange={(event) => updateSupplement('productCode', event.target.value.toUpperCase())} value={supplement.productCode} /></label><label><span>* 业务产品名称</span><input aria-label="补录业务产品名称" onChange={(event) => updateSupplement('productName', event.target.value)} value={supplement.productName} /></label><label><span>* 邮件号码</span><input aria-label="补录邮件号码" onChange={(event) => updateSupplement('itemCode', event.target.value.toUpperCase())} value={supplement.itemCode} /></label><label><span>派车单号</span><input aria-label="补录派车单号" onChange={(event) => updateSupplement('dispatchListNumber', event.target.value)} value={supplement.dispatchListNumber} /></label><label><span>* 收寄局</span><input aria-label="补录收寄局" onChange={(event) => updateSupplement('receivingOffice', event.target.value)} value={supplement.receivingOffice} /></label><label><span>* 寄达局</span><input aria-label="补录寄达局" onChange={(event) => updateSupplement('destinationOffice', event.target.value)} value={supplement.destinationOffice} /></label><label><span>寄件人</span><input aria-label="补录寄件人" onChange={(event) => updateSupplement('senderName', event.target.value)} value={supplement.senderName} /></label><label><span>寄件人电话</span><input aria-label="补录寄件人电话" onChange={(event) => updateSupplement('senderPhone', event.target.value)} value={supplement.senderPhone} /></label><label className="window-delivery__wide"><span>寄件人地址</span><input aria-label="补录寄件人地址" onChange={(event) => updateSupplement('senderAddress', event.target.value)} value={supplement.senderAddress} /></label><label><span>* 收件人</span><input aria-label="补录收件人" onChange={(event) => updateSupplement('recipientName', event.target.value)} value={supplement.recipientName} /></label><label><span>收件人手机</span><input aria-label="补录收件人手机" onChange={(event) => updateSupplement('recipientMobile', event.target.value)} value={supplement.recipientMobile} /></label><label className="window-delivery__wide"><span>* 收件人地址</span><input aria-label="补录收件人地址" onChange={(event) => updateSupplement('recipientAddress', event.target.value)} value={supplement.recipientAddress} /></label><label><span>件数</span><input aria-label="补录件数" min={1} onChange={(event) => updateSupplement('pieces', Number(event.target.value))} type="number" value={supplement.pieces} /></label><label><span>内件数</span><input aria-label="补录内件数" min={0} onChange={(event) => updateSupplement('innerPieces', Number(event.target.value))} type="number" value={supplement.innerPieces} /></label><label><span>重量（克）</span><input aria-label="补录邮件重量" min={1} onChange={(event) => updateSupplement('weightGrams', Number(event.target.value))} type="number" value={supplement.weightGrams} /></label><label><span>投单日期</span><input aria-label="补录投单日期" onChange={(event) => updateSupplement('postingDate', event.target.value)} type="date" value={supplement.postingDate} /></label><label><span>接收日期</span><input aria-label="补录接收日期" onChange={(event) => updateSupplement('receivedDate', event.target.value)} type="date" value={supplement.receivedDate} /></label><label><span>接收专号</span><input aria-label="补录接收专号" min={1} onChange={(event) => updateSupplement('specialSequence', Number(event.target.value))} type="number" value={supplement.specialSequence} /></label><label className="window-delivery__wide"><span>邮件备注</span><input aria-label="补录邮件备注" onChange={(event) => updateSupplement('mailNote', event.target.value)} value={supplement.mailNote} /></label></div></fieldset><fieldset><legend>金额信息</legend><div className="window-delivery__money-grid">{MONEY_FIELDS.map((field) => <label key={field.key}><span>{field.label}</span><CurrencyInput aria-label={`补录${field.label}`} onValueChange={(value) => updateSupplementMoney(field.key, value)} valueCents={supplement.money[field.key]} /></label>)}</div><p className="window-delivery__total">金额合计：{formatCents(windowDeliveryMoneyTotal(supplement.money))} 元</p>{supplement.money.returnPostageCents > 0 || supplement.productCode === '250200' ? <div className="window-delivery__authorization"><label><span>主管工号</span><input aria-label="窗投补录主管工号" onChange={(event) => setSupervisorId(event.target.value)} value={supervisorId} /></label><label><span>主管口令</span><input aria-label="窗投补录主管口令" onChange={(event) => setSupervisorSecret(event.target.value)} type="password" value={supervisorSecret} /></label></div> : null}</fieldset><div className="window-delivery__toolbar window-delivery__toolbar--footer"><button className="primary-button primary-button--compact" disabled={busy} type="submit">保存</button><button className="secondary-button" onClick={() => setSupplement(emptySupplement(today))} type="button">重置</button></div></form> : null}

      {section === 'delivery-return' ? receivePanel('delivery-return') : null}
      {section === 'delivery-to-window' ? receivePanel('delivery-to-window') : null}

      {section === 'maintenance' ? <><section className="window-delivery__filter window-delivery__filter--four"><label><span>业务产品</span><input aria-label="查改业务产品" onChange={(event) => setItemQuery((current) => ({ ...current, productCode: event.target.value }))} value={itemQuery.productCode} /></label><label><span>邮件号码</span><input aria-label="查改邮件号码" onChange={(event) => setItemQuery((current) => ({ ...current, itemCode: event.target.value }))} value={itemQuery.itemCode} /></label><label><span>收件人</span><input aria-label="查改收件人" onChange={(event) => setItemQuery((current) => ({ ...current, recipientName: event.target.value }))} value={itemQuery.recipientName} /></label><label><span>接收日期</span><input aria-label="查改接收日期" onChange={(event) => setItemQuery((current) => ({ ...current, receivedDateFrom: event.target.value, receivedDateTo: event.target.value }))} type="date" value={itemQuery.receivedDateFrom} /></label></section><section className="window-delivery__toolbar"><button className="secondary-button" onClick={() => setNotice(`查到 ${filteredItems.length} 条记录。`)} type="button">查询</button><button className="secondary-button" disabled={selectedItems.size !== 1} onClick={() => { const item = filteredItems.find((row) => selectedItems.has(row.id)); if (item) openRevision(item) }} type="button">修改</button><button className="secondary-button" disabled={selectedItems.size !== 1} onClick={() => { const item = filteredItems.find((row) => selectedItems.has(row.id)); if (item) void run({ type: 'recover-window-delivery-item', itemId: item.id, recoveredAt: localTimestamp(), operator }, '窗投邮件已恢复。') }} type="button">恢复</button><button className="danger-button" disabled={selectedItems.size !== 1} onClick={() => { const item = filteredItems.find((row) => selectedItems.has(row.id)); if (item) void run({ type: 'delete-window-delivery-item', itemId: item.id, deletedAt: localTimestamp(), operator }, '窗投邮件已删除。') }} type="button">删除</button></section><ItemTable items={filteredItems} onInspect={setDetailItem} onSelect={(id, checked) => setSelectedItems((current) => setContains(current, id, checked))} selected={selectedItems} /></> : null}

      {section === 'transfer' ? <><section className="window-delivery__filter"><label><span>* 邮件号码</span><input aria-label="转退邮件号码" onChange={(event) => setItemQuery((current) => ({ ...current, itemCode: event.target.value }))} value={itemQuery.itemCode} /></label><button className="secondary-button" onClick={() => { const match = workspace.windowDeliveryItems.find((item) => item.status === 'stored' && item.itemCode.toUpperCase() === itemQuery.itemCode.trim().toUpperCase()); if (!match) { setError('未找到可转退的库存邮件。'); return } setTransferItem(match); setTransfer(defaultTransfer(match)); setError('') }} type="button">查询</button></section>{transferItem ? <form className="window-delivery__transfer" onSubmit={(event) => { event.preventDefault(); void run({ type: 'transfer-window-delivery-item', itemId: transferItem.id, transfer, processedAt: localTimestamp(), operator }, '转退成功，记录已进入封发边界。').then(() => setTransferItem(null)) }}><ItemDetail item={transferItem} /><fieldset><legend>转退信息</legend><div className="window-delivery__form-grid"><label><span>省份</span><input aria-label="转退省份" onChange={(event) => setTransfer((current) => ({ ...current, destinationProvince: event.target.value }))} value={transfer.destinationProvince} /></label><label><span>地市</span><input aria-label="转退地市" onChange={(event) => setTransfer((current) => ({ ...current, destinationCity: event.target.value }))} value={transfer.destinationCity} /></label><label><span>区县</span><input aria-label="转退区县" onChange={(event) => setTransfer((current) => ({ ...current, destinationCounty: event.target.value }))} value={transfer.destinationCounty} /></label><label><span>* 邮政编码</span><input aria-label="转退邮政编码" maxLength={6} onChange={(event) => setTransfer((current) => ({ ...current, destinationPostcode: event.target.value.replace(/\D/g, '') }))} value={transfer.destinationPostcode} /></label><label><span>* 寄达局</span><input aria-label="转退寄达局" onChange={(event) => setTransfer((current) => ({ ...current, destinationOffice: event.target.value }))} value={transfer.destinationOffice} /></label><label><span>* 收件人</span><input aria-label="转退收件人" onChange={(event) => setTransfer((current) => ({ ...current, recipientName: event.target.value }))} value={transfer.recipientName} /></label><label><span>收件人电话</span><input aria-label="转退收件人电话" onChange={(event) => setTransfer((current) => ({ ...current, recipientPhone: event.target.value }))} value={transfer.recipientPhone} /></label><label><span>* 转退原因</span><select aria-label="转退原因" onChange={(event) => setTransfer((current) => ({ ...current, reason: event.target.value }))} value={transfer.reason}><option>收件人申请退回</option><option>地址不详</option><option>逾期未领</option><option>收件人拒收</option></select></label><label className="window-delivery__wide"><span>* 转退地址</span><input aria-label="转退地址" onChange={(event) => setTransfer((current) => ({ ...current, recipientAddress: event.target.value }))} value={transfer.recipientAddress} /></label></div></fieldset><div className="window-delivery__toolbar window-delivery__toolbar--footer"><button className="primary-button primary-button--compact" disabled={busy} type="submit">确认转退</button></div></form> : <p className="window-delivery__empty-card">输入库存邮件号码后查询。</p>}</> : null}

      {section === 'reminder' ? <><section className="window-delivery__filter"><label><span>邮件号码</span><input aria-label="催领邮件号码" onChange={(event) => setItemQuery((current) => ({ ...current, itemCode: event.target.value }))} value={itemQuery.itemCode} /></label><label><span>接收日期</span><input aria-label="催领接收日期" onChange={(event) => setItemQuery((current) => ({ ...current, receivedDateFrom: event.target.value, receivedDateTo: event.target.value }))} type="date" value={itemQuery.receivedDateFrom} /></label><button className="secondary-button" onClick={() => setNotice(`查到 ${filteredItems.length} 条记录。`)} type="button">查询</button></section><section className="window-delivery__toolbar"><button className="secondary-button" onClick={() => void run({ type: 'generate-window-delivery-reminder', stage: 'first', operatedAt: localTimestamp(), operator }, '一次催领清单已生成。')} type="button">查看一催清单</button><button className="secondary-button" onClick={() => void run({ type: 'generate-window-delivery-reminder', stage: 'second', operatedAt: localTimestamp(), operator }, '二次催领清单已生成。')} type="button">查看二催清单</button><button className="secondary-button" onClick={() => void run({ type: 'generate-window-delivery-reminder', stage: 'overdue', operatedAt: localTimestamp(), operator }, '逾期退回清单已生成。')} type="button">查看逾退清单</button><button className="primary-button primary-button--compact" onClick={() => void preparePrint('query-list', filteredItems.filter((item) => selectedItems.has(item.id)))} type="button">清单打印</button></section><ItemTable items={filteredItems.filter((item) => item.status === 'stored' || item.status === 'overdue-returned')} onInspect={setDetailItem} onSelect={(id, checked) => setSelectedItems((current) => setContains(current, id, checked))} selected={selectedItems} /></> : null}

      {section === 'cancellation' ? <><section className="window-delivery__filter"><label><span>* 邮件号码</span><input aria-label="销号邮件号码" onChange={(event) => setItemQuery((current) => ({ ...current, itemCode: event.target.value }))} value={itemQuery.itemCode} /></label><button className="secondary-button" onClick={() => { const match = workspace.windowDeliveryItems.find((item) => item.status === 'stored' && item.itemCode.toUpperCase() === itemQuery.itemCode.trim().toUpperCase()); if (!match) { setError('未找到可销号的库存邮件。'); return } setCancellationItem(match); setCancellation((current) => ({ ...current, claimantName: match.recipientName })); setError('') }} type="button">调取</button></section>{cancellationItem ? <form className="window-delivery__cancellation" onSubmit={(event) => { event.preventDefault(); void run({ type: 'cancel-window-delivery-item', itemId: cancellationItem.id, cancellation, cancelledAt: localTimestamp(), operator }, '窗投邮件销号成功，费用已记入收入台账。').then(() => setCancellationItem(null)) }}><ItemDetail item={cancellationItem} /><fieldset><legend>领件人信息</legend><div className="window-delivery__form-grid"><label><span>* 领件人姓名</span><input aria-label="销号领件人姓名" onChange={(event) => setCancellation((current) => ({ ...current, claimantName: event.target.value }))} value={cancellation.claimantName} /></label><label><span>* 证件名称</span><select aria-label="销号领件人证件名称" onChange={(event) => setCancellation((current) => ({ ...current, claimantIdentityType: event.target.value as Exclude<IdentityType, ''> }))} value={cancellation.claimantIdentityType}>{IDENTITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>* 证件号码</span><input aria-label="销号领件人证件号码" onChange={(event) => setCancellation((current) => ({ ...current, claimantIdentityNumber: event.target.value.toUpperCase() }))} value={cancellation.claimantIdentityNumber} /></label><label><span>代领人姓名</span><input aria-label="销号代领人姓名" onChange={(event) => setCancellation((current) => ({ ...current, agentName: event.target.value }))} value={cancellation.agentName} /></label><label><span>代领人证件</span><select aria-label="销号代领人证件名称" onChange={(event) => setCancellation((current) => ({ ...current, agentIdentityType: event.target.value ? event.target.value as Exclude<IdentityType, ''> : null }))} value={cancellation.agentIdentityType ?? ''}><option value="">请选择</option>{IDENTITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>代领人证件号</span><input aria-label="销号代领人证件号码" onChange={(event) => setCancellation((current) => ({ ...current, agentIdentityNumber: event.target.value.toUpperCase() }))} value={cancellation.agentIdentityNumber} /></label><label><span>支付方式</span><select aria-label="销号支付方式" onChange={(event) => setCancellation((current) => ({ ...current, tender: event.target.value as WindowDeliveryTender }))} value={cancellation.tender}><option value="cash">现金</option><option value="pos">POS</option><option value="third-party">第三方支付</option></select></label></div></fieldset><div className="window-delivery__toolbar window-delivery__toolbar--footer"><button className="primary-button primary-button--compact" disabled={busy} type="submit">确认销号</button></div></form> : <p className="window-delivery__empty-card">输入邮件号码后调取窗投记录。</p>}</> : null}

      {section === 'balance' ? <><section className="window-delivery__filter"><label><span>开始日期</span><input aria-label="窗投平衡开始日期" onChange={(event) => setBalanceFrom(event.target.value)} type="date" value={balanceFrom} /></label><label><span>结束日期</span><input aria-label="窗投平衡结束日期" onChange={(event) => setBalanceTo(event.target.value)} type="date" value={balanceTo} /></label><button className="secondary-button" onClick={() => setNotice('平衡统计已刷新。')} type="button">查询</button></section>{balance ? <><div className="window-delivery__balance-cards"><article><span>本期件数</span><strong>{balance.totalItems}</strong></article><article><span>税款</span><strong>{formatCents(balance.taxCents)}</strong></article><article><span>退回用户资费</span><strong>{formatCents(balance.returnPostageCents)}</strong></article><article><span>存局候领费</span><strong>{formatCents(balance.storageWaitCents)}</strong></article><article><span>代收款</span><strong>{formatCents(balance.codPaymentCents)}</strong></article></div><div className="window-delivery__table-scroll"><table className="window-delivery__table"><thead><tr><th>业务产品</th><th>上期结转</th><th>进口</th><th>销号</th><th>逾退</th><th>转退</th><th>库存</th></tr></thead><tbody>{balance.rows.map((row) => <tr key={row.productCode}><td>{row.productName}<small>{row.productCode}</small></td><td>{row.carriedForward}</td><td>{row.imported}</td><td>{row.cancelled}</td><td>{row.overdueReturned}</td><td>{row.transferred}</td><td>{row.stored}</td></tr>)}</tbody></table></div></> : null}</> : null}

      {section === 'query' ? <><section className="window-delivery__filter window-delivery__filter--four"><label><span>业务产品</span><input aria-label="窗投查询业务产品" onChange={(event) => setItemQuery((current) => ({ ...current, productCode: event.target.value }))} value={itemQuery.productCode} /></label><label><span>接收日期起</span><input aria-label="窗投查询接收日期起" onChange={(event) => setItemQuery((current) => ({ ...current, receivedDateFrom: event.target.value }))} type="date" value={itemQuery.receivedDateFrom} /></label><label><span>接收日期止</span><input aria-label="窗投查询接收日期止" onChange={(event) => setItemQuery((current) => ({ ...current, receivedDateTo: event.target.value }))} type="date" value={itemQuery.receivedDateTo} /></label><label><span>销号状态</span><select aria-label="窗投查询销号状态" onChange={(event) => setItemQuery((current) => ({ ...current, status: event.target.value as WindowDeliveryStatus | '' }))} value={itemQuery.status}><option value="">全部</option><option value="stored">未销号</option><option value="cancelled">已销号</option><option value="transferred">已转退</option><option value="overdue-returned">已逾退</option></select></label></section><section className="window-delivery__toolbar"><button className="secondary-button" onClick={() => setNotice(`查到 ${filteredItems.length} 条记录。`)} type="button">查询</button><button className="primary-button primary-button--compact" onClick={() => void preparePrint('query-list', filteredItems.filter((item) => selectedItems.has(item.id)))} type="button">清单打印</button></section><ItemTable items={filteredItems} onInspect={setDetailItem} onSelect={(id, checked) => setSelectedItems((current) => setContains(current, id, checked))} selected={selectedItems} /></> : null}

      {statusMessage}

      {detailItem ? <Modal eyebrow="窗投台账" title="邮件详情" wide><ItemDetail item={detailItem} /><div className="modal-actions"><button className="secondary-button" onClick={() => setDetailItem(null)} type="button">关闭</button></div></Modal> : null}
      {editingItem && revision ? <Modal eyebrow="窗投查改" title={`修改 ${editingItem.itemCode}`} wide><div className="window-delivery__form-grid"><label><span>收件人</span><input aria-label="查改收件人" onChange={(event) => setRevision((current) => current ? { ...current, recipientName: event.target.value } : current)} value={revision.recipientName} /></label><label><span>手机</span><input aria-label="查改收件人手机" onChange={(event) => setRevision((current) => current ? { ...current, recipientMobile: event.target.value } : current)} value={revision.recipientMobile} /></label><label className="window-delivery__wide"><span>地址</span><input aria-label="查改收件人地址" onChange={(event) => setRevision((current) => current ? { ...current, recipientAddress: event.target.value } : current)} value={revision.recipientAddress} /></label><label><span>件数</span><input aria-label="查改件数" min={1} onChange={(event) => setRevision((current) => current ? { ...current, pieces: Number(event.target.value) } : current)} type="number" value={revision.pieces} /></label><label><span>重量（克）</span><input aria-label="查改邮件重量" min={1} onChange={(event) => setRevision((current) => current ? { ...current, weightGrams: Number(event.target.value) } : current)} type="number" value={revision.weightGrams} /></label><label className="window-delivery__wide"><span>备注</span><input aria-label="查改邮件备注" onChange={(event) => setRevision((current) => current ? { ...current, mailNote: event.target.value } : current)} value={revision.mailNote} /></label></div><div className="modal-actions"><button className="secondary-button" onClick={() => { setEditingItem(null); setRevision(null) }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => { void run({ type: 'revise-window-delivery-item', itemId: editingItem.id, revision, revisedAt: localTimestamp(), operator }, '窗投邮件信息已修改。').then(() => { setEditingItem(null); setRevision(null) }) }} type="button">保存</button></div></Modal> : null}
      {printPreview ? <Modal eyebrow="窗投打印" title="窗投业务清单" wide><div className="window-delivery__print"><h2>本地寄递演练样张 · 无效</h2><p>{SECTION_TITLES[section]} · {printPreview.kind}</p><table><thead><tr><th>序号</th><th>邮件号码</th><th>业务产品</th><th>收件人</th><th>状态</th></tr></thead><tbody>{printPreview.items.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td>{item.itemCode}</td><td>{item.productName}</td><td>{item.recipientName}</td><td>{windowDeliveryStatusLabel(item.status)}</td></tr>)}</tbody></table><p>操作员：{operator.displayName} · 打印时间：{displayDateTime(localTimestamp())}</p></div><div className="modal-actions"><button className="secondary-button" onClick={() => setPrintPreview(null)} type="button">关闭</button><button className="primary-button primary-button--compact" onClick={() => window.print()} type="button">打印</button></div></Modal> : null}
    </section>
  )
}
