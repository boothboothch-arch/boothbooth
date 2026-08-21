import { NextRequest, NextResponse } from 'next/server'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { hmac } from '@/server/security/crypto'
import { apiError, assertSameOrigin } from '@/server/http/api'

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request)
    const token = request.cookies.get('bb_reservation')?.value
    if (token) await createPrivilegedClient().rpc('release_reservation', { p_token_hash: hmac(token) })
    const response = NextResponse.json({ released: true })
    response.cookies.delete('bb_reservation')
    return response
  } catch (error) { return apiError(error) }
}
