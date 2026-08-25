-- The initial catalog seed used PostgreSQL-compatible UUID text with a zero
-- version/variant. Zod's uuid validator correctly rejects those identifiers.
-- Preserve all administrator edits and normalize only affected JSON `id` values.

do $migration$
declare
  product_row record;
  normalized_groups jsonb;
begin
  for product_row in
    select id, option_groups
    from public.products
    where jsonb_typeof(option_groups) = 'array'
      and option_groups::text ~ '"id"[[:space:]]*:[[:space:]]*"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-0000-0000-[0-9A-Fa-f]{12}"'
  loop
    normalized_groups := regexp_replace(
      product_row.option_groups::text,
      '("id"[[:space:]]*:[[:space:]]*"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4})-0000-0000-([0-9A-Fa-f]{12}")',
      E'\\1-4000-8000-\\2',
      'g'
    )::jsonb;

    update public.products
    set option_groups = normalized_groups
    where id = product_row.id
      and option_groups is distinct from normalized_groups;
  end loop;
end;
$migration$;
