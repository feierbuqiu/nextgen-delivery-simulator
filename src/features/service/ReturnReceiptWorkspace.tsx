import { useEffect, useMemo, useState } from 'react'

import {
  destinationZoneLabel,
  formatCents,
} from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import {
  returnReceiptStatusLabel,
} from '../../domain/service/returnReceipt'
import type {
  ReturnReceiptRecord,
  ServiceOperatorSnapshot,
  ServiceTransaction,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface ReturnReceiptWorkspaceProps {
  onBack: () => void
  operator: ServiceOperatorSnapshot
  repository: ServiceRepository
}

interface ReceiptRow {
  receipt: ReturnReceiptRecord
  transaction: ServiceTransaction
}

function localDateTimeValue(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function persistedTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error('请输入有效的回执时间。')
  return parsed.toISOString()
}

function displayDateTime(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16).replace('T', ' ')
  return localDateTimeValue(parsed).replace('T', ' ')
}

function displayOperator(operator: ServiceOperatorSnapshot | null): string {
  if (!operator) return '—'
  return `${operator.displayName}（${operator.operatorId} / 台席 ${operator.workstationCode}）`
}

function includesQuery(row: ReceiptRow, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalized) return true
  return [
    row.receipt.id,
    row.receipt.originalItemCode,
    row.receipt.returnItemCode,
    row.transaction.id,
    row.transaction.product.label,
    row.transaction.customer.sender.name,
    row.transaction.customer.sender.contact,
    row.transaction.customer.recipient.name,
  ].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalized))
}

export function ReturnReceiptWorkspace({
  onBack,
  operator,
  repository,
}: ReturnReceiptWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ReturnReceiptRecord['status'] | 'all'>('all')
  const [arrivalReceipt, setArrivalReceipt] = useState<ReturnReceiptRecord | null>(null)
  const [dispatchReceipt, setDispatchReceipt] = useState<ReturnReceiptRecord | null>(null)
  const [detailRow, setDetailRow] = useState<ReceiptRow | null>(null)
  const [recipientSigner, setRecipientSigner] = useState('')
  const [deliveredAt, setDeliveredAt] = useState(localDateTimeValue)
  const [receivedAt, setReceivedAt] = useState(localDateTimeValue)
  const [returnItemCode, setReturnItemCode] = useState('')
  const [returnedAt, setReturnedAt] = useState(localDateTimeValue)
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (active) setWorkspace(loaded)
    })
    return () => {
      active = false
    }
  }, [repository])

  const rows = useMemo(() => {
    if (!workspace) return []
    const transactions = new Map(
      workspace.transactions.map((transaction) => [transaction.id, transaction]),
    )
    return workspace.returnReceipts
      .map((receipt): ReceiptRow | null => {
        const transaction = transactions.get(receipt.transactionId)
        return transaction ? { receipt, transaction } : null
      })
      .filter((row): row is ReceiptRow => Boolean(row))
      .filter((row) => status === 'all' || row.receipt.status === status)
      .filter((row) => includesQuery(row, query))
      .sort((left, right) => right.receipt.requestedAt.localeCompare(left.receipt.requestedAt))
  }, [query, status, workspace])

  const totals = useMemo(() => {
    const receipts = workspace?.returnReceipts ?? []
    return {
      awaiting: receipts.filter((item) => item.status === 'awaiting-return').length,
      received: receipts.filter((item) => item.status === 'received').length,
      returned: receipts.filter((item) => item.status === 'returned').length,
    }
  }, [workspace])

  function openArrival(receipt: ReturnReceiptRecord): void {
    const now = localDateTimeValue()
    setArrivalReceipt(receipt)
    setRecipientSigner('')
    setDeliveredAt(now)
    setReceivedAt(now)
    setNote('')
    setError('')
    setNotice('')
  }

  function openDispatch(receipt: ReturnReceiptRecord): void {
    setDispatchReceipt(receipt)
    setReturnItemCode('')
    setReturnedAt(localDateTimeValue())
    setError('')
    setNotice('')
  }

  async function recordArrival(): Promise<void> {
    if (!arrivalReceipt || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await repository.recordReturnReceiptArrival({
        receiptId: arrivalReceipt.id,
        recipientSigner,
        deliveredAt: persistedTimestamp(deliveredAt),
        receivedAt: persistedTimestamp(receivedAt),
        operator,
        note,
      })
      setWorkspace(result.state)
      setArrivalReceipt(null)
      setNotice(`回执 ${result.receipt.id} 已登记收到，可以继续办理寄回。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '回执收到登记失败。')
    } finally {
      setSubmitting(false)
    }
  }

  async function dispatch(): Promise<void> {
    if (!dispatchReceipt || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await repository.dispatchReturnReceipt({
        receiptId: dispatchReceipt.id,
        returnItemCode,
        returnedAt: persistedTimestamp(returnedAt),
        operator,
      })
      setWorkspace(result.state)
      setDispatchReceipt(null)
      setNotice(`回执 ${result.receipt.id} 已按 ${result.receipt.returnItemCode} 寄回。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '回执寄回办理失败。')
    } finally {
      setSubmitting(false)
    }
  }

  if (!workspace) {
    return (
      <section className="settlement-workspace settlement-workspace--loading">
        正在读取回执记录…
      </section>
    )
  }

  return (
    <>
      <div className="settlement-workspace return-receipt-workspace">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业渠道</button>
          <span>/</span>
          <strong>回执寄回办理</strong>
        </div>

        <section className="settlement-heading return-receipt-heading">
          <div>
            <p className="eyebrow">给据邮件附加业务</p>
            <h1>回执寄回办理</h1>
            <p>按原邮件号码查询，依次完成回执收到登记和挂号寄回登记。</p>
          </div>
          <div className="return-receipt-totals" aria-label="回执状态统计">
            <div><span>待回执</span><strong>{totals.awaiting}</strong></div>
            <div><span>待寄回</span><strong>{totals.received}</strong></div>
            <div><span>已寄回</span><strong>{totals.returned}</strong></div>
          </div>
        </section>

        <section className="settlement-panel">
          <div className="return-receipt-filters">
            <label>
              <span>查询条件</span>
              <input
                aria-label="查询回执"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="原邮件号码、回执编号、寄回号码或寄件人"
                value={query}
              />
            </label>
            <label>
              <span>回执状态</span>
              <select
                aria-label="回执状态"
                onChange={(event) => setStatus(
                  event.target.value as ReturnReceiptRecord['status'] | 'all',
                )}
                value={status}
              >
                <option value="all">全部</option>
                <option value="awaiting-return">待回执</option>
                <option value="received">已收到待寄回</option>
                <option value="returned">已寄回</option>
                <option value="cancelled">已取消</option>
              </select>
            </label>
          </div>

          {notice ? <p className="customer-notice" role="status">{notice}</p> : null}

          <div className="settlement-table-wrap">
            <table className="settlement-table return-receipt-table">
              <thead>
                <tr>
                  <th>回执编号</th>
                  <th>原邮件号码</th>
                  <th>业务产品 / 区域</th>
                  <th>寄件人 / 回执签收人</th>
                  <th>回执费</th>
                  <th>办理时间</th>
                  <th>寄回邮件号码</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ receipt, transaction }) => (
                  <tr key={receipt.id}>
                    <td>{receipt.id}</td>
                    <td><strong>{receipt.originalItemCode}</strong><small>{transaction.id}</small></td>
                    <td>{transaction.product.label}<small>{destinationZoneLabel(transaction.service.destinationZone)}</small></td>
                    <td>
                      {transaction.customer.sender.name || '—'}
                      <small>{receipt.recipientSigner ? `签收：${receipt.recipientSigner}` : `收件：${transaction.customer.recipient.name || '—'}`}</small>
                    </td>
                    <td>¥ {formatCents(receipt.feeCents)}</td>
                    <td>{displayDateTime(receipt.requestedAt)}<small>{receipt.receivedAt ? `收到 ${displayDateTime(receipt.receivedAt)}` : '尚未收到'}</small></td>
                    <td>{receipt.returnItemCode || '—'}</td>
                    <td>
                      <span className={`return-receipt-status return-receipt-status--${receipt.status}`}>
                        {returnReceiptStatusLabel(receipt.status)}
                      </span>
                    </td>
                    <td>
                      <div className="return-receipt-row-actions">
                        <button
                          aria-label={`查看回执 ${receipt.id} 详情`}
                          className="table-action"
                          onClick={() => setDetailRow({ receipt, transaction })}
                          type="button"
                        >
                          详情
                        </button>
                        {receipt.status === 'awaiting-return' ? (
                          <button
                            className="table-action"
                            disabled={transaction.status !== 'settled'}
                            onClick={() => openArrival(receipt)}
                            title={transaction.status === 'settled' ? '' : '原邮件结算后方可登记'}
                            type="button"
                          >
                            {transaction.status === 'settled' ? '回执收到' : '待原件结算'}
                          </button>
                        ) : receipt.status === 'received' ? (
                          <button className="table-action" onClick={() => openDispatch(receipt)} type="button">
                            办理寄回
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr><td className="settlement-empty" colSpan={9}>没有符合条件的回执记录。</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {arrivalReceipt ? (
        <Modal
          description={`原邮件号码：${arrivalReceipt.originalItemCode}`}
          eyebrow="回执寄回办理"
          title="回执收到登记"
        >
          <div className="modal-form return-receipt-modal-form">
            <label><span>回执签收人 *</span><input aria-label="回执签收人" maxLength={40} onChange={(event) => setRecipientSigner(event.target.value)} value={recipientSigner} /></label>
            <label><span>邮件妥投日期 *</span><input aria-label="邮件妥投日期" onChange={(event) => setDeliveredAt(event.target.value)} type="datetime-local" value={deliveredAt} /></label>
            <label><span>回执收到日期 *</span><input aria-label="回执收到日期" onChange={(event) => setReceivedAt(event.target.value)} type="datetime-local" value={receivedAt} /></label>
            <label><span>备注</span><textarea aria-label="回执备注" maxLength={80} onChange={(event) => setNote(event.target.value)} value={note} /></label>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => { setArrivalReceipt(null); setError('') }} type="button">取消</button>
              <button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void recordArrival()} type="button">确认收到</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {detailRow ? (
        <Modal
          description={`原邮件号码：${detailRow.receipt.originalItemCode}`}
          eyebrow="回执寄回办理"
          title="回执流程详情"
          wide
        >
          <div className="modal-form return-receipt-modal-form">
            <dl className="return-receipt-detail">
              <div><dt>回执编号</dt><dd>{detailRow.receipt.id}</dd></div>
              <div><dt>当前状态</dt><dd>{returnReceiptStatusLabel(detailRow.receipt.status)}</dd></div>
              <div><dt>收寄流水</dt><dd>{detailRow.transaction.id}</dd></div>
              <div><dt>原邮件号码</dt><dd>{detailRow.receipt.originalItemCode}</dd></div>
              <div><dt>业务产品</dt><dd>{detailRow.transaction.product.label}（{detailRow.transaction.product.searchCode}）</dd></div>
              <div><dt>区域</dt><dd>{destinationZoneLabel(detailRow.transaction.service.destinationZone)}</dd></div>
              <div><dt>办理回执时间</dt><dd>{displayDateTime(detailRow.receipt.requestedAt)}</dd></div>
              <div><dt>回执费</dt><dd>¥ {formatCents(detailRow.receipt.feeCents)}</dd></div>
              <div><dt>回执签收人</dt><dd>{detailRow.receipt.recipientSigner || '—'}</dd></div>
              <div><dt>邮件妥投时间</dt><dd>{displayDateTime(detailRow.receipt.deliveredAt)}</dd></div>
              <div><dt>回执收到时间</dt><dd>{displayDateTime(detailRow.receipt.receivedAt)}</dd></div>
              <div><dt>收到登记人</dt><dd>{displayOperator(detailRow.receipt.receivedBy)}</dd></div>
              <div><dt>寄回邮件号码</dt><dd>{detailRow.receipt.returnItemCode || '—'}</dd></div>
              <div><dt>回执寄回时间</dt><dd>{displayDateTime(detailRow.receipt.returnedAt)}</dd></div>
              <div><dt>寄回登记人</dt><dd>{displayOperator(detailRow.receipt.returnedBy)}</dd></div>
              <div><dt>备注</dt><dd>{detailRow.receipt.note || '—'}</dd></div>
            </dl>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setDetailRow(null)} type="button">关闭</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {dispatchReceipt ? (
        <Modal
          description={`原邮件号码：${dispatchReceipt.originalItemCode}；签收人：${dispatchReceipt.recipientSigner}`}
          eyebrow="回执寄回办理"
          title="回执挂号寄回"
        >
          <div className="modal-form return-receipt-modal-form">
            <label><span>寄回邮件号码 *</span><input aria-label="回执寄回邮件号码" maxLength={13} onChange={(event) => setReturnItemCode(event.target.value.toUpperCase())} placeholder="国内 2 位字母 + 11 位数字；国际使用 R 类 S10" value={returnItemCode} /></label>
            <label><span>回执寄回日期 *</span><input aria-label="回执寄回日期" onChange={(event) => setReturnedAt(event.target.value)} type="datetime-local" value={returnedAt} /></label>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => { setDispatchReceipt(null); setError('') }} type="button">取消</button>
              <button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void dispatch()} type="button">确认寄回</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
