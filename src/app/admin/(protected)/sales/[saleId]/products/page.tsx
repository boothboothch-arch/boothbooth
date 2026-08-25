import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { ProductCatalogEditor, type CatalogProduct } from "@/features/admin/product-catalog-editor";
import { createPrivilegedClient } from "@/server/supabase/privileged-client";

type Props = {
  params: Promise<{ saleId: string }>;
  searchParams: Promise<{ saved?: string; removed?: string; error?: string; add?: string }>;
};

const defaultCustomization = {
  initialEnabled: true, stickerEnabled: true, referenceImagesEnabled: true, extraRequestEnabled: true,
};

export default async function ProductCatalogPage({ params, searchParams }: Props) {
  const [{ saleId }, query] = await Promise.all([params, searchParams]);
  const client = createPrivilegedClient();
  const [{ data: sale }, { data: rows }] = await Promise.all([
    client.from("sales").select("id,round_number,title").eq("id", saleId).maybeSingle(),
    client.from("products").select("id,name,description,item_type,unit_price,stock_limit,sort_order,active,option_groups,customization_config").eq("sale_id", saleId).order("sort_order").order("created_at"),
  ]);
  if (!sale) notFound();
  const products: CatalogProduct[] = await Promise.all((rows ?? []).map(async (product) => {
    const { count } = await client.from("order_items").select("id,orders!inner(id)", { count: "exact", head: true }).eq("product_id", product.id).neq("orders.order_state", "cancelled");
    return {
      id: product.id, name: product.name, description: product.description ?? "", itemType: product.item_type as "shirt" | "bag",
      unitPrice: product.unit_price, stockLimit: product.stock_limit, sortOrder: product.sort_order ?? 0,
      active: product.active, soldCount: count ?? 0,
      optionGroups: Array.isArray(product.option_groups) ? (product.option_groups as CatalogProduct["optionGroups"]).map((group) => ({
        ...group,
        active: true,
        values: group.values.map((option) => ({ ...option, active: true })),
      })) : [],
      customizationConfig: { ...defaultCustomization, ...(product.customization_config as Partial<CatalogProduct["customizationConfig"]> ?? {}) },
    };
  }));
  const newProduct: CatalogProduct = {
    name: "", description: "", itemType: "shirt", unitPrice: 0, stockLimit: null,
    sortOrder: products.length, active: true, soldCount: 0, optionGroups: [], customizationConfig: defaultCustomization,
  };

  return <>
    <div className="admin-heading"><div><Link className="admin-back" href={`/admin/settings?saleId=${sale.id}`}><ArrowLeft size={14} /> 판매 설정</Link><span className="eyebrow">PRODUCTS · {sale.round_number}TH</span><h1>상품 관리</h1><p>{sale.title}에 판매할 상품, 한정 수량과 옵션 그룹을 관리합니다.</p></div><Link className="button button--primary" href={`/admin/sales/${sale.id}/products?add=1`}><Plus size={15} /> 상품 추가</Link></div>
    {query.saved && <div className="notice notice--success">상품과 옵션을 저장했습니다.</div>}
    {query.removed && <div className="notice notice--success">상품을 삭제하거나 숨김 처리했습니다.</div>}
    {query.error && <div className="notice notice--error">저장하지 못했습니다: {query.error}</div>}
    <div className="product-catalog-list">
      {query.add && <ProductCatalogEditor saleId={sale.id} product={newProduct} />}
      {products.map((product) => <ProductCatalogEditor key={product.id} saleId={sale.id} product={product} />)}
      {!products.length && !query.add && <section className="admin-panel admin-empty"><p>등록된 상품이 없습니다.</p><Link className="button button--primary" href={`/admin/sales/${sale.id}/products?add=1`}>첫 상품 추가</Link></section>}
    </div>
  </>;
}
