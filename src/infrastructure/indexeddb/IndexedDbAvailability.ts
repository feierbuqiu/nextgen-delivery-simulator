export type IndexedDbIssueKind = 'blocked' | 'blocking' | 'terminated' | 'unavailable'

export type IndexedDbSource =
  | '登录与权限数据'
  | '客户数据'
  | '业务与交割数据'

export interface IndexedDbIssue {
  kind: IndexedDbIssueKind
  source: IndexedDbSource
  occurredAt: string
  detail: string
}

export type IndexedDbIssueReporter = (issue: IndexedDbIssue) => void

export function reportIndexedDbIssue(
  reporter: IndexedDbIssueReporter,
  source: IndexedDbSource,
  kind: IndexedDbIssueKind,
  error?: unknown,
): void {
  reporter({
    kind,
    source,
    occurredAt: new Date().toISOString(),
    detail: error instanceof Error ? error.message : '',
  })
}

export class IndexedDbAvailabilityMonitor {
  private issue: IndexedDbIssue | null = null
  private readonly listeners = new Set<() => void>()

  readonly report: IndexedDbIssueReporter = (issue) => {
    this.issue = structuredClone(issue)
    this.listeners.forEach((listener) => listener())
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): IndexedDbIssue | null => this.issue

  clear(): void {
    if (!this.issue) return
    this.issue = null
    this.listeners.forEach((listener) => listener())
  }
}

export const ignoreIndexedDbIssue: IndexedDbIssueReporter = () => undefined
