-- 생성 진행 상태(TRIP-312 · U3 정본 §2.2 · BR-U3-04·05 · US-SCHED-09).
--
-- 왜 필요한가: 생성 POST 는 day1 만 담긴 PARTIAL 을 즉시 돌려주는데, 화면이 그릴
-- **단계 텍스트·[백그라운드로]·[취소]** 의 상태 원천이 없었다. 프론트(h09·h10)가 이 표면을 기다린다.
--
-- ⚠ V2.21 은 미머지 PR(visit_check)이 쓰고 있어 V2.22 를 쓴다. 두 PR 의 머지 순서와 무관하게 충돌하지 않는다.
--
-- 정본 §2.2 이탈 — `partial jsonb`(day1 만 담긴 중간 결과)를 만들지 않는다.
-- day1 은 이미 일정 행에 `PARTIAL` 상태로 저장돼 있고 화면도 일정 조회로 읽는다. 세션에 사본을 더 두면
-- 두 벌이 갈라졌을 때 어느 쪽이 사실인지 판단할 근거가 없다. 읽는 곳이 생기면 그때 컬럼을 추가한다.
CREATE TABLE generation_session (
  session_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  -- day1 확정 전에는 null 이다(정본 §2.2). 일정 행이 생기기 전에도 세션은 존재한다.
  -- FK 를 걸지 않는다 — 일정은 재생성으로 교체되는데(DELETE→INSERT) CASCADE 면 그 순간 이력이 사라진다.
  itinerary_id      uuid,
  status            varchar(10) NOT NULL
    CHECK (status IN ('RUNNING','DAY1_READY','COMPLETED','FAILED','CANCELED')),
  mode              varchar(9)  NOT NULL CHECK (mode IN ('FULLY_AI','CO_PLAN','MANUAL')),
  -- 폴백 배너의 근거(BR-U3-11 · INV-4 침묵 금지) — 경계 응답 전달분이다.
  is_fallback       boolean     NOT NULL DEFAULT false,
  candidates_level  varchar(10),
  -- 진행률·단계 텍스트의 원천. 진행률 자체는 저장하지 않는다 — 시각에서 파생된다.
  started_at        timestamptz NOT NULL,
  day1_ready_at     timestamptz,
  finished_at       timestamptz,
  -- 끝난 세션에는 끝난 시각이 있고, 진행 중에는 없다.
  CONSTRAINT chk_generation_session_finished
    CHECK ((status IN ('RUNNING','DAY1_READY')) = (finished_at IS NULL))
);

-- 한 여행에 진행 중 세션은 하나뿐 — 둘이면 화면이 어느 진행률을 그릴지 정할 수 없다.
-- 끝난 세션은 이력이라 얼마든지 쌓인다(부분 인덱스).
CREATE UNIQUE INDEX ux_generation_session_running
  ON generation_session (trip_id)
  WHERE status IN ('RUNNING','DAY1_READY');

CREATE INDEX ix_generation_session_trip ON generation_session (trip_id, started_at DESC);
