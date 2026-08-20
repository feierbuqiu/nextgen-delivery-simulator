import { describe, expect, it } from 'vitest'

import { createCustomerSeedState, createEmptySender } from './seed'
import {
  isValidContact,
  isValidResidentIdentity,
  resolvePostalCode,
  searchAgreementAccounts,
  searchCustomerHistory,
  validateSender,
} from './policy'

describe('customer policy', () => {
  it('accepts the documented demo phone shapes', () => {
    expect(isValidContact('10000000016')).toBe(true)
    expect(isValidContact('010-12345678')).toBe(true)
    expect(isValidContact('010-12345678-66')).toBe(true)
    expect(isValidContact('28800000011')).toBe(false)
  })

  it('enforces conditional identity and paired field rules', () => {
    const sender = createEmptySender()
    const invalid = validateSender(sender, true)
    expect(invalid.errors.form).toBeDefined()
    expect(invalid.errors.detailedAddress).toBeDefined()
    expect(invalid.errors.identityType).toBeDefined()

    const valid = validateSender(
      {
        ...sender,
        contact: '10000000016',
        detailedAddress: '瀚原省栖沄市景麓区星光路 18 号',
        identityType: 'primary',
        identityValue: '990101194912310044',
      },
      true,
    )
    expect(valid).toEqual({ valid: true, errors: {} })
  })

  it('validates the 18-character resident identity date and checksum', () => {
    expect(isValidResidentIdentity('990101194912310044')).toBe(true)
    expect(isValidResidentIdentity('990101194913310060')).toBe(false)
    expect(isValidResidentIdentity('990101194912310020')).toBe(false)
    expect(isValidResidentIdentity('11010519491231002')).toBe(false)
  })

  it('resolves a partial postal prefix deterministically', () => {
    expect(resolvePostalCode('100', ['200202', '100103', '100101'])).toBe('100101')
    expect(resolvePostalCode('999', ['100101'])).toBeNull()
    expect(resolvePostalCode('123456', ['100101'])).toBe('123456')
  })

  it('searches fictional agreements by code, exact name, or mnemonic', () => {
    const seed = createCustomerSeedState()
    expect(searchAgreementAccounts(seed.agreementAccounts, '000002')).toHaveLength(1)
    expect(searchAgreementAccounts(seed.agreementAccounts, '星河合作社')).toHaveLength(1)
    expect(searchAgreementAccounts(seed.agreementAccounts, 'qh')).toHaveLength(1)
    expect(searchAgreementAccounts(seed.agreementAccounts, '星河')).toHaveLength(0)
  })

  it('returns multiple deterministic history candidates', () => {
    const seed = createCustomerSeedState()
    expect(searchCustomerHistory(seed.senderHistory, '10000000016', '')).toHaveLength(2)
    expect(searchCustomerHistory(seed.recipientHistory, '', '顾')).toHaveLength(2)
  })
})
