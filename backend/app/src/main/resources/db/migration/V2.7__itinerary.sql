-- V2.7 itinerary (C8 · 밴드 h) — AI 일정 생성 결과 영속 (TRIP-266 · U3)
-- 근거: backend/docs/design/ai-backend-경계-계약-초안.md · construction u3-itinerary
-- itinerary → itinerary_day → visit_slot. 표시 시각·순서는 솔버 검증값만(INV-2), 소요시간(duration) 컬럼 없음(INV-3).
-- poi_snapshot_id 는 확정 시 동결(INV-U1-03) — PLANNED 동안 NULL.

CREATE TABLE itinerary (
  itinerary_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       uuid NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  status        varchar(12) NOT NULL DEFAULT 'PLANNED'
                CHECK (status IN ('PLANNED','CONFIRMED')),   -- 단방향 잠금
  solve_mode    varchar(16) NOT NULL CHECK (solve_mode IN ('FULL_AI','DETERMINISTIC','MINIMAL')),
  is_fallback   boolean     NOT NULL DEFAULT false,          -- INV-4 폴백 표시
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_itinerary_trip ON itinerary (trip_id);

CREATE TABLE itinerary_day (
  itinerary_day_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id     uuid NOT NULL REFERENCES itinerary(itinerary_id) ON DELETE CASCADE,
  day_date         date NOT NULL,
  day_order        int  NOT NULL,
  CONSTRAINT ux_itinerary_day_order UNIQUE (itinerary_id, day_order)
);
CREATE INDEX ix_itinerary_day_itinerary ON itinerary_day (itinerary_id);

CREATE TABLE visit_slot (
  visit_slot_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_day_id uuid NOT NULL REFERENCES itinerary_day(itinerary_day_id) ON DELETE CASCADE,
  source_poi_id    uuid NOT NULL,                                   -- 생성 시점 POI(poi_id). FK 미강제(place-data 변동 무관).
  poi_snapshot_id  uuid REFERENCES poi_snapshot(poi_snapshot_id),   -- 확정 시 동결(INV-U1-03), 그전 NULL
  order_index      int  NOT NULL,
  start_at         time NOT NULL,                                   -- 솔버 검증값만(INV-2)
  end_at           time NOT NULL,
  is_fixed         boolean NOT NULL DEFAULT false,                  -- 고정 블록(HC3)
  has_violation    boolean NOT NULL DEFAULT false,                  -- 위반 채로 저장 허용(편집)
  CONSTRAINT ux_visit_slot_order UNIQUE (itinerary_day_id, order_index),
  CONSTRAINT chk_visit_slot_time CHECK (end_at >= start_at)
  -- INV-3: 소요시간(duration) 컬럼 없음 — 거리만 표시.
);
CREATE INDEX ix_visit_slot_day ON visit_slot (itinerary_day_id);
