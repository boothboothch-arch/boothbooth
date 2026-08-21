import Link from 'next/link'
import { ArrowRight, CopyPlus, ExternalLink, Eye, Settings, Trash2 } from 'lucide-react'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { Badge } from '@/shared/ui/badge'

type SaleRow = {
  id: string
  round_number: number
  title: string
  starts_at: string
  ends_at: string
  order_limit: number
  manually_closed: boolean
  publication_status: 'draft' | 'published' | 'archived'
  sale_kind: 'live' | 'test'
  internal_note: string
}

const publicationLabel = { draft: '초안', published: '공개', archived: '보관' }

function operatingState(sale: SaleRow, activeOrders: number, activeReservations: number) {
  const now = Date.now()
  if (sale.sale_kind === 'test' && sale.publication_status === 'draft') return sale.manually_closed ? '테스트 중지' : '테스트 가능'
  if (sale.publication_status === 'draft') return '공개 전'
  if (sale.publication_status === 'archived') return '보관됨'
  if (now < Date.parse(sale.starts_at)) return '판매 예정'
  if (now >= Date.parse(sale.ends_at)) return '판매 종료'
  if (sale.manually_closed) return '신규 입장 중지'
  if (activeOrders + activeReservations >= sale.order_limit) return '접수 마감'
  return '판매 중'
}

export default async function AdminSalesPage({ searchParams }: { searchParams: Promise<{ error?: string; publicationSaved?: string; deleted?: string }> }) {
  const query = await searchParams
  const client = createPrivilegedClient()
  const { data: sales } = await client.from('sales').select('id,round_number,title,starts_at,ends_at,order_limit,manually_closed,publication_status,internal_note,sale_kind').order('round_number', { ascending: false })
  const rows = (sales ?? []) as SaleRow[]
  const nowIso = new Date().toISOString()
  const summaries = new Map(await Promise.all(rows.map(async (sale) => {
    const [{ count: activeOrders }, { count: activeReservations }] = await Promise.all([
      client.from('orders').select('id', { count: 'exact', head: true }).eq('sale_id', sale.id).neq('order_state', 'cancelled'),
      client.from('reservations').select('id', { count: 'exact', head: true }).eq('sale_id', sale.id).eq('state', 'active').gt('hard_expires_at', nowIso).gt('lease_expires_at', nowIso),
    ])
    return [sale.id, { activeOrders: activeOrders ?? 0, activeReservations: activeReservations ?? 0 }] as const
  })))
  return (
    <>
      <div className="admin-heading">
        <div><span className="eyebrow">SALES</span><h1>차수 관리</h1><p>다음 판매를 복사해 준비하고, 검수 후 공개하거나 지난 차수를 보관합니다.</p></div>
        <Link className="button button--primary" href="/admin/sales/new"><CopyPlus size={15} /> 새 차수 만들기</Link>
      </div>
      {query.publicationSaved && <div className="notice notice--success">차수 공개 상태를 변경했습니다.</div>}
      {query.deleted && <div className="notice notice--success">차수와 연결된 임시 데이터·참고 이미지를 영구 삭제했습니다.</div>}
      {query.error && <div className="notice notice--error">처리하지 못했습니다: {query.error}</div>}
      <section className="admin-panel">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>차수</th><th>용도</th><th>공개</th><th>운영 상태</th><th>판매 기간</th><th>접수</th><th>운영 메모</th><th>관리</th></tr></thead>
            <tbody>{rows.map((sale) => {
              const { activeOrders, activeReservations } = summaries.get(sale.id) ?? { activeOrders: 0, activeReservations: 0 }
              const state = operatingState(sale, activeOrders, activeReservations)
              return <tr key={sale.id}>
                <td><strong>{sale.round_number}차</strong><small>{sale.title}</small></td>
                <td><Badge tone={sale.sale_kind === 'test' ? 'yellow' : 'blue'}>{sale.sale_kind === 'test' ? '테스트' : '운영'}</Badge></td>
                <td><Badge tone={sale.publication_status === 'published' ? 'green' : 'neutral'}>{publicationLabel[sale.publication_status]}</Badge></td>
                <td>{state}</td>
                <td>{new Date(sale.starts_at).toLocaleString('ko-KR')}<small>~ {new Date(sale.ends_at).toLocaleString('ko-KR')}</small></td>
                <td>{activeOrders} / {sale.order_limit}건<small>작성 중 {activeReservations}명</small></td>
                <td>{sale.internal_note || '-'}</td>
                <td><div className="admin-row-actions">{sale.sale_kind === 'test' && <Link href={`/test/${sale.id}`} target="_blank"><ExternalLink size={14} /> 테스트</Link>}<Link href={`/admin/sales/${sale.id}/preview`}><Eye size={14} /> 미리보기</Link><Link href={`/admin/settings?saleId=${sale.id}`}><Settings size={14} /> 설정</Link><Link href={`/admin/orders?saleId=${sale.id}`}>주문 <ArrowRight size={14} /></Link><Link className="text-danger" href={`/admin/sales/${sale.id}/delete`}><Trash2 size={14} /> 삭제</Link></div></td>
              </tr>
            })}</tbody>
          </table>
          {!rows.length && <div className="admin-empty">등록된 판매 차수가 없습니다.</div>}
        </div>
      </section>
      <section className="admin-panel admin-round-guide">
        <h2>권장 운영 순서</h2>
        <ol><li>지난 차수를 복사해 다음 차수 초안을 만듭니다.</li><li>판매 설정에서 시간·가격·픽업 일정·계좌·안내를 수정하고 저장합니다.</li><li>미리보기와 공개 전 점검을 확인한 뒤 공개합니다.</li><li>판매 종료 후 주문 처리를 마치고 차수를 보관합니다.</li></ol>
      </section>
    </>
  )
}
