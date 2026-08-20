import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import type { CustomerRepository } from '../../domain/customer/repository'
import type { CustomerWorkspaceState, Gender, IdentityType } from '../../domain/customer/types'
import {
  maskBusinessCustomerPhone,
  queryBusinessCustomer,
  type BusinessCustomerProfile,
} from '../../domain/customer/businessCustomerQuery'

interface BusinessCustomerQueryWorkspaceProps {
  repository: CustomerRepository
  onBack: () => void
  clock?: () => Date
}

const identityTypeLabels: Record<IdentityType, string> = {
  '': '—',
  primary: '居民身份证',
  temporary: '临时身份证明',
  residence: '居住证',
  travel: '其他旅行证件',
}

const genderLabels: Record<Gender, string> = {
  '': '—',
  female: '女',
  male: '男',
  unspecified: '未说明',
}

const additionalUnavailableProfileFields = [
  ['会员积分', '营业客户会员积分'],
  ['客户忠诚度', '营业客户忠诚度'],
  ['消费等级', '营业客户消费等级'],
  ['题材偏好', '营业客户题材偏好'],
  ['店铺偏好', '营业客户店铺偏好'],
  ['价格偏好', '营业客户价格偏好'],
  ['渠道偏好', '营业客户渠道偏好'],
  ['退换货次数', '营业客户退换货次数'],
  ['拒绝次数', '营业客户拒绝次数'],
  ['消费时间', '营业客户消费时间'],
  ['消费内容', '营业客户消费内容'],
  ['消费价格', '营业客户消费价格'],
  ['消费渠道', '营业客户消费渠道'],
] as const

function Breadcrumb({ onBack }: { onBack: () => void }) {
  return <div className="customer-breadcrumb">
    <button onClick={onBack} type="button">主页</button>
    <span>/</span>
    <span>查询</span>
    <span>/</span>
    <strong>营业客户查询</strong>
  </div>
}

function ReadOnlyField({
  label,
  accessibleLabel,
  value,
}: {
  label: string
  accessibleLabel: string
  value: string
}) {
  return <label>
    <span>{label}：</span>
    <input aria-label={accessibleLabel} readOnly value={value || '—'} />
  </label>
}

function CustomerProfile({ profile }: { profile: BusinessCustomerProfile }) {
  return <section aria-label="营业客户查询结果" className="business-customer-query__result">
    <header>
      <strong>{profile.name}</strong>
      <span>{profile.source === 'agreement-account' ? '协议客户资料' : '历史寄件客户资料'}</span>
    </header>
    <div className="business-customer-query__profile-grid">
      <ReadOnlyField accessibleLabel="营业客户姓名" label="姓名" value={profile.name} />
      <ReadOnlyField accessibleLabel="营业客户性别" label="性别" value={genderLabels[profile.gender]} />
      <ReadOnlyField accessibleLabel="营业客户年龄" label="年龄" value={profile.age === null ? '—' : String(profile.age)} />
      <ReadOnlyField accessibleLabel="营业客户生日" label="生日" value={profile.birthDate} />
      <ReadOnlyField accessibleLabel="营业客户地域" label="地域" value={profile.region} />
      <ReadOnlyField accessibleLabel="营业客户职业" label="职业" value="—" />
      <ReadOnlyField accessibleLabel="营业客户手机号" label="手机号" value={maskBusinessCustomerPhone(profile.phone)} />
      <ReadOnlyField accessibleLabel="营业客户微信号" label="微信号" value="—" />
      <ReadOnlyField accessibleLabel="营业客户证件类型" label="证件类型" value={identityTypeLabels[profile.identityType]} />
      <ReadOnlyField accessibleLabel="营业客户代金客户标志" label="代金客户" value="—" />
      <ReadOnlyField accessibleLabel="营业客户保险客户标志" label="保险客户" value="—" />
      <ReadOnlyField accessibleLabel="营业客户证券客户标志" label="证券客户" value="—" />
      {additionalUnavailableProfileFields.map(([label, accessibleLabel]) => (
        <ReadOnlyField
          accessibleLabel={accessibleLabel}
          key={accessibleLabel}
          label={label}
          value="—"
        />
      ))}
    </div>
    <p className="business-customer-query__boundary">
      查询范围为当前浏览器保存的本网点客户台账；上级 CRM、保险、证券和消费画像未接入，相关字段不生成模拟结果。
    </p>
  </section>
}

export function BusinessCustomerQueryWorkspace({
  repository,
  onBack,
  clock = () => new Date(),
}: BusinessCustomerQueryWorkspaceProps) {
  const [workspace, setWorkspace] = useState<CustomerWorkspaceState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [phone, setPhone] = useState('')
  const [identityValue, setIdentityValue] = useState('')
  const [result, setResult] = useState<BusinessCustomerProfile | null | undefined>()
  const [queryError, setQueryError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      setLoading(false)
    }).catch((error: unknown) => {
      if (!active) return
      setLoading(false)
      setLoadError(error instanceof Error ? error.message : '客户数据读取失败。')
    })
    return () => {
      active = false
    }
  }, [loadAttempt, repository])

  function runQuery(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!workspace) return
    try {
      setResult(queryBusinessCustomer(workspace, { phone, identityValue }, clock()))
      setQueryError('')
    } catch (error) {
      setResult(undefined)
      setQueryError(error instanceof Error ? error.message : '营业客户查询失败。')
    }
  }

  if (loading) return <section className="channel-query-workspace business-customer-query-workspace">
    <Breadcrumb onBack={onBack} />
    <p aria-live="polite" role="status">正在读取营业客户资料……</p>
  </section>

  if (loadError || !workspace) return <section className="channel-query-workspace business-customer-query-workspace">
    <Breadcrumb onBack={onBack} />
    <div className="business-customer-query__load-error">
      <p role="alert">营业客户资料读取失败：{loadError || '客户数据不可用。'}</p>
      <button onClick={() => {
        setLoading(true)
        setLoadError('')
        setWorkspace(null)
        setLoadAttempt((attempt) => attempt + 1)
      }} type="button">重新读取</button>
    </div>
  </section>

  return <section className="channel-query-workspace business-customer-query-workspace">
    <Breadcrumb onBack={onBack} />
    <section aria-label="营业客户查询条件" className="business-customer-query__conditions">
      <header><span>⌄</span><strong>查询条件</strong></header>
      <form onSubmit={runQuery}>
        <label>
          <span>手机号：</span>
          <input
            aria-label="手机号"
            inputMode="numeric"
            maxLength={11}
            onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
            placeholder="请输入手机号"
            value={phone}
          />
        </label>
        <label>
          <span>证件号：</span>
          <input
            aria-label="证件号"
            maxLength={20}
            onChange={(event) => setIdentityValue(event.target.value)}
            placeholder="请输入证件号"
            value={identityValue}
          />
        </label>
        <button type="submit">查询</button>
      </form>
    </section>

    {queryError ? <p className="customer-form-error business-customer-query__query-error" role="alert">{queryError}</p> : null}
    {result ? <CustomerProfile profile={result} /> : null}
    {result === null ? <p className="business-customer-query__empty" role="status">未查询到符合条件的营业客户记录。</p> : null}
  </section>
}
