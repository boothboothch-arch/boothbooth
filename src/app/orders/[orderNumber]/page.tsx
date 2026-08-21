import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { PageShell } from '@/shared/ui/site-shell'
import { Badge } from '@/shared/ui/badge'
import { OrderDetail } from '@/features/order/ui/order-detail'
import { getOrderByNumber } from '@/server/orders/get-order'
import { verifyOrderAccessToken } from '@/server/security/access-token'

export const dynamic = 'force-dynamic'
export const metadata = { title: '주문 상세', robots: { index: false, follow: false } }

export default async function OrderDetailPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params
  const token = (await cookies()).get('bb_order_access')?.value
  if (!verifyOrderAccessToken(token, orderNumber)) redirect('/order/lookup')
  const order = await getOrderByNumber(orderNumber)
  if (!order) redirect('/order/lookup')
  return <PageShell><div className="page-wrap page-wrap--wide"><div className="page-heading"><Badge tone="green">MY ORDER</Badge><h1>주문 상세</h1><p>입금과 제작·수령 상태를 확인하세요. 주문 정보는 입금 확인 전까지 수정할 수 있어요.</p></div><OrderDetail initialOrder={order} /></div></PageShell>
}
