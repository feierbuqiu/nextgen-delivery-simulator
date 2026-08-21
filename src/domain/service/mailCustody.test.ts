import { describe, expect, it } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../customer/seed'
import {
  assertTransactionMailCustodyReleased,
  transactionMailCustody,
} from './mailCustody'
import { executeMailSealingCommand } from './mailSealing'
import { calculateServiceCharge } from './policy'
import { createEmptyServiceDraft, createServiceSeedState, SERVICE_PRODUCTS } from './seed'
import { acceptServiceTransaction, settleServiceTransactions } from './transactions'
import type { ServiceOperatorSnapshot } from './types'

const operator: ServiceOperatorSnapshot = {
  operatorId: '80000001',
  displayName: '林青禾',
  workstationCode: '01',
  acceptanceOffice: '景麓营业部',
  receivingOffice: '栖沄邮件处理中心',
}

describe('transaction mail custody', () => {
  it('blocks transaction changes while a sealed bag owns the mail and releases it after cancellation', () => {
    const product = SERVICE_PRODUCTS.find((item) => item.id === 'ordinary-letter-100')!
    const draft = {
      ...createEmptyServiceDraft(false),
      productId: product.id,
      destinationZone: 'nonlocal' as const,
      itemCode: 'XA10000000002',
      weightGrams: 20,
    }
    const accepted = acceptServiceTransaction(createServiceSeedState(), {
      acceptedAt: '2026-08-19T00:00:00.000Z',
      charge: calculateServiceCharge(draft, product),
      customer: {
        productFamily: product.productFamily,
        destinationRegion: 'domestic',
        sender: createEmptySender(),
        recipient: createEmptyRecipient(),
      },
      draft,
      product,
      operator,
    })
    const settled = settleServiceTransactions(accepted.state, {
      transactionIds: [accepted.transaction.id],
      tender: 'cash',
      settledAt: '2026-08-19T00:01:00.000Z',
      amountReceivedCents: accepted.transaction.charge.settlementDueCents,
    }).state
    const bagged = executeMailSealingCommand(settled, {
      type: 'generate-dispatch-bags',
      manifests: [{
        mailReferences: [{
          kind: 'transaction',
          transactionId: accepted.transaction.id,
        }],
        manifestNumber: '501',
        receptacleType: '1.袋',
        usesBarcodeContainer: false,
        containerBarcode: '',
        rfidBagTagNumber: '',
      }],
      shift: '01',
      institutionCode: '99901001',
      generatedAt: '2026-08-19T00:02:00.000Z',
      operator,
    })

    expect(transactionMailCustody(bagged.state, accepted.transaction.id)).toEqual({
      kind: 'dispatch-bag',
      reference: bagged.bags[0]!.id,
    })
    expect(() => assertTransactionMailCustodyReleased(
      bagged.state,
      accepted.transaction.id,
      '删除交易',
    )).toThrow(/已进入总包/u)

    const cancelled = executeMailSealingCommand(bagged.state, {
      type: 'cancel-dispatch-bags',
      bagIds: [bagged.bags[0]!.id],
      cancelledAt: '2026-08-19T00:03:00.000Z',
      operator,
    })
    expect(transactionMailCustody(cancelled.state, accepted.transaction.id)).toBeNull()
    expect(() => assertTransactionMailCustodyReleased(
      cancelled.state,
      accepted.transaction.id,
      '删除交易',
    )).not.toThrow()
  })
})
