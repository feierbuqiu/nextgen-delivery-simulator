import { describe, expect, it } from 'vitest'

import { matchPostalAdministrativeByChannel } from '../customer/postalAdministrativeDirectory'
import { CHANNEL_PICKUP_OFFICES } from './channelProductSales'
import { resolveElectronicCommerceAccount } from './electronicCommerce'
import { createServiceSeedState } from './seed'
import { matchTrafficMail, trafficMailExample, type TrafficMailPurpose } from './supplementaryTraffic'

function expectKnownAddress(address: string, postalCode?: string): void {
  const matched = matchPostalAdministrativeByChannel(address)
  expect(matched, address).not.toBeNull()
  if (postalCode !== undefined) expect(matched?.postalCode, address).toBe(postalCode)
}

describe('业务演练地址一致性', () => {
  it('渠道自提机构和窗投种子均来自现行区划', () => {
    for (const office of CHANNEL_PICKUP_OFFICES) expectKnownAddress(office.address)
    for (const item of createServiceSeedState().windowDeliveryItems) {
      if (!item.senderAddress.startsWith('海外')) expectKnownAddress(item.senderAddress)
      if (!item.recipientAddress.startsWith('海外')) expectKnownAddress(item.recipientAddress)
    }
  })

  it('电子商务查询账户地址与当前区划一致', () => {
    const state = createServiceSeedState()
    const accounts = [
      ['water', 'lanjing-water', '856461'],
      ['electricity', 'lanjing-electricity', '230118'],
      ['gas', 'lanjing-gas', '779921'],
      ['cable-tv', 'lanjing-cable', '640018'],
      ['broadband', 'lanjing-broadband', '830016'],
      ['mobile', 'lanjing-mobile', '10000000038'],
      ['landline', 'lanjing-landline', '01099001234'],
    ] as const

    for (const [projectId, providerId, accountNumber] of accounts) {
      const account = resolveElectronicCommerceAccount(
        state,
        projectId,
        providerId,
        accountNumber,
      )
      expectKnownAddress(account.customerAddress)
    }
  })

  it('补录交通业务的地址、区域和邮编相互契合', () => {
    const purposes: TrafficMailPurpose[] = ['bulk', 'single-journey', 'round-trip']
    for (const purpose of purposes) {
      const matchedMail = matchTrafficMail(trafficMailExample(purpose), purpose).mail
      expectKnownAddress(matchedMail.recipientAddress, matchedMail.recipientPostalCode)
      const directory = matchPostalAdministrativeByChannel(matchedMail.recipientAddress)
      const expectedZone = directory?.prefectureId === 'F001' ? 'local' : 'nonlocal'
      expect(matchedMail.destinationZone).toBe(expectedZone)
    }
  })
})
