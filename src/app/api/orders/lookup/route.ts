import { NextRequest, NextResponse } from 'next/server'
import { orderLookupSchema } from '@/features/order/schemas'
import { apiError, ApiProblem, assertSameOrigin, enforceRateLimit } from '@/server/http/api'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { createOrderAccessToken } from '@/server/security/access-token'
import { hmac, safeEqual } from '@/server/security/crypto'

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request)
    await enforceRateLimit(request, 'order-lookup', 10, 10 * 60)
    const parsed = orderLookupSchema.safeParse(await request.json())
    if (!parsed.success) throw new ApiProblem('INVALID_INPUT', parsed.error.issues[0]?.message ?? '입력 내용을 확인해주세요.', 422)
    const { orderNumber, phoneLast4 } = parsed.data
    const { data } = await createPrivilegedClient().from('orders').select('order_number,phone_last4_hash').eq('order_number', orderNumber).maybeSingle()
    if (!data || !safeEqual(data.phone_last4_hash, hmac(phoneLast4))) throw new ApiProblem('ORDER_NOT_FOUND', '주문번호 또는 휴대전화 번호를 확인해주세요.', 404)
    const response = NextResponse.json({ redirectTo: `/orders/${orderNumber}` })
    response.cookies.set('bb_order_access', createOrderAccessToken(orderNumber), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 60, path: '/' })
    return response
  } catch (error) { return apiError(error) }
}
