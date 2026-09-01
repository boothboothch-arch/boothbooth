import { NextRequest } from 'next/server'
import { processPendingOrderEmails } from '@/server/email/order-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 })
  }

  try {
    const result = await processPendingOrderEmails(20)
    return Response.json({ ok: result.configured, ...result }, { status: result.configured ? 200 : 503 })
  } catch (cause) {
    console.error('Order email cron failed', cause)
    return Response.json({ ok: false }, { status: 500 })
  }
}
