-- Customers may edit an order only while it is waiting for payment.
-- Admin production-information editing keeps its separate state policy.

do $migration$
declare
  function_definition text;
  updated_definition text;
  old_validation constant text := 'target.order_state not in (''payment_pending'', ''payment_confirmed'')';
  new_validation constant text := 'target.order_state <> ''payment_pending''';
begin
  function_definition := pg_get_functiondef(
    'public.update_customer_order_v2(uuid,jsonb)'::regprocedure
  );
  updated_definition := replace(function_definition, old_validation, new_validation);
  if updated_definition = function_definition then
    raise exception 'CUSTOMER_PAYMENT_PENDING_EDIT_VALIDATION_NOT_FOUND';
  end if;
  execute updated_definition;
end;
$migration$;
