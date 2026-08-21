import { NextRequest, NextResponse } from 'next/server'
import { apiError, ApiProblem, assertSameOrigin } from '@/server/http/api'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { hmac } from '@/server/security/crypto'

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request)
    const token = request.cookies.get('bb_reservation')?.value
    if (!token) throw new ApiProblem('RESERVATION_EXPIRED', '주문서 이용 시간이 끝났어요.', 410)
    const { data, error } = await createPrivilegedClient().rpc('heartbeat_reservation', { p_token_hash: hmac(token) })
    if (error) throw new ApiProblem('RESERVATION_EXPIRED', '주문서 이용 시간이 끝났어요.', 410)
    return NextResponse.json(data)
  } catch (error) { return apiError(error) }
}
