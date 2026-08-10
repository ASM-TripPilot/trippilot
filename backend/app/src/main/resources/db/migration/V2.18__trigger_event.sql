-- 재계획 트리거(TRIP-273 · US-PLANB-02 · C9) — 여행 중 감지된 변화와 그 억제 상태.
--
-- 이 테이블의 목적은 "무엇을 감지했나"보다 **"이미 말했나"**에 가깝다. 같은 사실을 반복해서 알리면
-- 사용자는 배너를 무시하게 되고, 그러면 정작 중요한 신호도 묻힌다(허위·과다 알림 금지).
CREATE TABLE trigger_event (
  trigger_event_id uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          uuid         NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  -- 4카테고리(정본 `전체-최소-스키마-설명.md` 밴드 i): 강수·당일휴무·이동지연·체류초과.
  type             varchar(10)  NOT NULL CHECK (type IN ('WEATHER','HOURS','DELAY','STAY_OVER')),
  -- 어느 방문지에 대한 신호인가. null = 일정 전체(예: 광역 특보).
  -- FK 를 걸지 않는다 — 슬롯은 편집·재생성으로 교체되는데(DELETE→INSERT) 그때 이력이 통째로 사라진다
  -- (itinerary_revision 에서 겪은 것과 같은 함정).
  target_slot_id   uuid,
  -- 감지값 요약(예: "강수확률 80%"). 표시용이며 판정에 쓰지 않는다.
  value            varchar(200) NOT NULL,
  -- ACTIVE=알리는 중 · NORMAL=상황이 해소됨 · DISMISSED=사용자가 "그대로 둘게요"
  status           varchar(9)   NOT NULL CHECK (status IN ('ACTIVE','NORMAL','DISMISSED')),
  detected_at      timestamptz  NOT NULL,
  updated_at       timestamptz  NOT NULL
);

-- 같은 사유·같은 방문지로 **동시에 두 번 알리지 않는다**. 앱이 먼저 걸러내지만, 감지가 동시에 두 번
-- 돌아도(스케줄러 중복 기동 등) DB 가 마지막 방어선이 된다.
CREATE UNIQUE INDEX ux_trigger_event_active
  ON trigger_event (trip_id, type, COALESCE(target_slot_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'ACTIVE';

CREATE INDEX ix_trigger_event_trip ON trigger_event (trip_id, detected_at DESC);

-- 트리거 민감도(여행 단위). 없으면 NORMAL 로 본다 — 행이 없다고 알림이 멈추면 안 된다.
--
-- 사용자 설정 화면(U6 설정/마이페이지)이 아직 없어 **변경 API 를 두지 않는다**. 여기 값을 바꾸는 경로가
-- 생기면 그때 profile 로 옮길지 여행 단위로 남길지 정한다(지금 정하면 근거 없이 고르는 셈이다).
CREATE TABLE replan_trigger_setting (
  trip_id     uuid        PRIMARY KEY REFERENCES trip(trip_id) ON DELETE CASCADE,
  sensitivity varchar(6)  NOT NULL CHECK (sensitivity IN ('LOW','NORMAL','HIGH')),
  updated_at  timestamptz NOT NULL
);
