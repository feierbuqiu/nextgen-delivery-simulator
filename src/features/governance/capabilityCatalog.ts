export type CapabilityMaturity = 'accepted' | 'implemented' | 'partial' | 'planned'

export type CapabilityVerification =
  | 'component'
  | 'domain'
  | 'none'

export interface CapabilityDefinition {
  id: string
  label: string
  path: string
  maturity: CapabilityMaturity
  verification: CapabilityVerification
  specification: string
  evidence: readonly string[]
  summary: string
  nextAction: string
}

export const CAPABILITY_MATURITY_LABELS: Readonly<Record<CapabilityMaturity, string>> = {
  accepted: '已验收',
  implemented: '已实现',
  partial: '部分实现',
  planned: '规划中',
}

export const CAPABILITY_VERIFICATION_LABELS: Readonly<Record<CapabilityVerification, string>> = {
  component: '组件与领域自动化',
  domain: '领域自动化',
  none: '尚无可执行验证',
}

const DEFAULT_NEXT_ACTION: Readonly<Record<Exclude<CapabilityMaturity, 'planned'>, string>> = {
  accepted: '保持回归用例、独立用户路径复核和合规内容复核。',
  implemented: '完成独立浏览器用户路径复核并记录结论后再升级为已验收。',
  partial: '关闭已知子流程和异常状态缺口后重新评定。',
}

function defineCapability(
  maturity: CapabilityMaturity,
  id: string,
  label: string,
  path: string,
  specification: string,
  evidence: readonly string[],
  summary: string,
  nextAction?: string,
): CapabilityDefinition {
  return {
    id,
    label,
    path,
    maturity,
    verification: maturity === 'planned'
      ? 'none'
      : evidence.some((path) => path.endsWith('.test.tsx'))
        ? 'component'
        : evidence.some((path) => path.endsWith('.test.ts'))
          ? 'domain'
          : 'none',
    specification,
    evidence,
    summary,
    nextAction: nextAction ?? (
      maturity === 'planned'
        ? '形成公开规格、领域规则、可执行工作区和自动化测试后再开放入口。'
        : DEFAULT_NEXT_ACTION[maturity]
    ),
  }
}

const implemented = (...args: Parameters<typeof defineCapability> extends [unknown, ...infer Rest] ? Rest : never) =>
  defineCapability('implemented', ...args)
const planned = (...args: Parameters<typeof defineCapability> extends [unknown, ...infer Rest] ? Rest : never) =>
  defineCapability('planned', ...args)

const SHELL_SPEC = 'src/features/shell/navigation.ts'
const ROADMAP = 'KNOWN_DEBT.md'
const SHELL_TEST = 'src/features/shell/SimulatorShell.test.tsx'

/**
 * 用户可见能力的唯一成熟度目录。
 *
 * 信息架构只保存稳定能力编号；菜单文字、能力边界页和生成文档均从这里读取。
 * 状态升级必须同时更新规格、证据路径和自动化验证，不能只修改展示标签。
 */
export const CAPABILITY_CATALOG: readonly CapabilityDefinition[] = [
  implemented('top.dashboard', '工作台', '全局导航 / 工作台', SHELL_SPEC, [SHELL_TEST], '登录后的主页、通知、待办、会话与工作页入口。'),
  planned('top.favorites', '收藏夹', '全局导航 / 收藏夹', SHELL_SPEC, [], '个性化快捷入口尚未建立持久化模型。'),
  implemented('top.channel', '营业渠道', '全局导航 / 营业渠道', SHELL_SPEC, [SHELL_TEST], '进入营业渠道信息架构与核心受理工作区。'),
  planned('top.periodicals', '报刊业务', '全局导航 / 报刊业务', ROADMAP, [], '按当前公开范围暂缓，不列入近期邮政核心链路建设。', '保留能力边界说明；除非范围重新调整，否则不进入近期实施。'),
  implemented('top.accounting', '账务处理', '全局导航 / 账务处理', 'PUBLICATION_POLICY.md', ['src/features/accounting/PersonalRemittanceWorkspace.test.tsx'], '个人缴款、机构日终、存行单与营业日报工作区。'),
  planned('top.philately', '集邮服务', '全局导航 / 集邮服务', ROADMAP, [], '按当前公开范围暂缓，不列入近期邮政核心链路建设。', '保留能力边界说明；除非范围重新调整，否则不进入近期实施。'),

  planned('more.distribution', '分销业务', '更多栏目 / 分销业务', ROADMAP, [], '按当前公开范围暂缓，不列入近期邮政核心链路建设。', '保留能力边界说明；除非范围重新调整，否则不进入近期实施。'),
  planned('more.points', '积分业务', '更多栏目 / 积分业务', ROADMAP, [], '商品库存管理已经实现并保留；积分账户、兑换、历史和统计按当前范围暂停扩展。', '保持既有库存回归，不继续新增积分能力。'),
  implemented('more.settlement', '结算处理', '更多栏目 / 结算处理', 'PUBLICATION_POLICY.md', ['src/features/service/SettlementWorkspace.test.tsx', 'src/domain/service/dispatchFlow.test.ts'], '统一处理待结算业务并形成结算、支付与凭据记录。'),
  planned('more.analytics', '综合数据', '更多栏目 / 综合数据', ROADMAP, [], '跨模块统计口径和数据字典尚未定稿。'),
  implemented('management.business', '业务管理', '更多栏目 / 业务管理', 'PUBLICATION_POLICY.md', ['src/features/management/ManagementWorkspaces.test.tsx'], '签到签退查询、人员审批和机构范围管理。'),
  implemented('management.basic', '基础管理', '更多栏目 / 基础管理', 'PUBLICATION_POLICY.md', ['src/features/management/ManagementWorkspaces.test.tsx'], '人员目录、岗位角色和权限维护。'),

  implemented('channel.business.recommendation', '业务推荐', '营业渠道 / 业务办理 / 业务推荐', 'PUBLICATION_POLICY.md', ['src/domain/service/recommendation.test.ts', 'src/features/recommendation/RecommendationWorkspace.test.tsx', 'src/features/service/ServiceIntakePanel.test.tsx'], '按演练字段采集或暂不采集客户，依邮件类型、重量和寄达局生成有依据的候选产品，并连续带入综合受理；平台报价和时限不生成模拟结论。'),
  implemented('channel.business.intake', '综合受理', '营业渠道 / 业务办理 / 综合受理', 'PUBLICATION_POLICY.md', ['src/features/customer/CustomerIntakeWorkspace.test.tsx', 'src/features/service/ServiceIntakePanel.test.tsx', 'src/domain/service/dispatchFlow.test.ts'], '客户采集、产品选择、计费、提交和持久化受理主链。'),
  implemented('channel.business.bulk', '大宗处理', '营业渠道 / 业务办理 / 大宗处理', 'PUBLICATION_POLICY.md', ['src/domain/service/bulk.test.ts', 'src/domain/service/migration.test.ts', 'src/features/bulk/BulkIntakeWorkspace.test.tsx', 'src/domain/service/dispatchRouting.test.ts'], '协议客户、批量导入、逐件校验、结算、区间面单、爱心包裹直封、统一总包、原生路单与运输班人工交割主链。'),
  planned('channel.business.overlay-entry', '网点叠加业务补录', '营业渠道 / 业务办理 / 网点叠加业务补录', ROADMAP, [], '补录能力部分存在于综合受理，但尚无独立入口契约。'),
  planned('channel.business.commercial-bulk', '商函邮件大宗处理', '营业渠道 / 业务办理 / 商函邮件大宗处理', ROADMAP, [], '商函专用模板、审批和结算边界尚未独立建模。'),
  planned('channel.business.public-welfare-bulk', '公益邮件大宗处理', '营业渠道 / 业务办理 / 公益邮件大宗处理', ROADMAP, [], '公益邮件专用校验与单据尚未形成独立工作区。'),
  implemented('channel.business.correction', '查改处理', '营业渠道 / 业务办理 / 查改处理', 'PUBLICATION_POLICY.md', ['src/domain/service/counterCorrections.test.ts', 'src/features/service/CounterCorrectionWorkspaces.test.tsx', 'src/features/service/TransactionQueryWorkspace.test.tsx'], '收寄、用邮物品、电子商务、补录/交管和商品销售共用查改页签，执行查询、修改/调账、删除授权、打印/开票与审计。'),
  implemented('channel.business.refund', '退款待办查询', '营业渠道 / 业务办理 / 退款待办查询', 'PUBLICATION_POLICY.md', ['src/features/service/RefundPendingWorkspace.test.tsx'], '查看并处理撤销后生成的本地退款待办。'),
  implemented('channel.business.return-receipt', '回执寄回办理', '营业渠道 / 业务办理 / 回执寄回办理', 'PUBLICATION_POLICY.md', ['src/features/service/ReturnReceiptWorkspace.test.tsx'], '回执办理、收到登记、寄回、撤销和状态查询。'),
  planned('channel.business.reply-coupon', '国际回信券兑付', '营业渠道 / 业务办理 / 国际回信券兑付', ROADMAP, [], '按当前公开范围停止继续建设；既有历史演练数据保留，但入口不再参与当前流程。', '保持历史数据兼容，不再扩展销售、兑付或结算能力。'),
  implemented('channel.business.self-service-import', '客户自助批量导入', '营业渠道 / 业务办理 / 客户自助批量导入', 'PUBLICATION_POLICY.md', ['src/domain/service/selfServiceImport.test.ts', 'src/features/self-service-import/SelfServiceBatchImportWorkspace.test.tsx', 'src/infrastructure/indexeddb/IndexedDbServiceRepository.test.ts'], '17 位预约单查询、五件预受理明细、成功与处理详情、记欠直接结算、按批次/订单号查改重打及刷新恢复；结算邮件进入封发关系人工维护清单。'),
  planned('channel.business.settlement-correction', '结算方式查改', '营业渠道 / 业务办理 / 结算方式查改', ROADMAP, [], '结算方式变更的授权、会计影响和审计规则尚未定稿。'),
  implemented('channel.business.channel-sales-entry', '多渠道商品简易销售', '营业渠道 / 业务办理 / 多渠道商品简易销售', 'PUBLICATION_POLICY.md', ['src/features/customer/CustomerIntakeWorkspace.test.tsx', 'src/features/shell/navigation.test.ts'], '独立菜单直接进入综合受理的商品销售页签，并沿用同一客户草稿、购物车、库存与结算链。', '该外围能力按当前范围只维持既有回归，不追加用户路径验收。'),
  implemented('channel.business.channel-sales-query', '多渠道商品综合销售查改', '营业渠道 / 业务办理 / 多渠道商品综合销售查改', 'PUBLICATION_POLICY.md', ['src/features/service/ChannelProductQueryWorkspace.test.tsx'], '商品销售查询、详情、打印、删除授权和库存恢复。'),
  planned('channel.business.insurance', '保险业务受理', '营业渠道 / 业务办理 / 保险业务受理', ROADMAP, [], '按当前公开范围暂缓；未模拟任何现实保险主体、产品或接口。', '保留能力边界说明；除非范围重新调整，否则不进入近期实施。'),

  implemented('channel.dispatch.handover', '交接处理', '营业渠道 / 邮件封发 / 交接处理', 'PUBLICATION_POLICY.md', ['src/features/dispatch/MailHandoverWorkspace.test.tsx'], '散件与总包交出、接收及状态约束。'),
  implemented('channel.dispatch.sealing', '封发处理', '营业渠道 / 邮件封发 / 封发处理', 'PUBLICATION_POLICY.md', ['src/features/dispatch/MailSealingWorkspace.test.tsx', 'src/domain/service/mailSealing.test.ts', 'src/domain/service/dispatchFlow.test.ts'], '原生未封发处理按真实业务日查询，完成清单采集、班次选择、总包生成及袋牌人工决定；散件外走、分拣封发和已封发查改仍共用持久化总包状态链。'),
  implemented('channel.dispatch.route', '路单生成', '营业渠道 / 邮件封发 / 路单生成', 'PUBLICATION_POLICY.md', ['src/features/dispatch/DispatchRouteWorkspace.test.tsx', 'src/domain/service/dispatchRouting.test.ts', 'src/domain/service/dispatchFlow.test.ts'], '独立演练页面按当前业务日核对未归单总包，并连续生成演练路单和总路单。'),
  implemented('channel.dispatch.print', '路单/清单打印', '营业渠道 / 邮件封发 / 路单/清单打印', 'PUBLICATION_POLICY.md', ['src/features/dispatch/DispatchPrintWorkspace.test.tsx', 'src/domain/service/dispatchRouting.test.ts'], '独立演练页面按当前业务日查询清单、路单和总路单，保存模拟打印审计并形成浏览器打印预览。'),
  implemented('channel.dispatch.export', '趟车出口', '营业渠道 / 邮件封发 / 趟车出口', 'PUBLICATION_POLICY.md', ['src/features/dispatch/DispatchTripExportWorkspace.test.tsx', 'src/domain/service/dispatchRouting.test.ts', 'src/domain/service/dispatchFlow.test.ts'], '独立演练页面按当前交接日采集演练派车单，主管现场输入工号和密码授权后推进路单、总路单及总包出口状态。'),
  implemented('channel.dispatch.query', '封发查询', '营业渠道 / 邮件封发 / 封发查询', 'PUBLICATION_POLICY.md', ['src/features/dispatch/DispatchQueryWorkspace.test.tsx'], '封发、路单、出口与问题状态查询。'),
  implemented('channel.dispatch.interchange-return', '总包退回互换局', '营业渠道 / 邮件封发 / 总包退回互换局', 'PUBLICATION_POLICY.md', ['src/features/dispatch/DispatchBagInterchangeReturnWorkspace.test.tsx'], '符合条件的总包退回与邮件池恢复。'),

  implemented('channel.special.application', '邮件撤改处理', '营业渠道 / 特殊处理 / 邮件撤改处理', 'PUBLICATION_POLICY.md', ['src/features/special-handling/SpecialHandlingWorkspace.test.tsx'], '邮件改址撤回申请和状态迁移。'),
  implemented('channel.special.status', '邮件改址撤回状态查询', '营业渠道 / 特殊处理 / 邮件改址撤回状态查询', 'PUBLICATION_POLICY.md', ['src/features/special-handling/SpecialHandlingWorkspace.test.tsx'], '特殊处理申请状态、详情和审计查询。'),

  implemented('channel.window.import', '窗投进口处理', '营业渠道 / 窗投业务 / 窗投进口处理', 'PUBLICATION_POLICY.md', ['src/features/window-delivery/WindowDeliveryWorkspace.test.tsx'], '窗投进口登记和邮件状态维护。'),
  implemented('channel.window.supplement', '窗投补录', '营业渠道 / 窗投业务 / 窗投补录', 'PUBLICATION_POLICY.md', ['src/features/window-delivery/WindowDeliveryWorkspace.test.tsx'], '窗投记录补录及校验。'),
  implemented('channel.window.return-receive', '投递转退邮件接收', '营业渠道 / 窗投业务 / 投递转退邮件接收', 'PUBLICATION_POLICY.md', ['src/features/window-delivery/WindowDeliveryWorkspace.test.tsx'], '投递转退邮件接收。'),
  implemented('channel.window.transfer-receive', '投递转窗投邮件接收', '营业渠道 / 窗投业务 / 投递转窗投邮件接收', 'PUBLICATION_POLICY.md', ['src/features/window-delivery/WindowDeliveryWorkspace.test.tsx'], '投递转窗投邮件接收。'),
  implemented('channel.window.maintenance', '窗投查改', '营业渠道 / 窗投业务 / 窗投查改', 'PUBLICATION_POLICY.md', ['src/features/window-delivery/WindowDeliveryWorkspace.test.tsx'], '窗投记录查询和维护。'),
  implemented('channel.window.transfer', '窗投转退', '营业渠道 / 窗投业务 / 窗投转退', 'PUBLICATION_POLICY.md', ['src/features/window-delivery/WindowDeliveryWorkspace.test.tsx'], '窗投邮件转退处理。'),
  implemented('channel.window.reminder', '窗投催领逾退', '营业渠道 / 窗投业务 / 窗投催领逾退', 'PUBLICATION_POLICY.md', ['src/features/window-delivery/WindowDeliveryWorkspace.test.tsx'], '催领和逾期退回状态处理。'),
  implemented('channel.window.cancellation', '窗投销号', '营业渠道 / 窗投业务 / 窗投销号', 'PUBLICATION_POLICY.md', ['src/features/window-delivery/WindowDeliveryWorkspace.test.tsx'], '窗投邮件销号。'),
  implemented('channel.window.balance', '窗投平衡统计', '营业渠道 / 窗投业务 / 窗投平衡统计', 'PUBLICATION_POLICY.md', ['src/features/window-delivery/WindowDeliveryWorkspace.test.tsx'], '窗投业务平衡汇总。'),
  implemented('channel.window.query', '窗投查询统计', '营业渠道 / 窗投业务 / 窗投查询统计', 'PUBLICATION_POLICY.md', ['src/features/window-delivery/WindowDeliveryWorkspace.test.tsx'], '窗投记录筛选和统计。'),

  implemented('channel.meter.handover-out', '委托交出处理', '营业渠道 / 邮资机业务 / 委托交出处理', 'PUBLICATION_POLICY.md', ['src/features/postage-meter/PostageMeterOperationsWorkspace.test.tsx'], '邮资机委托交出。'),
  implemented('channel.meter.handover-in', '委托接收处理', '营业渠道 / 邮资机业务 / 委托接收处理', 'PUBLICATION_POLICY.md', ['src/features/postage-meter/PostageMeterOperationsWorkspace.test.tsx'], '邮资机委托接收。'),
  implemented('channel.meter.batch', '过戳批次管理', '营业渠道 / 邮资机业务 / 过戳批次管理', 'PUBLICATION_POLICY.md', ['src/features/postage-meter/PostageMeterWorkspace.test.tsx'], '过戳批次建立与状态维护。'),
  implemented('channel.meter.registration', '过戳登记', '营业渠道 / 邮资机业务 / 过戳登记', 'PUBLICATION_POLICY.md', ['src/features/postage-meter/PostageMeterWorkspace.test.tsx'], '邮资机过戳登记。'),
  implemented('channel.meter.balance', '批次过戳平衡', '营业渠道 / 邮资机业务 / 批次过戳平衡', 'PUBLICATION_POLICY.md', ['src/features/postage-meter/PostageMeterWorkspace.test.tsx'], '批次过戳平衡校验。'),
  implemented('channel.meter.daily', '日终平衡', '营业渠道 / 邮资机业务 / 日终平衡', 'PUBLICATION_POLICY.md', ['src/features/postage-meter/PostageMeterWorkspace.test.tsx'], '邮资机日终平衡。'),
  implemented('channel.meter.funding', '注资申请', '营业渠道 / 邮资机业务 / 注资申请', 'PUBLICATION_POLICY.md', ['src/features/postage-meter/PostageMeterOperationsWorkspace.test.tsx'], '本地注资申请与状态推进。'),
  implemented('channel.meter.repair', '报修启用', '营业渠道 / 邮资机业务 / 报修启用', 'PUBLICATION_POLICY.md', ['src/features/postage-meter/PostageMeterOperationsWorkspace.test.tsx'], '报修、停用与恢复启用。'),
  implemented('channel.meter.maintenance', '邮资机信息维护', '营业渠道 / 邮资机业务 / 邮资机信息维护', 'PUBLICATION_POLICY.md', ['src/features/postage-meter/PostageMeterWorkspace.test.tsx'], '设备基础信息维护。'),
  implemented('channel.meter.handover-history', '邮资机历史交接信息查询', '营业渠道 / 邮资机业务 / 邮资机历史交接信息查询', 'PUBLICATION_POLICY.md', ['src/features/postage-meter/PostageMeterOperationsWorkspace.test.tsx'], '委托交接历史查询。'),
  implemented('channel.meter.usage-ledger', '邮资机使用登记簿查询', '营业渠道 / 邮资机业务 / 邮资机使用登记簿查询', 'PUBLICATION_POLICY.md', ['src/features/postage-meter/PostageMeterOperationsWorkspace.test.tsx'], '设备使用登记簿查询。'),

  implemented('channel.supplies.inbound', '用邮物品入库', '营业渠道 / 用邮物品管理 / 用邮物品入库', 'PUBLICATION_POLICY.md', ['src/features/postal-supply-management/PostalSupplyManagementWorkspace.test.tsx'], '用邮物品入库。'),
  implemented('channel.supplies.requisition', '用邮物品请领', '营业渠道 / 用邮物品管理 / 用邮物品请领', 'PUBLICATION_POLICY.md', ['src/features/postal-supply-management/PostalSupplyManagementWorkspace.test.tsx'], '库存请领。'),
  implemented('channel.supplies.approval', '用邮物品审批', '营业渠道 / 用邮物品管理 / 用邮物品审批', 'PUBLICATION_POLICY.md', ['src/features/postal-supply-management/PostalSupplyManagementWorkspace.test.tsx'], '请领审批。'),
  implemented('channel.supplies.receipt', '用邮物品接收', '营业渠道 / 用邮物品管理 / 用邮物品接收', 'PUBLICATION_POLICY.md', ['src/features/postal-supply-management/PostalSupplyManagementWorkspace.test.tsx'], '下发物品接收。'),
  implemented('channel.supplies.issue', '用邮物品下发', '营业渠道 / 用邮物品管理 / 用邮物品下发', 'PUBLICATION_POLICY.md', ['src/features/postal-supply-management/PostalSupplyManagementWorkspace.test.tsx'], '用邮物品下发。'),
  implemented('channel.supplies.return', '用邮物品退回', '营业渠道 / 用邮物品管理 / 用邮物品退回', 'PUBLICATION_POLICY.md', ['src/features/postal-supply-management/PostalSupplyManagementWorkspace.test.tsx'], '库存退回。'),
  implemented('channel.supplies.inventory', '用邮物品库存盘点', '营业渠道 / 用邮物品管理 / 用邮物品库存盘点', 'PUBLICATION_POLICY.md', ['src/features/postal-supply-management/PostalSupplyManagementWorkspace.test.tsx'], '库存盘点与差异记录。'),
  implemented('channel.supplies.balance', '用邮物品平衡统计', '营业渠道 / 用邮物品管理 / 用邮物品平衡统计', 'PUBLICATION_POLICY.md', ['src/features/postal-supply-management/PostalSupplyManagementWorkspace.test.tsx'], '库存平衡统计。'),
  implemented('channel.supplies.sales', '用邮物品销售统计', '营业渠道 / 用邮物品管理 / 用邮物品销售统计', 'PUBLICATION_POLICY.md', ['src/features/postal-supply-management/PostalSupplyManagementWorkspace.test.tsx'], '用邮物品销售汇总。'),

  planned('channel.commercial-bill', '商函账单处理', '营业渠道 / 商函账单处理', ROADMAP, [], '当前只有信息架构入口，未建立账单批次、版式和结算契约。'),
  implemented('channel.invoice.legacy-red', '票据冲红处理', '营业渠道 / 票据管理 / 票据冲红处理', 'PUBLICATION_POLICY.md', ['src/features/invoice/InvoiceManagementWorkspace.test.tsx'], '历史票据冲红处理。'),
  implemented('channel.invoice.financial-red', '业财发票冲红', '营业渠道 / 票据管理 / 业财发票冲红', 'PUBLICATION_POLICY.md', ['src/features/invoice/InvoiceManagementWorkspace.test.tsx'], '模拟业财发票冲红及审计。'),

  implemented('channel.query.third-party-payment', '第三方支付查询', '营业渠道 / 查询 / 第三方支付查询', 'PUBLICATION_POLICY.md', ['src/features/query/ChannelQueryWorkspace.test.tsx'], '本地第三方支付流水查询。'),
  implemented('channel.query.front-desk-log', '前台日志查询', '营业渠道 / 查询 / 前台日志查询', 'PUBLICATION_POLICY.md', ['src/features/query/ChannelQueryWorkspace.test.tsx'], '前台操作日志查询。'),
  implemented('channel.query.mail-tracking', '给据邮件跟踪查询', '营业渠道 / 查询 / 给据邮件跟踪查询', 'PUBLICATION_POLICY.md', ['src/features/query/ChannelQueryWorkspace.test.tsx'], '给据邮件轨迹查询。'),
  implemented('channel.query.accepted-mail', '收寄邮件查询', '营业渠道 / 查询 / 收寄邮件查询', 'PUBLICATION_POLICY.md', ['src/features/query/ChannelQueryWorkspace.test.tsx'], '收寄记录条件查询。'),
  implemented('channel.query.route-comparison', '邮路对照查询', '营业渠道 / 查询 / 邮路对照查询', 'PUBLICATION_POLICY.md', ['src/features/query/RoutingRelationshipWorkspace.test.tsx'], '邮路关系对照。'),
  implemented('channel.query.network-export', '网运出口关系查询', '营业渠道 / 查询 / 网运出口关系查询', 'PUBLICATION_POLICY.md', ['src/features/query/RoutingRelationshipWorkspace.test.tsx'], '网运出口关系查询。'),
  implemented('channel.query.branch-export', '寄递支局出口关系查询', '营业渠道 / 查询 / 寄递支局出口关系查询', 'PUBLICATION_POLICY.md', ['src/features/query/RoutingRelationshipWorkspace.test.tsx'], '寄递支局出口关系查询。'),
  implemented('channel.query.vehicle-dispatch', '车辆派车信息查询', '营业渠道 / 查询 / 车辆派车信息查询', 'PUBLICATION_POLICY.md', ['src/features/query/VehicleDispatchQueryWorkspace.test.tsx'], '演练车辆派车信息查询。'),
  implemented('channel.query.spot-check', '抽查演练信息查询', '营业渠道 / 查询 / 抽查演练信息查询', 'PUBLICATION_POLICY.md', ['src/features/query/SpotCheckExerciseWorkspace.test.tsx'], '演练题目和抽查记录查询。'),
  implemented('channel.query.postal-administrative', '邮编行政区划查询', '营业渠道 / 查询 / 邮编行政区划查询', 'PUBLICATION_POLICY.md', ['src/features/query/PostalAdministrativeQueryWorkspace.test.tsx'], '虚构邮编与三级区划目录查询。'),
  planned('channel.query.inspection-mailbox', '巡视类专用邮政信箱查询', '营业渠道 / 查询 / 巡视类专用邮政信箱查询', ROADMAP, [], '按当前公开范围暂缓，不列入近期查询建设。', '保留能力边界说明；除非范围重新调整，否则不进入近期实施。'),
  implemented('channel.query.customer', '营业客户查询', '营业渠道 / 查询 / 营业客户查询', 'PUBLICATION_POLICY.md', ['src/domain/customer/businessCustomerQuery.test.ts', 'src/features/query/BusinessCustomerQueryWorkspace.test.tsx'], '按完整手机号或证件号查询本地客户事实，以通用字段布局展示脱敏只读资料；外围 CRM 字段不生成模拟结果。'),
  planned('channel.query.offline-loan', '线下贷款申请管理', '营业渠道 / 查询 / 线下贷款申请管理', ROADMAP, [], '按当前公开范围暂缓；本项目不接入现实金融主体。', '保留能力边界说明；除非范围重新调整，否则不进入近期实施。'),

  implemented('channel.points.inventory', '商品库存管理', '营业渠道 / 积分业务 / 商品库存管理', 'PUBLICATION_POLICY.md', ['src/domain/service/pointsInventory.test.ts', 'src/features/points/PointsInventoryWorkspace.test.tsx'], '积分商品精确/模糊查询、入库、退库、库存约束及模拟外部同步流水；既有实现保留。', '按当前范围暂停进一步扩展，仅维持既有回归。'),
  planned('channel.points.redemption', '积分兑换', '营业渠道 / 积分业务 / 积分兑换', ROADMAP, [], '按当前公开范围暂缓，不列入近期实施。', '保留能力边界说明；除非范围重新调整，否则不进入近期实施。'),
  planned('channel.points.history', '兑换历史查询', '营业渠道 / 积分业务 / 兑换历史查询', ROADMAP, [], '按当前公开范围暂缓，不列入近期实施。', '保留能力边界说明；除非范围重新调整，否则不进入近期实施。'),
  planned('channel.points.statistics', '积分兑换统计', '营业渠道 / 积分业务 / 积分兑换统计', ROADMAP, [], '按当前公开范围暂缓，不列入近期实施。', '保留能力边界说明；除非范围重新调整，否则不进入近期实施。'),

  implemented('help.capability-matrix', '功能成熟度', '营业渠道 / 帮助中心 / 功能成熟度', 'src/features/governance/capabilityCatalog.ts', ['src/features/governance/CapabilityMatrixWorkspace.test.tsx'], '公开展示全部入口的成熟度、验证深度、规格和下一步。'),
  planned('help.operation', '操作帮助', '营业渠道 / 帮助中心 / 操作帮助', ROADMAP, [], '面向角色和任务的产品内帮助尚未形成独立内容体系。'),
] as const

const capabilityById = new Map(CAPABILITY_CATALOG.map((capability) => [
  capability.id,
  capability,
]))

export function getCapability(capabilityId: string): CapabilityDefinition {
  const capability = capabilityById.get(capabilityId)
  if (!capability) throw new Error(`未登记能力：${capabilityId}`)
  return capability
}

export function findCapability(capabilityId: string | undefined): CapabilityDefinition | null {
  return capabilityId ? capabilityById.get(capabilityId) ?? null : null
}

export function capabilityCounts(): Record<CapabilityMaturity, number> {
  return CAPABILITY_CATALOG.reduce<Record<CapabilityMaturity, number>>((counts, capability) => {
    counts[capability.maturity] += 1
    return counts
  }, { accepted: 0, implemented: 0, partial: 0, planned: 0 })
}
