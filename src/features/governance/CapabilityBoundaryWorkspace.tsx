import {
  CAPABILITY_MATURITY_LABELS,
  CAPABILITY_VERIFICATION_LABELS,
  findCapability,
} from './capabilityCatalog'

interface CapabilityBoundaryWorkspaceProps {
  capabilityId: string
  fallbackLabel: string
  onBack: () => void
}

/**
 * 尚未开放执行能力时，只呈现可审计的产品边界。
 *
 * 组件与工作台分包加载，避免完整治理台账进入登录和导航主包。
 */
export function CapabilityBoundaryWorkspace({
  capabilityId,
  fallbackLabel,
  onBack,
}: CapabilityBoundaryWorkspaceProps) {
  const capability = findCapability(capabilityId)
  const label = capability?.label ?? fallbackLabel

  return (
    <section aria-label={`${label}功能状态`} className="shell-placeholder-panel">
      <p className="shell-breadcrumb">
        {capability?.path ?? `营业渠道 / ${label}`}
      </p>
      <div className="shell-placeholder-card">
        <span aria-hidden="true" className="shell-placeholder-icon">
          {label.slice(0, 1)}
        </span>
        <h1>{label}</h1>
        {capability ? (
          <>
            <span className={`capability-status capability-status--${capability.maturity}`}>
              {CAPABILITY_MATURITY_LABELS[capability.maturity]}
            </span>
            <p>{capability.summary}</p>
            <dl className="shell-placeholder-details">
              <div><dt>能力编号</dt><dd><code>{capability.id}</code></dd></div>
              <div><dt>验证深度</dt><dd>{CAPABILITY_VERIFICATION_LABELS[capability.verification]}</dd></div>
              <div><dt>规格依据</dt><dd><code>{capability.specification}</code></dd></div>
            </dl>
            <aside role="note">
              <strong>当前版本边界</strong>
              <p>本入口不会生成、保存或展示伪造的业务办理结果。只有形成可执行规格、领域规则、持久化和自动化证据后，成熟度才会升级。</p>
            </aside>
            <p><strong>下一步：</strong>{capability.nextAction}</p>
          </>
        ) : <p>该入口尚未登记成熟度信息，请先完成能力目录评审。</p>}
        <button className="secondary-button" onClick={onBack} type="button">
          返回工作台
        </button>
      </div>
    </section>
  )
}
