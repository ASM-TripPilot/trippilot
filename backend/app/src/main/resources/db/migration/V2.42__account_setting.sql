-- V2.42 계정 단위 앱 설정 — key-value 한 테이블 (TRIP-614 · BR-U6-33 · O-U6-5)
-- V2.41 이 develop 최신이고 열린 PR 중 마이그레이션을 쓰는 것이 없어 V2.42 를 집었다(2026-09-01 실측).
--
-- 왜 /me/preferences 를 넓히지 않았나
--   PreferenceInput 은 "여행 취향" 축(styles·activities…)으로 좁게 정의돼 있고, 여행 생성 시
--   preferenceSnapshot 으로 **동결**된다. 앱 설정을 섞으면 "제휴 안내를 다시 안 보기"가 그 스냅숏에
--   딸려 들어가 여행 이력에 박힌다. 성질이 다른 값이라 자리를 나눈다(O-U6-5, 티켓도 신설을 권장).
--
-- 왜 표면별 컬럼이 아니라 key-value 인가 (팀 결정 2026-08-31)
--   설정이 하나 늘 때마다 마이그레이션이 붙으면 "설정 추가"가 스키마 변경 작업이 된다.
--   대신 **키 어휘와 값 해석은 서버가 소유한다** — notification_toggle.kind 와 같은 이유로
--   DB CHECK 를 걸지 않는다(어휘를 넓히자고 마이그레이션이 붙지 않게).
--
-- 파기
--   실제 30일 파기 배치는 아직 없다(auth 의 AccountDeletionRequested 주석 실측).
--   그래서 계정 행에 CASCADE 로 묶어 **구조적으로** 보장한다 — 배치가 생겨도 자동으로 지켜진다.
--   notification_toggle(V2.35)과 같은 관례다.

CREATE TABLE account_setting (
  account_id uuid        NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  key        varchar(48) NOT NULL,
  -- 값 해석(불리언·숫자·문자열)은 키마다 서버가 안다. 타입을 컬럼으로 나누면 key-value 로 둔 뜻이 사라진다.
  value      text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);
