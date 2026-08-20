import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import type { CustomerDraft, RecipientProfile } from '../../domain/customer/types'
import { FICTIONAL_ADDRESSES } from '../../domain/customer/seed'
import {
  CHANNEL_PICKUP_OFFICES,
  CHANNEL_PRODUCT_CATALOG,
  channelProductLineKey,
  remainingChannelPickupStock,
  remainingChannelProductStock,
  type ChannelPickupOffice,
} from '../../domain/service/channelProductSales'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import { pendingServiceSummary } from '../../domain/service/transactions'
import type {
  ChannelProductAllocation,
  ChannelProductCatalogItem,
  ChannelProductOrderDraftLine,
  ChannelProductPickupProfile,
  ChannelProductSku,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'
import type { ServiceSummary } from './ServiceIntakePanel'

interface ChannelProductSalesWorkspaceProps {
  customerDraft: CustomerDraft
  repository: ServiceRepository
  onOpenSettlement: () => void
  onSummaryChange: (summary: ServiceSummary) => void
}

type CartTab = 'all' | 'delivery' | 'pickup'

const DEMO_SUBMITTED_AT = '2026-08-04T11:00:00.000Z'

const emptyDeliveryRecipient = (): RecipientProfile => ({
  contact: '',
  name: '',
  detailedAddress: '',
  unit: '',
  postalCode: '',
})

const emptyPickupProfile = (): ChannelProductPickupProfile => ({
  contact: '',
  name: '',
  identityType: '',
  identityValue: '',
  gender: '',
  pickupOfficeCode: '',
  pickupOfficeName: '',
})

function addressPrefix(hierarchy: string[]): string {
  return hierarchy
    .filter((part, index) => part && part !== hierarchy[index - 1])
    .join('')
}

function cartEntry(line: ChannelProductOrderDraftLine): {
  product: ChannelProductCatalogItem
  sku: ChannelProductSku
} | null {
  const product = CHANNEL_PRODUCT_CATALOG.find((item) => item.id === line.productId)
  const sku = product?.skus.find((item) => item.code === line.skuCode)
  return product && sku ? { product, sku } : null
}

export function ChannelProductSalesWorkspace({
  customerDraft,
  repository,
  onOpenSettlement,
  onSummaryChange,
}: ChannelProductSalesWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [view, setView] = useState<'catalog' | 'cart'>('catalog')
  const [cartTab, setCartTab] = useState<CartTab>('all')
  const [category, setCategory] = useState('')
  const [secondaryCategory, setSecondaryCategory] = useState('')
  const [query, setQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<ChannelProductCatalogItem | null>(null)
  const [selectedSkuCode, setSelectedSkuCode] = useState('')
  const [selectedQuantity, setSelectedQuantity] = useState(1)
  const [cartLines, setCartLines] = useState<ChannelProductOrderDraftLine[]>([])
  const [allocations, setAllocations] = useState<ChannelProductAllocation[]>([])
  const [addedProductLabel, setAddedProductLabel] = useState('')
  const [submitConfirmationOpen, setSubmitConfirmationOpen] = useState(false)
  const [deliveryRecipient, setDeliveryRecipient] = useState<RecipientProfile>(emptyDeliveryRecipient)
  const [pickupProfile, setPickupProfile] = useState<ChannelProductPickupProfile>(emptyPickupProfile)
  const [allocationQuantities, setAllocationQuantities] = useState<Record<string, number>>({})
  const [editingAllocationId, setEditingAllocationId] = useState<string | null>(null)
  const [addressPickerOpen, setAddressPickerOpen] = useState(false)
  const [addressQuery, setAddressQuery] = useState('')
  const [pickupOfficeOpen, setPickupOfficeOpen] = useState(false)
  const [officeProvince, setOfficeProvince] = useState('')
  const [officeCity, setOfficeCity] = useState('')
  const [officeDistrict, setOfficeDistrict] = useState('')
  const [officeQuery, setOfficeQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

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

  const primaryCategories = useMemo(
    () => [...new Set(CHANNEL_PRODUCT_CATALOG.map((item) => item.category))],
    [],
  )
  const secondaryCategories = useMemo(
    () => [...new Set(
      CHANNEL_PRODUCT_CATALOG
        .filter((item) => !category || item.category === category)
        .map((item) => item.secondaryCategory),
    )],
    [category],
  )
  const products = useMemo(() => {
    const term = query.trim().toUpperCase()
    return CHANNEL_PRODUCT_CATALOG.filter((product) => (
      (!category || product.category === category) &&
      (!secondaryCategory || product.secondaryCategory === secondaryCategory) &&
      (!term || product.label.includes(query.trim()) || product.barcode.includes(term))
    ))
  }, [category, query, secondaryCategory])
  const cartEntries = cartLines.flatMap((line) => {
    const entry = cartEntry(line)
    return entry ? [{ line, ...entry }] : []
  })
  const cartQuantity = cartLines.reduce((total, line) => total + line.quantity, 0)
  const cartTotalCents = cartEntries.reduce(
    (total, entry) => total + entry.line.quantity * entry.sku.unitPriceCents,
    0,
  )
  const latestOrder = workspace?.channelProductOrders.at(-1) ?? null

  const historicalRecipients = useMemo(() => {
    const records = [customerDraft.recipient]
    for (const order of workspace?.channelProductOrders ?? []) {
      for (const allocation of order.allocations) {
        if (allocation.kind === 'delivery' && allocation.recipient) {
          records.push({ ...allocation.recipient, unit: '' })
        }
      }
    }
    const unique = new Map<string, RecipientProfile>()
    records.forEach((record) => {
      const key = `${record.contact}|${record.name}|${record.detailedAddress}`
      if (
        /^\d{6}$/.test(record.postalCode) &&
        record.detailedAddress.trim().length >= 7
      ) {
        unique.set(key, record)
      }
    })
    return [...unique.values()]
  }, [customerDraft.recipient, workspace?.channelProductOrders])

  const addressOptions = useMemo(() => {
    const term = addressQuery.trim()
    return FICTIONAL_ADDRESSES
      .filter((address) => address.mode === 'domestic')
      .filter((address) => {
        const prefix = addressPrefix(address.hierarchy)
        return !term || prefix.includes(term) || address.postalCode.includes(term)
      })
  }, [addressQuery])

  const officeProvinces = useMemo(
    () => [...new Set(CHANNEL_PICKUP_OFFICES.map((office) => office.province))],
    [],
  )
  const officeCities = useMemo(
    () => [...new Set(CHANNEL_PICKUP_OFFICES.filter(
      (office) => !officeProvince || office.province === officeProvince,
    ).map((office) => office.city))],
    [officeProvince],
  )
  const officeDistricts = useMemo(
    () => [...new Set(CHANNEL_PICKUP_OFFICES.filter(
      (office) => (!officeProvince || office.province === officeProvince) &&
        (!officeCity || office.city === officeCity),
    ).map((office) => office.district))],
    [officeCity, officeProvince],
  )
  const filteredOffices = useMemo(() => {
    const term = officeQuery.trim().toUpperCase()
    return CHANNEL_PICKUP_OFFICES.filter((office) => (
      (!officeProvince || office.province === officeProvince) &&
      (!officeCity || office.city === officeCity) &&
      (!officeDistrict || office.district === officeDistrict) &&
      (!term || office.code.includes(term) || office.name.includes(officeQuery.trim()))
    ))
  }, [officeCity, officeDistrict, officeProvince, officeQuery])

  function stockFor(productId: string, skuCode: string): number {
    return workspace
      ? remainingChannelProductStock(workspace, productId, skuCode)
      : 0
  }

  function allocatedQuantity(key: string, excludeId: string | null = null): number {
    return allocations.reduce((total, allocation) => (
      total + (allocation.id === excludeId
        ? 0
        : allocation.lines.find(
            (line) => channelProductLineKey(line.productId, line.skuCode) === key,
          )?.quantity ?? 0)
    ), 0)
  }

  function availableToAllocate(line: ChannelProductOrderDraftLine): number {
    const key = channelProductLineKey(line.productId, line.skuCode)
    const cartLine = cartLines.find(
      (item) => channelProductLineKey(item.productId, item.skuCode) === key,
    )
    return Math.max(
      0,
      (cartLine?.quantity ?? 0) - allocatedQuantity(key, editingAllocationId),
    )
  }

  function openProduct(product: ChannelProductCatalogItem): void {
    setSelectedProduct(product)
    setSelectedSkuCode(product.skus[0]?.code ?? '')
    setSelectedQuantity(1)
    setError('')
  }

  function addToCart(): void {
    if (!selectedProduct || !selectedSkuCode) return
    const sku = selectedProduct.skus.find((item) => item.code === selectedSkuCode)
    if (!sku) return
    const remaining = stockFor(selectedProduct.id, sku.code)
    if (!Number.isInteger(selectedQuantity) || selectedQuantity < 1 || (sku.inventoryControlled && selectedQuantity > remaining)) {
      setError(`数量须为 1 至 ${remaining} 的整数。`)
      return
    }
    const key = channelProductLineKey(selectedProduct.id, sku.code)
    setCartLines((current) => {
      const existing = current.find((line) => channelProductLineKey(line.productId, line.skuCode) === key)
      if (!existing) return [...current, { productId: selectedProduct.id, skuCode: sku.code, quantity: selectedQuantity }]
      const quantity = sku.inventoryControlled
        ? Math.min(remaining, existing.quantity + selectedQuantity)
        : existing.quantity + selectedQuantity
      return current.map((line) => channelProductLineKey(line.productId, line.skuCode) === key
        ? { ...line, quantity }
        : line)
    })
    setSelectedProduct(null)
    setAddedProductLabel(`${selectedProduct.label}（${sku.label}）`)
    setNotice('')
    setError('')
  }

  function updateCartQuantity(line: ChannelProductOrderDraftLine, quantity: number): void {
    const entry = cartEntry(line)
    if (!entry) return
    const key = channelProductLineKey(line.productId, line.skuCode)
    const minimum = Math.max(1, allocatedQuantity(key))
    const maximum = entry.sku.inventoryControlled
      ? stockFor(line.productId, line.skuCode)
      : 9999
    setCartLines((current) => current.map((item) => (
      channelProductLineKey(item.productId, item.skuCode) === key
        ? { ...item, quantity: Math.min(Math.max(quantity || minimum, minimum), maximum) }
        : item
    )))
    setError('')
  }

  function removeCartLine(line: ChannelProductOrderDraftLine): void {
    const key = channelProductLineKey(line.productId, line.skuCode)
    if (allocatedQuantity(key) > 0) {
      setError('该商品已用于寄递或自提登记，请先删除对应登记。')
      return
    }
    setCartLines((current) => current.filter(
      (item) => channelProductLineKey(item.productId, item.skuCode) !== key,
    ))
  }

  function resetAllocationForm(): void {
    setDeliveryRecipient(emptyDeliveryRecipient())
    setPickupProfile(emptyPickupProfile())
    setAllocationQuantities({})
    setEditingAllocationId(null)
    setAddressPickerOpen(false)
  }

  function openCartTab(tab: CartTab): void {
    setView('cart')
    setCartTab(tab)
    resetAllocationForm()
    setError('')
    setNotice('')
  }

  function allocationLines(): ChannelProductOrderDraftLine[] {
    return cartLines.flatMap((line) => {
      const key = channelProductLineKey(line.productId, line.skuCode)
      const quantity = allocationQuantities[key] ?? 0
      return quantity > 0 ? [{ ...line, quantity }] : []
    })
  }

  function saveDeliveryAllocation(): void {
    const lines = allocationLines()
    if (!/^\d{6,20}$/.test(deliveryRecipient.contact.trim())) {
      setError('收件人联系电话须为 6 至 20 位数字。')
      return
    }
    if (deliveryRecipient.name.trim().length < 2) {
      setError('收件人姓名至少填写 2 个字符。')
      return
    }
    if (!/^\d{6}$/.test(deliveryRecipient.postalCode.trim()) || deliveryRecipient.detailedAddress.trim().length < 7) {
      setError('请填写 6 位邮编和不少于 7 个字符的详细地址。')
      return
    }
    if (lines.length === 0) {
      setError('请至少填写一种需要寄递的商品数量。')
      return
    }
    if (lines.some((line) => line.quantity > availableToAllocate(line))) {
      setError('已填数量不得超过购物车剩余数量。')
      return
    }
    const allocation: ChannelProductAllocation = {
      id: editingAllocationId ?? `FHD-${String(allocations.length + 1).padStart(3, '0')}`,
      kind: 'delivery',
      recipient: {
        contact: deliveryRecipient.contact.trim(),
        name: deliveryRecipient.name.trim(),
        postalCode: deliveryRecipient.postalCode.trim(),
        detailedAddress: deliveryRecipient.detailedAddress.trim(),
      },
      pickup: null,
      lines,
    }
    setAllocations((current) => editingAllocationId
      ? current.map((item) => item.id === editingAllocationId ? allocation : item)
      : [...current, allocation])
    resetAllocationForm()
    setNotice('寄递登记已保存，可继续采集下一位收件人。')
    setError('')
  }

  function pickupDraftInventory(
    office: ChannelPickupOffice,
    line: ChannelProductOrderDraftLine,
  ): number {
    if (!workspace) return 0
    const key = channelProductLineKey(line.productId, line.skuCode)
    const alreadyDrafted = allocations.reduce((total, allocation) => (
      total + (
        allocation.id !== editingAllocationId &&
        allocation.kind === 'pickup' &&
        allocation.pickup?.pickupOfficeCode === office.code
          ? allocation.lines.find(
              (item) => channelProductLineKey(item.productId, item.skuCode) === key,
            )?.quantity ?? 0
          : 0
      )
    ), 0)
    return Math.max(
      0,
      remainingChannelPickupStock(workspace, office.code, line.productId, line.skuCode) - alreadyDrafted,
    )
  }

  function savePickupAllocation(): void {
    const lines = allocationLines()
    if (!/^\d{6,20}$/.test(pickupProfile.contact.trim())) {
      setError('自提人联系电话须为 6 至 20 位数字。')
      return
    }
    if (pickupProfile.name.trim().length < 2) {
      setError('自提人姓名至少填写 2 个字符。')
      return
    }
    const office = CHANNEL_PICKUP_OFFICES.find((item) => item.code === pickupProfile.pickupOfficeCode)
    if (!office) {
      setError('请选择自提配置机构。')
      return
    }
    if (lines.length === 0) {
      setError('请至少填写一种需要到店自提的商品数量。')
      return
    }
    if (lines.some((line) => line.quantity > availableToAllocate(line))) {
      setError('已填数量不得超过购物车剩余数量。')
      return
    }
    const overStock = lines.find((line) => {
      const entry = cartEntry(line)
      return entry?.sku.inventoryControlled && line.quantity > pickupDraftInventory(office, line)
    })
    if (overStock) {
      const entry = cartEntry(overStock)!
      setError(`${office.name}的${entry.product.label}（${entry.sku.label}）自提库存仅剩 ${pickupDraftInventory(office, overStock)}。`)
      return
    }
    const allocation: ChannelProductAllocation = {
      id: editingAllocationId ?? `ZTD-${String(allocations.length + 1).padStart(3, '0')}`,
      kind: 'pickup',
      recipient: null,
      pickup: { ...pickupProfile, pickupOfficeName: office.name },
      lines,
    }
    setAllocations((current) => editingAllocationId
      ? current.map((item) => item.id === editingAllocationId ? allocation : item)
      : [...current, allocation])
    resetAllocationForm()
    setNotice('到店自提登记已保存。')
    setError('')
  }

  function editAllocation(allocation: ChannelProductAllocation): void {
    setEditingAllocationId(allocation.id)
    setAllocationQuantities(Object.fromEntries(allocation.lines.map((line) => [
      channelProductLineKey(line.productId, line.skuCode),
      line.quantity,
    ])))
    if (allocation.kind === 'delivery' && allocation.recipient) {
      setCartTab('delivery')
      setDeliveryRecipient({ ...allocation.recipient, unit: '' })
      setPickupProfile(emptyPickupProfile())
    } else if (allocation.pickup) {
      setCartTab('pickup')
      setPickupProfile(allocation.pickup)
      setDeliveryRecipient(emptyDeliveryRecipient())
    }
    setError('')
    setNotice('')
  }

  function deleteAllocation(id: string): void {
    setAllocations((current) => current.filter((item) => item.id !== id))
    if (editingAllocationId === id) resetAllocationForm()
    setNotice('登记信息已删除，数量已退回购物车。')
    setError('')
  }

  async function submitOrder(): Promise<void> {
    if (!workspace || saving) return
    setSaving(true)
    setError('')
    try {
      const accepted = await repository.acceptChannelProductOrder({
        submittedAt: DEMO_SUBMITTED_AT,
        buyer: customerDraft.sender,
        lines: cartLines,
        allocations,
      })
      setWorkspace(accepted.state)
      setCartLines([])
      setAllocations([])
      setView('catalog')
      setCartTab('all')
      setSubmitConfirmationOpen(false)
      onSummaryChange(pendingServiceSummary(accepted.state))
      setNotice(`提交成功，商品销售流水 ${accepted.order.id} 已进入结算中心。`)
    } catch (caught) {
      setSubmitConfirmationOpen(false)
      setError(caught instanceof Error ? caught.message : '商品销售提交失败。')
    } finally {
      setSaving(false)
    }
  }

  if (!workspace) {
    return <section className="channel-sales channel-sales--loading">正在读取商品目录…</section>
  }

  return (
    <>
      <section className="channel-sales" aria-labelledby="channel-sales-title">
        <div className="channel-sales-heading">
          <div>
            <strong id="channel-sales-title">渠道转型商品销售</strong>
            <span>{view === 'catalog' ? '商品分类' : '我的购物车'}</span>
          </div>
          <div>
            <button className="secondary-button secondary-button--small" onClick={() => { setView('catalog'); setError(''); setNotice('') }} type="button">商品分类</button>
            <button className="channel-cart-button" onClick={() => openCartTab('all')} type="button">我的购物车 <b>{cartQuantity}</b></button>
            <button className="settlement-center-button" onClick={onOpenSettlement} type="button">结算中心（{pendingServiceSummary(workspace).count}）</button>
          </div>
        </div>

        {latestOrder ? (
          <article className="accepted-transaction" aria-label="最近渠道商品销售">
            <div><span className="accepted-transaction__eyebrow">最近销售</span><strong>{latestOrder.id}</strong><small>{latestOrder.lines.map((line) => `${line.productLabel} × ${line.quantity}`).join('、')}</small></div>
            <div><span>总件数</span><strong>{latestOrder.totalQuantity}</strong></div>
            <div><span>总金额</span><strong>¥ {formatCents(latestOrder.totalCents)}</strong></div>
            <span className={latestOrder.status === 'settled' ? 'queue-status queue-status--settled' : 'queue-status'}>{latestOrder.status === 'settled' ? '已结算' : '待结算'}</span>
          </article>
        ) : null}

        {view === 'catalog' ? (
          <div className="channel-catalog-layout">
            <aside className="channel-category-panel" aria-label="商品分类">
              <div className="channel-category-title">商品分类</div>
              <button className={!category ? 'is-active' : ''} onClick={() => { setCategory(''); setSecondaryCategory('') }} type="button">全部商品</button>
              {primaryCategories.map((item) => (
                <div className="channel-category-group" key={item}>
                  <button className={category === item && !secondaryCategory ? 'is-active' : ''} onClick={() => { setCategory(item); setSecondaryCategory('') }} type="button"><span>▸</span>{item}</button>
                  {category === item ? secondaryCategories.map((secondary) => (
                    <button className={secondaryCategory === secondary ? 'channel-category-child is-active' : 'channel-category-child'} key={secondary} onClick={() => setSecondaryCategory(secondary)} type="button">{secondary}</button>
                  )) : null}
                </div>
              ))}
            </aside>
            <div className="channel-product-browser">
              <div className="channel-product-search">
                <input aria-label="商品名称或条码" onChange={(event) => setQuery(event.target.value)} placeholder="请输入需要的商品名称或商品条码" value={query} />
                <button aria-label="检索商品" type="button">⌕</button>
              </div>
              <div className="channel-product-grid">
                {products.map((product) => {
                  const stock = product.skus.reduce((total, sku) => total + stockFor(product.id, sku.code), 0)
                  const minimum = Math.min(...product.skus.map((sku) => sku.unitPriceCents))
                  return (
                    <button aria-label={`查看商品 ${product.label}`} className="channel-product-card" key={product.id} onClick={() => openProduct(product)} type="button">
                      <span className="channel-product-art" style={{ '--product-accent': product.accent } as CSSProperties}>{product.label.slice(0, 2)}</span>
                      <strong>{product.label}</strong>
                      <span>¥ {formatCents(minimum)}{product.skus.length > 1 ? ' 起' : ''}</span>
                      <small>{product.skus.some((sku) => sku.inventoryControlled) ? `库存 ${stock} ${product.unit}` : '不校验库存'}</small>
                    </button>
                  )
                })}
                {products.length === 0 ? <p className="channel-empty">没有匹配的商品。</p> : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="channel-cart-workspace">
            <nav className="channel-cart-tabs" aria-label="购物车处理方式">
              <button aria-selected={cartTab === 'all'} className={cartTab === 'all' ? 'is-active' : ''} onClick={() => openCartTab('all')} role="tab" type="button">全部商品</button>
              <button aria-selected={cartTab === 'delivery'} className={cartTab === 'delivery' ? 'is-active' : ''} onClick={() => openCartTab('delivery')} role="tab" type="button">寄递登记</button>
              <button aria-selected={cartTab === 'pickup'} className={cartTab === 'pickup' ? 'is-active' : ''} onClick={() => openCartTab('pickup')} role="tab" type="button">到店自提登记</button>
            </nav>

            {cartTab === 'delivery' ? (
              <div className="channel-allocation-form">
                <div className="channel-history-row">
                  <label><span>历史收件人</span><select aria-label="历史收件人" onChange={(event) => { const record = historicalRecipients[Number(event.target.value)]; if (record) setDeliveryRecipient(record) }} value=""><option value="">请选择</option>{historicalRecipients.map((record, index) => <option key={`${record.contact}-${index}`} value={index}>{record.name} {record.contact}</option>)}</select></label>
                </div>
                <div className="channel-recipient-grid">
                  <label><span><b>*</b>手机号</span><input aria-label="寄递手机号" inputMode="numeric" onChange={(event) => setDeliveryRecipient((current) => ({ ...current, contact: event.target.value.replace(/\D/g, '') }))} value={deliveryRecipient.contact} /></label>
                  <label><span><b>*</b>姓名</span><input aria-label="寄递姓名" onChange={(event) => setDeliveryRecipient((current) => ({ ...current, name: event.target.value }))} value={deliveryRecipient.name} /></label>
                  <label><span><b>*</b>邮编</span><input aria-label="寄递邮编" inputMode="numeric" maxLength={6} onChange={(event) => setDeliveryRecipient((current) => ({ ...current, postalCode: event.target.value.replace(/\D/g, '').slice(0, 6) }))} value={deliveryRecipient.postalCode} /></label>
                  <label className="channel-address-field"><span><b>*</b>详细地址</span><div><input aria-label="寄递详细地址" onChange={(event) => setDeliveryRecipient((current) => ({ ...current, detailedAddress: event.target.value }))} value={deliveryRecipient.detailedAddress} /><button onClick={() => setAddressPickerOpen((open) => !open)} type="button">点选地址</button></div>{addressPickerOpen ? <div className="channel-address-popover" role="group" aria-label="寄递地址点选"><input aria-label="寄递地址检索" onChange={(event) => setAddressQuery(event.target.value)} placeholder="输入省市区县或邮编" value={addressQuery} /><div>{addressOptions.map((address) => { const prefix = addressPrefix(address.hierarchy); return <button key={`${prefix}-${address.postalCode}`} onClick={() => { setDeliveryRecipient((current) => ({ ...current, detailedAddress: prefix, postalCode: address.postalCode })); setAddressPickerOpen(false); setAddressQuery('') }} type="button"><strong>{prefix}</strong><span>{address.postalCode}</span></button> })}</div></div> : null}</label>
                </div>
                <AllocationLineTable allocationQuantities={allocationQuantities} available={(line) => availableToAllocate(line)} cartLines={cartLines} onQuantityChange={(key, quantity) => setAllocationQuantities((current) => ({ ...current, [key]: quantity }))} workspace={workspace} />
                <div className="channel-form-actions"><button className="primary-button primary-button--compact" onClick={saveDeliveryAllocation} type="button">{editingAllocationId ? '修改保存' : '保存'}</button><button className="secondary-button" onClick={resetAllocationForm} type="button">清空</button></div>
              </div>
            ) : cartTab === 'pickup' ? (
              <div className="channel-allocation-form">
                <div className="channel-recipient-grid channel-recipient-grid--pickup">
                  <label><span><b>*</b>手机号</span><input aria-label="自提手机号" inputMode="numeric" onChange={(event) => setPickupProfile((current) => ({ ...current, contact: event.target.value.replace(/\D/g, '') }))} value={pickupProfile.contact} /></label>
                  <label><span><b>*</b>姓名</span><input aria-label="自提姓名" onChange={(event) => setPickupProfile((current) => ({ ...current, name: event.target.value }))} value={pickupProfile.name} /></label>
                  <label><span>性别</span><select aria-label="自提人性别" onChange={(event) => setPickupProfile((current) => ({ ...current, gender: event.target.value }))} value={pickupProfile.gender}><option value="">请选择</option><option>男</option><option>女</option><option>未说明</option></select></label>
                  <label><span>证件类型</span><select aria-label="自提证件类型" onChange={(event) => setPickupProfile((current) => ({ ...current, identityType: event.target.value }))} value={pickupProfile.identityType}><option value="">请选择</option><option value="primary">居民身份证件</option><option value="other">其他有效证件</option></select></label>
                  <label><span>证件号码</span><input aria-label="自提证件号码" onChange={(event) => setPickupProfile((current) => ({ ...current, identityValue: event.target.value }))} value={pickupProfile.identityValue} /></label>
                  <label className="channel-pickup-office-field"><span><b>*</b>自提配置机构</span><div><input aria-label="自提配置机构" readOnly value={pickupProfile.pickupOfficeName ? `${pickupProfile.pickupOfficeName}（${pickupProfile.pickupOfficeCode}）` : ''} /><button onClick={() => setPickupOfficeOpen(true)} type="button">选择</button></div></label>
                </div>
                <AllocationLineTable allocationQuantities={allocationQuantities} available={(line) => { const office = CHANNEL_PICKUP_OFFICES.find((item) => item.code === pickupProfile.pickupOfficeCode); return office ? Math.min(availableToAllocate(line), pickupDraftInventory(office, line)) : availableToAllocate(line) }} cartLines={cartLines} onQuantityChange={(key, quantity) => setAllocationQuantities((current) => ({ ...current, [key]: quantity }))} pickupOffice={CHANNEL_PICKUP_OFFICES.find((item) => item.code === pickupProfile.pickupOfficeCode) ?? null} workspace={workspace} />
                <div className="channel-form-actions"><button className="primary-button primary-button--compact" onClick={savePickupAllocation} type="button">{editingAllocationId ? '修改保存' : '保存'}</button><button className="secondary-button" onClick={resetAllocationForm} type="button">清空</button></div>
              </div>
            ) : null}

            {cartTab === 'all' ? (
              <div className="settlement-table-wrap channel-cart-table-wrap">
                <table className="settlement-table channel-cart-table">
                  <thead><tr><th>商品信息</th><th>规格</th><th>单价</th><th>数量</th><th>已登记</th><th>现货数量</th><th>金额</th><th>操作</th></tr></thead>
                  <tbody>{cartEntries.map(({ line, product, sku }) => { const key = channelProductLineKey(line.productId, line.skuCode); const assigned = allocatedQuantity(key); return <tr key={key}><td><strong>{product.label}</strong><small>{product.barcode}</small></td><td>{sku.label}<small>{sku.code}</small></td><td>¥ {formatCents(sku.unitPriceCents)}</td><td><input aria-label={`购物车数量 ${product.label} ${sku.label}`} min={Math.max(1, assigned)} onChange={(event) => updateCartQuantity(line, Number(event.target.value))} type="number" value={line.quantity} /></td><td>{assigned}</td><td>{line.quantity - assigned}</td><td>¥ {formatCents(line.quantity * sku.unitPriceCents)}</td><td><button className="danger-link" onClick={() => removeCartLine(line)} type="button">删除</button></td></tr> })}{cartEntries.length === 0 ? <tr><td className="settlement-empty" colSpan={8}>购物车中没有商品。</td></tr> : null}</tbody>
                </table>
              </div>
            ) : null}

            {allocations.length > 0 ? (
              <div className="channel-allocation-list" aria-label="已保存的寄递和自提登记">
                {allocations.map((allocation, index) => (
                  <article key={allocation.id}><button aria-label={`展开登记 ${allocation.id}`} type="button">⌄</button><div><strong>{allocation.kind === 'delivery' ? `收件人${index + 1}：${allocation.recipient?.name}` : `到店自提${index + 1}：${allocation.pickup?.name}`}</strong><span>{allocation.kind === 'delivery' ? `${allocation.recipient?.contact} · ${allocation.recipient?.postalCode} · ${allocation.recipient?.detailedAddress}` : `${allocation.pickup?.contact} · ${allocation.pickup?.pickupOfficeName}`}</span><small>{allocation.lines.map((line) => { const entry = cartEntry(line); return `${entry?.product.label ?? line.productId}（${entry?.sku.label ?? line.skuCode}）× ${line.quantity}` }).join('、')}</small></div><button className="table-action" onClick={() => editAllocation(allocation)} type="button">修改</button><button className="danger-link" onClick={() => deleteAllocation(allocation.id)} type="button">删除</button></article>
                ))}
              </div>
            ) : null}

            <div className="channel-cart-footer"><span>已选商品 <b>{cartQuantity}</b> 件</span><strong>合计：<b>¥ {formatCents(cartTotalCents)}</b></strong><button className="channel-submit-button" disabled={cartLines.length === 0 || saving || cartTab !== 'all'} onClick={() => setSubmitConfirmationOpen(true)} title={cartTab === 'all' ? undefined : '请先返回全部商品'} type="button">提交</button></div>
          </div>
        )}

        {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
      </section>

      {selectedProduct ? (
        <Modal description={`${selectedProduct.category} / ${selectedProduct.secondaryCategory} · 商品条码 ${selectedProduct.barcode}`} eyebrow="商品详情" title={selectedProduct.label} wide>
          <div className="channel-product-detail">
            <span className="channel-product-detail__art" style={{ '--product-accent': selectedProduct.accent } as CSSProperties}>{selectedProduct.label.slice(0, 2)}</span>
            <div><p>{selectedProduct.description}</p><label><span>款式</span><select aria-label="商品 SKU" onChange={(event) => { setSelectedSkuCode(event.target.value); setSelectedQuantity(1); setError('') }} value={selectedSkuCode}>{selectedProduct.skus.map((sku) => <option key={sku.code} value={sku.code}>{sku.label} · ¥ {formatCents(sku.unitPriceCents)}</option>)}</select></label><label><span>数量</span><input aria-label="商品数量" max={stockFor(selectedProduct.id, selectedSkuCode)} min={1} onChange={(event) => setSelectedQuantity(Number(event.target.value))} type="number" value={selectedQuantity} /><small>库存 {stockFor(selectedProduct.id, selectedSkuCode)} {selectedProduct.unit}</small></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setSelectedProduct(null); setError('') }} type="button">取消</button><button className="channel-add-cart-button" onClick={addToCart} type="button">加入购物车</button></div></div>
          </div>
        </Modal>
      ) : null}

      {addedProductLabel ? (
        <Modal description={`${addedProductLabel} 已加入。`} eyebrow="信息" title="该商品加入购物车成功">
          <div className="modal-form channel-added-dialog"><div className="channel-success-icon">✓</div><div className="modal-actions"><button className="secondary-button" onClick={() => { setAddedProductLabel(''); openCartTab('all') }} type="button">查看购物车</button><button className="primary-button primary-button--compact" onClick={() => setAddedProductLabel('')} type="button">继续选择商品</button></div></div>
        </Modal>
      ) : null}

      {pickupOfficeOpen ? (
        <Modal description="按省份、地市、区县或机构编码/名称检索。" eyebrow="到店自提登记" title="自提机构信息" wide>
          <div className="modal-form channel-office-picker">
            <div className="channel-office-filters"><label><span>省份</span><select aria-label="自提机构省份" onChange={(event) => { setOfficeProvince(event.target.value); setOfficeCity(''); setOfficeDistrict('') }} value={officeProvince}><option value="">全部</option>{officeProvinces.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>地市</span><select aria-label="自提机构地市" onChange={(event) => { setOfficeCity(event.target.value); setOfficeDistrict('') }} value={officeCity}><option value="">全部</option>{officeCities.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>区县</span><select aria-label="自提机构区县" onChange={(event) => setOfficeDistrict(event.target.value)} value={officeDistrict}><option value="">全部</option>{officeDistricts.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>机构编码 / 名称</span><input aria-label="自提机构检索" onChange={(event) => setOfficeQuery(event.target.value)} placeholder="至少输入五位机构编码或名称" value={officeQuery} /></label></div>
            <div className="customer-table-wrap"><table className="customer-table"><thead><tr><th>序号</th><th>机构信息</th><th>地址</th><th>联系电话</th><th>操作</th></tr></thead><tbody>{filteredOffices.map((office, index) => <tr key={office.code}><td>{index + 1}</td><td><strong>{office.name}（{office.code}）</strong></td><td>{office.address}</td><td>{office.contact}</td><td><button className="table-action" onClick={() => { setPickupProfile((current) => ({ ...current, pickupOfficeCode: office.code, pickupOfficeName: office.name })); setPickupOfficeOpen(false) }} type="button">选择</button></td></tr>)}</tbody></table></div>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setPickupOfficeOpen(false)} type="button">关闭</button></div>
          </div>
        </Modal>
      ) : null}

      {submitConfirmationOpen ? (
        <Modal description={`购物车共 ${cartQuantity} 件，合计 ¥ ${formatCents(cartTotalCents)}。`} eyebrow="确认信息" title={allocations.length === 0 ? '是否确认以现货方式提交？' : '是否确认提交商品？'}>
          <div className="modal-form"><p>{allocations.length === 0 ? '本批商品将按现货方式交付并提交至结算中心。' : '已登记的寄递和到店自提信息将随商品订单一并保存，未登记数量按现货方式交付。'}</p><div className="modal-actions"><button className="secondary-button" onClick={() => setSubmitConfirmationOpen(false)} type="button">取消</button><button className="primary-button primary-button--compact" disabled={saving} onClick={() => void submitOrder()} type="button">{saving ? '正在提交…' : '确定'}</button></div></div>
        </Modal>
      ) : null}
    </>
  )
}

function AllocationLineTable({
  allocationQuantities,
  available,
  cartLines,
  onQuantityChange,
  pickupOffice = null,
  workspace,
}: {
  allocationQuantities: Record<string, number>
  available: (line: ChannelProductOrderDraftLine) => number
  cartLines: ChannelProductOrderDraftLine[]
  onQuantityChange: (key: string, quantity: number) => void
  pickupOffice?: ChannelPickupOffice | null
  workspace: ServiceWorkspaceState
}) {
  return (
    <div className="settlement-table-wrap channel-allocation-table-wrap">
      <table className="settlement-table channel-allocation-table">
        <thead><tr><th>选择</th><th>商品信息</th><th>规格</th><th>单价</th><th>剩余数量</th><th>已填数量</th><th>金额</th>{pickupOffice ? <th>自提库存</th> : null}</tr></thead>
        <tbody>{cartLines.map((line) => { const entry = cartEntry(line); if (!entry) return null; const key = channelProductLineKey(line.productId, line.skuCode); const quantity = allocationQuantities[key] ?? 0; const maximum = available(line); const pickupStock = pickupOffice ? remainingChannelPickupStock(workspace, pickupOffice.code, line.productId, line.skuCode) : null; return <tr key={key}><td><input aria-label={`登记 ${entry.product.label} ${entry.sku.label}`} checked={quantity > 0} disabled={maximum === 0} onChange={(event) => onQuantityChange(key, event.target.checked ? Math.min(1, maximum) : 0)} type="checkbox" /></td><td>{entry.product.label}<small>{entry.product.barcode}</small></td><td>{entry.sku.label}<small>{entry.sku.code}</small></td><td>¥ {formatCents(entry.sku.unitPriceCents)}</td><td>{maximum}</td><td><input aria-label={`已填数量 ${entry.product.label} ${entry.sku.label}`} disabled={quantity === 0} max={maximum} min={quantity === 0 ? 0 : 1} onChange={(event) => onQuantityChange(key, Math.min(Math.max(Number(event.target.value) || 1, 1), maximum))} type="number" value={quantity} /></td><td>¥ {formatCents(entry.sku.unitPriceCents * quantity)}</td>{pickupOffice ? <td>{entry.sku.inventoryControlled ? pickupStock : '不校验'}</td> : null}</tr> })}{cartLines.length === 0 ? <tr><td className="settlement-empty" colSpan={pickupOffice ? 8 : 7}>购物车中没有可登记商品。</td></tr> : null}</tbody>
      </table>
    </div>
  )
}
