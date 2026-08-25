-- Increase the initial text limit from 10 to 20 letters, excluding spaces.
-- Rebuild the latest order functions without changing their other behavior.

do $migration$
declare
  function_definition text;
  updated_definition text;
  old_validation constant text := 'length(replace(trim(item->>''initialText''), '' '', '''')) > 10';
  new_validation constant text := 'length(replace(trim(item->>''initialText''), '' '', '''')) > 20';
begin
  function_definition := pg_get_functiondef(
    'public.submit_order(text,text,jsonb,text,text,text)'::regprocedure
  );
  updated_definition := replace(function_definition, old_validation, new_validation);
  if updated_definition = function_definition then
    raise exception 'SUBMIT_ORDER_INITIAL_VALIDATION_NOT_FOUND';
  end if;
  execute updated_definition;

  function_definition := pg_get_functiondef(
    'public.update_customer_order_v2(uuid,jsonb)'::regprocedure
  );
  updated_definition := replace(function_definition, old_validation, new_validation);
  if updated_definition = function_definition then
    raise exception 'UPDATE_ORDER_INITIAL_VALIDATION_NOT_FOUND';
  end if;
  execute updated_definition;
end;
$migration$;
