create or replace function public.admin_bulk_update_order_state_v1(
  p_order_ids uuid[],
  p_order_state public.order_state
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_count integer := coalesce(cardinality(p_order_ids), 0);
  found_count integer;
  changed_count integer;
begin
  if requested_count < 1 or requested_count > 1000 then
    raise exception 'INVALID_BULK_ORDER_COUNT';
  end if;

  if (select count(distinct selected.order_id) from unnest(p_order_ids) as selected(order_id)) <> requested_count then
    raise exception 'DUPLICATE_ORDER_IDS';
  end if;

  perform 1
  from public.orders
  where id = any(p_order_ids)
  order by id
  for update;

  select count(*) into found_count
  from public.orders
  where id = any(p_order_ids);

  if found_count <> requested_count then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if p_order_state = 'completed' and exists (
    select 1
    from public.orders as customer_order
    left join public.shipments as shipment on shipment.order_id = customer_order.id
    where customer_order.id = any(p_order_ids)
      and customer_order.order_state <> 'completed'
      and customer_order.fulfillment_type = 'shipping'
      and nullif(trim(shipment.tracking_number), '') is null
  ) then
    raise exception 'BULK_TRACKING_REQUIRED';
  end if;

  update public.orders
  set order_state = p_order_state,
      payment_state = case
        when p_order_state in ('payment_pending', 'cancelled') then 'pending'::public.payment_state
        else 'paid'::public.payment_state
      end,
      payment_review_reason = null,
      cancellation_reason = case when p_order_state = 'cancelled' then '미입금 취소' else null end,
      cancelled_at = case
        when p_order_state = 'cancelled' and order_state <> 'cancelled' then now()
        when p_order_state <> 'cancelled' then null
        else cancelled_at
      end,
      payment_due_at = case
        when order_state = 'cancelled' and p_order_state = 'payment_pending' then now() + interval '1 hour'
        else payment_due_at
      end
  where id = any(p_order_ids)
    and order_state <> p_order_state;
  get diagnostics changed_count = row_count;

  if p_order_state = 'completed' then
    update public.shipments
    set completed_at = coalesce(completed_at, now())
    where order_id = any(p_order_ids);
  else
    update public.shipments
    set completed_at = null
    where order_id = any(p_order_ids)
      and completed_at is not null;
  end if;

  return jsonb_build_object(
    'selectedCount', requested_count,
    'changedCount', changed_count,
    'unchangedCount', requested_count - changed_count,
    'orderState', p_order_state
  );
end;
$$;

revoke all on function public.admin_bulk_update_order_state_v1(uuid[],public.order_state) from public;
grant execute on function public.admin_bulk_update_order_state_v1(uuid[],public.order_state) to service_role;
