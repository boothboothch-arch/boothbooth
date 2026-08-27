-- Let customers add, replace, and remove reference images while an order is
-- still waiting for payment. Image ownership and limits are enforced inside
-- the same transaction as the rest of the order update.

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
  item jsonb;
  target_item public.order_items%rowtype;
  upload public.order_image_uploads%rowtype;
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
  final_image_ids uuid[];
  image_id uuid;
  image_index integer;
  total_image_count integer := 0;
  item_removed_paths text[];
  removed_paths text[] := '{}'::text[];
begin
  select * into target from public.orders where id = p_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.order_state <> 'payment_pending' then raise exception 'ORDER_NOT_EDITABLE'; end if;
  select * into sale from public.sales where id = target.sale_id;
  if jsonb_array_length(p_payload->'items') <> (select count(*) from public.order_items where order_id = target.id) then raise exception 'ITEM_COUNT_CHANGE_NOT_ALLOWED'; end if;
  if fulfillment not in ('shipping', 'pickup') then raise exception 'INVALID_FULFILLMENT'; end if;
  if receipt_type not in ('none', 'personal', 'business') then raise exception 'INVALID_CASH_RECEIPT'; end if;
  if fulfillment = 'shipping' then
    if nullif(p_payload->>'addressCiphertext', '') is null then raise exception 'ADDRESS_REQUIRED'; end if;
    if postal_code !~ '^[0-9]{5}$' then raise exception 'INVALID_POSTAL_CODE'; end if;
  end if;

  for item in select value from jsonb_array_elements(p_payload->'items') loop
    select * into target_item from public.order_items where id = (item->>'id')::uuid and order_id = target.id for update;
    if target_item.id is null then raise exception 'INVALID_ITEM'; end if;
    select * into product from public.products where id = target_item.product_id and sale_id = sale.id;
    if product.id is null then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    if coalesce((product.customization_config->>'initialEnabled')::boolean, true) and (
      nullif(trim(item->>'initialText'), '') is null or trim(item->>'initialText') !~ '^[A-Za-z ]+$' or length(replace(trim(item->>'initialText'), ' ', '')) > 12
    ) then raise exception 'INVALID_INITIAL'; end if;
    option_result := private.resolve_product_options(product, coalesce(item->'selectedOptionValueIds', '[]'::jsonb));
    item_surcharge := (option_result->>'surcharge')::integer;

    select coalesce(array_agg(image.value::uuid), '{}'::uuid[])
    into final_image_ids
    from jsonb_array_elements_text(coalesce(item->'images', '[]'::jsonb)) as image(value);
    if cardinality(final_image_ids) > 3 then raise exception 'TOO_MANY_IMAGES'; end if;
    if cardinality(final_image_ids) <> (select count(distinct candidate.image_id) from unnest(final_image_ids) as candidate(image_id)) then raise exception 'INVALID_IMAGE'; end if;
    total_image_count := total_image_count + cardinality(final_image_ids);
    if total_image_count > 20 then raise exception 'TOO_MANY_IMAGES'; end if;

    foreach image_id in array final_image_ids loop
      if exists(select 1 from public.order_item_images where id = image_id and order_item_id = target_item.id) then
        continue;
      end if;
      select * into upload
      from public.order_image_uploads
      where id = image_id and order_id = target.id and client_item_id = target_item.id and consumed_at is null;
      if upload.id is null then raise exception 'INVALID_IMAGE'; end if;
    end loop;

    select coalesce(array_agg(storage_path), '{}'::text[])
    into item_removed_paths
    from public.order_item_images
    where order_item_id = target_item.id and not (id = any(final_image_ids));
    removed_paths := removed_paths || item_removed_paths;
    delete from public.order_item_images
    where order_item_id = target_item.id and not (id = any(final_image_ids));
    delete from public.order_image_uploads where storage_path = any(item_removed_paths);

    image_index := 0;
    foreach image_id in array final_image_ids loop
      if exists(select 1 from public.order_item_images where id = image_id and order_item_id = target_item.id) then
        update public.order_item_images set sort_order = image_index where id = image_id;
      else
        select * into upload
        from public.order_image_uploads
        where id = image_id and order_id = target.id and client_item_id = target_item.id and consumed_at is null;
        insert into public.order_item_images (id, order_item_id, storage_path, mime_type, byte_size, width, height, sort_order)
        values (upload.id, target_item.id, upload.storage_path, upload.mime_type, upload.byte_size, upload.width, upload.height, image_index);
        update public.order_image_uploads set consumed_at = now() where id = upload.id;
      end if;
      image_index := image_index + 1;
    end loop;

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
  update public.orders set
    address_ciphertext = coalesce(p_payload->>'addressCiphertext', ''), fulfillment_type = fulfillment,
    pickup_slot_id = null,
    pickup_snapshot = case when fulfillment = 'pickup' then jsonb_build_object('name', sale.pickup_name, 'address', sale.pickup_address, 'notice', sale.pickup_notice) else null end,
    cash_receipt_type = receipt_type, cash_receipt_identifier_ciphertext = nullif(p_payload->>'cashReceiptIdentifierCiphertext', ''),
    subtotal_amount = subtotal, base_shipping_fee = base_delivery_fee, remote_area_surcharge = remote_delivery_fee,
    shipping_fee = delivery_fee, total_amount = new_total, delivery_zone = target_delivery_zone,
    payment_state = case when target.payment_state = 'paid' and target.total_amount <> new_total then 'review_required'::public.payment_state else target.payment_state end,
    payment_review_reason = case when target.payment_state = 'paid' and target.total_amount <> new_total then '주문 수정으로 결제 금액 변경' else target.payment_review_reason end
  where id = target.id;
  return jsonb_build_object(
    'totalQuantity', target.total_quantity,
    'subtotalAmount', subtotal,
    'baseShippingFee', base_delivery_fee,
    'remoteAreaSurcharge', remote_delivery_fee,
    'shippingFee', delivery_fee,
    'totalAmount', new_total,
    'deliveryZone', target_delivery_zone,
    'storagePaths', to_jsonb(removed_paths)
  );
end;
$$;

revoke all on function public.update_customer_order_v2(uuid,jsonb) from public;
grant execute on function public.update_customer_order_v2(uuid,jsonb) to service_role;
