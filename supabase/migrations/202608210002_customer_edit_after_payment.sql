-- Customer edits remain available after payment confirmation and re-open payment review when the amount changes.

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
  new_total integer;
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
    select * into pickup from public.pickup_slots
    where id = (p_payload->>'pickupSlotId')::uuid and sale_id = sale.id and active and not manually_closed;
    if pickup.id is null then raise exception 'PICKUP_SLOT_UNAVAILABLE'; end if;
  elsif nullif(p_payload->>'addressCiphertext', '') is null then
    raise exception 'ADDRESS_REQUIRED';
  end if;

  for item in select value from jsonb_array_elements(p_payload->'items') loop
    select * into target_item
    from public.order_items
    where id = (item->>'id')::uuid and order_id = target.id
    for update;
    if target_item.id is null then raise exception 'INVALID_ITEM'; end if;

    select * into product
    from public.products
    where id = (item->>'productId')::uuid and sale_id = sale.id and active;
    if product.id is null or product.item_type <> item->>'itemType' then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    if nullif(trim(item->>'initialText'), '') is null
      or trim(item->>'initialText') !~ '^[A-Za-z ]+$'
      or length(replace(trim(item->>'initialText'), ' ', '')) > 10 then raise exception 'INVALID_INITIAL'; end if;

    item_surcharge := 0;
    if product.item_type = 'shirt' then
      select * into option_row
      from public.product_options
      where product_id = product.id and option_type = 'size' and value = item->>'size' and active;
      if option_row.id is null then raise exception 'INVALID_OPTION'; end if;
      item_surcharge := option_row.price_delta;
      if not exists(
        select 1 from public.product_options
        where product_id = product.id and option_type = 'gender' and value = item->>'gender' and active
      ) then raise exception 'INVALID_OPTION'; end if;
    end if;

    update public.order_items set
      product_id = product.id,
      product_name = product.name,
      unit_price = product.unit_price,
      item_type = product.item_type,
      size = case when product.item_type = 'shirt' then item->>'size' end,
      gender = case when product.item_type = 'shirt' then item->>'gender' end,
      initial_text = trim(item->>'initialText'),
      sticker_selected = coalesce((item->>'stickerSelected')::boolean, false),
      sticker_categories = coalesce(string_to_array(nullif(trim(item->>'stickerCategories'), ''), ','), '{}'::text[]),
      favorite_colors = coalesce(item->>'favoriteColors', ''),
      favorite_things = coalesce(item->>'favoriteThings', ''),
      desired_mood = coalesce(item->>'desiredMood', ''),
      instagram_reference = coalesce(item->>'instagramReference', ''),
      extra_request = coalesce(item->>'extraRequest', ''),
      option_surcharge = item_surcharge,
      line_amount = product.unit_price + item_surcharge
    where id = target_item.id;
    subtotal := subtotal + product.unit_price + item_surcharge;
  end loop;

  if fulfillment = 'shipping' and subtotal < sale.free_shipping_threshold then
    delivery_fee := sale.shipping_fee;
  end if;
  new_total := subtotal + delivery_fee;

  update public.orders set
    address_ciphertext = coalesce(p_payload->>'addressCiphertext', ''),
    fulfillment_type = fulfillment,
    pickup_slot_id = pickup.id,
    pickup_snapshot = case when pickup.id is null then null else jsonb_build_object(
      'name', sale.pickup_name,
      'address', sale.pickup_address,
      'notice', sale.pickup_notice,
      'date', pickup.pickup_date,
      'startsAt', pickup.starts_at,
      'endsAt', pickup.ends_at
    ) end,
    cash_receipt_type = receipt_type,
    cash_receipt_identifier_ciphertext = nullif(p_payload->>'cashReceiptIdentifierCiphertext', ''),
    subtotal_amount = subtotal,
    shipping_fee = delivery_fee,
    total_amount = new_total,
    payment_state = case
      when target.payment_state = 'paid' and target.total_amount <> new_total then 'review_required'::public.payment_state
      else target.payment_state
    end,
    payment_review_reason = case
      when target.payment_state = 'paid' and target.total_amount <> new_total then '주문 수정으로 결제 금액 변경'
      else target.payment_review_reason
    end
  where id = target.id;

  return jsonb_build_object(
    'totalQuantity', target.total_quantity,
    'subtotalAmount', subtotal,
    'shippingFee', delivery_fee,
    'totalAmount', new_total
  );
end;
$$;

revoke all on function public.update_customer_order_v2(uuid,jsonb) from public;
grant execute on function public.update_customer_order_v2(uuid,jsonb) to service_role;
