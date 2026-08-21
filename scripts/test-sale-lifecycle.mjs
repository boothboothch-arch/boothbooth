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
  const { data: products, error: productError } = await client.from('products').select('id,item_type,product_options(option_type,value,active)').eq('sale_id', testSaleId).eq('active', true)
  if (productError) throw productError
  const shirt = products.find((product) => product.item_type === 'shirt')
  const options = Array.isArray(shirt?.product_options) ? shirt.product_options.filter((option) => option.active) : []
  const size = options.find((option) => option.option_type === 'size')?.value
  const gender = options.find((option) => option.option_type === 'gender')?.value
  assert(shirt && size && gender, 'cloned shirt options missing')

  const submitted = await rpc('submit_order', {
    p_token_hash: tokenHash,
    p_idempotency_key: crypto.randomUUID(),
    p_payload: {
      customerName: '통합 테스트',
      phoneCiphertext: 'encrypted-phone',
      emailCiphertext: 'encrypted-email',
      depositorName: '통합 테스트',
      addressCiphertext: 'encrypted-address',
      fulfillmentType: 'shipping',
      cashReceiptType: 'none',
      items: [{
        clientId: crypto.randomUUID(),
        productId: shirt.id,
        itemType: 'shirt',
        size,
        gender,
        initialText: 'TEST',
        stickerSelected: false,
        stickerCategories: '',
        favoriteColors: '',
        favoriteThings: '',
        desiredMood: '',
        instagramReference: '',
        extraRequest: '',
        images: [],
      }],
    },
    p_phone_hash: crypto.randomUUID(),
    p_email_hash: crypto.randomUUID(),
    p_phone_last4_hash: crypto.randomUUID(),
  })

  const { count: emailCount } = await client.from('email_outbox').select('id', { count: 'exact', head: true }).eq('order_id', submitted.orderId)
  assert((emailCount ?? 0) === 0, 'test order email should be suppressed')
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
