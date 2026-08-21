import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { PageShell } from '@/shared/ui/site-shell'
import { OrderDetail } from '@/features/order/ui/order-detail'
import { getOrderByNumber } from '@/server/orders/get-order'
import { verifyOrderAccessToken } from '@/server/security/access-token'

export const dynamic = 'force-dynamic'
export const metadata = { title: '주문 완료', robots: { index: false, follow: false } }

export default async function OrderCompletePage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params
  const token = (await cookies()).get('bb_order_access')?.value
  if (!verifyOrderAccessToken(token, orderNumber)) redirect('/order/lookup')
  const order = await getOrderByNumber(orderNumber)
  if (!order) redirect('/order/lookup')
  return <PageShell><div className="page-wrap page-wrap--wide"><OrderDetail initialOrder={order} complete /></div></PageShell>
}
