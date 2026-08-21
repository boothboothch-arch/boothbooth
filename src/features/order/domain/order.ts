export type ProductType = 'shirt' | 'bag'
export type FulfillmentType = 'shipping' | 'pickup'
export type CashReceiptType = 'none' | 'personal' | 'business'

export type ProductConfig = {
  id: string
  type: ProductType
  name: string
  unitPrice: number
  sizes: { value: string; priceDelta: number }[]
  genders: string[]
}

export type PickupSlotView = {
  id: string
  date: string
  startsAt: string
  endsAt: string
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
  size: string | null
  gender: string | null
  initialText: string
  stickerSelected: boolean
  stickerCategories: string[]
  favoriteColors: string
  favoriteThings: string
  desiredMood: string
  instagramReference: string
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
  email: string
  depositorName: string
  address: { postalCode: string; address: string; addressDetail: string } | null
  fulfillmentType: FulfillmentType
  pickup: { name: string; address: string; notice: string; date: string; startsAt: string; endsAt: string } | null
  cashReceiptType: CashReceiptType
  cashReceiptIdentifier: string | null
  totalQuantity: number
  subtotalAmount: number
  shippingFee: number
  totalAmount: number
  orderState: 'payment_pending' | 'payment_confirmed' | 'preparing' | 'completed' | 'cancelled'
  paymentState: 'pending' | 'review_required' | 'paid' | 'refund_required' | 'refunded'
  paymentReviewReason: string | null
  cancellationReason: string | null
  paymentDueAt: string
  bank: { bankName: string; account: string; holder: string }
  availableProducts: ProductConfig[]
  availablePickupSlots: PickupSlotView[]
  items: OrderItemView[]
  shipment: { carrierCode: string | null; carrierName: string | null; trackingNumber: string | null; shippedAt: string | null } | null
  createdAt: string
}

export const orderStateLabel: Record<OrderView['orderState'], string> = {
  payment_pending: '입금 대기',
  payment_confirmed: '입금 확인',
  preparing: '배송·수령 준비',
  completed: '완료',
  cancelled: '취소',
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

export function itemPrice(product: ProductConfig, size?: string | null) {
  return product.unitPrice + (product.sizes.find((option) => option.value === size)?.priceDelta ?? 0)
}

export function orderTotals(
  products: ProductConfig[],
  items: { productId: string; size?: string | null }[],
  fulfillmentType: FulfillmentType,
  delivery: { shippingFee: number; freeShippingThreshold: number } = { shippingFee: 3000, freeShippingThreshold: 80_000 },
) {
  const subtotal = items.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.productId)
    return sum + (product ? itemPrice(product, item.size) : 0)
  }, 0)
  const shippingFee = fulfillmentType === 'shipping' && subtotal < delivery.freeShippingThreshold ? delivery.shippingFee : 0
  return { subtotal, shippingFee, total: subtotal + shippingFee }
}
