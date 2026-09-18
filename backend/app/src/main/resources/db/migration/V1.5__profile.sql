-- V1.5 M2 Profile — 프로필 · 취향 7축

CREATE TABLE profile (
  account_id uuid PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
  nickname   varchar(20) NOT NULL CHECK (char_length(nickname) BETWEEN 2 AND 20),
  nickname_updated_at     timestamptz NOT NULL DEFAULT now(),
  onboarding_completed_at timestamptz                 -- NULL=미완료
);
-- 확정: 전역 유일 인덱스 + 계정 파기 시 닉네임 해제(tombstone/NULL화)로 '활성 계정 간 유일' 구현
CREATE UNIQUE INDEX ux_profile_nickname ON profile (lower(nickname));

CREATE TABLE preference_set (
  account_id  uuid PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
  styles          text[]      CHECK (styles IS NULL OR styles <@ ARRAY['휴양','관광','액티비티','미식','쇼핑','자연','문화예술']),
  budget_tier     varchar(8)  CHECK (budget_tier IN ('저가','중간','고급','럭셔리')),
  budget_raw_amount bigint     CHECK (budget_raw_amount IS NULL OR budget_raw_amount > 0),
  companion_types text[]      CHECK (companion_types IS NULL OR companion_types <@ ARRAY['혼자','커플','친구','가족','부모님']),  -- 다중 선택(와이어프레임 c12)
  pet_flag        boolean     NOT NULL DEFAULT false,   -- '반려동물 동반' 칩
  activities      text[]      CHECK (activities IS NULL OR activities <@ ARRAY['자연','역사문화','테마파크','맛집투어','카페','전시','야경','쇼핑']),
  transport_modes text[]      CHECK (transport_modes IS NULL OR transport_modes <@ ARRAY['도보','대중교통','렌터카','택시','자전거']),
  food_tastes     text[]      CHECK (food_tastes IS NULL OR food_tastes <@ ARRAY['한식','양식','일식','중식','아시안']),
  pace            varchar(12) CHECK (pace IN ('느긋하게','균형있게','알차게')),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_budget_pair CHECK (budget_raw_amount IS NULL OR budget_tier IS NOT NULL)  -- INV-PR3
);
-- INV-PR2: 각 축 NULL=미설정, 비NULL=선택함. 중립 기본값은 저장 안 하고 조회 시 파생.
