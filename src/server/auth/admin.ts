import 'server-only'
import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/server/supabase/server-client'

export async function getAdmin() {
  try {
    const client = await createAuthServerClient()
    const { data: { user } } = await client.auth.getUser()
    if (!user) return null
    const { data } = await client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
    return data ? user : null
  } catch {
    return null
  }
}

export async function requireAdmin() {
  const user = await getAdmin()
  if (!user) redirect('/admin/login')
  return user
}
