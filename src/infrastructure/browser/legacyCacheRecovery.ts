const RECOVERY_MARKER = '2026-08-03-static-cache-v2'
const RECOVERY_STORAGE_KEY = 'local-delivery-training-cache-recovery'
const RETIRED_STORAGE_KEY = `${"retired-public-namespace"}-cache-recovery`

function alreadyRecovered(): boolean {
  try {
    if (window.localStorage.getItem(RECOVERY_STORAGE_KEY) === RECOVERY_MARKER) return true
    if (window.localStorage.getItem(RETIRED_STORAGE_KEY) !== RECOVERY_MARKER) return false
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, RECOVERY_MARKER)
    window.localStorage.removeItem(RETIRED_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

function markRecovered(): void {
  try {
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, RECOVERY_MARKER)
    window.localStorage.removeItem(RETIRED_STORAGE_KEY)
  } catch {
    // Storage may be disabled. Cache cleanup itself can still succeed.
  }
}

export async function removeLegacyRuntimeCaches(): Promise<void> {
  if (alreadyRecovered()) return

  const hadServiceWorkerController = 'serviceWorker' in navigator &&
    navigator.serviceWorker.controller !== null
  const cleanupTasks: Promise<unknown>[] = []

  if ('serviceWorker' in navigator) {
    cleanupTasks.push(
      navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.allSettled(registrations.map((registration) => registration.unregister())),
      ),
    )
  }

  if ('caches' in window) {
    cleanupTasks.push(
      window.caches.keys().then((cacheNames) =>
        Promise.allSettled(cacheNames.map((cacheName) => window.caches.delete(cacheName))),
      ),
    )
  }

  await Promise.allSettled(cleanupTasks)
  markRecovered()

  if (hadServiceWorkerController) {
    try {
      const reloadKey = `${RECOVERY_STORAGE_KEY}-reload`
      if (window.sessionStorage.getItem(reloadKey) !== RECOVERY_MARKER) {
        window.sessionStorage.setItem(reloadKey, RECOVERY_MARKER)
        window.location.reload()
      }
    } catch {
      // A later manual reload will finish releasing the old controller.
    }
  }
}
