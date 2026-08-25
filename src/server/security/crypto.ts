import 'server-only'
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getServerEnv } from '@/shared/config/env'

function encryptionKey() {
  return createHmac('sha256', getServerEnv().PII_ENCRYPTION_KEY).update('booth-booth-pii-v1').digest()
}

export function encryptText(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptText(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split('.')
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('Invalid encrypted value')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8')
}

export function hmac(value: string) {
  return createHmac('sha256', getServerEnv().PII_HMAC_SECRET).update(value).digest('hex')
}

export function normalizePhone(value: string) {
  return value.replace(/\D/g, '')
}

export function randomOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

export function safeEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
