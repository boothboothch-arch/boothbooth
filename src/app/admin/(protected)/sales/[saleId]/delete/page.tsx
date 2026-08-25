import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Database, Image as ImageIcon, Package, Trash2 } from 'lucide-react'
import { notFound } from 'next/navigation'
import { DangerConfirmForm } from '@/features/admin/danger-confirm-form'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { Badge } from '@/shared/ui/badge'

type Summary = {
  orderCount: number
  reservationCount: number
  productCount: number
  pickupCount: number
  imageCount: number
  saleCount: number
}

export default async function DeleteSalePage({
  params,
  searchParams,
}: {
  params: Promise<{ saleId: string }>
  searchParams: Promise<{ error?: string; reset?: string }>
}) {
  const [{ saleId }, query] = await Promise.all([params, searchParams])
  const client = createPrivilegedClient()
  const [{ data: sale }, { data: summaryData }] = await Promise.all([
    client.from('sales').select('id,round_number,title,publication_status,sale_kind').eq('id', saleId).maybeSingle(),
    client.rpc('admin_sale_deletion_summary', { p_sale_id: saleId }),
  ])
  if (!sale || !summaryData) notFound()
  const summary = summaryData as Summary
  const deleteBlockedReason = summary.saleCount <= 1
    ? '마지막 남은 차수는 삭제할 수 없습니다. 새 차수를 먼저 만들어주세요.'
    : sale.publication_status !== 'draft'
      ? '초안 상태의 차수만 삭제할 수 있습니다.'
      : summary.orderCount > 0
        ? sale.sale_kind === 'test'
          ? '테스트 데이터를 먼저 초기화하면 차수를 삭제할 수 있습니다.'
          : '실제 주문 이력이 있는 운영 차수는 삭제할 수 없습니다. 보관 상태로 유지해주세요.'
        : null
  const deletePhrase = `${sale.round_number}차 영구삭제`
  const resetPhrase = `${sale.round_number}차 테스트초기화`

  return (
    <>
      <div className="admin-heading">
        <div><span className="eyebrow">DANGER ZONE · {sale.round_number}TH</span><h1>차수 삭제</h1><p>차수와 연결된 설정·임시 데이터·참고 이미지를 확인한 뒤 안전하게 정리합니다.</p></div>
        <Link className="button button--secondary" href="/admin/sales"><ArrowLeft size={15} /> 차수 목록</Link>
      </div>
      {query.reset && <div className="notice notice--success">테스트 주문·예약·참고 이미지를 초기화했습니다. 안전을 위해 테스트 주문 입장은 중지된 상태입니다.</div>}
      {query.error && <div className="notice notice--error">처리하지 못했습니다: {query.error}</div>}

      <section className="admin-panel deletion-summary">
        <div className="deletion-summary__heading"><div><Badge tone={sale.sale_kind === 'test' ? 'yellow' : 'blue'}>{sale.sale_kind === 'test' ? '테스트 차수' : '운영 차수'}</Badge><h2>{sale.round_number}차 · {sale.title}</h2></div><Trash2 size={24} /></div>
        <div className="deletion-stat-grid">
          <div><Database size={17} /><span>주문</span><strong>{summary.orderCount}건</strong></div>
          <div><AlertTriangle size={17} /><span>예약</span><strong>{summary.reservationCount}건</strong></div>
          <div><Package size={17} /><span>상품·픽업</span><strong>{summary.productCount + summary.pickupCount}개</strong></div>
          <div><ImageIcon size={17} /><span>참고 이미지</span><strong>{summary.imageCount}장</strong></div>
        </div>
      </section>

      {sale.sale_kind === 'test' && (summary.orderCount > 0 || summary.reservationCount > 0 || summary.imageCount > 0) && (
        <section className="admin-panel danger-section">
          <div><h2>테스트 데이터 초기화</h2><p>차수 설정과 상품은 유지하고 테스트 주문, 예약, 배송 정보와 참고 이미지만 영구 삭제합니다. 초기화 후 주문 입장은 자동으로 중지됩니다.</p></div>
          <DangerConfirmForm saleId={sale.id} phrase={resetPhrase} mode="reset" />
        </section>
      )}

      <section className="admin-panel danger-section danger-section--delete">
        <div><h2>차수 영구 삭제</h2><p>상품·옵션·픽업 일정과 제출되지 않은 참고 이미지가 함께 삭제됩니다. 삭제된 차수는 복구할 수 없지만 같은 차수 번호는 다시 사용할 수 있습니다.</p></div>
        {deleteBlockedReason && <div className="notice notice--warning">{deleteBlockedReason}</div>}
        <DangerConfirmForm saleId={sale.id} phrase={deletePhrase} mode="delete" disabled={Boolean(deleteBlockedReason)} />
      </section>
    </>
  )
}
