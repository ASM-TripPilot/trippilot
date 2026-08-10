-- 재계획 세션(TRIP-273 · US-PLANB-01·02·12 · 스키마 정본 `전체-최소-스키마-설명.md` 밴드 i).
--
-- 재계획은 한 번의 요청으로 끝나지 않는다: 진입(사유·방식) → 대안 산출(비동기·외부 의존) → 선택 → 확정/취소.
-- 그 사이 상태를 남겨야 "왜 대안이 없었는지", "무엇을 되돌릴지"를 나중에도 말할 수 있다(침묵 금지 INV-4).
CREATE TABLE replan_session (
  replan_session_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  reason            varchar(10) NOT NULL CHECK (reason IN ('WEATHER','CLOSED','DELAY','CANCELED','FATIGUE','NONE')),
  mode              varchar(6)  NOT NULL CHECK (mode IN ('AI','MANUAL')),
  status            varchar(10) NOT NULL CHECK (status IN ('LOADING','PROPOSED','COMMITTED','CANCELED','UNDONE')),
  -- 대안 0건의 사유. 닫힌 집합이라야 화면이 문구를 정한다 — 자유 문자열이면 클라이언트가 분기하지 못한다.
  empty_reason      varchar(20) CHECK (empty_reason IN ('NO_REMAINING_SLOTS','NO_CANDIDATES','NOT_AVAILABLE','UPSTREAM_FAILED')),
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  -- 사유는 "찾아봤지만 없음"을 뜻한다 — 아직 산출 중(LOADING)에 있으면 화면이 빈 결과로 오해한다.
  CONSTRAINT chk_replan_empty_reason CHECK (empty_reason IS NULL OR status <> 'LOADING')
);

-- 한 여행에 진행 중 세션은 **하나뿐**. 둘이 열리면 어느 쪽을 확정할지 서버가 답할 수 없고,
-- 되돌리기 기준(baseline)도 갈라진다. 종료된 세션은 이력이라 얼마든지 쌓인다(부분 인덱스).
CREATE UNIQUE INDEX ux_replan_session_active
  ON replan_session (trip_id)
  WHERE status IN ('LOADING','PROPOSED');

CREATE INDEX ix_replan_session_trip ON replan_session (trip_id, created_at DESC);
