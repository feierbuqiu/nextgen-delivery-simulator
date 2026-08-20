import { describe, expect, it } from 'vitest'

import { createSeedState } from '../access/seed'
import { createCustomerSeedState } from '../customer/seed'
import { createServiceSeedState } from '../service/seed'
import {
  createSimulatorArchive,
  parseSimulatorArchive,
  SIMULATOR_ARCHIVE_KIND,
  SimulatorArchiveError,
} from './simulatorArchive'

describe('simulator archive', () => {
  it('round-trips the complete versioned local state', async () => {
    const archive = createSimulatorArchive(
      await createSeedState(),
      createCustomerSeedState(),
      createServiceSeedState(),
      '2026-08-03T12:00:00.000Z',
    )

    expect(parseSimulatorArchive(JSON.stringify(archive))).toEqual(archive)
  })

  it('imports a retired archive marker but always returns the neutral marker', async () => {
    const archive = createSimulatorArchive(
      await createSeedState(),
      createCustomerSeedState(),
      createServiceSeedState(),
    ) as unknown as Record<string, unknown>
    archive.kind = "retired-public-namespace-simulator-archive"

    expect(parseSimulatorArchive(JSON.stringify(archive)).kind).toBe(SIMULATOR_ARCHIVE_KIND)
  })

  it('never exports or restores a live platform-test exception', async () => {
    const seed = await createSeedState()
    const legacyState = {
      ...seed,
      session: {
        operatorId: seed.operator.id,
        workstationCode: '01',
        signedInAt: '2026-08-12T11:20:00.000Z',
        platformTestDuty: {
          enabledAt: '2026-08-12T11:30:00.000Z',
          expiresAt: '2026-08-12T15:30:00.000Z',
          enabledBy: seed.operator.id,
        },
      },
    }
    const archive = createSimulatorArchive(
      legacyState,
      createCustomerSeedState(),
      createServiceSeedState(),
    )

    expect(archive.data.access.session?.platformTestDuty).toBeNull()
    expect(parseSimulatorArchive(JSON.stringify({
      ...archive,
      data: { ...archive.data, access: legacyState },
    })).data.access.session?.platformTestDuty).toBeNull()
  })

  it('migrates an accepted legacy service state during import', async () => {
    const archive = createSimulatorArchive(
      await createSeedState(),
      createCustomerSeedState(),
      createServiceSeedState(),
    ) as unknown as Record<string, unknown>
    const data = archive.data as Record<string, unknown>
    const access = data.access as Record<string, unknown>
    access.schemaVersion = 2
    delete access.security
    const services = data.services as Record<string, unknown>
    services.schemaVersion = 2
    delete services.postalSupplySales
    delete services.nextPostalSupplySequence
    delete services.replyCouponRedemptions
    delete services.nextReplyCouponSequence
    delete services.looseMailHandovers
    delete services.nextLooseMailHandoverSequence
    delete services.dispatchRelationOverrides
    delete services.dispatchBags
    delete services.dispatchBagHandovers
    delete services.dispatchBagChanges
    delete services.dispatchBagInterchangeReturns
    delete services.dispatchRoutes
    delete services.dispatchPrintRecords
    delete services.postageMeterDevices
    delete services.postageMeterBatches
    delete services.postageMeterRegistrations
    delete services.postageMeterDailyBalances
    delete services.postageMeterMailHandovers
    delete services.postageMeterFundingRequests
    delete services.postageMeterRepairRequests
    delete services.postageMeterDeviceHandoverHistory
    delete services.nextDispatchBagSequence
    delete services.nextDispatchManifestSequence
    delete services.nextDispatchBagHandoverSequence
    delete services.nextDispatchBagChangeSequence
    delete services.nextDispatchBagInterchangeReturnSequence
    delete services.nextDispatchRouteSequence
    delete services.nextDispatchPrintSequence
    delete services.nextPostageMeterBatchSequence
    delete services.nextPostageMeterRegistrationSequence
    delete services.nextPostageMeterDailyBalanceSequence
    delete services.nextPostageMeterMailHandoverSequence
    delete services.nextPostageMeterFundingSequence
    delete services.nextPostageMeterRepairSequence

    const parsed = parseSimulatorArchive(JSON.stringify(archive))

    expect(parsed.data.access.schemaVersion).toBe(8)
    expect(parsed.data.access.security).toMatchObject({
      failedSecretAttempts: 0,
      lockedAt: null,
      events: [],
    })
    expect(parsed.data.services.schemaVersion).toBe(38)
    expect(parsed.data.services.postalSupplySales).toEqual([])
    expect(parsed.data.services.nextPostalSupplySequence).toBe(1)
    expect(parsed.data.services.replyCouponRedemptions).toEqual([])
    expect(parsed.data.services.nextReplyCouponSequence).toBe(1)
    expect(parsed.data.services.looseMailHandovers).toEqual([])
    expect(parsed.data.services.nextLooseMailHandoverSequence).toBe(1)
    expect(parsed.data.services.dispatchRelationOverrides).toEqual([])
    expect(parsed.data.services.dispatchBags).toEqual([])
    expect(parsed.data.services.nextDispatchBagSequence).toBe(1)
    expect(parsed.data.services.nextDispatchManifestSequence).toBe(501)
    expect(parsed.data.services.dispatchBagHandovers).toEqual([])
    expect(parsed.data.services.dispatchBagChanges).toEqual([])
    expect(parsed.data.services.dispatchBagInterchangeReturns).toEqual([])
    expect(parsed.data.services.dispatchRoutes).toEqual([])
    expect(parsed.data.services.dispatchPrintRecords).toEqual([])
    expect(parsed.data.services.nextDispatchBagHandoverSequence).toBe(1)
    expect(parsed.data.services.nextDispatchBagChangeSequence).toBe(1)
    expect(parsed.data.services.nextDispatchBagInterchangeReturnSequence).toBe(1)
    expect(parsed.data.services.nextDispatchRouteSequence).toBe(1)
    expect(parsed.data.services.nextDispatchPrintSequence).toBe(1)
    expect(parsed.data.services.postageMeterDevices).toHaveLength(2)
    expect(parsed.data.services.postageMeterBatches).toEqual([])
    expect(parsed.data.services.postageMeterRegistrations).toEqual([])
    expect(parsed.data.services.postageMeterDailyBalances).toEqual([])
    expect(parsed.data.services.postageMeterMailHandovers).toEqual([])
    expect(parsed.data.services.postageMeterFundingRequests).toEqual([])
    expect(parsed.data.services.postageMeterRepairRequests).toEqual([])
    expect(parsed.data.services.postageMeterDeviceHandoverHistory).toHaveLength(2)
    expect(parsed.data.services.nextPostageMeterBatchSequence).toBe(1)
    expect(parsed.data.services.nextPostageMeterRegistrationSequence).toBe(1)
    expect(parsed.data.services.nextPostageMeterDailyBalanceSequence).toBe(1)
    expect(parsed.data.services.nextPostageMeterMailHandoverSequence).toBe(1)
    expect(parsed.data.services.nextPostageMeterFundingSequence).toBe(1)
    expect(parsed.data.services.nextPostageMeterRepairSequence).toBe(1)
  })

  it('rejects unrelated and structurally incomplete JSON', () => {
    expect(() => parseSimulatorArchive('{"kind":"something-else"}'))
      .toThrowError(SimulatorArchiveError)
    expect(() => parseSimulatorArchive('{broken json'))
      .toThrow('所选文件不是有效的 JSON 数据')
  })

  it('preserves unknown public-safe text while importing a complete archive', async () => {
    const archive = createSimulatorArchive(
      await createSeedState(),
      createCustomerSeedState(),
      createServiceSeedState(),
    ) as unknown as Record<string, unknown>
    const data = archive.data as Record<string, unknown>
    const access = data.access as Record<string, unknown>
    const operator = access.operator as Record<string, unknown>
    operator.profileCompleted = true
    operator.profile = {
      institutionName: "青禾支局",
    }
    access.schemaVersion = 3

    const parsed = parseSimulatorArchive(JSON.stringify(archive))

    expect(parsed.data.access.schemaVersion).toBe(8)
    expect(parsed.data.access.operator.profile?.institutionName).toBe((operator.profile as { institutionName: string }).institutionName)
  })
})
