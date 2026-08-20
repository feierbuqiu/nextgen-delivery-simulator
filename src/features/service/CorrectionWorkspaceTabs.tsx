export type CorrectionWorkspaceKind =
  | 'acceptance'
  | 'postal-supplies'
  | 'electronic-commerce'
  | 'supplementary-traffic'
  | 'channel-products'

interface CorrectionWorkspaceTabsProps {
  active: CorrectionWorkspaceKind
  onSelect?: (workspace: CorrectionWorkspaceKind) => void
}

const IMPLEMENTED_TABS: Array<{ id: CorrectionWorkspaceKind; label: string }> = [
  { id: 'acceptance', label: '收寄查改' },
  { id: 'postal-supplies', label: '用邮物品查改' },
  { id: 'electronic-commerce', label: '电子商务查改' },
  { id: 'supplementary-traffic', label: '补录/交管查改' },
  { id: 'channel-products', label: '商品销售查改' },
]

export function CorrectionWorkspaceTabs({
  active,
  onSelect,
}: CorrectionWorkspaceTabsProps) {
  const implemented = new Map(IMPLEMENTED_TABS.map((tab) => [tab.id, tab]))
  const entries: Array<
    | { kind: 'implemented'; id: CorrectionWorkspaceKind; label: string }
    | { kind: 'deferred'; label: string }
  > = [
    { kind: 'implemented', ...implemented.get('acceptance')! },
    { kind: 'deferred', label: '报刊查改' },
    { kind: 'deferred', label: '集邮查改' },
    { kind: 'implemented', ...implemented.get('postal-supplies')! },
    { kind: 'implemented', ...implemented.get('electronic-commerce')! },
    { kind: 'deferred', label: '分销查改' },
    { kind: 'implemented', ...implemented.get('supplementary-traffic')! },
    { kind: 'implemented', ...implemented.get('channel-products')! },
  ]

  return (
    <nav aria-label="查改业务类别" className="correction-tabs">
      {entries.map((entry) => {
        if (entry.kind === 'deferred') {
          return (
            <button
              aria-disabled="true"
              className="correction-tab"
              key={entry.label}
              title="当前范围暂缓建设"
              type="button"
            >
              {entry.label}
            </button>
          )
        }
        const isActive = entry.id === active
        return (
          <button
            aria-current={isActive ? 'page' : undefined}
            className={isActive ? 'correction-tab correction-tab--active' : 'correction-tab'}
            key={entry.id}
            onClick={isActive || !onSelect ? undefined : () => onSelect(entry.id)}
            type="button"
          >
            {entry.label}
          </button>
        )
      })}
    </nav>
  )
}
