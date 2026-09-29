-- 제휴 아웃바운드 클릭(C5, 제휴링크-연동-설계.md 칸 1 · BR-U1-32).
--
-- V2.59 — 원래 V2.54 로 채번했으나(2026-09-27, 당시 V2.53 이 최신) 이 PR(#767)이 머지 대기하는 사이
-- develop 에 V2.55~V2.58 이 먼저 들어갔다. outOfOrder 미사용(기본 false) 환경에서 뒤늦은 2.54 는
-- **조용히 스킵**되어 DEV 처럼 이미 앞서간 DB 에 affiliate_click 이 영영 안 생긴다 — 그래서 개번(2026-09-29).
--
-- **내부 지표 전용이다(BR-U1-32)** — 사용자 대면 응답 어디에도 싣지 않는다. OTA 계약 전부터
-- 쌓이는 클릭이 어필리에이트 심사("운영 중인 매체")와 콘텐츠 API 협상의 근거가 된다.
--
-- stay 에 FK 를 걸지 않는다: stay 는 시드 재생성이 폐업 제거(DELETE)를 동반하는 테이블이라
-- FK 를 걸면 재생성이 클릭 이력을 지우거나(CASCADE) 막는다(RESTRICT). 클릭은 숙소가 사라져도
-- 남아야 하는 기록이다 — stay_id 는 "{출처}:{식별자}" 합성 경계 키를 그대로 담는다.
-- account 에는 CASCADE 를 건다(saved_stay 선례) — 클릭은 개인정보라 탈퇴와 함께 지워지는 것이 맞다.
--
-- account_id 는 **nullable — 익명 클릭이다**(domain-entities C5 의 accountId 필수에서 이탈).
-- 이 엔드포인트는 브라우저·커스텀탭이 열어 Authorization 을 실을 수 없다(칸 3 어트리뷰션 표준이
-- Custom Tab/SFSafariVC). 익명 행은 계정과 연결이 없어 개인정보가 아니고, 매체 증거로는 유효하다.
CREATE TABLE affiliate_click (
  click_id        uuid         PRIMARY KEY,
  account_id      uuid         REFERENCES account(account_id) ON DELETE CASCADE,
  stay_id         varchar(120) NOT NULL,
  vendor          varchar(30)  NOT NULL,  -- 'WEBSEARCH' → 계약 후 OTA 코드가 추가된다
  check_in        date,                   -- NULL 은 "날짜 없이 눌렀다" — 실가격 협상 데이터라 파라미터째 남긴다
  check_out       date,
  adults          integer,
  clicked_at      timestamptz  NOT NULL,
  -- 칸 2(포스트백 수신) 어휘 — domain-entities C5: NONE·RECEIVED. 지금은 전부 NONE.
  postback_status varchar(20)  NOT NULL DEFAULT 'NONE'
);

-- 쓰레기값은 행째 거른다(V2.51 rooms CHECK 선례). 기록은 fail-open 이라(서비스 runCatching)
-- 제약 위반은 "클릭 한 건 유실 + 에러 로그"로 끝나고 사용자 이동(302)은 그대로다 —
-- 협상 근거 데이터에 음수 인원·역전 날짜가 섞이는 것보다 낫다.
ALTER TABLE affiliate_click ADD CONSTRAINT ck_affiliate_click_adults_positive
  CHECK (adults IS NULL OR adults > 0);
ALTER TABLE affiliate_click ADD CONSTRAINT ck_affiliate_click_dates_ordered
  CHECK (check_in IS NULL OR check_out IS NULL OR check_out > check_in);
