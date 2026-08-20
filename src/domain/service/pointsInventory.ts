import type {
  PointsInventoryMovement,
  PointsInventoryMovementKind,
  PointsProductInventoryItem,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from './types'
import { businessCalendarDay } from '../shared/businessTime'

export interface PointsInventoryQuery {
  barcode: string
  productName: string
}

export type PointsInventoryCommand = {
  type: 'adjust-points-inventory'
  productId: string
  kind: PointsInventoryMovementKind
  quantity: number
  operatedAt: string
  operator: ServiceOperatorSnapshot
}

export interface PointsInventoryResult {
  state: ServiceWorkspaceState
  movement: PointsInventoryMovement
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN')
}

export function queryPointsProductInventory(
  state: ServiceWorkspaceState,
  query: PointsInventoryQuery,
): PointsProductInventoryItem[] {
  const barcode = query.barcode.trim()
  const productName = normalized(query.productName)
  return state.pointsProductInventory
    .filter((item) => !barcode || item.barcode === barcode)
    .filter((item) => !productName || normalized(item.name).includes(productName))
    .map((item) => structuredClone(item))
}

function movementId(operatedAt: string, sequence: number): string {
  const date = businessCalendarDay(operatedAt).replaceAll('-', '')
  return `JF-KC-${date}-${String(sequence).padStart(6, '0')}`
}

function validateQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('出入库数量必须是大于零的整数。')
  }
  return quantity
}

export function executePointsInventoryCommand(
  state: ServiceWorkspaceState,
  command: PointsInventoryCommand,
): PointsInventoryResult {
  const product = state.pointsProductInventory.find((item) => item.id === command.productId)
  if (!product) throw new Error('未找到需要处理的积分商品。')

  const quantity = validateQuantity(command.quantity)
  if (command.kind === 'outbound' && quantity > product.quantity) {
    throw new Error(`退库数量不能超过当前库存 ${product.quantity}。`)
  }

  const balanceAfter = command.kind === 'inbound'
    ? product.quantity + quantity
    : product.quantity - quantity
  const movement: PointsInventoryMovement = {
    id: movementId(command.operatedAt, state.nextPointsInventoryMovementSequence),
    productId: product.id,
    productNumber: product.productNumber,
    barcode: product.barcode,
    productName: product.name,
    kind: command.kind,
    quantity,
    balanceBefore: product.quantity,
    balanceAfter,
    operatedAt: command.operatedAt,
    operator: structuredClone(command.operator),
    syncTarget: '外部积分平台（模拟）',
    syncStatus: 'acknowledged',
  }
  const nextState: ServiceWorkspaceState = {
    ...state,
    pointsProductInventory: state.pointsProductInventory.map((item) => item.id === product.id
      ? { ...item, quantity: balanceAfter }
      : item),
    pointsInventoryMovements: [...state.pointsInventoryMovements, movement],
    nextPointsInventoryMovementSequence: state.nextPointsInventoryMovementSequence + 1,
  }
  return { state: nextState, movement }
}

export function pointsInventoryMovementKindLabel(kind: PointsInventoryMovementKind): string {
  return kind === 'inbound' ? '入库' : '退库'
}
