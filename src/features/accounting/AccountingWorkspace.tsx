import { useEffect, useMemo, useState } from 'react'

import { localWorkDate } from '../../domain/access/attendance'
import {
  projectBankDeposit,
  projectBusinessReport,
  projectInstitutionRemittance,
  type BusinessReportProjection,
} from '../../domain/service/institutionAccounting'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import type {
  BankDepositSlipRecord,
  BusinessReportPeriod,
  BusinessReportPrintRecord,
  BusinessReportScope,
  InstitutionRemittanceRecord,
  PersonalRemittanceRecord,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'
import { PersonalRemittanceWorkspace } from './PersonalRemittanceWorkspace'

interface AccountingWorkspaceProps {
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  institutionCode: string
  institutionName: string
  canManageInstitution: boolean
  onBack: () => void
  onOpenSettlement: () => void
}

type AccountingSection = 'personal' | 'institution' | 'deposit' | 'report'
type InstitutionSection = 'remittance' | 'employee-detail' | 'day-end' | 'subordinate' | 'history'

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

function previousWorkDate(): string {
  return localWorkDate(new Date(Date.now() - 86_400_000))
}

function statusLabel(status: InstitutionRemittanceRecord['status']): string {
  if (status === 'generated') return '待确认'
  if (status === 'confirmed') return '已缴款'
  return '已注销'
}

function personalStatusLabel(status: PersonalRemittanceRecord['status']): string {
  if (status === 'generated') return '待确认'
  if (status === 'confirmed') return '已缴款'
  return '已注销'
}

function chineseCurrency(cents: number): string {
  const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
  const smallUnits = ['', '拾', '佰', '仟']
  const sectionUnits = ['', '万', '亿', '万亿']
  const sectionText = (value: number): string => {
    let number = value
    let unit = 0
    let zero = false
    let text = ''
    while (number > 0) {
      const digit = number % 10
      if (digit === 0) {
        zero = text.length > 0
      } else {
        text = `${zero ? '零' : ''}${digits[digit]}${smallUnits[unit]}${text}`
        zero = false
      }
      unit += 1
      number = Math.floor(number / 10)
    }
    return text
  }
  const integer = Math.floor(Math.max(0, cents) / 100)
  const jiao = Math.floor((Math.max(0, cents) % 100) / 10)
  const fen = Math.max(0, cents) % 10
  let remaining = integer
  let sectionIndex = 0
  let integerText = ''
  let needZero = false
  while (remaining > 0) {
    const section = remaining % 10_000
    if (section > 0) {
      integerText = `${needZero ? '零' : ''}${sectionText(section)}${sectionUnits[sectionIndex]}${integerText}`
    }
    needZero = section > 0 && section < 1000
    remaining = Math.floor(remaining / 10_000)
    sectionIndex += 1
  }
  const fraction = `${jiao ? `${digits[jiao]}角` : ''}${fen ? `${digits[fen]}分` : ''}`
  return `${integerText || '零'}元${fraction || '整'}`
}

function useWorkspace(repository: ServiceRepository) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (active) setWorkspace(loaded)
    }).catch((caught: unknown) => {
      if (active) setLoadError(caught instanceof Error ? caught.message : '账务数据读取失败。')
    })
    return () => { active = false }
  }, [repository])
  return { workspace, setWorkspace, loadError }
}

function PermissionNote() {
  return <p className="accounting-permission-note">支局级账务内容保持可见；生成、确认和注销仅允许营业主管办理。</p>
}

function InstitutionRemittancePanel({
  repository,
  operator,
  institutionCode,
  institutionName,
  canManageInstitution,
}: Omit<AccountingWorkspaceProps, 'onBack' | 'onOpenSettlement'>) {
  const { workspace, setWorkspace, loadError } = useWorkspace(repository)
  const [section, setSection] = useState<InstitutionSection>('remittance')
  const [workDate, setWorkDate] = useState(() => localWorkDate(new Date()))
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmPrompt, setConfirmPrompt] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<InstitutionRemittanceRecord | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [printTarget, setPrintTarget] = useState<InstitutionRemittanceRecord | null>(null)
  const [depositPrintTarget, setDepositPrintTarget] = useState<BankDepositSlipRecord | null>(null)
  const [personalCancelTarget, setPersonalCancelTarget] = useState<PersonalRemittanceRecord | null>(null)

  const projection = useMemo(() => workspace
    ? projectInstitutionRemittance(workspace, workDate, institutionCode, institutionName)
    : null, [institutionCode, institutionName, workDate, workspace])
  const history = useMemo(() => workspace?.institutionRemittances
    .filter((item) => item.institutionCode === institutionCode)
    .slice()
    .reverse() ?? [], [institutionCode, workspace])
  const activeRecord = history.find((item) =>
    item.workDate === workDate && item.status !== 'cancelled') ?? null
  const personalHistory = useMemo(() => workspace?.personalRemittances
    .filter((item) => item.institutionCode === institutionCode)
    .slice()
    .reverse() ?? [], [institutionCode, workspace])
  const categories = activeRecord?.categories ?? projection?.categories ?? []
  const totals = activeRecord ?? projection

  async function confirmRemittance(): Promise<void> {
    if (!workspace || !projection || busy || !canManageInstitution) return
    setBusy(true)
    setError('')
    try {
      let remittance = activeRecord
      if (!remittance) {
        const generated = await repository.executeInstitutionAccounting({
          type: 'generate-institution-remittance',
          workDate,
          institutionCode,
          institutionName,
          operator,
          generatedAt: new Date().toISOString(),
          managerAuthorized: canManageInstitution,
        })
        remittance = generated.institutionRemittance
      }
      if (!remittance) throw new Error('支局缴款单生成失败。')
      const confirmed = await repository.executeInstitutionAccounting({
        type: 'confirm-institution-remittance',
        remittanceId: remittance.id,
        operator,
        confirmedAt: new Date().toISOString(),
        managerAuthorized: canManageInstitution,
      })
      setWorkspace(confirmed.state)
      setConfirmPrompt(false)
      setMessage(`支局缴款单 ${remittance.id} 已确认。`)
      if (confirmed.bankDepositSlip) setDepositPrintTarget(confirmed.bankDepositSlip)
      else if (remittance.cashAmountCents > 0) {
        setMessage(`支局缴款单 ${remittance.id} 已确认；现金已由既有存行单覆盖。`)
      }
    } catch (caught) {
      setConfirmPrompt(false)
      setError(caught instanceof Error ? caught.message : '支局缴款失败。')
    } finally {
      setBusy(false)
    }
  }

  async function cancelRemittance(): Promise<void> {
    if (!cancelTarget || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await repository.executeInstitutionAccounting({
        type: 'cancel-institution-remittance',
        remittanceId: cancelTarget.id,
        operator,
        cancelledAt: new Date().toISOString(),
        reason: cancelReason,
        managerAuthorized: canManageInstitution,
      })
      setWorkspace(result.state)
      setCancelTarget(null)
      setCancelReason('')
      setMessage(`支局缴款单 ${cancelTarget.id} 已注销；随单生成的存行单已同步处理。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '支局缴款单注销失败。')
    } finally {
      setBusy(false)
    }
  }

  async function printRemittance(target: InstitutionRemittanceRecord): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await repository.executeInstitutionAccounting({
        type: 'print-institution-remittance',
        remittanceId: target.id,
        printedAt: new Date().toISOString(),
      })
      setWorkspace(result.state)
      setPrintTarget(result.institutionRemittance)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '支局缴款单打印登记失败。')
    } finally {
      setBusy(false)
    }
  }

  async function printDeposit(target: BankDepositSlipRecord): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await repository.executeInstitutionAccounting({
        type: 'print-bank-deposit',
        slipId: target.id,
        printedAt: new Date().toISOString(),
      })
      setWorkspace(result.state)
      setDepositPrintTarget(result.bankDepositSlip)
      window.print()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '存行单打印登记失败。')
    } finally {
      setBusy(false)
    }
  }

  async function cancelPersonal(): Promise<void> {
    if (!personalCancelTarget || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await repository.executePersonalRemittance({
        type: 'cancel-personal-remittance',
        remittanceId: personalCancelTarget.id,
        operator,
        cancelledAt: new Date().toISOString(),
        reason: cancelReason,
        managerAuthorized: canManageInstitution,
      })
      setWorkspace(result.state)
      setPersonalCancelTarget(null)
      setCancelReason('')
      setMessage(`营业员缴款单 ${personalCancelTarget.id} 已由主管注销。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '营业员缴款单注销失败。')
    } finally {
      setBusy(false)
    }
  }

  if (!workspace || !projection || !totals) {
    return <section className="management-panel">{loadError || '正在读取支局缴款数据…'}</section>
  }

  return (
    <>
      {!canManageInstitution ? <PermissionNote /> : null}
      <nav aria-label="支局缴款栏目" className="management-tabs accounting-subtabs">
        <button aria-current={section === 'remittance' ? 'page' : undefined} onClick={() => setSection('remittance')} type="button">支局缴款</button>
        <button aria-current={section === 'employee-detail' ? 'page' : undefined} onClick={() => setSection('employee-detail')} type="button">营业员缴款明细</button>
        <button aria-current={section === 'day-end' ? 'page' : undefined} onClick={() => setSection('day-end')} type="button">营业员日结情况</button>
        <button aria-current={section === 'subordinate' ? 'page' : undefined} onClick={() => setSection('subordinate')} type="button">下级机构缴款情况</button>
        <button aria-current={section === 'history' ? 'page' : undefined} onClick={() => setSection('history')} type="button">支局缴款历史查询</button>
      </nav>
      {message ? <p className="customer-form-success" role="status">{message}</p> : null}
      {error && !cancelTarget && !personalCancelTarget ? <p className="customer-form-error" role="alert">{error}</p> : null}

      {section === 'remittance' ? (
        <section aria-label="支局缴款办理" className="management-panel">
          <div className="management-toolbar management-toolbar--filters remittance-toolbar">
            <label><span>统计日期</span><input aria-label="支局缴款统计日期" onChange={(event) => { setWorkDate(event.target.value); setMessage(''); setError('') }} type="date" value={workDate} /></label>
            <label><span>累计统计起始日期</span><input disabled value={workDate} /></label>
            <div className="management-toolbar-actions"><button onClick={() => { setMessage(`已核验 ${projection.workstationStatuses.length} 个做业务台席的日结状态。`); setError('') }} type="button">查询</button><button disabled={!canManageInstitution || activeRecord?.status === 'confirmed' || busy || totals.totalCount === 0 || projection.unclosedWorkstations.length > 0 || projection.pendingReferences.length > 0} onClick={() => setConfirmPrompt(true)} type="button">确认缴款</button><button onClick={() => { setWorkDate(localWorkDate(new Date())); setMessage(''); setError('') }} type="button">重置</button></div>
          </div>
          <div className="remittance-summary accounting-summary-wide">
            <div><span>支局缴款单</span><strong>{activeRecord?.id ?? '尚未生成'}</strong></div>
            <div><span>缴款状态</span><strong>{activeRecord ? statusLabel(activeRecord.status) : '待查询'}</strong></div>
            <div><span>做业务台席</span><strong>{projection.workstationStatuses.length}</strong></div>
            <div><span>未日结台席</span><strong>{projection.unclosedWorkstations.length}</strong></div>
            <div><span>总笔件数</span><strong>{totals.totalCount}</strong></div>
            <div><span>应缴营业款</span><strong>¥ {formatCents(totals.totalAmountCents)}</strong></div>
          </div>
          {projection.unclosedWorkstations.length > 0 ? <p className="remittance-warning">仍有 {projection.unclosedWorkstations.length} 个做业务台席未完成个人缴款日终，支局缴款暂不可确认。</p> : null}
          {projection.pendingReferences.length > 0 ? <p className="remittance-warning">仍有 {projection.pendingReferences.length} 笔未结算业务，必须先完成结算。</p> : null}
          <div className="management-table-wrap"><table className="management-table"><thead><tr><th>序号</th><th>统计科目</th><th>件数</th><th>金额</th><th>总金额</th></tr></thead><tbody>{categories.map((item, index) => <tr key={item.code}><td>{index + 1}</td><td>{item.label}</td><td>{item.count}</td><td>¥ {formatCents(item.amountCents)}</td><td>¥ {formatCents(item.amountCents)}</td></tr>)}{categories.length === 0 ? <tr><td className="management-empty" colSpan={5}>当前尚无可汇总的支局缴款数据。</td></tr> : null}</tbody></table></div>
          <div className="remittance-tender-summary"><div><span>现金</span><strong>¥ {formatCents(totals.cashAmountCents)}</strong></div><div><span>POS</span><strong>¥ {formatCents(totals.posAmountCents)}</strong></div><div><span>第三方支付</span><strong>¥ {formatCents(totals.thirdPartyAmountCents)}</strong></div><div><span>记欠</span><strong>¥ {formatCents(totals.creditAmountCents)}</strong></div></div>
          <div className="remittance-actions">{activeRecord && activeRecord.status !== 'cancelled' ? <button disabled={busy} onClick={() => void printRemittance(activeRecord)} type="button">打印</button> : null}{activeRecord && activeRecord.status !== 'cancelled' ? <button disabled={!canManageInstitution || busy} onClick={() => { setCancelTarget(activeRecord); setCancelReason('') }} type="button">注销</button> : null}</div>
        </section>
      ) : section === 'employee-detail' ? (
        <section aria-label="营业员缴款明细" className="management-panel management-table-wrap"><table className="management-table"><thead><tr><th>缴款日期</th><th>员工工号</th><th>员工姓名</th><th>台席</th><th>总金额</th><th>应上缴金额</th><th>状态</th><th>操作</th></tr></thead><tbody>{personalHistory.map((item) => <tr key={item.id}><td>{item.workDate}</td><td>{item.operator.operatorId}</td><td>{item.operator.displayName}</td><td>{item.workstationCode}</td><td>¥ {formatCents(item.totalAmountCents)}</td><td>¥ {formatCents(item.totalAmountCents)}</td><td>{personalStatusLabel(item.status)}</td><td>{item.status !== 'cancelled' ? <button disabled={!canManageInstitution} onClick={() => { setPersonalCancelTarget(item); setCancelReason('') }} type="button">注销</button> : item.cancelReason}</td></tr>)}</tbody></table>{personalHistory.length === 0 ? <p className="management-empty">暂无营业员缴款明细。</p> : null}</section>
      ) : section === 'day-end' ? (
        <section aria-label="营业员日结情况" className="management-panel management-table-wrap"><table className="management-table"><thead><tr><th>员工工号</th><th>员工姓名</th><th>台席</th><th>日结情况</th><th>未结算笔数</th><th>缴款单号</th></tr></thead><tbody>{projection.workstationStatuses.map((item) => <tr key={`${item.operator.operatorId}:${item.operator.workstationCode}`}><td>{item.operator.operatorId}</td><td>{item.operator.displayName}</td><td>{item.operator.workstationCode}</td><td>{item.status === 'confirmed' ? '已日结' : '未日结'}</td><td>{item.pendingReferences.length}</td><td>{item.personalRemittanceId ?? '—'}</td></tr>)}</tbody></table>{projection.workstationStatuses.length === 0 ? <p className="management-empty">当前日期没有做业务的台席。</p> : null}</section>
      ) : section === 'subordinate' ? (
        <section aria-label="下级机构缴款情况" className="management-panel"><div className="management-table-wrap"><table className="management-table"><thead><tr><th>机构编码</th><th>机构名称</th><th>缴款状态</th><th>缴款时间</th></tr></thead><tbody><tr><td className="management-empty" colSpan={4}>当前演练机构为营业网点，没有下级营业机构。</td></tr></tbody></table></div></section>
      ) : (
        <section aria-label="支局缴款历史查询" className="management-panel management-table-wrap"><table className="management-table"><thead><tr><th>缴款日期</th><th>缴款单号</th><th>总金额</th><th>应上缴营业款</th><th>状态</th><th>确认时间</th><th>操作</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{item.workDate}</td><td>{item.id}</td><td>¥ {formatCents(item.totalAmountCents)}</td><td>¥ {formatCents(item.totalAmountCents)}</td><td>{statusLabel(item.status)}</td><td>{dateTime(item.confirmedAt)}</td><td><div className="management-row-actions">{item.status !== 'cancelled' ? <button onClick={() => void printRemittance(item)} type="button">打印</button> : null}{item.status !== 'cancelled' ? <button disabled={!canManageInstitution} onClick={() => { setCancelTarget(item); setCancelReason('') }} type="button">注销</button> : <span>{item.cancelReason}</span>}</div></td></tr>)}</tbody></table>{history.length === 0 ? <p className="management-empty">暂无支局缴款历史。</p> : null}</section>
      )}

      {confirmPrompt ? <Modal compact eyebrow="支局缴款" title="确认缴款"><div className="modal-form"><p>确认支局缴款？确认前必须保证所有做业务台席均已日结且不存在未结算业务。</p>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => setConfirmPrompt(false)} type="button">取消</button><button className="primary-button primary-button--compact" disabled={busy} onClick={() => void confirmRemittance()} type="button">确定</button></div></div></Modal> : null}
      {cancelTarget ? <Modal compact eyebrow="支局缴款" title={`注销 ${cancelTarget.id}`}><div className="modal-form"><p>只允许注销当天支局缴款单；随本缴款单生成的存行单将一并注销。</p><label><span>注销原因</span><textarea aria-label="支局缴款注销原因" onChange={(event) => setCancelReason(event.target.value)} rows={3} value={cancelReason} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setCancelTarget(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" disabled={busy || cancelReason.trim().length < 2} onClick={() => void cancelRemittance()} type="button">确认注销</button></div></div></Modal> : null}
      {personalCancelTarget ? <Modal compact eyebrow="营业员缴款明细" title={`注销 ${personalCancelTarget.id}`}><div className="modal-form"><p>支局缴款已确认时必须先注销支局缴款单，才能注销营业员个人缴款单。</p><label><span>注销原因</span><textarea aria-label="主管注销个人缴款原因" onChange={(event) => setCancelReason(event.target.value)} rows={3} value={cancelReason} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setPersonalCancelTarget(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" disabled={busy || cancelReason.trim().length < 2} onClick={() => void cancelPersonal()} type="button">确认注销</button></div></div></Modal> : null}
      {printTarget ? <InstitutionRemittancePrint target={printTarget} onClose={() => setPrintTarget(null)} /> : null}
      {depositPrintTarget ? <BankDepositPrint target={depositPrintTarget} onClose={() => setDepositPrintTarget(null)} onPrint={() => void printDeposit(depositPrintTarget)} prompt /> : null}
    </>
  )
}

function InstitutionRemittancePrint({ target, onClose }: { target: InstitutionRemittanceRecord; onClose: () => void }) {
  return <Modal eyebrow="打印预览" title="支局缴款单" wide><div className="remittance-print-sheet"><h2>支局缴款单</h2><p>{target.institutionName} · 机构代码：{target.institutionCode}</p><dl><div><dt>缴款单号</dt><dd>{target.id}</dd></div><div><dt>统计日期</dt><dd>{target.workDate}</dd></div><div><dt>应缴营业款</dt><dd>¥ {formatCents(target.totalAmountCents)}</dd></div><div><dt>状态</dt><dd>{statusLabel(target.status)}</dd></div></dl><table><thead><tr><th>统计科目</th><th>件数</th><th>金额</th></tr></thead><tbody>{target.categories.map((item) => <tr key={item.code}><td>{item.label}</td><td>{item.count}</td><td>¥ {formatCents(item.amountCents)}</td></tr>)}</tbody><tfoot><tr><td>合计</td><td>{target.totalCount}</td><td>¥ {formatCents(target.totalAmountCents)}</td></tr></tfoot></table><p className="remittance-print-foot">制单人：{target.generatedBy.displayName} · 打印次数：{target.printHistory.length}</p><div className="modal-actions"><button className="secondary-button" onClick={onClose} type="button">关闭</button><button className="primary-button primary-button--compact" onClick={() => window.print()} type="button">打印</button></div></div></Modal>
}

function BankDepositPrint({ target, onClose, onPrint, prompt = false }: { target: BankDepositSlipRecord; onClose: () => void; onPrint: () => void; prompt?: boolean }) {
  return <Modal eyebrow="存行单打印" title={prompt ? '存行单生成成功，是否打印存行单？' : '营业现金存行单'} wide><div className="remittance-print-sheet bank-deposit-sheet"><h2>营业现金存行单</h2><dl><div><dt>存行单号</dt><dd>{target.id}</dd></div><div><dt>缴款日期</dt><dd>{target.workDate}</dd></div><div><dt>单位</dt><dd>元</dd></div><div><dt>业务系统</dt><dd>本地寄递演练样张 · 无效</dd></div><div><dt>缴款总金额</dt><dd>¥ {formatCents(target.totalAmountCents)}</dd></div><div><dt>金额（大写）</dt><dd>{chineseCurrency(target.totalAmountCents)}</dd></div><div><dt>摘要</dt><dd>{target.rangeStart} 至 {target.rangeEnd} 现金营业款</dd></div><div><dt>缴款单位</dt><dd>{target.institutionName}</dd></div></dl><table><thead><tr><th>业务流水</th><th>业务类别</th><th>笔件数</th><th>现金金额</th><th>结算时间</th></tr></thead><tbody>{target.details.map((item) => <tr key={item.reference}><td>{item.reference}</td><td>{item.categoryLabel}</td><td>{item.count}</td><td>¥ {formatCents(item.amountCents)}</td><td>{dateTime(item.settledAt)}</td></tr>)}</tbody></table><p className="remittance-print-foot">制单人：{target.generatedBy.displayName} · 打印次数：{target.printHistory.length}</p><div className="modal-actions"><button className="secondary-button" onClick={onClose} type="button">不打印</button><button className="primary-button primary-button--compact" onClick={onPrint} type="button">打印</button></div></div></Modal>
}

function BankDepositPanel({ repository, operator, institutionCode, institutionName, canManageInstitution }: Omit<AccountingWorkspaceProps, 'onBack' | 'onOpenSettlement'>) {
  const { workspace, setWorkspace, loadError } = useWorkspace(repository)
  const [workDate, setWorkDate] = useState(() => localWorkDate(new Date()))
  const [rangeStart, setRangeStart] = useState('00:00:00')
  const [rangeEnd, setRangeEnd] = useState('23:59:59')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [printTarget, setPrintTarget] = useState<BankDepositSlipRecord | null>(null)
  const [cancelTarget, setCancelTarget] = useState<BankDepositSlipRecord | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const projection = useMemo(() => {
    if (!workspace) return null
    try {
      return projectBankDeposit(workspace, workDate, institutionCode, institutionName, rangeStart, rangeEnd)
    } catch {
      return null
    }
  }, [institutionCode, institutionName, rangeEnd, rangeStart, workDate, workspace])
  const history = useMemo(() => workspace?.bankDepositSlips
    .filter((item) => item.institutionCode === institutionCode)
    .slice()
    .reverse() ?? [], [institutionCode, workspace])

  async function generate(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await repository.executeInstitutionAccounting({ type: 'generate-bank-deposit', workDate, institutionCode, institutionName, rangeStart, rangeEnd, operator, generatedAt: new Date().toISOString(), managerAuthorized: canManageInstitution })
      setWorkspace(result.state)
      setMessage(`存行单 ${result.bankDepositSlip?.id} 已生成。`)
      setPrintTarget(result.bankDepositSlip)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '存行单生成失败。')
    } finally {
      setBusy(false)
    }
  }

  async function print(target: BankDepositSlipRecord): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await repository.executeInstitutionAccounting({ type: 'print-bank-deposit', slipId: target.id, printedAt: new Date().toISOString() })
      setWorkspace(result.state)
      setPrintTarget(result.bankDepositSlip)
      window.print()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '存行单打印登记失败。')
    } finally {
      setBusy(false)
    }
  }

  async function cancel(): Promise<void> {
    if (!cancelTarget || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await repository.executeInstitutionAccounting({ type: 'cancel-bank-deposit', slipId: cancelTarget.id, operator, cancelledAt: new Date().toISOString(), reason: cancelReason, managerAuthorized: canManageInstitution })
      setWorkspace(result.state)
      setMessage(`存行单 ${cancelTarget.id} 已注销，可按业务需要重新生成。`)
      setCancelTarget(null)
      setCancelReason('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '存行单注销失败。')
    } finally {
      setBusy(false)
    }
  }

  if (!workspace) return <section className="management-panel">{loadError || '正在读取存行单数据…'}</section>
  return <>{!canManageInstitution ? <PermissionNote /> : null}{message ? <p className="customer-form-success" role="status">{message}</p> : null}{error && !cancelTarget ? <p className="customer-form-error" role="alert">{error}</p> : null}<section aria-label="存行单生成" className="management-panel"><div className="management-toolbar management-toolbar--filters accounting-deposit-toolbar"><label><span>数据来源</span><select disabled><option>当日</option></select></label><label><span>当前日期</span><input aria-label="存行日期" onChange={(event) => setWorkDate(event.target.value)} type="date" value={workDate} /></label><label><span>时间范围</span><span className="accounting-time-range"><input aria-label="存行起始时间" onChange={(event) => setRangeStart(event.target.value)} step="1" type="time" value={rangeStart} /><b>至</b><input aria-label="存行截止时间" onChange={(event) => setRangeEnd(event.target.value)} step="1" type="time" value={rangeEnd} /></span></label><div className="management-toolbar-actions"><button disabled={!canManageInstitution || busy || !projection || projection.sourceReferences.length === 0} onClick={() => void generate()} type="button">生成</button><button onClick={() => { setWorkDate(localWorkDate(new Date())); setRangeStart('00:00:00'); setRangeEnd('23:59:59'); setError(''); setMessage('') }} type="button">重置</button></div></div><div className="remittance-summary"><div><span>尚未存行现金流水</span><strong>{projection?.sourceReferences.length ?? 0}</strong></div><div><span>尚未存行现金金额</span><strong>¥ {formatCents(projection?.totalAmountCents ?? 0)}</strong></div><div><span>已生成存行单</span><strong>{history.filter((item) => item.status === 'active').length}</strong></div><div><span>统计时段</span><strong>{rangeStart} - {rangeEnd}</strong></div></div></section><section aria-label="存行单查询" className="management-panel management-table-wrap"><table className="management-table"><thead><tr><th>存行单号</th><th>生成日期</th><th>缴款起始时间</th><th>缴款截止时间</th><th>收现金额</th><th>来源</th><th>状态</th><th>操作</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.workDate}</td><td>{item.rangeStart}</td><td>{item.rangeEnd}</td><td>¥ {formatCents(item.totalAmountCents)}</td><td>{item.source === 'institution-remittance' ? '支局缴款联动' : '单独生成'}</td><td>{item.status === 'active' ? '有效' : '已注销'}</td><td><div className="management-row-actions"><button onClick={() => void print(item)} type="button">打印</button>{item.status === 'active' ? <button disabled={!canManageInstitution} onClick={() => { setCancelTarget(item); setCancelReason('') }} type="button">注销</button> : <span>{item.cancelReason}</span>}</div></td></tr>)}</tbody></table>{history.length === 0 ? <p className="management-empty">暂无存行单记录。</p> : null}</section>{cancelTarget ? <Modal compact eyebrow="存行单查询" title={`注销 ${cancelTarget.id}`}><div className="modal-form"><p>只允许注销当天存行单；注销成功后可重新生成。</p><label><span>注销原因</span><textarea aria-label="存行单注销原因" onChange={(event) => setCancelReason(event.target.value)} rows={3} value={cancelReason} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setCancelTarget(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" disabled={busy || cancelReason.trim().length < 2} onClick={() => void cancel()} type="button">确认注销</button></div></div></Modal> : null}{printTarget ? <BankDepositPrint target={printTarget} onClose={() => setPrintTarget(null)} onPrint={() => window.print()} /> : null}</>
}

function reportDates(period: BusinessReportPeriod, start: string, end: string): { startDate: string; endDate: string } {
  if (period === 'daily') return { startDate: start, endDate: end }
  const [endYear, endMonth] = end.split('-').map(Number)
  const endDay = new Date(Date.UTC(endYear!, endMonth!, 0)).getUTCDate()
  return { startDate: `${start}-01`, endDate: `${end}-${String(endDay).padStart(2, '0')}` }
}

function BusinessReportPanel({ repository, operator, institutionCode, institutionName, canManageInstitution }: Omit<AccountingWorkspaceProps, 'onBack' | 'onOpenSettlement'>) {
  const { workspace, setWorkspace, loadError } = useWorkspace(repository)
  const yesterday = previousWorkDate()
  const [scope, setScope] = useState<BusinessReportScope>('personal')
  const [period, setPeriod] = useState<BusinessReportPeriod>('daily')
  const [start, setStart] = useState(yesterday)
  const [end, setEnd] = useState(yesterday)
  const [projection, setProjection] = useState<BusinessReportProjection | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [printTarget, setPrintTarget] = useState<BusinessReportPrintRecord | null>(null)
  const dates = reportDates(period, start, end)
  const history = useMemo(() => workspace?.businessReportPrints.slice().reverse() ?? [], [workspace])

  function query(): void {
    if (!workspace) return
    setError('')
    setMessage('')
    try {
      const projected = projectBusinessReport(workspace, { scope, period, ...dates, institutionCode, institutionName, operatorId: scope === 'personal' ? operator.operatorId : null, workstationCode: scope === 'personal' ? '' : '', asOf: new Date().toISOString() })
      setProjection(projected)
      setMessage(`已汇总 ${projected.startDate} 至 ${projected.endDate} 的${scope === 'personal' ? '个人' : '支局'}营业报表。`)
    } catch (caught) {
      setProjection(null)
      setError(caught instanceof Error ? caught.message : '营业日报查询失败。')
    }
  }

  async function print(): Promise<void> {
    if (!projection) return
    setError('')
    try {
      const result = await repository.executeInstitutionAccounting({ type: 'print-business-report', scope, period, ...dates, institutionCode, institutionName, subjectOperatorId: scope === 'personal' ? operator.operatorId : null, subjectOperatorName: scope === 'personal' ? operator.displayName : institutionName, workstationCode: '', operator, printedAt: new Date().toISOString(), managerAuthorized: canManageInstitution })
      setWorkspace(result.state)
      setPrintTarget(result.businessReportPrint)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '营业日报打印登记失败。')
    }
  }

  if (!workspace) return <section className="management-panel">{loadError || '正在读取营业日报数据…'}</section>
  return <>{message ? <p className="customer-form-success" role="status">{message}</p> : null}{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<section aria-label="营业日报查询" className="management-panel"><div className="management-toolbar management-toolbar--filters accounting-report-toolbar"><fieldset><legend>报表范围</legend><label><input checked={scope === 'personal'} name="report-scope" onChange={() => setScope('personal')} type="radio" />个人日报</label><label title={!canManageInstitution ? '需要营业主管权限' : undefined}><input checked={scope === 'institution'} disabled={!canManageInstitution} name="report-scope" onChange={() => setScope('institution')} type="radio" />支局日报</label></fieldset><fieldset><legend>报表类型</legend><label><input checked={period === 'daily'} name="report-period" onChange={() => { setPeriod('daily'); setStart(yesterday); setEnd(yesterday) }} type="radio" />日报</label><label><input checked={period === 'monthly'} name="report-period" onChange={() => { setPeriod('monthly'); setStart(yesterday.slice(0, 7)); setEnd(yesterday.slice(0, 7)) }} type="radio" />月报</label></fieldset><label><span>开始时间</span><input aria-label="日报开始时间" onChange={(event) => setStart(event.target.value)} type={period === 'daily' ? 'date' : 'month'} value={start} /></label><label><span>结束时间</span><input aria-label="日报结束时间" onChange={(event) => setEnd(event.target.value)} type={period === 'daily' ? 'date' : 'month'} value={end} /></label><label><span>台席</span><select disabled><option>全部</option></select></label><div className="management-toolbar-actions"><button onClick={query} type="button">查询</button><button disabled={!projection} onClick={() => void print()} type="button">打印</button></div></div><div className="management-table-wrap"><table className="management-table"><thead><tr><th>序号</th><th>统计科目</th><th>件数</th><th>金额</th><th>销项税额</th><th>价税合计</th></tr></thead><tbody>{projection?.categories.map((item, index) => <tr key={item.code}><td>{index + 1}</td><td>{item.label}</td><td>{item.count}</td><td>¥ {formatCents(item.amountCents)}</td><td>¥ {formatCents(item.taxCents)}</td><td>¥ {formatCents(item.grossAmountCents)}</td></tr>)}{!projection || projection.categories.length === 0 ? <tr><td className="management-empty" colSpan={6}>请选择次日及更早日期查询营业日报。</td></tr> : null}</tbody>{projection ? <tfoot><tr><td colSpan={2}>收方总计</td><td>{projection.totalCount}</td><td>¥ {formatCents(projection.totalAmountCents)}</td><td>¥ {formatCents(projection.totalTaxCents)}</td><td>¥ {formatCents(projection.totalGrossAmountCents)}</td></tr></tfoot> : null}</table></div></section><section aria-label="营业日报打印历史" className="management-panel management-table-wrap"><h2>打印历史</h2><table className="management-table"><thead><tr><th>打印编号</th><th>范围</th><th>报表类型</th><th>统计期间</th><th>总金额</th><th>打印时间</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.scope === 'personal' ? '个人' : '支局'}</td><td>{item.period === 'daily' ? '日报' : '月报'}</td><td>{item.startDate} 至 {item.endDate}</td><td>¥ {formatCents(item.totalGrossAmountCents)}</td><td>{dateTime(item.printedAt)}</td></tr>)}</tbody></table>{history.length === 0 ? <p className="management-empty">暂无营业日报打印记录。</p> : null}</section>{printTarget ? <Modal eyebrow="打印预览" title={printTarget.scope === 'personal' ? '个人营收日报 / 月报' : '支局营收日报 / 月报'} wide><div className="remittance-print-sheet"><h2>{printTarget.scope === 'personal' ? '个人营收报表' : '支局营收报表'}</h2><p>{printTarget.institutionName} · {printTarget.startDate} 至 {printTarget.endDate}</p><table><thead><tr><th>统计科目</th><th>件数</th><th>金额</th><th>销项税额</th><th>价税合计</th></tr></thead><tbody>{printTarget.categories.map((item) => <tr key={item.code}><td>{item.label}</td><td>{item.count}</td><td>¥ {formatCents(item.amountCents)}</td><td>¥ {formatCents(item.taxCents)}</td><td>¥ {formatCents(item.grossAmountCents)}</td></tr>)}</tbody><tfoot><tr><td>合计</td><td>{printTarget.totalCount}</td><td>¥ {formatCents(printTarget.totalAmountCents)}</td><td>¥ {formatCents(printTarget.totalTaxCents)}</td><td>¥ {formatCents(printTarget.totalGrossAmountCents)}</td></tr></tfoot></table><p className="remittance-print-foot">打印编号：{printTarget.id} · 打印人：{printTarget.printedBy.displayName}</p><div className="modal-actions"><button className="secondary-button" onClick={() => setPrintTarget(null)} type="button">关闭</button><button className="primary-button primary-button--compact" onClick={() => window.print()} type="button">打印</button></div></div></Modal> : null}</>
}

export function AccountingWorkspace({ repository, operator, institutionCode, institutionName, canManageInstitution, onBack, onOpenSettlement }: AccountingWorkspaceProps) {
  const [section, setSection] = useState<AccountingSection>('personal')
  return <section aria-label="账务处理" className="management-workspace accounting-workspace"><div className="customer-breadcrumb"><button onClick={onBack} type="button">工作台</button><span>/</span><strong>账务处理</strong></div><header className="management-heading"><div><h1>账务处理</h1><p>缴款处理 / 存行单处理 / 营业日报</p></div><span>{institutionName} {institutionCode}</span></header><nav aria-label="账务处理栏目" className="management-tabs accounting-primary-tabs"><button aria-current={section === 'personal' ? 'page' : undefined} onClick={() => setSection('personal')} type="button">个人缴款</button><button aria-current={section === 'institution' ? 'page' : undefined} onClick={() => setSection('institution')} type="button">支局缴款</button><button aria-current={section === 'deposit' ? 'page' : undefined} onClick={() => setSection('deposit')} type="button">存行单处理</button><button aria-current={section === 'report' ? 'page' : undefined} onClick={() => setSection('report')} type="button">营业日报</button></nav>{section === 'personal' ? <PersonalRemittanceWorkspace embedded institutionCode={institutionCode} institutionName={institutionName} onBack={onBack} onOpenSettlement={onOpenSettlement} operator={operator} repository={repository} /> : section === 'institution' ? <InstitutionRemittancePanel canManageInstitution={canManageInstitution} institutionCode={institutionCode} institutionName={institutionName} operator={operator} repository={repository} /> : section === 'deposit' ? <BankDepositPanel canManageInstitution={canManageInstitution} institutionCode={institutionCode} institutionName={institutionName} operator={operator} repository={repository} /> : <BusinessReportPanel canManageInstitution={canManageInstitution} institutionCode={institutionCode} institutionName={institutionName} operator={operator} repository={repository} />}</section>
}
