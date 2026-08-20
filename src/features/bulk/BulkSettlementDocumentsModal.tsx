import { useMemo, useState } from 'react'

import { formatCents, paymentMethodLabel } from '../../domain/service/policy'
import type {
  BulkBatch,
  BulkDocumentKind,
  BulkProcessedRow,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface BulkSettlementDocumentsModalProps {
  batch: BulkBatch
  mode: 'settlement' | 'reprint'
  onComplete: (documentKinds: BulkDocumentKind[]) => Promise<void>
  onClose: () => void
}

interface SummaryLine {
  key: string
  label: string
  count: number
  weightGrams: number
  unitPostageCents: number | null
  totalPostageCents: number
}

const upperDigits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const upperUnits = ['', '拾', '佰', '仟']
const upperSections = ['', '万', '亿', '兆']

function sectionToUppercase(section: number): string {
  let value = section
  let result = ''
  let unitPosition = 0
  let pendingZero = false
  while (value > 0) {
    const digit = value % 10
    if (digit === 0) {
      if (result && !pendingZero) pendingZero = true
    } else {
      result = `${upperDigits[digit]}${upperUnits[unitPosition]}${pendingZero ? '零' : ''}${result}`
      pendingZero = false
    }
    unitPosition += 1
    value = Math.floor(value / 10)
  }
  return result
}

function integerToUppercase(value: number): string {
  if (value === 0) return '零'
  let remaining = value
  let sectionPosition = 0
  let result = ''
  let needsZero = false
  while (remaining > 0) {
    const section = remaining % 10000
    if (section === 0) {
      if (result) needsZero = true
    } else {
      const prefix = needsZero || (section < 1000 && remaining >= 10000) ? '零' : ''
      result = `${sectionToUppercase(section)}${upperSections[sectionPosition]}${prefix}${result}`
      needsZero = section < 1000
    }
    remaining = Math.floor(remaining / 10000)
    sectionPosition += 1
  }
  return result.replace(/零+/g, '零').replace(/零$/u, '')
}

function uppercaseCurrency(cents: number): string {
  const safeCents = Math.max(0, Math.round(cents))
  const yuan = Math.floor(safeCents / 100)
  const jiao = Math.floor((safeCents % 100) / 10)
  const fen = safeCents % 10
  const fraction = `${jiao ? `${upperDigits[jiao]}角` : ''}${fen ? `${upperDigits[fen]}分` : ''}`
  return `${integerToUppercase(yuan)}元${fraction || '整'}`
}

function documentTimestamp(value: string | null): string {
  return (value ?? '').slice(0, 19).replace('T', ' ') || '—'
}

function summaryLines(batch: BulkBatch, rows: BulkProcessedRow[]): SummaryLine[] {
  const grouped = new Map<string, SummaryLine>()
  for (const row of rows) {
    const key = `${row.effectiveBusinessCode}:${row.mailRemark}`
    const current = grouped.get(key)
    const label = row.mailRemark && row.mailRemark !== '无'
      ? `${batch.product.label}（${row.mailRemark}）`
      : batch.product.label
    if (!current) {
      grouped.set(key, {
        key,
        label,
        count: 1,
        weightGrams: row.resolvedWeightGrams ?? 0,
        unitPostageCents: row.postageCents,
        totalPostageCents: row.postageCents,
      })
      continue
    }
    current.count += 1
    current.weightGrams += row.resolvedWeightGrams ?? 0
    current.totalPostageCents += row.postageCents
    if (current.unitPostageCents !== row.postageCents) current.unitPostageCents = null
  }
  return [...grouped.values()]
}

function printDocuments(): void {
  document.body.classList.add('bulk-documents-printing')
  try {
    window.print()
  } finally {
    document.body.classList.remove('bulk-documents-printing')
  }
}

export function BulkSettlementDocumentsModal({
  batch,
  mode,
  onComplete,
  onClose,
}: BulkSettlementDocumentsModalProps) {
  const [selectedKinds, setSelectedKinds] = useState<BulkDocumentKind[]>([
    'bulk-mailing-list',
    'consolidated-posting-summary',
  ])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const rows = useMemo(
    () => batch.rows.filter((row) => row.status === 'success'),
    [batch.rows],
  )
  const summaries = useMemo(() => summaryLines(batch, rows), [batch, rows])
  const totalWeightGrams = rows.reduce(
    (total, row) => total + (row.resolvedWeightGrams ?? 0),
    0,
  )

  function toggleKind(kind: BulkDocumentKind): void {
    setSelectedKinds((current) => current.includes(kind)
      ? current.filter((item) => item !== kind)
      : [...current, kind])
    setError('')
  }

  async function handlePrint(): Promise<void> {
    if (selectedKinds.length === 0) {
      setError('请至少选择一种大宗单据。')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      printDocuments()
      await onComplete(selectedKinds)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '大宗单据打印记录失败。')
    } finally {
      setSubmitting(false)
    }
  }

  async function skipPrint(): Promise<void> {
    setSubmitting(true)
    setError('')
    try {
      await onComplete([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '大宗单据选择记录失败。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      description={`批次 ${batch.id} 共 ${batch.successCount} 件，已达到 ${batch.bulkThreshold} 件大宗标准。`}
      eyebrow={mode === 'settlement' ? '结算完成' : '大宗单据补打'}
      title={mode === 'settlement' ? '请选择需要打印的大宗单据' : '大宗单据打印'}
      wide
    >
      <div className="modal-form bulk-document-modal">
        <div className="bulk-document-options" aria-label="大宗单据类型">
          <label>
            <input
              checked={selectedKinds.includes('bulk-mailing-list')}
              onChange={() => toggleKind('bulk-mailing-list')}
              type="checkbox"
            />
            <span><strong>大宗邮件交寄清单</strong><small>逐件列出邮件号码、寄达局、重量、资费和收件人。</small></span>
          </label>
          <label>
            <input
              checked={selectedKinds.includes('consolidated-posting-summary')}
              onChange={() => toggleKind('consolidated-posting-summary')}
              type="checkbox"
            />
            <span><strong>整付零寄交寄汇总清单</strong><small>按邮件种类汇总件数、重量和邮费。</small></span>
          </label>
        </div>

        <dl className="bulk-document-totals">
          <div><dt>本批件数</dt><dd>{batch.successCount}</dd></div>
          <div><dt>总资费</dt><dd>{formatCents(batch.totalPostageCents)} 元</dd></div>
          <div><dt>权益数量</dt><dd>{batch.couponCount}</dd></div>
          <div><dt>优惠金额</dt><dd>{formatCents(batch.couponDiscountCents)} 元</dd></div>
        </dl>

        <div className="bulk-print-documents">
          {selectedKinds.includes('bulk-mailing-list') ? (
            <article aria-label="大宗邮件交寄清单" className="bulk-paper bulk-paper--mailing-list">
              <header><p>整付零寄交寄清单</p><h3>大宗邮件交寄清单</h3></header>
              <div className="bulk-paper__meta">
                <span>大宗用户编号：{batch.agreementAccountId}</span>
                <span>用户名称：{batch.agreementAccountName}</span>
                <span>单位地址：{batch.sender.detailedAddress}</span>
              </div>
              <table>
                <thead><tr><th>业务产品名称</th><th>邮件号码</th><th>寄达局名称</th><th>件数</th><th>重量</th><th>总资费(元)</th><th>收件人</th><th>备注</th><th>付费方式</th></tr></thead>
                <tbody>{rows.map((row) => (
                  <tr key={row.recordSequence}>
                    <td>{batch.product.label}</td><td>{row.allocatedItemCode || '—'}</td><td>{row.destinationOfficeName}</td><td>1</td><td>{row.resolvedWeightGrams ?? 0}</td><td>{formatCents(row.postageCents)}</td><td>{row.recipientName || '—'}</td><td>{row.mailRemark || '—'}</td><td>{paymentMethodLabel(batch.paymentMethod)}</td>
                  </tr>
                ))}</tbody>
              </table>
              <div className="bulk-paper__summary">
                <span>本页小计：{rows.length}件</span><span>总计：{batch.successCount}件</span><span>总资费：{formatCents(batch.totalPostageCents)}元</span><strong>权益数量：{batch.couponCount}</strong><strong>优惠金额：{formatCents(batch.couponDiscountCents)}元</strong>
              </div>
              <footer><span>营业员：{batch.operator.operatorId}</span><span>台席：{batch.operator.workstationCode}</span><span>交寄时间：{documentTimestamp(batch.settledAt)}</span></footer>
            </article>
          ) : null}

          {selectedKinds.includes('consolidated-posting-summary') ? (
            <article aria-label="整付零寄交寄汇总清单" className="bulk-paper bulk-paper--summary">
              <header><p>整付零寄交寄汇总清单</p><h3>整付零寄计费单</h3><span>第 {batch.id.replace(/\D/g, '').slice(-6)} 号</span></header>
              <div className="bulk-paper__meta"><span>单位：{batch.agreementAccountName}</span><span>登记证：{batch.agreementAccountId}</span></div>
              <table>
                <thead><tr><th>邮件种类</th><th>件数</th><th>重量(克)</th><th>邮费(元)</th><th>共计邮费(元)</th></tr></thead>
                <tbody>{summaries.map((line) => <tr key={line.key}><td>{line.label}</td><td>{line.count}</td><td>{line.weightGrams}</td><td>{line.unitPostageCents === null ? '—' : formatCents(line.unitPostageCents)}</td><td>{formatCents(line.totalPostageCents)}</td></tr>)}</tbody>
                <tfoot><tr><td>总计（小写）</td><td>{rows.length}</td><td>{totalWeightGrams}</td><td colSpan={2}>{formatCents(batch.totalPostageCents)}</td></tr><tr><td>总计金额（大写）</td><td colSpan={4}>{uppercaseCurrency(batch.totalPostageCents)}</td></tr><tr><td>权益数量</td><td colSpan={4}>{batch.couponCount}</td></tr><tr><td>优惠金额</td><td colSpan={4}>{formatCents(batch.couponDiscountCents)}</td></tr></tfoot>
              </table>
              <footer><span>经办人：{batch.operator.displayName}</span><span>出纳：</span><span>生成时间：{documentTimestamp(batch.settledAt)}</span></footer>
            </article>
          ) : null}
        </div>

        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          {mode === 'settlement' ? <button className="secondary-button" disabled={submitting} onClick={() => void skipPrint()} type="button">暂不打印</button> : <button className="secondary-button" disabled={submitting} onClick={onClose} type="button">关闭</button>}
          <button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void handlePrint()} type="button">{submitting ? '正在处理…' : '打印选中单据'}</button>
        </div>
      </div>
    </Modal>
  )
}
