import type { Metadata } from 'next'
import './globals.css'

const title = '부스부스'
const description = '부스부스 이니셜 티셔츠와 가방을 주문하세요.'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: {
    default: title,
    template: '%s · booth booth',
  },
  description,
  openGraph: { title, description, type: 'website', images: [{ url: '/og.png', width: 1731, height: 909, alt: title }] },
  twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
  robots: { index: true, follow: true },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
