-- Keep existing orders on one line and persist the layout through every edit path.
alter table public.order_items
  add column initial_line_count smallint not null default 1
  check (initial_line_count in (1, 2));

-- Patch the current routines so previous shipping, image, and reservation fixes
-- remain intact. Every replacement must match before any function is installed.
do $migration$
declare
  routine text;
  definition text;
  updated text;
  replacements text[][];
  replacement text[];
begin
  foreach routine in array array[
    'public.submit_order(text,text,jsonb,text,text,text)',
    'public.update_customer_order_v2(uuid,jsonb)',
    'public.admin_update_order_item_v1(uuid,uuid,jsonb,uuid)'
  ] loop
    definition := pg_get_functiondef(routine::regprocedure);
    if routine like 'public.submit_order(%' then
      replacements := array[
        array['initial_text, sticker_selected,', 'initial_text, initial_line_count, sticker_selected,'],
        array[$old$product.item_type, null, coalesce(trim(item->>'initialText'), ''),$old$,
              $new$product.item_type, null, coalesce(trim(item->>'initialText'), ''), coalesce((item->>'initialLineCount')::smallint, 1),$new$]
      ];
    elsif routine like 'public.update_customer_order_v2(%' then
      replacements := array[
        array[$old$initial_text = coalesce(trim(item->>'initialText'), ''),$old$,
              $new$initial_text = coalesce(trim(item->>'initialText'), ''),
      initial_line_count = coalesce((item->>'initialLineCount')::smallint, target_item.initial_line_count),$new$]
      ];
    else
      replacements := array[
        array['initial_text = initial_text_value,', $new$initial_text = initial_text_value,
    initial_line_count = coalesce((p_payload->>'initialLineCount')::smallint, target_item.initial_line_count),$new$],
        array[$old$'initialText', target_item.initial_text,$old$, $new$'initialText', target_item.initial_text,
    'initialLineCount', target_item.initial_line_count,$new$],
        array[$old$'initialText', initial_text,$old$, $new$'initialText', initial_text,
    'initialLineCount', initial_line_count,$new$]
      ];
    end if;
    foreach replacement slice 1 in array replacements loop
      updated := replace(definition, replacement[1], replacement[2]);
      if updated = definition then
        raise exception 'INITIAL_LINE_COUNT_PATCH_NOT_FOUND: % / %', routine, replacement[1];
      end if;
      definition := updated;
    end loop;
    execute definition;
  end loop;
end;
$migration$;
