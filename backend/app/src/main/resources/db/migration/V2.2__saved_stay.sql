-- V2.2 saved-accommodation (C4 · 밴드 e·g) — 저장/등록 숙소(앱 소유·등록시점 값 보존)

CREATE TABLE saved_stay (
  saved_stay_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  name            varchar(200) NOT NULL,             -- 등록시점 보존(외부 조회 불가해져도 사용)
  lat             double precision,                   -- 등록시점 좌표
  lng             double precision,
  coord_confirmed boolean NOT NULL DEFAULT false,     -- INV-U1-08 false면 거점 배정 불가
  check_in        date,                               -- nullable(저장만 한 숙소)
  check_out       date,
  external_source varchar(40),                        -- 직접등록(PIN)이면 NULL
  external_id     varchar(120),
  register_route  varchar(12) NOT NULL CHECK (register_route IN ('MAP_SEARCH','LINK_PASTE','PIN')),  -- 3경로
  memo            varchar(500),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_savedstay_dates CHECK (check_out IS NULL OR check_in IS NULL OR check_out > check_in),  -- INV-U1-09
  CONSTRAINT chk_savedstay_coord CHECK ((lat IS NULL) = (lng IS NULL) AND (NOT coord_confirmed OR lat IS NOT NULL))  -- 좌표 쌍 + INV-U1-08 확정=좌표 존재
);
CREATE INDEX ix_saved_stay_account ON saved_stay (account_id, created_at DESC);
