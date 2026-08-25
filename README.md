# booth booth store

booth booth의 커스텀 상품을 주문서 접수 한도와 상품별 재고 기준으로 판매하는 비회원 주문 서비스입니다. Next.js App Router를 Vercel에 배포하고, Supabase Postgres/Auth와 카카오 우편번호 서비스를 사용합니다. Supabase Edge Functions는 사용하지 않습니다.

## 구현 범위

- 판매 시작 카운트다운, 남은 주문 가능 건수, 조기 마감·재오픈
- 30분 주문 슬롯과 5분 비활성 경고/1분 후 반환
- 관리자가 상품·한정 수량·옵션 그룹·추가금·주문 입력 항목을 구성하는 동적 카탈로그
- 여러 종류의 티셔츠·가방을 함께 담는 상품별 커스텀 주문
- 상품별 이니셜·스티커 취향·디자인 참고정보와 모바일 이미지 업로드
- 택배·픽업 선택, 8만원 이상 무료배송, 제주·도서산간 추가 배송비와 현금영수증 신청 정보
- 같은 휴대전화 번호로 여러 주문 접수 허용
- `BB-` + Crockford Base32 10자리 주문번호와 30분 주문 조회 인증
- 주문 완료/조회 시 계좌 및 주문·입금·배송 상태 표시
- 입금 대기·확인 필요·완료·환불 상태, 관리자 미입금 취소와 복구
- 관리자 로그인, 주문/상품/판매/배송 설정, CSV 다운로드
- 기존 설정을 복사한 다음 차수 초안, 공개 전 점검·미리보기·공개·보관
- 차수별 대시보드·주문·CSV와 과거 주문 조회

상세 정책은 [PRD](./docs/PRD.md), 기술 결정은 [기술 설계서](./docs/TECHNICAL_DESIGN.md)를 참고하세요.

## 로컬 실행

필요한 환경은 Node.js 20.9 이상, npm, Docker Desktop입니다.

```bash
npm install
cp .env.example .env.local
npx supabase start
npx supabase db reset
npm run dev
```

`npx supabase status`가 출력하는 API URL, anon key, service role key를 각각 아래 항목에 넣습니다.

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
```

암호화·서명 비밀값은 각각 별도로 생성해 32자 이상으로 설정합니다.

```bash
openssl rand -base64 48
```

같은 값을 `PII_ENCRYPTION_KEY`, `PII_HMAC_SECRET`, `ORDER_ACCESS_SIGNING_SECRET`에 재사용하지 마세요.

## 최초 관리자 생성

1. Supabase Authentication에서 이메일/비밀번호 사용자를 직접 생성합니다.
2. 생성한 사용자의 UUID를 SQL Editor에서 관리자 목록에 넣습니다.
3. 운영 프로젝트에서는 공개 회원가입을 비활성화합니다.

```sql
insert into public.admin_users (user_id)
values ('AUTH_USER_UUID');
```

비밀번호 재설정 화면은 제품 요구사항에 따라 제공하지 않습니다. 분실 시 Supabase Dashboard에서 관리자가 직접 변경합니다.

## 다음 차수 운영

관리자 로그인 후 `차수 관리`에서 진행합니다.

1. `새 차수 만들기`에서 직전 차수를 복사합니다.
2. 새 차수 설정에서 판매 시간과 배송·픽업·계좌를 확인하고, `상품 관리`에서 상품·한정 수량·옵션 그룹을 구성합니다.
3. `미리보기`와 공개 전 점검을 확인한 뒤 `고객에게 공개`를 누릅니다.
4. 판매 중 일시 중지·재개는 해당 차수의 판매 설정에서 변경합니다.
5. 판매 종료 후 차수를 보관합니다. 주문과 이미지는 삭제되지 않습니다.

고객 메인은 현재 판매 중인 공개 차수를 우선 선택하고, 없으면 다음 공개 차수의 카운트다운을 자동으로 표시합니다. 같은 고객도 동일한 휴대전화 번호로 여러 주문을 접수할 수 있습니다.

## Supabase 배포

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

초기 예시 판매/상품이 필요하면 [seed.sql](./supabase/seed.sql)을 SQL Editor에서 실행합니다. 예시 계좌번호는 운영 전 관리자 설정에서 반드시 교체하세요.

## Vercel 배포

저장소를 Vercel에 연결하고 `.env.example`의 변수를 Production/Preview 환경에 등록합니다. `NEXT_PUBLIC_APP_URL`은 실제 HTTPS 주소로 지정합니다. 함수 기본 리전은 [vercel.json](./vercel.json)에서 서울(`icn1`)로 고정했습니다.

Vercel Hobby는 비상업적 개인 프로젝트용입니다. 실제 티셔츠 판매 전에는 Vercel Pro 전환 또는 상업적 사용을 허용하는 호스팅이 필요합니다.

## 검증 명령

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

판매 상태를 `open`으로 만든 전용 로컬 DB에서 500개 동시 예약의 초과 접수를 확인할 수 있습니다. 성공한 테스트 예약은 검사 후 자동 반환됩니다.

```bash
LOAD_TEST_URL=http://localhost:3000 LOAD_TEST_CONCURRENCY=500 npm run test:load
```

DB 마이그레이션 검증은 Docker Desktop을 실행한 상태에서 아래처럼 수행합니다.

```bash
npx supabase start
npx supabase db reset
npx supabase db lint --fail-on error
```
