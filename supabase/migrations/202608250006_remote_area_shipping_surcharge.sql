alter table public.sales
  add column if not exists remote_area_surcharge integer not null default 3000
    check (remote_area_surcharge >= 0);

alter table public.orders
  add column if not exists base_shipping_fee integer not null default 0
    check (base_shipping_fee >= 0),
  add column if not exists remote_area_surcharge integer not null default 0
    check (remote_area_surcharge >= 0),
  add column if not exists delivery_zone text not null default 'standard'
    check (delivery_zone in ('standard', 'remote'));

update public.orders
set base_shipping_fee = shipping_fee,
    remote_area_surcharge = 0,
    delivery_zone = 'standard';

create table if not exists public.delivery_surcharge_zones (
  id bigint generated always as identity primary key,
  name text not null,
  postal_code_start text not null check (postal_code_start ~ '^[0-9]{5}$'),
  postal_code_end text not null check (postal_code_end ~ '^[0-9]{5}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (postal_code_start <= postal_code_end),
  unique (postal_code_start, postal_code_end)
);

insert into public.delivery_surcharge_zones (name, postal_code_start, postal_code_end)
values
  ('인천 중구 섬지역', '22386', '22388'),
  ('인천 강화 섬지역', '23004', '23010'),
  ('인천 옹진 섬지역1', '23100', '23116'),
  ('인천 옹진 섬지역2', '23124', '23136'),
  ('충남 당진 섬지역', '31708', '31708'),
  ('충남 태안 섬지역', '32133', '32133'),
  ('충남 보령 섬지역', '33411', '33411'),
  ('경북 울릉도 전지역', '40200', '40240'),
  ('부산 강서구 섬지역', '46768', '46771'),
  ('경남 사천 섬지역', '52570', '52571'),
  ('경남 통영 섬지역1', '53031', '53033'),
  ('경남 통영 섬지역2', '53089', '53104'),
  ('전북 군산 섬지역', '54000', '54000'),
  ('전북 부안 섬지역', '56347', '56349'),
  ('전남 영광 섬지역', '57068', '57069'),
  ('전남 목포 섬지역', '58760', '58762'),
  ('전남 신안 섬지역1', '58800', '58810'),
  ('전남 신안 섬지역2', '58816', '58818'),
  ('전남 신안 섬지역3', '58826', '58826'),
  ('전남 신안 섬지역4', '58828', '58866'),
  ('전남 진도 섬지역', '58953', '58958'),
  ('전남 완도 섬지역1', '59102', '59103'),
  ('전남 완도 섬지역2', '59106', '59106'),
  ('전남 완도 섬지역3', '59127', '59127'),
  ('전남 완도 섬지역4', '59129', '59129'),
  ('전남 완도 섬지역5', '59137', '59166'),
  ('전남 보성 섬지역', '59421', '59421'),
  ('전남 고흥 섬지역1', '59531', '59531'),
  ('전남 고흥 섬지역2', '59551', '59551'),
  ('전남 고흥 섬지역3', '59563', '59563'),
  ('전남 고흥 섬지역4', '59568', '59568'),
  ('전남 여수 섬지역1', '59650', '59650'),
  ('전남 여수 섬지역2', '59766', '59766'),
  ('전남 여수 섬지역3', '59781', '59790'),
  ('제주 전지역', '63000', '63644'),
  ('제주 추자면', '63000', '63001'),
  ('제주 우도', '63365', '63365')
on conflict (postal_code_start, postal_code_end) do update
set name = excluded.name,
    active = true;

alter table public.delivery_surcharge_zones enable row level security;

create policy admin_all_delivery_surcharge_zones
on public.delivery_surcharge_zones
for all
to authenticated
using (private.is_admin())
with check (private.is_admin());

create or replace function private.is_remote_postal_code(p_postal_code text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_postal_code ~ '^[0-9]{5}$'
    and exists (
      select 1
      from public.delivery_surcharge_zones as zone
      where zone.active
        and p_postal_code between zone.postal_code_start and zone.postal_code_end
    ),
    false
  );
$$;

create or replace function public.admin_update_sale_settings_v2(p_sale_id uuid, p_config jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.sales%rowtype;
  submitted integer;
  reserved integer;
  requested_limit integer := (p_config->>'orderLimit')::integer;
  slot_row jsonb;
begin
  select * into target from public.sales where id = p_sale_id for update;
  if target.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  perform private.expire_reservations(target.id);
  select count(*) into submitted from public.orders where sale_id = target.id and order_state <> 'cancelled';
  select count(*) into reserved from public.reservations where sale_id = target.id and state = 'active' and hard_expires_at > now() and lease_expires_at > now();
  if requested_limit < submitted + reserved then raise exception 'ORDER_LIMIT_BELOW_OCCUPIED'; end if;
  if target.publication_status = 'published' and jsonb_array_length(p_config->'pickupSlots') = 0 then raise exception 'ACTIVE_PICKUP_SLOT_REQUIRED'; end if;
  if target.publication_status = 'published' and exists(select 1 from public.sales as other where other.id <> target.id and other.publication_status = 'published' and other.starts_at < (p_config->>'endsAt')::timestamptz and other.ends_at > (p_config->>'startsAt')::timestamptz) then raise exception 'PUBLISHED_SALE_WINDOW_OVERLAP'; end if;

  update public.sales set title = trim(p_config->>'title'), starts_at = (p_config->>'startsAt')::timestamptz,
    ends_at = (p_config->>'endsAt')::timestamptz, order_limit = requested_limit,
    manually_closed = (p_config->>'manuallyClosed')::boolean, bank_name = trim(p_config->>'bankName'),
    bank_account_ciphertext = coalesce(nullif(p_config->>'bankAccountCiphertext', ''), target.bank_account_ciphertext),
    bank_holder = trim(p_config->>'bankHolder'), kakao_channel_url = trim(p_config->>'kakaoChannelUrl'),
    shipping_notice = coalesce(p_config->>'shippingNotice', ''), shipping_fee = (p_config->>'shippingFee')::integer,
    free_shipping_threshold = (p_config->>'freeShippingThreshold')::integer,
    remote_area_surcharge = (p_config->>'remoteAreaSurcharge')::integer,
    pickup_name = trim(p_config->>'pickupName'), pickup_address = coalesce(p_config->>'pickupAddress', ''),
    pickup_notice = coalesce(p_config->>'pickupNotice', ''), internal_note = coalesce(p_config->>'internalNote', '')
  where id = target.id;

  delete from public.pickup_slots where sale_id = target.id;
  for slot_row in select value from jsonb_array_elements(p_config->'pickupSlots') loop
    insert into public.pickup_slots (sale_id, pickup_date, starts_at, ends_at)
    values (target.id, (slot_row->>'pickupDate')::date, (slot_row->>'startsAt')::time, (slot_row->>'endsAt')::time);
  end loop;
end;
$$;

create or replace function public.submit_order(
  p_token_hash text,
  p_idempotency_key text,
  p_payload jsonb,
  p_phone_hash text,
  p_email_hash text,
  p_phone_last4_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale public.sales%rowtype;
  reservation public.reservations%rowtype;
  product public.products%rowtype;
  pickup public.pickup_slots%rowtype;
  existing public.orders%rowtype;
  created public.orders%rowtype;
  created_item public.order_items%rowtype;
  item jsonb;
  image_id_text text;
  total_qty integer := 0;
  item_index integer := 0;
  subtotal integer := 0;
  item_surcharge integer;
  base_delivery_fee integer := 0;
  remote_delivery_fee integer := 0;
  delivery_fee integer := 0;
  target_delivery_zone text := 'standard';
  postal_code text := trim(coalesce(p_payload->>'postalCode', ''));
  number text;
  option_result jsonb;
  requested_product_qty integer;
  sold_product_qty integer;
  fulfillment text := p_payload->>'fulfillmentType';
  receipt_type text := coalesce(p_payload->>'cashReceiptType', 'none');
begin
  select * into existing from public.orders where idempotency_key = p_idempotency_key;
  if existing.id is not null then
    return jsonb_build_object('orderId', existing.id, 'orderNumber', existing.order_number, 'totalAmount', existing.total_amount, 'paymentDueAt', existing.payment_due_at);
  end if;

  select * into reservation from public.reservations where token_hash = p_token_hash for update;
  if reservation.id is null or reservation.state <> 'active' or reservation.hard_expires_at <= now() or reservation.lease_expires_at <= now() then raise exception 'RESERVATION_EXPIRED'; end if;
  select * into sale from public.sales where id = reservation.sale_id for update;
  if jsonb_typeof(p_payload->'items') <> 'array' or jsonb_array_length(p_payload->'items') < 1 then raise exception 'INVALID_QUANTITY'; end if;
  if fulfillment not in ('shipping', 'pickup') then raise exception 'INVALID_FULFILLMENT'; end if;
  if receipt_type not in ('none', 'personal', 'business') then raise exception 'INVALID_CASH_RECEIPT'; end if;

  if fulfillment = 'pickup' then
    select * into pickup from public.pickup_slots where id = (p_payload->>'pickupSlotId')::uuid and sale_id = sale.id and active and not manually_closed;
    if pickup.id is null then raise exception 'PICKUP_SLOT_UNAVAILABLE'; end if;
  elsif nullif(p_payload->>'addressCiphertext', '') is null then
    raise exception 'ADDRESS_REQUIRED';
  elsif postal_code !~ '^[0-9]{5}$' then
    raise exception 'INVALID_POSTAL_CODE';
  end if;

  for item in select value from jsonb_array_elements(p_payload->'items') loop
    item_index := item_index + 1;
    select * into product from public.products where id = (item->>'productId')::uuid and sale_id = sale.id and active for update;
    if product.id is null or product.item_type <> item->>'itemType' then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    if coalesce((product.customization_config->>'initialEnabled')::boolean, true) and (
      nullif(trim(item->>'initialText'), '') is null or trim(item->>'initialText') !~ '^[A-Za-z ]+$' or length(replace(trim(item->>'initialText'), ' ', '')) > 10
    ) then raise exception 'INVALID_INITIAL'; end if;
    option_result := private.resolve_product_options(product, coalesce(item->'selectedOptionValueIds', '[]'::jsonb));
    item_surcharge := (option_result->>'surcharge')::integer;

    if product.stock_limit is not null then
      select count(*) into requested_product_qty from jsonb_array_elements(p_payload->'items') as requested where requested->>'productId' = product.id::text;
      select count(*) into sold_product_qty from public.order_items as sold_item join public.orders as sold_order on sold_order.id = sold_item.order_id where sold_item.product_id = product.id and sold_order.order_state <> 'cancelled';
      if sold_product_qty + requested_product_qty > product.stock_limit then raise exception 'PRODUCT_SOLD_OUT'; end if;
    end if;
    if jsonb_array_length(coalesce(item->'images', '[]'::jsonb)) > 3 then raise exception 'TOO_MANY_IMAGES'; end if;
    total_qty := total_qty + 1;
    subtotal := subtotal + product.unit_price + item_surcharge;
  end loop;

  if (select count(*) from public.order_image_uploads where reservation_id = reservation.id and consumed_at is null) > 20 then raise exception 'TOO_MANY_IMAGES'; end if;
  if fulfillment = 'shipping' then
    if subtotal < sale.free_shipping_threshold then base_delivery_fee := sale.shipping_fee; end if;
    if private.is_remote_postal_code(postal_code) then
      target_delivery_zone := 'remote';
      remote_delivery_fee := sale.remote_area_surcharge;
    end if;
  end if;
  delivery_fee := base_delivery_fee + remote_delivery_fee;
  loop number := private.order_number(); exit when not exists(select 1 from public.orders where order_number = number); end loop;

  insert into public.orders (
    sale_id, reservation_id, idempotency_key, order_number, customer_name, phone_ciphertext, phone_normalized_hash,
    phone_last4_hash, email_ciphertext, email_normalized_hash, depositor_name, address_ciphertext, total_quantity,
    subtotal_amount, base_shipping_fee, remote_area_surcharge, shipping_fee, total_amount, delivery_zone,
    fulfillment_type, pickup_slot_id, pickup_snapshot, cash_receipt_type, cash_receipt_identifier_ciphertext,
    payment_due_at, bank_snapshot
  ) values (
    sale.id, reservation.id, p_idempotency_key, number, p_payload->>'customerName', p_payload->>'phoneCiphertext', p_phone_hash,
    p_phone_last4_hash, p_payload->>'emailCiphertext', p_email_hash, p_payload->>'depositorName', coalesce(p_payload->>'addressCiphertext', ''), total_qty,
    subtotal, base_delivery_fee, remote_delivery_fee, delivery_fee, subtotal + delivery_fee, target_delivery_zone,
    fulfillment, pickup.id,
    case when pickup.id is null then null else jsonb_build_object('name', sale.pickup_name, 'address', sale.pickup_address, 'notice', sale.pickup_notice, 'date', pickup.pickup_date, 'startsAt', pickup.starts_at, 'endsAt', pickup.ends_at) end,
    receipt_type, nullif(p_payload->>'cashReceiptIdentifierCiphertext', ''), now() + interval '1 hour',
    jsonb_build_object('bankName', sale.bank_name, 'accountCiphertext', sale.bank_account_ciphertext, 'holder', sale.bank_holder)
  ) returning * into created;

  item_index := 0;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    item_index := item_index + 1;
    select * into product from public.products where id = (item->>'productId')::uuid;
    option_result := private.resolve_product_options(product, coalesce(item->'selectedOptionValueIds', '[]'::jsonb));
    item_surcharge := (option_result->>'surcharge')::integer;
    insert into public.order_items (
      order_id, product_id, product_name, unit_price, color, size, quantity, line_amount, item_type, gender,
      initial_text, sticker_selected, sticker_categories, favorite_colors, favorite_things, desired_mood,
      instagram_reference, extra_request, option_surcharge, sort_order, selected_options
    ) values (
      created.id, product.id, product.name, product.unit_price, null, null, 1, product.unit_price + item_surcharge,
      product.item_type, null, coalesce(trim(item->>'initialText'), ''),
      coalesce((item->>'stickerSelected')::boolean, false), coalesce(string_to_array(nullif(trim(item->>'stickerCategories'), ''), ','), '{}'::text[]),
      '', '', '', '', coalesce(item->>'extraRequest', ''), item_surcharge, item_index, option_result->'snapshot'
    ) returning * into created_item;

    for image_id_text in select jsonb_array_elements_text(coalesce(item->'images', '[]'::jsonb)) loop
      insert into public.order_item_images (order_item_id, storage_path, mime_type, byte_size, width, height, sort_order)
      select created_item.id, upload.storage_path, upload.mime_type, upload.byte_size, upload.width, upload.height,
        (select count(*) from public.order_item_images where order_item_id = created_item.id)
      from public.order_image_uploads upload
      where upload.id = image_id_text::uuid and upload.reservation_id = reservation.id
        and upload.client_item_id = (item->>'clientId')::uuid and upload.consumed_at is null;
      if not found then raise exception 'INVALID_IMAGE'; end if;
      update public.order_image_uploads set consumed_at = now() where id = image_id_text::uuid;
    end loop;
  end loop;

  update public.reservations set state = 'converted', converted_order_id = created.id where id = reservation.id;
  return jsonb_build_object('orderId', created.id, 'orderNumber', created.order_number, 'totalAmount', created.total_amount, 'paymentDueAt', created.payment_due_at);
exception when unique_violation then raise exception 'DUPLICATE_ORDER';
end;
$$;

create or replace function public.update_customer_order_v2(p_order_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  sale public.sales%rowtype;
  product public.products%rowtype;
  pickup public.pickup_slots%rowtype;
  item jsonb;
  target_item public.order_items%rowtype;
  subtotal integer := 0;
  base_delivery_fee integer := 0;
  remote_delivery_fee integer := 0;
  delivery_fee integer := 0;
  target_delivery_zone text := 'standard';
  postal_code text := trim(coalesce(p_payload->>'postalCode', ''));
  item_surcharge integer;
  new_total integer;
  option_result jsonb;
  fulfillment text := p_payload->>'fulfillmentType';
  receipt_type text := coalesce(p_payload->>'cashReceiptType', 'none');
begin
  select * into target from public.orders where id = p_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.order_state not in ('payment_pending', 'payment_confirmed') then raise exception 'ORDER_NOT_EDITABLE'; end if;
  select * into sale from public.sales where id = target.sale_id;
  if jsonb_array_length(p_payload->'items') <> (select count(*) from public.order_items where order_id = target.id) then raise exception 'ITEM_COUNT_CHANGE_NOT_ALLOWED'; end if;
  if fulfillment not in ('shipping', 'pickup') then raise exception 'INVALID_FULFILLMENT'; end if;
  if receipt_type not in ('none', 'personal', 'business') then raise exception 'INVALID_CASH_RECEIPT'; end if;
  if fulfillment = 'pickup' then
    select * into pickup from public.pickup_slots where id = (p_payload->>'pickupSlotId')::uuid and sale_id = sale.id and active and not manually_closed;
    if pickup.id is null then raise exception 'PICKUP_SLOT_UNAVAILABLE'; end if;
  elsif nullif(p_payload->>'addressCiphertext', '') is null then
    raise exception 'ADDRESS_REQUIRED';
  elsif postal_code !~ '^[0-9]{5}$' then
    raise exception 'INVALID_POSTAL_CODE';
  end if;

  for item in select value from jsonb_array_elements(p_payload->'items') loop
    select * into target_item from public.order_items where id = (item->>'id')::uuid and order_id = target.id for update;
    if target_item.id is null then raise exception 'INVALID_ITEM'; end if;
    select * into product from public.products where id = target_item.product_id and sale_id = sale.id;
    if product.id is null then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    if coalesce((product.customization_config->>'initialEnabled')::boolean, true) and (
      nullif(trim(item->>'initialText'), '') is null or trim(item->>'initialText') !~ '^[A-Za-z ]+$' or length(replace(trim(item->>'initialText'), ' ', '')) > 10
    ) then raise exception 'INVALID_INITIAL'; end if;
    option_result := private.resolve_product_options(product, coalesce(item->'selectedOptionValueIds', '[]'::jsonb));
    item_surcharge := (option_result->>'surcharge')::integer;
    update public.order_items set initial_text = coalesce(trim(item->>'initialText'), ''),
      sticker_selected = coalesce((item->>'stickerSelected')::boolean, false),
      sticker_categories = coalesce(string_to_array(nullif(trim(item->>'stickerCategories'), ''), ','), '{}'::text[]),
      extra_request = coalesce(item->>'extraRequest', ''), option_surcharge = item_surcharge,
      line_amount = product.unit_price + item_surcharge, selected_options = option_result->'snapshot'
    where id = target_item.id;
    subtotal := subtotal + product.unit_price + item_surcharge;
  end loop;

  if fulfillment = 'shipping' then
    if subtotal < sale.free_shipping_threshold then base_delivery_fee := sale.shipping_fee; end if;
    if private.is_remote_postal_code(postal_code) then
      target_delivery_zone := 'remote';
      remote_delivery_fee := sale.remote_area_surcharge;
    end if;
  end if;
  delivery_fee := base_delivery_fee + remote_delivery_fee;
  new_total := subtotal + delivery_fee;
  update public.orders set address_ciphertext = coalesce(p_payload->>'addressCiphertext', ''), fulfillment_type = fulfillment,
    pickup_slot_id = pickup.id, pickup_snapshot = case when pickup.id is null then null else jsonb_build_object('name', sale.pickup_name, 'address', sale.pickup_address, 'notice', sale.pickup_notice, 'date', pickup.pickup_date, 'startsAt', pickup.starts_at, 'endsAt', pickup.ends_at) end,
    cash_receipt_type = receipt_type, cash_receipt_identifier_ciphertext = nullif(p_payload->>'cashReceiptIdentifierCiphertext', ''),
    subtotal_amount = subtotal, base_shipping_fee = base_delivery_fee, remote_area_surcharge = remote_delivery_fee,
    shipping_fee = delivery_fee, total_amount = new_total, delivery_zone = target_delivery_zone,
    payment_state = case when target.payment_state = 'paid' and target.total_amount <> new_total then 'review_required'::public.payment_state else target.payment_state end,
    payment_review_reason = case when target.payment_state = 'paid' and target.total_amount <> new_total then '주문 수정으로 결제 금액 변경' else target.payment_review_reason end
  where id = target.id;
  return jsonb_build_object('totalQuantity', target.total_quantity, 'subtotalAmount', subtotal, 'baseShippingFee', base_delivery_fee, 'remoteAreaSurcharge', remote_delivery_fee, 'shippingFee', delivery_fee, 'totalAmount', new_total, 'deliveryZone', target_delivery_zone);
end;
$$;

create or replace function public.admin_update_order_contact_v2(
  p_order_id uuid,
  p_customer_name text,
  p_phone_ciphertext text,
  p_phone_hash text,
  p_phone_last4_hash text,
  p_depositor_name text,
  p_address_ciphertext text,
  p_postal_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  sale public.sales%rowtype;
  base_delivery_fee integer := 0;
  remote_delivery_fee integer := 0;
  delivery_fee integer := 0;
  target_delivery_zone text := 'standard';
  new_total integer;
begin
  select * into target from public.orders where id = p_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  select * into sale from public.sales where id = target.sale_id;

  if target.fulfillment_type = 'shipping' then
    if nullif(p_address_ciphertext, '') is null then raise exception 'ADDRESS_REQUIRED'; end if;
    if trim(coalesce(p_postal_code, '')) !~ '^[0-9]{5}$' then raise exception 'INVALID_POSTAL_CODE'; end if;
    if target.subtotal_amount < sale.free_shipping_threshold then base_delivery_fee := sale.shipping_fee; end if;
    if private.is_remote_postal_code(trim(p_postal_code)) then
      target_delivery_zone := 'remote';
      remote_delivery_fee := sale.remote_area_surcharge;
    end if;
  end if;
  delivery_fee := base_delivery_fee + remote_delivery_fee;
  new_total := target.subtotal_amount + delivery_fee;

  update public.orders set
    customer_name = trim(p_customer_name), phone_ciphertext = p_phone_ciphertext,
    phone_normalized_hash = p_phone_hash, phone_last4_hash = p_phone_last4_hash,
    depositor_name = trim(p_depositor_name), address_ciphertext = p_address_ciphertext,
    base_shipping_fee = base_delivery_fee, remote_area_surcharge = remote_delivery_fee,
    shipping_fee = delivery_fee, total_amount = new_total, delivery_zone = target_delivery_zone,
    payment_state = case when target.payment_state = 'paid' and target.total_amount <> new_total then 'review_required'::public.payment_state else target.payment_state end,
    payment_review_reason = case when target.payment_state = 'paid' and target.total_amount <> new_total then '관리자 배송지 수정으로 결제 금액 변경' else target.payment_review_reason end
  where id = target.id;

  return jsonb_build_object('baseShippingFee', base_delivery_fee, 'remoteAreaSurcharge', remote_delivery_fee, 'shippingFee', delivery_fee, 'totalAmount', new_total, 'deliveryZone', target_delivery_zone);
end;
$$;

create or replace function public.admin_clone_sale_v2(
  p_source_sale_id uuid,
  p_round_number integer,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_internal_note text default '',
  p_sale_kind text default 'live'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_sale public.sales%rowtype;
  source_product public.products%rowtype;
  created_sale_id uuid;
begin
  select * into source_sale from public.sales where id = p_source_sale_id;
  if source_sale.id is null then raise exception 'SOURCE_SALE_NOT_FOUND'; end if;
  if p_round_number < 1 then raise exception 'INVALID_ROUND_NUMBER'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'TITLE_REQUIRED'; end if;
  if p_starts_at >= p_ends_at then raise exception 'INVALID_SALE_WINDOW'; end if;
  if p_sale_kind not in ('live', 'test') then raise exception 'INVALID_SALE_KIND'; end if;
  insert into public.sales (
    round_number, title, starts_at, ends_at, order_limit, manually_closed, bank_name,
    bank_account_ciphertext, bank_holder, kakao_channel_url, shipping_notice, shipping_fee,
    free_shipping_threshold, remote_area_surcharge, pickup_name, pickup_address, pickup_notice,
    publication_status, internal_note, sale_kind
  ) values (
    p_round_number, trim(p_title), p_starts_at, p_ends_at, source_sale.order_limit, false,
    source_sale.bank_name, source_sale.bank_account_ciphertext, source_sale.bank_holder,
    source_sale.kakao_channel_url, source_sale.shipping_notice, source_sale.shipping_fee,
    source_sale.free_shipping_threshold, source_sale.remote_area_surcharge, source_sale.pickup_name,
    source_sale.pickup_address, source_sale.pickup_notice, 'draft', coalesce(p_internal_note, ''), p_sale_kind
  ) returning id into created_sale_id;
  for source_product in select * from public.products where sale_id = source_sale.id order by sort_order, created_at, id loop
    insert into public.products (
      sale_id, name, description, unit_price, active, item_type, stock_limit, sort_order, option_groups, customization_config
    ) values (
      created_sale_id, source_product.name, source_product.description, source_product.unit_price,
      source_product.active, source_product.item_type, source_product.stock_limit, source_product.sort_order,
      source_product.option_groups, source_product.customization_config
    );
  end loop;
  return created_sale_id;
exception when unique_violation then raise exception 'ROUND_NUMBER_ALREADY_EXISTS';
end;
$$;

revoke all on function public.admin_update_sale_settings_v2(uuid,jsonb) from public;
revoke all on function public.submit_order(text,text,jsonb,text,text,text) from public;
revoke all on function public.update_customer_order_v2(uuid,jsonb) from public;
revoke all on function public.admin_update_order_contact_v2(uuid,text,text,text,text,text,text,text) from public;
revoke all on function public.admin_clone_sale_v2(uuid,integer,text,timestamptz,timestamptz,text,text) from public;

grant execute on function public.admin_update_sale_settings_v2(uuid,jsonb) to service_role;
grant execute on function public.submit_order(text,text,jsonb,text,text,text) to service_role;
grant execute on function public.update_customer_order_v2(uuid,jsonb) to service_role;
grant execute on function public.admin_update_order_contact_v2(uuid,text,text,text,text,text,text,text) to service_role;
grant execute on function public.admin_clone_sale_v2(uuid,integer,text,timestamptz,timestamptz,text,text) to service_role;
