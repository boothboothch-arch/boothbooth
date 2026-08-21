-- Multi-round operations: prepare, review, publish and archive future sales without code changes.

alter table public.sales
  add column if not exists round_number integer,
  add column if not exists publication_status text not null default 'published',
  add column if not exists internal_note text not null default '',
  add column if not exists published_at timestamptz;

with numbered as (
  select
    id,
    coalesce(
      nullif(substring(title from '([0-9]+)차'), '')::integer,
      row_number() over (order by created_at, id)::integer
    ) as inferred_round
  from public.sales
  where round_number is null
)
update public.sales as sale
set round_number = numbered.inferred_round
from numbered
where sale.id = numbered.id;

update public.sales
set published_at = coalesce(published_at, created_at)
where publication_status = 'published';

alter table public.sales alter column round_number set not null;
alter table public.sales alter column publication_status set default 'draft';
alter table public.sales drop constraint if exists sales_round_number_check;
alter table public.sales add constraint sales_round_number_check check (round_number > 0);
alter table public.sales drop constraint if exists sales_publication_status_check;
alter table public.sales add constraint sales_publication_status_check
  check (publication_status in ('draft', 'published', 'archived'));
create unique index if not exists sales_round_number_uidx on public.sales (round_number);
create index if not exists sales_publication_schedule_idx
  on public.sales (publication_status, starts_at, ends_at, round_number desc);

drop index if exists public.orders_active_phone_uidx;
drop index if exists public.orders_active_email_uidx;
create unique index if not exists orders_active_phone_sale_uidx
  on public.orders (sale_id, phone_normalized_hash)
  where order_state <> 'cancelled';
create unique index if not exists orders_active_email_sale_uidx
  on public.orders (sale_id, email_normalized_hash)
  where order_state <> 'cancelled';

create or replace function private.current_public_sale_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sale.id
  from public.sales as sale
  where sale.publication_status = 'published'
  order by
    case
      when sale.starts_at <= now() and sale.ends_at > now() then 0
      when sale.starts_at > now() then 1
      else 2
    end,
    case when sale.starts_at > now() then sale.starts_at end asc nulls last,
    case when sale.ends_at <= now() then sale.ends_at end desc nulls last,
    sale.round_number desc
  limit 1;
$$;

create or replace function public.get_sale_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale public.sales%rowtype;
  submitted integer;
  reserved integer;
  remaining integer;
  phase text;
begin
  select * into sale
  from public.sales
  where id = private.current_public_sale_id();

  if sale.id is null then return null; end if;
  perform private.expire_reservations(sale.id);

  select count(*) into submitted
  from public.orders
  where sale_id = sale.id and order_state <> 'cancelled';

  select count(*) into reserved
  from public.reservations
  where sale_id = sale.id
    and state = 'active'
    and hard_expires_at > now()
    and lease_expires_at > now();

  remaining := greatest(0, sale.order_limit - submitted - reserved);
  phase := case
    when now() < sale.starts_at then 'scheduled'
    when now() >= sale.ends_at then 'ended'
    when sale.manually_closed then 'manually_closed'
    when remaining = 0 and submitted >= sale.order_limit then 'sold_out'
    when remaining = 0 then 'temporarily_full'
    else 'open'
  end;

  return jsonb_build_object(
    'configured', true,
    'saleId', sale.id,
    'roundNumber', sale.round_number,
    'title', sale.title,
    'phase', phase,
    'startsAt', sale.starts_at,
    'endsAt', sale.ends_at,
    'orderLimit', sale.order_limit,
    'submittedCount', submitted,
    'activeReservations', reserved,
    'remainingCount', remaining,
    'serverNow', now()
  );
end;
$$;

create or replace function public.claim_reservation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale public.sales%rowtype;
  existing public.reservations%rowtype;
  reserved integer;
  submitted integer;
  created public.reservations%rowtype;
begin
  select * into sale
  from public.sales
  where id = private.current_public_sale_id()
  for update;

  if sale.id is null then raise exception 'SALE_NOT_CONFIGURED'; end if;
  perform private.expire_reservations(sale.id);

  select * into existing
  from public.reservations
  where token_hash = p_token_hash
  for update;

  if existing.id is not null
    and existing.sale_id = sale.id
    and existing.state = 'active'
    and existing.hard_expires_at > now()
    and existing.lease_expires_at > now() then
    return jsonb_build_object(
      'reservationId', existing.id,
      'saleId', existing.sale_id,
      'hardExpiresAt', existing.hard_expires_at,
      'leaseExpiresAt', existing.lease_expires_at
    );
  end if;

  if now() < sale.starts_at then raise exception 'SALE_NOT_STARTED'; end if;
  if now() >= sale.ends_at then raise exception 'SALE_ENDED'; end if;
  if sale.manually_closed then raise exception 'SALE_PAUSED'; end if;

  select count(*) into submitted
  from public.orders
  where sale_id = sale.id and order_state <> 'cancelled';

  select count(*) into reserved
  from public.reservations
  where sale_id = sale.id
    and state = 'active'
    and hard_expires_at > now()
    and lease_expires_at > now();

  if submitted + reserved >= sale.order_limit then raise exception 'SOLD_OUT'; end if;

  if existing.id is not null and existing.state in ('released', 'expired') then
    update public.reservations
    set sale_id = sale.id,
        state = 'active',
        hard_expires_at = now() + interval '20 minutes',
        lease_expires_at = now() + interval '90 seconds',
        last_activity_at = now(),
        converted_order_id = null
    where id = existing.id
    returning * into created;
  elsif existing.id is not null then
    raise exception 'RESERVATION_ALREADY_USED';
  else
    insert into public.reservations (sale_id, token_hash, hard_expires_at, lease_expires_at)
    values (sale.id, p_token_hash, now() + interval '20 minutes', now() + interval '90 seconds')
    returning * into created;
  end if;

  return jsonb_build_object(
    'reservationId', created.id,
    'saleId', created.sale_id,
    'hardExpiresAt', created.hard_expires_at,
    'leaseExpiresAt', created.lease_expires_at
  );
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
  option_row public.product_options%rowtype;
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
  delivery_fee integer := 0;
  number text;
  fulfillment text := p_payload->>'fulfillmentType';
  receipt_type text := coalesce(p_payload->>'cashReceiptType', 'none');
begin
  select * into existing from public.orders where idempotency_key = p_idempotency_key;
  if existing.id is not null then
    return jsonb_build_object('orderId', existing.id, 'orderNumber', existing.order_number, 'totalAmount', existing.total_amount, 'paymentDueAt', existing.payment_due_at);
  end if;

  select * into reservation from public.reservations where token_hash = p_token_hash for update;
  if reservation.id is null or reservation.state <> 'active' or reservation.hard_expires_at <= now() or reservation.lease_expires_at <= now() then
    raise exception 'RESERVATION_EXPIRED';
  end if;
  select * into sale from public.sales where id = reservation.sale_id for update;
  if jsonb_typeof(p_payload->'items') <> 'array' or jsonb_array_length(p_payload->'items') < 1 then raise exception 'INVALID_QUANTITY'; end if;
  if fulfillment not in ('shipping', 'pickup') then raise exception 'INVALID_FULFILLMENT'; end if;
  if receipt_type not in ('none', 'personal', 'business') then raise exception 'INVALID_CASH_RECEIPT'; end if;

  if exists(
    select 1 from public.orders
    where sale_id = sale.id and order_state <> 'cancelled' and phone_normalized_hash = p_phone_hash
  ) then raise exception 'DUPLICATE_ORDER'; end if;
  if exists(
    select 1 from public.orders
    where sale_id = sale.id and order_state <> 'cancelled' and email_normalized_hash = p_email_hash
  ) then raise exception 'DUPLICATE_ORDER'; end if;

  if fulfillment = 'pickup' then
    select * into pickup from public.pickup_slots
    where id = (p_payload->>'pickupSlotId')::uuid and sale_id = sale.id and active and not manually_closed;
    if pickup.id is null then raise exception 'PICKUP_SLOT_UNAVAILABLE'; end if;
  elsif nullif(p_payload->>'addressCiphertext', '') is null then
    raise exception 'ADDRESS_REQUIRED';
  end if;

  for item in select value from jsonb_array_elements(p_payload->'items') loop
    item_index := item_index + 1;
    select * into product from public.products where id = (item->>'productId')::uuid and sale_id = sale.id and active;
    if product.id is null or product.item_type <> item->>'itemType' then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    if nullif(trim(item->>'initialText'), '') is null
      or trim(item->>'initialText') !~ '^[A-Za-z ]+$'
      or length(replace(trim(item->>'initialText'), ' ', '')) > 10 then raise exception 'INVALID_INITIAL'; end if;
    item_surcharge := 0;
    if product.item_type = 'shirt' then
      select * into option_row from public.product_options
      where product_id = product.id and option_type = 'size' and value = item->>'size' and active;
      if option_row.id is null then raise exception 'INVALID_OPTION'; end if;
      item_surcharge := option_row.price_delta;
      if not exists(
        select 1 from public.product_options
        where product_id = product.id and option_type = 'gender' and value = item->>'gender' and active
      ) then raise exception 'INVALID_OPTION'; end if;
    end if;
    if jsonb_array_length(coalesce(item->'images', '[]'::jsonb)) > 3 then raise exception 'TOO_MANY_IMAGES'; end if;
    total_qty := total_qty + 1;
    subtotal := subtotal + product.unit_price + item_surcharge;
  end loop;

  if (select count(*) from public.order_image_uploads where reservation_id = reservation.id and consumed_at is null) > 20 then raise exception 'TOO_MANY_IMAGES'; end if;
  if fulfillment = 'shipping' and subtotal < sale.free_shipping_threshold then delivery_fee := sale.shipping_fee; end if;

  loop
    number := private.order_number();
    exit when not exists(select 1 from public.orders where order_number = number);
  end loop;

  insert into public.orders (
    sale_id, reservation_id, idempotency_key, order_number, customer_name,
    phone_ciphertext, phone_normalized_hash, phone_last4_hash, email_ciphertext,
    email_normalized_hash, depositor_name, address_ciphertext, total_quantity,
    subtotal_amount, shipping_fee, total_amount, fulfillment_type, pickup_slot_id, pickup_snapshot,
    cash_receipt_type, cash_receipt_identifier_ciphertext, payment_due_at, bank_snapshot
  ) values (
    sale.id, reservation.id, p_idempotency_key, number, p_payload->>'customerName',
    p_payload->>'phoneCiphertext', p_phone_hash, p_phone_last4_hash, p_payload->>'emailCiphertext',
    p_email_hash, p_payload->>'depositorName', coalesce(p_payload->>'addressCiphertext', ''), total_qty,
    subtotal, delivery_fee, subtotal + delivery_fee, fulfillment, pickup.id,
    case when pickup.id is null then null else jsonb_build_object('name', sale.pickup_name, 'address', sale.pickup_address, 'notice', sale.pickup_notice, 'date', pickup.pickup_date, 'startsAt', pickup.starts_at, 'endsAt', pickup.ends_at) end,
    receipt_type, nullif(p_payload->>'cashReceiptIdentifierCiphertext', ''), now() + interval '1 hour',
    jsonb_build_object('bankName', sale.bank_name, 'accountCiphertext', sale.bank_account_ciphertext, 'holder', sale.bank_holder)
  ) returning * into created;

  item_index := 0;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    item_index := item_index + 1;
    select * into product from public.products where id = (item->>'productId')::uuid;
    item_surcharge := 0;
    if product.item_type = 'shirt' then
      select * into option_row from public.product_options
      where product_id = product.id and option_type = 'size' and value = item->>'size' and active;
      item_surcharge := option_row.price_delta;
    end if;
    insert into public.order_items (
      order_id, product_id, product_name, unit_price, color, size, quantity, line_amount,
      item_type, gender, initial_text, sticker_selected, sticker_categories,
      favorite_colors, favorite_things, desired_mood, instagram_reference, extra_request,
      option_surcharge, sort_order
    ) values (
      created.id, product.id, product.name, product.unit_price, null, nullif(item->>'size', ''), 1, product.unit_price + item_surcharge,
      product.item_type, nullif(item->>'gender', ''), trim(item->>'initialText'), coalesce((item->>'stickerSelected')::boolean, false),
      coalesce(string_to_array(nullif(trim(item->>'stickerCategories'), ''), ','), '{}'::text[]),
      coalesce(item->>'favoriteColors', ''), coalesce(item->>'favoriteThings', ''), coalesce(item->>'desiredMood', ''),
      coalesce(item->>'instagramReference', ''), coalesce(item->>'extraRequest', ''), item_surcharge, item_index
    ) returning * into created_item;

    for image_id_text in select jsonb_array_elements_text(coalesce(item->'images', '[]'::jsonb)) loop
      insert into public.order_item_images (order_item_id, storage_path, mime_type, byte_size, width, height, sort_order)
      select created_item.id, upload.storage_path, upload.mime_type, upload.byte_size, upload.width, upload.height,
        (select count(*) from public.order_item_images where order_item_id = created_item.id)
      from public.order_image_uploads upload
      where upload.id = image_id_text::uuid
        and upload.reservation_id = reservation.id
        and upload.client_item_id = (item->>'clientId')::uuid
        and upload.consumed_at is null;
      if not found then raise exception 'INVALID_IMAGE'; end if;
      update public.order_image_uploads set consumed_at = now() where id = image_id_text::uuid;
    end loop;
  end loop;

  update public.reservations set state = 'converted', converted_order_id = created.id where id = reservation.id;
  insert into public.email_outbox (order_id, event_type, dedupe_key, recipient_ciphertext, payload_json)
  values (
    created.id,
    'order_received',
    created.id || ':order_received',
    created.email_ciphertext,
    jsonb_build_object('orderNumber', created.order_number, 'totalAmount', created.total_amount, 'paymentDueAt', created.payment_due_at)
  );

  return jsonb_build_object('orderId', created.id, 'orderNumber', created.order_number, 'totalAmount', created.total_amount, 'paymentDueAt', created.payment_due_at);
exception
  when unique_violation then raise exception 'DUPLICATE_ORDER';
end;
$$;

create or replace function public.admin_clone_sale(
  p_source_sale_id uuid,
  p_round_number integer,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_internal_note text default ''
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
  created_product_id uuid;
begin
  select * into source_sale from public.sales where id = p_source_sale_id;
  if source_sale.id is null then raise exception 'SOURCE_SALE_NOT_FOUND'; end if;
  if p_round_number < 1 then raise exception 'INVALID_ROUND_NUMBER'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'TITLE_REQUIRED'; end if;
  if p_starts_at >= p_ends_at then raise exception 'INVALID_SALE_WINDOW'; end if;

  insert into public.sales (
    round_number, title, starts_at, ends_at, order_limit, manually_closed,
    bank_name, bank_account_ciphertext, bank_holder, kakao_channel_url, shipping_notice,
    shipping_fee, free_shipping_threshold, pickup_name, pickup_address, pickup_notice,
    publication_status, internal_note
  ) values (
    p_round_number, trim(p_title), p_starts_at, p_ends_at, source_sale.order_limit, false,
    source_sale.bank_name, source_sale.bank_account_ciphertext, source_sale.bank_holder,
    source_sale.kakao_channel_url, source_sale.shipping_notice,
    source_sale.shipping_fee, source_sale.free_shipping_threshold,
    source_sale.pickup_name, source_sale.pickup_address, source_sale.pickup_notice,
    'draft', coalesce(p_internal_note, '')
  ) returning id into created_sale_id;

  for source_product in
    select * from public.products where sale_id = source_sale.id order by created_at, id
  loop
    insert into public.products (sale_id, name, unit_price, active, item_type)
    values (created_sale_id, source_product.name, source_product.unit_price, source_product.active, source_product.item_type)
    returning id into created_product_id;

    insert into public.product_options (product_id, option_type, value, sort_order, active, price_delta)
    select created_product_id, option_type, value, sort_order, active, price_delta
    from public.product_options
    where product_id = source_product.id;
  end loop;

  return created_sale_id;
exception
  when unique_violation then raise exception 'ROUND_NUMBER_ALREADY_EXISTS';
end;
$$;

create or replace function public.admin_set_sale_publication(p_sale_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.sales%rowtype;
begin
  if p_status not in ('draft', 'published', 'archived') then
    raise exception 'INVALID_PUBLICATION_STATUS';
  end if;

  select * into target from public.sales where id = p_sale_id for update;
  if target.id is null then raise exception 'SALE_NOT_FOUND'; end if;

  if p_status = 'draft' and exists(select 1 from public.orders where sale_id = target.id) then
    raise exception 'SALE_WITH_ORDERS_CANNOT_BE_DRAFT';
  end if;

  if p_status = 'published' then
    if target.starts_at >= target.ends_at then raise exception 'INVALID_SALE_WINDOW'; end if;
    if nullif(trim(target.bank_name), '') is null
      or nullif(trim(target.bank_account_ciphertext), '') is null
      or nullif(trim(target.bank_holder), '') is null then
      raise exception 'BANK_INFO_REQUIRED';
    end if;
    if nullif(trim(target.kakao_channel_url), '') is null then raise exception 'KAKAO_CHANNEL_REQUIRED'; end if;
    if not exists(select 1 from public.products where sale_id = target.id and item_type = 'shirt' and active) then
      raise exception 'ACTIVE_SHIRT_REQUIRED';
    end if;
    if not exists(select 1 from public.products where sale_id = target.id and item_type = 'bag' and active) then
      raise exception 'ACTIVE_BAG_REQUIRED';
    end if;
    if not exists(
      select 1 from public.product_options as option_row
      join public.products as product on product.id = option_row.product_id
      where product.sale_id = target.id and product.item_type = 'shirt'
        and product.active and option_row.option_type = 'size' and option_row.active
    ) then raise exception 'ACTIVE_SIZE_REQUIRED'; end if;
    if not exists(
      select 1 from public.product_options as option_row
      join public.products as product on product.id = option_row.product_id
      where product.sale_id = target.id and product.item_type = 'shirt'
        and product.active and option_row.option_type = 'gender' and option_row.active
    ) then raise exception 'ACTIVE_GENDER_REQUIRED'; end if;
    if not exists(
      select 1 from public.pickup_slots where sale_id = target.id and active and not manually_closed
    ) then raise exception 'ACTIVE_PICKUP_SLOT_REQUIRED'; end if;
    if exists(
      select 1 from public.sales as other
      where other.id <> target.id
        and other.publication_status = 'published'
        and other.starts_at < target.ends_at
        and other.ends_at > target.starts_at
    ) then raise exception 'PUBLISHED_SALE_WINDOW_OVERLAP'; end if;
  end if;

  update public.sales
  set publication_status = p_status,
      published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
      manually_closed = case when p_status = 'archived' then true when p_status = 'published' then false else manually_closed end
  where id = target.id;
end;
$$;

revoke all on function public.submit_order(text,text,jsonb,text,text,text) from public;
revoke all on function public.admin_clone_sale(uuid,integer,text,timestamptz,timestamptz,text) from public;
revoke all on function public.admin_set_sale_publication(uuid,text) from public;
grant execute on function public.submit_order(text,text,jsonb,text,text,text) to service_role;
grant execute on function public.admin_clone_sale(uuid,integer,text,timestamptz,timestamptz,text) to service_role;
grant execute on function public.admin_set_sale_publication(uuid,text) to service_role;
