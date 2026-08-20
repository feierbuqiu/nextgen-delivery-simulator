import { lazy } from 'react'

/**
 * 功能工作区按需加载，避免首次进入登录与工作台时下载全部业务模块。
 * 每个加载器只负责代码分包；依赖仍由 SimulatorShell 通过 props 注入。
 */
export const BulkIntakeWorkspace = lazy(async () => {
  const module = await import('../bulk/BulkIntakeWorkspace')
  return { default: module.BulkIntakeWorkspace }
})

export const CustomerIntakeWorkspace = lazy(async () => {
  const module = await import('../customer/CustomerIntakeWorkspace')
  return { default: module.CustomerIntakeWorkspace }
})

export const RecommendationWorkspace = lazy(async () => {
  const module = await import('../recommendation/RecommendationWorkspace')
  return { default: module.RecommendationWorkspace }
})

export const SelfServiceBatchImportWorkspace = lazy(async () => {
  const module = await import('../self-service-import/SelfServiceBatchImportWorkspace')
  return { default: module.SelfServiceBatchImportWorkspace }
})

export const MailHandoverWorkspace = lazy(async () => {
  const module = await import('../dispatch/MailHandoverWorkspace')
  return { default: module.MailHandoverWorkspace }
})

export const MailSealingWorkspace = lazy(async () => {
  const module = await import('../dispatch/MailSealingWorkspace')
  return { default: module.MailSealingWorkspace }
})

export const DispatchRouteWorkspace = lazy(async () => {
  const module = await import('../dispatch/DispatchRouteWorkspace')
  return { default: module.DispatchRouteWorkspace }
})

export const DispatchPrintWorkspace = lazy(async () => {
  const module = await import('../dispatch/DispatchPrintWorkspace')
  return { default: module.DispatchPrintWorkspace }
})

export const DispatchTripExportWorkspace = lazy(async () => {
  const module = await import('../dispatch/DispatchTripExportWorkspace')
  return { default: module.DispatchTripExportWorkspace }
})

export const DispatchQueryWorkspace = lazy(async () => {
  const module = await import('../dispatch/DispatchQueryWorkspace')
  return { default: module.DispatchQueryWorkspace }
})

export const DispatchBagInterchangeReturnWorkspace = lazy(async () => {
  const module = await import('../dispatch/DispatchBagInterchangeReturnWorkspace')
  return { default: module.DispatchBagInterchangeReturnWorkspace }
})

export const PostageMeterWorkspace = lazy(async () => {
  const module = await import('../postage-meter/PostageMeterWorkspace')
  return { default: module.PostageMeterWorkspace }
})

export const PostageMeterOperationsWorkspace = lazy(async () => {
  const module = await import('../postage-meter/PostageMeterOperationsWorkspace')
  return { default: module.PostageMeterOperationsWorkspace }
})

export const SpecialHandlingWorkspace = lazy(async () => {
  const module = await import('../special-handling/SpecialHandlingWorkspace')
  return { default: module.SpecialHandlingWorkspace }
})

export const WindowDeliveryWorkspace = lazy(async () => {
  const module = await import('../window-delivery/WindowDeliveryWorkspace')
  return { default: module.WindowDeliveryWorkspace }
})

export const PostalSupplyManagementWorkspace = lazy(async () => {
  const module = await import('../postal-supply-management/PostalSupplyManagementWorkspace')
  return { default: module.PostalSupplyManagementWorkspace }
})

export const PointsInventoryWorkspace = lazy(async () => {
  const module = await import('../points/PointsInventoryWorkspace')
  return { default: module.PointsInventoryWorkspace }
})

export const InvoiceManagementWorkspace = lazy(async () => {
  const module = await import('../invoice/InvoiceManagementWorkspace')
  return { default: module.InvoiceManagementWorkspace }
})

export const ChannelQueryWorkspace = lazy(async () => {
  const module = await import('../query/ChannelQueryWorkspace')
  return { default: module.ChannelQueryWorkspace }
})

export const RoutingRelationshipWorkspace = lazy(async () => {
  const module = await import('../query/RoutingRelationshipWorkspace')
  return { default: module.RoutingRelationshipWorkspace }
})

export const VehicleDispatchQueryWorkspace = lazy(async () => {
  const module = await import('../query/VehicleDispatchQueryWorkspace')
  return { default: module.VehicleDispatchQueryWorkspace }
})

export const SpotCheckExerciseWorkspace = lazy(async () => {
  const module = await import('../query/SpotCheckExerciseWorkspace')
  return { default: module.SpotCheckExerciseWorkspace }
})

export const PostalAdministrativeQueryWorkspace = lazy(async () => {
  const module = await import('../query/PostalAdministrativeQueryWorkspace')
  return { default: module.PostalAdministrativeQueryWorkspace }
})

export const BusinessCustomerQueryWorkspace = lazy(async () => {
  const module = await import('../query/BusinessCustomerQueryWorkspace')
  return { default: module.BusinessCustomerQueryWorkspace }
})

export const SettlementWorkspace = lazy(async () => {
  const module = await import('../service/SettlementWorkspace')
  return { default: module.SettlementWorkspace }
})

export const PersonalRemittanceWorkspace = lazy(async () => {
  const module = await import('../accounting/PersonalRemittanceWorkspace')
  return { default: module.PersonalRemittanceWorkspace }
})

export const AccountingWorkspace = lazy(async () => {
  const module = await import('../accounting/AccountingWorkspace')
  return { default: module.AccountingWorkspace }
})

export const RefundPendingWorkspace = lazy(async () => {
  const module = await import('../service/RefundPendingWorkspace')
  return { default: module.RefundPendingWorkspace }
})

export const ReturnReceiptWorkspace = lazy(async () => {
  const module = await import('../service/ReturnReceiptWorkspace')
  return { default: module.ReturnReceiptWorkspace }
})

export const ReplyCouponWorkspace = lazy(async () => {
  const module = await import('../service/ReplyCouponWorkspace')
  return { default: module.ReplyCouponWorkspace }
})

export const TransactionQueryWorkspace = lazy(async () => {
  const module = await import('../service/TransactionQueryWorkspace')
  return { default: module.TransactionQueryWorkspace }
})

export const ChannelProductQueryWorkspace = lazy(async () => {
  const module = await import('../service/ChannelProductQueryWorkspace')
  return { default: module.ChannelProductQueryWorkspace }
})

export const BasicManagementWorkspace = lazy(async () => {
  const module = await import('../management/BasicManagementWorkspace')
  return { default: module.BasicManagementWorkspace }
})

export const BusinessManagementWorkspace = lazy(async () => {
  const module = await import('../management/BusinessManagementWorkspace')
  return { default: module.BusinessManagementWorkspace }
})

export const CapabilityMatrixWorkspace = lazy(async () => {
  const module = await import('../governance/CapabilityMatrixWorkspace')
  return { default: module.CapabilityMatrixWorkspace }
})

export const CapabilityBoundaryWorkspace = lazy(async () => {
  const module = await import('../governance/CapabilityBoundaryWorkspace')
  return { default: module.CapabilityBoundaryWorkspace }
})
