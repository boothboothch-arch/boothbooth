import Image from 'next/image'
import { FlaskConical } from 'lucide-react'
import { notFound } from 'next/navigation'
import type { SaleStatus } from '@/features/sale/domain/sale'
import { SalePanel } from '@/features/sale/ui/sale-panel'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { Badge } from '@/shared/ui/badge'
import { PageShell } from '@/shared/ui/site-shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: '테스트 주문', robots: { index: false, follow: false } }

export default async function TestSalePage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params
  const client = createPrivilegedClient()
  const [{ data: sale }, { data: statusData }] = await Promise.all([
    client.from('sales').select('id,round_number,title,sale_kind').eq('id', saleId).maybeSingle(),
    client.rpc('get_test_sale_status', { p_sale_id: saleId }),
  ])
  if (!sale || sale.sale_kind !== 'test' || !statusData) notFound()
  const status = statusData as SaleStatus
  const renderedAt = new Date().toISOString()
  return (
    <PageShell>
      <main className="test-sale-page">
        <section className="test-sale-intro">
          <div className="launch-logo-crop"><Image src="/booth-booth-logo.png" alt="BOOTH BOOTH" width={3240} height={3240} priority /></div>
          <Badge tone="yellow"><FlaskConical size={13} /> TEST ORDER</Badge>
          <h1>{sale.round_number}차<br />테스트 주문</h1>
          <p>이 페이지에서 접수한 주문은 테스트 데이터로 분리됩니다. 고객 메인에는 이 차수가 노출되지 않습니다.</p>
        </section>
        <SalePanel
          initialNow={renderedAt}
          initialStatus={status}
          statusEndpoint={`/api/public/sale-status?saleId=${saleId}`}
          reservationSaleId={saleId}
        />
      </main>
    </PageShell>
  )
}
