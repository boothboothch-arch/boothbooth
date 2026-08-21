import { NextResponse, type NextRequest } from 'next/server'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { hmac } from '@/server/security/crypto'

export class ApiProblem extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message)
  }
}

export function apiError(error: unknown) {
  const problem = error instanceof ApiProblem ? error : new ApiProblem('INTERNAL_ERROR', '잠시 후 다시 시도해주세요.', 500)
  const requestId = crypto.randomUUID()
  return NextResponse.json({ error: { code: problem.code, message: problem.message, requestId } }, { status: problem.status, headers: { 'X-Request-Id': requestId } })
}

export function clientIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
}

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (origin && origin !== request.nextUrl.origin) throw new ApiProblem('INVALID_ORIGIN', '허용되지 않은 요청입니다.', 403)
}

export async function enforceRateLimit(request: NextRequest, scope: string, limit: number, windowSeconds: number) {
  const client = createPrivilegedClient()
  const key = hmac(`${scope}:${clientIp(request)}`)
  const { data, error } = await client.rpc('check_rate_limit', {
    p_scope: scope,
    p_key_hash: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) throw new ApiProblem('RATE_LIMIT_ERROR', '요청을 확인하지 못했어요.', 500)
  if (data !== true) throw new ApiProblem('RATE_LIMITED', '요청이 너무 많아요. 잠시 후 다시 시도해주세요.', 429)
}
