import { describe, expect, it } from 'vitest'

import type { ProductFamily } from '../customer/types'
import type { ServiceDestinationZone, ServiceTransaction } from './types'
import {
  isRegisteredReceiptTransaction,
  serviceReceiptTitle,
} from './receipt'

function receiptTransaction(
  productFamily: ProductFamily,
  destinationZone: ServiceDestinationZone,
): ServiceTransaction {
  return {
    customer: { productFamily },
    service: { destinationZone },
  } as ServiceTransaction
}

describe('service receipt projection', () => {
  it('uses the observed domestic title for local and nonlocal given letters', () => {
    const local = receiptTransaction('standard-delivery', 'local')
    const nonlocal = receiptTransaction('standard-delivery', 'nonlocal')

    expect(isRegisteredReceiptTransaction(local)).toBe(true)
    expect(serviceReceiptTitle(local)).toBe('国内挂号函件收据')
    expect(serviceReceiptTitle(nonlocal)).toBe('国内挂号函件收据')
  })

  it('separates international given-letter and generic mail receipts', () => {
    expect(serviceReceiptTitle(
      receiptTransaction('standard-delivery', 'international'),
    )).toBe('国际给据函件收寄凭据')
    expect(serviceReceiptTitle(
      receiptTransaction('basic-letter', 'nonlocal'),
    )).toBe('邮件收寄凭据')
  })
})
