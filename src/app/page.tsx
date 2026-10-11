import { fallbackSaleStatus, type SaleStatus } from '@/features/sale/domain/sale';
import { SaleHome, type ProductRow, type SaleConfig } from '@/features/sale/ui/sale-home';
import { createPrivilegedClient } from '@/server/supabase/privileged-client';
import { hasServerEnv } from '@/shared/config/env';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const renderedAt = new Date().toISOString();
  let status: SaleStatus = { ...fallbackSaleStatus, serverNow: renderedAt };
  let products: ProductRow[] = [];
  let saleConfig: SaleConfig | null = null;

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

  return <SaleHome renderedAt={renderedAt} status={status} products={products} saleConfig={saleConfig} />;
}
