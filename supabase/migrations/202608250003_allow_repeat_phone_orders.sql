drop index if exists public.orders_active_phone_uidx;
drop index if exists public.orders_active_phone_sale_uidx;

do $migration$
declare
  target_function regprocedure := 'public.submit_order(text,text,jsonb,text,text,text)'::regprocedure;
  function_definition text;
  duplicate_check text := $check$
  if exists(
    select 1 from public.orders
    where sale_id = sale.id and order_state <> 'cancelled' and phone_normalized_hash = p_phone_hash
  ) then raise exception 'DUPLICATE_ORDER'; end if;
  if exists(
    select 1 from public.orders
    where sale_id = sale.id and order_state <> 'cancelled' and email_normalized_hash = p_email_hash
  ) then raise exception 'DUPLICATE_ORDER'; end if;
$check$;
begin
  function_definition := pg_get_functiondef(target_function);
  if strpos(function_definition, duplicate_check) = 0 then
    raise exception 'submit_order duplicate check was not found';
  end if;
  execute replace(function_definition, duplicate_check, '');
end;
$migration$;
