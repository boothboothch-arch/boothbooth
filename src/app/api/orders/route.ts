import { NextRequest, NextResponse } from 'next/server'
import { orderFormSchema } from '@/features/order/schemas'
import { INITIAL_TEXT_LIMIT } from '@/features/order/domain/order'
import { apiError, ApiProblem, assertSameOrigin, enforceRateLimit } from '@/server/http/api'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { createOrderAccessToken } from '@/server/security/access-token'
import { encryptText, hmac, normalizePhone } from '@/server/security/crypto'

function mapSubmitError(message: string) {
  if (message.includes('RESERVATION_EXPIRED')) return new ApiProblem('RESERVATION_EXPIRED', '주문서 이용 시간이 끝났어요.', 410)
  if (message.includes('DUPLICATE_ORDER')) return new ApiProblem('DUPLICATE_ORDER', '이미 처리된 주문 요청이에요.', 409)
  if (message.includes('INVALID_OPTION')) return new ApiProblem('INVALID_OPTION', '현재 선택할 수 없는 상품 옵션이 포함되어 있어요.', 409)
  if (message.includes('PRODUCT_SOLD_OUT')) return new ApiProblem('PRODUCT_SOLD_OUT', '선택한 한정 상품이 품절되었어요. 주문서를 새로 확인해주세요.', 409)
  if (message.includes('INVALID_INITIAL')) return new ApiProblem('INVALID_INITIAL', `이니셜은 영문 대·소문자로 공백 제외 ${INITIAL_TEXT_LIMIT}자까지 입력해주세요.`, 422)
  if (message.includes('INVALID_POSTAL_CODE')) return new ApiProblem('INVALID_POSTAL_CODE', '배송지 우편번호를 확인해주세요.', 422)
  if (message.includes('TOO_MANY_IMAGES')) return new ApiProblem('TOO_MANY_IMAGES', '첨부 가능한 이미지 수를 초과했어요.', 422)
  if (message.includes('INVALID_IMAGE')) return new ApiProblem('INVALID_IMAGE', '업로드된 참고 이미지를 확인하지 못했어요. 다시 첨부해주세요.', 422)
  return new ApiProblem('ORDER_SUBMIT_ERROR', '주문을 접수하지 못했어요. 잠시 후 다시 시도해주세요.', 500)
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request)
    await enforceRateLimit(request, 'order-submit', 10, 3600)
    const token = request.cookies.get('bb_reservation')?.value
    if (!token) throw new ApiProblem('RESERVATION_EXPIRED', '주문서 이용 시간이 끝났어요.', 410)
    const parsed = orderFormSchema.safeParse(await request.json())
    if (!parsed.success) throw new ApiProblem('INVALID_INPUT', parsed.error.issues[0]?.message ?? '입력 내용을 확인해주세요.', 422)
    const value = parsed.data
    const phone = normalizePhone(value.phone)
    const idempotencyKey = request.headers.get('idempotency-key') ?? crypto.randomUUID()
    const payload = {
      customerName: value.customerName,
      phoneCiphertext: encryptText(phone),
      depositorName: value.depositorName,
      fulfillmentType: value.fulfillmentType,
      postalCode: value.fulfillmentType === 'shipping' ? value.postalCode : '',
      addressCiphertext: value.fulfillmentType === 'shipping' ? encryptText(JSON.stringify({ postalCode: value.postalCode, address: value.address, addressDetail: value.addressDetail })) : '',
      cashReceiptType: value.cashReceiptType,
      cashReceiptIdentifierCiphertext: value.cashReceiptType === 'none' ? '' : encryptText(value.cashReceiptIdentifier.replaceAll('-', '')),
      items: value.items,
    }
    const { data, error } = await createPrivilegedClient().rpc('submit_order', {
      p_token_hash: hmac(token),
      p_idempotency_key: idempotencyKey,
      p_payload: payload,
      p_phone_hash: hmac(phone),
      p_email_hash: null,
      p_phone_last4_hash: hmac(phone.slice(-4)),
    })
    if (error) throw mapSubmitError(error.message)
    const result = data as { orderNumber: string }
    const response = NextResponse.json({ ...result, redirectTo: `/order/complete/${result.orderNumber}` })
    response.cookies.set('bb_order_access', createOrderAccessToken(result.orderNumber), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 60, path: '/' })
    response.cookies.delete('bb_reservation')
    return response
  } catch (error) { return apiError(error) }
}
