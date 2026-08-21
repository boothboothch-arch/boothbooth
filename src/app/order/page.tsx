import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { PageShell } from '@/shared/ui/site-shell'
import { Badge } from '@/shared/ui/badge'
import { OrderForm } from '@/features/order/ui/order-form'
import type { PickupSlotView, ProductConfig } from '@/features/order/domain/order'
import { hasServerEnv } from '@/shared/config/env'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { hmac } from '@/server/security/crypto'

export const dynamic = 'force-dynamic'
export const metadata = { title: '주문서 작성', robots: { index: false, follow: false } }

function todayInKst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default async function OrderPage() {
  if (!hasServerEnv()) redirect('/')
  const token = (await cookies()).get('bb_reservation')?.value
  if (!token) redirect('/')
  const client = createPrivilegedClient()
  const { data: reservation, error } = await client.rpc('heartbeat_reservation', { p_token_hash: hmac(token) })
  if (error || !reservation) redirect('/')
  const reservationData = reservation as { saleId: string; hardExpiresAt: string; serverNow: string }
  const [{ data: sale }, { data: productRows }, { data: slots }] = await Promise.all([
    client.from('sales').select('round_number,title,shipping_fee,free_shipping_threshold,sale_kind').eq('id', reservationData.saleId).maybeSingle(),
    client.from('products').select('id,name,unit_price,item_type,product_options(option_type,value,sort_order,price_delta,active)').eq('sale_id', reservationData.saleId).eq('active', true).order('created_at'),
    client.from('pickup_slots').select('id,pickup_date,starts_at,ends_at').eq('sale_id', reservationData.saleId).eq('active', true).eq('manually_closed', false).gte('pickup_date', todayInKst()).order('pickup_date').order('starts_at'),
  ])
  const products: ProductConfig[] = (productRows ?? []).map((product) => {
    const options = Array.isArray(product.product_options) ? product.product_options.filter((option) => option.active) : []
    return {
      id: product.id,
      type: product.item_type as ProductConfig['type'],
      name: product.name,
      unitPrice: product.unit_price,
      sizes: options.filter((option) => option.option_type === 'size').sort((a, b) => a.sort_order - b.sort_order).map((option) => ({ value: option.value, priceDelta: option.price_delta })),
      genders: options.filter((option) => option.option_type === 'gender').sort((a, b) => a.sort_order - b.sort_order).map((option) => option.value),
    }
  })
  if (!products.length) redirect('/')
  const pickupSlots: PickupSlotView[] = (slots ?? []).map((slot) => ({ id: slot.id, date: slot.pickup_date, startsAt: slot.starts_at, endsAt: slot.ends_at }))
  return (
    <PageShell>
      <div className="page-wrap order-page-wrap">
        <div className="page-heading"><Badge tone={sale?.sale_kind === 'test' ? 'yellow' : 'green'}>{sale?.sale_kind === 'test' ? 'TEST ORDER' : 'ORDER FORM'} · {sale?.round_number ?? ''}</Badge><h1>{sale?.title ?? '부스부스 이니셜 주문'}<br />주문서</h1><p>{sale?.sale_kind === 'test' ? '테스트 주문은 고객 메인과 분리되며 이메일이 발송되지 않습니다.' : '상품마다 이니셜과 원하는 분위기를 입력해주세요.'}</p></div>
        <OrderForm hardExpiresAt={reservationData.hardExpiresAt} serverNow={reservationData.serverNow} products={products} pickupSlots={pickupSlots} shippingFee={sale?.shipping_fee ?? 3000} freeShippingThreshold={sale?.free_shipping_threshold ?? 80000} />
      </div>
    </PageShell>
  )
}
