import { useEffect, useMemo, useState } from 'react'

import type {
  OnSiteAuthorization,
  RequestOnSiteAuthorization,
} from '../../domain/access/workAuthorization'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import {
  postageMeterBatchDifference,
  queryPostageMeterBatches,
  queryPostageMeterPendingTransactions,
  type PostageMeterBatchQuery,
} from '../../domain/service/postageMeter'
import type { ServiceRepository } from '../../domain/service/repository'
import type {
  PostageMeterBatch,
  PostageMeterDevice,
  PostageMeterNetworkMode,
  PostageMeterTerminalPort,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

export type PostageMeterSection =
  | 'batch'
  | 'registration'
  | 'balance'
  | 'daily'
  | 'maintenance'

interface PostageMeterWorkspaceProps {
  section: PostageMeterSection
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  institutionCode: string
  authorizeOnSite: RequestOnSiteAuthorization
  onBack: () => void
}

interface DeviceDraft {
  counterCode: string
  networkMode: PostageMeterNetworkMode
  terminalPort: PostageMeterTerminalPort
}

const sectionLabels: Record<PostageMeterSection, string> = {
  batch: '过戳批次管理',
  registration: '过戳登记',
  balance: '批次过戳平衡',
  daily: '日终平衡',
  maintenance: '邮资机信息维护',
}

function latestOperationalDay(workspace: ServiceWorkspaceState): string {
  return [
    ...workspace.transactions.map((transaction) => businessCalendarDay(transaction.acceptedAt)),
    ...workspace.postageMeterBatches.map((batch) => businessCalendarDay(batch.createdAt)),
    ...workspace.postageMeterRegistrations.map((record) =>
      businessCalendarDay(record.registeredAt)),
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

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

function moneyInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '')
  const [integer = '', ...rest] = cleaned.split('.')
  return rest.length === 0
    ? integer
    : `${integer}.${rest.join('').slice(0, 2)}`
}

function statusLabel(status: PostageMeterBatch['status']): string {
  return status === 'pending' ? '未过戳' : status === 'registered' ? '待平衡' : '已平衡'
}

function downloadText(filename: string, content: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function escapeCsv(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function PostageMeterWorkspace({
  section,
  repository,
  operator,
  institutionCode,
  authorizeOnSite,
  onBack,
}: PostageMeterWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [batchQuery, setBatchQuery] = useState<PostageMeterBatchQuery>({
    createdDateFrom: businessCalendarDay(new Date()),
    createdDateTo: businessCalendarDay(new Date()),
    status: '',
  })
  const [batchRows, setBatchRows] = useState<PostageMeterBatch[]>([])
  const [batchTab, setBatchTab] = useState<'management' | 'approval'>('management')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [appendBatchId, setAppendBatchId] = useState<string | null>(null)
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([])
  const [detailBatch, setDetailBatch] = useState<PostageMeterBatch | null>(null)
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [startCount, setStartCount] = useState('')
  const [endCount, setEndCount] = useState('')
  const [cancelledCount, setCancelledCount] = useState('0')
  const [startAmount, setStartAmount] = useState('')
  const [endAmount, setEndAmount] = useState('')
  const [cancelledAmount, setCancelledAmount] = useState('0.00')
  const [readingLoaded, setReadingLoaded] = useState(false)
  const [adjustAuthorized, setAdjustAuthorized] = useState(false)
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [supervisorEmployeeId, setSupervisorEmployeeId] = useState('')
  const [supervisorSecret, setSupervisorSecret] = useState('')
  const [adjustmentAuthorization, setAdjustmentAuthorization] = useState<OnSiteAuthorization>()
  const [balanceDateFrom, setBalanceDateFrom] = useState(businessCalendarDay(new Date()))
  const [balanceDateTo, setBalanceDateTo] = useState(businessCalendarDay(new Date()))
  const [balanceBatchTerm, setBalanceBatchTerm] = useState('')
  const [balanceDeviceId, setBalanceDeviceId] = useState('')
  const [balanceStatus, setBalanceStatus] = useState<PostageMeterBatch['status'] | ''>('')
  const [discrepancyBatch, setDiscrepancyBatch] = useState<PostageMeterBatch | null>(null)
  const [discrepancyReason, setDiscrepancyReason] = useState('')
  const [dailyDate, setDailyDate] = useState(businessCalendarDay(new Date()))
  const [dailyDeviceId, setDailyDeviceId] = useState('')
  const [dailyPreviewOpen, setDailyPreviewOpen] = useState(false)
  const [uploadRecordsOpen, setUploadRecordsOpen] = useState(false)
  const [deviceDrafts, setDeviceDrafts] = useState<Record<string, DeviceDraft>>({})
  const [deviceNameFilter, setDeviceNameFilter] = useState('')
  const [deviceNetworkFilter, setDeviceNetworkFilter] = useState<PostageMeterNetworkMode | ''>('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      const day = latestOperationalDay(loaded)
      setWorkspace(loaded)
      setBatchQuery({ createdDateFrom: day, createdDateTo: day, status: '' })
      setBatchRows(queryPostageMeterBatches(loaded, {
        createdDateFrom: day,
        createdDateTo: day,
        status: '',
      }))
      setBalanceDateFrom(day)
      setBalanceDateTo(day)
      setDailyDate(day)
      setSelectedDeviceId(loaded.postageMeterDevices[0]?.id ?? '')
      setDailyDeviceId(loaded.postageMeterDevices[0]?.id ?? '')
      setDeviceDrafts(Object.fromEntries(loaded.postageMeterDevices.map((device) => [
        device.id,
        {
          counterCode: device.counterCode,
          networkMode: device.networkMode,
          terminalPort: device.terminalPort,
        },
      ])))
    })
    return () => {
      active = false
    }
  }, [repository])

  const pendingTransactions = useMemo(
    () => workspace ? queryPostageMeterPendingTransactions(workspace) : [],
    [workspace],
  )
  const selectedBatch = workspace?.postageMeterBatches.find(
    (batch) => batch.id === selectedBatchId,
  ) ?? null
  const selectedDevice = workspace?.postageMeterDevices.find(
    (device) => device.id === selectedDeviceId,
  ) ?? null
  const dailyBalance = workspace?.postageMeterDailyBalances.find(
    (balance) => balance.statisticDate === dailyDate &&
      balance.deviceId === dailyDeviceId,
  ) ?? null
  const balanceRows = workspace
    ? workspace.postageMeterBatches
        .filter((batch) => batch.status !== 'pending')
        .filter((batch) => !balanceStatus || batch.status === balanceStatus)
        .filter((batch) => !balanceBatchTerm.trim() ||
          batch.batchNumber.includes(balanceBatchTerm.trim()))
        .filter((batch) => {
          const registration = workspace.postageMeterRegistrations.find(
            (record) => record.batchId === batch.id,
          )
          if (!registration) return false
          const day = businessCalendarDay(registration.registeredAt)
          return (!balanceDateFrom || day >= balanceDateFrom) &&
            (!balanceDateTo || day <= balanceDateTo) &&
            (!balanceDeviceId || registration.deviceId === balanceDeviceId)
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    : []
  const visibleDevices = workspace?.postageMeterDevices.filter((device) => {
    const term = deviceNameFilter.trim().toLocaleLowerCase('zh-CN')
    return (!term || [device.name, device.meterHeadNumber, device.baseNumber]
      .join(' ').toLocaleLowerCase('zh-CN').includes(term)) &&
      (!deviceNetworkFilter || device.networkMode === deviceNetworkFilter)
  }) ?? []
  const returnApprovalRows = workspace?.postageMeterMailHandovers
    .filter((handover) => handover.status === 'return-requested')
    .sort((left, right) =>
      (right.returnRequestedAt ?? '').localeCompare(left.returnRequestedAt ?? '')) ?? []

  function applyWorkspace(next: ServiceWorkspaceState, message: string): void {
    const day = latestOperationalDay(next)
    const nextBatchQuery = { ...batchQuery, createdDateFrom: day, createdDateTo: day }
    setWorkspace(next)
    setBatchQuery(nextBatchQuery)
    setBatchRows(queryPostageMeterBatches(next, nextBatchQuery))
    setBalanceDateFrom(day)
    setBalanceDateTo(day)
    setDailyDate(day)
    setNotice(message)
    setError('')
  }

  function runBatchQuery(): void {
    if (!workspace) return
    const rows = queryPostageMeterBatches(workspace, batchQuery)
    setBatchRows(rows)
    setNotice(`查询完成，共 ${rows.length} 条。`)
    setError('')
  }

  function openBatchPicker(targetBatchId: string | null): void {
    if (pendingTransactions.length === 0) {
      setError('当前没有已结算且尚未入批次的协议客户邮件。')
      return
    }
    setAppendBatchId(targetBatchId)
    setSelectedTransactionIds([])
    setPickerOpen(true)
    setError('')
  }

  async function saveBatchSelection(): Promise<void> {
    try {
      const result = appendBatchId
        ? await repository.executePostageMeter({
            type: 'append-postage-meter-batch',
            batchId: appendBatchId,
            transactionIds: selectedTransactionIds,
          })
        : await repository.executePostageMeter({
            type: 'create-postage-meter-batch',
            transactionIds: selectedTransactionIds,
            createdAt: new Date().toISOString(),
            operator,
          })
      applyWorkspace(
        result.state,
        appendBatchId ? '批次追加成功。' : `过戳批次 ${result.batch?.batchNumber} 已生成。`,
      )
      setPickerOpen(false)
      setAppendBatchId(null)
      setSelectedTransactionIds([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '过戳批次保存失败。')
    }
  }

  async function deleteBatch(batch: PostageMeterBatch): Promise<void> {
    try {
      const result = await repository.executePostageMeter({
        type: 'delete-postage-meter-batch',
        batchId: batch.id,
      })
      applyWorkspace(result.state, `过戳批次 ${batch.batchNumber} 已删除。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '过戳批次删除失败。')
    }
  }

  async function approveHandoverReturn(handoverId: string): Promise<void> {
    try {
      const result = await repository.executePostageMeter({
        type: 'approve-postage-meter-mail-handover-return',
        handoverId,
        approvedAt: new Date().toISOString(),
        operator,
      })
      applyWorkspace(result.state, '委托退回申请已批准。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '退回审批失败。')
    }
  }

  function exportBatch(batch: PostageMeterBatch): void {
    const rows = [
      ['查询流水号', '协议客户号', '客户名称', '业务产品', '邮件号码', '应过戳件数', '应过戳金额'],
      ...batch.items.map((item) => [
        item.querySerial,
        item.agreementAccountId,
        item.agreementAccountName,
        item.productName,
        item.itemNumber,
        item.quantity,
        formatCents(item.expectedPostageCents),
      ]),
    ]
    downloadText(
      `postage-meter-batch-${batch.batchNumber}.csv`,
      `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`,
    )
    setNotice('过戳批次明细已导出。')
  }

  function loadDeviceReading(): void {
    if (!selectedBatch || !selectedDevice) {
      setError('请先选择待过戳批次和邮资机。')
      return
    }
    setStartCount(String(selectedDevice.cumulativeImprintCount))
    setEndCount(String(selectedDevice.cumulativeImprintCount))
    setCancelledCount('0')
    setStartAmount(formatCents(selectedDevice.cumulativePostageCents))
    setEndAmount(formatCents(selectedDevice.cumulativePostageCents))
    setCancelledAmount('0.00')
    setReadingLoaded(true)
    setAdjustAuthorized(false)
    setAdjustmentAuthorization(undefined)
    setNotice('邮资机起始读数读取完成。')
    setError('')
  }

  async function authorizeAdjustment(): Promise<void> {
    try {
      const authorization = await authorizeOnSite(
        'adjust-postage-meter-reading',
        supervisorEmployeeId,
        supervisorSecret,
        new Date().toISOString(),
      )
      setAdjustmentAuthorization(authorization)
      setAdjustAuthorized(true)
      setAuthorizationOpen(false)
      setSupervisorSecret('')
      setNotice('有权人员现场授权通过，可以调整起始读数。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '现场授权失败。')
    }
  }

  async function saveRegistration(): Promise<void> {
    if (!selectedBatch || !selectedDevice) {
      setError('请先选择待过戳批次和邮资机。')
      return
    }
    try {
      const result = await repository.executePostageMeter({
        type: 'register-postage-meter-reading',
        batchId: selectedBatch.id,
        deviceId: selectedDevice.id,
        startCount: Number(startCount),
        endCount: Number(endCount),
        cancelledCount: Number(cancelledCount),
        startAmountCents: parseMoney(startAmount, '起始金额'),
        endAmountCents: parseMoney(endAmount, '终止金额'),
        cancelledAmountCents: parseMoney(cancelledAmount, '注销金额'),
        authorization: adjustmentAuthorization,
        registeredAt: new Date().toISOString(),
        operator,
      })
      applyWorkspace(result.state, `批次 ${selectedBatch.batchNumber} 过戳登记已保存。`)
      setSelectedBatchId('')
      setAdjustmentAuthorization(undefined)
      setAdjustAuthorized(false)
      setReadingLoaded(false)
      setAdjustAuthorized(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '过戳登记失败。')
    }
  }

  async function saveDiscrepancy(): Promise<void> {
    if (!discrepancyBatch) return
    try {
      const result = await repository.executePostageMeter({
        type: 'record-postage-meter-discrepancy',
        batchId: discrepancyBatch.id,
        reason: discrepancyReason,
      })
      applyWorkspace(result.state, `批次 ${discrepancyBatch.batchNumber} 已完成平衡。`)
      setDiscrepancyBatch(null)
      setDiscrepancyReason('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '差错登记失败。')
    }
  }

  async function generateDaily(): Promise<void> {
    try {
      const result = await repository.executePostageMeter({
        type: 'generate-postage-meter-daily-balance',
        institutionCode,
        institutionName: operator.acceptanceOffice,
        statisticDate: dailyDate,
        deviceId: dailyDeviceId,
        generatedAt: new Date().toISOString(),
      })
      applyWorkspace(result.state, '日终平衡统计完成。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '日终统计失败。')
    }
  }

  async function uploadDaily(): Promise<void> {
    if (!dailyBalance) {
      setError('请先执行日终统计。')
      return
    }
    try {
      const result = await repository.executePostageMeter({
        type: 'upload-postage-meter-daily-balance',
        balanceId: dailyBalance.id,
        uploadedAt: new Date().toISOString(),
        operator,
      })
      applyWorkspace(result.state, '日终平衡汇总信息上传成功。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '日终平衡上传失败。')
    }
  }

  function exportDaily(): void {
    if (!dailyBalance) {
      setError('请先执行日终统计。')
      return
    }
    const device = workspace?.postageMeterDevices.find(
      (candidate) => candidate.id === dailyBalance.deviceId,
    )
    const rows = [
      ['统计日期', '邮资机', '应过戳件数', '应过戳金额', '已过戳件数', '已过戳金额', '注销件数', '注销金额', '差异件数', '差异金额', '上传状态'],
      [
        dailyBalance.statisticDate,
        device?.name ?? '',
        dailyBalance.expectedItemCount,
        formatCents(dailyBalance.expectedPostageCents),
        dailyBalance.actualItemCount,
        formatCents(dailyBalance.actualPostageCents),
        dailyBalance.cancelledItemCount,
        formatCents(dailyBalance.cancelledPostageCents),
        dailyBalance.differenceItemCount,
        formatCents(dailyBalance.differencePostageCents),
        dailyBalance.uploadedAt ? '已上传' : '未上传',
      ],
    ]
    downloadText(
      `postage-meter-daily-${dailyBalance.statisticDate}.csv`,
      `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`,
    )
    setNotice('邮资机平衡汇总信息已导出。')
  }

  function updateDeviceDraft(deviceId: string, patch: Partial<DeviceDraft>): void {
    setDeviceDrafts((current) => {
      const currentDraft = current[deviceId]
      if (!currentDraft) return current
      return {
        ...current,
        [deviceId]: { ...currentDraft, ...patch },
      }
    })
  }

  async function saveDevice(device: PostageMeterDevice): Promise<void> {
    const draft = deviceDrafts[device.id]
    if (!draft) return
    try {
      const result = await repository.executePostageMeter({
        type: 'update-postage-meter-device',
        deviceId: device.id,
        counterCode: draft.counterCode,
        networkMode: draft.networkMode,
        terminalPort: draft.terminalPort,
        updatedAt: new Date().toISOString(),
      })
      applyWorkspace(result.state, `${device.name} 信息保存成功。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '邮资机信息保存失败。')
    }
  }

  async function saveVisibleDevices(): Promise<void> {
    if (!workspace) return
    try {
      let latest = workspace
      for (const device of visibleDevices) {
        const draft = deviceDrafts[device.id]
        if (!draft) continue
        const result = await repository.executePostageMeter({
          type: 'update-postage-meter-device',
          deviceId: device.id,
          counterCode: draft.counterCode,
          networkMode: draft.networkMode,
          terminalPort: draft.terminalPort,
          updatedAt: new Date().toISOString(),
        })
        latest = result.state
      }
      applyWorkspace(latest, `邮资机信息保存成功，共 ${visibleDevices.length} 条。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '邮资机信息保存失败。')
    }
  }

  function resetDeviceDrafts(): void {
    if (!workspace) return
    setDeviceDrafts(Object.fromEntries(workspace.postageMeterDevices.map((device) => [
      device.id,
      {
        counterCode: device.counterCode,
        networkMode: device.networkMode,
        terminalPort: device.terminalPort,
      },
    ])))
    setDeviceNameFilter('')
    setDeviceNetworkFilter('')
    setNotice('查询条件和未保存修改已重置。')
    setError('')
  }

  if (!workspace) {
    return <section className="mail-handover mail-handover--loading">正在读取邮资机业务数据…</section>
  }

  const renderBatchManagement = () => (
    <>
      <nav aria-label="过戳批次管理分类" className="dispatch-query__tabs postage-meter__tabs">
        <button aria-current={batchTab === 'management' ? 'page' : undefined} onClick={() => setBatchTab('management')} type="button">批次管理</button>
        <button aria-current={batchTab === 'approval' ? 'page' : undefined} onClick={() => setBatchTab('approval')} type="button">批次查改审批</button>
      </nav>
      {batchTab === 'management' ? <><section aria-label="过戳批次查询条件" className="mail-handover__query">
        <div className="mail-handover__filters postage-meter__filters">
          <label><span>日期范围</span><input aria-label="批次开始日期" onChange={(event) => setBatchQuery((current) => ({ ...current, createdDateFrom: event.target.value }))} value={batchQuery.createdDateFrom} /></label>
          <label><span>至</span><input aria-label="批次结束日期" onChange={(event) => setBatchQuery((current) => ({ ...current, createdDateTo: event.target.value }))} value={batchQuery.createdDateTo} /></label>
          <label><span>过戳状态</span><select aria-label="批次过戳状态" onChange={(event) => setBatchQuery((current) => ({ ...current, status: event.target.value as PostageMeterBatch['status'] | '' }))} value={batchQuery.status}><option value="">请选择</option><option value="pending">未过戳</option><option value="registered">待平衡</option><option value="balanced">已平衡</option></select></label>
        </div>
        <div className="mail-handover__actions"><button className="mail-handover__action-primary" onClick={() => openBatchPicker(null)} type="button">新增</button><button onClick={runBatchQuery} type="button">查询</button></div>
      </section>
      <section aria-label="过戳批次查询结果" className="mail-handover__results">
        <header><span>批次管理</span><strong>{batchRows.length} 条</strong></header>
        <div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table"><thead><tr><th>序号</th><th>过戳批次号</th><th>应过戳总件数</th><th>应过戳总金额</th><th>已过戳件数</th><th>已过戳金额</th><th>生成日期</th><th>过戳状态</th><th>操作</th></tr></thead><tbody>
          {batchRows.map((batch, index) => <tr key={batch.id}><td>{index + 1}</td><td>{batch.batchNumber}</td><td>{batch.expectedItemCount}</td><td>{formatCents(batch.expectedPostageCents)}</td><td>{batch.actualItemCount}</td><td>{formatCents(batch.actualPostageCents)}</td><td>{businessCalendarDay(batch.createdAt)}</td><td>{statusLabel(batch.status)}</td><td className="postage-meter__row-actions"><button onClick={() => setDetailBatch(batch)} type="button">详情</button><button disabled={batch.status !== 'pending'} onClick={() => openBatchPicker(batch.id)} type="button">追加</button><button onClick={() => exportBatch(batch)} type="button">导出</button><button disabled={batch.status !== 'pending'} onClick={() => void deleteBatch(batch)} type="button">删除</button></td></tr>)}
          {batchRows.length === 0 ? <tr><td colSpan={9}>无数据</td></tr> : null}
        </tbody></table></div>
      </section>
      </> : <section aria-label="批次查改审批结果" className="mail-handover__results"><header><span>委托退回审批</span><strong>{returnApprovalRows.length} 条</strong></header><div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table"><thead><tr><th>序号</th><th>委托流水号</th><th>申请日期</th><th>收寄机构</th><th>过戳机构</th><th>应过戳件数</th><th>应过戳金额</th><th>申请员工</th><th>操作</th></tr></thead><tbody>{returnApprovalRows.map((handover, index) => <tr key={handover.id}><td>{index + 1}</td><td>{handover.handoverNumber}</td><td>{handover.returnRequestedAt ? businessCalendarDay(handover.returnRequestedAt) : '—'}</td><td>{handover.sourceInstitutionName}</td><td>{handover.targetInstitutionName}</td><td>{handover.expectedItemCount}</td><td>{formatCents(handover.expectedPostageCents)}</td><td>{handover.returnRequestedBy?.displayName}</td><td><button onClick={() => void approveHandoverReturn(handover.id)} type="button">批准退回</button></td></tr>)}{returnApprovalRows.length === 0 ? <tr><td colSpan={9}>无数据</td></tr> : null}</tbody></table></div></section>}
    </>
  )

  const renderRegistration = () => (
    <>
      <nav aria-label="过戳登记分类" className="dispatch-query__tabs postage-meter__tabs"><button aria-current="page" type="button">过戳登记</button><button disabled type="button">过戳历史查询</button></nav>
      <section aria-label="过戳登记操作区" className="mail-handover__query postage-meter__registration-query">
        <div className="postage-meter__selector-row"><label><span>待过戳批次选择</span><select aria-label="待过戳批次选择" onChange={(event) => { setSelectedBatchId(event.target.value); setReadingLoaded(false) }} value={selectedBatchId}><option value="">请选择</option>{workspace.postageMeterBatches.filter((batch) => batch.status === 'pending').map((batch) => <option key={batch.id} value={batch.id}>{batch.batchNumber}</option>)}</select></label><label><span>邮资机</span><select aria-label="过戳邮资机" onChange={(event) => { setSelectedDeviceId(event.target.value); setReadingLoaded(false) }} value={selectedDeviceId}><option value="">请选择</option>{workspace.postageMeterDevices.filter((device) => device.validity === 'valid').map((device) => <option key={device.id} value={device.id}>{device.meterHeadNumber} {device.name}</option>)}</select></label></div>
        <div className="mail-handover__actions"><button onClick={loadDeviceReading} type="button">读取</button><button className="mail-handover__action-warning" onClick={() => setAuthorizationOpen(true)} type="button">调整</button><button className="mail-handover__action-primary" onClick={() => void saveRegistration()} type="button">保存</button></div>
        <div className="postage-meter__batch-summary"><span>批次总件数：<strong>{selectedBatch?.expectedItemCount ?? 0}</strong> 件</span><span>批次总金额：<strong>{formatCents(selectedBatch?.expectedPostageCents ?? 0)}</strong> 元</span><span>已过戳件数：<strong>{selectedBatch?.actualItemCount ?? 0}</strong> 件</span><span>已过戳金额：<strong>{formatCents(selectedBatch?.actualPostageCents ?? 0)}</strong> 元</span><span>未过戳件数：<strong>{selectedBatch ? selectedBatch.expectedItemCount - selectedBatch.actualItemCount : 0}</strong> 件</span><span>未过戳金额：<strong>{formatCents(selectedBatch ? selectedBatch.expectedPostageCents - selectedBatch.actualPostageCents : 0)}</strong> 元</span></div>
      </section>
      <section aria-label="邮资机读数登记" className="postage-meter__reading-grid"><label><span>起始数量</span><input aria-label="邮资机起始数量" inputMode="numeric" onChange={(event) => setStartCount(digitsOnly(event.target.value))} readOnly={!adjustAuthorized} value={startCount} /><em>件</em></label><label><span>终止数量</span><input aria-label="邮资机终止数量" inputMode="numeric" onChange={(event) => setEndCount(digitsOnly(event.target.value))} readOnly={!readingLoaded} value={endCount} /><em>件</em></label><label><span>注销数量</span><input aria-label="邮资机注销数量" inputMode="numeric" onChange={(event) => setCancelledCount(digitsOnly(event.target.value))} readOnly={!readingLoaded} value={cancelledCount} /><em>件</em></label><label><span>起始金额</span><input aria-label="邮资机起始金额" inputMode="decimal" onChange={(event) => setStartAmount(moneyInput(event.target.value))} readOnly={!adjustAuthorized} value={startAmount} /><em>元</em></label><label><span>终止金额</span><input aria-label="邮资机终止金额" inputMode="decimal" onChange={(event) => setEndAmount(moneyInput(event.target.value))} readOnly={!readingLoaded} value={endAmount} /><em>元</em></label><label><span>注销金额</span><input aria-label="邮资机注销金额" inputMode="decimal" onChange={(event) => setCancelledAmount(moneyInput(event.target.value))} readOnly={!readingLoaded} value={cancelledAmount} /><em>元</em></label><label><span>本期使用数量</span><input aria-label="本期使用数量" readOnly value={Math.max(0, Number(endCount || 0) - Number(startCount || 0) - Number(cancelledCount || 0))} /><em>件</em></label><label><span>本期使用金额</span><input aria-label="本期使用金额" readOnly value={(() => { try { return formatCents(Math.max(0, parseMoney(endAmount || '0', '终止金额') - parseMoney(startAmount || '0', '起始金额') - parseMoney(cancelledAmount || '0', '注销金额'))) } catch { return '0.00' } })()} /><em>元</em></label><label><span>总邮资</span><input aria-label="邮资机总邮资" readOnly value={formatCents(selectedDevice?.totalPostageCents ?? 0)} /><em>元</em></label><label><span>剩余金额</span><input aria-label="邮资机剩余金额" readOnly value={formatCents(selectedDevice?.remainingPostageCents ?? 0)} /><em>元</em></label></section>
    </>
  )

  const renderBalance = () => (
    <>
      <section aria-label="批次过戳平衡查询条件" className="mail-handover__query"><div className="mail-handover__filters postage-meter__filters"><label><span>过戳批次号</span><input aria-label="平衡批次号" onChange={(event) => setBalanceBatchTerm(event.target.value)} placeholder="批次号" value={balanceBatchTerm} /></label><label><span>过戳登记日期</span><input aria-label="平衡开始日期" onChange={(event) => setBalanceDateFrom(event.target.value)} value={balanceDateFrom} /></label><label><span>至</span><input aria-label="平衡结束日期" onChange={(event) => setBalanceDateTo(event.target.value)} value={balanceDateTo} /></label><label><span>邮资机</span><select aria-label="平衡邮资机" onChange={(event) => setBalanceDeviceId(event.target.value)} value={balanceDeviceId}><option value="">请选择</option>{workspace.postageMeterDevices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><label><span>差错状态</span><select aria-label="批次差错状态" onChange={(event) => setBalanceStatus(event.target.value as PostageMeterBatch['status'] | '')} value={balanceStatus}><option value="">请选择</option><option value="registered">待登记</option><option value="balanced">已完成</option></select></label></div><div className="mail-handover__actions"><button onClick={() => { setNotice(`查询完成，共 ${balanceRows.length} 条。`); setError('') }} type="button">查询</button></div></section>
      <section aria-label="批次过戳平衡结果" className="mail-handover__results"><header><span>批次过戳平衡</span><strong>{balanceRows.length} 条</strong></header><div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table postage-meter__balance-table"><thead><tr><th rowSpan={2}>登记日期</th><th rowSpan={2}>过戳批次号</th><th colSpan={3}>应过戳总件数</th><th colSpan={3}>应过戳总金额</th><th rowSpan={2}>已过戳件数</th><th rowSpan={2}>已过戳金额</th><th rowSpan={2}>差错状态</th><th rowSpan={2}>操作</th></tr><tr><th>其中本局</th><th>代他局</th><th>小计</th><th>其中本局</th><th>代他局</th><th>小计</th></tr></thead><tbody>{balanceRows.map((batch) => { const difference = postageMeterBatchDifference(batch); const registration = workspace.postageMeterRegistrations.find((record) => record.batchId === batch.id); return <tr key={batch.id}><td>{registration ? businessCalendarDay(registration.registeredAt) : '—'}</td><td>{batch.batchNumber}</td><td>{batch.expectedItemCount}</td><td>0</td><td>{batch.expectedItemCount}</td><td>{formatCents(batch.expectedPostageCents)}</td><td>0.00</td><td>{formatCents(batch.expectedPostageCents)}</td><td>{batch.actualItemCount}</td><td>{formatCents(batch.actualPostageCents)}</td><td>{batch.status === 'balanced' ? '已登记' : difference.itemCount === 0 && difference.postageCents === 0 ? '无差错' : '有差错'}</td><td className="postage-meter__row-actions"><button onClick={() => { setDiscrepancyBatch(batch); setDiscrepancyReason(batch.discrepancyReason) }} type="button">差错登记</button><button onClick={() => setDetailBatch(batch)} type="button">详情</button></td></tr> })}{balanceRows.length === 0 ? <tr><td colSpan={12}>无数据</td></tr> : null}</tbody></table></div></section>
    </>
  )

  const renderDaily = () => (
    <>
      <section aria-label="日终平衡操作区" className="mail-handover__query"><div className="mail-handover__filters postage-meter__filters"><label><span>过戳机构</span><input aria-label="日终过戳机构" readOnly value={operator.acceptanceOffice} /></label><label><span>统计日期</span><input aria-label="日终统计日期" onChange={(event) => setDailyDate(event.target.value)} value={dailyDate} /></label><label><span>邮资机</span><select aria-label="日终邮资机" onChange={(event) => setDailyDeviceId(event.target.value)} value={dailyDeviceId}>{workspace.postageMeterDevices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label></div><div className="mail-handover__actions postage-meter__daily-actions"><button onClick={() => void generateDaily()} type="button">日终统计</button><button className="mail-handover__action-primary" onClick={() => void uploadDaily()} type="button">确认上传</button><button className="mail-handover__action-warning" onClick={() => setUploadRecordsOpen(true)} type="button">上传记录</button><button onClick={exportDaily} type="button">导出</button><button onClick={() => { if (dailyBalance) setDailyPreviewOpen(true); else setError('请先执行日终统计。') }} type="button">打印</button><button onClick={() => { if (dailyBalance) setDailyPreviewOpen(true); else setError('请先执行日终统计。') }} type="button">机构过戳信息统计打印</button></div></section>
      <section aria-label="日终平衡汇总信息" className="postage-meter__daily-summary"><h2>日终平衡汇总信息</h2><div><span>应过戳件数<strong>{dailyBalance?.expectedItemCount ?? 0}</strong></span><span>其中本局过戳件数<strong>{dailyBalance?.expectedItemCount ?? 0}</strong></span><span>代他局过戳件数<strong>0</strong></span><span>应过戳金额<strong>{formatCents(dailyBalance?.expectedPostageCents ?? 0)}</strong></span><span>其中本局过戳金额<strong>{formatCents(dailyBalance?.expectedPostageCents ?? 0)}</strong></span><span>代他局过戳金额<strong>0.00</strong></span><span>已过戳件数<strong>{dailyBalance?.actualItemCount ?? 0}</strong></span><span>注销件数<strong>{dailyBalance?.cancelledItemCount ?? 0}</strong></span><span>差异件数<strong>{dailyBalance?.differenceItemCount ?? 0}</strong></span><span>已过戳金额<strong>{formatCents(dailyBalance?.actualPostageCents ?? 0)}</strong></span><span>注销金额<strong>{formatCents(dailyBalance?.cancelledPostageCents ?? 0)}</strong></span><span>差异金额<strong>{formatCents(dailyBalance?.differencePostageCents ?? 0)}</strong></span><span>邮资机使用数<strong>{dailyBalance ? 1 : 0}</strong></span><span>上传状态<strong>{dailyBalance?.uploadedAt ? '已上传' : '未上传'}</strong></span></div></section>
      <section aria-label="邮资机平衡汇总信息" className="mail-handover__results"><header><span>邮资机平衡汇总信息</span><strong>{dailyBalance ? 1 : 0} 条</strong></header><div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table"><thead><tr><th>序号</th><th>邮资机名称 / 表头号</th><th>表头累计已用邮资总数</th><th>表头累计已用邮资总额</th><th>表头累计处理邮件总数</th><th>已过戳件数</th><th>已过戳金额</th><th>注销件数</th><th>差异件数</th></tr></thead><tbody>{dailyBalance ? <tr><td>1</td><td>{workspace.postageMeterDevices.find((device) => device.id === dailyBalance.deviceId)?.name}<br />{workspace.postageMeterDevices.find((device) => device.id === dailyBalance.deviceId)?.meterHeadNumber}</td><td>{workspace.postageMeterDevices.find((device) => device.id === dailyBalance.deviceId)?.cumulativeImprintCount}</td><td>{formatCents(workspace.postageMeterDevices.find((device) => device.id === dailyBalance.deviceId)?.cumulativePostageCents ?? 0)}</td><td>{dailyBalance.actualItemCount + dailyBalance.cancelledItemCount}</td><td>{dailyBalance.actualItemCount}</td><td>{formatCents(dailyBalance.actualPostageCents)}</td><td>{dailyBalance.cancelledItemCount}</td><td>{dailyBalance.differenceItemCount}</td></tr> : <tr><td colSpan={9}>无数据</td></tr>}</tbody></table></div></section>
    </>
  )

  const renderMaintenance = () => (
    <>
      <section aria-label="邮资机信息查询条件" className="mail-handover__query"><div className="mail-handover__filters postage-meter__filters"><label><span>机器型号</span><input aria-label="邮资机机器型号" onChange={(event) => setDeviceNameFilter(event.target.value)} placeholder="邮资机名称 / 表头号" value={deviceNameFilter} /></label><label><span>有效标志</span><select aria-label="邮资机有效标志" defaultValue="valid"><option value="valid">有效</option><option value="invalid">无效</option></select></label><label><span>直联状态</span><select aria-label="邮资机直联状态" onChange={(event) => setDeviceNetworkFilter(event.target.value as PostageMeterNetworkMode | '')} value={deviceNetworkFilter}><option value="">全部</option><option value="direct">直联</option><option value="indirect">非直连</option></select></label></div><div className="mail-handover__actions"><button onClick={() => { setNotice(`查询完成，共 ${visibleDevices.length} 条。`); setError('') }} type="button">查询</button><button className="mail-handover__action-primary" onClick={() => void saveVisibleDevices()} type="button">保存</button><button className="mail-handover__action-warning" onClick={resetDeviceDrafts} type="button">重置</button></div></section>
      <section aria-label="邮资机信息列表" className="mail-handover__results"><header><span>邮资机信息维护</span><strong>{visibleDevices.length} 条</strong></header><div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table postage-meter__device-table"><thead><tr><th>序号</th><th>邮资机名称</th><th>表头号</th><th>底座号</th><th>有效状态</th><th>台席代码</th><th>联网能力</th><th>端口号</th><th>报修状态</th><th>操作</th></tr></thead><tbody>{visibleDevices.map((device, index) => { const draft = deviceDrafts[device.id]; return <tr key={device.id}><td>{index + 1}</td><td>{device.name}</td><td>{device.meterHeadNumber}</td><td>{device.baseNumber}</td><td>{device.validity === 'valid' ? '有效' : '无效'}</td><td><input aria-label={`${device.name}台席代码`} inputMode="numeric" maxLength={8} onChange={(event) => updateDeviceDraft(device.id, { counterCode: digitsOnly(event.target.value).slice(0, 8) })} value={draft?.counterCode ?? ''} /></td><td><select aria-label={`${device.name}联网能力`} onChange={(event) => updateDeviceDraft(device.id, { networkMode: event.target.value as PostageMeterNetworkMode })} value={draft?.networkMode ?? 'direct'}><option value="direct">直联</option><option value="indirect">非直连</option></select></td><td><select aria-label={`${device.name}终端端口`} onChange={(event) => updateDeviceDraft(device.id, { terminalPort: event.target.value as PostageMeterTerminalPort })} value={draft?.terminalPort ?? '1'}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></td><td>{device.reportStatus === 'enabled' ? '启用' : '报修'}</td><td><button onClick={() => void saveDevice(device)} type="button">保存</button></td></tr> })}{visibleDevices.length === 0 ? <tr><td colSpan={10}>无数据</td></tr> : null}</tbody></table></div></section>
    </>
  )

  return (
    <>
      <div className="mail-handover postage-meter">
        <div className="customer-breadcrumb"><button onClick={onBack} type="button">营业工作台</button><span>/</span><span>邮资机业务</span><span>/</span><strong>{sectionLabels[section]}</strong></div>
        {section === 'batch' ? renderBatchManagement() : null}
        {section === 'registration' ? renderRegistration() : null}
        {section === 'balance' ? renderBalance() : null}
        {section === 'daily' ? renderDaily() : null}
        {section === 'maintenance' ? renderMaintenance() : null}
        {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
        {error && !pickerOpen && !authorizationOpen && !discrepancyBatch ? <p className="customer-form-error" role="alert">{error}</p> : null}
      </div>

      {pickerOpen ? <Modal description={appendBatchId ? '向未过戳批次追加邮件' : '选择已结算协议客户邮件'} eyebrow="过戳批次管理" title="待过戳批次查询"><div className="postage-meter__picker-summary"><span>勾选总件数：<strong>{pendingTransactions.filter((transaction) => selectedTransactionIds.includes(transaction.id)).reduce((total, transaction) => total + transaction.service.quantity, 0)}</strong> 件</span><span>勾选总金额：<strong>{formatCents(pendingTransactions.filter((transaction) => selectedTransactionIds.includes(transaction.id)).reduce((total, transaction) => total + transaction.charge.postageCents, 0))}</strong> 元</span></div><div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table"><thead><tr><th>选择</th><th>序号</th><th>查询流水号</th><th>协议客户名称</th><th>协议客户编号</th><th>应过戳件数</th><th>应过戳总金额</th><th>收寄机构名称</th></tr></thead><tbody>{pendingTransactions.map((transaction, index) => <tr key={transaction.id}><td><input aria-label={`选择待过戳记录 ${transaction.id}`} checked={selectedTransactionIds.includes(transaction.id)} onChange={() => setSelectedTransactionIds((current) => current.includes(transaction.id) ? current.filter((id) => id !== transaction.id) : [...current, transaction.id])} type="checkbox" /></td><td>{index + 1}</td><td>{transaction.id}</td><td>{transaction.customer.sender.agreementAccountName}</td><td>{transaction.customer.sender.agreementAccountId}</td><td>{transaction.service.quantity}</td><td>{formatCents(transaction.charge.postageCents)}</td><td>{transaction.operator.acceptanceOffice}</td></tr>)}</tbody></table></div>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => void saveBatchSelection()} type="button">保存</button><button className="secondary-button" onClick={() => setPickerOpen(false)} type="button">关闭</button></div></Modal> : null}

      {detailBatch ? <Modal description={detailBatch.batchNumber} eyebrow="过戳批次管理" title="过戳批次详情"><div className="postage-meter__picker-summary"><span>应过戳：<strong>{detailBatch.expectedItemCount}</strong> 件</span><span>应过戳金额：<strong>{formatCents(detailBatch.expectedPostageCents)}</strong> 元</span><span>已过戳：<strong>{detailBatch.actualItemCount}</strong> 件</span><span>已过戳金额：<strong>{formatCents(detailBatch.actualPostageCents)}</strong> 元</span></div><div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table"><thead><tr><th>序号</th><th>业务产品</th><th>邮件号码</th><th>协议客户</th><th>件数</th><th>金额</th></tr></thead><tbody>{detailBatch.items.map((item, index) => <tr key={item.transactionId}><td>{index + 1}</td><td>{item.productName}</td><td>{item.itemNumber}</td><td>{item.agreementAccountName}</td><td>{item.quantity}</td><td>{formatCents(item.expectedPostageCents)}</td></tr>)}</tbody></table></div>{detailBatch.discrepancyReason ? <p>差错原因：{detailBatch.discrepancyReason}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => setDetailBatch(null)} type="button">关闭</button></div></Modal> : null}

      {authorizationOpen ? <Modal description="调整邮资机起始数量与起始金额" eyebrow="过戳登记" title="主管授权"><div className="mail-handover__modal-form"><label><span>主管工号</span><input aria-label="邮资机主管工号" onChange={(event) => setSupervisorEmployeeId(event.target.value)} value={supervisorEmployeeId} /></label><label><span>授权密码</span><input aria-label="邮资机主管授权密码" onChange={(event) => setSupervisorSecret(event.target.value)} type="password" value={supervisorSecret} /></label></div>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="primary-button primary-button--compact" onClick={authorizeAdjustment} type="button">确定</button><button className="secondary-button" onClick={() => setAuthorizationOpen(false)} type="button">取消</button></div></Modal> : null}

      {discrepancyBatch ? <Modal description={discrepancyBatch.batchNumber} eyebrow="批次过戳平衡" title="差错登记"><div className="postage-meter__discrepancy-summary"><span>应过戳总件数：<strong>{discrepancyBatch.expectedItemCount}</strong> 件</span><span>应过戳总金额：<strong>{formatCents(discrepancyBatch.expectedPostageCents)}</strong> 元</span><span>已过戳总件数：<strong>{discrepancyBatch.actualItemCount}</strong> 件</span><span>已过戳总金额：<strong>{formatCents(discrepancyBatch.actualPostageCents)}</strong> 元</span><span>总差异件数：<strong>{postageMeterBatchDifference(discrepancyBatch).itemCount}</strong> 件</span><span>总差异金额：<strong>{formatCents(postageMeterBatchDifference(discrepancyBatch).postageCents)}</strong> 元</span></div><label className="postage-meter__reason"><span>差错原因</span><textarea aria-label="邮资机差错原因" onChange={(event) => setDiscrepancyReason(event.target.value)} value={discrepancyReason} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => void saveDiscrepancy()} type="button">保存</button><button className="secondary-button" onClick={() => setDiscrepancyBatch(null)} type="button">关闭</button></div></Modal> : null}

      {dailyPreviewOpen && dailyBalance ? <Modal description={`${dailyBalance.statisticDate} ${operator.acceptanceOffice}`} eyebrow="日终平衡" title="邮资机平衡汇总信息"><div className="postage-meter__print-preview"><h3>邮资机平衡汇总信息</h3><p>邮资机：{workspace.postageMeterDevices.find((device) => device.id === dailyBalance.deviceId)?.name}</p><p>应过戳：{dailyBalance.expectedItemCount} 件 / {formatCents(dailyBalance.expectedPostageCents)} 元</p><p>已过戳：{dailyBalance.actualItemCount} 件 / {formatCents(dailyBalance.actualPostageCents)} 元</p><p>注销：{dailyBalance.cancelledItemCount} 件 / {formatCents(dailyBalance.cancelledPostageCents)} 元</p><p>差异：{dailyBalance.differenceItemCount} 件 / {formatCents(dailyBalance.differencePostageCents)} 元</p></div><div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => { window.print(); setNotice('已调用浏览器打印。') }} type="button">打印</button><button className="secondary-button" onClick={() => setDailyPreviewOpen(false)} type="button">关闭</button></div></Modal> : null}

      {uploadRecordsOpen ? <Modal description="日终平衡上传记录" eyebrow="日终平衡" title="上传记录"><div className="mail-handover__table-wrap"><table className="mail-handover__table postage-meter__table"><thead><tr><th>统计日期</th><th>邮资机</th><th>生成时间</th><th>上传状态</th><th>上传员工</th></tr></thead><tbody>{workspace.postageMeterDailyBalances.map((balance) => <tr key={balance.id}><td>{balance.statisticDate}</td><td>{workspace.postageMeterDevices.find((device) => device.id === balance.deviceId)?.name}</td><td>{new Date(balance.generatedAt).toLocaleString('zh-CN')}</td><td>{balance.uploadedAt ? '已上传' : '未上传'}</td><td>{balance.uploadedBy?.displayName ?? '—'}</td></tr>)}{workspace.postageMeterDailyBalances.length === 0 ? <tr><td colSpan={5}>无数据</td></tr> : null}</tbody></table></div><div className="modal-actions"><button className="secondary-button" onClick={() => setUploadRecordsOpen(false)} type="button">关闭</button></div></Modal> : null}
    </>
  )
}
