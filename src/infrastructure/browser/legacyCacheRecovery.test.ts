import { afterEach, describe, expect, it, vi } from 'vitest'

import { removeLegacyRuntimeCaches } from './legacyCacheRecovery'

describe('legacy browser cache recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('unregisters historical workers and clears Cache Storage once per recovery version', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    const unregister = vi.fn().mockResolvedValue(true)
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }])
    const deleteCache = vi.fn().mockResolvedValue(true)
    const listCaches = vi.fn().mockResolvedValue(['legacy-shell', 'legacy-assets'])
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: null,
        getRegistrations,
      },
    })
    vi.stubGlobal('caches', {
      delete: deleteCache,
      keys: listCaches,
    })

    await removeLegacyRuntimeCaches()
    await removeLegacyRuntimeCaches()

    expect(getRegistrations).toHaveBeenCalledTimes(1)
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(listCaches).toHaveBeenCalledTimes(1)
    expect(deleteCache).toHaveBeenCalledTimes(2)
  })
})
