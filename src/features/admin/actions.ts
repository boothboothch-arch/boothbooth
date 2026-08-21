'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/server/auth/admin'
import { encryptText, hmac, normalizeEmail, normalizePhone } from '@/server/security/crypto'
import { createAuthServerClient } from '@/server/supabase/server-client'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim()
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
    ['ACTIVE_PICKUP_SLOT_REQUIRED', '공개 전에 활성 픽업 시간을 한 개 이상 등록해주세요.'],
    ['ACTIVE_SHIRT_REQUIRED', '공개 전에 티셔츠 상품을 활성화해주세요.'],
    ['ACTIVE_BAG_REQUIRED', '공개 전에 가방 상품을 활성화해주세요.'],
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
  const client = createPrivilegedClient()
  const { error } = await client.rpc('admin_update_order', {
    p_order_id: value(formData, 'orderId'),
    p_order_state: value(formData, 'orderState'),
    p_payment_state: value(formData, 'paymentState'),
    p_payment_review_reason: value(formData, 'paymentReviewReason') || null,
    p_cancellation_reason: value(formData, 'cancellationReason') || null,
    p_carrier_code: value(formData, 'carrierCode') || null,
    p_carrier_name: value(formData, 'carrierName') || null,
    p_tracking_number: value(formData, 'trackingNumber') || null,
  })
  if (error) redirect(`/admin/orders/${orderNumber}?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/admin')
  revalidatePath('/admin/orders')
  revalidatePath(`/admin/orders/${orderNumber}`)
  redirect(`/admin/orders/${orderNumber}?saved=1`)
}

export async function updateOrderInfoAction(formData: FormData) {
  await requireAdmin()
  const orderNumber = value(formData, 'orderNumber')
  const phone = normalizePhone(value(formData, 'phone'))
  const email = normalizeEmail(value(formData, 'email'))
  if (!/^01[016789]\d{7,8}$/.test(phone) || !/^\S+@\S+\.\S+$/.test(email)) {
    redirect(`/admin/orders/${orderNumber}?error=${encodeURIComponent('휴대전화 또는 이메일 형식을 확인해주세요.')}`)
  }
  const client = createPrivilegedClient()
  const patch: Record<string, unknown> = {
    customer_name: value(formData, 'customerName'), phone_ciphertext: encryptText(phone), phone_normalized_hash: hmac(phone), phone_last4_hash: hmac(phone.slice(-4)),
    email_ciphertext: encryptText(email), email_normalized_hash: hmac(email), depositor_name: value(formData, 'depositorName'),
  }
  if (value(formData, 'fulfillmentType') === 'shipping') patch.address_ciphertext = encryptText(JSON.stringify({ postalCode: value(formData, 'postalCode'), address: value(formData, 'address'), addressDetail: value(formData, 'addressDetail') }))
  const { error } = await client.from('orders').update(patch).eq('id', value(formData, 'orderId'))
  if (error) redirect(`/admin/orders/${orderNumber}?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/admin')
  revalidatePath('/admin/orders')
  revalidatePath(`/admin/orders/${orderNumber}`)
  redirect(`/admin/orders/${orderNumber}?saved=1`)
}

export async function resendOrderEmailAction(formData: FormData) {
  await requireAdmin()
  const orderNumber = value(formData, 'orderNumber')
  const client = createPrivilegedClient()
  const { error } = await client.rpc('admin_requeue_email', {
    p_order_id: value(formData, 'orderId'),
    p_event_type: value(formData, 'eventType'),
  })
  if (error) redirect(`/admin/orders/${orderNumber}?error=${encodeURIComponent(error.message)}`)
  revalidatePath(`/admin/orders/${orderNumber}`)
  redirect(`/admin/orders/${orderNumber}?emailQueued=1`)
}

export async function updateSettingsAction(formData: FormData) {
  await requireAdmin()
  const account = value(formData, 'bankAccount')
  const sizes = [...new Set(value(formData, 'sizes').split(',').map((item) => item.trim()).filter(Boolean))]
  const genders = [...new Set(value(formData, 'genders').split(',').map((item) => item.trim()).filter(Boolean))]
  const pickupSlots = value(formData, 'pickupSlots').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [pickup_date, starts_at, ends_at] = line.split(',').map((entry) => entry.trim())
    return { pickup_date, starts_at, ends_at }
  })
  const orderLimit = Number(value(formData, 'orderLimit'))
  const shirtPrice = Number(value(formData, 'shirtPrice'))
  const bagPrice = Number(value(formData, 'bagPrice'))
  const twoXlSurcharge = Number(value(formData, 'twoXlSurcharge'))
  const shippingFee = Number(value(formData, 'shippingFee'))
  const freeShippingThreshold = Number(value(formData, 'freeShippingThreshold'))
  const saleId = value(formData, 'saleId')
  const startsAtValue = value(formData, 'startsAt')
  const endsAtValue = value(formData, 'endsAt')
  const pickupKeys = pickupSlots.map((slot) => `${slot.pickup_date},${slot.starts_at},${slot.ends_at}`)
  const validPickupSlots = pickupSlots.every((slot) =>
    /^\d{4}-\d{2}-\d{2}$/.test(slot.pickup_date)
    && /^\d{2}:\d{2}$/.test(slot.starts_at)
    && /^\d{2}:\d{2}$/.test(slot.ends_at)
    && slot.starts_at < slot.ends_at,
  ) && new Set(pickupKeys).size === pickupKeys.length
  const numbers = [orderLimit, shirtPrice, bagPrice, twoXlSurcharge, shippingFee, freeShippingThreshold]
  const requiredText = ['title', 'shirtName', 'bagName', 'bankName', 'bankHolder', 'kakaoChannelUrl', 'pickupName'].every((key) => Boolean(value(formData, key)))
  const validKakaoUrl = isHttpUrl(value(formData, 'kakaoChannelUrl'))
  const validDateInput = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsAtValue) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(endsAtValue)
  const startsAt = validDateInput ? kstDate(startsAtValue) : ''
  const endsAt = validDateInput ? kstDate(endsAtValue) : ''
  if (!saleId || !requiredText || !validKakaoUrl || !Number.isInteger(orderLimit) || orderLimit < 1 || numbers.some((number) => !Number.isInteger(number) || number < 0) || !sizes.length || !genders.length || !validPickupSlots || !startsAt || !endsAt || Date.parse(startsAt) >= Date.parse(endsAt)) {
    redirect(settingsUrl(saleId, 'error', '접수 한도, 상품 옵션 또는 픽업 시간 형식을 확인해주세요.') as never)
  }
  const client = createPrivilegedClient()
  const { error } = await client.rpc('admin_update_sale_settings', {
    p_sale_id: saleId,
    p_config: {
      title: value(formData, 'title'), startsAt, endsAt, orderLimit,
      manuallyClosed: formData.get('manuallyClosed') === 'on',
      bankName: value(formData, 'bankName'), bankAccountCiphertext: account ? encryptText(account) : null,
      bankHolder: value(formData, 'bankHolder'), kakaoChannelUrl: value(formData, 'kakaoChannelUrl'),
      shippingNotice: value(formData, 'shippingNotice'), shippingFee, freeShippingThreshold,
      pickupName: value(formData, 'pickupName'), pickupAddress: value(formData, 'pickupAddress'),
      pickupNotice: value(formData, 'pickupNotice'), internalNote: value(formData, 'internalNote'),
      shirt: { name: value(formData, 'shirtName'), unitPrice: shirtPrice },
      bag: { name: value(formData, 'bagName'), unitPrice: bagPrice },
      sizes: sizes.map((size, index) => ({ value: size, sortOrder: index + 1, priceDelta: size === '2XL' ? twoXlSurcharge : 0 })),
      genders: genders.map((gender, index) => ({ value: gender, sortOrder: index + 1 })),
      pickupSlots: pickupSlots.map((slot) => ({ pickupDate: slot.pickup_date, startsAt: slot.starts_at, endsAt: slot.ends_at })),
    },
  })
  if (error) redirect(settingsUrl(saleId, 'error', saleErrorMessage(error.message)) as never)
  revalidatePath('/')
  revalidatePath('/admin')
  revalidatePath('/admin/settings')
  revalidatePath('/admin/sales')
  redirect(settingsUrl(saleId, 'saved') as never)
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
