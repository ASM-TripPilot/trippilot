-- change_log_entry — 변경 이력(changelog 계층, US-PLANB-09 · TRIP-275).
-- "이날 무엇을 왜 바꿨는지"를 되짚기 위한 기록이라 남은 뒤에는 바뀌지 않아야 한다 → append-only.
CREATE TABLE change_log_entry (
  change_log_entry_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id             uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  actor               varchar(64) NOT NULL,                 -- 변경 주체(수동 편집=계정 id)
  source_type         varchar(16) NOT NULL
                        CHECK (source_type IN ('PLAN_B','MANUAL','COEDIT','ASSISTANT')),
  reason              varchar(500),                          -- 선택 — Plan-B 는 트리거 사유를 싣는다
  before_snapshot     jsonb       NOT NULL,                  -- 변경 전 일정 스냅숏(시각·순서만, INV-3)
  after_snapshot      jsonb       NOT NULL,                  -- 변경 후 스냅숏
  at                  timestamptz NOT NULL
);

-- 타임라인 조회(여행별 최신순)
CREATE INDEX ix_change_log_trip_at ON change_log_entry (trip_id, at DESC);

-- append-only 강제 — 동의 증적·위치 법정 로그(V1.7)와 같은 방식으로 앱 롤에서 회수.
-- (여행 삭제 시에는 FK CASCADE 로 함께 정리된다 — 앱이 지우는 것이 아니다.)
REVOKE UPDATE, DELETE ON change_log_entry FROM app_user;
