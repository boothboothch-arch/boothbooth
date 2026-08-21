import Image from 'next/image'
import Link from 'next/link'
import { ArrowUpRight, Banknote, Camera, MessageCircle, Palette, Shirt, ShoppingBag, Truck } from 'lucide-react'
import { fallbackSaleStatus, type SaleStatus } from '@/features/sale/domain/sale'
import { SalePanel } from '@/features/sale/ui/sale-panel'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { hasServerEnv } from '@/shared/config/env'
import { PageShell } from '@/shared/ui/site-shell'

export const dynamic = 'force-dynamic'

type ProductRow = {
  name: string
  unit_price: number
  item_type: 'shirt' | 'bag'
  product_options: { option_type: string; value: string; price_delta: number; active: boolean }[] | null
}

export default async function HomePage() {
  const renderedAt = new Date().toISOString()
  let status: SaleStatus = { ...fallbackSaleStatus, serverNow: renderedAt }
  let products: ProductRow[] = []
  let saleConfig: { shipping_fee: number; free_shipping_threshold: number; kakao_channel_url: string } | null = null

  if (hasServerEnv()) {
    const client = createPrivilegedClient()
    const { data } = await client.rpc('get_sale_status')
    if (data) status = data as SaleStatus
    if (status.saleId) {
      const [{ data: productRows }, { data: sale }] = await Promise.all([
        client.from('products').select('name,unit_price,item_type,product_options(option_type,value,price_delta,active)').eq('sale_id', status.saleId).eq('active', true).order('created_at'),
        client.from('sales').select('shipping_fee,free_shipping_threshold,kakao_channel_url').eq('id', status.saleId).maybeSingle(),
      ])
      products = (productRows ?? []) as ProductRow[]
      saleConfig = sale
    }
  }

  const shirt = products.find((product) => product.item_type === 'shirt')
  const bag = products.find((product) => product.item_type === 'bag')
  const twoXlSurcharge = (Array.isArray(shirt?.product_options) ? shirt.product_options : []).find((option) => option.option_type === 'size' && option.value === '2XL' && option.active)?.price_delta ?? 2000
  const shippingFee = saleConfig?.shipping_fee ?? 3000
  const freeShippingThreshold = saleConfig?.free_shipping_threshold ?? 80000
  const roundLabel = status.roundNumber ? String(status.roundNumber).padStart(2, '0') : '—'
  const kakaoUrl = saleConfig?.kakao_channel_url || process.env.NEXT_PUBLIC_KAKAO_CHANNEL_URL || 'https://pf.kakao.com/'

  return (
    <PageShell>
      <section className="launch-hero">
        <div className="launch-hero__shape launch-hero__shape--one" aria-hidden="true" />
        <div className="launch-hero__shape launch-hero__shape--two" aria-hidden="true" />

        <div className="launch-identity">
          <div className="launch-logo-crop">
            <Image src="/booth-booth-logo.png" alt="BOOTH BOOTH" width={3240} height={3240} priority />
          </div>
        </div>

        <div className="launch-status">
          <div className="launch-status__label"><span>ORDER STATUS</span><b>{roundLabel}</b></div>
          <SalePanel initialNow={renderedAt} initialStatus={status} />
          <div className="launch-quick-links">
            <Link href="/order/lookup">주문 조회 <ArrowUpRight size={14} /></Link>
            <a href={kakaoUrl} target="_blank" rel="noreferrer"><MessageCircle size={14} /> 문의하기</a>
          </div>
        </div>
      </section>

      <section className="home-guide" aria-labelledby="home-guide-title">
        <div className="home-guide__inner">
          <header className="home-guide__intro">
            <div>
              <span className="home-guide__kicker">ORDER GUIDE · {roundLabel}</span>
              <h2 id="home-guide-title">주문 전에<br />확인해주세요.</h2>
            </div>
            <p>티셔츠와 가방을 한 번에 담고, 상품마다 원하는 이니셜과 디자인 참고 내용을 입력해 주문할 수 있어요.</p>
          </header>

          <div className="home-guide__grid">
            <article className="home-guide__card home-guide__card--accent">
              <div className="home-guide__card-heading"><span><Shirt size={20} /></span><h3>상품 및 가격</h3></div>
              <dl className="home-guide__price-list">
                <div><dt>{shirt?.name ?? '이니셜 티셔츠'}</dt><dd>{(shirt?.unit_price ?? 33000).toLocaleString('ko-KR')}원</dd></div>
                <div><dt>2XL 추가금</dt><dd>+{twoXlSurcharge.toLocaleString('ko-KR')}원</dd></div>
                <div><dt>{bag?.name ?? '이니셜 가방'}</dt><dd>{(bag?.unit_price ?? 20000).toLocaleString('ko-KR')}원</dd></div>
              </dl>
            </article>

            <article className="home-guide__card">
              <div className="home-guide__card-heading"><span><Palette size={20} /></span><h3>상품별 커스텀</h3></div>
              <ul className="home-guide__list"><li>티셔츠마다 사이즈·성별·이니셜 입력</li><li>가방마다 원하는 이니셜 입력</li><li>랜덤 스티커 선택 시 원하는 카테고리 3–5개 권장</li></ul>
            </article>

            <article className="home-guide__card">
              <div className="home-guide__card-heading"><span><Truck size={20} /></span><h3>택배 또는 직접 픽업</h3></div>
              <ul className="home-guide__list"><li>상품 금액 {freeShippingThreshold.toLocaleString('ko-KR')}원 이상 무료배송</li><li>{freeShippingThreshold.toLocaleString('ko-KR')}원 미만 배송비 {shippingFee.toLocaleString('ko-KR')}원</li><li>직접 픽업은 배송비 없이 날짜·시간 선택</li></ul>
            </article>

            <article className="home-guide__card">
              <div className="home-guide__card-heading"><span><Banknote size={20} /></span><h3>입금 및 제작 안내</h3></div>
              <ul className="home-guide__list"><li>주문 후 안내된 계좌로 1시간 이내 입금</li><li>입금 확인 후 제작 시작 · 별도 시안 미제공</li><li>제작 시작 후 단순 변심 교환·환불은 어려워요</li><li>제작 불량 또는 주문과 다른 상품은 무료 재제작·교환</li></ul>
            </article>
          </div>

          <div className="home-guide__notes">
            <div><ShoppingBag size={17} /><p><strong>함께 주문</strong><span>티셔츠와 가방을 필요한 만큼 한 주문에 담을 수 있어요.</span></p></div>
            <div><Camera size={17} /><p><strong>참고 이미지</strong><span>상품당 최대 3장, 주문 전체 최대 20장까지 첨부할 수 있어요.</span></p></div>
            <div><MessageCircle size={17} /><p><strong>변경·취소 문의</strong><span>배송 준비 전까지 주문을 수정할 수 있으며, 취소·환불은 카카오톡 채널로 문의해주세요.</span></p></div>
          </div>
        </div>
      </section>
    </PageShell>
  )
}
