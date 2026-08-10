-- Plan-B 감지·억제(TRIP-273 · C9 · U4 정본 §2).
--
-- 판정 결과를 **발화하지 않은 것까지** 남긴다. "왜 알림이 안 왔나"를 답할 수 있어야 하기 때문이다
-- (억제됐는지, 영향이 없다고 봤는지, 외부 조회가 실패했는지는 서로 다른 사실이다).
CREATE TABLE plan_b_trigger (
  trigger_id     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        uuid         NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  -- 어느 일정에 대한 판정인가. FK 를 걸지 않는다 — 일정은 재생성으로 교체되는데(DELETE→INSERT)
  -- CASCADE 면 그 순간 판정 이력이 통째로 사라진다.
  itinerary_id   uuid         NOT NULL,
  -- BR-U4-01: 4종뿐. ai `TriggerKind` 가 정본이며 백엔드가 종류를 늘리지 않는다(DEC-U4-4).
  -- '체류 초과'는 DELAY 의 payload 변형이고, '교통'은 존재하지 않는다.
  kind           varchar(7)   NOT NULL CHECK (kind IN ('WEATHER','CLOSURE','DELAY','MANUAL')),
  affected_date  date         NOT NULL,
  -- 영향받는 슬롯의 **경계 키**("{date}#{poiId}", BR-U2-04). 날짜 전체 영향이면 null.
  -- 물리 키가 아닌 이유: 재계획으로 슬롯 행이 갈려도 판정 이력의 참조가 끊기지 않게.
  slot_key       varchar(100),
  -- 직렬화 가능 원시값만(ai 규약). 예: {"pop":70} · {"delayMin":18}
  payload        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  should_replan  boolean      NOT NULL,
  scope          varchar(13)  CHECK (scope IN ('FULL_DAY','PARTIAL_SLOTS','NONE')),
  reason         varchar(200) NOT NULL,
  -- ACTIVE=발화 중 · SUPPRESSED=억제돼 발화 안 함 · CONSUMED=재계획 확정에 쓰임 · EXPIRED=대상 슬롯이 지남
  state          varchar(10)  NOT NULL CHECK (state IN ('ACTIVE','SUPPRESSED','CONSUMED','EXPIRED')),
  detected_at    timestamptz  NOT NULL,
  -- INV-U4-01: 발화하지 않기로 한 판정(should_replan=false)이 ACTIVE 로 남으면 화면에 노출된다.
  CONSTRAINT chk_plan_b_trigger_active CHECK (state <> 'ACTIVE' OR should_replan)
);

-- BR-U4-07: 동일 kind × 동일 slotKey 는 1회만 발화한다. 앱이 먼저 막지만, 지오펜스가 동시에 두 번
-- 깨워도(BR-U4-04) 배너가 둘로 늘지 않도록 DB 가 마지막 방어선이 된다.
CREATE UNIQUE INDEX ux_plan_b_trigger_active
  ON plan_b_trigger (trip_id, kind, COALESCE(slot_key, ''))
  WHERE state = 'ACTIVE';

CREATE INDEX ix_plan_b_trigger_trip ON plan_b_trigger (trip_id, detected_at DESC);

-- 억제 상태 — "그대로 둘게요" / i10 의 [끄기](BR-U4-15: 화면에서 배너만 감추는 동작이 아니다).
CREATE TABLE plan_b_suppression (
  suppression_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  kind           varchar(7)  NOT NULL CHECK (kind IN ('WEATHER','CLOSURE','DELAY','MANUAL')),
  slot_key       varchar(100),
  scope_type     varchar(4)  NOT NULL CHECK (scope_type IN ('SLOT','DAY','TRIP')),
  suppressed_at  timestamptz NOT NULL,
  -- 만료 없으면 여행 종료까지.
  expires_at     timestamptz,
  -- SLOT 범위 억제는 대상 슬롯이 있어야 뜻이 있다. DAY·TRIP 은 넓은 범위라 슬롯이 없다.
  CONSTRAINT chk_plan_b_suppression_slot CHECK (scope_type <> 'SLOT' OR slot_key IS NOT NULL)
);

CREATE INDEX ix_plan_b_suppression_trip ON plan_b_suppression (trip_id, kind);

-- 알림 민감도. 정본은 **계정 단위** 설정이라 하고, 물리 소유(profile 이관 여부)는 U6 설정과 함께 정한다(G-U4-6).
-- 그 결정 전까지 여기 최소 형태로 둔다 — 행이 없으면 NORMAL 로 본다(설정이 없다고 알림이 멈추면 안 된다).
CREATE TABLE plan_b_sensitivity (
  account_id  uuid        PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
  sensitivity varchar(6)  NOT NULL CHECK (sensitivity IN ('LOW','NORMAL','HIGH')),
  updated_at  timestamptz NOT NULL
);
