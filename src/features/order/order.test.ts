import { describe, expect, it } from 'vitest'
import { isCustomerEditable, limitInitialTextInput, orderStateOptions, orderStateTone, orderTotals, type ProductConfig } from './domain/order'
import { customerOrderUpdateSchema, orderFormSchema, orderLookupSchema } from './schemas'

const products: ProductConfig[] = [
  { id: '20000000-0000-0000-0000-000000000001', type: 'shirt', name: '이니셜 티셔츠', description: '', unitPrice: 33000, stockLimit: null, remainingStock: null, customization: { initialEnabled: true, stickerEnabled: true, referenceImagesEnabled: true, extraRequestEnabled: true }, optionGroups: [{ id: '30000000-0000-4000-8000-000000000001', name: '사이즈', selectionType: 'single', required: true, minSelections: 1, maxSelections: 1, sortOrder: 0, active: true, values: [{ id: '40000000-0000-4000-8000-000000000001', label: 'M', priceDelta: 0, sortOrder: 0, active: true }, { id: '40000000-0000-4000-8000-000000000002', label: '2XL', priceDelta: 2000, sortOrder: 1, active: true }] }] },
  { id: '20000000-0000-0000-0000-000000000002', type: 'bag', name: '이니셜 가방', description: '', unitPrice: 20000, stockLimit: null, remainingStock: null, customization: { initialEnabled: true, stickerEnabled: true, referenceImagesEnabled: true, extraRequestEnabled: true }, optionGroups: [] },
]

const validOrder = {
  customerName: '홍길동', phone: '010-1234-5678', email: 'buyer@example.com', depositorName: '홍길동',
  fulfillmentType: 'shipping', postalCode: '04524', address: '서울 중구 세종대로 110', addressDetail: '1층',
  cashReceiptType: 'none', cashReceiptIdentifier: '',
  items: [{ clientId: crypto.randomUUID(), productId: products[0].id, itemType: 'shirt', selectedOptionValueIds: ['40000000-0000-4000-8000-000000000001'], initialText: 'Min', stickerSelected: true, stickerCategories: '공룡, 무지개', extraRequest: '', images: [] }],
  privacyConsent: true, customOrderConsent: true,
}

describe('order validation', () => {
  it('상품별 커스텀 주문을 허용한다', () => expect(orderFormSchema.safeParse(validOrder).success).toBe(true))
  it('유효한 이메일 주소를 필수로 요구하고 정규화한다', () => {
    expect(orderFormSchema.parse({ ...validOrder, email: ' Buyer@Example.COM ' }).email).toBe('buyer@example.com')
    expect(orderFormSchema.safeParse({ ...validOrder, email: 'not-an-email' }).success).toBe(false)
  })
  it('가방에는 옵션 그룹이 없어도 된다', () => expect(orderFormSchema.safeParse({ ...validOrder, items: [{ ...validOrder.items[0], productId: products[1].id, itemType: 'bag', selectedOptionValueIds: [] }] }).success).toBe(true))
  it('이니셜은 공백 제외 영문 12자까지만 허용한다', () => {
    expect(orderFormSchema.safeParse({ ...validOrder, items: [{ ...validOrder.items[0], initialText: 'ABCDEFGHIJKL' }] }).success).toBe(true)
    expect(orderFormSchema.safeParse({ ...validOrder, items: [{ ...validOrder.items[0], initialText: 'ABCDEFGHIJKLM' }] }).success).toBe(false)
    expect(orderFormSchema.safeParse({ ...validOrder, items: [{ ...validOrder.items[0], initialText: '안녕' }] }).success).toBe(false)
  })
  it('이니셜 입력 단계에서 공백 제외 12자를 넘는 문자를 제거한다', () => {
    expect(limitInitialTextInput('ABCDEFGHIJKLM')).toBe('ABCDEFGHIJKL')
    expect(limitInitialTextInput('ABC DEF GHI JKL M').replaceAll(' ', '')).toBe('ABCDEFGHIJKL')
  })
  it('배송과 픽업 조건을 구분한다', () => {
    expect(orderFormSchema.safeParse({ ...validOrder, fulfillmentType: 'pickup', postalCode: '', address: '', addressDetail: '' }).success).toBe(true)
  })
  it('상품 수량 상한을 두지 않는다', () => {
    const bag = { ...validOrder.items[0], productId: products[1].id, itemType: 'bag' as const, selectedOptionValueIds: [] }
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
  it('고객 수정에서도 상품별·주문별 이미지 제한을 적용한다', () => {
    const item = {
      id: crypto.randomUUID(),
      productId: products[0].id,
      itemType: 'shirt' as const,
      selectedOptionValueIds: ['40000000-0000-4000-8000-000000000001'],
      initialText: 'Min',
      stickerSelected: false,
      stickerCategories: '',
      extraRequest: '',
      images: Array.from({ length: 3 }, () => crypto.randomUUID()),
    }
    const update = {
      fulfillmentType: 'shipping' as const,
      postalCode: '04524',
      address: '서울 중구 세종대로 110',
      addressDetail: '1층',
      cashReceiptType: 'none' as const,
      cashReceiptIdentifier: '',
      items: [item],
    }
    expect(customerOrderUpdateSchema.safeParse(update).success).toBe(true)
    expect(customerOrderUpdateSchema.safeParse({ ...update, items: [{ ...item, images: [...item.images, crypto.randomUUID()] }] }).success).toBe(false)
    expect(customerOrderUpdateSchema.safeParse({ ...update, items: Array.from({ length: 7 }, () => ({ ...item, id: crypto.randomUUID(), images: Array.from({ length: 3 }, () => crypto.randomUUID()) })) }).success).toBe(false)
  })
})

describe('pricing and editing policy', () => {
  const jejuRange = [{ name: '제주특별자치도', start: '63000', end: '63644' }]
  it('고객과 관리자가 사용하는 주문 상태 네 단계를 유지한다', () => {
    expect(orderStateOptions.map((option) => option.label)).toEqual(['입금 대기', '입금 완료', '제작 중', '출고 완료', '미입금 취소'])
    expect(orderStateTone('payment_pending')).toBe('yellow')
    expect(orderStateTone('payment_confirmed')).toBe('blue')
    expect(orderStateTone('completed')).toBe('green')
  })
  it('옵션 추가금과 배송비를 계산한다', () => expect(orderTotals(products, [{ productId: products[0].id, selectedOptionValueIds: ['40000000-0000-4000-8000-000000000001'] }, { productId: products[0].id, selectedOptionValueIds: ['40000000-0000-4000-8000-000000000002'] }], 'shipping')).toEqual({ subtotal: 68000, baseShippingFee: 3000, remoteAreaSurcharge: 0, shippingFee: 3000, total: 71000, deliveryZone: 'standard' }))
  it('8만원 이상과 픽업은 무료다', () => {
    expect(orderTotals(products, Array.from({ length: 4 }, () => ({ productId: products[1].id })), 'shipping')).toEqual({ subtotal: 80000, baseShippingFee: 0, remoteAreaSurcharge: 0, shippingFee: 0, total: 80000, deliveryZone: 'standard' })
    expect(orderTotals(products, [{ productId: products[1].id }], 'pickup').shippingFee).toBe(0)
  })
  it('차수별 배송 정책을 계산에 반영한다', () => {
    expect(orderTotals(products, [{ productId: products[1].id }], 'shipping', { shippingFee: 4000, freeShippingThreshold: 50000 })).toEqual({ subtotal: 20000, baseShippingFee: 4000, remoteAreaSurcharge: 0, shippingFee: 4000, total: 24000, deliveryZone: 'standard' })
  })
  it('제주·도서산간 추가 배송비는 무료배송과 별도로 적용한다', () => {
    const delivery = { shippingFee: 3000, freeShippingThreshold: 80000, remoteAreaSurcharge: 3000, postalCode: '63000', remotePostalRanges: jejuRange }
    expect(orderTotals(products, [{ productId: products[1].id }], 'shipping', delivery)).toMatchObject({ baseShippingFee: 3000, remoteAreaSurcharge: 3000, shippingFee: 6000, total: 26000, deliveryZone: 'remote' })
    expect(orderTotals(products, Array.from({ length: 4 }, () => ({ productId: products[1].id })), 'shipping', delivery)).toMatchObject({ baseShippingFee: 0, remoteAreaSurcharge: 3000, shippingFee: 3000, total: 83000, deliveryZone: 'remote' })
    expect(orderTotals(products, [{ productId: products[1].id }], 'pickup', delivery)).toMatchObject({ remoteAreaSurcharge: 0, shippingFee: 0, deliveryZone: 'standard' })
  })
  it('입금 대기 상태에서만 고객이 수정할 수 있다', () => {
    expect(isCustomerEditable('payment_pending')).toBe(true)
    expect(isCustomerEditable('payment_confirmed')).toBe(false)
    expect(isCustomerEditable('preparing')).toBe(false)
    expect(isCustomerEditable('completed')).toBe(false)
  })
})
