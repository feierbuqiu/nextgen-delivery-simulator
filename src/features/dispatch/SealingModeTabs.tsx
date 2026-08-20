export type SealingSection = 'unsealed' | 'sealed' | 'loose-outbound' | 'sorting'

interface SealingModeTabsProps {
  active: SealingSection
  onSelect: (section: SealingSection) => void
}

const TABS: ReadonlyArray<{ id: SealingSection; label: string }> = [
  { id: 'unsealed', label: '未封发处理' },
  { id: 'sealed', label: '已封发查改' },
  { id: 'loose-outbound', label: '散件外走' },
  { id: 'sorting', label: '分拣封发' },
]

export function SealingModeTabs({ active, onSelect }: SealingModeTabsProps) {
  return (
    <nav aria-label="封发处理类别" className="mail-handover__tabs">
      {TABS.map((tab) => (
        <button
          aria-current={active === tab.id ? 'page' : undefined}
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
