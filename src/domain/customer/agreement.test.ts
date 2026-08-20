import { describe, expect, it } from 'vitest'

import { createCustomerSeedState } from './seed'
import {
  approveAgreementApplication,
  MINIMUM_BULK_ITEM_COUNT,
  submitAgreementApplication,
  validateAgreementApplication,
  type AgreementApplicationDraft,
} from './agreement'

function applicationDraft(
  overrides: Partial<AgreementApplicationDraft> = {},
): AgreementApplicationDraft {
  return {
    appliedAt: '2026-08-04T10:00:00.000Z',
    legalName: '陆川',
    shortName: '陆川大宗客户',
    customerType: 'individual',
    identityType: 'primary',
    identityValue: '990101194912310044',
    contact: '10000000027',
    senderName: '陆川',
    detailedAddress: '瀚原省栖沄市景麓区新程路 36 号',
    unit: '',
    postalCode: '110022',
    mnemonic: 'LC',
    expectedItemCount: 6,
    productCategoryCode: '200',
    paymentMethod: 'cash-settlement',
    allowCredit: false,
    businessScope: '大宗给据函件收寄',
    certificateFileName: '',
    contractFileName: '',
    gender: 'unspecified',
    ...overrides,
  }
}

describe('agreement customer registration', () => {
  it('requires at least five items for a bulk registration application', () => {
    expect(validateAgreementApplication(applicationDraft({ expectedItemCount: 4 })))
      .toMatchObject({
        expectedItemCount: `大宗申请的预计交寄件数不得少于 ${MINIMUM_BULK_ITEM_COUNT} 件。`,
      })
  })

  it('keeps an application pending until approval creates a selectable account', () => {
    const submitted = submitAgreementApplication(
      createCustomerSeedState(),
      applicationDraft(),
    )

    expect(submitted.application).toMatchObject({
      id: 'XY-20260804-0001',
      status: 'pending',
      expectedItemCount: 6,
      accountId: null,
    })
    expect(submitted.state.agreementAccounts).toHaveLength(3)

    const approved = approveAgreementApplication(
      submitted.state,
      submitted.application.id,
      '2026-08-04T10:05:00.000Z',
    )
    expect(approved.application).toMatchObject({
      status: 'approved',
      accountId: '91000000000004',
    })
    expect(approved.account).toMatchObject({
      id: '91000000000004',
      name: '陆川大宗客户',
      identityValue: '990101194912310044',
      paymentMethod: 'cash-settlement',
    })
  })
})
