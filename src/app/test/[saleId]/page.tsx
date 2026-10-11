import { notFound } from 'next/navigation'
import type { SaleStatus } from '@/features/sale/domain/sale'
import { SaleHome, type ProductRow } from '@/features/sale/ui/sale-home'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: '테스트 주문', robots: { index: false, follow: false } }

export default async function TestSalePage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params
  const client = createPrivilegedClient()
  const [{ data: sale }, { data: statusData }, { data: products }] = await Promise.all([
    client.from('sales').select('id,sale_kind,shipping_fee,free_shipping_threshold,remote_area_surcharge,kakao_channel_url').eq('id', saleId).maybeSingle(),
    client.rpc('get_test_sale_status', { p_sale_id: saleId }),
    client.from('products').select('name,description,unit_price,item_type,stock_limit,option_groups').eq('sale_id', saleId).eq('active', true).order('sort_order').order('created_at'),
  ])
  if (!sale || sale.sale_kind !== 'test' || !statusData) notFound()
  return (
    <SaleHome
      renderedAt={new Date().toISOString()}
      status={statusData as SaleStatus}
      products={(products ?? []) as ProductRow[]}
      saleConfig={sale}
      testSaleId={saleId}
    />
  )
}
