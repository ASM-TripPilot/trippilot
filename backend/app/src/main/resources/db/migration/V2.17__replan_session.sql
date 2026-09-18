-- 재계획 세션(TRIP-273 · U4 정본 `construction/u4-in-trip-planb/functional-design/domain-entities.md` §3.2).
--
-- i10 제출 ~ i18 확정/취소까지의 수명. 확정 전까지 **원 일정에는 아무것도 쓰지 않는다**(INV-U4-05) —
-- 재계획안은 여기 `draft` 에만 있고, APPLIED 가 될 때 비로소 itinerary·visit_slot 에 반영된다.
CREATE TABLE replan_session (
  session_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  -- 어느 일정을 다시 짜는가. FK 를 걸지 않는다 — 일정은 재생성으로 교체되는데(DELETE→INSERT)
  -- CASCADE 면 그 순간 세션 이력이 통째로 사라진다(itinerary_revision 에서 겪은 것과 같은 함정).
  itinerary_id     uuid        NOT NULL,
  -- 자동 진입이면 근거 트리거를 동반한다. 수동 진입이면 null.
  trigger_id       uuid,
  scope            varchar(13) NOT NULL CHECK (scope IN ('PARTIAL_SLOTS','FULL_DAY')),
  -- '지금 이후'의 기준점. 이 시각 이전 슬롯은 재계획 대상이 아니다.
  from_instant     timestamptz NOT NULL,
  -- 출발 기준점(§5 사다리). GPS 가 없으면 수동 핀 → 마지막 방문지 → 숙소 순으로 내려간다.
  origin_kind      varchar(11) NOT NULL CHECK (origin_kind IN ('GPS','MANUAL','LAST_VISIT','STAY_ANCHOR')),
  origin_lat       double precision,
  origin_lng       double precision,
  -- i10 의 '왜'(다중) · '어떻게'(다중) · 자유 입력. 어휘를 서버가 강제하지 않는다 — 화면이 고른 값을 그대로 싣는다.
  reasons          text[]      NOT NULL DEFAULT '{}',
  directives       text[]      NOT NULL DEFAULT '{}',
  free_text        varchar(500),
  -- '건너뛰기'가 채운다. 재계획 시 이 장소들을 후보에서 뺀다.
  excluded_poi_ids uuid[]      NOT NULL DEFAULT '{}',
  status           varchar(12) NOT NULL
    CHECK (status IN ('COLLECTING','SOLVING','DRAFT','APPLIED','CANCELED','FAILED','NO_SOLUTION')),
  -- 산출된 재계획안. 확정 전에는 여기에만 존재한다(INV-U4-05).
  draft            jsonb,
  created_at       timestamptz NOT NULL,
  closed_at        timestamptz,
  -- 열린 상태에서 닫힌 시각이 있을 수 없고, 닫혔는데 없을 수도 없다.
  CONSTRAINT chk_replan_session_closed
    CHECK ((status IN ('COLLECTING','SOLVING','DRAFT')) = (closed_at IS NULL)),
  -- GPS·수동 기준점은 좌표가 있어야 뜻이 있다. 나머지(마지막 방문지·숙소)는 서버가 유도하므로 없을 수 있다.
  CONSTRAINT chk_replan_session_origin
    CHECK (origin_kind NOT IN ('GPS','MANUAL') OR (origin_lat IS NOT NULL AND origin_lng IS NOT NULL))
);

-- INV-U4-06: 한 여행에 열린 세션은 **최대 1개**. 앱은 새 진입 시 기존 세션을 CANCELED 로 닫고 시작하지만,
-- 동시 요청이 겹쳐도 둘이 열리지 않도록 DB 가 마지막 방어선이 된다.
CREATE UNIQUE INDEX ux_replan_session_open
  ON replan_session (trip_id)
  WHERE status IN ('COLLECTING','SOLVING','DRAFT');

CREATE INDEX ix_replan_session_trip ON replan_session (trip_id, created_at DESC);
