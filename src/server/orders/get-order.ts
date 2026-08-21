import 'server-only'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { decryptText } from '@/server/security/crypto'
import type { OrderView, PickupSlotView, ProductConfig } from '@/features/order/domain/order'

const imageBucket = 'order-reference-images'

function todayInKst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function safeDecrypt(value: string | null | undefined) {
  if (!value) return ''
  try { return decryptText(value) } catch { return value }
}

export async function getOrderByNumber(orderNumber: string): Promise<OrderView | null> {
  const client = createPrivilegedClient()
  const { data: order, error } = await client.from('orders').select('*').eq('order_number', orderNumber).maybeSingle()
  if (error || !order) return null
  const [{ data: sale }, { data: items }, { data: shipment }, { data: productRows }, { data: pickupSlots }] = await Promise.all([
    client.from('sales').select('round_number,title,kakao_channel_url,sale_kind').eq('id', order.sale_id).maybeSingle(),
    client.from('order_items').select('*').eq('order_id', order.id).order('sort_order').order('id'),
    client.from('shipments').select('*').eq('order_id', order.id).maybeSingle(),
    client.from('products').select('id,name,unit_price,item_type,product_options(option_type,value,sort_order,price_delta,active)').eq('sale_id', order.sale_id).eq('active', true).order('created_at'),
    client.from('pickup_slots').select('id,pickup_date,starts_at,ends_at').eq('sale_id', order.sale_id).eq('active', true).eq('manually_closed', false).gte('pickup_date', todayInKst()).order('pickup_date').order('starts_at'),
  ])
  const itemIds = (items ?? []).map((item) => item.id)
  const { data: imageRows } = itemIds.length ? await client.from('order_item_images').select('*').in('order_item_id', itemIds).order('sort_order') : { data: [] }
  const paths = (imageRows ?? []).map((image) => image.storage_path)
  const { data: signedRows } = paths.length ? await client.storage.from(imageBucket).createSignedUrls(paths, 10 * 60) : { data: [] }
  const signedByPath = new Map((signedRows ?? []).map((row) => [row.path, row.signedUrl]))
  const products: ProductConfig[] = (productRows ?? []).map((product) => {
    const options = Array.isArray(product.product_options) ? product.product_options.filter((option) => option.active) : []
    return {
      id: product.id,
      type: product.item_type as ProductConfig['type'],
      name: product.name,
      unitPrice: product.unit_price,
      sizes: options.filter((option) => option.option_type === 'size').sort((a, b) => a.sort_order - b.sort_order).map((option) => ({ value: option.value, priceDelta: option.price_delta })),
      genders: options.filter((option) => option.option_type === 'gender').sort((a, b) => a.sort_order - b.sort_order).map((option) => option.value),
    }
  })
  const slots: PickupSlotView[] = (pickupSlots ?? []).map((slot) => ({ id: slot.id, date: slot.pickup_date, startsAt: slot.starts_at, endsAt: slot.ends_at }))
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
    shippingFee: order.shipping_fee,
    totalAmount: order.total_amount,
    orderState: order.order_state,
    paymentState: order.payment_state,
    paymentReviewReason: order.payment_review_reason,
    cancellationReason: order.cancellation_reason,
    paymentDueAt: order.payment_due_at,
    bank: { bankName: bankSnapshot.bankName, account: safeDecrypt(bankSnapshot.accountCiphertext), holder: bankSnapshot.holder },
    availableProducts: products,
    availablePickupSlots: slots,
    items: (items ?? []).map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      itemType: item.item_type,
      size: item.size,
      gender: item.gender,
      initialText: item.initial_text,
      stickerSelected: item.sticker_selected,
      stickerCategories: item.sticker_categories ?? [],
      favoriteColors: item.favorite_colors,
      favoriteThings: item.favorite_things,
      desiredMood: item.desired_mood,
      instagramReference: item.instagram_reference,
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
