import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fallbackSaleStatus } from '@/features/sale/domain/sale'
import { hasServerEnv } from '@/shared/config/env'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!hasServerEnv()) return NextResponse.json({ ...fallbackSaleStatus, serverNow: new Date().toISOString() })
  const client = createPrivilegedClient()
  const rawSaleId = request.nextUrl.searchParams.get('saleId')
  const parsedSaleId = rawSaleId ? z.uuid().safeParse(rawSaleId) : null
  if (rawSaleId && !parsedSaleId?.success) return NextResponse.json({ error: { code: 'INVALID_SALE', message: '테스트 차수를 확인해주세요.' } }, { status: 422 })
  const { data, error } = parsedSaleId?.success
    ? await client.rpc('get_test_sale_status', { p_sale_id: parsedSaleId.data })
    : await client.rpc('get_sale_status')
  if (error || !data) return NextResponse.json({ error: { code: 'SALE_STATUS_ERROR', message: '판매 상태를 불러오지 못했어요.' } }, { status: 503 })
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
