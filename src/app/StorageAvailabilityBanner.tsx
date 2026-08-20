import { useSyncExternalStore } from 'react'

import type {
  IndexedDbAvailabilityMonitor,
  IndexedDbIssue,
} from '../infrastructure/indexeddb/IndexedDbAvailability'

interface StorageAvailabilityBannerProps {
  monitor: IndexedDbAvailabilityMonitor
}

function issueMessage(issue: IndexedDbIssue): string {
  if (issue.kind === 'blocked') {
    return `${issue.source}打开被其他页面阻塞，当前页面不能确认持久化结果。`
  }
  if (issue.kind === 'blocking') {
    return `${issue.source}连接因其他页面升级而关闭，当前页面必须重新加载后才能继续。`
  }
  if (issue.kind === 'terminated') {
    return `${issue.source}连接意外中断，当前页面必须重新加载后才能继续。`
  }
  return `${issue.source}不可用；系统没有切换到临时内存，当前页面不会假装已经保存。`
}

export function StorageAvailabilityBanner({ monitor }: StorageAvailabilityBannerProps) {
  const issue = useSyncExternalStore(
    monitor.subscribe,
    monitor.getSnapshot,
    monitor.getSnapshot,
  )
  if (!issue) return null

  return (
    <aside className="storage-availability-banner" role="alert">
      <strong>本机数据连接异常</strong>
      <span>{issueMessage(issue)}</span>
      <small>请停止录入，关闭其他模拟器标签页或退出隐私模式后重新加载；不要清除站点数据。</small>
    </aside>
  )
}
