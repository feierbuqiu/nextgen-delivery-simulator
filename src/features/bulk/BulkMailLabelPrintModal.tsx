import { useMemo, useState } from 'react'

import { formatCents, paymentMethodLabel } from '../../domain/service/policy'
import type { BulkBatch } from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface BulkMailLabelPrintModalProps {
  batch: BulkBatch
  onClose: () => void
  onComplete: (
    fromSequence: number,
    toSequence: number,
    detailSheet: boolean,
  ) => Promise<void>
}

function printLabels(): void {
  document.body.classList.add('bulk-labels-printing')
  try {
    window.print()
  } finally {
    document.body.classList.remove('bulk-labels-printing')
  }
}

export function BulkMailLabelPrintModal({
  batch,
  onClose,
  onComplete,
}: BulkMailLabelPrintModalProps) {
  const [fromSequence, setFromSequence] = useState('1')
  const [toSequence, setToSequence] = useState(String(batch.successCount))
  const [detailSheet, setDetailSheet] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const successfulRows = useMemo(
    () => batch.rows.filter((row) => row.status === 'success'),
    [batch.rows],
  )
  const from = Number(fromSequence)
  const to = Number(toSequence)
  const validRange = Number.isInteger(from) && Number.isInteger(to) &&
    from >= 1 && to >= from && to <= successfulRows.length
  const previewRows = validRange ? successfulRows.slice(from - 1, to) : []

  function resetRange(): void {
    setFromSequence('1')
    setToSequence(String(batch.successCount))
    setError('')
  }

  async function handlePrint(): Promise<void> {
    if (!validRange) {
      setError(`打印范围须为 1 至 ${batch.successCount} 的连续序号。`)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      printLabels()
      await onComplete(from, to, detailSheet)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '面单打印记录失败。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      description={`批次 ${batch.id} 共 ${batch.successCount} 件，可全部或按连续序号打印。`}
      eyebrow="大宗导入"
      title="打印导入邮件面单"
      wide
    >
      <div className="modal-form bulk-label-modal">
        <div className="bulk-print-range">
          <label><span>起止</span><input aria-label="面单打印起始序号" min="1" onChange={(event) => { setFromSequence(event.target.value); setError('') }} type="number" value={fromSequence} /></label>
          <span>～</span>
          <label><span className="visually-hidden">终止</span><input aria-label="面单打印终止序号" min="1" onChange={(event) => { setToSequence(event.target.value); setError('') }} type="number" value={toSequence} /></label>
        </div>
        {batch.product.searchCode === '303' ? (
          <label className="bulk-label-detail-choice">
            <input checked={detailSheet} onChange={(event) => setDetailSheet(event.target.checked)} type="checkbox" />
            <span>同时打印国内快包详情单</span>
          </label>
        ) : null}

        <div aria-label="大宗邮件面单预览" className="bulk-label-sheets">
          {previewRows.map((row) => (
            <article className="bulk-mail-label" key={row.recordSequence}>
              <header><strong>{batch.product.label}</strong><span>{row.allocatedItemCode || '无条码邮件'}</span></header>
              <dl>
                <div><dt>收件人</dt><dd>{row.recipientName || '—'} / {row.recipientPhone}</dd></div>
                <div><dt>收件地址</dt><dd>{row.recipientAddress}</dd></div>
                <div><dt>寄达局</dt><dd>{row.destinationOfficeName === '.' ? '系统匹配' : row.destinationOfficeName}</dd></div>
                <div><dt>寄件人</dt><dd>{batch.sender.name} / {batch.sender.contact}</dd></div>
                <div><dt>重量/资费</dt><dd>{row.resolvedWeightGrams ?? 0} 克 / {formatCents(row.postageCents)} 元</dd></div>
                <div><dt>付费/备注</dt><dd>{paymentMethodLabel(batch.paymentMethod)} / {row.mailRemark || '无'}</dd></div>
              </dl>
              <footer><span>{batch.agreementAccountName}</span><span>{batch.id} / {row.recordSequence}</span></footer>
            </article>
          ))}
          {detailSheet && validRange ? (
            <article aria-label="国内快包详情单" className="bulk-mail-label bulk-mail-label--detail">
              <header><strong>国内快包详情单</strong><span>{batch.id}</span></header>
              <p>本页对应序号 {from}～{to}，共 {previewRows.length} 件；由当前登录营业员人工确认打印。</p>
            </article>
          ) : null}
        </div>

        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" disabled={submitting} onClick={onClose} type="button">取消</button>
          <button className="secondary-button" disabled={submitting} onClick={resetRange} type="button">重置</button>
          <button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void handlePrint()} type="button">{submitting ? '正在记录…' : '确定打印'}</button>
        </div>
      </div>
    </Modal>
  )
}
