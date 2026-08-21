import { useEffect, useMemo, useState } from 'react'

import {
  businessCalendarDay,
  formatBusinessDateTime,
} from '../../domain/shared/businessTime'
import {
  queryPostageMeterDelegableTransactions,
  queryPostageMeterMailHandovers,
  queryPostageMeterUsageLedger,
} from '../../domain/service/postageMeter'
import type { ServiceRepository } from '../../domain/service/repository'
import type {
  PostageMeterMailHandover,
  PostageMeterMailHandoverStatus,
  PostageMeterRepairMatter,
  ServiceOperatorSnapshot,
  ServiceTransaction,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

export type PostageMeterOperationSection =
  | 'handover-out'
  | 'handover-in'
  | 'funding'
  | 'repair'
  | 'handover-history'
  | 'usage-ledger'

interface PostageMeterOperationsWorkspaceProps {
  section: PostageMeterOperationSection
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  institutionCode: string
  onBack: () => void
}

interface InstitutionOption {
  code: string
  name: string
}

const targetInstitutions: InstitutionOption[] = [
  { code: '99902001', name: '松岚支局' },
  { code: '99903001', name: '云浦支局' },
]

const sectionLabels: Record<PostageMeterOperationSection, string> = {
  'handover-out': '委托交出处理',
  'handover-in': '委托接收处理',
  funding: '注资申请',
  repair: '报修启用',
  'handover-history': '邮资机历史交接信息查询',
  'usage-ledger': '邮资机使用登记簿查询',
}

function latestOperationalDay(workspace: ServiceWorkspaceState): string {
  return [
    ...workspace.transactions.map((transaction) => businessCalendarDay(transaction.acceptedAt)),
    ...workspace.postageMeterMailHandovers.map((handover) =>
      businessCalendarDay(handover.handedOverAt)),
    ...workspace.postageMeterRegistrations.map((registration) =>
      businessCalendarDay(registration.registeredAt)),
  ].filter(Boolean).sort().at(-1) ?? businessCalendarDay(new Date())
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

function parseMoney(value: string, label: string): number {
  const trimmed = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`${label}必须是最多两位小数的金额。`)
  }
  const [integer, decimal = ''] = trimmed.split('.')
  return Number(integer) * 100 + Number(decimal.padEnd(2, '0'))
}

function moneyInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '')
  const [integer = '', ...rest] = cleaned.split('.')
  return rest.length === 0 ? integer : `${integer}.${rest.join('').slice(0, 2)}`
}

function matchesDay(value: string, from: string, to: string): boolean {
  const day = businessCalendarDay(value)
  return (!from || day >= from) && (!to || day <= to)
}

function handoverStatusLabel(status: PostageMeterMailHandoverStatus): string {
  if (status === 'pending-receipt') return '未接收'
  if (status === 'received') return '已接收'
  if (status === 'return-requested') return '退回待审批'
  return '已退回'
}

function escapeCsv(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function PostageMeterOperationsWorkspace({
  section,
  repository,
  operator,
  institutionCode,
  onBack,
}: PostageMeterOperationsWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [dateFrom, setDateFrom] = useState(businessCalendarDay(new Date()))
  const [dateTo, setDateTo] = useState(businessCalendarDay(new Date()))
  const [outTab, setOutTab] = useState<'pending' | 'history'>('pending')
  const [inTab, setInTab] = useState<'pending' | 'history'>('pending')
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([])
  const [selectedHandoverIds, setSelectedHandoverIds] = useState<string[]>([])
  const [handoverModalIds, setHandoverModalIds] = useState<string[]>([])
  const [receiveModalIds, setReceiveModalIds] = useState<string[]>([])
  const [targetInstitutionCode, setTargetInstitutionCode] = useState('99902001')
  const [agreementTerm, setAgreementTerm] = useState('')
  const [sourceInstitutionTerm, setSourceInstitutionTerm] = useState('')
  const [handoverNumberTerm, setHandoverNumberTerm] = useState('')
  const [handoverStatus, setHandoverStatus] = useState<PostageMeterMailHandoverStatus | ''>('')
  const [detailHandover, setDetailHandover] = useState<PostageMeterMailHandover | null>(null)
  const [returnHandover, setReturnHandover] = useState<PostageMeterMailHandover | null>(null)
  const [returnMode, setReturnMode] = useState<'request' | 'direct'>('request')
  const [fundingDeviceId, setFundingDeviceId] = useState('')
  const [fundingAmount, setFundingAmount] = useState('')
  const [repairDeviceId, setRepairDeviceId] = useState('')
  const [repairMatter, setRepairMatter] = useState<PostageMeterRepairMatter | ''>('')
  const [historyDeviceId, setHistoryDeviceId] = useState('')
  const [usageDeviceId, setUsageDeviceId] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      const day = latestOperationalDay(loaded)
      setWorkspace(loaded)
      setDateFrom(day)
      setDateTo(day)
      setFundingDeviceId(loaded.postageMeterDevices[0]?.id ?? '')
      setRepairDeviceId(loaded.postageMeterDevices[0]?.id ?? '')
      setHistoryDeviceId(loaded.postageMeterDevices[0]?.id ?? '')
      setUsageDeviceId(loaded.postageMeterDevices[0]?.id ?? '')
    })
    return () => {
      active = false
    }
  }, [repository])

  const delegableTransactions = useMemo(() => {
    if (!workspace) return []
    return queryPostageMeterDelegableTransactions(workspace)
      .filter((transaction) => matchesDay(transaction.acceptedAt, dateFrom, dateTo))
      .filter((transaction) => !agreementTerm ||
        transaction.customer.sender.agreementAccountId?.includes(agreementTerm) ||
        transaction.customer.sender.agreementAccountName.includes(agreementTerm))
  }, [workspace, dateFrom, dateTo, agreementTerm])

  const handovers = useMemo(() => workspace
    ? queryPostageMeterMailHandovers(workspace, {
        handedOverDateFrom: dateFrom,
        handedOverDateTo: dateTo,
        status: handoverStatus,
        sourceInstitution: sourceInstitutionTerm,
        targetInstitution: '',
        agreementAccount: agreementTerm,
        handoverNumber: handoverNumberTerm,
      })
    : [], [workspace, dateFrom, dateTo, handoverStatus, agreementTerm, handoverNumberTerm, sourceInstitutionTerm])

  const pendingIncoming = handovers.filter((handover) =>
    handover.status === 'pending-receipt')
  const receivedHistory = handovers.filter((handover) =>
    handover.status !== 'pending-receipt')
  const usageRows = workspace
    ? queryPostageMeterUsageLedger(workspace, dateFrom, dateTo, usageDeviceId)
    : []

  if (!workspace) return <p className="customer-loading">正在读取邮资机业务数据…</p>

  const selectedTransactions = delegableTransactions.filter((transaction) =>
    handoverModalIds.includes(transaction.id))
  const selectedIncoming = pendingIncoming.filter((handover) =>
    receiveModalIds.includes(handover.id))

  function applyWorkspace(next: ServiceWorkspaceState, message: string): void {
    const day = latestOperationalDay(next)
    setWorkspace(next)
    setDateFrom(day)
    setDateTo(day)
    setNotice(message)
    setError('')
  }

  function toggleTransaction(transactionId: string): void {
    setSelectedTransactionIds((current) => current.includes(transactionId)
      ? current.filter((id) => id !== transactionId)
      : [...current, transactionId])
  }

  function toggleHandover(handoverId: string): void {
    setSelectedHandoverIds((current) => current.includes(handoverId)
      ? current.filter((id) => id !== handoverId)
      : [...current, handoverId])
  }

  async function submitHandover(): Promise<void> {
    const target = targetInstitutions.find((institution) =>
      institution.code === targetInstitutionCode)
    if (!target) {
      setError('请选择过戳机构。')
      return
    }
    try {
      const result = await repository.executePostageMeter({
        type: 'create-postage-meter-mail-handover',
        transactionIds: handoverModalIds,
        sourceInstitutionCode: institutionCode,
        sourceInstitutionName: operator.acceptanceOffice,
        targetInstitutionCode: target.code,
        targetInstitutionName: target.name,
        sourceCounterCode: operator.workstationCode,
        handedOverAt: new Date().toISOString(),
        operator,
      })
      applyWorkspace(result.state, `委托交出成功，委托流水号 ${result.handover?.handoverNumber}。`)
      setSelectedTransactionIds([])
      setHandoverModalIds([])
      setOutTab('history')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '委托交出失败。')
    }
  }

  async function receiveHandovers(): Promise<void> {
    try {
      const result = await repository.executePostageMeter({
        type: 'receive-postage-meter-mail-handovers',
        handoverIds: receiveModalIds,
        receivedAt: new Date().toISOString(),
        operator,
      })
      applyWorkspace(result.state, `接收成功，共 ${result.handovers?.length ?? 0} 个委托批次。`)
      setSelectedHandoverIds([])
      setReceiveModalIds([])
      setInTab('history')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '委托接收失败。')
    }
  }

  async function confirmReturn(): Promise<void> {
    if (!returnHandover) return
    try {
      const result = await repository.executePostageMeter(returnMode === 'request'
        ? {
            type: 'request-postage-meter-mail-handover-return',
            handoverId: returnHandover.id,
            requestedAt: new Date().toISOString(),
            operator,
          }
        : {
            type: 'return-postage-meter-mail-handover',
            handoverId: returnHandover.id,
            returnedAt: new Date().toISOString(),
            operator,
          })
      applyWorkspace(
        result.state,
        returnMode === 'request'
          ? '退回申请已提交，请在批次查改审批中完成审批。'
          : '委托记录已退回。',
      )
      setReturnHandover(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '退回处理失败。')
    }
  }

  async function submitFunding(): Promise<void> {
    try {
      const result = await repository.executePostageMeter({
        type: 'submit-postage-meter-funding-request',
        deviceId: fundingDeviceId,
        amountCents: parseMoney(fundingAmount, '申请注资金额'),
        requestedAt: new Date().toISOString(),
        operator,
      })
      applyWorkspace(
        result.state,
        `注资申请 ${result.fundingRequest?.requestNumber} 已发送，等待邮资机管理系统审批。`,
      )
      setFundingAmount('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '注资申请失败。')
    }
  }

  async function submitRepair(): Promise<void> {
    if (!repairMatter) {
      setError('请选择申请事项。')
      return
    }
    try {
      const result = await repository.executePostageMeter({
        type: 'submit-postage-meter-repair-request',
        deviceId: repairDeviceId,
        matter: repairMatter,
        requestedAt: new Date().toISOString(),
        operator,
      })
      applyWorkspace(
        result.state,
        repairMatter === 'repair'
          ? `报修申请 ${result.repairRequest?.requestNumber} 已提交，邮资机已停用。`
          : `启用申请 ${result.repairRequest?.requestNumber} 已提交，请到日终平衡重新上传后生效。`,
      )
      setRepairMatter('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '报修启用申请失败。')
    }
  }

  function handoverProcessed(handover: PostageMeterMailHandover): boolean {
    if (!workspace) return false
    const transactionIds = new Set(handover.items.map((item) => item.transactionId))
    return workspace.postageMeterBatches.some((batch) =>
      batch.items.some((item) => transactionIds.has(item.transactionId)))
  }

  function exportUsage(): void {
    const rows = [
      ['过戳批次号', '协议客户编号', '起始数量', '终止数量', '注销件数', '起始金额', '终止金额', '注销金额', '已过戳件数', '已过戳金额', '应过戳件数', '应过戳金额', '差异件数', '差异金额'],
      ...usageRows.map((row) => [
        row.batch.batchNumber,
        row.agreementAccountIds.join('/'),
        row.registration.startCount,
        row.registration.endCount,
        row.registration.cancelledCount,
        formatCents(row.registration.startAmountCents),
        formatCents(row.registration.endAmountCents),
        formatCents(row.registration.cancelledAmountCents),
        row.registration.actualItemCount,
        formatCents(row.registration.actualPostageCents),
        row.batch.expectedItemCount,
        formatCents(row.batch.expectedPostageCents),
        row.differenceItemCount,
        formatCents(row.differencePostageCents),
      ]),
    ]
    downloadText(
      `postage-meter-ledger-${dateFrom}-${dateTo}.csv`,
      `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`,
    )
    setNotice(`已导出 ${usageRows.length} 条使用登记簿记录。`)
  }

  function transactionTable(rows: ServiceTransaction[]) {
    return <div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table"><thead><tr><th>选择</th><th>序号</th><th>查询流水号</th><th>客户名称</th><th>客户编号</th><th>应过戳件数</th><th>应过戳金额</th><th>收寄机构</th><th>收寄日期</th><th>操作</th></tr></thead><tbody>{rows.map((transaction, index) => <tr key={transaction.id}><td><input aria-label={`选择待委托记录 ${transaction.id}`} checked={selectedTransactionIds.includes(transaction.id)} onChange={() => toggleTransaction(transaction.id)} type="checkbox" /></td><td>{index + 1}</td><td>{transaction.id}</td><td>{transaction.customer.sender.agreementAccountName}</td><td>{transaction.customer.sender.agreementAccountId}</td><td>{transaction.service.quantity}</td><td>{formatCents(transaction.charge.postageCents)}</td><td>{transaction.operator.acceptanceOffice}</td><td>{businessCalendarDay(transaction.acceptedAt)}</td><td className="postage-meter__row-actions"><button onClick={() => setHandoverModalIds([transaction.id])} type="button">委托</button></td></tr>)}{rows.length === 0 ? <tr><td colSpan={10}>无数据</td></tr> : null}</tbody></table></div>
  }

  function handoverTable(rows: PostageMeterMailHandover[], receiving = false) {
    return <div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table"><thead><tr>{receiving ? <th>选择</th> : null}<th>序号</th><th>委托流水号</th><th>交出日期</th><th>应过戳件数</th><th>应过戳金额</th><th>收寄机构</th><th>过戳机构</th><th>交接状态</th><th>操作</th></tr></thead><tbody>{rows.map((handover, index) => <tr key={handover.id}>{receiving ? <td><input aria-label={`选择待接收记录 ${handover.id}`} checked={selectedHandoverIds.includes(handover.id)} onChange={() => toggleHandover(handover.id)} type="checkbox" /></td> : null}<td>{index + 1}</td><td>{handover.handoverNumber}</td><td>{businessCalendarDay(handover.handedOverAt)}</td><td>{handover.expectedItemCount}</td><td>{formatCents(handover.expectedPostageCents)}</td><td>{handover.sourceInstitutionName}</td><td>{handover.targetInstitutionName}</td><td>{handoverStatusLabel(handover.status)}</td><td className="postage-meter__row-actions"><button onClick={() => setDetailHandover(handover)} type="button">详情</button>{receiving && handover.status === 'pending-receipt' ? <button onClick={() => setReceiveModalIds([handover.id])} type="button">接收</button> : null}{!receiving && handover.status === 'received' && !handoverProcessed(handover) ? <button onClick={() => { setReturnMode('request'); setReturnHandover(handover) }} type="button">退回</button> : null}{receiving && handover.status === 'received' && !handoverProcessed(handover) ? <button onClick={() => { setReturnMode('direct'); setReturnHandover(handover) }} type="button">退回</button> : null}</td></tr>)}{rows.length === 0 ? <tr><td colSpan={receiving ? 10 : 9}>无数据</td></tr> : null}</tbody></table></div>
  }

  const renderHandoverOut = () => <>
    <nav aria-label="委托交出分类" className="dispatch-query__tabs postage-meter__tabs"><button aria-current={outTab === 'pending' ? 'page' : undefined} onClick={() => setOutTab('pending')} type="button">待委托记录</button><button aria-current={outTab === 'history' ? 'page' : undefined} onClick={() => setOutTab('history')} type="button">已委托记录</button></nav>
    <section aria-label="委托交出查询条件" className="mail-handover__query"><div className="mail-handover__filters postage-meter__filters"><label><span>收寄日期</span><input aria-label="委托交出开始日期" onChange={(event) => setDateFrom(event.target.value)} value={dateFrom} /></label><label><span>至</span><input aria-label="委托交出结束日期" onChange={(event) => setDateTo(event.target.value)} value={dateTo} /></label><label><span>收寄人员</span><input aria-label="委托交出收寄人员" readOnly value={operator.displayName} /></label><label><span>协议客户</span><input aria-label="委托交出协议客户" onChange={(event) => setAgreementTerm(event.target.value)} placeholder="名称或编号" value={agreementTerm} /></label><label><span>台席</span><input aria-label="委托交出台席" readOnly value={operator.workstationCode} /></label>{outTab === 'history' ? <><label><span>委托流水号</span><input aria-label="委托交出流水号" onChange={(event) => setHandoverNumberTerm(event.target.value)} value={handoverNumberTerm} /></label><label><span>交接状态</span><select aria-label="委托交出状态" onChange={(event) => setHandoverStatus(event.target.value as PostageMeterMailHandoverStatus | '')} value={handoverStatus}><option value="">全部</option><option value="pending-receipt">未接收</option><option value="received">已接收</option><option value="return-requested">退回待审批</option><option value="returned">已退回</option></select></label></> : null}</div><div className="mail-handover__actions"><button onClick={() => { setNotice(`查询完成，共 ${outTab === 'pending' ? delegableTransactions.length : handovers.length} 条。`); setError('') }} type="button">查询</button><button className="mail-handover__action-warning" onClick={() => { setAgreementTerm(''); setHandoverNumberTerm(''); setHandoverStatus('') }} type="button">重置</button>{outTab === 'pending' ? <button className="mail-handover__action-primary" disabled={selectedTransactionIds.length === 0} onClick={() => setHandoverModalIds(selectedTransactionIds)} type="button">批量委托</button> : null}</div></section>
    <section aria-label={outTab === 'pending' ? '待委托记录' : '已委托记录'} className="mail-handover__results"><header><span>{outTab === 'pending' ? '待委托记录' : '已委托记录'}</span><strong>{outTab === 'pending' ? delegableTransactions.length : handovers.length} 条</strong></header>{outTab === 'pending' ? transactionTable(delegableTransactions) : handoverTable(handovers)}</section>
  </>

  const renderHandoverIn = () => <>
    <nav aria-label="委托接收分类" className="dispatch-query__tabs postage-meter__tabs"><button aria-current={inTab === 'pending' ? 'page' : undefined} onClick={() => setInTab('pending')} type="button">接收确认</button><button aria-current={inTab === 'history' ? 'page' : undefined} onClick={() => setInTab('history')} type="button">已接收查询</button></nav>
    <section aria-label="委托接收查询条件" className="mail-handover__query"><div className="mail-handover__filters postage-meter__filters"><label><span>交出日期</span><input aria-label="委托接收开始日期" onChange={(event) => setDateFrom(event.target.value)} value={dateFrom} /></label><label><span>至</span><input aria-label="委托接收结束日期" onChange={(event) => setDateTo(event.target.value)} value={dateTo} /></label><label><span>收寄机构</span><input aria-label="委托接收收寄机构" onChange={(event) => setSourceInstitutionTerm(event.target.value)} placeholder="机构名称或代码" value={sourceInstitutionTerm} /></label><label><span>委托流水号</span><input aria-label="委托接收流水号" onChange={(event) => setHandoverNumberTerm(event.target.value)} value={handoverNumberTerm} /></label></div><div className="mail-handover__actions"><button onClick={() => { setNotice(`查询完成，共 ${inTab === 'pending' ? pendingIncoming.length : receivedHistory.length} 条。`); setError('') }} type="button">查询</button>{inTab === 'pending' ? <button className="mail-handover__action-primary" disabled={selectedHandoverIds.length === 0} onClick={() => setReceiveModalIds(selectedHandoverIds)} type="button">批量接收</button> : null}</div></section>
    <section aria-label={inTab === 'pending' ? '接收确认' : '已接收查询'} className="mail-handover__results"><header><span>{inTab === 'pending' ? '接收确认' : '已接收查询'}</span><strong>{inTab === 'pending' ? pendingIncoming.length : receivedHistory.length} 条</strong></header>{handoverTable(inTab === 'pending' ? pendingIncoming : receivedHistory, true)}</section>
  </>

  const renderFunding = () => <section aria-label="远程注资申请" className="postage-meter__request-panel"><h1>远程注资申请</h1><label><span>邮资机品牌型号</span><select aria-label="注资邮资机品牌型号" onChange={(event) => setFundingDeviceId(event.target.value)} value={fundingDeviceId}>{workspace.postageMeterDevices.map((device) => <option key={device.id} value={device.id}>{device.meterHeadNumber} / {device.name}</option>)}</select></label><label><span>申请注资金额</span><input aria-label="申请注资金额" inputMode="decimal" onChange={(event) => setFundingAmount(moneyInput(event.target.value))} placeholder="请输入注资金额" value={fundingAmount} /><em>元</em></label><button className="mail-handover__action-warning" onClick={() => void submitFunding()} type="button">注资申请</button></section>

  const renderRepair = () => {
    const device = workspace.postageMeterDevices.find((candidate) =>
      candidate.id === repairDeviceId)
    return <section aria-label="报修启用申请" className="postage-meter__request-panel"><h1>报修启用申请</h1><label><span>邮资机品牌型号</span><select aria-label="报修邮资机品牌型号" onChange={(event) => setRepairDeviceId(event.target.value)} value={repairDeviceId}>{workspace.postageMeterDevices.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><label><span>邮资机表头号</span><input aria-label="报修邮资机表头号" readOnly value={device?.meterHeadNumber ?? ''} /></label><label><span>申请事项</span><select aria-label="报修启用申请事项" onChange={(event) => setRepairMatter(event.target.value as PostageMeterRepairMatter | '')} value={repairMatter}><option value="">请选择</option><option value="repair">报修</option><option value="enable">启用</option></select></label><button className="mail-handover__action-warning" onClick={() => void submitRepair()} type="button">提交</button></section>
  }

  const deviceHistoryRows = workspace.postageMeterDeviceHandoverHistory
    .filter((record) => !historyDeviceId || record.deviceId === historyDeviceId)
    .filter((record) => matchesDay(record.operatedAt, dateFrom, dateTo))

  const renderHandoverHistory = () => <><section aria-label="邮资机历史交接查询条件" className="mail-handover__query"><div className="mail-handover__filters postage-meter__filters"><label><span>统计日期</span><input aria-label="邮资机历史交接开始日期" onChange={(event) => setDateFrom(event.target.value)} value={dateFrom} /></label><label><span>至</span><input aria-label="邮资机历史交接结束日期" onChange={(event) => setDateTo(event.target.value)} value={dateTo} /></label><label><span>邮资机</span><select aria-label="邮资机历史交接设备" onChange={(event) => setHistoryDeviceId(event.target.value)} value={historyDeviceId}>{workspace.postageMeterDevices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label></div><div className="mail-handover__actions"><button onClick={() => setNotice(`查询完成，共 ${deviceHistoryRows.length} 条。`)} type="button">查询</button><button className="mail-handover__action-warning" onClick={() => { const day = latestOperationalDay(workspace); setDateFrom(day); setDateTo(day) }} type="button">重置</button></div></section><section aria-label="邮资机历史交接查询结果" className="mail-handover__results"><header><span>历史交接信息</span><strong>{deviceHistoryRows.length} 条</strong></header><div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table"><thead><tr><th>序号</th><th>邮资机名称</th><th>表头号</th><th>交出机构名称</th><th>交出员工姓名</th><th>接收机构名称</th><th>接收员工姓名</th><th>操作日期</th></tr></thead><tbody>{deviceHistoryRows.map((record, index) => { const device = workspace.postageMeterDevices.find((candidate) => candidate.id === record.deviceId); return <tr key={record.id}><td>{index + 1}</td><td>{device?.name}</td><td>{device?.meterHeadNumber}</td><td>{record.sourceInstitutionName}</td><td>{record.sourceEmployeeName}</td><td>{record.receivingInstitutionName}</td><td>{record.receivingEmployeeName}</td><td>{formatBusinessDateTime(record.operatedAt)}</td></tr> })}{deviceHistoryRows.length === 0 ? <tr><td colSpan={8}>无数据</td></tr> : null}</tbody></table></div></section></>

  const renderUsageLedger = () => <><section aria-label="邮资机使用登记簿查询条件" className="mail-handover__query"><div className="mail-handover__filters postage-meter__filters"><label><span>使用机构</span><input aria-label="邮资机使用机构" readOnly value={operator.acceptanceOffice} /></label><label><span>邮资机</span><select aria-label="邮资机使用登记簿设备" onChange={(event) => setUsageDeviceId(event.target.value)} value={usageDeviceId}>{workspace.postageMeterDevices.map((device) => <option key={device.id} value={device.id}>{device.meterHeadNumber} {device.name}</option>)}</select></label><label><span>统计日期</span><input aria-label="邮资机登记簿开始日期" onChange={(event) => setDateFrom(event.target.value)} value={dateFrom} /></label><label><span>至</span><input aria-label="邮资机登记簿结束日期" onChange={(event) => setDateTo(event.target.value)} value={dateTo} /></label></div><div className="mail-handover__actions"><button onClick={() => setNotice(`查询完成，共 ${usageRows.length} 条。`)} type="button">查询</button><button className="mail-handover__action-primary" onClick={exportUsage} type="button">导出</button><button className="mail-handover__action-warning" onClick={() => { const day = latestOperationalDay(workspace); setDateFrom(day); setDateTo(day) }} type="button">重置</button></div></section><section aria-label="邮资机使用登记簿查询结果" className="mail-handover__results"><header><span>邮资机使用登记簿</span><strong>{usageRows.length} 条</strong></header><div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table postage-meter__ledger-table"><thead><tr><th>序号</th><th>过戳批次号</th><th>协议客户编号</th><th>起始数量</th><th>终止数量</th><th>注销件数</th><th>起始金额</th><th>终止金额</th><th>注销金额</th><th>已过戳件数</th><th>已过戳金额</th><th>应过戳件数</th><th>应过戳金额</th><th>差异件数</th><th>差异金额</th></tr></thead><tbody>{usageRows.map((row, index) => <tr key={row.registration.id}><td>{index + 1}</td><td>{row.batch.batchNumber}</td><td>{row.agreementAccountIds.join('/')}</td><td>{row.registration.startCount}</td><td>{row.registration.endCount}</td><td>{row.registration.cancelledCount}</td><td>{formatCents(row.registration.startAmountCents)}</td><td>{formatCents(row.registration.endAmountCents)}</td><td>{formatCents(row.registration.cancelledAmountCents)}</td><td>{row.registration.actualItemCount}</td><td>{formatCents(row.registration.actualPostageCents)}</td><td>{row.batch.expectedItemCount}</td><td>{formatCents(row.batch.expectedPostageCents)}</td><td>{row.differenceItemCount}</td><td>{formatCents(row.differencePostageCents)}</td></tr>)}{usageRows.length === 0 ? <tr><td colSpan={15}>无数据</td></tr> : null}</tbody></table></div></section></>

  return <><div className="mail-handover postage-meter"><div className="customer-breadcrumb"><button onClick={onBack} type="button">营业工作台</button><span>/</span><span>邮资机业务</span><span>/</span><strong>{sectionLabels[section]}</strong></div>{section === 'handover-out' ? renderHandoverOut() : null}{section === 'handover-in' ? renderHandoverIn() : null}{section === 'funding' ? renderFunding() : null}{section === 'repair' ? renderRepair() : null}{section === 'handover-history' ? renderHandoverHistory() : null}{section === 'usage-ledger' ? renderUsageLedger() : null}{notice ? <p className="customer-notice" role="status">{notice}</p> : null}{error && handoverModalIds.length === 0 && receiveModalIds.length === 0 && !returnHandover ? <p className="customer-form-error" role="alert">{error}</p> : null}</div>
    {handoverModalIds.length > 0 ? <Modal description="选择代过戳机构" eyebrow="委托交出处理" title="委托处理"><div className="mail-handover__modal-form"><label><span>过戳机构</span><select aria-label="委托过戳机构" onChange={(event) => setTargetInstitutionCode(event.target.value)} value={targetInstitutionCode}>{targetInstitutions.map((institution) => <option key={institution.code} value={institution.code}>{institution.name} {institution.code}</option>)}</select></label></div><div className="postage-meter__picker-summary"><span>勾选金额：<strong>{formatCents(selectedTransactions.reduce((total, transaction) => total + transaction.charge.postageCents, 0))}</strong> 元</span><span>勾选件数：<strong>{selectedTransactions.reduce((total, transaction) => total + transaction.service.quantity, 0)}</strong> 件</span></div>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => void submitHandover()} type="button">确定</button><button className="secondary-button" onClick={() => setHandoverModalIds([])} type="button">取消</button></div></Modal> : null}
    {receiveModalIds.length > 0 ? <Modal description="确认接收所选委托邮件" eyebrow="委托接收处理" title="接收确认"><div className="mail-handover__modal-form"><label><span>过戳机构</span><input aria-label="接收过戳机构" readOnly value={selectedIncoming.map((handover) => handover.targetInstitutionName).join('、')} /></label><label><span>收寄机构</span><input aria-label="接收收寄机构" readOnly value={selectedIncoming.map((handover) => handover.sourceInstitutionName).join('、')} /></label></div><div className="postage-meter__picker-summary"><span>勾选金额：<strong>{formatCents(selectedIncoming.reduce((total, handover) => total + handover.expectedPostageCents, 0))}</strong> 元</span><span>勾选件数：<strong>{selectedIncoming.reduce((total, handover) => total + handover.expectedItemCount, 0)}</strong> 件</span></div>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => void receiveHandovers()} type="button">确定</button><button className="secondary-button" onClick={() => setReceiveModalIds([])} type="button">取消</button></div></Modal> : null}
    {detailHandover ? <Modal description={detailHandover.handoverNumber} eyebrow="邮资机委托交接" title="委托记录详情"><div className="postage-meter__picker-summary"><span>交出机构：<strong>{detailHandover.sourceInstitutionName}</strong></span><span>过戳机构：<strong>{detailHandover.targetInstitutionName}</strong></span><span>应过戳：<strong>{detailHandover.expectedItemCount}</strong> 件</span><span>应过戳金额：<strong>{formatCents(detailHandover.expectedPostageCents)}</strong> 元</span></div><div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table"><thead><tr><th>序号</th><th>查询流水号</th><th>客户名称</th><th>客户编号</th><th>邮件号码</th><th>件数</th><th>金额</th></tr></thead><tbody>{detailHandover.items.map((item, index) => <tr key={item.transactionId}><td>{index + 1}</td><td>{item.querySerial}</td><td>{item.agreementAccountName}</td><td>{item.agreementAccountId}</td><td>{item.itemNumber}</td><td>{item.quantity}</td><td>{formatCents(item.expectedPostageCents)}</td></tr>)}</tbody></table></div><div className="modal-actions"><button className="secondary-button" onClick={() => setDetailHandover(null)} type="button">关闭</button></div></Modal> : null}
    {returnHandover ? <Modal description={returnHandover.handoverNumber} eyebrow={returnMode === 'request' ? '委托交出处理' : '委托接收处理'} title="退回确认"><p>是否退回该委托批次？当前勾选 {returnHandover.expectedItemCount} 件，勾选金额 {formatCents(returnHandover.expectedPostageCents)} 元。</p>{returnMode === 'request' ? <p>提交后需要待过戳机构在批次查改审批中批准。</p> : null}{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => void confirmReturn()} type="button">确定</button><button className="secondary-button" onClick={() => setReturnHandover(null)} type="button">取消</button></div></Modal> : null}
  </>
}
