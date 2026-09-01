import 'server-only'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { decryptText } from '@/server/security/crypto'
import type { OrderView, ProductConfig } from '@/features/order/domain/order'

const imageBucket = 'order-reference-images'

function safeDecrypt(value: string | null | undefined) {
  if (!value) return ''
  try { return decryptText(value) } catch { return value }
}

export async function getOrderByNumber(orderNumber: string): Promise<OrderView | null> {
  const client = createPrivilegedClient()
  const { data: order, error } = await client.from('orders').select('*').eq('order_number', orderNumber).maybeSingle()
  if (error || !order) return null
  const [{ data: sale }, { data: items }, { data: shipment }, { data: productRows }, { data: remoteZones }] = await Promise.all([
    client.from('sales').select('round_number,title,kakao_channel_url,sale_kind,shipping_fee,free_shipping_threshold,remote_area_surcharge').eq('id', order.sale_id).maybeSingle(),
    client.from('order_items').select('*').eq('order_id', order.id).order('sort_order').order('id'),
    client.from('shipments').select('*').eq('order_id', order.id).maybeSingle(),
    client.from('products').select('id,name,description,unit_price,item_type,stock_limit,sort_order,option_groups,customization_config').eq('sale_id', order.sale_id).order('sort_order').order('created_at'),
    client.from('delivery_surcharge_zones').select('name,postal_code_start,postal_code_end').eq('active', true).order('postal_code_start'),
  ])
  const itemIds = (items ?? []).map((item) => item.id)
  const { data: imageRows } = itemIds.length ? await client.from('order_item_images').select('*').in('order_item_id', itemIds).order('sort_order') : { data: [] }
  const paths = (imageRows ?? []).map((image) => image.storage_path)
  const { data: signedRows } = paths.length ? await client.storage.from(imageBucket).createSignedUrls(paths, 10 * 60) : { data: [] }
  const signedByPath = new Map((signedRows ?? []).map((row) => [row.path, row.signedUrl]))
  const products: ProductConfig[] = await Promise.all((productRows ?? []).map(async (product) => {
    const { count } = await client.from('order_items').select('id,orders!inner(id)', { count: 'exact', head: true }).eq('product_id', product.id).neq('orders.order_state', 'cancelled')
    const stockLimit = product.stock_limit as number | null
    return {
      id: product.id,
      type: product.item_type as ProductConfig['type'],
      name: product.name,
      description: product.description ?? '',
      unitPrice: product.unit_price,
      stockLimit,
      remainingStock: stockLimit === null ? null : Math.max(0, stockLimit - (count ?? 0)),
      optionGroups: Array.isArray(product.option_groups) ? product.option_groups as ProductConfig['optionGroups'] : [],
      customization: { initialEnabled: true, stickerEnabled: true, referenceImagesEnabled: true, extraRequestEnabled: true, ...(product.customization_config as Partial<ProductConfig['customization']> ?? {}) },
    }
  }))
  const bankSnapshot = order.bank_snapshot as { bankName: string; accountCiphertext: string; holder: string }
  const pickup = order.pickup_snapshot as OrderView['pickup']
  const address = order.fulfillment_type === 'shipping' ? JSON.parse(safeDecrypt(order.address_ciphertext)) as NonNullable<OrderView['address']> : null
  return {
    id: order.id,
    saleId: order.sale_id,
    roundNumber: sale?.round_number ?? 0,
    saleTitle: sale?.title ?? '부스부스 이니셜 주문',
    saleKind: sale?.sale_kind === 'test' ? 'test' : 'live',
    kakaoChannelUrl: sale?.kakao_channel_url || process.env.NEXT_PUBLIC_KAKAO_CHANNEL_URL || 'https://pf.kakao.com/',
    orderNumber: order.order_number,
    customerName: order.customer_name,
    phone: safeDecrypt(order.phone_ciphertext),
    email: safeDecrypt(order.email_ciphertext),
    depositorName: order.depositor_name,
    address,
    fulfillmentType: order.fulfillment_type,
    pickup,
    cashReceiptType: order.cash_receipt_type,
    cashReceiptIdentifier: order.cash_receipt_type === 'none' ? null : safeDecrypt(order.cash_receipt_identifier_ciphertext),
    totalQuantity: order.total_quantity,
    subtotalAmount: order.subtotal_amount,
    baseShippingFee: order.base_shipping_fee ?? order.shipping_fee,
    remoteAreaSurcharge: order.remote_area_surcharge ?? 0,
    shippingFee: order.shipping_fee,
    totalAmount: order.total_amount,
    deliveryZone: order.delivery_zone === 'remote' ? 'remote' : 'standard',
    deliveryConfig: {
      shippingFee: sale?.shipping_fee ?? 3000,
      freeShippingThreshold: sale?.free_shipping_threshold ?? 80000,
      remoteAreaSurcharge: sale?.remote_area_surcharge ?? 3000,
      remotePostalRanges: (remoteZones ?? []).map((zone) => ({ name: zone.name, start: zone.postal_code_start, end: zone.postal_code_end })),
    },
    orderState: order.order_state,
    paymentState: order.payment_state,
    paymentReviewReason: order.payment_review_reason,
    cancellationReason: order.cancellation_reason,
    paymentDueAt: order.payment_due_at,
    bank: { bankName: bankSnapshot.bankName, account: safeDecrypt(bankSnapshot.accountCiphertext), holder: bankSnapshot.holder },
    availableProducts: products,
    items: (items ?? []).map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      itemType: item.item_type,
      selectedOptions: Array.isArray(item.selected_options) ? item.selected_options : [],
      initialText: item.initial_text,
      stickerSelected: item.sticker_selected,
      stickerCategories: item.sticker_categories ?? [],
      extraRequest: item.extra_request,
      unitPrice: item.unit_price,
      optionSurcharge: item.option_surcharge,
      lineAmount: item.line_amount,
      images: (imageRows ?? []).filter((image) => image.order_item_id === item.id).map((image) => ({ id: image.id, url: signedByPath.get(image.storage_path) ?? '', width: image.width, height: image.height })),
    })),
    shipment: shipment ? { carrierCode: shipment.carrier_code, carrierName: shipment.carrier_name, trackingNumber: shipment.tracking_number, shippedAt: shipment.shipped_at } : null,
    createdAt: order.created_at,
  }
}
