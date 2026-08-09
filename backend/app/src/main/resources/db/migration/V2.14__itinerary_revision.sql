-- 일정 편집 이력·되돌리기(TRIP-310 · DEC-U3-1 · domain-entities §2.1).
-- U3 가 소유하는 것은 "사용자 편집 + AI 생성 기준 버전"뿐 — Plan-B 는 U4, 아카이브 change-log 는 U5(C12).
--
-- ⚠ 정본(§2.1)은 리비전을 itinerary 에 매답니다만, 이 코드베이스의 저장 방식이 그것을 허용하지 않는다:
--   · 편집·되돌리기는 `replaceForTrip`(DELETE→INSERT)라 itinerary 행이 매번 새로 만들어진다
--     → itinerary_id FK 를 CASCADE 로 걸면 **편집 한 번에 이력이 통째로 사라진다**
--   · 재생성은 새 itinerary_id 를 발급한다 → itinerary_id 로 묶으면 재생성 순간 과거 이력과 끊긴다
-- 그래서 수명 주기의 주인인 **trip 에 매단다**. itinerary_id 는 "어느 일정의 버전이었나"를 남기는 참고 값
-- (FK 미강제 — 교체돼 사라진 일정 id 도 그대로 보존).
CREATE TABLE itinerary_revision (
  revision_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  itinerary_id  uuid        NOT NULL,
  seq           integer     NOT NULL,
  actor         varchar(8)  NOT NULL CHECK (actor IN ('USER','AI')),
  kind          varchar(10) NOT NULL CHECK (kind IN ('BASELINE','GENERATE','EDIT','RESTORE')),
  summary       varchar(200) NOT NULL,
  detail        varchar(500),
  snapshot      jsonb       NOT NULL,
  created_at    timestamptz NOT NULL,
  -- INV-U3-06: seq 유일·단조. 동시 기록이 같은 seq 를 쓰는 것을 DB 가 막는다.
  CONSTRAINT ux_itinerary_revision_seq UNIQUE (trip_id, seq)
);

CREATE INDEX ix_itinerary_revision_trip ON itinerary_revision (trip_id, seq DESC);

-- 되돌리기는 과거 리비전을 지우지 않고 새 리비전을 쌓는다(BR-U3-32) → 앱은 개별 행을 지울 일이 없다.
REVOKE UPDATE, DELETE ON itinerary_revision FROM app_user;
