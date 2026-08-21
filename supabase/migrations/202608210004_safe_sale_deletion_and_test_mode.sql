-- Safe round deletion and operator-managed test rounds.

alter table public.sales
  add column if not exists sale_kind text not null default 'live';

alter table public.sales drop constraint if exists sales_sale_kind_check;
alter table public.sales add constraint sales_sale_kind_check
  check (sale_kind in ('live', 'test'));

create index if not exists sales_kind_round_idx
  on public.sales (sale_kind, round_number desc);

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
    and sale.sale_kind = 'live'
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

create or replace function private.prevent_test_sale_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sale_kind = 'test' and new.publication_status = 'published' then
    raise exception 'TEST_SALE_CANNOT_BE_PUBLISHED';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_test_sale_publication on public.sales;
create trigger prevent_test_sale_publication
before insert or update of sale_kind, publication_status on public.sales
for each row execute function private.prevent_test_sale_publication();

create or replace function public.get_test_sale_status(p_sale_id uuid)
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
  where id = p_sale_id and sale_kind = 'test';

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
    when sale.publication_status <> 'draft' then 'ended'
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

create or replace function public.claim_test_reservation(p_token_hash text, p_sale_id uuid)
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
  where id = p_sale_id and sale_kind = 'test'
  for update;

  if sale.id is null then raise exception 'TEST_SALE_NOT_FOUND'; end if;
  if sale.publication_status <> 'draft' or sale.manually_closed then raise exception 'SALE_PAUSED'; end if;
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
  created_product_id uuid;
begin
  select * into source_sale from public.sales where id = p_source_sale_id;
  if source_sale.id is null then raise exception 'SOURCE_SALE_NOT_FOUND'; end if;
  if p_round_number < 1 then raise exception 'INVALID_ROUND_NUMBER'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'TITLE_REQUIRED'; end if;
  if p_starts_at >= p_ends_at then raise exception 'INVALID_SALE_WINDOW'; end if;
  if p_sale_kind not in ('live', 'test') then raise exception 'INVALID_SALE_KIND'; end if;

  insert into public.sales (
    round_number, title, starts_at, ends_at, order_limit, manually_closed,
    bank_name, bank_account_ciphertext, bank_holder, kakao_channel_url, shipping_notice,
    shipping_fee, free_shipping_threshold, pickup_name, pickup_address, pickup_notice,
    publication_status, internal_note, sale_kind
  ) values (
    p_round_number, trim(p_title), p_starts_at, p_ends_at, source_sale.order_limit, false,
    source_sale.bank_name, source_sale.bank_account_ciphertext, source_sale.bank_holder,
    source_sale.kakao_channel_url, source_sale.shipping_notice,
    source_sale.shipping_fee, source_sale.free_shipping_threshold,
    source_sale.pickup_name, source_sale.pickup_address, source_sale.pickup_notice,
    'draft', coalesce(p_internal_note, ''), p_sale_kind
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

create or replace function private.sale_storage_paths(p_sale_id uuid)
returns table(storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct paths.storage_path
  from (
    select upload.storage_path
    from public.order_image_uploads as upload
    where upload.reservation_id in (select reservation.id from public.reservations as reservation where reservation.sale_id = p_sale_id)
       or upload.order_id in (select customer_order.id from public.orders as customer_order where customer_order.sale_id = p_sale_id)
    union
    select image.storage_path
    from public.order_item_images as image
    join public.order_items as item on item.id = image.order_item_id
    join public.orders as customer_order on customer_order.id = item.order_id
    where customer_order.sale_id = p_sale_id
  ) as paths;
$$;

create or replace function public.admin_prepare_sale_deletion(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.sales%rowtype;
  paths jsonb;
begin
  select * into target from public.sales where id = p_sale_id for update;
  if target.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  if target.publication_status <> 'draft' then raise exception 'SALE_MUST_BE_DRAFT'; end if;
  if exists(select 1 from public.orders where sale_id = target.id) then raise exception 'SALE_HAS_ORDERS'; end if;
  if (select count(*) from public.sales) <= 1 then raise exception 'LAST_SALE_CANNOT_BE_DELETED'; end if;

  update public.sales set manually_closed = true where id = target.id;
  update public.reservations
  set state = 'released',
      hard_expires_at = least(hard_expires_at, now()),
      lease_expires_at = least(lease_expires_at, now())
  where sale_id = target.id and state = 'active';
  select coalesce(jsonb_agg(path.storage_path), '[]'::jsonb) into paths
  from private.sale_storage_paths(target.id) as path;

  return jsonb_build_object(
    'saleId', target.id,
    'storagePaths', paths,
    'reservationCount', (select count(*) from public.reservations where sale_id = target.id),
    'imageCount', jsonb_array_length(paths)
  );
end;
$$;

create or replace function public.admin_sale_deletion_summary(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.sales%rowtype;
  path_count integer;
begin
  select * into target from public.sales where id = p_sale_id;
  if target.id is null then return null; end if;
  select count(*) into path_count from private.sale_storage_paths(target.id);
  return jsonb_build_object(
    'orderCount', (select count(*) from public.orders where sale_id = target.id),
    'reservationCount', (select count(*) from public.reservations where sale_id = target.id),
    'productCount', (select count(*) from public.products where sale_id = target.id),
    'pickupCount', (select count(*) from public.pickup_slots where sale_id = target.id),
    'imageCount', path_count,
    'saleCount', (select count(*) from public.sales)
  );
end;
$$;

create or replace function public.admin_delete_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.sales%rowtype;
begin
  select * into target from public.sales where id = p_sale_id for update;
  if target.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  if target.publication_status <> 'draft' then raise exception 'SALE_MUST_BE_DRAFT'; end if;
  if exists(select 1 from public.orders where sale_id = target.id) then raise exception 'SALE_HAS_ORDERS'; end if;
  if (select count(*) from public.sales) <= 1 then raise exception 'LAST_SALE_CANNOT_BE_DELETED'; end if;

  delete from public.sales where id = target.id;
end;
$$;

create or replace function public.admin_prepare_test_sale_reset(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.sales%rowtype;
  paths jsonb;
begin
  select * into target from public.sales where id = p_sale_id for update;
  if target.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  if target.sale_kind <> 'test' then raise exception 'TEST_SALE_REQUIRED'; end if;
  if target.publication_status = 'published' then raise exception 'PUBLISHED_SALE_CANNOT_BE_RESET'; end if;

  update public.sales set manually_closed = true where id = target.id;
  update public.reservations
  set state = 'released',
      hard_expires_at = least(hard_expires_at, now()),
      lease_expires_at = least(lease_expires_at, now())
  where sale_id = target.id and state = 'active';
  select coalesce(jsonb_agg(path.storage_path), '[]'::jsonb) into paths
  from private.sale_storage_paths(target.id) as path;

  return jsonb_build_object(
    'saleId', target.id,
    'storagePaths', paths,
    'orderCount', (select count(*) from public.orders where sale_id = target.id),
    'reservationCount', (select count(*) from public.reservations where sale_id = target.id),
    'imageCount', jsonb_array_length(paths)
  );
end;
$$;

create or replace function public.admin_reset_test_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.sales%rowtype;
begin
  select * into target from public.sales where id = p_sale_id for update;
  if target.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  if target.sale_kind <> 'test' then raise exception 'TEST_SALE_REQUIRED'; end if;
  if target.publication_status = 'published' then raise exception 'PUBLISHED_SALE_CANNOT_BE_RESET'; end if;

  update public.sales set manually_closed = true where id = target.id;
  update public.reservations set converted_order_id = null where sale_id = target.id;
  delete from public.orders where sale_id = target.id;
  delete from public.reservations where sale_id = target.id;
end;
$$;

create or replace function private.suppress_test_sale_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_id is not null and exists(
    select 1
    from public.orders as customer_order
    join public.sales as sale on sale.id = customer_order.sale_id
    where customer_order.id = new.order_id and sale.sale_kind = 'test'
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists suppress_test_sale_email on public.email_outbox;
create trigger suppress_test_sale_email
before insert on public.email_outbox
for each row execute function private.suppress_test_sale_email();

revoke all on function public.get_test_sale_status(uuid) from public;
revoke all on function public.claim_test_reservation(text,uuid) from public;
revoke all on function public.admin_clone_sale_v2(uuid,integer,text,timestamptz,timestamptz,text,text) from public;
revoke all on function public.admin_prepare_sale_deletion(uuid) from public;
revoke all on function public.admin_sale_deletion_summary(uuid) from public;
revoke all on function public.admin_delete_sale(uuid) from public;
revoke all on function public.admin_prepare_test_sale_reset(uuid) from public;
revoke all on function public.admin_reset_test_sale(uuid) from public;
revoke all on function private.sale_storage_paths(uuid) from public;

grant execute on function public.get_test_sale_status(uuid) to service_role;
grant execute on function public.claim_test_reservation(text,uuid) to service_role;
grant execute on function public.admin_clone_sale_v2(uuid,integer,text,timestamptz,timestamptz,text,text) to service_role;
grant execute on function public.admin_prepare_sale_deletion(uuid) to service_role;
grant execute on function public.admin_sale_deletion_summary(uuid) to service_role;
grant execute on function public.admin_delete_sale(uuid) to service_role;
grant execute on function public.admin_prepare_test_sale_reset(uuid) to service_role;
grant execute on function public.admin_reset_test_sale(uuid) to service_role;

-- The application server uses the service role for trusted admin and order workflows.
-- Keep its table privileges explicit so fresh local and hosted projects behave the same.
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
