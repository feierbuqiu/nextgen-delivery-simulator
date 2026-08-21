import assert from 'node:assert/strict'
import test from 'node:test'

import { generateThirdPartyArtifacts } from './publication-metadata.mjs'

test('scoped npm package URLs keep the namespace separator', () => {
  const lockfile = JSON.stringify({
    packages: {
      '': { name: 'fixture', version: '1.0.0', license: 'MIT' },
      'node_modules/@scope/example': {
        name: '@scope/example',
        version: '1.2.3',
        license: 'MIT',
        resolved: 'https://registry.npmjs.org/@scope/example/-/example-1.2.3.tgz',
      },
    },
  })
  const artifacts = generateThirdPartyArtifacts(
    lockfile,
    JSON.stringify({ name: 'fixture', version: '1.0.0', license: 'MIT' }),
    JSON.stringify({ creationInfo: { created: '2026-08-20T00:00:00Z' } }),
  )
  const sbom = JSON.parse(artifacts.sbom)
  const dependency = sbom.packages.find((entry) => entry.name === '@scope/example')

  assert.equal(
    dependency.externalRefs[0].referenceLocator,
    'pkg:npm/%40scope/example@1.2.3',
  )
})
