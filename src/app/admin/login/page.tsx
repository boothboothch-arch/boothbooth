import { redirect } from 'next/navigation'
import { Brand } from '@/shared/ui/brand'
import { hasPublicEnv } from '@/shared/config/env'
import { getAdmin } from '@/server/auth/admin'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: '관리자 로그인', robots: { index: false, follow: false } }

export default async function AdminLoginPage() {
  if (hasPublicEnv() && await getAdmin()) redirect('/admin')
  return (
    <main className="admin-login-page">
      <div><Brand /><div className="page-heading"><span className="eyebrow">ADMIN</span><h1>운영자 로그인</h1><p>booth booth 주문과 판매 설정을 관리합니다.</p></div>{hasPublicEnv() ? <LoginForm /> : <div className="notice notice--setup">Supabase 환경 변수를 먼저 설정해주세요.</div>}</div>
    </main>
  )
}

