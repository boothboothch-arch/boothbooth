import Link from 'next/link'
import type { ReactNode } from 'react'
import { Brand } from './brand'

export function SiteHeader() {
  return (
    <header className="site-header">
      <Brand />
      <nav className="site-nav" aria-label="주요 메뉴">
        <a href={process.env.NEXT_PUBLIC_KAKAO_CHANNEL_URL ?? 'https://pf.kakao.com/'} target="_blank" rel="noreferrer">문의</a>
      </nav>
      <Link className="header-link" href="/order/lookup">주문 조회</Link>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Brand />
      <p>Small things, thoughtfully made.</p>
      <span>© 2026 booth booth</span>
    </footer>
  )
}

export function PageShell({ children }: { children: ReactNode }) {
  return <><SiteHeader /><main>{children}</main><SiteFooter /></>
}
