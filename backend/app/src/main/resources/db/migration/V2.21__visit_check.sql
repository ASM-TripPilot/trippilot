-- 방문 실적(TRIP-U4 · C10 · U4 정본 §3.1 · DEC-U4-10).
--
-- `plan`(= visit_slot)과 구분되는 **`actual` 계층의 첫 조각**이다. 계획은 "가기로 한 것",
-- 여기는 "실제로 간 것"이라 서로 덮어쓰지 않는다.
--
-- ⚠ **사진·메모 컬럼을 만들지 않는다**(정본 G-U4-5). 이 테이블은 U5 C12 Travel Archive 로 이관 예정이고,
-- 확장은 U5 가 승계한다. 여기서 미리 늘리면 이관 시 두 설계가 충돌한다.
CREATE TABLE visit_check (
  visit_check_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  -- 슬롯 **경계 키**("{date}#{poiId}", BR-U2-04). 물리 키가 아닌 이유: 재계획으로 슬롯 행이 갈려도
  -- 실적의 참조가 끊기지 않아야 한다. 즉석 방문(계획에 없던 곳)이면 null.
  slot_key       varchar(100),
  poi_id         uuid        NOT NULL,
  arrived_at     timestamptz,
  completed_at   timestamptz,
  -- 건너뜀(취소). U4 정본 §3.1 의 최소 집합에는 없지만 **TRIP-118 이 '방문 완료/취소'를 요구**한다.
  -- 요약 스키마 문서의 visit_record.status 도 completed/skipped 를 나눈다. 정본 최소분의 확장이며,
  -- U5 이관 시 status enum 으로 흡수될 수 있다.
  skipped_at     timestamptz,
  -- 자동(지오펜스) / 수동 체크인. 권한이 없거나 정확도가 낮으면 수동으로 대체된다(BR-U4-36).
  source         varchar(14) NOT NULL CHECK (source IN ('AUTO_GEOFENCE','MANUAL')),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  -- 완료는 도착 이후다. 순서가 뒤집히면 파생 체류가 음수가 된다.
  CONSTRAINT chk_visit_check_order CHECK (completed_at IS NULL OR (arrived_at IS NOT NULL AND completed_at >= arrived_at)),
  -- 완료와 건너뜀은 동시에 참일 수 없다 — 둘 다 있으면 '갔나 안 갔나'가 갈린다.
  CONSTRAINT chk_visit_check_outcome CHECK (completed_at IS NULL OR skipped_at IS NULL)
);

-- 같은 슬롯에 실적이 둘이면 "완료됐나"가 갈린다(INV-U4-04 의 잠금 판정이 흔들린다).
-- 즉석 방문(slot_key null)은 여러 건일 수 있어 부분 인덱스로 둔다.
CREATE UNIQUE INDEX ux_visit_check_slot ON visit_check (trip_id, slot_key) WHERE slot_key IS NOT NULL;

CREATE INDEX ix_visit_check_trip ON visit_check (trip_id, arrived_at DESC);

-- 체류(dwell)는 **컬럼으로 두지 않는다** — completed_at − arrived_at 파생값이다(정본 §3.1).
-- 저장하면 두 값과 어긋날 수 있고, 어긋난 쪽이 무엇인지 나중에 알 수 없다.
