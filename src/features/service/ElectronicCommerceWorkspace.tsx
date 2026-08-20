import { useEffect, useMemo, useState } from 'react'

import {
  ELECTRONIC_COMMERCE_PROJECTS,
  electronicCommerceExampleAccount,
  electronicCommerceProject,
  resolveElectronicCommerceAccount,
  type ElectronicCommerceAccount,
} from '../../domain/service/electronicCommerce'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import { pendingServiceSummary } from '../../domain/service/transactions'
import type {
  ElectronicCommerceProjectId,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { CurrencyInput } from '../../ui/CurrencyInput'
import { Modal } from '../../ui/Modal'
import type { ServiceSummary } from './ServiceIntakePanel'

interface ElectronicCommerceWorkspaceProps {
  repository: ServiceRepository
  onOpenSettlement: () => void
  onSummaryChange: (summary: ServiceSummary) => void
}

type CommerceTab = 'utility-payment' | 'phone-topup'

const DEMO_ACCEPTED_AT = '2026-08-10T10:20:00.000Z'

export function ElectronicCommerceWorkspace({
  repository,
  onOpenSettlement,
  onSummaryChange,
}: ElectronicCommerceWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [activeTab, setActiveTab] = useState<CommerceTab>('utility-payment')
  const [projectId, setProjectId] = useState<ElectronicCommerceProjectId>('water')
  const [providerId, setProviderId] = useState('lanjing-water')
  const [accountNumber, setAccountNumber] = useState('')
  const [account, setAccount] = useState<ElectronicCommerceAccount | null>(null)
  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

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

  const projects = useMemo(
    () => ELECTRONIC_COMMERCE_PROJECTS.filter((project) => project.kind === activeTab),
    [activeTab],
  )
  const project = electronicCommerceProject(projectId)

  function clearLookup(): void {
    setAccountNumber('')
    setAccount(null)
    setAmountCents(null)
    setConfirmOpen(false)
    setError('')
  }

  function switchTab(tab: CommerceTab): void {
    const first = ELECTRONIC_COMMERCE_PROJECTS.find((candidate) => candidate.kind === tab)!
    setActiveTab(tab)
    setProjectId(first.id)
    setProviderId(first.providers[0]!.id)
    setNotice('')
    clearLookup()
  }

  function chooseProject(nextProjectId: ElectronicCommerceProjectId): void {
    const nextProject = ELECTRONIC_COMMERCE_PROJECTS.find((candidate) => candidate.id === nextProjectId)!
    setProjectId(nextProjectId)
    setProviderId(nextProject.providers[0]!.id)
    setNotice('')
    clearLookup()
  }

  function queryAccount(): void {
    if (!workspace) return
    try {
      const found = resolveElectronicCommerceAccount(
        workspace,
        project.id,
        providerId,
        accountNumber,
      )
      setAccount(found)
      setAmountCents(found.dueAmountCents)
      setNotice('查询成功。')
      setError('')
    } catch (caught) {
      setAccount(null)
      setAmountCents(null)
      setNotice('')
      setError(caught instanceof Error ? caught.message : '缴费账户查询失败。')
    }
  }

  function prepareSubmit(): void {
    if (!account) {
      setError('请先查询缴费账户。')
      return
    }
    if (amountCents === null || amountCents < 1) {
      setError(activeTab === 'utility-payment' ? '请输入缴费金额。' : '请输入充值金额。')
      return
    }
    if (activeTab === 'utility-payment' && amountCents !== account.dueAmountCents) {
      setError('缴费金额必须与应缴总额一致。')
      return
    }
    if (activeTab === 'phone-topup' && (amountCents < 100 || amountCents > 50000)) {
      setError('话费充值金额须为 1.00 至 500.00 元。')
      return
    }
    setConfirmOpen(true)
    setError('')
  }

  async function confirmSubmit(): Promise<void> {
    if (!workspace || !account || amountCents === null || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const accepted = await repository.acceptElectronicCommerce({
        acceptedAt: DEMO_ACCEPTED_AT,
        projectId: project.id,
        providerId,
        accountNumber: account.accountNumber,
        amountCents,
      })
      setWorkspace(accepted.state)
      onSummaryChange(pendingServiceSummary(accepted.state))
      setConfirmOpen(false)
      setAccountNumber('')
      setAccount(null)
      setAmountCents(null)
      setNotice(`业务录入成功：${accepted.record.id}，请进入结算中心。`)
    } catch (caught) {
      setConfirmOpen(false)
      setError(caught instanceof Error ? caught.message : '电子商务业务录入失败。')
    } finally {
      setSubmitting(false)
    }
  }

  if (!workspace) {
    return <section className="electronic-commerce electronic-commerce--loading">正在读取电子商务业务…</section>
  }

  return (
    <>
      <section aria-label="电子商务" className="electronic-commerce">
        <div className="electronic-commerce__heading">
          <strong>电子商务</strong>
          <button className="settlement-jump-button" onClick={onOpenSettlement} type="button">
            结算中心（{pendingServiceSummary(workspace).count}）
          </button>
        </div>

        <nav aria-label="电子商务业务" className="electronic-commerce__tabs" role="tablist">
          <button aria-selected={activeTab === 'utility-payment'} className={activeTab === 'utility-payment' ? 'is-active' : ''} onClick={() => switchTab('utility-payment')} role="tab" type="button">生活缴费</button>
          <button aria-selected={activeTab === 'phone-topup'} className={activeTab === 'phone-topup' ? 'is-active' : ''} onClick={() => switchTab('phone-topup')} role="tab" type="button">话费充值</button>
        </nav>

        <div className="electronic-commerce__body">
          <div className="electronic-commerce__form">
            <label>
              <span>缴费项目：</span>
              <select aria-label="缴费项目" onChange={(event) => chooseProject(event.target.value as ElectronicCommerceProjectId)} value={project.id}>
                {projects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
              </select>
            </label>
            <label>
              <span>缴费单位：</span>
              <select aria-label="缴费单位" onChange={(event) => { setProviderId(event.target.value); setAccount(null); setAmountCents(null); setError(''); setNotice('') }} value={providerId}>
                {project.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
              </select>
            </label>
            <label className="electronic-commerce__account-row">
              <span>{project.accountLabel}：</span>
              <input
                aria-label={project.accountLabel}
                inputMode="numeric"
                onChange={(event) => { setAccountNumber(event.target.value.replace(/\D/g, '').slice(0, 20)); setAccount(null); setAmountCents(null); setError(''); setNotice('') }}
                placeholder={`请输入${project.accountLabel}，如 ${electronicCommerceExampleAccount(project.id)}`}
                value={accountNumber}
              />
              <button className="electronic-commerce__query" onClick={queryAccount} type="button">查询</button>
            </label>
            <label>
              <span>{activeTab === 'utility-payment' ? '缴费金额：' : '充值金额：'}</span>
              <CurrencyInput aria-label={activeTab === 'utility-payment' ? '缴费金额' : '充值金额'} onValueChange={(value) => { setAmountCents(value); setError(''); setNotice('') }} valueCents={amountCents} />
            </label>
            <div className="electronic-commerce__actions">
              <button className="electronic-commerce__submit" onClick={prepareSubmit} type="button">提交</button>
              <button className="electronic-commerce__cancel" onClick={() => { clearLookup(); setNotice('') }} type="button">取消</button>
            </div>
          </div>

          <dl className="electronic-commerce__account-summary" aria-label="缴费账户信息">
            <div><dt>用户户名：</dt><dd>{account?.customerName ?? ''}</dd></div>
            <div><dt>用户地址：</dt><dd>{account?.customerAddress ?? ''}</dd></div>
            <div>
              <dt>{activeTab === 'utility-payment' ? '应缴总额：' : '账户余额：'}</dt>
              <dd>{account ? `${formatCents(activeTab === 'utility-payment' ? account.dueAmountCents! : account.accountBalanceCents!)} 元` : ''}</dd>
            </div>
          </dl>
        </div>

        {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
      </section>

      {confirmOpen ? (
        <Modal description="业务提交后不能撤销。" eyebrow="电子商务" title="确认信息">
          <div className="modal-form electronic-commerce__confirm">
            <p>业务不支持撤销，请核准缴费号码，是否提交？</p>
            <dl>
              <div><dt>缴费项目</dt><dd>{project.label}</dd></div>
              <div><dt>{project.accountLabel}</dt><dd>{account?.accountNumber}</dd></div>
              <div><dt>用户户名</dt><dd>{account?.customerName}</dd></div>
              <div><dt>{activeTab === 'utility-payment' ? '缴费金额' : '充值金额'}</dt><dd>{formatCents(amountCents ?? 0)} 元</dd></div>
            </dl>
            <div className="modal-actions">
              <button className="secondary-button" disabled={submitting} onClick={() => setConfirmOpen(false)} type="button">取消</button>
              <button className="primary-button primary-button--compact" disabled={submitting} onClick={() => void confirmSubmit()} type="button">{submitting ? '正在提交…' : '确定'}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
