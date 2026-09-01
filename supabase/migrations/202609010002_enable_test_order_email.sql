create or replace function private.allow_order_received_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type <> 'order_received' or nullif(new.recipient_ciphertext, '') is null then
    return null;
  end if;
  return new;
end;
$$;

create or replace function private.enqueue_order_received_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(new.email_ciphertext, '') is null then return new; end if;

  insert into public.email_outbox (
    order_id, event_type, dedupe_key, recipient_ciphertext, payload_json
  ) values (
    new.id,
    'order_received',
    new.id || ':order_received',
    new.email_ciphertext,
    jsonb_build_object(
      'customerName', new.customer_name,
      'orderNumber', new.order_number,
      'totalAmount', new.total_amount,
      'paymentDueAt', new.payment_due_at,
      'kakaoChannelUrl', (select kakao_channel_url from public.sales where id = new.sale_id),
      'saleKind', (select sale_kind from public.sales where id = new.sale_id)
    )
  );
  return new;
end;
$$;
