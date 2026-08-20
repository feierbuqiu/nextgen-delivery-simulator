import { useEffect, useMemo, useState } from 'react'

import { localWorkDate } from '../../domain/access/attendance'
import {
  projectPersonalRemittance,
} from '../../domain/service/personalRemittance'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import type {
  PersonalRemittanceRecord,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface PersonalRemittanceWorkspaceProps {
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  institutionCode: string
  institutionName: string
  onBack: () => void
  onOpenSettlement: () => void
  embedded?: boolean
}

type Section = 'remittance' | 'pending' | 'history'

interface PendingRow {
  id: string
  type: string
  acceptedAt: string
  amountCents: number
}

function dateTime(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value)).replaceAll('/', '-')
}

function statusLabel(status: PersonalRemittanceRecord['status']): string {
  if (status === 'generated') return '待确认'
  if (status === 'confirmed') return '已确认'
  return '已注销'
}

function pendingRows(
  state: ServiceWorkspaceState,
  operator: ServiceOperatorSnapshot,
): PendingRow[] {
  const matches = (candidate: ServiceOperatorSnapshot): boolean =>
    candidate.operatorId === operator.operatorId
    && candidate.workstationCode === operator.workstationCode
  return [
    ...state.transactions
      .filter((item) => item.status === 'pending-settlement' && matches(item.operator))
      .map((item) => ({ id: item.id, type: item.product.label, acceptedAt: item.acceptedAt, amountCents: item.charge.settlementDueCents })),
    ...state.postalSupplySales
      .filter((item) => item.status === 'pending-settlement' && matches(item.operator))
      .map((item) => ({ id: item.id, type: '用邮物品销售', acceptedAt: item.acceptedAt, amountCents: item.totalCents })),
    ...state.channelProductOrders
      .filter((item) => item.status === 'pending-settlement' && matches(item.operator))
      .map((item) => ({ id: item.id, type: '渠道商品销售', acceptedAt: item.submittedAt, amountCents: item.totalCents })),
    ...state.supplementaryTrafficRecords
      .filter((item) => item.status === 'pending-settlement' && matches(item.operator))
      .map((item) => ({ id: item.id, type: '补录及交管业务', acceptedAt: item.acceptedAt, amountCents: item.amountCents })),
    ...state.electronicCommerceRecords
      .filter((item) => item.status === 'pending-settlement' && matches(item.operator))
      .map((item) => ({ id: item.id, type: '电子商务', acceptedAt: item.acceptedAt, amountCents: item.amountCents })),
    ...state.bulkBatches
      .filter((item) => item.settlementStatus === 'unsettled' && matches(item.operator))
      .map((item) => ({ id: item.id, type: '大宗处理', acceptedAt: item.importedAt, amountCents: Math.max(0, item.totalSettlementDueCents - item.couponDiscountCents) })),
  ].sort((left, right) => left.acceptedAt.localeCompare(right.acceptedAt))
}

export function PersonalRemittanceWorkspace({
  repository,
  operator,
  institutionCode,
  institutionName,
  onBack,
  onOpenSettlement,
  embedded = false,
}: PersonalRemittanceWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [section, setSection] = useState<Section>('remittance')
  const [workDate, setWorkDate] = useState(() => localWorkDate(new Date()))
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<PersonalRemittanceRecord | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [printTarget, setPrintTarget] = useState<PersonalRemittanceRecord | null>(null)

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (active) setWorkspace(loaded)
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : '个人缴款数据读取失败。')
    })
    return () => { active = false }
  }, [repository])

  const projection = useMemo(() => workspace
    ? projectPersonalRemittance(
      workspace,
      workDate,
      operator.operatorId,
      operator.workstationCode,
    )
    : null, [operator.operatorId, operator.workstationCode, workDate, workspace])
  const history = useMemo(() => workspace?.personalRemittances
    .filter((item) => item.operator.operatorId === operator.operatorId
      && item.workstationCode === operator.workstationCode)
    .slice()
    .reverse() ?? [], [operator.operatorId, operator.workstationCode, workspace])
  const activeRecord = history.find((item) => item.workDate === workDate && item.status !== 'cancelled') ?? null
  const unresolved = useMemo(
    () => workspace ? pendingRows(workspace, operator) : [],
    [operator, workspace],
  )
  const categories = activeRecord?.categories ?? projection?.categories ?? []
  const totals = activeRecord ?? projection

  async function generate(ignoreCurrentDayPending: boolean): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await repository.executePersonalRemittance({
        type: 'generate-personal-remittance',
        workDate,
        operator,
        institutionCode,
        institutionName,
        workstationCode: operator.workstationCode,
        generatedAt: new Date().toISOString(),
        ignoreCurrentDayPending,
      })
      setWorkspace(result.state)
      setPendingPrompt(false)
      setMessage(`个人缴款单 ${result.remittance.id} 已生成，请核对后确认缴款。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '个人缴款单生成失败。')
    } finally {
      setBusy(false)
    }
  }

  function queryAndGenerate(): void {
    setError('')
    setMessage('')
    if (activeRecord) {
      setMessage(`已查询到个人缴款单 ${activeRecord.id}。`)
      return
    }
    if (!projection) return
    if (projection.previousDayPendingReferences.length > 0) {
      setError(`存在 ${projection.previousDayPendingReferences.length} 笔历史未结算业务，请先进入结算中心处理。`)
      return
    }
    if (projection.pendingReferences.length > 0) {
      setPendingPrompt(true)
      return
    }
    void generate(false)
  }

  async function confirm(): Promise<void> {
    if (!activeRecord || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await repository.executePersonalRemittance({
        type: 'confirm-personal-remittance',
        remittanceId: activeRecord.id,
        operator,
        confirmedAt: new Date().toISOString(),
      })
      setWorkspace(result.state)
      setMessage(`个人缴款单 ${result.remittance.id} 已确认。当前台席当天不得继续办理影响账务的业务。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '确认缴款失败。')
    } finally {
      setBusy(false)
    }
  }

  async function cancel(): Promise<void> {
    if (!cancelTarget || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await repository.executePersonalRemittance({
        type: 'cancel-personal-remittance',
        remittanceId: cancelTarget.id,
        operator,
        cancelledAt: new Date().toISOString(),
        reason: cancelReason,
      })
      setWorkspace(result.state)
      setCancelTarget(null)
      setCancelReason('')
      setMessage(`个人缴款单 ${result.remittance.id} 已注销，可重新生成。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '缴款单注销失败。')
    } finally {
      setBusy(false)
    }
  }

  async function print(remittance: PersonalRemittanceRecord): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await repository.executePersonalRemittance({
        type: 'print-personal-remittance',
        remittanceId: remittance.id,
        printedAt: new Date().toISOString(),
      })
      setWorkspace(result.state)
      setPrintTarget(result.remittance)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '个人缴款单打印登记失败。')
    } finally {
      setBusy(false)
    }
  }

  if (!workspace || !projection || !totals) {
    return <section className="management-workspace">正在读取个人缴款数据…</section>
  }

  return (
    <>
      <section aria-label={embedded ? '个人缴款工作区' : '个人缴款'} className="management-workspace remittance-workspace">
        {!embedded ? <div className="customer-breadcrumb"><button onClick={onBack} type="button">账务处理</button><span>/</span><strong>个人缴款</strong></div> : null}
        {!embedded ? <header className="management-heading"><div><h1>个人缴款</h1><p>缴款处理 / 个人缴款</p></div><span>{institutionName} {institutionCode}</span></header> : null}
        <nav aria-label="个人缴款栏目" className="management-tabs">
          <button aria-current={section === 'remittance' ? 'page' : undefined} onClick={() => setSection('remittance')} type="button">个人缴款</button>
          <button aria-current={section === 'pending' ? 'page' : undefined} onClick={() => setSection('pending')} type="button">未结算明细</button>
          <button aria-current={section === 'history' ? 'page' : undefined} onClick={() => setSection('history')} type="button">营业员缴款历史</button>
        </nav>

        {message ? <p className="customer-form-success" role="status">{message}</p> : null}
        {error && !cancelTarget ? <p className="customer-form-error" role="alert">{error}</p> : null}

        {section === 'remittance' ? (
          <section aria-label="个人缴款办理" className="management-panel">
            <div className="management-toolbar management-toolbar--filters remittance-toolbar">
              <label><span>统计日期</span><input aria-label="个人缴款统计日期" onChange={(event) => { setWorkDate(event.target.value); setMessage(''); setError('') }} type="date" value={workDate} /></label>
              <label><span>员工</span><input aria-label="个人缴款员工" disabled value={`${operator.displayName} ${operator.operatorId}`} /></label>
              <label><span>台席</span><select aria-label="个人缴款台席" disabled value={operator.workstationCode}><option value={operator.workstationCode}>{operator.workstationCode}</option></select></label>
              <div className="management-toolbar-actions"><button disabled={busy} onClick={queryAndGenerate} type="button">查询</button><button onClick={() => { setMessage(''); setError(''); setWorkDate(localWorkDate(new Date())) }} type="button">重置</button></div>
            </div>

            <div className="remittance-summary">
              <div><span>缴款单号</span><strong>{activeRecord?.id ?? '尚未生成'}</strong></div>
              <div><span>状态</span><strong className={`remittance-status remittance-status--${activeRecord?.status ?? 'preview'}`}>{activeRecord ? statusLabel(activeRecord.status) : '待查询'}</strong></div>
              <div><span>总笔件数</span><strong>{totals.totalCount}</strong></div>
              <div><span>缴款总额</span><strong>¥ {formatCents(totals.totalAmountCents)}</strong></div>
            </div>

            <div className="management-table-wrap">
              <table className="management-table remittance-table"><thead><tr><th>序号</th><th>核算类别</th><th>笔件数</th><th>金额</th></tr></thead><tbody>{categories.map((category, index) => <tr key={category.code}><td>{index + 1}</td><td>{category.label}<small>{category.code}</small></td><td>{category.count}</td><td>¥ {formatCents(category.amountCents)}</td></tr>)}{categories.length === 0 ? <tr><td className="management-empty" colSpan={4}>当前尚无已结算缴款数据。</td></tr> : null}</tbody><tfoot><tr><td colSpan={2}>合计</td><td>{totals.totalCount}</td><td>¥ {formatCents(totals.totalAmountCents)}</td></tr></tfoot></table>
            </div>

            <div className="remittance-tender-summary">
              <div><span>现金</span><strong>¥ {formatCents(totals.cashAmountCents)}</strong></div>
              <div><span>POS</span><strong>¥ {formatCents(totals.posAmountCents)}</strong></div>
              <div><span>第三方支付</span><strong>¥ {formatCents(totals.thirdPartyAmountCents)}</strong></div>
              <div><span>记欠</span><strong>¥ {formatCents(totals.creditAmountCents)}</strong></div>
            </div>

            {activeRecord?.ignoredPendingReferences.length ? <p className="remittance-warning">本缴款单生成时忽略了当天 {activeRecord.ignoredPendingReferences.length} 笔未结算业务。</p> : null}
            <div className="remittance-actions">
              {!activeRecord && history.some((item) => item.workDate === workDate && item.status === 'cancelled') ? <button disabled={busy} onClick={queryAndGenerate} type="button">重新生成</button> : null}
              {activeRecord?.status === 'generated' ? <button className="primary-button primary-button--compact" disabled={busy} onClick={() => void confirm()} type="button">确认缴款</button> : null}
              {activeRecord ? <button disabled={busy} onClick={() => { setCancelTarget(activeRecord); setCancelReason('') }} type="button">注销</button> : null}
              {activeRecord ? <button disabled={busy} onClick={() => void print(activeRecord)} type="button">打印</button> : null}
            </div>
          </section>
        ) : section === 'pending' ? (
          <section aria-label="未结算明细" className="management-panel">
            <div className="management-toolbar"><p>历史未结算必须先处理；当天未结算可在生成缴款单时确认忽略。</p><button onClick={onOpenSettlement} type="button">进入结算中心</button></div>
            <div className="management-table-wrap"><table className="management-table"><thead><tr><th>业务流水</th><th>业务类型</th><th>受理时间</th><th>待结算金额</th></tr></thead><tbody>{unresolved.map((row) => <tr key={row.id}><td>{row.id}</td><td>{row.type}</td><td>{dateTime(row.acceptedAt)}</td><td>¥ {formatCents(row.amountCents)}</td></tr>)}</tbody></table>{unresolved.length === 0 ? <p className="management-empty">当前员工、当前台席没有未结算业务。</p> : null}</div>
          </section>
        ) : (
          <section aria-label="营业员缴款历史" className="management-panel management-table-wrap">
            <table className="management-table"><thead><tr><th>缴款单号</th><th>统计日期</th><th>台席</th><th>笔件数</th><th>金额</th><th>状态</th><th>生成时间</th><th>操作</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.workDate}</td><td>{item.workstationCode}</td><td>{item.totalCount}</td><td>¥ {formatCents(item.totalAmountCents)}</td><td>{statusLabel(item.status)}</td><td>{dateTime(item.generatedAt)}</td><td><div className="management-row-actions">{item.status !== 'cancelled' ? <button onClick={() => void print(item)} type="button">打印</button> : null}{item.status !== 'cancelled' ? <button onClick={() => { setCancelTarget(item); setCancelReason('') }} type="button">注销</button> : <span>{item.cancelReason}</span>}</div></td></tr>)}</tbody></table>{history.length === 0 ? <p className="management-empty">暂无个人缴款历史。</p> : null}
          </section>
        )}
      </section>

      {pendingPrompt ? (
        <Modal compact eyebrow="个人缴款" title="当天存在未结算信息">
          <div className="modal-form"><p>当天还有 {projection.pendingReferences.length} 笔未结算业务。选择“确定”将忽略这些业务并生成个人缴款单；选择“取消”返回。</p><div className="modal-actions"><button className="secondary-button" onClick={() => setPendingPrompt(false)} type="button">取消</button><button className="primary-button primary-button--compact" disabled={busy} onClick={() => void generate(true)} type="button">确定</button></div></div>
        </Modal>
      ) : null}

      {cancelTarget ? (
        <Modal compact eyebrow="个人缴款" title={`注销缴款单 ${cancelTarget.id}`}>
          <div className="modal-form"><p>已确认的缴款单注销后，台席账务锁会解除；请重新生成并核对缴款单。</p><label><span>注销原因</span><textarea aria-label="个人缴款注销原因" onChange={(event) => setCancelReason(event.target.value)} rows={3} value={cancelReason} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setCancelTarget(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" disabled={busy || cancelReason.trim().length < 2} onClick={() => void cancel()} type="button">确认注销</button></div></div>
        </Modal>
      ) : null}

      {printTarget ? (
        <Modal eyebrow="打印预览" title="个人缴款单" wide>
          <div className="remittance-print-sheet">
            <h2>个人缴款单</h2><p>{institutionName} · 机构代码：{institutionCode}</p>
            <dl><div><dt>缴款单号</dt><dd>{printTarget.id}</dd></div><div><dt>统计日期</dt><dd>{printTarget.workDate}</dd></div><div><dt>营业员</dt><dd>{printTarget.operator.displayName}（{printTarget.operator.operatorId}）</dd></div><div><dt>台席</dt><dd>{printTarget.workstationCode}</dd></div></dl>
            <table><thead><tr><th>核算类别</th><th>笔件数</th><th>金额</th></tr></thead><tbody>{printTarget.categories.map((category) => <tr key={category.code}><td>{category.label}</td><td>{category.count}</td><td>¥ {formatCents(category.amountCents)}</td></tr>)}</tbody><tfoot><tr><td>合计</td><td>{printTarget.totalCount}</td><td>¥ {formatCents(printTarget.totalAmountCents)}</td></tr></tfoot></table>
            <p className="remittance-print-foot">打印次数：{printTarget.printHistory.length} · 打印时间：{dateTime(printTarget.printHistory.at(-1) ?? null)}</p>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setPrintTarget(null)} type="button">关闭</button><button className="primary-button primary-button--compact" onClick={() => window.print()} type="button">打印</button></div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
