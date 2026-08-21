import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'
import { renderOrderEmail } from '@/server/email/render-email'
import { decryptText, safeEqual } from '@/server/security/crypto'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const emailEnvSchema = z.object({
  CRON_SHARED_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().min(10),
  EMAIL_FROM: z.string().min(3),
  NEXT_PUBLIC_APP_URL: z.string().url(),
})

type EmailJob = {
  id: string
  event_type: string
  recipient_ciphertext: string
  payload_json: Record<string, unknown>
}

export async function POST(request: NextRequest) {
  const parsed = emailEnvSchema.safeParse(process.env)
  if (!parsed.success) return NextResponse.json({ error: 'Email worker is not configured.' }, { status: 503 })
  const authorization = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${parsed.data.CRON_SHARED_SECRET}`
  if (!safeEqual(authorization, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const client = createPrivilegedClient()
  const { data, error } = await client.rpc('claim_email_jobs', { p_limit: 20 })
  if (error) return NextResponse.json({ error: 'Could not claim email jobs.' }, { status: 500 })
  const jobs = (data ?? []) as EmailJob[]
  const resend = new Resend(parsed.data.RESEND_API_KEY)
  let sent = 0
  let failed = 0

  for (const job of jobs) {
    try {
      const recipient = decryptText(job.recipient_ciphertext)
      const message = renderOrderEmail(job.event_type, job.payload_json, parsed.data.NEXT_PUBLIC_APP_URL)
      const result = await resend.emails.send({ from: parsed.data.EMAIL_FROM, to: recipient, subject: message.subject, html: message.html })
      if (result.error) throw new Error(result.error.message)
      await client.rpc('mark_email_sent', { p_id: job.id })
      sent += 1
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown email error'
      await client.rpc('mark_email_failed', { p_id: job.id, p_error: message })
      failed += 1
    }
  }
  return NextResponse.json({ claimed: jobs.length, sent, failed })
}

