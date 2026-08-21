import { describe, expect, it } from 'vitest'
import { isCustomerEditable, orderTotals, type ProductConfig } from './domain/order'
import { orderFormSchema, orderLookupSchema } from './schemas'

const products: ProductConfig[] = [
  { id: '20000000-0000-0000-0000-000000000001', type: 'shirt', name: '이니셜 티셔츠', unitPrice: 33000, sizes: [{ value: 'M', priceDelta: 0 }, { value: '2XL', priceDelta: 2000 }], genders: ['남성', '여성'] },
  { id: '20000000-0000-0000-0000-000000000002', type: 'bag', name: '이니셜 가방', unitPrice: 20000, sizes: [], genders: [] },
]

const validOrder = {
  customerName: '홍길동', phone: '010-1234-5678', email: 'hello@example.com', depositorName: '홍길동',
  fulfillmentType: 'shipping', postalCode: '04524', address: '서울 중구 세종대로 110', addressDetail: '1층', pickupSlotId: '',
  cashReceiptType: 'none', cashReceiptIdentifier: '',
  items: [{ clientId: crypto.randomUUID(), productId: products[0].id, itemType: 'shirt', size: 'M', gender: '여성', initialText: 'Min', stickerSelected: true, stickerCategories: '공룡, 무지개', favoriteColors: '', favoriteThings: '', desiredMood: '', instagramReference: '', extraRequest: '', images: [] }],
  privacyConsent: true, customOrderConsent: true,
}

describe('order validation', () => {
  it('상품별 커스텀 주문을 허용한다', () => expect(orderFormSchema.safeParse(validOrder).success).toBe(true))
  it('가방에는 사이즈와 성별이 없어도 된다', () => expect(orderFormSchema.safeParse({ ...validOrder, items: [{ ...validOrder.items[0], productId: products[1].id, itemType: 'bag', size: '', gender: '' }] }).success).toBe(true))
  it('이니셜은 공백 제외 영문 10자까지만 허용한다', () => {
    expect(orderFormSchema.safeParse({ ...validOrder, items: [{ ...validOrder.items[0], initialText: 'Hello World' }] }).success).toBe(true)
    expect(orderFormSchema.safeParse({ ...validOrder, items: [{ ...validOrder.items[0], initialText: '안녕' }] }).success).toBe(false)
  })
  it('배송과 픽업 조건을 구분한다', () => {
    expect(orderFormSchema.safeParse({ ...validOrder, fulfillmentType: 'pickup', postalCode: '', address: '', addressDetail: '', pickupSlotId: crypto.randomUUID() }).success).toBe(true)
  })
  it('상품 수량 상한을 두지 않는다', () => {
    const bag = { ...validOrder.items[0], productId: products[1].id, itemType: 'bag' as const, size: '', gender: '' }
    expect(orderFormSchema.safeParse({ ...validOrder, items: Array.from({ length: 6 }, () => ({ ...bag, clientId: crypto.randomUUID() })) }).success).toBe(true)
  })
  it('현금영수증 유형에 맞는 번호를 요구한다', () => {
    expect(orderFormSchema.safeParse({ ...validOrder, cashReceiptType: 'business', cashReceiptIdentifier: '1234567890' }).success).toBe(true)
    expect(orderFormSchema.safeParse({ ...validOrder, cashReceiptType: 'business', cashReceiptIdentifier: '1234' }).success).toBe(false)
  })
  it('봇 방지 필드가 채워진 주문을 거절한다', () => expect(orderFormSchema.safeParse({ ...validOrder, website: 'spam' }).success).toBe(false))
  it('주문번호 형식을 엄격하게 확인한다', () => {
    expect(orderLookupSchema.safeParse({ orderNumber: 'BB-0123456789', phoneLast4: '1234' }).success).toBe(true)
    expect(orderLookupSchema.safeParse({ orderNumber: 'BB-OOOOOOOOOO', phoneLast4: '1234' }).success).toBe(false)
  })
})

describe('pricing and editing policy', () => {
  it('2XL 추가금과 배송비를 계산한다', () => expect(orderTotals(products, [{ productId: products[0].id, size: 'M' }, { productId: products[0].id, size: '2XL' }], 'shipping')).toEqual({ subtotal: 68000, shippingFee: 3000, total: 71000 }))
  it('8만원 이상과 픽업은 무료다', () => {
    expect(orderTotals(products, Array.from({ length: 4 }, () => ({ productId: products[1].id })), 'shipping')).toEqual({ subtotal: 80000, shippingFee: 0, total: 80000 })
    expect(orderTotals(products, [{ productId: products[1].id }], 'pickup').shippingFee).toBe(0)
  })
  it('차수별 배송 정책을 계산에 반영한다', () => {
    expect(orderTotals(products, [{ productId: products[1].id }], 'shipping', { shippingFee: 4000, freeShippingThreshold: 50000 })).toEqual({ subtotal: 20000, shippingFee: 4000, total: 24000 })
  })
  it('입금 대기와 입금 확인 상태에서 고객이 수정할 수 있다', () => {
    expect(isCustomerEditable('payment_pending')).toBe(true)
    expect(isCustomerEditable('payment_confirmed')).toBe(true)
    expect(isCustomerEditable('preparing')).toBe(false)
  })
})
