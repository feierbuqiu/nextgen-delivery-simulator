import { useEffect, useMemo, useState } from 'react'

import {
  createSelfServiceImportWorkbook,
} from '../../domain/service/selfServiceImport'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import { pendingServiceSummary } from '../../domain/service/transactions'
import type {
  SelfServiceImportBatch,
  SelfServiceReservation,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface SelfServiceBatchImportWorkspaceProps {
  serviceRepository: ServiceRepository
  operator: ServiceOperatorSnapshot
  onBack: () => void
  onSummaryChange: (summary: { count: number; totalCents: number }) => void
}

type DetailView = 'success' | 'processing' | null

function dateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(parsed)
}

function localTimestamp(value = new Date()): string {
  const pad = (part: number, length = 2) => String(part).padStart(length, '0')
  const offsetMinutes = -value.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? '+' : '-'
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60)
  const offsetRemainder = Math.abs(offsetMinutes) % 60
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    `T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}` +
    `.${pad(value.getMilliseconds(), 3)}${offsetSign}${pad(offsetHours)}:${pad(offsetRemainder)}`
}

function downloadWorkbook(source: string, fileName: string): void {
  const blob = new Blob([`\uFEFF${source}`], {
    type: 'application/vnd.ms-excel;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function exportBatch(
  batch: SelfServiceImportBatch,
  view: 'success' | 'processing',
): void {
  downloadWorkbook(
    createSelfServiceImportWorkbook(batch, view),
    `${batch.id}-${view === 'success' ? '成功详情' : '处理详情'}.xls`,
  )
}

export function SelfServiceBatchImportWorkspace({
  serviceRepository,
  operator,
  onBack,
  onSummaryChange,
}: SelfServiceBatchImportWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [activeTab, setActiveTab] = useState<'import' | 'customer'>('import')
  const [queryReservationNumber, setQueryReservationNumber] = useState('')
  const [queryStatus, setQueryStatus] = useState('')
  const [appliedReservationNumber, setAppliedReservationNumber] = useState('')
  const [appliedStatus, setAppliedStatus] = useState('')
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [reservationNumber, setReservationNumber] = useState('')
  const [preview, setPreview] = useState<SelfServiceReservation | null>(null)
  const [detailBatchId, setDetailBatchId] = useState('')
  const [detailView, setDetailView] = useState<DetailView>(null)
  const [settlementBatchId, setSettlementBatchId] = useState('')
  const [settlementConfirm, setSettlementConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void serviceRepository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      onSummaryChange(pendingServiceSummary(loaded))
    })
    return () => {
      active = false
    }
  }, [onSummaryChange, serviceRepository])

  const visibleBatches = useMemo(() => {
    const batches = workspace?.selfServiceImports ?? []
    return batches.filter((batch) => {
      if (
        appliedReservationNumber &&
        !batch.reservationNumber.includes(appliedReservationNumber) &&
        !batch.id.includes(appliedReservationNumber)
      ) return false
      if (appliedStatus === 'processed' && batch.status !== 'processed') return false
      if (appliedStatus === 'settled' && !batch.settlementId) return false
      if (appliedStatus === 'unsettled' && batch.settlementId) return false
      return true
    })
  }, [appliedReservationNumber, appliedStatus, workspace])

  const detailBatch = workspace?.selfServiceImports.find(
    (batch) => batch.id === detailBatchId,
  )
  const settlementBatch = workspace?.selfServiceImports.find(
    (batch) => batch.id === settlementBatchId,
  )
  const currentCustomer = preview
    ? {
        accountId: preview.agreementAccountId,
        accountName: preview.agreementAccountName,
        reservationNumber: preview.reservationNumber,
        count: preview.items.length,
      }
    : workspace?.selfServiceImports.at(-1)
      ? {
          accountId: workspace.selfServiceImports.at(-1)!.agreementAccountId,
          accountName: workspace.selfServiceImports.at(-1)!.agreementAccountName,
          reservationNumber: workspace.selfServiceImports.at(-1)!.reservationNumber,
          count: workspace.selfServiceImports.at(-1)!.totalCount,
        }
      : null

  function openImportDialog(): void {
    setReservationNumber('')
    setPreview(null)
    setError('')
    setMessage('')
    setImportDialogOpen(true)
  }

  async function queryReservation(): Promise<void> {
    setError('')
    setMessage('')
    try {
      const found = await serviceRepository.querySelfServiceReservation(
        reservationNumber,
      )
      setPreview(found)
    } catch (caught) {
      setPreview(null)
      setError(caught instanceof Error ? caught.message : '预约单查询失败。')
    }
  }

  async function importReservation(): Promise<void> {
    if (!preview || submitting) return
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const imported = await serviceRepository.importSelfServiceReservation({
        reservationNumber: preview.reservationNumber,
        importedAt: localTimestamp(),
        operator,
      })
      setWorkspace(imported.state)
      setImportDialogOpen(false)
      setPreview(null)
      setDetailBatchId(imported.batch.id)
      setDetailView('success')
      setMessage(`预约单 ${imported.batch.reservationNumber} 导入完成。`)
      onSummaryChange(pendingServiceSummary(imported.state))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '预约单导入失败。')
    } finally {
      setSubmitting(false)
    }
  }

  async function settleBatch(): Promise<void> {
    if (!settlementBatch || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const settled = await serviceRepository.settleSelfServiceImport(
        settlementBatch.id,
        localTimestamp(),
      )
      setWorkspace(settled.state)
      setSettlementBatchId('')
      setSettlementConfirm(false)
      setMessage(`批次 ${settled.batch.id} 已完成记欠结算。`)
      onSummaryChange(pendingServiceSummary(settled.state))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '记欠结算失败。')
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteBatch(batch: SelfServiceImportBatch): Promise<void> {
    setError('')
    try {
      const next = await serviceRepository.deleteSelfServiceImport(batch.id)
      setWorkspace(next)
      setDetailView(null)
      setDetailBatchId('')
      setMessage(`批次 ${batch.id} 已删除。`)
      onSummaryChange(pendingServiceSummary(next))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '批次删除失败。')
    }
  }

  if (!workspace) {
    return <section className="self-service-loading">正在读取客户自助导入数据…</section>
  }

  return (
    <>
      <section className="self-service-workspace">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">首页</button>
          <span>/</span><span>业务办理</span><span>/</span>
          <strong>客户自助批量导入</strong>
        </div>

        <nav aria-label="客户自助批量导入页签" className="bulk-subtabs">
          <button
            aria-current={activeTab === 'import' ? 'page' : undefined}
            onClick={() => setActiveTab('import')}
            type="button"
          >
            客户自助批量导入
          </button>
          <button
            aria-current={activeTab === 'customer' ? 'page' : undefined}
            onClick={() => setActiveTab('customer')}
            type="button"
          >
            当前客户信息
          </button>
        </nav>

        {activeTab === 'customer' ? (
          <section className="bulk-section self-service-customer-panel">
            <header><span>⌄</span><strong>当前客户信息</strong></header>
            <dl>
              <div><dt>协议客户</dt><dd>{currentCustomer?.accountName ?? '—'}</dd></div>
              <div><dt>客户编号</dt><dd>{currentCustomer?.accountId ?? '—'}</dd></div>
              <div><dt>预约单号</dt><dd>{currentCustomer?.reservationNumber ?? '—'}</dd></div>
              <div><dt>总记录数</dt><dd>{currentCustomer?.count ?? 0}</dd></div>
            </dl>
          </section>
        ) : (
          <section className="bulk-section self-service-main-panel">
            <header><span>⌄</span><strong>批量导入查询</strong></header>
            <div className="self-service-query-row">
              <label>
                <span>预约单号</span>
                <input
                  aria-label="查询预约单号"
                  inputMode="numeric"
                  maxLength={17}
                  onChange={(event) => setQueryReservationNumber(event.target.value)}
                  value={queryReservationNumber}
                />
              </label>
              <label>
                <span>处理标志</span>
                <select
                  aria-label="查询处理标志"
                  onChange={(event) => setQueryStatus(event.target.value)}
                  value={queryStatus}
                >
                  <option value="">请选择</option>
                  <option value="processed">已处理</option>
                  <option value="unsettled">未结算</option>
                  <option value="settled">已结算</option>
                </select>
              </label>
              <button
                className="bulk-blue-button"
                onClick={() => {
                  setAppliedReservationNumber(queryReservationNumber.trim())
                  setAppliedStatus(queryStatus)
                }}
                type="button"
              >
                查询
              </button>
              <button className="bulk-green-button" onClick={openImportDialog} type="button">
                导入
              </button>
            </div>

            <div className="bulk-table-wrap">
              <table className="bulk-table self-service-batch-table">
                <thead>
                  <tr>
                    <th>序号</th><th>处理标志</th><th>协议客户</th>
                    <th>查询流水号</th><th>订单号</th><th>总记录数</th>
                    <th>导入时间</th><th>导入员工</th><th>导入机构</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBatches.map((batch, index) => (
                    <tr key={batch.id}>
                      <td>{index + 1}</td>
                      <td>{batch.status === 'processed' ? '已处理' : '处理中'}</td>
                      <td>{batch.agreementAccountName}</td>
                      <td>{batch.id}</td>
                      <td>{batch.reservationNumber}</td>
                      <td>{batch.totalCount}</td>
                      <td>{dateTime(batch.importedAt)}</td>
                      <td>{batch.operator.displayName}</td>
                      <td>{batch.importOfficeName}</td>
                      <td className="bulk-actions">
                        <button onClick={() => {
                          setDetailBatchId(batch.id)
                          setDetailView('success')
                        }} type="button">成功详情</button>
                        <button onClick={() => {
                          setDetailBatchId(batch.id)
                          setDetailView('processing')
                        }} type="button">处理详情</button>
                      </td>
                    </tr>
                  ))}
                  {visibleBatches.length === 0 ? (
                    <tr><td className="home-empty-cell" colSpan={10}>无数据</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <footer className="home-pagination">
              <button disabled type="button">‹</button>
              <button aria-current="page" type="button">1</button>
              <button disabled type="button">›</button>
              <span>共 {visibleBatches.length} 条</span>
              <select aria-label="客户自助导入每页条数" defaultValue="20">
                <option value="20">20条/页</option>
              </select>
            </footer>
          </section>
        )}

        {message ? <p className="bulk-message" role="status">{message}</p> : null}
        {error && !importDialogOpen ? <p className="bulk-error" role="alert">{error}</p> : null}
      </section>

      {importDialogOpen ? (
        <Modal eyebrow="客户自助批量导入" title="批量导入" wide>
          <div className="self-service-import-dialog">
            <div className="self-service-dialog-query">
              <label>
                <span><b>*</b> 预约单号</span>
                <input
                  aria-label="导入预约单号"
                  autoFocus
                  inputMode="numeric"
                  maxLength={17}
                  onChange={(event) => {
                    setReservationNumber(event.target.value)
                    setPreview(null)
                    setError('')
                  }}
                  value={reservationNumber}
                />
              </label>
              <button className="bulk-blue-button" onClick={() => void queryReservation()} type="button">
                查询
              </button>
              <button
                className="bulk-green-button"
                disabled={!preview || submitting}
                onClick={() => void importReservation()}
                type="button"
              >
                导入
              </button>
            </div>
            <div className="bulk-table-wrap self-service-preview-wrap">
              <table className="bulk-table self-service-preview-table">
                <thead>
                  <tr>
                    <th>序号</th><th>大客户编号</th><th>协议客户</th>
                    <th>业务产品</th><th>邮件号码</th><th>订单号</th>
                    <th>寄达省份</th><th>寄达市</th><th>寄达区县</th>
                    <th>寄达局邮编</th><th>寄达局名称</th><th>收件人</th>
                    <th>收件地址</th><th>收件电话</th><th>寄件人</th>
                    <th>寄件地址</th><th>寄件电话</th><th>重量（克）</th>
                  </tr>
                </thead>
                <tbody>
                  {preview?.items.map((item, index) => (
                    <tr key={item.orderNumber}>
                      <td>{index + 1}</td>
                      <td>{preview.agreementAccountId}</td>
                      <td>{preview.agreementAccountName}</td>
                      <td>普通包裹（300）</td>
                      <td>{item.itemCode}</td><td>{item.orderNumber}</td>
                      <td>{item.destinationProvince}</td><td>{item.destinationCity}</td>
                      <td>{item.destinationCounty}</td><td>{item.destinationPostcode}</td>
                      <td>{item.destinationOfficeName}</td><td>{item.recipientName}</td>
                      <td>{item.recipientAddress}</td><td>{item.recipientPhone}</td>
                      <td>{item.senderName}</td><td>{item.senderAddress}</td>
                      <td>{item.senderPhone}</td><td>{item.weightGrams}</td>
                    </tr>
                  ))}
                  {!preview ? <tr><td className="home-empty-cell" colSpan={18}>无数据</td></tr> : null}
                </tbody>
              </table>
            </div>
            {error ? <p className="bulk-error" role="alert">{error}</p> : null}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => {
                setImportDialogOpen(false)
                setPreview(null)
                setError('')
              }} type="button">取消</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {detailView && detailBatch ? (
        <Modal
          eyebrow="客户自助批量导入"
          title={detailView === 'success' ? '邮件详情列表' : '导入处理提示'}
          wide
        >
          {detailView === 'success' ? (
            <div className="bulk-detail-modal">
              <div className="bulk-progress">
                <span style={{ width: `${detailBatch.progressPercent}%` }} />
                <strong>{detailBatch.progressPercent}%</strong>
              </div>
              <p>100%时可重新进入查看邮件</p>
              <div className="bulk-table-wrap">
                <table className="bulk-table self-service-detail-table">
                  <thead><tr>
                    <th>序号</th><th>订单号</th><th>邮件号码</th><th>机构编号</th>
                    <th>寄达局</th><th>收件人</th><th>收件地址</th><th>总资费</th>
                    <th>更新日期</th><th>创建日期</th>
                  </tr></thead>
                  <tbody>
                    {detailBatch.rows.filter((row) => row.status === 'success').map((row, index) => (
                      <tr key={row.orderNumber}>
                        <td>{index + 1}</td><td>{row.orderNumber}</td><td>{row.itemCode}</td>
                        <td>{detailBatch.importOfficeCode}</td><td>{row.destinationOfficeName}</td>
                        <td>{row.recipientName}</td><td>{row.recipientAddress}</td>
                        <td>{formatCents(row.postageCents)}</td><td>{dateTime(row.updatedAt)}</td>
                        <td>{dateTime(detailBatch.importedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-actions">
                <button className="bulk-blue-button" onClick={() => exportBatch(detailBatch, 'success')} type="button">导出</button>
                <button className="secondary-button" onClick={() => setDetailView(null)} type="button">取消</button>
              </div>
            </div>
          ) : (
            <div className="bulk-detail-modal">
              <div className="bulk-metrics">
                <span>查询流水号：<b>{detailBatch.id}</b></span>
                <span>处理总数：<b>{detailBatch.totalCount}</b></span>
                <span>处理成功：<b>{detailBatch.successCount}</b></span>
                <span>处理失败：<b>{detailBatch.failedCount}</b></span>
                <span>处理成功总金额：<b>{formatCents(detailBatch.totalSuccessfulAmountCents)}</b></span>
              </div>
              <div className="bulk-table-wrap">
                <table className="bulk-table self-service-failure-table">
                  <thead><tr>
                    <th>序号</th><th>订单号</th><th>邮件号码</th><th>省份代码</th>
                    <th>机构编号</th><th>异常原因</th><th>更新日期</th>
                  </tr></thead>
                  <tbody>
                    {detailBatch.rows.filter((row) => row.status === 'failed').map((row, index) => (
                      <tr key={row.orderNumber}>
                        <td>{index + 1}</td><td>{row.orderNumber}</td><td>{row.itemCode}</td>
                        <td>{row.destinationProvince}</td><td>{detailBatch.importOfficeCode}</td>
                        <td>{row.failureReason}</td><td>{dateTime(row.updatedAt)}</td>
                      </tr>
                    ))}
                    {detailBatch.failedCount === 0 ? (
                      <tr><td className="home-empty-cell" colSpan={7}>无数据</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="modal-actions self-service-processing-actions">
                {!detailBatch.settlementId ? (
                  <button className="danger-button" onClick={() => {
                    setSettlementBatchId(detailBatch.id)
                    setSettlementConfirm(false)
                    setDetailView(null)
                  }} type="button">结算中心</button>
                ) : null}
                {!detailBatch.settlementId ? (
                  <button className="self-service-delete-button" onClick={() => void deleteBatch(detailBatch)} type="button">删除</button>
                ) : null}
                <button className="bulk-blue-button" onClick={() => exportBatch(detailBatch, 'processing')} type="button">导出</button>
                <button className="secondary-button" onClick={() => setDetailView(null)} type="button">关闭</button>
              </div>
            </div>
          )}
        </Modal>
      ) : null}

      {settlementBatch ? (
        <Modal eyebrow="结算处理" title="结算中心" wide>
          <div className="self-service-settlement">
            <dl>
              <div><dt>查询流水号</dt><dd>{settlementBatch.id}</dd></div>
              <div><dt>付费方式</dt><dd>记欠</dd></div>
              <div><dt>总件数</dt><dd>{settlementBatch.successCount}</dd></div>
              <div><dt>总金额</dt><dd>¥ {formatCents(settlementBatch.totalSuccessfulAmountCents)}</dd></div>
              <div><dt>当前现结金额</dt><dd>¥ 0.00</dd></div>
              <div><dt>记欠金额</dt><dd>¥ {formatCents(settlementBatch.totalSuccessfulAmountCents)}</dd></div>
            </dl>
            {settlementConfirm ? (
              <p className="self-service-settlement-confirm" role="alertdialog">
                无现结金额，是否直接结算？
              </p>
            ) : null}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => {
                setSettlementBatchId('')
                setSettlementConfirm(false)
              }} type="button">取消</button>
              {settlementConfirm ? (
                <button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void settleBatch()} type="button">确定</button>
              ) : (
                <button className="primary-button primary-button--compact" onClick={() => setSettlementConfirm(true)} type="button">结算</button>
              )}
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
