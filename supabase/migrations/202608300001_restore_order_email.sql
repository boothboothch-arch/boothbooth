alter table public.email_outbox
  add column if not exists processing_started_at timestamptz,
  add column if not exists provider_message_id text;

drop trigger if exists suppress_order_email on public.email_outbox;
drop trigger if exists suppress_test_sale_email on public.email_outbox;

create or replace function private.allow_order_received_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_sale_kind text;
begin
  if new.event_type <> 'order_received' or nullif(new.recipient_ciphertext, '') is null then
    return null;
  end if;

  select sale.sale_kind into target_sale_kind
  from public.orders as customer_order
  join public.sales as sale on sale.id = customer_order.sale_id
  where customer_order.id = new.order_id;

  if target_sale_kind = 'test' then return null; end if;
  return new;
end;
$$;

create trigger allow_order_received_email
before insert on public.email_outbox
for each row execute function private.allow_order_received_email();

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
      'kakaoChannelUrl', (select kakao_channel_url from public.sales where id = new.sale_id)
    )
  );
  return new;
end;
$$;

drop trigger if exists enqueue_order_received_email on public.orders;
create trigger enqueue_order_received_email
after insert on public.orders
for each row execute function private.enqueue_order_received_email();

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
    where (
      state in ('pending', 'failed')
      or (state = 'processing' and processing_started_at < now() - interval '10 minutes')
    )
      and next_attempt_at <= now()
      and attempt_count < 5
    order by created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 50)
  )
  update public.email_outbox as outbox
  set state = 'processing',
      attempt_count = outbox.attempt_count + 1,
      last_error = null,
      processing_started_at = now()
  from jobs
  where outbox.id = jobs.id
  returning outbox.*;
end;
$$;

create or replace function public.claim_order_email_job(p_order_id uuid)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with job as (
    select id
    from public.email_outbox
    where order_id = p_order_id
      and event_type = 'order_received'
      and (
        state in ('pending', 'failed')
        or (state = 'processing' and processing_started_at < now() - interval '10 minutes')
      )
      and next_attempt_at <= now()
      and attempt_count < 5
    order by created_at desc
    for update skip locked
    limit 1
  )
  update public.email_outbox as outbox
  set state = 'processing',
      attempt_count = outbox.attempt_count + 1,
      last_error = null,
      processing_started_at = now()
  from job
  where outbox.id = job.id
  returning outbox.*;
end;
$$;

create or replace function public.mark_email_sent(p_id uuid, p_provider_message_id text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.email_outbox
  set state = 'sent', sent_at = now(), last_error = null,
      processing_started_at = null, provider_message_id = p_provider_message_id
  where id = p_id and state = 'processing';
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

create or replace function public.admin_update_order_contact_v3(
  p_order_id uuid,
  p_customer_name text,
  p_phone_ciphertext text,
  p_phone_hash text,
  p_phone_last4_hash text,
  p_email_ciphertext text,
  p_email_hash text,
  p_depositor_name text,
  p_address_ciphertext text,
  p_postal_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  target_sale_kind text;
  target_kakao_url text;
  updated_jobs integer := 0;
  result jsonb;
begin
  select * into target from public.orders where id = p_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  result := public.admin_update_order_contact_v2(
    p_order_id, p_customer_name, p_phone_ciphertext, p_phone_hash,
    p_phone_last4_hash, p_depositor_name, p_address_ciphertext, p_postal_code
  );

  update public.orders
  set email_ciphertext = p_email_ciphertext,
      email_normalized_hash = p_email_hash
  where id = p_order_id;

  update public.email_outbox
  set recipient_ciphertext = p_email_ciphertext,
      state = 'pending', attempt_count = 0, next_attempt_at = now(),
      last_error = null, processing_started_at = null
  where order_id = p_order_id
    and event_type = 'order_received'
    and state in ('pending', 'failed');
  get diagnostics updated_jobs = row_count;

  select sale_kind, kakao_channel_url into target_sale_kind, target_kakao_url
  from public.sales where id = target.sale_id;
  if target.email_normalized_hash is distinct from p_email_hash
    and updated_jobs = 0
    and target_sale_kind <> 'test' then
    insert into public.email_outbox (
      order_id, event_type, dedupe_key, recipient_ciphertext, payload_json
    ) values (
      target.id,
      'order_received',
      target.id || ':order_received:email:' || left(p_email_hash, 16),
      p_email_ciphertext,
      jsonb_build_object(
        'customerName', trim(p_customer_name),
        'orderNumber', target.order_number,
        'totalAmount', (result->>'totalAmount')::integer,
        'paymentDueAt', target.payment_due_at,
        'kakaoChannelUrl', target_kakao_url
      )
    ) on conflict (dedupe_key) do nothing;
  end if;

  return result;
end;
$$;

revoke all on function public.claim_email_jobs(integer) from public;
revoke all on function public.claim_order_email_job(uuid) from public;
revoke all on function public.mark_email_sent(uuid,text) from public;
revoke all on function public.mark_email_failed(uuid,text) from public;
revoke all on function public.admin_update_order_contact_v3(uuid,text,text,text,text,text,text,text,text,text) from public;

grant execute on function public.claim_email_jobs(integer) to service_role;
grant execute on function public.claim_order_email_job(uuid) to service_role;
grant execute on function public.mark_email_sent(uuid,text) to service_role;
grant execute on function public.mark_email_failed(uuid,text) to service_role;
grant execute on function public.admin_update_order_contact_v3(uuid,text,text,text,text,text,text,text,text,text) to service_role;
