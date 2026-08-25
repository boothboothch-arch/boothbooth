import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' }))
const client = createClient(status.API_URL, status.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function rpc(name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}

const { data: source, error: sourceError } = await client.from('sales').select('id,round_number').eq('sale_kind', 'live').order('round_number', { ascending: false }).limit(1).maybeSingle()
if (sourceError || !source) throw new Error(sourceError?.message ?? 'source sale missing')
const roundNumber = source.round_number + 1000
let testSaleId = null

try {
  testSaleId = await rpc('admin_clone_sale_v2', {
    p_source_sale_id: source.id,
    p_round_number: roundNumber,
    p_title: `${roundNumber}차 자동 통합 테스트`,
    p_starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    p_ends_at: new Date(Date.now() + 172_800_000).toISOString(),
    p_internal_note: '자동 통합 테스트 후 삭제',
    p_sale_kind: 'test',
  })
  const saleStatus = await rpc('get_test_sale_status', { p_sale_id: testSaleId })
  assert(saleStatus.phase === 'open', 'test sale should be open regardless of public sale dates')

  const tokenHash = crypto.randomUUID()
  await rpc('claim_test_reservation', { p_token_hash: tokenHash, p_sale_id: testSaleId })
  const { data: products, error: productError } = await client.from('products').select('id,item_type,option_groups').eq('sale_id', testSaleId).eq('active', true)
  if (productError) throw productError
  const shirt = products.find((product) => product.item_type === 'shirt')
  const selectedOptionValueIds = (Array.isArray(shirt?.option_groups) ? shirt.option_groups : [])
    .filter((group) => group.active && group.required)
    .flatMap((group) => (group.values ?? []).filter((value) => value.active).slice(0, group.selectionType === 'multiple' ? Math.max(1, group.minSelections ?? 1) : 1).map((value) => value.id))
  assert(shirt, 'cloned product missing')

  const phoneHash = crypto.randomUUID()
  const orderPayload = {
    customerName: '통합 테스트',
    phoneCiphertext: 'encrypted-phone',
    depositorName: '통합 테스트',
    addressCiphertext: 'encrypted-address',
    fulfillmentType: 'shipping',
    cashReceiptType: 'none',
    items: [{
      clientId: crypto.randomUUID(),
      productId: shirt.id,
      itemType: 'shirt',
      selectedOptionValueIds,
      initialText: 'TEST',
      stickerSelected: false,
      stickerCategories: '',
      extraRequest: '',
      images: [],
    }],
  }
  const submitted = await rpc('submit_order', {
    p_token_hash: tokenHash,
    p_idempotency_key: crypto.randomUUID(),
    p_payload: orderPayload,
    p_phone_hash: phoneHash,
    p_email_hash: null,
    p_phone_last4_hash: crypto.randomUUID(),
  })
  const secondTokenHash = crypto.randomUUID()
  await rpc('claim_test_reservation', { p_token_hash: secondTokenHash, p_sale_id: testSaleId })
  const secondSubmitted = await rpc('submit_order', {
    p_token_hash: secondTokenHash,
    p_idempotency_key: crypto.randomUUID(),
    p_payload: { ...orderPayload, items: [{ ...orderPayload.items[0], clientId: crypto.randomUUID() }] },
    p_phone_hash: phoneHash,
    p_email_hash: null,
    p_phone_last4_hash: crypto.randomUUID(),
  })
  assert(submitted.orderId !== secondSubmitted.orderId, 'same phone should create separate orders')

  const groupId = crypto.randomUUID()
  const optionId = crypto.randomUUID()
  const limitedProductId = await rpc('admin_upsert_product', {
    p_sale_id: testSaleId,
    p_product_id: null,
    p_config: {
      name: '한정 옵션 테스트 상품', description: '관리자 상품 생성 통합 테스트', itemType: 'bag',
      unitPrice: 10000, stockLimit: 1, sortOrder: 999, active: true,
      optionGroups: [{
        id: groupId, name: '인쇄 면', selectionType: 'single', required: true,
        minSelections: 1, maxSelections: 1, sortOrder: 0, active: true,
        values: [{ id: optionId, label: '양면', priceDelta: 7000, sortOrder: 0, active: true }],
      }],
      customizationConfig: { initialEnabled: false, stickerEnabled: false, referenceImagesEnabled: false, extraRequestEnabled: true },
    },
  })
  const limitedPayload = {
    ...orderPayload,
    items: [{
      clientId: crypto.randomUUID(), productId: limitedProductId, itemType: 'bag', selectedOptionValueIds: [optionId],
      initialText: '', stickerSelected: false, stickerCategories: '', extraRequest: '옵션 테스트', images: [],
    }],
  }
  const limitedTokenHash = crypto.randomUUID()
  await rpc('claim_test_reservation', { p_token_hash: limitedTokenHash, p_sale_id: testSaleId })
  const limitedSubmitted = await rpc('submit_order', {
    p_token_hash: limitedTokenHash, p_idempotency_key: crypto.randomUUID(), p_payload: limitedPayload,
    p_phone_hash: crypto.randomUUID(), p_email_hash: null, p_phone_last4_hash: crypto.randomUUID(),
  })
  const { data: limitedItem, error: limitedItemError } = await client.from('order_items').select('option_surcharge,selected_options').eq('order_id', limitedSubmitted.orderId).single()
  if (limitedItemError) throw limitedItemError
  assert(limitedItem.option_surcharge === 7000 && limitedItem.selected_options?.[0]?.valueLabel === '양면', 'option surcharge and snapshot should be stored')

  const soldOutTokenHash = crypto.randomUUID()
  await rpc('claim_test_reservation', { p_token_hash: soldOutTokenHash, p_sale_id: testSaleId })
  let soldOutRejected = false
  try {
    await rpc('submit_order', {
      p_token_hash: soldOutTokenHash, p_idempotency_key: crypto.randomUUID(),
      p_payload: { ...limitedPayload, items: [{ ...limitedPayload.items[0], clientId: crypto.randomUUID() }] },
      p_phone_hash: crypto.randomUUID(), p_email_hash: null, p_phone_last4_hash: crypto.randomUUID(),
    })
  } catch (error) {
    soldOutRejected = error instanceof Error && error.message.includes('PRODUCT_SOLD_OUT')
  }
  assert(soldOutRejected, 'limited product should reject orders beyond stock')

  await rpc('admin_prepare_test_sale_reset', { p_sale_id: testSaleId })
  await rpc('admin_reset_test_sale', { p_sale_id: testSaleId })
  const [{ count: orderCount }, { count: reservationCount }] = await Promise.all([
    client.from('orders').select('id', { count: 'exact', head: true }).eq('sale_id', testSaleId),
    client.from('reservations').select('id', { count: 'exact', head: true }).eq('sale_id', testSaleId),
  ])
  assert((orderCount ?? 0) === 0 && (reservationCount ?? 0) === 0, 'test reset should remove orders and reservations')
  await rpc('admin_prepare_sale_deletion', { p_sale_id: testSaleId })
  await rpc('admin_delete_sale', { p_sale_id: testSaleId })
  const { count: deletedCount } = await client.from('sales').select('id', { count: 'exact', head: true }).eq('id', testSaleId)
  assert((deletedCount ?? 0) === 0, 'test sale should be deleted')
  testSaleId = null
  console.log('sale lifecycle integration passed')
} finally {
  if (testSaleId) {
    await client.rpc('admin_prepare_test_sale_reset', { p_sale_id: testSaleId })
    await client.rpc('admin_reset_test_sale', { p_sale_id: testSaleId })
    await client.rpc('admin_prepare_sale_deletion', { p_sale_id: testSaleId })
    await client.rpc('admin_delete_sale', { p_sale_id: testSaleId })
  }
}
