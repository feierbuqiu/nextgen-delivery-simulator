import type { ReactNode } from 'react'

export type ShellIconName =
  | 'workbench'
  | 'business'
  | 'dispatch'
  | 'special'
  | 'counter'
  | 'meter'
  | 'supplies'
  | 'commercial-bill'
  | 'invoice'
  | 'query'
  | 'points'
  | 'help'

const shellIconGlyphs: Record<ShellIconName, ReactNode> = {
  workbench: <><rect height="13" rx="1" width="18" x="3" y="3" /><path d="M8 21h8M12 16v5" /></>,
  business: <><path d="M3 7h7l2 2h9v11H3z" /><path d="M3 11h18M8 7V4h8v5" /></>,
  dispatch: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  special: <><path d="M4 3h12v18H4zM8 7h4M8 11h4M8 15h3" /><path d="M20 7v7M20 18v.1" /></>,
  counter: <><path d="M6 21V9a6 6 0 0 1 12 0v12M4 21h16M6 12h12M12 12v9" /><path d="M9 7h6" /></>,
  meter: <><path d="M8 3h8v5l3 4v4H5v-4l3-4Z" /><path d="M4 16h16v5H4zM9 12h6" /></>,
  supplies: <><path d="M4 3v18h17M8 17v-5M13 17V8M18 17V5" /></>,
  'commercial-bill': <><path d="M5 3h11l3 3v15H5zM16 3v4h4" /><path d="M8 11h8M8 15h8M8 18h5" /></>,
  invoice: <><path d="M6 3h12v18l-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  query: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  points: <><circle cx="12" cy="12" r="10" /><path d="m12 6 1.8 3.7 4.1.6-3 2.9.7 4.1-3.6-1.9-3.6 1.9.7-4.1-3-2.9 4.1-.6Z" /></>,
  help: <><circle cx="12" cy="12" r="10" /><path d="M9.6 9a2.7 2.7 0 1 1 4.7 1.8c-1.5 1.1-2.3 1.7-2.3 3.2M12 18v.1" /></>,
}

export function ShellIcon({ className, name }: { className?: string; name: ShellIconName }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
    >
      {shellIconGlyphs[name]}
    </svg>
  )
}
