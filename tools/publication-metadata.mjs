import { createHash } from 'node:crypto'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function packageNameFromPath(packagePath, entry) {
  if (typeof entry.name === 'string' && entry.name) return entry.name
  const marker = 'node_modules/'
  const offset = packagePath.lastIndexOf(marker)
  const remainder = offset >= 0 ? packagePath.slice(offset + marker.length) : packagePath
  const parts = remainder.split('/')
  return remainder.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function spdxIdentifier(packagePath, name, version) {
  const readable = `${name}-${version}`.replace(/[^A-Za-z0-9.-]+/gu, '-')
  return `SPDXRef-Package-${readable}-${sha256(packagePath).slice(0, 12)}`
}

function declaredLicense(entry) {
  return typeof entry.license === 'string' && entry.license.trim() ? entry.license.trim() : 'NOASSERTION'
}

function existingCreatedTimestamp(existingSbomText) {
  if (!existingSbomText) return null
  try {
    const parsed = JSON.parse(existingSbomText)
    return typeof parsed.creationInfo?.created === 'string' ? parsed.creationInfo.created : null
  } catch {
    return null
  }
}

export function generateThirdPartyArtifacts(lockText, packageText, existingSbomText = '') {
  const lockfile = JSON.parse(lockText)
  const packageJson = JSON.parse(packageText)
  const dependencies = Object.entries(lockfile.packages ?? {})
    .filter(([packagePath]) => packagePath !== '')
    .map(([packagePath, entry]) => {
      const name = packageNameFromPath(packagePath, entry)
      const version = typeof entry.version === 'string' ? entry.version : 'NOASSERTION'
      return {
        packagePath,
        name,
        version,
        license: declaredLicense(entry),
        resolved: typeof entry.resolved === 'string' ? entry.resolved : 'NOASSERTION',
        spdxId: spdxIdentifier(packagePath, name, version),
      }
    })
    .sort((left, right) => (
      left.name.localeCompare(right.name, 'en') ||
      left.version.localeCompare(right.version, 'en') ||
      left.packagePath.localeCompare(right.packagePath, 'en')
    ))

  const notices = [
    '# 第三方依赖声明',
    '',
    '本文件由 `tools/generate-third-party-metadata.mjs` 根据锁文件生成。许可证标识来自依赖包发布的元数据；分发者仍应在发布前复核适用许可证正文和义务。',
    '',
    '| 包 | 版本 | 声明许可证 | 锁定来源 |',
    '| --- | --- | --- | --- |',
    ...dependencies.map((dependency) => (
      `| \`${dependency.name}\` | \`${dependency.version}\` | \`${dependency.license}\` | ${dependency.resolved === 'NOASSERTION' ? dependency.resolved : `[npm](${dependency.resolved})`} |`
    )),
  ].join('\n')

  const rootSpdxId = 'SPDXRef-RootPackage'
  const created = existingCreatedTimestamp(existingSbomText) ?? new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
  const sbom = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `${packageJson.name}-${packageJson.version}`,
    documentNamespace: `https://spdx.invalid/${encodeURIComponent(packageJson.name)}/${packageJson.version}/${sha256(lockText).slice(0, 24)}`,
    creationInfo: {
      created,
      creators: ['Tool: tools/generate-third-party-metadata.mjs'],
    },
    packages: [
      {
        name: packageJson.name,
        SPDXID: rootSpdxId,
        versionInfo: packageJson.version,
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: 'NOASSERTION',
        licenseDeclared: typeof packageJson.license === 'string' ? packageJson.license : 'NOASSERTION',
        copyrightText: 'NOASSERTION',
      },
      ...dependencies.map((dependency) => ({
        name: dependency.name,
        SPDXID: dependency.spdxId,
        versionInfo: dependency.version,
        downloadLocation: dependency.resolved,
        filesAnalyzed: false,
        licenseConcluded: 'NOASSERTION',
        licenseDeclared: dependency.license,
        copyrightText: 'NOASSERTION',
        externalRefs: [{
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: `pkg:npm/${encodeURIComponent(dependency.name)}@${encodeURIComponent(dependency.version)}`,
        }],
      })),
    ],
    relationships: [
      {
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
        relatedSpdxElement: rootSpdxId,
      },
      ...dependencies.map((dependency) => ({
        spdxElementId: rootSpdxId,
        relationshipType: 'DEPENDS_ON',
        relatedSpdxElement: dependency.spdxId,
      })),
    ],
  }

  return {
    notices: `${notices}\n`,
    sbom: `${JSON.stringify(sbom, null, 2)}\n`,
    dependencyCount: dependencies.length,
  }
}
