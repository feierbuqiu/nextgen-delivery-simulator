import {
  destinationZoneLabel,
  formatCents,
  paymentMethodLabel,
} from '../../domain/service/policy'
import {
  internationalDestinationLabel,
} from '../../domain/service/international'
import {
  serviceReceiptTitle,
} from '../../domain/service/receipt'
import type { ServiceTransaction } from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface ServiceReceiptModalProps {
  mode: 'initial' | 'reprint'
  onClose: (reason: 'cancelled' | 'printed') => void
  transaction: ServiceTransaction
}

function receiptTimestamp(value: string): string {
  return value.slice(0, 19).replace('T', ' ')
}

function receiptDestination(transaction: ServiceTransaction): {
  label: string
  value: string
} {
  if (transaction.service.destinationZone === 'international') {
    const countryCode = transaction.service.destinationOffice
    const country = countryCode
      ? internationalDestinationLabel(countryCode)
      : '国际'
    return {
      label: '寄达国家',
      value: countryCode ? `${country}（${countryCode}）` : country,
    }
  }

  const address = transaction.customer.recipient.detailedAddress.trim()
  return {
    label: '寄达地址',
    value: address || destinationZoneLabel(transaction.service.destinationZone),
  }
}

function printReceipt(): void {
  document.body.classList.add('service-receipt-printing')
  try {
    window.print()
  } finally {
    document.body.classList.remove('service-receipt-printing')
  }
}

export function ServiceReceiptModal({
  mode,
  onClose,
  transaction,
}: ServiceReceiptModalProps) {
  const receiptTitle = serviceReceiptTitle(transaction)
  const destination = receiptDestination(transaction)
  const itemCode = transaction.service.itemCode || '无邮件号码'
  const settlementStatus = transaction.status === 'settled'
    ? `已结算${transaction.settlementId ? `（${transaction.settlementId}）` : ''}`
    : transaction.status === 'withdrawn'
      ? '已撤销'
      : '待结算'

  function handlePrint(): void {
    printReceipt()
    onClose('printed')
  }

  return (
    <Modal
      eyebrow={mode === 'initial' ? '给据函件收寄' : '查改单据'}
      title={mode === 'initial' ? `是否打印${receiptTitle}？` : '邮件收寄单据重打'}
      wide
    >
      <div className="modal-form service-receipt-modal">
        <article aria-label={receiptTitle} className="service-receipt">
          <header className="service-receipt__header">
            <div>
              <p>本地寄递演练样张 · 无效</p>
              <h3>{receiptTitle}</h3>
            </div>
            <span>客户联</span>
          </header>

          <section className="service-receipt__item-code">
            <span>邮件号码</span>
            <strong>{itemCode}</strong>
          </section>

          <dl className="service-receipt__details">
            <div><dt>收寄流水</dt><dd>{transaction.id}</dd></div>
            <div><dt>收寄时间</dt><dd>{receiptTimestamp(transaction.acceptedAt)}</dd></div>
            <div><dt>业务产品</dt><dd>{transaction.product.label}（{transaction.product.searchCode}）</dd></div>
            <div><dt>业务代码</dt><dd>{transaction.product.effectiveBusinessCode}</dd></div>
            <div><dt>区域</dt><dd>{destinationZoneLabel(transaction.service.destinationZone)}</dd></div>
            <div><dt>重量 / 件数</dt><dd>{transaction.service.weightGrams ?? 0} 克 / {transaction.service.quantity} 件</dd></div>
            <div><dt>寄件人</dt><dd>{transaction.customer.sender.name || '未填写'} {transaction.customer.sender.contact}</dd></div>
            <div><dt>收件人</dt><dd>{transaction.customer.recipient.name || '未填写'} {transaction.customer.recipient.contact}</dd></div>
            <div className="service-receipt__wide"><dt>{destination.label}</dt><dd>{destination.value}</dd></div>
            <div><dt>付费方式</dt><dd>{paymentMethodLabel(transaction.service.paymentMethod)}</dd></div>
            <div><dt>回执业务</dt><dd>{transaction.service.returnReceiptRequested ? '已办理' : '未办理'}</dd></div>
            <div><dt>结算状态</dt><dd>{settlementStatus}</dd></div>
            <div><dt>贴票金额</dt><dd>¥ {formatCents(transaction.service.stampAmountCents ?? 0)}</dd></div>
            <div><dt>回执费</dt><dd>¥ {formatCents(transaction.charge.returnReceiptCents)}</dd></div>
            <div><dt>结算应收</dt><dd>¥ {formatCents(transaction.charge.settlementDueCents)}</dd></div>
            <div className="service-receipt__total"><dt>总资费</dt><dd>¥ {formatCents(transaction.charge.postageCents)}</dd></div>
          </dl>

          <footer className="service-receipt__footer">
            <span>收寄机构：{transaction.operator.acceptanceOffice}</span>
            <span>营业员：{transaction.operator.displayName}</span>
            <span>台席：{transaction.operator.workstationCode}</span>
          </footer>
        </article>

        <div className="modal-actions service-receipt__actions">
          <button
            className="secondary-button"
            onClick={() => onClose('cancelled')}
            type="button"
          >
            {mode === 'initial' ? '取消' : '关闭'}
          </button>
          <button className="primary-button primary-button--compact" onClick={handlePrint} type="button">
            打印
          </button>
        </div>
      </div>
    </Modal>
  )
}
