import { useMemo, useState } from 'react'

import {
  CAPABILITY_CATALOG,
  CAPABILITY_MATURITY_LABELS,
  CAPABILITY_VERIFICATION_LABELS,
  capabilityCounts,
  type CapabilityMaturity,
} from './capabilityCatalog'

type MaturityFilter = CapabilityMaturity | 'all'

interface CapabilityMatrixWorkspaceProps {
  onBack: () => void
}

const maturityOrder: readonly CapabilityMaturity[] = [
  'accepted',
  'implemented',
  'partial',
  'planned',
]

export function CapabilityMatrixWorkspace({ onBack }: CapabilityMatrixWorkspaceProps) {
  const [maturity, setMaturity] = useState<MaturityFilter>('all')
  const [query, setQuery] = useState('')
  const counts = capabilityCounts()
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleCapabilities = useMemo(() => CAPABILITY_CATALOG.filter((capability) => {
    if (maturity !== 'all' && capability.maturity !== maturity) return false
    if (!normalizedQuery) return true
    return [
      capability.id,
      capability.label,
      capability.path,
      capability.summary,
      capability.specification,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  }), [maturity, normalizedQuery])

  return (
    <section aria-label="功能成熟度" className="capability-workspace">
      <div className="customer-breadcrumb">
        <button onClick={onBack} type="button">主页</button>
        <span>/</span>
        <strong>功能成熟度</strong>
      </div>

      <header className="capability-heading">
        <div>
          <span>工程治理</span>
          <h1>功能成熟度矩阵</h1>
          <p>以稳定能力编号关联菜单、规格、自动化证据和下一步；状态不等同于现实系统接入。</p>
        </div>
        <strong>{CAPABILITY_CATALOG.length} 项公开能力</strong>
      </header>

      <div aria-label="成熟度汇总" className="capability-summary">
        {maturityOrder.map((status) => (
          <button
            aria-pressed={maturity === status}
            className={`capability-summary-card capability-summary-card--${status}`}
            key={status}
            onClick={() => setMaturity((current) => current === status ? 'all' : status)}
            type="button"
          >
            <span>{CAPABILITY_MATURITY_LABELS[status]}</span>
            <strong>{counts[status]}</strong>
          </button>
        ))}
      </div>

      <section aria-label="能力筛选" className="capability-filter">
        <label>
          <span>检索能力</span>
          <input
            aria-label="检索能力"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="能力编号、名称、路径或规格"
            value={query}
          />
        </label>
        <label>
          <span>成熟度</span>
          <select
            aria-label="成熟度筛选"
            onChange={(event) => setMaturity(event.target.value as MaturityFilter)}
            value={maturity}
          >
            <option value="all">全部</option>
            {maturityOrder.map((status) => (
              <option key={status} value={status}>{CAPABILITY_MATURITY_LABELS[status]}</option>
            ))}
          </select>
        </label>
        <output aria-live="polite">当前显示 {visibleCapabilities.length} 项</output>
      </section>

      <div className="capability-table-wrap">
        <table className="capability-table">
          <thead>
            <tr>
              <th>能力与路径</th>
              <th>成熟度</th>
              <th>验证深度</th>
              <th>当前边界</th>
              <th>规格与下一步</th>
            </tr>
          </thead>
          <tbody>
            {visibleCapabilities.map((capability) => (
              <tr key={capability.id}>
                <td>
                  <strong>{capability.label}</strong>
                  <code>{capability.id}</code>
                  <small>{capability.path}</small>
                </td>
                <td>
                  <span className={`capability-status capability-status--${capability.maturity}`}>
                    {CAPABILITY_MATURITY_LABELS[capability.maturity]}
                  </span>
                </td>
                <td>{CAPABILITY_VERIFICATION_LABELS[capability.verification]}</td>
                <td>{capability.summary}</td>
                <td>
                  <code>{capability.specification}</code>
                  <small>{capability.nextAction}</small>
                </td>
              </tr>
            ))}
            {visibleCapabilities.length === 0 ? (
              <tr><td className="management-empty" colSpan={5}>没有符合条件的能力。</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
