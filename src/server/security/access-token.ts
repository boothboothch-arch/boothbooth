import 'server-only'
import { createHmac } from 'node:crypto'
import { getServerEnv } from '@/shared/config/env'
import { safeEqual } from './crypto'

type OrderAccessPayload = { orderNumber: string; expiresAt: number }

function signature(payload: string) {
  return createHmac('sha256', getServerEnv().ORDER_ACCESS_SIGNING_SECRET).update(payload).digest('base64url')
}

export function createOrderAccessToken(orderNumber: string, lifetimeSeconds = 30 * 60) {
  const payload: OrderAccessPayload = { orderNumber, expiresAt: Math.floor(Date.now() / 1000) + lifetimeSeconds }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signature(encoded)}`
}

export function verifyOrderAccessToken(token: string | undefined, orderNumber: string) {
  if (!token) return false
  const [encoded, candidate] = token.split('.')
  if (!encoded || !candidate || !safeEqual(signature(encoded), candidate)) return false
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OrderAccessPayload
    return payload.orderNumber === orderNumber && payload.expiresAt > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}
