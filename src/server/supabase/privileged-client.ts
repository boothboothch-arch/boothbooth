import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { getServerEnv } from '@/shared/config/env'

export function createPrivilegedClient() {
  const env = getServerEnv()
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
