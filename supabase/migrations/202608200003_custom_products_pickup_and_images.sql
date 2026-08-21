-- PRD v0.2: custom shirt/bag items, pickup, cash-receipt request, and private reference images.

do $$
declare
  target_job_id bigint;
begin
  select jobid into target_job_id from cron.job where jobname = 'booth-booth-cancel-overdue' limit 1;
  if target_job_id is not null then perform cron.unschedule(target_job_id); end if;
exception when undefined_table then null;
end;
$$;

drop function if exists public.cancel_overdue_orders();

alter table public.sales
  add column if not exists shipping_fee integer not null default 3000 check (shipping_fee >= 0),
  add column if not exists free_shipping_threshold integer not null default 80000 check (free_shipping_threshold >= 0),
  add column if not exists pickup_name text not null default '부스부스 매장',
  add column if not exists pickup_address text not null default '',
  add column if not exists pickup_notice text not null default '';

update public.sales
set bank_name = '국민은행', bank_account_ciphertext = '301201-04-460201', bank_holder = '장견희'
where bank_name = '은행명 입력 필요' or bank_holder = '예금주 입력 필요';

alter table public.products add column if not exists item_type text;
update public.products set item_type = 'shirt' where item_type is null;
alter table public.products alter column item_type set not null;
alter table public.products drop constraint if exists products_item_type_check;
alter table public.products add constraint products_item_type_check check (item_type in ('shirt', 'bag'));
create unique index if not exists products_sale_type_uidx on public.products (sale_id, item_type);

alter table public.product_options drop constraint if exists product_options_option_type_check;
alter table public.product_options add constraint product_options_option_type_check check (option_type in ('size', 'gender'));
alter table public.product_options add column if not exists price_delta integer not null default 0 check (price_delta >= 0);
delete from public.product_options where option_type = 'color';

update public.products set name = '이니셜 티셔츠', unit_price = 33000 where item_type = 'shirt';
insert into public.products (sale_id, name, unit_price, item_type, active)
select id, '이니셜 가방', 20000, 'bag', true from public.sales
on conflict (sale_id, item_type) do update set name = excluded.name, unit_price = excluded.unit_price;

insert into public.product_options (product_id, option_type, value, sort_order, price_delta)
select p.id, 'size', option.value, option.ordinality::integer,
  case when option.value = '2XL' then 2000 else 0 end
from public.products p
cross join unnest(array['XS','S','M','L','XL','2XL']) with ordinality as option(value, ordinality)
where p.item_type = 'shirt'
on conflict (product_id, option_type, value) do update set sort_order = excluded.sort_order, price_delta = excluded.price_delta, active = true;

insert into public.product_options (product_id, option_type, value, sort_order)
select p.id, 'gender', option.value, option.ordinality::integer
from public.products p
cross join unnest(array['남성','여성']) with ordinality as option(value, ordinality)
where p.item_type = 'shirt'
on conflict (product_id, option_type, value) do update set sort_order = excluded.sort_order, active = true;

create table if not exists public.pickup_slots (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  pickup_date date not null,
  starts_at time not null,
  ends_at time not null,
  active boolean not null default true,
  manually_closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sale_id, pickup_date, starts_at, ends_at),
  check (starts_at < ends_at)
);
drop trigger if exists pickup_slots_updated_at on public.pickup_slots;
create trigger pickup_slots_updated_at before update on public.pickup_slots for each row execute function private.set_updated_at();

insert into public.pickup_slots (sale_id, pickup_date, starts_at, ends_at)
select sale.id, slot.pickup_date, slot.starts_at, slot.ends_at
from public.sales sale
cross join (values
  ('2026-09-05'::date, '11:00'::time, '13:00'::time),
  ('2026-09-05'::date, '13:00'::time, '15:00'::time),
  ('2026-09-05'::date, '15:00'::time, '17:00'::time),
  ('2026-09-06'::date, '11:00'::time, '13:00'::time),
  ('2026-09-06'::date, '13:00'::time, '15:00'::time),
  ('2026-09-06'::date, '15:00'::time, '17:00'::time)
) as slot(pickup_date, starts_at, ends_at)
on conflict do nothing;

alter table public.orders drop constraint if exists orders_total_quantity_check;
alter table public.orders alter column total_quantity type integer;
alter table public.orders add constraint orders_total_quantity_check check (total_quantity >= 1);
alter table public.orders
  add column if not exists subtotal_amount integer not null default 0 check (subtotal_amount >= 0),
  add column if not exists shipping_fee integer not null default 0 check (shipping_fee >= 0),
  add column if not exists fulfillment_type text not null default 'shipping' check (fulfillment_type in ('shipping', 'pickup')),
  add column if not exists pickup_slot_id uuid references public.pickup_slots(id),
  add column if not exists pickup_snapshot jsonb,
  add column if not exists cash_receipt_type text not null default 'none' check (cash_receipt_type in ('none', 'personal', 'business')),
  add column if not exists cash_receipt_identifier_ciphertext text;
alter table public.orders drop constraint if exists orders_pickup_slot_id_fkey;
alter table public.orders add constraint orders_pickup_slot_id_fkey foreign key (pickup_slot_id) references public.pickup_slots(id) on delete set null;
update public.orders set subtotal_amount = total_amount where subtotal_amount = 0;

alter table public.order_items alter column color drop not null;
alter table public.order_items alter column size drop not null;
alter table public.order_items
  add column if not exists item_type text not null default 'shirt' check (item_type in ('shirt', 'bag')),
  add column if not exists gender text,
  add column if not exists initial_text text not null default 'BB',
  add column if not exists sticker_selected boolean not null default false,
  add column if not exists sticker_categories text[] not null default '{}',
  add column if not exists favorite_colors text not null default '',
  add column if not exists favorite_things text not null default '',
  add column if not exists desired_mood text not null default '',
  add column if not exists instagram_reference text not null default '',
  add column if not exists extra_request text not null default '',
  add column if not exists option_surcharge integer not null default 0 check (option_surcharge >= 0),
  add column if not exists sort_order integer not null default 0;

create table if not exists public.order_image_uploads (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  client_item_id uuid not null,
  storage_path text not null unique,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 2097152),
  width integer not null check (width > 0 and width <= 1600),
  height integer not null check (height > 0 and height <= 1600),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((reservation_id is not null) <> (order_id is not null))
);
create index if not exists order_image_uploads_reservation_idx on public.order_image_uploads (reservation_id, client_item_id) where consumed_at is null;
create index if not exists order_image_uploads_order_idx on public.order_image_uploads (order_id, client_item_id) where consumed_at is null;

create table if not exists public.order_item_images (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  byte_size integer not null,
  width integer not null,
  height integer not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

do $$
begin
  -- Hosted Supabase already has Storage here. Some fresh local CLI versions create it
  -- after application migrations, so do not block the rest of the schema in that case.
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('order-reference-images', 'order-reference-images', false, 2097152, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;

alter table public.pickup_slots enable row level security;
alter table public.order_image_uploads enable row level security;
alter table public.order_item_images enable row level security;
revoke all on public.pickup_slots, public.order_image_uploads, public.order_item_images from anon, authenticated;
grant select, insert, update, delete on public.pickup_slots to authenticated;
grant select on public.order_item_images to authenticated;
create policy admin_all_pickup_slots on public.pickup_slots for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_read_order_item_images on public.order_item_images for select to authenticated using (private.is_admin());

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

  if exists(select 1 from public.orders where order_state <> 'cancelled' and phone_normalized_hash = p_phone_hash) then raise exception 'DUPLICATE_ORDER'; end if;
  if exists(select 1 from public.orders where order_state <> 'cancelled' and email_normalized_hash = p_email_hash) then raise exception 'DUPLICATE_ORDER'; end if;

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
      select * into option_row from public.product_options where product_id = product.id and option_type = 'size' and value = item->>'size' and active;
      if option_row.id is null then raise exception 'INVALID_OPTION'; end if;
      item_surcharge := option_row.price_delta;
      if not exists(select 1 from public.product_options where product_id = product.id and option_type = 'gender' and value = item->>'gender' and active) then raise exception 'INVALID_OPTION'; end if;
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
      select * into option_row from public.product_options where product_id = product.id and option_type = 'size' and value = item->>'size' and active;
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
      where upload.id = image_id_text::uuid and upload.reservation_id = reservation.id
        and upload.client_item_id = (item->>'clientId')::uuid and upload.consumed_at is null;
      if not found then raise exception 'INVALID_IMAGE'; end if;
      update public.order_image_uploads set consumed_at = now() where id = image_id_text::uuid;
    end loop;
  end loop;

  update public.reservations set state = 'converted', converted_order_id = created.id where id = reservation.id;
  insert into public.email_outbox (order_id, event_type, dedupe_key, recipient_ciphertext, payload_json)
  values (created.id, 'order_received', created.id || ':order_received', created.email_ciphertext,
    jsonb_build_object('orderNumber', created.order_number, 'totalAmount', created.total_amount, 'paymentDueAt', created.payment_due_at));

  return jsonb_build_object('orderId', created.id, 'orderNumber', created.order_number, 'totalAmount', created.total_amount, 'paymentDueAt', created.payment_due_at);
exception
  when unique_violation then raise exception 'DUPLICATE_ORDER';
end;
$$;

create or replace function public.admin_update_order(
  p_order_id uuid,
  p_order_state public.order_state,
  p_payment_state public.payment_state,
  p_payment_review_reason text default null,
  p_cancellation_reason text default null,
  p_carrier_code text default null,
  p_carrier_name text default null,
  p_tracking_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.orders%rowtype;
  updated public.orders%rowtype;
  shipment public.shipments%rowtype;
begin
  select * into previous from public.orders where id = p_order_id for update;
  if previous.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if p_payment_state = 'review_required' and nullif(trim(p_payment_review_reason), '') is null then raise exception 'PAYMENT_REVIEW_REASON_REQUIRED'; end if;
  if p_order_state = 'cancelled' and nullif(trim(p_cancellation_reason), '') is null then raise exception 'CANCELLATION_REASON_REQUIRED'; end if;

  update public.orders
  set order_state = p_order_state,
      payment_state = p_payment_state,
      payment_review_reason = case when p_payment_state = 'review_required' then trim(p_payment_review_reason) else null end,
      cancellation_reason = case when p_order_state = 'cancelled' then trim(p_cancellation_reason) else null end,
      cancelled_at = case when p_order_state = 'cancelled' and previous.order_state <> 'cancelled' then now() when p_order_state <> 'cancelled' then null else cancelled_at end,
      payment_due_at = case when previous.order_state = 'cancelled' and p_order_state = 'payment_pending' and p_payment_state = 'pending' then now() + interval '1 hour' else payment_due_at end
  where id = p_order_id returning * into updated;

  if updated.fulfillment_type = 'shipping' and (nullif(trim(p_carrier_name), '') is not null or nullif(trim(p_tracking_number), '') is not null) then
    insert into public.shipments (order_id, carrier_code, carrier_name, tracking_number, shipped_at, completed_at)
    values (p_order_id, nullif(trim(p_carrier_code), ''), nullif(trim(p_carrier_name), ''), nullif(trim(p_tracking_number), ''),
      case when nullif(trim(p_tracking_number), '') is not null then now() end, case when p_order_state = 'completed' then now() end)
    on conflict (order_id) do update set carrier_code = excluded.carrier_code, carrier_name = excluded.carrier_name,
      tracking_number = excluded.tracking_number, shipped_at = case when excluded.tracking_number is not null then coalesce(public.shipments.shipped_at, now()) else public.shipments.shipped_at end,
      completed_at = case when p_order_state = 'completed' then coalesce(public.shipments.completed_at, now()) end
    returning * into shipment;
  end if;

  if p_payment_state = 'paid' and previous.payment_state <> 'paid' then
    insert into public.email_outbox (order_id, event_type, dedupe_key, recipient_ciphertext, payload_json)
    values (updated.id, 'payment_confirmed', updated.id || ':payment_confirmed:' || gen_random_uuid(), updated.email_ciphertext,
      jsonb_build_object('orderNumber', updated.order_number, 'totalAmount', updated.total_amount));
  end if;
  if p_order_state = 'cancelled' and previous.order_state <> 'cancelled' then
    insert into public.email_outbox (order_id, event_type, dedupe_key, recipient_ciphertext, payload_json)
    values (updated.id, 'order_cancelled', updated.id || ':cancelled:' || gen_random_uuid(), updated.email_ciphertext,
      jsonb_build_object('orderNumber', updated.order_number, 'reason', updated.cancellation_reason));
  end if;
  if updated.fulfillment_type = 'shipping' and nullif(trim(p_tracking_number), '') is not null and previous.order_state <> 'preparing' then
    insert into public.email_outbox (order_id, event_type, dedupe_key, recipient_ciphertext, payload_json)
    values (updated.id, 'shipment_started', updated.id || ':shipment_started:' || gen_random_uuid(), updated.email_ciphertext,
      jsonb_build_object('orderNumber', updated.order_number, 'carrierName', shipment.carrier_name, 'trackingNumber', shipment.tracking_number));
  end if;
  if p_order_state = 'preparing' and previous.order_state <> 'preparing' and updated.fulfillment_type = 'pickup' then
    insert into public.email_outbox (order_id, event_type, dedupe_key, recipient_ciphertext, payload_json)
    values (updated.id, 'pickup_ready', updated.id || ':pickup_ready:' || gen_random_uuid(), updated.email_ciphertext,
      jsonb_build_object('orderNumber', updated.order_number, 'pickup', updated.pickup_snapshot));
  end if;
  if p_order_state = 'completed' and previous.order_state <> 'completed' then
    insert into public.email_outbox (order_id, event_type, dedupe_key, recipient_ciphertext, payload_json)
    values (updated.id, 'delivery_completed', updated.id || ':delivery_completed:' || gen_random_uuid(), updated.email_ciphertext,
      jsonb_build_object('orderNumber', updated.order_number, 'fulfillmentType', updated.fulfillment_type));
  end if;
  return jsonb_build_object('orderId', updated.id, 'orderNumber', updated.order_number);
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
  option_row public.product_options%rowtype;
  pickup public.pickup_slots%rowtype;
  item jsonb;
  target_item public.order_items%rowtype;
  subtotal integer := 0;
  delivery_fee integer := 0;
  item_surcharge integer;
  fulfillment text := p_payload->>'fulfillmentType';
  receipt_type text := coalesce(p_payload->>'cashReceiptType', 'none');
begin
  select * into target from public.orders where id = p_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.order_state <> 'payment_pending' then raise exception 'ORDER_NOT_EDITABLE'; end if;
  select * into sale from public.sales where id = target.sale_id;
  if jsonb_array_length(p_payload->'items') <> (select count(*) from public.order_items where order_id = target.id) then raise exception 'ITEM_COUNT_CHANGE_NOT_ALLOWED'; end if;
  if fulfillment not in ('shipping', 'pickup') then raise exception 'INVALID_FULFILLMENT'; end if;
  if receipt_type not in ('none', 'personal', 'business') then raise exception 'INVALID_CASH_RECEIPT'; end if;
  if fulfillment = 'pickup' then
    select * into pickup from public.pickup_slots where id = (p_payload->>'pickupSlotId')::uuid and sale_id = sale.id and active and not manually_closed;
    if pickup.id is null then raise exception 'PICKUP_SLOT_UNAVAILABLE'; end if;
  elsif nullif(p_payload->>'addressCiphertext', '') is null then raise exception 'ADDRESS_REQUIRED'; end if;

  for item in select value from jsonb_array_elements(p_payload->'items') loop
    select * into target_item from public.order_items where id = (item->>'id')::uuid and order_id = target.id for update;
    if target_item.id is null then raise exception 'INVALID_ITEM'; end if;
    select * into product from public.products where id = (item->>'productId')::uuid and sale_id = sale.id and active;
    if product.id is null or product.item_type <> item->>'itemType' then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    if nullif(trim(item->>'initialText'), '') is null or trim(item->>'initialText') !~ '^[A-Za-z ]+$' or length(replace(trim(item->>'initialText'), ' ', '')) > 10 then raise exception 'INVALID_INITIAL'; end if;
    item_surcharge := 0;
    if product.item_type = 'shirt' then
      select * into option_row from public.product_options where product_id = product.id and option_type = 'size' and value = item->>'size' and active;
      if option_row.id is null then raise exception 'INVALID_OPTION'; end if;
      item_surcharge := option_row.price_delta;
      if not exists(select 1 from public.product_options where product_id = product.id and option_type = 'gender' and value = item->>'gender' and active) then raise exception 'INVALID_OPTION'; end if;
    end if;
    update public.order_items set
      product_id = product.id, product_name = product.name, unit_price = product.unit_price, item_type = product.item_type,
      size = case when product.item_type = 'shirt' then item->>'size' end,
      gender = case when product.item_type = 'shirt' then item->>'gender' end,
      initial_text = trim(item->>'initialText'), sticker_selected = coalesce((item->>'stickerSelected')::boolean, false),
      sticker_categories = coalesce(string_to_array(nullif(trim(item->>'stickerCategories'), ''), ','), '{}'::text[]),
      favorite_colors = coalesce(item->>'favoriteColors', ''), favorite_things = coalesce(item->>'favoriteThings', ''),
      desired_mood = coalesce(item->>'desiredMood', ''), instagram_reference = coalesce(item->>'instagramReference', ''),
      extra_request = coalesce(item->>'extraRequest', ''), option_surcharge = item_surcharge,
      line_amount = product.unit_price + item_surcharge
    where id = target_item.id;
    subtotal := subtotal + product.unit_price + item_surcharge;
  end loop;

  if fulfillment = 'shipping' and subtotal < sale.free_shipping_threshold then delivery_fee := sale.shipping_fee; end if;
  update public.orders set
    address_ciphertext = coalesce(p_payload->>'addressCiphertext', ''), fulfillment_type = fulfillment,
    pickup_slot_id = pickup.id,
    pickup_snapshot = case when pickup.id is null then null else jsonb_build_object('name', sale.pickup_name, 'address', sale.pickup_address, 'notice', sale.pickup_notice, 'date', pickup.pickup_date, 'startsAt', pickup.starts_at, 'endsAt', pickup.ends_at) end,
    cash_receipt_type = receipt_type,
    cash_receipt_identifier_ciphertext = nullif(p_payload->>'cashReceiptIdentifierCiphertext', ''),
    subtotal_amount = subtotal, shipping_fee = delivery_fee, total_amount = subtotal + delivery_fee
  where id = target.id;
  return jsonb_build_object('totalQuantity', target.total_quantity, 'subtotalAmount', subtotal, 'shippingFee', delivery_fee, 'totalAmount', subtotal + delivery_fee);
end;
$$;

revoke all on public.pickup_slots, public.order_image_uploads, public.order_item_images from anon, authenticated;
revoke all on function public.submit_order(text,text,jsonb,text,text,text) from public;
revoke all on function public.update_customer_order_v2(uuid,jsonb) from public;
grant execute on function public.submit_order(text,text,jsonb,text,text,text) to service_role;
grant execute on function public.update_customer_order_v2(uuid,jsonb) to service_role;

drop function if exists public.update_customer_order(uuid,text,jsonb);
drop function if exists public.admin_update_order_info(uuid,text,text,text,text,text,text,text,text,jsonb);
drop function if exists public.admin_update_settings(uuid,text,timestamptz,timestamptz,integer,boolean,text,text,text,text,text,uuid,text,integer,text[],text[]);
