import type { ServiceTransaction } from './types'

const DOMESTIC_ZONES = new Set(['local', 'nonlocal'])

export function isRegisteredReceiptTransaction(
  transaction: ServiceTransaction,
): boolean {
  return transaction.customer.productFamily === 'standard-delivery'
}

export function serviceReceiptTitle(
  transaction: ServiceTransaction,
): string {
  if (!isRegisteredReceiptTransaction(transaction)) return '邮件收寄凭据'
  if (DOMESTIC_ZONES.has(transaction.service.destinationZone)) {
    return '国内挂号函件收据'
  }
  if (transaction.service.destinationZone === 'international') {
    return '国际给据函件收寄凭据'
  }
  return '特区给据函件收寄凭据'
}
