-- V2.4 거점 (밴드 g) — 구간 거점 + 날짜별 확정 거점(커버리지)
-- trip·saved_stay 의존이라 마지막.
-- saved_stay FK는 DEFERRABLE INITIALLY DEFERRED: 사용 중 숙소 직접 삭제는 차단(커밋 시 검사)하되,
-- 계정 퍼지(account CASCADE → saved_stay + trip→base_assignment 다이아몬드)는 커밋 시점엔 참조가 사라져 통과.
-- (즉시 RESTRICT/NO ACTION은 cascade 중 즉시 검사돼 계정 삭제를 깨뜨림 — 검증 확인)

CREATE TABLE base_assignment (
  base_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       uuid NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  saved_stay_id uuid NOT NULL REFERENCES saved_stay(saved_stay_id) DEFERRABLE INITIALLY DEFERRED,
  date_from     date NOT NULL,
  date_to       date NOT NULL,                        -- 다박=단일 배정(INV-U1-15)
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_base_dates CHECK (date_to > date_from)   -- INV-U1-15
);
CREATE INDEX ix_base_assignment_trip ON base_assignment (trip_id);
CREATE INDEX ix_base_assignment_stay ON base_assignment (saved_stay_id);   -- FK 검사·거점 조회

CREATE TABLE trip_base_day (
  trip_id       uuid NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  day_date      date NOT NULL,
  saved_stay_id uuid REFERENCES saved_stay(saved_stay_id) DEFERRABLE INITIALLY DEFERRED,  -- NULL 허용(destination_center)
  resolution    varchar(20) NOT NULL CHECK (resolution IN ('auto','prev_stay','destination_center','user_pick')),
  PRIMARY KEY (trip_id, day_date)                     -- 하루 1행 보장. 전-날짜 완비(INV-U1-16)는 CoverageResolver/PBT 소관
);
CREATE INDEX ix_trip_base_day_stay ON trip_base_day (saved_stay_id) WHERE saved_stay_id IS NOT NULL;
