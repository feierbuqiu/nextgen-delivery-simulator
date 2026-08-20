import { useMemo, useState } from 'react'

import { formatCents } from '../../domain/service/policy'
import type { ServiceSummary } from '../service/ServiceIntakePanel'

type NoticeFilter = 'all' | 'read' | 'unread'

const notices = [
  {
    id: 'notice-001',
    title: '营业渠道日常演练安排',
    date: '2026-08-03',
    read: false,
  },
  {
    id: 'notice-002',
    title: '服务窗口设备巡检提示',
    date: '2026-08-02',
    read: true,
  },
] as const

export function HomeDashboard({ summary }: { summary: ServiceSummary }) {
  const [noticeFilter, setNoticeFilter] = useState<NoticeFilter>('all')
  const visibleNotices = useMemo(() => notices.filter((notice) => {
    if (noticeFilter === 'read') return notice.read
    if (noticeFilter === 'unread') return !notice.read
    return true
  }), [noticeFilter])
  const todoRows = [
    summary.count > 0
      ? `当前有 ${summary.count} 笔业务等待结算，合计 ${formatCents(summary.totalCents)} 元`
      : '当前客户业务均已完成结算',
    '请完成当日营业台席检查',
  ]

  return (
    <section aria-label="主页信息" className="home-dashboard">
      <article className="home-panel home-notice-panel">
        <header className="home-panel-header">
          <h1><span aria-hidden="true">◖</span> 通知公告</h1>
          <div aria-label="公告状态筛选" className="home-filter-buttons" role="group">
            {([
              ['all', '全部'],
              ['read', '已读'],
              ['unread', '未读'],
            ] as const).map(([value, label]) => (
              <button
                aria-pressed={noticeFilter === value}
                className={noticeFilter === value ? 'home-filter-button home-filter-button--active' : 'home-filter-button'}
                key={value}
                onClick={() => setNoticeFilter(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </header>
        <div className="home-table-wrap">
          <table className="home-table">
            <thead>
              <tr><th>公告标题</th><th>时间</th></tr>
            </thead>
            <tbody>
              {visibleNotices.map((notice) => (
                <tr key={notice.id}>
                  <td>{notice.title}</td>
                  <td>{notice.date}</td>
                </tr>
              ))}
              {visibleNotices.length === 0 ? (
                <tr><td className="home-empty-cell" colSpan={2}>无数据</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <footer className="home-pagination" aria-label="通知公告分页">
          <button aria-label="公告上一页" disabled type="button">‹</button>
          <button aria-current="page" type="button">1</button>
          <button aria-label="公告下一页" disabled type="button">›</button>
          <span>到第</span><input aria-label="公告页码" defaultValue="1" inputMode="numeric" />
          <span>页</span><button type="button">确定</button>
          <span>共 {visibleNotices.length} 条</span>
          <select aria-label="公告每页条数" defaultValue="10"><option value="10">10条/页</option></select>
        </footer>
      </article>

      <article className="home-panel home-warning-panel">
        <header className="home-panel-header">
          <h2><span aria-hidden="true">↻</span> 预警预报信息</h2>
        </header>
        <div className="home-table-wrap">
          <table className="home-table">
            <thead><tr><th>报警项目</th><th>报警日期</th></tr></thead>
            <tbody><tr><td className="home-empty-cell" colSpan={2}>无数据</td></tr></tbody>
          </table>
        </div>
      </article>

      <article aria-label="营业服务主题图" className="home-year-banner">
        <div className="home-year-shape home-year-shape--one" />
        <div className="home-year-shape home-year-shape--two" />
        <strong>2026</strong>
        <span>新一代营业服务</span>
      </article>

      <article className="home-panel home-todo-panel">
        <header className="home-panel-header">
          <h2><span aria-hidden="true">◷</span> 待办事宜</h2>
        </header>
        <div className="home-table-wrap">
          <table className="home-table">
            <thead><tr><th>待办事宜</th><th>待办日期</th></tr></thead>
            <tbody>
              {todoRows.map((todo, index) => (
                <tr key={todo}><td>{todo}</td><td>{index === 0 ? '2026-08-03' : '2026-08-04'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="home-pagination" aria-label="待办事宜分页">
          <button aria-label="待办上一页" disabled type="button">‹</button>
          <button aria-current="page" type="button">1</button>
          <button aria-label="待办下一页" disabled type="button">›</button>
          <span>共 {todoRows.length} 条</span>
          <select aria-label="待办每页条数" defaultValue="10"><option value="10">10条/页</option></select>
        </footer>
      </article>
    </section>
  )
}
