'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/server/auth/admin'
import { encryptText, hmac, normalizeEmail, normalizePhone } from '@/server/security/crypto'
import { processOrderEmail } from '@/server/email/order-email'
import { createAuthServerClient } from '@/server/supabase/server-client'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { INITIAL_TEXT_LIMIT } from '@/features/order/domain/order'
import { z } from 'zod'

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim()
}

function jsonValue(formData: FormData, key: string, fallback: unknown) {
  try { return JSON.parse(value(formData, key)) as unknown } catch { return fallback }
}

function kstDate(value: string) {
  const date = new Date(`${value}:00+09:00`)
  if (Number.isNaN(date.getTime())) throw new Error('판매 시간을 확인해주세요.')
  return date.toISOString()
}

function isHttpUrl(value: string) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

function settingsUrl(saleId: string, key: 'saved' | 'created' | 'error', message = '1') {
  const params = new URLSearchParams({ saleId, [key]: message })
  return `/admin/settings?${params.toString()}`
}

function saleErrorMessage(message: string) {
  const matched = [
    ['ROUND_NUMBER_ALREADY_EXISTS', '이미 존재하는 차수입니다.'],
    ['PUBLISHED_SALE_WINDOW_OVERLAP', '다른 공개 판매와 판매 시간이 겹칩니다.'],
    ['ACTIVE_SHIRT_REQUIRED', '공개 전에 티셔츠 상품을 활성화해주세요.'],
    ['ACTIVE_BAG_REQUIRED', '공개 전에 가방 상품을 활성화해주세요.'],
    ['ACTIVE_PRODUCT_REQUIRED', '공개 전에 판매할 상품을 한 개 이상 활성화해주세요.'],
    ['ACTIVE_SIZE_REQUIRED', '공개 전에 티셔츠 사이즈를 등록해주세요.'],
    ['ACTIVE_GENDER_REQUIRED', '공개 전에 티셔츠 성별 옵션을 등록해주세요.'],
    ['BANK_INFO_REQUIRED', '공개 전에 입금 계좌 정보를 입력해주세요.'],
    ['KAKAO_CHANNEL_REQUIRED', '공개 전에 카카오톡 채널 주소를 입력해주세요.'],
    ['SALE_WITH_ORDERS_CANNOT_BE_DRAFT', '주문이 있는 판매는 초안으로 되돌릴 수 없습니다. 대신 보관 처리해주세요.'],
    ['TEST_SALE_CANNOT_BE_PUBLISHED', '테스트 차수는 고객 메인에 공개할 수 없습니다. 테스트 전용 링크를 이용해주세요.'],
    ['SALE_MUST_BE_DRAFT', '초안 상태의 차수만 삭제할 수 있습니다.'],
    ['SALE_HAS_ORDERS', '주문 이력이 있는 차수는 바로 삭제할 수 없습니다. 테스트 차수라면 먼저 테스트 데이터를 초기화해주세요.'],
    ['LAST_SALE_CANNOT_BE_DELETED', '마지막 남은 차수는 삭제할 수 없습니다. 새 차수를 먼저 만들어주세요.'],
    ['TEST_SALE_REQUIRED', '테스트 차수에서만 테스트 데이터를 초기화할 수 있습니다.'],
    ['PUBLISHED_SALE_CANNOT_BE_RESET', '공개 중인 차수는 초기화할 수 없습니다.'],
  ].find(([code]) => message.includes(code))
  return matched?.[1] ?? message
}

const imageBucket = 'order-reference-images'

function storagePaths(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('storagePaths' in payload)) return []
  const paths = (payload as { storagePaths?: unknown }).storagePaths
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string' && path.length > 0) : []
}

async function removeSaleImages(client: ReturnType<typeof createPrivilegedClient>, paths: string[]) {
  for (let index = 0; index < paths.length; index += 1000) {
    const { error } = await client.storage.from(imageBucket).remove(paths.slice(index, index + 1000))
    if (error) throw new Error('참고 이미지를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.')
  }
}

export async function logoutAction() {
  const client = await createAuthServerClient()
  await client.auth.signOut()
  redirect('/admin/login')
}

export async function updateOrderAction(formData: FormData) {
  await requireAdmin()
  const orderNumber = value(formData, 'orderNumber')
  const orderState = value(formData, 'orderState')
  const trackingNumber = value(formData, 'trackingNumber')
  if (orderState === 'completed' && value(formData, 'fulfillmentType') === 'shipping' && !trackingNumber) {
    redirect(`/admin/orders/${orderNumber}?error=${encodeURIComponent('출고 완료로 변경하려면 운송장 번호를 입력해주세요.')}`)
  }
  const paymentState = orderState === 'payment_pending'
    ? 'pending'
    : orderState === 'cancelled'
      ? 'pending'
      : 'paid'
  const client = createPrivilegedClient()
  const { error } = await client.rpc('admin_update_order', {
    p_order_id: value(formData, 'orderId'),
    p_order_state: orderState,
    p_payment_state: paymentState,
    p_payment_review_reason: null,
    p_cancellation_reason: orderState === 'cancelled' ? '미입금 취소' : null,
    p_carrier_code: value(formData, 'carrierCode') || null,
    p_carrier_name: value(formData, 'carrierName') || null,
    p_tracking_number: trackingNumber || null,
  })
  if (error) redirect(`/admin/orders/${orderNumber}?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/admin')
  revalidatePath('/admin/orders')
  revalidatePath(`/admin/orders/${orderNumber}`)
  redirect(`/admin/orders/${orderNumber}?saved=1`)
}

const bulkOrderStateSchema = z.object({
  orderIds: z.array(z.uuid()).min(1).max(1000),
  orderState: z.enum(['payment_pending', 'payment_confirmed', 'preparing', 'completed', 'cancelled']),
})

export async function bulkUpdateOrderStateAction(input: unknown): Promise<
  | { ok: true; changedCount: number; unchangedCount: number }
  | { ok: false; message: string }
> {
  await requireAdmin()
  const parsed = bulkOrderStateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: '선택한 주문과 변경할 상태를 다시 확인해주세요.' }
  const orderIds = [...new Set(parsed.data.orderIds)]
  if (orderIds.length !== parsed.data.orderIds.length) return { ok: false, message: '중복 선택된 주문이 있습니다. 목록을 새로고침한 후 다시 시도해주세요.' }

  const { data, error } = await createPrivilegedClient().rpc('admin_bulk_update_order_state_v1', {
    p_order_ids: orderIds,
    p_order_state: parsed.data.orderState,
  })
  if (error) {
    if (error.message.includes('BULK_TRACKING_REQUIRED')) return { ok: false, message: '출고 완료로 변경하려면 선택한 모든 택배 주문에 운송장 번호가 등록되어 있어야 합니다.' }
    if (error.message.includes('ORDER_NOT_FOUND')) return { ok: false, message: '목록을 불러온 뒤 변경되거나 삭제된 주문이 있습니다. 새로고침 후 다시 선택해주세요.' }
    if (error.message.includes('INVALID_BULK_ORDER_COUNT')) return { ok: false, message: '한 번에 변경할 수 있는 주문은 최대 1,000건입니다.' }
    return { ok: false, message: '주문 상태를 일괄 변경하지 못했습니다. 잠시 후 다시 시도해주세요.' }
  }

  const result = data as { changedCount?: number; unchangedCount?: number } | null
  revalidatePath('/admin')
  revalidatePath('/admin/orders')
  return {
    ok: true,
    changedCount: result?.changedCount ?? 0,
    unchangedCount: result?.unchangedCount ?? 0,
  }
}

export async function updateOrderInfoAction(formData: FormData) {
  await requireAdmin()
  const orderNumber = value(formData, 'orderNumber')
  const phone = normalizePhone(value(formData, 'phone'))
  const email = normalizeEmail(value(formData, 'email'))
  const fulfillmentType = value(formData, 'fulfillmentType')
  const postalCode = value(formData, 'postalCode')
  if (!/^01[016789]\d{7,8}$/.test(phone)) {
    redirect(`/admin/orders/${orderNumber}?error=${encodeURIComponent('휴대전화 형식을 확인해주세요.')}`)
  }
  if (!z.string().email().safeParse(email).success) {
    redirect(`/admin/orders/${orderNumber}?error=${encodeURIComponent('이메일 주소를 확인해주세요.')}`)
  }
  if (fulfillmentType === 'shipping' && !/^\d{5}$/.test(postalCode)) {
    redirect(`/admin/orders/${orderNumber}?error=${encodeURIComponent('우편번호를 확인해주세요.')}`)
  }
  const client = createPrivilegedClient()
  const addressCiphertext = fulfillmentType === 'shipping'
    ? encryptText(JSON.stringify({ postalCode, address: value(formData, 'address'), addressDetail: value(formData, 'addressDetail') }))
    : ''
  const orderId = value(formData, 'orderId')
  const { error } = await client.rpc('admin_update_order_contact_v3', {
    p_order_id: orderId,
    p_customer_name: value(formData, 'customerName'),
    p_phone_ciphertext: encryptText(phone),
    p_phone_hash: hmac(phone),
    p_phone_last4_hash: hmac(phone.slice(-4)),
    p_email_ciphertext: encryptText(email),
    p_email_hash: hmac(email),
    p_depositor_name: value(formData, 'depositorName'),
    p_address_ciphertext: addressCiphertext,
    p_postal_code: postalCode,
  })
  if (error) redirect(`/admin/orders/${orderNumber}?error=${encodeURIComponent(error.message)}`)
  await processOrderEmail(orderId)
  revalidatePath('/admin')
  revalidatePath('/admin/orders')
  revalidatePath(`/admin/orders/${orderNumber}`)
  redirect(`/admin/orders/${orderNumber}?saved=1`)
}

const adminOrderItemUpdateSchema = z.object({
  orderId: z.uuid(),
  orderItemId: z.uuid(),
  selectedOptionValueIds: z.array(z.uuid()).max(30),
  initialText: z.string().trim().max(40).refine((text) => !text || /^[A-Za-z ]+$/.test(text), '이니셜은 영문 대·소문자만 입력해주세요.').refine((text) => text.replaceAll(' ', '').length <= INITIAL_TEXT_LIMIT, `이니셜은 공백 제외 ${INITIAL_TEXT_LIMIT}자까지 입력할 수 있습니다.`),
  stickerSelected: z.boolean(),
  stickerCategories: z.string().trim().max(200),
  extraRequest: z.string().trim().max(300),
}).superRefine((value, context) => {
  if (value.stickerSelected && !value.stickerCategories.split(',').some((category) => category.trim())) {
    context.addIssue({ code: 'custom', path: ['stickerCategories'], message: '원하는 스티커 카테고리를 하나 이상 입력해주세요.' })
  }
})

function orderItemUpdateError(message: string) {
  if (message.includes('ORDER_ITEM_NOT_EDITABLE')) return '출고 완료 또는 취소된 주문의 제작 정보는 수정할 수 없습니다.'
  if (message.includes('INVALID_OPTION')) return '상품 옵션 선택 조건을 확인해주세요.'
  if (message.includes('INVALID_INITIAL')) return `이니셜은 영문 대·소문자로 공백 제외 ${INITIAL_TEXT_LIMIT}자까지 입력해주세요.`
  if (message.includes('ORDER_ITEM_NOT_FOUND') || message.includes('PRODUCT_NOT_FOUND')) return '수정할 상품 정보를 찾지 못했습니다.'
  return '상품별 제작 정보를 수정하지 못했습니다.'
}

export async function updateOrderItemAction(formData: FormData) {
  const admin = await requireAdmin()
  const orderNumber = value(formData, 'orderNumber')
  const parsed = adminOrderItemUpdateSchema.safeParse({
    orderId: value(formData, 'orderId'),
    orderItemId: value(formData, 'orderItemId'),
    selectedOptionValueIds: jsonValue(formData, 'selectedOptionValueIds', null),
    initialText: value(formData, 'initialText'),
    stickerSelected: value(formData, 'stickerSelected') === 'true',
    stickerCategories: value(formData, 'stickerCategories'),
    extraRequest: value(formData, 'extraRequest'),
  })
  if (!orderNumber || !parsed.success) {
    const message = parsed.success ? '주문번호를 확인해주세요.' : parsed.error.issues[0]?.message ?? '입력 내용을 확인해주세요.'
    redirect(`/admin/orders/${orderNumber}?error=${encodeURIComponent(message)}` as never)
  }
  const { error } = await createPrivilegedClient().rpc('admin_update_order_item_v1', {
    p_order_id: parsed.data.orderId,
    p_order_item_id: parsed.data.orderItemId,
    p_payload: {
      selectedOptionValueIds: parsed.data.selectedOptionValueIds,
      initialText: parsed.data.initialText,
      stickerSelected: parsed.data.stickerSelected,
      stickerCategories: parsed.data.stickerSelected ? parsed.data.stickerCategories : '',
      extraRequest: parsed.data.extraRequest,
    },
    p_admin_user_id: admin.id,
  })
  if (error) redirect(`/admin/orders/${orderNumber}?error=${encodeURIComponent(orderItemUpdateError(error.message))}` as never)
  revalidatePath('/admin')
  revalidatePath('/admin/orders')
  revalidatePath(`/admin/orders/${orderNumber}`)
  redirect(`/admin/orders/${orderNumber}?itemSaved=1` as never)
}

export async function updateSettingsAction(formData: FormData) {
  await requireAdmin()
  const account = value(formData, 'bankAccount')
  const orderLimit = Number(value(formData, 'orderLimit'))
  const shippingFee = Number(value(formData, 'shippingFee'))
  const freeShippingThreshold = Number(value(formData, 'freeShippingThreshold'))
  const remoteAreaSurcharge = Number(value(formData, 'remoteAreaSurcharge'))
  const saleId = value(formData, 'saleId')
  const startsAtValue = value(formData, 'startsAt')
  const endsAtValue = value(formData, 'endsAt')
  const numbers = [orderLimit, shippingFee, freeShippingThreshold, remoteAreaSurcharge]
  const requiredText = ['title', 'bankName', 'bankHolder', 'kakaoChannelUrl', 'pickupName'].every((key) => Boolean(value(formData, key)))
  const validKakaoUrl = isHttpUrl(value(formData, 'kakaoChannelUrl'))
  const validDateInput = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsAtValue) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(endsAtValue)
  const startsAt = validDateInput ? kstDate(startsAtValue) : ''
  const endsAt = validDateInput ? kstDate(endsAtValue) : ''
  if (!saleId || !requiredText || !validKakaoUrl || !Number.isInteger(orderLimit) || orderLimit < 1 || numbers.some((number) => !Number.isInteger(number) || number < 0) || !startsAt || !endsAt || Date.parse(startsAt) >= Date.parse(endsAt)) {
    redirect(settingsUrl(saleId, 'error', '접수 한도, 판매 시간 또는 비용 설정을 확인해주세요.') as never)
  }
  const client = createPrivilegedClient()
  const { error } = await client.rpc('admin_update_sale_settings_v2', {
    p_sale_id: saleId,
    p_config: {
      title: value(formData, 'title'), startsAt, endsAt, orderLimit,
      manuallyClosed: formData.get('manuallyClosed') === 'on',
      bankName: value(formData, 'bankName'), bankAccountCiphertext: account ? encryptText(account) : null,
      bankHolder: value(formData, 'bankHolder'), kakaoChannelUrl: value(formData, 'kakaoChannelUrl'),
      shippingNotice: value(formData, 'shippingNotice'), shippingFee, freeShippingThreshold, remoteAreaSurcharge,
      pickupName: value(formData, 'pickupName'), pickupAddress: value(formData, 'pickupAddress'),
      pickupNotice: value(formData, 'pickupNotice'), internalNote: value(formData, 'internalNote'),
    },
  })
  if (error) redirect(settingsUrl(saleId, 'error', saleErrorMessage(error.message)) as never)
  revalidatePath('/')
  revalidatePath('/admin')
  revalidatePath('/admin/settings')
  revalidatePath('/admin/sales')
  redirect(settingsUrl(saleId, 'saved') as never)
}

const optionValueSchema = z.object({
  id: z.uuid(), label: z.string().trim().min(1).max(80), priceDelta: z.number().int().min(0),
  sortOrder: z.number().int().min(0), active: z.boolean(),
})
const optionGroupSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(80), selectionType: z.enum(['single', 'multiple']),
  required: z.boolean(), minSelections: z.number().int().min(0), maxSelections: z.number().int().min(1),
  sortOrder: z.number().int().min(0), active: z.boolean(), values: z.array(optionValueSchema).min(1),
}).refine((group) => group.minSelections <= group.maxSelections, '최소 선택 수는 최대 선택 수보다 클 수 없습니다.')
  .refine((group) => group.maxSelections <= group.values.filter((option) => option.active).length || !group.active, '최대 선택 수는 사용 중인 선택값 수보다 클 수 없습니다.')
  .refine((group) => new Set(group.values.map((option) => option.id)).size === group.values.length, '선택값 식별자가 중복되었습니다.')

export async function saveProductAction(formData: FormData) {
  await requireAdmin()
  const saleId = value(formData, 'saleId')
  const productId = value(formData, 'productId') || null
  const unitPrice = Number(value(formData, 'unitPrice'))
  const stockText = value(formData, 'stockLimit')
  const stockLimit = stockText ? Number(stockText) : null
  const sortOrder = Number(value(formData, 'sortOrder'))
  const optionGroups = z.array(optionGroupSchema).refine((groups) => new Set(groups.map((group) => group.id)).size === groups.length, '옵션 그룹 식별자가 중복되었습니다.').safeParse(jsonValue(formData, 'optionGroups', null))
  const customizationConfig = z.object({
    initialEnabled: z.boolean(), stickerEnabled: z.boolean(), referenceImagesEnabled: z.boolean(), extraRequestEnabled: z.boolean(),
  }).safeParse(jsonValue(formData, 'customizationConfig', null))
  const validNumbers = Number.isInteger(unitPrice) && unitPrice >= 0 && Number.isInteger(sortOrder)
    && (stockLimit === null || Number.isInteger(stockLimit) && stockLimit >= 0)
  if (!saleId || !['shirt', 'bag'].includes(value(formData, 'itemType')) || !value(formData, 'name') || !validNumbers || !optionGroups.success || !customizationConfig.success) {
    redirect(`/admin/sales/${saleId}/products?error=${encodeURIComponent(optionGroups.error?.issues[0]?.message ?? '상품과 옵션 입력값을 확인해주세요.')}` as never)
  }
  const { error } = await createPrivilegedClient().rpc('admin_upsert_product', {
    p_sale_id: saleId,
    p_product_id: productId,
    p_config: {
      name: value(formData, 'name'), description: value(formData, 'description'), itemType: value(formData, 'itemType'),
      unitPrice, stockLimit, sortOrder, active: formData.get('active') === 'on', optionGroups: optionGroups.data,
      customizationConfig: customizationConfig.data,
    },
  })
  if (error) redirect(`/admin/sales/${saleId}/products?error=${encodeURIComponent(saleErrorMessage(error.message))}` as never)
  revalidatePath('/')
  revalidatePath('/order')
  revalidatePath(`/admin/sales/${saleId}/products`)
  revalidatePath('/admin/settings')
  redirect(`/admin/sales/${saleId}/products?saved=1` as never)
}

export async function removeProductAction(formData: FormData) {
  await requireAdmin()
  const saleId = value(formData, 'saleId')
  const { error } = await createPrivilegedClient().rpc('admin_remove_product', {
    p_sale_id: saleId, p_product_id: value(formData, 'productId'),
  })
  if (error) redirect(`/admin/sales/${saleId}/products?error=${encodeURIComponent(saleErrorMessage(error.message))}` as never)
  revalidatePath('/')
  revalidatePath('/order')
  revalidatePath(`/admin/sales/${saleId}/products`)
  redirect(`/admin/sales/${saleId}/products?removed=1` as never)
}

export async function createSaleAction(formData: FormData) {
  await requireAdmin()
  const sourceSaleId = value(formData, 'sourceSaleId')
  const roundNumber = Number(value(formData, 'roundNumber'))
  const title = value(formData, 'title')
  const startsAtValue = value(formData, 'startsAt')
  const endsAtValue = value(formData, 'endsAt')
  const validDates = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsAtValue) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(endsAtValue)
  const startsAt = validDates ? kstDate(startsAtValue) : ''
  const endsAt = validDates ? kstDate(endsAtValue) : ''
  const saleKind = value(formData, 'saleKind')
  if (!sourceSaleId || !Number.isInteger(roundNumber) || roundNumber < 1 || !title || !startsAt || !endsAt || Date.parse(startsAt) >= Date.parse(endsAt) || !['live', 'test'].includes(saleKind)) {
    redirect(`/admin/sales/new?error=${encodeURIComponent('복사할 차수, 새 차수 번호와 제목을 확인해주세요.')}` as never)
  }

  const client = createPrivilegedClient()
  const { data, error } = await client.rpc('admin_clone_sale_v2', {
    p_source_sale_id: sourceSaleId,
    p_round_number: roundNumber,
    p_title: title,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_internal_note: value(formData, 'internalNote'),
    p_sale_kind: saleKind,
  })
  if (error || !data) {
    redirect(`/admin/sales/new?error=${encodeURIComponent(saleErrorMessage(error?.message ?? '차수를 만들지 못했습니다.'))}` as never)
  }

  revalidatePath('/admin/sales')
  redirect(settingsUrl(String(data), 'created') as never)
}

export async function updateSalePublicationAction(formData: FormData) {
  await requireAdmin()
  const saleId = value(formData, 'saleId')
  const status = value(formData, 'publicationStatus')
  const requestedReturnTo = value(formData, 'returnTo')
  const returnTo = requestedReturnTo.startsWith('/admin/settings?') ? requestedReturnTo : '/admin/sales'
  const client = createPrivilegedClient()
  const { error } = await client.rpc('admin_set_sale_publication', {
    p_sale_id: saleId,
    p_status: status,
  })
  if (error) {
    const separator = returnTo.includes('?') ? '&' : '?'
    redirect(`${returnTo}${separator}error=${encodeURIComponent(saleErrorMessage(error.message))}` as never)
  }

  revalidatePath('/')
  revalidatePath('/order')
  revalidatePath('/admin')
  revalidatePath('/admin/sales')
  revalidatePath('/admin/settings')
  const separator = returnTo.includes('?') ? '&' : '?'
  redirect(`${returnTo}${separator}publicationSaved=1` as never)
}

export async function deleteSaleAction(formData: FormData) {
  await requireAdmin()
  const saleId = value(formData, 'saleId')
  const client = createPrivilegedClient()
  const { data: sale } = await client.from('sales').select('id,round_number').eq('id', saleId).maybeSingle()
  if (!sale) redirect('/admin/sales?error=' + encodeURIComponent('삭제할 차수를 찾지 못했습니다.') as never)
  const expected = `${sale.round_number}차 영구삭제`
  if (value(formData, 'confirmation') !== expected) {
    redirect(`/admin/sales/${saleId}/delete?error=${encodeURIComponent(`확인 문구 “${expected}”를 정확히 입력해주세요.`)}` as never)
  }

  const { data: prepared, error: prepareError } = await client.rpc('admin_prepare_sale_deletion', { p_sale_id: saleId })
  if (prepareError) redirect(`/admin/sales/${saleId}/delete?error=${encodeURIComponent(saleErrorMessage(prepareError.message))}` as never)
  try {
    await removeSaleImages(client, storagePaths(prepared))
  } catch (error) {
    redirect(`/admin/sales/${saleId}/delete?error=${encodeURIComponent(error instanceof Error ? error.message : '참고 이미지를 삭제하지 못했습니다.')}` as never)
  }
  const { error } = await client.rpc('admin_delete_sale', { p_sale_id: saleId })
  if (error) redirect(`/admin/sales/${saleId}/delete?error=${encodeURIComponent(saleErrorMessage(error.message))}` as never)

  revalidatePath('/')
  revalidatePath('/admin')
  revalidatePath('/admin/sales')
  revalidatePath('/admin/settings')
  redirect('/admin/sales?deleted=1' as never)
}

export async function resetTestSaleAction(formData: FormData) {
  await requireAdmin()
  const saleId = value(formData, 'saleId')
  const client = createPrivilegedClient()
  const { data: sale } = await client.from('sales').select('id,round_number,sale_kind').eq('id', saleId).maybeSingle()
  if (!sale) redirect('/admin/sales?error=' + encodeURIComponent('초기화할 차수를 찾지 못했습니다.') as never)
  const expected = `${sale.round_number}차 테스트초기화`
  if (value(formData, 'confirmation') !== expected) {
    redirect(`/admin/sales/${saleId}/delete?error=${encodeURIComponent(`확인 문구 “${expected}”를 정확히 입력해주세요.`)}` as never)
  }

  const { data: prepared, error: prepareError } = await client.rpc('admin_prepare_test_sale_reset', { p_sale_id: saleId })
  if (prepareError) redirect(`/admin/sales/${saleId}/delete?error=${encodeURIComponent(saleErrorMessage(prepareError.message))}` as never)
  try {
    await removeSaleImages(client, storagePaths(prepared))
  } catch (error) {
    redirect(`/admin/sales/${saleId}/delete?error=${encodeURIComponent(error instanceof Error ? error.message : '참고 이미지를 삭제하지 못했습니다.')}` as never)
  }
  const { error } = await client.rpc('admin_reset_test_sale', { p_sale_id: saleId })
  if (error) redirect(`/admin/sales/${saleId}/delete?error=${encodeURIComponent(saleErrorMessage(error.message))}` as never)

  revalidatePath('/admin')
  revalidatePath('/admin/orders')
  revalidatePath('/admin/sales')
  revalidatePath(`/test/${saleId}`)
  redirect(`/admin/sales/${saleId}/delete?reset=1` as never)
}
