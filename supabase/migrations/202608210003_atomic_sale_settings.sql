-- Keep operator-managed sale settings atomic: every section saves together or no section changes.

create or replace function public.admin_update_sale_settings(p_sale_id uuid, p_config jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.sales%rowtype;
  shirt public.products%rowtype;
  bag public.products%rowtype;
  submitted integer;
  reserved integer;
  occupied integer;
  requested_limit integer := (p_config->>'orderLimit')::integer;
  option_row jsonb;
  slot_row jsonb;
begin
  select * into target from public.sales where id = p_sale_id for update;
  if target.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  perform private.expire_reservations(target.id);

  select count(*) into submitted
  from public.orders
  where sale_id = target.id and order_state <> 'cancelled';
  select count(*) into reserved
  from public.reservations
  where sale_id = target.id and state = 'active' and hard_expires_at > now() and lease_expires_at > now();
  occupied := submitted + reserved;
  if requested_limit < occupied then raise exception 'ORDER_LIMIT_BELOW_OCCUPIED'; end if;
  if target.publication_status = 'published' and jsonb_array_length(p_config->'pickupSlots') = 0 then
    raise exception 'ACTIVE_PICKUP_SLOT_REQUIRED';
  end if;
  if target.publication_status = 'published' and exists(
    select 1 from public.sales as other
    where other.id <> target.id
      and other.publication_status = 'published'
      and other.starts_at < (p_config->>'endsAt')::timestamptz
      and other.ends_at > (p_config->>'startsAt')::timestamptz
  ) then
    raise exception 'PUBLISHED_SALE_WINDOW_OVERLAP';
  end if;

  update public.sales set
    title = trim(p_config->>'title'),
    starts_at = (p_config->>'startsAt')::timestamptz,
    ends_at = (p_config->>'endsAt')::timestamptz,
    order_limit = requested_limit,
    manually_closed = (p_config->>'manuallyClosed')::boolean,
    bank_name = trim(p_config->>'bankName'),
    bank_account_ciphertext = coalesce(nullif(p_config->>'bankAccountCiphertext', ''), target.bank_account_ciphertext),
    bank_holder = trim(p_config->>'bankHolder'),
    kakao_channel_url = trim(p_config->>'kakaoChannelUrl'),
    shipping_notice = coalesce(p_config->>'shippingNotice', ''),
    shipping_fee = (p_config->>'shippingFee')::integer,
    free_shipping_threshold = (p_config->>'freeShippingThreshold')::integer,
    pickup_name = trim(p_config->>'pickupName'),
    pickup_address = coalesce(p_config->>'pickupAddress', ''),
    pickup_notice = coalesce(p_config->>'pickupNotice', ''),
    internal_note = coalesce(p_config->>'internalNote', '')
  where id = target.id;

  select * into shirt from public.products where sale_id = target.id and item_type = 'shirt' for update;
  select * into bag from public.products where sale_id = target.id and item_type = 'bag' for update;
  if shirt.id is null or bag.id is null then raise exception 'PRODUCTS_NOT_CONFIGURED'; end if;

  update public.products
  set name = trim(p_config->'shirt'->>'name'), unit_price = (p_config->'shirt'->>'unitPrice')::integer
  where id = shirt.id;
  update public.products
  set name = trim(p_config->'bag'->>'name'), unit_price = (p_config->'bag'->>'unitPrice')::integer
  where id = bag.id;

  delete from public.product_options where product_id = shirt.id;
  for option_row in select value from jsonb_array_elements(p_config->'sizes') loop
    insert into public.product_options (product_id, option_type, value, sort_order, price_delta)
    values (
      shirt.id,
      'size',
      trim(option_row->>'value'),
      (option_row->>'sortOrder')::integer,
      (option_row->>'priceDelta')::integer
    );
  end loop;
  for option_row in select value from jsonb_array_elements(p_config->'genders') loop
    insert into public.product_options (product_id, option_type, value, sort_order, price_delta)
    values (shirt.id, 'gender', trim(option_row->>'value'), (option_row->>'sortOrder')::integer, 0);
  end loop;

  delete from public.pickup_slots where sale_id = target.id;
  for slot_row in select value from jsonb_array_elements(p_config->'pickupSlots') loop
    insert into public.pickup_slots (sale_id, pickup_date, starts_at, ends_at)
    values (
      target.id,
      (slot_row->>'pickupDate')::date,
      (slot_row->>'startsAt')::time,
      (slot_row->>'endsAt')::time
    );
  end loop;
end;
$$;

revoke all on function public.admin_update_sale_settings(uuid,jsonb) from public;
grant execute on function public.admin_update_sale_settings(uuid,jsonb) to service_role;
