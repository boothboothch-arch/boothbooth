do $migration$
declare
  target_function regprocedure;
  function_definition text;
begin
  foreach target_function in array array[
    'public.claim_reservation(text)'::regprocedure,
    'public.claim_test_reservation(text,uuid)'::regprocedure
  ]
  loop
    function_definition := pg_get_functiondef(target_function);
    function_definition := replace(function_definition, '20 minutes', '30 minutes');
    execute function_definition;
  end loop;
end;
$migration$;
