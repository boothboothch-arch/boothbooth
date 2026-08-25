export type ProductType = 'shirt' | 'bag'
export type FulfillmentType = 'shipping' | 'pickup'
export type CashReceiptType = 'none' | 'personal' | 'business'
export type DeliveryZone = 'standard' | 'remote'
export type PostalCodeRange = { name: string; start: string; end: string }

export type ProductOptionValue = { id: string; label: string; priceDelta: number; sortOrder: number; active: boolean }
export type ProductOptionGroup = {
  id: string
  name: string
  selectionType: 'single' | 'multiple'
  required: boolean
  minSelections: number
  maxSelections: number
  sortOrder: number
  active: boolean
  values: ProductOptionValue[]
}

export type ProductConfig = {
  id: string
  type: ProductType
  name: string
  description: string
  unitPrice: number
  stockLimit: number | null
  remainingStock: number | null
  optionGroups: ProductOptionGroup[]
  customization: { initialEnabled: boolean; stickerEnabled: boolean; referenceImagesEnabled: boolean; extraRequestEnabled: boolean }
}

export type OrderItemImageView = {
  id: string
  url: string
  width: number
  height: number
}

export type OrderItemView = {
  id: string
  productId: string
  productName: string
  itemType: ProductType
  selectedOptions: { groupId: string; groupName: string; valueId: string; valueLabel: string; priceDelta: number }[]
  initialText: string
  stickerSelected: boolean
  stickerCategories: string[]
  extraRequest: string
  unitPrice: number
  optionSurcharge: number
  lineAmount: number
  images: OrderItemImageView[]
}

export type OrderView = {
  id: string
  saleId: string
  roundNumber: number
  saleTitle: string
  saleKind: 'live' | 'test'
  kakaoChannelUrl: string
  orderNumber: string
  customerName: string
  phone: string
  depositorName: string
  address: { postalCode: string; address: string; addressDetail: string } | null
  fulfillmentType: FulfillmentType
  pickup: { name: string; address: string; notice: string } | null
  cashReceiptType: CashReceiptType
  cashReceiptIdentifier: string | null
  totalQuantity: number
  subtotalAmount: number
  baseShippingFee: number
  remoteAreaSurcharge: number
  shippingFee: number
  totalAmount: number
  deliveryZone: DeliveryZone
  deliveryConfig: {
    shippingFee: number
    freeShippingThreshold: number
    remoteAreaSurcharge: number
    remotePostalRanges: PostalCodeRange[]
  }
  orderState: 'payment_pending' | 'payment_confirmed' | 'preparing' | 'completed' | 'cancelled'
  paymentState: 'pending' | 'review_required' | 'paid' | 'refund_required' | 'refunded'
  paymentReviewReason: string | null
  cancellationReason: string | null
  paymentDueAt: string
  bank: { bankName: string; account: string; holder: string }
  availableProducts: ProductConfig[]
  items: OrderItemView[]
  shipment: { carrierCode: string | null; carrierName: string | null; trackingNumber: string | null; shippedAt: string | null } | null
  createdAt: string
}

export const orderStateLabel: Record<OrderView['orderState'], string> = {
  payment_pending: '입금 대기',
  payment_confirmed: '입금 완료',
  preparing: '제작 중',
  completed: '출고 완료',
  cancelled: '미입금 취소',
}

export const orderStateOptions = [
  { value: 'payment_pending', label: '입금 대기' },
  { value: 'payment_confirmed', label: '입금 완료' },
  { value: 'preparing', label: '제작 중' },
  { value: 'completed', label: '출고 완료' },
  { value: 'cancelled', label: '미입금 취소' },
] as const satisfies ReadonlyArray<{ value: OrderView['orderState']; label: string }>

export function orderStateTone(state: OrderView['orderState']): 'yellow' | 'blue' | 'green' | 'red' {
  if (state === 'cancelled') return 'red'
  if (state === 'completed') return 'green'
  if (state === 'payment_confirmed') return 'blue'
  return 'yellow'
}

export const paymentStateLabel: Record<OrderView['paymentState'], string> = {
  pending: '입금 대기',
  review_required: '확인 필요',
  paid: '입금 완료',
  refund_required: '환불 필요',
  refunded: '환불 완료',
}

export function isCustomerEditable(state: OrderView['orderState']) {
  return state === 'payment_pending' || state === 'payment_confirmed'
}

export function itemPrice(product: ProductConfig, selectedOptionValueIds: string[] = []) {
  const selected = new Set(selectedOptionValueIds)
  return product.unitPrice + product.optionGroups.flatMap((group) => group.values).reduce((sum, option) => sum + (selected.has(option.id) ? option.priceDelta : 0), 0)
}

export function isRemotePostalCode(postalCode: string, ranges: PostalCodeRange[]) {
  const normalized = postalCode.trim()
  return /^\d{5}$/.test(normalized) && ranges.some((range) => normalized >= range.start && normalized <= range.end)
}

export function orderTotals(
  products: ProductConfig[],
  items: { productId: string; selectedOptionValueIds?: string[] }[],
  fulfillmentType: FulfillmentType,
  delivery: {
    shippingFee: number
    freeShippingThreshold: number
    remoteAreaSurcharge?: number
    postalCode?: string
    remotePostalRanges?: PostalCodeRange[]
  } = { shippingFee: 3000, freeShippingThreshold: 80_000 },
) {
  const subtotal = items.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.productId)
    return sum + (product ? itemPrice(product, item.selectedOptionValueIds) : 0)
  }, 0)
  const baseShippingFee = fulfillmentType === 'shipping' && subtotal < delivery.freeShippingThreshold ? delivery.shippingFee : 0
  const deliveryZone: DeliveryZone = fulfillmentType === 'shipping'
    && isRemotePostalCode(delivery.postalCode ?? '', delivery.remotePostalRanges ?? []) ? 'remote' : 'standard'
  const remoteAreaSurcharge = deliveryZone === 'remote' ? delivery.remoteAreaSurcharge ?? 3000 : 0
  const shippingFee = baseShippingFee + remoteAreaSurcharge
  return { subtotal, baseShippingFee, remoteAreaSurcharge, shippingFee, total: subtotal + shippingFee, deliveryZone }
}
