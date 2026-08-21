import assert from 'node:assert/strict'
import test from 'node:test'

import { findReactRefreshPreamble } from './check-dev-server.mjs'

test('development preamble parser accepts case-insensitive HTML script markup', () => {
  const preamble = 'window.$RefreshReg$ = () => {}; injectIntoGlobalHook(window)'
  const html = `<SCRIPT TYPE = "MODULE">${preamble}</SCRIPT >`

  assert.equal(findReactRefreshPreamble(html), preamble)
})

test('development preamble parser rejects non-module scripts', () => {
  const html = '<script type="text/javascript">injectIntoGlobalHook(window)</script>'

  assert.equal(findReactRefreshPreamble(html), null)
})
