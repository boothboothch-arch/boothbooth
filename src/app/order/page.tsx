import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PageShell } from "@/shared/ui/site-shell";
import { Badge } from "@/shared/ui/badge";
import { OrderForm } from "@/features/order/ui/order-form";
import type {
  PostalCodeRange,
  ProductConfig,
} from "@/features/order/domain/order";
import { hasServerEnv } from "@/shared/config/env";
import { createPrivilegedClient } from "@/server/supabase/privileged-client";
import { hmac } from "@/server/security/crypto";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "주문서 작성",
  robots: { index: false, follow: false },
};

export default async function OrderPage() {
  if (!hasServerEnv()) redirect("/");
  const token = (await cookies()).get("bb_reservation")?.value;
  if (!token) redirect("/");
  const client = createPrivilegedClient();
  const { data: reservation, error } = await client.rpc(
    "heartbeat_reservation",
    { p_token_hash: hmac(token) },
  );
  if (error || !reservation) redirect("/");
  const reservationData = reservation as {
    saleId: string;
    hardExpiresAt: string;
    serverNow: string;
  };
  const [
    { data: sale },
    { data: productRows },
    { data: remoteZones },
  ] = await Promise.all([
    client
      .from("sales")
      .select(
        "round_number,title,shipping_fee,free_shipping_threshold,remote_area_surcharge,sale_kind",
      )
      .eq("id", reservationData.saleId)
      .maybeSingle(),
    client
      .from("products")
      .select(
        "id,name,description,unit_price,item_type,stock_limit,sort_order,option_groups,customization_config",
      )
      .eq("sale_id", reservationData.saleId)
      .eq("active", true)
      .order("sort_order")
      .order("created_at"),
    client
      .from("delivery_surcharge_zones")
      .select("name,postal_code_start,postal_code_end")
      .eq("active", true)
      .order("postal_code_start"),
  ]);
  const products: ProductConfig[] = await Promise.all(
    (productRows ?? []).map(async (product) => {
      const { count } = await client
        .from("order_items")
        .select("id,orders!inner(id)", { count: "exact", head: true })
        .eq("product_id", product.id)
        .neq("orders.order_state", "cancelled");
      const stockLimit = product.stock_limit as number | null;
      return {
        id: product.id,
        type: product.item_type as ProductConfig["type"],
        name: product.name,
        description: product.description ?? "",
        unitPrice: product.unit_price,
        stockLimit,
        remainingStock:
          stockLimit === null ? null : Math.max(0, stockLimit - (count ?? 0)),
        optionGroups: Array.isArray(product.option_groups)
          ? (product.option_groups as ProductConfig["optionGroups"])
          : [],
        customization: {
          initialEnabled: true,
          stickerEnabled: true,
          referenceImagesEnabled: true,
          extraRequestEnabled: true,
          ...((product.customization_config as Partial<
            ProductConfig["customization"]
          >) ?? {}),
        },
      };
    }),
  );
  const availableProducts = products.filter(
    (product) => product.remainingStock === null || product.remainingStock > 0,
  );
  if (!availableProducts.length) redirect("/");
  const remotePostalRanges: PostalCodeRange[] = (remoteZones ?? []).map(
    (zone) => ({
      name: zone.name,
      start: zone.postal_code_start,
      end: zone.postal_code_end,
    }),
  );
  return (
    <PageShell>
      <div className="page-wrap order-page-wrap">
        <div className="page-heading">
          <Badge tone={sale?.sale_kind === "test" ? "yellow" : "green"}>
            {sale?.sale_kind === "test" ? "TEST ORDER" : "ORDER FORM"} ·{" "}
            {sale?.round_number ?? ""}
          </Badge>
          <h1>
            {sale?.title ?? "부스부스 이니셜 주문"}
            <br />
            주문서
          </h1>
        </div>
        <OrderForm
          hardExpiresAt={reservationData.hardExpiresAt}
          serverNow={reservationData.serverNow}
          products={products}
          shippingFee={sale?.shipping_fee ?? 3000}
          freeShippingThreshold={sale?.free_shipping_threshold ?? 80000}
          remoteAreaSurcharge={sale?.remote_area_surcharge ?? 3000}
          remotePostalRanges={remotePostalRanges}
        />
      </div>
    </PageShell>
  );
}
