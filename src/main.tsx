import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import { isLocalRuntime, renderLocalOnlyBlock } from './app/localOnly'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Application root element was not found')
}

if (!isLocalRuntime(window.location)) {
  renderLocalOnlyBlock(root)
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
