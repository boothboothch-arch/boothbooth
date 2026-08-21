'use server'

import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/server/supabase/server-client'

export type LoginState = { error: string }

export async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  if (!email || !password) return { error: '이메일과 비밀번호를 입력해주세요.' }

  const client = await createAuthServerClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) return { error: '로그인 정보를 확인해주세요.' }
  const { data: admin } = await client.from('admin_users').select('user_id').eq('user_id', data.user.id).maybeSingle()
  if (!admin) {
    await client.auth.signOut()
    return { error: '관리자 권한이 없는 계정입니다.' }
  }
  redirect('/admin')
}

