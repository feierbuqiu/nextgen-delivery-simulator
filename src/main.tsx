import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import { isLocalRuntime, renderLocalOnlyBlock } from './app/localOnly'
import { removeLegacyRuntimeCaches } from './infrastructure/browser/legacyCacheRecovery'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Application root element was not found')
}

if (!isLocalRuntime(window.location)) {
  renderLocalOnlyBlock(root)
} else {
  void removeLegacyRuntimeCaches()

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
