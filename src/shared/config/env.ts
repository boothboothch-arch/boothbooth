import { z } from 'zod'

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
})

const serverSchema = publicSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(10),
  PII_ENCRYPTION_KEY: z.string().min(32),
  PII_HMAC_SECRET: z.string().min(32),
  ORDER_ACCESS_SIGNING_SECRET: z.string().min(32),
})

export function hasPublicEnv() {
  return publicSchema.safeParse(process.env).success
}

export function hasServerEnv() {
  return serverSchema.safeParse(process.env).success
}

export function getPublicEnv() {
  const result = publicSchema.safeParse(process.env)
  if (!result.success) throw new Error('Supabase public environment variables are not configured.')
  return result.data
}

export function getServerEnv() {
  const result = serverSchema.safeParse(process.env)
  if (!result.success) throw new Error('Server environment variables are not configured.')
  return result.data
}
