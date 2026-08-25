-- Reduce the initial text limit from 20 to 12 letters, excluding spaces.
-- This follows the earlier 10-to-20 migration so existing databases and fresh
-- installations arrive at the same final validation rule.

do $migration$
declare
  function_definition text;
  updated_definition text;
  old_item_validation constant text := 'length(replace(trim(item->>''initialText''), '' '', '''')) > 20';
  new_item_validation constant text := 'length(replace(trim(item->>''initialText''), '' '', '''')) > 12';
  old_admin_validation constant text := 'length(replace(initial_text_value, '' '', '''')) > 20';
  new_admin_validation constant text := 'length(replace(initial_text_value, '' '', '''')) > 12';
begin
  function_definition := pg_get_functiondef(
    'public.submit_order(text,text,jsonb,text,text,text)'::regprocedure
  );
  updated_definition := replace(function_definition, old_item_validation, new_item_validation);
  if updated_definition = function_definition then
    raise exception 'SUBMIT_ORDER_INITIAL_12_VALIDATION_NOT_FOUND';
  end if;
  execute updated_definition;

  function_definition := pg_get_functiondef(
    'public.update_customer_order_v2(uuid,jsonb)'::regprocedure
  );
  updated_definition := replace(function_definition, old_item_validation, new_item_validation);
  if updated_definition = function_definition then
    raise exception 'UPDATE_ORDER_INITIAL_12_VALIDATION_NOT_FOUND';
  end if;
  execute updated_definition;

  function_definition := pg_get_functiondef(
    'public.admin_update_order_item_v1(uuid,uuid,jsonb,uuid)'::regprocedure
  );
  updated_definition := replace(function_definition, old_admin_validation, new_admin_validation);
  if updated_definition = function_definition then
    raise exception 'ADMIN_UPDATE_ORDER_INITIAL_12_VALIDATION_NOT_FOUND';
  end if;
  execute updated_definition;
end;
$migration$;
