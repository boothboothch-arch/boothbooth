create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.reservation_state as enum ('active', 'converted', 'released', 'expired');
create type public.order_state as enum ('payment_pending', 'payment_confirmed', 'preparing', 'completed', 'cancelled');
create type public.payment_state as enum ('pending', 'review_required', 'paid', 'refund_required', 'refunded');
create type public.email_state as enum ('pending', 'processing', 'sent', 'failed');

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  order_limit integer not null default 100 check (order_limit > 0),
  manually_closed boolean not null default false,
  bank_name text not null,
  bank_account_ciphertext text not null,
  bank_holder text not null,
  kakao_channel_url text not null,
  shipping_notice text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  name text not null,
  unit_price integer not null check (unit_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  option_type text not null check (option_type in ('color', 'size')),
  value text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  unique (product_id, option_type, value)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  token_hash text not null unique,
  state public.reservation_state not null default 'active',
  hard_expires_at timestamptz not null,
  lease_expires_at timestamptz not null,
  last_activity_at timestamptz not null default now(),
  converted_order_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reservations_active_hard_idx on public.reservations (sale_id, state, hard_expires_at);
create index reservations_active_lease_idx on public.reservations (sale_id, state, lease_expires_at);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  reservation_id uuid not null unique references public.reservations(id),
  idempotency_key text not null unique,
  order_number text not null unique,
  customer_name text not null,
  phone_ciphertext text not null,
  phone_normalized_hash text not null,
  phone_last4_hash text not null,
  email_ciphertext text not null,
  email_normalized_hash text not null,
  depositor_name text not null,
  address_ciphertext text not null,
  total_quantity smallint not null check (total_quantity between 1 and 5),
  total_amount integer not null check (total_amount >= 0),
  order_state public.order_state not null default 'payment_pending',
  payment_state public.payment_state not null default 'pending',
  payment_review_reason text,
  payment_due_at timestamptz not null,
  bank_snapshot jsonb not null,
  cancellation_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reservations
  add constraint reservations_converted_order_fk
  foreign key (converted_order_id) references public.orders(id);

create unique index orders_active_phone_uidx on public.orders (phone_normalized_hash) where order_state <> 'cancelled';
create unique index orders_active_email_uidx on public.orders (email_normalized_hash) where order_state <> 'cancelled';
create index orders_created_idx on public.orders (created_at desc);
create index orders_state_idx on public.orders (order_state, payment_state);
create index orders_due_idx on public.orders (payment_due_at) where order_state = 'payment_pending';

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  unit_price integer not null,
  color text not null,
  size text not null,
  quantity smallint not null check (quantity > 0),
  line_amount integer not null check (line_amount >= 0)
);

create table public.shipments (
  order_id uuid primary key references public.orders(id) on delete cascade,
  carrier_code text,
  carrier_name text,
  tracking_number text,
  shipped_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  event_type text not null,
  dedupe_key text not null unique,
  recipient_ciphertext text not null,
  payload_json jsonb not null default '{}'::jsonb,
  state public.email_state not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index email_outbox_pending_idx on public.email_outbox (state, next_attempt_at) where state in ('pending', 'failed');

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  scope text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_events_lookup_idx on public.rate_limit_events (scope, key_hash, created_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sales_updated_at before update on public.sales for each row execute function private.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function private.set_updated_at();
create trigger reservations_updated_at before update on public.reservations for each row execute function private.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function private.set_updated_at();
create trigger shipments_updated_at before update on public.shipments for each row execute function private.set_updated_at();

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.admin_users where user_id = (select auth.uid()));
$$;

create or replace function private.expire_reservations(p_sale_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.reservations
  set state = 'expired'
  where sale_id = p_sale_id
    and state = 'active'
    and (hard_expires_at <= now() or lease_expires_at <= now());
$$;

create or replace function private.order_number()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes bytea := extensions.gen_random_bytes(10);
  result text := 'BB-';
begin
  for i in 0..9 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end;
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
  select * into sale from public.sales order by created_at desc limit 1;
  if sale.id is null then return null; end if;
  perform private.expire_reservations(sale.id);

  select count(*) into submitted from public.orders where sale_id = sale.id and order_state <> 'cancelled';
  select count(*) into reserved from public.reservations
    where sale_id = sale.id and state = 'active' and hard_expires_at > now() and lease_expires_at > now();
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
  select * into sale from public.sales order by created_at desc limit 1 for update;
  if sale.id is null then raise exception 'SALE_NOT_CONFIGURED'; end if;
  perform private.expire_reservations(sale.id);

  select * into existing from public.reservations where token_hash = p_token_hash for update;
  if existing.id is not null and existing.state = 'active' and existing.hard_expires_at > now() and existing.lease_expires_at > now() then
    return jsonb_build_object('reservationId', existing.id, 'saleId', existing.sale_id, 'hardExpiresAt', existing.hard_expires_at, 'leaseExpiresAt', existing.lease_expires_at);
  end if;

  if now() < sale.starts_at then raise exception 'SALE_NOT_STARTED'; end if;
  if now() >= sale.ends_at then raise exception 'SALE_ENDED'; end if;
  if sale.manually_closed then raise exception 'SALE_PAUSED'; end if;

  select count(*) into submitted from public.orders where sale_id = sale.id and order_state <> 'cancelled';
  select count(*) into reserved from public.reservations
    where sale_id = sale.id and state = 'active' and hard_expires_at > now() and lease_expires_at > now();
  if submitted + reserved >= sale.order_limit then raise exception 'SOLD_OUT'; end if;

  if existing.id is not null and existing.state in ('released', 'expired') then
    update public.reservations
    set sale_id = sale.id, state = 'active', hard_expires_at = now() + interval '30 minutes',
        lease_expires_at = now() + interval '90 seconds', last_activity_at = now(), converted_order_id = null
    where id = existing.id
    returning * into created;
  elsif existing.id is not null then
    raise exception 'RESERVATION_ALREADY_USED';
  else
    insert into public.reservations (sale_id, token_hash, hard_expires_at, lease_expires_at)
    values (sale.id, p_token_hash, now() + interval '30 minutes', now() + interval '90 seconds')
    returning * into created;
  end if;

  return jsonb_build_object('reservationId', created.id, 'saleId', created.sale_id, 'hardExpiresAt', created.hard_expires_at, 'leaseExpiresAt', created.lease_expires_at);
end;
$$;

create or replace function public.heartbeat_reservation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.reservations%rowtype;
begin
  update public.reservations
  set last_activity_at = now(), lease_expires_at = least(hard_expires_at, now() + interval '90 seconds')
  where token_hash = p_token_hash and state = 'active' and hard_expires_at > now() and lease_expires_at > now()
  returning * into reservation;
  if reservation.id is null then raise exception 'RESERVATION_EXPIRED'; end if;
  return jsonb_build_object('saleId', reservation.sale_id, 'hardExpiresAt', reservation.hard_expires_at, 'leaseExpiresAt', reservation.lease_expires_at, 'serverNow', now());
end;
$$;

create or replace function public.release_reservation(p_token_hash text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with released as (
    update public.reservations set state = 'released'
    where token_hash = p_token_hash and state = 'active'
    returning id
  ) select exists(select 1 from released);
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
  existing public.orders%rowtype;
  created public.orders%rowtype;
  item jsonb;
  item_qty integer;
  total_qty integer := 0;
  total_price integer := 0;
  number text;
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
  select * into product from public.products where sale_id = sale.id and active = true order by created_at limit 1;
  if product.id is null then raise exception 'PRODUCT_UNAVAILABLE'; end if;

  if exists(select 1 from public.orders where order_state <> 'cancelled' and phone_normalized_hash = p_phone_hash) then raise exception 'DUPLICATE_ORDER'; end if;
  if exists(select 1 from public.orders where order_state <> 'cancelled' and email_normalized_hash = p_email_hash) then raise exception 'DUPLICATE_ORDER'; end if;

  for item in select value from jsonb_array_elements(p_payload->'items') loop
    item_qty := (item->>'quantity')::integer;
    if item_qty < 1 then raise exception 'INVALID_QUANTITY'; end if;
    if not exists(select 1 from public.product_options where product_id = product.id and option_type = 'color' and value = item->>'color' and active) then raise exception 'INVALID_OPTION'; end if;
    if not exists(select 1 from public.product_options where product_id = product.id and option_type = 'size' and value = item->>'size' and active) then raise exception 'INVALID_OPTION'; end if;
    total_qty := total_qty + item_qty;
  end loop;
  if total_qty < 1 or total_qty > 5 then raise exception 'INVALID_QUANTITY'; end if;
  total_price := total_qty * product.unit_price;

  loop
    number := private.order_number();
    exit when not exists(select 1 from public.orders where order_number = number);
  end loop;

  insert into public.orders (
    sale_id, reservation_id, idempotency_key, order_number, customer_name,
    phone_ciphertext, phone_normalized_hash, phone_last4_hash, email_ciphertext,
    email_normalized_hash, depositor_name, address_ciphertext, total_quantity,
    total_amount, payment_due_at, bank_snapshot
  ) values (
    sale.id, reservation.id, p_idempotency_key, number, p_payload->>'customerName',
    p_payload->>'phoneCiphertext', p_phone_hash, p_phone_last4_hash, p_payload->>'emailCiphertext',
    p_email_hash, p_payload->>'depositorName', p_payload->>'addressCiphertext', total_qty,
    total_price, now() + interval '24 hours',
    jsonb_build_object('bankName', sale.bank_name, 'accountCiphertext', sale.bank_account_ciphertext, 'holder', sale.bank_holder)
  ) returning * into created;

  for item in select value from jsonb_array_elements(p_payload->'items') loop
    item_qty := (item->>'quantity')::integer;
    insert into public.order_items (order_id, product_id, product_name, unit_price, color, size, quantity, line_amount)
    values (created.id, product.id, product.name, product.unit_price, item->>'color', item->>'size', item_qty, product.unit_price * item_qty);
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

create or replace function public.update_customer_order(
  p_order_id uuid,
  p_address_ciphertext text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  product public.products%rowtype;
  item jsonb;
  item_qty integer;
  total_qty integer := 0;
  total_price integer;
begin
  select * into target from public.orders where id = p_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.order_state not in ('payment_pending', 'payment_confirmed') then raise exception 'ORDER_NOT_EDITABLE'; end if;
  select * into product from public.products where sale_id = target.sale_id and active order by created_at limit 1;
  for item in select value from jsonb_array_elements(p_items) loop
    item_qty := (item->>'quantity')::integer;
    if item_qty < 1 then raise exception 'INVALID_QUANTITY'; end if;
    if not exists(select 1 from public.product_options where product_id = product.id and option_type = 'color' and value = item->>'color' and active) then raise exception 'INVALID_OPTION'; end if;
    if not exists(select 1 from public.product_options where product_id = product.id and option_type = 'size' and value = item->>'size' and active) then raise exception 'INVALID_OPTION'; end if;
    total_qty := total_qty + item_qty;
  end loop;
  if total_qty < 1 or total_qty > 5 then raise exception 'INVALID_QUANTITY'; end if;
  total_price := total_qty * product.unit_price;

  delete from public.order_items where order_id = target.id;
  for item in select value from jsonb_array_elements(p_items) loop
    item_qty := (item->>'quantity')::integer;
    insert into public.order_items (order_id, product_id, product_name, unit_price, color, size, quantity, line_amount)
    values (target.id, product.id, product.name, product.unit_price, item->>'color', item->>'size', item_qty, product.unit_price * item_qty);
  end loop;
  update public.orders
  set address_ciphertext = p_address_ciphertext,
      total_quantity = total_qty,
      total_amount = total_price,
      payment_state = case when payment_state = 'paid' and total_amount <> total_price then 'review_required' else payment_state end,
      payment_review_reason = case when payment_state = 'paid' and total_amount <> total_price then '주문 수정으로 결제 금액 변경' else payment_review_reason end
  where id = target.id;
  return jsonb_build_object('totalQuantity', total_qty, 'totalAmount', total_price);
end;
$$;

create or replace function public.check_rate_limit(p_scope text, p_key_hash text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_count integer;
begin
  select count(*) into event_count from public.rate_limit_events
  where scope = p_scope and key_hash = p_key_hash and created_at > now() - make_interval(secs => p_window_seconds);
  if event_count >= p_limit then return false; end if;
  insert into public.rate_limit_events (scope, key_hash) values (p_scope, p_key_hash);
  return true;
end;
$$;

create or replace function public.cancel_overdue_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancelled_count integer;
begin
  with targets as (
    update public.orders
    set order_state = 'cancelled', cancellation_reason = '입금 기한 만료', cancelled_at = now()
    where order_state = 'payment_pending' and payment_state = 'pending' and payment_due_at <= now()
    returning *
  ), queued as (
    insert into public.email_outbox (order_id, event_type, dedupe_key, recipient_ciphertext, payload_json)
    select id, 'order_cancelled', id || ':auto_cancelled', email_ciphertext,
      jsonb_build_object('orderNumber', order_number, 'reason', '입금 기한 만료')
    from targets on conflict (dedupe_key) do nothing
  )
  select count(*) into cancelled_count from targets;
  delete from public.rate_limit_events where created_at < now() - interval '1 day';
  return cancelled_count;
end;
$$;

alter table public.sales enable row level security;
alter table public.products enable row level security;
alter table public.product_options enable row level security;
alter table public.reservations enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.shipments enable row level security;
alter table public.email_outbox enable row level security;
alter table public.admin_users enable row level security;
alter table public.rate_limit_events enable row level security;

create policy admin_read_sales on public.sales for select to authenticated using (private.is_admin());
create policy admin_all_products on public.products for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all_options on public.product_options for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_read_orders on public.orders for select to authenticated using (private.is_admin());
create policy admin_read_items on public.order_items for select to authenticated using (private.is_admin());
create policy admin_read_shipments on public.shipments for select to authenticated using (private.is_admin());
create policy admin_read_outbox on public.email_outbox for select to authenticated using (private.is_admin());
create policy admin_self on public.admin_users for select to authenticated using (user_id = (select auth.uid()));

revoke all on all tables in schema public from anon, authenticated;
grant select on public.sales, public.products, public.product_options, public.orders, public.order_items, public.shipments, public.email_outbox, public.admin_users to authenticated;
grant all on public.products, public.product_options to authenticated;

revoke all on function public.get_sale_status() from public;
revoke all on function public.claim_reservation(text) from public;
revoke all on function public.heartbeat_reservation(text) from public;
revoke all on function public.release_reservation(text) from public;
revoke all on function public.submit_order(text,text,jsonb,text,text,text) from public;
revoke all on function public.update_customer_order(uuid,text,jsonb) from public;
revoke all on function public.check_rate_limit(text,text,integer,integer) from public;
revoke all on function public.cancel_overdue_orders() from public;

grant execute on function public.get_sale_status() to anon, authenticated, service_role;
grant execute on function public.claim_reservation(text) to service_role;
grant execute on function public.heartbeat_reservation(text) to service_role;
grant execute on function public.release_reservation(text) to service_role;
grant execute on function public.submit_order(text,text,jsonb,text,text,text) to service_role;
grant execute on function public.update_customer_order(uuid,text,jsonb) to service_role;
grant execute on function public.check_rate_limit(text,text,integer,integer) to service_role;
grant execute on function public.cancel_overdue_orders() to service_role;

select cron.schedule('booth-booth-cancel-overdue', '* * * * *', $$select public.cancel_overdue_orders();$$)
where not exists (select 1 from cron.job where jobname = 'booth-booth-cancel-overdue');
