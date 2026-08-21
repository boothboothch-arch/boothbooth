'use client'

import { useActionState } from 'react'
import { Button } from '@/shared/ui/button'
import { loginAction, type LoginState } from './actions'

const initialState: LoginState = { error: '' }

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState)
  return (
    <form className="surface-card admin-login-form" action={action}>
      <div className="field"><label htmlFor="email">이메일</label><input id="email" name="email" type="email" autoComplete="username" required /></div>
      <div className="field"><label htmlFor="password">비밀번호</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? '로그인 중…' : '관리자 로그인'}</Button>
    </form>
  )
}

