import {
  useState,
  type FormEvent,
} from 'react'

import {
  approveAgreementApplication,
  localAgreementTimestamp,
  submitAgreementApplication,
  validateAgreementApplication,
  type AgreementApplicationDraft,
  type AgreementApplicationErrors,
} from '../../domain/customer/agreement'
import type { CustomerRepository } from '../../domain/customer/repository'
import type {
  AgreementAccount,
  CustomerWorkspaceState,
  Gender,
  IdentityType,
} from '../../domain/customer/types'
import { Modal } from '../../ui/Modal'

type RegistrationView = 'registration' | 'query'

interface AgreementCustomerRegistrationModalProps {
  customerRepository: CustomerRepository
  customerState: CustomerWorkspaceState
  initialView: RegistrationView
  onApproved: (
    state: CustomerWorkspaceState,
    account: AgreementAccount,
  ) => void
  onClose: () => void
  onStateChange: (state: CustomerWorkspaceState) => void
}

const customerTypeLabels = {
  individual: '个人',
  organization: '单位',
} as const

const applicationStatusLabels = {
  pending: '待审批',
  approved: '已通过',
  rejected: '未通过',
} as const

function emptyApplicationDraft(): AgreementApplicationDraft {
  return {
    appliedAt: localAgreementTimestamp(),
    legalName: '',
    shortName: '',
    customerType: 'individual',
    identityType: '',
    identityValue: '',
    contact: '',
    senderName: '',
    gender: 'unspecified',
    detailedAddress: '',
    unit: '',
    postalCode: '',
    mnemonic: '',
    expectedItemCount: 6,
    productCategoryCode: '200',
    paymentMethod: 'cash-settlement',
    allowCredit: false,
    businessScope: '大宗给据函件收寄',
    certificateFileName: '',
    contractFileName: '',
  }
}

function FieldError({ message }: { message?: string }) {
  return message ? <span className="customer-field-error">{message}</span> : null
}

export function AgreementCustomerRegistrationModal({
  customerRepository,
  customerState,
  initialView,
  onApproved,
  onClose,
  onStateChange,
}: AgreementCustomerRegistrationModalProps) {
  const [view, setView] = useState<RegistrationView>(initialView)
  const [workspace, setWorkspace] = useState(customerState)
  const [draft, setDraft] = useState<AgreementApplicationDraft>(emptyApplicationDraft)
  const [errors, setErrors] = useState<AgreementApplicationErrors>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  function update<K extends keyof AgreementApplicationDraft>(
    key: K,
    value: AgreementApplicationDraft[K],
  ): void {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }))
  }

  async function submitApplication(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    const validation = validateAgreementApplication(draft)
    if (Object.keys(validation).length > 0) {
      setErrors(validation)
      return
    }
    setBusy(true)
    try {
      const submitted = submitAgreementApplication(workspace, draft)
      const persisted = await customerRepository.restore(submitted.state)
      setWorkspace(persisted)
      onStateChange(persisted)
      setView('query')
      setMessage(`申请 ${submitted.application.id} 已提交。`)
    } catch (caught) {
      setErrors({
        form: caught instanceof Error
          ? caught.message
          : '协议客户注册申请提交失败。',
      })
    } finally {
      setBusy(false)
    }
  }

  async function approve(applicationId: string): Promise<void> {
    setBusy(true)
    setErrors({})
    try {
      const approved = approveAgreementApplication(
        workspace,
        applicationId,
        new Date().toISOString(),
      )
      const persisted = await customerRepository.restore(approved.state)
      setWorkspace(persisted)
      onStateChange(persisted)
      onApproved(persisted, approved.account)
    } catch (caught) {
      setErrors({
        form: caught instanceof Error
          ? caught.message
          : '协议客户注册申请审批失败。',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal eyebrow="协议客户管理" title="协议客户注册申请" wide>
      <div className="agreement-registration-modal">
        <nav aria-label="协议客户注册页签" className="agreement-registration-tabs">
          <button
            aria-current={view === 'registration' ? 'page' : undefined}
            onClick={() => setView('registration')}
            type="button"
          >
            协议客户注册
          </button>
          <button
            aria-current={view === 'query' ? 'page' : undefined}
            onClick={() => setView('query')}
            type="button"
          >
            协议客户申请查询
          </button>
        </nav>

        {view === 'registration' ? (
          <form className="modal-form agreement-registration-form" onSubmit={(event) => void submitApplication(event)}>
            <section className="agreement-registration-section">
              <header>协议客户基本信息</header>
              <div className="agreement-registration-grid">
                <label className="agreement-registration-wide"><span><b>*</b> 法定客户名称</span><input aria-label="法定客户名称" onChange={(event) => update('legalName', event.target.value)} value={draft.legalName} /><FieldError message={errors.legalName} /></label>
                <label><span><b>*</b> 客户简称</span><input aria-label="客户简称" onChange={(event) => update('shortName', event.target.value)} value={draft.shortName} /><FieldError message={errors.shortName} /></label>
                <label><span><b>*</b> 客户类型</span><select aria-label="协议客户类型" onChange={(event) => update('customerType', event.target.value as AgreementApplicationDraft['customerType'])} value={draft.customerType}><option value="individual">个人</option><option value="organization">单位</option></select></label>
                <label><span><b>*</b> 证件类型</span><select aria-label="协议客户证件类型" onChange={(event) => update('identityType', event.target.value as IdentityType)} value={draft.identityType}><option value="">请选择</option><option value="primary">居民身份证</option><option value="temporary">临时身份证</option><option value="residence">居住证</option><option value="travel">其他旅行证件</option></select><FieldError message={errors.identityType} /></label>
                <label><span><b>*</b> 证件号码</span><input aria-label="协议客户证件号码" maxLength={20} onChange={(event) => update('identityValue', event.target.value)} value={draft.identityValue} /><FieldError message={errors.identityValue} /></label>
                <label><span><b>*</b> 联系电话</span><input aria-label="协议客户联系电话" onChange={(event) => update('contact', event.target.value)} value={draft.contact} /><FieldError message={errors.contact} /></label>
                <label><span><b>*</b> 寄件人姓名</span><input aria-label="协议客户寄件人姓名" onChange={(event) => update('senderName', event.target.value)} value={draft.senderName} /><FieldError message={errors.senderName} /></label>
                <label><span>性别</span><select aria-label="协议客户性别" onChange={(event) => update('gender', event.target.value as Gender)} value={draft.gender}><option value="unspecified">未说明</option><option value="female">女</option><option value="male">男</option></select></label>
                <label><span>单位</span><input aria-label="协议客户单位" onChange={(event) => update('unit', event.target.value)} value={draft.unit} /></label>
                <label className="agreement-registration-wide"><span><b>*</b> 详细地址</span><input aria-label="协议客户详细地址" onChange={(event) => update('detailedAddress', event.target.value)} value={draft.detailedAddress} /><FieldError message={errors.detailedAddress} /></label>
                <label><span>邮编</span><input aria-label="协议客户邮编" inputMode="numeric" maxLength={6} onChange={(event) => update('postalCode', event.target.value)} value={draft.postalCode} /><FieldError message={errors.postalCode} /></label>
              </div>
            </section>

            <section className="agreement-registration-section">
              <header>业务关系信息</header>
              <div className="agreement-registration-grid">
                <label><span><b>*</b> 输入简码</span><input aria-label="协议客户输入简码" maxLength={12} onChange={(event) => update('mnemonic', event.target.value.toUpperCase())} value={draft.mnemonic} /><FieldError message={errors.mnemonic} /></label>
                <label><span><b>*</b> 预计交寄件数</span><input aria-label="协议客户预计交寄件数" min="1" onChange={(event) => update('expectedItemCount', Number(event.target.value))} type="number" value={draft.expectedItemCount} /><FieldError message={errors.expectedItemCount} /></label>
                <label><span><b>*</b> 产品类别</span><select aria-label="协议客户产品类别" onChange={(event) => update('productCategoryCode', event.target.value)} value={draft.productCategoryCode}><option value="200">给据函件（200）</option><option value="220">给据明信片（220）</option><option value="300">普通包裹（300）</option><option value="310">快递包裹（310）</option></select><FieldError message={errors.productCategoryCode} /></label>
                <label><span><b>*</b> 付费方式</span><select aria-label="协议客户付费方式" onChange={(event) => { const paymentMethod = event.target.value as AgreementApplicationDraft['paymentMethod']; update('paymentMethod', paymentMethod); if (paymentMethod === 'cash-settlement') update('allowCredit', false) }} value={draft.paymentMethod}><option value="cash-settlement">现结</option><option value="credit">记欠</option></select></label>
                <fieldset className="agreement-registration-choice"><legend>是否允许记欠</legend><label><input checked={draft.allowCredit} disabled={draft.paymentMethod !== 'credit'} onChange={(event) => update('allowCredit', event.target.checked)} type="checkbox" />是</label><FieldError message={errors.allowCredit} /></fieldset>
                <label className="agreement-registration-wide"><span><b>*</b> 业务范围</span><textarea aria-label="协议客户业务范围" onChange={(event) => update('businessScope', event.target.value)} rows={2} value={draft.businessScope} /><FieldError message={errors.businessScope} /></label>
                <label className="agreement-registration-upload"><span>证件信息</span><input aria-label="协议客户证件信息文件" onChange={(event) => update('certificateFileName', event.target.files?.[0]?.name ?? '')} type="file" /><em>{draft.certificateFileName || '未选择文件'}</em></label>
                <label className="agreement-registration-upload"><span>业务关系合同</span><input aria-label="协议客户业务关系合同" onChange={(event) => update('contractFileName', event.target.files?.[0]?.name ?? '')} type="file" /><em>{draft.contractFileName || '未选择文件'}</em></label>
              </div>
            </section>

            {errors.form ? <p className="customer-form-error" role="alert">{errors.form}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={onClose} type="button">返回</button><button className="primary-button" disabled={busy} type="submit">提交申请</button></div>
          </form>
        ) : (
          <div className="agreement-application-query">
            {message ? <p className="bulk-message" role="status">{message}</p> : null}
            {errors.form ? <p className="bulk-error" role="alert">{errors.form}</p> : null}
            <div className="bulk-table-wrap">
              <table className="bulk-table">
                <thead><tr><th>申请编号</th><th>大客户名称</th><th>客户类型</th><th>预计件数</th><th>产品类别</th><th>审批状态</th><th>审批意见</th><th>操作</th></tr></thead>
                <tbody>
                  {workspace.agreementApplications.map((application) => (
                    <tr key={application.id}>
                      <td>{application.id}</td><td>{application.legalName}</td><td>{customerTypeLabels[application.customerType]}</td><td>{application.expectedItemCount}</td><td>{application.productCategoryCode}</td><td>{applicationStatusLabels[application.status]}</td><td>{application.approvalOpinion || '—'}</td>
                      <td>{application.status === 'pending' ? <button aria-label={`审核通过 ${application.id}`} className="bulk-green-button" disabled={busy} onClick={() => void approve(application.id)} type="button">审核通过</button> : application.accountId}</td>
                    </tr>
                  ))}
                  {workspace.agreementApplications.length === 0 ? <tr><td className="home-empty-cell" colSpan={8}>无数据</td></tr> : null}
                </tbody>
              </table>
            </div>
            <div className="modal-actions"><button className="secondary-button" onClick={onClose} type="button">关闭</button><button className="primary-button" onClick={() => { setDraft(emptyApplicationDraft()); setErrors({}); setMessage(''); setView('registration') }} type="button">协议客户注册申请</button></div>
          </div>
        )}
      </div>
    </Modal>
  )
}
