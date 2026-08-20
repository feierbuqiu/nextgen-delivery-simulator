import { useState, type FormEvent } from 'react'

import type { RegisterBulkInvoiceRequest } from '../../domain/service/bulk'
import type { BulkBatch } from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

export type BulkInvoiceDraft = Omit<
  RegisterBulkInvoiceRequest,
  'batchId' | 'issuedAt'
>

interface BulkInvoiceRegistrationModalProps {
  batch: BulkBatch
  onClose: () => void
  onSubmit: (draft: BulkInvoiceDraft) => Promise<void>
}

export function BulkInvoiceRegistrationModal({
  batch,
  onClose,
  onSubmit,
}: BulkInvoiceRegistrationModalProps) {
  const [draft, setDraft] = useState<BulkInvoiceDraft>({
    buyerType: 'organization',
    buyerName: batch.agreementAccountName,
    taxpayerId: batch.sender.identityValue,
    deliveryPhone: batch.sender.contact,
    buyerPhone: '',
    deliveryEmail: '',
    buyerAddress: batch.sender.detailedAddress,
    bankName: '',
    bankAccount: '',
    reviewer: batch.operator.displayName,
    remark: '',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function update<K extends keyof BulkInvoiceDraft>(
    key: K,
    value: BulkInvoiceDraft[K],
  ): void {
    setDraft((current) => ({ ...current, [key]: value }))
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onSubmit(draft)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '电子发票登记失败。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      description={`批次 ${batch.id} · 价税合计 ${(
        (batch.totalSettlementDueCents - batch.couponDiscountCents) / 100
      ).toFixed(2)} 元`}
      eyebrow="结算中心"
      title="电子发票登记"
      wide
    >
      <form className="modal-form bulk-invoice-form" onSubmit={(event) => void submit(event)}>
        <div className="bulk-invoice-grid">
          <label><span>购方性质</span><select aria-label="购方性质" onChange={(event) => update('buyerType', event.target.value as BulkInvoiceDraft['buyerType'])} value={draft.buyerType}><option value="organization">1-单位</option><option value="individual">2-个人</option></select></label>
          <label><span><b>*</b> 购方名称</span><input aria-label="购方名称" onChange={(event) => update('buyerName', event.target.value)} value={draft.buyerName} /></label>
          <label><span><b>*</b> 购方纳税人识别号</span><input aria-label="购方纳税人识别号" onChange={(event) => update('taxpayerId', event.target.value)} value={draft.taxpayerId} /></label>
          <label><span>交付电话</span><input aria-label="交付电话" onChange={(event) => update('deliveryPhone', event.target.value)} value={draft.deliveryPhone} /></label>
          <label><span>购方手机</span><input aria-label="购方手机" onChange={(event) => update('buyerPhone', event.target.value)} value={draft.buyerPhone} /></label>
          <label><span>交付邮箱</span><input aria-label="交付邮箱" onChange={(event) => update('deliveryEmail', event.target.value)} type="email" value={draft.deliveryEmail} /></label>
          <label className="bulk-invoice-wide"><span>购方地址</span><input aria-label="购方地址" onChange={(event) => update('buyerAddress', event.target.value)} value={draft.buyerAddress} /></label>
          <label><span>购方开户行</span><input aria-label="购方开户行" onChange={(event) => update('bankName', event.target.value)} value={draft.bankName} /></label>
          <label><span>购方账号</span><input aria-label="购方账号" onChange={(event) => update('bankAccount', event.target.value)} value={draft.bankAccount} /></label>
          <label><span>复核人</span><input aria-label="复核人" onChange={(event) => update('reviewer', event.target.value)} value={draft.reviewer} /></label>
          <label className="bulk-invoice-wide"><span>备注</span><input aria-label="发票备注" onChange={(event) => update('remark', event.target.value)} value={draft.remark} /></label>
        </div>
        <p className="bulk-invoice-delivery-note">交付电话和交付邮箱至少填写一项。</p>
        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
        <div className="modal-actions"><button className="secondary-button" disabled={submitting} onClick={onClose} type="button">取消</button><button className="primary-button primary-button--compact" disabled={submitting} type="submit">{submitting ? '正在登记…' : '确认开票'}</button></div>
      </form>
    </Modal>
  )
}
