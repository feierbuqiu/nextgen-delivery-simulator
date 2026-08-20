import { describe, expect, it } from 'vitest'

import { promoteCustomerDraft } from './history'
import { createCustomerSeedState, createEmptyRecipient, createEmptySender } from './seed'
import type { CustomerDraft } from './types'

describe('customer history promotion', () => {
  it('promotes exact snapshots only once after a transaction succeeds', () => {
    const draft: CustomerDraft = {
      productFamily: 'standard-delivery',
      destinationRegion: 'domestic',
      sender: {
        ...createEmptySender(),
        contact: '10000000025',
        name: '演示甲',
        detailedAddress: '瀚原省栖沄市景麓区新路 1 号',
      },
      recipient: {
        ...createEmptyRecipient(),
        contact: '10000000026',
        name: '演示乙',
        detailedAddress: '澄岐省澄野市江洲区新路 2 号',
      },
      status: 'customer-ready',
      updatedAt: '2026-01-15T09:00:00.000Z',
    }
    const first = promoteCustomerDraft(createCustomerSeedState(), draft)
    const second = promoteCustomerDraft(first, draft)

    expect(first.senderHistory.at(-1)).toMatchObject({ id: 'sender-004', name: '演示甲' })
    expect(first.recipientHistory.at(-1)).toMatchObject({ id: 'recipient-004', name: '演示乙' })
    expect(second.senderHistory).toHaveLength(4)
    expect(second.recipientHistory).toHaveLength(4)
  })
})
