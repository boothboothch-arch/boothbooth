create table if not exists public.order_item_change_logs (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  admin_user_id uuid references auth.users(id) on delete set null,
  before_data jsonb not null,
  after_data jsonb not null,
  order_total_before integer not null check (order_total_before >= 0),
  order_total_after integer not null check (order_total_after >= 0),
  created_at timestamptz not null default now()
);

create index if not exists order_item_change_logs_order_idx
  on public.order_item_change_logs (order_id, created_at desc);

alter table public.order_item_change_logs enable row level security;
revoke all on public.order_item_change_logs from anon, authenticated;
grant select on public.order_item_change_logs to authenticated;

create policy admin_read_order_item_change_logs
  on public.order_item_change_logs
  for select
  to authenticated
  using (private.is_admin());

create or replace function public.admin_update_order_item_v1(
  p_order_id uuid,
  p_order_item_id uuid,
  p_payload jsonb,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order public.orders%rowtype;
  target_item public.order_items%rowtype;
  target_product public.products%rowtype;
  target_sale public.sales%rowtype;
  selected_value_ids jsonb;
  current_value_ids jsonb;
  option_result jsonb;
  new_surcharge integer;
  new_subtotal integer;
  new_base_shipping_fee integer := 0;
  new_remote_surcharge integer := 0;
  new_shipping_fee integer := 0;
  new_total integer;
  before_data jsonb;
  after_data jsonb;
  initial_text_value text := trim(coalesce(p_payload->>'initialText', ''));
  sticker_selected_value boolean := coalesce((p_payload->>'stickerSelected')::boolean, false);
begin
  select * into target_order from public.orders where id = p_order_id for update;
  if target_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target_order.order_state not in ('payment_pending', 'payment_confirmed', 'preparing') then
    raise exception 'ORDER_ITEM_NOT_EDITABLE';
  end if;

  select * into target_item
  from public.order_items
  where id = p_order_item_id and order_id = target_order.id
  for update;
  if target_item.id is null then raise exception 'ORDER_ITEM_NOT_FOUND'; end if;

  select * into target_product from public.products where id = target_item.product_id;
  if target_product.id is null or target_product.sale_id <> target_order.sale_id then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  select * into target_sale from public.sales where id = target_order.sale_id;

  if coalesce((target_product.customization_config->>'initialEnabled')::boolean, true) and (
    nullif(initial_text_value, '') is null
    or initial_text_value !~ '^[A-Za-z ]+$'
    or length(replace(initial_text_value, ' ', '')) > 20
  ) then raise exception 'INVALID_INITIAL'; end if;
  if length(coalesce(p_payload->>'stickerCategories', '')) > 200 then raise exception 'INVALID_STICKER_CATEGORIES'; end if;
  if length(coalesce(p_payload->>'extraRequest', '')) > 300 then raise exception 'INVALID_EXTRA_REQUEST'; end if;

  select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
  into selected_value_ids
  from jsonb_array_elements_text(case
    when jsonb_typeof(p_payload->'selectedOptionValueIds') = 'array' then p_payload->'selectedOptionValueIds'
    else '[]'::jsonb
  end) as selected(value);

  select coalesce(jsonb_agg(option->>'valueId' order by option->>'valueId'), '[]'::jsonb)
  into current_value_ids
  from jsonb_array_elements(coalesce(target_item.selected_options, '[]'::jsonb)) as option;

  -- 상품 관리에서 과거 주문의 옵션이 비활성화된 경우에도, 옵션 자체를
  -- 변경하지 않는 제작 정보 수정은 기존 스냅샷과 금액을 그대로 유지한다.
  if selected_value_ids = current_value_ids then
    option_result := jsonb_build_object(
      'surcharge', target_item.option_surcharge,
      'snapshot', target_item.selected_options
    );
  else
    option_result := private.resolve_product_options(target_product, selected_value_ids);
  end if;
  new_surcharge := (option_result->>'surcharge')::integer;

  before_data := jsonb_build_object(
    'selectedOptions', target_item.selected_options,
    'initialText', target_item.initial_text,
    'stickerSelected', target_item.sticker_selected,
    'stickerCategories', target_item.sticker_categories,
    'extraRequest', target_item.extra_request,
    'optionSurcharge', target_item.option_surcharge,
    'lineAmount', target_item.line_amount
  );

  update public.order_items set
    selected_options = option_result->'snapshot',
    option_surcharge = new_surcharge,
    line_amount = target_item.unit_price + new_surcharge,
    initial_text = initial_text_value,
    sticker_selected = sticker_selected_value,
    sticker_categories = case
      when sticker_selected_value then coalesce(array(
        select trim(category)
        from unnest(string_to_array(nullif(trim(p_payload->>'stickerCategories'), ''), ',')) as category
        where nullif(trim(category), '') is not null
      ), '{}'::text[])
      else '{}'::text[]
    end,
    extra_request = coalesce(p_payload->>'extraRequest', '')
  where id = target_item.id
  returning jsonb_build_object(
    'selectedOptions', selected_options,
    'initialText', initial_text,
    'stickerSelected', sticker_selected,
    'stickerCategories', sticker_categories,
    'extraRequest', extra_request,
    'optionSurcharge', option_surcharge,
    'lineAmount', line_amount
  ) into after_data;

  select coalesce(sum(line_amount), 0) into new_subtotal
  from public.order_items where order_id = target_order.id;

  if target_order.fulfillment_type = 'shipping' then
    if new_subtotal < target_sale.free_shipping_threshold then
      new_base_shipping_fee := target_sale.shipping_fee;
    end if;
    if target_order.delivery_zone = 'remote' then
      new_remote_surcharge := target_sale.remote_area_surcharge;
    end if;
  end if;
  new_shipping_fee := new_base_shipping_fee + new_remote_surcharge;
  new_total := new_subtotal + new_shipping_fee;

  update public.orders set
    subtotal_amount = new_subtotal,
    base_shipping_fee = new_base_shipping_fee,
    remote_area_surcharge = new_remote_surcharge,
    shipping_fee = new_shipping_fee,
    total_amount = new_total,
    payment_state = case
      when payment_state in ('paid', 'review_required') and total_amount <> new_total
        then 'review_required'::public.payment_state
      else payment_state
    end,
    payment_review_reason = case
      when payment_state in ('paid', 'review_required') and total_amount <> new_total
        then '관리자 제작 정보 수정으로 결제 금액 변경'
      else payment_review_reason
    end
  where id = target_order.id;

  insert into public.order_item_change_logs (
    order_id, order_item_id, admin_user_id, before_data, after_data,
    order_total_before, order_total_after
  ) values (
    target_order.id, target_item.id, p_admin_user_id, before_data, after_data,
    target_order.total_amount, new_total
  );

  return jsonb_build_object(
    'subtotalAmount', new_subtotal,
    'baseShippingFee', new_base_shipping_fee,
    'remoteAreaSurcharge', new_remote_surcharge,
    'shippingFee', new_shipping_fee,
    'totalAmount', new_total,
    'previousTotalAmount', target_order.total_amount,
    'paymentReviewRequired', target_order.payment_state in ('paid', 'review_required') and target_order.total_amount <> new_total
  );
end;
$$;

revoke all on function public.admin_update_order_item_v1(uuid,uuid,jsonb,uuid) from public;
grant execute on function public.admin_update_order_item_v1(uuid,uuid,jsonb,uuid) to service_role;
