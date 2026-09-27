-- 제휴 아웃바운드 클릭(C5, 제휴링크-연동-설계.md 칸 1 · BR-U1-32).
--
-- V2.53 다음. 열린 PR 중 db/migration 을 쓰는 것이 없음을 확인했다(2026-09-27 — #763 은 머지됨).
--
-- **내부 지표 전용이다(BR-U1-32)** — 사용자 대면 응답 어디에도 싣지 않는다. OTA 계약 전부터
-- 쌓이는 클릭이 어필리에이트 심사("운영 중인 매체")와 콘텐츠 API 협상의 근거가 된다.
--
-- stay 에 FK 를 걸지 않는다: stay 는 시드 재생성이 폐업 제거(DELETE)를 동반하는 테이블이라
-- FK 를 걸면 재생성이 클릭 이력을 지우거나(CASCADE) 막는다(RESTRICT). 클릭은 숙소가 사라져도
-- 남아야 하는 기록이다 — stay_id 는 "{출처}:{식별자}" 합성 경계 키를 그대로 담는다.
-- account 에는 CASCADE 를 건다(saved_stay 선례) — 클릭은 개인정보라 탈퇴와 함께 지워지는 것이 맞다.
CREATE TABLE affiliate_click (
  click_id        uuid         PRIMARY KEY,
  account_id      uuid         NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  stay_id         varchar(120) NOT NULL,
  vendor          varchar(30)  NOT NULL,  -- 'WEBSEARCH' → 계약 후 OTA 코드가 추가된다
  check_in        date,                   -- NULL 은 "날짜 없이 눌렀다" — 실가격 협상 데이터라 파라미터째 남긴다
  check_out       date,
  adults          integer,
  clicked_at      timestamptz  NOT NULL,
  -- 칸 2(포스트백 수신) 어휘 — domain-entities C5: NONE·RECEIVED. 지금은 전부 NONE.
  postback_status varchar(20)  NOT NULL DEFAULT 'NONE'
);
