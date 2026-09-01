import { z } from 'zod'
import { INITIAL_TEXT_LIMIT } from './domain/order'

const optionalNote = z.string().trim().max(300, '300자 이내로 입력해주세요.')
const databaseId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

export const uploadedImageSchema = z.object({
  id: z.uuid(),
})

export const orderItemSchema = z.object({
  clientId: z.uuid(),
  productId: databaseId,
  itemType: z.enum(['shirt', 'bag']),
  selectedOptionValueIds: z.array(z.uuid()).max(30),
  initialText: z.string().trim().max(40).refine((text) => !text || /^[A-Za-z ]+$/.test(text), '이니셜은 영문 대·소문자만 입력해주세요.').refine((text) => text.replaceAll(' ', '').length <= INITIAL_TEXT_LIMIT, `이니셜은 공백 제외 ${INITIAL_TEXT_LIMIT}자까지 입력할 수 있어요.`),
  stickerSelected: z.boolean(),
  stickerCategories: z.string().trim().max(200),
  extraRequest: optionalNote,
  images: z.array(z.uuid()).max(3, '상품 하나에 이미지는 최대 3장까지 첨부할 수 있어요.'),
})

export const orderFormSchema = z.object({
  customerName: z.string().trim().min(2, '이름을 입력해주세요.').max(50),
  phone: z.string().regex(/^01[016789]-?\d{3,4}-?\d{4}$/, '휴대전화 번호를 확인해주세요.'),
  email: z.string().trim().toLowerCase().max(254).email('이메일 주소를 확인해주세요.'),
  depositorName: z.string().trim().min(2, '입금자명을 입력해주세요.').max(50),
  fulfillmentType: z.enum(['shipping', 'pickup']),
  postalCode: z.string().trim().max(10),
  address: z.string().trim().max(200),
  addressDetail: z.string().trim().max(200),
  cashReceiptType: z.enum(['none', 'personal', 'business']),
  cashReceiptIdentifier: z.string().trim().max(20),
  items: z.array(orderItemSchema).min(1, '상품을 하나 이상 추가해주세요.'),
  privacyConsent: z.boolean().refine((value) => value, '개인정보 수집에 동의해주세요.'),
  customOrderConsent: z.boolean().refine((value) => value, '커스텀 제작 및 교환·환불 안내에 동의해주세요.'),
  website: z.string().max(0).optional(),
}).superRefine((value, context) => {
  if (value.fulfillmentType === 'shipping') {
    if (!/^\d{5}$/.test(value.postalCode)) context.addIssue({ code: 'custom', path: ['postalCode'], message: '우편번호를 확인해주세요.' })
    if (value.address.length < 3) context.addIssue({ code: 'custom', path: ['address'], message: '주소를 입력해주세요.' })
    if (!value.addressDetail) context.addIssue({ code: 'custom', path: ['addressDetail'], message: '상세 주소를 입력해주세요.' })
  }
  if (value.cashReceiptType === 'personal' && !/^01[016789]\d{7,8}$/.test(value.cashReceiptIdentifier.replaceAll('-', ''))) {
    context.addIssue({ code: 'custom', path: ['cashReceiptIdentifier'], message: '소득공제용 휴대전화 번호를 확인해주세요.' })
  }
  if (value.cashReceiptType === 'business' && !/^\d{10}$/.test(value.cashReceiptIdentifier.replaceAll('-', ''))) {
    context.addIssue({ code: 'custom', path: ['cashReceiptIdentifier'], message: '사업자등록번호 10자리를 확인해주세요.' })
  }
  if (value.items.reduce((sum, item) => sum + item.images.length, 0) > 20) {
    context.addIssue({ code: 'custom', path: ['items'], message: '한 주문에는 이미지를 최대 20장까지 첨부할 수 있어요.' })
  }
})

export type OrderFormInput = z.infer<typeof orderFormSchema>

export const customerOrderUpdateSchema = z.object({
  fulfillmentType: z.enum(['shipping', 'pickup']),
  postalCode: z.string().trim().max(10),
  address: z.string().trim().max(200),
  addressDetail: z.string().trim().max(200),
  cashReceiptType: z.enum(['none', 'personal', 'business']),
  cashReceiptIdentifier: z.string().trim().max(20),
  items: z.array(orderItemSchema.omit({ clientId: true }).extend({ id: z.uuid() })).min(1),
}).superRefine((value, context) => {
  if (value.fulfillmentType === 'shipping') {
    if (!/^\d{5}$/.test(value.postalCode)) context.addIssue({ code: 'custom', path: ['postalCode'], message: '우편번호를 확인해주세요.' })
    if (value.address.length < 3) context.addIssue({ code: 'custom', path: ['address'], message: '주소를 입력해주세요.' })
    if (!value.addressDetail) context.addIssue({ code: 'custom', path: ['addressDetail'], message: '상세 주소를 입력해주세요.' })
  }
  const digits = value.cashReceiptIdentifier.replaceAll('-', '')
  if (value.cashReceiptType === 'personal' && !/^01[016789]\d{7,8}$/.test(digits)) context.addIssue({ code: 'custom', path: ['cashReceiptIdentifier'], message: '휴대전화 번호를 확인해주세요.' })
  if (value.cashReceiptType === 'business' && !/^\d{10}$/.test(digits)) context.addIssue({ code: 'custom', path: ['cashReceiptIdentifier'], message: '사업자등록번호를 확인해주세요.' })
  if (value.items.reduce((sum, item) => sum + item.images.length, 0) > 20) {
    context.addIssue({ code: 'custom', path: ['items'], message: '한 주문에는 이미지를 최대 20장까지 첨부할 수 있어요.' })
  }
})

export type CustomerOrderUpdateInput = z.infer<typeof customerOrderUpdateSchema>

export const orderLookupSchema = z.object({
  orderNumber: z.string().trim().toUpperCase().regex(/^BB-[0-9A-HJKMNP-TV-Z]{10}$/, '주문번호를 확인해주세요.'),
  phoneLast4: z.string().regex(/^\d{4}$/, '휴대전화 뒷자리 4개를 입력해주세요.'),
})
