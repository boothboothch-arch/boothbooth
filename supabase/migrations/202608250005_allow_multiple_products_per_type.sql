-- 상품 유형은 화면 아이콘과 기본 분류에만 사용한다.
-- 한 차수에 같은 유형의 상품을 여러 개 등록할 수 있어야 한다.
drop index if exists public.products_sale_type_uidx;
