import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  Banknote,
  Camera,
  MessageCircle,
  Palette,
  Shirt,
  ShoppingBag,
  Truck,
} from "lucide-react";
import {
  fallbackSaleStatus,
  type SaleStatus,
} from "@/features/sale/domain/sale";
import { SalePanel } from "@/features/sale/ui/sale-panel";
import { createPrivilegedClient } from "@/server/supabase/privileged-client";
import { hasServerEnv } from "@/shared/config/env";
import { PageShell } from "@/shared/ui/site-shell";

export const dynamic = "force-dynamic";

type ProductRow = {
  name: string;
  description: string;
  unit_price: number;
  item_type: "shirt" | "bag";
  stock_limit: number | null;
  option_groups: {
    id: string;
    name: string;
    active: boolean;
    values: {
      id: string;
      label: string;
      priceDelta: number;
      active: boolean;
    }[];
  }[];
};

export default async function HomePage() {
  const renderedAt = new Date().toISOString();
  let status: SaleStatus = { ...fallbackSaleStatus, serverNow: renderedAt };
  let products: ProductRow[] = [];
  let saleConfig: {
    shipping_fee: number;
    free_shipping_threshold: number;
    remote_area_surcharge: number;
    kakao_channel_url: string;
  } | null = null;

  if (hasServerEnv()) {
    const client = createPrivilegedClient();
    const { data } = await client.rpc("get_sale_status");
    if (data) status = data as SaleStatus;
    if (status.saleId) {
      const [{ data: productRows }, { data: sale }] = await Promise.all([
        client
          .from("products")
          .select(
            "name,description,unit_price,item_type,stock_limit,option_groups",
          )
          .eq("sale_id", status.saleId)
          .eq("active", true)
          .order("sort_order")
          .order("created_at"),
        client
          .from("sales")
          .select(
            "shipping_fee,free_shipping_threshold,remote_area_surcharge,kakao_channel_url",
          )
          .eq("id", status.saleId)
          .maybeSingle(),
      ]);
      products = (productRows ?? []) as ProductRow[];
      saleConfig = sale;
    }
  }

  const shippingFee = saleConfig?.shipping_fee ?? 3000;
  const freeShippingThreshold = saleConfig?.free_shipping_threshold ?? 80000;
  const remoteAreaSurcharge = saleConfig?.remote_area_surcharge ?? 3000;
  const roundLabel = status.roundNumber
    ? String(status.roundNumber).padStart(2, "0")
    : "—";
  const kakaoUrl =
    saleConfig?.kakao_channel_url ||
    process.env.NEXT_PUBLIC_KAKAO_CHANNEL_URL ||
    "https://pf.kakao.com/";

  return (
    <PageShell>
      <section className="launch-hero">
        <div
          className="launch-hero__shape launch-hero__shape--one"
          aria-hidden="true"
        />
        <div
          className="launch-hero__shape launch-hero__shape--two"
          aria-hidden="true"
        />

        <div className="launch-identity">
          <div className="launch-logo-crop">
            <Image
              src="/booth-booth-logo.png"
              alt="BOOTH BOOTH"
              width={3240}
              height={3240}
              priority
            />
          </div>
        </div>

        <div className="launch-status">
          <div className="launch-status__label">
            <span>ORDER STATUS</span>
            <b>{roundLabel}</b>
          </div>
          <SalePanel initialNow={renderedAt} initialStatus={status} />
          <div className="launch-quick-links">
            <Link href="/order/lookup">
              주문 조회 <ArrowUpRight size={14} />
            </Link>
            <a href={kakaoUrl} target="_blank" rel="noreferrer">
              <MessageCircle size={14} /> 문의하기
            </a>
          </div>
        </div>
      </section>

      <section className="home-guide" aria-labelledby="home-guide-title">
        <div className="home-guide__inner">
          <header className="home-guide__intro">
            <div>
              <span className="home-guide__kicker">
                ORDER GUIDE · {roundLabel}
              </span>
              <h2 id="home-guide-title">
                주문 전에
                <br />
                확인해주세요.
              </h2>
            </div>
            <p>
              판매 중인 상품을 한 번에 담고, 상품별 옵션과 디자인 참고 내용을
              입력해 주문할 수 있어요.
            </p>
          </header>

          <div className="home-guide__grid">
            <article className="home-guide__card home-guide__card--accent">
              <div className="home-guide__card-heading">
                <span>
                  <Shirt size={20} />
                </span>
                <h3>상품 및 가격</h3>
              </div>
              <dl className="home-guide__price-list">
                {products.map((product) => {
                  return (
                    <div key={product.name}>
                      <dt>
                        {product.name}
                        {product.stock_limit !== null && (
                          <small>한정 {product.stock_limit}개</small>
                        )}
                      </dt>
                      <dd>{product.unit_price.toLocaleString("ko-KR")}원</dd>
                    </div>
                  );
                })}
                {products.length === 0 && (
                  <div>
                    <dt>판매 상품 준비 중</dt>
                    <dd>—</dd>
                  </div>
                )}
              </dl>
            </article>

            <article className="home-guide__card">
              <div className="home-guide__card-heading">
                <span>
                  <Palette size={20} />
                </span>
                <h3>상품별 커스텀</h3>
              </div>
              <p className="home-guide__description">
                스펠링의 대소문자 규칙없이, 가장 잘 어울리는 패치 느낌과 색감을
                고려하여 자유롭게 제작합니다.
              </p>
              <ul className="home-guide__list">
                <li>별도의 디자인 시안은 제공되지 않아요</li>
                <li>마음에 드는 인스타그램 디자인은 참고 이미지로 첨부</li>
                <li>옵션 추가금은 주문 금액에 자동 반영</li>
              </ul>
            </article>

            <article className="home-guide__card">
              <div className="home-guide__card-heading">
                <span>
                  <Truck size={20} />
                </span>
                <h3>택배 또는 직접 픽업</h3>
              </div>
              <ul className="home-guide__list">
                <li>
                  상품 금액 {freeShippingThreshold.toLocaleString("ko-KR")}원
                  이상 무료배송
                </li>
                <li>
                  {freeShippingThreshold.toLocaleString("ko-KR")}원 미만 배송비{" "}
                  {shippingFee.toLocaleString("ko-KR")}원
                </li>
                <li>
                  제주·도서산간은 무료배송 여부와 관계없이{" "}
                  {remoteAreaSurcharge.toLocaleString("ko-KR")}원 추가
                </li>
              </ul>
            </article>

            <article className="home-guide__card">
              <div className="home-guide__card-heading">
                <span>
                  <Banknote size={20} />
                </span>
                <h3>입금 및 제작 안내</h3>
              </div>
              <ul className="home-guide__list">
                <li>주문 후 안내된 계좌로 1시간 이내 입금</li>
                <li>커스텀 상품은 선입금 확인 후 제작 진행</li>
                <li>주문 후 10~14일 이내 발송</li>
                <li>제작 시작 이후에는 교환 및 환불 불가</li>
                <li>
                  의류 불량 또는 주문 내용과 다르게 제작된 상품은 긴급 제작으로
                  교환
                </li>
              </ul>
            </article>
          </div>

          <div className="home-guide__notes">
            <div>
              <ShoppingBag size={17} />
              <p>
                <strong>함께 주문</strong>
                <span>여러 상품을 필요한 만큼 한 주문에 담을 수 있어요.</span>
              </p>
            </div>
            <div>
              <Camera size={17} />
              <p>
                <strong>참고 이미지</strong>
                <span>
                  상품당 최대 3장, 주문 전체 최대 20장까지 첨부할 수 있어요.
                </span>
              </p>
            </div>
            <div>
              <MessageCircle size={17} />
              <p>
                <strong>변경·취소 문의</strong>
                <span>
                  제작 시작 전까지 주문을 수정할 수 있으며, 취소·환불은 카카오톡
                  채널로 문의해주세요.
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
