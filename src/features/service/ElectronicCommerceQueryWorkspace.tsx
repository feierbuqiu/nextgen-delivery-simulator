import { useEffect, useMemo, useState } from 'react'

import {
  ELECTRONIC_COMMERCE_PROJECTS,
  electronicCommerceStatusLabel,
  maskElectronicCommerceAccount,
  queryElectronicCommerceRecords,
  type ElectronicCommerceQuery,
} from '../../domain/service/electronicCommerce'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import { pendingServiceSummary } from '../../domain/service/transactions'
import type {
  ElectronicCommerceProjectId,
  ElectronicCommerceRecord,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'
import type { ServiceSummary } from './ServiceIntakePanel'
import {
  CorrectionWorkspaceTabs,
  type CorrectionWorkspaceKind,
} from './CorrectionWorkspaceTabs'

interface ElectronicCommerceQueryWorkspaceProps {
  repository: ServiceRepository
  onBack: () => void
  onOpenAcceptanceQuery: () => void
  onOpenChannelProductQuery: () => void
  onSelectWorkspace?: (workspace: CorrectionWorkspaceKind) => void
  onSummaryChange: (summary: ServiceSummary) => void
}

const DEMO_DATE = '2026-08-10'

function defaultQuery(): ElectronicCommerceQuery {
  return {
    projectId: '',
    status: '',
    operatorId: '',
    acceptedDateFrom: DEMO_DATE,
    acceptedDateTo: DEMO_DATE,
  }
}

export function ElectronicCommerceQueryWorkspace({
  repository,
  onBack,
  onOpenAcceptanceQuery,
  onOpenChannelProductQuery,
  onSelectWorkspace,
  onSummaryChange,
}: ElectronicCommerceQueryWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState<ElectronicCommerceQuery>(defaultQuery)
  const [appliedQuery, setAppliedQuery] = useState<ElectronicCommerceQuery | null>(null)
  const [detail, setDetail] = useState<ElectronicCommerceRecord | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      onSummaryChange(pendingServiceSummary(loaded))
    })
    return () => {
      active = false
    }
  }, [onSummaryChange, repository])

  const results = useMemo(
    () => appliedQuery && workspace
      ? queryElectronicCommerceRecords(workspace.electronicCommerceRecords, appliedQuery)
      : [],
    [appliedQuery, workspace],
  )

  function runQuery(): void {
    setAppliedQuery(structuredClone(query))
    setNotice('查询完成。')
  }

  function resetQuery(): void {
    setQuery(defaultQuery())
    setAppliedQuery(null)
    setNotice('')
  }

  function selectWorkspace(target: CorrectionWorkspaceKind): void {
    if (onSelectWorkspace) {
      onSelectWorkspace(target)
      return
    }
    if (target === 'acceptance') onOpenAcceptanceQuery()
    if (target === 'channel-products') onOpenChannelProductQuery()
  }

  if (!workspace) {
    return <section className="transaction-query transaction-query--loading">正在读取电子商务查改数据…</section>
  }

  return (
    <>
      <div className="transaction-query electronic-commerce-query">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业工作台</button><span>/</span><span>查改处理</span><span>/</span><strong>电子商务查改</strong>
        </div>

        <CorrectionWorkspaceTabs active="electronic-commerce" onSelect={selectWorkspace} />

        <section aria-label="电子商务查改查询条件" className="correction-query-panel electronic-commerce-query__filters">
          <div className="correction-query-grid">
            <label><span>查改项目</span><select aria-label="电子商务查改项目" onChange={(event) => setQuery((current) => ({ ...current, projectId: event.target.value as '' | ElectronicCommerceProjectId }))} value={query.projectId}><option value="">全部</option>{ELECTRONIC_COMMERCE_PROJECTS.map((project) => <option key={project.id} value={project.id}>{project.label}</option>)}</select></label>
            <label><span>缴费状态</span><select aria-label="电子商务缴费状态" onChange={(event) => setQuery((current) => ({ ...current, status: event.target.value as ElectronicCommerceQuery['status'] }))} value={query.status}><option value="">全部</option><option value="pending-settlement">待结算</option><option value="settled">成功</option></select></label>
            <label><span>收寄员工</span><input aria-label="电子商务收寄员工" onChange={(event) => setQuery((current) => ({ ...current, operatorId: event.target.value }))} placeholder="员工号或姓名" value={query.operatorId} /></label>
            <label><span>交易日期</span><input aria-label="电子商务开始日期" onChange={(event) => setQuery((current) => ({ ...current, acceptedDateFrom: event.target.value }))} type="date" value={query.acceptedDateFrom} /></label>
            <label><span>至</span><input aria-label="电子商务结束日期" onChange={(event) => setQuery((current) => ({ ...current, acceptedDateTo: event.target.value }))} type="date" value={query.acceptedDateTo} /></label>
          </div>
          <div className="correction-query-actions"><button className="primary-button primary-button--compact" onClick={runQuery} type="button">查询</button><button className="secondary-button secondary-button--small" onClick={resetQuery} type="button">重置</button></div>
        </section>

        <section aria-label="电子商务查改结果" className="correction-result-panel">
          <div className="settlement-table-wrap">
            <table className="settlement-table electronic-commerce-query__table">
              <thead><tr><th>序号</th><th>电商流水号</th><th>缴费充值项目</th><th>缴费账号</th><th>户名</th><th>地址</th><th>缴费充值金额</th><th>缴费充值日期</th><th>缴费充值状态</th><th>操作</th></tr></thead>
              <tbody>
                {results.map((record, index) => <tr key={record.id}><td>{index + 1}</td><td>{record.id}</td><td>{record.providerLabel} / {record.projectLabel}</td><td>{maskElectronicCommerceAccount(record.accountNumber)}</td><td>{record.customerName}</td><td>{record.customerAddress}</td><td>{formatCents(record.amountCents)}</td><td>{record.acceptedAt.replace('T', ' ').slice(0, 19)}</td><td>{electronicCommerceStatusLabel(record.status)}</td><td><button className="table-action" onClick={() => setDetail(record)} type="button">客户详情</button></td></tr>)}
                {appliedQuery && results.length === 0 ? <tr><td className="settlement-empty" colSpan={10}>无数据</td></tr> : null}
              </tbody>
            </table>
          </div>
          {notice ? <p className="customer-notice" role="status">{notice} 共 {results.length} 条记录。</p> : null}
        </section>
      </div>

      {detail ? (
        <Modal description="电子商务缴费客户信息只读展示。" eyebrow="电子商务查改" title="客户详情">
          <div className="modal-form electronic-commerce-query__detail">
            <dl>
              <div><dt>电商流水号</dt><dd>{detail.id}</dd></div>
              <div><dt>缴费充值项目</dt><dd>{detail.projectLabel}</dd></div>
              <div><dt>缴费单位</dt><dd>{detail.providerLabel}</dd></div>
              <div><dt>缴费账号</dt><dd>{detail.accountNumber}</dd></div>
              <div><dt>用户户名</dt><dd>{detail.customerName}</dd></div>
              <div><dt>用户地址</dt><dd>{detail.customerAddress}</dd></div>
              <div><dt>缴费充值金额</dt><dd>{formatCents(detail.amountCents)} 元</dd></div>
              <div><dt>缴费充值状态</dt><dd>{electronicCommerceStatusLabel(detail.status)}</dd></div>
            </dl>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setDetail(null)} type="button">关闭</button></div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
