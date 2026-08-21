alter table public.email_outbox add column if not exists processing_started_at timestamptz;

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
  if p_payment_state = 'review_required' and nullif(trim(p_payment_review_reason), '') is null then
    raise exception 'PAYMENT_REVIEW_REASON_REQUIRED';
  end if;
  if p_order_state = 'cancelled' and nullif(trim(p_cancellation_reason), '') is null then
    raise exception 'CANCELLATION_REASON_REQUIRED';
  end if;

  update public.orders
  set order_state = p_order_state,
      payment_state = p_payment_state,
      payment_review_reason = case when p_payment_state = 'review_required' then trim(p_payment_review_reason) else null end,
      cancellation_reason = case when p_order_state = 'cancelled' then trim(p_cancellation_reason) else null end,
      cancelled_at = case
        when p_order_state = 'cancelled' and previous.order_state <> 'cancelled' then now()
        when p_order_state <> 'cancelled' then null
        else cancelled_at
      end,
      payment_due_at = case
        when previous.order_state = 'cancelled' and p_order_state = 'payment_pending' and p_payment_state = 'pending' then now() + interval '24 hours'
        else payment_due_at
      end
  where id = p_order_id
  returning * into updated;

  if nullif(trim(p_carrier_name), '') is not null or nullif(trim(p_tracking_number), '') is not null then
    insert into public.shipments (order_id, carrier_code, carrier_name, tracking_number, shipped_at, completed_at)
    values (
      p_order_id,
      nullif(trim(p_carrier_code), ''),
      nullif(trim(p_carrier_name), ''),
      nullif(trim(p_tracking_number), ''),
      case when nullif(trim(p_tracking_number), '') is not null then now() else null end,
      case when p_order_state = 'completed' then now() else null end
    )
    on conflict (order_id) do update
    set carrier_code = excluded.carrier_code,
        carrier_name = excluded.carrier_name,
        tracking_number = excluded.tracking_number,
        shipped_at = case
          when excluded.tracking_number is not null then coalesce(public.shipments.shipped_at, now())
          else public.shipments.shipped_at
        end,
        completed_at = case when p_order_state = 'completed' then coalesce(public.shipments.completed_at, now()) else null end
    returning * into shipment;
  elsif p_order_state = 'completed' then
    update public.shipments set completed_at = coalesce(completed_at, now()) where order_id = p_order_id returning * into shipment;
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

  if nullif(trim(p_tracking_number), '') is not null
    and (coalesce(shipment.tracking_number, '') <> '' or p_order_state = 'preparing')
    and (previous.order_state <> 'preparing' or not exists (
      select 1 from public.email_outbox where order_id = updated.id and event_type = 'shipment_started' and state in ('pending', 'processing', 'sent')
    )) then
    insert into public.email_outbox (order_id, event_type, dedupe_key, recipient_ciphertext, payload_json)
    values (updated.id, 'shipment_started', updated.id || ':shipment_started:' || gen_random_uuid(), updated.email_ciphertext,
      jsonb_build_object('orderNumber', updated.order_number, 'carrierName', shipment.carrier_name, 'trackingNumber', shipment.tracking_number));
  end if;

  if p_order_state = 'completed' and previous.order_state <> 'completed' then
    insert into public.email_outbox (order_id, event_type, dedupe_key, recipient_ciphertext, payload_json)
    values (updated.id, 'delivery_completed', updated.id || ':delivery_completed:' || gen_random_uuid(), updated.email_ciphertext,
      jsonb_build_object('orderNumber', updated.order_number));
  end if;

  return jsonb_build_object('orderId', updated.id, 'orderNumber', updated.order_number);
end;
$$;

create or replace function public.admin_update_order_info(
  p_order_id uuid,
  p_customer_name text,
  p_phone_ciphertext text,
  p_phone_hash text,
  p_phone_last4_hash text,
  p_email_ciphertext text,
  p_email_hash text,
  p_depositor_name text,
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
  select * into product from public.products where sale_id = target.sale_id and active order by created_at limit 1;
  if product.id is null then raise exception 'PRODUCT_UNAVAILABLE'; end if;

  for item in select value from jsonb_array_elements(p_items) loop
    item_qty := (item->>'quantity')::integer;
    if item_qty < 1 then raise exception 'INVALID_QUANTITY'; end if;
    if not exists(select 1 from public.product_options where product_id = product.id and option_type = 'color' and value = item->>'color' and active) then raise exception 'INVALID_OPTION'; end if;
    if not exists(select 1 from public.product_options where product_id = product.id and option_type = 'size' and value = item->>'size' and active) then raise exception 'INVALID_OPTION'; end if;
    total_qty := total_qty + item_qty;
  end loop;
  if total_qty < 1 or total_qty > 5 then raise exception 'INVALID_QUANTITY'; end if;
  total_price := total_qty * product.unit_price;

  update public.orders
  set customer_name = trim(p_customer_name), phone_ciphertext = p_phone_ciphertext,
      phone_normalized_hash = p_phone_hash, phone_last4_hash = p_phone_last4_hash,
      email_ciphertext = p_email_ciphertext, email_normalized_hash = p_email_hash,
      depositor_name = trim(p_depositor_name), address_ciphertext = p_address_ciphertext,
      total_quantity = total_qty, total_amount = total_price,
      payment_state = case when payment_state = 'paid' and total_amount <> total_price then 'review_required' else payment_state end,
      payment_review_reason = case when payment_state = 'paid' and total_amount <> total_price then '관리자 주문 수정으로 결제 금액 변경' else payment_review_reason end
  where id = target.id;

  delete from public.order_items where order_id = target.id;
  for item in select value from jsonb_array_elements(p_items) loop
    item_qty := (item->>'quantity')::integer;
    insert into public.order_items (order_id, product_id, product_name, unit_price, color, size, quantity, line_amount)
    values (target.id, product.id, product.name, product.unit_price, item->>'color', item->>'size', item_qty, product.unit_price * item_qty);
  end loop;
  update public.email_outbox set recipient_ciphertext = p_email_ciphertext where order_id = target.id and state in ('pending', 'failed');
  return jsonb_build_object('orderId', target.id, 'totalQuantity', total_qty, 'totalAmount', total_price);
exception
  when unique_violation then raise exception 'DUPLICATE_ORDER';
end;
$$;

create or replace function public.claim_email_jobs(p_limit integer default 20)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with jobs as (
    select id
    from public.email_outbox
    where (state in ('pending', 'failed') or (state = 'processing' and processing_started_at < now() - interval '10 minutes'))
      and next_attempt_at <= now()
      and attempt_count < 5
    order by created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 50)
  )
  update public.email_outbox outbox
  set state = 'processing', attempt_count = attempt_count + 1, last_error = null, processing_started_at = now()
  from jobs
  where outbox.id = jobs.id
  returning outbox.*;
end;
$$;

create or replace function public.admin_update_settings(
  p_sale_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_order_limit integer,
  p_manually_closed boolean,
  p_bank_name text,
  p_bank_account_ciphertext text,
  p_bank_holder text,
  p_kakao_channel_url text,
  p_shipping_notice text,
  p_product_id uuid,
  p_product_name text,
  p_unit_price integer,
  p_colors text[],
  p_sizes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  occupied_count integer;
begin
  if p_starts_at >= p_ends_at then raise exception 'INVALID_SALE_PERIOD'; end if;
  if p_order_limit < 1 then raise exception 'INVALID_ORDER_LIMIT'; end if;
  if p_unit_price < 0 then raise exception 'INVALID_PRICE'; end if;
  if coalesce(array_length(p_colors, 1), 0) < 1 or coalesce(array_length(p_sizes, 1), 0) < 1 then
    raise exception 'OPTIONS_REQUIRED';
  end if;
  perform 1 from public.sales where id = p_sale_id for update;
  perform private.expire_reservations(p_sale_id);
  select
    (select count(*) from public.orders where sale_id = p_sale_id and order_state <> 'cancelled') +
    (select count(*) from public.reservations where sale_id = p_sale_id and state = 'active' and hard_expires_at > now() and lease_expires_at > now())
  into occupied_count;
  if p_order_limit < occupied_count then raise exception 'ORDER_LIMIT_BELOW_OCCUPIED'; end if;

  update public.sales
  set title = trim(p_title), starts_at = p_starts_at, ends_at = p_ends_at,
      order_limit = p_order_limit, manually_closed = p_manually_closed,
      bank_name = trim(p_bank_name),
      bank_account_ciphertext = coalesce(nullif(p_bank_account_ciphertext, ''), bank_account_ciphertext),
      bank_holder = trim(p_bank_holder), kakao_channel_url = trim(p_kakao_channel_url),
      shipping_notice = trim(p_shipping_notice)
  where id = p_sale_id;

  update public.products set name = trim(p_product_name), unit_price = p_unit_price where id = p_product_id and sale_id = p_sale_id;
  delete from public.product_options where product_id = p_product_id;
  insert into public.product_options (product_id, option_type, value, sort_order)
  select p_product_id, 'color', trim(value), ordinal::integer
  from unnest(p_colors) with ordinality as option(value, ordinal)
  where trim(value) <> '';
  insert into public.product_options (product_id, option_type, value, sort_order)
  select p_product_id, 'size', trim(value), ordinal::integer
  from unnest(p_sizes) with ordinality as option(value, ordinal)
  where trim(value) <> '';
end;
$$;

create or replace function public.admin_requeue_email(p_order_id uuid, p_event_type text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  shipment public.shipments%rowtype;
  created_id uuid;
  payload jsonb;
begin
  if p_event_type not in ('order_received', 'payment_confirmed', 'order_cancelled', 'shipment_started', 'delivery_completed') then
    raise exception 'INVALID_EMAIL_EVENT';
  end if;
  select * into target from public.orders where id = p_order_id;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  select * into shipment from public.shipments where order_id = target.id;
  if p_event_type = 'shipment_started' and (shipment.order_id is null or shipment.tracking_number is null) then
    raise exception 'SHIPMENT_REQUIRED';
  end if;
  payload := case p_event_type
    when 'order_received' then jsonb_build_object('orderNumber', target.order_number, 'totalAmount', target.total_amount, 'paymentDueAt', target.payment_due_at)
    when 'payment_confirmed' then jsonb_build_object('orderNumber', target.order_number, 'totalAmount', target.total_amount)
    when 'order_cancelled' then jsonb_build_object('orderNumber', target.order_number, 'reason', coalesce(target.cancellation_reason, '관리자 취소'))
    when 'shipment_started' then jsonb_build_object('orderNumber', target.order_number, 'carrierName', shipment.carrier_name, 'trackingNumber', shipment.tracking_number)
    else jsonb_build_object('orderNumber', target.order_number)
  end;
  insert into public.email_outbox (order_id, event_type, dedupe_key, recipient_ciphertext, payload_json)
  values (target.id, p_event_type, target.id || ':manual:' || p_event_type || ':' || gen_random_uuid(), target.email_ciphertext, payload)
  returning id into created_id;
  return created_id;
end;
$$;

create or replace function public.mark_email_sent(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.email_outbox set state = 'sent', sent_at = now(), last_error = null, processing_started_at = null where id = p_id and state = 'processing';
$$;

create or replace function public.mark_email_failed(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.email_outbox
  set state = 'failed', last_error = left(p_error, 1000), processing_started_at = null,
      next_attempt_at = now() + make_interval(mins => least(60, power(2, attempt_count)::integer))
  where id = p_id and state = 'processing';
$$;

revoke all on function public.admin_update_order(uuid,public.order_state,public.payment_state,text,text,text,text,text) from public;
revoke all on function public.admin_update_order_info(uuid,text,text,text,text,text,text,text,text,jsonb) from public;
revoke all on function public.claim_email_jobs(integer) from public;
revoke all on function public.admin_update_settings(uuid,text,timestamptz,timestamptz,integer,boolean,text,text,text,text,text,uuid,text,integer,text[],text[]) from public;
revoke all on function public.admin_requeue_email(uuid,text) from public;
revoke all on function public.mark_email_sent(uuid) from public;
revoke all on function public.mark_email_failed(uuid,text) from public;

grant execute on function public.admin_update_order(uuid,public.order_state,public.payment_state,text,text,text,text,text) to service_role;
grant execute on function public.admin_update_order_info(uuid,text,text,text,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.claim_email_jobs(integer) to service_role;
grant execute on function public.admin_update_settings(uuid,text,timestamptz,timestamptz,integer,boolean,text,text,text,text,text,uuid,text,integer,text[],text[]) to service_role;
grant execute on function public.admin_requeue_email(uuid,text) to service_role;
grant execute on function public.mark_email_sent(uuid) to service_role;
grant execute on function public.mark_email_failed(uuid,text) to service_role;
