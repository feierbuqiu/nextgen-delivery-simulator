import { useEffect, useMemo, useState } from 'react'

import type { CustomerDraft } from '../../domain/customer/types'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import {
  SUPPLEMENTARY_SUBJECTS,
  matchTrafficMail,
  queryTrafficStatistics,
  roundTripQuoteCents,
  supplementaryTrafficKindLabel,
  trafficMailExample,
  trafficRemarkLabel,
  type AcceptSupplementaryTrafficRequest,
  type TrafficMailMatch,
  type TrafficStatisticsQuery,
} from '../../domain/service/supplementaryTraffic'
import { pendingServiceSummary } from '../../domain/service/transactions'
import type {
  ServicePaymentMethod,
  ServiceWorkspaceState,
  SupplementaryTrafficRecord,
  TrafficMailSnapshot,
} from '../../domain/service/types'
import { CurrencyInput } from '../../ui/CurrencyInput'
import { Modal } from '../../ui/Modal'
import type { ServiceSummary } from './ServiceIntakePanel'

interface SupplementaryTrafficWorkspaceProps {
  customerDraft: CustomerDraft
  repository: ServiceRepository
  onOpenSettlement: () => void
  onSummaryChange: (summary: ServiceSummary) => void
}

type WorkTab = 'supplementary' | 'traffic-bulk' | 'single-journey' | 'round-trip' | 'statistics'
type CapturePurpose = 'bulk' | 'round-trip'

interface SupplementaryDraftRow {
  id: string
  selected: boolean
  subjectCode: string
  count: number
  amountCents: number | null
  paymentMethod: Extract<ServicePaymentMethod, 'cash-settlement' | 'credit'>
}

function emptySupplementaryRow(sequence: number): SupplementaryDraftRow {
  return {
    id: `supplementary-row-${sequence}`,
    selected: true,
    subjectCode: '',
    count: 1,
    amountCents: null,
    paymentMethod: 'cash-settlement',
  }
}

function emptyStatisticsQuery(): TrafficStatisticsQuery {
  const businessDate = businessCalendarDay(new Date())
  return {
    mailNumber: '',
    acceptedDateFrom: businessDate,
    acceptedDateTo: businessDate,
    kind: '',
    remark: '',
  }
}

function kindDate(record: SupplementaryTrafficRecord): string {
  return businessCalendarDay(record.acceptedAt)
}

function mailRecordAmount(record: Exclude<SupplementaryTrafficRecord, { kind: 'supplementary-income' }>): number {
  return record.kind === 'single-journey-payment'
    ? record.collectOnDeliveryCents
    : record.amountCents
}

export function SupplementaryTrafficWorkspace({
  customerDraft,
  repository,
  onOpenSettlement,
  onSummaryChange,
}: SupplementaryTrafficWorkspaceProps) {
  const businessDate = businessCalendarDay(new Date())
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [activeTab, setActiveTab] = useState<WorkTab>('supplementary')
  const [rows, setRows] = useState<SupplementaryDraftRow[]>([emptySupplementaryRow(1)])
  const [nextRowSequence, setNextRowSequence] = useState(2)
  const [subjectRowId, setSubjectRowId] = useState<string | null>(null)
  const [subjectSelection, setSubjectSelection] = useState('')
  const [subjectQuery, setSubjectQuery] = useState('')
  const [capturePurpose, setCapturePurpose] = useState<CapturePurpose | null>(null)
  const [captureMailNumber, setCaptureMailNumber] = useState('')
  const [trafficBulkMatch, setTrafficBulkMatch] = useState<TrafficMailMatch | null>(null)
  const [singleJourneyOpen, setSingleJourneyOpen] = useState(false)
  const [singleJourneyMailNumber, setSingleJourneyMailNumber] = useState('')
  const [collectOnDeliveryCents, setCollectOnDeliveryCents] = useState<number | null>(null)
  const [singleFilters, setSingleFilters] = useState({
    mailNumber: '',
    dateFrom: businessDate,
    dateTo: businessDate,
  })
  const [appliedSingleFilters, setAppliedSingleFilters] = useState(singleFilters)
  const [roundMail, setRoundMail] = useState<TrafficMailSnapshot | null>(null)
  const [roundProductionFeeCents, setRoundProductionFeeCents] = useState<number | null>(0)
  const [roundQuoteCents, setRoundQuoteCents] = useState<number | null>(null)
  const [statisticsQuery, setStatisticsQuery] = useState<TrafficStatisticsQuery>(emptyStatisticsQuery)
  const [appliedStatisticsQuery, setAppliedStatisticsQuery] = useState<TrafficStatisticsQuery>(emptyStatisticsQuery)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      onSummaryChange(pendingServiceSummary(loaded))
    })
    return () => {
      active = false
    }
  }, [onSummaryChange, repository])

  const customerKind = customerDraft.sender.agreementAccountId ? '大宗' : '零星'
  const customerName = customerDraft.sender.agreementAccountName
    || customerDraft.sender.name
    || customerDraft.sender.unit
    || '未维护'
  const selectedSubjectRow = rows.find((row) => row.id === subjectRowId) ?? null
  const filteredSubjects = SUPPLEMENTARY_SUBJECTS.filter((subject) => {
    const query = subjectQuery.trim().toUpperCase()
    return !query || subject.label.includes(subjectQuery.trim()) || subject.code.includes(query)
  })
  const singleJourneyMatch = useMemo(() => {
    try {
      return singleJourneyMailNumber ? matchTrafficMail(singleJourneyMailNumber, 'single-journey') : null
    } catch {
      return null
    }
  }, [singleJourneyMailNumber])
  const singleJourneyRecords = useMemo(() => (
    (workspace?.supplementaryTrafficRecords ?? [])
      .filter((record) => record.kind === 'single-journey-payment')
      .filter((record) => !appliedSingleFilters.mailNumber || record.mail.mailNumber.includes(appliedSingleFilters.mailNumber.trim()))
      .filter((record) => !appliedSingleFilters.dateFrom || kindDate(record) >= appliedSingleFilters.dateFrom)
      .filter((record) => !appliedSingleFilters.dateTo || kindDate(record) <= appliedSingleFilters.dateTo)
      .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))
  ), [appliedSingleFilters, workspace?.supplementaryTrafficRecords])
  const statisticsRecords = useMemo(
    () => queryTrafficStatistics(
      workspace?.supplementaryTrafficRecords ?? [],
      appliedStatisticsQuery,
    ),
    [appliedStatisticsQuery, workspace?.supplementaryTrafficRecords],
  )

  function switchTab(tab: WorkTab): void {
    setActiveTab(tab)
    setNotice('')
    setError('')
    if (tab === 'traffic-bulk') openCapture('bulk')
    if (tab === 'round-trip') openCapture('round-trip')
  }

  function openCapture(purpose: CapturePurpose): void {
    setCapturePurpose(purpose)
    setCaptureMailNumber('')
    setError('')
  }

  function updateRow(id: string, patch: Partial<SupplementaryDraftRow>): void {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
    setError('')
  }

  function addSupplementaryRow(): void {
    setRows((current) => [...current, emptySupplementaryRow(nextRowSequence)])
    setNextRowSequence((current) => current + 1)
    setNotice('')
    setError('')
  }

  function deleteSupplementaryRows(): void {
    const remaining = rows.filter((row) => !row.selected)
    setRows(remaining.length > 0 ? remaining : [emptySupplementaryRow(nextRowSequence)])
    if (remaining.length === 0) setNextRowSequence((current) => current + 1)
    setNotice('已删除选中的补录记录。')
    setError('')
  }

  async function acceptRequest(request: AcceptSupplementaryTrafficRequest) {
    const accepted = await repository.acceptSupplementaryTraffic(request)
    setWorkspace(accepted.state)
    onSummaryChange(pendingServiceSummary(accepted.state))
    return accepted
  }

  async function saveSupplementaryRows(): Promise<void> {
    if (saving) return
    const selected = rows.filter((row) => row.selected)
    if (selected.length === 0) {
      setError('请勾选需要保存的补录记录。')
      return
    }
    const invalid = selected.find((row) => (
      !row.subjectCode || !Number.isInteger(row.count) || row.count < 1 ||
      row.amountCents === null || row.amountCents < 1 ||
      (row.paymentMethod === 'credit' && !customerDraft.sender.agreementAccountId)
    ))
    if (invalid) {
      setError(invalid.paymentMethod === 'credit' && !customerDraft.sender.agreementAccountId
        ? '零星客户不能选择记欠，请先维护协议客户信息。'
        : '请为选中记录填写补录科目、正整数件／笔数和大于 0 元的金额。')
      return
    }
    setSaving(true)
    setError('')
    try {
      let latest: ServiceWorkspaceState | null = null
      for (const row of selected) {
        const accepted = await repository.acceptSupplementaryTraffic({
          kind: 'supplementary-income',
          acceptedAt: new Date().toISOString(),
          sender: customerDraft.sender,
          subjectCode: row.subjectCode,
          count: row.count,
          amountCents: row.amountCents!,
          paymentMethod: row.paymentMethod,
        })
        latest = accepted.state
      }
      if (latest) {
        setWorkspace(latest)
        onSummaryChange(pendingServiceSummary(latest))
      }
      setRows([emptySupplementaryRow(nextRowSequence)])
      setNextRowSequence((current) => current + 1)
      setNotice(`补录保存成功，共 ${selected.length} 条，已提交至结算中心。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '补录保存失败。')
    } finally {
      setSaving(false)
    }
  }

  function confirmSubject(): void {
    if (!selectedSubjectRow || !subjectSelection) {
      setError('请选择补录科目。')
      return
    }
    updateRow(selectedSubjectRow.id, { subjectCode: subjectSelection })
    setSubjectRowId(null)
    setSubjectSelection('')
    setSubjectQuery('')
  }

  function confirmCapture(): void {
    if (!capturePurpose) return
    try {
      if (capturePurpose === 'bulk' && !customerDraft.sender.agreementAccountId) {
        throw new Error('请先维护协议客户信息。')
      }
      const matched = matchTrafficMail(captureMailNumber, capturePurpose)
      if (capturePurpose === 'bulk') {
        setTrafficBulkMatch(matched)
      } else {
        setRoundMail(matched.mail)
        setRoundProductionFeeCents(matched.productionFeeCents)
        setRoundQuoteCents(null)
      }
      setCapturePurpose(null)
      setCaptureMailNumber('')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '邮件号码匹配失败。')
    }
  }

  async function recordTrafficBulk(): Promise<void> {
    if (!trafficBulkMatch || saving) return
    setSaving(true)
    setError('')
    try {
      const accepted = await acceptRequest({
        kind: 'traffic-bulk-mail',
        acceptedAt: new Date().toISOString(),
        sender: customerDraft.sender,
        mailNumber: trafficBulkMatch.mail.mailNumber,
      })
      setTrafficBulkMatch(null)
      setNotice(`录入成功：${accepted.record.id}，已进入结算中心。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '交管大宗邮件录入失败。')
    } finally {
      setSaving(false)
    }
  }

  async function recordSingleJourney(): Promise<void> {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const accepted = await acceptRequest({
        kind: 'single-journey-payment',
        acceptedAt: new Date().toISOString(),
        sender: customerDraft.sender,
        mailNumber: singleJourneyMailNumber,
        collectOnDeliveryCents: collectOnDeliveryCents ?? 0,
      })
      setSingleJourneyOpen(false)
      setSingleJourneyMailNumber('')
      setCollectOnDeliveryCents(null)
      setNotice(`缴款保存成功：${accepted.record.id}，已进入结算中心。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '单程投递缴款保存失败。')
    } finally {
      setSaving(false)
    }
  }

  function updateRoundMail(patch: Partial<TrafficMailSnapshot>): void {
    setRoundMail((current) => current ? { ...current, ...patch } : current)
    setRoundQuoteCents(null)
    setError('')
  }

  function calculateRoundTrip(): void {
    if (!roundMail) return
    try {
      const quote = roundTripQuoteCents(roundMail)
      setRoundQuoteCents(quote)
      setNotice('资费计算成功。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '资费计算失败。')
    }
  }

  async function recordRoundTrip(): Promise<void> {
    if (!roundMail || roundQuoteCents === null || saving) {
      if (roundQuoteCents === null) setError('请先点击计费。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const accepted = await acceptRequest({
        kind: 'round-trip-return',
        acceptedAt: new Date().toISOString(),
        sender: customerDraft.sender,
        mail: roundMail,
        productionFeeCents: roundProductionFeeCents ?? 0,
      })
      setRoundMail(null)
      setRoundQuoteCents(null)
      setNotice(`录入成功：${accepted.record.id}，已进入结算中心。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '双程返程收寄录入失败。')
    } finally {
      setSaving(false)
    }
  }

  if (!workspace) {
    return <section className="supplementary-workspace supplementary-workspace--loading">正在读取补录/交管业务…</section>
  }

  return (
    <>
      <section aria-label="补录/交管" className="supplementary-workspace">
        <div className="supplementary-heading">
          <strong>补录/交管</strong>
          <button className="settlement-jump-button" onClick={onOpenSettlement} type="button">
            结算中心（{pendingServiceSummary(workspace).count}）
          </button>
        </div>

        <nav aria-label="补录/交管业务" className="supplementary-tabs" role="tablist">
          <button aria-selected={activeTab === 'supplementary'} className={activeTab === 'supplementary' ? 'is-active' : ''} onClick={() => switchTab('supplementary')} role="tab" type="button">补录操作</button>
          <button aria-selected={activeTab === 'traffic-bulk'} className={activeTab === 'traffic-bulk' ? 'is-active' : ''} onClick={() => switchTab('traffic-bulk')} role="tab" type="button">交管大宗邮件收寄</button>
          <button aria-selected={activeTab === 'single-journey'} className={activeTab === 'single-journey' ? 'is-active' : ''} onClick={() => switchTab('single-journey')} role="tab" type="button">单程邮件投递缴款</button>
          <button aria-selected={activeTab === 'round-trip'} className={activeTab === 'round-trip' ? 'is-active' : ''} onClick={() => switchTab('round-trip')} role="tab" type="button">双程邮件返程收寄</button>
          <button aria-selected={activeTab === 'statistics'} className={activeTab === 'statistics' ? 'is-active' : ''} onClick={() => switchTab('statistics')} role="tab" type="button">交管邮件接收统计</button>
        </nav>

        {activeTab === 'supplementary' ? (
          <div className="supplementary-panel">
            <div className="supplementary-meta-row">
              <span>零星/大宗标志：<strong>{customerKind}</strong></span>
              <span>录入日期：<strong>{businessDate}</strong></span>
            </div>
            <div className="supplementary-actions">
              <button className="table-action" onClick={addSupplementaryRow} type="button">添加</button>
              <button className="primary-button primary-button--compact" disabled={saving} onClick={() => void saveSupplementaryRows()} type="button">保存</button>
              <button className="danger-button" onClick={deleteSupplementaryRows} type="button">删除</button>
            </div>
            <div className="settlement-table-wrap">
              <table className="settlement-table supplementary-entry-table">
                <thead><tr><th>选择</th><th>序号</th><th>补录科目</th><th>件/笔数</th><th>金额</th><th>用户名称</th><th>付费方式</th><th>收寄方式</th><th>记欠标志</th><th>批量标志</th></tr></thead>
                <tbody>{rows.map((row, index) => { const subject = SUPPLEMENTARY_SUBJECTS.find((candidate) => candidate.code === row.subjectCode); return <tr key={row.id}><td><input aria-label={`选择补录记录 ${index + 1}`} checked={row.selected} onChange={(event) => updateRow(row.id, { selected: event.target.checked })} type="checkbox" /></td><td>{index + 1}</td><td><button className="subject-picker-button" onClick={() => { setSubjectRowId(row.id); setSubjectSelection(row.subjectCode) }} type="button">{subject ? `${subject.label}（${subject.code}）` : '请选择补录科目'}</button></td><td><input aria-label={`件笔数 ${index + 1}`} min={1} onChange={(event) => updateRow(row.id, { count: Math.max(1, Number(event.target.value) || 1) })} type="number" value={row.count} /></td><td><CurrencyInput aria-label={`补录金额 ${index + 1}`} onValueChange={(value) => updateRow(row.id, { amountCents: value })} valueCents={row.amountCents} /></td><td>{customerName}</td><td><select aria-label={`补录付费方式 ${index + 1}`} onChange={(event) => updateRow(row.id, { paymentMethod: event.target.value as SupplementaryDraftRow['paymentMethod'] })} value={row.paymentMethod}><option value="cash-settlement">现结</option><option value="credit">记欠</option></select></td><td>窗口</td><td>{subject?.creditAllowed ? '允许' : '不允许'}</td><td>{subject?.bulkAllowed ? '允许' : '不允许'}</td></tr> })}</tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === 'traffic-bulk' ? (
          <div className="supplementary-panel traffic-mail-panel">
            <div className="traffic-panel-actions"><button className="table-action" onClick={() => openCapture('bulk')} type="button">采集邮件号码</button></div>
            <TrafficMailForm match={trafficBulkMatch} paymentLabel="记欠" totalCents={trafficBulkMatch?.bulkPostageCents ?? null} />
            <div className="traffic-form-actions"><button className="primary-button primary-button--compact" disabled={!trafficBulkMatch || saving} onClick={() => void recordTrafficBulk()} type="button">录入</button></div>
          </div>
        ) : null}

        {activeTab === 'single-journey' ? (
          <div className="supplementary-panel">
            <div className="traffic-query-row">
              <label><span>邮件号码</span><input aria-label="单程查询邮件号码" onChange={(event) => setSingleFilters((current) => ({ ...current, mailNumber: event.target.value.replace(/\D/g, '').slice(0, 13) }))} value={singleFilters.mailNumber} /></label>
              <label><span>录入日期</span><input aria-label="单程查询开始日期" onChange={(event) => setSingleFilters((current) => ({ ...current, dateFrom: event.target.value }))} type="date" value={singleFilters.dateFrom} /></label>
              <span>至</span>
              <label><span className="sr-only">结束日期</span><input aria-label="单程查询结束日期" onChange={(event) => setSingleFilters((current) => ({ ...current, dateTo: event.target.value }))} type="date" value={singleFilters.dateTo} /></label>
              <button className="table-action" onClick={() => setAppliedSingleFilters(singleFilters)} type="button">查询</button>
              <button className="warning-button" onClick={() => { setSingleJourneyOpen(true); setSingleJourneyMailNumber(''); setCollectOnDeliveryCents(null); setError('') }} type="button">缴款</button>
            </div>
            <div className="settlement-table-wrap"><table className="settlement-table"><thead><tr><th>序号</th><th>邮件号码</th><th>到付邮费</th><th>工本费</th><th>处理员工号</th><th>处理员工姓名</th><th>处理日期</th><th>状态</th></tr></thead><tbody>{singleJourneyRecords.map((record, index) => <tr key={record.id}><td>{index + 1}</td><td>{record.mail.mailNumber}</td><td>¥ {formatCents(record.collectOnDeliveryCents)}</td><td>¥ {formatCents(record.productionFeeCents)}</td><td>{record.operator.operatorId}</td><td>{record.operator.displayName}</td><td>{kindDate(record)}</td><td>{record.status === 'settled' ? '已结算' : '待结算'}</td></tr>)}{singleJourneyRecords.length === 0 ? <tr><td className="settlement-empty" colSpan={8}>暂无数据</td></tr> : null}</tbody></table></div>
          </div>
        ) : null}

        {activeTab === 'round-trip' ? (
          <div className="supplementary-panel traffic-mail-panel">
            <div className="traffic-panel-actions"><button className="table-action" onClick={() => openCapture('round-trip')} type="button">采集邮件号码</button></div>
            {roundMail ? (
              <div className="traffic-mail-form traffic-mail-form--editable">
                <label><span>业务产品</span><input readOnly value="交管专项特快（405）" /></label>
                <label><span>区域</span><select aria-label="双程区域" onChange={(event) => { const zone = event.target.value as 'local' | 'nonlocal'; updateRoundMail({ destinationZone: zone, effectiveBusinessCode: zone === 'local' ? '405000' : '405100' }) }} value={roundMail.destinationZone}><option value="local">本埠</option><option value="nonlocal">外埠</option></select></label>
                <label><span>邮件号码</span><input aria-label="双程邮件号码" readOnly value={roundMail.mailNumber} /></label>
                <label><span>收件人</span><input aria-label="双程收件人" onChange={(event) => updateRoundMail({ recipientName: event.target.value })} value={roundMail.recipientName} /></label>
                <label><span>收件人电话</span><input aria-label="双程收件人电话" onChange={(event) => updateRoundMail({ recipientTelephone: event.target.value.replace(/\D/g, '') })} value={roundMail.recipientTelephone} /></label>
                <label><span>收件人手机</span><input aria-label="双程收件人手机" onChange={(event) => updateRoundMail({ recipientMobile: event.target.value.replace(/\D/g, '') })} value={roundMail.recipientMobile} /></label>
                <label className="traffic-address-field"><span>收件人地址</span><input aria-label="双程收件人地址" onChange={(event) => updateRoundMail({ recipientAddress: event.target.value })} value={roundMail.recipientAddress} /></label>
                <label><span>邮件备注</span><select aria-label="双程邮件备注" onChange={(event) => updateRoundMail({ remark: event.target.value as TrafficMailSnapshot['remark'] })} value={roundMail.remark}><option value="round-trip-document">双程证件</option></select></label>
                <label><span>收件人邮编</span><input aria-label="双程收件人邮编" maxLength={6} onChange={(event) => updateRoundMail({ recipientPostalCode: event.target.value.replace(/\D/g, '').slice(0, 6) })} value={roundMail.recipientPostalCode} /></label>
                <label><span>邮件重量(g)</span><input aria-label="双程邮件重量" min={1} onChange={(event) => updateRoundMail({ weightGrams: Math.max(1, Number(event.target.value) || 1) })} type="number" value={roundMail.weightGrams} /></label>
                <label><span>工本费</span><CurrencyInput aria-label="双程工本费" onValueChange={(value) => { setRoundProductionFeeCents(value); setRoundQuoteCents(null) }} valueCents={roundProductionFeeCents} /></label>
                <label><span>付费方式</span><input readOnly value="现结" /></label>
                <label><span>总邮资</span><input aria-label="双程总邮资" readOnly value={roundQuoteCents === null ? '' : formatCents(roundQuoteCents)} /></label>
              </div>
            ) : <p className="settlement-empty">请采集双程邮件号码。</p>}
            <div className="traffic-form-actions"><button className="warning-button" disabled={!roundMail} onClick={calculateRoundTrip} type="button">计费</button><button className="primary-button primary-button--compact" disabled={!roundMail || roundQuoteCents === null || saving} onClick={() => void recordRoundTrip()} type="button">录入</button></div>
          </div>
        ) : null}

        {activeTab === 'statistics' ? (
          <div className="supplementary-panel">
            <div className="statistics-filter-panel">
              <label><span>邮件号码</span><input aria-label="统计邮件号码" onChange={(event) => setStatisticsQuery((current) => ({ ...current, mailNumber: event.target.value.replace(/\D/g, '').slice(0, 13) }))} value={statisticsQuery.mailNumber} /></label>
              <label><span>收寄日期</span><input aria-label="统计开始日期" onChange={(event) => setStatisticsQuery((current) => ({ ...current, acceptedDateFrom: event.target.value }))} type="date" value={statisticsQuery.acceptedDateFrom} /></label>
              <span>至</span>
              <label><span className="sr-only">统计结束日期</span><input aria-label="统计结束日期" onChange={(event) => setStatisticsQuery((current) => ({ ...current, acceptedDateTo: event.target.value }))} type="date" value={statisticsQuery.acceptedDateTo} /></label>
              <label><span>邮件类型</span><select aria-label="统计邮件类型" onChange={(event) => setStatisticsQuery((current) => ({ ...current, kind: event.target.value as TrafficStatisticsQuery['kind'] }))} value={statisticsQuery.kind}><option value="">请选择</option><option value="traffic-bulk-mail">交管大宗邮件</option><option value="single-journey-payment">单程投递缴款</option><option value="round-trip-return">双程返程邮件</option></select></label>
              <label><span>备注</span><select aria-label="统计备注" onChange={(event) => setStatisticsQuery((current) => ({ ...current, remark: event.target.value as TrafficStatisticsQuery['remark'] }))} value={statisticsQuery.remark}><option value="">请选择</option><option value="single-document">单程证件</option><option value="round-trip-document">双程证件</option></select></label>
              <button className="table-action" onClick={() => setAppliedStatisticsQuery(statisticsQuery)} type="button">查询</button>
            </div>
            <div className="settlement-table-wrap"><table className="settlement-table"><thead><tr><th>序号</th><th>业务产品代码</th><th>业务产品名称</th><th>邮件号码</th><th>备注</th><th>总资费</th><th>邮件类型</th><th>收寄日期</th></tr></thead><tbody>{statisticsRecords.map((record, index) => <tr key={record.id}><td>{index + 1}</td><td>{record.mail.effectiveBusinessCode}</td><td>{record.mail.productLabel}</td><td>{record.mail.mailNumber}</td><td>{trafficRemarkLabel(record.mail.remark)}</td><td>¥ {formatCents(mailRecordAmount(record))}</td><td>{supplementaryTrafficKindLabel(record.kind)}</td><td>{kindDate(record)}</td></tr>)}{statisticsRecords.length === 0 ? <tr><td className="settlement-empty" colSpan={8}>暂无数据</td></tr> : null}</tbody></table></div>
          </div>
        ) : null}

        {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
        {error && !subjectRowId && !capturePurpose && !singleJourneyOpen ? <p className="customer-form-error" role="alert">{error}</p> : null}
      </section>

      {subjectRowId ? (
        <Modal description="按一级科目和统计单元选择补录科目。" eyebrow="补录操作" title="补录科目" wide>
          <div className="modal-form subject-picker-modal">
            <div className="subject-picker-filters">
              <label>
                <span>一级科目</span>
                <select aria-label="一级补录科目" onChange={() => undefined} value="BL04">
                  <option value="BL04">BL04 电子商务和代理补录</option>
                </select>
              </label>
              <label><span>二级科目</span><input aria-label="二级补录科目" onChange={(event) => setSubjectQuery(event.target.value)} value={subjectQuery} /></label>
              <button className="table-action" type="button">查询</button>
            </div>
            <div className="settlement-table-wrap"><table className="settlement-table"><thead><tr><th>选择</th><th>序号</th><th>统计单元 ID</th><th>统计单元名称</th><th>记欠标志</th><th>批量标志</th><th>内管标志</th><th>补录项说明</th></tr></thead><tbody>{filteredSubjects.map((subject) => <tr key={subject.code}><td><input aria-label={`选择科目 ${subject.label}`} checked={subjectSelection === subject.code} onChange={() => setSubjectSelection(subject.code)} type="radio" /></td><td>{subject.sequence}</td><td>{subject.code}</td><td>{subject.label}</td><td>允许</td><td>允许</td><td>无限制</td><td>收入进入模拟账</td></tr>)}</tbody></table></div>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setSubjectRowId(null); setSubjectSelection(''); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={confirmSubject} type="button">选择</button></div>
          </div>
        </Modal>
      ) : null}

      {capturePurpose ? (
        <Modal description="输入邮件号码后匹配相关业务信息。" eyebrow="补录/交管" title="邮件号码采集">
          <div className="modal-form traffic-capture-modal"><label><span>邮件号码</span><input aria-label="采集邮件号码" autoFocus inputMode="numeric" maxLength={13} onChange={(event) => setCaptureMailNumber(event.target.value.replace(/\D/g, '').slice(0, 13))} placeholder={`请输入邮件号码，如 ${trafficMailExample(capturePurpose)}`} value={captureMailNumber} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setCapturePurpose(null); setCaptureMailNumber(''); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={confirmCapture} type="button">确定</button></div></div>
        </Modal>
      ) : null}

      {singleJourneyOpen ? (
        <Modal description="邮件号码匹配工本费；到付邮费必须大于 0 元。" eyebrow="单程邮件投递缴款" title="单程邮件投递缴款">
          <div className="modal-form single-journey-modal"><label><span>邮件号码</span><input aria-label="单程缴款邮件号码" inputMode="numeric" maxLength={13} onChange={(event) => { setSingleJourneyMailNumber(event.target.value.replace(/\D/g, '').slice(0, 13)); setError('') }} placeholder={`请输入邮件号码，如 ${trafficMailExample('single-journey')}`} value={singleJourneyMailNumber} /></label><label><span>到付邮费</span><CurrencyInput aria-label="单程到付邮费" onValueChange={setCollectOnDeliveryCents} valueCents={collectOnDeliveryCents} /></label><label><span>工本费</span><input aria-label="单程工本费" readOnly value={singleJourneyMatch ? formatCents(singleJourneyMatch.productionFeeCents) : ''} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setSingleJourneyOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" disabled={saving} onClick={() => void recordSingleJourney()} type="button">确定</button></div></div>
        </Modal>
      ) : null}
    </>
  )
}

function TrafficMailForm({
  match,
  paymentLabel,
  totalCents,
}: {
  match: TrafficMailMatch | null
  paymentLabel: string
  totalCents: number | null
}) {
  const mail = match?.mail
  return (
    <div className="traffic-mail-form">
      <label><span>业务产品</span><input readOnly value="交管专项特快（405）" /></label>
      <label><span>区域</span><input readOnly value={mail?.destinationZone === 'local' ? '本埠' : mail ? '外埠' : ''} /></label>
      <label><span>邮件号码</span><input aria-label="交管大宗邮件号码" readOnly value={mail?.mailNumber ?? ''} /></label>
      <label><span>收件人</span><input readOnly value={mail?.recipientName ?? ''} /></label>
      <label><span>收件人电话</span><input readOnly value={mail?.recipientTelephone ?? ''} /></label>
      <label><span>收件人手机</span><input readOnly value={mail?.recipientMobile ?? ''} /></label>
      <label className="traffic-address-field"><span>收件人地址</span><input readOnly value={mail?.recipientAddress ?? ''} /></label>
      <label><span>邮件备注</span><input readOnly value={mail ? trafficRemarkLabel(mail.remark) : ''} /></label>
      <label><span>收件人邮编</span><input readOnly value={mail?.recipientPostalCode ?? ''} /></label>
      <label><span>邮件重量(g)</span><input readOnly value={mail?.weightGrams ?? ''} /></label>
      <label><span>工本费</span><input readOnly value={match ? formatCents(match.productionFeeCents) : ''} /></label>
      <label><span>付费方式</span><input readOnly value={paymentLabel} /></label>
      <label><span>总邮资</span><input readOnly value={totalCents === null ? '' : formatCents(totalCents)} /></label>
    </div>
  )
}
