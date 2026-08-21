import Link from 'next/link'
import { BarChart3, CalendarRange, LogOut, Package, Settings } from 'lucide-react'
import { requireAdmin } from '@/server/auth/admin'
import { Brand } from '@/shared/ui/brand'
import { logoutAction } from '@/features/admin/actions'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Brand />
        <nav aria-label="관리자 메뉴">
          <Link href="/admin"><BarChart3 size={17} /> 대시보드</Link>
          <Link href="/admin/sales"><CalendarRange size={17} /> 차수 관리</Link>
          <Link href="/admin/orders"><Package size={17} /> 주문 관리</Link>
          <Link href="/admin/settings"><Settings size={17} /> 판매 설정</Link>
        </nav>
        <form action={logoutAction}><button type="submit"><LogOut size={16} /> 로그아웃</button></form>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  )
}
