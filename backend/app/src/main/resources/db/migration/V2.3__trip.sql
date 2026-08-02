-- V2.3 trip (C6 · 밴드 g) — 여행 + 다도시 목적지 + 필수 방문지

CREATE TABLE trip (
  trip_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  title               varchar(120) NOT NULL,          -- 미입력 시 목적지 기반 자동생성
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  party               int  NOT NULL DEFAULT 1 CHECK (party >= 1),
  companion_type      varchar(8) CHECK (companion_type IN ('혼자','친구','연인','가족')),  -- 온보딩 '커플'→'연인' 매핑
  budget_total        bigint,                          -- 온보딩 취향 상속
  preference_snapshot jsonb NOT NULL,                  -- 생성시점 취향 동결 + 여행별 오버라이드
  status              varchar(12) NOT NULL DEFAULT 'PLANNED'
                      CHECK (status IN ('PLANNED','CONFIRMED','ACTIVE','ENDED')),  -- INV-U1-13 단방향
  deleted_at          timestamptz,                     -- 소프트 삭제
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_trip_dates CHECK (end_date >= start_date)   -- INV-U1-11
);
CREATE INDEX ix_trip_account ON trip (account_id, start_date DESC) WHERE deleted_at IS NULL;

CREATE TABLE trip_destination (
  trip_destination_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id  uuid NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  seq      int  NOT NULL,                             -- 표시 순서
  region   varchar(60) NOT NULL,
  nights   int  NOT NULL CHECK (nights >= 0),
  CONSTRAINT ux_trip_destination_seq UNIQUE (trip_id, seq)
  -- INV-U1-14 Σnights ≤ (end_date−start_date): 교차 집계라 서비스 검증
);

CREATE TABLE must_visit (
  must_visit_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         uuid NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  poi_snapshot_id uuid NOT NULL REFERENCES poi_snapshot(poi_snapshot_id),  -- 사본 참조(INV-U1-03)
  source_poi_id   uuid NOT NULL,                      -- 중복 판정 키(INV-U1-18)
  type            varchar(8) NOT NULL CHECK (type IN ('ANYTIME','FIXED')),
  fixed_date      date,
  fixed_start     time,
  dwell_min       int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_mustvisit_fixed CHECK (type <> 'FIXED' OR (fixed_date IS NOT NULL AND fixed_start IS NOT NULL)),  -- INV-U1-17
  CONSTRAINT ux_must_visit_poi UNIQUE (trip_id, source_poi_id)   -- INV-U1-18 동일 장소 중복 불가
);
