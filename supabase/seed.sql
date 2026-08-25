-- Fresh-project bootstrap data.
-- This seed intentionally creates a draft sale. Configure the bank account,
-- pickup information, schedule, products, and options in the admin before publishing.

insert into public.sales (
  id, round_number, title, starts_at, ends_at, order_limit, manually_closed,
  bank_name, bank_account_ciphertext, bank_holder, kakao_channel_url, shipping_notice,
  shipping_fee, free_shipping_threshold, remote_area_surcharge,
  pickup_name, pickup_address, pickup_notice,
  publication_status, published_at, internal_note, sale_kind
) values (
  '10000000-0000-0000-0000-000000000001',
  6,
  '6차 부스부스 커스텀 주문',
  now() + interval '7 days',
  now() + interval '14 days',
  100,
  false,
  '관리자 설정 필요',
  '관리자 화면에서 계좌번호를 설정해주세요',
  '관리자 설정 필요',
  'https://pf.kakao.com/_rTzhX',
  '주문 마감 후 제작 및 배송 일정을 안내합니다.',
  3000,
  80000,
  3000,
  '부스부스 픽업',
  '관리자 화면에서 픽업 주소를 설정해주세요',
  '픽업 전 확정된 날짜와 시간을 확인해주세요.',
  'draft',
  null,
  '신규 프로젝트 초기 설정용 차수입니다. 공개 전 모든 설정을 확인해주세요.',
  'live'
)
on conflict (id) do update set
  title = excluded.title,
  order_limit = excluded.order_limit,
  shipping_fee = excluded.shipping_fee,
  free_shipping_threshold = excluded.free_shipping_threshold,
  remote_area_surcharge = excluded.remote_area_surcharge,
  kakao_channel_url = excluded.kakao_channel_url,
  shipping_notice = excluded.shipping_notice,
  internal_note = excluded.internal_note;

insert into public.products (
  id, sale_id, name, description, unit_price, item_type, stock_limit,
  sort_order, active, option_groups, customization_config
) values
(
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '이니셜 티셔츠',
  '이름의 영문자마다 가장 잘 어울리는 패치 느낌과 배열, 색감을 고려해 제작합니다.',
  33000,
  'shirt',
  1000,
  1,
  true,
  jsonb_build_array(
    jsonb_build_object(
      'id', '31000000-0000-4000-8000-000000000001',
      'name', '사이즈',
      'selectionType', 'single',
      'required', true,
      'minSelections', 1,
      'maxSelections', 1,
      'sortOrder', 1,
      'active', true,
      'values', jsonb_build_array(
        jsonb_build_object('id', '41000000-0000-4000-8000-000000000001', 'label', 'XS', 'priceDelta', 0, 'sortOrder', 1, 'active', true),
        jsonb_build_object('id', '41000000-0000-4000-8000-000000000002', 'label', 'S', 'priceDelta', 0, 'sortOrder', 2, 'active', true),
        jsonb_build_object('id', '41000000-0000-4000-8000-000000000003', 'label', 'M', 'priceDelta', 0, 'sortOrder', 3, 'active', true),
        jsonb_build_object('id', '41000000-0000-4000-8000-000000000004', 'label', 'L', 'priceDelta', 0, 'sortOrder', 4, 'active', true),
        jsonb_build_object('id', '41000000-0000-4000-8000-000000000005', 'label', 'XL', 'priceDelta', 0, 'sortOrder', 5, 'active', true),
        jsonb_build_object('id', '41000000-0000-4000-8000-000000000006', 'label', '2XL', 'priceDelta', 2000, 'sortOrder', 6, 'active', true)
      )
    ),
    jsonb_build_object(
      'id', '31000000-0000-4000-8000-000000000002',
      'name', '성별',
      'selectionType', 'single',
      'required', true,
      'minSelections', 1,
      'maxSelections', 1,
      'sortOrder', 2,
      'active', true,
      'values', jsonb_build_array(
        jsonb_build_object('id', '41000000-0000-4000-8000-000000000007', 'label', '남성', 'priceDelta', 0, 'sortOrder', 1, 'active', true),
        jsonb_build_object('id', '41000000-0000-4000-8000-000000000008', 'label', '여성', 'priceDelta', 0, 'sortOrder', 2, 'active', true)
      )
    ),
    jsonb_build_object(
      'id', '31000000-0000-4000-8000-000000000003',
      'name', '인쇄 방식',
      'selectionType', 'single',
      'required', true,
      'minSelections', 1,
      'maxSelections', 1,
      'sortOrder', 3,
      'active', true,
      'values', jsonb_build_array(
        jsonb_build_object('id', '41000000-0000-4000-8000-000000000009', 'label', '앞면만', 'priceDelta', 0, 'sortOrder', 1, 'active', true),
        jsonb_build_object('id', '41000000-0000-4000-8000-000000000010', 'label', '뒷면 추가', 'priceDelta', 10000, 'sortOrder', 2, 'active', true)
      )
    )
  ),
  '{"initialEnabled":true,"stickerEnabled":true,"referenceImagesEnabled":true,"extraRequestEnabled":true}'::jsonb
),
(
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '내맘대로 티셔츠',
  '키즈 사이즈부터 선택할 수 있는 한정 수량 커스텀 티셔츠입니다.',
  66000,
  'shirt',
  10,
  2,
  true,
  jsonb_build_array(
    jsonb_build_object(
      'id', '32000000-0000-4000-8000-000000000001',
      'name', '사이즈',
      'selectionType', 'single',
      'required', true,
      'minSelections', 1,
      'maxSelections', 1,
      'sortOrder', 1,
      'active', true,
      'values', jsonb_build_array(
        jsonb_build_object('id', '42000000-0000-4000-8000-000000000001', 'label', '키즈 100', 'priceDelta', 0, 'sortOrder', 1, 'active', true),
        jsonb_build_object('id', '42000000-0000-4000-8000-000000000002', 'label', '키즈 110', 'priceDelta', 0, 'sortOrder', 2, 'active', true),
        jsonb_build_object('id', '42000000-0000-4000-8000-000000000003', 'label', '키즈 120', 'priceDelta', 0, 'sortOrder', 3, 'active', true),
        jsonb_build_object('id', '42000000-0000-4000-8000-000000000004', 'label', '키즈 130', 'priceDelta', 0, 'sortOrder', 4, 'active', true),
        jsonb_build_object('id', '42000000-0000-4000-8000-000000000005', 'label', '키즈 140', 'priceDelta', 0, 'sortOrder', 5, 'active', true),
        jsonb_build_object('id', '42000000-0000-4000-8000-000000000006', 'label', '키즈 150', 'priceDelta', 0, 'sortOrder', 6, 'active', true),
        jsonb_build_object('id', '42000000-0000-4000-8000-000000000007', 'label', 'XS', 'priceDelta', 0, 'sortOrder', 7, 'active', true),
        jsonb_build_object('id', '42000000-0000-4000-8000-000000000008', 'label', 'S', 'priceDelta', 0, 'sortOrder', 8, 'active', true),
        jsonb_build_object('id', '42000000-0000-4000-8000-000000000009', 'label', 'M', 'priceDelta', 0, 'sortOrder', 9, 'active', true),
        jsonb_build_object('id', '42000000-0000-4000-8000-000000000010', 'label', 'L', 'priceDelta', 0, 'sortOrder', 10, 'active', true),
        jsonb_build_object('id', '42000000-0000-4000-8000-000000000011', 'label', 'XL', 'priceDelta', 0, 'sortOrder', 11, 'active', true),
        jsonb_build_object('id', '42000000-0000-4000-8000-000000000012', 'label', '2XL', 'priceDelta', 2000, 'sortOrder', 12, 'active', true)
      )
    )
  ),
  '{"initialEnabled":true,"stickerEnabled":true,"referenceImagesEnabled":true,"extraRequestEnabled":true}'::jsonb
),
(
  '20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '이니셜 가방',
  '이니셜과 가장 잘 어울리는 조합으로 제작하는 커스텀 가방입니다.',
  20000,
  'bag',
  null,
  3,
  true,
  jsonb_build_array(
    jsonb_build_object(
      'id', '33000000-0000-4000-8000-000000000001',
      'name', '인쇄 방식',
      'selectionType', 'single',
      'required', true,
      'minSelections', 1,
      'maxSelections', 1,
      'sortOrder', 1,
      'active', true,
      'values', jsonb_build_array(
        jsonb_build_object('id', '43000000-0000-4000-8000-000000000001', 'label', '단면', 'priceDelta', 0, 'sortOrder', 1, 'active', true),
        jsonb_build_object('id', '43000000-0000-4000-8000-000000000002', 'label', '양면', 'priceDelta', 7000, 'sortOrder', 2, 'active', true)
      )
    )
  ),
  '{"initialEnabled":true,"stickerEnabled":true,"referenceImagesEnabled":true,"extraRequestEnabled":true}'::jsonb
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  unit_price = excluded.unit_price,
  item_type = excluded.item_type,
  stock_limit = excluded.stock_limit,
  sort_order = excluded.sort_order,
  active = excluded.active,
  option_groups = excluded.option_groups,
  customization_config = excluded.customization_config;

-- Create the administrator in Supabase Authentication first, then allowlist it:
-- insert into public.admin_users (user_id) values ('AUTH_USER_UUID');
