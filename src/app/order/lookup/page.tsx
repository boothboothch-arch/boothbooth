import { Badge } from '@/shared/ui/badge'
import { PageShell } from '@/shared/ui/site-shell'
import { OrderLookupForm } from '@/features/order/ui/order-lookup-form'

export const metadata = { title: '주문 조회', robots: { index: false, follow: false } }

export default function OrderLookupPage() {
  return <PageShell><div className="page-wrap page-wrap--narrow"><div className="page-heading"><Badge tone="blue">ORDER LOOKUP</Badge><h1>내 주문 확인하기</h1><p>주문 완료 시 발급받은 주문번호와 휴대전화 번호 뒷자리를 입력해주세요.</p></div><OrderLookupForm /></div></PageShell>
}
