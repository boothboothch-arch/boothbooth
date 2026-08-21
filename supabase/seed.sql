insert into public.sales (
  id, round_number, publication_status, published_at, title, starts_at, ends_at, order_limit,
  bank_name, bank_account_ciphertext, bank_holder, kakao_channel_url, shipping_notice
) values (
  '10000000-0000-0000-0000-000000000001',
  6,
  'published',
  now(),
  '6차 부스부스 이니셜 티셔츠',
  '2026-09-01 12:00:00+09',
  '2026-09-07 23:59:59+09',
  100,
  '국민은행',
  '301201-04-460201',
  '장견희',
  'https://pf.kakao.com/',
  '주문 마감 후 제작 및 배송 일정을 안내합니다.'
) on conflict (id) do nothing;

insert into public.products (id, sale_id, name, unit_price, item_type)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '이니셜 티셔츠',
  33000,
  'shirt'
) on conflict (id) do nothing;

insert into public.products (id, sale_id, name, unit_price, item_type)
values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '이니셜 가방', 20000, 'bag')
on conflict (id) do nothing;

insert into public.product_options (product_id, option_type, value, sort_order, price_delta) values
  ('20000000-0000-0000-0000-000000000001', 'size', 'XS', 1, 0),
  ('20000000-0000-0000-0000-000000000001', 'size', 'S', 2, 0),
  ('20000000-0000-0000-0000-000000000001', 'size', 'M', 3, 0),
  ('20000000-0000-0000-0000-000000000001', 'size', 'L', 4, 0),
  ('20000000-0000-0000-0000-000000000001', 'size', 'XL', 5, 0),
  ('20000000-0000-0000-0000-000000000001', 'size', '2XL', 6, 2000),
  ('20000000-0000-0000-0000-000000000001', 'gender', '남성', 1, 0),
  ('20000000-0000-0000-0000-000000000001', 'gender', '여성', 2, 0)
on conflict (product_id, option_type, value) do nothing;

insert into public.pickup_slots (sale_id, pickup_date, starts_at, ends_at) values
  ('10000000-0000-0000-0000-000000000001', '2026-09-05', '11:00', '13:00'),
  ('10000000-0000-0000-0000-000000000001', '2026-09-05', '13:00', '15:00'),
  ('10000000-0000-0000-0000-000000000001', '2026-09-05', '15:00', '17:00'),
  ('10000000-0000-0000-0000-000000000001', '2026-09-06', '11:00', '13:00'),
  ('10000000-0000-0000-0000-000000000001', '2026-09-06', '13:00', '15:00'),
  ('10000000-0000-0000-0000-000000000001', '2026-09-06', '15:00', '17:00')
on conflict do nothing;

-- 관리자 계정 생성 후 아래 SQL로 allowlist에 추가하세요.
-- insert into public.admin_users(user_id) values ('AUTH_USER_UUID');
