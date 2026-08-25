drop index if exists public.orders_active_email_uidx;
drop index if exists public.orders_active_email_sale_uidx;

alter table public.orders
  alter column email_ciphertext drop not null,
  alter column email_normalized_hash drop not null;

create or replace function private.suppress_order_email()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  return null;
end;
$$;

drop trigger if exists suppress_test_sale_email on public.email_outbox;
drop trigger if exists suppress_order_email on public.email_outbox;
create trigger suppress_order_email
before insert on public.email_outbox
for each row execute function private.suppress_order_email();

drop function if exists public.claim_email_jobs(integer);
drop function if exists public.admin_requeue_email(uuid, text);
drop function if exists public.mark_email_sent(uuid);
drop function if exists public.mark_email_failed(uuid, text);
