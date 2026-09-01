import 'server-only'
import { z } from 'zod'
import { getServerEnv } from '@/shared/config/env'
import { decryptText } from '@/server/security/crypto'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { buildOrderReceivedEmail } from './order-email-template'

type EmailJob = {
  id: string
  order_id: string
  event_type: string
  dedupe_key: string
  recipient_ciphertext: string
  payload_json: unknown
}

const payloadSchema = z.object({
  customerName: z.string().min(1),
  orderNumber: z.string().min(1),
  totalAmount: z.number().int().nonnegative(),
  paymentDueAt: z.string().min(1),
  kakaoChannelUrl: z.string().url().optional(),
  saleKind: z.enum(['live', 'test']).default('live'),
})

export type EmailProcessingResult = {
  configured: boolean
  claimed: number
  sent: number
  failed: number
}

function emailConfig() {
  const env = getServerEnv()
  if (!env.RESEND_API_KEY || !env.ORDER_EMAIL_FROM) return null
  return {
    apiKey: env.RESEND_API_KEY,
    from: env.ORDER_EMAIL_FROM,
    replyTo: env.ORDER_EMAIL_REPLY_TO,
    appUrl: env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    kakaoChannelUrl: env.NEXT_PUBLIC_KAKAO_CHANNEL_URL,
  }
}

async function sendWithResend(job: EmailJob, config: NonNullable<ReturnType<typeof emailConfig>>) {
  if (job.event_type !== 'order_received') throw new Error(`Unsupported email event: ${job.event_type}`)
  const payload = payloadSchema.parse(job.payload_json)
  const recipient = decryptText(job.recipient_ciphertext)
  const email = buildOrderReceivedEmail({
    ...payload,
    appUrl: config.appUrl,
    kakaoChannelUrl: payload.kakaoChannelUrl ?? config.kakaoChannelUrl,
  })
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `order-email/${job.dedupe_key}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: [recipient],
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(8_000),
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Resend ${response.status}: ${raw.slice(0, 500)}`)
  const result = JSON.parse(raw) as { id?: string }
  if (!result.id) throw new Error('Resend response did not include a message id.')
  return result.id
}

async function processClaimedJobs(jobs: EmailJob[], config: NonNullable<ReturnType<typeof emailConfig>>) {
  const client = createPrivilegedClient()
  const results = await Promise.all(jobs.map(async (job) => {
    try {
      const providerMessageId = await sendWithResend(job, config)
      const { error } = await client.rpc('mark_email_sent', {
        p_id: job.id,
        p_provider_message_id: providerMessageId,
      })
      if (error) throw error
      return true
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown email delivery error'
      await client.rpc('mark_email_failed', { p_id: job.id, p_error: message })
      return false
    }
  }))
  const sent = results.filter(Boolean).length
  return { sent, failed: results.length - sent }
}

async function claimAndProcess(orderId?: string, limit = 20): Promise<EmailProcessingResult> {
  const config = emailConfig()
  if (!config) return { configured: false, claimed: 0, sent: 0, failed: 0 }
  const client = createPrivilegedClient()
  const result = orderId
    ? await client.rpc('claim_order_email_job', { p_order_id: orderId })
    : await client.rpc('claim_email_jobs', { p_limit: limit })
  if (result.error) throw result.error
  const jobs = (result.data ?? []) as EmailJob[]
  const processed = await processClaimedJobs(jobs, config)
  return { configured: true, claimed: jobs.length, ...processed }
}

export async function processOrderEmail(orderId: string): Promise<EmailProcessingResult> {
  try {
    return await claimAndProcess(orderId, 1)
  } catch {
    return { configured: false, claimed: 0, sent: 0, failed: 1 }
  }
}

export async function processPendingOrderEmails(limit = 20) {
  return claimAndProcess(undefined, limit)
}
